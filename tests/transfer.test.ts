import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { ARMORY_BY_ID, FLEET, NODES, SHIP_BY_ID, THEATRES, WARROOM, WARROOM_CONFIG, WARROOM_DATA } from '../src/data';
import { validateWarRoomData } from '../src/data/warroomSchema';
import { armoryLevel, doctrineSlotCount } from '../src/sim/armory';
import {
  activeTheatre,
  commandCapacity,
  defaultPatrol,
  everCleared,
  groupsUnlocked,
  isShipUnlocked,
  nextCampaignNode,
  nodeStatus,
  patrolOptions,
  theatreCleared,
  theatreEverCleared,
} from '../src/sim/campaign';
import { targetNode } from '../src/sim/fleet';
import { modsOf } from '../src/sim/modifiers';
import { isUnitUnlocked, targetProblem } from '../src/sim/marines';
import { canTransfer, setTheatre, transfer, transferCost, transferGain, transferOpens, transferProblem } from '../src/sim/transfer';
import { buyWarroom, canBuyWarroom, honorBonus, nextWarroomCost, warroomLevel, warroomTotal } from '../src/sim/warroom';
import { buildCampaignView, warroomEffect } from '../src/state/campaignView';
import { buildView } from '../src/state/selectors';
import { makeShip } from '../src/state/fleetState';
import { migrate } from '../src/state/migrations';
import { fromRaw, newGameState, toRaw } from '../src/state/serialize';
import type { GameState } from '../src/state/types';

const T1 = THEATRES[0];
const T2 = THEATRES[1];
const boss1 = T1.nodes[T1.nodes.length - 1].id;
const boss2 = T2.nodes[T2.nodes.length - 1].id;

function game(): GameState {
  const s = newGameState(0, 5);
  s.meta.fleetUnlocked = true;
  s.meta.opsUnlocked = true;
  return s;
}

/** A game that has beaten the first theatre and fields a Marathon, so it may Transfer. */
function ready(): GameState {
  const s = game();
  for (const n of T1.nodes) {
    s.meta.cleared[n.id] = 1;
    s.meta.everCleared[n.id] = 1;
  }
  s.run.fleet.ships.push(makeShip(SHIP_BY_ID['heavy-cruiser'], 1, 1, 'front'));
  return s;
}

describe('theatre and War Room data', () => {
  it('has five theatres whose last node is a boss', () => {
    expect(THEATRES.map((t) => t.id)).toEqual([1, 2, 3, 4, 5]);
    for (const t of THEATRES) expect(t.nodes[t.nodes.length - 1].boss).toBe(true);
    expect(T2.nodes).toHaveLength(8);
    expect(T2.nodes.every((n) => n.id.startsWith('t2-'))).toBe(true);
  });

  it('passes validation and catches a bad shop', () => {
    expect(validateWarRoomData(WARROOM_DATA)).toEqual([]);
    const d = structuredClone(WARROOM_DATA);
    d.config.honorBonus = 5;
    d.items[0].costs = [];
    d.items[1].costs = [8, 3];
    d.items.push({ ...d.items[2] });
    const errors = validateWarRoomData(d);
    for (const text of ['honorBonus', 'costs length', 'must not fall', 'duplicate']) expect(errors.some((e) => e.includes(text)), text).toBe(true);
  });

  it('gives Theatre 2 enemies, rewards and a carrier boss', () => {
    for (const n of T2.nodes) {
      expect(Object.keys(n.enemies).length).toBeGreaterThan(0);
      expect(n.reward.rp).toBeGreaterThan(0);
    }
    expect(T2.nodes[T2.nodes.length - 1].enemies['assault-carrier']).toBe(1);
    const rewards = T2.nodes.map((n) => n.reward.rp);
    expect(rewards).toEqual([...rewards].sort((a, b) => a - b));
    expect(T2.nodes[0].reward.rp).toBeGreaterThan(T1.nodes[T1.nodes.length - 1].reward.rp);
  });
});

describe('theatres in the campaign', () => {
  it('open one sector at a time inside the theatre being fought', () => {
    const s = game();
    expect(nodeStatus(s.meta, T2.nodes[0].id)).toBe('locked');
    s.meta.theatresOpen = 2;
    expect(nodeStatus(s.meta, T2.nodes[0].id)).toBe('locked'); // the fleet is still fighting in theatre 1
    expect(setTheatre(s, 2).ok).toBe(true);
    expect(nodeStatus(s.meta, T2.nodes[0].id)).toBe('open');
    expect(nodeStatus(s.meta, T2.nodes[1].id)).toBe('locked');
    expect(nodeStatus(s.meta, T1.nodes[0].id)).toBe('locked');
    expect(nextCampaignNode(s.meta)?.id).toBe(T2.nodes[0].id);
    s.meta.cleared[T2.nodes[0].id] = 1;
    expect(nextCampaignNode(s.meta)?.id).toBe(T2.nodes[1].id);
  });

  it('cannot be entered before a Transfer opens them', () => {
    const s = game();
    expect(setTheatre(s, 2)).toEqual({ ok: false, reason: 'That theatre is not open yet' });
    expect(setTheatre(s, 9).ok).toBe(false);
    expect(s.meta.theatre).toBe(1);
  });

  it('pay a strike group for every theatre ever cleared, not only this cycle', () => {
    const s = game();
    expect(groupsUnlocked(s.meta)).toBe(1);
    s.meta.everCleared[boss1] = 1;
    expect(theatreEverCleared(s.meta, T1)).toBe(true);
    expect(theatreCleared(s.meta, T1)).toBe(false);
    expect(groupsUnlocked(s.meta)).toBe(2);
    s.meta.warroom['reserve-fleet'] = 2;
    expect(groupsUnlocked(s.meta)).toBe(Math.min(FLEET.maxGroups, 4));
  });

  it('let a Patrol and the marines work on any sector ever cleared', () => {
    const s = game();
    s.meta.everCleared[T1.nodes[0].id] = 1;
    s.meta.everCleared[T1.nodes[3].id] = 1;
    expect(everCleared(s.meta, T1.nodes[3].id)).toBe(true);
    expect(patrolOptions(s.meta).map((n) => n.id)).toEqual([T1.nodes[0].id, T1.nodes[3].id]);
    expect(defaultPatrol(s.meta)?.id).toBe(T1.nodes[0].id); // nothing cleared this cycle: the easiest known sector
    s.meta.cleared[T1.nodes[3].id] = 1;
    expect(defaultPatrol(s.meta)?.id).toBe(T1.nodes[3].id);
    const group = s.run.fleet.groups[0];
    group.order = 'patrol';
    group.patrolNode = T1.nodes[0].id;
    expect(targetNode(s, group).node?.id).toBe(T1.nodes[0].id);
    group.patrolNode = T1.nodes[1].id; // never cleared: falls back
    expect(targetNode(s, group).node?.id).toBe(T1.nodes[3].id);
    expect(targetProblem(s, 'patrol', 't1-n1')).toBeNull();
    expect(targetProblem(s, 'patrol', 't1-n2')).not.toBeNull();
  });
});

describe('Transfer', () => {
  it('needs the boss down and a Marathon in the fleet', () => {
    const s = game();
    expect(canTransfer(s)).toBe(false);
    expect(transferProblem(s)).toBe(`Defeat ${T1.nodes[T1.nodes.length - 1].name} first`);
    for (const n of T1.nodes) s.meta.cleared[n.id] = 1;
    expect(transferProblem(s)).toBe('Field a Heavy cruiser first');
    expect(transferGain(s)).toBe(0);
    expect(transfer(s)).toBeNull();
    s.run.fleet.ships.push(makeShip(SHIP_BY_ID['heavy-cruiser'], 1, 1, 'front'));
    expect(transferProblem(s)).toBeNull();
    expect(transferGain(s)).toBe(T1.honors);
    expect(transferOpens(s)?.id).toBe(2);
  });

  it('banks Honors, opens the next theatre, and wipes the run, Medals and the Armory', () => {
    const s = ready();
    s.meta.medals = 12;
    s.meta.medalsEarned = 30;
    s.meta.armory = { 'forward-depots': 2 };
    s.meta.captured = { 't1-n1': 1, 't1-n7': 1 };
    s.meta.redeploys = 3;
    s.run.rp = D(1e9);
    s.run.earned = D(5e9);
    s.run.elapsed = 4000;
    const cost = transferCost(s);
    expect(cost).toMatchObject({ medals: 12, medalsEarned: 30, armory: 2 });
    const report = transfer(s)!;
    expect(report).toMatchObject({ honors: T1.honors, medalsLost: 12, runSeconds: 4000 });
    expect(report.opened?.id).toBe(2);
    expect(s.meta.theatre).toBe(2);
    expect(s.meta.theatresOpen).toBe(2);
    expect(s.meta.honors).toBe(T1.honors);
    expect(s.meta.honorsEarned).toBe(T1.honors);
    expect(s.meta.transfers).toBe(1);
    expect(s.meta.redeploys).toBe(4);
    expect(s.meta.medals).toBe(0);
    expect(s.meta.medalsEarned).toBe(0);
    expect(s.meta.armory).toEqual({});
    expect(s.meta.cleared).toEqual({});
    expect(s.meta.captured).toEqual({});
    expect(s.run.fleet.ships).toEqual([]);
    expect(s.run.rp.toNumber()).toBeLessThan(1e3);
    expect(s.run.earned.toNumber()).toBe(0);
    // what a Transfer keeps
    expect(s.meta.opsUnlocked).toBe(true);
    expect(s.meta.fleetUnlocked).toBe(true);
    expect(everCleared(s.meta, boss1)).toBe(true);
    expect(isShipUnlocked(s.meta, SHIP_BY_ID['heavy-cruiser'])).toBe(true);
    expect(groupsUnlocked(s.meta)).toBe(2);
    expect(armoryLevel(s.meta, 'forward-depots')).toBe(0);
    expect(ARMORY_BY_ID['forward-depots']).toBeDefined();
  });

  it('keeps marine unlocks, and stays in the last theatre when there is no next one', () => {
    const s = ready();
    transfer(s);
    expect(isUnitUnlocked(s, { id: 'marksman', unlock: { kind: 'node', node: 't1-n3' } } as never)).toBe(true);
    // walk to the last theatre, then Transfer out of it
    const last = THEATRES[THEATRES.length - 1];
    s.meta.theatresOpen = last.id;
    s.meta.theatre = last.id;
    for (const n of last.nodes) s.meta.cleared[n.id] = 1;
    for (const id of ['carrier', 'flagship']) s.run.fleet.ships.push(makeShip(SHIP_BY_ID[id], 9, 1, 'front'));
    const before = s.meta.honorsEarned;
    expect(transferOpens(s)).toBeNull();
    expect(transferProblem(s)).toBeNull();
    const again = transfer(s)!;
    expect(again.opened).toBeNull();
    expect(again.to.id).toBe(last.id);
    expect(s.meta.theatre).toBe(last.id);
    expect(s.meta.honorsEarned).toBe(before + last.honors);
    expect(activeTheatre(s.meta).id).toBe(last.id);
  });

  it('can return to an earlier theatre once opened, to farm it', () => {
    const s = ready();
    transfer(s);
    expect(setTheatre(s, 1).ok).toBe(true);
    expect(nextCampaignNode(s.meta)?.id).toBe(T1.nodes[0].id);
    expect(setTheatre(s, 2).ok).toBe(true);
  });
});

describe('the War Room', () => {
  const give = (s: GameState, n: number) => {
    s.meta.honors += n;
    s.meta.honorsEarned += n;
  };

  it('sells levels for Honors and stops at the top', () => {
    const s = game();
    const flag = WARROOM.find((w) => w.id === 'flag-command')!;
    expect(canBuyWarroom(s.meta, flag)).toBe(false);
    expect(buyWarroom(s, 'flag-command')).toBe(false);
    give(s, 100);
    expect(nextWarroomCost(s.meta, flag)).toBe(flag.costs[0]);
    for (let i = 0; i < flag.maxLevel; i++) expect(buyWarroom(s, 'flag-command')).toBe(true);
    expect(warroomLevel(s.meta, 'flag-command')).toBe(flag.maxLevel);
    expect(nextWarroomCost(s.meta, flag)).toBeNull();
    expect(buyWarroom(s, 'flag-command')).toBe(false);
    expect(buyWarroom(s, 'nothing')).toBe(false);
    expect(s.meta.honors).toBe(100 - flag.costs.reduce((a, b) => a + b, 0));
    expect(s.meta.honorsEarned).toBe(100); // spending never lowers the bonus
  });

  it('raises Command capacity, doctrine slots and strike groups, and survives a Transfer', () => {
    const s = ready();
    const base = commandCapacity(s.meta);
    const slots = doctrineSlotCount(s.meta);
    give(s, 50);
    buyWarroom(s, 'flag-command');
    buyWarroom(s, 'joint-staff');
    buyWarroom(s, 'reserve-fleet');
    expect(commandCapacity(s.meta)).toBe(base + 1);
    expect(doctrineSlotCount(s.meta)).toBe(slots + 1);
    expect(warroomTotal(s.meta, 'group')).toBe(1);
    const groups = groupsUnlocked(s.meta);
    transfer(s);
    expect(warroomLevel(s.meta, 'flag-command')).toBe(1);
    expect(commandCapacity(s.meta)).toBe(FLEET.commandCapacity + 1);
    expect(doctrineSlotCount(s.meta)).toBe(slots + 1);
    expect(groupsUnlocked(s.meta)).toBe(groups); // the theatre keeps its group, the shop's stays
  });

  it('adds ship damage and marine Power for every Honor earned', () => {
    const s = game();
    expect(honorBonus(s.meta)).toBe(0);
    expect(modsOf(s).damage).toBe(0);
    give(s, 5);
    expect(honorBonus(s.meta)).toBeCloseTo(5 * WARROOM_CONFIG.honorBonus);
    expect(modsOf(s).damage).toBeCloseTo(0.15);
    expect(modsOf(s).marine).toBeCloseTo(0.15);
    s.meta.honors = 0; // spent all of them
    expect(modsOf(s).damage).toBeCloseTo(0.15);
  });
});

describe('saves with theatres', () => {
  it('round-trip Honors, the War Room and the theatre', () => {
    const s = ready();
    s.meta.honors = 1;
    s.meta.honorsEarned = 6;
    s.meta.warroom = { 'flag-command': 2 };
    s.meta.theatresOpen = 2;
    s.meta.theatre = 2;
    s.meta.transfers = 1;
    const back = fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!;
    expect(back.meta).toMatchObject({ honors: 1, honorsEarned: 6, theatre: 2, theatresOpen: 2, transfers: 1, warroom: { 'flag-command': 2 } });
    expect(back.meta.everCleared[boss1]).toBe(1);
  });

  it('survive hostile values', () => {
    const raw = toRaw(game()) as any;
    raw.meta.theatre = 99;
    raw.meta.theatresOpen = 99;
    raw.meta.honors = 50;
    raw.meta.honorsEarned = 30;
    raw.meta.warroom = { 'flag-command': 500, constructor: 3, ghost: 2, 'joint-staff': -4 };
    raw.meta.everCleared = { 't1-n1': 3, ghost: 4, '__proto__': 1, 't1-n2': -1 };
    const s = fromRaw(raw)!;
    expect(s.meta.theatresOpen).toBe(THEATRES.length);
    expect(s.meta.theatre).toBe(THEATRES.length);
    expect(s.meta.honors).toBe(30 - WARROOM.find((w) => w.id === 'flag-command')!.costs.reduce((a, b) => a + b, 0)); // never more than were left unspent
    expect(s.meta.warroom).toEqual({ 'flag-command': WARROOM.find((w) => w.id === 'flag-command')!.maxLevel });
    expect(Object.keys(s.meta.everCleared)).toEqual(['t1-n1']);
    const bad = toRaw(game()) as any;
    bad.meta.theatre = 2; // a theatre that is not open
    expect(fromRaw(bad)!.meta.theatre).toBe(1);
  });

  it('keep ground captured after a Transfer, and refuse a free shop or an unopened theatre', () => {
    const s = ready();
    transfer(s);
    s.meta.captured['t1-n3'] = 1; // retaken from an earlier cycle's sector
    const back = fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!;
    expect(back.meta.captured).toEqual({ 't1-n3': 1 });
    const raw = toRaw(game()) as any;
    raw.meta.warroom = { 'flag-command': 4, 'reserve-fleet': 2, 'joint-staff': 1 };
    raw.meta.honorsEarned = 5;
    raw.meta.honors = 5;
    raw.meta.everCleared = { 't1-n1': 1, 't2-n1': 1 };
    const hostile = fromRaw(raw)!;
    const spent = Object.entries(hostile.meta.warroom).reduce((n, [id, l]) => n + WARROOM.find((w) => w.id === id)!.costs.slice(0, l).reduce((a, b) => a + b, 0), 0);
    expect(spent).toBeLessThanOrEqual(5);
    expect(hostile.meta.honors + spent).toBeLessThanOrEqual(5);
    expect(hostile.meta.everCleared).toEqual({ 't1-n1': 1 });
  });

  it('upgrade a version 4 save with nothing lost', () => {
    const raw = toRaw(game()) as any;
    raw.version = 4;
    raw.meta.cleared = { 't1-n1': 2, 't1-n2': 1 };
    for (const k of ['everCleared', 'theatre', 'theatresOpen', 'honors', 'honorsEarned', 'transfers', 'warroom']) delete raw.meta[k];
    expect(migrate(raw)).not.toBeNull();
    const s = fromRaw(raw)!;
    expect(s.meta.cleared).toEqual({ 't1-n1': 2, 't1-n2': 1 });
    expect(s.meta.everCleared).toEqual({ 't1-n1': 2, 't1-n2': 1 });
    expect(s.meta).toMatchObject({ theatre: 1, theatresOpen: 1, honors: 0, honorsEarned: 0, transfers: 0, warroom: {} });
  });
});

describe('the final boss', () => {
  it('is a carrier with an escort', () => {
    expect(boss2).toBe('t2-n8');
    expect(NODES.find((n) => n.id === boss2)?.boss).toBe(true);
  });
});

describe('the Campaign screen view', () => {
  it('shows each theatre, its sectors and what a Transfer needs', () => {
    const s = game();
    s.meta.cleared[T1.nodes[0].id] = 1;
    s.meta.cleared[T1.nodes[1].id] = 1;
    const v = buildCampaignView(s);
    expect(v.unlocked).toBe(true);
    expect(v.theatres.map((t) => [t.theatre.id, t.state])).toEqual([[1, 'active'], [2, 'locked'], [3, 'locked'], [4, 'locked'], [5, 'locked']]);
    expect(v.theatres[0].pins.map((p) => p.state)).toEqual(['secured', 'secured', 'open', 'locked', 'locked', 'locked', 'locked', 'locked']);
    expect(v.theatres[0].cleared).toBe(2);
    expect(v.transfer.ready).toBe(false);
    expect(v.transfer.steps.map((x) => x.done)).toEqual([false, false]);
    expect(v.transfer.problem).toBe(`Defeat ${T1.nodes[T1.nodes.length - 1].name} first`);
    expect(v.warroom.map((w) => w.def.id)).toEqual(WARROOM.map((w) => w.id));
  });

  it('marks sectors cleared in an earlier cycle, and an open theatre to switch to', () => {
    const s = ready();
    transfer(s);
    const v = buildCampaignView(s);
    expect(v.theatres.map((t) => t.state)).toEqual(['open', 'active', 'locked', 'locked', 'locked']);
    expect(v.theatres[0].pins.every((p) => p.state === 'earlier')).toBe(true);
    expect(v.theatres[0].everBeaten).toBe(true);
    expect(v.theatres[1].pins[0].state).toBe('open');
    expect(v.honors).toBe(T1.honors);
    expect(v.honorBonus).toBeCloseTo(T1.honors * WARROOM_CONFIG.honorBonus);
    expect(v.transfer.ready).toBe(false);
    expect(v.transfer.opens?.id).toBe(3);
  });

  it('prices War Room levels and describes them', () => {
    const s = game();
    s.meta.honors = 3;
    s.meta.honorsEarned = 3;
    const v = buildCampaignView(s);
    const flag = v.warroom.find((w) => w.def.id === 'flag-command')!;
    expect(flag.cost).toBe(WARROOM.find((w) => w.id === 'flag-command')!.costs[0]);
    expect(flag.canBuy).toBe(true);
    expect(flag.current).toBe('No extra Command');
    expect(flag.next).toBe('+1 Command capacity per group');
    expect(warroomEffect(WARROOM.find((w) => w.id === 'reserve-fleet')!, 2)).toBe('+2 strike groups');
    expect(warroomEffect(WARROOM.find((w) => w.id === 'joint-staff')!, 1)).toBe('+1 doctrine slot');
  });

  it('is part of the full view', () => {
    const s = ready();
    const v = buildView(s, { screen: 'campaign', squad: 1 });
    expect(v.campaign.transfer.ready).toBe(true);
  });
});
