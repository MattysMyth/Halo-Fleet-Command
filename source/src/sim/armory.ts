import { ARMORY, ARMORY_BY_ID, ECONOMY, RESEARCH_CONFIG } from '../data';
import type { ArmoryDef } from '../data';
import type { GameState, MetaState } from '../state/types';
import { warroomTotal } from './warroom';

export function armoryLevel(meta: MetaState, id: string): number {
  return meta.armory[id] ?? 0;
}

/** Medal cost of the next level, or null when the item is fully bought. */
export function nextArmoryCost(meta: MetaState, def: ArmoryDef): number | null {
  const level = armoryLevel(meta, def.id);
  return level >= def.maxLevel ? null : def.costs[level];
}

export function canBuyArmory(meta: MetaState, def: ArmoryDef): boolean {
  const cost = nextArmoryCost(meta, def);
  return cost !== null && meta.medals >= cost;
}

/** Spend Medals on the next level. Returns true when the purchase went through. */
export function buyArmory(state: GameState, id: string): boolean {
  const def = ARMORY_BY_ID[id];
  if (!def || !canBuyArmory(state.meta, def)) return false;
  const cost = nextArmoryCost(state.meta, def) as number;
  state.meta.medals -= cost;
  state.meta.armory[id] = armoryLevel(state.meta, id) + 1;
  return true;
}

export function hasAutobuy(meta: MetaState, buildingId: string): boolean {
  return ARMORY.some((a) => a.kind === 'autobuy' && a.building === buildingId && armoryLevel(meta, a.id) > 0);
}

/** Longest stretch of away time that still earns production, in seconds. */
export function offlineCapSeconds(meta: MetaState): number {
  let hours = ECONOMY.offline.baseCapHours;
  for (const a of ARMORY) {
    if (a.kind === 'offlineCap') hours += a.hoursPerLevel * armoryLevel(meta, a.id);
  }
  return hours * 3600;
}

/** Share of normal output that continues while away, from 0 to 1. */
export function offlineEfficiency(meta: MetaState): number {
  let eff = ECONOMY.offline.baseEfficiency;
  for (const a of ARMORY) {
    if (a.kind === 'offlineEfficiency') eff += a.perLevel * armoryLevel(meta, a.id);
  }
  return Math.min(1, eff);
}

/** Research projects that can run at once. */
export function researchBays(meta: MetaState): number {
  let n = RESEARCH_CONFIG.queues;
  for (const a of ARMORY) if (a.kind === 'researchQueue') n += armoryLevel(meta, a.id);
  return n;
}

/** Doctrines a fleet can hold at once. */
export function doctrineSlotCount(meta: MetaState): number {
  let n = RESEARCH_CONFIG.doctrineSlots;
  for (const a of ARMORY) if (a.kind === 'doctrineSlot') n += armoryLevel(meta, a.id);
  return n + warroomTotal(meta, 'doctrineSlot');
}
