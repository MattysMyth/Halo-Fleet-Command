/**
 * Fixed-step game loop.
 *
 * Logic advances in constant `stepMs` slices (10 Hz by default) so the simulation is the same
 * on every machine. Rendering is separate: the UI only reads state.
 *
 * Time that passes while the page is frozen (hidden tab, sleeping laptop) arrives as one large
 * gap. Small gaps are replayed as steps; large gaps are handed to `onGap` so the game can apply
 * them in one calculation instead of thousands of catch-up ticks.
 */
export interface LoopOptions {
  stepMs?: number;
  /** Gaps longer than this go to onGap instead of being replayed as steps. */
  maxCatchupMs?: number;
  /** Clock in ms. Injectable so tests can drive time by hand. */
  now?: () => number;
  onStep: (dtSeconds: number) => void;
  onGap: (gapSeconds: number) => void;
  /** Called once after every tick() that did work, for rendering. */
  onTick?: () => void;
}

export class FixedLoop {
  private readonly stepMs: number;
  private readonly maxCatchupMs: number;
  private readonly now: () => number;
  private readonly opts: LoopOptions;
  private last: number;
  private acc = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: LoopOptions) {
    this.opts = opts;
    this.stepMs = opts.stepMs ?? 100;
    this.maxCatchupMs = opts.maxCatchupMs ?? 10_000;
    this.now = opts.now ?? (() => Date.now());
    this.last = this.now();
  }

  /** Advance by however much real time has passed since the last call. */
  tick(): void {
    const t = this.now();
    const elapsed = t - this.last;
    this.last = t;
    if (elapsed <= 0) return;

    if (elapsed > this.maxCatchupMs) {
      this.opts.onGap(elapsed / 1000);
      this.acc = 0;
    } else {
      this.acc += elapsed;
      while (this.acc >= this.stepMs) {
        this.opts.onStep(this.stepMs / 1000);
        this.acc -= this.stepMs;
      }
    }
    this.opts.onTick?.();
  }

  start(): void {
    if (this.timer !== null) return;
    this.last = this.now();
    this.timer = setInterval(() => this.tick(), Math.min(50, this.stepMs / 2));
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
