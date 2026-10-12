import * as THREE from 'three';
import { GROUND_Y } from '../core/constants';
import { createDiscHalves } from '../pieces/disc';
import type { PieceView } from '../pieces/pieceView';
import type { ParticleFx } from './particles';

const MAX_CHUNKS = 520;
const FLOOR_X = 5.7, FLOOR_Z = 6.2;
const floorY = (x: number, z: number) => (Math.abs(x) < FLOOR_X && Math.abs(z) < FLOOR_Z ? 0.0 : GROUND_Y);

interface Chunk {
  alive: boolean;
  p: THREE.Vector3; v: THREE.Vector3;
  q: THREE.Quaternion; axis: THREE.Vector3; spin: number;
  s: THREE.Vector3; r: number;
  age: number; life: number; fade: number;
}

interface Half {
  g: THREE.Group; v: THREE.Vector3; w: THREE.Vector3; age: number; bounced: number; resting: boolean;
}

/** Warrior → 20-40 terracotta/bronze chunks (one InstancedMesh); disc → two tumbling halves. */
export class ShatterFx {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private chunks: Chunk[] = [];
  private halves: Half[] = [];
  private head = 0;
  private m4 = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor(private fx: ParticleFx) {
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    // roughen: squash a few vertices so chunks are not perfect gems
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const k = 0.78 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.5;
      pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k, pa.getZ(i) * k);
    }
    geo.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.15, flatShading: true }), MAX_CHUNKS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX_CHUNKS;
    for (let i = 0; i < MAX_CHUNKS; i++) {
      this.chunks.push({
        alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0), spin: 0,
        s: new THREE.Vector3(), r: 0.05, age: 0, life: 1, fade: 1.5,
      });
      this.m4.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, this.col.set(0x000000));
    }
    this.group.add(this.mesh);
  }

  /** burst the statue into chunks. `dir` = horizontal direction of the blow (unit). */
  shatterWarrior(piece: PieceView, dir: THREE.Vector3, count = 34): void {
    const base = piece.root.position.clone();
    const red = piece.side === 0;
    const palette = red
      ? [0xa65a3c, 0x95543a, 0xb0663f, 0x7d4430, 0xb3261e, 0x8a4c32, 0xc9a24a]
      : [0x2e2a24, 0x3a342b, 0x26231e, 0x4a8f7f, 0x6d6a55, 0x1d1b17, 0x8d9a98];
    const off = new THREE.Vector3(0, 0, piece.side === 0 ? piece.rig.discOffsetZ : -piece.rig.discOffsetZ);
    for (let n = 0; n < count; n++) {
      const c = this.chunks[this.head];
      this.head = (this.head + 1) % MAX_CHUNKS;
      const h = 0.1 + Math.random() * piece.rig.height * 0.85;
      c.p.set(base.x + off.x + (Math.random() - 0.5) * 0.22, base.y + 0.18 + h, base.z + off.z + (Math.random() - 0.5) * 0.22);
      const out = new THREE.Vector3(c.p.x - (base.x + off.x), 0, c.p.z - (base.z + off.z)).normalize();
      const sp = 1.4 + Math.random() * 3.4;
      c.v.copy(out).multiplyScalar(sp * 0.7).addScaledVector(dir, sp * 0.9);
      c.v.y = 1.2 + Math.random() * 3.0 + h * 1.2;
      c.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      c.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      c.spin = (Math.random() - 0.5) * 22;
      const big = n < 4 ? 1.9 : 1;
      const sz = (0.05 + Math.random() * 0.075) * big;
      c.s.set(sz * (0.8 + Math.random() * 0.8), sz * (0.6 + Math.random() * 0.7), sz * (0.8 + Math.random() * 0.8));
      c.r = sz * 0.45;
      c.age = 0;
      c.life = 1.1 + Math.random() * 0.7;
      c.fade = 1.5;
      c.alive = true;
      this.mesh.setColorAt(this.chunkIndex(c), this.col.set(palette[Math.floor(Math.random() * palette.length)]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const mid = base.clone().add(off);
    mid.y += 0.4;
    this.fx.dust(mid.clone().setY(0.05), 14, 1.5);
    this.fx.sparks(mid, 14, 0.8);
  }

  private chunkIndex(c: Chunk) {
    return this.chunks.indexOf(c);
  }

  /** the lacquer disc cleaves in two and tumbles away */
  splitDisc(piece: PieceView, dir: THREE.Vector3): void {
    const halves = createDiscHalves(piece.type, piece.side);
    const yaw = piece.disc.face.rotation.y + Math.atan2(dir.x, dir.z) * 0.0; // keep the carved character upright
    halves.forEach((g, i) => {
      g.position.copy(piece.root.position);
      g.rotation.y = yaw;
      this.group.add(g);
      const sign = i === 0 ? 1 : -1;
      const sep = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(sign);
      const v = sep.multiplyScalar(1.1 + Math.random() * 0.8).addScaledVector(dir, 1.2 + Math.random() * 1.2);
      v.y = 2.6 + Math.random() * 1.4;
      const w = new THREE.Vector3((Math.random() - 0.3) * 9, (Math.random() - 0.5) * 4, sign * (3 + Math.random() * 5));
      this.halves.push({ g, v, w, age: 0, bounced: 0, resting: false });
    });
    piece.root.visible = false;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    let dirty = false;
    const g = -11;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (!c.alive) continue;
      dirty = true;
      c.age += dt;
      const fadeU = Math.max(0, (c.age - c.life) / c.fade);
      if (fadeU >= 1) {
        c.alive = false;
        this.m4.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m4);
        continue;
      }
      c.v.y += g * dt;
      c.p.addScaledVector(c.v, dt);
      const fl = floorY(c.p.x, c.p.z) + c.r;
      if (c.p.y < fl && c.v.y < 0) {
        c.p.y = fl;
        if (Math.abs(c.v.y) < 0.9) {
          c.v.y = 0;
          c.v.x *= 0.82; c.v.z *= 0.82;
          c.spin *= 0.7;
        } else {
          c.v.y *= -0.3; // restitution 0.3
          c.v.x *= 0.72; c.v.z *= 0.72;
          c.spin *= 0.6;
        }
      }
      const rot = new THREE.Quaternion().setFromAxisAngle(c.axis, c.spin * dt);
      c.q.premultiply(rot);
      const k = 1 - fadeU * fadeU;
      this.m4.compose(c.p, c.q, new THREE.Vector3(c.s.x * k, c.s.y * k, c.s.z * k));
      this.mesh.setMatrixAt(i, this.m4);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;

    for (let i = this.halves.length - 1; i >= 0; i--) {
      const h = this.halves[i];
      h.age += dt;
      if (!h.resting) {
        h.v.y += g * dt;
        h.g.position.addScaledVector(h.v, dt);
        h.g.rotation.x += h.w.x * dt;
        h.g.rotation.z += h.w.z * dt;
        h.g.rotation.y += h.w.y * dt;
        const fl = floorY(h.g.position.x, h.g.position.z) + 0.12;
        if (h.g.position.y < fl && h.v.y < 0) {
          h.g.position.y = fl;
          h.v.y *= -0.3;
          h.v.x *= 0.7; h.v.z *= 0.7;
          h.w.multiplyScalar(0.55);
          h.bounced++;
        }
      }
      if (h.age > 2.4) {
        const u = Math.min(1, (h.age - 2.4) / 0.6);
        h.g.scale.setScalar(1 - u * u);
        if (u >= 1) {
          h.g.removeFromParent();
          this.halves.splice(i, 1);
        }
      }
    }
  }

  clear(): void {
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].alive = false;
      this.m4.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const h of this.halves) h.g.removeFromParent();
    this.halves.length = 0;
  }
}
