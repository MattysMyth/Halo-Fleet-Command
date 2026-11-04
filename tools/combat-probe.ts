/**
 * Prints win rates for sample fleets against each campaign node, so enemy numbers can be tuned.
 *   npx tsx tools/combat-probe.ts
 */
import { NODES, SHIP_BY_ID } from '../src/data';
import { makeShip } from '../src/state/fleetState';
import type { Ship } from '../src/state/types';
import { enemyUnits, playerUnit } from '../src/sim/fleet';
import { runBattle } from '../src/sim/combat';
import type { Priority, Stance } from '../src/data';

function fleet(n: number, classId: string, xp: number, weapons?: string[][]): Ship[] {
  const def = SHIP_BY_ID[classId];
  return Array.from({ length: n }, (_, i) => {
    const s = makeShip(def, i + 1, 1, i < 4 ? 'front' : i < 8 ? 'line' : 'rear');
    s.xp = xp;
    if (weapons) s.weapons = weapons[i % weapons.length];
    return s;
  });
}

function winRate(ships: Ship[], nodeIdx: number, opts: { stance?: Stance; priority?: Priority; abilities?: boolean } = {}): { win: number; secs: number; lost: number } {
  const N = 60;
  let win = 0;
  let secs = 0;
  let lost = 0;
  for (let i = 0; i < N; i++) {
    const r = runBattle(
      { player: ships.map((s) => playerUnit(s)), enemy: enemyUnits(NODES[nodeIdx]), stance: opts.stance ?? 'standard', priority: opts.priority ?? 'weakest', seed: 1000 + i },
      { abilities: opts.abilities },
    );
    if (r.outcome === 'victory') win += 1;
    secs += r.seconds;
    lost += r.player.filter((u) => !u.alive).length;
  }
  return { win: win / N, secs: secs / N, lost: lost / N };
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const configs: { label: string; ships: () => Ship[] }[] = [
  { label: '2 frigates', ships: () => fleet(2, 'frigate', 0) },
  { label: '4 frigates', ships: () => fleet(4, 'frigate', 0) },
  { label: '6 frigates', ships: () => fleet(6, 'frigate', 0) },
  { label: '8 frigates', ships: () => fleet(8, 'frigate', 0) },
  { label: '10 frigates', ships: () => fleet(10, 'frigate', 0) },
  { label: '13 frigates', ships: () => fleet(13, 'frigate', 0) },
  { label: '13 frig reg', ships: () => fleet(13, 'frigate', 3) },
  { label: '13 frig vet', ships: () => fleet(13, 'frigate', 12) },
  { label: '13 frig elite', ships: () => fleet(13, 'frigate', 40) },
  { label: '3 cruisers', ships: () => fleet(3, 'light-cruiser', 0) },
];
console.log('win rate (no abilities / abilities) per node; columns are nodes 1..8');
console.log(' '.repeat(16) + NODES.map((_, i) => `   n${i + 1}    `).join(''));
for (const c of configs) {
  const cells = NODES.map((_, i) => {
    const a = winRate(c.ships(), i);
    const b = winRate(c.ships(), i, { abilities: true });
    return `${pct(a.win)}/${pct(b.win)} `;
  });
  console.log(c.label.padEnd(16) + cells.join(''));
}
