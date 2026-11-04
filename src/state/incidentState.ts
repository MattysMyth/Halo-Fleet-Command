/** Sanitisers for incidents and contested positions, shared by the serialiser and tests. */
import { ENEMY_BY_ID, MARINE, POSITION_BY_NODE } from '../data';
import type { Incident } from './types';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function sanitizeIncidents(raw: unknown, held: ReadonlySet<string>): { incidents: Incident[]; next: number } {
  const out: Incident[] = [];
  const seen = new Set<number>();
  let max = 0;
  const c = MARINE.incidents;
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!isObj(r)) continue;
      const kind = r.kind;
      const node = r.node;
      if ((kind !== 'boarding' && kind !== 'defend') || typeof node !== 'string' || !POSITION_BY_NODE[node]) continue;
      if (kind === 'defend' && !held.has(node)) continue; // only held ground can be attacked
      const id = Math.floor(num(r.id, 0));
      if (id < 1 || id > 1_000_000 || seen.has(id)) continue;
      if (out.filter((i) => i.kind === kind).length >= c.max) continue;
      const inc: Incident = {
        id,
        kind,
        node,
        threat: clamp(num(r.threat, POSITION_BY_NODE[node].threat), 1, 1_000_000),
        expires: clamp(num(r.expires, 1), 0.001, Math.max(c.boardingSeconds, c.defendSeconds)),
      };
      if (kind === 'boarding') {
        if (typeof r.enemy !== 'string' || !ENEMY_BY_ID[r.enemy]) continue;
        inc.enemy = r.enemy;
        inc.salvage = clamp(num(r.salvage, 0), 0, 1_000_000);
        inc.hullChance = clamp(num(r.hullChance, 0), 0, c.hullChance.cap);
      }
      seen.add(id);
      max = Math.max(max, id);
      out.push(inc);
    }
  }
  return { incidents: out, next: Math.min(1_000_000, max + 1) };
}

export function sanitizeContested(raw: unknown, held: ReadonlySet<string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(raw)) {
    for (const [node, secs] of Object.entries(raw)) {
      const s = num(secs, 0);
      if (POSITION_BY_NODE[node] && held.has(node) && s > 0) out[node] = Math.min(MARINE.incidents.contestedSeconds, s);
    }
  }
  return out;
}
