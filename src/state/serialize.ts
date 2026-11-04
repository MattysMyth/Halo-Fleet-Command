import { D, Decimal, ZERO } from '../core/numbers';
import type { Notation } from '../core/numbers';
import { NOTATIONS } from '../core/numbers';
import { BUILDINGS, ARMORY_BY_ID, ECONOMY, FLEET, MARINE, NODE_BY_ID, POSITION_BY_NODE, THEATRES, WARROOM_BY_ID, RELIC_BY_ID } from '../data';
import { doctrineSlotCount, researchBays } from '../sim/armory';
import { commandCapacity, groupsUnlocked } from '../sim/campaign';
import { capOf, storageCap } from '../sim/economy';
import { initialDefendClock } from '../sim/incidents';
import { modsFor, vaultFor } from '../sim/modifiers';
import { applyRelics } from '../sim/relics';
import { freshFleet, sanitizeFleet } from './fleetState';
import { freshMarines, sanitizeMarines } from './marineState';
import { sanitizeContested, sanitizeIncidents } from './incidentState';
import { freshDoctrine, freshResearch, sanitizeDoctrine, sanitizeResearch } from './researchState';
import { CURRENT_VERSION, migrate } from './migrations';
import type { BuyMode, GameState, MetaState, RawSave } from './types';

const EXPORT_PREFIX = 'HFC1.';

export function emptyMeta(): MetaState {
  return {
    medals: 0,
    medalsEarned: 0,
    armory: {},
    redeploys: 0,
    lastRunSeconds: null,
    bestRunSeconds: null,
    lifetimeEarned: ZERO,
    cleared: {},
    cadreXp: 0,
    fleetUnlocked: false,
    battles: { total: 0, won: 0, lost: 0 },
    opsUnlocked: false,
    captured: {},
    missions: { total: 0, won: 0, lost: 0, killed: 0 },
    everCleared: {},
    theatre: 1,
    theatresOpen: 1,
    honors: 0,
    honorsEarned: 0,
    transfers: 0,
    warroom: {},
    relics: {},
  };
}

/** Fresh run values: starting requisition plus whatever the Armory grants at the start of a run. */
export function freshRun(meta: MetaState): GameState['run'] {
  const owned: Record<string, number> = Object.fromEntries(BUILDINGS.map((b) => [b.id, 0]));
  for (const [id, level] of Object.entries(meta.armory)) {
    const def = ARMORY_BY_ID[id];
    if (def && def.kind === 'startBuildings' && level > 0) {
      owned[def.building] = Math.max(owned[def.building] ?? 0, def.counts[Math.min(level, def.counts.length) - 1]);
    }
  }
  return {
    rp: D(ECONOMY.startingRp),
    earned: ZERO,
    ti: ZERO,
    deut: ZERO,
    pers: meta.opsUnlocked ? D(MARINE.startingPersonnel) : ZERO,
    intel: ZERO,
    salvage: ZERO,
    owned,
    fleet: freshFleet(),
    marines: freshMarines(meta.opsUnlocked ? 1 : 0),
    research: freshResearch(),
    doctrine: freshDoctrine(doctrineSlotCount(meta)),
    incidents: [],
    nextIncidentId: 1,
    defendClock: initialDefendClock(),
    contested: {},
    elapsed: 0,
    autoClock: 0,
    live: {},
    ops: {},
  };
}

export const TEXT_SCALES: readonly number[] = [1, 1.15, 1.3];
export const DISPLAY_DEFAULTS = { sound: false, volume: 0.5, reduceMotion: false, highContrast: false, textScale: 1 };

export function newGameState(now: number, seed: number): GameState {
  const meta = emptyMeta();
  return {
    version: CURRENT_VERSION,
    startedAt: now,
    lastSeen: now,
    seed: seed >>> 0,
    run: freshRun(meta),
    meta,
    settings: { notation: 'standard', buyMode: 1, battleSpeed: 1, ...DISPLAY_DEFAULTS },
  };
}

/**
 * Deuterium to save. A battle in progress is not saved, so the Deuterium its sortie cost is handed
 * back: after a reload the fleet is simply in port again. A marine mission's orbital strikes are
 * handed back the same way.
 */
function unspentDeut(state: GameState): Decimal {
  let paid = 0;
  for (const rt of Object.values(state.run.live)) if (rt.battle) paid += rt.paid ?? 0;
  for (const op of Object.values(state.run.ops)) if (op.mission) paid += op.mission.paid.deut;
  return paid > 0 ? Decimal.min(D(capOf(state, 'deut')), state.run.deut.add(paid)) : state.run.deut;
}

/** Personnel to save: garrison fees paid for an assault still under way go back to the stock. */
function unspentPers(state: GameState): Decimal {
  let paid = 0;
  for (const op of Object.values(state.run.ops)) if (op.mission) paid += op.mission.paid.pers;
  return paid > 0 ? Decimal.min(D(capOf(state, 'pers')), state.run.pers.add(paid)) : state.run.pers;
}

export function toRaw(state: GameState): RawSave {
  return {
    version: state.version,
    startedAt: state.startedAt,
    lastSeen: state.lastSeen,
    seed: state.seed,
    run: {
      rp: state.run.rp.toString(),
      earned: state.run.earned.toString(),
      ti: state.run.ti.toString(),
      deut: unspentDeut(state).toString(),
      pers: unspentPers(state).toString(),
      intel: state.run.intel.toString(),
      salvage: state.run.salvage.toString(),
      owned: { ...state.run.owned },
      fleet: structuredClone(state.run.fleet),
      marines: structuredClone(state.run.marines),
      research: structuredClone(state.run.research),
      doctrine: structuredClone(state.run.doctrine),
      // A mission in progress is not saved, so the incident it was answering goes back on the board: a reload cannot dodge an overrun.
      incidents: structuredClone([...state.run.incidents, ...Object.values(state.run.ops).flatMap((op) => (op.mission?.incident ? [op.mission.incident] : []))]),
      nextIncidentId: state.run.nextIncidentId,
      defendClock: state.run.defendClock,
      contested: { ...state.run.contested },
      elapsed: state.run.elapsed,
    },
    meta: {
      medals: state.meta.medals,
      medalsEarned: state.meta.medalsEarned,
      armory: { ...state.meta.armory },
      redeploys: state.meta.redeploys,
      lastRunSeconds: state.meta.lastRunSeconds,
      bestRunSeconds: state.meta.bestRunSeconds,
      lifetimeEarned: state.meta.lifetimeEarned.toString(),
      cleared: { ...state.meta.cleared },
      cadreXp: state.meta.cadreXp,
      fleetUnlocked: state.meta.fleetUnlocked,
      battles: { ...state.meta.battles },
      opsUnlocked: state.meta.opsUnlocked,
      captured: { ...state.meta.captured },
      missions: { ...state.meta.missions },
      everCleared: { ...state.meta.everCleared },
      theatre: state.meta.theatre,
      theatresOpen: state.meta.theatresOpen,
      honors: state.meta.honors,
      honorsEarned: state.meta.honorsEarned,
      transfers: state.meta.transfers,
      warroom: { ...state.meta.warroom },
      relics: { ...state.meta.relics },
    },
    settings: { ...state.settings },
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const nonNeg = (x: unknown, fallback = 0): number => Math.max(0, num(x, fallback));
const nullableNum = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function dec(x: unknown, fallback: Decimal = ZERO): Decimal {
  if (typeof x !== 'string' && typeof x !== 'number') return fallback;
  try {
    const v = new Decimal(x);
    return !Number.isFinite(v.mantissa) || !Number.isFinite(v.exponent) || v.exponent > 1e9 || v.lt(0) ? fallback : v;
  } catch {
    return fallback; // the Decimal parser throws on text like "banana"
  }
}

/**
 * Build a GameState from a parsed save, filling gaps with defaults and dropping anything the
 * current data does not know about. Returns null when the input is not a usable save.
 */
export function fromRaw(input: unknown): GameState | null {
  const raw = migrate(input);
  if (!raw || !isObj(raw.run) || !isObj(raw.meta)) return null;

  const now = Date.now();
  const base = newGameState(now, num(raw.seed, now));
  const run = raw.run;
  const meta = raw.meta;
  const settings = isObj(raw.settings) ? raw.settings : {};

  const owned = { ...base.run.owned };
  if (isObj(run.owned)) {
    for (const b of BUILDINGS) owned[b.id] = Math.floor(nonNeg(run.owned[b.id]));
  }

  const armory: Record<string, number> = {};
  if (isObj(meta.armory)) {
    for (const [id, level] of Object.entries(meta.armory)) {
      const def = ARMORY_BY_ID[id];
      if (def) armory[id] = Math.min(def.maxLevel, Math.floor(nonNeg(level)));
    }
  }

  const cleared: Record<string, number> = {};
  if (isObj(meta.cleared)) {
    for (const [id, n] of Object.entries(meta.cleared)) {
      if (NODE_BY_ID[id] && Math.floor(nonNeg(n)) > 0) cleared[id] = Math.floor(nonNeg(n));
    }
  }
  const everCleared: Record<string, number> = { ...cleared };
  if (isObj(meta.everCleared)) {
    for (const [id, n] of Object.entries(meta.everCleared)) {
      if (NODE_BY_ID[id] && Math.floor(nonNeg(n)) > 0) everCleared[id] = Math.max(everCleared[id] ?? 0, Math.floor(nonNeg(n)));
    }
  }
  const warroom: Record<string, number> = {};
  if (isObj(meta.warroom)) {
    for (const [id, level] of Object.entries(meta.warroom)) {
      const def = WARROOM_BY_ID[id];
      if (def && Math.floor(nonNeg(level)) > 0) warroom[id] = Math.min(def.maxLevel, Math.floor(nonNeg(level)));
    }
  }
  const relics: Record<string, number> = {};
  if (isObj(meta.relics)) {
    for (const [id, level] of Object.entries(meta.relics)) {
      const def = RELIC_BY_ID[id];
      if (def && Math.floor(nonNeg(level)) > 0) relics[id] = Math.min(def.costs.length, Math.floor(nonNeg(level)));
    }
  }
  const theatresOpen = Math.min(THEATRES.length, Math.max(1, Math.floor(nonNeg(meta.theatresOpen, 1))));
  // A theatre that is not open cannot have been cleared.
  for (const t of THEATRES) if (t.id > theatresOpen) for (const n of t.nodes) { delete everCleared[n.id]; delete cleared[n.id]; }
  const theatre = Math.min(theatresOpen, Math.max(1, Math.floor(nonNeg(meta.theatre, 1))));
  const honorsEarned = Math.floor(nonNeg(meta.honorsEarned));
  // Levels bought must have been paid for out of the Honors ever earned: trim the shop from the back until they were.
  const costOf = (id: string, level: number): number => WARROOM_BY_ID[id].costs.slice(0, level).reduce((a, b) => a + b, 0);
  let spent = Object.entries(warroom).reduce((n, [id, level]) => n + costOf(id, level), 0);
  for (const id of Object.keys(warroom).reverse()) {
    while (spent > honorsEarned && warroom[id] > 0) {
      spent -= WARROOM_BY_ID[id].costs[warroom[id] - 1];
      warroom[id] -= 1;
    }
    if (warroom[id] === 0) delete warroom[id];
  }
  const honors = Math.min(honorsEarned - spent, Math.floor(nonNeg(meta.honors)));
  const battles = isObj(meta.battles) ? meta.battles : {};
  const captured: Record<string, number> = {};
  if (isObj(meta.captured)) {
    for (const [id, n] of Object.entries(meta.captured)) {
      if (NODE_BY_ID[id] && POSITION_BY_NODE[id] && everCleared[id] && Math.floor(nonNeg(n)) > 0) captured[id] = 1; // only ground the campaign has cleared can be held
    }
  }
  const missions = isObj(meta.missions) ? meta.missions : {};

  const progress = { armory, warroom, everCleared, cleared, captured, theatre, theatresOpen } as MetaState;
  const research = sanitizeResearch(run.research, researchBays(progress));
  const doctrine = sanitizeDoctrine(run.doctrine, doctrineSlotCount(progress));
  const mods = { ...modsFor(research, doctrine), vault: vaultFor(theatresOpen) };
  applyRelics(mods, relics);
  const heldNodes = new Set(Object.keys(captured));
  const incidents = sanitizeIncidents(run.incidents, heldNodes);

  const speed = num(settings.battleSpeed, 1);
  const battleSpeed = FLEET.battleSpeeds.includes(speed) ? speed : 1;
  const notation = NOTATIONS.includes(settings.notation as Notation) ? (settings.notation as Notation) : 'standard';
  const mode = settings.buyMode;
  const buyMode: BuyMode = mode === 10 || mode === 100 || mode === 'max' ? mode : 1;

  return {
    version: CURRENT_VERSION,
    startedAt: num(raw.startedAt, now),
    lastSeen: num(raw.lastSeen, now),
    seed: num(raw.seed, now) >>> 0,
    run: {
      rp: dec(run.rp),
      earned: dec(run.earned),
      ti: Decimal.min(D(storageCap('ti', mods)), dec(run.ti)),
      deut: Decimal.min(D(storageCap('deut', mods)), dec(run.deut)),
      pers: Decimal.min(D(storageCap('pers', mods)), dec(run.pers)),
      intel: Decimal.min(D(storageCap('intel', mods)), dec(run.intel)),
      salvage: Decimal.min(D(storageCap('salvage', mods)), dec(run.salvage)),
      owned,
      fleet: sanitizeFleet(
        run.fleet,
        commandCapacity(progress),
        groupsUnlocked(progress),
      ),
      marines: sanitizeMarines(run.marines, owned.barracks ?? 0),
      research,
      doctrine,
      incidents: incidents.incidents,
      nextIncidentId: Math.max(incidents.next, Math.min(1_000_000, Math.floor(nonNeg(run.nextIncidentId, 1)))),
      defendClock: Math.min(MARINE.incidents.defendEvery[1], nonNeg(run.defendClock, initialDefendClock())),
      contested: sanitizeContested(run.contested, heldNodes),
      elapsed: nonNeg(run.elapsed),
      autoClock: 0,
      live: {},
      ops: {},
    },
    meta: {
      medals: Math.floor(nonNeg(meta.medals)),
      medalsEarned: Math.floor(nonNeg(meta.medalsEarned)),
      armory,
      redeploys: Math.floor(nonNeg(meta.redeploys)),
      lastRunSeconds: nullableNum(meta.lastRunSeconds),
      bestRunSeconds: nullableNum(meta.bestRunSeconds),
      lifetimeEarned: dec(meta.lifetimeEarned),
      cleared,
      cadreXp: Math.min(FLEET.cadre.cap, Math.floor(nonNeg(meta.cadreXp))),
      fleetUnlocked: meta.fleetUnlocked === true,
      battles: {
        total: Math.floor(nonNeg(battles.total)),
        won: Math.floor(nonNeg(battles.won)),
        lost: Math.floor(nonNeg(battles.lost)),
      },
      opsUnlocked: meta.opsUnlocked === true,
      captured,
      missions: {
        total: Math.floor(nonNeg(missions.total)),
        won: Math.floor(nonNeg(missions.won)),
        lost: Math.floor(nonNeg(missions.lost)),
        killed: Math.floor(nonNeg(missions.killed)),
      },
      everCleared,
      theatre,
      theatresOpen,
      honors,
      honorsEarned,
      transfers: Math.floor(nonNeg(meta.transfers)),
      warroom,
      relics,
    },
    settings: {
      notation,
      buyMode,
      battleSpeed,
      sound: settings.sound === true,
      volume: Math.min(1, Math.max(0, num(settings.volume, DISPLAY_DEFAULTS.volume))),
      reduceMotion: settings.reduceMotion === true,
      highContrast: settings.highContrast === true,
      textScale: TEXT_SCALES.includes(num(settings.textScale, 1)) ? num(settings.textScale, 1) : 1,
    },
  };
}

/** Save text for the export box: a short prefix plus base64 JSON. */
export function encodeSave(state: GameState): string {
  return EXPORT_PREFIX + btoa(JSON.stringify(toRaw(state)));
}

/** Parse export text (or raw JSON from local storage). Returns null for anything unusable. */
export function decodeSave(text: string): GameState | null {
  const trimmed = text.trim();
  try {
    const json = trimmed.startsWith(EXPORT_PREFIX) ? atob(trimmed.slice(EXPORT_PREFIX.length)) : trimmed;
    return fromRaw(JSON.parse(json));
  } catch {
    return null;
  }
}
