/** Relics: permanent upgrades bought with Salvage from the Reliquary. They survive Redeploy and Transfer. */
export type RelicEffect = 'production' | 'hull' | 'reward' | 'damage' | 'storage' | 'marine';
export const RELIC_EFFECTS: readonly RelicEffect[] = ['production', 'hull', 'reward', 'damage', 'storage', 'marine'];

export interface RelicDef {
  id: string;
  name: string;
  description: string;
  effect: RelicEffect;
  /** Added to the bonus for each level bought. */
  perLevel: number;
  /** What the bonus applies to, as a phrase for the screen. */
  label: string;
  /** Salvage for each level, in order. */
  costs: number[];
}

export function validateRelics(list: RelicDef[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const r of list) {
    if (ids.has(r.id)) errors.push(`duplicate relic ${r.id}`);
    ids.add(r.id);
    if (!RELIC_EFFECTS.includes(r.effect)) errors.push(`${r.id}: unknown effect ${r.effect}`);
    if (!(r.perLevel > 0 && r.perLevel <= 0.25)) errors.push(`${r.id}: perLevel must be above 0 and at most 0.25`);
    if (r.costs.length < 1) errors.push(`${r.id}: needs at least one level`);
    if (r.costs.some((c) => !(c >= 1))) errors.push(`${r.id}: costs must be positive`);
    if (r.costs.some((c, n) => n > 0 && c < r.costs[n - 1])) errors.push(`${r.id}: costs must not fall`);
  }
  return errors;
}
