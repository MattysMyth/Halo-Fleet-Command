/**
 * Incidents: things that happen to the fleet and the ground that the marines may answer.
 *
 *  - Boarding: a battle ends with a beaten enemy ship left under a quarter of its hull. For a short
 *    while a squad can board it for Salvage, and sometimes a hull.
 *  - Defend: every so often a held position is counter-attacked. A squad can answer it. If nobody
 *    does, the garrison fights alone: it usually holds, and sometimes is overrun, which costs
 *    Personnel and suspends the position's production bonus for a while.
 *
 * Nothing here knows about squads or ships, so the fleet can raise incidents and the marines can
 * answer them without either importing the other.
 */
import { D } from '../core/numbers';
import { createRng } from '../core/rng';
import { ENEMY_BY_ID, MARINE, NODE_BY_ID, POSITION_BY_NODE } from '../data';
import type { GameState, Incident, IncidentKind } from '../state/types';
import { addCapped } from './economy';

export type IncidentEvent =
  | { kind: 'incident'; incident: Incident }
  | { kind: 'incident-ended'; incident: Incident; result: 'expired' | 'held' | 'overrun'; pers: number };
export type IncidentEmit = (e: IncidentEvent) => void;

const cfg = () => MARINE.incidents;

const rngFor = (state: GameState, salt: number) => createRng((state.seed ^ Math.imul(salt + 1, 0x85ebca6b) ^ Math.imul(state.run.nextIncidentId + 1, 0x9e3779b1)) >>> 0);

/** A fresh counter-attack timer: the middle of the range, so a new run is predictable. */
export const initialDefendClock = (): number => (cfg().defendEvery[0] + cfg().defendEvery[1]) / 2;

export const heldPositions = (state: GameState): string[] => Object.keys(state.meta.captured).filter((n) => state.meta.captured[n] > 0 && POSITION_BY_NODE[n]);

export const incidentsOf = (state: GameState, kind: IncidentKind): Incident[] => state.run.incidents.filter((i) => i.kind === kind);
export const incidentById = (state: GameState, id: number): Incident | undefined => state.run.incidents.find((i) => i.id === id);

function push(state: GameState, inc: Incident, emit?: IncidentEmit): void {
  state.run.incidents.push(inc);
  // A new one pushes out the oldest of its kind.
  const same = state.run.incidents.filter((i) => i.kind === inc.kind);
  for (let k = 0; k < same.length - cfg().max; k++) {
    const gone = same[k];
    state.run.incidents = state.run.incidents.filter((i) => i !== gone);
    emit?.({ kind: 'incident-ended', incident: gone, result: 'expired', pers: 0 });
  }
  emit?.({ kind: 'incident', incident: inc });
}

/** Offer a boarding action on a beaten enemy ship. Returns the incident, or null when the node has no ground to fight on. */
export function spawnBoarding(state: GameState, node: string, enemyId: string, emit?: IncidentEmit): Incident | null {
  const pos = POSITION_BY_NODE[node];
  const n = NODE_BY_ID[node];
  const enemy = ENEMY_BY_ID[enemyId];
  if (!pos || !n || !enemy) return null;
  const c = cfg();
  const inc: Incident = {
    id: state.run.nextIncidentId++,
    kind: 'boarding',
    node,
    threat: pos.threat * (c.boardThreat.base + c.boardThreat.perCommand * enemy.command),
    expires: c.boardingSeconds,
    enemy: enemyId,
    salvage: n.reward.salvage * (c.boardSalvage.base + c.boardSalvage.perCommand * enemy.command),
    hullChance: Math.min(c.hullChance.cap, c.hullChance.base + c.hullChance.perCommand * enemy.command),
  };
  push(state, inc, emit);
  return inc;
}

export function spawnDefend(state: GameState, node: string, emit?: IncidentEmit): Incident | null {
  const pos = POSITION_BY_NODE[node];
  if (!pos || !(state.meta.captured[node] > 0)) return null;
  const inc: Incident = {
    id: state.run.nextIncidentId++,
    kind: 'defend',
    node,
    threat: pos.threat * cfg().defendThreat,
    expires: cfg().defendSeconds,
  };
  push(state, inc, emit);
  return inc;
}

/** Remove an incident from the list (a squad is taking it). */
export function takeIncident(state: GameState, id: number): Incident | null {
  const i = state.run.incidents.findIndex((x) => x.id === id);
  if (i < 0) return null;
  return state.run.incidents.splice(i, 1)[0];
}

/** An overrun: Personnel are lost, and the position pays no production bonus for a while. Returns the Personnel lost. */
export function overrun(state: GameState, node: string): number {
  const pos = POSITION_BY_NODE[node];
  if (!pos) return 0;
  const lost = Math.min(state.run.pers.toNumber(), Math.ceil(pos.garrison * cfg().overrunGarrisons));
  state.run.pers = state.run.pers.sub(lost);
  state.run.contested[node] = cfg().contestedSeconds;
  return lost;
}

/** Nobody answered a counter-attack: the garrison holds, or is overrun. */
function resolveUnanswered(state: GameState, inc: Incident, emit?: IncidentEmit): void {
  const held = rngFor(state, inc.id).next() < cfg().holdChance;
  const pers = held ? 0 : overrun(state, inc.node);
  emit?.({ kind: 'incident-ended', incident: inc, result: held ? 'held' : 'overrun', pers });
}

/** Seconds a position still pays nothing for after an overrun, or 0. */
export const contestedFor = (state: GameState, node: string): number => state.run.contested[node] ?? 0;

/** Advance incidents, the counter-attack timer and contested positions. `defending` lists nodes a squad is already defending. */
export function stepIncidents(state: GameState, dt: number, defending: Set<string>, emit?: IncidentEmit): void {
  const run = state.run;
  for (const node of Object.keys(run.contested)) {
    run.contested[node] -= dt;
    if (run.contested[node] <= 0) delete run.contested[node];
  }

  if (run.incidents.length > 0) {
    const gone: Incident[] = [];
    for (const inc of run.incidents) {
      inc.expires -= dt;
      if (inc.expires <= 0) gone.push(inc);
    }
    if (gone.length > 0) {
      run.incidents = run.incidents.filter((i) => !gone.includes(i));
      for (const inc of gone) {
        if (inc.kind === 'defend') resolveUnanswered(state, inc, emit);
        else emit?.({ kind: 'incident-ended', incident: inc, result: 'expired', pers: 0 });
      }
    }
  }

  const held = heldPositions(state);
  if (held.length === 0) return;
  run.defendClock -= dt;
  if (run.defendClock > 0) return;
  const [lo, hi] = cfg().defendEvery;
  const rng = rngFor(state, 7777);
  run.defendClock = lo + (hi - lo) * rng.next();
  const free = held.filter((n) => !defending.has(n) && !run.incidents.some((i) => i.kind === 'defend' && i.node === n));
  if (free.length > 0) spawnDefend(state, free[Math.floor(rng.next() * free.length) % free.length], emit);
}

/** Salvage a won boarding pays, before the Salvage bonus. */
export const boardingSalvage = (inc: Incident): number => inc.salvage ?? 0;

/** Pay Salvage into the stockpile. */
export const paySalvage = (state: GameState, amount: number): void => void addCapped(state, 'salvage', D(amount));
