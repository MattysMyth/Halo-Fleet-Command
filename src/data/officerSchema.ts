/** Officers and AI cores: one can lead each strike group. They are unlocked by clearing a sector and kept for good. */
import type { Effect } from './researchSchema';

export const OFFICER_EFFECTS = ['damage', 'hull', 'repair', 'cooldown', 'sortie', 'shield'] as const;

export interface OfficerDef {
  id: string;
  name: string;
  title: string;
  blurb: string;
  /** Clearing this sector (in any cycle) makes the officer available. */
  unlock: string;
  effects: Effect[];
}

export function validateOfficers(list: OfficerDef[], nodeIds: Set<string>): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const o of list) {
    if (ids.has(o.id)) errors.push(`duplicate officer ${o.id}`);
    ids.add(o.id);
    if (!nodeIds.has(o.unlock)) errors.push(`${o.id}: unlocked by unknown node ${o.unlock}`);
    if (o.effects.length < 1) errors.push(`${o.id}: needs an effect`);
    for (const e of o.effects) {
      if (!(OFFICER_EFFECTS as readonly string[]).includes(e.kind)) errors.push(`${o.id}: effect ${e.kind} does not apply to a group`);
      if (!('amount' in e) || !(e.amount > 0 && e.amount <= 0.5)) errors.push(`${o.id}: effect amounts run above 0 to 0.5`);
    }
  }
  return errors;
}
