import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { ENEMY_BY_ID, MARINE, MARINE_DATA, NODES, POSITION_BY_NODE, SHIP_BY_ID, THEATRES } from '../src/data';
import { validateMarineData } from '../src/data/marineSchema';
import { capturedBonus } from '../src/sim/campaign';
import { productionMultiplier } from '../src/sim/economy';
import {
  boardingSalvage,
  contestedFor,
  heldPositions,
  incidentById,
  initialDefendClock,
  overrun,
  spawnBoarding,
  spawnDefend,
  stepIncidents,
  takeIncident,
} from '../src/sim/incidents';
import type { IncidentEvent } from '../src/sim/incidents';
import { stepFleet, grantShip } from '../src/sim/fleet';
import {
  autoIncident,
  launchIncident,
  missionOdds,
  reinforce,
  runtimeOf,
  setMission,
  stageThreat,
  stepMarines,
  syncMarines,
} from '../src/sim/marines';
import type { MarineEvent } from '../src/sim/marines';
import { redeploy } from '../src/sim/prestige';
import { makeShip } from '../src/state/fleetState';
import { sanitizeContested, sanitizeIncidents } from '../src/state/incidentState';
import { fromRaw, newGameState, toRaw } from '../src/state/serialize';
import type { GameState } from '../src/state/types';

const NODE_IDS = new Set(NODES.map((n) => n.id));

function game(seed = 7): GameState {
  const s = newGameState(0, seed);
  s.meta.fleetUnlocked = true;
  for (const n of NODES.slice(0, 4)) s.meta.cleared[n.id] = 1;
  s.run.rp = D(1e9);
  s.run.ti = D(1e5);
  s.run.deut = D(1000);
  syncMarines(s);
  s.run.pers = D(500);
  return s;
}

function veterans(s: GameState, xp = 300) {
  const squad = s.run.marines.squads[0];
  reinforce(s, squad);
  for (const m of squad.slots) if (m) m.xp = xp;
  return squad;
}

const hold = (s: GameState, ...nodes: string[]): void => {
  for (const n of nodes) s.meta.captured[n] = 1;
};

function runMarines(s: GameState, seconds: number, events: MarineEvent[] = [], dt = 0.5): MarineEvent[] {
  for (let t = 0; t < seconds; t += dt) stepMarines(s, dt, (e) => events.push(e));
  return events;
}

describe('incident data', () => {
  it('passes validation and catches mistakes', () => {
    expect(validateMarineData(MARINE_DATA, NODE_IDS)).toEqual([]);
    const d = structuredClone(MARINE_DATA);
    d.missions = d.missions.filter((m) => m.id !== 'defend');
    d.missions.find((m) => m.id === 'boarding')!.auto = true;
    d.config.incidents.holdChance = 2;
    d.config.incidents.defendEvery = [100, 50];
    d.config.incidents.wreckBelow = 1;
    const errors = validateMarineData(d, NODE_IDS);
    for (const text of ['mission defend must exist', 'cannot repeat on its own', 'chances must be 0 to 1', 'rising pair', 'wreck settings']) {
      expect(errors.some((e) => e.includes(text)), text).toBe(true);
    }
  });

  it('names a hull class that exists', () => {
    expect(SHIP_BY_ID[MARINE.incidents.hullClass]).toBeDefined();
  });

  it('keeps the incident missions out of a squad\'s standing orders', () => {
    const s = game();
    const squad = s.run.marines.squads[0];
    setMission(s, squad.id, 'boarding');
    setMission(s, squad.id, 'defend');
    expect(squad.mission).toBe('patrol');
    const raw = toRaw(s) as any;
    raw.run.marines.squads[0].mission = 'defend';
    expect(fromRaw(raw)!.run.marines.squads[0].mission).toBe('patrol');
  });
});

describe('boarding offers from battle', () => {
  const frigates = (s: GameState, n: number) => {
    for (let i = 0; i < n; i++) s.run.fleet.ships.push(makeShip(SHIP_BY_ID.frigate, s.run.fleet.nextShipId++, 1, i < 4 ? 'front' : 'line'));
  };

  it('are raised by a won battle that leaves a broken enemy ship drifting', () => {
    let seen = 0;
    for (let seed = 1; seed <= 12 && seen === 0; seed++) {
      const s = game(seed);
      s.meta.cleared = {};
      frigates(s, 8);
      s.run.fleet.groups[0].order = 'campaign';
      const events: IncidentEvent[] = [];
      for (let t = 0; t < 900 && s.meta.battles.total === 0; t += 0.5) stepFleet(s, 0.5, (e) => e.kind === 'incident' && events.push(e));
      seen += s.run.incidents.length;
      for (const inc of s.run.incidents) {
        expect(inc.kind).toBe('boarding');
        expect(inc.node).toBe(NODES[0].id);
        expect(ENEMY_BY_ID[inc.enemy!]).toBeDefined();
        expect(inc.expires).toBe(MARINE.incidents.boardingSeconds);
      }
      expect(events).toHaveLength(s.run.incidents.length);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('are never raised before Operations is open', () => {
    const s = game(3);
    s.meta.opsUnlocked = false;
    s.meta.cleared = {};
    frigates(s, 8);
    for (let t = 0; t < 900 && s.meta.battles.total === 0; t += 0.5) stepFleet(s, 0.5);
    expect(s.run.incidents).toEqual([]);
  });

  it('price the ship by its Command, and cap the list at the limit', () => {
    const s = game();
    const corvette = spawnBoarding(s, 't1-n3', 'corvette')!;
    const destroyer = spawnBoarding(s, 't1-n3', 'destroyer')!;
    expect(destroyer.threat).toBeGreaterThan(corvette.threat);
    expect(destroyer.salvage!).toBeGreaterThan(corvette.salvage!);
    expect(destroyer.hullChance!).toBeGreaterThan(corvette.hullChance!);
    expect(destroyer.hullChance!).toBeLessThanOrEqual(MARINE.incidents.hullChance.cap);
    expect(boardingSalvage(destroyer)).toBe(destroyer.salvage);
    for (let i = 0; i < 6; i++) spawnBoarding(s, 't1-n1', 'gunboat');
    expect(s.run.incidents.filter((i) => i.kind === 'boarding')).toHaveLength(MARINE.incidents.max);
    expect(s.run.incidents.some((i) => i.id === corvette.id)).toBe(false);
    expect(spawnBoarding(s, 'nowhere', 'corvette')).toBeNull();
    expect(spawnBoarding(s, 't1-n1', 'ghost')).toBeNull();
  });

  it('expire if nobody answers', () => {
    const s = game();
    const events: IncidentEvent[] = [];
    spawnBoarding(s, 't1-n1', 'gunboat');
    stepIncidents(s, MARINE.incidents.boardingSeconds - 1, new Set(), (e) => events.push(e));
    expect(s.run.incidents).toHaveLength(1);
    stepIncidents(s, 2, new Set(), (e) => events.push(e));
    expect(s.run.incidents).toEqual([]);
    expect(events.at(-1)).toMatchObject({ kind: 'incident-ended', result: 'expired' });
  });
});

describe('answering a boarding action', () => {
  it('pays Salvage for a win, and a hull when the roll goes well', () => {
    let gotHull = false;
    let gotSalvage = false;
    for (let seed = 1; seed <= 25; seed++) {
      const s = game(seed);
      veterans(s);
      const inc = spawnBoarding(s, 't1-n1', 'destroyer')!;
      inc.threat = 1; // an easy boarding, to test the pay
      inc.hullChance = 1;
      const events: MarineEvent[] = [];
      expect(launchIncident(s, 1, inc.id).ok).toBe(true);
      expect(incidentById(s, inc.id)).toBeUndefined();
      expect(runtimeOf(s, 1).mission?.incident?.id).toBe(inc.id);
      // an attended mission waits for a tactic in each brief: let the standing orders play it out
      runMarines(s, 400, events);
      const boarded = events.find((e) => e.kind === 'boarded');
      expect(boarded).toBeDefined();
      if (boarded?.kind === 'boarded') {
        gotSalvage = boarded.salvage > 0 && s.run.salvage.toNumber() >= boarded.salvage;
        gotHull = boarded.hull && s.run.fleet.ships.length === 1;
      }
      break;
    }
    expect(gotSalvage).toBe(true);
    expect(gotHull).toBe(true);
  });

  it('pays nothing for a lost boarding and the incident is gone', () => {
    const s = game();
    const squad = veterans(s, 0);
    const inc = spawnBoarding(s, 't1-n1', 'destroyer')!;
    inc.threat = 1e9;
    launchIncident(s, squad.id, inc.id);
    const events = runMarines(s, 400);
    expect(events.some((e) => e.kind === 'boarded')).toBe(false);
    expect(s.run.salvage.toNumber()).toBe(0);
    expect(s.run.fleet.ships).toHaveLength(0);
    expect(s.run.incidents).toEqual([]);
  });

  it('refuses a squad that is busy, a missing incident, and an unready squad', () => {
    const s = game();
    const squad = veterans(s);
    expect((launchIncident(s, squad.id, 999) as { reason?: string }).reason).toMatch(/over/);
    expect((launchIncident(s, 42, 1) as { reason?: string }).reason).toMatch(/Unknown/);
    const a = spawnBoarding(s, 't1-n1', 'gunboat')!;
    const b = spawnBoarding(s, 't1-n1', 'gunboat')!;
    expect(launchIncident(s, squad.id, a.id).ok).toBe(true);
    expect((launchIncident(s, squad.id, b.id) as { reason?: string }).reason).toMatch(/Already/);
    const empty = game();
    empty.run.pers = D(0);
    const inc = spawnBoarding(empty, 't1-n1', 'gunboat')!;
    expect(launchIncident(empty, 1, inc.id).ok).toBe(false);
    expect(incidentById(empty, inc.id)).toBeDefined(); // a refused launch does not use the incident up
  });

  it('uses the incident\'s threat for the odds', () => {
    const s = game();
    const squad = veterans(s);
    const inc = spawnBoarding(s, 't1-n2', 'corvette')!;
    expect(stageThreat(s, 'boarding', inc.node, 0, inc)).toBeCloseTo(inc.threat * 0.9);
    expect(stageThreat(s, 'boarding', inc.node, 0)).toBe(Infinity);
    const easy = missionOdds(s, squad, 'boarding', inc.node, false, inc);
    inc.threat *= 100;
    expect(missionOdds(s, squad, 'boarding', inc.node, false, inc).all).toBeLessThan(easy.all);
  });
});

describe('counter-attacks', () => {
  it('do not start until ground is held, then arrive on the timer', () => {
    const s = game();
    s.run.defendClock = 5;
    stepIncidents(s, 100, new Set());
    expect(s.run.incidents).toEqual([]);
    expect(s.run.defendClock).toBe(5);
    hold(s, 't1-n1');
    stepIncidents(s, 6, new Set());
    expect(s.run.incidents).toHaveLength(1);
    expect(s.run.incidents[0]).toMatchObject({ kind: 'defend', node: 't1-n1' });
    expect(s.run.defendClock).toBeGreaterThanOrEqual(MARINE.incidents.defendEvery[0]);
    expect(s.run.defendClock).toBeLessThanOrEqual(MARINE.incidents.defendEvery[1]);
    expect(heldPositions(s)).toEqual(['t1-n1']);
  });

  it('never attack one position twice at once, or one a squad is already defending', () => {
    const s = game();
    hold(s, 't1-n1', 't1-n2');
    spawnDefend(s, 't1-n1');
    s.run.defendClock = 0;
    stepIncidents(s, 1, new Set(['t1-n2']));
    expect(s.run.incidents.filter((i) => i.kind === 'defend')).toHaveLength(1);
    expect(spawnDefend(s, 't1-n3')).toBeNull(); // not held
  });

  it('are resolved by the garrison when nobody answers: it holds, or is overrun', () => {
    let held = 0;
    let overrunSeen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = game(seed);
      hold(s, 't1-n3');
      s.run.defendClock = 1e9;
      const inc = spawnDefend(s, 't1-n3')!;
      const before = s.run.pers.toNumber();
      const events: IncidentEvent[] = [];
      stepIncidents(s, MARINE.incidents.defendSeconds + 1, new Set(), (e) => events.push(e));
      const end = events.find((e) => e.kind === 'incident-ended');
      expect(end).toBeDefined();
      if (end?.kind !== 'incident-ended') continue;
      expect(end.incident.id).toBe(inc.id);
      if (end.result === 'held') {
        held += 1;
        expect(s.run.pers.toNumber()).toBe(before);
        expect(contestedFor(s, 't1-n3')).toBe(0);
      } else {
        overrunSeen += 1;
        const garrison = POSITION_BY_NODE['t1-n3'].garrison;
        expect(s.run.pers.toNumber()).toBe(before - garrison * MARINE.incidents.overrunGarrisons);
        expect(end.pers).toBe(garrison * MARINE.incidents.overrunGarrisons);
        expect(contestedFor(s, 't1-n3')).toBeGreaterThan(MARINE.incidents.contestedSeconds - 5);
      }
    }
    expect(held).toBeGreaterThan(15);
    expect(overrunSeen).toBeGreaterThan(3);
  });

  it('suspend a position\'s production bonus while contested, then restore it', () => {
    const s = game();
    hold(s, 't1-n1'); // +6% Requisition
    const bonus = capturedBonus(s.meta, 'rp');
    expect(bonus).toBeGreaterThan(0);
    const normal = productionMultiplier(s);
    const lost = overrun(s, 't1-n1');
    expect(lost).toBe(POSITION_BY_NODE['t1-n1'].garrison * MARINE.incidents.overrunGarrisons);
    expect(capturedBonus(s.meta, 'rp', s.run.contested)).toBe(0);
    expect(productionMultiplier(s)).toBeCloseTo(normal / (1 + bonus));
    s.run.defendClock = 1e9;
    stepIncidents(s, MARINE.incidents.contestedSeconds + 1, new Set());
    expect(contestedFor(s, 't1-n1')).toBe(0);
    expect(productionMultiplier(s)).toBeCloseTo(normal);
  });

  it('cannot cost more Personnel than there are', () => {
    const s = game();
    hold(s, 't1-n3');
    s.run.pers = D(2);
    expect(overrun(s, 't1-n3')).toBe(2);
    expect(s.run.pers.toNumber()).toBe(0);
  });

  it('are answered by an auto squad with good odds, and a win cancels the overrun', () => {
    const s = game();
    hold(s, 't1-n1');
    const squad = veterans(s);
    s.run.defendClock = 1e9;
    const inc = spawnDefend(s, 't1-n1')!;
    inc.threat = 1;
    expect(autoIncident(s, squad)?.id).toBe(inc.id);
    const events: MarineEvent[] = [];
    stepMarines(s, 0.5, (e) => events.push(e));
    expect(runtimeOf(s, squad.id).mission?.kind).toBe('defend');
    runMarines(s, 600, events);
    expect(events.some((e) => e.kind === 'incident-ended' && e.result === 'overrun')).toBe(false);
    expect(contestedFor(s, 't1-n1')).toBe(0);
    const done = events.find((e) => e.kind === 'mission' && e.summary.kind === 'defend');
    expect(done && done.kind === 'mission' && done.summary.outcome).toBe('won');
  });

  it('are an overrun when the squad loses or is recalled', () => {
    const s = game();
    hold(s, 't1-n3');
    const squad = veterans(s, 0);
    s.run.defendClock = 1e9;
    const inc = spawnDefend(s, 't1-n3')!;
    inc.threat = 1e9;
    launchIncident(s, squad.id, inc.id);
    const events = runMarines(s, 600);
    expect(events.some((e) => e.kind === 'incident-ended' && e.result === 'overrun')).toBe(true);
    expect(contestedFor(s, 't1-n3')).toBeGreaterThan(0);
  });

  it('are not answered by an auto squad that cannot win', () => {
    const s = game();
    hold(s, 't1-n3');
    const squad = veterans(s, 0);
    const inc = spawnDefend(s, 't1-n3')!;
    inc.threat = 1e9;
    expect(autoIncident(s, squad)).toBeNull();
  });
});

describe('incident saves', () => {
  it('round-trip incidents, the timer and contested positions', () => {
    const s = game();
    hold(s, 't1-n1', 't1-n3');
    spawnBoarding(s, 't1-n2', 'corvette');
    spawnDefend(s, 't1-n1');
    s.run.contested['t1-n3'] = 400;
    s.run.defendClock = 777;
    const back = fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!;
    expect(back.run.incidents.map((i) => [i.kind, i.node])).toEqual([['boarding', 't1-n2'], ['defend', 't1-n1']]);
    expect(back.run.contested).toEqual({ 't1-n3': 400 });
    expect(back.run.defendClock).toBe(777);
    expect(back.run.nextIncidentId).toBe(s.run.nextIncidentId);
  });

  it('survive hostile values', () => {
    const held = new Set(['t1-n1']);
    const good = { id: 1, kind: 'boarding', node: 't1-n1', threat: 50, expires: 100, enemy: 'corvette', salvage: 5, hullChance: 0.3 };
    const { incidents, next } = sanitizeIncidents(
      [
        good,
        { ...good, id: 1 }, // duplicate id
        { ...good, id: 2, enemy: 'constructor' },
        { ...good, id: 3, node: '__proto__' },
        { ...good, id: 4, kind: 'defend', node: 't1-n2' }, // not held
        { id: 5, kind: 'defend', node: 't1-n1', threat: -5, expires: 1e12 },
        { ...good, id: -3 },
        { ...good, id: 6, hullChance: 9, salvage: 'x', threat: NaN },
        'junk',
        null,
      ],
      held,
    );
    expect(incidents.map((i) => i.id)).toEqual([1, 5, 6]);
    expect(incidents[1].threat).toBe(1);
    expect(incidents[1].expires).toBeLessThanOrEqual(MARINE.incidents.defendSeconds);
    expect(incidents[2].hullChance).toBeLessThanOrEqual(MARINE.incidents.hullChance.cap);
    expect(incidents[2].salvage).toBe(0);
    expect(next).toBe(7);
    expect(sanitizeIncidents('x', held)).toEqual({ incidents: [], next: 1 });
    expect(sanitizeContested({ 't1-n1': 1e9, 't1-n2': 5, ghost: 5, 't1-n3': -1 }, new Set(['t1-n1', 't1-n3']))).toEqual({ 't1-n1': MARINE.incidents.contestedSeconds });
    expect(sanitizeContested(null, held)).toEqual({});
  });

  it('limit how many incidents a save can hold', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, kind: 'boarding', node: 't1-n1', threat: 10, expires: 10, enemy: 'corvette', salvage: 1, hullChance: 0 }));
    expect(sanitizeIncidents(many, new Set()).incidents).toHaveLength(MARINE.incidents.max);
  });

  it('reset at Redeploy, keeping held ground and the first timer', () => {
    const s = game();
    hold(s, 't1-n1');
    spawnBoarding(s, 't1-n1', 'gunboat');
    s.run.contested['t1-n1'] = 100;
    s.run.defendClock = 3;
    s.run.earned = D(1e12);
    expect(redeploy(s)).not.toBeNull();
    expect(s.run.incidents).toEqual([]);
    expect(s.run.contested).toEqual({});
    expect(s.run.defendClock).toBe(initialDefendClock());
    expect(s.meta.captured).toEqual({ 't1-n1': 1 });
  });
});

describe('the heavy cruiser and hull grants', () => {
  it('is a capital class that unlocks with the first theatre\'s boss', () => {
    const h = SHIP_BY_ID['heavy-cruiser'];
    expect(h.command).toBe(6);
    expect(h.cost).toEqual({ rp: 1500000, ti: 220000 });
    expect(h.unlock).toEqual({ kind: 'node', node: THEATRES[0].nodes[THEATRES[0].nodes.length - 1].id });
    expect(h.defaultLoadout.weapon).toHaveLength(h.slots.weapon);
  });

  it('can be handed to the fleet at a share of its hull', () => {
    const s = game();
    const ship = grantShip(s, 'frigate', 0.4)!;
    expect(s.run.fleet.ships).toContain(ship);
    expect(ship.hull).toBeCloseTo(0.4);
    expect(grantShip(s, 'ghost', 1)).toBeNull();
  });

  it('takeIncident removes only the one asked for', () => {
    const s = game();
    const a = spawnBoarding(s, 't1-n1', 'gunboat')!;
    const b = spawnBoarding(s, 't1-n1', 'gunboat')!;
    expect(takeIncident(s, a.id)?.id).toBe(a.id);
    expect(takeIncident(s, a.id)).toBeNull();
    expect(s.run.incidents.map((i) => i.id)).toEqual([b.id]);
  });
});
