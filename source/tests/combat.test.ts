import { describe, expect, it } from 'vitest';
import { COMBAT, FLEET } from '../src/data';
import type { WeaponStats } from '../src/data';
import {
  activate,
  applyHit,
  autoAbilities,
  createBattle,
  integrity,
  runBattle,
  stepBattle,
} from '../src/sim/combat';
import type { BattleSetup, Battle, UnitSetup } from '../src/sim/combat';

let nextId = 1;

const gun = (over: Partial<WeaponStats> = {}): WeaponStats => ({
  id: 'gun',
  name: 'Gun',
  type: 'kinetic',
  reach: 'long',
  shots: 1,
  damage: 100,
  cooldown: 1,
  pen: 0,
  accuracy: 1,
  ...over,
});

function unit(side: 'player' | 'enemy', over: Partial<UnitSetup> = {}): UnitSetup {
  return {
    id: nextId++,
    side,
    name: `${side} ${nextId}`,
    defId: 'test',
    row: 'line',
    command: 1,
    hull: 1000,
    maxHull: 1000,
    shield: 0,
    maxShield: 0,
    armour: 0,
    speed: 1,
    damageMult: 1,
    weapons: [gun()],
    pd: 0,
    prefer: 'long',
    ...over,
  };
}

const setup = (player: UnitSetup[], enemy: UnitSetup[], over: Partial<BattleSetup> = {}): BattleSetup => ({
  player,
  enemy,
  stance: 'standard',
  priority: 'weakest',
  seed: 7,
  ...over,
});

const stepN = (b: Battle, n: number): void => {
  for (let i = 0; i < n; i++) stepBattle(b);
};

/** A battle where nothing fires, so a test can drive a single weapon by hand. */
const quiet = (player: UnitSetup[], enemy: UnitSetup[], over: Partial<BattleSetup> = {}): Battle => {
  const b = createBattle(setup(player, enemy, over));
  for (const u of b.units) for (const w of u.weapons) w.cd = 0;
  return b;
};

describe('damage model', () => {
  const target = () => ({ shield: 100, hull: 500, armour: 0, lastHit: 0 });

  it('scales shield damage by damage type', () => {
    for (const [type, k] of [['kinetic', 0.6], ['explosive', 1], ['energy', 1.5]] as const) {
      const t = target();
      const r = applyHit(t, 40, type, 0, false, 1);
      expect(r.shield).toBeCloseTo(40 * k);
      expect(t.shield).toBeCloseTo(100 - 40 * k);
      expect(t.hull).toBe(500);
    }
  });

  it('carries leftover damage to the hull once shields fall', () => {
    const t = { shield: 30, hull: 500, armour: 0, lastHit: 0 };
    const r = applyHit(t, 40, 'energy', 0, false, 1); // 60 scaled, 30 absorbed, 30 / 1.5 = 20 left over
    expect(r.shield).toBe(30);
    expect(r.hull).toBeCloseTo(20);
    expect(t.shield).toBe(0);
    expect(t.hull).toBeCloseTo(480);
  });

  it('trims hull damage by armour unless the weapon penetrates', () => {
    const hit = (armour: number, pen: number): number => {
      const t = { shield: 0, hull: 1000, armour, lastHit: 0 };
      applyHit(t, 100, 'kinetic', pen, false, 1);
      return 1000 - t.hull;
    };
    expect(hit(50, 0)).toBeCloseTo(50);
    expect(hit(50, 0.6)).toBeCloseTo(80);
    expect(hit(50, 1)).toBeCloseTo(100);
  });

  it('never lets armour cut a hit below the minimum share', () => {
    const t = { shield: 0, hull: 1000, armour: 500, lastHit: 0 };
    applyHit(t, 10, 'kinetic', 0, false, 1);
    expect(1000 - t.hull).toBeCloseTo(10 * COMBAT.minHullShare);
  });

  it('ignores armour when asked to', () => {
    const t = { shield: 0, hull: 1000, armour: 80, lastHit: 0 };
    applyHit(t, 100, 'kinetic', 0, true, 1);
    expect(1000 - t.hull).toBeCloseTo(100);
  });
});

describe('battles', () => {
  const strongSide = (side: 'player' | 'enemy', n: number) =>
    Array.from({ length: n }, () => unit(side, { hull: 800, maxHull: 800, weapons: [gun({ damage: 60 })] }));

  it('is deterministic for a given seed', () => {
    const make = () => setup(strongSide('player', 4), strongSide('enemy', 4).map((u, i) => ({ ...u, id: 100 + i })));
    const a = runBattle(make());
    const b = runBattle({ ...make(), player: make().player.map((u, i) => ({ ...u, id: a.player[i].id })) });
    expect(a.outcome).toBe(b.outcome);
    expect(a.seconds).toBe(b.seconds);
    expect(a.player.map((u) => u.hull)).toEqual(b.player.map((u) => u.hull));
  });

  it('changes with the seed', () => {
    const seconds = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const p = [unit('player', { weapons: [gun({ accuracy: 0.5, damage: 40 })] })];
      const e = [unit('enemy', { weapons: [gun({ accuracy: 0.5, damage: 40 })] })];
      seconds.add(runBattle(setup(p, e, { seed })).seconds);
    }
    expect(seconds.size).toBeGreaterThan(1);
  });

  it('lets a much stronger fleet win and a much weaker one lose', () => {
    const big = Array.from({ length: 8 }, () => unit('player', { weapons: [gun({ damage: 80 })] }));
    const small = [unit('enemy', { hull: 300, maxHull: 300 }), unit('enemy', { hull: 300, maxHull: 300 })];
    expect(runBattle(setup(big, small)).outcome).toBe('victory');

    const few = [unit('player', { hull: 300, maxHull: 300 }), unit('player', { hull: 300, maxHull: 300 })];
    const many = Array.from({ length: 8 }, () => unit('enemy', { weapons: [gun({ damage: 80 })] }));
    expect(runBattle(setup(few, many)).outcome).toBe('defeat');
  });

  it('breaks a fleet once it has lost half its Command value', () => {
    const p = Array.from({ length: 4 }, () => unit('player'));
    const e = [unit('enemy')];
    const b = quiet(p, e);
    for (const u of b.units) u.weapons = [];
    b.units.filter((u) => u.side === 'player').slice(0, 1).forEach((u) => (u.hull = 0));
    stepBattle(b);
    expect(b.outcome).toBeNull(); // 3 of 4 left
    b.units.filter((u) => u.side === 'player' && u.alive).slice(0, 1).forEach((u) => (u.hull = 0));
    stepBattle(b);
    expect(integrity(b, 'player')).toBe(0.5);
    expect(b.outcome).toBe('defeat');
  });

  it('weighs Command value, not ship count, when breaking', () => {
    const heavy = unit('player', { command: 6 });
    const light = [unit('player'), unit('player')];
    const b = quiet([heavy, ...light], [unit('enemy')]);
    for (const u of b.units) u.weapons = [];
    b.units[0].hull = 0; // lose 6 of 8 Command
    stepBattle(b);
    expect(b.outcome).toBe('defeat');
  });

  it('calls it a draw when neither side can finish the other', () => {
    const p = [unit('player', { weapons: [gun({ damage: 1 })], speed: 2 })];
    const e = [unit('enemy', { hull: 1e9, maxHull: 1e9, weapons: [gun({ damage: 1 })] })];
    const r = runBattle(setup(p, e));
    expect(r.outcome).toBe('draw');
    expect(r.seconds).toBeGreaterThanOrEqual(COMBAT.maxSeconds);
  });

  it('counts a mutual break by who is worse off', () => {
    const b = quiet([unit('player'), unit('player')], [unit('enemy'), unit('enemy'), unit('enemy')]);
    for (const u of b.units) u.weapons = [];
    b.units.filter((u) => u.side === 'player').slice(0, 1).forEach((u) => (u.hull = 0)); // player 50%
    b.units.filter((u) => u.side === 'enemy').slice(0, 2).forEach((u) => (u.hull = 0)); // enemy 33%
    stepBattle(b);
    expect(b.outcome).toBe('victory');
  });
});

describe('range', () => {
  it('lets the faster fleet choose the band', () => {
    const fast = (stance: BattleSetup['stance']) => {
      const b = createBattle(setup([unit('player', { speed: 2, weapons: [] })], [unit('enemy', { speed: 1, prefer: 'close', weapons: [] })], { stance }));
      stepN(b, 40); // 20 s, enough for two band shifts
      return b;
    };
    expect(fast('standoff').band).toBe(2);
    expect(fast('closein').band).toBe(0);
    expect(fast('standard').band).toBe(1);
    expect(fast('closein').control).toBe('player');
  });

  it('lets a faster enemy close the range whatever the stance', () => {
    const b = createBattle(setup([unit('player', { speed: 1, weapons: [] })], [unit('enemy', { speed: 1.5, prefer: 'close', weapons: [] })], { stance: 'standoff' }));
    stepN(b, 40);
    expect(b.control).toBe('enemy');
    expect(b.band).toBe(0);
  });

  it('shifts one band at a time, not instantly', () => {
    const b = createBattle(setup([unit('player', { speed: 2, weapons: [] })], [unit('enemy', { weapons: [] })], { stance: 'closein' }));
    stepN(b, 10); // 5 s
    expect(b.band).toBe(2);
    stepN(b, 4); // past 6 s
    expect(b.band).toBe(1);
  });

  it('only fires weapons that reach the current band', () => {
    const b = quiet([unit('player', { weapons: [gun({ reach: 'close' })] })], [unit('enemy', { weapons: [] })]);
    stepN(b, 6);
    expect(b.recent.length).toBe(0); // long range: a close weapon cannot reach
    b.band = 0;
    stepN(b, 2);
    expect(b.recent.length).toBeGreaterThan(0);
  });

  it('lets long-range weapons fire at any band', () => {
    for (const band of [0, 1, 2]) {
      const b = quiet([unit('player', { weapons: [gun({ reach: 'long' })] })], [unit('enemy', { weapons: [] })]);
      b.band = band;
      b.targetBand = band;
      stepBattle(b);
      expect(b.salvos.length).toBeGreaterThan(0);
    }
  });
});

describe('targeting', () => {
  it('draws enemy fire 3 : 2 : 1 by row', () => {
    const p = [
      unit('player', { row: 'front', hull: 1e9, maxHull: 1e9, weapons: [] }),
      unit('player', { row: 'line', hull: 1e9, maxHull: 1e9, weapons: [] }),
      unit('player', { row: 'rear', hull: 1e9, maxHull: 1e9, weapons: [] }),
    ];
    const e = [unit('enemy', { hull: 1e9, maxHull: 1e9, weapons: [gun({ cooldown: 0.5, damage: 1 })] })];
    const hits = new Map<number, number>();
    for (let seed = 1; seed <= 8; seed++) {
      const b = createBattle(setup(p, e, { seed }));
      while (!b.outcome) {
        stepBattle(b);
        for (const s of b.salvos) hits.set(s.to, (hits.get(s.to) ?? 0) + 1);
      }
    }
    const [f, l, r] = p.map((u) => hits.get(u.id) ?? 0);
    const total = f + l + r;
    expect(total).toBeGreaterThan(3000);
    expect(f / total).toBeGreaterThan(0.45);
    expect(f / total).toBeLessThan(0.55);
    expect(l / total).toBeGreaterThan(0.28);
    expect(l / total).toBeLessThan(0.38);
    expect(r / total).toBeGreaterThan(0.12);
    expect(r / total).toBeLessThan(0.22);
    expect(FLEET.rowWeights).toEqual({ front: 3, line: 2, rear: 1 });
  });

  const foes = () => [
    unit('enemy', { hull: 300, maxHull: 300, weapons: [] }),
    unit('enemy', { hull: 900, maxHull: 900, weapons: [] }),
    unit('enemy', { hull: 600, maxHull: 600, shield: 500, maxShield: 500, weapons: [] }),
  ];
  const firstTarget = (priority: BattleSetup['priority'], e: UnitSetup[]): number => {
    const b = quiet([unit('player')], e, { priority });
    stepBattle(b);
    return b.salvos[0].to;
  };

  it('follows the priority setting', () => {
    const e = foes();
    expect(firstTarget('weakest', e)).toBe(e[0].id);
    expect(firstTarget('strongest', foes())).toBeDefined();
    const e2 = foes();
    expect(firstTarget('strongest', e2)).toBe(e2[2].id); // 600 hull + 500 shield beats 900 hull
    const e3 = foes();
    expect(firstTarget('shields', e3)).toBe(e3[2].id); // the only shielded foe is stripped first
    const e4 = [unit('enemy', { hull: 300, maxHull: 300, weapons: [] }), unit('enemy', { hull: 900, maxHull: 900, weapons: [] })];
    expect(firstTarget('shields', e4)).toBe(e4[0].id); // nothing shielded: weakest
  });

  it('puts Focus Fire on the chosen target', () => {
    const e = foes();
    const b = quiet([unit('player')], e);
    expect(activate(b, 'focus', e[1].id)).toBe(true);
    stepBattle(b);
    expect(b.salvos[0].to).toBe(e[1].id);
  });
});

describe('point defence', () => {
  const stopRate = (pdOnTarget: number, pdElsewhere: number): number => {
    const missile = gun({ shots: 6, missile: true, accuracy: 1, cooldown: 0.5, damage: 1 });
    const target = unit('enemy', { hull: 1e9, maxHull: 1e9, weapons: [], pd: pdOnTarget });
    const e = [target, unit('enemy', { hull: 1e9, maxHull: 1e9, weapons: [], pd: pdElsewhere })];
    const b = createBattle(setup([unit('player', { weapons: [missile] })], e, { priority: 'weakest' }));
    let stopped = 0;
    let fired = 0;
    for (let i = 0; i < 600; i++) {
      stepBattle(b);
      for (const s of b.salvos) if (s.to === target.id) { stopped += s.stopped; fired += s.shots; }
    }
    return fired === 0 ? 0 : stopped / fired;
  };

  it('stops about 40% of missiles per slot on the target', () => {
    expect(stopRate(1, 0)).toBeGreaterThan(0.3);
    expect(stopRate(1, 0)).toBeLessThan(0.5);
    const three = stopRate(3, 0); // 1 - 0.6^3 = 0.78
    expect(three).toBeGreaterThan(0.7);
    expect(three).toBeLessThan(0.86);
  });

  it('covers neighbours at reduced strength and does nothing without it', () => {
    const covered = stopRate(0, 2); // half strength of two slots: 1 - 0.6^1 = 0.4
    expect(covered).toBeGreaterThan(0.3);
    expect(covered).toBeLessThan(0.5);
    expect(stopRate(0, 0)).toBe(0);
  });

  it('never stops non-missile shots', () => {
    const target = unit('enemy', { hull: 1e9, maxHull: 1e9, weapons: [], pd: 4 });
    const b = createBattle(setup([unit('player', { weapons: [gun({ shots: 6, accuracy: 1, cooldown: 0.5 })] })], [target]));
    stepN(b, 40);
    expect(b.recent.every((s) => s.stopped === 0)).toBe(true);
    expect(b.recent.length).toBeGreaterThan(0);
  });
});

describe('shields', () => {
  it('recharge after a quiet spell and not before', () => {
    const e = unit('enemy', { shield: 100, maxShield: 100, regen: { delay: 5, rate: 0.1 }, weapons: [] });
    const b = createBattle(setup([unit('player', { weapons: [] })], [e]));
    const t = b.units.find((u) => u.id === e.id);
    if (!t) throw new Error('missing unit');
    t.shield = 20;
    t.lastHit = 0;
    stepN(b, 8); // 4 s: inside the delay
    expect(t.shield).toBe(20);
    stepN(b, 10); // 9 s: 4 s past the delay
    expect(t.shield).toBeGreaterThan(20);
    expect(t.shield).toBeLessThanOrEqual(100);
  });
});

describe('abilities', () => {
  const dummy = () => unit('enemy', { hull: 1e6, maxHull: 1e6, armour: 40, weapons: [] });

  it('Focus Fire adds 25% damage to the target and then runs out', () => {
    const t = { ...dummy(), armour: 0 };
    const b = quiet([unit('player', { weapons: [gun({ damage: 100, cooldown: 1 })] })], [t]);
    stepBattle(b);
    const base = b.salvos[0].hull;
    expect(activate(b, 'focus', t.id)).toBe(true);
    stepBattle(b);
    stepBattle(b); // second tick lets the 1 s cooldown elapse
    const boosted = b.recent.at(-1)?.hull ?? 0;
    expect(boosted).toBeCloseTo(base * 1.25, 5);
    stepN(b, 24); // 12 s later the 10 s window is over
    expect(b.recent.at(-1)?.hull).toBeCloseTo(base, 5);
  });

  it('Evasive Pattern cuts damage taken by 30%', () => {
    const target = unit('player', { hull: 1e6, maxHull: 1e6, weapons: [] });
    const shooter = unit('enemy', { weapons: [gun({ damage: 100, cooldown: 1 })] });
    const b = quiet([target], [shooter]);
    stepBattle(b);
    const base = b.salvos[0].hull;
    expect(activate(b, 'evasive')).toBe(true);
    stepN(b, 2);
    expect(b.recent.at(-1)?.hull).toBeCloseTo(base * 0.7, 5);
  });

  it('MAC Overcharge doubles the next MAC volley and ignores armour', () => {
    const t = dummy(); // armour 40
    const mac = gun({ damage: 100, cooldown: 2, mac: true });
    const b = quiet([unit('player', { weapons: [mac] })], [t]);
    stepBattle(b);
    expect(b.salvos[0].hull).toBeCloseTo(60); // 100 - 40
    stepN(b, 4); // let it come off cooldown again
    expect(activate(b, 'overcharge')).toBe(true);
    stepN(b, 4);
    const charged = b.recent.find((s) => s.hull > 100);
    expect(charged?.hull).toBeCloseTo(200);
    stepN(b, 6);
    expect(b.recent.at(-1)?.hull).toBeCloseTo(60); // back to normal after one volley
  });

  it('refuses Overcharge with no MAC aboard', () => {
    const b = quiet([unit('player', { weapons: [gun({ mac: false })] })], [dummy()]);
    expect(activate(b, 'overcharge')).toBe(false);
  });

  it('enforces cooldowns', () => {
    const t = dummy();
    const b = quiet([unit('player')], [t]);
    expect(activate(b, 'evasive')).toBe(true);
    expect(activate(b, 'evasive')).toBe(false);
    stepN(b, Math.ceil(COMBAT.abilities.evasive.cooldown / COMBAT.tick) + 1);
    expect(activate(b, 'evasive')).toBe(true);
  });

  it('rejects Focus Fire on a bad target', () => {
    const b = quiet([unit('player')], [dummy()]);
    expect(activate(b, 'focus', 99999)).toBe(false);
    expect(activate(b, 'focus', b.units[0].id)).toBe(false); // a friendly ship
  });

  it('Slipspace Retreat ends the battle', () => {
    const b = quiet([unit('player')], [dummy()]);
    expect(activate(b, 'retreat')).toBe(true);
    expect(b.outcome).toBe('retreat');
    stepBattle(b); // does nothing
    expect(b.ticks).toBe(0);
  });

  it('lets an automatic commander use abilities without ever retreating', () => {
    const b = quiet([unit('player', { weapons: [gun({ mac: true })] })], [dummy()]);
    const picks = autoAbilities(b);
    expect(picks.some((p) => p.id === 'focus')).toBe(true);
    expect(picks.some((p) => p.id === 'retreat')).toBe(false);
  });
});

describe('abilities in whole battles', () => {
  it('help: an even fight is won more often with an automatic commander', () => {
    const wins = (abilities: boolean): number => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const p = Array.from({ length: 4 }, () => unit('player', { hull: 700, maxHull: 700, weapons: [gun({ damage: 60, mac: true, cooldown: 4, accuracy: 0.8 })] }));
        const e = Array.from({ length: 4 }, () => unit('enemy', { hull: 1400, maxHull: 1400, weapons: [gun({ damage: 60, cooldown: 4, accuracy: 0.8 })] }));
        if (runBattle(setup(p, e, { seed }), { abilities }).outcome === 'victory') n += 1;
      }
      return n;
    };
    const without = wins(false);
    const withAbilities = wins(true);
    expect(without).toBeGreaterThan(0); // not a foregone conclusion either way
    expect(withAbilities).toBeGreaterThan(without + 10);
  });
});
