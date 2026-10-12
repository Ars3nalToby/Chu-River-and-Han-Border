export interface FrameInfo {
  /** scaled delta (seconds) — slowed by hit-stop */
  dt: number;
  /** real delta (seconds) */
  rawDt: number;
  /** accumulated scaled time */
  time: number;
  /** accumulated real time */
  rawTime: number;
}

type Listener = (f: FrameInfo) => void;

/** Single requestAnimationFrame loop with a global time scale. */
export class Loop {
  timeScale = 1;
  private listeners: Listener[] = [];
  private last = 0;
  private time = 0;
  private rawTime = 0;
  private running = false;
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** smoothed FPS over the last ~0.5s, updated continuously */
  fps = 60;
  onFps?: (fps: number) => void;

  add(l: Listener): () => void {
    this.listeners.push(l);
    return () => (this.listeners = this.listeners.filter((x) => x !== l));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      const rawDt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const dt = rawDt * this.timeScale;
      this.time += dt;
      this.rawTime += rawDt;
      const info: FrameInfo = { dt, rawDt, time: this.time, rawTime: this.rawTime };
      for (const l of this.listeners) l(info);
      this.fpsAcc += rawDt;
      this.fpsFrames++;
      if (this.fpsAcc >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAcc;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
        this.onFps?.(this.fps);
      }
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }
}
