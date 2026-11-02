import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { MARINE, NODES } from '../src/data';
import { reinforce, runtimeOf, setAuto, setMission, setTarget, startMission, stepMarines, syncMarines } from '../src/sim/marines';
import { startResearch } from '../src/sim/research';
import { sanitizeResearch } from '../src/state/researchState';
import { redeploy } from '../src/sim/prestige';
import { CURRENT_VERSION, migrate } from '../src/state/migrations';
import { sanitizeMarines } from '../src/state/marineState';
import { decodeSave, encodeSave, fromRaw, newGameState, toRaw } from '../src/state/serialize';
import type { GameState } from '../src/state/types';

function played(): GameState {
  const s = newGameState(0, 5);
  for (const n of NODES.slice(0, 4)) s.meta.cleared[n.id] = 1;
  syncMarines(s);
  s.run.pers = D(50);
  s.run.intel = D(500);
  reinforce(s, s.run.marines.squads[0]);
  s.run.marines.squads[0].slots[0]!.xp = 30;
  s.run.marines.squads[0].slots[0]!.perks = ['sharpshooter'];
  s.run.marines.squads[0].slots[1]!.hurt = 40;
  s.run.marines.scouted['t1-n2'] = 2;
  startResearch(s, 'optics');
  s.meta.captured['t1-n1'] = 1;
  s.meta.missions = { total: 4, won: 3, lost: 1, killed: 2 };
  return s;
}

describe('marine saves', () => {
  it('round-trip the roster, research, scouting and captured ground', () => {
    const s = played();
    const back = decodeSave(encodeSave(s))!;
    expect(back.run.marines).toEqual(s.run.marines);
    expect(back.run.pers.eq(s.run.pers)).toBe(true);
    expect(back.run.intel.eq(s.run.intel)).toBe(true);
    expect(back.meta.captured).toEqual({ 't1-n1': 1 });
    expect(back.meta.opsUnlocked).toBe(true);
    expect(back.meta.missions).toEqual(s.meta.missions);
    expect(back.version).toBe(CURRENT_VERSION);
  });

  it('upgrade a version 2 save and open Operations if the first sector is already clear', () => {
    const old = toRaw(newGameState(0, 1)) as unknown as Record<string, any>;
    old.version = 2;
    delete old.run.pers;
    delete old.run.intel;
    delete old.run.marines;
    for (const k of ['opsUnlocked', 'captured', 'missions']) delete old.meta[k];
    old.meta.cleared = { 't1-n1': 1 };
    expect(migrate(old)?.version).toBe(CURRENT_VERSION);
    const s = fromRaw(old)!;
    expect(s.meta.opsUnlocked).toBe(false);
    syncMarines(s);
    expect(s.meta.opsUnlocked).toBe(true);
    expect(s.run.marines.squads).toHaveLength(1);
    expect(s.run.pers.toNumber()).toBe(MARINE.startingPersonnel);
  });

  it('hand back an assault garrison and orbital Deuterium that a reload would lose', () => {
    const s = played();
    s.meta.cleared['t1-n1'] = 1;
    delete s.meta.captured['t1-n1'];
    setAuto(s, 1, false);
    setMission(s, 1, 'assault');
    setTarget(s, 1, 't1-n1');
    s.run.marines.squads[0].slots[1]!.hurt = 0;
    const before = s.run.pers.toNumber();
    expect(startMission(s, 1).ok).toBe(true);
    const paid = runtimeOf(s, 1).mission!.paid.pers;
    expect(paid).toBeGreaterThan(0);
    const raw = toRaw(s);
    expect(Number(raw.run.pers)).toBeCloseTo(s.run.pers.toNumber() + paid);
    expect(Number(raw.run.pers)).toBeLessThanOrEqual(before);
    stepMarines(s, 1);
    expect(fromRaw(JSON.parse(JSON.stringify(raw)))!.run.ops).toEqual({});
  });

  it('start a Redeploy with fresh marines, kept ground and starting Personnel', () => {
    const s = played();
    s.run.earned = D(1e9);
    expect(redeploy(s)).not.toBeNull();
    expect(s.run.marines.squads).toHaveLength(1);
    expect(s.run.marines.squads[0].slots.every((m) => m === null)).toBe(true);
    expect(s.run.research).toEqual({ done: [], active: [] });
    expect(s.run.marines.scouted).toEqual({});
    expect(s.run.pers.toNumber()).toBe(MARINE.startingPersonnel);
    expect(s.run.intel.toNumber()).toBe(0);
    expect(s.meta.captured).toEqual({ 't1-n1': 1 });
    expect(s.meta.opsUnlocked).toBe(true);
  });
});

describe('hardened marine loading', () => {
  it('drops unknown units, perks and vehicles and fixes numbers', () => {
    const raw = {
      squads: [
        {
          id: 1,
          name: '   ',
          slots: [
            { id: 1, unit: 'marine', xp: 1e30, perks: ['leader', 'sharpshooter'], hurt: -5 },
            { id: 1, unit: 'marine', xp: 'x', perks: 'no', hurt: 1e9 },
            { id: 2, unit: 'dragon', xp: 5 },
            null,
          ],
          want: ['marksman', 'nonsense', 3],
          vehicle: 'tank',
          mission: 'raid',
          target: 'mars',
          standing: 'wild',
          failStreak: -3,
        },
        { id: 1 },
        { id: 99 },
        'junk',
      ],
      nextMarineId: -4,
      scouted: { 't1-n1': 3, mars: 4, 't1-n2': -1 },
    };
    const m = sanitizeMarines(raw);
    expect(m.squads).toHaveLength(1);
    const sq = m.squads[0];
    expect(sq.name).toBe('Alpha Squad');
    expect(sq.slots).toHaveLength(MARINE.squadSlots);
    expect(sq.slots[0]?.xp).toBeLessThanOrEqual(1_000_000);
    expect(sq.slots[0]?.perks).toEqual([]); // 'leader' is a rank 2 perk and cannot come first
    expect(sq.slots[0]?.hurt).toBe(0);
    expect(sq.slots[1]?.id).not.toBe(sq.slots[0]?.id);
    expect(sq.slots[1]?.hurt).toBeLessThanOrEqual(3600);
    expect(sq.slots[2]).toBeNull();
    expect(sq.want.every((w) => w === 'marine' || w === 'marksman')).toBe(true);
    expect(sq.vehicle).toBeNull();
    expect(sq.mission).toBe('patrol');
    expect(sq.target).toBeNull();
    expect(sq.standing).toBe('adaptive');
    expect(sq.failStreak).toBe(0);
    expect(m.scouted).toEqual({ 't1-n1': 3 });
    const ids = m.squads.flatMap((q) => q.slots.filter(Boolean).map((x) => x!.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.nextMarineId).toBeGreaterThan(Math.max(0, ...ids));
  });

  it('keeps a research node only when what it needs is kept', () => {
    expect(sanitizeResearch({ done: ['medevac'], active: [] }, 1).done).toEqual([]);
    expect(sanitizeResearch({ done: ['optics', 'plates', 'surgeons'], active: [{ id: 'surgeons', remaining: 5 }] }, 1).active).toEqual([]);
    const ok = sanitizeResearch({ done: ['plates', 'optics', 'ghost'], active: [{ id: 'comms', remaining: 1e9 }] }, 1);
    expect(ok.done.sort()).toEqual(['optics', 'plates']);
    expect(ok.active).toEqual([{ id: 'comms', remaining: 180 }]);
  });

  it('runs no more projects than there are bays, and no project twice', () => {
    const two = sanitizeResearch({ done: [], active: [{ id: 'optics', remaining: 5 }, { id: 'optics', remaining: 5 }, { id: 'comms', remaining: 5 }] }, 2);
    expect(two.active.map((p) => p.id)).toEqual(['optics', 'comms']);
    expect(sanitizeResearch({ done: [], active: [{ id: 'optics', remaining: 5 }, { id: 'comms', remaining: 5 }] }, 1).active).toHaveLength(1);
  });

  it('survives complete rubbish and clamps stockpiles', () => {
    expect(sanitizeMarines(null).squads).toEqual([]);
    expect(sanitizeResearch('x', 1)).toEqual({ done: [], active: [] });
    const s = newGameState(0, 1);
    const raw = toRaw(s) as any;
    raw.run.pers = '1e50';
    raw.run.intel = 'banana';
    raw.meta.cleared = { 't1-n1': 1 };
    raw.meta.captured = { 't1-n1': 1, 't1-n2': 1, mars: 1 }; // t1-n2 is not cleared, so it cannot be held
    raw.meta.missions = { total: -1, won: 'x' };
    const back = fromRaw(raw)!;
    expect(back.run.pers.toNumber()).toBe(MARINE.storage.pers);
    expect(back.run.intel.toNumber()).toBe(0);
    expect(back.meta.captured).toEqual({ 't1-n1': 1 });
    expect(back.meta.missions).toEqual({ total: 0, won: 0, lost: 0, killed: 0 });
  });
});

describe('hostile saves (review fixes)', () => {
  const load = (edit: (raw: any) => void): GameState => {
    const raw = toRaw(played()) as any;
    edit(raw);
    return fromRaw(raw)!;
  };

  it('treat prototype names as unknown ids rather than crashing the loop', () => {
    const s = load((raw) => {
      const sq = raw.run.marines.squads[0];
      sq.want[0] = 'constructor';
      sq.slots[2] = { id: 99, unit: 'toString', xp: 0, perks: [], hurt: 0 };
      sq.mission = 'constructor';
      sq.vehicle = 'constructor';
      raw.run.research.active = [{ id: 'constructor', remaining: 5 }];
    });
    const sq = s.run.marines.squads[0];
    expect(sq.want[0]).toBe('marine');
    expect(sq.slots[2]).toBeNull();
    expect(sq.mission).toBe('patrol');
    expect(sq.vehicle).toBeNull();
    expect(s.run.research.active).toEqual([]);
    expect(() => stepMarines(s, 1)).not.toThrow();
  });

  it('renumber squads, keep auto off for assaults, and allow only the squads the Barracks pay for', () => {
    const s = load((raw) => {
      const base = raw.run.marines.squads[0];
      raw.run.marines.squads = [{ ...base, id: 2, mission: 'assault', auto: true }, { ...base, id: 4 }, { ...base, id: 3 }];
      raw.run.owned.barracks = 1;
    });
    expect(s.run.marines.squads.map((q) => q.id)).toEqual([1, 2]);
    expect(s.run.marines.squads[0].auto).toBe(false);
    const none = load((raw) => {
      raw.run.marines.squads = [raw.run.marines.squads[0], { ...raw.run.marines.squads[0], id: 2 }];
      raw.run.owned.barracks = 0;
    });
    expect(none.run.marines.squads).toHaveLength(1);
  });

  it('clamp the marine id counter', () => {
    const s = load((raw) => {
      raw.run.marines.nextMarineId = 1e300;
    });
    expect(s.run.marines.nextMarineId).toBeLessThanOrEqual(1_000_000);
  });
});
