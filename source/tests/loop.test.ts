import { describe, expect, it } from 'vitest';
import { FixedLoop } from '../src/core/loop';

function setup() {
  let t = 1_000_000;
  const steps: number[] = [];
  const gaps: number[] = [];
  let ticks = 0;
  const loop = new FixedLoop({
    now: () => t,
    stepMs: 100,
    maxCatchupMs: 10_000,
    onStep: (dt) => steps.push(dt),
    onGap: (g) => gaps.push(g),
    onTick: () => (ticks += 1),
  });
  return { loop, advance: (ms: number) => (t += ms), steps, gaps, ticks: () => ticks };
}

describe('FixedLoop', () => {
  it('runs one step per 100 ms of real time', () => {
    const s = setup();
    s.advance(1000);
    s.loop.tick();
    expect(s.steps).toHaveLength(10);
    expect(s.steps.every((dt) => dt === 0.1)).toBe(true);
    expect(s.gaps).toHaveLength(0);
  });

  it('keeps leftover time for the next tick', () => {
    const s = setup();
    s.advance(150);
    s.loop.tick();
    expect(s.steps).toHaveLength(1);
    s.advance(50);
    s.loop.tick();
    expect(s.steps).toHaveLength(2);
  });

  it('replays a short freeze as steps', () => {
    const s = setup();
    s.advance(5000);
    s.loop.tick();
    expect(s.steps).toHaveLength(50);
    expect(s.gaps).toHaveLength(0);
  });

  it('hands a long freeze to onGap in one call', () => {
    const s = setup();
    s.advance(3_600_000);
    s.loop.tick();
    expect(s.steps).toHaveLength(0);
    expect(s.gaps).toEqual([3600]);
  });

  it('notifies after each tick that did work and ignores a clock that did not move', () => {
    const s = setup();
    s.loop.tick();
    expect(s.ticks()).toBe(0);
    s.advance(100);
    s.loop.tick();
    expect(s.ticks()).toBe(1);
  });
});
