import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { ECONOMY } from '../src/data';
import { buyArmory, canBuyArmory, nextArmoryCost, offlineCapSeconds } from '../src/sim/armory';
import { globalMultiplier } from '../src/sim/economy';
import { canRedeploy, multiplierAfter, redeploy, redeployGain, remainingToTrigger } from '../src/sim/prestige';
import { ARMORY_BY_ID } from '../src/data';
import { newGameState } from '../src/state/serialize';

const { trigger, scale } = ECONOMY.prestige;
const fresh = () => newGameState(0, 1);

describe('Redeploy', () => {
  it('pays nothing below the trigger', () => {
    const s = fresh();
    s.run.earned = D(trigger / 2);
    expect(redeployGain(s)).toBe(0);
    expect(canRedeploy(s)).toBe(false);
    expect(redeploy(s)).toBeNull();
  });

  it('pays floor(sqrt(earned / scale)) Medals', () => {
    const s = fresh();
    for (const mult of [1, 1.5, 4, 25, 100]) {
      s.run.earned = D(trigger * mult);
      expect(redeployGain(s)).toBe(Math.floor(Math.sqrt((trigger * mult) / scale)));
    }
  });

  it('pays at least one Medal at the trigger and twice as many for four times the earnings', () => {
    const s = fresh();
    s.run.earned = D(trigger);
    const atTrigger = redeployGain(s);
    expect(atTrigger).toBeGreaterThanOrEqual(1);
    s.run.earned = D(trigger * 4);
    expect(Math.abs(redeployGain(s) - 2 * atTrigger)).toBeLessThanOrEqual(1);
  });

  it('shows what is left to earn', () => {
    const s = fresh();
    s.run.earned = D(trigger / 4);
    expect(remainingToTrigger(s).toNumber()).toBeCloseTo(trigger * 0.75, 0);
    s.run.earned = D(trigger * 2);
    expect(remainingToTrigger(s).toNumber()).toBe(0);
  });

  it('resets the run and keeps the meta layer', () => {
    const s = fresh();
    s.run.earned = D(trigger * 4);
    const expected = redeployGain(s);
    s.run.rp = D(12345);
    s.run.owned.depot = 80;
    s.run.owned.command = 3;
    s.run.elapsed = 4000;
    s.meta.lifetimeEarned = D(5e9);
    s.meta.armory['auto-depot'] = 1;
    s.settings.notation = 'scientific';

    const report = redeploy(s)!;
    expect(report.gain).toBe(expected);
    expect(report.runSeconds).toBe(4000);

    expect(s.run.owned.depot).toBe(0);
    expect(s.run.owned.command).toBe(0);
    expect(s.run.rp.toNumber()).toBe(ECONOMY.startingRp);
    expect(s.run.earned.toNumber()).toBe(0);
    expect(s.run.elapsed).toBe(0);

    expect(s.meta.medals).toBe(expected);
    expect(s.meta.medalsEarned).toBe(expected);
    expect(s.meta.redeploys).toBe(1);
    expect(s.meta.lastRunSeconds).toBe(4000);
    expect(s.meta.bestRunSeconds).toBe(4000);
    expect(s.meta.armory['auto-depot']).toBe(1);
    expect(s.meta.lifetimeEarned.toNumber()).toBe(5e9);
    expect(s.settings.notation).toBe('scientific');
  });

  it('raises the production multiplier by the Medal bonus per Medal', () => {
    const s = fresh();
    const bonus = ECONOMY.prestige.medalBonus;
    s.run.earned = D(trigger);
    const gain = redeployGain(s);
    expect(globalMultiplier(s)).toBe(1);
    expect(multiplierAfter(s, 5)).toBeCloseTo(1 + 5 * bonus, 9);
    redeploy(s);
    expect(globalMultiplier(s)).toBeCloseTo(1 + gain * bonus, 9);
  });

  it('tracks the fastest run', () => {
    const s = fresh();
    s.run.earned = D(trigger);
    s.run.elapsed = 5000;
    redeploy(s);
    s.run.earned = D(trigger);
    s.run.elapsed = 3000;
    redeploy(s);
    s.run.earned = D(trigger);
    s.run.elapsed = 9000;
    redeploy(s);
    expect(s.meta.bestRunSeconds).toBe(3000);
    expect(s.meta.lastRunSeconds).toBe(9000);
  });

  it('spending Medals never lowers the bonus', () => {
    const s = fresh();
    s.run.earned = D(trigger * 4);
    redeploy(s);
    const before = globalMultiplier(s);
    expect(buyArmory(s, 'auto-depot')).toBe(true);
    expect(globalMultiplier(s)).toBe(before);
  });
});

describe('Armory', () => {
  it('charges Medals and levels the item up', () => {
    const s = fresh();
    s.meta.medals = 5;
    const def = ARMORY_BY_ID['forward-depots'];
    expect(nextArmoryCost(s.meta, def)).toBe(3);
    expect(buyArmory(s, 'forward-depots')).toBe(true);
    expect(s.meta.medals).toBe(2);
    expect(s.meta.armory['forward-depots']).toBe(1);
    expect(nextArmoryCost(s.meta, def)).toBe(8);
    expect(canBuyArmory(s.meta, def)).toBe(false);
    expect(buyArmory(s, 'forward-depots')).toBe(false);
  });

  it('stops at the maximum level', () => {
    const s = fresh();
    s.meta.medals = 1e6;
    const def = ARMORY_BY_ID['auto-depot'];
    expect(buyArmory(s, 'auto-depot')).toBe(true);
    expect(nextArmoryCost(s.meta, def)).toBeNull();
    expect(buyArmory(s, 'auto-depot')).toBe(false);
  });

  it('forward depots start the next run with buildings already standing', () => {
    const s = fresh();
    s.meta.medals = 10;
    buyArmory(s, 'forward-depots');
    s.run.earned = D(trigger);
    redeploy(s);
    expect(s.run.owned.depot).toBe(5);
  });

  it('extended rotations stack onto the base offline cap', () => {
    const s = fresh();
    s.meta.medals = 100;
    expect(offlineCapSeconds(s.meta)).toBe(ECONOMY.offline.baseCapHours * 3600);
    buyArmory(s, 'extended-rotations');
    buyArmory(s, 'extended-rotations');
    expect(offlineCapSeconds(s.meta)).toBe((ECONOMY.offline.baseCapHours + 8) * 3600);
  });
});
