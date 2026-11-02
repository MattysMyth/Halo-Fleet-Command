import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { NODES, THEATRES, UNIT_BY_ID } from '../src/data';
import { isUnitUnlocked, missionOdds, reinforce, setMission, setTarget, setWant, startMission, stepMarines, syncMarines, targetProblem } from '../src/sim/marines';
import type { MarineEvent } from '../src/sim/marines';
import { newGameState } from '../src/state/serialize';
import type { GameState } from '../src/state/types';

function game(): GameState {
  const s = newGameState(0, 11);
  s.meta.fleetUnlocked = true;
  for (const t of THEATRES) for (const n of t.nodes) { s.meta.cleared[n.id] = 1; s.meta.everCleared[n.id] = 1; }
  syncMarines(s);
  s.run.pers = D(500);
  s.run.deut = D(100);
  return s;
}

describe('ODST and Spartans', () => {
  it('unlock with Theatre 2 ground and cost Personnel', () => {
    const fresh = newGameState(0, 3);
    expect(isUnitUnlocked(fresh, UNIT_BY_ID.odst)).toBe(false);
    expect(isUnitUnlocked(fresh, UNIT_BY_ID.spartan)).toBe(false);
    const s = game();
    expect(isUnitUnlocked(s, UNIT_BY_ID.odst)).toBe(true);
    expect(isUnitUnlocked(s, UNIT_BY_ID.spartan)).toBe(true);
    expect(UNIT_BY_ID.spartan.cost).toBeGreaterThan(UNIT_BY_ID.odst.cost);
  });

  it('a Spartan squad is far stronger than marines against the same ground', () => {
    const s = game();
    const sq = s.run.marines.squads[0];
    reinforce(s, sq);
    const weak = missionOdds(s, sq, 'patrol', NODES[NODES.length - 1].id).all;
    for (let i = 0; i < 4; i++) setWant(s, sq.id, i, 'spartan');
    for (let i = 0; i < 4; i++) sq.slots[i] = null;
    reinforce(s, sq);
    expect(sq.slots.filter((m) => m?.unit === 'spartan').length).toBe(4);
    const strong = missionOdds(s, sq, 'patrol', NODES[NODES.length - 1].id).all;
    expect(strong).toBeGreaterThan(weak);
  });
});

describe('Hunter strike', () => {
  it('only goes to held ground', () => {
    const s = game();
    const id = THEATRES[0].nodes[0].id;
    expect(targetProblem(s, 'hunter', id)).toMatch(/hold/);
    s.meta.captured[id] = 1;
    expect(targetProblem(s, 'hunter', id)).toBeNull();
  });

  it('pays Salvage on a win', () => {
    const s = game();
    const id = THEATRES[0].nodes[2].id;
    s.meta.captured[id] = 1;
    const sq = s.run.marines.squads[0];
    reinforce(s, sq);
    for (const m of sq.slots) if (m) m.xp = 300;
    expect(setMission(s, sq.id, 'hunter').ok).toBe(true);
    expect(setTarget(s, sq.id, id).ok).toBe(true);
    const before = s.run.salvage;
    const events: MarineEvent[] = [];
    expect(startMission(s, sq.id, (e) => events.push(e)).ok).toBe(true);
    for (let t = 0; t < 600; t += 0.5) stepMarines(s, 0.5, (e) => events.push(e));
    const done = events.find((e) => e.kind === 'mission');
    expect(done).toBeTruthy();
    if (done && done.kind === 'mission') {
      expect(done.summary.outcome).toBe('won');
      expect(s.run.salvage.gt(before)).toBe(true);
    }
  });

});
