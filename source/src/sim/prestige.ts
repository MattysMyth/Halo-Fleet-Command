import { Decimal, ZERO } from '../core/numbers';
import { ECONOMY } from '../data';
import { freshRun } from '../state/serialize';
import type { GameState } from '../state/types';
import { globalMultiplier } from './economy';
import { updateCadre } from './fleet';

/** Service Medals a Redeploy would pay right now: floor(sqrt(earned / scale)), or 0 below the trigger. */
export function redeployGain(state: GameState): number {
  const { trigger, scale } = ECONOMY.prestige;
  if (state.run.earned.lt(trigger)) return 0;
  return Math.floor(Decimal.sqrt(state.run.earned.div(scale)).toNumber());
}

export function canRedeploy(state: GameState): boolean {
  return redeployGain(state) >= 1;
}

/** Requisition still to earn before Redeploy unlocks (zero once the trigger is met). */
export function remainingToTrigger(state: GameState): Decimal {
  const left = new Decimal(ECONOMY.prestige.trigger).sub(state.run.earned);
  return left.lt(0) ? ZERO : left;
}

/** The production multiplier you would have after a Redeploy that pays `gain` Medals. */
export function multiplierAfter(state: GameState, gain: number): number {
  return 1 + ECONOMY.prestige.medalBonus * (state.meta.medalsEarned + gain);
}

export interface RedeployReport {
  gain: number;
  runSeconds: number;
  earned: Decimal;
  multiplierBefore: number;
  multiplierAfter: number;
}

/**
 * Redeploy: bank Service Medals and start a fresh run. Buildings, requisition and the run clock
 * reset. Medals, the Armory, settings and lifetime totals stay.
 */
export function redeploy(state: GameState): RedeployReport | null {
  const gain = redeployGain(state);
  if (gain < 1) return null;

  const report: RedeployReport = {
    gain,
    runSeconds: state.run.elapsed,
    earned: state.run.earned,
    multiplierBefore: globalMultiplier(state),
    multiplierAfter: multiplierAfter(state, gain),
  };

  updateCadre(state);
  state.meta.medals += gain;
  state.meta.medalsEarned += gain;
  state.meta.redeploys += 1;
  state.meta.lastRunSeconds = state.run.elapsed;
  state.meta.bestRunSeconds =
    state.meta.bestRunSeconds === null ? state.run.elapsed : Math.min(state.meta.bestRunSeconds, state.run.elapsed);
  state.run = freshRun(state.meta);
  return report;
}
