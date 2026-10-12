import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Gfx } from '../core/renderer';
import { FONT_BRUSH, makeCanvas } from '../core/textures';
import { fbm2, mulberry32, noise2 } from '../core/util';
import { COLORS, GROUND_Y, WATER_HALF, sqX, sqZ } from '../core/constants';
import { River } from './river';
import { getSharedEnv } from './lighting';

/* Layout (world units, top surface of the board = y 0) */
export const SLAB_X = 4.75; // half-width of the wooden slab
export const SLAB_Z = 5.25; // half-length of the wooden slab
export const FRAME_W = 0.9;
export const FRAME_X = SLAB_X + FRAME_W;
export const FRAME_Z = SLAB_Z + FRAME_W;
const BANK_OUT = 0.5; // banks run from WATER_HALF to this
const SLAB_BOTTOM = -0.3;

/* ───────────────────────────── textures ───────────────────────────── */

function woodTexture(): { map: THREE.CanvasTexture } {
  const W = 2048, H = 1024;
  const { c, g } = makeCanvas(W, H);
  const img = g.createImageData(W, H);
  const d = img.data;
  const base = [107, 74, 46];
  for (let y = 0; y < H; y++) {
    // plank seams
    const plank = Math.floor(y / 256);
    const seam = Math.abs((y % 256) - 1) < 2 ? 0.45 : 1;
    const plankTint = 0.94 + 0.12 * noise2(plank * 7.1, 3.3);
    for (let x = 0; x < W; x++) {
      const warp = fbm2(x * 0.0009, y * 0.004 + plank * 9, 3) * 22;
      const rings = 0.5 + 0.5 * Math.sin((y * 0.12 + warp) * 6.2831 * 0.25 * 4);
      const streak = noise2(x * 0.0035 + plank * 5, y * 0.45);
      const fine = noise2(x * 0.03, y * 1.4);
      let v = 0.88 + 0.09 * Math.pow(rings, 1.3) + (streak - 0.5) * 0.14 + (fine - 0.5) * 0.07;
      v *= plankTint * seam;
      const i = (y * W + x) * 4;
      d[i] = Math.min(255, base[0] * v);
      d[i + 1] = Math.min(255, base[1] * v);
      d[i + 2] = Math.min(255, base[2] * v);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // a couple of knots
  const rnd = mulberry32(31);
  for (let k = 0; k < 5; k++) {
    const x = rnd() * W, y = rnd() * H;
    for (let r = 26; r > 2; r -= 3) {
      g.strokeStyle = `rgba(40,24,12,${0.05 + (26 - r) * 0.012})`;
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(x, y, r * 2.6, r * 0.9, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return { map };
}

/** carved ruyi-cloud scroll, tileable along x. Returns colour + bump canvases. */
function cloudBorderTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 1024, H = 128, TILE = 256;
  const col = makeCanvas(W, H);
  const bmp = makeCanvas(W, H);
  // stone base
  const img = col.g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = fbm2((x / W) * 8, (y / H) * 2, 4) * 0.6 + noise2(x * 0.4, y * 0.4) * 0.4;
      const v = 38 + n * 34;
      const i = (y * W + x) * 4;
      img.data[i] = v * 0.98; img.data[i + 1] = v * 1.0; img.data[i + 2] = v * 1.06; img.data[i + 3] = 255;
    }
  col.g.putImageData(img, 0, 0);
  bmp.g.fillStyle = '#9a9a9a';
  bmp.g.fillRect(0, 0, W, H);

  const stroke = (draw: (g: CanvasRenderingContext2D) => void) => {
    // colour: dark groove + lit lower lip; bump: groove low
    col.g.lineCap = bmp.g.lineCap = 'round';
    col.g.lineJoin = bmp.g.lineJoin = 'round';
    col.g.save(); col.g.translate(1.5, 1.5); col.g.strokeStyle = 'rgba(120,130,150,0.28)'; col.g.lineWidth = 6; draw(col.g); col.g.stroke(); col.g.restore();
    col.g.strokeStyle = 'rgba(6,7,10,0.92)'; col.g.lineWidth = 6; draw(col.g); col.g.stroke();
    bmp.g.strokeStyle = '#1c1c1c'; bmp.g.lineWidth = 8; draw(bmp.g); bmp.g.stroke();
  };
  // 云雷纹: square-spiral "cloud-thunder" meander, alternately mirrored
  const meander = (g: CanvasRenderingContext2D, cx: number, cy: number, s: number, flip: number) => {
    g.beginPath();
    const P: [number, number][] = [
      [-1, 0.9], [-1, -1], [1, -1], [1, 0.9], [-0.42, 0.9], [-0.42, -0.42], [0.42, -0.42], [0.42, 0.34], [0.05, 0.34],
    ];
    P.forEach(([x, y], i) => {
      const X = cx + x * s * flip, Y = cy + y * s;
      if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
    });
  };
  for (let t = 0; t < W / TILE; t++) {
    const ox = t * TILE;
    stroke((g) => meander(g, ox + 64, 64, 36, 1));
    stroke((g) => meander(g, ox + 192, 64, 36, -1));
    // linking rule
    stroke((g) => { g.beginPath(); g.moveTo(ox + 102, 64 + 32); g.lineTo(ox + 154, 64 + 32); });
  }
  // border rules
  for (const y of [8, H - 8]) {
    stroke((g) => { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); });
  }
  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(col.c, true), bump: mk(bmp.c, false) };
}

/** carved calligraphy on a stone bank strip (world-scale drawing on an anisotropic canvas) */
function bankTexture(chars: string[], xs: number[], wide: number, deep: number): {
  map: THREE.CanvasTexture; bump: THREE.CanvasTexture; emissive: THREE.CanvasTexture;
} {
  const W = 4096, H = 256;
  const k = [makeCanvas(W, H), makeCanvas(W, H), makeCanvas(W, H)]; // colour, bump, emissive
  const sx = W / wide, sy = H / deep;
  // stone
  const img = k[0].g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = fbm2(x * 0.006, y * 0.02, 4) * 0.65 + noise2(x * 0.5, y * 0.5) * 0.35;
      const v = 46 + n * 38;
      const i = (y * W + x) * 4;
      img.data[i] = v * 0.97; img.data[i + 1] = v; img.data[i + 2] = v * 1.05; img.data[i + 3] = 255;
    }
  k[0].g.putImageData(img, 0, 0);
  k[1].g.fillStyle = '#a0a0a0'; k[1].g.fillRect(0, 0, W, H);
  k[2].g.fillStyle = '#000'; k[2].g.fillRect(0, 0, W, H);
  // wave lines in the unused stretches
  const waves = (g: CanvasRenderingContext2D, color: string, lw: number) => {
    g.strokeStyle = color; g.lineWidth = lw;
    for (let row = 0; row < 3; row++) {
      g.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = H * (0.25 + row * 0.25) + Math.sin(x * 0.02 + row * 1.7) * 7;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  };
  waves(k[0].g, 'rgba(8,9,12,0.5)', 3);
  waves(k[1].g, '#505050', 4);
  const glyph = 0.31; // world units (glyph height)
  for (let i = 0; i < chars.length; i++) {
    const cx = (xs[i] + wide / 2) * sx, cy = H / 2;
    for (const [idx, g] of k.map((v, j) => [j, v.g] as const)) {
      g.save();
      g.font = `${glyph * sy * 1.0}px ${FONT_BRUSH}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // glyphs are drawn square: compensate for the anisotropic canvas
      g.translate(cx, cy);
      g.scale(sx / sy, 1);
      if (idx === 0) {
        g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillText(chars[i], 2, 3);          // inner shadow
        g.fillStyle = '#16181c'; g.fillText(chars[i], 0, 0);                   // engraved
        g.fillStyle = 'rgba(201,162,74,0.72)'; g.fillText(chars[i], 0, 0);     // gold fill
      } else if (idx === 1) {
        g.fillStyle = '#101010'; g.fillText(chars[i], 0, 0);
      } else {
        g.fillStyle = '#c9a24a'; g.fillText(chars[i], 0, 0);
      }
      g.restore();
    }
  }
  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(k[0].c, true), bump: mk(k[1].c, false), emissive: mk(k[2].c, true) };
}

/* ───────────────────────────── geometry helpers ───────────────────────────── */

function lineBox(x0: number, z0: number, x1: number, z1: number, w: number, h: number): THREE.BufferGeometry {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = new THREE.BoxGeometry(len, h, w);
  g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
  g.translate((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
  return g;
}

/* ───────────────────────────── Board ───────────────────────────── */

export class Board {
  readonly group = new THREE.Group();
  readonly river: River;
  private checkGlow: THREE.Mesh[] = [];
  private glowTarget = [0, 0];
  private glowValue = [0, 0];
  private goldMat: THREE.MeshStandardMaterial;

  constructor(private gfx: Gfx) {
    const g = this.group;
    const stoneMat = new THREE.MeshStandardMaterial({ color: COLORS.stone, roughness: 0.82, metalness: 0.05 });
    const wood = woodTexture();

    /* wooden slab: two halves with the river channel between */
    const woodMat = new THREE.MeshPhysicalMaterial({
      map: wood.map, bumpMap: wood.map, bumpScale: 0.7, roughness: 0.7, metalness: 0.02, specularIntensity: 0.35,
      envMap: getSharedEnv(), envMapIntensity: 0.12,
    });
    const halfDepth = SLAB_Z - BANK_OUT;
    const makeHalf = (sign: 1 | -1) => {
      const geo = new THREE.BoxGeometry(SLAB_X * 2, 0.3, halfDepth);
      const m = new THREE.Mesh(geo, [stoneMat, stoneMat, woodMat, stoneMat, stoneMat, stoneMat]);
      m.position.set(0, -0.15, sign * (BANK_OUT + halfDepth / 2));
      m.castShadow = true;
      m.receiveShadow = true;
      // vary the grain between the halves
      if (sign < 0) {
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getX(i), 1 - uv.getY(i));
      }
      return m;
    };
    g.add(makeHalf(1), makeHalf(-1));

    /* stone banks + calligraphy: 楚河 on Black's bank, 漢界 on Red's bank */
    const bankW = SLAB_X * 2;
    const bankD = BANK_OUT - WATER_HALF;
    const makeBank = (sign: 1 | -1, chars: string[], xs: number[]) => {
      const t = bankTexture(chars, xs, bankW, bankD);
      const mat = new THREE.MeshStandardMaterial({
        map: t.map, bumpMap: t.bump, bumpScale: 1.6, emissiveMap: t.emissive, emissive: new THREE.Color(0xc9a24a), emissiveIntensity: 0.4,
        roughness: 0.78, metalness: 0.06,
      });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(bankW, 0.3, bankD), [stoneMat, stoneMat, mat, stoneMat, stoneMat, stoneMat]);
      slab.position.set(0, -0.15, sign * (WATER_HALF + bankD / 2));
      slab.receiveShadow = true;
      slab.castShadow = true;
      if (sign < 0) slab.rotation.y = 0; // text stays upright for Red's seat
      return slab;
    };
    // Red's bank is z>0; Black's bank z<0. Both read upright from Red's seat.
    g.add(makeBank(-1, ['楚', '河'], [-3.0, -1.7]));
    g.add(makeBank(1, ['漢', '界'], [1.7, 3.0]));

    /* channel bed + the water (River adds the animated surface) */
    const bed = new THREE.Mesh(new THREE.BoxGeometry(bankW, 0.18, WATER_HALF * 2), new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.9 }));
    bed.position.set(0, -0.21, 0);
    g.add(bed);
    this.river = new River(gfx, SLAB_X * 2);
    g.add(this.river.group);

    /* stepping-stone bridge at the centre */
    {
      const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.7, metalness: 0.05 });
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 6), bridgeMat);
        s.position.set(0, -0.05, (i - 1) * 0.22);
        s.rotation.y = i * 0.6;
        s.castShadow = true;
        s.receiveShadow = true;
        g.add(s);
      }
      // two lion posts at the bank edge
      for (const sx of [-0.6, 0.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.2, 8), bridgeMat);
        post.position.set(sx, 0.1, 0);
        post.castShadow = true;
        g.add(post);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), bridgeMat);
        cap.position.set(sx, 0.22, 0);
        g.add(cap);
      }
    }

    /* inlaid grid lines (raised ink) */
    {
      const geos: THREE.BufferGeometry[] = [];
      const lw = 0.038, lh = 0.016;
      const top = sqZ(0), bot = sqZ(9);
      // ranks
      for (let r = 0; r <= 9; r++) geos.push(lineBox(sqX(0) - lw / 2, sqZ(r), sqX(8) + lw / 2, sqZ(r), r === 0 || r === 9 ? lw * 1.9 : lw, lh));
      // files: outer files full height (to the banks), inner files broken at the river
      for (let f = 0; f <= 8; f++) {
        const w = f === 0 || f === 8 ? lw * 1.9 : lw;
        geos.push(lineBox(sqX(f), top, sqX(f), sqZ(4), w, lh));
        geos.push(lineBox(sqX(f), sqZ(5), sqX(f), bot, w, lh));
      }
      // outer double rule
      const m = 0.15;
      const ox0 = sqX(0) - m, ox1 = sqX(8) + m;
      geos.push(lineBox(ox0, top + m, ox1, top + m, 0.02, lh * 0.8));
      geos.push(lineBox(ox0, bot - m, ox1, bot - m, 0.02, lh * 0.8));
      geos.push(lineBox(ox0, top + m, ox0, BANK_OUT, 0.02, lh * 0.8));
      geos.push(lineBox(ox1, top + m, ox1, BANK_OUT, 0.02, lh * 0.8));
      geos.push(lineBox(ox0, bot - m, ox0, -BANK_OUT, 0.02, lh * 0.8));
      geos.push(lineBox(ox1, bot - m, ox1, -BANK_OUT, 0.02, lh * 0.8));
      // cross markers at soldier + cannon points
      const tick = (f: number, r: number) => {
        const cx = sqX(f), cz = sqZ(r);
        const gap = 0.07, len = 0.17;
        for (const sx of [-1, 1]) {
          if ((f === 0 && sx < 0) || (f === 8 && sx > 0)) continue;
          for (const sz of [-1, 1]) {
            geos.push(lineBox(cx + sx * gap, cz + sz * gap, cx + sx * (gap + len), cz + sz * gap, 0.03, lh));
            geos.push(lineBox(cx + sx * gap, cz + sz * gap, cx + sx * gap, cz + sz * (gap + len), 0.03, lh));
          }
        }
      };
      for (const f of [0, 2, 4, 6, 8]) { tick(f, 3); tick(f, 6); }
      for (const f of [1, 7]) { tick(f, 2); tick(f, 7); }
      const inkMat = new THREE.MeshStandardMaterial({ color: COLORS.inkLine, roughness: 0.45, metalness: 0.15 });
      const ink = new THREE.Mesh(mergeGeometries(geos)!, inkMat);
      ink.receiveShadow = true;
      g.add(ink);
      geos.forEach((x) => x.dispose());

      // gold palace diagonals (bloom-faint)
      const gold: THREE.BufferGeometry[] = [];
      for (const [r0, r1] of [[0, 2], [7, 9]]) {
        gold.push(lineBox(sqX(3), sqZ(r0), sqX(5), sqZ(r1), 0.03, 0.02));
        gold.push(lineBox(sqX(5), sqZ(r0), sqX(3), sqZ(r1), 0.03, 0.02));
      }
      this.goldMat = new THREE.MeshStandardMaterial({
        color: COLORS.gold, roughness: 0.3, metalness: 0.85, emissive: new THREE.Color(COLORS.gold), emissiveIntensity: 2.4,
      });
      g.add(new THREE.Mesh(mergeGeometries(gold)!, this.goldMat));
      gold.forEach((x) => x.dispose());
    }

    /* stone frame with carved cloud pattern */
    {
      const cloud = cloudBorderTextures();
      const FT = 0.07; // frame top height
      const mats = (rx: number) => {
        const m = cloud.map.clone(); m.repeat.set(rx, 1); m.needsUpdate = true;
        const b = cloud.bump.clone(); b.repeat.set(rx, 1); b.needsUpdate = true;
        return new THREE.MeshStandardMaterial({ map: m, bumpMap: b, bumpScale: 2.4, roughness: 0.82, metalness: 0.06 });
      };
      const side = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.88, metalness: 0.04 });
      const strip = (w: number, d: number, x: number, z: number, rep: number, rot: number) => {
        const geo = new THREE.BoxGeometry(w, FT + 0.3, d);
        const top = mats(rep);
        const mesh = new THREE.Mesh(geo, [side, side, top, side, side, side]);
        mesh.position.set(x, (FT - 0.3) / 2, z);
        if (rot) {
          // rotate texture orientation for the long sides: UV on +Y face runs along x, so turn it
          const uv = geo.attributes.uv;
          for (let i = 0; i < uv.count; i++) {
            // only the top face's UVs (indices 8..11 for BoxGeometry order px,nx,py,ny,pz,nz → py starts at 8)
            if (i >= 8 && i < 12) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); }
          }
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
      };
      const lenX = SLAB_X * 2, lenZ = SLAB_Z - BANK_OUT;
      // north/south strips along x
      g.add(strip(lenX, FRAME_W, 0, FRAME_Z - FRAME_W / 2, lenX / FRAME_W * 0.5, 0));
      g.add(strip(lenX, FRAME_W, 0, -(FRAME_Z - FRAME_W / 2), lenX / FRAME_W * 0.5, 0));
      // east/west strips along z, split by the river gate
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const s = strip(FRAME_W, lenZ, sx * (FRAME_X - FRAME_W / 2), sz * (BANK_OUT + lenZ / 2), lenZ / FRAME_W * 0.5, 1);
          g.add(s);
        }
        // river gate sill (low) — the water flows out over it
        const sill = new THREE.Mesh(new THREE.BoxGeometry(FRAME_W, 0.12, BANK_OUT * 2), side);
        sill.position.set(sx * (FRAME_X - FRAME_W / 2), -0.24, 0);
        g.add(sill);
      }
      // corner blocks: slightly taller, with a gold-studded cap
      const cornerMat = new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.7, metalness: 0.1 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const cb = new THREE.Mesh(new THREE.BoxGeometry(FRAME_W, FT + 0.3 + 0.1, FRAME_W), cornerMat);
        cb.position.set(sx * (FRAME_X - FRAME_W / 2), (FT + 0.1 - 0.3) / 2, sz * (FRAME_Z - FRAME_W / 2));
        cb.castShadow = true;
        cb.receiveShadow = true;
        g.add(cb);
        const boss = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({
          color: COLORS.gold, roughness: 0.32, metalness: 0.85, emissive: COLORS.gold, emissiveIntensity: 0.25,
        }));
        boss.position.set(cb.position.x, FT + 0.1, cb.position.z);
        g.add(boss);
      }
      // inner lip: thin dark rim hugging the slab
      const lip = new THREE.Mesh(new THREE.BoxGeometry(SLAB_X * 2 + 0.06, 0.02, SLAB_Z * 2 + 0.06), new THREE.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.9 }));
      lip.position.y = -0.015;
      lip.visible = false;
      g.add(lip);
    }

    /* plinth with a river tunnel; the board is a bridge */
    {
      const plinthMat = new THREE.MeshStandardMaterial({ color: 0x1f2126, roughness: 0.92, metalness: 0.03 });
      const H = -0.3 - GROUND_Y;
      const blockZ = FRAME_Z - 0.85;
      for (const sz of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(FRAME_X * 2 - 0.2, H, blockZ), plinthMat);
        b.position.set(0, GROUND_Y + H / 2 - 0.0, sz * (0.85 + blockZ / 2));
        b.castShadow = true;
        b.receiveShadow = true;
        g.add(b);
      }
      // stepped base courses
      const step = new THREE.Mesh(new THREE.BoxGeometry(FRAME_X * 2 + 0.7, 0.28, FRAME_Z * 2 + 0.7 - 1.7), plinthMat);
      step.visible = false;
      g.add(step);
      // tunnel lintel under the deck (so the deck reads as a slab spanning the water)
      const deck = new THREE.Mesh(new THREE.BoxGeometry(FRAME_X * 2 - 0.2, 0.25, 1.7), plinthMat);
      deck.position.set(0, -0.3 - 0.125 + 0.0, 0);
      deck.receiveShadow = true;
      g.add(deck);
    }

    /* palace check glow */
    {
      const mat = (side: number) => new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uI: { value: 0 }, uT: { value: 0 }, uC: { value: new THREE.Color(1.0, 0.12, 0.05) } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform float uI; uniform float uT; uniform vec3 uC;
          void main(){ vec2 p = vUv - 0.5; float d = max(abs(p.x), abs(p.y)) * 2.0;
            float a = smoothstep(1.05, 0.2, d) * (0.55 + 0.45 * sin(uT * 4.0)); a *= a;
            gl_FragColor = vec4(uC * a * uI * 1.4, a * uI); }`,
      });
      for (const rank of [1, 8]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), mat(rank));
        m.rotation.x = -Math.PI / 2;
        m.position.set(0, 0.02, sqZ(rank));
        m.renderOrder = 3;
        m.visible = false;
        g.add(m);
        this.checkGlow.push(m);
      }
    }
  }

  /** side 0 = Red palace (z>0), 1 = Black palace */
  setCheckGlow(side: 0 | 1, on: boolean) {
    this.glowTarget[side] = on ? 1 : 0;
  }

  update(dt: number, time: number) {
    this.river.update(dt, time);
    for (let i = 0; i < 2; i++) {
      this.glowValue[i] += (this.glowTarget[i] - this.glowValue[i]) * Math.min(1, dt * 5);
      const m = this.checkGlow[i];
      m.visible = this.glowValue[i] > 0.01;
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uI.value = this.glowValue[i];
      u.uT.value = time;
    }
  }
}
