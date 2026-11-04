/**
 * Campaign progress: which sectors are cleared, what they unlock, and the production bonus they
 * pay. Progress lives in MetaState, so it survives Redeploy.
 */
import { FLEET, NODES, NODE_BY_ID, POSITIONS, SHIPS, THEATRES, THEATRE_OF_NODE } from '../data';
import type { NodeDef, PositionBonus, ShipClassDef, TheatreDef } from '../data';
import type { MetaState } from '../state/types';
import { warroomTotal } from './warroom';

export const isCleared = (meta: MetaState, nodeId: string): boolean => (meta.cleared[nodeId] ?? 0) > 0;

/** Cleared in this cycle or in an earlier one (a Transfer wipes the first, never the second). */
export const everCleared = (meta: MetaState, nodeId: string): boolean => isCleared(meta, nodeId) || (meta.everCleared[nodeId] ?? 0) > 0;

export const clearedCount = (meta: MetaState): number => NODES.filter((n) => isCleared(meta, n.id)).length;

/** Production multiplier from sectors brought under control. */
export const sectorMultiplier = (meta: MetaState): number => 1 + FLEET.sectorBonus * clearedCount(meta);

export const isCaptured = (meta: MetaState, nodeId: string): boolean => (meta.captured[nodeId] ?? 0) > 0;

/** Total of the held ground positions' bonuses of one kind: a share for production, a count for Command. */
export function capturedBonus(meta: MetaState, kind: PositionBonus['kind'], contested?: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const p of POSITIONS) if (isCaptured(meta, p.node) && p.bonus.kind === kind && !(contested && (contested[p.node] ?? 0) > 0)) total += p.bonus.amount;
  return total;
}

/** Command capacity of one strike group: the base, a bonus for each theatre opened beyond the second (so farming an earlier front never shrinks a group), plus one per few sectors cleared, per position held for Command and per War Room level. */
export const commandCapacity = (meta: MetaState): number =>
  FLEET.commandCapacity + FLEET.lateTheatreCommand * Math.max(0, meta.theatresOpen - 2) + Math.floor(clearedCount(meta) / FLEET.sectorsPerCommand) + capturedBonus(meta, 'command') + warroomTotal(meta, 'command');

export type NodeStatus = 'cleared' | 'open' | 'locked';

/** A node is open when it is in the theatre being fought and everything before it there is cleared. */
export function nodeStatus(meta: MetaState, nodeId: string): NodeStatus {
  if (isCleared(meta, nodeId)) return 'cleared';
  const t = THEATRE_OF_NODE[nodeId];
  if (!t || t.id !== meta.theatre || t.id > meta.theatresOpen) return 'locked';
  const i = t.nodes.findIndex((n) => n.id === nodeId);
  return i === 0 || isCleared(meta, t.nodes[i - 1].id) ? 'open' : 'locked';
}

export const theatreCleared = (meta: MetaState, t: TheatreDef): boolean => isCleared(meta, t.nodes[t.nodes.length - 1].id);

/** A theatre whose boss has been beaten at any time. */
export const theatreEverCleared = (meta: MetaState, t: TheatreDef): boolean => everCleared(meta, t.nodes[t.nodes.length - 1].id);

export const theatreOpen = (meta: MetaState, t: TheatreDef): boolean => t.id <= meta.theatresOpen;

/** The theatre being fought. */
export const activeTheatre = (meta: MetaState): TheatreDef => THEATRES.find((t) => t.id === meta.theatre) ?? THEATRES[0];

/** The node a Campaign order fights next, or null when the active theatre is cleared. */
export function nextCampaignNode(meta: MetaState): NodeDef | null {
  return activeTheatre(meta).nodes.find((n) => nodeStatus(meta, n.id) === 'open') ?? null;
}

/** The furthest cleared node: the default Patrol target. */
export function highestCleared(meta: MetaState): NodeDef | null {
  let best: NodeDef | null = null;
  for (const n of NODES) if (isCleared(meta, n.id)) best = n;
  return best;
}

/** Nodes a Patrol order may be pointed at: any sector ever cleared, so a Transfer does not leave the fleet with nowhere to train. */
export const patrolOptions = (meta: MetaState): NodeDef[] => NODES.filter((n) => everCleared(meta, n.id));

/** Where a Patrol goes when none is chosen: the furthest sector cleared this run, else the easiest one ever cleared. */
export const defaultPatrol = (meta: MetaState): NodeDef | null => highestCleared(meta) ?? patrolOptions(meta)[0] ?? null;

export function isShipUnlocked(meta: MetaState, def: ShipClassDef): boolean {
  return def.unlock.kind === 'start' || everCleared(meta, def.unlock.node);
}

export const unlockedShips = (meta: MetaState): ShipClassDef[] => SHIPS.filter((s) => isShipUnlocked(meta, s));

/** Strike groups available: one, plus one per theatre ever cleared, plus the War Room's Reserve fleet. */
export function groupsUnlocked(meta: MetaState): number {
  return Math.min(FLEET.maxGroups, 1 + THEATRES.filter((t) => theatreEverCleared(meta, t)).length + warroomTotal(meta, 'group'));
}

export const nodeById = (id: string): NodeDef | undefined => NODE_BY_ID[id];
