/**
 * Marine missions: squads, the stages a mission runs through, the tactics chosen at each stage,
 * casualties and recovery, ranks and perks, held ground positions and field research.
 *
 * Like the rest of src/sim this works on GameState in place and knows nothing about the UI. A stage
 * is a pure roll against a win chance, so results can be replayed and tested from a seed.
 */
import { D, Decimal, ZERO } from '../core/numbers';
import { createRng } from '../core/rng';
import {
  MARINE,
  MARINE_RANKS,
  MISSION_BY_ID,
  NODE_BY_ID,
  PERK_BY_ID,
  POSITION_BY_NODE,
  TACTIC_BY_ID,
  UNIT_BY_ID,
  VEHICLE_BY_ID,
} from '../data';
import type {
  MarineRankDef,
  MissionDef,
  MissionKind,
  NodeDef,
  PositionDef,
  Standing,
  TacticId,
  UnitDef,
  VehicleDef,
} from '../data';
import { STANDINGS } from '../data/marineSchema';
import { defaultSquad, makeMarine, maxSquads, pendingPerks, rankIndexOf } from '../state/marineState';
import type { GameState, Incident, Marine, MissionRun, MissionSummary, Squad, SquadRuntime, StageLog } from '../state/types';
import { everCleared, isCaptured } from './campaign';
import { addCapped, credit, productionPerSecond } from './economy';
import { fitShips, grantShip, groupCommand, salvageAmount } from './fleet';
import { overrun, paySalvage, stepIncidents, takeIncident } from './incidents';
import type { IncidentEvent } from './incidents';
import { modsOf } from './modifiers';
import type { Mods } from './modifiers';

/* ---------- events ---------- */

export type MarineEvent =
  | { kind: 'ops-unlocked' }
  | { kind: 'squad'; squad: Squad }
  | { kind: 'deploy'; squad: Squad; mission: MissionDef; node: NodeDef }
  | { kind: 'stage'; squad: Squad; log: StageLog }
  | { kind: 'mission'; squad: Squad; summary: MissionSummary; nodeName: string }
  | { kind: 'marine-rank'; squad: Squad; marine: Marine; rank: MarineRankDef }
  | { kind: 'captured'; node: NodeDef; position: PositionDef }
  | { kind: 'squad-stalled'; squad: Squad }
  | { kind: 'boarded'; squad: Squad; incident: Incident; salvage: number; hull: boolean }
  | IncidentEvent;

export type MarineEmit = (e: MarineEvent) => void;

export type Result = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): Result => ({ ok: false, reason });
const OK: Result = { ok: true };

/* ---------- lookups ---------- */

export const squadById = (state: GameState, id: number): Squad | undefined => state.run.marines.squads.find((s) => s.id === id);

export function runtimeOf(state: GameState, squadId: number): SquadRuntime {
  let rt = state.run.ops[squadId];
  if (!rt) {
    rt = { mission: null, rest: 0, last: null, waiting: null };
    state.run.ops[squadId] = rt;
  }
  return rt;
}

export const unitOf = (m: Marine): UnitDef => UNIT_BY_ID[m.unit];
export const rankOf = (m: Marine): MarineRankDef => MARINE_RANKS[rankIndexOf(m.xp)];

export const marinesIn = (squad: Squad): Marine[] => squad.slots.filter((m): m is Marine => m !== null);
export const readyIn = (squad: Squad): Marine[] => marinesIn(squad).filter((m) => m.hurt <= 0);
export const woundedIn = (squad: Squad): Marine[] => marinesIn(squad).filter((m) => m.hurt > 0);

export const isUnitUnlocked = (state: GameState, def: UnitDef): boolean => def.unlock.kind === 'start' || everCleared(state.meta, def.unlock.node);
export const isVehicleUnlocked = (state: GameState, def: VehicleDef): boolean => def.unlock.kind === 'start' || everCleared(state.meta, def.unlock.node);

/** Squads the Barracks Complexes allow right now. */
export function squadsAllowed(state: GameState): number {
  const barracks = state.run.owned.barracks ?? 0;
  let n = 0;
  for (const need of MARINE.squadBarracks) if (barracks >= need) n += 1;
  return Math.min(n, maxSquads());
}

/* ---------- research modifiers ---------- */

/** Marine-relevant bonuses from research and doctrine. */
export type ResearchMods = Mods;
export const researchMods = (state: GameState): Mods => modsOf(state);

/* ---------- power, threat and odds ---------- */

const tacticOf = (id: TacticId) => TACTIC_BY_ID[id];
const vehicleOf = (squad: Squad): VehicleDef | null => (squad.vehicle ? VEHICLE_BY_ID[squad.vehicle] ?? null : null);

export interface MarineStats {
  firepower: number;
  grit: number;
  tactics: number;
  /** Rank and perk share added to those three. */
  bonus: number;
}

/** A marine's stats after research, rank and perks. */
export function marineStats(state: GameState, m: Marine): MarineStats {
  const base = unitOf(m).stats;
  const res = researchMods(state);
  let bonus = rankOf(m).power;
  for (const p of m.perks) bonus += PERK_BY_ID[p]?.effect.power ?? 0;
  return {
    firepower: base.firepower * (1 + res.stat.firepower),
    grit: base.grit * (1 + res.stat.grit),
    tactics: base.tactics * (1 + res.stat.tactics),
    bonus,
  };
}

export function marinePower(state: GameState, m: Marine): number {
  const s = marineStats(state, m);
  return (s.firepower + s.grit + s.tactics) * (1 + s.bonus);
}

/** The group on Support orders that can strike from orbit, if any, with the Deuterium a strike costs. */
export function supportGroup(state: GameState): { id: number; name: string; cost: number } | null {
  for (const g of state.run.fleet.groups) {
    if (g.order !== 'support' || g.stalled) continue;
    if (fitShips(state, g.id).length === 0) continue;
    return { id: g.id, name: g.name, cost: Math.max(1, Math.ceil(groupCommand(state, g.id) * MARINE.orbitalDeutPerCommand)) };
  }
  return null;
}

/** Average Tactics of the marines on the ground, plus the vehicle's. */
export function squadTactics(state: GameState, marines: Marine[], vehicle: VehicleDef | null): number {
  if (marines.length === 0) return 0;
  const sum = marines.reduce((n, m) => n + marineStats(state, m).tactics, 0);
  return sum / marines.length + (vehicle?.tactics ?? 0);
}

export interface PowerParts {
  base: number;
  vehicle: number;
  multiplier: number;
  total: number;
}

/** Squad Power before a tactic: marines and vehicle, research, best perk aura and fleet support. */
export function basePower(state: GameState, marines: Marine[], vehicle: VehicleDef | null, supported?: boolean): PowerParts {
  const res = researchMods(state);
  const crew = marines.reduce((n, m) => n + marinePower(state, m), 0);
  const veh = vehicle ? vehicle.power * (1 + res.vehicle) : 0;
  let aura = 0;
  for (const m of marines) for (const p of m.perks) aura = Math.max(aura, PERK_BY_ID[p]?.effect.aura ?? 0);
  const support = (supported ?? supportGroup(state) !== null) ? MARINE.supportBonus : 0;
  const multiplier = (1 + res.power) * (1 + res.marine) * (1 + aura) * (1 + support);
  const base = crew + veh;
  return { base, vehicle: veh, multiplier, total: base * multiplier };
}

/** Chance of winning a stage: P against threat T. An even match is a coin flip. */
export function winChance(power: number, threat: number): number {
  if (!(power > 0)) return 0;
  if (!(threat > 0)) return 1;
  return 1 / (1 + (threat / power) ** MARINE.win.exponent);
}

/** Threat of one stage of a mission at a sector. Every Recon completed there lowers an Assault's threat. */
export function stageThreat(state: GameState, kind: MissionKind, nodeId: string, stageIndex: number, incident?: Incident): number {
  const pos = POSITION_BY_NODE[nodeId];
  const mission = MISSION_BY_ID[kind];
  if (!pos || !mission) return Infinity;
  const stage = mission.stages[stageIndex];
  if (!stage) return Infinity;
  if (mission.incident) return incident ? incident.threat * mission.threat * stage.threat : Infinity;
  const scouted = kind === 'assault' ? Math.min(MARINE.recon.cap, MARINE.recon.perScout * (state.run.marines.scouted[nodeId] ?? 0)) : 0;
  return pos.threat * mission.threat * stage.threat * (1 - scouted);
}

export interface TacticPreview {
  id: TacticId;
  available: boolean;
  /** Why it cannot be chosen, or a caution about it. */
  note: string | null;
  power: number;
  p: number;
  /** Chance a marine on the ground becomes a casualty in this stage. */
  rate: number;
  /** Deuterium the tactic costs. */
  deut: number;
}

export interface StageContext {
  kind: MissionKind;
  node: string;
  stage: number;
  marines: Marine[];
  vehicle: VehicleDef | null;
  /** Fleet support as it stood when the stage's tactic was fixed. Left out while a tactic is still being chosen. */
  support?: boolean;
  /** The incident a Boarding or Defend mission answers. */
  incident?: Incident;
}

/** Casualty rate for a stage before perks: it climbs as the chance to win falls. */
export function casualtyRate(p: number, tactic: TacticId, vehicle: VehicleDef | null, medics: number, win = true): number {
  const c = MARINE.casualty;
  const medic = Math.max(c.floor, c.medic ** Math.min(medics, c.medicCap));
  const rate = (c.base + c.slope * (1 - p)) * tacticOf(tactic).casualty * (vehicle?.casualty ?? 1) * medic * (win ? 1 : c.failMult);
  return Math.min(0.9, Math.max(0, rate));
}

const medicsIn = (marines: Marine[]): number => marines.filter((m) => unitOf(m).medic).length;

export function previewTactic(state: GameState, ctx: StageContext, id: TacticId, paidOrbital = false): TacticPreview {
  const tactic = tacticOf(id);
  const live = supportGroup(state);
  const supported = ctx.support ?? live !== null;
  const parts = basePower(state, ctx.marines, ctx.vehicle, supported);
  let mult = tactic.power;
  let available = true;
  let note: string | null = null;
  let deut = 0;
  const mission = MISSION_BY_ID[ctx.kind];
  if (id === 'flank') {
    const req = mission.stages[ctx.stage]?.tacticsReq ?? 0;
    const tactics = squadTactics(state, ctx.marines, ctx.vehicle);
    if (!ctx.vehicle?.flank) {
      mult = 0.8;
      note = 'Needs a Warthog. Without one the flank costs 20% Power.';
    } else if (tactics < req) {
      mult = 0.8;
      note = `Needs Tactics ${req}; the squad has ${tactics.toFixed(1)}. The flank costs 20% Power.`;
    }
  } else if (id === 'orbital') {
    if (!supported) {
      available = false;
      note = 'Needs a strike group on Support orders.';
    } else {
      deut = live?.cost ?? 0;
      if (!paidOrbital && state.run.deut.lt(deut)) {
        available = false;
        note = `Needs ${deut} Deuterium.`;
      }
    }
  }
  const power = parts.total * mult;
  const p = winChance(power, stageThreat(state, ctx.kind, ctx.node, ctx.stage, ctx.incident));
  const rate = casualtyRate(p, id, ctx.vehicle, medicsIn(ctx.marines));
  return { id, available, note, power, p, rate, deut };
}

export const previewTactics = (state: GameState, ctx: StageContext): TacticPreview[] =>
  (['aggressive', 'methodical', 'flank', 'orbital'] as TacticId[]).map((id) => previewTactic(state, ctx, id));

/** The tactic a squad's standing order would pick for a stage. Never spends Deuterium. */
export function standingTactic(state: GameState, ctx: StageContext, standing: Standing): TacticId {
  if (standing === 'aggressive' || standing === 'methodical') return standing;
  const flank = previewTactic(state, ctx, 'flank');
  const flankWorks = flank.note === null;
  if (standing === 'flank') return flankWorks ? 'flank' : 'aggressive';
  const options = (['aggressive', 'methodical', 'flank'] as TacticId[])
    .map((id) => previewTactic(state, ctx, id))
    .filter((o) => o.id !== 'flank' || flankWorks);
  const best = options.reduce((a, b) => (b.p > a.p ? b : a));
  const slow = options.find((o) => o.id === 'methodical');
  // Take the careful option when the stage is comfortable or it costs almost nothing in odds.
  // When the squad is outgunned, careful only prolongs the defeat, so it takes the best odds.
  return slow && slow.p >= 0.5 && best.p - slow.p < 0.08 ? 'methodical' : best.id;
}

export function stageSeconds(kind: MissionKind, tactic: TacticId): number {
  const mission = MISSION_BY_ID[kind];
  return (mission.seconds / mission.stages.length) * tacticOf(tactic).time;
}

/* ---------- squad upkeep ---------- */

const recoverySeconds = (state: GameState, m: Marine): number => {
  let t = MARINE.casualty.recoverySeconds * researchMods(state).recovery;
  for (const p of m.perks) t *= PERK_BY_ID[p]?.effect.recovery ?? 1;
  return t;
};

/** Fill empty slots from Personnel, in slot order. Returns how many marines joined. */
export function reinforce(state: GameState, squad: Squad): number {
  let joined = 0;
  const ms = state.run.marines;
  for (let i = 0; i < squad.slots.length; i++) {
    if (squad.slots[i]) continue;
    let def = UNIT_BY_ID[squad.want[i]] ?? UNIT_BY_ID.marine;
    if (!isUnitUnlocked(state, def)) def = UNIT_BY_ID.marine;
    if (state.run.pers.lt(def.cost)) continue;
    state.run.pers = state.run.pers.sub(def.cost);
    squad.slots[i] = makeMarine(ms.nextMarineId++, def.id);
    joined += 1;
  }
  return joined;
}

export function setWant(state: GameState, squadId: number, slot: number, unit: string): Result {
  const squad = squadById(state, squadId);
  const def = UNIT_BY_ID[unit];
  if (!squad || !def || slot < 0 || slot >= squad.want.length) return fail('Unknown slot');
  if (!isUnitUnlocked(state, def)) return fail('Not unlocked');
  squad.want[slot] = unit;
  return OK;
}

/** Send a marine home. Half their Personnel cost comes back, so a slot can be given a new role. */
export function discharge(state: GameState, squadId: number, slot: number): Result {
  const squad = squadById(state, squadId);
  if (!squad) return fail('Unknown squad');
  if (runtimeOf(state, squadId).mission) return fail('The squad is on a mission');
  const m = squad.slots[slot];
  if (!m) return fail('That slot is empty');
  squad.slots[slot] = null;
  addCapped(state, 'pers', D(Math.floor(unitOf(m).cost / 2)));
  return OK;
}

export function fitVehicle(state: GameState, squadId: number, vehicleId: string | null): Result {
  const squad = squadById(state, squadId);
  if (!squad) return fail('Unknown squad');
  if (runtimeOf(state, squadId).mission) return fail('The squad is on a mission');
  if (vehicleId === null) {
    squad.vehicle = null;
    return OK;
  }
  const def = VEHICLE_BY_ID[vehicleId];
  if (!def) return fail('Unknown vehicle');
  if (squad.vehicle === vehicleId) return OK;
  if (!isVehicleUnlocked(state, def)) return fail('Not unlocked');
  if (state.run.rp.lt(def.cost.rp)) return fail('Not enough Requisition');
  if (state.run.ti.lt(def.cost.ti)) return fail('Not enough Titanium-A');
  state.run.rp = state.run.rp.sub(def.cost.rp);
  state.run.ti = state.run.ti.sub(def.cost.ti);
  squad.vehicle = vehicleId;
  return OK;
}

export function choosePerk(state: GameState, squadId: number, marineId: number, perkId: string): Result {
  const squad = squadById(state, squadId);
  const m = squad?.slots.find((x) => x?.id === marineId) ?? null;
  const perk = PERK_BY_ID[perkId];
  if (!squad || !m || !perk) return fail('Unknown marine or perk');
  if (pendingPerks(m) <= 0) return fail('No promotion waiting');
  if (perk.rank !== m.perks.length + 1) return fail('That perk is for another rank');
  m.perks.push(perk.id);
  return OK;
}

/** Choose the first perk on offer for every marine with a promotion waiting. Returns how many were set. */
export function autoPerks(state: GameState, squadId: number): number {
  const squad = squadById(state, squadId);
  if (!squad) return 0;
  let n = 0;
  for (const m of marinesIn(squad)) {
    while (pendingPerks(m) > 0) {
      const perk = Object.values(PERK_BY_ID).find((p) => p.rank === m.perks.length + 1);
      if (!perk) break;
      m.perks.push(perk.id);
      n += 1;
    }
  }
  return n;
}

const withSquad = (state: GameState, id: number, fn: (s: Squad) => void): Result => {
  const squad = squadById(state, id);
  if (!squad) return fail('Unknown squad');
  fn(squad);
  return OK;
};

export const renameSquad = (state: GameState, id: number, name: string): Result =>
  withSquad(state, id, (s) => {
    const clean = name.trim().slice(0, 32);
    if (clean) s.name = clean;
  });

export const setMission = (state: GameState, id: number, kind: MissionKind): Result =>
  withSquad(state, id, (s) => {
    if (!MISSION_BY_ID[kind] || MISSION_BY_ID[kind].incident) return;
    s.mission = kind;
    if (!MISSION_BY_ID[kind].auto) s.auto = false;
  });

export const setTarget = (state: GameState, id: number, node: string | null): Result =>
  withSquad(state, id, (s) => void (s.target = node !== null && POSITION_BY_NODE[node] ? node : null));

export const setStanding = (state: GameState, id: number, standing: Standing): Result =>
  withSquad(state, id, (s) => {
    if (STANDINGS.includes(standing)) s.standing = standing;
  });

export const setAuto = (state: GameState, id: number, on: boolean): Result => {
  const squad = squadById(state, id);
  if (!squad) return fail('Unknown squad');
  if (on && !MISSION_BY_ID[squad.mission].auto) return fail('That mission needs your orders');
  squad.auto = on;
  if (on) squad.stalled = false;
  squad.failStreak = on ? 0 : squad.failStreak;
  return OK;
};

export const resumeSquad = (state: GameState, id: number): Result =>
  withSquad(state, id, (s) => {
    s.stalled = false;
    s.failStreak = 0;
  });

/* ---------- targets ---------- */

/** Can this mission go to this sector? Returns the reason when it cannot. */
export function targetProblem(state: GameState, kind: MissionKind, nodeId: string): string | null {
  const node = NODE_BY_ID[nodeId];
  const pos = POSITION_BY_NODE[nodeId];
  if (!node || !pos) return 'No such position';
  if (!everCleared(state.meta, nodeId)) return 'The fleet has not cleared that sector yet';
  if (kind === 'assault' && isCaptured(state.meta, nodeId)) return 'Already held';
  if (kind === 'hunter' && !isCaptured(state.meta, nodeId)) return 'Hunters only gather on ground you hold';
  return null;
}

export interface Odds {
  /** Chance of winning each stage on the squad's standing order, at full strength. */
  stages: number[];
  worst: number;
  /** Chance of clearing every stage. */
  all: number;
}

/**
 * Odds for a squad against a sector, counting wounded marines as though recovered, so a squad is
 * judged by what it can field and not by who is limping this minute.
 */
export function missionOdds(state: GameState, squad: Squad, kind: MissionKind, nodeId: string, readyOnly = false, incident?: Incident): Odds {
  const marines = readyOnly ? readyIn(squad) : marinesIn(squad);
  const vehicle = vehicleOf(squad);
  const mission = MISSION_BY_ID[kind];
  const stages = mission.stages.map((_, i) => {
    const ctx: StageContext = { kind, node: nodeId, stage: i, marines, vehicle, incident };
    const tactic = standingTactic(state, ctx, squad.standing);
    return previewTactic(state, ctx, tactic).p;
  });
  return { stages, worst: Math.min(...stages), all: stages.reduce((a, b) => a * b, 1) };
}

/** Where an auto squad goes: the hardest sector it can take on safely, or null when there is none. */
export function autoTarget(state: GameState, squad: Squad, kind: MissionKind): string | null {
  const nodes = Object.keys(POSITION_BY_NODE).filter((id) => targetProblem(state, kind, id) === null);
  nodes.sort((a, b) => POSITION_BY_NODE[b].threat - POSITION_BY_NODE[a].threat);
  if (kind === 'recon') {
    // Scouting only matters where there is ground left to take.
    const open = nodes.filter((id) => !isCaptured(state.meta, id) && (state.run.marines.scouted[id] ?? 0) * MARINE.recon.perScout < MARINE.recon.cap);
    for (const id of open) if (missionOdds(state, squad, kind, id, true).worst >= MARINE.autoMinWin) return id;
    return null;
  }
  for (const id of nodes) if (missionOdds(state, squad, kind, id, true).worst >= MARINE.autoMinWin) return id;
  return null;
}

/** The sector a squad would go to now: its own target when valid, else the auto choice. */
export function chosenTarget(state: GameState, squad: Squad): string | null {
  if (squad.target && targetProblem(state, squad.mission, squad.target) === null) return squad.target;
  return squad.auto ? autoTarget(state, squad, squad.mission) : null;
}

/* ---------- missions ---------- */

export function missionSeed(state: GameState, squadId: number): number {
  const n = state.meta.missions.total + 1;
  return (state.seed ^ Math.imul(n, 0x9e3779b1) ^ Math.imul(squadId + 1, 0xc2b2ae35)) >>> 0;
}

const stageSeed = (seed: number, stage: number): number => (seed ^ Math.imul(stage + 1, 0x85ebca6b)) >>> 0;

/** Marines of a squad still committed and fit to fight. */
export const onGround = (squad: Squad, run: MissionRun): Marine[] => readyIn(squad).filter((m) => run.ids.includes(m.id));

export const stageContext = (squad: Squad, run: MissionRun): StageContext => ({
  kind: run.kind,
  node: run.node,
  stage: run.stage,
  marines: onGround(squad, run),
  vehicle: vehicleOf(squad),
  support: run.phase === 'fight' ? run.support : undefined,
  incident: run.incident,
});

/** Can the squad launch its chosen mission at `nodeId` right now? */
export function launchProblem(state: GameState, squad: Squad, nodeId: string | null): string | null {
  const rt = runtimeOf(state, squad.id);
  if (rt.mission) return 'Already on a mission';
  if (nodeId === null) return squad.auto ? 'No sector it can safely take on' : 'Pick a target sector';
  const bad = targetProblem(state, squad.mission, nodeId);
  if (bad) return bad;
  if (squad.mission === 'assault') {
    for (const other of state.run.marines.squads) {
      const m = other.id !== squad.id ? runtimeOf(state, other.id).mission : null;
      if (m && m.kind === 'assault' && m.node === nodeId) return `${other.name} is already assaulting there`;
    }
    const need = POSITION_BY_NODE[nodeId].garrison;
    if (state.run.pers.lt(need)) return `Needs ${need} Personnel for the garrison`;
  }
  return null;
}

function beginStage(state: GameState, squad: Squad, run: MissionRun, attended: boolean): void {
  run.tactic = null;
  run.manual = false;
  run.support = undefined;
  if (attended) {
    run.phase = 'brief';
    run.timer = MARINE.briefSeconds;
    return;
  }
  commit(state, run, standingTactic(state, stageContext(squad, run), squad.standing), false);
}

function commit(state: GameState, run: MissionRun, tactic: TacticId, manual: boolean): void {
  run.tactic = tactic;
  run.support = supportGroup(state) !== null;
  run.manual = manual;
  run.phase = 'fight';
  run.timer = stageSeconds(run.kind, tactic);
}

/** Start the squad's mission. Empty slots are refilled from Personnel first. */
export function startMission(state: GameState, squadId: number, emit?: MarineEmit): Result {
  const squad = squadById(state, squadId);
  if (!squad) return fail('Unknown squad');
  const rt = runtimeOf(state, squadId);
  if (rt.mission) return fail('Already on a mission');
  if (rt.rest > 0 && squad.auto) return fail('The squad is resting');
  const nodeId = chosenTarget(state, squad);
  const problem = launchProblem(state, squad, nodeId);
  if (problem || nodeId === null) return fail(problem ?? 'No target');
  return deploy(state, squad, squad.mission, nodeId, null, !(squad.auto && MISSION_BY_ID[squad.mission].auto), emit);
}

/** Put a squad on the ground: shared by standing missions and incident answers. */
function deploy(state: GameState, squad: Squad, kind: MissionKind, nodeId: string, incident: Incident | null, attended: boolean, emit?: MarineEmit): Result {
  const rt = runtimeOf(state, squad.id);
  reinforce(state, squad);
  const ready = readyIn(squad);
  const need = squad.auto ? MARINE.minReady : 1;
  if (ready.length < need) return fail(ready.length === 0 ? 'No marines are ready' : `Needs ${need} ready marines`);
  const mission = MISSION_BY_ID[kind];
  const garrison = kind === 'assault' ? POSITION_BY_NODE[nodeId].garrison : 0;
  if (garrison > 0) {
    if (state.run.pers.lt(garrison)) return fail(`Needs ${garrison} Personnel for the garrison`);
    state.run.pers = state.run.pers.sub(garrison);
  }
  if (incident) takeIncident(state, incident.id);
  const run: MissionRun = {
    kind,
    ...(incident ? { incident } : {}),
    node: nodeId,
    stage: 0,
    phase: 'fight',
    timer: 0,
    tactic: null,
    manual: false,
    ids: ready.map((m) => m.id),
    seed: missionSeed(state, squad.id),
    paid: { pers: garrison, deut: 0 },
    log: [],
    rp: ZERO,
    intel: 0,
    wounded: 0,
    killed: 0,
  };
  rt.mission = run;
  rt.waiting = null;
  state.meta.missions.total += 1;
  beginStage(state, squad, run, attended);
  emit?.({ kind: 'deploy', squad, mission, node: NODE_BY_ID[nodeId] });
  return OK;
}

/** Send a squad to answer a Boarding chance or a counter-attack. Nobody needs to be on Support or on a matching standing mission. */
export function launchIncident(state: GameState, squadId: number, incidentId: number, emit?: MarineEmit, auto = false): Result {
  const squad = squadById(state, squadId);
  if (!squad) return fail('Unknown squad');
  if (runtimeOf(state, squadId).mission) return fail('Already on a mission');
  const inc = state.run.incidents.find((i) => i.id === incidentId);
  if (!inc) return fail('That is over');
  return deploy(state, squad, inc.kind, inc.node, inc, !auto, emit);
}

/** The incident an idle auto squad should answer on its own: counter-attacks first, then the soonest to expire, if the odds are good. */
export function autoIncident(state: GameState, squad: Squad): Incident | null {
  if (readyIn(squad).length < MARINE.minReady) return null;
  const list = [...state.run.incidents].sort((a, b) => (a.kind === b.kind ? a.expires - b.expires : a.kind === 'defend' ? -1 : 1));
  for (const inc of list) if (missionOdds(state, squad, inc.kind, inc.node, true, inc).worst >= MARINE.autoMinWin) return inc;
  return null;
}

/** Pick the tactic for the stage in its briefing. Orbital support pays its Deuterium now. */
export function chooseTactic(state: GameState, squadId: number, tactic: TacticId): Result {
  const squad = squadById(state, squadId);
  const run = squad ? runtimeOf(state, squadId).mission : null;
  if (!squad || !run) return fail('No mission under way');
  if (run.phase !== 'brief') return fail('The stage has already begun');
  const preview = previewTactic(state, stageContext(squad, run), tactic);
  if (!preview.available) return fail(preview.note ?? 'Not available');
  if (tactic === 'orbital') {
    state.run.deut = state.run.deut.sub(preview.deut);
    run.paid.deut += preview.deut;
  }
  commit(state, run, tactic, true);
  return OK;
}

/** Pull the squad back. Stages already won stay paid; a held-back garrison returns to the stock. */
export function recall(state: GameState, squadId: number, emit?: MarineEmit): Result {
  const squad = squadById(state, squadId);
  const run = squad ? runtimeOf(state, squadId).mission : null;
  if (!squad || !run) return fail('No mission under way');
  endMission(state, squad, run, 'aborted', emit);
  return OK;
}

function awardXp(state: GameState, squad: Squad, marines: Marine[], base: number, nodeId: string, emit?: MarineEmit): void {
  const res = researchMods(state);
  const cap = POSITION_BY_NODE[nodeId]?.xpCap ?? Infinity;
  for (const m of marines) {
    const before = rankIndexOf(m.xp);
    let mult = 1 + res.xp;
    for (const p of m.perks) mult *= PERK_BY_ID[p]?.effect.xp ?? 1;
    m.xp = Math.max(m.xp, Math.min(m.xp + base * mult, cap));
    const after = rankIndexOf(m.xp);
    if (after > before) emit?.({ kind: 'marine-rank', squad, marine: m, rank: MARINE_RANKS[after] });
  }
}

function endMission(state: GameState, squad: Squad, run: MissionRun, outcome: MissionSummary['outcome'], emit?: MarineEmit): void {
  const rt = runtimeOf(state, squad.id);
  const mission = MISSION_BY_ID[run.kind];
  const node = NODE_BY_ID[run.node];
  let captured = false;

  if (run.kind === 'defend' && outcome !== 'won') {
    // The squad failed or pulled out: the position is overrun.
    const pers = overrun(state, run.node);
    emit?.({ kind: 'incident-ended', incident: run.incident as Incident, result: 'overrun', pers });
  }
  if (outcome === 'won') {
    if (run.kind === 'boarding' && run.incident) {
      const inc = run.incident;
      const salvage = salvageAmount(inc.salvage ?? 0, researchMods(state));
      paySalvage(state, salvage);
      const hull = createRng(run.seed ^ 0x5bd1e995).next() < (inc.hullChance ?? 0);
      if (hull) grantShip(state, MARINE.incidents.hullClass, MARINE.incidents.hullShare);
      emit?.({ kind: 'boarded', squad, incident: inc, salvage, hull });
    }
    if (run.kind === 'hunter') paySalvage(state, salvageAmount((node?.reward.salvage ?? 0) * MARINE.hunter.salvageShare, researchMods(state)));
    awardXp(state, squad, onGround(squad, run), MARINE.xp.complete * mission.rewards.xp, run.node, emit);
    if (run.kind === 'recon') state.run.marines.scouted[run.node] = (state.run.marines.scouted[run.node] ?? 0) + 1;
    if (run.kind === 'assault' && !isCaptured(state.meta, run.node)) {
      state.meta.captured[run.node] = 1;
      captured = true;
      emit?.({ kind: 'captured', node, position: POSITION_BY_NODE[run.node] });
    }
  }
  // The garrison stays only with the squad that took the ground; anyone else gets it back.
  if (!captured && run.paid.pers > 0) addCapped(state, 'pers', D(run.paid.pers));

  const summary: MissionSummary = {
    kind: run.kind,
    node: run.node,
    outcome,
    stages: run.log,
    rp: run.rp,
    intel: run.intel,
    wounded: run.wounded,
    killed: run.killed,
    captured,
  };
  rt.mission = null;
  rt.last = summary;
  rt.rest = MARINE.restSeconds;
  if (outcome === 'won') {
    state.meta.missions.won += 1;
    squad.failStreak = 0;
  } else if (outcome === 'lost') {
    state.meta.missions.lost += 1;
    squad.failStreak += 1;
    if (squad.auto && squad.failStreak >= 3 && !squad.stalled) {
      squad.stalled = true;
      emit?.({ kind: 'squad-stalled', squad });
    }
  }
  emit?.({ kind: 'mission', squad, summary, nodeName: node?.name ?? run.node });
}

/** Fight the stage that has just run its course. */
function resolveStage(state: GameState, squad: Squad, run: MissionRun, emit?: MarineEmit): void {
  const mission = MISSION_BY_ID[run.kind];
  const tactic = run.tactic ?? 'aggressive';
  const marines = onGround(squad, run);
  if (marines.length === 0) {
    endMission(state, squad, run, 'lost', emit);
    return;
  }
  const ctx = stageContext(squad, run);
  const preview = previewTactic(state, ctx, tactic, true);
  run.paid.deut = 0; // the strike has landed; a later save must not hand its Deuterium back
  const rng = createRng(stageSeed(run.seed, run.stage));
  const win = rng.next() < preview.p;
  const vehicle = ctx.vehicle;
  const medics = medicsIn(marines);
  const baseRate = casualtyRate(preview.p, tactic, vehicle, medics, win);
  const res = researchMods(state);

  let wounded = 0;
  let killed = 0;
  const survivors: Marine[] = [];
  for (const m of marines) {
    let rate = baseRate;
    let woundShare = Math.min(1, MARINE.casualty.wounded + res.wounded);
    for (const p of m.perks) {
      const e = PERK_BY_ID[p]?.effect;
      if (!e) continue;
      if (e.casualty !== undefined) rate *= e.casualty;
      if (e.wounded !== undefined) woundShare = Math.max(woundShare, e.wounded);
    }
    if (rng.next() >= rate) {
      survivors.push(m);
      continue;
    }
    if (rng.next() < woundShare) {
      m.hurt = recoverySeconds(state, m);
      wounded += 1;
      survivors.push(m);
    } else {
      const slot = squad.slots.findIndex((x) => x?.id === m.id);
      if (slot >= 0) squad.slots[slot] = null;
      killed += 1;
    }
  }
  state.meta.missions.killed += killed;
  run.wounded += wounded;
  run.killed += killed;

  const share = 1 / mission.stages.length;
  if (win) {
    const pos = POSITION_BY_NODE[run.node];
    const bonus = run.manual ? 1 + MARINE.activeBonus : 1;
    const rp = productionPerSecond(state).mul(pos.rpSeconds * mission.rewards.rp * share * bonus);
    credit(state, rp);
    run.rp = run.rp.add(rp);
    const intel = pos.intel * mission.rewards.intel * share * bonus;
    addCapped(state, 'intel', D(intel));
    run.intel += intel;
  }
  awardXp(state, squad, survivors, MARINE.xp.stage * mission.rewards.xp * (win ? 1 : 0.5), run.node, emit);

  const log: StageLog = {
    stage: run.stage,
    name: mission.stages[run.stage].name,
    tactic,
    manual: run.manual,
    win,
    p: preview.p,
    wounded,
    killed,
  };
  run.log.push(log);
  emit?.({ kind: 'stage', squad, log });

  if (!win) {
    endMission(state, squad, run, 'lost', emit);
  } else if (run.stage + 1 >= mission.stages.length) {
    endMission(state, squad, run, 'won', emit);
  } else {
    run.stage += 1;
    beginStage(state, squad, run, !(squad.auto && mission.auto));
  }
}

function stepMission(state: GameState, squad: Squad, run: MissionRun, dt: number, speed: number, emit?: MarineEmit): void {
  if (run.phase === 'brief') {
    run.timer -= dt;
    if (run.timer <= 0) {
      const tactic = standingTactic(state, stageContext(squad, run), squad.standing);
      commit(state, run, tactic, false);
    }
    return;
  }
  run.timer -= dt * speed;
  if (run.timer <= 0) resolveStage(state, squad, run, emit);
}

/* ---------- waiting reasons ---------- */

/** Why an idle squad is not deploying, from facts that are cheap to read. Null means it is free to go. */
export function idleReason(state: GameState, squad: Squad): string | null {
  const rt = runtimeOf(state, squad.id);
  if (rt.mission) return null;
  if (squad.stalled) return 'Stood down after repeated failures';
  if (!squad.auto) return 'Standing by for orders';
  if (rt.rest > 0) return rt.blocked && rt.waiting ? rt.waiting : 'Resting';
  const ready = readyIn(squad).length;
  const wounded = woundedIn(squad).length;
  const vacancies = squad.slots.length - marinesIn(squad).length;
  if (ready < MARINE.minReady) {
    if (ready + vacancies === 0 || wounded === 0) return state.run.pers.lt(1) ? 'Awaiting recruits' : 'Short of marines';
    return `Recovering: ${wounded} wounded`;
  }
  return null;
}

/* ---------- time ---------- */

/** Open Operations once the first sector falls, and add squads as Barracks allow. */
export function syncMarines(state: GameState, emit?: MarineEmit): void {
  const meta = state.meta;
  if (!meta.opsUnlocked && everCleared(meta, MARINE.unlockNode)) {
    meta.opsUnlocked = true;
    addCapped(state, 'pers', D(MARINE.startingPersonnel));
    emit?.({ kind: 'ops-unlocked' });
  }
  if (!meta.opsUnlocked) return;
  const squads = state.run.marines.squads;
  while (squads.length < squadsAllowed(state) || squads.length < 1) {
    const squad = defaultSquad(squads.length + 1);
    squads.push(squad);
    if (squads.length > 1) emit?.({ kind: 'squad', squad });
  }
}

/** One live step. `speed` hurries missions and recovery, the same setting that hurries battles. */
export function stepMarines(state: GameState, dt: number, emit?: MarineEmit, speed = 1): void {
  syncMarines(state, emit);
  if (!state.meta.opsUnlocked) return;
  const defending = new Set<string>();
  for (const q of state.run.marines.squads) {
    const m = runtimeOf(state, q.id).mission;
    if (m?.kind === 'defend') defending.add(m.node);
  }
  stepIncidents(state, dt, defending, emit);
  const heal = dt * speed;
  for (const squad of state.run.marines.squads) {
    for (const m of squad.slots) if (m && m.hurt > 0) m.hurt = Math.max(0, m.hurt - heal);
  }
  for (const squad of state.run.marines.squads) {
    const rt = runtimeOf(state, squad.id);
    if (rt.mission) {
      stepMission(state, squad, rt.mission, dt, speed, emit);
      continue;
    }
    if (rt.rest > 0) {
      rt.rest = Math.max(0, rt.rest - heal);
      if (rt.rest <= 0) rt.blocked = false;
    }
    // An auto squad draws replacements as soon as Personnel allows.
    if (squad.auto && !squad.stalled && squad.slots.includes(null)) reinforce(state, squad);
    // ...and answers a counter-attack or a boarding chance when its odds are good.
    if (squad.auto && !squad.stalled && rt.rest <= 0 && state.run.incidents.length > 0) {
      const inc = autoIncident(state, squad);
      if (inc && launchIncident(state, squad.id, inc.id, emit, true).ok) continue;
    }
    const reason = idleReason(state, squad);
    if (reason !== null || !squad.auto || squad.stalled || rt.rest > 0) {
      if (!rt.blocked) rt.waiting = reason;
      continue;
    }
    const result = startMission(state, squad.id, emit);
    if (!result.ok) {
      // Nothing to deploy to just yet: look again shortly instead of every step.
      rt.waiting = result.reason;
      rt.rest = MARINE.restSeconds * 2;
      rt.blocked = true;
    }
  }
}

/* ---------- offline ---------- */

export interface MarineOfflineReport {
  missions: number;
  won: number;
  rp: Decimal;
  intel: number;
  killed: number;
  captured: number;
  ranks: number;
}

/**
 * Time away. The squads simply carry on in coarse steps, on their standing orders, so the report
 * is what really happened and not an estimate. Steps are two seconds long, which is finer than a
 * stage, so results match what the same time spent watching would have produced.
 */
export function applyOfflineMarines(state: GameState, awaySeconds: number, efficiency: number, emit?: MarineEmit): MarineOfflineReport {
  const report: MarineOfflineReport = { missions: 0, won: 0, rp: ZERO, intel: 0, killed: 0, captured: 0, ranks: 0 };
  syncMarines(state, emit);
  if (!state.meta.opsUnlocked) return report;
  const seen: MarineEmit = (e) => {
    if (e.kind === 'mission' && e.summary.outcome !== 'aborted') {
      report.missions += 1;
      if (e.summary.outcome === 'won') report.won += 1;
      report.rp = report.rp.add(e.summary.rp);
      report.intel += e.summary.intel;
      report.killed += e.summary.killed;
    } else if (e.kind === 'captured') report.captured += 1;
    else if (e.kind === 'marine-rank') report.ranks += 1;
    emit?.(e);
  };
  // A mission under way when the tab was left runs on its standing order.
  for (const rt of Object.values(state.run.ops)) if (rt.mission?.phase === 'brief') rt.mission.timer = 0;
  const total = Math.max(0, awaySeconds) * efficiency;
  const dt = 2;
  for (let t = 0; t < total; t += dt) stepMarines(state, Math.min(dt, total - t), seen, 1);
  return report;
}

