/**
 * The War Room: a permanent shop paid for in Battle Honors. Honors come from a Transfer, and the
 * shop's purchases survive every Transfer.
 */
export type WarRoomKind =
  | 'doctrineSlot' // another doctrine slot
  | 'group' // another strike group beyond the ones theatres grant
  | 'command'; // more Command capacity for every strike group

export interface WarRoomItemDef {
  id: string;
  name: string;
  description: string;
  kind: WarRoomKind;
  maxLevel: number;
  /** Honors for each level, in order. */
  costs: number[];
}

export interface WarRoomConfig {
  /** Ship damage and marine Power per Honor earned. */
  honorBonus: number;
}

export interface WarRoomData {
  config: WarRoomConfig;
  items: WarRoomItemDef[];
}

export function validateWarRoomData(d: WarRoomData): string[] {
  const errors: string[] = [];
  if (!(d.config.honorBonus >= 0 && d.config.honorBonus <= 0.2)) errors.push('honorBonus must be 0 to 0.2');
  const ids = new Set<string>();
  for (const i of d.items) {
    if (ids.has(i.id)) errors.push(`duplicate war room item ${i.id}`);
    ids.add(i.id);
    if (!(i.maxLevel >= 1) || !Number.isInteger(i.maxLevel)) errors.push(`${i.id}: maxLevel must be a whole number of at least 1`);
    if (i.costs.length !== i.maxLevel) errors.push(`${i.id}: costs length must equal maxLevel`);
    if (i.costs.some((c) => !(c >= 1) || !Number.isInteger(c))) errors.push(`${i.id}: costs must be whole Honors`);
    if (i.costs.some((c, n) => n > 0 && c < i.costs[n - 1])) errors.push(`${i.id}: costs must not fall`);
  }
  return errors;
}
