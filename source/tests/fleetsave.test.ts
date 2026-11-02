import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/core/numbers';
import { FLEET } from '../src/data';
import { makeShip, sanitizeFleet } from '../src/state/fleetState';
import { CURRENT_VERSION, migrate } from '../src/state/migrations';
import { DISPLAY_DEFAULTS, decodeSave, encodeSave, fromRaw, newGameState, toRaw } from '../src/state/serialize';
import { SHIP_BY_ID } from '../src/data';

const frigate = SHIP_BY_ID.frigate;

describe('save format', () => {
  it('is the current version', () => {
    expect(CURRENT_VERSION).toBe(6);
    expect(newGameState(0, 1).version).toBe(6);
  });

  it('round-trips ships, groups, the build queue and campaign progress', () => {
    const s = newGameState(1_000, 5);
    s.run.ti = new Decimal('12345');
    s.run.deut = new Decimal('678');
    const a = makeShip(frigate, 1, 1, 'front');
    a.hull = 0.4;
    a.xp = 17;
    a.weapons = ['autocannon', 'autocannon'];
    s.run.fleet.ships.push(a, makeShip(frigate, 2, 0, 'rear'));
    s.run.fleet.nextShipId = 3;
    s.run.fleet.queue.push({ classId: 'frigate', remaining: 50, total: 120 });
    s.run.fleet.slips = 2;
    s.run.fleet.groups[0].order = 'patrol';
    s.run.fleet.groups[0].stance = 'closein';
    s.run.fleet.groups[0].priority = 'shields';
    s.run.fleet.groups[0].patrolNode = 't1-n2';
    s.run.fleet.groups[0].autoAbilities = true;
    s.meta.cleared = { 't1-n1': 3, 't1-n2': 1 };
    s.meta.fleetUnlocked = true;
    s.meta.battles = { total: 9, won: 6, lost: 3 };
    s.settings.battleSpeed = 4;

    const back = fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!;
    expect(back.run.ti.eq(12345)).toBe(true);
    expect(back.run.deut.eq(678)).toBe(true);
    expect(back.run.fleet.ships).toEqual(s.run.fleet.ships);
    expect(back.run.fleet.queue).toEqual(s.run.fleet.queue);
    expect(back.run.fleet.slips).toBe(2);
    expect(back.run.fleet.groups[0]).toEqual(s.run.fleet.groups[0]);
    expect(back.meta.cleared).toEqual({ 't1-n1': 3, 't1-n2': 1 });
    expect(back.meta.fleetUnlocked).toBe(true);
    expect(back.meta.battles).toEqual({ total: 9, won: 6, lost: 3 });
    expect(back.settings.battleSpeed).toBe(4);
    expect(decodeSave(encodeSave(s))!.run.fleet.ships.length).toBe(2);
  });

  it('does not save battles in progress', () => {
    const s = newGameState(0, 1);
    s.run.live[1] = { battle: null, node: 't1-n1', acc: 0, rest: 3, last: null, waiting: null };
    const raw = toRaw(s) as unknown as { run: Record<string, unknown> };
    expect('live' in raw.run).toBe(false);
    expect(fromRaw(JSON.parse(JSON.stringify(raw)))!.run.live).toEqual({});
  });
});

describe('hardened loading', () => {
  it('rejects non-finite amounts and clamps stockpiles to their caps', () => {
    const raw = JSON.parse(JSON.stringify(toRaw(newGameState(0, 1))));
    raw.run.rp = 'Infinity';
    raw.run.ti = '5e9';
    raw.run.deut = '1e999999999999999999';
    const s = fromRaw(raw)!;
    expect(s.run.rp.eq(0) || Number.isFinite(s.run.rp.toNumber())).toBe(true);
    expect(s.run.ti.toNumber()).toBe(FLEET.storage.ti);
    expect(s.run.deut.toNumber()).toBeLessThanOrEqual(FLEET.storage.deut);
  });

  it('keeps ship ids clear of the enemy id range and groups within what is unlocked', () => {
    const f = sanitizeFleet({
      groups: [{ id: 1 }, { id: 2 }, { id: 3 }],
      ships: [{ classId: 'frigate', id: 100_000, group: 1 }],
    }, 10, 1);
    expect(f.groups.length).toBe(1);
    expect(f.ships[0].id).toBeLessThan(100_000);
  });

  it('hands back the sortie cost of a battle that is not saved', () => {
    const s = newGameState(0, 1);
    s.run.deut = new Decimal(100);
    s.run.live[1] = { battle: {} as never, node: 't1-n1', acc: 0, rest: 0, last: null, waiting: null, paid: 20 };
    expect(fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!.run.deut.toNumber()).toBe(120);
  });
});

describe('veteran cadre in saves', () => {
  it('round-trips and is clamped to its cap', () => {
    const s = newGameState(0, 1);
    s.meta.cadreXp = 7;
    expect(fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!.meta.cadreXp).toBe(7);
    s.meta.cadreXp = 9999;
    expect(fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!.meta.cadreXp).toBe(FLEET.cadre.cap);
  });
});

describe('migrating a version 1 save', () => {
  const v1 = () => ({
    version: 1,
    startedAt: 10,
    lastSeen: 20,
    seed: 99,
    run: { rp: '1234.5', earned: '9999', owned: { depot: 12, hub: 4 }, elapsed: 600 },
    meta: {
      medals: 3,
      medalsEarned: 7,
      armory: { 'auto-depot': 1 },
      redeploys: 2,
      lastRunSeconds: 4000,
      bestRunSeconds: 3500,
      lifetimeEarned: '5e9',
    },
    settings: { notation: 'scientific', buyMode: 10 },
  });

  it('keeps all progress and starts the new systems empty', () => {
    const s = fromRaw(v1())!;
    expect(s.version).toBe(6);
    expect(s.run.rp.toNumber()).toBeCloseTo(1234.5);
    expect(s.run.owned.depot).toBe(12);
    expect(s.run.owned.hub).toBe(4);
    expect(s.meta.medalsEarned).toBe(7);
    expect(s.meta.armory['auto-depot']).toBe(1);
    expect(s.settings).toEqual({ notation: 'scientific', buyMode: 10, battleSpeed: 1, ...DISPLAY_DEFAULTS });
    expect(s.run.ti.eq(0)).toBe(true);
    expect(s.run.deut.eq(0)).toBe(true);
    expect(s.run.fleet.ships).toEqual([]);
    expect(s.run.fleet.groups.length).toBe(1);
    expect(s.run.owned.outpost).toBe(0);
    expect(s.meta.cleared).toEqual({});
    expect(s.meta.fleetUnlocked).toBe(false);
  });

  it('migrates through the step table', () => {
    const out = migrate(v1())!;
    expect(out.version).toBe(CURRENT_VERSION);
    expect((out.run as Record<string, unknown>).ti).toBe('0');
    expect((out.meta as Record<string, unknown>).cleared).toEqual({});
  });

  it('tolerates a v1 save with missing sections', () => {
    const s = fromRaw({ version: 1, run: {}, meta: {} });
    expect(s).not.toBeNull();
    expect(s!.run.fleet.groups.length).toBe(1);
  });
});

describe('repairing a damaged fleet', () => {
  it('drops unknown classes, fixes bad gear, rows and groups', () => {
    const fleet = sanitizeFleet({
      groups: [{ id: 1 }],
      ships: [
        { id: 1, classId: 'warthog-of-doom', group: 1 },
        { id: 2, classId: 'frigate', group: 1, row: 'sideways', hull: 7, weapons: ['mac', 'pd'], defence: ['mac'], utility: ['x'] },
        { id: 3, classId: 'frigate', group: 42, hull: -2, xp: -5 },
      ],
    });
    expect(fleet.ships.map((s) => s.id)).toEqual([2, 3]);
    const [a, b] = fleet.ships;
    expect(a.row).toBe('line');
    expect(a.hull).toBe(1);
    expect(a.weapons).toEqual(['mac', 'archer']); // 'pd' is not a weapon, so the default for slot 2 returns
    expect(a.defence).toEqual(['pd']);
    expect(a.utility).toEqual([]);
    expect(b.group).toBe(0); // group 42 does not exist
    expect(b.hull).toBe(0);
    expect(b.xp).toBe(0);
  });

  it('reassigns duplicate ship ids and keeps the counter ahead of them', () => {
    const fleet = sanitizeFleet({
      groups: [{ id: 1 }],
      ships: [
        { id: 5, classId: 'frigate', group: 1 },
        { id: 5, classId: 'frigate', group: 1 },
        { classId: 'frigate', group: 1 },
      ],
    });
    const ids = fleet.ships.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(fleet.nextShipId).toBeGreaterThan(Math.max(...ids));
  });

  it('moves ships beyond a group\'s Command capacity back to the hangar', () => {
    const ships = Array.from({ length: FLEET.commandCapacity + 3 }, (_, i) => ({ id: i + 1, classId: 'frigate', group: 1 }));
    const fleet = sanitizeFleet({ groups: [{ id: 1 }], ships });
    expect(fleet.ships.filter((s) => s.group === 1).length).toBe(FLEET.commandCapacity);
    expect(fleet.ships.filter((s) => s.group === 0).length).toBe(3);
  });

  it('clamps the queue, slips and group settings', () => {
    const fleet = sanitizeFleet({
      groups: [{ id: 1, order: 'nap', stance: 'x', priority: 'y', minIntegrity: 9, patrolNode: 'nowhere', failStreak: -3, name: '   ' }],
      queue: [
        { classId: 'frigate', remaining: 999, total: 120 },
        { classId: 'ghost', remaining: 1, total: 1 },
        ...Array.from({ length: 20 }, () => ({ classId: 'frigate', remaining: 10, total: 120 })),
      ],
      slips: 99,
    });
    const g = fleet.groups[0];
    expect(g.order).toBe('campaign');
    expect(g.stance).toBe('standard');
    expect(g.priority).toBe('weakest');
    expect(g.minIntegrity).toBe(1);
    expect(g.patrolNode).toBeNull();
    expect(g.failStreak).toBe(0);
    expect(g.name).toBe('Strike Group 1');
    expect(fleet.queue.length).toBe(FLEET.queueLimit);
    expect(fleet.queue[0].remaining).toBe(120);
    expect(fleet.slips).toBe(FLEET.slips.base + FLEET.slips.costs.length);
  });

  it('always leaves at least one group, and survives non-object input', () => {
    expect(sanitizeFleet(null).groups.length).toBe(1);
    expect(sanitizeFleet('banana').ships).toEqual([]);
    expect(sanitizeFleet({ groups: [] }).groups.length).toBe(1);
  });

  it('drops unknown campaign nodes from a save', () => {
    const raw = toRaw(newGameState(0, 1)) as unknown as { meta: { cleared: Record<string, number> } };
    raw.meta.cleared = { 't1-n1': 2, 'moon-base': 5, 't1-n2': -1 };
    expect(fromRaw(raw)!.meta.cleared).toEqual({ 't1-n1': 2 });
  });
});
