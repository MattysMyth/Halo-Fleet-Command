import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { BUILDINGS, FLEET } from '../src/data';
import { advance, applyOffline, isUnlocked, productionByResource, productionPerSecond, step } from '../src/sim/economy';
import { newGameState } from '../src/state/serialize';

const fresh = () => newGameState(0, 1);

describe('titanium and deuterium buildings', () => {
  it('produce their own resource and leave Requisition alone', () => {
    const s = fresh();
    s.run.owned.outpost = 4;
    s.run.owned.harvester = 10;
    expect(productionPerSecond(s).eq(0)).toBe(true);
    const rates = productionByResource(s);
    expect(rates.ti.toNumber()).toBeCloseTo(4 * 0.25);
    expect(rates.deut.toNumber()).toBeCloseTo(10 * 0.06);
    step(s, 10);
    expect(s.run.ti.toNumber()).toBeCloseTo(10);
    expect(s.run.deut.toNumber()).toBeCloseTo(6);
    expect(s.run.rp.toNumber()).toBe(15); // starting Requisition untouched
  });

  it('unlock behind logistics hubs and their own first tier', () => {
    const s = fresh();
    const outpost = BUILDINGS.find((b) => b.id === 'outpost')!;
    const mine = BUILDINGS.find((b) => b.id === 'mine')!;
    const harvester = BUILDINGS.find((b) => b.id === 'harvester')!;
    expect(isUnlocked(s, outpost)).toBe(false);
    s.run.owned.hub = 2;
    expect(isUnlocked(s, outpost)).toBe(true);
    expect(isUnlocked(s, harvester)).toBe(false);
    s.run.owned.hub = 3;
    expect(isUnlocked(s, harvester)).toBe(true);
    expect(isUnlocked(s, mine)).toBe(false);
    s.run.owned.outpost = 5;
    expect(isUnlocked(s, mine)).toBe(true);
  });

  it('scale with Medals and cleared sectors, like Requisition does', () => {
    const s = fresh();
    s.run.owned.outpost = 4;
    s.meta.medalsEarned = 10; // x1.5
    s.meta.cleared = { 't1-n1': 1, 't1-n2': 1 }; // x1.06
    expect(productionByResource(s).ti.toNumber()).toBeCloseTo(4 * 0.25 * 1.5 * 1.06);
  });

  it('are capped by storage', () => {
    const s = fresh();
    s.run.owned.outpost = 100;
    s.run.owned.harvester = 100;
    step(s, 1e7);
    expect(s.run.ti.toNumber()).toBe(FLEET.storage.ti);
    expect(s.run.deut.toNumber()).toBe(FLEET.storage.deut);
    const before = s.run.ti;
    step(s, 100);
    expect(s.run.ti.eq(before)).toBe(true);
  });

  it('fill only the room that is left', () => {
    const s = fresh();
    s.run.owned.outpost = 4;
    s.run.ti = D(FLEET.storage.ti - 3);
    const r = advance(s, 100, 1);
    expect(s.run.ti.toNumber()).toBe(FLEET.storage.ti);
    expect(r.ti.toNumber()).toBeCloseTo(3);
  });
});

describe('advance and offline progress', () => {
  it('report every resource produced', () => {
    const s = fresh();
    s.run.owned.depot = 10;
    s.run.owned.outpost = 8;
    s.run.owned.harvester = 5;
    const r = advance(s, 600, 1);
    expect(r.gained.toNumber()).toBeCloseTo(10 * 0.2 * 600, 0);
    expect(r.ti.toNumber()).toBeCloseTo(8 * 0.25 * 600, 0);
    expect(r.deut.toNumber()).toBeCloseTo(5 * 0.06 * 600, 0);
  });

  it('apply offline efficiency to Titanium and Deuterium too', () => {
    const s = fresh();
    s.run.owned.outpost = 10;
    const report = applyOffline(s, 3600);
    expect(report.efficiency).toBe(0.5);
    expect(report.ti.toNumber()).toBeCloseTo(10 * 0.25 * 3600 * 0.5, 0);
    expect(s.run.ti.toNumber()).toBeCloseTo(report.ti.toNumber(), 3);
  });

  it('keeps the Redeploy trigger counting Requisition only', () => {
    const s = fresh();
    s.run.owned.outpost = 50;
    step(s, 1000);
    expect(s.run.earned.eq(0)).toBe(true);
    expect(s.run.ti.gt(0)).toBe(true);
  });
});
