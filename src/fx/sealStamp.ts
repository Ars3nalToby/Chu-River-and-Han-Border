/** Vermilion seal stamp "將軍" that slams onto the screen centre with an ink-splash burst. */
export class SealStamp {
  private layer: HTMLElement;
  private seal: HTMLElement;
  private glyphs: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private drops: { x: number; y: number; vx: number; vy: number; r: number; life: number; age: number; stretch: number }[] = [];
  private raf = 0;
  private hideTimer = 0;

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'stamp-layer';
    this.canvas = document.createElement('canvas');
    this.seal = document.createElement('div');
    this.seal.className = 'seal';
    const face = document.createElement('div');
    face.className = 'face';
    this.glyphs = document.createElement('div');
    this.glyphs.className = 'glyphs';
    this.seal.append(face, this.glyphs);
    this.layer.append(this.canvas, this.seal);
    parent.appendChild(this.layer);
    this.g = this.canvas.getContext('2d')!;
    // rough-edge ink filter
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.innerHTML = `<filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="7"/></filter>`;
    parent.appendChild(svg);
  }

  /** @param impact called at the moment the seal lands (≈ 0.13 s in) */
  show(text: string, opts: { latin?: boolean; impact?: () => void; durationMs?: number } = {}): void {
    const dur = opts.durationMs ?? 900;
    this.glyphs.innerHTML = '';
    for (const ch of opts.latin ? [text] : Array.from(text)) {
      const sp = document.createElement('span');
      sp.textContent = ch;
      this.glyphs.appendChild(sp);
    }
    this.seal.classList.remove('show', 'short', 'en');
    if (opts.latin) this.seal.classList.add('en');
    else if (text.length === 1) this.seal.classList.add('short');
    void this.seal.offsetWidth; // restart the animation
    this.seal.classList.add('show');
    (this.seal.style as CSSStyleDeclaration).animationDuration = `${dur}ms`;
    clearTimeout(this.hideTimer);
    window.setTimeout(() => {
      this.splash();
      opts.impact?.();
      this.layer.classList.remove('layer-shake');
      void this.layer.offsetWidth;
      this.layer.classList.add('layer-shake');
    }, dur * 0.14);
    this.hideTimer = window.setTimeout(() => this.seal.classList.remove('show'), dur + 40);
  }

  private splash() {
    const rect = this.layer.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    const cx = rect.width / 2, cy = rect.height / 2;
    const unit = Math.min(rect.width, rect.height) * 0.11;
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.8 + Math.random() * 2.6) * unit * 3.2;
      const dist = unit * (0.9 + Math.random() * 1.4);
      this.drops.push({
        x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.5 + Math.random() * Math.random() * 11,
        life: 0.35 + Math.random() * 0.55, age: 0, stretch: 1 + Math.random() * 2.6,
      });
    }
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const g = this.g;
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drops = this.drops.filter((d) => d.age < d.life);
      for (const d of this.drops) {
        d.age += dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vx *= Math.exp(-5.5 * dt);
        d.vy *= Math.exp(-5.5 * dt);
        const u = d.age / d.life;
        g.save();
        g.translate(d.x, d.y);
        g.rotate(Math.atan2(d.vy, d.vx));
        g.fillStyle = `rgba(158, 22, 14, ${0.9 * (1 - u)})`;
        g.beginPath();
        g.ellipse(0, 0, d.r * (1 + Math.min(1.5, Math.hypot(d.vx, d.vy) / 260) * d.stretch * 0.4), d.r * (1 - u * 0.4), 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      if (this.drops.length) this.raf = requestAnimationFrame(tick);
      else g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    };
    this.raf = requestAnimationFrame(tick);
  }
}
