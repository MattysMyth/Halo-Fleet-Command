/** Win rates of a few fleet builds against each node of a theatre, to tune node scales. Run: npx tsx tools/theatre-probe.ts [theatre] */
import { DOCTRINES, RESEARCH, THEATRES, SHIP_BY_ID } from '../src/data';
import { modsFor, NEUTRAL_MODS } from '../src/sim/modifiers';
import { makeShip } from '../src/state/fleetState';
import { enemyUnits, playerUnit } from '../src/sim/fleet';
import { runBattle } from '../src/sim/combat';

const theatre = THEATRES.find((t) => t.id === Number(process.argv[2] ?? 2)) ?? THEATRES[1];
let next = 1;
const mk = (cls: string, n: number, xp: number) =>
  Array.from({ length: n }, () => {
    const s = makeShip(SHIP_BY_ID[cls], next++, 1, cls === 'frigate' ? 'front' : 'line');
    s.xp = xp;
    return s;
  });
const builds: [string, (xp: number) => ReturnType<typeof mk>][] = [
  ['6 frigates', (xp) => mk('frigate', 6, xp)],
  ['11 frigates', (xp) => mk('frigate', 11, xp)],
  ['1 light+8 frig', (xp) => [...mk('light-cruiser', 1, xp), ...mk('frigate', 8, xp)]],
  ['2 light+5 frig', (xp) => [...mk('light-cruiser', 2, xp), ...mk('frigate', 5, xp)]],
  ['4 light', (xp) => mk('light-cruiser', 4, xp)],
  ['3 light+1 frig', (xp) => [...mk('light-cruiser', 3, xp), ...mk('frigate', 1, xp)]],
  ['2 heavy', (xp) => mk('heavy-cruiser', 2, xp)],
  ['2 heavy+1 light', (xp) => [...mk('heavy-cruiser', 2, xp), ...mk('light-cruiser', 1, xp)]],
  ['2 heavy+1 light+1 fr', (xp) => [...mk('heavy-cruiser', 2, xp), ...mk('light-cruiser', 1, xp), ...mk('frigate', 1, xp)]],
  ['2 heavy+2 light', (xp) => [...mk('heavy-cruiser', 2, xp), ...mk('light-cruiser', 2, xp)]],
  ['3 heavy', (xp) => mk('heavy-cruiser', 3, xp)],
  ['2 carrier', (xp) => mk('carrier', 2, xp)],
  ['3 carrier', (xp) => mk('carrier', 3, xp)],
  ['2 carrier+2 heavy', (xp) => [...mk('carrier', 2, xp), ...mk('heavy-cruiser', 2, xp)]],
  ['2 flag+1 carrier', (xp) => [...mk('flagship', 2, xp), ...mk('carrier', 1, xp)]],
  ['3 flagship', (xp) => mk('flagship', 3, xp)],
  ['3 flag+2 carrier', (xp) => [...mk('flagship', 3, xp), ...mk('carrier', 2, xp)]],
];
const N = 40;
// A fully researched fleet with the first doctrine and a Transfer's worth of Honors, as an upper bound on what a run can field.
const geared = modsFor({ done: RESEARCH.map((r) => r.id), active: [] }, { picked: [DOCTRINES[Number(process.argv[3] ?? 0)].id], cooldown: 0 });
geared.damage += 0.03 * 2;
const MODS = process.argv.includes('--geared') ? geared : NEUTRAL_MODS;
console.log(process.argv.includes('--geared') ? 'fully researched + doctrine ' + DOCTRINES[Number(process.argv[3] ?? 0)].name : 'no research');
for (const xp of [0, 40]) {
  console.log(`\n-- crews at ${xp} xp`);
  console.log('build'.padEnd(18), theatre.nodes.map((n) => n.id.split('-')[1].padEnd(11)).join(' '));
  for (const [label, make] of builds) {
    const row: string[] = [];
    for (const node of theatre.nodes) {
      let w = 0;
      let secs = 0;
      for (let i = 0; i < N; i++) {
        const ships = make(xp);
        const r = runBattle({ player: ships.map((s) => playerUnit(s, MODS)), enemy: enemyUnits(node), stance: 'standard', priority: 'weakest', seed: 500 + i });
        if (r.outcome === 'victory') w++;
        secs += r.seconds;
      }
      row.push(`${String(Math.round((w / N) * 100)).padStart(3)}% ${String(Math.round(secs / N)).padStart(3)}s`.padEnd(11));
    }
    console.log(label.padEnd(18), row.join(' '));
  }
}
