/**
 * Research projects and doctrines. Projects cost Intel (Captured tech also Salvage) up front, run
 * in parallel up to the number of research bays, and are refunded if cancelled. Doctrines are
 * adopted into slots; changing one that is already in place costs Intel and starts a cooldown.
 */
import { D } from '../core/numbers';
import { DOCTRINE_BY_ID, RESEARCH_BY_ID, RESEARCH_CONFIG } from '../data';
import type { DoctrineDef, ResearchDef } from '../data';
import type { GameState } from '../state/types';
import { doctrineSlotCount, researchBays } from './armory';
import { addCapped } from './economy';

export type ResearchEvent = { kind: 'research'; def: ResearchDef };
export type ResearchEmit = (e: ResearchEvent) => void;

export type Result = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): Result => ({ ok: false, reason });
const OK: Result = { ok: true };

export const researchDone = (state: GameState, id: string): boolean => state.run.research.done.includes(id);

export type ResearchStatus = 'done' | 'active' | 'available' | 'locked';

export function researchStatus(state: GameState, def: ResearchDef): ResearchStatus {
  const r = state.run.research;
  if (r.done.includes(def.id)) return 'done';
  if (r.active.some((p) => p.id === def.id)) return 'active';
  return def.requires === null || r.done.includes(def.requires) ? 'available' : 'locked';
}

/** Why a project cannot start right now, or null when it can. */
export function researchProblem(state: GameState, def: ResearchDef): string | null {
  const st = researchStatus(state, def);
  if (st === 'done') return 'Already researched';
  if (st === 'active') return 'Already under way';
  if (st === 'locked') return 'Needs earlier research';
  if (state.run.research.active.length >= researchBays(state.meta)) return 'Every research bay is busy';
  if (state.run.intel.lt(def.intel)) return 'Not enough Intel';
  if (def.salvage && state.run.salvage.lt(def.salvage)) return 'Not enough Salvage';
  return null;
}

export function startResearch(state: GameState, id: string): Result {
  const def = RESEARCH_BY_ID[id];
  if (!def) return fail('Unknown research');
  const why = researchProblem(state, def);
  if (why) return fail(why);
  state.run.intel = state.run.intel.sub(def.intel);
  if (def.salvage) state.run.salvage = state.run.salvage.sub(def.salvage);
  state.run.research.active.push({ id, remaining: def.seconds });
  return OK;
}

export function cancelResearch(state: GameState, id: string): Result {
  const r = state.run.research;
  const i = r.active.findIndex((p) => p.id === id);
  if (i < 0) return fail('That project is not under way');
  const def = RESEARCH_BY_ID[id];
  r.active.splice(i, 1);
  addCapped(state, 'intel', D(def.intel));
  if (def.salvage) addCapped(state, 'salvage', D(def.salvage));
  return OK;
}

/** Advance projects and the doctrine cooldown. Safe to call with a long `dt` (time away). */
export function stepResearch(state: GameState, dt: number, emit?: ResearchEmit): void {
  const r = state.run.research;
  const d = state.run.doctrine;
  if (d.cooldown > 0) d.cooldown = Math.max(0, d.cooldown - dt);
  if (r.active.length === 0) return;
  const finished: ResearchDef[] = [];
  for (const p of r.active) {
    p.remaining -= dt;
    if (p.remaining <= 1e-9) finished.push(RESEARCH_BY_ID[p.id]);
  }
  if (finished.length === 0) return;
  r.active = r.active.filter((p) => p.remaining > 1e-9);
  for (const def of finished) {
    r.done.push(def.id);
    emit?.({ kind: 'research', def });
  }
}

/* ---------- doctrine ---------- */

export const doctrineSlots = (state: GameState): number => doctrineSlotCount(state.meta);

/** Intel to adopt `id` in `slot` right now: nothing for an empty slot, the swap fee otherwise. */
export function doctrineCost(state: GameState, slot: number): number {
  return state.run.doctrine.picked[slot] ? RESEARCH_CONFIG.swapIntel : 0;
}

export function doctrineProblem(state: GameState, slot: number, id: string): string | null {
  const d = state.run.doctrine;
  if (!DOCTRINE_BY_ID[id]) return 'Unknown doctrine';
  if (slot < 0 || slot >= d.picked.length) return 'No such slot';
  if (d.picked[slot] === id) return 'Already adopted';
  if (d.picked.includes(id)) return 'Already adopted in another slot';
  if (d.picked[slot]) {
    if (d.cooldown > 0) return 'The staff are still reorganising';
    if (state.run.intel.lt(RESEARCH_CONFIG.swapIntel)) return 'Not enough Intel';
  }
  return null;
}

export function adoptDoctrine(state: GameState, slot: number, id: string): Result {
  const why = doctrineProblem(state, slot, id);
  if (why) return fail(why);
  const d = state.run.doctrine;
  if (d.picked[slot]) {
    state.run.intel = state.run.intel.sub(RESEARCH_CONFIG.swapIntel);
    d.cooldown = RESEARCH_CONFIG.swapSeconds;
  }
  d.picked[slot] = id;
  return OK;
}

export const doctrineAt = (state: GameState, slot: number): DoctrineDef | null => {
  const id = state.run.doctrine.picked[slot];
  return id ? DOCTRINE_BY_ID[id] ?? null : null;
};

/** Open doctrine slots appear when the Armory grants them; grow the saved list to match. */
export function syncDoctrineSlots(state: GameState): void {
  const want = doctrineSlots(state);
  const d = state.run.doctrine;
  while (d.picked.length < want) d.picked.push(null);
}
