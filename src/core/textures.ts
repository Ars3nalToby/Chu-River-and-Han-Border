import * as THREE from 'three';

export const FONT_BRUSH = '"Ma Shan Zheng", "Noto Serif SC", "WenQuanYi Zen Hei", "Songti SC", serif';
export const FONT_UI = '"Noto Serif SC", "Songti SC", "WenQuanYi Zen Hei", serif';

export function makeCanvas(w: number, h = w): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: false })! };
}

/** Wait (with timeout) for web fonts that cover the given text. */
export async function loadFonts(text: string, timeoutMs = 7000): Promise<boolean> {
  if (!('fonts' in document)) return false;
  const job = Promise.all([
    document.fonts.load('64px "Ma Shan Zheng"', text),
    document.fonts.load('600 24px "Noto Serif SC"', text),
    document.fonts.load('400 18px "Noto Serif SC"', text),
  ]).then(() => true);
  const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs));
  try {
    return await Promise.race([job, timeout]);
  } catch {
    return false;
  }
}

let softDot: THREE.CanvasTexture | null = null;
/** white radial falloff — used by every glow / ember / mote sprite */
export function softDotTexture(): THREE.CanvasTexture {
  if (softDot) return softDot;
  const { c, g } = makeCanvas(128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  softDot = new THREE.CanvasTexture(c);
  softDot.colorSpace = THREE.SRGBColorSpace;
  return softDot;
}

/** soft cloudy blob for mist sprites */
export function mistTexture(seed = 1): THREE.CanvasTexture {
  const { c, g } = makeCanvas(256);
  const rnd = (() => { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {
    const x = 70 + rnd() * 116, y = 90 + rnd() * 76, r = 28 + rnd() * 46;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.20)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  }
  // fade to zero at the borders
  const edge = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = edge;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
