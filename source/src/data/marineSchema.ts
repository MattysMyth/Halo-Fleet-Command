/**
 * Shapes of the marine content files (units, vehicles, missions, positions, field research) plus a
 * validator, so a typo in data fails a test and not a player.
 */

export type Stat = 'firepower' | 'grit' | 'tactics';
export const STATS: readonly Stat[] = ['firepower', 'grit', 'tactics'];

export type MissionKind = 'patrol' | 'recon' | 'assault' | 'hunter' | 'boarding' | 'defend';
export const MISSION_KINDS: readonly MissionKind[] = ['patrol', 'recon', 'assault', 'hunter', 'boarding', 'defend'];

export type TacticId = 'aggressive' | 'methodical' | 'flank' | 'orbital';
export const TACTICS: readonly TacticId[] = ['aggressive', 'methodical', 'flank', 'orbital'];

/** What a squad does when nobody picks a tactic. Adaptive picks the best of the free tactics each stage. */
export type Standing = 'aggressive' | 'methodical' | 'flank' | 'adaptive';
export const STANDINGS: readonly Standing[] = ['aggressive', 'methodical', 'flank', 'adaptive'];

export type MarineUnlock = { kind: 'start' } | { kind: 'node'; node: string };

export interface UnitDef {
  id: string;
  name: string;
  role: string;
  blurb: string;
  /** Personnel to train one. */
  cost: number;
  stats: Record<Stat, number>;
  /** Corpsmen stabilise casualties: each one ready lowers the squad's casualty rate. */
  medic?: boolean;
  unlock: MarineUnlock;
}

export interface VehicleDef {
  id: string;
  name: string;
  blurb: string;
  cost: { rp: number; ti: number };
  /** Added to the squad's Power. */
  power: number;
  /** Added to the squad's Tactics, which decides whether a Flank works. */
  tactics: number;
  /** Multiplies the casualty rate. */
  casualty: number;
  /** A Flank needs a vehicle that can do it. */
  flank: boolean;
  unlock: MarineUnlock;
}

export interface RankDef {
  id: string;
  name: string;
  short: string;
  xp: number;
  /** Share added to the marine's own stats. */
  power: number;
}

export interface PerkEffect {
  /** Extra share of the marine's own Power. */
  power?: number;
  /** Multiplies this marine's casualty chance. */
  casualty?: number;
  /** Share of this marine's casualties that are wounds, in place of the usual split. */
  wounded?: number;
  /** Multiplies this marine's recovery time. */
  recovery?: number;
  /** Multiplies XP earned. */
  xp?: number;
  /** Share added to the whole squad's Power while this marine is ready. The best one applies. */
  aura?: number;
}

export interface PerkDef {
  id: string;
  name: string;
  blurb: string;
  /** Rank index that offers it: 1 is the first promotion. */
  rank: number;
  effect: PerkEffect;
}

export interface TacticDef {
  id: TacticId;
  name: string;
  blurb: string;
  /** Multiplies squad Power. */
  power: number;
  /** Multiplies the casualty rate. */
  casualty: number;
  /** Multiplies the time a stage takes. */
  time: number;
}

export interface StageDef {
  name: string;
  /** Multiplies the mission's base threat. */
  threat: number;
  /** Squad Tactics needed for a Flank to work here. */
  tacticsReq: number;
}

export interface MissionDef {
  id: MissionKind;
  name: string;
  blurb: string;
  stages: StageDef[];
  /** Length of an uninterrupted run at normal tactics speed. */
  seconds: number;
  /** Multiplies the target's ground threat. */
  threat: number;
  /** Requisition is paid as seconds of current production, Intel and XP as multiples. */
  rewards: { rp: number; intel: number; xp: number };
  /** May a squad repeat it on its own? */
  auto: boolean;
  /** Incident missions are not chosen as a squad's standing mission: they answer something that has just happened. */
  incident?: boolean;
}

export type PositionBonus = { kind: 'rp' | 'ti' | 'deut' | 'pers' | 'intel'; amount: number } | { kind: 'command'; amount: number };

export interface PositionDef {
  node: string;
  name: string;
  blurb: string;
  /** Base threat of one stage on the ground. */
  threat: number;
  /** Personnel left as the garrison when it is taken. */
  garrison: number;
  /** Crews stop learning here at this much XP, so easy ground cannot make veterans. */
  xpCap: number;
  /** Seconds of production a Patrol sweep here pays. */
  rpSeconds: number;
  /** Intel a Patrol sweep here pays. */
  intel: number;
  bonus: PositionBonus;
}

export interface IncidentConfig {
  /** Most open incidents of each kind; a new one pushes out the oldest. */
  max: number;
  /** Seconds to answer a boarding chance or a counter-attack before it is gone. */
  boardingSeconds: number;
  defendSeconds: number;
  /** A beaten enemy left under this share of its hull can be boarded. */
  wreckBelow: number;
  /** Wrecks that can be boarded after one battle, and the chance one is offered, by order. */
  wrecksPerBattle: number;
  boardChance: { campaign: number; patrol: number };
  /** Threat of a boarding action: the sector's ground threat times base + perCommand x the wreck's Command. */
  boardThreat: { base: number; perCommand: number };
  /** Salvage a boarding pays: the sector's Campaign Salvage times base + perCommand x Command. */
  boardSalvage: { base: number; perCommand: number };
  /** Chance a won boarding also yields a hull: base + perCommand x Command, up to cap. */
  hullChance: { base: number; perCommand: number; cap: number };
  /** The hull handed over, as a ship class, and the share of its hull left. */
  hullClass: string;
  hullShare: number;
  /** Seconds between counter-attacks (min, max) while any ground is held. */
  defendEvery: [number, number];
  defendThreat: number;
  /** Chance the garrison holds when nobody answers. */
  holdChance: number;
  /** An overrun position pays no production bonus for this long, and costs this many garrisons of Personnel. */
  contestedSeconds: number;
  overrunGarrisons: number;
}

export interface MarineConfig {
  storage: { pers: number; intel: number };
  /** Personnel a run starts with once Operations is open. */
  startingPersonnel: number;
  /** Clearing this node opens the Operations screen. */
  unlockNode: string;
  squadSlots: number;
  /** Barracks needed for each squad, in order. The first is the squad you start with. */
  squadBarracks: number[];
  /** Reward and Power maths. */
  win: { exponent: number };
  casualty: {
    base: number;
    slope: number;
    failMult: number;
    wounded: number;
    recoverySeconds: number;
    medic: number;
    medicCap: number;
    floor: number;
  };
  xp: { stage: number; complete: number };
  /** Seconds a stage waits for a tactic before the squad's standing order runs it. */
  briefSeconds: number;
  /** Rest between a squad's missions on auto. */
  restSeconds: number;
  /** Share of Power a fleet on Support orders adds to every squad. */
  supportBonus: number;
  /** Extra reward on stages where a tactic was chosen by hand. */
  activeBonus: number;
  /** Deuterium per point of Command in the supporting group for one orbital strike. */
  orbitalDeutPerCommand: number;
  /** Scouting an assault target lowers its threat by this share per Recon, up to the cap, until the run ends. */
  recon: { perScout: number; cap: number };
  /** A squad on auto needs this many ready marines to deploy. */
  minReady: number;
  incidents: IncidentConfig;
  /** Hunter strikes pay this share of the sector's campaign Salvage on a win. */
  hunter: { salvageShare: number };
  /** An auto squad only picks a target where every stage is at least this likely to be won. */
  autoMinWin: number;
}

export interface MarineData {
  units: UnitDef[];
  vehicles: VehicleDef[];
  ranks: RankDef[];
  perks: PerkDef[];
  tactics: TacticDef[];
  missions: MissionDef[];
  positions: PositionDef[];
  config: MarineConfig;
}

/* ---------- validation ---------- */

export function validateMarineData(d: MarineData, nodeIds: Set<string>): string[] {
  const errors: string[] = [];
  const unique = (list: { id: string }[], what: string) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) errors.push(`duplicate ${what} id ${x.id}`);
      seen.add(x.id);
    }
    return seen;
  };

  const unitIds = unique(d.units, 'unit');
  for (const u of d.units) {
    if (!(u.cost >= 1)) errors.push(`${u.id}: cost must be at least 1 Personnel`);
    for (const s of STATS) if (!(u.stats[s] > 0)) errors.push(`${u.id}: ${s} must be positive`);
    if (u.unlock.kind === 'node' && !nodeIds.has(u.unlock.node)) errors.push(`${u.id}: unlocked by unknown node ${u.unlock.node}`);
  }
  if (!d.units.some((u) => u.unlock.kind === 'start')) errors.push('no unit is available from the start');

  unique(d.vehicles, 'vehicle');
  for (const v of d.vehicles) {
    if (!(v.cost.rp >= 0) || !(v.cost.ti >= 0)) errors.push(`${v.id}: bad cost`);
    if (!(v.power >= 0) || !(v.casualty > 0)) errors.push(`${v.id}: bad power or casualty`);
    if (v.unlock.kind === 'node' && !nodeIds.has(v.unlock.node)) errors.push(`${v.id}: unlocked by unknown node ${v.unlock.node}`);
  }

  if (d.ranks.length === 0 || d.ranks[0].xp !== 0) errors.push('first rank must need 0 xp');
  if (d.ranks.some((r, i) => i > 0 && r.xp <= d.ranks[i - 1].xp)) errors.push('rank xp must increase');
  unique(d.ranks, 'rank');

  unique(d.perks, 'perk');
  for (const p of d.perks) {
    if (!Number.isInteger(p.rank) || p.rank < 1 || p.rank >= d.ranks.length) errors.push(`${p.id}: rank ${p.rank} is not a promotion`);
  }
  for (let r = 1; r < d.ranks.length; r++) {
    if (d.perks.filter((p) => p.rank === r).length < 2) errors.push(`rank ${r} needs at least two perks to choose between`);
  }

  const tacticIds = unique(d.tactics, 'tactic');
  for (const t of TACTICS) if (!tacticIds.has(t)) errors.push(`missing tactic ${t}`);
  for (const t of d.tactics) if (!(t.power > 0) || !(t.casualty > 0) || !(t.time > 0)) errors.push(`${t.id}: bad multipliers`);

  const missionIds = unique(d.missions, 'mission');
  for (const k of MISSION_KINDS) if (!missionIds.has(k)) errors.push(`missing mission ${k}`);
  for (const m of d.missions) {
    if (m.stages.length < 3 || m.stages.length > 6) errors.push(`${m.id}: missions run 3 to 6 stages`);
    if (!(m.seconds > 0) || !(m.threat > 0)) errors.push(`${m.id}: bad length or threat`);
    if (!(m.rewards.rp >= 0) || !(m.rewards.intel >= 0) || !(m.rewards.xp > 0)) errors.push(`${m.id}: bad rewards`);
    for (const s of m.stages) if (!(s.threat > 0) || !(s.tacticsReq >= 0)) errors.push(`${m.id}: stage ${s.name} is malformed`);
  }

  const posNodes = new Set<string>();
  for (const p of d.positions) {
    if (!nodeIds.has(p.node)) errors.push(`position on unknown node ${p.node}`);
    if (posNodes.has(p.node)) errors.push(`two positions on ${p.node}`);
    posNodes.add(p.node);
    if (!(p.threat > 0) || !(p.garrison >= 0) || !(p.rpSeconds >= 0) || !(p.intel >= 0)) errors.push(`${p.node}: bad numbers`);
    if (!(p.bonus.amount > 0)) errors.push(`${p.node}: bonus must be positive`);
    if (!(p.xpCap > 0)) errors.push(`${p.node}: xpCap must be positive`);
  }

  const ic = d.config.incidents;
  if (!(ic.max >= 1) || !(ic.boardingSeconds > 0) || !(ic.defendSeconds > 0)) errors.push('incident limits are invalid');
  if (!(ic.wreckBelow > 0 && ic.wreckBelow < 1) || !(ic.wrecksPerBattle >= 1)) errors.push('incident wreck settings are invalid');
  if (!(ic.holdChance >= 0 && ic.holdChance <= 1) || !(ic.hullChance.cap >= 0 && ic.hullChance.cap <= 1)) errors.push('incident chances must be 0 to 1');
  if (!(ic.defendEvery[0] > 0) || ic.defendEvery[1] < ic.defendEvery[0]) errors.push('defendEvery must be a rising pair above 0');
  if (!(ic.hullShare > 0 && ic.hullShare <= 1) || !(ic.contestedSeconds >= 0) || !(ic.overrunGarrisons >= 0)) errors.push('incident penalty values are invalid');
  for (const k of ['boarding', 'defend'] as const) if (!d.missions.some((m) => m.id === k && m.incident)) errors.push(`mission ${k} must exist and be an incident`);
  for (const m of d.missions) if (m.incident && m.auto) errors.push(`${m.id}: an incident mission cannot repeat on its own`);

  const c = d.config;
  if (!nodeIds.has(c.unlockNode)) errors.push('unlockNode is not a node');
  if (c.squadBarracks.length < 1 || c.squadBarracks[0] !== 0) errors.push('the first squad must need no Barracks');
  if (c.squadBarracks.some((x, i) => i > 0 && x <= c.squadBarracks[i - 1])) errors.push('squadBarracks must increase');
  if (!(c.squadSlots >= 1) || !Number.isInteger(c.squadSlots)) errors.push('squadSlots must be a whole number');
  if (!(c.win.exponent > 0)) errors.push('win exponent must be positive');
  if (!(c.casualty.wounded >= 0 && c.casualty.wounded <= 1)) errors.push('wounded share must be 0 to 1');
  if (!(c.casualty.recoverySeconds > 0) || !(c.casualty.medic > 0 && c.casualty.medic <= 1)) errors.push('casualty timing or medic value is invalid');
  if (!(c.minReady >= 1) || c.minReady > c.squadSlots) errors.push('minReady must be between 1 and the squad size');
  if (!(c.briefSeconds > 0) || !(c.restSeconds >= 0)) errors.push('timing values are invalid');
  if (!(c.autoMinWin > 0 && c.autoMinWin <= 1)) errors.push('autoMinWin must be above 0 and at most 1');
  for (const u of d.units) if (u.cost > c.storage.pers) errors.push(`${u.id}: costs more than Personnel storage holds`);
  void unitIds;
  return errors;
}
