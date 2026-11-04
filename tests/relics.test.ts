import { describe, expect, it } from 'vitest';
import { D } from '../src/core/numbers';
import { RELICS, RELIC_BY_ID, FLEET } from '../src/data';
import { validateRelics } from '../src/data/relicSchema';
import { productionMultiplier } from '../src/sim/economy';
import { capOf } from '../src/sim/economy';
import { modsOf } from '../src/sim/modifiers';
import { redeploy } from '../src/sim/prestige';
import { buyRelic, nextRelicCost, relicLevel, relicProblem } from '../src/sim/relics';
import { migrate } from '../src/state/migrations';
import { buildCampaignView } from '../src/state/campaignView';
import { fromRaw, newGameState, toRaw } from '../src/state/serialize';

describe('Relics', () => {
  it('pass validation and catch mistakes', () => {
    expect(validateRelics(RELICS)).toEqual([]);
    const bad = structuredClone(RELICS);
    bad[0].perLevel = 5;
    bad[1].costs = [100, 50];
    bad.push({ ...bad[2] });
    const errors = validateRelics(bad);
    for (const t of ['perLevel', 'must not fall', 'duplicate']) expect(errors.some((e) => e.includes(t)), t).toBe(true);
  });

  it('are bought with Salvage, level by level, to the top', () => {
    const s = newGameState(0, 1);
    const def = RELIC_BY_ID.lattice;
    expect(relicProblem(s, 'lattice')).toMatch(/Salvage/);
    expect(buyRelic(s, 'lattice')).toBe(false);
    s.run.salvage = D(1e9);
    for (let i = 0; i < def.costs.length; i++) {
      const before = s.run.salvage;
      expect(buyRelic(s, 'lattice')).toBe(true);
      expect(before.sub(s.run.salvage).toNumber()).toBe(def.costs[i]);
    }
    expect(relicLevel(s.meta, 'lattice')).toBe(def.costs.length);
    expect(nextRelicCost(s.meta, def)).toBeNull();
    expect(buyRelic(s, 'lattice')).toBe(false);
    expect(buyRelic(s, 'nonsense')).toBe(false);
  });

  it('change the numbers they promise', () => {
    const s = newGameState(0, 1);
    const p0 = productionMultiplier(s, 'rp');
    s.run.salvage = D(1e9);
    buyRelic(s, 'lattice');
    expect(productionMultiplier(s, 'rp')).toBeGreaterThan(p0);
    buyRelic(s, 'beam');
    buyRelic(s, 'index');
    buyRelic(s, 'hardlight');
    buyRelic(s, 'slipdrive');
    const m = modsOf(s);
    expect(m.damage).toBeCloseTo(RELIC_BY_ID.beam.perLevel);
    expect(m.marine).toBeCloseTo(RELIC_BY_ID.index.perLevel);
    expect(m.hull).toBeCloseTo(RELIC_BY_ID.hardlight.perLevel);
    expect(m.reward).toBeCloseTo(RELIC_BY_ID.slipdrive.perLevel);
    const cap0 = capOf(s, 'ti');
    buyRelic(s, 'cartographer');
    expect(capOf(s, 'ti')).toBeGreaterThan(cap0);
  });

  it('survive a Redeploy and a save, and a storage Relic is not clamped away on load', () => {
    const s = newGameState(0, 1);
    s.run.salvage = D(1e9);
    buyRelic(s, 'cartographer');
    buyRelic(s, 'cartographer');
    s.run.ti = D(capOf(s, 'ti'));
    const back = fromRaw(JSON.parse(JSON.stringify(toRaw(s))))!;
    expect(back.meta.relics.cartographer).toBe(2);
    expect(back.run.ti.toNumber()).toBe(capOf(s, 'ti'));
    expect(capOf(s, 'ti')).toBeGreaterThan(FLEET.storage.ti);
    s.run.earned = D(1e12);
    redeploy(s);
    expect(s.meta.relics.cartographer).toBe(2);
  });

  it('are trimmed on load when a hand-edited save claims too much', () => {
    const s = newGameState(0, 1);
    const raw = JSON.parse(JSON.stringify(toRaw(s)));
    raw.meta.relics = { lattice: 99, ghost: 3, beam: -4, index: 'x' };
    const back = fromRaw(raw)!;
    expect(back.meta.relics).toEqual({ lattice: RELIC_BY_ID.lattice.costs.length });
  });

  it('upgrade an older save with none', () => {
    const raw = JSON.parse(JSON.stringify(toRaw(newGameState(0, 1))));
    raw.version = 5;
    delete raw.meta.relics;
    const up = migrate(raw)!;
    expect(up.version).toBe(6);
    expect((up.meta as Record<string, unknown>).relics).toEqual({});
  });

  it('show on the Campaign screen with prices and what is affordable', () => {
    const s = newGameState(0, 1);
    s.meta.opsUnlocked = true;
    let v = buildCampaignView(s);
    expect(v.relics).toHaveLength(RELICS.length);
    expect(v.relics.every((r) => !r.canBuy)).toBe(true);
    s.run.salvage = D(RELIC_BY_ID.cartographer.costs[0]);
    v = buildCampaignView(s);
    const c = v.relics.find((r) => r.def.id === 'cartographer')!;
    expect(c.canBuy).toBe(true);
    expect(c.current).toBe('No bonus');
    expect(c.next).toBe('+10% storage');
    expect(v.salvage).toBe(RELIC_BY_ID.cartographer.costs[0]);
  });
});
