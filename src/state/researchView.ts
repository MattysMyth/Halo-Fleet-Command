/**
 * What the Research screen shows: branches of projects, the research bays, doctrine slots and the
 * running total of every bonus.
 */
import { BRANCHES, DOCTRINES, RESEARCH, RESEARCH_CONFIG } from '../data';
import type { BranchDef, DoctrineDef, Effect, ResearchDef } from '../data';
import { doctrineProblem, doctrineSlots, researchProblem, researchStatus } from '../sim/research';
import type { ResearchStatus } from '../sim/research';
import { researchBays } from '../sim/armory';
import { modsOf } from '../sim/modifiers';
import type { GameState } from './types';

export interface ProjectView {
  def: ResearchDef;
  status: ResearchStatus;
  remaining: number | null;
  /** Why it cannot start now; null when it can. */
  problem: string | null;
}

export interface BranchView {
  def: BranchDef;
  projects: ProjectView[];
  done: number;
}

export interface DoctrineOption {
  def: DoctrineDef;
  /** Slot it is adopted in, or null. */
  slot: number | null;
  /** Why it cannot go into each slot right now (null = can). */
  problems: (string | null)[];
}

export interface SlotView {
  slot: number;
  current: DoctrineDef | null;
}

export interface ResearchScreenView {
  unlocked: boolean;
  branches: BranchView[];
  bays: { used: number; total: number };
  slots: SlotView[];
  doctrines: DoctrineOption[];
  swapIntel: number;
  /** Seconds until a swap is allowed again. */
  cooldown: number;
  /** One line per active bonus, for the summary panel. */
  bonuses: string[];
}

const pct = (x: number): string => `${x >= 0 ? '+' : '-'}${Math.round(Math.abs(x) * 100)}%`;

/** Plain-language text for one effect, used in tooltips and the bonus summary. */
export function effectText(e: Effect): string {
  switch (e.kind) {
    case 'stat':
      return `${pct(e.amount)} marine ${e.stat}`;
    case 'opening':
      return `${pct(e.amount)} ship damage for the first ${e.seconds} s`;
    default:
      return `${pct(e.amount)} ${LABEL[e.kind]}`;
  }
}

const LABEL: Record<string, string> = {
  power: 'squad Power',
  vehicle: 'vehicle Power',
  recovery: 'wound recovery',
  wounded: 'wounded share',
  xp: 'marine experience',
  hull: 'ship hull',
  armour: 'ship armour',
  damage: 'ship damage',
  cooldown: 'weapon rate of fire',
  shield: 'shield (share of hull)',
  repair: 'repair speed',
  build: 'ship build speed',
  production: 'production',
  storage: 'storage',
  sortie: 'cheaper sorties',
  salvage: 'Salvage',
  patrol: 'Patrol Titanium and Salvage',
  reward: 'Campaign rewards',
  marine: 'marine Power',
};

export function bonusLines(state: GameState): string[] {
  const m = modsOf(state);
  const out: string[] = [];
  const add = (label: string, x: number): void => {
    if (Math.abs(x) > 1e-9) out.push(`${pct(x)} ${label}`);
  };
  add('ship hull', m.hull);
  add('ship armour', m.armour);
  add('ship damage', m.damage);
  add('weapon rate of fire', 1 / m.cooldown - 1);
  add('shield (of hull)', m.shield);
  if (m.opening) out.push(`${pct(m.opening.mult - 1)} ship damage for the first ${m.opening.seconds} s`);
  add('repair speed', m.repair);
  add('ship build speed', m.build);
  add('production', m.production);
  add('storage', m.storage);
  add('cheaper sorties', 1 - m.sortie);
  add('Salvage', m.salvage);
  add('Patrol Titanium and Salvage', m.patrol);
  add('Campaign rewards', m.reward);
  add('marine Power', m.marine + m.power);
  add('vehicle Power', m.vehicle);
  add('marine experience', m.xp);
  add('wound recovery', 1 / m.recovery - 1);
  for (const [k, v] of Object.entries(m.stat)) add(`marine ${k}`, v);
  return out;
}

export function buildResearchView(state: GameState): ResearchScreenView {
  const r = state.run.research;
  const slots = doctrineSlots(state);
  const branches: BranchView[] = BRANCHES.map((def) => {
    const projects: ProjectView[] = RESEARCH.filter((n) => n.branch === def.id).map((n) => ({
      def: n,
      status: researchStatus(state, n),
      remaining: r.active.find((p) => p.id === n.id)?.remaining ?? null,
      problem: researchProblem(state, n),
    }));
    return { def, projects, done: projects.filter((p) => p.status === 'done').length };
  });
  return {
    unlocked: state.meta.opsUnlocked || state.run.intel.gt(0) || r.done.length > 0 || r.active.length > 0,
    branches,
    bays: { used: r.active.length, total: researchBays(state.meta) },
    slots: Array.from({ length: slots }, (_, slot) => ({
      slot,
      current: DOCTRINES.find((d) => d.id === state.run.doctrine.picked[slot]) ?? null,
    })),
    doctrines: DOCTRINES.map((def) => ({
      def,
      slot: state.run.doctrine.picked.indexOf(def.id) >= 0 ? state.run.doctrine.picked.indexOf(def.id) : null,
      problems: Array.from({ length: slots }, (_, slot) => doctrineProblem(state, slot, def.id)),
    })),
    swapIntel: RESEARCH_CONFIG.swapIntel,
    cooldown: state.run.doctrine.cooldown,
    bonuses: bonusLines(state),
  };
}
