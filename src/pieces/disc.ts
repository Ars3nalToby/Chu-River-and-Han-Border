import * as THREE from 'three';
import { DISC_H, DISC_R, COLORS } from '../core/constants';
import { FONT_BRUSH, makeCanvas } from '../core/textures';
import { fbm2, mulberry32 } from '../core/util';
import { PT } from '../game/rules';

/** Radius of the textured top face (the lathe body covers R → RF as a flat lacquered rim). */
export const RF = 0.345;
const DOME = 0.014;

/** Ma Shan Zheng has no 傌 / 俥, so Red's horse & chariot discs use 馬 / 車 (colour tells them apart). */
const CHARS: Record<number, [string, string]> = {
  // type: [red, black]
  [PT.General]: ['帥', '將'],
  [PT.Advisor]: ['仕', '士'],
  [PT.Elephant]: ['相', '象'],
  [PT.Horse]: ['馬', '馬'],
  [PT.Chariot]: ['車', '車'],
  [PT.Cannon]: ['炮', '砲'],
  [PT.Soldier]: ['兵', '卒'],
};
export const discChar = (type: number, side: 0 | 1) => CHARS[type][side];
export const ALL_DISC_CHARS = Object.values(CHARS).flat().join('');

export interface FaceTextures {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

const texCache = new Map<string, FaceTextures>();
/** vertical shift of the carved character on its face: −1 toward the face's canvas-top, +1 toward its bottom, 0 centred */
export type Shift = -1 | 0 | 1;
let TEX_SIZE = 1024;
export function setDiscTextureSize(px: number) {
  TEX_SIZE = px;
}

function faceTextures(type: number, side: 0 | 1, shift: Shift): FaceTextures {
  const key = `${type}:${side}:${shift}:${TEX_SIZE}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = TEX_SIZE;
  const C = S / 2;
  const ch = CHARS[type][side];
  const red = side === 0;

  const col = makeCanvas(S);
  const bmp = makeCanvas(S);
  const emi = makeCanvas(S >> 1);
  const g = col.g;

  /* lacquer rim band (outer part of the face) */
  g.fillStyle = red ? '#7a1e14' : '#16171b';
  g.fillRect(0, 0, S, S);
  const rimGrad = g.createRadialGradient(C, C, S * 0.3, C, C, S * 0.5);
  rimGrad.addColorStop(0, red ? 'rgba(160,50,34,0.0)' : 'rgba(60,64,80,0.0)');
  rimGrad.addColorStop(1, red ? 'rgba(20,4,2,0.55)' : 'rgba(0,0,0,0.5)');
  g.fillStyle = rimGrad;
  g.fillRect(0, 0, S, S);

  /* boxwood inner field with faint grain */
  const fieldR = S * 0.395;
  g.save();
  g.beginPath();
  g.arc(C, C, fieldR, 0, Math.PI * 2);
  g.clip();
  const fg = g.createRadialGradient(C - S * 0.08, C - S * 0.1, S * 0.05, C, C, fieldR);
  if (red) { fg.addColorStop(0, '#dcc08a'); fg.addColorStop(1, '#b8935a'); } else { fg.addColorStop(0, '#cfc3a6'); fg.addColorStop(1, '#a89a7c'); }
  g.fillStyle = fg;
  g.fillRect(0, 0, S, S);
  const rnd = mulberry32(type * 17 + side * 5 + 3);
  for (let i = 0; i < 90; i++) {
    const y = rnd() * S;
    g.strokeStyle = `rgba(70,44,18,${0.04 + rnd() * 0.06})`;
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath();
    for (let x = 0; x <= S; x += 24) {
      const yy = y + Math.sin(x * 0.012 + i) * 3 + fbm2(x * 0.004, i * 0.3, 2) * 12;
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  g.restore();
  // field edge: engraved line
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.lineWidth = S * 0.007;
  g.beginPath(); g.arc(C, C, fieldR, 0, Math.PI * 2); g.stroke();

  /* inlaid ring (gold for Red, silver-bronze for Black) */
  const ringR = S * 0.452, ringW = S * 0.012;
  const ringCol = red ? '#c9a24a' : '#9aa0a6';
  g.strokeStyle = ringCol;
  g.lineWidth = ringW;
  g.beginPath(); g.arc(C, C, ringR, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = red ? 'rgba(255,236,170,0.5)' : 'rgba(255,255,255,0.35)';
  g.lineWidth = ringW * 0.35;
  g.beginPath(); g.arc(C, C, ringR - ringW * 0.25, 0, Math.PI * 2); g.stroke();

  /* carved character */
  const size = S * 0.58;
  const cy = C + shift * S * 0.07; // away from the statue, which stands on the other half of the disc
  const draw = (gg: CanvasRenderingContext2D, dx: number, dy: number, style: string, stroke = 0) => {
    gg.font = `${size}px ${FONT_BRUSH}`;
    gg.textAlign = 'center';
    gg.textBaseline = 'middle';
    gg.fillStyle = style;
    if (stroke) { gg.strokeStyle = style; gg.lineWidth = stroke; gg.lineJoin = 'round'; gg.strokeText(ch, C + dx, cy + dy); }
    gg.fillText(ch, C + dx, cy + dy);
  };
  const fill = red ? '#b3261e' : '#121212';
  draw(g, S * 0.004, S * 0.005, red ? 'rgba(255,225,190,0.35)' : 'rgba(255,255,255,0.28)', S * 0.006); // lit lower-right lip
  draw(g, -S * 0.004, -S * 0.005, 'rgba(20,8,2,0.75)', S * 0.006);                                          // shadowed upper-left wall
  draw(g, 0, 0, fill, S * 0.004);
  // darker core for depth
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.restore();

  /* bump: groove depth, soft bevel */
  const b = bmp.g;
  b.fillStyle = '#b4b4b4';
  b.fillRect(0, 0, S, S);
  // field plate sits slightly lower than the rim
  b.fillStyle = '#a2a2a2';
  b.beginPath(); b.arc(C, C, fieldR, 0, Math.PI * 2); b.fill();
  // inlay ring raised
  b.strokeStyle = '#d0d0d0'; b.lineWidth = ringW * 1.4;
  b.beginPath(); b.arc(C, C, ringR, 0, Math.PI * 2); b.stroke();
  for (let i = 8; i >= 0; i--) {
    const v = Math.round(110 - (8 - i) * 9); // deeper toward the centre of each stroke
    draw(b, 0, 0, `rgb(${v},${v},${v})`, i * S * 0.0026);
  }
  draw(b, 0, 0, '#3a3a3a', 0);

  /* emissive: only the inlaid ring */
  const e = emi.g;
  const k = emi.c.width / S;
  e.fillStyle = '#000'; e.fillRect(0, 0, emi.c.width, emi.c.height);
  e.strokeStyle = red ? '#ffb347' : '#6f7882';
  e.lineWidth = ringW * k;
  e.beginPath(); e.arc(C * k, C * k, ringR * k, 0, Math.PI * 2); e.stroke();

  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const out = { map: mk(col.c, true), bump: mk(bmp.c, false), emissive: mk(emi.c, true) };
  texCache.set(key, out);
  return out;
}

/* ───────────────────────────── geometry ───────────────────────────── */

/** lathe profile: bevelled underside, vertical flank, rounded top shoulder, flat rim ring up to the face. */
function profile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const rb = 0.034, rt = 0.052;
  pts.push(new THREE.Vector2(0.0001, 0));
  pts.push(new THREE.Vector2(DISC_R - rb, 0));
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(DISC_R - rb + Math.sin(a) * rb, rb - Math.cos(a) * rb));
  }
  pts.push(new THREE.Vector2(DISC_R, DISC_H - rt));
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(DISC_R - rt + Math.cos(a) * rt, DISC_H - rt + Math.sin(a) * rt));
  }
  pts.push(new THREE.Vector2(RF + 0.006, DISC_H));
  // tiny step down into the face (the face sits flush at RF)
  pts.push(new THREE.Vector2(RF, DISC_H));
  return pts;
}

function faceGeometry(thetaStart = 0, thetaLength = Math.PI * 2): THREE.BufferGeometry {
  const rings = 14, segs = Math.max(8, Math.round(56 * (thetaLength / (Math.PI * 2))));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  pos.push(0, DISC_H + DOME, 0);
  uv.push(0.5, 0.5);
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * RF;
    const y = DISC_H + DOME * (1 - (rr / RF) * (rr / RF));
    for (let s = 0; s <= segs; s++) {
      const th = thetaStart + (s / segs) * thetaLength;
      const x = Math.sin(th) * rr, z = Math.cos(th) * rr;
      pos.push(x, y, z);
      uv.push(0.5 + x / (2 * RF), 0.5 - z / (2 * RF));
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + s + 1);
  for (let r = 1; r < rings; r++) {
    const a = 1 + (r - 1) * (segs + 1);
    const b = 1 + r * (segs + 1);
    for (let s = 0; s < segs; s++) {
      idx.push(a + s, b + s, a + s + 1);
      idx.push(a + s + 1, b + s, b + s + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let G: { body: THREE.BufferGeometry; face: THREE.BufferGeometry; bodyA: THREE.BufferGeometry; bodyB: THREE.BufferGeometry; faceA: THREE.BufferGeometry; faceB: THREE.BufferGeometry; cutA: THREE.BufferGeometry; cutB: THREE.BufferGeometry } | null = null;
function geometries() {
  if (G) return G;
  const p = profile();
  const cutShape = new THREE.Shape();
  // cross-section (z, y) of the disc: mirror the profile
  const prof = p.map((v) => [v.x, v.y] as [number, number]);
  cutShape.moveTo(-prof[1][0], 0);
  for (const [r, y] of prof.slice(1)) cutShape.lineTo(r, y);
  const topY = DISC_H + DOME * 0; // face is dome-high in the middle; keep section at rim height
  cutShape.lineTo(RF, topY);
  cutShape.lineTo(-RF, topY);
  for (const [r, y] of [...prof].reverse().slice(0, -1)) cutShape.lineTo(-r, y);
  const mkCut = (sign: number) => {
    const g = new THREE.ShapeGeometry(cutShape);
    g.rotateY(sign * (-Math.PI / 2));
    return g;
  };
  G = {
    body: new THREE.LatheGeometry(p, 64),
    face: faceGeometry(),
    bodyA: new THREE.LatheGeometry(p, 40, 0, Math.PI),
    bodyB: new THREE.LatheGeometry(p, 40, Math.PI, Math.PI),
    faceA: faceGeometry(0, Math.PI),
    faceB: faceGeometry(Math.PI, Math.PI),
    cutA: mkCut(1),
    cutB: mkCut(-1),
  };
  return G;
}

/* ───────────────────────────── materials ───────────────────────────── */

const bodyMats: THREE.MeshPhysicalMaterial[] = [];
export function lacquerBody(side: 0 | 1): THREE.MeshPhysicalMaterial {
  if (!bodyMats[side]) {
    bodyMats[side] = new THREE.MeshPhysicalMaterial(
      side === 0
        ? { color: COLORS.lacquerRed, roughness: 0.32, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.24 }
        : { color: COLORS.lacquerBlack, roughness: 0.28, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.22 },
    );
  }
  return bodyMats[side];
}

const faceMats = new Map<string, THREE.MeshPhysicalMaterial>();
export function faceKey(type: number, side: 0 | 1, shift: Shift): string {
  return `${type}:${side}:${shift}:${TEX_SIZE}`;
}
export function faceMaterial(type: number, side: 0 | 1, shift: Shift = 0): THREE.MeshPhysicalMaterial {
  const key = faceKey(type, side, shift);
  let m = faceMats.get(key);
  if (!m) {
    const t = faceTextures(type, side, shift);
    m = new THREE.MeshPhysicalMaterial({
      map: t.map, bumpMap: t.bump, bumpScale: 2.2, emissiveMap: t.emissive,
      emissive: new THREE.Color(0xffffff), emissiveIntensity: side === 0 ? 0.55 : 0.22,
      roughness: side === 0 ? 0.36 : 0.32, metalness: 0.04, clearcoat: 0.6, clearcoatRoughness: 0.24,
    });
    faceMats.set(key, m);
  }
  return m;
}

const cutMat = new THREE.MeshStandardMaterial({ color: 0xb08b58, roughness: 0.7, side: THREE.DoubleSide });

/* ───────────────────────────── Disc factory ───────────────────────────── */

export interface Disc {
  /** whole disc group, origin at the bottom centre */
  root: THREE.Group;
  /** the part that carries the character (rotated so text reads upright for the viewer) */
  face: THREE.Group;
  /** the textured top mesh (its material is swapped when the character shift changes) */
  top: THREE.Mesh;
}

export function createDisc(type: number, side: 0 | 1, shift: Shift = 0): Disc {
  const g = geometries();
  const root = new THREE.Group();
  const face = new THREE.Group();
  const body = new THREE.Mesh(g.body, lacquerBody(side));
  body.castShadow = true;
  body.receiveShadow = true;
  const top = new THREE.Mesh(g.face, faceMaterial(type, side, shift));
  top.receiveShadow = true;
  face.add(top);
  root.add(body, face);
  return { root, face, top };
}

/** Two half-discs for the "disc splits in two" capture beat. Origin at the bottom centre. */
export function createDiscHalves(type: number, side: 0 | 1): THREE.Group[] {
  const g = geometries();
  const make = (body: THREE.BufferGeometry, face: THREE.BufferGeometry, cut: THREE.BufferGeometry) => {
    const grp = new THREE.Group();
    const b = new THREE.Mesh(body, lacquerBody(side));
    b.castShadow = true;
    const f = new THREE.Mesh(face, faceMaterial(type, side));
    const c = new THREE.Mesh(cut, cutMat);
    grp.add(b, f, c);
    return grp;
  };
  return [make(g.bodyA, g.faceA, g.cutA), make(g.bodyB, g.faceB, g.cutB)];
}

/** free face textures that no piece uses any more (after a re-skin: side flip, classic toggle…) */
export function pruneFaceCache(inUse: Set<string>): void {
  for (const [k, m] of faceMats) {
    if (inUse.has(k)) continue;
    m.dispose();
    faceMats.delete(k);
  }
  for (const [k, t] of texCache) {
    if (inUse.has(k)) continue;
    t.map.dispose(); t.bump.dispose(); t.emissive.dispose();
    texCache.delete(k);
  }
}

/** Dispose cached GPU resources (used when texture resolution changes). */
export function resetDiscCaches() {
  for (const t of texCache.values()) { t.map.dispose(); t.bump.dispose(); t.emissive.dispose(); }
  texCache.clear();
  for (const m of faceMats.values()) m.dispose();
  faceMats.clear();
}
