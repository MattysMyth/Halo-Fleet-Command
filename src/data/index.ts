import buildingsJson from './buildings.json';
import armoryJson from './armory.json';
import economyJson from './economy.json';
import equipmentJson from './equipment.json';
import shipsJson from './ships.json';
import enemiesJson from './enemies.json';
import theatresJson from './theatres.json';
import warroomJson from './warroom.json';
import relicsJson from './relics.json';
import officersJson from './officers.json';
import type { OfficerDef } from './officerSchema';
import type { RelicDef } from './relicSchema';
import fleetJson from './fleet.json';
import combatJson from './combat.json';
import marinesJson from './marines.json';
import researchJson from './research.json';
import type { ArmoryDef, BuildingDef, EconomyConfig } from './schema';
import type { WarRoomData } from './warroomSchema';
import type {
  CombatConfig,
  EnemyDef,
  EquipmentDef,
  FleetConfig,
  NodeDef,
  ShipClassDef,
  TheatreDef,
} from './fleetSchema';
import type { MarineData } from './marineSchema';
import type { BranchDef, DoctrineDef, ResearchConfig, ResearchData, ResearchDef } from './researchSchema';

export type { ArmoryDef, BuildingDef, EconomyConfig, Resource, Unlock } from './schema';
export type {
  AbilityDef,
  Band,
  CombatConfig,
  DamageType,
  EnemyDef,
  EquipmentDef,
  FleetConfig,
  ModuleDef,
  NodeDef,
  Order,
  Priority,
  RankDef,
  Row,
  ShipClassDef,
  Stance,
  TheatreDef,
  WeaponDef,
  WeaponStats,
} from './fleetSchema';

export type {
  MarineConfig,
  MarineData,
  MarineUnlock,
  MissionDef,
  MissionKind,
  PerkDef,
  PerkEffect,
  PositionBonus,
  PositionDef,
  RankDef as MarineRankDef,
  StageDef,
  Standing,
  Stat,
  TacticDef,
  TacticId,
  UnitDef,
  VehicleDef,
} from './marineSchema';

export type { WarRoomConfig, WarRoomData, WarRoomItemDef, WarRoomItemDef as WarRoomDef, WarRoomKind } from './warroomSchema';
export type { BranchDef, DoctrineDef, Effect, ResearchConfig, ResearchData, ResearchDef } from './researchSchema';

export const BUILDINGS = buildingsJson as unknown as BuildingDef[];
export const ARMORY = armoryJson as unknown as ArmoryDef[];
export const ECONOMY = economyJson as unknown as EconomyConfig;

/** Lookup maps have no prototype, so ids such as "constructor" in a hand-edited save are simply unknown. */
function fromEntries<V>(entries: Iterable<readonly [string, V]>): Record<string, V> {
  return Object.assign(Object.create(null) as Record<string, V>, Object.fromEntries(entries));
}

export const BUILDING_BY_ID: Readonly<Record<string, BuildingDef>> = fromEntries(
  BUILDINGS.map((b) => [b.id, b]),
);
export const ARMORY_BY_ID: Readonly<Record<string, ArmoryDef>> = fromEntries(
  ARMORY.map((a) => [a.id, a]),
);

/* ---------- fleet and combat content ---------- */

export const EQUIPMENT = equipmentJson as unknown as EquipmentDef[];
export const SHIPS = shipsJson as unknown as ShipClassDef[];
export const ENEMIES = enemiesJson as unknown as EnemyDef[];
export const THEATRES = theatresJson as unknown as TheatreDef[];
export const FLEET = fleetJson as unknown as FleetConfig;
export const COMBAT = combatJson as unknown as CombatConfig;

export const EQUIPMENT_BY_ID: Readonly<Record<string, EquipmentDef>> = fromEntries(
  EQUIPMENT.map((e) => [e.id, e]),
);
export const SHIP_BY_ID: Readonly<Record<string, ShipClassDef>> = fromEntries(SHIPS.map((s) => [s.id, s]));
export const ENEMY_BY_ID: Readonly<Record<string, EnemyDef>> = fromEntries(ENEMIES.map((e) => [e.id, e]));

/** Every campaign node in order, across theatres. */
export const NODES: readonly NodeDef[] = THEATRES.flatMap((t) => t.nodes);
export const NODE_BY_ID: Readonly<Record<string, NodeDef>> = fromEntries(NODES.map((n) => [n.id, n]));
/** Which theatre a node belongs to. */
export const THEATRE_OF_NODE: Readonly<Record<string, TheatreDef>> = fromEntries(
  THEATRES.flatMap((t) => t.nodes.map((n) => [n.id, t] as const)),
);

/* ---------- marine content ---------- */

const MARINES = marinesJson as unknown as MarineData;
export const MARINE = MARINES.config;
export const MARINE_UNITS = MARINES.units;
export const VEHICLES = MARINES.vehicles;
export const MARINE_RANKS = MARINES.ranks;
export const PERKS = MARINES.perks;
export const TACTIC_DEFS = MARINES.tactics;
export const MISSIONS = MARINES.missions;
export const POSITIONS = MARINES.positions;

export const UNIT_BY_ID: Readonly<Record<string, (typeof MARINE_UNITS)[number]>> = fromEntries(
  MARINE_UNITS.map((u) => [u.id, u]),
);
export const VEHICLE_BY_ID: Readonly<Record<string, (typeof VEHICLES)[number]>> = fromEntries(
  VEHICLES.map((v) => [v.id, v]),
);
export const PERK_BY_ID: Readonly<Record<string, (typeof PERKS)[number]>> = fromEntries(PERKS.map((p) => [p.id, p]));
export const TACTIC_BY_ID: Readonly<Record<string, (typeof TACTIC_DEFS)[number]>> = fromEntries(
  TACTIC_DEFS.map((t) => [t.id, t]),
);
export const MISSION_BY_ID: Readonly<Record<string, (typeof MISSIONS)[number]>> = fromEntries(
  MISSIONS.map((m) => [m.id, m]),
);
export const POSITION_BY_NODE: Readonly<Record<string, (typeof POSITIONS)[number]>> = fromEntries(
  POSITIONS.map((p) => [p.node, p]),
);
export const MARINE_DATA: MarineData = MARINES;

/* ---------- research and doctrine content ---------- */

export const RESEARCH_DATA = researchJson as unknown as ResearchData;
export const RESEARCH_CONFIG: ResearchConfig = RESEARCH_DATA.config;
export const BRANCHES: BranchDef[] = RESEARCH_DATA.branches;
export const RESEARCH: ResearchDef[] = RESEARCH_DATA.nodes;
export const DOCTRINES: DoctrineDef[] = RESEARCH_DATA.doctrines;
export const RESEARCH_BY_ID: Readonly<Record<string, ResearchDef>> = fromEntries(RESEARCH.map((r) => [r.id, r]));
export const DOCTRINE_BY_ID: Readonly<Record<string, DoctrineDef>> = fromEntries(DOCTRINES.map((d) => [d.id, d]));

/* ---------- War Room content ---------- */

export const WARROOM_DATA = warroomJson as unknown as WarRoomData;
export const OFFICERS = officersJson as unknown as OfficerDef[];
export const OFFICER_BY_ID: Readonly<Record<string, OfficerDef>> = fromEntries(OFFICERS.map((o) => [o.id, o]));
export type { OfficerDef } from './officerSchema';
export const RELICS = relicsJson as unknown as RelicDef[];
export const RELIC_BY_ID: Readonly<Record<string, RelicDef>> = fromEntries(RELICS.map((r) => [r.id, r]));
export type { RelicDef, RelicEffect } from './relicSchema';
export const WARROOM_CONFIG = WARROOM_DATA.config;
export const WARROOM = WARROOM_DATA.items;
export const WARROOM_BY_ID: Readonly<Record<string, (typeof WARROOM)[number]>> = fromEntries(WARROOM.map((i) => [i.id, i]));
