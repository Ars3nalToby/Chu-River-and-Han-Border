/**
 * Fully synthesised audio (WebAudio, no files): wood, footsteps, bronze, terracotta,
 * cannon, drums, river + wind ambience, Karplus-Strong guqin plucks.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private noise!: AudioBuffer;
  private pluckCache = new Map<number, AudioBuffer>();
  muted = false;
  volume = 0.8;
  private ambientStarted = false;

  /** must be called from a user gesture */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.5;
    this.ambBus.connect(this.master);
    // 2s of white noise
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbient();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx!.currentTime, 0.05);
  }

  private get t() {
    return this.ctx!.currentTime;
  }

  /* ---------------- primitives ---------------- */

  private env(g: GainNode, t0: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  private burst(opts: { dur: number; type: BiquadFilterType; freq: number; q?: number; peak: number; attack?: number; delay?: number; freqEnd?: number; bus?: AudioNode }) {
    if (!this.ctx) return;
    const t0 = this.t + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.dur);
    f.Q.value = opts.q ?? 1;
    const g = this.ctx.createGain();
    this.env(g, t0, opts.attack ?? 0.004, opts.peak, opts.dur);
    src.connect(f).connect(g).connect(opts.bus ?? this.sfxBus);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + opts.dur + (opts.attack ?? 0.004) + 0.05);
  }

  private tone(opts: { type?: OscillatorType; f0: number; f1?: number; dur: number; peak: number; attack?: number; delay?: number; bus?: AudioNode }) {
    if (!this.ctx) return;
    const t0 = this.t + (opts.delay ?? 0);
    const o = this.ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.f0, t0);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(opts.f1, t0 + opts.dur);
    const g = this.ctx.createGain();
    this.env(g, t0, opts.attack ?? 0.004, opts.peak, opts.dur);
    o.connect(g).connect(opts.bus ?? this.sfxBus);
    o.start(t0);
    o.stop(t0 + opts.dur + (opts.attack ?? 0.004) + 0.05);
  }

  /* ---------------- game sounds ---------------- */

  woodClick(vol = 1) {
    this.burst({ dur: 0.05, type: 'bandpass', freq: 1900, q: 3, peak: 0.55 * vol });
    this.tone({ f0: 620, f1: 280, dur: 0.07, peak: 0.35 * vol });
  }

  woodSlide(dur = 0.4, vol = 1) {
    this.burst({ dur, type: 'bandpass', freq: 520, freqEnd: 380, q: 0.9, peak: 0.16 * vol, attack: 0.08 });
    this.burst({ dur: dur * 0.8, type: 'lowpass', freq: 900, q: 0.6, peak: 0.1 * vol, attack: 0.1, delay: 0.02 });
  }

  footstep(vol = 1) {
    this.tone({ f0: 95, f1: 42, dur: 0.14, peak: 0.55 * vol });
    this.burst({ dur: 0.09, type: 'lowpass', freq: 380, peak: 0.28 * vol });
  }

  bronzeClang(vol = 1, pitch = 1) {
    if (!this.ctx) return;
    const base = 330 * pitch;
    [1, 2.76, 5.4, 8.93, 11.34].forEach((m, i) => {
      this.tone({ type: 'sine', f0: base * m, dur: 1.4 / (1 + i * 0.7), peak: (0.34 / (1 + i * 0.55)) * vol });
    });
    this.burst({ dur: 0.08, type: 'highpass', freq: 3000, peak: 0.5 * vol });
    this.tone({ type: 'triangle', f0: base * 0.5, f1: base * 0.48, dur: 0.5, peak: 0.2 * vol });
  }

  terracottaShatter(vol = 1) {
    this.burst({ dur: 0.35, type: 'highpass', freq: 1500, q: 0.5, peak: 0.4 * vol, attack: 0.002 });
    this.tone({ f0: 180, f1: 70, dur: 0.25, peak: 0.45 * vol });
    for (let i = 0; i < 9; i++) {
      this.burst({ dur: 0.05, type: 'bandpass', freq: 1800 + Math.random() * 3200, q: 4, peak: 0.25 * vol * Math.random(), delay: 0.05 + i * 0.045 + Math.random() * 0.03 });
    }
    // clay tick-tick of chunks settling
    for (let i = 0; i < 5; i++) {
      this.tone({ f0: 900 + Math.random() * 700, f1: 400, dur: 0.04, peak: 0.12 * vol, delay: 0.4 + i * 0.12 + Math.random() * 0.08 });
    }
  }

  cannonThump(vol = 1) {
    this.tone({ f0: 130, f1: 32, dur: 0.5, peak: 0.95 * vol });
    this.burst({ dur: 0.5, type: 'lowpass', freq: 900, freqEnd: 120, q: 0.7, peak: 0.55 * vol });
    this.burst({ dur: 0.06, type: 'highpass', freq: 2200, peak: 0.3 * vol });
  }

  cannonWhistle(dur = 1.0, vol = 1) {
    this.tone({ type: 'sine', f0: 2200, f1: 620, dur, peak: 0.07 * vol, attack: 0.06 });
    this.tone({ type: 'sine', f0: 2210, f1: 640, dur, peak: 0.04 * vol, attack: 0.06 });
  }

  explosion(vol = 1) {
    this.tone({ f0: 90, f1: 28, dur: 0.9, peak: 1.0 * vol });
    this.burst({ dur: 1.5, type: 'lowpass', freq: 2400, freqEnd: 90, q: 0.5, peak: 0.85 * vol, attack: 0.005 });
    this.burst({ dur: 0.18, type: 'highpass', freq: 1800, peak: 0.5 * vol });
  }

  warDrum(vol = 1) {
    const hit = (delay: number, g: number) => {
      this.tone({ f0: 112, f1: 46, dur: 0.5, peak: 0.9 * g * vol, delay });
      this.burst({ dur: 0.18, type: 'lowpass', freq: 520, peak: 0.45 * g * vol, delay });
      this.tone({ f0: 70, f1: 40, dur: 0.7, peak: 0.5 * g * vol, delay });
    };
    hit(0, 1);
    hit(0.34, 0.75);
  }

  /** the seal-stamp "thud" */
  thud(vol = 1) {
    this.tone({ f0: 75, f1: 34, dur: 0.38, peak: 0.95 * vol });
    this.burst({ dur: 0.12, type: 'lowpass', freq: 300, peak: 0.55 * vol });
  }

  /** guqin-like pluck via Karplus-Strong */
  pluck(freq = 220, vol = 1, delay = 0) {
    if (!this.ctx) return;
    let buf = this.pluckCache.get(freq);
    if (!buf) {
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * 2.4);
      buf = this.ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const N = Math.max(2, Math.round(sr / freq));
      const line = new Float32Array(N);
      for (let i = 0; i < N; i++) line[i] = (Math.random() * 2 - 1) * (1 - i / N * 0.3);
      // one-pole smoothing of the exciter → softer, silkier attack
      for (let i = 1; i < N; i++) line[i] = line[i] * 0.4 + line[i - 1] * 0.6;
      let idx = 0;
      for (let i = 0; i < len; i++) {
        const a = line[idx], b = line[(idx + 1) % N];
        const v = (a + b) * 0.5 * 0.9965;
        line[idx] = v;
        d[i] = a;
        idx = (idx + 1) % N;
      }
      this.pluckCache.set(freq, buf);
    }
    const t0 = this.t + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.55 * vol;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    s.connect(lp).connect(g).connect(this.sfxBus);
    s.start(t0);
  }

  /** short pentatonic motifs for UI */
  uiTone(kind: 'select' | 'move' | 'confirm' | 'error' | 'win' | 'lose') {
    const D = [146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 370.0, 440.0]; // D pentatonic-ish
    switch (kind) {
      case 'select': this.pluck(D[5], 0.7); break;
      case 'move': this.pluck(D[3], 0.6); break;
      case 'confirm': this.pluck(D[3], 0.7); this.pluck(D[6], 0.7, 0.09); break;
      case 'error': this.pluck(D[1], 0.8); break;
      case 'win': [3, 5, 6, 8].forEach((n, i) => this.pluck(D[n], 0.9, i * 0.16)); break;
      case 'lose': [6, 4, 2, 0].forEach((n, i) => this.pluck(D[n], 0.9, i * 0.2)); break;
    }
  }

  /* ---------------- ambience ---------------- */

  private startAmbient() {
    if (!this.ctx || this.ambientStarted) return;
    this.ambientStarted = true;
    const ctx = this.ctx;
    const loopNoise = (type: BiquadFilterType, freq: number, q: number, gain: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      s.connect(f).connect(g).connect(this.ambBus);
      s.start();
      return { f, g };
    };
    // river: low rumble + gurgle that drifts
    const river = loopNoise('lowpass', 520, 0.4, 0.22);
    const gurgle = loopNoise('bandpass', 1400, 2.0, 0.06);
    // wind: slow bandpass sweeps
    const wind = loopNoise('bandpass', 380, 1.4, 0.12);
    const lfo = (param: AudioParam, rate: number, depth: number, base: number) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      param.value = base;
      o.start();
    };
    lfo(wind.f.frequency, 0.07, 160, 380);
    lfo(wind.g.gain, 0.05, 0.07, 0.11);
    lfo(gurgle.f.frequency, 0.31, 420, 1400);
    lfo(gurgle.g.gain, 0.23, 0.025, 0.05);
    lfo(river.g.gain, 0.11, 0.04, 0.2);
  }
}
