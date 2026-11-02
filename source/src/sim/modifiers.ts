/**
 * Every bonus from research and doctrine, folded into one set of numbers. The rest of the sim asks
 * for these instead of reading the research tree itself, so adding an effect means touching this
 * file and the one place the effect applies.
 *
 * Most fields are additive fractions (0.1 means +10%). `cooldown`, `sortie` and `recovery` are
 * multipliers that shrink with each bonus.
 */
import { DOCTRINE_BY_ID, FLEET, RESEARCH_BY_ID } from '../data';
import type { Effect, Stat } from '../data';
import type { DoctrineState, GameState, ResearchState } from '../state/types';
import { applyRelics } from './relics';
import { honorBonus } from './warroom';

export interface Mods {
  stat: Record<Stat, number>;
  /** Marine squad Power from research. */
  power: number;
  vehicle: number;
  /** Multiplies marine recovery time. */
  recovery: number;
  /** Added to the share of casualties that are wounds. */
  wounded: number;
  xp: number;
  hull: number;
  armour: number;
  damage: number;
  /** Multiplies weapon cooldowns. */
  cooldown: number;
  /** Shield as a share of hull. */
  shield: number;
  repair: number;
  build: number;
  production: number;
  storage: number;
  /** Multiplies the Deuterium a sortie costs. */
  sortie: number;
  salvage: number;
  patrol: number;
  reward: number;
  /** Marine Power from doctrine. */
  marine: number;
  /** Stockpile cap multipliers from the theatres opened so far. */
  vault: { ti: number; salvage: number };
  /** A damage bonus that lasts only the first seconds of a battle. */
  opening: { mult: number; seconds: number } | null;
}

function blank(): Mods {
  return {
    stat: { firepower: 0, grit: 0, tactics: 0 },
    power: 0,
    vehicle: 0,
    recovery: 1,
    wounded: 0,
    xp: 0,
    hull: 0,
    armour: 0,
    damage: 0,
    cooldown: 1,
    shield: 0,
    repair: 0,
    build: 0,
    production: 0,
    storage: 0,
    sortie: 1,
    salvage: 0,
    patrol: 0,
    reward: 0,
    marine: 0,
    vault: { ti: 1, salvage: 1 },
    opening: null,
  };
}

export function applyEffect(m: Mods, e: Effect): void {
  switch (e.kind) {
    case 'stat':
      m.stat[e.stat] += e.amount;
      return;
    case 'cooldown':
      m.cooldown *= 1 - e.amount;
      return;
    case 'sortie':
      m.sortie *= 1 - e.amount;
      return;
    case 'recovery':
      m.recovery *= 1 - e.amount;
      return;
    case 'opening':
      m.opening = { mult: (m.opening?.mult ?? 1) * (1 + e.amount), seconds: Math.max(m.opening?.seconds ?? 0, e.seconds) };
      return;
    default:
      m[e.kind] += e.amount;
  }
}

export function modsFor(research: ResearchState, doctrine: DoctrineState): Mods {
  const m = blank();
  for (const id of research.done) for (const e of RESEARCH_BY_ID[id]?.effects ?? []) applyEffect(m, e);
  for (const id of doctrine.picked) if (id) for (const e of DOCTRINE_BY_ID[id]?.effects ?? []) applyEffect(m, e);
  return m;
}

export const NEUTRAL_MODS: Readonly<Mods> = blank();

/** Research and doctrine, plus the Battle Honors bonus to ship damage and marine Power. */
export function modsOf(state: GameState): Mods {
  const m = modsFor(state.run.research, state.run.doctrine);
  const honors = honorBonus(state.meta);
  m.damage += honors;
  m.marine += honors;
  m.vault = vaultFor(state.meta.theatresOpen);
  applyRelics(m, state.meta.relics ?? {});
  return m;
}

/** Stockpile cap multipliers once this many theatres are open. */
export function vaultFor(theatresOpen: number): Mods['vault'] {
  const open = Math.max(1, Math.floor(theatresOpen)) - 1;
  const pick = (a: number[]): number => a[Math.min(open, a.length - 1)] ?? 1;
  return { ti: pick(FLEET.theatreStorage.ti), salvage: pick(FLEET.theatreStorage.salvage) };
}
