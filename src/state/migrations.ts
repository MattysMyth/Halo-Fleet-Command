/**
 * Save-format migrations.
 *
 * Every change to the saved shape bumps CURRENT_VERSION and adds a migration that upgrades
 * version n to n + 1. Old saves are upgraded step by step on load, so the design can keep
 * changing during the build without breaking anyone's progress.
 */
export const CURRENT_VERSION = 6;

type Json = Record<string, unknown>;
export type Migration = (raw: Json) => Json;

const obj = (x: unknown): Json => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : {});

/**
 * MIGRATIONS[n] upgrades a version-n save to version n + 1.
 *  1 -> 2 (build 0.2): adds Titanium-A, Deuterium, the fleet and campaign progress. Every new field
 *  starts empty, which is also what fromRaw fills in for anything missing.
 *  2 -> 3 (build 0.3): adds Personnel, Intel, the marine roster, captured positions and mission totals.
 *  3 -> 4 (build 0.4): adds Salvage and doctrines, and moves field research out of the marine roster
 *  into the general research state (one project at a time becomes a list of projects), and adds incidents
 *  (boarding chances and counter-attacks) and contested positions.
 *  4 -> 5 (build 0.4): adds the Transfer layer: Battle Honors, the War Room, the active and highest open
 *  theatre, and the record of every sector ever cleared (seeded from the sectors cleared now).
 *  5 -> 6 (build 0.5): adds Relics, the Reliquary's permanent purchases.
 */
export const MIGRATIONS: Record<number, Migration> = {
  5: (raw) => ({ ...raw, meta: { ...obj(raw.meta), relics: {} } }),
  4: (raw) => {
    const meta = obj(raw.meta);
    return {
      ...raw,
      meta: { ...meta, everCleared: { ...obj(meta.cleared) }, theatre: 1, theatresOpen: 1, honors: 0, honorsEarned: 0, transfers: 0, warroom: {} },
    };
  },
  1: (raw) => ({
    ...raw,
    run: { ...obj(raw.run), ti: '0', deut: '0' },
    meta: { ...obj(raw.meta), cleared: {}, cadreXp: 0, fleetUnlocked: false, battles: { total: 0, won: 0, lost: 0 } },
    settings: { ...obj(raw.settings), battleSpeed: 1 },
  }),
  2: (raw) => ({
    ...raw,
    run: { ...obj(raw.run), pers: '0', intel: '0' },
    meta: { ...obj(raw.meta), opsUnlocked: false, captured: {}, missions: { total: 0, won: 0, lost: 0, killed: 0 } },
  }),
  3: (raw) => {
    const run = obj(raw.run);
    const { research: old, ...marines } = obj(run.marines);
    const field = obj(old);
    return {
      ...raw,
      run: {
        ...run,
        marines,
        salvage: '0',
        research: { done: Array.isArray(field.done) ? field.done : [], active: field.active ? [field.active] : [] },
        doctrine: { picked: [null], cooldown: 0 },
        incidents: [],
        nextIncidentId: 1,
        contested: {},
      },
    };
  },
};

/**
 * Upgrade a parsed save to `target`. Returns null when the input is not a save, is newer than this
 * build understands, or a migration step is missing.
 */
export function migrate(
  input: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = CURRENT_VERSION,
): Json | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  let raw = { ...(input as Json) };
  let version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > target) return null;

  while (version < target) {
    const step = migrations[version];
    if (!step) return null;
    raw = { ...step(raw), version: version + 1 };
    version += 1;
  }
  return raw;
}
