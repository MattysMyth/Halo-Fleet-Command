import { describe, expect, it } from 'vitest';
import { NODES, OFFICERS, OFFICER_BY_ID, THEATRES } from '../src/data';
import { validateOfficers } from '../src/data/officerSchema';
import { assignOfficer, describeOfficer, groupMods, officerOf } from '../src/sim/officers';
import { modsOf } from '../src/sim/modifiers';
import { runtimeOf, sortieCost } from '../src/sim/fleet';
import { makeShip } from '../src/state/fleetState';
import { SHIP_BY_ID } from '../src/data';
import { fromRaw, newGameState, toRaw } from '../src/state/serialize';
import type { GameState } from '../src/state/types';

const IDS = new Set(NODES.map((n) => n.id));

function game(): GameState {
  const s = newGameState(0, 3);
  s.meta.fleetUnlocked = true;
  s.run.fleet.groups.push({ ...s.run.fleet.groups[0], id: 2, name: 'Strike Group 2' });
  return s;
}
const clear = (s: GameState, id: string) => void (s.meta.everCleared[id] = 1);

describe('Officers', () => {
  it('pass validation and catch mistakes', () => {
    expect(validateOfficers(OFFICERS, IDS)).toEqual([]);
    const bad = structuredClone(OFFICERS);
    bad[0].unlock = 'nowhere';
    bad[1].effects = [{ kind: 'power', amount: 0.1 }];
    bad[2].effects = [{ kind: 'damage', amount: 9 }];
    bad.push({ ...bad[3] });
    const errors = validateOfficers(bad, IDS);
    for (const t of ['unknown node', 'does not apply', 'amounts run', 'duplicate']) expect(errors.some((e) => e.includes(t)), t).toBe(true);
  });

  it('unlock with the boss and sector they belong to, in order of the war', () => {
    const order = OFFICERS.map((o) => THEATRES.findIndex((t) => t.nodes.some((n) => n.id === o.unlock)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(OFFICERS.some((o) => o.title.includes('AI'))).toBe(true);
  });

  it('cannot be assigned until their sector has been cleared', () => {
    const s = game();
    expect(assignOfficer(s, 1, 'varga').ok).toBe(false);
    clear(s, 't1-n4');
    expect(assignOfficer(s, 1, 'varga').ok).toBe(true);
    expect(assignOfficer(s, 1, 'ghost').ok).toBe(false);
    expect(assignOfficer(s, 9, 'varga').ok).toBe(false);
  });

  it('lead one group at a time and add to that group alone', () => {
    const s = game();
    clear(s, 't1-n4');
    const [a, b] = s.run.fleet.groups;
    const base = modsOf(s).damage;
    assignOfficer(s, 1, 'varga');
    expect(groupMods(s, a).damage).toBeCloseTo(base + 0.08);
    expect(groupMods(s, b).damage).toBeCloseTo(base);
    assignOfficer(s, 2, 'varga');
    expect(a.officer).toBeNull();
    expect(b.officer).toBe('varga');
    expect(officerOf(s, a)).toBeNull();
    assignOfficer(s, 2, null);
    expect(b.officer).toBeNull();
  });

  it('cut the cost of a sortie for their group', () => {
    const s = game();
    clear(s, 't2-n8');
    s.run.fleet.ships.push(makeShip(SHIP_BY_ID['heavy-cruiser'], 1, 1, 'front'));
    const before = sortieCost(s, 1);
    assignOfficer(s, 1, 'lindqvist');
    expect(sortieCost(s, 1)).toBeLessThan(before);
  });

  it('stop counting if their sector is lost from the record, and survive a save', () => {
    const s = game();
    clear(s, 't1-n8');
    assignOfficer(s, 2, 'okonkwo');
    const back = fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!;
    expect(back.run.fleet.groups.find((g) => g.id === 2)!.officer).toBe('okonkwo');
    delete s.meta.everCleared['t1-n8'];
    expect(officerOf(s, s.run.fleet.groups[1])).toBeNull();
  });

  it('are cleaned from a hand-edited save: unknown ids and one officer twice', () => {
    const s = game();
    const raw = JSON.parse(JSON.stringify(toRaw(s)));
    raw.run.fleet.groups[0].officer = 'rao';
    raw.run.fleet.groups[1].officer = 'rao';
    const back = fromRaw(raw)!;
    expect(back.run.fleet.groups.filter((g) => g.officer === 'rao')).toHaveLength(1);
    raw.run.fleet.groups[0].officer = { x: 1 };
    expect(fromRaw(raw)!.run.fleet.groups[0].officer).toBeNull();
  });

  it('are described in plain words', () => {
    expect(describeOfficer(OFFICER_BY_ID.varga)).toBe('+8% damage');
    expect(describeOfficer(OFFICER_BY_ID.okonkwo)).toContain('repair');
  });

  it('cannot move while their group is in battle, nor be taken from it', () => {
    const s = game();
    clear(s, 't1-n4');
    assignOfficer(s, 1, 'varga');
    runtimeOf(s, 1).battle = {} as never;
    expect(assignOfficer(s, 2, 'varga').ok).toBe(false);
    expect(assignOfficer(s, 1, null).ok).toBe(false);
    expect(s.run.fleet.groups[0].officer).toBe('varga');
    runtimeOf(s, 1).battle = null;
    expect(assignOfficer(s, 2, 'varga').ok).toBe(true);
  });
});
