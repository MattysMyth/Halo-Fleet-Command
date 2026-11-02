/** The War Room shop: Battle Honors buy permanent upgrades that survive every Transfer. */
import { WARROOM, WARROOM_BY_ID, WARROOM_CONFIG } from '../data';
import type { WarRoomDef } from '../data';
import type { GameState, MetaState } from '../state/types';

export const warroomLevel = (meta: MetaState, id: string): number => meta.warroom[id] ?? 0;

/** Total levels bought across every item of one kind. */
export function warroomTotal(meta: MetaState, kind: WarRoomDef['kind']): number {
  let n = 0;
  for (const item of WARROOM) if (item.kind === kind) n += warroomLevel(meta, item.id);
  return n;
}

/** Honors for the next level, or null when the item is fully bought. */
export function nextWarroomCost(meta: MetaState, def: WarRoomDef): number | null {
  const level = warroomLevel(meta, def.id);
  return level >= def.maxLevel ? null : def.costs[level];
}

export function canBuyWarroom(meta: MetaState, def: WarRoomDef): boolean {
  const cost = nextWarroomCost(meta, def);
  return cost !== null && meta.honors >= cost;
}

export function buyWarroom(state: GameState, id: string): boolean {
  const def = WARROOM_BY_ID[id];
  if (!def || !canBuyWarroom(state.meta, def)) return false;
  state.meta.honors -= nextWarroomCost(state.meta, def) as number;
  state.meta.warroom[id] = warroomLevel(state.meta, id) + 1;
  return true;
}

/** Ship damage and marine Power from every Honor ever earned. */
export const honorBonus = (meta: MetaState): number => WARROOM_CONFIG.honorBonus * meta.honorsEarned;
