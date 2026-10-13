export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** frame-rate independent exponential damping */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export type Ease = (t: number) => number;
export const linear: Ease = (t) => t;
export const easeInQuad: Ease = (t) => t * t;
export const easeOutQuad: Ease = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad: Ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeInCubic: Ease = (t) => t * t * t;
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInPow = (p: number): Ease => (t) => Math.pow(t, p);
export const easeOutPow = (p: number): Ease => (t) => 1 - Math.pow(1 - t, p);

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** cheap 2D value noise + fbm, deterministic */
const P = new Uint8Array(512);
{
  const r = mulberry32(1337);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
}
const fade = (t: number) => t * t * (3 - 2 * t);
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const a = P[P[X] + Y] / 255, b = P[P[X + 1] + Y] / 255;
  const c = P[P[X] + Y + 1] / 255, d = P[P[X + 1] + Y + 1] / 255;
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
/** periodic value noise (tiles every `period` lattice cells) */
export function noise2p(x: number, y: number, period: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X0 = ((xi % period) + period) % period, X1 = (X0 + 1) % period;
  const Y0 = ((yi % period) + period) % period, Y1 = (Y0 + 1) % period;
  const a = P[P[X0] + Y0] / 255, b = P[P[X1] + Y0] / 255;
  const c = P[P[X0] + Y1] / 255, d = P[P[X1] + Y1] / 255;
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2p(x: number, y: number, period: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * noise2p(x * f, y * f, period * f);
    f *= 2;
    a *= 0.5;
  }
  return s;
}

export function fbm2(x: number, y: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x * f, y * f);
    f *= 2;
    a *= 0.5;
  }
  return s;
}

export function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}
