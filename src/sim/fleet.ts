/**
 * Fleet management: the drydock, strike groups and their standing orders, and everything that
 * turns a group's orders into battles, rewards and repairs.
 *
 * Like the rest of src/sim this works on GameState in place and knows nothing about the UI.
 * Battles themselves are fought by sim/combat.ts; this file builds their setups from ships,
 * steps live battles, and settles the results.
 */
import { D, Decimal, ZERO } from '../core/numbers';
import { createRng } from '../core/rng';
import {
  COMBAT,
  ENEMY_BY_ID,
  EQUIPMENT_BY_ID,
  FLEET,
  MARINE,
  NODE_BY_ID,
  RESEARCH_CONFIG,
  SHIP_BY_ID,
} from '../data';
import type { EnemyDef, NodeDef, Order, Priority, RankDef, Row, ShipClassDef, Stance, WeaponDef } from '../data';
import { defaultGroup, makeShip, maxSlips } from '../state/fleetState';
import type { GameState, Group, GroupResult, GroupRuntime, Ship } from '../state/types';
import {
  activate,
  autoAbilities,
  createBattle,
  resultOf,
  runBattle,
  stepBattle,
} from './combat';
import type { AbilityId, BattleSetup, UnitResult, UnitSetup } from './combat';
import { commandCapacity, defaultPatrol, everCleared, groupsUnlocked, isCleared, isShipUnlocked, nextCampaignNode, nodeById } from './campaign';
import { addCapped, capOf, storageCap } from './economy';
import { spawnBoarding } from './incidents';
import type { IncidentEvent } from './incidents';
import { modsOf, NEUTRAL_MODS } from './modifiers';
import { assignOfficer, groupMods } from './officers';
import type { Mods } from './modifiers';

/* ---------- events ---------- */

export type FleetEvent =
  | { kind: 'fleet-unlocked' }
  | { kind: 'launch'; ship: Ship; className: string; group: number }
  | { kind: 'sortie'; group: Group; node: NodeDef }
  | { kind: 'battle'; group: Group; result: GroupResult; nodeName: string }
  | { kind: 'cleared'; node: NodeDef; boss: boolean; unlocks: ShipClassDef[] }
  | { kind: 'rank'; ship: Ship; rank: RankDef }
  | { kind: 'stalled'; group: Group }
  | { kind: 'group'; group: Group }
  | IncidentEvent;

export type Emit = (e: FleetEvent) => void;

/* ---------- lookups and derived stats ---------- */

export const classOf = (ship: Ship): ShipClassDef => SHIP_BY_ID[ship.classId];

export const shipsOf = (state: GameState, groupId: number): Ship[] =>
  state.run.fleet.ships.filter((s) => s.group === groupId);

export const groupById = (state: GameState, id: number): Group | undefined =>
  state.run.fleet.groups.find((g) => g.id === id);

export const shipName = (ship: Ship): string => `${classOf(ship).name} ${ship.id}`;

/** Command points used by the ships in a group (crippled ships still take their place). */
export const groupCommand = (state: GameState, groupId: number): number =>
  shipsOf(state, groupId).reduce((n, s) => n + classOf(s).command, 0);

export function rankIndex(xp: number): number {
  let idx = 0;
  FLEET.ranks.forEach((r, i) => {
    if (xp >= r.xp) idx = i;
  });
  return idx;
}

export const rankOf = (xp: number): RankDef => FLEET.ranks[rankIndex(xp)];

/** Combat stats of a ship at full hull, with its loadout and crew rank applied. */
export interface ShipStats {
  maxHull: number;
  armour: number;
  damageMult: number;
  pd: number;
  speed: number;
  command: number;
  weapons: WeaponDef[];
  /** Shield points at the start of a battle (from Captured tech). */
  shield: number;
}

export function shipStats(ship: Ship, mods: Mods = NEUTRAL_MODS): ShipStats {
  const def = classOf(ship);
  const bonus = rankOf(ship.xp).bonus;
  let hullMult = 1;
  let armourMult = 1;
  let damageMult = def.damageMult;
  let pd = 0;
  for (const id of [...ship.defence, ...ship.utility]) {
    const m = EQUIPMENT_BY_ID[id];
    if (!m || m.slot === 'weapon') continue;
    pd += m.pd ?? 0;
    armourMult *= m.armourMult ?? 1;
    hullMult *= m.hullMult ?? 1;
    damageMult *= m.damageMult ?? 1;
  }
  let weapons = ship.weapons.map((id) => EQUIPMENT_BY_ID[id]).filter((g): g is WeaponDef => g?.slot === 'weapon');
  if (mods.cooldown !== 1) weapons = weapons.map((w) => ({ ...w, cooldown: w.cooldown * mods.cooldown }));
  const maxHull = Math.max(1, def.hull * hullMult * (1 + bonus) * (1 + mods.hull));
  return {
    maxHull,
    armour: def.armour * armourMult * (1 + mods.armour),
    damageMult: damageMult * (1 + bonus) * Math.max(0, 1 + mods.damage),
    pd,
    speed: def.speed,
    command: def.command,
    weapons,
    shield: maxHull * mods.shield,
  };
}

/** Command-weighted hull of a group, 0 to 1. Crippled and missing ships count as zero. */
export function integrityOf(state: GameState, groupId: number): number {
  const ships = shipsOf(state, groupId);
  const total = ships.reduce((n, s) => n + classOf(s).command, 0);
  if (total === 0) return 0;
  return ships.reduce((n, s) => n + classOf(s).command * s.hull, 0) / total;
}

/* ---------- runtime ---------- */

export function runtimeOf(state: GameState, groupId: number): GroupRuntime {
  let rt = state.run.live[groupId];
  if (!rt) {
    rt = { battle: null, node: null, acc: 0, rest: 0, last: null, waiting: null };
    state.run.live[groupId] = rt;
  }
  return rt;
}

const inBattle = (state: GameState, groupId: number): boolean => groupId !== 0 && runtimeOf(state, groupId).battle !== null;

/* ---------- battle setups ---------- */

export function playerUnit(ship: Ship, mods: Mods = NEUTRAL_MODS): UnitSetup {
  const stats = shipStats(ship, mods);
  const def = classOf(ship);
  return {
    id: ship.id,
    side: 'player',
    name: shipName(ship),
    defId: def.id,
    row: ship.row,
    command: def.command,
    hull: stats.maxHull * ship.hull,
    maxHull: stats.maxHull,
    shield: stats.shield,
    maxShield: stats.shield,
    ...(stats.shield > 0 ? { regen: RESEARCH_CONFIG.shield } : {}),
    armour: stats.armour,
    speed: stats.speed,
    damageMult: stats.damageMult,
    weapons: stats.weapons,
    pd: stats.pd,
    prefer: 'long',
    shipId: ship.id,
  };
}

const ENEMY_ID_BASE = 100_000;

/** The enemy fleet for a node. A node's scale multiplies enemy hull and shields, and damage by its square root. */
export function enemyUnits(node: NodeDef): UnitSetup[] {
  const scale = node.scale ?? 1;
  const out: UnitSetup[] = [];
  let id = ENEMY_ID_BASE;
  for (const [defId, count] of Object.entries(node.enemies)) {
    const def: EnemyDef = ENEMY_BY_ID[defId];
    for (let i = 0; i < count; i++) {
      out.push({
        id: id++,
        side: 'enemy',
        name: count > 1 ? `${def.name} ${i + 1}` : def.name,
        defId: def.id,
        row: 'line',
        command: def.command,
        hull: def.hull * scale,
        maxHull: def.hull * scale,
        shield: def.shield * scale,
        maxShield: def.shield * scale,
        armour: def.armour,
        speed: def.speed,
        damageMult: Math.sqrt(scale),
        weapons: def.weapons,
        pd: def.pd ?? 0,
        prefer: def.prefer,
        regen: def.regen,
        tags: def.tags,
      });
    }
  }
  return out;
}

export function battleSeed(state: GameState, groupId: number, salt = 0): number {
  const n = state.meta.battles.total + 1 + salt;
  return (state.seed ^ Math.imul(n, 0x9e3779b1) ^ Math.imul(groupId + 1, 0x85ebca6b)) >>> 0;
}

/** Ships in a group that can fight (not crippled). */
export const fitShips = (state: GameState, groupId: number): Ship[] => shipsOf(state, groupId).filter((s) => s.hull > 0);

export function buildSetup(state: GameState, group: Group, node: NodeDef, seed: number): BattleSetup | null {
  const ships = fitShips(state, group.id);
  if (ships.length === 0) return null;
  const mods = groupMods(state, group);
  return {
    player: ships.map((s) => playerUnit(s, mods)),
    enemy: enemyUnits(node),
    stance: group.stance,
    priority: group.priority,
    seed,
    ...(mods.opening ? { opening: mods.opening } : {}),
  };
}

/* ---------- targets and costs ---------- */

/** The node a group's current order would send it to, or null with the reason it has none. */
export function targetNode(state: GameState, group: Group): { node: NodeDef | null; why: string | null } {
  if (group.order === 'reserve') return { node: null, why: 'In reserve' };
  if (group.order === 'support') return { node: null, why: 'Supporting the marines' };
  if (group.order === 'campaign') {
    const next = nextCampaignNode(state.meta);
    return next ? { node: next, why: null } : { node: null, why: 'Campaign complete. Set a Patrol.' };
  }
  const chosen = group.patrolNode && everCleared(state.meta, group.patrolNode) ? nodeById(group.patrolNode) : undefined;
  const node = chosen ?? defaultPatrol(state.meta);
  return node ? { node, why: null } : { node: null, why: 'Clear a sector before patrolling' };
}

export function sortieCost(state: GameState, groupId: number): number {
  const base = fitShips(state, groupId).reduce((n, s) => n + classOf(s).command, 0) * FLEET.sortie.deutPerCommand;
  return Math.max(base > 0 ? 1 : 0, Math.round(base * groupMods(state, groupById(state, groupId)).sortie));
}

/* ---------- drydock ---------- */

export type Result = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): Result => ({ ok: false, reason });
const OK: Result = { ok: true };

export function slipCost(state: GameState): number | null {
  const i = state.run.fleet.slips - FLEET.slips.base;
  return i >= 0 && i < FLEET.slips.costs.length ? FLEET.slips.costs[i] : null;
}

export function buySlip(state: GameState): Result {
  const cost = slipCost(state);
  if (cost === null || state.run.fleet.slips >= maxSlips()) return fail('Every slip is built');
  if (state.run.rp.lt(cost)) return fail('Not enough Requisition');
  state.run.rp = state.run.rp.sub(cost);
  state.run.fleet.slips += 1;
  return OK;
}

export function canQueue(state: GameState, classId: string): Result {
  const def = SHIP_BY_ID[classId];
  if (!def) return fail('Unknown ship');
  if (!isShipUnlocked(state.meta, def)) return fail('Not unlocked');
  if (state.run.fleet.queue.length >= FLEET.queueLimit) return fail('The build queue is full');
  if (state.run.rp.lt(def.cost.rp)) return fail('Not enough Requisition');
  if (state.run.ti.lt(def.cost.ti)) return fail('Not enough Titanium-A');
  return OK;
}

/** Pay for a hull and put it in the queue. Resources are spent now and refunded if the job is cancelled. */
export function queueShip(state: GameState, classId: string): Result {
  const check = canQueue(state, classId);
  if (!check.ok) return check;
  const def = SHIP_BY_ID[classId];
  state.run.rp = state.run.rp.sub(def.cost.rp);
  state.run.ti = state.run.ti.sub(def.cost.ti);
  state.run.fleet.queue.push({ classId, remaining: def.buildSeconds, total: def.buildSeconds });
  return OK;
}

export function cancelJob(state: GameState, index: number): Result {
  const job = state.run.fleet.queue[index];
  if (!job) return fail('No such job');
  const def = SHIP_BY_ID[job.classId];
  state.run.fleet.queue.splice(index, 1);
  state.run.rp = state.run.rp.add(def.cost.rp);
  addCapped(state, 'ti', D(def.cost.ti));
  return OK;
}

export const defaultRow = (shipsInGroup: number): Row => (shipsInGroup < 4 ? 'front' : shipsInGroup < 8 ? 'line' : 'rear');

/** The first group with room for a ship, or 0 (the hangar) when every group is full. */
export function groupWithRoom(state: GameState, def: ShipClassDef): number {
  const capacity = commandCapacity(state.meta);
  for (const g of state.run.fleet.groups) {
    if (groupCommand(state, g.id) + def.command <= capacity) return g.id;
  }
  return 0;
}

function launch(state: GameState, classId: string, emit?: Emit): Ship {
  const def = SHIP_BY_ID[classId];
  const fleet = state.run.fleet;
  const group = groupWithRoom(state, def);
  const ship = makeShip(def, fleet.nextShipId++, group, defaultRow(shipsOf(state, group).length));
  ship.xp = state.meta.cadreXp;
  fleet.ships.push(ship);
  emit?.({ kind: 'launch', ship, className: def.name, group });
  return ship;
}

/** How fast the drydock works: research and doctrine, never below the configured floor. */
export const buildSpeed = (state: GameState): number => Math.max(RESEARCH_CONFIG.minBuildSpeed, 1 + modsOf(state).build);

/** Progress the build queue: the first `slips` jobs are worked in parallel. */
export function stepQueue(state: GameState, dt: number, emit?: Emit): void {
  const fleet = state.run.fleet;
  let left = dt * buildSpeed(state);
  // Advance to each completion in turn, so time left over after a launch goes to the next job.
  while (left > 1e-9 && fleet.queue.length > 0) {
    const active = Math.min(fleet.slips, fleet.queue.length);
    let slice = left;
    for (let i = 0; i < active; i++) slice = Math.min(slice, Math.max(0, fleet.queue[i].remaining));
    const done: number[] = [];
    for (let i = 0; i < active; i++) {
      const job = fleet.queue[i];
      job.remaining -= slice;
      if (job.remaining <= 1e-9) done.push(i);
    }
    for (let k = done.length - 1; k >= 0; k--) {
      const [job] = fleet.queue.splice(done[k], 1);
      launch(state, job.classId, emit);
    }
    left -= slice;
    if (slice <= 0 && done.length === 0) break;
  }
}

/** Scrap a ship for half its Titanium back. */
export function decommission(state: GameState, shipId: number): Result {
  const fleet = state.run.fleet;
  const i = fleet.ships.findIndex((s) => s.id === shipId);
  if (i === -1) return fail('No such ship');
  const ship = fleet.ships[i];
  if (inBattle(state, ship.group)) return fail('The group is in battle');
  addCapped(state, 'ti', D(classOf(ship).cost.ti * 0.5));
  fleet.ships.splice(i, 1);
  return OK;
}

/* ---------- ships and groups ---------- */

export function assignShip(state: GameState, shipId: number, groupId: number): Result {
  const ship = state.run.fleet.ships.find((s) => s.id === shipId);
  if (!ship) return fail('No such ship');
  if (ship.group === groupId) return OK;
  if (groupId !== 0 && !groupById(state, groupId)) return fail('No such group');
  if (inBattle(state, ship.group) || inBattle(state, groupId)) return fail('The group is in battle');
  if (groupId !== 0 && groupCommand(state, groupId) + classOf(ship).command > commandCapacity(state.meta)) {
    return fail('Not enough Command capacity');
  }
  ship.group = groupId;
  ship.row = defaultRow(shipsOf(state, groupId).length - 1);
  return OK;
}

export function setRow(state: GameState, shipId: number, row: Row): Result {
  const ship = state.run.fleet.ships.find((s) => s.id === shipId);
  if (!ship) return fail('No such ship');
  if (inBattle(state, ship.group)) return fail('The group is in battle');
  ship.row = row;
  return OK;
}

/** Swap the equipment in one slot. Free, but only while the ship is docked. */
export function refit(state: GameState, shipId: number, slot: 'weapon' | 'defence' | 'utility', index: number, equipId: string): Result {
  const ship = state.run.fleet.ships.find((s) => s.id === shipId);
  if (!ship) return fail('No such ship');
  if (inBattle(state, ship.group)) return fail('The group is in battle');
  const gear = EQUIPMENT_BY_ID[equipId];
  if (!gear || gear.slot !== slot) return fail('That does not fit this slot');
  const list = slot === 'weapon' ? ship.weapons : slot === 'defence' ? ship.defence : ship.utility;
  if (index < 0 || index >= list.length) return fail('No such slot');
  list[index] = equipId;
  return OK;
}

const withGroup = (state: GameState, groupId: number, fn: (g: Group) => void): Result => {
  const g = groupById(state, groupId);
  if (!g) return fail('No such group');
  fn(g);
  return OK;
};

const clearStall = (g: Group): void => {
  g.stalled = false;
  g.failStreak = 0;
};

export const setOrder = (state: GameState, id: number, order: Order): Result =>
  withGroup(state, id, (g) => {
    g.order = order;
    clearStall(g);
  });
export const setOfficer = (state: GameState, id: number, officer: string | null): Result => {
  const r = assignOfficer(state, id, officer);
  return r.ok ? OK : fail(r.reason);
};
export const setStance = (state: GameState, id: number, stance: Stance): Result => withGroup(state, id, (g) => void (g.stance = stance));
export const setPriority = (state: GameState, id: number, priority: Priority): Result =>
  withGroup(state, id, (g) => void (g.priority = priority));
export const setMinIntegrity = (state: GameState, id: number, v: number): Result =>
  withGroup(state, id, (g) => void (g.minIntegrity = Math.min(1, Math.max(0.1, v))));
export const setAutoAbilities = (state: GameState, id: number, on: boolean): Result =>
  withGroup(state, id, (g) => void (g.autoAbilities = on));
export const setPatrolNode = (state: GameState, id: number, node: string | null): Result =>
  withGroup(state, id, (g) => {
    g.patrolNode = node && NODE_BY_ID[node] ? node : null;
    clearStall(g);
  });
export const resumeGroup = (state: GameState, id: number): Result => withGroup(state, id, clearStall);
export const renameGroup = (state: GameState, id: number, name: string): Result =>
  withGroup(state, id, (g) => void (g.name = name.trim().slice(0, 32) || g.name));

/* ---------- abilities ---------- */

export function abilityCost(id: AbilityId): number {
  return COMBAT.abilities[id].deut;
}

/** Use an ability in a group's live battle, paying its Deuterium. Returns false if it could not be used. */
export function useAbility(state: GameState, groupId: number, id: AbilityId, target?: number): boolean {
  const battle = state.run.live[groupId]?.battle;
  if (!battle || battle.outcome) return false;
  const cost = abilityCost(id);
  if (state.run.deut.lt(cost)) return false;
  if (!activate(battle, id, target)) return false;
  state.run.deut = state.run.deut.sub(cost);
  return true;
}

/** At Redeploy the best crew trains the next generation: new crews start with a share of its experience. */
export function updateCadre(state: GameState): void {
  const best = state.run.fleet.ships.reduce((n, s) => Math.max(n, s.xp), 0);
  const seeded = Math.min(FLEET.cadre.cap, Math.floor(best * FLEET.cadre.share));
  state.meta.cadreXp = Math.max(state.meta.cadreXp, seeded);
}

/* ---------- repair ---------- */

/** Repair ships docked in `groupId` (0 is the hangar) over `seconds`, paying Titanium. Returns Titanium spent. */
export function repairShips(state: GameState, groupId: number, seconds: number, rate?: number): number {
  const group = groupById(state, groupId);
  const base = rate ?? (groupId === 0 || group?.order === 'reserve' ? FLEET.repair.reservePerSecond : FLEET.repair.fieldPerSecond);
  const perSecond = base * (1 + groupMods(state, group).repair);
  let spent = 0;
  for (const ship of shipsOf(state, groupId)) {
    if (ship.hull >= 1) continue;
    const perHull = classOf(ship).repairTi;
    let amount = Math.min(1 - ship.hull, perSecond * seconds);
    if (perHull > 0) {
      const afford = state.run.ti.div(perHull).toNumber();
      amount = Math.min(amount, afford);
    }
    if (amount <= 1e-9) continue;
    const cost = amount * perHull;
    state.run.ti = Decimal.max(0, state.run.ti.sub(cost));
    ship.hull = Math.min(1, ship.hull + amount);
    if (1 - ship.hull < 1e-9) ship.hull = 1;
    spent += cost;
  }
  return spent;
}

/* ---------- sorties and results ---------- */

function describeWaiting(state: GameState, group: Group, rt: GroupRuntime): string | null {
  if (group.order === 'reserve') return 'In reserve';
  if (group.order === 'support') return 'Supporting the marines';
  if (group.stalled) return 'Stalled after repeated defeats';
  const { node, why } = targetNode(state, group);
  if (!node) return why;
  const fit = fitShips(state, group.id);
  if (shipsOf(state, group.id).length === 0) return 'No ships assigned';
  if (fit.length === 0) return state.run.ti.lte(0) ? 'Crippled. Awaiting Titanium' : 'Repairing';
  const integrity = integrityOf(state, group.id);
  if (integrity < group.minIntegrity) return state.run.ti.lte(0) ? 'Awaiting Titanium for repairs' : 'Repairing';
  const cost = sortieCost(state, group.id);
  if (state.run.deut.lt(cost)) return `Awaiting Deuterium (${cost} needed)`;
  if (rt.rest > 0) return 'Rearming';
  return null;
}

function startSortie(state: GameState, group: Group, rt: GroupRuntime, node: NodeDef, emit?: Emit): void {
  const seed = battleSeed(state, group.id);
  const setup = buildSetup(state, group, node, seed);
  if (!setup) return;
  const cost = sortieCost(state, group.id);
  state.run.deut = state.run.deut.sub(cost);
  rt.battle = createBattle(setup);
  rt.node = node.id;
  rt.order = group.order;
  rt.paid = cost;
  rt.acc = 0;
  rt.waiting = null;
  emit?.({ kind: 'sortie', group, node });
}

function trySortie(state: GameState, group: Group, rt: GroupRuntime, emit?: Emit): void {
  rt.waiting = describeWaiting(state, group, rt);
  if (rt.waiting !== null) return;
  const { node } = targetNode(state, group);
  if (node) startSortie(state, group, rt, node, emit);
}

/** After a win, offer a boarding action on each enemy ship left broken and drifting, up to the limit per battle. */
function offerBoarding(state: GameState, node: NodeDef, order: Order, enemy: UnitResult[], emit?: Emit): void {
  const c = MARINE.incidents;
  const chance = order === 'campaign' ? c.boardChance.campaign : order === 'patrol' ? c.boardChance.patrol : 0;
  if (chance <= 0) return;
  const wrecks = enemy
    .filter((u) => u.alive && u.hull > 0 && u.hull / u.maxHull < c.wreckBelow)
    .sort((a, b) => (ENEMY_BY_ID[b.defId]?.command ?? 0) - (ENEMY_BY_ID[a.defId]?.command ?? 0))
    .slice(0, c.wrecksPerBattle);
  if (wrecks.length === 0) return;
  const rng = createRng((state.seed ^ Math.imul(state.meta.battles.total + 1, 0x9e3779b1)) >>> 0);
  for (const w of wrecks) if (rng.next() < chance) spawnBoarding(state, node.id, w.defId, emit);
}

/** A hull handed to the fleet outside the drydock (a captured wreck, refitted). Returns the ship, or null for an unknown class. */
export function grantShip(state: GameState, classId: string, hullShare: number, emit?: Emit): Ship | null {
  if (!SHIP_BY_ID[classId]) return null;
  const ship = launch(state, classId, emit);
  ship.hull = Math.min(1, Math.max(0.01, hullShare));
  return ship;
}

/** Salvage from a base amount: research and doctrine raise it, and a win always yields something. */
export function salvageAmount(base: number, mods: Mods): number {
  return base > 0 ? Math.max(1, Math.round(base * (1 + mods.salvage))) : 0;
}

/** What a Patrol win pays. */
export function patrolYield(node: NodeDef, mods: Mods): { ti: number; deut: number; salvage: number } {
  const k = Math.max(0, 1 + mods.patrol);
  return { ti: node.patrol.ti * k, deut: node.patrol.deut, salvage: salvageAmount(node.patrol.salvage * k, mods) };
}

/** Crews learn from a fight only up to the node's xpCap, so easy sectors cannot make veterans of a fleet. */
function awardXp(ships: Ship[], amount: number, cap: number, emit?: Emit): void {
  if (amount <= 0) return;
  for (const ship of ships) {
    const gain = Math.min(amount, cap - ship.xp);
    if (gain <= 0) continue;
    const before = rankIndex(ship.xp);
    ship.xp += gain;
    const after = rankIndex(ship.xp);
    if (after > before) emit?.({ kind: 'rank', ship, rank: FLEET.ranks[after] });
  }
}

/** Settle a finished battle: hull damage, experience, rewards, campaign progress. */
function resolve(state: GameState, group: Group, rt: GroupRuntime, emit?: Emit): void {
  const battle = rt.battle;
  const node = rt.node ? NODE_BY_ID[rt.node] : undefined;
  if (!battle || !battle.outcome || !node) {
    rt.battle = null;
    return;
  }
  const result = resultOf(battle);
  const order = rt.order ?? group.order;
  const fought: Ship[] = [];
  let crippled = 0;
  for (const u of result.player) {
    const ship = state.run.fleet.ships.find((s) => s.id === u.shipId);
    if (!ship) continue;
    fought.push(ship);
    const wasFit = ship.hull > 0;
    ship.hull = u.alive ? Math.min(1, Math.max(0.01, u.hull / u.maxHull)) : 0;
    if (wasFit && ship.hull === 0) crippled += 1;
  }

  const won = result.outcome === 'victory';
  let rp = ZERO;
  let ti = 0;
  let deut = 0;
  let salvage = 0;
  let firstClear = false;
  let newUnlock = false;
  const mods = modsOf(state);

  if (won) {
    if (order === 'patrol') {
      ({ ti, deut, salvage } = patrolYield(node, mods));
      addCapped(state, 'ti', D(ti));
      addCapped(state, 'deut', D(deut));
      addCapped(state, 'salvage', D(salvage));
    } else {
      firstClear = !isCleared(state.meta, node.id);
      const mult = (firstClear ? FLEET.firstClearMult : 1) * Math.max(0, 1 + mods.reward);
      rp = D(node.reward.rp * mult);
      ti = node.reward.ti * mult;
      salvage = salvageAmount(node.reward.salvage * (firstClear ? FLEET.firstClearMult : 1), mods);
      addCapped(state, 'salvage', D(salvage));
      state.run.rp = state.run.rp.add(rp);
      state.run.earned = state.run.earned.add(rp);
      state.meta.lifetimeEarned = state.meta.lifetimeEarned.add(rp);
      addCapped(state, 'ti', D(ti));
      state.meta.cleared[node.id] = (state.meta.cleared[node.id] ?? 0) + 1;
      newUnlock = !(state.meta.everCleared[node.id] ?? 0);
      state.meta.everCleared[node.id] = (state.meta.everCleared[node.id] ?? 0) + 1;
    }
  }

  state.meta.battles.total += 1;
  if (won) state.meta.battles.won += 1;
  else if (result.outcome === 'defeat' || result.outcome === 'draw') state.meta.battles.lost += 1;

  awardXp(fought, result.outcome === 'retreat' ? 0 : won ? FLEET.xp.win : FLEET.xp.loss, node.xpCap, emit);

  if (won && state.meta.opsUnlocked) offerBoarding(state, node, order, result.enemy, emit);

  const summary: GroupResult = { outcome: result.outcome, node: node.id, order, firstClear, rp, ti, deut, salvage, crippled, seconds: result.seconds };
  rt.last = summary;
  rt.battle = null;
  rt.node = null;
  rt.order = undefined;
  rt.paid = undefined;
  rt.acc = 0;
  rt.rest = FLEET.sortie.restSeconds;
  emit?.({ kind: 'battle', group, result: summary, nodeName: node.name });

  if (won) {
    group.failStreak = 0;
    if (firstClear) {
      const theatreBoss = node.boss === true;
      const unlocks = newUnlock ? (node.unlocks ?? []).map((id) => SHIP_BY_ID[id]).filter(Boolean) : [];
      emit?.({ kind: 'cleared', node, boss: theatreBoss, unlocks });
    }
  } else if (result.outcome !== 'retreat') {
    group.failStreak += 1;
    if (group.failStreak >= FLEET.failStreakLimit) {
      group.stalled = true;
      emit?.({ kind: 'stalled', group });
    }
  }
}

function stepGroupBattle(state: GameState, group: Group, rt: GroupRuntime, dt: number, emit?: Emit): void {
  const battle = rt.battle;
  if (!battle) return;
  rt.acc += dt;
  battle.stance = group.stance;
  battle.priority = group.priority;
  while (rt.acc >= COMBAT.tick && !battle.outcome) {
    stepBattle(battle);
    rt.acc -= COMBAT.tick;
    if (group.autoAbilities) {
      for (const a of autoAbilities(battle)) useAbility(state, group.id, a.id, a.target);
    }
  }
  if (battle.outcome) resolve(state, group, rt, emit);
}

/* ---------- the fleet step ---------- */

/** Keep the group list and the Fleet screen's unlock in step with progress. */
export function syncFleet(state: GameState, emit?: Emit): void {
  if (!state.meta.fleetUnlocked && (state.run.earned.gte(FLEET.unlockEarned) || state.run.fleet.ships.length > 0)) {
    state.meta.fleetUnlocked = true;
    emit?.({ kind: 'fleet-unlocked' });
  }
  const fleet = state.run.fleet;
  const want = groupsUnlocked(state.meta);
  while (fleet.groups.length < want) {
    const id = Math.max(0, ...fleet.groups.map((g) => g.id)) + 1;
    const g = defaultGroup(id);
    fleet.groups.push(g);
    emit?.({ kind: 'group', group: g });
  }
}

/**
 * One step of fleet time: drydock, repairs, and every group's battle or sortie. `speed` is the
 * battle speed setting: it hurries the fleet's operations but not construction at the drydock.
 */
export function stepFleet(state: GameState, dt: number, emit?: Emit, speed = 1): void {
  syncFleet(state, emit);
  stepQueue(state, dt, emit);
  const fleetDt = dt * speed;
  for (const group of state.run.fleet.groups) {
    const rt = runtimeOf(state, group.id);
    if (rt.battle) {
      stepGroupBattle(state, group, rt, fleetDt, emit);
      continue;
    }
    repairShips(state, group.id, fleetDt);
    rt.rest = Math.max(0, rt.rest - fleetDt);
    trySortie(state, group, rt, emit);
  }
  repairShips(state, 0, fleetDt);
}

/* ---------- offline Patrol ---------- */

export interface PatrolEstimate {
  samples: number;
  winRate: number;
  /** Average battle length in seconds. */
  battleSeconds: number;
  /** Average Titanium spent on repairs after one battle. */
  repairTi: number;
  /** Average seconds to repair after one battle (ships repair in parallel). */
  repairSeconds: number;
}

/**
 * Estimate how a group fares on a node by fighting sample battles with the real simulator, each
 * from full hull (a patrol repairs between sorties). Deterministic for a given state.
 */
export function estimatePatrol(state: GameState, group: Group, node: NodeDef, samples: number = FLEET.offline.samples): PatrolEstimate {
  const mods = groupMods(state, group);
  const ships = fitShips(state, group.id).map((s) => ({ ...s, hull: 1 }));
  if (ships.length === 0) return { samples: 0, winRate: 0, battleSeconds: 0, repairTi: 0, repairSeconds: 0 };
  let wins = 0;
  let seconds = 0;
  let repairTi = 0;
  let repairSeconds = 0;
  for (let i = 0; i < samples; i++) {
    const r = runBattle({
      player: ships.map((s) => playerUnit(s, mods)),
      enemy: enemyUnits(node),
      stance: group.stance,
      priority: group.priority,
      seed: battleSeed(state, group.id, 1000 + i),
      ...(mods.opening ? { opening: mods.opening } : {}),
    });
    if (r.outcome === 'victory') wins += 1;
    seconds += r.seconds;
    let worst = 0;
    for (const u of r.player) {
      const ship = ships.find((s) => s.id === u.shipId);
      if (!ship) continue;
      const lost = u.alive ? Math.max(0, 1 - u.hull / u.maxHull) : 1;
      repairTi += lost * classOf(ship).repairTi;
      worst = Math.max(worst, lost);
    }
    repairSeconds += worst / (FLEET.repair.fieldPerSecond * (1 + mods.repair));
  }
  return {
    samples,
    winRate: wins / samples,
    battleSeconds: seconds / samples,
    repairTi: repairTi / samples,
    repairSeconds: repairSeconds / samples,
  };
}

export interface PatrolReport {
  group: number;
  name: string;
  node: string;
  nodeName: string;
  battles: number;
  wins: number;
  ti: number;
  deut: number;
  salvage: number;
  winRate: number;
}

export interface FleetOfflineReport {
  launched: number;
  patrols: PatrolReport[];
}

/**
 * How many patrol cycles a group on Patrol can afford while the player is away. Costs and rewards
 * are tracked cycle by cycle against the stock and its cap, so nothing is created from nothing.
 * Returns null when the group is not patrolling or is not fit to.
 */
function patrolPlan(state: GameState, group: Group, awaySeconds: number, efficiency: number) {
  if (group.order !== 'patrol' || group.stalled) return null;
  const { node } = targetNode(state, group);
  if (!node) return null;
  repairShips(state, group.id, 60); // get the fleet fit before it sails
  const est = estimatePatrol(state, group, node);
  if (est.samples === 0 || est.winRate < FLEET.offline.minWinRate) return null;

  const cycleSeconds = est.battleSeconds + FLEET.sortie.restSeconds + est.repairSeconds;
  const maxCycles = Math.floor((awaySeconds * efficiency) / cycleSeconds);
  const deutCost = sortieCost(state, group.id);
  const mods = modsOf(state);
  const pay = patrolYield(node, mods);
  let deut = state.run.deut.toNumber();
  let ti = state.run.ti.toNumber();
  let salvage = state.run.salvage.toNumber();
  let cycles = 0;
  let expectedWins = 0;
  while (cycles < maxCycles && deut >= deutCost && ti >= est.repairTi) {
    deut = Math.min(storageCap('deut', mods), deut - deutCost + est.winRate * pay.deut);
    ti = Math.min(storageCap('ti', mods), ti - est.repairTi + est.winRate * pay.ti);
    salvage = Math.min(storageCap('salvage', mods), salvage + est.winRate * pay.salvage);
    expectedWins += est.winRate;
    cycles += 1;
  }
  return { node, est, cycles, expectedWins, deut, ti, salvage, pay };
}

/**
 * Apply time away to the fleet. The build queue and repairs run in full. Groups on Patrol fight
 * the expected number of battles for the time away (scaled by offline efficiency), limited by
 * the Deuterium and Titanium they can pay for.
 */
export function applyOfflineFleet(state: GameState, awaySeconds: number, efficiency: number, emit?: Emit): FleetOfflineReport {
  const report: FleetOfflineReport = { launched: 0, patrols: [] };
  if (awaySeconds <= 0) return report;
  syncFleet(state, emit);

  const before = state.run.fleet.ships.length;
  for (let t = 0; t < awaySeconds; t += 30) stepQueue(state, Math.min(30, awaySeconds - t), emit);
  report.launched = state.run.fleet.ships.length - before;

  for (const group of state.run.fleet.groups) {
    const rt = runtimeOf(state, group.id);
    if (rt.battle) {
      // A battle in progress when the page closed does not carry over; its sortie is refunded.
      state.run.deut = Decimal.min(D(capOf(state, 'deut')), state.run.deut.add(rt.paid ?? 0));
      rt.battle = null;
      rt.node = null;
      rt.order = undefined;
      rt.paid = undefined;
    }
    const patrol = patrolPlan(state, group, awaySeconds, efficiency);
    if (!patrol) {
      repairShips(state, group.id, awaySeconds);
      continue;
    }
    const { node, est, cycles, expectedWins, deut: deutAfter, ti: tiAfter, salvage: salvageAfter, pay } = patrol;
    if (cycles < 1) {
      repairShips(state, group.id, awaySeconds);
      continue;
    }
    const wins = Math.min(cycles, Math.round(expectedWins));
    state.run.deut = D(deutAfter);
    state.run.ti = D(tiAfter);
    state.run.salvage = D(salvageAfter);
    awardXp(fitShips(state, group.id), wins * FLEET.xp.win + (cycles - wins) * FLEET.xp.loss, node.xpCap, emit);
    state.meta.battles.total += cycles;
    state.meta.battles.won += wins;
    state.meta.battles.lost += cycles - wins;
    report.patrols.push({
      group: group.id,
      name: group.name,
      node: node.id,
      nodeName: node.name,
      battles: cycles,
      wins,
      ti: wins * pay.ti,
      deut: wins * pay.deut,
      salvage: wins * pay.salvage,
      winRate: est.winRate,
    });
  }
  repairShips(state, 0, awaySeconds);
  return report;
}
