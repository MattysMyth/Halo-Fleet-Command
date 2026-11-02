/** Finds enemy scales that give a reference fleet a falling win rate across a theatre. Run: npx tsx tools/theatre-tune.ts <theatre> <from%> <to%> <ship:count,...> [--write] */
import { writeFileSync } from 'node:fs';
import { DOCTRINES, RESEARCH, SHIP_BY_ID, THEATRES } from '../src/data';
import { modsFor } from '../src/sim/modifiers';
import { makeShip } from '../src/state/fleetState';
import { enemyUnits, playerUnit } from '../src/sim/fleet';
import { runBattle } from '../src/sim/combat';

const tid = Number(process.argv[2]);
const from = Number(process.argv[3]) / 100;
const to = Number(process.argv[4]) / 100;
const spec = process.argv[5].split(',').map((x) => x.split(':'));
const theatre = THEATRES.find((t) => t.id === tid)!;
const mods = modsFor({ done: RESEARCH.map((r) => r.id), active: [] }, { picked: [DOCTRINES[0].id], cooldown: 0 });
mods.damage += 0.03 * 2 * tid;
let id = 1;
const N = 24;
function rate(scale: number, node: (typeof theatre.nodes)[number]): number {
  let w = 0;
  for (let i = 0; i < N; i++) {
    const ships = spec.flatMap(([c, n]) => Array.from({ length: Number(n) }, () => { const s = makeShip(SHIP_BY_ID[c], id++, 1, 'line'); s.xp = 40; return s; }));
    const r = runBattle({ player: ships.map((s) => playerUnit(s, mods)), enemy: enemyUnits({ ...node, scale }), stance: 'standard', priority: 'weakest', seed: 900 + i });
    if (r.outcome === 'victory') w++;
  }
  return w / N;
}
const out: Record<string, number> = {};
theatre.nodes.forEach((node, i) => {
  const target = from + ((to - from) * i) / (theatre.nodes.length - 1);
  let lo = 0.2, hi = 400;
  for (let k = 0; k < 14; k++) {
    const mid = Math.sqrt(lo * hi);
    if (rate(mid, node) > target) lo = mid; else hi = mid;
  }
  const s = Math.round(Math.sqrt(lo * hi) * 10) / 10;
  out[node.id] = s;
  console.log(node.id, 'scale', s, 'rate', rate(s, node).toFixed(2), 'target', target.toFixed(2));
});
if (process.argv.includes('--write')) writeFileSync(`/tmp/claude-0/-home-claude/979319c6-0ce7-5ae3-b6ef-cd6188788c0c/scratchpad/scales-${tid}.json`, JSON.stringify(out));
