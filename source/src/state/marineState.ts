/**
 * Building blocks for marine state: fresh squads and marines, rank maths, and a sanitiser that turns
 * whatever a save contains into a valid MarineState. Shared by the serialiser and the marine sim.
 */
import { MARINE, MARINE_RANKS, MISSION_BY_ID, NODE_BY_ID, PERK_BY_ID, UNIT_BY_ID, VEHICLE_BY_ID } from '../data';
import { STANDINGS } from '../data/marineSchema';
import type { Marine, MarineState, Squad } from './types';

export const SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
export const maxSquads = (): number => MARINE.squadBarracks.length;

export function defaultSquad(id: number): Squad {
  return {
    id,
    name: `${SQUAD_NAMES[(id - 1) % SQUAD_NAMES.length]} Squad`,
    slots: Array.from({ length: MARINE.squadSlots }, () => null),
    want: Array.from({ length: MARINE.squadSlots }, () => 'marine'),
    vehicle: null,
    mission: 'patrol',
    target: null,
    standing: 'adaptive',
    auto: true,
    stalled: false,
    failStreak: 0,
  };
}

export function freshMarines(squads = 0): MarineState {
  return {
    squads: Array.from({ length: squads }, (_, i) => defaultSquad(i + 1)),
    nextMarineId: 1,
    scouted: {},
  };
}

export function makeMarine(id: number, unit: string, xp = 0): Marine {
  return { id, unit, xp, perks: [], hurt: 0 };
}

/** Index into the rank list for an amount of experience: 0 is Private. */
export function rankIndexOf(xp: number): number {
  let r = 0;
  for (let i = 0; i < MARINE_RANKS.length; i++) if (xp >= MARINE_RANKS[i].xp) r = i;
  return r;
}

/** Perks a marine has earned but not chosen yet. */
export const pendingPerks = (m: Marine): number => Math.max(0, rankIndexOf(m.xp) - m.perks.length);

/* ---------- sanitising a saved roster ---------- */

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const posInt = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x > 0 && x < 1_000_000 ? x : null);
const MAX_XP = 1_000_000;
const MAX_HURT = 3600;

function cleanMarine(raw: unknown, used: Set<number>, nextId: { n: number }): Marine | null {
  if (!isObj(raw) || typeof raw.unit !== 'string' || !UNIT_BY_ID[raw.unit]) return null;
  let id = posInt(raw.id);
  if (id === null || used.has(id)) id = nextId.n;
  used.add(id);
  nextId.n = Math.max(nextId.n, id + 1);
  const xp = Math.min(MAX_XP, Math.max(0, num(raw.xp, 0)));
  const perks: string[] = [];
  if (Array.isArray(raw.perks)) {
    const earned = rankIndexOf(xp);
    for (const p of raw.perks) {
      const def = typeof p === 'string' ? PERK_BY_ID[p] : undefined;
      if (!def || def.rank !== perks.length + 1 || perks.length >= earned) break;
      perks.push(def.id);
    }
  }
  return { id, unit: raw.unit, xp, perks, hurt: Math.min(MAX_HURT, Math.max(0, num(raw.hurt, 0))) };
}

export function sanitizeMarines(input: unknown, barracks = Infinity): MarineState {
  const raw = isObj(input) ? input : {};
  const used = new Set<number>();
  const nextId = { n: 1 };
  const squads: Squad[] = [];
  const squadIds = new Set<number>();
  // Only as many squads as the Barracks Complexes standing allow.
  const allowed = MARINE.squadBarracks.filter((need) => barracks >= need).length;
  if (Array.isArray(raw.squads)) {
    for (const s of raw.squads) {
      if (!isObj(s) || squads.length >= Math.min(maxSquads(), allowed)) continue;
      const wasId = posInt(s.id);
      if (wasId === null || squadIds.has(wasId) || wasId > maxSquads()) continue;
      squadIds.add(wasId);
      const id = squads.length + 1; // renumber, so ids are always 1..n and runtime state cannot be shared
      const d = defaultSquad(id);
      const slots: (Marine | null)[] = d.slots.map((_, i) => (Array.isArray(s.slots) ? cleanMarine(s.slots[i], used, nextId) : null));
      const want = d.want.map((_, i) => {
        const w = Array.isArray(s.want) ? s.want[i] : undefined;
        return typeof w === 'string' && UNIT_BY_ID[w] ? w : 'marine';
      });
      const mission = typeof s.mission === 'string' && MISSION_BY_ID[s.mission] && !MISSION_BY_ID[s.mission].incident ? (s.mission as Squad['mission']) : 'patrol';
      squads.push({
        id,
        name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 32) : d.name,
        slots,
        want,
        vehicle: typeof s.vehicle === 'string' && VEHICLE_BY_ID[s.vehicle] ? s.vehicle : null,
        mission,
        target: typeof s.target === 'string' && NODE_BY_ID[s.target] ? s.target : null,
        standing: STANDINGS.includes(s.standing as Squad['standing']) ? (s.standing as Squad['standing']) : 'adaptive',
        auto: s.auto !== false && MISSION_BY_ID[mission].auto, // an assault always needs orders
        stalled: s.stalled === true,
        failStreak: Math.max(0, Math.min(99, Math.floor(num(s.failStreak, 0)))),
      });
    }
  }

  const scouted: Record<string, number> = {};
  if (isObj(raw.scouted)) {
    for (const [id, n] of Object.entries(raw.scouted)) {
      const c = Math.floor(Math.max(0, num(n, 0)));
      if (NODE_BY_ID[id] && c > 0) scouted[id] = Math.min(20, c);
    }
  }
  return {
    squads,
    nextMarineId: Math.min(1_000_000, Math.max(nextId.n, Math.floor(num(raw.nextMarineId, 1)))),
    scouted,
  };
}
