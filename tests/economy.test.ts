import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { BUILDING_BY_ID, BUILDINGS, ECONOMY } from '../src/data';
import { buyArmory } from '../src/sim/armory';
import {
  advance,
  applyOffline,
  buildingOutput,
  buy,
  buyAmount,
  costOf,
  drive,
  driveYield,
  globalMultiplier,
  isUnlocked,
  maxAffordable,
  milestoneMultiplier,
  nextMilestone,
  productionPerSecond,
  runAutobuyers,
  step,
} from '../src/sim/economy';
import { newGameState } from '../src/state/serialize';

const depot = BUILDING_BY_ID.depot;
const fresh = () => newGameState(0, 1);

describe('cost', () => {
  it('starts at the base cost and grows by the shared rate', () => {
    expect(costOf(depot, 0).toNumber()).toBeCloseTo(10, 9);
    expect(costOf(depot, 1).toNumber()).toBeCloseTo(10 * ECONOMY.growth, 9);
    expect(costOf(depot, 10).toNumber()).toBeCloseTo(10 * ECONOMY.growth ** 10, 6);
  });

  it('bulk cost equals buying one at a time', () => {
    for (const def of BUILDINGS) {
      for (const owned of [0, 3, 40]) {
        let sum = 0;
        for (let i = 0; i < 25; i++) sum += def.baseCost * ECONOMY.growth ** (owned + i);
        expect(costOf(def, owned, 25).toNumber() / sum).toBeCloseTo(1, 9);
      }
    }
  });

  it('maxAffordable matches a brute-force count', () => {
    for (const budget of [5, 10, 11, 100, 1234, 98765, 4.2e7]) {
      for (const owned of [0, 7, 30]) {
        let k = 0;
        let spent = 0;
        while (spent + depot.baseCost * ECONOMY.growth ** (owned + k) <= budget) {
          spent += depot.baseCost * ECONOMY.growth ** (owned + k);
          k += 1;
        }
        expect(maxAffordable(depot, owned, D(budget))).toBe(k);
      }
    }
  });

  it('never claims more than the budget can pay', () => {
    for (let i = 0; i < 200; i++) {
      const budget = D(10 + i * 37.3);
      const k = maxAffordable(depot, i % 17, budget);
      expect(costOf(depot, i % 17, k).lte(budget)).toBe(true);
    }
  });
});

describe('output and milestones', () => {
  it('doubles output at each milestone count', () => {
    expect(milestoneMultiplier(24)).toBe(1);
    expect(milestoneMultiplier(25)).toBe(2);
    expect(milestoneMultiplier(50)).toBe(4);
    expect(milestoneMultiplier(100)).toBe(8);
    expect(milestoneMultiplier(200)).toBe(16);
    expect(milestoneMultiplier(5000)).toBe(16);
  });

  it('reports the next milestone', () => {
    expect(nextMilestone(0)).toBe(25);
    expect(nextMilestone(25)).toBe(50);
    expect(nextMilestone(200)).toBeNull();
  });

  it('sums building output with milestones and the Medal bonus', () => {
    const s = fresh();
    s.run.owned.depot = 25;
    s.run.owned.hub = 2;
    expect(buildingOutput(s, depot).toNumber()).toBeCloseTo(25 * 0.2 * 2, 9);
    expect(productionPerSecond(s).toNumber()).toBeCloseTo(25 * 0.2 * 2 + 2 * 1.5, 9);
    s.meta.medalsEarned = 10;
    const bonus = 1 + 10 * ECONOMY.prestige.medalBonus;
    expect(globalMultiplier(s)).toBeCloseTo(bonus, 9);
    expect(productionPerSecond(s).toNumber()).toBeCloseTo((25 * 0.2 * 2 + 2 * 1.5) * bonus, 9);
  });
});

describe('unlocks and buying', () => {
  it('unlocks a building once the previous tier reaches its count', () => {
    const s = fresh();
    const hub = BUILDING_BY_ID.hub;
    expect(isUnlocked(s, depot)).toBe(true);
    expect(isUnlocked(s, hub)).toBe(false);
    s.run.owned.depot = 5;
    expect(isUnlocked(s, hub)).toBe(true);
  });

  it('keeps a building unlocked once you own one', () => {
    const s = fresh();
    s.run.owned.hub = 1;
    s.run.owned.depot = 0;
    expect(isUnlocked(s, BUILDING_BY_ID.hub)).toBe(true);
  });

  it('spends and counts correctly', () => {
    const s = fresh();
    s.run.rp = D(100);
    expect(buy(s, 'depot', 1)).toBe(1);
    expect(s.run.owned.depot).toBe(1);
    expect(s.run.rp.toNumber()).toBeCloseTo(90, 9);
  });

  it('refuses what you cannot afford or have not unlocked', () => {
    const s = fresh();
    s.run.rp = D(5);
    expect(buy(s, 'depot', 1)).toBe(0);
    s.run.rp = D(1e9);
    expect(buy(s, 'hub', 1)).toBe(0);
    expect(buy(s, 'nonsense', 1)).toBe(0);
    expect(buy(s, 'depot', 0)).toBe(0);
    expect(s.run.rp.toNumber()).toBe(1e9);
  });

  it('computes how many a buy click will purchase in each mode', () => {
    const s = fresh();
    s.run.rp = D(100);
    expect(buyAmount(s, depot, 1)).toBe(1);
    expect(buyAmount(s, depot, 10)).toBe(0);
    expect(buyAmount(s, depot, 'max')).toBe(maxAffordable(depot, 0, D(100)));
    s.run.rp = D(1000);
    expect(buyAmount(s, depot, 10)).toBe(10);
  });
});

describe('time', () => {
  it('step adds production and counts run time', () => {
    const s = fresh();
    s.run.owned.depot = 10;
    const before = s.run.rp;
    step(s, 1);
    expect(s.run.rp.sub(before).toNumber()).toBeCloseTo(2, 9);
    expect(s.run.earned.toNumber()).toBeCloseTo(2, 9);
    expect(s.run.elapsed).toBeCloseTo(1, 9);
  });

  it('spending does not reduce earned', () => {
    const s = fresh();
    s.run.rp = D(100);
    s.run.earned = D(100);
    buy(s, 'depot', 1);
    expect(s.run.earned.toNumber()).toBe(100);
  });

  it('advance equals many small steps when nothing is bought', () => {
    const a = fresh();
    const b = fresh();
    a.run.owned.depot = 30;
    b.run.owned.depot = 30;
    for (let i = 0; i < 6000; i++) step(a, 0.1);
    advance(b, 600);
    expect(b.run.rp.div(a.run.rp).toNumber()).toBeCloseTo(1, 6);
  });

  it('advance scales production by efficiency but not the run clock', () => {
    const s = fresh();
    s.run.owned.depot = 10;
    s.run.rp = D(0);
    const { gained } = advance(s, 100, 0.5);
    expect(gained.toNumber()).toBeCloseTo(100, 6);
    expect(s.run.elapsed).toBeCloseTo(100, 6);
  });

  it('the drive pays a flat amount plus a share of output', () => {
    const s = fresh();
    expect(driveYield(s).toNumber()).toBeCloseTo(1, 9);
    s.run.owned.depot = 100;
    const rate = productionPerSecond(s).toNumber();
    expect(driveYield(s).toNumber()).toBeCloseTo(1 + rate * 0.03, 9);
    const before = s.run.rp;
    drive(s);
    expect(s.run.rp.gt(before)).toBe(true);
    expect(s.run.earned.gt(0)).toBe(true);
  });
});

describe('autobuyers', () => {
  it('buy nothing until the Armory item is owned', () => {
    const s = fresh();
    s.run.rp = D(1e6);
    expect(runAutobuyers(s)).toBe(0);
  });

  it('buy under the spending cap once owned', () => {
    const s = fresh();
    s.meta.medals = 2;
    expect(buyArmory(s, 'auto-depot')).toBe(true);
    s.run.rp = D(1000);
    const bought = runAutobuyers(s);
    expect(bought).toBeGreaterThan(0);
    // The cap is a quarter of stock, so at least three quarters must be left.
    expect(s.run.rp.toNumber()).toBeGreaterThanOrEqual(750 - 1e-6);
  });

  it('skip copies that would not pay for themselves in time', () => {
    const s = fresh();
    s.meta.medals = 2;
    buyArmory(s, 'auto-depot');
    s.run.owned.depot = 60; // a 60th depot costs ~25k for 0.2/s: a 35 hour payback
    s.run.rp = D(1e9);
    expect(runAutobuyers(s)).toBe(0);
    expect(s.run.owned.depot).toBe(60);
  });

  it('run during offline time too', () => {
    const s = fresh();
    s.meta.medals = 2;
    buyArmory(s, 'auto-depot');
    s.run.owned.depot = 1;
    const { bought } = advance(s, 3600);
    expect(bought).toBeGreaterThan(5);
  });
});

describe('offline progress', () => {
  it('applies efficiency and the time cap', () => {
    const s = fresh();
    s.run.owned.depot = 10;
    s.run.rp = D(0);
    const report = applyOffline(s, 20 * 3600);
    expect(report.capSeconds).toBe(8 * 3600);
    expect(report.appliedSeconds).toBe(8 * 3600);
    expect(report.efficiency).toBe(0.5);
    expect(report.gained.toNumber()).toBeCloseTo(2 * 8 * 3600 * 0.5, 3);
  });

  it('gives short absences their full length', () => {
    const s = fresh();
    s.run.owned.depot = 10;
    const report = applyOffline(s, 600);
    expect(report.appliedSeconds).toBe(600);
  });

  it('Armory upgrades raise the cap and efficiency', () => {
    const s = fresh();
    s.meta.medals = 100;
    buyArmory(s, 'extended-rotations');
    buyArmory(s, 'field-logistics');
    s.run.owned.depot = 10;
    const report = applyOffline(s, 100 * 3600);
    expect(report.capSeconds).toBe(12 * 3600);
    expect(report.efficiency).toBeCloseTo(0.6, 9);
  });

  it('is deterministic', () => {
    const a = fresh();
    const b = fresh();
    for (const s of [a, b]) {
      s.run.owned.depot = 50;
      s.run.owned.hub = 10;
      applyOffline(s, 7200);
    }
    expect(a.run.rp.eq(b.run.rp)).toBe(true);
  });

  it('never returns NaN or negative stock', () => {
    const s = fresh();
    const report = applyOffline(s, -50);
    expect(report.appliedSeconds).toBe(0);
    expect(Number.isNaN(s.run.rp.mantissa)).toBe(false);
    expect(s.run.rp.gte(0)).toBe(true);
    expect(report.gained.eq(0)).toBe(true);
  });
});
