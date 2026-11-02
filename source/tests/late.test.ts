import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { ENEMY_BY_ID, FLEET, NODES, POSITION_BY_NODE, SHIP_BY_ID, SHIPS, THEATRES } from '../src/data';
import { commandCapacity } from '../src/sim/campaign';
import { capOf } from '../src/sim/economy';
import { makeShip } from '../src/state/fleetState';
import { newGameState, fromRaw, toRaw } from '../src/state/serialize';

describe('Theatres 3 to 5', () => {
  const late = THEATRES.filter((t) => t.id >= 3);

  it('each have eight sectors, a boss, known enemies and a ground position per sector', () => {
    expect(late.map((t) => t.id)).toEqual([3, 4, 5]);
    for (const t of late) {
      expect(t.nodes).toHaveLength(8);
      expect(t.nodes[7].boss).toBe(true);
      for (const n of t.nodes) {
        expect(n.scale).toBeGreaterThan(0);
        for (const id of Object.keys(n.enemies)) expect(ENEMY_BY_ID[id], `${n.id} ${id}`).toBeDefined();
        expect(POSITION_BY_NODE[n.id], n.id).toBeDefined();
      }
    }
  });

  it('pay more Honors each, and rewards rise through every theatre', () => {
    const honors = THEATRES.map((t) => t.honors);
    expect(honors).toEqual([...honors].sort((a, b) => a - b));
    expect(new Set(honors).size).toBe(honors.length);
    for (const t of THEATRES) for (let i = 1; i < t.nodes.length; i++) expect(t.nodes[i].reward.rp).toBeGreaterThan(t.nodes[i - 1].reward.rp);
    for (let i = 1; i < THEATRES.length; i++) expect(THEATRES[i].nodes[0].reward.rp).toBeGreaterThan(THEATRES[i - 1].nodes[7].reward.rp);
  });

  it('need a carrier, then a flagship, to Transfer on', () => {
    expect(THEATRES[2].transferShip).toBe('carrier');
    expect(THEATRES[3].transferShip).toBe('flagship');
    expect(THEATRES[4].transferShip).toBeUndefined();
  });
});

describe('carrier and flagship', () => {
  it('unlock from real sectors, cost more and fight harder than the class below', () => {
    const order = ['frigate', 'light-cruiser', 'heavy-cruiser', 'carrier', 'flagship'].map((id) => SHIP_BY_ID[id]);
    for (let i = 1; i < order.length; i++) {
      expect(order[i].hull).toBeGreaterThan(order[i - 1].hull);
      expect(order[i].damageMult).toBeGreaterThan(order[i - 1].damageMult);
      expect(order[i].cost.rp).toBeGreaterThan(order[i - 1].cost.rp);
      expect(order[i].command).toBeGreaterThan(order[i - 1].command);
    }
    for (const id of ['carrier', 'flagship']) {
      const u = SHIP_BY_ID[id].unlock;
      expect(u.kind === 'node' && NODES.some((n) => n.id === u.node)).toBe(true);
    }
    expect(SHIPS.length).toBe(5);
  });

  it('fit in a strike group once the theatre they belong to is open', () => {
    const s = newGameState(0, 5);
    s.meta.theatre = 3;
    s.meta.theatresOpen = 3;
    expect(commandCapacity(s.meta)).toBeGreaterThanOrEqual(SHIP_BY_ID.carrier.command);
    for (const n of THEATRES[2].nodes) s.meta.cleared[n.id] = 1; // a fully cleared theatre
    expect(commandCapacity(s.meta)).toBeGreaterThanOrEqual(SHIP_BY_ID.carrier.command * 2);
    s.meta.theatre = 5;
    s.meta.theatresOpen = 5;
    expect(commandCapacity(s.meta)).toBeGreaterThanOrEqual(SHIP_BY_ID.flagship.command + SHIP_BY_ID.carrier.command);
    expect(commandCapacity(s.meta)).toBeGreaterThanOrEqual(FLEET.commandCapacity + FLEET.lateTheatreCommand * 3);
  });
});

describe('late stockpiles', () => {
  it('hold enough Titanium and Salvage for the new ships, and survive a save', () => {
    const s = newGameState(0, 5);
    expect(capOf(s, 'ti')).toBe(FLEET.storage.ti);
    s.meta.theatresOpen = 3;
    expect(capOf(s, 'ti')).toBeGreaterThanOrEqual(SHIP_BY_ID.carrier.cost.ti);
    s.meta.theatresOpen = 4;
    expect(capOf(s, 'ti')).toBeGreaterThanOrEqual(SHIP_BY_ID.flagship.cost.ti);
    s.run.ti = D(SHIP_BY_ID.flagship.cost.ti);
    const back = fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!;
    expect(back.run.ti.gte(SHIP_BY_ID.flagship.cost.ti)).toBe(true);
  });
});

describe('review fixes', () => {
  it('trims a group over capacity on load, and an earlier theatre never shrinks capacity', () => {
    const s = newGameState(0, 5);
    s.meta.theatresOpen = 4;
    s.meta.theatre = 4;
    const cap = commandCapacity(s.meta);
    s.meta.theatre = 1;
    expect(commandCapacity(s.meta)).toBe(cap);
    // a save claiming far too many frigates in one group
    s.run.fleet.ships = Array.from({ length: 80 }, (_, i) => ({ ...makeShip(SHIP_BY_ID.frigate, i + 1, 1, 'front') }));
    const back = fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!;
    const inGroup = back.run.fleet.ships.filter((x) => x.group === 1).length;
    expect(inGroup).toBeLessThanOrEqual(commandCapacity(back.meta));
    expect(inGroup).toBeGreaterThan(0);
  });
});
