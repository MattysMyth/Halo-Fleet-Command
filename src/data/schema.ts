/** Shapes of the JSON content files, plus a validator so a typo in data fails tests, not players. */

export type Unlock = { kind: 'start' } | { kind: 'owned'; building: string; count: number };

/** Stockpiled resources that buildings produce. Requisition is the default. */
export type Resource = 'rp' | 'ti' | 'deut' | 'pers' | 'intel';
export const RESOURCES: readonly Resource[] = ['rp', 'ti', 'deut', 'pers', 'intel'];

export interface BuildingDef {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  /** Always paid in Requisition. */
  baseCost: number;
  /** Output per second in the building's resource. */
  baseOutput: number;
  /** What the building produces. Defaults to Requisition. */
  resource?: Resource;
  /** Per-building override of the shared cost growth rate. */
  growth?: number;
  unlock: Unlock;
}

export interface EconomyConfig {
  startingRp: number;
  growth: number;
  milestones: number[];
  milestoneMultiplier: number;
  drive: { base: number; rateShare: number };
  offline: { baseCapHours: number; baseEfficiency: number; backgroundLimitSeconds: number };
  autobuy: { budgetShare: number; paybackSeconds: number };
  /** What one unit of each resource is worth in Requisition, for judging purchases across resources. */
  value: Record<Resource, number>;
  prestige: { trigger: number; scale: number; medalBonus: number };
}

interface ArmoryBase {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  /** Medal cost of each level, in order. Length must equal maxLevel. */
  costs: number[];
}

export type ArmoryDef = ArmoryBase &
  (
    | { kind: 'autobuy'; building: string }
    | { kind: 'startBuildings'; building: string; counts: number[] }
    | { kind: 'offlineCap'; hoursPerLevel: number }
    | { kind: 'offlineEfficiency'; perLevel: number }
    | { kind: 'researchQueue' }
    | { kind: 'doctrineSlot' }
  );

export function validateData(buildings: BuildingDef[], armory: ArmoryDef[], economy: EconomyConfig): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const b of buildings) {
    if (ids.has(b.id)) errors.push(`duplicate building id ${b.id}`);
    ids.add(b.id);
    if (!(b.baseCost > 0)) errors.push(`${b.id}: baseCost must be positive`);
    if (!(b.baseOutput > 0)) errors.push(`${b.id}: baseOutput must be positive`);
    if (b.growth !== undefined && !(b.growth > 1)) errors.push(`${b.id}: growth must be above 1`);
    if (b.resource !== undefined && !RESOURCES.includes(b.resource)) errors.push(`${b.id}: unknown resource ${b.resource}`);
  }
  for (const b of buildings) {
    if (b.unlock.kind === 'owned') {
      if (!ids.has(b.unlock.building)) errors.push(`${b.id}: unlock references unknown building ${b.unlock.building}`);
      if (b.unlock.building === b.id) errors.push(`${b.id}: unlocks itself`);
      if (!(b.unlock.count >= 1)) errors.push(`${b.id}: unlock count must be at least 1`);
    }
  }
  if (buildings.length === 0 || buildings[0].unlock.kind !== 'start') {
    errors.push('first building must be available from the start');
  }

  const armoryIds = new Set<string>();
  for (const a of armory) {
    if (armoryIds.has(a.id)) errors.push(`duplicate armory id ${a.id}`);
    armoryIds.add(a.id);
    if (a.costs.length !== a.maxLevel) errors.push(`${a.id}: costs length must equal maxLevel`);
    if (a.costs.some((c) => !(c > 0))) errors.push(`${a.id}: every cost must be positive`);
    if ((a.kind === 'autobuy' || a.kind === 'startBuildings') && !ids.has(a.building)) {
      errors.push(`${a.id}: unknown building ${a.building}`);
    }
    if (a.kind === 'startBuildings' && a.counts.length !== a.maxLevel) {
      errors.push(`${a.id}: counts length must equal maxLevel`);
    }
  }

  if (!(economy.growth > 1)) errors.push('economy.growth must be above 1');
  if (!(economy.autobuy.paybackSeconds > 0)) errors.push('economy.autobuy.paybackSeconds must be positive');
  if (economy.milestones.some((m, i) => i > 0 && m <= economy.milestones[i - 1])) {
    errors.push('economy.milestones must be strictly increasing');
  }
  if (economy.prestige.trigger <= 0 || economy.prestige.scale <= 0) errors.push('prestige trigger and scale must be positive');
  return errors;
}
