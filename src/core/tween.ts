import { Ease, linear } from './util';

interface Task {
  t: number;
  dur: number;
  fn: (u: number) => void;
  ease: Ease;
  done: () => void;
  unscaled: boolean;
}

/**
 * Promise-based tweens driven by the single render loop.
 * `tween()` follows the global time scale (hit-stop slows it); pass `unscaled` for UI/timer work.
 */
export class Scheduler {
  private tasks: Task[] = [];
  /** >1 fast-forwards everything (used to finish an aborted replay quickly) */
  speed = 1;

  tween(dur: number, fn: (u: number) => void, ease: Ease = linear, unscaled = false): Promise<void> {
    return new Promise((resolve) => {
      if (dur <= 0) {
        fn(1);
        resolve();
        return;
      }
      this.tasks.push({ t: 0, dur, fn, ease, done: resolve, unscaled });
    });
  }

  wait(sec: number, unscaled = false): Promise<void> {
    return this.tween(sec, () => {}, linear, unscaled);
  }

  /** run a callback every frame for `dur` seconds, with frame dt */
  update(dt: number, rawDt: number): void {
    if (!this.tasks.length) return;
    const finished: Task[] = [];
    // iterate on a snapshot: callbacks may add tasks
    const snapshot = this.tasks.slice();
    for (const k of snapshot) {
      k.t += (k.unscaled ? rawDt : dt) * this.speed;
      const u = Math.min(1, k.t / k.dur);
      k.fn(k.ease(u));
      if (u >= 1) finished.push(k);
    }
    if (finished.length) {
      this.tasks = this.tasks.filter((k) => !finished.includes(k));
      for (const k of finished) k.done();
    }
  }

  /** drop everything in flight (new game / replay) — pending promises resolve immediately */
  cancelAll(): void {
    const t = this.tasks;
    this.tasks = [];
    for (const k of t) k.done();
  }

  get busy(): boolean {
    return this.tasks.length > 0;
  }
}
