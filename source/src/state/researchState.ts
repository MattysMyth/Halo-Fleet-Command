/**
 * Fresh research and doctrine state, and sanitisers that turn whatever a save contains into valid
 * state. Shared by the serialiser and the research sim.
 */
import { DOCTRINE_BY_ID, RESEARCH_BY_ID } from '../data';
import type { DoctrineState, ResearchState } from './types';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

export const freshResearch = (): ResearchState => ({ done: [], active: [] });
export const freshDoctrine = (slots = 1): DoctrineState => ({ picked: Array.from({ length: slots }, () => null), cooldown: 0 });

/** Keep only known projects whose prerequisites are kept, and at most `bays` of them running. */
export function sanitizeResearch(raw: unknown, bays: number): ResearchState {
  const out = freshResearch();
  const r = isObj(raw) ? raw : {};
  if (Array.isArray(r.done)) {
    const wanted = new Set(r.done.filter((x): x is string => typeof x === 'string' && !!RESEARCH_BY_ID[x]));
    // A hand-edited save cannot skip the tree.
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of wanted) {
        const req = RESEARCH_BY_ID[id].requires;
        if (req !== null && !wanted.has(req)) {
          wanted.delete(id);
          changed = true;
        }
      }
    }
    out.done = [...wanted];
  }
  const list = Array.isArray(r.active) ? r.active : isObj(r.active) ? [r.active] : [];
  for (const a of list) {
    if (out.active.length >= bays) break;
    if (!isObj(a) || typeof a.id !== 'string') continue;
    const def = RESEARCH_BY_ID[a.id];
    if (!def || out.done.includes(def.id) || out.active.some((p) => p.id === def.id)) continue;
    if (def.requires !== null && !out.done.includes(def.requires)) continue;
    out.active.push({ id: def.id, remaining: Math.min(def.seconds, Math.max(0.001, num(a.remaining, def.seconds))) });
  }
  return out;
}

export function sanitizeDoctrine(raw: unknown, slots: number): DoctrineState {
  const out = freshDoctrine(slots);
  const r = isObj(raw) ? raw : {};
  if (Array.isArray(r.picked)) {
    const seen = new Set<string>();
    for (let i = 0; i < slots; i++) {
      const id = r.picked[i];
      if (typeof id === 'string' && DOCTRINE_BY_ID[id] && !seen.has(id)) {
        out.picked[i] = id;
        seen.add(id);
      }
    }
  }
  out.cooldown = Math.min(24 * 3600, Math.max(0, num(r.cooldown, 0)));
  return out;
}
