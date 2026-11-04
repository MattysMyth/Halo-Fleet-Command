/**
 * Headless balance simulation.
 *
 * Plays the real engine (src/sim) with a simple "engaged player" bot so pacing can be checked
 * against the design targets without opening a browser. Run with:
 *
 *   npm run balance                      # defaults: 2 clicks/s, a decision every 3 s
 *   npm run balance -- --clicks 0 --interval 600 --cycles 6
 *   npm run balance -- --fleet 0         # economy only, to compare with build 0.1
 *
 * The bot buys Requisition buildings by payback, keeps Titanium and Deuterium income in line with
 * the size of its fleet, builds frigates up to the group's Command capacity, runs the campaign with
 * automatic abilities, trains on Patrol when the campaign stalls, redeploys when the Medal gain is
 * worth it, and spends Medals in a fixed priority order.
 */
import { ARMORY, BUILDINGS, ECONOMY, FLEET, MARINE, DOCTRINES, MARINE_UNITS, NODES, POSITIONS, RESEARCH, SHIP_BY_ID, VEHICLES, WARROOM } from '../src/data';
import { formatDuration, formatNumber } from '../src/core/numbers';
import { buyArmory, canBuyArmory } from '../src/sim/armory';
import { activeTheatre, commandCapacity, patrolOptions, theatreCleared, isCleared, isShipUnlocked, nextCampaignNode } from '../src/sim/campaign';
import { buyWarroom, canBuyWarroom } from '../src/sim/warroom';
import { canTransfer, transfer, transferOpens } from '../src/sim/transfer';
import {
  buy,
  costOf,
  drive,
  driveYield,
  isUnlocked,
  productionByResource,
  productionMultiplier,
  productionPerSecond,
  resourceOf,
  unitOutput,
  globalMultiplier,
} from '../src/sim/economy';
import { buySlip, decommission, estimatePatrol, groupCommand, queueShip, resumeGroup, runtimeOf, setAutoAbilities, setOrder, setPatrolNode, slipCost } from '../src/sim/fleet';
import {
  autoPerks,
  chooseTactic,
  fitVehicle,
  isUnitUnlocked,
  isVehicleUnlocked,
  missionOdds,
  previewTactics,
  readyIn,
  runtimeOf as squadRuntime,
  setAuto,
  setMission,
  setStanding,
  setTarget,
  squadsAllowed,
  stageContext,
  startMission,
  resumeSquad,
  targetProblem,
} from '../src/sim/marines';
import { isCaptured } from '../src/sim/campaign';
import { adoptDoctrine, startResearch } from '../src/sim/research';
import { researchBays } from '../src/sim/armory';
import { redeploy, redeployGain } from '../src/sim/prestige';
import { stepWorld } from '../src/sim/world';
import { newGameState } from '../src/state/serialize';
import type { GameState } from '../src/state/types';

/* ---------- options ---------- */

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const CLICKS_PER_SECOND = arg('clicks', 2);
const DECISION_INTERVAL = Math.max(1, Math.floor(arg('interval', 3)));
const MAX_HOURS = arg('hours', 12);
const CYCLES = Math.floor(arg('cycles', 6));
const USE_FLEET = arg('fleet', 1) !== 0;
const USE_MARINES = USE_FLEET && arg('marines', 1) !== 0;
const MAX_BOT_SQUADS = arg('squads', 2);
const PERS_PER_SQUAD = arg('persSquad', 0.25);
const INTEL_PER_SQUAD = arg('intelSquad', 0.12);
/** `--late 1`: build cruisers, Transfer when a theatre falls, and play on into the later theatres. */
const LATE = arg('late', 0) !== 0;

/* ---------- buying buildings ---------- */

const plannedCommand = (s: GameState): number =>
  groupCommand(s, 1) + s.run.fleet.queue.reduce((n, j) => n + SHIP_BY_ID[j.classId].command, 0);

function rpTarget(s: GameState): { id: string; cost: number } | null {
  const rate = productionPerSecond(s).toNumber() + CLICKS_PER_SECOND * driveYield(s).toNumber();
  const pm = productionMultiplier(s);
  let best: { id: string; cost: number; score: number } | null = null;

  for (const def of BUILDINGS) {
    if (resourceOf(def) !== 'rp' || !isUnlocked(s, def)) continue;
    const owned = s.run.owned[def.id] ?? 0;
    const cost = costOf(def, owned, 1).toNumber();
    const delta = ((owned + 1) * unitOutput(def, owned + 1) - owned * unitOutput(def, owned)) * pm;
    const payback = cost / delta;
    const rp = s.run.rp.toNumber();
    const wait = cost > rp ? (cost - rp) / Math.max(rate, 1e-9) : 0;
    let score = payback + wait;

    // Players buy toward the next unlock, so favour a building that still gates a locked tier.
    const gates = BUILDINGS.some(
      (l) => l.unlock.kind === 'owned' && l.unlock.building === def.id && owned < l.unlock.count && !isUnlocked(s, l),
    );
    if (gates) score *= 0.5;

    if (!best || score < best.score) best = { id: def.id, cost, score };
  }
  return best;
}

/** Income a sensible player wants, scaled to the fleet they are running. */
type Chain = 'ti' | 'deut' | 'pers' | 'intel';

function incomeTarget(s: GameState, res: Chain): number {
  const cmd = Math.max(1, plannedCommand(s));
  if (res === 'ti') return Math.max(1.2 + 0.45 * cmd, LATE ? (wantedClass(s)?.cost.ti ?? 0) / 1800 : 0);
  if (res === 'deut') return 0.08 + 0.035 * cmd;
  const squads = squadsAllowed(s);
  if (res === 'pers') return 0.1 + PERS_PER_SQUAD * squads;
  return 0.04 + INTEL_PER_SQUAD * squads;
}

function resourceTarget(s: GameState, res: Chain): { id: string; cost: number } | null {
  const rates = productionByResource(s);
  if (rates[res].toNumber() >= incomeTarget(s, res)) return null;
  let best: { id: string; cost: number; perCost: number } | null = null;
  for (const def of BUILDINGS) {
    if (resourceOf(def) !== res || !isUnlocked(s, def)) continue;
    const owned = s.run.owned[def.id] ?? 0;
    const cost = costOf(def, owned, 1).toNumber();
    const gain = ((owned + 1) * unitOutput(def, owned + 1) - owned * unitOutput(def, owned)) * productionMultiplier(s);
    const perCost = gain / cost;
    if (!best || perCost > best.perCost) best = { id: def.id, cost, perCost };
  }
  return best;
}

/** Requisition a player sets aside for the next frigate once they have the Titanium for it. */
function reserve(s: GameState): number {
  if (!USE_FLEET) return 0;
  const f = s.run.fleet;
  const frigate = SHIP_BY_ID.frigate;
  const wants = plannedCommand(s) + 1 <= commandCapacity(s.meta) && f.queue.length < f.slips + 1;
  return wants && s.run.ti.gte(frigate.cost.ti) && s.run.fleet.ships.length + f.queue.length < 3 ? frigate.cost.rp : 0;
}

/** The building to buy next on the way to owning at least one of `id`: the building itself, or whatever still gates it. */
function gateTarget(s: GameState, id: string): string {
  const def = BUILDINGS.find((b) => b.id === id)!;
  if (isUnlocked(s, def) || def.unlock.kind !== 'owned') return id;
  return gateTarget(s, def.unlock.building);
}

/** Barracks Complexes are what opens more squads, so a marine player buys them as soon as they are affordable. */
function barracksTarget(s: GameState): { id: string; cost: number } | null {
  if (!USE_MARINES || !s.meta.opsUnlocked) return null;
  const need = MARINE.squadBarracks.filter((b) => b > (s.run.owned.barracks ?? 0)).sort((a, b) => a - b)[0];
  if (need === undefined || squadsAllowed(s) >= MAX_BOT_SQUADS) return null;
  const id = gateTarget(s, 'barracks');
  const def = BUILDINGS.find((b) => b.id === id)!;
  return { id, cost: costOf(def, s.run.owned[id] ?? 0, 1).toNumber() };
}

function botBuy(s: GameState): void {
  for (let guard = 0; guard < 2000; guard++) {
    const held = reserve(s);
    let target: { id: string; cost: number } | null = null;
    const bt = barracksTarget(s);
    if (bt && s.run.rp.toNumber() >= bt.cost + held && bt.cost <= s.run.rp.toNumber() * 0.35) target = bt;
    if (!target && USE_FLEET) {
      // Resource buildings come first when income lags the fleet, but never with more than a third of the stock.
      const chains: Chain[] = USE_MARINES && s.meta.opsUnlocked ? ['ti', 'deut', 'pers', 'intel'] : ['ti', 'deut'];
      for (const res of chains) {
        const t = resourceTarget(s, res);
        if (t && s.run.rp.toNumber() >= t.cost + held && t.cost <= s.run.rp.toNumber() * 0.5) {
          target = t;
          break;
        }
      }
    }
    if (!target) {
      const t = rpTarget(s);
      if (t && s.run.rp.gte(t.cost + held)) target = t;
    }
    if (!target) return;
    if (buy(s, target.id, 1) === 0) return;
  }
}


/* ---------- running the marines ---------- */

const WANTS = ['marine', 'marine', 'marine', 'marine', 'marksman', 'corpsman'];

/** What a thoughtful player wants this squad doing next: scout or take the easiest open position, else patrol. */
function planFor(s: GameState, squad: GameState['run']['marines']['squads'][number]): { kind: 'recon' | 'assault'; node: string } | null {
  const ms = s.run.marines;
  const next = POSITIONS.filter((p) => targetProblem(s, 'assault', p.node) === null).sort((a, b) => a.threat - b.threat)[0];
  if (!next || squad.id !== 1 || s.run.pers.lt(next.garrison + 4)) return null;
  const scouts = ms.scouted[next.node] ?? 0;
  if (process.argv.includes('--decisions') && Math.floor(s.run.elapsed) % 300 < 3) {
    console.log(`   [${formatDuration(s.run.elapsed)}] next ${next.node} pers ${s.run.pers.toFixed(0)} scouts ${scouts} recon ${missionOdds(s, squad, 'recon', next.node).worst.toFixed(2)} assault all ${missionOdds(s, squad, 'assault', next.node).all.toFixed(2)} ready ${readyIn(squad).length} veh ${squad.vehicle}`);
  }
  if (scouts * MARINE.recon.perScout < MARINE.recon.cap && missionOdds(s, squad, 'recon', next.node).worst >= 0.5) return { kind: 'recon', node: next.node };
  if (missionOdds(s, squad, 'assault', next.node).all >= ASSAULT_MIN) return { kind: 'assault', node: next.node };
  return null;
}

let marineRp = 0;
const seenSummary = new WeakSet<object>();

function botMarines(s: GameState): void {
  if (!s.meta.opsUnlocked) return;
  const ms = s.run.marines;
  for (const sq of ms.squads) {
    const last = squadRuntime(s, sq.id).last;
    if (last && !seenSummary.has(last)) {
      seenSummary.add(last);
      marineRp += last.rp.toNumber();
    }
  }

  // Research: fill every bay with whatever is affordable, cheapest first. `--research 0` turns the bot's research off.
  if (arg('research', 1) > 0) {
    for (const r of [...RESEARCH].sort((a, b) => a.intel - b.intel)) {
      if (s.run.research.active.length >= researchBays(s.meta)) break;
      startResearch(s, r.id);
    }
    const doc = DOCTRINES[Math.floor(arg('doctrine', 0)) - 1];
    if (doc && !s.run.doctrine.picked.includes(doc.id)) adoptDoctrine(s, 0, doc.id);
  }

  for (const squad of ms.squads) {
    const rt = squadRuntime(s, squad.id);
    const plan = planFor(s, squad);
    if (rt.mission) {
      // Attended assaults: pick the best tactic when the brief opens.
      if (rt.mission.phase === 'brief') {
        const ctx = stageContext(squad, rt.mission);
        const best = previewTactics(s, ctx)
          .filter((t) => t.available && (t.deut === 0 || s.run.deut.gte(t.deut)))
          .sort((a, b) => b.p - a.p)[0];
        if (best) chooseTactic(s, squad.id, best.id);
      }
      // A squad on auto patrol finishes what it is doing, then stands by for the plan.
      if (plan && squad.auto && rt.mission.kind !== plan.kind) setAuto(s, squad.id, false);
      continue;
    }

    // Roster: the wanted mix, perks, the best vehicle the stock can pay for.
    squad.want = squad.want.map((_, i) => {
      const unit = WANTS[i] ?? 'marine';
      return isUnitUnlocked(s, MARINE_UNIT_BY_ID(unit)) ? unit : 'marine';
    });
    autoPerks(s, squad.id);
    setStanding(s, squad.id, 'adaptive');
    for (const v of [...VEHICLES].sort((a, b) => b.power - a.power)) {
      if (!isVehicleUnlocked(s, v) || squad.vehicle === v.id) continue;
      const cur = VEHICLES.find((x) => x.id === squad.vehicle);
      if (cur && cur.power >= v.power) continue;
      if (s.run.rp.gte(v.cost.rp * 3)) fitVehicle(s, squad.id, v.id);
    }

    if (squad.stalled) resumeSquad(s, squad.id);
    if (readyIn(squad).length < MARINE.minReady && s.run.pers.lt(1)) continue;

    if (plan) {
      setMission(s, squad.id, plan.kind);
      setTarget(s, squad.id, plan.node);
      setAuto(s, squad.id, false);
      if (startMission(s, squad.id).ok) {
        if (plan.kind === 'assault') mark(`squad ${squad.id} first assault on ${plan.node}`);
        setAuto(s, squad.id, plan.kind === 'recon');
      }
      continue; // keep waiting for this plan rather than falling back to a patrol
    }

    // Otherwise sweep for Requisition and Intel on auto.
    setMission(s, squad.id, squad.id % 2 === 0 && POSITIONS.some((p) => !isCaptured(s.meta, p.node)) ? 'recon' : 'patrol');
    setTarget(s, squad.id, null);
    setAuto(s, squad.id, true);
    if (rt.rest <= 0) startMission(s, squad.id);
  }
}

const ASSAULT_MIN = arg('assaultMin', 0.55);
const MARINE_UNIT_BY_ID = (id: string) => MARINE_UNITS.find((u) => u.id === id) ?? MARINE_UNITS[0];

/* ---------- running the fleet ---------- */

let patrolUntil = -1;

/** The biggest hull the fleet can pay for right now (late game only), or the biggest one it has unlocked when nothing is affordable. */
function wantedClass(s: GameState, affordable = false) {
  let unlocked: (typeof SHIPS_BY_SIZE)[number] | null = null;
  for (const def of SHIPS_BY_SIZE) {
    if (!isShipUnlocked(s.meta, def)) continue;
    unlocked ??= def;
    if (s.run.rp.gte(def.cost.rp) && s.run.ti.gte(def.cost.ti)) return def;
  }
  return affordable ? null : unlocked;
}
const SHIPS_BY_SIZE = ['heavy-cruiser', 'light-cruiser'].map((id) => SHIP_BY_ID[id]);

let lastResume = 0;

function botFleet(s: GameState): void {
  const fleet = s.run.fleet;
  const group = fleet.groups[0];
  setAutoAbilities(s, group.id, true);

  const cap = commandCapacity(s.meta);
  const planned = plannedCommand(s);
  const big = LATE ? wantedClass(s, true) : null;
  if (big && fleet.queue.length < fleet.slips + 1 && (cap - planned >= big.command || fleet.queue.length === 0)) {
    // Retire the smallest ships to make room for the hull, once the money for it is in hand.
    let free = cap - planned;
    const retire = [...fleet.ships].sort((a, b) => SHIP_BY_ID[a.classId].command - SHIP_BY_ID[b.classId].command).filter((x) => SHIP_BY_ID[x.classId].command < big.command);
    while (free < big.command && retire.length > 0) {
      const ship = retire.shift()!;
      if (decommission(s, ship.id).ok) free += SHIP_BY_ID[ship.classId].command;
    }
    if (free >= big.command) queueShip(s, big.id);
  } else if (planned + 1 <= cap && fleet.queue.length < fleet.slips + 1) queueShip(s, 'frigate');
  const cost = slipCost(s);
  if (cost !== null && planned < cap && s.run.rp.gt(cost * 4)) buySlip(s);

  // A group that stalled before it had anywhere to train needs a look from a player now and then.
  if (LATE && group.stalled && patrolOptions(s.meta).length === 0 && s.run.elapsed - lastResume >= 600) {
    resumeGroup(s, group.id);
    lastResume = s.run.elapsed;
  }

  // A stalled campaign means the fleet is not ready: train on Patrol for a while, then try again.
  if (group.stalled && group.order === 'campaign' && patrolOptions(s.meta).length > 0) {
    goPatrol(s);
    patrolUntil = s.run.elapsed + 900;
  } else if (group.order === 'patrol' && nextCampaignNode(s.meta) && s.run.elapsed >= patrolUntil) {
    setOrder(s, group.id, 'campaign');
  } else if (group.order === 'campaign' && !nextCampaignNode(s.meta)) {
    goPatrol(s);
  } else if (group.order === 'patrol' && s.run.elapsed >= nextPatrolReview) {
    goPatrol(s); // the fleet has grown: look for a harder patrol
  }
}

let nextPatrolReview = 0;

/** Patrol the hardest cleared sector the fleet can beat comfortably. */
function goPatrol(s: GameState): void {
  const group = s.run.fleet.groups[0];
  const options = patrolOptions(s.meta);
  let pick: string | null = options[0]?.id ?? null;
  for (let i = options.length - 1; i >= 0; i--) {
    if (estimatePatrol(s, group, options[i], 12).winRate >= 0.85) {
      pick = options[i].id;
      break;
    }
  }
  setOrder(s, group.id, 'patrol');
  setPatrolNode(s, group.id, pick);
  nextPatrolReview = s.run.elapsed + 600;
}

/** What a thoughtful player buys, in order. The bot saves up for the next item instead of skipping ahead. */
const ARMORY_PRIORITY = [
  'forward-depots', 'auto-depot', 'forward-hubs', 'auto-hub', 'forward-depots', 'auto-charter',
  'forward-hubs', 'forward-depots', 'field-logistics', 'auto-platform', 'extended-rotations',
  'forward-hubs', 'forward-depots', 'field-logistics', 'auto-yard', 'extended-rotations',
  'field-logistics', 'auto-command', 'extended-rotations', 'field-logistics', 'extended-rotations',
  'field-logistics',
];

function spendMedals(s: GameState): void {
  const bought = new Map<string, number>();
  for (const id of ARMORY_PRIORITY) {
    const def = ARMORY.find((a) => a.id === id);
    if (!def) continue;
    const wanted = (bought.get(id) ?? 0) + 1;
    const level = s.meta.armory[id] ?? 0;
    if (level >= wanted) {
      bought.set(id, wanted);
      continue;
    }
    if (!canBuyArmory(s.meta, def)) return; // save up for it
    buyArmory(s, id);
    bought.set(id, wanted);
  }
}

/** Spend Battle Honors in a fixed order: Command first, then the doctrine slot. */
function spendHonors(s: GameState): void {
  for (const id of ['flag-command', 'flag-command', 'joint-staff', 'flag-command', 'flag-command']) {
    const def = WARROOM.find((w) => w.id === id);
    if (def && canBuyWarroom(s.meta, def)) buyWarroom(s, id);
  }
}

/** Redeploy once the gain is at least half of what you already hold: a rough "worth it" rule. */
function shouldRedeploy(s: GameState): boolean {
  const gain = redeployGain(s);
  if (gain < 1) return false;
  // With the theatre's boss down, stay in this run: a Redeploy would scrap the heavy cruiser the Transfer needs.
  if (LATE && theatreCleared(s.meta, activeTheatre(s.meta)) && transferOpens(s)) return false;
  // Late game: give the big hulls (40 minute builds) time to finish before scrapping the run.
  if (LATE && s.meta.transfers > 0 && s.run.elapsed < arg('lateRun', 7200)) return false;
  if (s.meta.redeploys === 0) return true;
  return gain >= Math.max(2, 0.5 * s.meta.medalsEarned);
}

/* ---------- reporting ---------- */

const fmt = (n: number) => formatNumber(n);
const row = (...cols: string[]) => cols.map((c, i) => (i === 0 ? c.padEnd(10) : c.padStart(11))).join('');

/** Global milestone times, in seconds of total play. */
const milestones = new Map<string, number>();
let globalTime = 0;
function mark(key: string): void {
  if (!milestones.has(key)) milestones.set(key, globalTime);
}

interface CycleResult {
  seconds: number;
  done: boolean;
  transfer: boolean;
  toTrigger: number | null;
  ships: number;
  cleared: number;
  battles: number;
  tiStarved: number;
  deutStarved: number;
}

function simulateCycle(s: GameState, label: string, verbose: boolean): CycleResult {
  const startElapsed = s.run.elapsed;
  const startBattles = s.meta.battles.total;
  const checkpoints = [60, 180, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600, 4500, 5400, 7200, 10800, 14400];
  let toTrigger: number | null = null;
  let clickDebt = 0;
  let tiStarved = 0;
  let deutStarved = 0;
  const maxSeconds = MAX_HOURS * 3600;
  patrolUntil = -1;

  if (verbose) {
    console.log(`\n${label}\n${row('time', 'RP/s', 'Ti/s', 'Deut/s')}${row('ships', 'cleared', 'Ti', 'Deut')}`);
  }

  for (let t = 0; t < maxSeconds; t++) {
    clickDebt += CLICKS_PER_SECOND;
    const clicks = Math.floor(clickDebt);
    clickDebt -= clicks;
    if (t % DECISION_INTERVAL === 0 || DECISION_INTERVAL <= 3) for (let c = 0; c < clicks; c++) drive(s);

    stepWorld(s, 1);
    globalTime += 1;
    const sinceStart = s.run.elapsed - startElapsed;

    if (t % DECISION_INTERVAL === 0) {
      botBuy(s);
      if (USE_FLEET) botFleet(s);
      if (USE_MARINES) botMarines(s);
    }

    if (USE_FLEET) {
      if ((s.run.owned.outpost ?? 0) > 0) mark('first Titanium outpost');
      if (s.run.fleet.ships.length > 0) mark('first ship launched');
      if (s.meta.battles.total > 0) mark('first sortie resolved');
      for (const n of NODES) if (isCleared(s.meta, n.id)) mark(`${n.id} ${n.name}`);
      if (s.meta.opsUnlocked) mark('Operations open');
      if (s.run.marines.squads.length > 1) mark('second squad');
      if (s.run.marines.squads.length > 2) mark('third squad');
      for (const n of Object.keys(s.meta.captured)) mark(`captured ${n}`);
      if (s.run.research.done.length >= 4) mark('4 research done');
      if (s.run.research.done.length >= 10) mark('10 research done');
      const waiting = runtimeOf(s, 1).waiting ?? '';
      if (waiting.startsWith('Awaiting Titanium') || waiting.startsWith('Crippled')) tiStarved += 1;
      if (waiting.startsWith('Awaiting Deuterium')) deutStarved += 1;
    }

    if (verbose && checkpoints.includes(Math.round(sinceStart))) {
      const rates = productionByResource(s);
      console.log(
        row(formatDuration(sinceStart), fmt(rates.rp.toNumber()), fmt(rates.ti.toNumber()), fmt(rates.deut.toNumber())) +
          row(String(s.run.fleet.ships.length), String(Object.keys(s.meta.cleared).length), fmt(s.run.ti.toNumber()), fmt(s.run.deut.toNumber())),
      );
      if (USE_MARINES && s.meta.opsUnlocked) {
        const sq = s.run.marines.squads[0];
        console.log(
          '   marines: ' +
            `pers ${fmt(rates.pers.toNumber())}/s stock ${fmt(s.run.pers.toNumber())}, intel ${fmt(rates.intel.toNumber())}/s stock ${fmt(s.run.intel.toNumber())}, ` +
            `squads ${s.run.marines.squads.length}, ready ${readyIn(sq).length}/6, vehicle ${sq.vehicle ?? 'none'}, barracks ${s.run.owned.barracks ?? 0}, ` +
            `missions ${s.meta.missions.won}/${s.meta.missions.total}, ${squadRuntime(s, sq.id).waiting ?? ''}`,
        );
        if (process.argv.includes('--squadlog')) {
          for (const q of s.run.marines.squads) {
            const r = squadRuntime(s, q.id);
            console.log(`     #${q.id} ${q.mission}${q.auto ? ' auto' : ''} -> ${r.mission ? r.mission.node + ' stage ' + r.mission.stage : r.waiting ?? 'idle'} rest ${r.rest.toFixed(0)} stalled ${q.stalled} ready ${readyIn(q).length}`);
          }
        }
      }
    }

    if (process.argv.includes('--fleetlog') && USE_FLEET && Math.round(sinceStart) % 600 === 0 && s.meta.theatre > 1 || (process.argv.includes('--fleetlog') && Math.round(sinceStart) % 600 === 0 && s.meta.transfers > 0)) {
      const g = s.run.fleet.groups[0];
      const comp: Record<string, number> = {};
      for (const sh of s.run.fleet.ships) comp[sh.classId] = (comp[sh.classId] ?? 0) + 1;
      console.log(`   [${formatDuration(sinceStart)}] th${s.meta.theatre} ${JSON.stringify(comp)} queue ${s.run.fleet.queue.map((j) => j.classId).join(',')} cap ${commandCapacity(s.meta)} rp ${fmt(s.run.rp.toNumber())} ti ${fmt(s.run.ti.toNumber())} order ${g.order} stalled ${g.stalled} waiting ${runtimeOf(s, 1).waiting ?? ''} battles ${s.meta.battles.won}/${s.meta.battles.total}`);
    }
    if (toTrigger === null && s.run.earned.gte(ECONOMY.prestige.trigger)) toTrigger = sinceStart;

    const transferNow = LATE && canTransfer(s) && transferOpens(s) !== null;
    if (transferNow || shouldRedeploy(s)) {
      return {
        seconds: sinceStart,
        done: true,
        transfer: transferNow,
        toTrigger,
        ships: s.run.fleet.ships.length,
        cleared: Object.keys(s.meta.cleared).length,
        battles: s.meta.battles.total - startBattles,
        tiStarved,
        deutStarved,
      };
    }
  }
  return {
    seconds: s.run.elapsed - startElapsed,
    done: false,
    transfer: false,
    toTrigger,
    ships: s.run.fleet.ships.length,
    cleared: Object.keys(s.meta.cleared).length,
    battles: s.meta.battles.total - startBattles,
    tiStarved,
    deutStarved,
  };
}

/* ---------- main ---------- */

console.log(`Balance simulation: ${CLICKS_PER_SECOND} clicks/s, a decision every ${DECISION_INTERVAL}s, up to ${MAX_HOURS}h per cycle, fleet ${USE_FLEET ? 'on' : 'off'}`);
console.log(`Redeploy trigger ${fmt(ECONOMY.prestige.trigger)}, Medal scale ${fmt(ECONOMY.prestige.scale)}, +${ECONOMY.prestige.medalBonus * 100}% per Medal, command capacity ${FLEET.commandCapacity}`);

const s = newGameState(0, 1);
const summary: string[] = [];

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  const r = simulateCycle(s, `Cycle ${cycle}`, cycle === 1);
  if (!r.done) {
    summary.push(`cycle ${cycle}: no Redeploy within ${MAX_HOURS}h (earned ${fmt(s.run.earned.toNumber())})`);
    break;
  }
  const gain = redeployGain(s);
  const earned = s.run.earned.toNumber();
  if (r.transfer) {
    const from = s.meta.theatre;
    const report = transfer(s);
    spendHonors(s);
    summary.push(
      `cycle ${cycle}: TRANSFER out of theatre ${from} at ${formatDuration(r.seconds).padEnd(9)} (total play ${formatDuration(globalTime)}) earned ${fmt(earned)}, +${report?.honors ?? 0} Honors, ` +
        `warroom ${JSON.stringify(s.meta.warroom)}, ships ${r.ships}, sectors ${r.cleared}/${NODES.length}, battles ${r.battles}, Ti-starved ${formatDuration(r.tiStarved)}, Deut-starved ${formatDuration(r.deutStarved)}`,
    );
    marineRp = 0;
    continue;
  }
  redeploy(s);
  spendMedals(s);
  summary.push(
    `cycle ${cycle}: trigger at ${(r.toTrigger === null ? 'never' : formatDuration(r.toTrigger)).padEnd(8)} redeployed at ${formatDuration(r.seconds).padEnd(9)} earned ${fmt(earned).padEnd(9)} +${String(gain).padEnd(4)} Medals ` +
      `(total ${s.meta.medalsEarned}, bonus x${globalMultiplier(s).toFixed(2)}, play ${formatDuration(globalTime)}) ships ${r.ships}, sectors ${r.cleared}/${NODES.length}, battles ${r.battles}, ` +
      `Ti-starved ${formatDuration(r.tiStarved)}, Deut-starved ${formatDuration(r.deutStarved)}` +
      (USE_MARINES
        ? `, marine RP ${fmt(marineRp)} (${((100 * marineRp) / Math.max(1, earned)).toFixed(1)}% of earned),`+` squads ${s.run.marines.squads.length}, missions ${s.meta.missions.won}/${s.meta.missions.total} won, KIA ${s.meta.missions.killed}, held ${Object.keys(s.meta.captured).length}`
        : ''),
  );
  marineRp = 0;
  if (isCleared(s.meta, NODES[NODES.length - 1].id) && (cycle >= 3 || LATE)) break;
}

console.log('\nCycle summary');
for (const line of summary) console.log('  ' + line);

if (USE_FLEET) {
  console.log('\nMilestones (total play time, all runs)');
  for (const [key, t] of milestones) console.log(`  ${key.padEnd(34)} ${formatDuration(t)}`);
}
