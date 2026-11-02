/** Finds, per node, the enemy scale at which a reference fleet wins a target share of battles. */
import { NODES, SHIP_BY_ID } from '../src/data';
import { makeShip } from '../src/state/fleetState';
import type { Ship } from '../src/state/types';
import { enemyUnits, playerUnit } from '../src/sim/fleet';
import { runBattle } from '../src/sim/combat';

function fleet(n: number, xp: number): Ship[] {
  const def = SHIP_BY_ID.frigate;
  return Array.from({ length: n }, (_, i) => {
    const s = makeShip(def, i + 1, 1, i < 4 ? 'front' : i < 8 ? 'line' : 'rear');
    s.xp = xp;
    return s;
  });
}
function rate(ships: Ship[], idx: number, scale: number, abilities: boolean, n = 80): number {
  const node = { ...NODES[idx], scale };
  let w = 0;
  for (let i = 0; i < n; i++) {
    if (runBattle({ player: ships.map((s) => playerUnit(s)), enemy: enemyUnits(node), stance: 'standard', priority: 'weakest', seed: 500 + i }, { abilities }).outcome === 'victory') w++;
  }
  return w / n;
}
function search(ships: Ship[], idx: number, target: number, abilities: boolean): number {
  let lo = 0.2;
  let hi = 30;
  for (let k = 0; k < 14; k++) {
    const mid = Math.sqrt(lo * hi);
    if (rate(ships, idx, mid, abilities) > target) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}
const plan: { frigates: number; xp: number; abilities: boolean; target: number }[] = [
  { frigates: 1, xp: 0, abilities: false, target: 0.8 },
  { frigates: 2, xp: 0, abilities: false, target: 0.8 },
  { frigates: 3, xp: 0, abilities: false, target: 0.8 },
  { frigates: 4, xp: 0, abilities: false, target: 0.8 },
  { frigates: 6, xp: 0, abilities: false, target: 0.8 },
  { frigates: 8, xp: 3, abilities: false, target: 0.8 },
  { frigates: 11, xp: 12, abilities: false, target: 0.8 },
  { frigates: 13, xp: 40, abilities: true, target: 0.75 },
];
plan.forEach((p, i) => {
  const s = search(fleet(p.frigates, p.xp), i, p.target, p.abilities);
  console.log(`n${i + 1} ${NODES[i].name.padEnd(18)} scale ${s.toFixed(2)}  (${p.frigates} frigates xp ${p.xp}${p.abilities ? ' + abilities' : ''} win ${Math.round(p.target * 100)}%)`);
});
