/** The Reliquary: Salvage buys Relics, permanent bonuses that survive Redeploy and Transfer. */
import { D } from '../core/numbers';
import { RELICS, RELIC_BY_ID } from '../data';
import type { RelicDef } from '../data';
import type { GameState, MetaState } from '../state/types';
import type { Mods } from './modifiers';

export const relicLevel = (meta: Pick<MetaState, 'relics'>, id: string): number => meta.relics[id] ?? 0;

export const maxRelicLevel = (def: RelicDef): number => def.costs.length;

/** Salvage for the next level, or null when the relic is complete. */
export function nextRelicCost(meta: Pick<MetaState, 'relics'>, def: RelicDef): number | null {
  const level = relicLevel(meta, def.id);
  return level >= maxRelicLevel(def) ? null : def.costs[level];
}

export function relicProblem(state: GameState, id: string): string | null {
  const def = RELIC_BY_ID[id];
  if (!def) return 'No such relic';
  const cost = nextRelicCost(state.meta, def);
  if (cost === null) return 'Already complete';
  if (state.run.salvage.lt(cost)) return `Needs ${cost} Salvage`;
  return null;
}

export function buyRelic(state: GameState, id: string): boolean {
  if (relicProblem(state, id) !== null) return false;
  const def = RELIC_BY_ID[id];
  state.run.salvage = state.run.salvage.sub(D(nextRelicCost(state.meta, def) as number));
  state.meta.relics[id] = relicLevel(state.meta, id) + 1;
  return true;
}

/** Fold every Relic into the modifiers. */
export function applyRelics(m: Mods, relics: Record<string, number>): void {
  for (const def of RELICS) {
    const level = Math.min(maxRelicLevel(def), Math.max(0, Math.floor(relics[def.id] ?? 0)));
    if (level > 0) m[def.effect] += def.perLevel * level;
  }
}
