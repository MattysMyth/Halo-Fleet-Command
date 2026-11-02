/**
 * The whole simulation in one place: economy, fleet and marines advancing together. The store calls
 * these instead of reaching into the parts separately.
 */
import type { GameState } from '../state/types';
import { applyOffline, step } from './economy';
import type { OfflineReport } from './economy';
import { applyOfflineFleet, stepFleet } from './fleet';
import type { FleetEvent, FleetOfflineReport } from './fleet';
import { applyOfflineMarines, stepMarines } from './marines';
import type { MarineEvent, MarineOfflineReport } from './marines';
import { stepResearch, syncDoctrineSlots } from './research';
import type { ResearchEvent } from './research';

export type WorldEvent = FleetEvent | MarineEvent | ResearchEvent;
export type Emit = (e: WorldEvent) => void;

/** One live step. The battle speed setting hurries fleet and marine operations only. */
export function stepWorld(state: GameState, dt: number, emit?: Emit): void {
  step(state, dt);
  syncDoctrineSlots(state);
  stepResearch(state, dt, emit);
  stepFleet(state, dt, emit, state.settings.battleSpeed);
  stepMarines(state, dt, emit, state.settings.battleSpeed);
}

/** Replay a short gap (a throttled background tab) in one-second steps at normal speed. */
export function advanceWorld(state: GameState, seconds: number, emit?: Emit): void {
  let left = seconds;
  while (left > 1e-9) {
    const dt = Math.min(1, left);
    step(state, dt);
    syncDoctrineSlots(state);
    stepResearch(state, dt, emit);
    stepFleet(state, dt, emit, 1);
    stepMarines(state, dt, emit, 1);
    left -= dt;
  }
}

export interface WorldOfflineReport extends OfflineReport {
  fleet: FleetOfflineReport;
  marines: MarineOfflineReport;
  /** Research projects that finished while away. */
  research: string[];
}

/** Time away beyond the background limit: capped, scaled by offline efficiency, with Patrol estimated and the squads carrying on. */
export function applyOfflineWorld(state: GameState, awaySeconds: number, emit?: Emit): WorldOfflineReport {
  const report = applyOffline(state, awaySeconds);
  syncDoctrineSlots(state);
  const research: string[] = [];
  // Projects run on the real time away, not the efficiency-scaled time: the staff keep working.
  stepResearch(state, Math.max(0, awaySeconds), (e) => {
    research.push(e.def.name);
    emit?.(e);
  });
  const fleet = applyOfflineFleet(state, report.appliedSeconds, report.efficiency, emit);
  const marines = applyOfflineMarines(state, report.appliedSeconds, report.efficiency, emit);
  return { ...report, fleet, marines, research };
}
