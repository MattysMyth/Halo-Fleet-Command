import { computed, signal } from '@preact/signals';
import { FixedLoop } from '../core/loop';
import { formatCount, formatDuration, formatNumber } from '../core/numbers';
import type { Notation } from '../core/numbers';
import { clearSave, pickStore, readSave, writeSave } from '../core/save';
import { plural } from '../core/text';
import { configureSound, playCue } from '../core/sound';
import type { Cue } from '../core/sound';
import { ARMORY_BY_ID, BUILDINGS, BUILDING_BY_ID, ECONOMY, ENEMY_BY_ID, FLEET, MARINE, NODE_BY_ID, SHIP_BY_ID, THEATRES, RELIC_BY_ID, WARROOM_BY_ID } from '../data';
import type { MissionKind, Order, Priority, Row, Stance, Standing, TacticId } from '../data';
import { MARINE_RANKS, MISSION_BY_ID } from '../data';
import { buyArmory } from '../sim/armory';
import { buy, buyAmount, drive, milestonesReached } from '../sim/economy';
import type { AbilityId } from '../sim/combat';
import * as fleetSim from '../sim/fleet';
import type { Result } from '../sim/fleet';
import * as marineSim from '../sim/marines';
import * as researchSim from '../sim/research';
import { redeploy } from '../sim/prestige';
import * as transferSim from '../sim/transfer';
import type { TransferReport } from '../sim/transfer';
import { buyWarroom } from '../sim/warroom';
import { buyRelic } from '../sim/relics';
import type { RedeployReport } from '../sim/prestige';
import { advanceWorld, applyOfflineWorld, stepWorld } from '../sim/world';
import type { WorldEvent, WorldOfflineReport } from '../sim/world';
import { bonusText } from './opsView';
import { buildView } from './selectors';
import { decodeSave, encodeSave, newGameState, TEXT_SCALES } from './serialize';
import type { BuyMode, GameState } from './types';

export type Screen = 'command' | 'fleet' | 'operations' | 'research' | 'campaign' | 'prestige' | 'settings';
export type FleetTab = 'battle' | 'drydock' | 'sector';
export type LogKind = 'info' | 'milestone' | 'prestige' | 'offline' | 'system' | 'fleet' | 'battle' | 'ops';

export interface LogEntry {
  id: number;
  /** Run clock when the entry was written, e.g. "1h 02m". */
  at: string;
  text: string;
  kind: LogKind;
}

const AUTOSAVE_MS = 30_000;
const LOG_LIMIT = 60;

const { store: storage, persistent } = pickStore();

function loadInitial(): { state: GameState; fresh: boolean } {
  const text = readSave(storage);
  const loaded = text ? decodeSave(text) : null;
  if (!loaded) return { state: newGameState(Date.now(), Math.floor(Math.random() * 2 ** 32)), fresh: true };
  return { state: loaded, fresh: false };
}

/* ---------- reactive state ---------- */

const initial = loadInitial();
let state: GameState = initial.state;

/** Bumped after every change; the view recomputes from it. */
export const frame = signal(0);
export const screen = signal<Screen>('command');
export const fleetTab = signal<FleetTab>('battle');
/** The strike group the Fleet screen is showing. */
export const selectedGroup = signal(1);
/** The squad the Operations screen is showing. */
export const selectedSquad = signal(1);
export const logEntries = signal<LogEntry[]>([]);
export const offlineReport = signal<WorldOfflineReport | null>(null);
/** A short message about the last action that could not be done, shown for a few seconds. */
export const notice = signal<string | null>(null);
export const saveInfo = signal<{ at: number | null; ok: boolean; persistent: boolean }>({
  at: null,
  ok: true,
  persistent,
});
/** Patrol estimates the player asked for, by group and node. Cleared when ships or loadouts change. */
export const scouted = signal<Record<string, { winRate: number; at: number }>>({});

export const view = computed(() => {
  frame.value;
  return buildView(state, { screen: screen.value, squad: selectedSquad.value });
});

export const getState = (): GameState => state;
const touch = (): void => {
  frame.value += 1;
};

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string): void {
  notice.value = text;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = null;
  }, 4000);
}

/* ---------- log ---------- */

let logId = 0;
/** Apply the display and sound settings: sound cues, and attributes the stylesheet reads. */
export function applyDisplay(): void {
  const st = state.settings;
  configureSound(st.sound, st.volume);
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.contrast = st.highContrast ? 'high' : 'normal';
  root.dataset.motion = st.reduceMotion ? 'reduce' : 'full';
  root.dataset.scale = String(st.textScale);
}

const cue = (c: Cue): void => void playCue(c);

function log(text: string, kind: LogKind = 'info'): void {
  const entry: LogEntry = { id: (logId += 1), at: formatDuration(state.run.elapsed), text, kind };
  logEntries.value = [entry, ...logEntries.value].slice(0, LOG_LIMIT);
}

/** Last milestone count per building, so only new doublings are logged. */
let seenMilestones: Record<string, number> = {};
function baselineMilestones(): void {
  seenMilestones = Object.fromEntries(BUILDINGS.map((b) => [b.id, milestonesReached(state.run.owned[b.id] ?? 0)]));
}
function checkMilestones(): void {
  for (const b of BUILDINGS) {
    const now = milestonesReached(state.run.owned[b.id] ?? 0);
    if (now > (seenMilestones[b.id] ?? 0)) {
      log(`${plural(b.name)} reached ${state.run.owned[b.id]}. Output doubled.`, 'milestone');
    }
    seenMilestones[b.id] = now;
  }
}

/* ---------- fleet events ---------- */

const groupName = (id: number): string => state.run.fleet.groups.find((g) => g.id === id)?.name ?? 'the hangar';

function onFleetEvent(e: WorldEvent): void {
  const n = (v: Parameters<typeof formatNumber>[0]) => formatNumber(v, state.settings.notation);
  switch (e.kind) {
    case 'fleet-unlocked':
      log('Fleet Command is online. Build ships at the drydock, then send them out.', 'milestone');
      break;
    case 'launch':
      log(`${e.className} ${e.ship.id} launched${e.group ? ` into ${groupName(e.group)}` : ' to the hangar'}.`, 'fleet');
      break;
    case 'battle': {
      const r = e.result;
      if (r.outcome === 'victory') {
        // Patrol wins are routine; the sector counter tells that story.
        if (r.order === 'campaign') {
          const bonus = r.firstClear ? ' First clear bonus.' : '';
          cue('win');
          log(`Victory at ${e.nodeName}. +${n(r.rp)} RP, +${formatCount(r.ti, state.settings.notation)} Ti${r.salvage > 0 ? `, +${formatCount(r.salvage, state.settings.notation)} Salvage` : ''}.${bonus}`, 'fleet');
        }
      } else if (r.outcome === 'retreat') {
        log(`${e.group.name} slipped away from ${e.nodeName}. Ships intact.`, 'battle');
      } else if (r.outcome === 'draw') {
        log(`${e.group.name} broke off at ${e.nodeName}. Neither side held.`, 'battle');
      } else {
        const hurt = r.crippled > 0 ? ` ${r.crippled} ship${r.crippled === 1 ? '' : 's'} crippled.` : '';
        cue('lose');
        log(`Defeat at ${e.nodeName}.${hurt}`, 'battle');
      }
      break;
    }
    case 'cleared': {
      cue('fanfare');
      const bonus = `Production +${Math.round(FLEET.sectorBonus * 100)}%.`;
      log(e.boss ? `${e.node.name} broken. The theatre is secured. ${bonus}` : `${e.node.name} secured. ${bonus}`, 'milestone');
      for (const s of e.unlocks) log(`${s.name} design unlocked at the drydock.`, 'milestone');
      break;
    }
    case 'rank':
      if (e.rank.id === 'veteran' || e.rank.id === 'elite') log(`${fleetSim.shipName(e.ship)} promoted to ${e.rank.name}.`, 'fleet');
      break;
    case 'stalled':
      log(`${e.group.name} is holding position after repeated defeats. Refit or reinforce it, then resume.`, 'battle');
      break;
    case 'group':
      log(`${e.group.name} authorised.`, 'fleet');
      break;
    case 'sortie':
      break;
    case 'research':
      cue('chime');
      log(`Research complete: ${e.def.name}.`, 'milestone');
      break;
    default:
      onMarineEvent(e);
  }
}

/* ---------- marine events ---------- */

function onMarineEvent(e: marineSim.MarineEvent): void {
  const n = (v: Parameters<typeof formatNumber>[0]) => formatNumber(v, state.settings.notation);
  switch (e.kind) {
    case 'ops-unlocked':
      cue('chime');
      log('Operations is open. A detachment of marines has reported for duty. Equip them and send them out.', 'milestone');
      break;
    case 'squad':
      log(`${e.squad.name} formed.`, 'ops');
      break;
    case 'mission': {
      const s = e.summary;
      const name = MISSION_BY_ID[s.kind].name;
      if (s.outcome === 'aborted') {
        log(`${e.squad.name} was recalled from ${e.nodeName}.`, 'ops');
      } else if (s.outcome === 'lost') {
        const dead = s.killed > 0 ? ` ${s.killed} killed.` : '';
        cue('lose');
        log(`${e.squad.name} fell back from ${e.nodeName}.${dead}`, 'battle');
      } else if (s.captured) {
        cue('fanfare');
        log(`${e.squad.name} took ${e.nodeName}. The position is ours.`, 'milestone');
      } else if (s.kind !== 'patrol') {
        log(`${name} at ${e.nodeName} complete. +${n(s.rp)} RP, +${formatCount(s.intel, state.settings.notation)} Intel.`, 'ops');
      }
      break;
    }
    case 'captured': {
      log(`${e.position.name} held: ${bonusText(e.position.bonus)}.`, 'milestone');
      break;
    }
    case 'marine-rank':
      if (MARINE_RANKS.indexOf(e.rank) >= 2) log(`${e.squad.name}: a marine reached ${e.rank.name}. Choose a perk.`, 'ops');
      break;
    case 'squad-stalled':
      log(`${e.squad.name} stood down after repeated failures. Reinforce or retrain it, then resume.`, 'battle');
      break;
    case 'incident':
      if (e.incident.kind === 'boarding') {
        log(`A crippled ${ENEMY_BY_ID[e.incident.enemy ?? '']?.name ?? 'enemy ship'} is drifting at ${NODE_BY_ID[e.incident.node]?.name}. Marines could board it.`, 'ops');
      } else {
        log(`Covenant forces are counter-attacking ${NODE_BY_ID[e.incident.node]?.name}. Send a squad to Defend.`, 'battle');
      }
      break;
    case 'incident-ended': {
      const where = NODE_BY_ID[e.incident.node]?.name ?? e.incident.node;
      if (e.result === 'held') log(`The garrison at ${where} held.`, 'ops');
      else if (e.result === 'overrun') log(`${where} was overrun. ${e.pers} Personnel lost and its bonus is suspended for a while.`, 'battle');
      else log(`The boarding chance at ${where} slipped away.`, 'ops');
      break;
    }
    case 'boarded': {
      const hull = e.hull ? ` A ${SHIP_BY_ID[MARINE.incidents.hullClass]?.name ?? 'hull'} was recovered for the fleet.` : '';
      log(`${e.squad.name} boarded the wreck: +${n(e.salvage)} Salvage.${hull}`, 'milestone');
      break;
    }
    case 'deploy':
    case 'stage':
      break;
  }
}

/* ---------- saving ---------- */

export function saveNow(): void {
  state.lastSeen = Date.now();
  const ok = writeSave(storage, encodeSave(state));
  saveInfo.value = { at: state.lastSeen, ok, persistent };
}

/* ---------- time ---------- */

function describeOffline(r: WorldOfflineReport): string {
  const n = (v: Parameters<typeof formatNumber>[0]) => formatNumber(v, state.settings.notation);
  const capped = r.awaySeconds > r.appliedSeconds ? ` (capped at ${formatDuration(r.capSeconds)})` : '';
  const extra: string[] = [];
  if (r.ti.gt(0)) extra.push(`${n(r.ti)} Ti`);
  if (r.deut.gt(0)) extra.push(`${n(r.deut)} Deut`);
  const fleet = r.fleet.patrols.reduce((acc, p) => ({ battles: acc.battles + p.battles, wins: acc.wins + p.wins }), { battles: 0, wins: 0 });
  if (fleet.battles > 0) extra.push(`${fleet.wins} of ${fleet.battles} patrol battles won`);
  if (r.fleet.launched > 0) extra.push(`${r.fleet.launched} ship${r.fleet.launched === 1 ? '' : 's'} launched`);
  const ops = r.marines;
  if (ops.missions > 0) extra.push(`${ops.won} of ${ops.missions} marine missions won`);
  if (ops.captured > 0) extra.push(`${ops.captured} position${ops.captured === 1 ? '' : 's'} taken`);
  const tail = extra.length > 0 ? ` Also: ${extra.join(', ')}.` : '';
  return `Away ${formatDuration(r.awaySeconds)}${capped}. Earned ${n(r.gained)} RP at ${Math.round(r.efficiency * 100)}% output.${tail}`;
}

/** Apply a long stretch of time. Short gaps are the tab being throttled, so they run at full output. */
function applyGap(seconds: number): void {
  if (seconds <= 0) return;
  if (seconds <= ECONOMY.offline.backgroundLimitSeconds) {
    advanceWorld(state, seconds, onFleetEvent);
    return;
  }
  const report = applyOfflineWorld(state, seconds, onFleetEvent);
  offlineReport.value = report;
  log(describeOffline(report), 'offline');
}

const loop = new FixedLoop({
  onStep: (dt) => stepWorld(state, dt, onFleetEvent),
  onGap: (seconds) => applyGap(seconds),
  onTick: () => {
    state.lastSeen = Date.now();
    checkMilestones();
    keepSelectionValid();
    touch();
  },
});

let lastAutosave = Date.now();

export function start(): void {
  // Time since the save was written counts as away time.
  const away = (Date.now() - state.lastSeen) / 1000;
  baselineMilestones();
  applyDisplay();
  if (initial.fresh) {
    log('Requisition office open. Stock a depot to get supplies moving.', 'system');
  } else {
    log('Save loaded.', 'system');
    applyGap(away);
    baselineMilestones();
  }
  touch();

  loop.start();
  setInterval(() => {
    if (Date.now() - lastAutosave >= AUTOSAVE_MS) {
      lastAutosave = Date.now();
      saveNow();
    }
  }, 5_000);

  const flush = (): void => saveNow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else loop.tick();
  });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
}

/* ---------- actions ---------- */

export function setScreen(next: Screen): void {
  screen.value = next;
}

export function setFleetTab(next: FleetTab): void {
  fleetTab.value = next;
}

/** Keep the selected group pointing at one that exists (a Redeploy or reset can change the list). */
function keepSelectionValid(): void {
  const groups = state.run.fleet.groups;
  if (!groups.some((g) => g.id === selectedGroup.value)) selectedGroup.value = groups[0]?.id ?? 1;
  const squads = state.run.marines.squads;
  if (!squads.some((q) => q.id === selectedSquad.value)) selectedSquad.value = squads[0]?.id ?? 1;
}

export function selectGroup(id: number): void {
  selectedGroup.value = id;
  touch();
}

export function buyBuilding(id: string): void {
  const def = BUILDING_BY_ID[id];
  if (!def) return;
  const k = buyAmount(state, def, state.settings.buyMode);
  if (k > 0) buy(state, id, k);
  checkMilestones();
  touch();
}

export function setBuyMode(mode: BuyMode): void {
  state.settings.buyMode = mode;
  touch();
}

export function driveClick(): void {
  drive(state);
  touch();
}

export function purchaseArmory(id: string): void {
  if (buyArmory(state, id)) {
    log(`Armory: ${ARMORY_BY_ID[id].name}.`, 'prestige');
    saveNow();
  }
  touch();
}

export function doRedeploy(): RedeployReport | null {
  const report = redeploy(state);
  if (!report) return null;
  const n = (v: number) => formatCount(v, state.settings.notation);
  cue('fanfare');
  log(
    `Redeployed after ${formatDuration(report.runSeconds)}: +${n(report.gain)} Service Medals. Production bonus now x${state.meta.medalsEarned > 0 ? (report.multiplierAfter).toFixed(2) : '1.00'}.`,
    'prestige',
  );
  if (state.meta.cadreXp > 0) log(`The veteran cadre keeps its training: new crews start with ${state.meta.cadreXp} experience.`, 'prestige');
  scouted.value = {};
  baselineMilestones();
  keepSelectionValid();
  saveNow();
  touch();
  return report;
}

/** Transfer out of the active theatre: Honors in, the run, Medals and Armory out. */
export function doTransfer(): TransferReport | null {
  const report = transferSim.transfer(state);
  if (!report) return null;
  cue('fanfare');
  log(`Transferred out of ${report.from.name} after ${formatDuration(report.runSeconds)}: +${report.honors} Battle Honors.`, 'milestone');
  if (report.opened) log(`${report.opened.name} is open. The war has moved on, and so has the fleet.`, 'milestone');
  if (report.medalsLost > 0) log(`${formatCount(report.medalsLost, state.settings.notation)} unspent Service Medals and the Armory were left behind.`, 'prestige');
  scouted.value = {};
  baselineMilestones();
  keepSelectionValid();
  saveNow();
  touch();
  return report;
}

export function purchaseWarroom(id: string): void {
  if (buyWarroom(state, id)) {
    log(`War Room: ${WARROOM_BY_ID[id].name}.`, 'prestige');
    saveNow();
  }
  touch();
}

export function purchaseRelic(id: string): void {
  if (buyRelic(state, id)) {
    log(`Reliquary: ${RELIC_BY_ID[id].name}.`, 'prestige');
    saveNow();
  }
  touch();
}

export function fightIn(theatre: number): boolean {
  const r = transferSim.setTheatre(state, theatre);
  if (!r.ok) say(r.reason);
  else {
    log(`The campaign order now fights in ${THEATRES.find((t) => t.id === theatre)?.name}.`, 'ops');
    for (const g of state.run.fleet.groups) if (g.stalled && g.order === 'campaign') fleetSim.resumeGroup(state, g.id);
    scouted.value = {};
    saveNow();
  }
  touch();
  return r.ok;
}

/* ---------- fleet actions ---------- */

/** Run a fleet action, report why it failed, and refresh the view. */
function fleetAct(fn: () => Result, opts: { invalidateScouting?: boolean } = {}): boolean {
  const r = fn();
  if (!r.ok) say(r.reason);
  else if (opts.invalidateScouting) scouted.value = {};
  touch();
  return r.ok;
}

export const queueShip = (classId: string): boolean => fleetAct(() => fleetSim.queueShip(state, classId));
export const cancelJob = (index: number): boolean => fleetAct(() => fleetSim.cancelJob(state, index));
export const buySlip = (): boolean => fleetAct(() => fleetSim.buySlip(state));
export const decommissionShip = (shipId: number): boolean =>
  fleetAct(() => fleetSim.decommission(state, shipId), { invalidateScouting: true });
export const assignShip = (shipId: number, groupId: number): boolean =>
  fleetAct(() => fleetSim.assignShip(state, shipId, groupId), { invalidateScouting: true });
export const setShipRow = (shipId: number, row: Row): boolean => fleetAct(() => fleetSim.setRow(state, shipId, row));
export const refitShip = (shipId: number, slot: 'weapon' | 'defence' | 'utility', index: number, equipId: string): boolean =>
  fleetAct(() => fleetSim.refit(state, shipId, slot, index, equipId), { invalidateScouting: true });

export const setGroupOrder = (id: number, order: Order): boolean => fleetAct(() => fleetSim.setOrder(state, id, order));
export const setGroupStance = (id: number, stance: Stance): boolean =>
  fleetAct(() => fleetSim.setStance(state, id, stance), { invalidateScouting: true });
export const setGroupOfficer = (id: number, officer: string | null): boolean => fleetAct(() => fleetSim.setOfficer(state, id, officer), { invalidateScouting: true });
export const setGroupPriority = (id: number, p: Priority): boolean =>
  fleetAct(() => fleetSim.setPriority(state, id, p), { invalidateScouting: true });
export const setGroupMinIntegrity = (id: number, v: number): boolean => fleetAct(() => fleetSim.setMinIntegrity(state, id, v));
export const setGroupAuto = (id: number, on: boolean): boolean => fleetAct(() => fleetSim.setAutoAbilities(state, id, on));
export const setGroupPatrol = (id: number, node: string | null): boolean => fleetAct(() => fleetSim.setPatrolNode(state, id, node));
export const resumeGroup = (id: number): boolean => fleetAct(() => fleetSim.resumeGroup(state, id));
export const renameGroup = (id: number, name: string): boolean => fleetAct(() => fleetSim.renameGroup(state, id, name));

export function useAbility(groupId: number, id: AbilityId, target?: number): boolean {
  const ok = fleetSim.useAbility(state, groupId, id, target);
  if (!ok) say(state.run.deut.lt(fleetSim.abilityCost(id)) ? 'Not enough Deuterium' : 'That ability is not ready');
  touch();
  return ok;
}

export function setBattleSpeed(speed: number): void {
  if (!FLEET.battleSpeeds.includes(speed)) return;
  state.settings.battleSpeed = speed;
  touch();
}

/** Ask the staff how the selected group would fare against a sector. Fights a dozen sample battles. */
export function scoutNode(groupId: number, nodeId: string): void {
  const group = fleetSim.groupById(state, groupId);
  const node = NODE_BY_ID[nodeId];
  if (!group || !node) return;
  const est = fleetSim.estimatePatrol(state, group, node, 12);
  if (est.samples === 0) {
    say('No fit ships in that group to scout with');
  } else {
    scouted.value = { ...scouted.value, [`${groupId}:${nodeId}`]: { winRate: est.winRate, at: state.meta.battles.total } };
  }
  touch();
}

/* ---------- marine actions ---------- */

function marineAct(fn: () => marineSim.Result): boolean {
  const r = fn();
  if (!r.ok) say(r.reason);
  touch();
  return r.ok;
}

export function selectSquad(id: number): void {
  selectedSquad.value = id;
  touch();
}

export const launchSquad = (id: number): boolean => marineAct(() => marineSim.startMission(state, id, onFleetEvent));
export const answerIncident = (squadId: number, incidentId: number): boolean =>
  marineAct(() => marineSim.launchIncident(state, squadId, incidentId, onFleetEvent));
export const recallSquad = (id: number): boolean => marineAct(() => marineSim.recall(state, id, onFleetEvent));
export const pickTactic = (id: number, tactic: TacticId): boolean => marineAct(() => marineSim.chooseTactic(state, id, tactic));
export const setSquadMission = (id: number, kind: MissionKind): boolean => marineAct(() => marineSim.setMission(state, id, kind));
export const setSquadTarget = (id: number, node: string | null): boolean => marineAct(() => marineSim.setTarget(state, id, node));
export const setSquadStanding = (id: number, standing: Standing): boolean => marineAct(() => marineSim.setStanding(state, id, standing));
export const setSquadAuto = (id: number, on: boolean): boolean => marineAct(() => marineSim.setAuto(state, id, on));
export const resumeSquad = (id: number): boolean => marineAct(() => marineSim.resumeSquad(state, id));
export const renameSquad = (id: number, name: string): boolean => marineAct(() => marineSim.renameSquad(state, id, name));
export const setSquadWant = (id: number, slot: number, unit: string): boolean => marineAct(() => marineSim.setWant(state, id, slot, unit));
export const dischargeMarine = (id: number, slot: number): boolean => marineAct(() => marineSim.discharge(state, id, slot));
export const fitSquadVehicle = (id: number, vehicle: string | null): boolean => marineAct(() => marineSim.fitVehicle(state, id, vehicle));
export const pickPerk = (id: number, marine: number, perk: string): boolean => marineAct(() => marineSim.choosePerk(state, id, marine, perk));
function researchAct(fn: () => researchSim.Result): boolean {
  const r = fn();
  if (!r.ok) say(r.reason);
  touch();
  return r.ok;
}
export const startProject = (id: string): boolean => researchAct(() => researchSim.startResearch(state, id));
export const cancelProject = (id: string): boolean => researchAct(() => researchSim.cancelResearch(state, id));
export const adoptDoctrine = (slot: number, id: string): boolean => researchAct(() => researchSim.adoptDoctrine(state, slot, id));

export function reinforceSquad(id: number): void {
  const squad = marineSim.squadById(state, id);
  if (!squad) return;
  const joined = marineSim.reinforce(state, squad);
  if (joined === 0) say(squad.slots.includes(null) ? 'Not enough Personnel' : 'The squad is at full strength');
  touch();
}

export function autoChoosePerks(id: number): void {
  marineSim.autoPerks(state, id);
  touch();
}

/* ---------- settings and saves ---------- */

export function setSound(on: boolean): void {
  state.settings.sound = on;
  applyDisplay();
  if (on) cue('chime'); // the first cue after a click also wakes the browser's audio
  touch();
}

export function setVolume(volume: number): void {
  state.settings.volume = Math.min(1, Math.max(0, volume));
  applyDisplay();
  touch();
}

export function setReduceMotion(on: boolean): void {
  state.settings.reduceMotion = on;
  applyDisplay();
  touch();
}

export function setHighContrast(on: boolean): void {
  state.settings.highContrast = on;
  applyDisplay();
  touch();
}

export function setTextScale(scale: number): void {
  state.settings.textScale = TEXT_SCALES.includes(scale) ? scale : 1;
  applyDisplay();
  touch();
}

export function setNotation(notation: Notation): void {
  state.settings.notation = notation;
  touch();
}

export function exportSave(): string {
  return encodeSave(state);
}

/** Replace the current game with an imported save. Returns false when the text is not a usable save. */
export function importSave(text: string): boolean {
  const imported = decodeSave(text);
  if (!imported) return false;
  imported.lastSeen = Date.now(); // an old export should not pay out the time since it was made
  state = imported;
  applyDisplay();
  scouted.value = {};
  baselineMilestones();
  keepSelectionValid();
  log('Save imported.', 'system');
  saveNow();
  touch();
  return true;
}

export function hardReset(): void {
  clearSave(storage);
  state = newGameState(Date.now(), Math.floor(Math.random() * 2 ** 32));
  applyDisplay();
  offlineReport.value = null;
  logEntries.value = [];
  scouted.value = {};
  selectedGroup.value = 1;
  selectedSquad.value = 1;
  fleetTab.value = 'battle';
  screen.value = 'command';
  baselineMilestones();
  log('Requisition office open. Stock a depot to get supplies moving.', 'system');
  saveNow();
  touch();
}

export function dismissOffline(): void {
  offlineReport.value = null;
}
