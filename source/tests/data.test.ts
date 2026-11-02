import { describe, expect, it } from 'vitest';
import { ARMORY, BUILDINGS, COMBAT, ECONOMY, ENEMIES, EQUIPMENT, FLEET, SHIPS, THEATRES } from '../src/data';
import { validateFleetData } from '../src/data/fleetSchema';
import type { FleetData } from '../src/data/fleetSchema';
import { validateData } from '../src/data/schema';
import type { ArmoryDef, BuildingDef } from '../src/data/schema';

const fleetData = (): FleetData =>
  structuredClone({ equipment: EQUIPMENT, ships: SHIPS, enemies: ENEMIES, theatres: THEATRES, fleet: FLEET, combat: COMBAT });

describe('game data', () => {
  it('passes validation', () => {
    expect(validateData(BUILDINGS, ARMORY, ECONOMY)).toEqual([]);
    expect(validateFleetData(fleetData())).toEqual([]);
  });

  it('catches the mistakes it is meant to catch', () => {
    const b: BuildingDef[] = [
      { id: 'a', name: 'A', blurb: '', icon: 'a', baseCost: 10, baseOutput: 1, unlock: { kind: 'start' } },
      { id: 'b', name: 'B', blurb: '', icon: 'b', baseCost: 10, baseOutput: 1, unlock: { kind: 'owned', building: 'zzz', count: 1 } },
    ];
    const a: ArmoryDef[] = [
      { id: 'x', name: 'X', description: '', kind: 'autobuy', building: 'a', maxLevel: 2, costs: [1] },
    ];
    const errors = validateData(b, a, ECONOMY);
    expect(errors.some((e) => e.includes('unknown building zzz'))).toBe(true);
    expect(errors.some((e) => e.includes('costs length'))).toBe(true);
  });

  it('rejects an unknown building resource', () => {
    const b = structuredClone(BUILDINGS);
    (b[1] as { resource?: string }).resource = 'plasma';
    expect(validateData(b, ARMORY, ECONOMY).some((e) => e.includes('unknown resource plasma'))).toBe(true);
  });
});

describe('fleet data', () => {
  it('catches broken loadouts, enemies and nodes', () => {
    const d = fleetData();
    d.ships[0].defaultLoadout.weapon = ['mac']; // one weapon for two slots
    d.ships[0].defaultLoadout.defence = ['mac']; // a weapon in a defence slot
    d.theatres[0].nodes[0].enemies = { nobody: 1 };
    d.theatres[0].nodes[2].boss = true; // boss not last
    const errors = validateFleetData(d);
    expect(errors.some((e) => e.includes('default weapon loadout has 1 items for 2 slots'))).toBe(true);
    expect(errors.some((e) => e.includes('is a weapon item in a defence slot'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown enemy nobody'))).toBe(true);
    expect(errors.some((e) => e.includes('the boss must be the last node'))).toBe(true);
  });

  it('catches bad weapon numbers and an unreachable ship unlock', () => {
    const d = fleetData();
    const mac = d.equipment.find((e) => e.id === 'mac');
    if (mac && mac.slot === 'weapon') {
      mac.pen = 2;
      mac.cooldown = 0;
    }
    d.ships[1].unlock = { kind: 'node', node: 'nowhere' };
    const errors = validateFleetData(d);
    expect(errors.some((e) => e.includes('mac: pen must be between 0 and 1'))).toBe(true);
    expect(errors.some((e) => e.includes('mac: cooldown must be positive'))).toBe(true);
    expect(errors.some((e) => e.includes('unlocked by unknown node nowhere'))).toBe(true);
  });

  it('keeps every ship unlock reachable and every enemy used', () => {
    const nodeIds = new Set(THEATRES.flatMap((t) => t.nodes.map((n) => n.id)));
    for (const s of SHIPS) if (s.unlock.kind === 'node') expect(nodeIds.has(s.unlock.node)).toBe(true);
    const used = new Set(THEATRES.flatMap((t) => t.nodes.flatMap((n) => Object.keys(n.enemies))));
    for (const e of ENEMIES) expect(used.has(e.id)).toBe(true);
  });
});
