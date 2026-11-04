import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/core/numbers';
import { createMemoryStore, readSave, writeSave } from '../src/core/save';
import { migrate } from '../src/state/migrations';
import type { Migration } from '../src/state/migrations';
import { DISPLAY_DEFAULTS, decodeSave, encodeSave, fromRaw, newGameState, toRaw } from '../src/state/serialize';

describe('save round trip', () => {
  it('preserves big numbers and all progress', () => {
    const s = newGameState(1_000, 123);
    s.run.rp = new Decimal('4.5e30');
    s.run.earned = new Decimal('9.9e40');
    s.run.owned.depot = 42;
    s.meta.medals = 5;
    s.meta.medalsEarned = 11;
    s.meta.armory['auto-depot'] = 1;
    s.meta.lifetimeEarned = new Decimal('1.2e55');
    s.settings = { ...s.settings, notation: 'scientific', buyMode: 'max', battleSpeed: 1 };

    const back = fromRaw(JSON.parse(JSON.stringify(toRaw(s))));
    expect(back).not.toBeNull();
    expect(back!.run.rp.eq(s.run.rp)).toBe(true);
    expect(back!.run.earned.eq(s.run.earned)).toBe(true);
    expect(back!.run.owned.depot).toBe(42);
    expect(back!.meta.medals).toBe(5);
    expect(back!.meta.medalsEarned).toBe(11);
    expect(back!.meta.armory['auto-depot']).toBe(1);
    expect(back!.meta.lifetimeEarned.eq(s.meta.lifetimeEarned)).toBe(true);
    expect(back!.settings).toEqual({ notation: 'scientific', buyMode: 'max', battleSpeed: 1, ...DISPLAY_DEFAULTS });
    expect(back!.seed).toBe(123);
  });

  it('round-trips through the export string', () => {
    const s = newGameState(1_000, 7);
    s.run.owned.hub = 9;
    const text = encodeSave(s);
    expect(text.startsWith('HFC1.')).toBe(true);
    expect(decodeSave(text)!.run.owned.hub).toBe(9);
    expect(decodeSave(`  ${text}\n`)!.run.owned.hub).toBe(9);
  });

  it('rejects garbage without throwing', () => {
    expect(decodeSave('not a save')).toBeNull();
    expect(decodeSave('HFC1.@@@')).toBeNull();
    expect(decodeSave('{}')).toBeNull();
    expect(decodeSave('[]')).toBeNull();
    expect(decodeSave('null')).toBeNull();
  });

  it('repairs damaged values and drops unknown content', () => {
    const raw = toRaw(newGameState(1_000, 1)) as unknown as Record<string, any>;
    raw.run.rp = 'banana';
    raw.run.owned = { depot: -5, hub: 3.7, ghost: 99 };
    raw.meta.armory = { 'auto-depot': 99, 'no-such-item': 3 };
    raw.settings = { notation: 'klingon', buyMode: 7 };
    const s = fromRaw(raw)!;
    expect(s.run.rp.eq(0)).toBe(true);
    expect(s.run.owned.depot).toBe(0);
    expect(s.run.owned.hub).toBe(3);
    expect('ghost' in s.run.owned).toBe(false);
    expect(s.meta.armory['auto-depot']).toBe(1);
    expect('no-such-item' in s.meta.armory).toBe(false);
    expect(s.settings).toEqual({ notation: 'standard', buyMode: 1, battleSpeed: 1, ...DISPLAY_DEFAULTS });
  });
});

describe('migrations', () => {
  const steps: Record<number, Migration> = {
    0: (r) => ({ ...r, renamed: r.oldName }),
    1: (r) => ({ ...r, extra: 'added' }),
  };

  it('upgrades step by step to the target version', () => {
    const out = migrate({ version: 0, oldName: 'x' }, steps, 2)!;
    expect(out.version).toBe(2);
    expect(out.renamed).toBe('x');
    expect(out.extra).toBe('added');
  });

  it('leaves a current save alone', () => {
    expect(migrate({ version: 2, keep: true }, steps, 2)).toEqual({ version: 2, keep: true });
  });

  it('refuses saves from a newer build, bad versions and missing steps', () => {
    expect(migrate({ version: 3 }, steps, 2)).toBeNull();
    expect(migrate({ version: -1 }, steps, 2)).toBeNull();
    expect(migrate({ version: 1.5 }, steps, 2)).toBeNull();
    expect(migrate({}, steps, 2)).toBeNull();
    expect(migrate({ version: 0 }, {}, 2)).toBeNull();
    expect(migrate('x', steps, 2)).toBeNull();
  });

  it('does not mutate its input', () => {
    const input = { version: 0, oldName: 'x' };
    migrate(input, steps, 2);
    expect(input).toEqual({ version: 0, oldName: 'x' });
  });
});

describe('storage wrapper', () => {
  it('reads back what it wrote', () => {
    const store = createMemoryStore();
    expect(readSave(store)).toBeNull();
    expect(writeSave(store, 'abc')).toBe(true);
    expect(readSave(store)).toBe('abc');
  });

  it('survives a store that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSave(broken)).toBeNull();
    expect(writeSave(broken, 'abc')).toBe(false);
  });
});
