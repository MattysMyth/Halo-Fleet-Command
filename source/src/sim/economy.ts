import { D, Decimal, ZERO } from '../core/numbers';
import { BUILDINGS, BUILDING_BY_ID, ECONOMY, FLEET, MARINE } from '../data';
import type { BuildingDef, Resource } from '../data';
import type { BuyMode, GameState } from '../state/types';
import { hasAutobuy, offlineCapSeconds, offlineEfficiency } from './armory';
import { capturedBonus, sectorMultiplier } from './campaign';
import { modsOf, NEUTRAL_MODS } from './modifiers';
import type { Mods } from './modifiers';

/* ---------- cost ---------- */

export const growthOf = (def: BuildingDef): number => def.growth ?? ECONOMY.growth;

/** Cost of buying `k` more copies when `owned` are already standing: a geometric sum, no loop. */
export function costOf(def: BuildingDef, owned: number, k = 1): Decimal {
  if (k <= 0) return ZERO;
  return Decimal.sumGeometricSeries(k, def.baseCost, growthOf(def), owned);
}

/** Most copies `budget` can pay for. Guards against floating-point error at the boundary. */
export function maxAffordable(def: BuildingDef, owned: number, budget: Decimal): number {
  if (budget.lt(def.baseCost)) return 0;
  let k = Math.floor(Decimal.affordGeometricSeries(budget, def.baseCost, growthOf(def), owned).toNumber());
  if (!Number.isFinite(k) || k < 0) return 0;
  while (k > 0 && costOf(def, owned, k).gt(budget)) k -= 1;
  return k;
}

/* ---------- output ---------- */

/** How many milestone doublings a count of `owned` has reached. */
export function milestonesReached(owned: number): number {
  let n = 0;
  for (const m of ECONOMY.milestones) if (owned >= m) n += 1;
  return n;
}

export function nextMilestone(owned: number): number | null {
  for (const m of ECONOMY.milestones) if (owned < m) return m;
  return null;
}

export function milestoneMultiplier(owned: number): number {
  return ECONOMY.milestoneMultiplier ** milestonesReached(owned);
}

/** Requisition per second from one copy, including milestone doublings but not global bonuses. */
export function unitOutput(def: BuildingDef, owned: number): number {
  return def.baseOutput * milestoneMultiplier(owned);
}

export const resourceOf = (def: BuildingDef): Resource => def.resource ?? 'rp';

/** Production bonus from Service Medals: ECONOMY.prestige.medalBonus per Medal ever earned. */
export function globalMultiplier(state: GameState): number {
  return 1 + ECONOMY.prestige.medalBonus * state.meta.medalsEarned;
}

/** Everything that scales production: Medals, sectors under control and the ground positions held for that resource. */
export function productionMultiplier(state: GameState, resource: Resource = 'rp'): number {
  return globalMultiplier(state) * sectorMultiplier(state.meta) * (1 + capturedBonus(state.meta, resource, state.run.contested)) * (1 + modsOf(state).production);
}

/** Output per second from every copy of one building, in its own resource, including bonuses. */
export function buildingOutput(state: GameState, def: BuildingDef): Decimal {
  const owned = state.run.owned[def.id] ?? 0;
  if (owned <= 0) return ZERO;
  return D(unitOutput(def, owned)).mul(owned).mul(productionMultiplier(state, resourceOf(def)));
}

/** Per-second production of each stockpiled resource. */
export function productionByResource(state: GameState): Record<Resource, Decimal> {
  const out: Record<Resource, Decimal> = { rp: ZERO, ti: ZERO, deut: ZERO, pers: ZERO, intel: ZERO };
  for (const def of BUILDINGS) {
    const r = resourceOf(def);
    out[r] = out[r].add(buildingOutput(state, def));
  }
  return out;
}

/** Requisition per second only. */
export function productionPerSecond(state: GameState): Decimal {
  let total = ZERO;
  for (const def of BUILDINGS) if (resourceOf(def) === 'rp') total = total.add(buildingOutput(state, def));
  return total;
}

export type Capped = 'ti' | 'deut' | 'pers' | 'intel' | 'salvage';

const baseCap = (resource: Capped): number =>
  resource === 'ti' || resource === 'deut' || resource === 'salvage' ? FLEET.storage[resource] : MARINE.storage[resource];

/** Most a stockpile can hold, with the storage bonus from `mods` (research) applied. */
export const storageCap = (resource: Capped, mods: Mods = NEUTRAL_MODS): number => Math.floor(baseCap(resource) * (1 + mods.storage) * (resource === 'ti' || resource === 'salvage' ? mods.vault[resource] : 1));

/** The cap for this game's stockpile. */
export const capOf = (state: GameState, resource: Capped): number => storageCap(resource, modsOf(state));

/** Add to a capped stockpile. Returns how much was actually stored. */
export function addCapped(state: GameState, resource: Capped, amount: Decimal): Decimal {
  const cap = capOf(state, resource);
  const have = state.run[resource];
  const room = Decimal.max(0, D(cap).sub(have));
  const stored = Decimal.min(amount, room);
  state.run[resource] = have.add(stored);
  return stored;
}

/* ---------- unlocks and purchases ---------- */

export function isUnlocked(state: GameState, def: BuildingDef): boolean {
  if ((state.run.owned[def.id] ?? 0) > 0) return true;
  const u = def.unlock;
  if (u.kind === 'start') return true;
  return (state.run.owned[u.building] ?? 0) >= u.count;
}

/** Copies a buy click would purchase right now in the chosen mode, or 0 when it cannot be paid. */
export function buyAmount(state: GameState, def: BuildingDef, mode: BuyMode): number {
  const owned = state.run.owned[def.id] ?? 0;
  if (mode === 'max') return maxAffordable(def, owned, state.run.rp);
  return costOf(def, owned, mode).lte(state.run.rp) ? mode : 0;
}

/** Buy `k` copies if unlocked and affordable. Returns how many were bought (0 or k). */
export function buy(state: GameState, id: string, k: number): number {
  const def = BUILDING_BY_ID[id];
  if (!def || k < 1 || !isUnlocked(state, def)) return 0;
  const owned = state.run.owned[id] ?? 0;
  const cost = costOf(def, owned, k);
  if (cost.gt(state.run.rp)) return 0;
  state.run.rp = state.run.rp.sub(cost);
  state.run.owned[id] = owned + k;
  return k;
}

/* ---------- time ---------- */

export function credit(state: GameState, gain: Decimal): void {
  state.run.rp = state.run.rp.add(gain);
  state.run.earned = state.run.earned.add(gain);
  state.meta.lifetimeEarned = state.meta.lifetimeEarned.add(gain);
}

/** The manual Requisition Drive: a small flat gain that also scales a little with output. */
export function driveYield(state: GameState): Decimal {
  return D(ECONOMY.drive.base).add(productionPerSecond(state).mul(ECONOMY.drive.rateShare));
}

export function drive(state: GameState): Decimal {
  const gain = driveYield(state);
  credit(state, gain);
  return gain;
}

/** Extra requisition per second from buying one more copy (milestone doublings included). */
export function marginalOutput(state: GameState, def: BuildingDef): number {
  const owned = state.run.owned[def.id] ?? 0;
  return ((owned + 1) * unitOutput(def, owned + 1) - owned * unitOutput(def, owned)) * productionMultiplier(state, resourceOf(def));
}

/**
 * Let each owned autobuyer purchase what it can. An autobuyer only takes a copy that pays for
 * itself within the payback limit, and never spends more than its share of current stock, so it
 * cannot pour requisition into low tiers whose copies have become poor value.
 */
export function runAutobuyers(state: GameState): number {
  let bought = 0;
  for (const def of BUILDINGS) {
    if (!hasAutobuy(state.meta, def.id) || !isUnlocked(state, def)) continue;
    const owned = state.run.owned[def.id] ?? 0;
    const budget = state.run.rp.mul(ECONOMY.autobuy.budgetShare);
    const cap = Math.min(maxAffordable(def, owned, budget), 1000);
    let k = 0;
    while (k < cap) {
      const idx = owned + k;
      const gain = ((idx + 1) * unitOutput(def, idx + 1) - idx * unitOutput(def, idx)) * productionMultiplier(state, resourceOf(def));
      const delta = gain * (ECONOMY.value[resourceOf(def)] ?? 1); // judged in Requisition terms
      if (costOf(def, idx, 1).div(delta).gt(ECONOMY.autobuy.paybackSeconds)) break;
      k += 1;
    }
    if (k >= 1) bought += buy(state, def.id, k);
  }
  return bought;
}

export interface Produced {
  rp: Decimal;
  ti: Decimal;
  deut: Decimal;
  pers: Decimal;
  intel: Decimal;
}

/** Produce every resource for `seconds` at the given output share. Titanium and Deuterium are capped. */
export function produce(state: GameState, seconds: number, efficiency = 1): Produced {
  const rates = productionByResource(state);
  const rp = rates.rp.mul(seconds * efficiency);
  credit(state, rp);
  const ti = addCapped(state, 'ti', rates.ti.mul(seconds * efficiency));
  const deut = addCapped(state, 'deut', rates.deut.mul(seconds * efficiency));
  const pers = addCapped(state, 'pers', rates.pers.mul(seconds * efficiency));
  const intel = addCapped(state, 'intel', rates.intel.mul(seconds * efficiency));
  return { rp, ti, deut, pers, intel };
}

/** One simulation step of `dt` seconds at full output. Autobuyers run once a second. */
export function step(state: GameState, dt: number): void {
  produce(state, dt);
  state.run.elapsed += dt;
  state.run.autoClock += dt;
  if (state.run.autoClock >= 1) {
    state.run.autoClock -= 1;
    runAutobuyers(state);
  }
}

export interface AdvanceResult {
  /** Requisition earned. */
  gained: Decimal;
  /** Titanium-A, Deuterium, Personnel and Intel stored. */
  ti: Decimal;
  deut: Decimal;
  pers: Decimal;
  intel: Decimal;
  bought: number;
}

/**
 * Apply a long stretch of time in one pass. Output is piecewise constant, so this integrates in
 * at most ~600 chunks (running autobuyers once per chunk) instead of replaying every tick.
 */
export function advance(state: GameState, seconds: number, efficiency = 1): AdvanceResult {
  let bought = 0;
  let gained = ZERO;
  let ti = ZERO;
  let deut = ZERO;
  let pers = ZERO;
  let intel = ZERO;
  const chunk = Math.max(0.1, seconds / 600);
  let left = seconds;
  while (left > 1e-9) {
    const dt = Math.min(chunk, left);
    const made = produce(state, dt, efficiency);
    gained = gained.add(made.rp);
    ti = ti.add(made.ti);
    deut = deut.add(made.deut);
    pers = pers.add(made.pers);
    intel = intel.add(made.intel);
    state.run.elapsed += dt;
    bought += runAutobuyers(state);
    left -= dt;
  }
  return { gained, ti, deut, pers, intel, bought };
}

export interface OfflineReport {
  awaySeconds: number;
  appliedSeconds: number;
  capSeconds: number;
  efficiency: number;
  gained: Decimal;
  ti: Decimal;
  deut: Decimal;
  pers: Decimal;
  intel: Decimal;
  bought: number;
}

/** Apply time spent away: capped by the offline limit and scaled by offline efficiency. */
export function applyOffline(state: GameState, awaySeconds: number): OfflineReport {
  const capSeconds = offlineCapSeconds(state.meta);
  const efficiency = offlineEfficiency(state.meta);
  const appliedSeconds = Math.min(Math.max(0, awaySeconds), capSeconds);
  const { gained, ti, deut, pers, intel, bought } = advance(state, appliedSeconds, efficiency);
  return { awaySeconds, appliedSeconds, capSeconds, efficiency, gained, ti, deut, pers, intel, bought };
}
