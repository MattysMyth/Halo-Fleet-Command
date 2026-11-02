import { afterEach, describe, expect, it } from 'vitest';
import { configureSound, playCue, soundEnabled } from '../src/core/sound';
import { DISPLAY_DEFAULTS, TEXT_SCALES, fromRaw, newGameState, toRaw } from '../src/state/serialize';

const roundTrip = (mutate: (raw: Record<string, any>) => void) => {
  const raw = JSON.parse(JSON.stringify(toRaw(newGameState(0, 1))));
  mutate(raw);
  return fromRaw(raw)!.settings;
};

describe('sound', () => {
  afterEach(() => configureSound(false, 0.5));

  it('is off by default and plays nothing while off or silent', () => {
    expect(DISPLAY_DEFAULTS.sound).toBe(false);
    expect(soundEnabled()).toBe(false);
    expect(playCue('win')).toBe(false);
    configureSound(true, 0);
    expect(soundEnabled()).toBe(false);
  });

  it('never throws when the browser has no audio', () => {
    configureSound(true, 0.5);
    expect(soundEnabled()).toBe(true);
    expect(() => playCue('fanfare', 1e9)).not.toThrow();
    expect(playCue('fanfare', 2e9)).toBe(false); // no AudioContext in the test environment
  });

  it('clamps the volume', () => {
    configureSound(true, 7);
    expect(soundEnabled()).toBe(true);
    configureSound(true, -3);
    expect(soundEnabled()).toBe(false);
  });
});

describe('display settings in a save', () => {
  it('round trip', () => {
    const s = roundTrip((r) => Object.assign(r.settings, { sound: true, volume: 0.8, reduceMotion: true, highContrast: true, textScale: 1.3 }));
    expect(s).toMatchObject({ sound: true, volume: 0.8, reduceMotion: true, highContrast: true, textScale: 1.3 });
  });

  it('are repaired when a hand-edited save is out of range', () => {
    const s = roundTrip((r) => Object.assign(r.settings, { sound: 'yes', volume: 9, reduceMotion: 1, highContrast: 'true', textScale: 5 }));
    expect(s.sound).toBe(false);
    expect(s.volume).toBe(1);
    expect(s.reduceMotion).toBe(false);
    expect(s.highContrast).toBe(false);
    expect(s.textScale).toBe(1);
    expect(TEXT_SCALES).toContain(s.textScale);
  });

  it('start at the defaults when an older save has none', () => {
    const s = roundTrip((r) => {
      r.settings = { notation: 'standard', buyMode: 1, battleSpeed: 1 };
    });
    expect(s).toMatchObject(DISPLAY_DEFAULTS);
  });
});
