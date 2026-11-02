/**
 * Shapes of the fleet and combat content files, plus a validator.
 * Kept apart from schema.ts so the economy types stay small.
 */

/** Distance bands, near to far. A weapon fires when the engagement is at or inside its reach. */
export type Band = 'close' | 'medium' | 'long';
export const BANDS: readonly Band[] = ['close', 'medium', 'long'];
/** Numeric form of a band: 0 close, 1 medium, 2 long. */
export const bandIndex = (b: Band): number => BANDS.indexOf(b);

export type DamageType = 'kinetic' | 'explosive' | 'energy';
export type Row = 'front' | 'line' | 'rear';
export const ROWS: readonly Row[] = ['front', 'line', 'rear'];
export type Stance = 'standoff' | 'standard' | 'closein';
export const STANCES: readonly Stance[] = ['standoff', 'standard', 'closein'];
export type Priority = 'weakest' | 'strongest' | 'shields' | 'carriers';
export const PRIORITIES: readonly Priority[] = ['weakest', 'strongest', 'shields', 'carriers'];
export type Order = 'campaign' | 'patrol' | 'reserve' | 'support';
export const ORDERS: readonly Order[] = ['campaign', 'patrol', 'reserve', 'support'];

/** Stats shared by player and enemy weapons. Damage is per shot; a salvo fires `shots` of them. */
export interface WeaponStats {
  id: string;
  name: string;
  type: DamageType;
  reach: Band;
  shots: number;
  damage: number;
  /** Seconds between salvos. */
  cooldown: number;
  /** Armour penetration, 0 to 1. */
  pen: number;
  /** Chance each shot lands, before point defence. */
  accuracy: number;
  /** Missiles and torpedoes can be shot down by point defence. */
  missile?: boolean;
  /** Marks the MAC family, which MAC Overcharge empowers. */
  mac?: boolean;
}

export type WeaponDef = WeaponStats & { slot: 'weapon'; blurb: string };

export interface ModuleDef {
  id: string;
  name: string;
  slot: 'defence' | 'utility';
  blurb: string;
  /** Point-defence slots this module provides (each is one interception attempt per missile). */
  pd?: number;
  armourMult?: number;
  hullMult?: number;
  damageMult?: number;
}

export type EquipmentDef = WeaponDef | ModuleDef;

export type ShipUnlock = { kind: 'start' } | { kind: 'node'; node: string };

export interface ShipClassDef {
  id: string;
  name: string;
  canon: string;
  role: string;
  /** Command points the ship uses in a strike group. */
  command: number;
  hull: number;
  armour: number;
  /** Fleet speed contribution; the faster fleet controls the engagement range. */
  speed: number;
  /** Multiplies the damage of every weapon on the ship (about x4 per tier). */
  damageMult: number;
  slots: { weapon: number; defence: number; utility: number };
  cost: { rp: number; ti: number };
  buildSeconds: number;
  /** Titanium to repair a ship from nothing back to full hull. */
  repairTi: number;
  unlock: ShipUnlock;
  defaultLoadout: { weapon: string[]; defence: string[]; utility: string[] };
  icon: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  faction: 'insurrectionist' | 'covenant';
  command: number;
  hull: number;
  shield: number;
  armour: number;
  speed: number;
  /** The band this ship wants to fight at. */
  prefer: Band;
  /** Shield recharge: after `delay` seconds without a hit, regain `rate` of max shield per second. */
  regen?: { delay: number; rate: number };
  /** Point-defence slots on the ship. */
  pd?: number;
  weapons: WeaponStats[];
  tags?: string[];
}

export interface NodeDef {
  id: string;
  name: string;
  blurb: string;
  /** Enemy id to count. */
  enemies: Record<string, number>;
  /** Multiplies enemy hull and shields (and damage by its square root). Defaults to 1. */
  scale?: number;
  /** Paid on every Campaign win. The first clear pays `firstClearMult` times. */
  reward: { rp: number; ti: number; salvage: number };
  /** Paid on every Patrol win. */
  patrol: { ti: number; deut: number; salvage: number };
  /** Crews stop learning here: a ship at or above this experience gains none from fighting at this node. */
  xpCap: number;
  boss?: boolean;
  /** Ship classes unlocked by clearing this node. */
  unlocks?: string[];
}

export interface TheatreDef {
  id: number;
  name: string;
  blurb: string;
  /** Battle Honors a Transfer out of this theatre pays. */
  honors: number;
  /** A ship class the fleet must field before it may Transfer out of this theatre. */
  transferShip?: string;
  nodes: NodeDef[];
}

export interface RankDef {
  id: string;
  name: string;
  /** Experience needed to reach the rank. */
  xp: number;
  /** Bonus to the ship's damage and hull. */
  bonus: number;
}

export interface FleetConfig {
  /** RP earned (this run or ever) that reveals the Fleet screen. */
  unlockEarned: number;
  /** Command capacity of a strike group at the start. */
  commandCapacity: number;
  /** Every this many sectors cleared adds one point of Command capacity. */
  sectorsPerCommand: number;
  /** Extra Command per strike group for each theatre fought beyond the second. */
  lateTheatreCommand: number;
  maxGroups: number;
  queueLimit: number;
  slips: { base: number; costs: number[] };
  rowWeights: Record<Row, number>;
  ranks: RankDef[];
  xp: { win: number; loss: number };
  sortie: { deutPerCommand: number; restSeconds: number };
  repair: { fieldPerSecond: number; reservePerSecond: number };
  integrityPresets: number[];
  failStreakLimit: number;
  /** Production bonus per campaign node cleared. */
  sectorBonus: number;
  /** Veteran cadre: at Redeploy the best crew's experience seeds `share` of itself (up to `cap`) in future new crews. */
  cadre: { share: number; cap: number };
  /** The first Campaign clear of a node pays this many times its reward. */
  firstClearMult: number;
  /** Cap on stored Titanium-A, Deuterium and Salvage. */
  storage: { ti: number; deut: number; salvage: number };
  /** Multiplies the Titanium and Salvage stockpile caps, by the number of theatres opened (index 0 is one theatre). */
  theatreStorage: { ti: number[]; salvage: number[] };
  /** Offline Patrol: sampled battles per estimate and the lowest win rate a group will patrol at. */
  offline: { samples: number; minWinRate: number };
  battleSpeeds: number[];
}

export interface AbilityDef {
  name: string;
  cooldown: number;
  deut: number;
  /** Seconds the effect lasts; absent for instant abilities. */
  duration?: number;
  blurb: string;
}

export interface CombatConfig {
  /** Seconds per combat tick. */
  tick: number;
  /** Seconds the engagement takes to shift one band. */
  bandSeconds: number;
  /** A battle that lasts this long is a draw. */
  maxSeconds: number;
  /** A fleet breaks after losing this share of its Command value. */
  breakFraction: number;
  /** Shield damage multiplier by damage type. */
  shieldMult: Record<'kinetic' | 'explosive' | 'energy', number>;
  /** Fraction of a hit that always reaches the hull, however thick the armour. */
  minHullShare: number;
  /** Each point-defence slot's chance to stop a missile. */
  pdChance: number;
  /** Share of a ship's point defence that also covers its neighbours. */
  pdSpill: number;
  pdMaxIntercept: number;
  stance: Record<Stance, { band: Band; name: string }>;
  abilities: {
    focus: AbilityDef & { damageBonus: number };
    evasive: AbilityDef & { damageTaken: number };
    overcharge: AbilityDef;
    retreat: AbilityDef;
  };
}

/* ---------- validation ---------- */

export interface FleetData {
  equipment: EquipmentDef[];
  ships: ShipClassDef[];
  enemies: EnemyDef[];
  theatres: TheatreDef[];
  fleet: FleetConfig;
  combat: CombatConfig;
}

const weaponErrors = (w: WeaponStats, where: string): string[] => {
  const e: string[] = [];
  if (!BANDS.includes(w.reach)) e.push(`${where}: bad reach ${w.reach}`);
  if (!['kinetic', 'explosive', 'energy'].includes(w.type)) e.push(`${where}: bad damage type ${w.type}`);
  if (!(w.shots >= 1) || !Number.isInteger(w.shots)) e.push(`${where}: shots must be a whole number of at least 1`);
  if (!(w.damage > 0)) e.push(`${where}: damage must be positive`);
  if (!(w.cooldown > 0)) e.push(`${where}: cooldown must be positive`);
  if (!(w.pen >= 0 && w.pen <= 1)) e.push(`${where}: pen must be between 0 and 1`);
  if (!(w.accuracy > 0 && w.accuracy <= 1)) e.push(`${where}: accuracy must be above 0 and at most 1`);
  return e;
};

export function validateFleetData(d: FleetData): string[] {
  const errors: string[] = [];
  const gear = new Map<string, EquipmentDef>();
  for (const g of d.equipment) {
    if (gear.has(g.id)) errors.push(`duplicate equipment id ${g.id}`);
    gear.set(g.id, g);
    if (g.slot === 'weapon') errors.push(...weaponErrors(g, g.id));
  }

  const shipIds = new Set<string>();
  for (const s of d.ships) {
    if (shipIds.has(s.id)) errors.push(`duplicate ship id ${s.id}`);
    shipIds.add(s.id);
    if (!(s.command >= 1)) errors.push(`${s.id}: command must be at least 1`);
    if (!(s.hull > 0) || s.armour < 0 || !(s.speed > 0) || !(s.damageMult > 0)) errors.push(`${s.id}: bad hull, armour, speed or damage`);
    if (!(s.buildSeconds > 0) || !(s.cost.rp >= 0) || !(s.cost.ti >= 0) || !(s.repairTi >= 0)) errors.push(`${s.id}: bad cost or time`);
    for (const slot of ['weapon', 'defence', 'utility'] as const) {
      const load = s.defaultLoadout[slot];
      if (load.length !== s.slots[slot]) errors.push(`${s.id}: default ${slot} loadout has ${load.length} items for ${s.slots[slot]} slots`);
      for (const id of load) {
        const g = gear.get(id);
        if (!g) errors.push(`${s.id}: unknown equipment ${id}`);
        else if (g.slot !== slot) errors.push(`${s.id}: ${id} is a ${g.slot} item in a ${slot} slot`);
      }
    }
  }
  if (!d.ships.some((s) => s.unlock.kind === 'start')) errors.push('no ship class is available from the start');

  const enemyIds = new Set<string>();
  for (const e of d.enemies) {
    if (enemyIds.has(e.id)) errors.push(`duplicate enemy id ${e.id}`);
    enemyIds.add(e.id);
    if (!(e.command >= 1) || !(e.hull > 0) || e.shield < 0 || e.armour < 0 || !(e.speed > 0)) errors.push(`${e.id}: bad stats`);
    if (e.weapons.length === 0) errors.push(`${e.id}: has no weapons`);
    if (!BANDS.includes(e.prefer)) errors.push(`${e.id}: bad preferred band`);
    e.weapons.forEach((w, i) => errors.push(...weaponErrors(w, `${e.id}.weapons[${i}]`)));
  }

  const nodeIds = new Set<string>();
  for (const t of d.theatres) {
    if (t.nodes.length === 0) errors.push(`theatre ${t.id} has no nodes`);
    if (!(t.honors >= 1) || !Number.isInteger(t.honors)) errors.push(`theatre ${t.id}: honors must be a whole number of at least 1`);
    if (t.transferShip !== undefined && !shipIds.has(t.transferShip)) errors.push(`theatre ${t.id}: unknown transfer ship ${t.transferShip}`);
    t.nodes.forEach((n, i) => {
      if (nodeIds.has(n.id)) errors.push(`duplicate node id ${n.id}`);
      nodeIds.add(n.id);
      const entries = Object.entries(n.enemies);
      if (entries.length === 0) errors.push(`${n.id}: no enemies`);
      for (const [id, count] of entries) {
        if (!enemyIds.has(id)) errors.push(`${n.id}: unknown enemy ${id}`);
        if (!(count >= 1) || !Number.isInteger(count)) errors.push(`${n.id}: bad count for ${id}`);
      }
      if (n.scale !== undefined && !(n.scale > 0)) errors.push(`${n.id}: scale must be positive`);
      if (!(n.xpCap > 0)) errors.push(`${n.id}: xpCap must be positive`);
      if (!(n.reward.rp >= 0) || !(n.reward.ti >= 0) || !(n.patrol.ti >= 0) || !(n.patrol.deut >= 0) || !(n.reward.salvage >= 0) || !(n.patrol.salvage >= 0)) errors.push(`${n.id}: bad reward`);
      if (n.boss && i !== t.nodes.length - 1) errors.push(`${n.id}: the boss must be the last node`);
      for (const u of n.unlocks ?? []) if (!shipIds.has(u)) errors.push(`${n.id}: unlocks unknown ship ${u}`);
    });
    if (!t.nodes[t.nodes.length - 1]?.boss) errors.push(`theatre ${t.id}: last node must be the boss`);
  }
  d.theatres.forEach((t, i) => {
    if (t.id !== i + 1) errors.push(`theatre ids must run 1, 2, 3 in order (found ${t.id} at place ${i + 1})`);
  });
  for (const s of d.ships) {
    if (s.unlock.kind === 'node' && !nodeIds.has(s.unlock.node)) errors.push(`${s.id}: unlocked by unknown node ${s.unlock.node}`);
  }

  const f = d.fleet;
  if (!(f.slips.base >= 1) || f.slips.costs.some((x) => !(x > 0))) errors.push('slips malformed');
  if (f.ranks.length === 0 || f.ranks[0].xp !== 0) errors.push('first rank must need 0 xp');
  if (f.ranks.some((r, i) => i > 0 && r.xp <= f.ranks[i - 1].xp)) errors.push('rank xp must increase');
  if (!(f.commandCapacity >= 1) || !(f.maxGroups >= 1) || !(f.queueLimit >= 1)) errors.push('fleet capacity values must be positive');
  if (f.integrityPresets.some((p) => !(p > 0 && p <= 1))) errors.push('integrity presets must be between 0 and 1');
  for (const k of ['ti', 'salvage'] as const) if (!f.theatreStorage[k]?.length || f.theatreStorage[k].some((x) => !(x >= 1))) errors.push(`theatreStorage.${k} must list multipliers of at least 1`);
  if (!(f.lateTheatreCommand >= 0)) errors.push('lateTheatreCommand must not be negative');
  if (!(f.sectorsPerCommand >= 1)) errors.push('sectorsPerCommand must be at least 1');
  if (!(f.cadre.share >= 0 && f.cadre.share <= 1) || !(f.cadre.cap >= 0)) errors.push('cadre share must be 0 to 1 and cap non-negative');
  if (!(f.firstClearMult >= 1)) errors.push('firstClearMult must be at least 1');
  if (!(f.repair.fieldPerSecond > 0) || !(f.repair.reservePerSecond > 0)) errors.push('repair rates must be positive');
  if (f.battleSpeeds[0] !== 1) errors.push('battle speeds must start at 1');
  for (const k of ['front', 'line', 'rear'] as const) if (!(f.rowWeights[k] > 0)) errors.push(`row weight ${k} must be positive`);

  const c = d.combat;
  if (!(c.tick > 0) || !(c.bandSeconds > 0) || !(c.maxSeconds > c.tick)) errors.push('combat timing values are invalid');
  if (!(c.breakFraction > 0 && c.breakFraction < 1)) errors.push('breakFraction must be between 0 and 1');
  if (!(c.minHullShare > 0 && c.minHullShare <= 1)) errors.push('minHullShare must be between 0 and 1');
  for (const k of ['kinetic', 'explosive', 'energy'] as const) if (!(c.shieldMult[k] > 0)) errors.push(`shieldMult ${k} must be positive`);
  for (const k of ['standoff', 'standard', 'closein'] as const) if (!BANDS.includes(c.stance[k]?.band)) errors.push(`stance ${k} needs a band`);
  return errors;
}
