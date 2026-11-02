import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { MARINE, MARINE_DATA, MISSIONS, NODES, POSITIONS, POSITION_BY_NODE, SHIPS } from '../src/data';
import { validateMarineData } from '../src/data/marineSchema';
import { cancelResearch, startResearch, stepResearch } from '../src/sim/research';
import { applyOfflineWorld } from '../src/sim/world';
import { capturedBonus, commandCapacity } from '../src/sim/campaign';
import { productionByResource } from '../src/sim/economy';
import { makeShip } from '../src/state/fleetState';
import { setOrder } from '../src/sim/fleet';
import {
  applyOfflineMarines,
  autoPerks,
  autoTarget,
  basePower,
  casualtyRate,
  chooseTactic,
  choosePerk,
  discharge,
  fitVehicle,
  idleReason,
  launchProblem,
  marinePower,
  missionOdds,
  previewTactic,
  readyIn,
  recall,
  reinforce,
  researchMods,
  runtimeOf,
  setAuto,
  setMission,
  setTarget,
  setWant,
  squadById,
  squadsAllowed,
  stageContext,
  stageThreat,
  standingTactic,
  startMission,
  stepMarines,
  supportGroup,
  syncMarines,
  winChance,
} from '../src/sim/marines';
import type { MarineEvent } from '../src/sim/marines';
import { pendingPerks, rankIndexOf } from '../src/state/marineState';
import { decodeSave, encodeSave, newGameState } from '../src/state/serialize';
import type { GameState, Squad } from '../src/state/types';

const NODE_IDS = new Set(NODES.map((n) => n.id));
const ids = NODES.map((n) => n.id);

interface Opts {
  cleared?: number;
  pers?: number;
  rp?: number;
  xp?: number;
  seed?: number;
}

/** A state with Operations open, the first `cleared` sectors taken, and Personnel in the stores. */
function setup(o: Opts = {}): GameState {
  const s = newGameState(0, o.seed ?? 7);
  s.meta.fleetUnlocked = true;
  for (const id of ids.slice(0, o.cleared ?? 3)) s.meta.cleared[id] = 1;
  s.run.rp = D(o.rp ?? 1e9);
  s.run.ti = D(1e5);
  s.run.deut = D(1000);
  syncMarines(s);
  s.run.pers = D(o.pers ?? 100);
  return s;
}

/** A squad of six ready marines with the given experience. */
function crew(s: GameState, xp = 0): Squad {
  const squad = s.run.marines.squads[0];
  reinforce(s, squad);
  for (const m of squad.slots) if (m) m.xp = xp;
  return squad;
}

/** A copy that keeps big numbers working, which structuredClone does not. */
const clone = (s: GameState): GameState => decodeSave(encodeSave(s))!;

function run(s: GameState, seconds: number, events: MarineEvent[] = [], dt = 0.5): MarineEvent[] {
  for (let t = 0; t < seconds; t += dt) stepMarines(s, dt, (e) => events.push(e));
  return events;
}

describe('marine data', () => {
  it('passes validation', () => {
    expect(validateMarineData(MARINE_DATA, NODE_IDS)).toEqual([]);
  });

  it('catches the mistakes it is meant to catch', () => {
    const d = structuredClone(MARINE_DATA);
    d.units[0].stats.grit = 0;
    d.units[1].unlock = { kind: 'node', node: 'nowhere' };
    d.perks = d.perks.filter((p) => p.rank !== 2);
    d.positions[0].node = 'elsewhere';
    d.config.squadBarracks = [1, 5];
    const errors = validateMarineData(d, NODE_IDS);
    expect(errors.some((e) => e.includes('marine: grit must be positive'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown node nowhere'))).toBe(true);
    expect(errors.some((e) => e.includes('rank 2 needs at least two perks'))).toBe(true);
    expect(errors.some((e) => e.includes('position on unknown node elsewhere'))).toBe(true);
    expect(errors.some((e) => e.includes('first squad must need no Barracks'))).toBe(true);
  });

  it('puts a ground position on every sector and keeps threat rising', () => {
    expect(POSITIONS.map((p) => p.node)).toEqual(ids);
    // Threat climbs within a theatre; a later theatre starts easier than the last one ended, since a Transfer resets the marines' research.
    for (let i = 1; i < POSITIONS.length; i++) {
      if (POSITIONS[i].node.split('-')[0] === POSITIONS[i - 1].node.split('-')[0]) expect(POSITIONS[i].threat).toBeGreaterThan(POSITIONS[i - 1].threat);
    }
  });
});

describe('odds and casualties', () => {
  it('give an even match even odds and fall off sharply when outgunned', () => {
    expect(winChance(100, 100)).toBeCloseTo(0.5);
    expect(winChance(200, 100)).toBeGreaterThan(0.8);
    expect(winChance(50, 100)).toBeLessThan(0.2);
    expect(winChance(0, 100)).toBe(0);
    expect(winChance(100, 0)).toBe(1);
  });

  it('raise the casualty rate as the odds fall, and a failed stage costs more', () => {
    const easy = casualtyRate(0.95, 'aggressive', null, 0);
    const hard = casualtyRate(0.4, 'aggressive', null, 0);
    expect(hard).toBeGreaterThan(easy * 3);
    expect(casualtyRate(0.4, 'aggressive', null, 0, false)).toBeCloseTo(hard * MARINE.casualty.failMult);
  });

  it('are shaped by the tactic, a medic and a vehicle', () => {
    const p = 0.6;
    const base = casualtyRate(p, 'aggressive', null, 0);
    expect(casualtyRate(p, 'methodical', null, 0)).toBeLessThan(base * 0.5);
    expect(casualtyRate(p, 'aggressive', null, 1)).toBeCloseTo(base * MARINE.casualty.medic);
    // Medics stack only so far.
    expect(casualtyRate(p, 'aggressive', null, 9)).toBeCloseTo(casualtyRate(p, 'aggressive', null, MARINE.casualty.medicCap));
  });
});

describe('Operations unlock', () => {
  it('opens when the first sector falls, once, with starting Personnel and a squad', () => {
    const s = newGameState(0, 1);
    const events: MarineEvent[] = [];
    syncMarines(s, (e) => events.push(e));
    expect(s.meta.opsUnlocked).toBe(false);
    expect(s.run.marines.squads).toHaveLength(0);

    s.meta.cleared[MARINE.unlockNode] = 1;
    syncMarines(s, (e) => events.push(e));
    expect(s.meta.opsUnlocked).toBe(true);
    expect(s.run.pers.toNumber()).toBe(MARINE.startingPersonnel);
    expect(s.run.marines.squads).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'ops-unlocked')).toHaveLength(1);

    syncMarines(s, (e) => events.push(e));
    expect(s.run.pers.toNumber()).toBe(MARINE.startingPersonnel);
    expect(events.filter((e) => e.kind === 'ops-unlocked')).toHaveLength(1);
  });

  it('adds squads as Barracks Complexes are built, up to the limit', () => {
    const s = setup();
    expect(squadsAllowed(s)).toBe(1);
    s.run.owned.barracks = MARINE.squadBarracks[1];
    syncMarines(s);
    expect(s.run.marines.squads).toHaveLength(2);
    s.run.owned.barracks = 9999;
    syncMarines(s);
    expect(s.run.marines.squads).toHaveLength(MARINE.squadBarracks.length);
    expect(new Set(s.run.marines.squads.map((q) => q.id)).size).toBe(MARINE.squadBarracks.length);
  });
});

describe('squads', () => {
  it('refill from Personnel at each unit cost, as far as the stock goes', () => {
    const s = setup({ pers: 4 });
    const squad = s.run.marines.squads[0];
    expect(reinforce(s, squad)).toBe(4);
    expect(s.run.pers.toNumber()).toBe(0);
    expect(readyIn(squad)).toHaveLength(4);
    s.run.pers = D(10);
    expect(reinforce(s, squad)).toBe(2);
    expect(s.run.pers.toNumber()).toBe(8);
  });

  it('refuse a unit that is not unlocked and fall back to a marine if it is wanted anyway', () => {
    const s = setup({ cleared: 1 });
    const squad = s.run.marines.squads[0];
    expect(setWant(s, 1, 0, 'marksman').ok).toBe(false);
    s.meta.cleared['t1-n3'] = 1;
    expect(setWant(s, 1, 0, 'marksman').ok).toBe(true);
    expect(reinforce(s, squad)).toBe(6);
    expect(squad.slots[0]?.unit).toBe('marksman');
    expect(s.run.pers.toNumber()).toBe(100 - 2 - 5);
  });

  it('give half the Personnel back when a marine is discharged', () => {
    const s = setup({ cleared: 3 });
    setWant(s, 1, 0, 'marksman');
    reinforce(s, s.run.marines.squads[0]);
    const before = s.run.pers.toNumber();
    expect(discharge(s, 1, 0).ok).toBe(true);
    expect(s.run.pers.toNumber()).toBe(before + 1);
    expect(s.run.marines.squads[0].slots[0]).toBeNull();
    expect(discharge(s, 1, 0).ok).toBe(false);
  });

  it('pay for a vehicle once it is unlocked', () => {
    const s = setup({ cleared: 1, rp: 10 });
    expect((fitVehicle(s, 1, 'warthog') as { reason?: string }).reason).toMatch(/Not unlocked/);
    s.meta.cleared['t1-n2'] = 1;
    expect((fitVehicle(s, 1, 'warthog') as { reason?: string }).reason).toMatch(/Requisition/);
    s.run.rp = D(1e9);
    const rp = s.run.rp;
    expect(fitVehicle(s, 1, 'warthog').ok).toBe(true);
    expect(s.run.rp.lt(rp)).toBe(true);
    expect(s.run.marines.squads[0].vehicle).toBe('warthog');
    const after = s.run.rp;
    expect(fitVehicle(s, 1, 'warthog').ok).toBe(true); // already fitted: no second charge
    expect(s.run.rp.eq(after)).toBe(true);
    expect(fitVehicle(s, 1, null).ok).toBe(true);
  });
});

describe('power and tactics', () => {
  it('sum marine stats, scaled by rank, perks, research and vehicle', () => {
    const s = setup();
    const squad = crew(s);
    const marines = readyIn(squad);
    expect(marinePower(s, marines[0])).toBe(25);
    expect(basePower(s, marines, null).total).toBe(150);

    marines[0].xp = MARINE_DATA.ranks[1].xp;
    expect(marinePower(s, marines[0])).toBeCloseTo(25 * 1.1);
    marines[0].perks = ['sharpshooter'];
    expect(marinePower(s, marines[0])).toBeCloseTo(25 * 1.2);

    s.run.research.done = ['optics'];
    expect(marinePower(s, marines[1])).toBeCloseTo(10 * 1.08 + 10 + 5);
    expect(researchMods(s).stat.firepower).toBeCloseTo(0.08);
  });

  it('count only the best squad aura and add the vehicle after rank', () => {
    const s = setup({ cleared: 2 });
    const squad = crew(s);
    const marines = readyIn(squad);
    const plain = basePower(s, marines, null).total;
    marines[0].xp = 100;
    marines[0].perks = ['sharpshooter', 'leader'];
    marines[1].xp = 100;
    marines[1].perks = ['sharpshooter', 'leader'];
    const withAura = basePower(s, marines, null);
    expect(withAura.multiplier).toBeCloseTo(1.05); // two leaders do not stack
    expect(withAura.total).toBeGreaterThan(plain * 1.05);
    s.meta.cleared['t1-n2'] = 1;
    const warthog = { ...MARINE_DATA.vehicles[0] };
    expect(basePower(s, marines, warthog).vehicle).toBe(warthog.power);
  });

  it('make a Flank pay off only with a Warthog and enough Tactics', () => {
    const s = setup({ cleared: 2 });
    const squad = crew(s);
    squad.target = 't1-n2';
    squad.mission = 'recon';
    const run = (vehicle: string | null) => {
      squad.vehicle = vehicle;
      return previewTactic(s, { kind: 'recon', node: 't1-n2', stage: 0, marines: readyIn(squad), vehicle: vehicle ? { ...MARINE_DATA.vehicles.find((v) => v.id === vehicle)! } : null }, 'flank');
    };
    const bare = run(null);
    expect(bare.note).toMatch(/Warthog/);
    const aggressive = previewTactic(s, { kind: 'recon', node: 't1-n2', stage: 0, marines: readyIn(squad), vehicle: null }, 'aggressive');
    expect(bare.power).toBeLessThan(aggressive.power);
    const withHog = run('warthog');
    expect(withHog.note).toBeNull();
    expect(withHog.power).toBeGreaterThan(basePower(s, readyIn(squad), null).total * 1.4);
  });

  it('refuse orbital support without a fleet on Support orders, and ask for its Deuterium with one', () => {
    const s = setup();
    const squad = crew(s);
    const ctx = { kind: 'patrol' as const, node: 't1-n1', stage: 0, marines: readyIn(squad), vehicle: null };
    expect(previewTactic(s, ctx, 'orbital').available).toBe(false);
    expect(supportGroup(s)).toBeNull();

    s.run.fleet.ships.push(makeShip(SHIPS[0], s.run.fleet.nextShipId++, 1, 'front'));
    setOrder(s, 1, 'support');
    const group = supportGroup(s);
    expect(group?.cost).toBeGreaterThan(0);
    const strike = previewTactic(s, ctx, 'orbital');
    expect(strike.available).toBe(true);
    expect(strike.deut).toBe(group?.cost);
    s.run.deut = D(0);
    expect(previewTactic(s, ctx, 'orbital').available).toBe(false);
  });

  it('give every squad a Power bonus while a fleet is on Support orders', () => {
    const s = setup();
    const squad = crew(s);
    const before = basePower(s, readyIn(squad), null).total;
    s.run.fleet.ships.push(makeShip(SHIPS[0], s.run.fleet.nextShipId++, 1, 'front'));
    setOrder(s, 1, 'support');
    expect(basePower(s, readyIn(squad), null).total).toBeCloseTo(before * (1 + MARINE.supportBonus));
  });

  it('let the standing order pick sensibly', () => {
    const s = setup();
    const squad = crew(s);
    const ctx = { kind: 'patrol' as const, node: 't1-n1', stage: 0, marines: readyIn(squad), vehicle: null };
    expect(standingTactic(s, ctx, 'aggressive')).toBe('aggressive');
    expect(standingTactic(s, ctx, 'methodical')).toBe('methodical');
    expect(standingTactic(s, ctx, 'flank')).toBe('aggressive'); // no Warthog, so it will not flank
    // Easy odds: adaptive takes the careful option because it costs almost nothing.
    expect(standingTactic(s, ctx, 'adaptive')).toBe('methodical');
    // A stage the squad is outgunned in: careful only prolongs the defeat, so it presses the attack.
    const hard = { ...ctx, kind: 'assault' as const, node: 't1-n8' };
    expect(standingTactic(s, hard, 'adaptive')).toBe('aggressive');
    // A stage that is close: it takes whichever has the better odds.
    const close = { ...ctx, kind: 'assault' as const, node: 't1-n1' };
    const odds = (['aggressive', 'methodical'] as const).map((id) => previewTactic(s, close, id).p);
    expect(odds[0]).toBeGreaterThan(odds[1]);
    expect(standingTactic(s, close, 'adaptive')).toBe(odds[1] >= 0.5 && odds[0] - odds[1] < 0.08 ? 'methodical' : 'aggressive');
  });
});

describe('threat', () => {
  it('follows the position, mission and stage, and Recon lowers an Assault only', () => {
    const s = setup();
    const t = stageThreat(s, 'assault', 't1-n1', 0);
    expect(t).toBeCloseTo(POSITION_BY_NODE['t1-n1'].threat * MISSIONS.find((m) => m.id === 'assault')!.threat * 0.9);
    s.run.marines.scouted['t1-n1'] = 1;
    expect(stageThreat(s, 'assault', 't1-n1', 0)).toBeCloseTo(t * (1 - MARINE.recon.perScout));
    s.run.marines.scouted['t1-n1'] = 50;
    expect(stageThreat(s, 'assault', 't1-n1', 0)).toBeCloseTo(t * (1 - MARINE.recon.cap));
    const patrol = stageThreat(s, 'patrol', 't1-n1', 0);
    expect(patrol).toBeLessThan(t);
    expect(stageThreat(s, 'patrol', 'nowhere', 0)).toBe(Infinity);
  });
});

describe('launching a mission', () => {
  it('needs a target the fleet has cleared', () => {
    const s = setup({ cleared: 1 });
    crew(s);
    const squad = s.run.marines.squads[0];
    squad.auto = false;
    expect(launchProblem(s, squad, null)).toMatch(/Pick a target/);
    expect(launchProblem(s, squad, 't1-n2')).toMatch(/not cleared/);
    expect(startMission(s, 1).ok).toBe(false);
    setTarget(s, 1, 't1-n1');
    expect(startMission(s, 1).ok).toBe(true);
    expect(startMission(s, 1).ok).toBe(false); // already out
  });

  it('refills the squad first, and needs ready marines', () => {
    const s = setup({ pers: 0 });
    const squad = s.run.marines.squads[0];
    setAuto(s, 1, false);
    setTarget(s, 1, 't1-n1');
    expect((startMission(s, 1) as { reason?: string }).reason).toMatch(/No marines/);
    s.run.pers = D(3);
    expect(startMission(s, 1).ok).toBe(true);
    expect(readyIn(squad)).toHaveLength(3);
  });

  it('asks an assault for its garrison and gives it back when the mission is lost or recalled', () => {
    const s = setup({ cleared: 1, pers: 6 });
    const squad = s.run.marines.squads[0];
    setMission(s, 1, 'assault');
    setTarget(s, 1, 't1-n1');
    expect(squad.auto).toBe(false);
    s.run.pers = D(2);
    expect((startMission(s, 1) as { reason?: string }).reason).toMatch(/garrison/);
    s.run.pers = D(20);
    expect(startMission(s, 1).ok).toBe(true);
    const held = s.run.pers.toNumber(); // refill and garrison already paid
    expect(runtimeOf(s, 1).mission?.paid.pers).toBe(POSITION_BY_NODE['t1-n1'].garrison);
    expect(recall(s, 1).ok).toBe(true);
    expect(s.run.pers.toNumber()).toBe(held + POSITION_BY_NODE['t1-n1'].garrison);
    expect(s.meta.captured['t1-n1']).toBeUndefined();
  });

  it('waits for a tactic in the briefing, then falls back to the standing order', () => {
    const s = setup({ cleared: 1 });
    crew(s);
    setAuto(s, 1, false);
    setTarget(s, 1, 't1-n1');
    startMission(s, 1);
    const mission = () => runtimeOf(s, 1).mission!;
    expect(mission().phase).toBe('brief');
    run(s, MARINE.briefSeconds - 1);
    expect(mission().phase).toBe('brief');
    run(s, 2);
    expect(mission().phase).toBe('fight');
    expect(mission().manual).toBe(false);
    expect(mission().tactic).not.toBeNull();
  });

  it('runs a chosen tactic, flags it as manual and pays the active bonus', () => {
    const s = setup({ cleared: 1, seed: 11 });
    crew(s);
    const squad = s.run.marines.squads[0];
    setAuto(s, 1, false);
    setTarget(s, 1, 't1-n1');
    startMission(s, 1);
    expect(chooseTactic(s, 1, 'methodical').ok).toBe(true);
    expect(runtimeOf(s, 1).mission?.manual).toBe(true);
    expect(chooseTactic(s, 1, 'aggressive').ok).toBe(false); // the stage has begun
    expect(squad.slots.filter(Boolean)).toHaveLength(6);
  });

  it('refuses an orbital strike without Deuterium and pays for it when it can', () => {
    const s = setup({ cleared: 1 });
    crew(s);
    setAuto(s, 1, false);
    setTarget(s, 1, 't1-n1');
    s.run.fleet.ships.push(makeShip(SHIPS[0], s.run.fleet.nextShipId++, 1, 'front'));
    setOrder(s, 1, 'support');
    startMission(s, 1);
    const cost = supportGroup(s)!.cost;
    const deut = s.run.deut.toNumber();
    expect(chooseTactic(s, 1, 'orbital').ok).toBe(true);
    expect(s.run.deut.toNumber()).toBe(deut - cost);
    expect(runtimeOf(s, 1).mission?.paid.deut).toBe(cost);
  });
});

describe('a mission through its stages', () => {
  /** Run a manual patrol of the easiest sector with a strong squad and return what happened. */
  function sweep(seed: number, xp = 100) {
    const s = setup({ cleared: 1, seed });
    crew(s, xp);
    setAuto(s, 1, false);
    setTarget(s, 1, 't1-n1');
    const events: MarineEvent[] = [];
    startMission(s, 1, (e) => events.push(e));
    run(s, 400, events);
    return { s, events };
  }

  it('is a pure function of the seed', () => {
    const a = sweep(5);
    const b = sweep(5);
    const logs = (x: ReturnType<typeof sweep>) => JSON.stringify(x.events.filter((e) => e.kind === 'stage').map((e) => (e.kind === 'stage' ? e.log : null)));
    expect(logs(a)).toBe(logs(b));
    expect(a.s.run.rp.eq(b.s.run.rp)).toBe(true);
    expect(JSON.stringify(a.s.run.marines)).toBe(JSON.stringify(b.s.run.marines));
  });

  it('pays Requisition and Intel for every stage won and ends in the summary', () => {
    const { s, events } = sweep(5, 200);
    const end = events.find((e) => e.kind === 'mission');
    expect(end).toBeDefined();
    if (end?.kind !== 'mission') return;
    expect(end.summary.outcome).toBe('won');
    expect(end.summary.stages).toHaveLength(3);
    expect(end.summary.stages.every((st) => st.win)).toBe(true);
    expect(s.run.intel.toNumber()).toBeCloseTo(POSITION_BY_NODE['t1-n1'].intel);
    expect(runtimeOf(s, 1).mission).toBeNull();
    expect(s.meta.missions.won).toBe(1);
  });

  it('pays a stage more when its tactic was picked by hand', () => {
    const play = (manual: boolean) => {
      const s = setup({ cleared: 1, seed: 3 });
      crew(s, 300);
      s.run.owned.depot = 50; // so Requisition production is not zero
      setAuto(s, 1, false);
      setTarget(s, 1, 't1-n1');
      startMission(s, 1);
      const mission = () => runtimeOf(s, 1).mission;
      for (let i = 0; i < 2000 && mission(); i++) {
        if (manual && mission()?.phase === 'brief') chooseTactic(s, 1, 'aggressive');
        stepMarines(s, 0.5);
        if (!manual && mission()?.phase === 'fight') {
          /* the standing order runs on its own after the briefing */
        }
      }
      return runtimeOf(s, 1).last!;
    };
    const hand = play(true);
    const auto = play(false);
    expect(hand.outcome).toBe('won');
    expect(auto.outcome).toBe('won');
    expect(hand.intel).toBeCloseTo(auto.intel * (1 + MARINE.activeBonus));
    expect(hand.rp.gt(auto.rp)).toBe(true);
  });

  it('ends a mission at the first stage lost and counts the failure', () => {
    const s = setup({ cleared: 8, seed: 2 });
    crew(s, 0);
    setAuto(s, 1, false);
    setMission(s, 1, 'recon');
    setTarget(s, 1, 't1-n8');
    const events: MarineEvent[] = [];
    startMission(s, 1, (e) => events.push(e));
    run(s, 600, events);
    const end = events.find((e) => e.kind === 'mission');
    expect(end?.kind === 'mission' && end.summary.outcome).toBe('lost');
    expect(end?.kind === 'mission' && end.summary.stages.length).toBeLessThan(4);
    expect(s.meta.missions.lost).toBe(1);
    expect(s.run.marines.squads[0].failStreak).toBe(1);
  });

  it('wounds recover with time, and the dead leave the roster', () => {
    const s = setup({ cleared: 8, seed: 9 });
    crew(s, 0);
    setAuto(s, 1, false);
    setMission(s, 1, 'recon');
    setTarget(s, 1, 't1-n8');
    startMission(s, 1);
    for (let i = 0; i < 4000 && runtimeOf(s, 1).mission; i++) stepMarines(s, 0.5);
    const squad = s.run.marines.squads[0];
    const hurt = squad.slots.filter((m) => m && m.hurt > 0);
    const dead = squad.slots.filter((m) => m === null);
    expect(hurt.length + dead.length).toBeGreaterThan(0);
    expect(s.meta.missions.killed).toBe(dead.length);
    for (const m of hurt) expect(m!.hurt).toBeLessThanOrEqual(MARINE.casualty.recoverySeconds);
    run(s, MARINE.casualty.recoverySeconds + 5);
    expect(squad.slots.every((m) => m === null || m.hurt === 0)).toBe(true);
  });

  it('give experience, rank up marines and offer a perk for each promotion', () => {
    const s = setup({ cleared: 1, seed: 4 });
    const squad = crew(s, MARINE_DATA.ranks[1].xp - 1);
    setAuto(s, 1, false);
    setTarget(s, 1, 't1-n1');
    const events: MarineEvent[] = [];
    startMission(s, 1, (e) => events.push(e));
    run(s, 400, events);
    const promoted = readyIn(squad).concat(squad.slots.filter((m) => m && m.hurt > 0) as never).filter((m) => rankIndexOf(m.xp) >= 1);
    expect(promoted.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'marine-rank')).toBe(true);
    const m = promoted[0];
    expect(pendingPerks(m)).toBe(rankIndexOf(m.xp));
    expect(choosePerk(s, 1, m.id, 'leader').ok).toBe(false); // a rank 2 perk before rank 1
    expect(choosePerk(s, 1, m.id, 'cover').ok).toBe(true);
    expect(m.perks).toEqual(['cover']);
    expect(choosePerk(s, 1, m.id, 'sharpshooter').ok).toBe(false); // nothing pending any more
    expect(autoPerks(s, 1)).toBeGreaterThanOrEqual(0);
  });

  it('lets a perk shape casualties: Tough as boots makes every casualty a wound', () => {
    const s = setup({ cleared: 8, seed: 21 });
    const squad = crew(s, 100);
    for (const m of squad.slots) if (m) m.perks = ['cover', 'tough'];
    setAuto(s, 1, false);
    setMission(s, 1, 'recon');
    setTarget(s, 1, 't1-n8');
    startMission(s, 1);
    run(s, 600);
    expect(s.meta.missions.killed).toBe(0);
  });
});

describe('capturing ground', () => {
  function assault(node: string, seed: number): GameState {
    const s = setup({ cleared: ids.indexOf(node) + 1, seed });
    const squad = crew(s, 300);
    for (const m of squad.slots) if (m) m.perks = ['cover', 'tough', 'veteran'];
    s.run.pers = D(200);
    setMission(s, 1, 'assault');
    setTarget(s, 1, node);
    s.run.marines.scouted[node] = 5;
    expect(startMission(s, 1).ok).toBe(true);
    run(s, 2000);
    return s;
  }

  it('takes a position, pays the garrison and keeps the bonus', () => {
    const before = setup({ cleared: 1 });
    const rpBefore = productionByResource(before).rp;
    expect(capturedBonus(before.meta, 'rp')).toBe(0);

    const s = assault('t1-n1', 6);
    const last = runtimeOf(s, 1).last!;
    expect(last.outcome).toBe('won');
    expect(last.captured).toBe(true);
    expect(s.meta.captured['t1-n1']).toBe(1);
    expect(capturedBonus(s.meta, 'rp')).toBeCloseTo(0.06);
    s.run.owned.depot = 10;
    const withDepots = productionByResource(s).rp;
    s.meta.captured = {};
    expect(withDepots.div(productionByResource(s).rp).toNumber()).toBeCloseTo(1.06);
    void rpBefore;
    // A position cannot be assaulted twice.
    s.meta.captured['t1-n1'] = 1;
    const squad = squadById(s, 1)!;
    expect(launchProblem(s, squad, 't1-n1')).toMatch(/Already held/);
  });

  it('can add Command capacity, and survives as a bonus on the right resource', () => {
    const s = setup({ cleared: 8 });
    const base = commandCapacity(s.meta);
    s.meta.captured['t1-n7'] = 1;
    expect(commandCapacity(s.meta)).toBe(base + 1);
    s.meta.captured['t1-n2'] = 1;
    expect(capturedBonus(s.meta, 'ti')).toBeCloseTo(0.15);
    expect(capturedBonus(s.meta, 'deut')).toBe(0);
  });
});

describe('auto-deploy', () => {
  it('chooses the hardest sector it can take safely, and a Recon only where ground is left', () => {
    const s = setup({ cleared: 8 });
    const squad = crew(s, 0);
    const target = autoTarget(s, squad, 'patrol');
    expect(target).not.toBeNull();
    expect(missionOdds(s, squad, 'patrol', target!).worst).toBeGreaterThanOrEqual(MARINE.autoMinWin);
    // It would not pick anything harder.
    const harder = ids.slice(ids.indexOf(target!) + 1);
    for (const id of harder) expect(missionOdds(s, squad, 'patrol', id).worst).toBeLessThan(MARINE.autoMinWin);

    s.meta.captured = Object.fromEntries(ids.map((id) => [id, 1]));
    expect(autoTarget(s, squad, 'recon')).toBeNull();
  });

  it('deploys on its own, repeats, rests between missions and gains experience', () => {
    const s = setup({ cleared: 2, seed: 13 });
    crew(s, 0);
    const events: MarineEvent[] = [];
    run(s, 900, events);
    const missions = events.filter((e) => e.kind === 'mission');
    expect(missions.length).toBeGreaterThan(3);
    expect(events.some((e) => e.kind === 'deploy')).toBe(true);
    expect(s.run.intel.gt(0)).toBe(true);
    expect(s.run.marines.squads[0].slots.some((m) => m && m.xp > 0)).toBe(true);
  });

  it('waits for the wounded, and for recruits, rather than going out short', () => {
    const s = setup({ cleared: 2, pers: 0 });
    const squad = s.run.marines.squads[0];
    expect(idleReason(s, squad)).toBe('Awaiting recruits');
    run(s, 5);
    expect(runtimeOf(s, 1).mission).toBeNull();
    s.run.pers = D(6);
    reinforce(s, squad);
    for (const m of squad.slots.slice(0, 4)) m!.hurt = 30;
    expect(idleReason(s, squad)).toMatch(/Recovering/);
    run(s, 5);
    expect(runtimeOf(s, 1).mission).toBeNull();
    run(s, 40);
    expect(readyIn(squad).length).toBeGreaterThanOrEqual(MARINE.minReady);
  });

  it('stands down after three failed missions in a row', () => {
    const s = setup({ cleared: 8, seed: 31 });
    const squad = crew(s, 0);
    squad.target = 't1-n8'; // far too hard
    squad.mission = 'recon';
    const events: MarineEvent[] = [];
    run(s, 4000, events);
    expect(events.some((e) => e.kind === 'squad-stalled')).toBe(true);
    expect(squad.stalled).toBe(true);
    expect(s.meta.missions.lost).toBe(3);
    const n = s.meta.missions.total;
    run(s, 100);
    expect(s.meta.missions.total).toBe(n);
    expect(idleReason(s, squad)).toMatch(/Stood down/);
  });

  it('never repeats an assault on its own', () => {
    const s = setup({ cleared: 2 });
    setMission(s, 1, 'assault');
    expect(setAuto(s, 1, true).ok).toBe(false);
    expect(s.run.marines.squads[0].auto).toBe(false);
  });
});

describe('offline', () => {
  it('lets auto squads carry on, with the same results as watching', () => {
    const away = setup({ cleared: 2, seed: 17 });
    crew(away, 0);
    const watched = clone(away);
    const report = applyOfflineMarines(away, 1800, 1);
    run(watched, 1800, [], 2);
    expect(report.missions).toBeGreaterThan(5);
    expect(report.missions).toBe(watched.meta.missions.total - (runtimeOf(watched, 1).mission ? 1 : 0));
    expect(away.run.intel.toNumber()).toBeCloseTo(watched.run.intel.toNumber(), 3);
  });

  it('scales with offline efficiency', () => {
    const a = setup({ cleared: 2, seed: 17 });
    crew(a, 0);
    const b = clone(a);
    const full = applyOfflineMarines(a, 3600, 1);
    const half = applyOfflineMarines(b, 3600, 0.5);
    expect(half.missions).toBeLessThan(full.missions);
    expect(half.missions).toBeGreaterThan(full.missions * 0.35);
  });

  it('does nothing before Operations is open, and finishes a research while away', () => {
    const fresh = newGameState(0, 1);
    expect(applyOfflineMarines(fresh, 3600, 1).missions).toBe(0);

    const s = setup({ cleared: 1 });
    s.run.intel = D(1000);
    expect(startResearch(s, 'optics').ok).toBe(true);
    const report = applyOfflineWorld(s, 600);
    expect(report.research).toContain('Rifle optics');
    expect(s.run.research.done).toEqual(['optics']);
  });
});

describe('field research', () => {
  it('costs Intel, fills the research bays and respects what each node needs', () => {
    const s = setup({ cleared: 1 });
    expect((startResearch(s, 'optics') as { reason?: string }).reason).toMatch(/Intel/);
    s.run.intel = D(10000);
    expect((startResearch(s, 'plates') as { reason?: string }).reason).toMatch(/earlier/);
    expect(startResearch(s, 'ghost').ok).toBe(false);
    expect(startResearch(s, 'optics').ok).toBe(true);
    expect(s.run.intel.toNumber()).toBe(10000 - 30);
    expect((startResearch(s, 'comms') as { reason?: string }).reason).toMatch(/bay/);
    stepResearch(s, 61);
    expect(s.run.research.done).toContain('optics');
    expect((startResearch(s, 'optics') as { reason?: string }).reason).toMatch(/Already/);
    expect(startResearch(s, 'plates').ok).toBe(true);
  });

  it('refunds a cancelled research', () => {
    const s = setup({ cleared: 1 });
    s.run.intel = D(100);
    startResearch(s, 'optics');
    expect(cancelResearch(s, 'optics').ok).toBe(true);
    expect(s.run.intel.toNumber()).toBe(100);
    expect(s.run.research.active).toEqual([]);
    expect(cancelResearch(s, 'optics').ok).toBe(false);
  });

  it('shortens recovery and shifts casualties towards wounds', () => {
    const s = setup({ cleared: 1 });
    s.run.research.done = ['optics', 'plates', 'surgeons', 'medevac'];
    const mods = researchMods(s);
    expect(mods.recovery).toBeCloseTo(0.7);
    expect(mods.wounded).toBeCloseTo(0.15);
  });
});

describe('stage context and odds', () => {
  it('judge a squad by what it can field, counting the wounded as recovered', () => {
    const s = setup({ cleared: 4 });
    const squad = crew(s, 0);
    const full = missionOdds(s, squad, 'assault', 't1-n3').all;
    for (const m of squad.slots.slice(0, 3)) m!.hurt = 60;
    expect(missionOdds(s, squad, 'assault', 't1-n3').all).toBe(full);
    squad.slots[0] = null;
    squad.slots[1] = null;
    expect(missionOdds(s, squad, 'assault', 't1-n3').all).toBeLessThan(full);
  });

  it('reads the marines on the ground from the mission, not the whole squad', () => {
    const s = setup({ cleared: 1 });
    const squad = crew(s);
    setAuto(s, 1, false);
    setTarget(s, 1, 't1-n1');
    startMission(s, 1);
    const run1 = runtimeOf(s, 1).mission!;
    expect(stageContext(squad, run1).marines).toHaveLength(6);
    squad.slots[0]!.hurt = 10;
    expect(stageContext(squad, run1).marines).toHaveLength(5);
    expect(squad.mission).toBe('patrol');
  });
});

describe('review fixes', () => {
  it('does not hand back orbital Deuterium on a save once the stage has been fought', () => {
    const s = setup({ cleared: 1, seed: 11 });
    crew(s, 300);
    setAuto(s, 1, false);
    setTarget(s, 1, 't1-n1');
    s.run.fleet.ships.push(makeShip(SHIPS[0], s.run.fleet.nextShipId++, 1, 'front'));
    setOrder(s, 1, 'support');
    startMission(s, 1);
    expect(chooseTactic(s, 1, 'orbital').ok).toBe(true);
    for (let t = 0; t < 600 && (runtimeOf(s, 1).mission?.log.length ?? 1) < 1 && runtimeOf(s, 1).mission; t++) stepMarines(s, 0.5);
    const saved = decodeSave(encodeSave(s))!;
    expect(saved.run.deut.toNumber()).toBeLessThanOrEqual(s.run.deut.toNumber() + 1e-9);
  });

  it('stops teaching crews once a sector has no more to give', () => {
    const s = setup({ cleared: 1, seed: 3 });
    const squad = crew(s, 0);
    run(s, 4000, [], 1);
    for (const m of squad.slots) if (m) expect(m.xp).toBeLessThanOrEqual(POSITION_BY_NODE['t1-n1'].xpCap + 1e-9);
    expect(POSITION_BY_NODE['t1-n1'].xpCap).toBeLessThan(MARINE_DATA.ranks[3].xp);
  });

  it('fixes the fleet support for a stage when its tactic is chosen', () => {
    const s = setup({ cleared: 1, seed: 5 });
    const squad = crew(s, 0);
    setAuto(s, 1, false);
    setTarget(s, 1, 't1-n1');
    s.run.fleet.ships.push(makeShip(SHIPS[0], s.run.fleet.nextShipId++, 1, 'front'));
    setOrder(s, 1, 'support');
    startMission(s, 1);
    expect(chooseTactic(s, 1, 'orbital').ok).toBe(true);
    const mission = runtimeOf(s, 1).mission!;
    const before = previewTactic(s, stageContext(squad, mission), 'orbital', true);
    setOrder(s, 1, 'patrol'); // stand the fleet down after the strike was called
    expect(supportGroup(s)).toBeNull();
    const after = previewTactic(s, stageContext(squad, mission), 'orbital', true);
    expect(after.power).toBeCloseTo(before.power);
    expect(after.p).toBeCloseTo(before.p);
  });

  it('judges an auto squad by the marines it can field, not the ones in the infirmary', () => {
    const s = setup({ cleared: 4, seed: 9 });
    const squad = crew(s, 20);
    for (const m of squad.slots.slice(0, 2)) m!.hurt = 60;
    const target = autoTarget(s, squad, 'patrol');
    if (target) expect(missionOdds(s, squad, 'patrol', target, true).worst).toBeGreaterThanOrEqual(MARINE.autoMinWin);
  });

  it('lets only one squad assault a position at a time, and returns the garrison of a squad that does not take it', () => {
    const s = setup({ cleared: 1, seed: 8 });
    s.run.owned.barracks = 1;
    syncMarines(s);
    s.run.pers = D(200);
    const [a, b] = s.run.marines.squads;
    for (const q of [a, b]) {
      reinforce(s, q);
      for (const m of q.slots) if (m) m.xp = 300;
      setMission(s, q.id, 'assault');
      setTarget(s, q.id, 't1-n1');
    }
    s.run.marines.scouted['t1-n1'] = 5;
    expect(startMission(s, a.id).ok).toBe(true);
    expect(launchProblem(s, b, 't1-n1')).toMatch(/already assaulting/);
    // The ground falls to someone else first: the garrison paid at launch must come home.
    const garrison = POSITION_BY_NODE['t1-n1'].garrison;
    const held = s.run.pers.toNumber();
    s.meta.captured['t1-n1'] = 1;
    s.run.defendClock = 1e9; // keep counter-attacks out of this test
    run(s, 2000);
    expect(runtimeOf(s, a.id).mission).toBeNull();
    expect(s.run.pers.toNumber()).toBeGreaterThanOrEqual(held + garrison - 1e-9);
  });
});
