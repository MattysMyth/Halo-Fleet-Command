/**
 * Small synthesised cues, so the game needs no audio files. Off by default; the browser only lets
 * sound start after the player has interacted, so the audio context is made on the first cue.
 */
export type Cue = 'chime' | 'win' | 'lose' | 'blip' | 'fanfare';

interface Tone {
  freq: number;
  at: number;
  len: number;
  type: OscillatorType;
  gain: number;
  slide?: number;
}

const CUES: Record<Cue, Tone[]> = {
  blip: [{ freq: 660, at: 0, len: 0.07, type: 'square', gain: 0.5 }],
  chime: [
    { freq: 880, at: 0, len: 0.12, type: 'sine', gain: 0.6 },
    { freq: 1320, at: 0.08, len: 0.18, type: 'sine', gain: 0.5 },
  ],
  win: [
    { freq: 523, at: 0, len: 0.12, type: 'triangle', gain: 0.6 },
    { freq: 659, at: 0.1, len: 0.12, type: 'triangle', gain: 0.6 },
    { freq: 784, at: 0.2, len: 0.22, type: 'triangle', gain: 0.6 },
  ],
  lose: [
    { freq: 220, at: 0, len: 0.3, type: 'sawtooth', gain: 0.35, slide: 110 },
  ],
  fanfare: [
    { freq: 392, at: 0, len: 0.14, type: 'triangle', gain: 0.6 },
    { freq: 523, at: 0.14, len: 0.14, type: 'triangle', gain: 0.6 },
    { freq: 659, at: 0.28, len: 0.14, type: 'triangle', gain: 0.6 },
    { freq: 784, at: 0.42, len: 0.4, type: 'triangle', gain: 0.7 },
  ],
};

let enabled = false;
let volume = 0.5;
let ctx: AudioContext | null = null;
let lastAt = 0;

export function configureSound(on: boolean, vol: number): void {
  enabled = on;
  volume = Math.min(1, Math.max(0, vol));
}

export const soundEnabled = (): boolean => enabled && volume > 0;

/** Play a cue. Never throws: a browser without audio, or one that blocks it, just stays quiet. */
export function playCue(cue: Cue, now: number = Date.now()): boolean {
  if (!soundEnabled() || now - lastAt < 120) return false;
  try {
    const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
    const AC = Ctor.AudioContext ?? Ctor.webkitAudioContext;
    if (!AC) return false;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    lastAt = now;
    const t0 = ctx.currentTime;
    for (const tone of CUES[cue]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.freq, t0 + tone.at);
      if (tone.slide) osc.frequency.linearRampToValueAtTime(tone.slide, t0 + tone.at + tone.len);
      const peak = tone.gain * volume * 0.25;
      g.gain.setValueAtTime(0.0001, t0 + tone.at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + tone.at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.at + tone.len);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + tone.at);
      osc.stop(t0 + tone.at + tone.len + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}
