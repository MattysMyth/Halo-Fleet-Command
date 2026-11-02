import { D, Decimal, ZERO } from '../core/numbers';
import { plural } from '../core/text';
import type { Notation } from '../core/numbers';
import {
  ARMORY,
  BUILDINGS,
  BUILDING_BY_ID,
  COMBAT,
  ECONOMY,
  ENEMY_BY_ID,
  FLEET,
  OFFICERS,
  SHIPS,
  THEATRES,
} from '../data';
import type { ArmoryDef, BuildingDef, NodeDef, OfficerDef, RankDef, Resource, ShipClassDef, TheatreDef } from '../data';
import {
  armoryLevel,
  canBuyArmory,
  nextArmoryCost,
  offlineCapSeconds,
  offlineEfficiency,
} from '../sim/armory';
import {
  buildingOutput,
  buyAmount,
  costOf,
  driveYield,
  globalMultiplier,
  isUnlocked,
  marginalOutput,
  milestoneMultiplier,
  nextMilestone,
} from '../sim/economy';
import {
  abilityCooldown,
  commandLeft,
  evasiveActive,
  focusActive,
} from '../sim/combat';
import type { AbilityId, Battle } from '../sim/combat';
import { commandCapacity, everCleared, groupsUnlocked, isCleared, isShipUnlocked, nodeStatus, sectorMultiplier } from '../sim/campaign';
import type { NodeStatus } from '../sim/campaign';
import { productionByResource, productionMultiplier, resourceOf, capOf } from '../sim/economy';
import {
  abilityCost,
  canQueue,
  classOf,
  groupCommand,
  integrityOf,
  rankIndex,
  runtimeOf,
  shipName,
  shipStats,
  shipsOf,
  slipCost,
  sortieCost,
  targetNode,
} from '../sim/fleet';
import { maxSlips } from './fleetState';
import { describeOfficer, officerOf, officerUnlocked } from '../sim/officers';
import { buildOpsView, stock } from './opsView';
import { buildCampaignView } from './campaignView';
import type { CampaignView } from './campaignView';
import { buildResearchView } from './researchView';
import type { ResearchScreenView } from './researchView';
import { ZERO as ZERO_D } from '../core/numbers';
import type { OpsView } from './opsView';
import { multiplierAfter, redeployGain, remainingToTrigger } from '../sim/prestige';
import type { BuyMode, GameState, Group, GroupResult, Ship } from './types';

export interface BuildingView {
  def: BuildingDef;
  /** What the building produces. Every building is bought with Requisition. */
  resource: Resource;
  owned: number;
  unlocked: boolean;
  /** The single next locked tier, shown greyed out with its requirement. */
  teaser: boolean;
  unlockText: string | null;
  /** Requisition per second from all copies of this building. */
  output: Decimal;
  /** Requisition per second from one copy (milestones and Medal bonus included). */
  perCopy: Decimal;
  /** Share of total production, 0 to 1. */
  share: number;
  /** Copies one click buys right now; 0 when it cannot be paid. */
  buyCount: number;
  /** Copies the button is labelled with. */
  labelCount: number;
  cost: Decimal;
  canAfford: boolean;
  /** Extra requisition per second the labelled purchase would add. */
  gain: Decimal;
  milestone: { previous: number; next: number | null; multiplier: number };
  autobuy: boolean;
}

export interface ArmoryView {
  def: ArmoryDef;
  level: number;
  cost: number | null;
  canBuy: boolean;
  current: string;
  next: string | null;
}

/** One chain of buildings (Requisition, Titanium-A, Deuterium) shown as a section of the Command screen. */
export interface BuildingSection {
  resource: Resource;
  title: string;
  blurb: string;
  buildings: BuildingView[];
}

export interface StockView {
  amount: Decimal;
  perSecond: Decimal;
  cap: number;
  /** Share of the cap in use, 0 to 1. */
  fill: number;
}

export interface ShipView {
  ship: Ship;
  name: string;
  className: string;
  command: number;
  rank: RankDef;
  /** Experience still needed for the next rank, or null at the top rank. */
  xpToNext: number | null;
  hull: number;
  maxHull: number;
  armour: number;
  speed: number;
  damageMult: number;
  pd: number;
  crippled: boolean;
  loadout: { weapon: string[]; defence: string[]; utility: string[] };
}

export interface AbilityView {
  id: AbilityId;
  name: string;
  blurb: string;
  cost: number;
  /** Seconds until it can be used again; 0 when ready. */
  cooldown: number;
  active: boolean;
  usable: boolean;
}

export interface ResultView {
  result: GroupResult;
  nodeName: string;
}

export interface BattleSummary {
  time: number;
  /** 0 close, 1 medium, 2 long. */
  band: number;
  control: 'player' | 'enemy';
  player: { left: number; start: number };
  enemy: { left: number; start: number };
  /** Share of starting Command at which a fleet breaks. */
  breakAt: number;
  focus: { target: number; secondsLeft: number } | null;
  outcome: string | null;
}

export interface OfficerView {
  def: OfficerDef;
  effect: string;
  available: boolean;
  /** The strike group this officer already leads, when it is another one. */
  elsewhere: string | null;
  unlockName: string;
}

export interface GroupView {
  group: Group;
  ships: ShipView[];
  command: number;
  capacity: number;
  integrity: number;
  target: NodeDef | null;
  /** Why the group is not in battle, or null while it is fighting or about to sortie. */
  waiting: string | null;
  rest: number;
  sortieCost: number;
  /** Everyone who could lead this group: the officer in charge, and who is free or serving elsewhere. */
  officers: OfficerView[];
  officer: OfficerDef | null;
  /** The live battle. A mutable reference: the battle view reads it each frame. */
  battle: Battle | null;
  battleNode: string | null;
  summary: BattleSummary | null;
  abilities: AbilityView[];
  last: ResultView | null;
}

export interface JobView {
  index: number;
  classId: string;
  name: string;
  remaining: number;
  total: number;
  working: boolean;
}

export interface ClassView {
  def: ShipClassDef;
  unlocked: boolean;
  canQueue: boolean;
  reason: string | null;
  afford: { rp: boolean; ti: boolean };
  owned: number;
  queued: number;
}

export interface NodeView {
  def: NodeDef;
  status: NodeStatus;
  clears: number;
  enemies: { name: string; count: number }[];
  /** Pay for the next campaign win, first-clear bonus included. */
  reward: { rp: number; ti: number; firstClear: boolean };
  unlocks: string[];
  /** A Patrol may be sent here: the sector was cleared this run or in an earlier theatre cycle. */
  patrol: boolean;
}

export interface SectorView {
  theatre: TheatreDef;
  nodes: NodeView[];
  cleared: number;
  total: number;
  /** Production multiplier from sectors under control. */
  multiplier: number;
}

export interface FleetView {
  unlocked: boolean;
  capacity: number;
  groups: GroupView[];
  groupsOpen: number;
  groupsMax: number;
  hangar: ShipView[];
  queue: JobView[];
  queueLimit: number;
  slips: number;
  maxSlips: number;
  slipCost: number | null;
  canBuySlip: boolean;
  classes: ClassView[];
  theatres: SectorView[];
  battleSpeed: number;
  cadreXp: number;
  battles: { total: number; won: number; lost: number };
  shipCount: number;
}

export interface View {
  rp: Decimal;
  rps: Decimal;
  ti: StockView;
  deut: StockView;
  ops: OpsView;
  research: ResearchScreenView;
  campaign: CampaignView;
  salvage: StockView;
  /** Show the Titanium and Deuterium pills once either has come into play. */
  showStocks: boolean;
  sections: BuildingSection[];
  fleet: FleetView;
  sectorMultiplier: number;
  cadreXp: number;
  earned: Decimal;
  driveYield: Decimal;
  medals: number;
  medalsEarned: number;
  multiplier: number;
  runSeconds: number;
  notation: Notation;
  display: { sound: boolean; volume: number; reduceMotion: boolean; highContrast: boolean; textScale: number };
  buyMode: BuyMode;
  buildings: BuildingView[];
  redeploy: {
    gain: number;
    ready: boolean;
    trigger: number;
    remaining: Decimal;
    /** earned / trigger, clamped to 0..1 */
    progress: number;
    multiplierAfter: number;
    medalsPerHour: number | null;
    count: number;
    lastRunSeconds: number | null;
    bestRunSeconds: number | null;
  };
  armory: ArmoryView[];
  offline: { capHours: number; efficiency: number };
  lifetimeEarned: Decimal;
}

function unlockText(def: BuildingDef): string | null {
  const u = def.unlock;
  if (u.kind === 'start') return null;
  const needed = BUILDING_BY_ID[u.building];
  return `Own ${u.count} ${u.count === 1 ? needed.name : plural(needed.name)}`;
}

/** Human text for what an Armory item does at a given level. Level 0 describes "not bought". */
export function armoryEffect(def: ArmoryDef, level: number): string {
  switch (def.kind) {
    case 'autobuy':
      return level > 0 ? 'Active' : 'Not active';
    case 'startBuildings': {
      const name = BUILDING_BY_ID[def.building].name;
      const count = level > 0 ? def.counts[Math.min(level, def.counts.length) - 1] : 0;
      return count > 0 ? `Start with ${count} ${name}s` : `Start with no ${name}s`;
    }
    case 'offlineCap': {
      const hours = ECONOMY.offline.baseCapHours + def.hoursPerLevel * level;
      return `Offline cap ${hours} hours`;
    }
    case 'offlineEfficiency': {
      const pct = Math.min(1, ECONOMY.offline.baseEfficiency + def.perLevel * level);
      return `Offline output ${Math.round(pct * 100)}%`;
    }
    case 'researchQueue':
      return `${1 + level} research ${level > 0 ? 'bays' : 'bay'}`;
    case 'doctrineSlot':
      return `${1 + level} doctrine ${level > 0 ? 'slots' : 'slot'}`;
  }
}

const SECTION_INFO: Record<Resource, { title: string; blurb: string }> = {
  rp: { title: 'Supply manifest', blurb: 'Requisition pays for everything else.' },
  ti: { title: 'Titanium-A extraction', blurb: 'Hull plate for ships and repairs.' },
  deut: { title: 'Deuterium refining', blurb: 'Fuel for sorties and combat abilities.' },
  pers: { title: 'Recruitment', blurb: 'Personnel fill the squads and garrison captured ground.' },
  intel: { title: 'Signals intelligence', blurb: 'Intel pays for field research.' },
};

function stockView(state: GameState, key: 'ti' | 'deut', rate: Decimal): StockView {
  const amount = state.run[key];
  const cap = capOf(state, key);
  return { amount, perSecond: rate, cap, fill: Math.min(1, amount.div(cap).toNumber()) };
}

function shipView(ship: Ship): ShipView {
  const st = shipStats(ship);
  const rank = FLEET.ranks[rankIndex(ship.xp)];
  const next = FLEET.ranks[rankIndex(ship.xp) + 1];
  return {
    ship,
    name: shipName(ship),
    className: classOf(ship).name,
    command: classOf(ship).command,
    rank,
    xpToNext: next ? next.xp - ship.xp : null,
    hull: ship.hull,
    maxHull: st.maxHull,
    armour: st.armour,
    speed: st.speed,
    damageMult: st.damageMult,
    pd: st.pd,
    crippled: ship.hull <= 0,
    loadout: { weapon: [...ship.weapons], defence: [...ship.defence], utility: [...ship.utility] },
  };
}

function abilityViews(state: GameState, battle: Battle | null): AbilityView[] {
  if (!battle) return [];
  const ids: AbilityId[] = ['focus', 'evasive', 'overcharge', 'retreat'];
  return ids.map((id) => {
    const def = COMBAT.abilities[id];
    const cost = abilityCost(id);
    const cooldown = id === 'retreat' ? 0 : abilityCooldown(battle, id);
    const active = id === 'focus' ? focusActive(battle) : id === 'evasive' ? evasiveActive(battle) : false;
    return {
      id,
      name: def.name,
      blurb: def.blurb,
      cost,
      cooldown,
      active,
      usable: !battle.outcome && cooldown <= 0 && state.run.deut.gte(cost),
    };
  });
}

function summaryOf(b: Battle): BattleSummary {
  return {
    time: b.time,
    band: b.band,
    control: b.control,
    player: { left: commandLeft(b, 'player'), start: b.startCommand.player },
    enemy: { left: commandLeft(b, 'enemy'), start: b.startCommand.enemy },
    breakAt: COMBAT.breakFraction,
    focus: focusActive(b) && b.focus ? { target: b.focus.target, secondsLeft: Math.max(0, b.focus.until - b.time) } : null,
    outcome: b.outcome,
  };
}

function groupView(state: GameState, group: Group, capacity: number): GroupView {
  const rt = runtimeOf(state, group.id);
  const last = rt.last;
  return {
    group,
    ships: shipsOf(state, group.id).map(shipView),
    command: groupCommand(state, group.id),
    capacity,
    integrity: integrityOf(state, group.id),
    target: targetNode(state, group).node,
    waiting: rt.battle ? null : rt.waiting,
    rest: rt.rest,
    sortieCost: sortieCost(state, group.id),
    officer: officerOf(state, group),
    officers: OFFICERS.map((def) => ({
      def,
      effect: describeOfficer(def),
      available: officerUnlocked(state.meta, def),
      elsewhere: state.run.fleet.groups.find((g) => g.id !== group.id && g.officer === def.id)?.name ?? null,
      unlockName: NODE_NAME[def.unlock] ?? def.unlock,
    })),
    battle: rt.battle,
    battleNode: rt.node,
    summary: rt.battle ? summaryOf(rt.battle) : null,
    abilities: abilityViews(state, rt.battle),
    last: last ? { result: last, nodeName: NODE_NAME[last.node] ?? last.node } : null,
  };
}

const NODE_NAME: Record<string, string> = Object.fromEntries(THEATRES.flatMap((t) => t.nodes.map((n) => [n.id, n.name])));

function nodeView(state: GameState, def: NodeDef): NodeView {
  const clears = state.meta.cleared[def.id] ?? 0;
  const first = !isCleared(state.meta, def.id);
  const mult = first ? FLEET.firstClearMult : 1;
  return {
    def,
    status: nodeStatus(state.meta, def.id),
    clears,
    enemies: Object.entries(def.enemies).map(([id, count]) => ({ name: ENEMY_BY_ID[id]?.name ?? id, count })),
    reward: { rp: def.reward.rp * mult, ti: def.reward.ti * mult, firstClear: first },
    unlocks: (def.unlocks ?? []).map((id) => SHIPS.find((c) => c.id === id)?.name ?? id),
    patrol: everCleared(state.meta, def.id),
  };
}

function fleetView(state: GameState): FleetView {
  const fleet = state.run.fleet;
  const capacity = commandCapacity(state.meta);
  const queueCounts: Record<string, number> = {};
  for (const j of fleet.queue) queueCounts[j.classId] = (queueCounts[j.classId] ?? 0) + 1;
  const ownedCounts: Record<string, number> = {};
  for (const sh of fleet.ships) ownedCounts[sh.classId] = (ownedCounts[sh.classId] ?? 0) + 1;

  const cost = slipCost(state);
  const working = Math.min(fleet.slips, fleet.queue.length);
  return {
    unlocked: state.meta.fleetUnlocked,
    capacity,
    groups: fleet.groups.map((g) => groupView(state, g, capacity)),
    groupsOpen: fleet.groups.length,
    groupsMax: Math.max(groupsUnlocked(state.meta), fleet.groups.length),
    hangar: shipsOf(state, 0).map(shipView),
    queue: fleet.queue.map((j, index) => ({
      index,
      classId: j.classId,
      name: SHIPS.find((c) => c.id === j.classId)?.name ?? j.classId,
      remaining: Math.max(0, j.remaining),
      total: j.total,
      working: index < working,
    })),
    queueLimit: FLEET.queueLimit,
    slips: fleet.slips,
    maxSlips: maxSlips(),
    slipCost: cost,
    canBuySlip: cost !== null && state.run.rp.gte(cost),
    classes: SHIPS.map((def) => {
      const unlocked = isShipUnlocked(state.meta, def);
      const check = unlocked ? canQueue(state, def.id) : { ok: false as const, reason: 'Not unlocked' };
      return {
        def,
        unlocked,
        canQueue: check.ok,
        reason: check.ok ? null : check.reason,
        afford: { rp: state.run.rp.gte(def.cost.rp), ti: state.run.ti.gte(def.cost.ti) },
        owned: ownedCounts[def.id] ?? 0,
        queued: queueCounts[def.id] ?? 0,
      };
    }),
    theatres: THEATRES.map((theatre) => {
      const nodes = theatre.nodes.map((n) => nodeView(state, n));
      return {
        theatre,
        nodes,
        cleared: nodes.filter((n) => n.status === 'cleared').length,
        total: nodes.length,
        multiplier: sectorMultiplier(state.meta),
      };
    }),
    battleSpeed: state.settings.battleSpeed,
    cadreXp: state.meta.cadreXp,
    battles: { ...state.meta.battles },
    shipCount: fleet.ships.length,
  };
}

/** Which chains to show: any chain with an unlocked building, or one whose first locked building is within reach. */
function sectionsOf(buildings: BuildingView[], state: GameState): BuildingSection[] {
  const out: BuildingSection[] = [];
  for (const resource of ['rp', 'ti', 'deut', 'pers', 'intel'] as Resource[]) {
    const chain = buildings.filter((b) => b.resource === resource);
    if (chain.length === 0) continue;
    const anyUnlocked = chain.some((b) => b.unlocked);
    const firstLocked = chain.find((b) => !b.unlocked);
    const u = firstLocked?.def.unlock;
    const near = u && u.kind === 'owned' ? (state.run.owned[u.building] ?? 0) > 0 : false;
    if (resource !== 'rp' && !anyUnlocked && !near) continue;
    out.push({ resource, ...SECTION_INFO[resource], buildings: chain });
  }
  return out;
}

export interface ViewContext {
  screen: string;
  squad: number;
}

export function buildView(state: GameState, ctx: ViewContext = { screen: 'command', squad: 1 }): View {
  const mode = state.settings.buyMode;
  const production = productionByResource(state);

  const teaserShown: Record<Resource, boolean> = { rp: false, ti: false, deut: false, pers: false, intel: false };
  const buildings: BuildingView[] = BUILDINGS.map((def) => {
    const resource = resourceOf(def);
    const owned = state.run.owned[def.id] ?? 0;
    const unlocked = isUnlocked(state, def);
    const teaser = !unlocked && !teaserShown[resource];
    if (teaser) teaserShown[resource] = true;

    const gm = productionMultiplier(state, resource);
    const output = buildingOutput(state, def);
    const buyCount = unlocked ? buyAmount(state, def, mode) : 0;
    const labelCount = buyCount > 0 ? buyCount : mode === 'max' ? 1 : mode;
    const cost = costOf(def, owned, labelCount);

    // Gain from the labelled purchase: output after minus output before, with milestones.
    const after = D(def.baseOutput * milestoneMultiplier(owned + labelCount)).mul(owned + labelCount).mul(gm);
    const gain = labelCount === 1 ? D(marginalOutput(state, def)) : after.sub(output);
    const total = production[resource];

    return {
      def,
      resource,
      owned,
      unlocked,
      teaser,
      unlockText: unlocked ? null : unlockText(def),
      output,
      perCopy: D(def.baseOutput * milestoneMultiplier(Math.max(owned, 1))).mul(gm),
      share: total.gt(0) ? output.div(total).toNumber() : 0,
      buyCount,
      labelCount,
      cost,
      canAfford: buyCount > 0,
      gain,
      milestone: {
        previous: [...ECONOMY.milestones].reverse().find((m) => m <= owned) ?? 0,
        next: nextMilestone(owned),
        multiplier: milestoneMultiplier(owned),
      },
      autobuy: ARMORY.some((a) => a.kind === 'autobuy' && a.building === def.id && armoryLevel(state.meta, a.id) > 0),
    };
  });

  const gain = redeployGain(state);
  const trigger = ECONOMY.prestige.trigger;
  const hours = state.run.elapsed / 3600;
  const fleet = fleetView(state);
  const showStocks =
    state.meta.fleetUnlocked || state.run.ti.gt(0) || state.run.deut.gt(0) || production.ti.gt(0) || production.deut.gt(0);

  return {
    rp: state.run.rp,
    rps: production.rp,
    ti: stockView(state, 'ti', production.ti),
    deut: stockView(state, 'deut', production.deut),
    ops: buildOpsView(state, ctx.squad, ctx.screen === 'operations', { pers: production.pers, intel: production.intel }),
    research: buildResearchView(state),
    campaign: buildCampaignView(state),
    salvage: stock(state, 'salvage', ZERO_D),
    showStocks,
    sections: sectionsOf(buildings, state),
    fleet,
    sectorMultiplier: sectorMultiplier(state.meta),
    cadreXp: state.meta.cadreXp,
    earned: state.run.earned,
    driveYield: driveYield(state),
    medals: state.meta.medals,
    medalsEarned: state.meta.medalsEarned,
    multiplier: globalMultiplier(state),
    runSeconds: state.run.elapsed,
    notation: state.settings.notation,
    display: {
      sound: state.settings.sound,
      volume: state.settings.volume,
      reduceMotion: state.settings.reduceMotion,
      highContrast: state.settings.highContrast,
      textScale: state.settings.textScale,
    },
    buyMode: mode,
    buildings,
    redeploy: {
      gain,
      ready: gain >= 1,
      trigger,
      remaining: remainingToTrigger(state),
      progress: Math.min(1, state.run.earned.div(trigger).toNumber()),
      multiplierAfter: multiplierAfter(state, gain),
      medalsPerHour: gain >= 1 && hours > 0 ? gain / hours : null,
      count: state.meta.redeploys,
      lastRunSeconds: state.meta.lastRunSeconds,
      bestRunSeconds: state.meta.bestRunSeconds,
    },
    armory: ARMORY.map((def) => {
      const level = armoryLevel(state.meta, def.id);
      return {
        def,
        level,
        cost: nextArmoryCost(state.meta, def),
        canBuy: canBuyArmory(state.meta, def),
        current: armoryEffect(def, level),
        next: level < def.maxLevel ? armoryEffect(def, level + 1) : null,
      };
    }),
    offline: { capHours: offlineCapSeconds(state.meta) / 3600, efficiency: offlineEfficiency(state.meta) },
    lifetimeEarned: state.meta.lifetimeEarned ?? ZERO,
  };
}
