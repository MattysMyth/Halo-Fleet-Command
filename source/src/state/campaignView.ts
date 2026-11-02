/**
 * What the Campaign screen shows: every theatre as a map card, the Transfer panel and the War Room
 * shop that Battle Honors pay for.
 */
import { RELICS, SHIP_BY_ID, THEATRES, WARROOM } from '../data';
import type { NodeDef, RelicDef, TheatreDef, WarRoomDef } from '../data';
import { activeTheatre, everCleared, isCleared, nodeStatus, theatreCleared, theatreEverCleared, theatreOpen } from '../sim/campaign';
import { canTransfer, transferCost, transferGain, transferOpens, transferProblem } from '../sim/transfer';
import { capOf } from '../sim/economy';
import { maxRelicLevel, nextRelicCost, relicLevel, relicProblem } from '../sim/relics';
import { canBuyWarroom, honorBonus, nextWarroomCost, warroomLevel } from '../sim/warroom';
import type { GameState } from './types';

export type PinState = 'secured' | 'earlier' | 'open' | 'locked';

export interface TheatreCard {
  theatre: TheatreDef;
  state: 'active' | 'open' | 'locked';
  pins: { node: NodeDef; state: PinState }[];
  /** Sectors secured in this cycle. */
  cleared: number;
  boss: NodeDef;
  bossDown: boolean;
  /** The boss has fallen in some cycle: the theatre's strike group is kept. */
  everBeaten: boolean;
  honors: number;
}

export interface TransferStep {
  label: string;
  done: boolean;
}

export interface TransferView {
  theatre: TheatreDef;
  steps: TransferStep[];
  ready: boolean;
  problem: string | null;
  gain: number;
  opens: TheatreDef | null;
  /** What this Transfer would give up. */
  cost: { medals: number; medalsEarned: number; armory: number };
  honorBonusAfter: number;
}

export interface WarRoomItemView {
  def: WarRoomDef;
  level: number;
  cost: number | null;
  canBuy: boolean;
  current: string;
  next: string | null;
}

export interface RelicView {
  def: RelicDef;
  level: number;
  max: number;
  cost: number | null;
  canBuy: boolean;
  /** The next level costs more Salvage than the stockpile can ever hold. */
  overCap: boolean;
  current: string;
  next: string | null;
}

export interface CampaignView {
  relics: RelicView[];
  salvage: number;
  unlocked: boolean;
  theatres: TheatreCard[];
  transfer: TransferView;
  warroom: WarRoomItemView[];
  honors: number;
  honorsEarned: number;
  honorBonus: number;
  transfers: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function relicEffect(def: RelicDef, level: number): string {
  return level === 0 ? 'No bonus' : `+${Math.round(def.perLevel * level * 100)}% ${def.label}`;
}

export function warroomEffect(def: WarRoomDef, level: number): string {
  switch (def.kind) {
    case 'doctrineSlot':
      return level === 0 ? 'No extra slot' : `+${plural(level, 'doctrine slot', 'doctrine slots')}`;
    case 'group':
      return level === 0 ? 'No extra group' : `+${plural(level, 'strike group', 'strike groups')}`;
    case 'command':
      return level === 0 ? 'No extra Command' : `+${level} Command capacity per group`;
  }
}

function card(state: GameState, theatre: TheatreDef): TheatreCard {
  const meta = state.meta;
  const boss = theatre.nodes[theatre.nodes.length - 1];
  const open = theatreOpen(meta, theatre);
  return {
    theatre,
    state: !open ? 'locked' : meta.theatre === theatre.id ? 'active' : 'open',
    pins: theatre.nodes.map((node) => {
      const s = nodeStatus(meta, node.id);
      const pin: PinState = isCleared(meta, node.id) ? 'secured' : everCleared(meta, node.id) ? 'earlier' : s === 'open' ? 'open' : 'locked';
      return { node, state: pin };
    }),
    cleared: theatre.nodes.filter((n) => isCleared(meta, n.id)).length,
    boss,
    bossDown: theatreCleared(meta, theatre),
    everBeaten: theatreEverCleared(meta, theatre),
    honors: theatre.honors,
  };
}

export function buildCampaignView(state: GameState): CampaignView {
  const meta = state.meta;
  const theatre = activeTheatre(meta);
  const boss = theatre.nodes[theatre.nodes.length - 1];
  const steps: TransferStep[] = [{ label: `Defeat ${boss.name}`, done: theatreCleared(meta, theatre) }];
  if (theatre.transferShip) {
    steps.push({
      label: `Field a ${SHIP_BY_ID[theatre.transferShip]?.name ?? theatre.transferShip}`,
      done: state.run.fleet.ships.some((s) => s.classId === theatre.transferShip),
    });
  }
  const cost = transferCost(state);
  return {
    unlocked: meta.fleetUnlocked,
    theatres: THEATRES.map((t) => card(state, t)),
    transfer: {
      theatre,
      steps,
      ready: canTransfer(state),
      problem: transferProblem(state),
      gain: transferGain(state),
      opens: transferOpens(state),
      cost: { medals: cost.medals, medalsEarned: cost.medalsEarned, armory: cost.armory },
      honorBonusAfter: honorBonus({ ...meta, honorsEarned: meta.honorsEarned + theatre.honors }),
    },
    warroom: WARROOM.map((def) => {
      const level = warroomLevel(meta, def.id);
      const next = nextWarroomCost(meta, def);
      return {
        def,
        level,
        cost: next,
        canBuy: canBuyWarroom(meta, def),
        current: warroomEffect(def, level),
        next: next === null ? null : warroomEffect(def, level + 1),
      };
    }),
    relics: RELICS.map((def) => {
      const level = relicLevel(meta, def.id);
      const next = nextRelicCost(meta, def);
      return {
        def,
        level,
        max: maxRelicLevel(def),
        cost: next,
        canBuy: relicProblem(state, def.id) === null,
        overCap: next !== null && next > capOf(state, 'salvage'),
        current: relicEffect(def, level),
        next: next === null ? null : relicEffect(def, level + 1),
      };
    }),
    salvage: state.run.salvage.toNumber(),
    honors: meta.honors,
    honorsEarned: meta.honorsEarned,
    honorBonus: honorBonus(meta),
    transfers: meta.transfers,
  };
}
