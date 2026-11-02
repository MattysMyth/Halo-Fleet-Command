/**
 * Research and doctrine content: five branches of nodes paid for in Intel (the Captured tech branch
 * also in Salvage), and the doctrines a fleet can adopt. Effects are plain data, folded into one
 * set of modifiers by sim/modifiers.ts.
 */
import type { Stat } from './marineSchema';

export type SimpleEffectKind =
  | 'power' // marine squad Power
  | 'vehicle' // vehicle Power
  | 'recovery' // faster wound recovery
  | 'wounded' // more casualties are wounds
  | 'xp' // marine experience
  | 'hull' // ship hull
  | 'armour' // ship armour
  | 'damage' // ship damage
  | 'cooldown' // weapons cycle faster
  | 'shield' // shield as a share of hull
  | 'repair' // repair speed
  | 'build' // ship build speed
  | 'production' // all production
  | 'storage' // stockpile caps
  | 'sortie' // cheaper sorties
  | 'salvage' // Salvage from every source
  | 'patrol' // Patrol Titanium and Salvage
  | 'reward' // Campaign win rewards
  | 'marine'; // marine Power (doctrine)

export type Effect =
  | { kind: 'stat'; stat: Stat; amount: number }
  | { kind: SimpleEffectKind; amount: number }
  | { kind: 'opening'; amount: number; seconds: number };

export interface BranchDef {
  id: string;
  name: string;
  blurb: string;
}

export interface ResearchDef {
  id: string;
  branch: string;
  name: string;
  blurb: string;
  intel: number;
  /** Salvage as well, for the Captured tech branch. */
  salvage?: number;
  seconds: number;
  requires: string | null;
  effects: Effect[];
}

export interface DoctrineDef {
  id: string;
  name: string;
  blurb: string;
  effects: Effect[];
}

export interface ResearchConfig {
  /** Projects that can run at once before Armory upgrades. */
  queues: number;
  doctrineSlots: number;
  /** Intel to change a doctrine that is already in a slot. */
  swapIntel: number;
  /** After a swap the staff need this long before the next. */
  swapSeconds: number;
  /** Player shields start full each battle and recharge like this. */
  shield: { delay: number; rate: number };
  /** Build speed never falls below this share, however many penalties stack. */
  minBuildSpeed: number;
}

export interface ResearchData {
  config: ResearchConfig;
  branches: BranchDef[];
  nodes: ResearchDef[];
  doctrines: DoctrineDef[];
}

const KINDS = new Set<string>([
  'stat', 'power', 'vehicle', 'recovery', 'wounded', 'xp', 'hull', 'armour', 'damage', 'cooldown', 'shield', 'repair',
  'build', 'production', 'storage', 'sortie', 'salvage', 'patrol', 'reward', 'marine', 'opening',
]);

function effectErrors(list: Effect[], where: string, positive: boolean): string[] {
  const e: string[] = [];
  if (list.length === 0) e.push(`${where}: no effects`);
  for (const f of list) {
    if (!KINDS.has(f.kind)) e.push(`${where}: unknown effect ${f.kind}`);
    if (!Number.isFinite(f.amount) || f.amount === 0) e.push(`${where}: effect ${f.kind} needs a non-zero amount`);
    if (positive && f.amount < 0) e.push(`${where}: research effects must be positive`);
    if (f.kind === 'opening' && !(f.seconds > 0)) e.push(`${where}: opening needs seconds`);
    if ((f.kind === 'cooldown' || f.kind === 'sortie' || f.kind === 'recovery') && f.amount >= 1) e.push(`${where}: ${f.kind} must be below 1`);
  }
  return e;
}

export function validateResearchData(d: ResearchData): string[] {
  const errors: string[] = [];
  const branchIds = new Set<string>();
  for (const b of d.branches) {
    if (branchIds.has(b.id)) errors.push(`duplicate branch ${b.id}`);
    branchIds.add(b.id);
  }
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (ids.has(n.id)) errors.push(`duplicate research id ${n.id}`);
    ids.add(n.id);
  }
  for (const n of d.nodes) {
    if (!branchIds.has(n.branch)) errors.push(`${n.id}: unknown branch ${n.branch}`);
    if (!(n.intel > 0) || !(n.seconds > 0) || (n.salvage !== undefined && !(n.salvage > 0))) errors.push(`${n.id}: bad cost or time`);
    if (n.requires !== null) {
      const req = d.nodes.find((x) => x.id === n.requires);
      if (!req) errors.push(`${n.id}: requires unknown ${n.requires}`);
      else if (req.branch !== n.branch) errors.push(`${n.id}: requires a node from another branch`);
    }
    errors.push(...effectErrors(n.effects, n.id, true));
  }
  // Prerequisites must not loop.
  for (const n of d.nodes) {
    let at: string | null = n.requires;
    for (let i = 0; at !== null && i <= d.nodes.length; i++) at = d.nodes.find((x) => x.id === at)?.requires ?? null;
    if (at !== null) errors.push(`${n.id}: prerequisites loop`);
  }
  const dids = new Set<string>();
  for (const x of d.doctrines) {
    if (dids.has(x.id)) errors.push(`duplicate doctrine ${x.id}`);
    dids.add(x.id);
    errors.push(...effectErrors(x.effects, x.id, false));
  }
  const c = d.config;
  if (!(c.queues >= 1) || !(c.doctrineSlots >= 1) || !(c.swapIntel >= 0) || !(c.swapSeconds >= 0)) errors.push('research config is invalid');
  if (!(c.minBuildSpeed > 0 && c.minBuildSpeed <= 1)) errors.push('minBuildSpeed must be above 0 and at most 1');
  return errors;
}
