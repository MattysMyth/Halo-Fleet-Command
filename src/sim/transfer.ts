/**
 * Transfer: the second prestige layer. Beat a theatre's boss and the war moves on: the campaign
 * resets, Battle Honors are banked, and the next theatre opens. A Transfer is also a Redeploy that
 * costs the Medals and the Armory as well.
 */
import { Decimal } from '../core/numbers';
import { SHIP_BY_ID, THEATRES } from '../data';
import type { TheatreDef } from '../data';
import { freshRun } from '../state/serialize';
import type { GameState } from '../state/types';
import { activeTheatre, theatreCleared } from './campaign';
import { updateCadre } from './fleet';
import { globalMultiplier } from './economy';
import { redeployGain } from './prestige';

export type TransferResult = { ok: true } | { ok: false; reason: string };

/** Why the fleet cannot Transfer yet, or null when it can. */
export function transferProblem(state: GameState): string | null {
  const t = activeTheatre(state.meta);
  const boss = t.nodes[t.nodes.length - 1];
  if (!theatreCleared(state.meta, t)) return `Defeat ${boss.name} first`;
  if (t.transferShip && !state.run.fleet.ships.some((s) => s.classId === t.transferShip)) {
    return `Field a ${SHIP_BY_ID[t.transferShip]?.name ?? t.transferShip} first`;
  }
  return null;
}

export const canTransfer = (state: GameState): boolean => transferProblem(state) === null;

/** Battle Honors a Transfer would pay right now. */
export const transferGain = (state: GameState): number => (canTransfer(state) ? activeTheatre(state.meta).honors : 0);

/** The theatre a Transfer from here opens, or null when it is the last one or already open. */
export function transferOpens(state: GameState): TheatreDef | null {
  const next = THEATRES.find((t) => t.id === state.meta.theatre + 1);
  return next && next.id > state.meta.theatresOpen ? next : null;
}

export interface TransferReport {
  honors: number;
  from: TheatreDef;
  /** The theatre the fleet is now fighting in. */
  to: TheatreDef;
  opened: TheatreDef | null;
  runSeconds: number;
  earned: Decimal;
  /** What the Transfer cost: Medals held, and the Armory levels they bought. */
  medalsLost: number;
  multiplierBefore: number;
}

/** What the Transfer will give up, for the confirmation screen. */
export function transferCost(state: GameState): { medals: number; medalsEarned: number; armory: number; pendingMedals: number } {
  return {
    medals: state.meta.medals,
    medalsEarned: state.meta.medalsEarned,
    armory: Object.values(state.meta.armory).reduce((a, b) => a + b, 0),
    pendingMedals: redeployGain(state),
  };
}

export function transfer(state: GameState): TransferReport | null {
  if (!canTransfer(state)) return null;
  const from = activeTheatre(state.meta);
  const opened = transferOpens(state);
  const to = opened ?? from;
  const report: TransferReport = {
    honors: from.honors,
    from,
    to,
    opened,
    runSeconds: state.run.elapsed,
    earned: state.run.earned,
    medalsLost: state.meta.medals,
    multiplierBefore: globalMultiplier(state),
  };

  updateCadre(state);
  const m = state.meta;
  m.honors += from.honors;
  m.honorsEarned += from.honors;
  m.transfers += 1;
  m.redeploys += 1;
  m.lastRunSeconds = state.run.elapsed;
  m.bestRunSeconds = m.bestRunSeconds === null ? state.run.elapsed : Math.min(m.bestRunSeconds, state.run.elapsed);
  if (opened) m.theatresOpen = opened.id;
  m.theatre = to.id;
  m.medals = 0;
  m.medalsEarned = 0;
  m.armory = {};
  m.cleared = {};
  m.captured = {};
  state.run = freshRun(m);
  return report;
}

/** Point the Campaign order at another theatre that a Transfer has opened. */
export function setTheatre(state: GameState, id: number): TransferResult {
  if (!THEATRES.some((t) => t.id === id)) return { ok: false, reason: 'Unknown theatre' };
  if (id > state.meta.theatresOpen) return { ok: false, reason: 'That theatre is not open yet' };
  state.meta.theatre = id;
  return { ok: true };
}
