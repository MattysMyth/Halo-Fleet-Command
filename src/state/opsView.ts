/**
 * What the Operations screen shows, worked out from game state. Kept apart from selectors.ts so
 * that file stays about the economy and fleet; the odds for every sector are only worked out while
 * the screen is open.
 */
import type { Decimal } from '../core/numbers';
import {
  ENEMY_BY_ID,
  MARINE,
  MARINE_RANKS,
  MARINE_UNITS,
  MISSION_BY_ID,
  MISSIONS,
  NODE_BY_ID,
  PERKS,
  POSITIONS,
  TACTIC_DEFS,
  VEHICLES,
} from '../data';
import type {
  MarineRankDef,
  MissionDef,
  NodeDef,
  PerkDef,
  PositionBonus,
  PositionDef,
  TacticDef,
  UnitDef,
  VehicleDef,
} from '../data';
import { everCleared, isCaptured } from '../sim/campaign';
import { capOf } from '../sim/economy';
import { contestedFor } from '../sim/incidents';
import {
  basePower,
  chosenTarget,
  launchProblem,
  marinePower,
  marinesIn,
  missionOdds,
  onGround,
  previewTactics,
  runtimeOf,
  squadTactics,
  squadsAllowed,
  stageContext,
  stageThreat,
  supportGroup,
  isUnitUnlocked,
  isVehicleUnlocked,
} from '../sim/marines';
import type { Odds, TacticPreview } from '../sim/marines';
import { pendingPerks, rankIndexOf } from './marineState';
import type { StockView } from './selectors';
import type { GameState, Incident, Marine, MissionSummary, Squad, StageLog } from './types';

export interface MarineView {
  slot: number;
  marine: Marine | null;
  /** What the slot is refilled with. */
  want: UnitDef;
  unit: UnitDef | null;
  rank: MarineRankDef | null;
  xpToNext: number | null;
  ready: boolean;
  hurt: number;
  power: number;
  perks: PerkDef[];
  pending: number;
  /** Perks on offer for the next promotion. */
  options: PerkDef[];
}

export interface StageView {
  name: string;
  state: 'won' | 'lost' | 'now' | 'next';
  log: StageLog | null;
}

export interface RunView {
  mission: MissionDef;
  node: NodeDef;
  stage: number;
  stages: StageView[];
  phase: 'brief' | 'fight';
  timer: number;
  /** Length of the current phase, for the progress bar. */
  timerTotal: number;
  tactic: TacticDef | null;
  manual: boolean;
  options: TacticPreview[];
  power: number;
  threat: number;
  onGround: number;
  rp: Decimal;
  intel: number;
  wounded: number;
  killed: number;
  garrison: number;
}

export interface ChoiceView<T> {
  def: T;
  unlocked: boolean;
  affordable: boolean;
  current: boolean;
}

export interface SquadView {
  squad: Squad;
  slots: MarineView[];
  ready: number;
  wounded: number;
  vacancies: number;
  power: number;
  tactics: number;
  vehicle: VehicleDef | null;
  mission: MissionDef;
  target: NodeDef | null;
  odds: Odds | null;
  waiting: string | null;
  rest: number;
  run: RunView | null;
  last: (MissionSummary & { nodeName: string }) | null;
  launchWhy: string | null;
  canLaunch: boolean;
  vehicles: ChoiceView<VehicleDef>[];
  units: ChoiceView<UnitDef>[];
  pending: number;
}

export interface IncidentView {
  incident: Incident;
  node: NodeDef;
  /** What is on offer or under attack, in a few words. */
  title: string;
  detail: string;
  /** Odds for the selected squad, when it is idle and has marines. */
  odds: Odds | null;
  /** Why the selected squad cannot answer it, or null if it can. */
  why: string | null;
  mission: MissionDef;
}

export interface PositionView {
  def: PositionDef;
  node: NodeDef;
  status: 'held' | 'open' | 'locked';
  bonus: string;
  scouted: number;
  /** Threat of the first stage of an Assault, after scouting. */
  threat: number;
  odds: Odds | null;
  targeted: boolean;
  /** Seconds the production bonus stays suspended after an overrun. */
  contested: number;
}

export interface OpsView {
  unlocked: boolean;
  squads: SquadView[];
  selected: SquadView | null;
  positions: PositionView[];
  incidents: IncidentView[];
  pers: StockView;
  intel: StockView;
  support: { name: string; cost: number } | null;
  squadsAllowed: number;
  squadsMax: number;
  /** Barracks Complexes needed for the next squad, and how many stand. */
  nextSquad: { need: number; have: number } | null;
  held: number;
  totals: { total: number; won: number; lost: number; killed: number };
  tacticDefs: TacticDef[];
}

export function bonusText(b: PositionBonus): string {
  switch (b.kind) {
    case 'rp':
      return `+${Math.round(b.amount * 100)}% Requisition`;
    case 'ti':
      return `+${Math.round(b.amount * 100)}% Titanium-A`;
    case 'deut':
      return `+${Math.round(b.amount * 100)}% Deuterium`;
    case 'pers':
      return `+${Math.round(b.amount * 100)}% Personnel`;
    case 'intel':
      return `+${Math.round(b.amount * 100)}% Intel`;
    case 'command':
      return `+${b.amount} Command capacity`;
  }
}

export function stock(state: GameState, key: 'pers' | 'intel' | 'salvage', rate: Decimal): StockView {
  const amount = state.run[key];
  const cap = capOf(state, key);
  return { amount, perSecond: rate, cap, fill: Math.min(1, amount.div(cap).toNumber()) };
}

function marineView(state: GameState, squad: Squad, slot: number): MarineView {
  const m = squad.slots[slot];
  const want = MARINE_UNITS.find((u) => u.id === squad.want[slot]) ?? MARINE_UNITS[0];
  if (!m) return { slot, marine: null, want, unit: null, rank: null, xpToNext: null, ready: false, hurt: 0, power: 0, perks: [], pending: 0, options: [] };
  const idx = rankIndexOf(m.xp);
  const next = MARINE_RANKS[idx + 1];
  const pending = pendingPerks(m);
  return {
    slot,
    marine: m,
    want,
    unit: MARINE_UNITS.find((u) => u.id === m.unit) ?? null,
    rank: MARINE_RANKS[idx],
    xpToNext: next ? Math.ceil(next.xp - m.xp) : null,
    ready: m.hurt <= 0,
    hurt: m.hurt,
    power: marinePower(state, m),
    perks: m.perks.map((id) => PERKS.find((p) => p.id === id)).filter((p): p is PerkDef => !!p),
    pending,
    options: pending > 0 ? PERKS.filter((p) => p.rank === m.perks.length + 1) : [],
  };
}

function runView(state: GameState, squad: Squad): RunView | null {
  const run = runtimeOf(state, squad.id).mission;
  if (!run) return null;
  const mission = MISSION_BY_ID[run.kind];
  const ctx = stageContext(squad, run);
  const stages: StageView[] = mission.stages.map((s, i) => {
    const log = run.log[i] ?? null;
    return { name: s.name, log, state: log ? (log.win ? 'won' : 'lost') : i === run.stage ? 'now' : 'next' };
  });
  const options = run.phase === 'brief' ? previewTactics(state, ctx) : [];
  const power = basePower(state, ctx.marines, ctx.vehicle).total;
  const tactic = run.tactic ? TACTIC_DEFS.find((t) => t.id === run.tactic) ?? null : null;
  const total = run.phase === 'brief' ? MARINE.briefSeconds : (mission.seconds / mission.stages.length) * (tactic?.time ?? 1);
  return {
    mission,
    node: NODE_BY_ID[run.node],
    stage: run.stage,
    stages,
    phase: run.phase,
    timer: Math.max(0, run.timer),
    timerTotal: total,
    tactic,
    manual: run.manual,
    options,
    power,
    threat: stageThreat(state, run.kind, run.node, run.stage, run.incident),
    onGround: onGround(squad, run).length,
    rp: run.rp,
    intel: run.intel,
    wounded: run.wounded,
    killed: run.killed,
    garrison: run.paid.pers,
  };
}

function squadView(state: GameState, squad: Squad, detailed: boolean): SquadView {
  const rt = runtimeOf(state, squad.id);
  const marines = marinesIn(squad);
  const vehicle = VEHICLES.find((v) => v.id === squad.vehicle) ?? null;
  const targetId = chosenTarget(state, squad);
  const launchWhy = launchProblem(state, squad, targetId);
  const mission = MISSION_BY_ID[squad.mission];
  const slots = squad.slots.map((_, i) => marineView(state, squad, i));
  return {
    squad,
    slots,
    ready: slots.filter((s) => s.marine && s.ready).length,
    wounded: slots.filter((s) => s.marine && !s.ready).length,
    vacancies: slots.filter((s) => !s.marine).length,
    power: basePower(state, marines, vehicle).total,
    tactics: squadTactics(state, marines, vehicle),
    vehicle,
    mission,
    target: targetId ? NODE_BY_ID[targetId] : null,
    odds: detailed && targetId && marines.length > 0 ? missionOdds(state, squad, squad.mission, targetId) : null,
    waiting: rt.waiting,
    rest: rt.rest,
    run: runView(state, squad),
    last: rt.last ? { ...rt.last, nodeName: NODE_BY_ID[rt.last.node]?.name ?? rt.last.node } : null,
    launchWhy,
    canLaunch: !rt.mission && launchWhy === null,
    vehicles: VEHICLES.map((def) => ({
      def,
      unlocked: isVehicleUnlocked(state, def),
      affordable: state.run.rp.gte(def.cost.rp) && state.run.ti.gte(def.cost.ti),
      current: squad.vehicle === def.id,
    })),
    units: MARINE_UNITS.map((def) => ({ def, unlocked: isUnitUnlocked(state, def), affordable: state.run.pers.gte(def.cost), current: false })),
    pending: slots.reduce((n, s) => n + s.pending, 0),
  };
}

function incidentView(state: GameState, inc: Incident, selected: SquadView | null, detailed: boolean): IncidentView {
  const mission = MISSION_BY_ID[inc.kind];
  const node = NODE_BY_ID[inc.node];
  const enemy = inc.enemy ? ENEMY_BY_ID[inc.enemy] : null;
  const idle = !!selected && selected.run === null;
  const hasMarines = !!selected && selected.ready >= MARINE.minReady;
  let why: string | null = null;
  if (!selected) why = 'No squad';
  else if (!idle) why = `${selected.squad.name} is on a mission`;
  else if (!hasMarines) why = `Needs ${MARINE.minReady} ready marines`;
  const odds = detailed && selected && idle && hasMarines ? missionOdds(state, selected.squad, inc.kind, inc.node, true, inc) : null;
  const title = inc.kind === 'boarding' ? `Board a drifting ${enemy?.name ?? 'enemy ship'}` : `Counter-attack at ${node.name}`;
  const detail =
    inc.kind === 'boarding'
      ? `${node.name}. A wreck is open to boarders: about ${Math.round(inc.salvage ?? 0)} Salvage, ${Math.round((inc.hullChance ?? 0) * 100)}% chance of a hull.`
      : `${node.name}. Covenant forces are assaulting the position. Unanswered, the garrison holds alone or is overrun.`;
  return { incident: inc, node, title, detail, odds, why, mission };
}

export function buildOpsView(state: GameState, selectedSquad: number, detailed: boolean, rates: { pers: Decimal; intel: Decimal }): OpsView {
  const unlocked = state.meta.opsUnlocked;
  const squads = state.run.marines.squads.map((s) => squadView(state, s, detailed));
  const selected = squads.find((s) => s.squad.id === selectedSquad) ?? squads[0] ?? null;
  const positions: PositionView[] = POSITIONS.map((def) => {
    const node = NODE_BY_ID[def.node];
    const status = isCaptured(state.meta, def.node) ? 'held' : everCleared(state.meta, def.node) ? 'open' : 'locked';
    const odds = detailed && selected && status === 'open' && selected.squad.slots.some(Boolean) ? missionOdds(state, selected.squad, 'assault', def.node) : null;
    return {
      def,
      node,
      status,
      bonus: bonusText(def.bonus),
      scouted: state.run.marines.scouted[def.node] ?? 0,
      threat: stageThreat(state, 'assault', def.node, 0),
      odds,
      targeted: selected?.squad.target === def.node,
      contested: contestedFor(state, def.node),
    };
  });
  const incidents = state.run.incidents.map((inc) => incidentView(state, inc, selected, detailed));
  const allowed = squadsAllowed(state);
  const nextNeed = MARINE.squadBarracks[allowed];
  return {
    unlocked,
    squads,
    selected,
    positions,
    incidents,
    pers: stock(state, 'pers', rates.pers),
    intel: stock(state, 'intel', rates.intel),
    support: supportGroup(state),
    squadsAllowed: allowed,
    squadsMax: MARINE.squadBarracks.length,
    nextSquad: nextNeed === undefined ? null : { need: nextNeed, have: state.run.owned.barracks ?? 0 },
    held: Object.keys(state.meta.captured).length,
    totals: { ...state.meta.missions },
    tacticDefs: TACTIC_DEFS,
  };
}

export { MISSIONS };
