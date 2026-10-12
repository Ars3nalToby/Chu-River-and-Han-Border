import * as THREE from 'three';
import { COLORS, GROUND_Y } from '../core/constants';
import { createDisc } from '../pieces/disc';
import type { Scheduler } from '../core/tween';
import { easeOutCubic, fbm2, noise2 } from '../core/util';
import { makeCanvas } from '../core/textures';

const TRAY_X = 6.95;
const SLOTS_PER_COL = 8;
const SPACING = 0.56;

/** carved circular recesses where the captured replicas rest */
function slotTexture(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 256, H = 1536;
  const col = makeCanvas(W, H), bmp = makeCanvas(W, H);
  const img = col.g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = fbm2(x * 0.02, y * 0.02, 4) * 0.7 + noise2(x * 0.5, y * 0.5) * 0.3;
    const v = 34 + n * 30;
    const i = (y * W + x) * 4;
    img.data[i] = v * 0.97; img.data[i + 1] = v; img.data[i + 2] = v * 1.05; img.data[i + 3] = 255;
  }
  col.g.putImageData(img, 0, 0);
  bmp.g.fillStyle = '#a0a0a0'; bmp.g.fillRect(0, 0, W, H);
  // 2 columns × 8 rows, mapped to the same slot grid as slotPos()
  for (let c = 0; c < 2; c++) for (let r = 0; r < 14; r++) {
    const cx = W * (c === 0 ? 0.5 - 0.3 / 1.4 : 0.5 + 0.3 / 1.4);
    const cy = H * ((3.7 - r * SPACING + 4.3) / 8.6);
    const rad = (0.255 / 1.4) * W;
    col.g.fillStyle = 'rgba(4,5,7,0.55)'; col.g.beginPath(); col.g.arc(cx, cy, rad, 0, Math.PI * 2); col.g.fill();
    col.g.strokeStyle = 'rgba(201,162,74,0.55)'; col.g.lineWidth = 3; col.g.beginPath(); col.g.arc(cx, cy, rad + 4, 0, Math.PI * 2); col.g.stroke();
    bmp.g.fillStyle = '#505050'; bmp.g.beginPath(); bmp.g.arc(cx, cy, rad, 0, Math.PI * 2); bmp.g.fill();
  }
  const mk = (cv: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: mk(col.c, true), bump: mk(bmp.c, false) };
}

/** Stone trays beside the board holding small replica discs of captured pieces. */
export class Trays {
  readonly group = new THREE.Group();
  /** replicas by tray: index 0 = Red's trophies (black pieces, left), 1 = Black's trophies (red pieces, right) */
  private slots: THREE.Group[][] = [[], []];

  constructor(private sched: Scheduler) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.85, metalness: 0.05 });
    const trim = new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.35, metalness: 0.85, emissive: COLORS.gold, emissiveIntensity: 0.15 });
    const topTex = slotTexture();
    const top = new THREE.MeshStandardMaterial({ map: topTex.map, bumpMap: topTex.bump, bumpScale: 2.0, roughness: 0.8, metalness: 0.05 });
    const h = -0.1 - GROUND_Y;
    for (const tray of [0, 1]) {
      const x = tray === 0 ? -TRAY_X : TRAY_X;
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 8.6), [stone, stone, top, stone, stone, stone]);
      base.position.set(x, GROUND_Y + h / 2, 0);
      base.castShadow = true;
      base.receiveShadow = true;
      this.group.add(base);
      for (const sz of [-1, 1]) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.03, 0.04), trim);
        rim.position.set(x, -0.1, sz * 4.28);
        this.group.add(rim);
      }
      for (const sx of [-1, 1]) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 8.6), trim);
        rim.position.set(x + sx * 0.69, -0.1, 0);
        this.group.add(rim);
      }
    }
  }

  private slotPos(tray: 0 | 1, i: number): THREE.Vector3 {
    const col = Math.floor(i / SLOTS_PER_COL), row = i % SLOTS_PER_COL;
    const x = (tray === 0 ? -TRAY_X : TRAY_X) + (col === 0 ? -0.3 : 0.3);
    // each captor's trophies start near its own end of the board
    const startZ = tray === 0 ? 3.7 : 3.7 - 13 * SPACING;
    const z = tray === 0 ? startZ - row * SPACING : startZ + row * SPACING;
    return new THREE.Vector3(x, -0.07, z);
  }

  /** drop a replica of the captured piece into the captor's tray */
  async add(captor: 0 | 1, type: number, capturedSide: 0 | 1, from?: THREE.Vector3): Promise<void> {
    const list = this.slots[captor];
    const d = createDisc(type, capturedSide);
    d.root.scale.setScalar(0.52);
    const target = this.slotPos(captor, list.length);
    d.root.position.copy(from ?? target.clone().add(new THREE.Vector3(0, 2.5, 0)));
    d.face.rotation.y = captor === 0 ? 0 : 0;
    d.root.rotation.y = (Math.random() - 0.5) * 0.5;
    this.group.add(d.root);
    list.push(d.root);
    const start = d.root.position.clone();
    await this.sched.tween(0.7, (u) => {
      const e = easeOutCubic(u);
      d.root.position.lerpVectors(start, target, e);
      d.root.position.y += Math.sin(u * Math.PI) * 1.2 * (1 - u * 0.3);
    });
  }

  clear(): void {
    for (const list of this.slots) {
      for (const g of list) g.removeFromParent();
      list.length = 0;
    }
  }

  /** rebuild instantly from a list of captured pieces (undo / replay) */
  setContents(captures: { captor: 0 | 1; type: number; side: 0 | 1 }[]): void {
    this.clear();
    for (const c of captures) {
      const list = this.slots[c.captor];
      const d = createDisc(c.type, c.side);
      d.root.scale.setScalar(0.52);
      d.root.position.copy(this.slotPos(c.captor, list.length));
      this.group.add(d.root);
      list.push(d.root);
    }
  }
}
