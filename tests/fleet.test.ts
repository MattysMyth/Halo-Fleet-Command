import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { COMBAT, FLEET, NODES, SHIP_BY_ID, THEATRES } from '../src/data';
import { commandCapacity, groupsUnlocked, isShipUnlocked, nextCampaignNode, nodeStatus, sectorMultiplier } from '../src/sim/campaign';
import {
  assignShip,
  buySlip,
  cancelJob,
  canQueue,
  classOf,
  decommission,
  groupCommand,
  integrityOf,
  queueShip,
  rankOf,
  refit,
  repairShips,
  resumeGroup,
  runtimeOf,
  setOrder,
  setPatrolNode,
  setRow,
  shipStats,
  shipsOf,
  sortieCost,
  stepFleet,
  syncFleet,
  targetNode,
  updateCadre,
  applyOfflineFleet,
  useAbility,
} from '../src/sim/fleet';
import type { FleetEvent } from '../src/sim/fleet';
import { makeShip } from '../src/state/fleetState';
import { redeploy } from '../src/sim/prestige';
import { newGameState } from '../src/state/serialize';
import type { GameState } from '../src/state/types';

const frigate = SHIP_BY_ID.frigate;

function setup(opts: { frigates?: number; xp?: number; ti?: number; deut?: number; rp?: number; cleared?: string[] } = {}): GameState {
  const s = newGameState(0, 42);
  s.run.ti = D(opts.ti ?? 100000);
  s.run.deut = D(opts.deut ?? 5000);
  s.run.rp = D(opts.rp ?? 1e9);
  s.meta.fleetUnlocked = true;
  for (const id of opts.cleared ?? []) s.meta.cleared[id] = 1;
  for (let i = 0; i < (opts.frigates ?? 0); i++) {
    const ship = makeShip(frigate, s.run.fleet.nextShipId++, 1, i < 4 ? 'front' : 'line');
    ship.xp = opts.xp ?? 0;
    s.run.fleet.ships.push(ship);
  }
  return s;
}

/** Run the fleet for up to `seconds`, stopping early once `until` is true. */
function run(s: GameState, seconds: number, until?: () => boolean, events: FleetEvent[] = []): FleetEvent[] {
  for (let t = 0; t < seconds; t += 0.5) {
    stepFleet(s, 0.5, (e) => events.push(e));
    if (until?.()) break;
  }
  return events;
}

const nodes = (s: GameState) => ({ first: NODES[0], last: THEATRES[0].nodes[THEATRES[0].nodes.length - 1], s });

describe('ship stats', () => {
  it('start from the class and apply the loadout', () => {
    const ship = makeShip(frigate, 1, 1, 'front');
    const st = shipStats(ship);
    expect(st.maxHull).toBe(400);
    expect(st.armour).toBe(10);
    expect(st.pd).toBe(1);
    expect(st.damageMult).toBe(1);
    expect(st.weapons.map((w) => w.id)).toEqual(['mac', 'archer']);

    ship.defence = ['plating'];
    expect(shipStats(ship).armour).toBeCloseTo(14);
    expect(shipStats(ship).pd).toBe(0);
  });

  it('apply crew rank to hull and damage', () => {
    const ship = makeShip(frigate, 1, 1, 'front');
    ship.xp = 12; // veteran
    expect(rankOf(ship.xp).id).toBe('veteran');
    expect(shipStats(ship).maxHull).toBeCloseTo(400 * 1.18);
    expect(shipStats(ship).damageMult).toBeCloseTo(1.18);
  });

  it('give a cruiser heavier mounts and bulkheads', () => {
    const ship = makeShip(SHIP_BY_ID['light-cruiser'], 1, 1, 'front');
    const st = shipStats(ship);
    expect(st.damageMult).toBe(4);
    expect(st.maxHull).toBeCloseTo(2000 * 1.15);
    expect(st.weapons.length).toBe(3);
  });
});

describe('drydock', () => {
  it('takes payment up front and launches the ship when the job finishes', () => {
    const s = setup({ rp: 5000, ti: 1000 });
    expect(queueShip(s, 'frigate')).toEqual({ ok: true });
    expect(s.run.rp.toNumber()).toBe(5000 - frigate.cost.rp);
    expect(s.run.ti.toNumber()).toBe(1000 - frigate.cost.ti);
    expect(s.run.fleet.queue.length).toBe(1);

    const events: FleetEvent[] = [];
    run(s, frigate.buildSeconds - 1, undefined, events);
    expect(s.run.fleet.ships.length).toBe(0);
    run(s, 3, undefined, events);
    expect(s.run.fleet.ships.length).toBe(1);
    expect(s.run.fleet.queue.length).toBe(0);
    const ship = s.run.fleet.ships[0];
    expect(ship.classId).toBe('frigate');
    expect(ship.group).toBe(1);
    expect(ship.row).toBe('front');
    expect(ship.hull).toBe(1);
    expect(ship.weapons).toEqual(['mac', 'archer']);
    expect(events.some((e) => e.kind === 'launch')).toBe(true);
  });

  it('rejects what cannot be built', () => {
    const poor = setup({ rp: frigate.cost.rp - 1, ti: 1000 });
    expect(queueShip(poor, 'frigate')).toEqual({ ok: false, reason: 'Not enough Requisition' });
    const noTi = setup({ rp: 1e6, ti: frigate.cost.ti - 1 });
    expect(queueShip(noTi, 'frigate')).toEqual({ ok: false, reason: 'Not enough Titanium-A' });
    const s = setup();
    expect(canQueue(s, 'light-cruiser')).toEqual({ ok: false, reason: 'Not unlocked' });
    expect(canQueue(s, 'nope').ok).toBe(false);
    for (let i = 0; i < FLEET.queueLimit; i++) expect(queueShip(s, 'frigate').ok).toBe(true);
    expect(queueShip(s, 'frigate')).toEqual({ ok: false, reason: 'The build queue is full' });
  });

  it('works one job per slip', () => {
    const one = setup();
    queueShip(one, 'frigate');
    queueShip(one, 'frigate');
    run(one, frigate.buildSeconds + 2);
    expect(one.run.fleet.ships.length).toBe(1);
    run(one, frigate.buildSeconds);
    expect(one.run.fleet.ships.length).toBe(2);

    const two = setup();
    expect(buySlip(two).ok).toBe(true);
    queueShip(two, 'frigate');
    queueShip(two, 'frigate');
    run(two, frigate.buildSeconds + 2);
    expect(two.run.fleet.ships.length).toBe(2);
  });

  it('charges for slips in order and stops at the last', () => {
    const s = setup({ rp: 1e12 });
    const before = s.run.rp.toNumber();
    expect(buySlip(s).ok).toBe(true);
    expect(before - s.run.rp.toNumber()).toBeCloseTo(FLEET.slips.costs[0], 2);
    while (buySlip(s).ok) {
      /* buy them all */
    }
    expect(s.run.fleet.slips).toBe(FLEET.slips.base + FLEET.slips.costs.length);
    expect(buySlip(s)).toEqual({ ok: false, reason: 'Every slip is built' });
    expect(buySlip(setup({ rp: 10 }))).toEqual({ ok: false, reason: 'Not enough Requisition' });
  });

  it('refunds a cancelled job in full', () => {
    const s = setup({ rp: 5000, ti: 1000 });
    queueShip(s, 'frigate');
    expect(cancelJob(s, 0)).toEqual({ ok: true });
    expect(s.run.rp.toNumber()).toBe(5000);
    expect(s.run.ti.toNumber()).toBe(1000);
    expect(cancelJob(s, 0).ok).toBe(false);
  });

  it('sends new ships to the hangar when the group is full', () => {
    const s = setup({ frigates: FLEET.commandCapacity });
    setOrder(s, 1, 'reserve'); // keep the group at home so no sector is cleared meanwhile
    expect(groupCommand(s, 1)).toBe(FLEET.commandCapacity);
    queueShip(s, 'frigate');
    run(s, frigate.buildSeconds + 2);
    expect(shipsOf(s, 0).length).toBe(1);
    expect(shipsOf(s, 1).length).toBe(FLEET.commandCapacity);
  });

  it('unlocks the light cruiser when the boss falls, and capacity grows with sectors', () => {
    const s = setup({ rp: 1e9, ti: 1e5 });
    const cruiser = SHIP_BY_ID['light-cruiser'];
    expect(isShipUnlocked(s.meta, cruiser)).toBe(false);
    s.meta.cleared['t1-n8'] = 1;
    expect(isShipUnlocked(s.meta, cruiser)).toBe(true);
    expect(canQueue(s, 'light-cruiser').ok).toBe(true);
    expect(commandCapacity(setup().meta)).toBe(FLEET.commandCapacity);
    expect(commandCapacity(setup({ cleared: ['t1-n1', 't1-n2'] }).meta)).toBe(FLEET.commandCapacity + 1);
  });

  it('scraps a ship for half its Titanium', () => {
    const s = setup({ frigates: 1, ti: 0 });
    expect(decommission(s, s.run.fleet.ships[0].id)).toEqual({ ok: true });
    expect(s.run.ti.toNumber()).toBe(frigate.cost.ti * 0.5);
    expect(s.run.fleet.ships.length).toBe(0);
    expect(decommission(s, 99).ok).toBe(false);
  });
});

describe('ships and groups', () => {
  it('assigns within Command capacity and refuses beyond it', () => {
    const s = setup({ frigates: FLEET.commandCapacity });
    const extra = makeShip(frigate, s.run.fleet.nextShipId++, 0, 'line');
    s.run.fleet.ships.push(extra);
    expect(assignShip(s, extra.id, 1)).toEqual({ ok: false, reason: 'Not enough Command capacity' });
    expect(assignShip(s, s.run.fleet.ships[0].id, 0).ok).toBe(true);
    expect(assignShip(s, extra.id, 1).ok).toBe(true);
    expect(extra.group).toBe(1);
    expect(assignShip(s, extra.id, 9)).toEqual({ ok: false, reason: 'No such group' });
  });

  it('lets crews set rows and refit equipment only when docked and only with fitting gear', () => {
    const s = setup({ frigates: 1 });
    const id = s.run.fleet.ships[0].id;
    expect(setRow(s, id, 'rear').ok).toBe(true);
    expect(s.run.fleet.ships[0].row).toBe('rear');
    expect(refit(s, id, 'weapon', 0, 'autocannon').ok).toBe(true);
    expect(s.run.fleet.ships[0].weapons).toEqual(['autocannon', 'archer']);
    expect(refit(s, id, 'weapon', 0, 'pd').ok).toBe(false); // a defence module in a weapon slot
    expect(refit(s, id, 'weapon', 5, 'mac').ok).toBe(false);
    expect(refit(s, id, 'defence', 0, 'plating').ok).toBe(true);
    expect(refit(s, 99, 'defence', 0, 'pd').ok).toBe(false);
  });

  it('refuses changes while the group is fighting', () => {
    const s = setup({ frigates: 4, cleared: [] });
    run(s, 5, () => runtimeOf(s, 1).battle !== null);
    expect(runtimeOf(s, 1).battle).not.toBeNull();
    const id = s.run.fleet.ships[0].id;
    expect(setRow(s, id, 'rear').ok).toBe(false);
    expect(refit(s, id, 'weapon', 0, 'mac').ok).toBe(false);
    expect(assignShip(s, id, 0).ok).toBe(false);
    expect(decommission(s, id).ok).toBe(false);
  });

  it('clears a stall when the order or patrol target changes, or on resume', () => {
    const s = setup({ frigates: 1 });
    const g = s.run.fleet.groups[0];
    g.stalled = true;
    g.failStreak = 3;
    setOrder(s, g.id, 'patrol');
    expect(g.stalled).toBe(false);
    expect(g.failStreak).toBe(0);
    g.stalled = true;
    setPatrolNode(s, g.id, 't1-n1');
    expect(g.stalled).toBe(false);
    g.stalled = true;
    resumeGroup(s, g.id);
    expect(g.stalled).toBe(false);
    expect(setPatrolNode(s, g.id, 'nowhere').ok).toBe(true);
    expect(g.patrolNode).toBeNull();
  });
});

describe('campaign', () => {
  it('opens nodes one at a time', () => {
    const s = setup();
    expect(nextCampaignNode(s.meta)?.id).toBe('t1-n1');
    expect(nodeStatus(s.meta, 't1-n1')).toBe('open');
    expect(nodeStatus(s.meta, 't1-n2')).toBe('locked');
    s.meta.cleared['t1-n1'] = 1;
    expect(nodeStatus(s.meta, 't1-n1')).toBe('cleared');
    expect(nextCampaignNode(s.meta)?.id).toBe('t1-n2');
    for (const n of NODES) s.meta.cleared[n.id] = 1;
    expect(nextCampaignNode(s.meta)).toBeNull();
  });

  it('pays a production bonus per cleared sector and a second group once the theatre falls', () => {
    const s = setup();
    expect(sectorMultiplier(s.meta)).toBe(1);
    s.meta.cleared['t1-n1'] = 1;
    s.meta.cleared['t1-n2'] = 4;
    expect(sectorMultiplier(s.meta)).toBeCloseTo(1 + 2 * FLEET.sectorBonus);
    expect(groupsUnlocked(s.meta)).toBe(1);
    for (const n of THEATRES[0].nodes) s.meta.cleared[n.id] = 1;
    expect(groupsUnlocked(s.meta)).toBe(2);
    for (const n of THEATRES[1].nodes) s.meta.cleared[n.id] = 1;
    expect(groupsUnlocked(s.meta)).toBe(3);
    for (const n of THEATRES[1].nodes) delete s.meta.cleared[n.id];
    expect(groupsUnlocked(s.meta)).toBe(2);
    syncFleet(s);
    expect(s.run.fleet.groups.length).toBe(2);
    expect(s.run.fleet.groups[1].id).toBe(2);
  });

  it('reveals the Fleet screen once enough Requisition has been earned', () => {
    const s = newGameState(0, 1);
    const events: FleetEvent[] = [];
    syncFleet(s, (e) => events.push(e));
    expect(s.meta.fleetUnlocked).toBe(false);
    s.run.earned = D(FLEET.unlockEarned);
    syncFleet(s, (e) => events.push(e));
    expect(s.meta.fleetUnlocked).toBe(true);
    syncFleet(s, (e) => events.push(e));
    expect(events.filter((e) => e.kind === 'fleet-unlocked').length).toBe(1);
  });
});

describe('sorties', () => {
  it('spend Deuterium, fight, and pay the first-clear reward', () => {
    const s = setup({ frigates: 6, deut: 100, ti: 0 });
    const cost = sortieCost(s, 1);
    expect(cost).toBe(6 * FLEET.sortie.deutPerCommand);
    const events = run(s, 600, () => s.meta.battles.total > 0);

    expect(s.meta.battles.total).toBe(1);
    expect(s.meta.battles.won).toBe(1);
    expect(s.run.deut.toNumber()).toBe(100 - cost);
    expect(s.meta.cleared['t1-n1']).toBe(1);
    expect(s.run.rp.toNumber()).toBeCloseTo(1e9 + NODES[0].reward.rp * FLEET.firstClearMult);
    expect(s.run.earned.toNumber()).toBeCloseTo(NODES[0].reward.rp * FLEET.firstClearMult);
    expect(s.run.ti.toNumber()).toBeGreaterThanOrEqual(NODES[0].reward.ti * FLEET.firstClearMult - 1e-6);
    expect(runtimeOf(s, 1).battle).toBeNull();
    expect(runtimeOf(s, 1).last?.outcome).toBe('victory');
    expect(runtimeOf(s, 1).last?.firstClear).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['sortie', 'battle', 'cleared']));
  });

  it('pay only the base reward on a repeat win', () => {
    const s = setup({ frigates: 6, cleared: ['t1-n1'] });
    s.meta.cleared['t1-n2'] = 1; // push the campaign on so we replay via patrol-less campaign: n3 is next
    const before = s.run.rp.toNumber();
    run(s, 900, () => s.meta.battles.total > 0);
    expect(s.meta.battles.won).toBe(1);
    expect(s.run.rp.toNumber() - before).toBeCloseTo(NODES[2].reward.rp * FLEET.firstClearMult);
  });

  it('give crews experience and carry damage into the next sortie', () => {
    const s = setup({ frigates: 6 });
    run(s, 600, () => s.meta.battles.total > 0);
    for (const ship of s.run.fleet.ships) expect(ship.xp).toBe(FLEET.xp.win);
    expect(s.run.fleet.ships.some((sh) => sh.hull < 1) || integrityOf(s, 1) === 1).toBe(true);
  });

  it('wait for Deuterium instead of sailing', () => {
    const s = setup({ frigates: 4, deut: 1 });
    run(s, 30);
    expect(runtimeOf(s, 1).battle).toBeNull();
    expect(runtimeOf(s, 1).waiting).toMatch(/Awaiting Deuterium/);
    expect(s.meta.battles.total).toBe(0);
    s.run.deut = D(100);
    run(s, 5);
    expect(runtimeOf(s, 1).battle).not.toBeNull();
  });

  it('wait for repairs below the integrity threshold, spending Titanium as they go', () => {
    const s = setup({ frigates: 4, ti: 1000 });
    for (const ship of s.run.fleet.ships) ship.hull = 0.5;
    s.run.fleet.groups[0].minIntegrity = 0.7;
    run(s, 5);
    expect(runtimeOf(s, 1).battle).toBeNull();
    expect(runtimeOf(s, 1).waiting).toBe('Repairing');
    const tiBefore = s.run.ti.toNumber();
    run(s, 40, () => runtimeOf(s, 1).battle !== null);
    expect(runtimeOf(s, 1).battle).not.toBeNull();
    expect(integrityOf(s, 1)).toBeGreaterThanOrEqual(0.7 - 1e-9);
    expect(tiBefore - s.run.ti.toNumber()).toBeGreaterThan(0);
  });

  it('do nothing when the order is Reserve, and there is no node to fight', () => {
    const s = setup({ frigates: 4 });
    setOrder(s, 1, 'reserve');
    run(s, 20);
    expect(s.meta.battles.total).toBe(0);
    expect(runtimeOf(s, 1).waiting).toBe('In reserve');
    setOrder(s, 1, 'patrol'); // nothing cleared yet
    run(s, 2);
    expect(runtimeOf(s, 1).waiting).toMatch(/Clear a sector/);
    expect(targetNode(s, s.run.fleet.groups[0]).node).toBeNull();
  });

  it('report a finished campaign', () => {
    const s = setup({ frigates: 2, cleared: NODES.map((n) => n.id) });
    run(s, 2);
    expect(runtimeOf(s, 1).waiting).toMatch(/Campaign complete/);
  });
});

describe('repairs', () => {
  it('cost Titanium in proportion to the damage mended', () => {
    const s = setup({ frigates: 1, ti: 1000 });
    const ship = s.run.fleet.ships[0];
    ship.hull = 0.5;
    const spent = repairShips(s, 1, 25, 0.01); // 25 s at 1% per second = 25% hull
    expect(ship.hull).toBeCloseTo(0.75);
    expect(spent).toBeCloseTo(0.25 * frigate.repairTi);
    expect(s.run.ti.toNumber()).toBeCloseTo(1000 - spent);
  });

  it('stall without Titanium and go part way with a little', () => {
    const none = setup({ frigates: 1, ti: 0 });
    none.run.fleet.ships[0].hull = 0.2;
    repairShips(none, 1, 100, 0.01);
    expect(none.run.fleet.ships[0].hull).toBe(0.2);

    const some = setup({ frigates: 1, ti: frigate.repairTi * 0.1 }); // enough Titanium for 10% of the hull
    some.run.fleet.ships[0].hull = 0.2;
    repairShips(some, 1, 100, 0.01);
    expect(some.run.fleet.ships[0].hull).toBeCloseTo(0.3);
    expect(some.run.ti.toNumber()).toBeCloseTo(0);
  });

  it('go four times faster in reserve and in the hangar', () => {
    const s = setup({ frigates: 2 });
    s.run.fleet.ships[0].hull = 0.1;
    s.run.fleet.ships[1].hull = 0.1;
    stepFleet(s, 1);
    const field = s.run.fleet.ships[0].hull - 0.1;
    expect(field).toBeCloseTo(FLEET.repair.fieldPerSecond);

    const r = setup({ frigates: 1 });
    r.run.fleet.ships[0].hull = 0.1;
    setOrder(r, 1, 'reserve');
    stepFleet(r, 1);
    expect(r.run.fleet.ships[0].hull - 0.1).toBeCloseTo(FLEET.repair.reservePerSecond);

    const h = setup({ frigates: 1 });
    h.run.fleet.ships[0].group = 0;
    h.run.fleet.ships[0].hull = 0.1;
    stepFleet(h, 1);
    expect(h.run.fleet.ships[0].hull - 0.1).toBeCloseTo(FLEET.repair.reservePerSecond);
  });

  it('mend a crippled ship from nothing', () => {
    const s = setup({ frigates: 1, ti: 1000 });
    s.run.fleet.ships[0].hull = 0;
    expect(integrityOf(s, 1)).toBe(0);
    repairShips(s, 1, 10, 0.01);
    expect(s.run.fleet.ships[0].hull).toBeCloseTo(0.1);
  });
});

describe('defeat', () => {
  it('cripples ships, stalls the group after repeated losses, and holds until resumed', () => {
    const s = setup({ frigates: 4, cleared: NODES.slice(0, 7).map((n) => n.id), ti: 1e6, deut: 1e5 });
    const g = s.run.fleet.groups[0];
    expect(nextCampaignNode(s.meta)?.id).toBe('t1-n8');
    const events: FleetEvent[] = [];
    run(s, 3000, () => g.stalled, events);

    expect(g.stalled).toBe(true);
    expect(g.failStreak).toBe(FLEET.failStreakLimit);
    expect(s.meta.battles.lost).toBe(FLEET.failStreakLimit);
    expect(s.meta.cleared['t1-n8']).toBeUndefined();
    expect(events.some((e) => e.kind === 'stalled')).toBe(true);

    const total = s.meta.battles.total;
    run(s, 300);
    expect(s.meta.battles.total).toBe(total); // no more sorties while stalled
    expect(runtimeOf(s, 1).waiting).toMatch(/Stalled/);
    resumeGroup(s, 1);
    run(s, 400, () => runtimeOf(s, 1).battle !== null);
    expect(runtimeOf(s, 1).battle).not.toBeNull();
  });

  it('pays no reward for a loss', () => {
    const s = setup({ frigates: 4, cleared: NODES.slice(0, 7).map((n) => n.id), ti: 1e6, deut: 1e5 });
    const rp = s.run.rp.toNumber();
    run(s, 600, () => s.meta.battles.total > 0);
    expect(s.meta.battles.lost).toBe(1);
    expect(s.run.rp.toNumber()).toBe(rp);
    expect(runtimeOf(s, 1).last?.crippled).toBeGreaterThan(0);
    expect(shipsOf(s, 1).some((x) => x.hull === 0)).toBe(true);
  });

  it('lets a retreat leave with no reward, no penalty and no experience', () => {
    const s = setup({ frigates: 6, deut: 100 });
    run(s, 10, () => runtimeOf(s, 1).battle !== null);
    const deutBefore = s.run.deut.toNumber();
    expect(useAbility(s, 1, 'retreat')).toBe(true);
    expect(s.run.deut.toNumber()).toBe(deutBefore - COMBAT.abilities.retreat.deut);
    stepFleet(s, 0.5);
    expect(runtimeOf(s, 1).battle).toBeNull();
    expect(runtimeOf(s, 1).last?.outcome).toBe('retreat');
    expect(s.meta.cleared['t1-n1']).toBeUndefined();
    expect(s.run.fleet.groups[0].failStreak).toBe(0);
    expect(s.run.fleet.ships.every((x) => x.xp === 0)).toBe(true);
  });
});

describe('patrol', () => {
  it('pays Titanium and Deuterium but not Requisition, and does not advance the campaign', () => {
    const s = setup({ frigates: 6, cleared: ['t1-n1'], deut: 200, ti: 0 });
    setOrder(s, 1, 'patrol');
    expect(targetNode(s, s.run.fleet.groups[0]).node?.id).toBe('t1-n1');
    const rp = s.run.rp.toNumber();
    run(s, 900, () => s.meta.battles.won >= 1);
    expect(s.meta.battles.won).toBe(1);
    expect(s.run.rp.toNumber()).toBe(rp);
    expect(s.meta.cleared['t1-n1']).toBe(1);
    expect(s.run.ti.toNumber()).toBeGreaterThanOrEqual(NODES[0].patrol.ti - 1e-6);
    const spent = 6 * FLEET.sortie.deutPerCommand;
    expect(s.run.deut.toNumber()).toBeCloseTo(200 - spent + NODES[0].patrol.deut);
  });

  it('can be pointed at any cleared sector', () => {
    const s = setup({ frigates: 4, cleared: ['t1-n1', 't1-n2', 't1-n3'] });
    setOrder(s, 1, 'patrol');
    expect(targetNode(s, s.run.fleet.groups[0]).node?.id).toBe('t1-n3'); // furthest by default
    setPatrolNode(s, 1, 't1-n2');
    expect(targetNode(s, s.run.fleet.groups[0]).node?.id).toBe('t1-n2');
    setPatrolNode(s, 1, 't1-n5'); // not cleared, so it is ignored
    expect(targetNode(s, s.run.fleet.groups[0]).node?.id).toBe('t1-n3');
  });
});

describe('abilities', () => {
  it('cost Deuterium and need a battle', () => {
    const s = setup({ frigates: 6, deut: 100 });
    expect(useAbility(s, 1, 'evasive')).toBe(false); // no battle yet
    run(s, 10, () => runtimeOf(s, 1).battle !== null);
    const before = s.run.deut.toNumber();
    expect(useAbility(s, 1, 'evasive')).toBe(true);
    expect(s.run.deut.toNumber()).toBe(before - COMBAT.abilities.evasive.deut);
    expect(useAbility(s, 1, 'evasive')).toBe(false); // cooling down
    s.run.deut = D(1);
    expect(useAbility(s, 1, 'overcharge')).toBe(false); // cannot pay
  });

  it('are used automatically when the group is set to', () => {
    const s = setup({ frigates: 6, deut: 1000 });
    s.run.fleet.groups[0].autoAbilities = true;
    run(s, 600, () => s.meta.battles.total > 0);
    const spent = 1000 - s.run.deut.toNumber() + NODES[0].reward.rp * 0; // sortie plus abilities
    expect(spent).toBeGreaterThan(6 * FLEET.sortie.deutPerCommand);
  });
});

describe('battle speed', () => {
  it('hurries battles and repairs but not the drydock', () => {
    const a = setup({ frigates: 1 });
    const b = setup({ frigates: 1 });
    a.run.fleet.ships[0].hull = 0.1;
    b.run.fleet.ships[0].hull = 0.1;
    setOrder(a, 1, 'reserve');
    setOrder(b, 1, 'reserve');
    queueShip(a, 'frigate');
    queueShip(b, 'frigate');
    stepFleet(a, 1, undefined, 1);
    stepFleet(b, 1, undefined, 4);
    expect(b.run.fleet.ships[0].hull - 0.1).toBeCloseTo(4 * (a.run.fleet.ships[0].hull - 0.1));
    expect(a.run.fleet.queue[0].remaining).toBe(b.run.fleet.queue[0].remaining);
  });

  it('resolves the same battle either way', () => {
    const outcome = (speed: number) => {
      const s = setup({ frigates: 6 });
      for (let t = 0; t < 600 && s.meta.battles.total === 0; t += 0.5) stepFleet(s, 0.5, undefined, speed);
      return runtimeOf(s, 1).last?.outcome;
    };
    expect(outcome(1)).toBe('victory');
    expect(outcome(4)).toBe('victory');
  });
});

describe('helpers', () => {
  it('describe the first node and the boss', () => {
    const { first, last } = nodes(setup());
    expect(first.id).toBe('t1-n1');
    expect(last.boss).toBe(true);
    expect(last.unlocks).toContain('light-cruiser');
    expect(classOf(makeShip(frigate, 1, 1, 'front')).id).toBe('frigate');
  });
});

describe('veteran cadre', () => {
  it('keeps half the best ship\'s experience, capped', () => {
    const s = setup({ frigates: 2 });
    s.run.fleet.ships[0].xp = 10;
    updateCadre(s);
    expect(s.meta.cadreXp).toBe(Math.min(FLEET.cadre.cap, Math.floor(10 * FLEET.cadre.share)));
    s.run.fleet.ships[1].xp = 500;
    updateCadre(s);
    expect(s.meta.cadreXp).toBe(FLEET.cadre.cap);
  });

  it('never goes down', () => {
    const s = setup({ frigates: 1, xp: 0 });
    s.meta.cadreXp = 6;
    updateCadre(s);
    expect(s.meta.cadreXp).toBe(6);
  });

  it('survives Redeploy and seeds the next run\'s ships', () => {
    const s = setup({ frigates: 1, xp: 20 });
    s.run.earned = D(1e12);
    const kept = Math.min(FLEET.cadre.cap, Math.floor(20 * FLEET.cadre.share));
    expect(redeploy(s)).not.toBeNull();
    expect(s.meta.cadreXp).toBe(kept);
    expect(s.run.fleet.ships.length).toBe(0);

    s.run.ti = D(100000);
    s.run.rp = D(1e9);
    expect(queueShip(s, 'frigate').ok).toBe(true);
    run(s, frigate.buildSeconds + 2, () => s.run.fleet.ships.length > 0);
    expect(s.run.fleet.ships[0].xp).toBe(kept);
  });
});

describe('experience cap', () => {
  it('stops teaching crews once they reach what a sector can offer', () => {
    const s = setup({ frigates: 6, xp: 3, cleared: ['t1-n1'], deut: 5000 });
    setOrder(s, 1, 'patrol');
    setPatrolNode(s, 1, 't1-n1');
    const cap = NODES[0].xpCap;
    run(s, 600, () => s.meta.battles.won >= 3);
    expect(s.meta.battles.won).toBeGreaterThanOrEqual(3);
    for (const ship of s.run.fleet.ships) expect(ship.xp).toBe(cap);
  });

  it('is higher at harder sectors', () => {
    const caps = NODES.map((n) => n.xpCap);
    expect(caps).toEqual([...caps].sort((a, b) => a - b));
    expect(caps[caps.length - 1]).toBeGreaterThan(FLEET.ranks[FLEET.ranks.length - 1].xp);
  });
});

describe('review fixes', () => {
  it('pays a sortie by the order it left under, not the order set mid-battle', () => {
    const s = setup({ frigates: 6, cleared: ['t1-n1'] });
    setOrder(s, 1, 'patrol');
    setPatrolNode(s, 1, 't1-n1');
    const rt = runtimeOf(s, 1);
    run(s, 30, () => rt.battle !== null);
    expect(rt.battle).not.toBeNull();
    const rpBefore = s.run.rp;
    setOrder(s, 1, 'campaign'); // flip during the fight
    run(s, 300, () => rt.battle === null);
    expect(rt.last?.order).toBe('patrol');
    expect(s.run.rp.eq(rpBefore)).toBe(true);
  });

  it('applies stance changes to a battle already under way', () => {
    const s = setup({ frigates: 4 });
    const rt = runtimeOf(s, 1);
    run(s, 30, () => rt.battle !== null);
    expect(rt.battle?.stance).toBe('standard');
    s.run.fleet.groups[0].stance = 'closein';
    stepFleet(s, 0.5);
    expect(rt.battle?.stance).toBe('closein');
  });

  it('carries leftover build time to the next job', () => {
    const s = setup({});
    for (let i = 0; i < 4; i++) expect(queueShip(s, 'frigate').ok).toBe(true);
    s.run.fleet.queue[0].remaining = 7.3;
    const before = s.run.fleet.ships.length;
    applyOfflineFleet(s, 7.3 + 3 * frigate.buildSeconds + 0.1, 1);
    expect(s.run.fleet.ships.length - before).toBe(4);
  });

  it('never creates Titanium or Deuterium from an offline patrol', () => {
    const s = setup({ frigates: 3, ti: 0, deut: 60, cleared: ['t1-n1', 't1-n2'] });
    setOrder(s, 1, 'patrol');
    setPatrolNode(s, 1, 't1-n2');
    const tiBefore = s.run.ti.toNumber();
    const report = applyOfflineFleet(s, 8 * 3600, 1);
    const ti = s.run.ti.toNumber();
    const gross = report.patrols.reduce((n, p) => n + p.ti, 0);
    expect(ti).toBeGreaterThanOrEqual(0);
    expect(ti - tiBefore).toBeLessThanOrEqual(gross);
    expect(s.run.deut.toNumber()).toBeLessThanOrEqual(FLEET.storage.deut);
  });

  it('repairs hangar and idle ships over a long absence', () => {
    const s = setup({ frigates: 2, ti: 100000 });
    s.run.fleet.ships[0].hull = 0;
    s.run.fleet.ships[1].hull = 0.3;
    s.run.fleet.ships[0].group = 0;
    applyOfflineFleet(s, 8 * 3600, 1);
    expect(s.run.fleet.ships[0].hull).toBe(1);
    expect(s.run.fleet.ships[1].hull).toBe(1);
  });
});
