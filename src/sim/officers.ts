/** Officers and AI cores lead a strike group and add their effects to that group's ships. */
import { OFFICERS, OFFICER_BY_ID } from '../data';
import type { OfficerDef } from '../data';
import type { Group, GameState, MetaState } from '../state/types';
import { everCleared } from './campaign';
import { runtimeOf } from './fleet';
import { applyEffect, modsOf } from './modifiers';
import type { Mods } from './modifiers';

export const officerUnlocked = (meta: MetaState, def: OfficerDef): boolean => everCleared(meta, def.unlock);

/** The officer actually leading a group: assigned and still unlocked. */
export function officerOf(state: GameState, group: Group | undefined | null): OfficerDef | null {
  const def = group?.officer ? OFFICER_BY_ID[group.officer] : undefined;
  return def && officerUnlocked(state.meta, def) ? def : null;
}

/** Research, doctrine, Honors and Relics, plus the group's officer. */
export function groupMods(state: GameState, group: Group | undefined | null): Mods {
  const m = modsOf(state);
  const o = officerOf(state, group);
  if (o) for (const e of o.effects) applyEffect(m, e);
  return m;
}

/** Put an officer in charge of a group (null to relieve them). An officer leads one group at a time. */
export function assignOfficer(state: GameState, groupId: number, officerId: string | null): { ok: true } | { ok: false; reason: string } {
  const group = state.run.fleet.groups.find((g) => g.id === groupId);
  if (!group) return { ok: false, reason: 'No such group' };
  const busy = (g: Group): boolean => runtimeOf(state, g.id).battle !== null;
  if (busy(group)) return { ok: false, reason: 'The group is in battle' };
  if (officerId !== null) {
    const holder = state.run.fleet.groups.find((g) => g.officer === officerId && g.id !== groupId);
    if (holder && busy(holder)) return { ok: false, reason: `${holder.name} is in battle with this officer` };
  }
  if (officerId === null) {
    group.officer = null;
    return { ok: true };
  }
  const def = OFFICER_BY_ID[officerId];
  if (!def) return { ok: false, reason: 'No such officer' };
  if (!officerUnlocked(state.meta, def)) return { ok: false, reason: 'Not yet available' };
  for (const g of state.run.fleet.groups) if (g.officer === officerId) g.officer = null;
  group.officer = officerId;
  return { ok: true };
}

const EFFECT_TEXT: Record<string, (pct: number) => string> = {
  damage: (p) => `+${p}% damage`,
  hull: (p) => `+${p}% hull`,
  repair: (p) => `+${p}% repair speed`,
  cooldown: (p) => `${p}% faster weapons`,
  sortie: (p) => `${p}% cheaper sorties`,
  shield: (p) => `+${p}% shields`,
};

/** A short line for the screen, such as "+8% damage, +10% hull". */
export const describeOfficer = (def: OfficerDef): string =>
  def.effects.map((e) => EFFECT_TEXT[e.kind]?.(Math.round(('amount' in e ? e.amount : 0) * 100)) ?? String(e.kind)).join(', ');

export { OFFICERS };
