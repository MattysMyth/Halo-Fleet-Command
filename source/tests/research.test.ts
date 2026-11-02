import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { ARMORY, NODES, RESEARCH, RESEARCH_DATA, SHIP_BY_ID } from '../src/data';
import { validateResearchData } from '../src/data/researchSchema';
import { createBattle, runBattle, stepBattle } from '../src/sim/combat';
import type { UnitSetup } from '../src/sim/combat';
import { addCapped, capOf, productionMultiplier, storageCap } from '../src/sim/economy';
import { buildSpeed, buildSetup, patrolYield, playerUnit, queueShip, repairShips, shipStats, sortieCost, stepFleet, stepQueue } from '../src/sim/fleet';
import { modsFor, modsOf, NEUTRAL_MODS } from '../src/sim/modifiers';
import { adoptDoctrine, cancelResearch, doctrineProblem, startResearch, stepResearch, syncDoctrineSlots } from '../src/sim/research';
import { applyOfflineWorld } from '../src/sim/world';
import { makeShip } from '../src/state/fleetState';
import { CURRENT_VERSION, migrate } from '../src/state/migrations';
import { sanitizeDoctrine } from '../src/state/researchState';
import { decodeSave, encodeSave, fromRaw, newGameState, toRaw } from '../src/state/serialize';
import type { GameState } from '../src/state/types';

const frigate = SHIP_BY_ID.frigate;

function game(): GameState {
  const s = newGameState(0, 7);
  s.meta.fleetUnlocked = true;
  s.meta.opsUnlocked = true;
  s.run.intel = D(100000);
  s.run.salvage = D(1000);
  s.run.ti = D(100000);
  s.run.deut = D(5000);
  s.run.rp = D(1e9);
  return s;
}

function withShips(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s.run.fleet.ships.push(makeShip(frigate, s.run.fleet.nextShipId++, 1, i < 4 ? 'front' : 'line'));
  return s;
}

const finish = (s: GameState, ...ids: string[]): void => {
  for (const id of ids) {
    expect(startResearch(s, id).ok).toBe(true);
    stepResearch(s, 99999);
  }
};

describe('research data', () => {
  it('passes validation', () => {
    expect(validateResearchData(RESEARCH_DATA)).toEqual([]);
  });

  it('catches broken trees and effects', () => {
    const d = structuredClone(RESEARCH_DATA);
    d.nodes[1].requires = 'ghost';
    d.nodes[2].branch = 'nowhere';
    d.nodes[0].effects = [];
    d.nodes[3].effects = [{ kind: 'damage', amount: -0.1 }];
    d.nodes[4].effects = [{ kind: 'cooldown', amount: 1.5 }];
    d.doctrines[0].effects = [{ kind: 'opening', amount: 0.4, seconds: 0 }];
    d.nodes[5].requires = d.nodes[5].id;
    const errors = validateResearchData(d);
    for (const text of ['requires unknown ghost', 'unknown branch nowhere', 'no effects', 'must be positive', 'must be below 1', 'needs seconds', 'loop']) {
      expect(errors.some((e) => e.includes(text)), text).toBe(true);
    }
  });

  it('keeps every prerequisite inside its branch and gives each branch several projects', () => {
    for (const b of RESEARCH_DATA.branches) expect(RESEARCH.filter((r) => r.branch === b.id).length).toBeGreaterThanOrEqual(5);
    expect(RESEARCH.filter((r) => r.salvage).every((r) => r.branch === 'captured')).toBe(true);
  });
});

describe('research projects', () => {
  it('cost Intel (and Salvage for Captured tech), and need what they require', () => {
    const s = game();
    s.run.intel = D(10);
    expect((startResearch(s, 'bulkheads') as { reason?: string }).reason).toMatch(/Intel/);
    s.run.intel = D(100000);
    expect((startResearch(s, 'ablative') as { reason?: string }).reason).toMatch(/earlier/);
    s.run.salvage = D(0);
    expect((startResearch(s, 'cov-plating') as { reason?: string }).reason).toMatch(/Salvage/);
    s.run.salvage = D(100);
    expect(startResearch(s, 'cov-plating').ok).toBe(true);
    expect(s.run.salvage.toNumber()).toBe(75);
    expect(s.run.intel.toNumber()).toBe(100000 - 150);
  });

  it('run in parallel up to the bays, and a second bay comes from the Armory', () => {
    const s = game();
    expect(startResearch(s, 'bulkheads').ok).toBe(true);
    expect((startResearch(s, 'targeting') as { reason?: string }).reason).toMatch(/bay/);
    const bay = ARMORY.find((a) => a.kind === 'researchQueue')!;
    s.meta.armory[bay.id] = 1;
    expect(startResearch(s, 'targeting').ok).toBe(true);
    expect(s.run.research.active).toHaveLength(2);
    const done: string[] = [];
    stepResearch(s, 91, (e) => done.push(e.def.id));
    expect(done).toEqual(['bulkheads', 'targeting']);
    expect(s.run.research.active).toEqual([]);
  });

  it('are refunded in full when cancelled', () => {
    const s = game();
    s.run.intel = D(500);
    s.run.salvage = D(100);
    startResearch(s, 'cov-plating');
    expect(cancelResearch(s, 'cov-plating').ok).toBe(true);
    expect(s.run.intel.toNumber()).toBe(500);
    expect(s.run.salvage.toNumber()).toBe(100);
    expect(cancelResearch(s, 'cov-plating').ok).toBe(false);
  });

  it('finish while away, at real time', () => {
    const s = game();
    startResearch(s, 'bulkheads');
    const report = applyOfflineWorld(s, 200);
    expect(report.research).toEqual(['Reinforced bulkheads']);
    expect(s.run.research.done).toEqual(['bulkheads']);
  });

  it('reset at Redeploy along with doctrine', async () => {
    const { redeploy } = await import('../src/sim/prestige');
    const s = game();
    finish(s, 'bulkheads');
    adoptDoctrine(s, 0, 'shock');
    s.run.earned = D(1e12);
    expect(redeploy(s)).not.toBeNull();
    expect(s.run.research).toEqual({ done: [], active: [] });
    expect(s.run.doctrine).toEqual({ picked: [null], cooldown: 0 });
    expect(s.run.salvage.toNumber()).toBe(0);
  });
});

describe('doctrine', () => {
  it('is free the first time and costs Intel and an hour afterwards', () => {
    const s = game();
    const intel = s.run.intel.toNumber();
    expect(adoptDoctrine(s, 0, 'defensive').ok).toBe(true);
    expect(s.run.intel.toNumber()).toBe(intel);
    expect(s.run.doctrine.cooldown).toBe(0);
    expect(adoptDoctrine(s, 0, 'shock').ok).toBe(true);
    expect(s.run.intel.toNumber()).toBe(intel - RESEARCH_DATA.config.swapIntel);
    expect(s.run.doctrine.cooldown).toBe(RESEARCH_DATA.config.swapSeconds);
    expect((adoptDoctrine(s, 0, 'attrition') as { reason?: string }).reason).toMatch(/reorganising/);
    stepResearch(s, RESEARCH_DATA.config.swapSeconds);
    expect(adoptDoctrine(s, 0, 'attrition').ok).toBe(true);
  });

  it('refuses unknown doctrines, bad slots, repeats and a swap nobody can pay for', () => {
    const s = game();
    expect(doctrineProblem(s, 0, 'ghost')).toMatch(/Unknown/);
    expect(doctrineProblem(s, 3, 'shock')).toMatch(/slot/);
    adoptDoctrine(s, 0, 'shock');
    expect(doctrineProblem(s, 0, 'shock')).toMatch(/Already/);
    s.run.intel = D(1);
    expect(doctrineProblem(s, 0, 'defensive')).toMatch(/Intel/);
  });

  it('gets a second slot from the Armory, never the same doctrine twice', () => {
    const s = game();
    const college = ARMORY.find((a) => a.kind === 'doctrineSlot')!;
    s.meta.armory[college.id] = 1;
    syncDoctrineSlots(s);
    expect(s.run.doctrine.picked).toHaveLength(2);
    adoptDoctrine(s, 0, 'shock');
    expect(doctrineProblem(s, 1, 'shock')).toMatch(/another slot/);
    expect(adoptDoctrine(s, 1, 'defensive').ok).toBe(true);
    expect(modsOf(s).armour).toBeCloseTo(0.2);
    expect(modsOf(s).damage).toBeCloseTo(-0.1);
  });

  it('is sanitised on load', () => {
    expect(sanitizeDoctrine({ picked: ['shock', 'shock', 'ghost'], cooldown: -5 }, 2)).toEqual({ picked: ['shock', null], cooldown: 0 });
    expect(sanitizeDoctrine(null, 1)).toEqual({ picked: [null], cooldown: 0 });
    expect(sanitizeDoctrine({ picked: ['shock', 'defensive'], cooldown: 1e12 }, 1).cooldown).toBeLessThanOrEqual(86400);
  });
});

describe('modifiers', () => {
  it('start neutral and fold every effect in', () => {
    const none = modsFor({ done: [], active: [] }, { picked: [null], cooldown: 0 });
    expect(none).toEqual(NEUTRAL_MODS);
    const s = game();
    finish(s, 'targeting', 'reloaders', 'warheads', 'bulkheads', 'ablative');
    adoptDoctrine(s, 0, 'shock');
    const m = modsOf(s);
    expect(m.damage).toBeCloseTo(0.16);
    expect(m.cooldown).toBeCloseTo(0.92);
    expect(m.hull).toBeCloseTo(0.08 - 0.1);
    expect(m.armour).toBeCloseTo(0.1);
    expect(m.opening).toEqual({ mult: 1.4, seconds: 10 });
  });

  it('change a ship\'s stats, with the shield a share of the hull', () => {
    const s = withShips(game(), 1);
    const ship = s.run.fleet.ships[0];
    const base = shipStats(ship);
    expect(base.shield).toBe(0);
    finish(s, 'bulkheads', 'targeting', 'reloaders', 'cov-plating', 'plasma-sinks');
    const st = shipStats(ship, modsOf(s));
    expect(st.maxHull).toBeCloseTo(base.maxHull * 1.08);
    expect(st.armour).toBeCloseTo(base.armour * 1.12);
    expect(st.damageMult).toBeCloseTo(base.damageMult * 1.06);
    expect(st.weapons[0].cooldown).toBeCloseTo(base.weapons[0].cooldown * 0.92);
    expect(st.shield).toBeCloseTo(st.maxHull * 0.08);
    const unit = playerUnit(ship, modsOf(s));
    expect(unit.shield).toBe(unit.maxShield);
    expect(unit.regen).toBeDefined();
    expect(playerUnit(ship).regen).toBeUndefined();
  });

  it('speed up the drydock, with a floor', () => {
    const s = game();
    expect(buildSpeed(s)).toBe(1);
    finish(s, 'bulkheads', 'automation');
    expect(buildSpeed(s)).toBeCloseTo(1.2);
    const a = game();
    finish(a, 'bulkheads', 'automation');
    queueShip(a, 'frigate');
    stepQueue(a, SHIP_BY_ID.frigate.buildSeconds / 1.2 + 0.01);
    expect(a.run.fleet.ships).toHaveLength(1);
    const slow = game();
    slow.run.doctrine.picked = ['marines-first'];
    expect(buildSpeed(slow)).toBeCloseTo(0.9);
    expect(buildSpeed({ meta: { honorsEarned: 0 }, run: { research: { done: [], active: [] }, doctrine: { picked: [null], cooldown: 0 } } } as unknown as GameState)).toBe(1);
  });

  it('cut sortie costs, speed repairs, and raise storage and production', () => {
    const s = withShips(game(), 4);
    const before = sortieCost(s, 1);
    finish(s, 'chains', 'depots', 'burns', 'dockyards');
    expect(sortieCost(s, 1)).toBe(Math.round(before * 0.85));
    expect(productionMultiplier(s)).toBeCloseTo(productionMultiplier(game()) * 1.05);
    expect(capOf(s, 'ti')).toBe(Math.floor(storageCap('ti') * 1.25));
    expect(capOf(s, 'salvage')).toBeGreaterThan(storageCap('salvage'));
    const ship = s.run.fleet.ships[0];
    ship.hull = 0.5;
    repairShips(s, 1, 10, 0.01);
    expect(ship.hull).toBeCloseTo(0.5 + 0.1 * 1.4);
  });

  it('cap Salvage and grow with the storage bonus', () => {
    const s = game();
    s.run.salvage = D(0);
    addCapped(s, 'salvage', D(1e9));
    expect(s.run.salvage.toNumber()).toBe(storageCap('salvage'));
  });

  it('pay more from Patrol and Salvage, and less from attrition-less campaigns', () => {
    const node = NODES[3];
    const base = patrolYield(node, NEUTRAL_MODS);
    expect(base).toEqual({ ti: node.patrol.ti, deut: node.patrol.deut, salvage: node.patrol.salvage });
    const s = game();
    finish(s, 'cov-plating', 'reclaimers', 'chains', 'burns', 'convoys');
    const up = patrolYield(node, modsOf(s));
    expect(up.ti).toBeCloseTo(node.patrol.ti * 1.2);
    expect(up.salvage).toBe(Math.round(node.patrol.salvage * 1.2 * 1.3));
    expect(up.deut).toBe(node.patrol.deut);
    expect(patrolYield(NODES[0], NEUTRAL_MODS).salvage).toBeGreaterThanOrEqual(1);
  });
});

describe('salvage and rewards in battle', () => {
  const sortie = (s: GameState, order: 'campaign' | 'patrol' = 'campaign'): void => {
    s.run.fleet.groups[0].order = order;
    for (let t = 0; t < 900 && s.meta.battles.total === 0; t += 0.5) stepFleet(s, 0.5);
  };

  it('a first Campaign clear pays Salvage, boosted by the first-clear multiplier', () => {
    const s = withShips(game(), 8);
    s.run.salvage = D(0);
    sortie(s);
    expect(s.meta.cleared[NODES[0].id]).toBe(1);
    expect(s.run.salvage.toNumber()).toBeGreaterThan(NODES[0].reward.salvage - 1);
  });

  it('Patrol pays Salvage on a cleared node', () => {
    const s = withShips(game(), 8);
    s.meta.cleared[NODES[0].id] = 1;
    s.run.salvage = D(0);
    sortie(s, 'patrol');
    expect(s.run.salvage.toNumber()).toBe(NODES[0].patrol.salvage);
  });

  it('Campaign rewards follow the reward bonus, Salvage follows the Salvage bonus', () => {
    const plain = withShips(game(), 8);
    sortie(plain);
    const boosted = withShips(game(), 8);
    boosted.run.doctrine.picked = ['attrition']; // -15% campaign rewards
    sortie(boosted);
    const gain = (s: GameState) => s.run.earned.toNumber();
    expect(gain(boosted)).toBeCloseTo(gain(plain) * 0.85, 0);
  });

  it('offline Patrol brings back Salvage', () => {
    const s = withShips(game(), 10);
    s.meta.cleared[NODES[0].id] = 1;
    s.run.fleet.groups[0].order = 'patrol';
    s.run.salvage = D(0);
    const report = applyOfflineWorld(s, 3600);
    expect(report.fleet.patrols[0].salvage).toBeGreaterThan(0);
    expect(s.run.salvage.toNumber()).toBeGreaterThan(0);
  });
});

describe('opening bonus in combat', () => {
  const unit = (over: Partial<UnitSetup>): UnitSetup => ({
    id: 1, side: 'player', name: 'A', defId: 'frigate', row: 'front', command: 1, hull: 1e9, maxHull: 1e9, shield: 0, maxShield: 0, armour: 0,
    speed: 1, damageMult: 1, weapons: [{ id: 'w', name: 'w', type: 'kinetic', reach: 'long', shots: 1, damage: 100, cooldown: 1, pen: 1, accuracy: 1 }],
    pd: 0, prefer: 'long', ...over,
  });
  const dealt = (opening?: { mult: number; seconds: number }): number => {
    const b = createBattle({ player: [unit({})], enemy: [unit({ id: 2, side: 'enemy' })], stance: 'standard', priority: 'weakest', seed: 3, opening });
    while (b.time < 20) stepBattle(b);
    return b.units[0].dealt;
  };

  it('raises damage only while it lasts', () => {
    const plain = dealt();
    const boosted = dealt({ mult: 1.4, seconds: 10 });
    expect(boosted).toBeGreaterThan(plain * 1.15);
    expect(boosted).toBeLessThan(plain * 1.4);
  });

  it('is carried into the group\'s battle setup', () => {
    const s = withShips(game(), 4);
    s.run.doctrine.picked = ['shock'];
    const setup = buildSetup(s, s.run.fleet.groups[0], NODES[0], 1)!;
    expect(setup.opening).toEqual({ mult: 1.4, seconds: 10 });
    expect(buildSetup(withShips(game(), 4), s.run.fleet.groups[0], NODES[0], 1)!.opening).toBeUndefined();
  });

  it('never changes the shape of a plain battle', () => {
    const run = () => runBattle({ player: [unit({})], enemy: [unit({ id: 2, side: 'enemy', hull: 5000, maxHull: 5000 })], stance: 'standard', priority: 'weakest', seed: 9 });
    expect(run()).toEqual(run());
  });
});

describe('saves', () => {
  it('migrate from version 3, moving field research into the new state', () => {
    const v3 = {
      version: 3,
      run: { rp: '10', marines: { squads: [], nextMarineId: 1, scouted: {}, research: { done: ['optics'], active: { id: 'plates', remaining: 40 } } } },
      meta: {},
    };
    const out = migrate(v3)!;
    expect(out.version).toBe(CURRENT_VERSION);
    const run = out.run as Record<string, any>;
    expect(run.research).toEqual({ done: ['optics'], active: [{ id: 'plates', remaining: 40 }] });
    expect(run.marines.research).toBeUndefined();
    expect(run.salvage).toBe('0');
    expect(run.doctrine).toEqual({ picked: [null], cooldown: 0 });
    const s = fromRaw(v3)!;
    expect(s.run.research.done).toEqual(['optics']);
    expect(s.run.research.active).toEqual([{ id: 'plates', remaining: 40 }]);
  });

  it('round-trip research, doctrine and Salvage', () => {
    const s = game();
    finish(s, 'bulkheads', 'targeting');
    startResearch(s, 'ablative');
    adoptDoctrine(s, 0, 'logistics-corps');
    s.run.salvage = D(123);
    const back = decodeSave(encodeSave(s))!;
    expect(back.run.research.done.sort()).toEqual(['bulkheads', 'targeting']);
    expect(back.run.research.active.map((p) => p.id)).toEqual(['ablative']);
    expect(back.run.doctrine.picked).toEqual(['logistics-corps']);
    expect(back.run.salvage.toNumber()).toBe(123);
  });

  it('survive hostile research and Salvage values', () => {
    const raw = toRaw(game()) as any;
    raw.run.salvage = '1e99';
    raw.run.research = { done: ['constructor', 'ablative', 7], active: 'x' };
    raw.run.doctrine = { picked: ['__proto__'], cooldown: 'soon' };
    const s = fromRaw(raw)!;
    expect(s.run.salvage.toNumber()).toBe(storageCap('salvage'));
    expect(s.run.research).toEqual({ done: [], active: [] });
    expect(s.run.doctrine).toEqual({ picked: [null], cooldown: 0 });
  });

  it('keep Intel above the base cap when storage research is done', () => {
    const s = game();
    finish(s, 'chains', 'depots');
    s.run.ti = D(storageCap('ti') * 1.2);
    const back = fromRaw(toRaw(s))!;
    expect(back.run.ti.toNumber()).toBeCloseTo(storageCap('ti') * 1.2);
  });
});
