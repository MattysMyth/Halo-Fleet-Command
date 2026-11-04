/**
 * Building blocks for fleet state: fresh fleets, new ships, and a sanitiser that turns whatever a
 * save contains into a valid FleetState. Shared by the serialiser and the fleet sim.
 */
import { EQUIPMENT_BY_ID, FLEET, NODE_BY_ID, OFFICER_BY_ID, SHIP_BY_ID } from '../data';
import type { ShipClassDef } from '../data';
import { ORDERS, PRIORITIES, ROWS, STANCES } from '../data/fleetSchema';
import type { BuildJob, FleetState, Group, Ship } from './types';

export function defaultGroup(id: number): Group {
  return {
    id,
    name: `Strike Group ${id}`,
    order: 'campaign',
    stance: 'standard',
    priority: 'weakest',
    minIntegrity: FLEET.integrityPresets[1] ?? 0.7,
    autoAbilities: false,
    patrolNode: null,
    stalled: false,
    failStreak: 0,
    officer: null,
  };
}

export function freshFleet(): FleetState {
  return { ships: [], groups: [defaultGroup(1)], queue: [], slips: FLEET.slips.base, nextShipId: 1 };
}

/** A new ship at full hull with the class's default loadout. */
export function makeShip(def: ShipClassDef, id: number, group: number, row: Ship['row']): Ship {
  return {
    id,
    classId: def.id,
    hull: 1,
    xp: 0,
    weapons: [...def.defaultLoadout.weapon],
    defence: [...def.defaultLoadout.defence],
    utility: [...def.defaultLoadout.utility],
    group,
    row,
  };
}

export const maxSlips = (): number => FLEET.slips.base + FLEET.slips.costs.length;

/* ---------- sanitising a saved fleet ---------- */

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
/** Ids stay below 100000, where the battle simulator starts numbering enemy ships. */
const posInt = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x > 0 && x < 100_000 ? x : null);

function cleanSlot(saved: unknown, slot: 'weapon' | 'defence' | 'utility', defaults: string[]): string[] {
  const list = Array.isArray(saved) ? saved : [];
  return defaults.map((fallback, i) => {
    const id = list[i];
    const gear = typeof id === 'string' ? EQUIPMENT_BY_ID[id] : undefined;
    return gear && gear.slot === slot ? gear.id : fallback;
  });
}

export function sanitizeFleet(input: unknown, capacity: number = FLEET.commandCapacity, maxGroups: number = FLEET.maxGroups): FleetState {
  const raw = isObj(input) ? input : {};
  const base = freshFleet();

  // Groups: keep valid ones, always keep at least group 1.
  const groups: Group[] = [];
  const groupIds = new Set<number>();
  if (Array.isArray(raw.groups)) {
    for (const g of raw.groups) {
      if (!isObj(g) || groups.length >= maxGroups) continue;
      const id = posInt(g.id);
      if (id === null || groupIds.has(id)) continue;
      groupIds.add(id);
      const d = defaultGroup(id);
      groups.push({
        id,
        name: typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 32) : d.name,
        order: ORDERS.includes(g.order as Group['order']) ? (g.order as Group['order']) : d.order,
        stance: STANCES.includes(g.stance as Group['stance']) ? (g.stance as Group['stance']) : d.stance,
        priority: PRIORITIES.includes(g.priority as Group['priority']) ? (g.priority as Group['priority']) : d.priority,
        minIntegrity: Math.min(1, Math.max(0.1, num(g.minIntegrity, d.minIntegrity))),
        autoAbilities: g.autoAbilities === true,
        patrolNode: typeof g.patrolNode === 'string' && NODE_BY_ID[g.patrolNode] ? g.patrolNode : null,
        stalled: g.stalled === true,
        failStreak: Math.max(0, Math.floor(num(g.failStreak, 0))),
        officer: typeof g.officer === 'string' && OFFICER_BY_ID[g.officer] && !groups.some((o) => o.officer === g.officer) ? g.officer : null,
      });
    }
  }
  if (groups.length === 0) groups.push(...base.groups);
  groupIds.clear();
  for (const g of groups) groupIds.add(g.id);

  // Ships: known classes only, valid gear for every slot, unique ids, real groups.
  const ships: Ship[] = [];
  const shipIds = new Set<number>();
  const unassigned: Ship[] = [];
  if (Array.isArray(raw.ships)) {
    for (const s of raw.ships) {
      if (!isObj(s) || typeof s.classId !== 'string') continue;
      const def = SHIP_BY_ID[s.classId];
      if (!def) continue;
      const id = posInt(s.id);
      const ship: Ship = {
        id: id !== null && !shipIds.has(id) ? id : -1,
        classId: def.id,
        hull: Math.min(1, Math.max(0, num(s.hull, 1))),
        xp: Math.max(0, Math.floor(num(s.xp, 0))),
        weapons: cleanSlot(s.weapons, 'weapon', def.defaultLoadout.weapon),
        defence: cleanSlot(s.defence, 'defence', def.defaultLoadout.defence),
        utility: cleanSlot(s.utility, 'utility', def.defaultLoadout.utility),
        group: typeof s.group === 'number' && groupIds.has(s.group) ? s.group : 0,
        row: ROWS.includes(s.row as Ship['row']) ? (s.row as Ship['row']) : 'line',
      };
      if (ship.id === -1) unassigned.push(ship);
      else {
        shipIds.add(ship.id);
        ships.push(ship);
      }
    }
  }
  let nextId = Math.max(0, ...shipIds) + 1;
  for (const ship of unassigned) {
    ship.id = nextId++;
    ships.push(ship);
  }

  // A group may not hold more Command than its capacity (data can change between builds).
  const used = new Map<number, number>();
  for (const ship of ships) {
    if (ship.group === 0) continue;
    const next = (used.get(ship.group) ?? 0) + SHIP_BY_ID[ship.classId].command;
    if (next > capacity) ship.group = 0;
    else used.set(ship.group, next);
  }

  const queue: BuildJob[] = [];
  if (Array.isArray(raw.queue)) {
    for (const j of raw.queue) {
      if (!isObj(j) || typeof j.classId !== 'string' || !SHIP_BY_ID[j.classId] || queue.length >= FLEET.queueLimit) continue;
      const total = Math.max(1, num(j.total, SHIP_BY_ID[j.classId].buildSeconds));
      queue.push({ classId: j.classId, total, remaining: Math.min(total, Math.max(0, num(j.remaining, total))) });
    }
  }

  const slips = Math.min(maxSlips(), Math.max(FLEET.slips.base, Math.floor(num(raw.slips, FLEET.slips.base))));
  return { ships, groups, queue, slips, nextShipId: Math.max(nextId, Math.floor(num(raw.nextShipId, 1))) };
}
