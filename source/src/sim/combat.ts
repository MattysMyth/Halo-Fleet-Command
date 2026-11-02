/**
 * Ship combat: a pure, seeded battle simulator.
 *
 * Nothing here knows about the rest of the game. A battle is built from two lists of units, stepped
 * in fixed ticks, and ends with an outcome. The same setup and seed always give the same battle, so
 * it can be unit-tested, replayed headlessly by the balance tool, and sampled to estimate offline
 * Patrol results.
 *
 * Model in short:
 *  - The engagement sits in one of three range bands (close, medium, long). It starts at long and
 *    shifts one band every few seconds toward what the faster fleet wants.
 *  - A weapon fires when it is off cooldown and the engagement is at or inside its reach.
 *  - A hit drains shields first (scaled by damage type), then reaches the hull, where armour trims
 *    it unless the weapon penetrates.
 *  - A fleet breaks when it has lost half its Command value.
 */
import { createRng } from '../core/rng';
import { COMBAT, FLEET } from '../data';
import type { Band, DamageType, Priority, Row, Stance, WeaponStats } from '../data';
import { bandIndex } from '../data/fleetSchema';

export type Side = 'player' | 'enemy';
export type Outcome = 'victory' | 'defeat' | 'retreat' | 'draw';
export type AbilityId = 'focus' | 'evasive' | 'overcharge' | 'retreat';

/** Everything the simulator needs to know about one ship. */
export interface UnitSetup {
  /** Unique within the battle. */
  id: number;
  side: Side;
  name: string;
  /** Ship class id or enemy id, for display. */
  defId: string;
  row: Row;
  command: number;
  /** Current hull points. A player ship may start damaged. */
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  armour: number;
  speed: number;
  /** Multiplies every weapon's damage. */
  damageMult: number;
  weapons: WeaponStats[];
  /** Point-defence slots. */
  pd: number;
  /** The band an enemy wants to fight at (player fleets use their stance instead). */
  prefer: Band;
  regen?: { delay: number; rate: number };
  tags?: string[];
  /** Back-reference to the player's ship record. */
  shipId?: number;
}

export interface BattleSetup {
  player: UnitSetup[];
  enemy: UnitSetup[];
  stance: Stance;
  priority: Priority;
  seed: number;
  /** The player's ships hit harder for the first `seconds` of the battle (Shock and awe doctrine). */
  opening?: { mult: number; seconds: number };
}

export interface WeaponState {
  stats: WeaponStats;
  /** Seconds until the weapon can fire again. */
  cd: number;
  /** Set by MAC Overcharge; the next volley is doubled and ignores armour. */
  charged: boolean;
  reach: number;
}

export interface Unit extends Omit<UnitSetup, 'weapons'> {
  weapons: WeaponState[];
  alive: boolean;
  /** Battle time of the last hit taken, for shield recharge. */
  lastHit: number;
  /** Damage dealt this battle (shield and hull points). */
  dealt: number;
}

/** One weapon firing one salvo. The UI draws these as tracers. */
export interface SalvoEvent {
  t: number;
  from: number;
  to: number;
  weapon: string;
  type: DamageType;
  shots: number;
  hits: number;
  /** Missiles stopped by point defence. */
  stopped: number;
  shield: number;
  hull: number;
  killed: boolean;
}

export interface Battle {
  time: number;
  ticks: number;
  units: Unit[];
  /** 0 close, 1 medium, 2 long. */
  band: number;
  bandClock: number;
  targetBand: number;
  /** Which fleet's preferred range the engagement is moving toward. */
  control: Side;
  stance: Stance;
  priority: Priority;
  rngState: number;
  startCommand: Record<Side, number>;
  focus: { target: number; until: number } | null;
  opening: { mult: number; seconds: number } | null;
  evasiveUntil: number;
  /** Battle time at which each timed ability can be used again. */
  readyAt: Record<'focus' | 'evasive' | 'overcharge', number>;
  outcome: Outcome | null;
  /** Salvos fired during the most recent tick. */
  salvos: SalvoEvent[];
  /** Salvos from the last few seconds, for drawing tracers between UI frames. */
  recent: SalvoEvent[];
}

export interface UnitResult {
  id: number;
  defId: string;
  shipId?: number;
  name: string;
  alive: boolean;
  hull: number;
  maxHull: number;
}

export interface BattleResult {
  outcome: Outcome;
  seconds: number;
  player: UnitResult[];
  enemy: UnitResult[];
}

/* ---------- setup ---------- */

export function createBattle(setup: BattleSetup): Battle {
  const rng = createRng(setup.seed);
  const make = (u: UnitSetup): Unit => ({
    ...u,
    weapons: u.weapons.map((stats) => ({
      stats,
      // Stagger the opening volleys so a whole fleet does not fire on the same tick.
      cd: stats.cooldown * (0.15 + 0.5 * rng.next()),
      charged: false,
      reach: bandIndex(stats.reach),
    })),
    alive: u.hull > 0,
    lastHit: -Infinity,
    dealt: 0,
  });
  const units = [...setup.player, ...setup.enemy].map(make);
  const command = (side: Side): number => units.filter((u) => u.side === side && u.alive).reduce((s, u) => s + u.command, 0);
  return {
    time: 0,
    ticks: 0,
    units,
    band: 2,
    bandClock: 0,
    targetBand: 2,
    control: 'player',
    stance: setup.stance,
    priority: setup.priority,
    rngState: rng.state(),
    startCommand: { player: command('player'), enemy: command('enemy') },
    focus: null,
    opening: setup.opening ?? null,
    evasiveUntil: -1,
    readyAt: { focus: 0, evasive: 0, overcharge: 0 },
    outcome: null,
    salvos: [],
    recent: [],
  };
}

/* ---------- queries ---------- */

export const aliveUnits = (b: Battle, side: Side): Unit[] => b.units.filter((u) => u.side === side && u.alive);

export function commandLeft(b: Battle, side: Side): number {
  let n = 0;
  for (const u of b.units) if (u.side === side && u.alive) n += u.command;
  return n;
}

/** Share of the starting Command value still fighting, 0 to 1. */
export function integrity(b: Battle, side: Side): number {
  const start = b.startCommand[side];
  return start > 0 ? commandLeft(b, side) / start : 0;
}

export function abilityCooldown(b: Battle, id: 'focus' | 'evasive' | 'overcharge'): number {
  return Math.max(0, b.readyAt[id] - b.time);
}

export const abilityReady = (b: Battle, id: 'focus' | 'evasive' | 'overcharge'): boolean => abilityCooldown(b, id) <= 0;

export const focusActive = (b: Battle): boolean => b.focus !== null && b.time < b.focus.until;
export const evasiveActive = (b: Battle): boolean => b.time < b.evasiveUntil;

function fleetSpeed(b: Battle, side: Side): number {
  let weight = 0;
  let sum = 0;
  for (const u of b.units) {
    if (u.side !== side || !u.alive) continue;
    weight += u.command;
    sum += u.speed * u.command;
  }
  return weight > 0 ? sum / weight : 0;
}

/* ---------- damage ---------- */

/**
 * Apply one hit of raw damage `d`. Shields take d x (type multiplier) first; any damage left over
 * carries to the hull, where armour trims it (down to the minimum share) unless `ignoreArmour`.
 * Returns the shield and hull points actually removed.
 */
export function applyHit(
  target: Pick<Unit, 'shield' | 'hull' | 'armour' | 'lastHit'>,
  d: number,
  type: DamageType,
  pen: number,
  ignoreArmour: boolean,
  time: number,
): { shield: number; hull: number } {
  let shieldLost = 0;
  let hullLost = 0;
  let raw = d;
  target.lastHit = time;

  if (target.shield > 0) {
    const k = COMBAT.shieldMult[type];
    const scaled = raw * k;
    if (scaled <= target.shield) {
      target.shield -= scaled;
      return { shield: scaled, hull: 0 };
    }
    shieldLost = target.shield;
    raw = (scaled - target.shield) / k;
    target.shield = 0;
  }

  const through = ignoreArmour ? raw : Math.max(COMBAT.minHullShare * raw, raw - target.armour * (1 - pen));
  hullLost = Math.min(through, Math.max(0, target.hull));
  target.hull -= through;
  return { shield: shieldLost, hull: hullLost };
}

/* ---------- targeting ---------- */

const lowest = (units: Unit[], key: (u: Unit) => number): Unit => {
  let best = units[0];
  let bestKey = key(best);
  for (let i = 1; i < units.length; i++) {
    const k = key(units[i]);
    if (k < bestKey) {
      best = units[i];
      bestKey = k;
    }
  }
  return best;
};

function playerTarget(b: Battle, foes: Unit[]): Unit {
  if (b.focus && b.time < b.focus.until) {
    const f = foes.find((u) => u.id === b.focus?.target);
    if (f) return f;
  }
  const left = (u: Unit): number => u.hull + u.shield;
  switch (b.priority) {
    case 'strongest':
      return lowest(foes, (u) => -left(u));
    case 'shields': {
      // Strip shields first: the foe with the least shield left that still has some, else the weakest.
      const shielded = foes.filter((u) => u.shield > 0);
      return shielded.length > 0 ? lowest(shielded, (u) => u.shield) : lowest(foes, left);
    }
    case 'carriers': {
      const carriers = foes.filter((u) => u.tags?.includes('carrier'));
      return lowest(carriers.length > 0 ? carriers : foes, left);
    }
    default:
      return lowest(foes, left);
  }
}

/** Enemies pick a target at random, weighted by row (front rows draw the most fire). */
function enemyTarget(foes: Unit[], rng: { next(): number }): Unit {
  let total = 0;
  for (const u of foes) total += FLEET.rowWeights[u.row];
  let roll = rng.next() * total;
  for (const u of foes) {
    roll -= FLEET.rowWeights[u.row];
    if (roll < 0) return u;
  }
  return foes[foes.length - 1];
}

/* ---------- the step ---------- */

const RECENT_SECONDS = 2.5;

function updateRange(b: Battle, dt: number): void {
  b.control = fleetSpeed(b, 'player') >= fleetSpeed(b, 'enemy') ? 'player' : 'enemy';
  if (b.control === 'player') {
    b.targetBand = bandIndex(COMBAT.stance[b.stance].band);
  } else {
    let weight = 0;
    let sum = 0;
    for (const u of b.units) {
      if (u.side !== 'enemy' || !u.alive) continue;
      weight += u.command;
      sum += bandIndex(u.prefer) * u.command;
    }
    b.targetBand = weight > 0 ? Math.round(sum / weight) : b.band;
  }
  if (b.band === b.targetBand) {
    b.bandClock = 0;
    return;
  }
  b.bandClock += dt;
  if (b.bandClock >= COMBAT.bandSeconds) {
    b.band += Math.sign(b.targetBand - b.band);
    b.bandClock = 0;
  }
}

function fireSalvo(
  b: Battle,
  rng: { next(): number; chance(p: number): boolean },
  attacker: Unit,
  weapon: WeaponState,
  target: Unit,
  pd: Record<Side, number>,
): void {
  const s = weapon.stats;
  const charged = weapon.charged && s.mac === true;
  if (charged) weapon.charged = false;

  let perShot = s.damage * attacker.damageMult * (charged ? 2 : 1);
  if (attacker.side === 'player' && b.focus && b.focus.target === target.id && b.time < b.focus.until) {
    perShot *= 1 + COMBAT.abilities.focus.damageBonus;
  }
  if (attacker.side === 'player' && b.opening && b.time < b.opening.seconds) perShot *= b.opening.mult;
  if (target.side === 'player' && b.time < b.evasiveUntil) perShot *= COMBAT.abilities.evasive.damageTaken;

  // Point defence covers its own ship fully and the rest of the fleet at reduced strength.
  const slots = target.pd + COMBAT.pdSpill * Math.max(0, pd[target.side] - target.pd);
  const stopChance = s.missile && slots > 0 ? Math.min(COMBAT.pdMaxIntercept, 1 - (1 - COMBAT.pdChance) ** slots) : 0;

  let hits = 0;
  let stopped = 0;
  let shield = 0;
  let hull = 0;
  const wasAlive = target.hull > 0;
  for (let i = 0; i < s.shots; i++) {
    if (!rng.chance(s.accuracy)) continue;
    if (stopChance > 0 && rng.chance(stopChance)) {
      stopped += 1;
      continue;
    }
    hits += 1;
    const r = applyHit(target, perShot, s.type, s.pen, charged, b.time);
    shield += r.shield;
    hull += r.hull;
  }
  attacker.dealt += shield + hull;
  b.salvos.push({
    t: b.time,
    from: attacker.id,
    to: target.id,
    weapon: s.id,
    type: s.type,
    shots: s.shots,
    hits,
    stopped,
    shield,
    hull,
    killed: wasAlive && target.hull <= 0,
  });
}

/** Advance the battle by one tick. Does nothing once an outcome is set. */
export function stepBattle(b: Battle, dt: number = COMBAT.tick): void {
  if (b.outcome) return;
  const rng = createRng(b.rngState);
  b.salvos = [];
  b.time += dt;
  b.ticks += 1;

  updateRange(b, dt);

  const pd: Record<Side, number> = { player: 0, enemy: 0 };
  for (const u of b.units) if (u.alive) pd[u.side] += u.pd;

  for (const u of b.units) {
    if (!u.alive) continue;

    if (u.regen && u.maxShield > 0 && b.time - u.lastHit >= u.regen.delay && u.shield < u.maxShield) {
      u.shield = Math.min(u.maxShield, u.shield + u.regen.rate * u.maxShield * dt);
    }

    for (const w of u.weapons) {
      w.cd = Math.max(0, w.cd - dt);
      if (w.cd > 0 || b.band > w.reach) continue;
      const foes = b.units.filter((f) => f.side !== u.side && f.alive && f.hull > 0);
      if (foes.length === 0) break;
      const target = u.side === 'player' ? playerTarget(b, foes) : enemyTarget(foes, rng);
      fireSalvo(b, rng, u, w, target, pd);
      w.cd = w.stats.cooldown;
    }
  }

  // Deaths resolve together at the end of the tick, so neither side gets the last shot for free.
  for (const u of b.units) if (u.alive && u.hull <= 0) u.alive = false;

  const pLeft = integrity(b, 'player');
  const eLeft = integrity(b, 'enemy');
  const pBroke = pLeft <= COMBAT.breakFraction;
  const eBroke = eLeft <= COMBAT.breakFraction;
  if (pBroke || eBroke) {
    if (pBroke && eBroke) b.outcome = eLeft < pLeft ? 'victory' : 'defeat';
    else b.outcome = pBroke ? 'defeat' : 'victory';
  } else if (b.time >= COMBAT.maxSeconds) {
    b.outcome = 'draw';
  }
  b.recent = [...b.recent, ...b.salvos].filter((e) => e.t > b.time - RECENT_SECONDS).slice(-60);
  b.rngState = rng.state();
}

/* ---------- abilities ---------- */

/** Use a timed ability. Returns false when it is on cooldown, the battle is over, or the target is invalid. */
export function activate(b: Battle, id: AbilityId, target?: number): boolean {
  if (b.outcome) return false;
  const def = COMBAT.abilities[id];
  switch (id) {
    case 'focus': {
      if (!abilityReady(b, 'focus')) return false;
      const t = b.units.find((u) => u.id === target && u.side === 'enemy' && u.alive);
      if (!t) return false;
      b.focus = { target: t.id, until: b.time + (def.duration ?? 0) };
      b.readyAt.focus = b.time + def.cooldown;
      return true;
    }
    case 'evasive':
      if (!abilityReady(b, 'evasive')) return false;
      b.evasiveUntil = b.time + (def.duration ?? 0);
      b.readyAt.evasive = b.time + def.cooldown;
      return true;
    case 'overcharge': {
      if (!abilityReady(b, 'overcharge')) return false;
      let armed = 0;
      for (const u of b.units) {
        if (u.side !== 'player' || !u.alive) continue;
        for (const w of u.weapons) {
          if (w.stats.mac) {
            w.charged = true;
            armed += 1;
          }
        }
      }
      if (armed === 0) return false;
      b.readyAt.overcharge = b.time + def.cooldown;
      return true;
    }
    case 'retreat':
      b.outcome = 'retreat';
      return true;
  }
}

/**
 * What an automatic commander would do right now. Used by groups set to use abilities on their
 * own, and by the balance tool. It never retreats.
 */
export function autoAbilities(b: Battle): { id: AbilityId; target?: number }[] {
  if (b.outcome) return [];
  const out: { id: AbilityId; target?: number }[] = [];
  const foes = b.units.filter((u) => u.side === 'enemy' && u.alive && u.hull > 0);

  if (abilityReady(b, 'focus') && !focusActive(b) && foes.length > 0) {
    out.push({ id: 'focus', target: playerTarget({ ...b, focus: null }, foes).id });
  }
  const hullLeft = b.units.filter((u) => u.side === 'player').reduce((s, u) => s + Math.max(0, u.hull), 0);
  const hullMax = b.units.filter((u) => u.side === 'player').reduce((s, u) => s + u.maxHull, 0);
  if (abilityReady(b, 'evasive') && !evasiveActive(b) && hullMax > 0 && hullLeft / hullMax < 0.85 && b.band <= 1) {
    out.push({ id: 'evasive' });
  }
  if (abilityReady(b, 'overcharge')) {
    const soon = b.units.some((u) => u.side === 'player' && u.alive && u.weapons.some((w) => w.stats.mac && w.cd <= 1.5));
    if (soon) out.push({ id: 'overcharge' });
  }
  return out;
}

/* ---------- running a whole battle ---------- */

export function resultOf(b: Battle): BattleResult {
  const pick = (side: Side): UnitResult[] =>
    b.units
      .filter((u) => u.side === side)
      .map((u) => ({
        id: u.id,
        defId: u.defId,
        shipId: u.shipId,
        name: u.name,
        alive: u.alive,
        hull: Math.max(0, u.hull),
        maxHull: u.maxHull,
      }));
  return { outcome: b.outcome ?? 'draw', seconds: b.time, player: pick('player'), enemy: pick('enemy') };
}

/** Fight a battle to the end with no player input. `abilities` lets an automatic commander use them. */
export function runBattle(setup: BattleSetup, opts: { abilities?: boolean } = {}): BattleResult {
  const b = createBattle(setup);
  while (!b.outcome) {
    if (opts.abilities) for (const a of autoAbilities(b)) activate(b, a.id, a.target);
    stepBattle(b);
  }
  return resultOf(b);
}
