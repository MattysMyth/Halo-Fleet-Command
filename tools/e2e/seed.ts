/**
 * Writes sample saves for the browser harness (tools/e2e/run.mjs) to a JSON file.
 * Usage: npx tsx tools/e2e/seed.ts <out.json>
 */
import { writeFileSync } from 'node:fs';
import { D } from '../../src/core/numbers';
import { SHIP_BY_ID, THEATRES } from '../../src/data';
import { makeShip } from '../../src/state/fleetState';
import { fitVehicle, reinforce, setAuto, setMission, setTarget, setWant, startMission, syncMarines } from '../../src/sim/marines';
import { startResearch } from '../../src/sim/research';
import { spawnBoarding, spawnDefend } from '../../src/sim/incidents';
import { stepWorld } from '../../src/sim/world';
import { newGameState, toRaw } from '../../src/state/serialize';
import type { GameState } from '../../src/state/types';

const frigate = SHIP_BY_ID.frigate;

function fleetSave(opts: { away?: number; ships?: number; cleared?: string[]; patrol?: boolean } = {}): GameState {
  const now = Date.now();
  const s = newGameState(now - (opts.away ?? 0) * 1000, 7);
  s.lastSeen = now - (opts.away ?? 0) * 1000;
  s.run.rp = D(2e6);
  s.run.earned = D(3e6);
  s.run.ti = D(9000);
  s.run.deut = D(900);
  s.run.elapsed = 3000;
  s.run.owned = { ...s.run.owned, depot: 40, hub: 22, charter: 10, platform: 4, outpost: 6, mine: 3, harvester: 6, refinery: 2 };
  s.meta.fleetUnlocked = true;
  s.meta.medals = 3;
  s.meta.medalsEarned = 6;
  s.meta.cadreXp = 4;
  for (const id of opts.cleared ?? ['t1-n1', 't1-n2', 't1-n3']) s.meta.cleared[id] = 2;
  const n = opts.ships ?? 7;
  for (let i = 0; i < n; i++) {
    const ship = makeShip(frigate, s.run.fleet.nextShipId++, 1, i < 4 ? 'front' : 'line');
    ship.xp = i * 2;
    if (i === 2) ship.hull = 0.55;
    s.run.fleet.ships.push(ship);
  }
  s.run.fleet.queue.push({ classId: 'frigate', remaining: 70, total: 120 });
  s.run.fleet.queue.push({ classId: 'frigate', remaining: 120, total: 120 });
  if (opts.patrol) {
    s.run.fleet.groups[0].order = 'patrol';
    s.run.fleet.groups[0].patrolNode = 't1-n3';
  }
  return s;
}

/** A game with Operations open: two squads, one mid-assault in its brief, wounded and promoted marines, captured ground, research. */
function opsSave(opts: { away?: number; fresh?: boolean } = {}): GameState {
  const s = fleetSave({ away: opts.away, cleared: opts.fresh ? ['t1-n1'] : ['t1-n1', 't1-n2', 't1-n3', 't1-n4', 't1-n5'], ships: opts.fresh ? 3 : 9 });
  s.meta.opsUnlocked = true;
  s.run.pers = D(opts.fresh ? 6 : 420);
  s.run.intel = D(opts.fresh ? 0 : 900);
  s.run.owned = { ...s.run.owned, recruit: 8, academy: 4, barracks: 1, listening: 4, analysis: 2 };
  syncMarines(s);
  if (opts.fresh) return s;
  s.meta.captured = { 't1-n1': 1 };
  s.meta.missions = { total: 14, won: 9, lost: 3, killed: 5 };
  const [a, b] = s.run.marines.squads;
  [0, 1, 2, 3, 4, 5].forEach((i) => setWant(s, a.id, i, i === 4 ? 'marksman' : i === 5 ? 'corpsman' : 'marine'));
  reinforce(s, a);
  reinforce(s, b);
  a.slots.forEach((m, i) => {
    if (!m) return;
    m.xp = [0, 8, 24, 60, 12, 30][i];
    if (i === 3) m.perks = ['sharpshooter', 'leader', 'veteran'];
    if (i === 2) m.perks = ['cover'];
    if (i === 5) m.hurt = 55;
  });
  fitVehicle(s, a.id, 'warthog');
  setMission(s, a.id, 'assault');
  setTarget(s, a.id, 't1-n2');
  setAuto(s, a.id, false);
  startMission(s, a.id);
  setMission(s, b.id, 'patrol');
  setAuto(s, b.id, true);
  startMission(s, b.id);
  s.run.marines.scouted = { 't1-n2': 1 };
  startResearch(s, 'optics');
  for (let i = 0; i < 6; i++) stepWorld(s, 0.5); // stay inside the 12 s brief of the assault
  return s;
}

/** The ops save with a boarding chance and a counter-attack waiting, and no auto squad to answer them. */
function incidentSave(): GameState {
  const s = opsSave();
  for (const q of s.run.marines.squads) q.auto = false;
  s.run.defendClock = 1e9;
  spawnBoarding(s, 't1-n3', 'corvette');
  spawnDefend(s, 't1-n1');
  s.run.contested['t1-n1'] = 420;
  return s;
}

/** The boss is down and a Marathon is fielded: ready to Transfer, with Honors to spend from an earlier life. */
function transferSave(): GameState {
  const s = opsSave();
  for (const n of THEATRES[0].nodes) {
    s.meta.cleared[n.id] = 1;
    s.meta.everCleared[n.id] = 1;
  }
  s.meta.honors = 4;
  s.meta.honorsEarned = 4;
  s.run.fleet.ships.push(makeShip(SHIP_BY_ID['heavy-cruiser'], s.run.fleet.nextShipId++, 1, 'front'));
  return s;
}

const out = process.argv[2];
if (!out) throw new Error('usage: seed.ts <out.json>');
const saves = {
  fresh: toRaw(newGameState(Date.now(), 3)),
  fleet: toRaw(fleetSave()),
  away: toRaw(fleetSave({ away: 7200, patrol: true })),
  ops: toRaw(opsSave()),
  opsfresh: toRaw(opsSave({ fresh: true })),
  opsinc: toRaw(incidentSave()),
  transfer: toRaw(transferSave()),
  opsaway: toRaw(opsSave({ away: 5400 })),
  big: toRaw(fleetSave({ ships: 14, cleared: ['t1-n1', 't1-n2', 't1-n3', 't1-n4', 't1-n5', 't1-n6', 't1-n7'] })),
};
writeFileSync(out, JSON.stringify(saves));
console.log('wrote', Object.keys(saves).join(', '));
