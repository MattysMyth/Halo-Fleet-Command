import type { Decimal } from '../core/numbers';
import type { Notation } from '../core/numbers';
import type { MissionKind, Order, Priority, Row, Stance, Standing, TacticId } from '../data';
import type { Battle, Outcome } from '../sim/combat';

export type BuyMode = 1 | 10 | 100 | 'max';

/* ---------- fleet ---------- */

export interface Ship {
  id: number;
  classId: string;
  /** Hull as a share of full, 0 to 1. Zero means crippled. */
  hull: number;
  /** Crew experience; ranks come from thresholds in fleet.json. */
  xp: number;
  /** Equipment ids per slot type, one entry per slot. */
  weapons: string[];
  defence: string[];
  utility: string[];
  /** The group the ship serves in. Zero means the hangar (no group). */
  group: number;
  row: Row;
}

export interface Group {
  id: number;
  name: string;
  order: Order;
  stance: Stance;
  priority: Priority;
  /** The group sorties only when its fleet integrity is at least this share. */
  minIntegrity: number;
  /** Spend Deuterium on abilities automatically. */
  autoAbilities: boolean;
  /** Patrol target; null means the furthest cleared sector. */
  patrolNode: string | null;
  /** Set after repeated defeats; the group stays in orbit until the player resumes it. */
  stalled: boolean;
  failStreak: number;
  /** The officer or AI core leading the group, if any. */
  officer: string | null;
}

export interface BuildJob {
  classId: string;
  remaining: number;
  total: number;
}

export interface FleetState {
  ships: Ship[];
  groups: Group[];
  queue: BuildJob[];
  /** Drydock slips: jobs worked in parallel. */
  slips: number;
  nextShipId: number;
}

/** What a group's last battle came to, for the battle screen. */
export interface GroupResult {
  outcome: Outcome;
  node: string;
  order: Order;
  firstClear: boolean;
  rp: Decimal;
  ti: number;
  deut: number;
  salvage: number;
  crippled: number;
  seconds: number;
}

/** Live, unsaved state for one group: its battle in progress and its rest timer. */
export interface GroupRuntime {
  battle: Battle | null;
  /** Node being fought, while a battle is on. */
  node: string | null;
  /** Seconds left in the current combat tick. */
  acc: number;
  /** Seconds before the group may sortie again. */
  rest: number;
  last: GroupResult | null;
  /** Why the group is waiting, for the UI. */
  waiting: string | null;
  /** The order the current sortie was sent under; changing orders mid-battle does not alter its pay. */
  order?: Order;
  /** Deuterium paid for the current sortie, handed back if the battle is dropped unfinished. */
  paid?: number;
}

/* ---------- marines ---------- */

export interface Marine {
  id: number;
  unit: string;
  xp: number;
  /** Perk ids chosen so far, one per promotion at most, in rank order. */
  perks: string[];
  /** Seconds of recovery left. Zero means ready. */
  hurt: number;
}

export interface Squad {
  id: number;
  name: string;
  /** One entry per slot: a marine, or null for a vacancy. */
  slots: (Marine | null)[];
  /** The unit each slot is refilled with. */
  want: string[];
  vehicle: string | null;
  mission: MissionKind;
  /** Target sector; null lets an auto squad choose. */
  target: string | null;
  /** The tactic used when nobody picks one. */
  standing: Standing;
  /** Repeat the mission on its own and run stages on the standing tactic. */
  auto: boolean;
  /** Set after repeated failures; the squad stays home until the player resumes it. */
  stalled: boolean;
  failStreak: number;
}

export interface MarineState {
  squads: Squad[];
  nextMarineId: number;
  /** Recon missions completed per node this run. */
  scouted: Record<string, number>;
}

export interface StageLog {
  stage: number;
  name: string;
  tactic: TacticId;
  manual: boolean;
  win: boolean;
  /** Chance the stage was won, as it stood when it was fought. */
  p: number;
  wounded: number;
  killed: number;
}

/** What a mission came to, for the Operations screen. */
export interface MissionSummary {
  kind: MissionKind;
  node: string;
  outcome: 'won' | 'lost' | 'aborted';
  stages: StageLog[];
  rp: Decimal;
  intel: number;
  wounded: number;
  killed: number;
  captured: boolean;
}

/** Live, unsaved state of one squad's mission. */
export interface MissionRun {
  kind: MissionKind;
  node: string;
  /** Index of the stage in progress. */
  stage: number;
  phase: 'brief' | 'fight';
  /** Seconds left in the current phase. */
  timer: number;
  /** Tactic picked for the current stage, and whether a person picked it. */
  tactic: TacticId | null;
  manual: boolean;
  /** Marines committed to the mission. */
  ids: number[];
  seed: number;
  /** Resources paid up front, handed back if the mission is dropped unfinished. */
  paid: { pers: number; deut: number };
  /** The incident this mission answers, for Boarding and Defend. */
  incident?: Incident;
  /** Whether a strike group was on Support orders when the stage's tactic was fixed; later changes do not count. */
  support?: boolean;
  log: StageLog[];
  rp: Decimal;
  intel: number;
  wounded: number;
  killed: number;
}

export interface SquadRuntime {
  mission: MissionRun | null;
  /** Seconds before an auto squad may deploy again. */
  rest: number;
  last: MissionSummary | null;
  waiting: string | null;
  /** The squad found nothing to deploy to and is waiting before it looks again. */
  blocked?: boolean;
}

/* ---------- incidents ---------- */

export type IncidentKind = 'boarding' | 'defend';

/** Something the marines can answer that has just happened: a beaten ship to board, or a held position under attack. */
export interface Incident {
  id: number;
  kind: IncidentKind;
  /** The sector it happened in. */
  node: string;
  /** Ground threat of the first stage, before the mission's own multipliers. */
  threat: number;
  /** Seconds left to answer it. */
  expires: number;
  /** Boarding: the enemy ship's id (for its name), Salvage on offer before bonuses, and the chance of a hull. */
  enemy?: string;
  salvage?: number;
  hullChance?: number;
}

/* ---------- research and doctrine ---------- */

export interface Project {
  id: string;
  /** Seconds of work left. */
  remaining: number;
}

export interface ResearchState {
  done: string[];
  /** Projects under way, at most as many as there are research bays. */
  active: Project[];
}

export interface DoctrineState {
  /** One entry per doctrine slot: a doctrine id, or null for an empty slot. */
  picked: (string | null)[];
  /** Seconds before the next swap is allowed. */
  cooldown: number;
}

/* ---------- run and meta ---------- */

export interface RunState {
  /** Requisition on hand. */
  rp: Decimal;
  /** Requisition earned this run (spending does not reduce it). Drives Redeploy. */
  earned: Decimal;
  /** Titanium-A, Deuterium, Personnel and Intel on hand. */
  ti: Decimal;
  deut: Decimal;
  pers: Decimal;
  intel: Decimal;
  /** Salvage recovered from wrecks; pays for Captured tech. */
  salvage: Decimal;
  owned: Record<string, number>;
  fleet: FleetState;
  marines: MarineState;
  research: ResearchState;
  doctrine: DoctrineState;
  /** Boarding chances and counter-attacks waiting for an answer. */
  incidents: Incident[];
  nextIncidentId: number;
  /** Seconds until the next counter-attack on held ground. */
  defendClock: number;
  /** Positions whose production bonus is suspended after an overrun, with seconds left. */
  contested: Record<string, number>;
  /** Seconds this run has been going. */
  elapsed: number;
  /** Seconds since autobuyers last ran. Not saved. */
  autoClock: number;
  /** Battles in progress, keyed by group id. Not saved. */
  live: Record<number, GroupRuntime>;
  /** Missions in progress, keyed by squad id. Not saved. */
  ops: Record<number, SquadRuntime>;
}

export interface MetaState {
  /** Spendable Service Medals. */
  medals: number;
  /** Every Medal ever earned. Spending never lowers the production bonus. */
  medalsEarned: number;
  /** Armory purchases: item id to level. */
  armory: Record<string, number>;
  redeploys: number;
  lastRunSeconds: number | null;
  bestRunSeconds: number | null;
  lifetimeEarned: Decimal;
  /** Campaign wins per node id. Survives Redeploy. */
  cleared: Record<string, number>;
  /** Experience that new crews start with, carried over from past runs (the veteran cadre). */
  cadreXp: number;
  /** Set once the Fleet screen has been revealed. */
  fleetUnlocked: boolean;
  battles: { total: number; won: number; lost: number };
  /** Set once the Operations screen has been revealed. */
  opsUnlocked: boolean;
  /** Ground positions held, by node. Survives Redeploy. */
  captured: Record<string, number>;
  missions: { total: number; won: number; lost: number; killed: number };
  /** Sectors cleared at any time, across Transfers. Ship unlocks and strike groups come from this. */
  everCleared: Record<string, number>;
  /** The theatre the Campaign order is fighting in. */
  theatre: number;
  /** The highest theatre a Transfer has opened. */
  theatresOpen: number;
  /** Spendable Battle Honors. */
  honors: number;
  /** Every Honor ever earned. Spending never lowers the damage and Power bonus. */
  honorsEarned: number;
  transfers: number;
  /** War Room purchases: item id to level. Survives Transfer. */
  warroom: Record<string, number>;
  /** Relics bought with Salvage: relic id to level. Survives Redeploy and Transfer. */
  relics: Record<string, number>;
}

export interface Settings {
  notation: Notation;
  buyMode: BuyMode;
  /** Battle speed multiplier. */
  battleSpeed: number;
  /** Synthesised sound cues. Off until the player turns them on. */
  sound: boolean;
  /** 0 to 1. */
  volume: number;
  reduceMotion: boolean;
  highContrast: boolean;
  /** Interface zoom: 1, 1.15 or 1.3. */
  textScale: number;
}

export interface GameState {
  /** Save format version; see state/migrations.ts. */
  version: number;
  startedAt: number;
  /** Wall-clock ms of the last save or tick; used for offline progress. */
  lastSeen: number;
  /** Seed for the game's seeded random generator. */
  seed: number;
  run: RunState;
  meta: MetaState;
  settings: Settings;
}

/** JSON-safe form of GameState: Decimals become strings, runtime-only fields are dropped. */
export interface RawSave {
  version: number;
  startedAt: number;
  lastSeen: number;
  seed: number;
  run: {
    rp: string;
    earned: string;
    ti: string;
    deut: string;
    pers: string;
    intel: string;
    salvage: string;
    owned: Record<string, number>;
    fleet: FleetState;
    marines: MarineState;
    research: ResearchState;
    doctrine: DoctrineState;
    incidents: Incident[];
    nextIncidentId: number;
    defendClock: number;
    contested: Record<string, number>;
    elapsed: number;
  };
  meta: {
    medals: number;
    medalsEarned: number;
    armory: Record<string, number>;
    redeploys: number;
    lastRunSeconds: number | null;
    bestRunSeconds: number | null;
    lifetimeEarned: string;
    cleared: Record<string, number>;
    cadreXp: number;
    fleetUnlocked: boolean;
    battles: { total: number; won: number; lost: number };
    opsUnlocked: boolean;
    captured: Record<string, number>;
    missions: { total: number; won: number; lost: number; killed: number };
    everCleared: Record<string, number>;
    theatre: number;
    theatresOpen: number;
    honors: number;
    honorsEarned: number;
    transfers: number;
    warroom: Record<string, number>;
    relics: Record<string, number>;
  };
  settings: { notation: Notation; buyMode: BuyMode; battleSpeed: number };
}
