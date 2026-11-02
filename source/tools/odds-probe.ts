/** Prints a squad's odds against each position for a few loadouts, to tune threat numbers. Run: npx tsx tools/odds-probe.ts */
import { MARINE, POSITIONS } from '../src/data';
import { fitVehicle, missionOdds, reinforce, setWant, syncMarines } from '../src/sim/marines';
import { newGameState } from '../src/state/serialize';
import { D } from '../src/core/numbers';
import type { GameState } from '../src/state/types';

function loadout(unit: string[], vehicle: string | null, xp: number, researchAll: boolean): GameState {
  const s = newGameState(0, 1);
  s.meta.opsUnlocked = true;
  for (const id of POSITIONS.map((p) => p.node)) s.meta.cleared[id] = true as never;
  syncMarines(s);
  s.run.pers = D(1000);
  s.run.rp = D(1e12);
  s.run.ti = D(1e6);
  const sq = s.run.marines.squads[0];
  unit.forEach((u, i) => setWant(s, sq.id, i, u));
  reinforce(s, sq);
  for (const m of sq.slots) if (m) m.xp = xp;
  if (vehicle) fitVehicle(s, sq.id, vehicle);
  if (researchAll) s.run.research.done = ['optics','plates','comms','surgeons','medevac','drills','combined','school'];
  return s;
}

const cases: [string, string[], string | null, number, boolean][] = [
  ['6 marines, no vehicle', Array(6).fill('marine'), null, 0, false],
  ['+warthog', Array(6).fill('marine'), 'warthog', 0, false],
  ['mixed + hornet, rank 1', ['marine','marine','marine','marine','marksman','corpsman'], 'hornet', 8, false],
  ['mixed + scorpion, rank 2, research half', ['marine','marine','marine','marine','marksman','corpsman'], 'scorpion', 24, false],
  ['mixed + scorpion, rank 3, all research', ['marine','marine','marine','marine','marksman','corpsman'], 'scorpion', 60, true],
  ['ODST mix + scorpion, rank 3, all research', ['marine','marine','odst','odst','marksman','corpsman'], 'scorpion', 60, true],
  ['2 Spartan + ODST + corpsman, scorpion, r3', ['spartan','spartan','odst','odst','marksman','corpsman'], 'scorpion', 60, true],
  ['4 Spartan + 2 ODST, scorpion, r3', ['spartan','spartan','spartan','spartan','odst','odst'], 'scorpion', 60, true],
];
console.log('worst-stage win chance on the standing order (all-stage chance in brackets), assault');
console.log('loadout'.padEnd(44) + POSITIONS.map((p) => p.node.slice(3).padStart(10)).join(''));
for (const [name, units, v, xp, res] of cases) {
  const s = loadout(units, v, xp, res);
  const sq = s.run.marines.squads[0];
  console.log(name.padEnd(44) + POSITIONS.map((p) => { const o = missionOdds(s, sq, 'assault', p.node); return `${o.worst.toFixed(2)}(${o.all.toFixed(2)})`.padStart(10); }).join(''));
}
console.log('patrol');
for (const [name, units, v, xp, res] of cases) {
  const s = loadout(units, v, xp, res);
  const sq = s.run.marines.squads[0];
  console.log(name.padEnd(44) + POSITIONS.map((p) => { const o = missionOdds(s, sq, 'patrol', p.node); return `${o.worst.toFixed(2)}(${o.all.toFixed(2)})`.padStart(10); }).join(''));
}
void MARINE;
