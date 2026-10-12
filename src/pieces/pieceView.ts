import * as THREE from 'three';
import { DISC_H, sqWorld } from '../core/constants';
import { softDotTexture } from '../core/textures';
import { PT } from '../game/rules';
import { createDisc, Disc, faceKey, faceMaterial, Shift } from './disc';
import type { IAnimator } from './animator';
import type { WarriorRig } from './warrior';
import { createAnimator, createWarrior } from './provider';

export const DISC_TOP = DISC_H + 0.014;
const DISC_HIT_GEO = new THREE.CylinderGeometry(0.45, 0.45, 0.22, 16);
const BODY_HIT_GEO = new THREE.CylinderGeometry(0.22, 0.26, 1.15, 10);
const FACE_MAT = new THREE.MeshBasicMaterial({ visible: false });

let nextId = 1;

/** One piece on the board: lacquer disc + (optional) warrior statue + animation state. */
export class PieceView {
  readonly id = nextId++;
  readonly root = new THREE.Group();
  readonly disc: Disc;
  readonly rig: WarriorRig;
  readonly animator: IAnimator;
  /** invisible picking proxies: a flat disc and a slim body — what you see is what you pick */
  readonly hitDisc: THREE.Mesh;
  readonly hitBody: THREE.Mesh;
  sq: number;
  /** current warrior yaw (0 faces −Z, i.e. toward Black) */
  facing: number;
  readonly restFacing: number;
  private glowSprite?: THREE.Sprite;
  private glowT = 0;
  private lastPos = new THREE.Vector3();
  private wheelAngle = 0;
  classic = false;
  private yaw = 0;

  constructor(readonly type: PT, readonly side: 0 | 1, sq: number, phase = 0) {
    this.sq = sq;
    this.disc = createDisc(type, side);
    this.rig = createWarrior(type, side);
    this.restFacing = side === 0 ? 0 : Math.PI;
    this.facing = this.restFacing;
    this.rig.root.position.set(0, DISC_TOP, side === 0 ? this.rig.discOffsetZ : -this.rig.discOffsetZ);
    this.rig.root.rotation.y = this.facing;
    this.root.add(this.disc.root, this.rig.root);
    this.animator = createAnimator(this.rig, phase);
    this.hitDisc = new THREE.Mesh(DISC_HIT_GEO, FACE_MAT);
    this.hitDisc.position.y = 0.1;
    this.hitBody = new THREE.Mesh(BODY_HIT_GEO, FACE_MAT);
    this.hitBody.position.set(0, DISC_TOP + 0.58, side === 0 ? this.rig.discOffsetZ : -this.rig.discOffsetZ);
    this.hitDisc.userData.pieceId = this.hitBody.userData.pieceId = this.id;
    this.root.add(this.hitDisc, this.hitBody);
    sqWorld(sq, this.root.position);
    this.lastPos.copy(this.root.position);
  }

  setSquare(sq: number): void {
    this.sq = sq;
    sqWorld(sq, this.root.position);
    this.lastPos.copy(this.root.position);
  }

  setClassic(on: boolean): void {
    this.classic = on;
    this.rig.root.visible = !on;
    this.hitBody.visible = !on;
    this.refreshFace();
  }

  /** orient the carved character: 0 = upright for Red's seat, π = upright for Black's seat */
  setFaceYaw(yaw: number): void {
    this.yaw = yaw;
    this.disc.face.rotation.y = yaw;
    this.refreshFace();
  }

  /** the character sits on the half of the disc away from the statue (centred in Classic mode) */
  private faceShift(): Shift {
    if (this.classic) return 0;
    const zero = Math.abs(Math.sin(this.yaw)) < 0.5 && Math.cos(this.yaw) > 0;
    // statue stands at the owner's rear; canvas-top points to −Z when yaw = 0
    const statueAtCanvasBottom = this.side === 0 ? zero : !zero;
    return statueAtCanvasBottom ? -1 : 1;
  }
  /** objects to raycast against when picking this piece */
  get hitObjects(): THREE.Object3D[] {
    return this.classic ? [this.hitDisc] : [this.hitDisc, this.hitBody];
  }

  get faceKey(): string {
    return faceKey(this.type, this.side, this.faceShift());
  }
  private refreshFace(): void {
    this.disc.top.material = faceMaterial(this.type, this.side, this.faceShift());
  }

  setFacing(yaw: number): void {
    this.facing = yaw;
    this.rig.root.rotation.y = yaw;
  }

  /** yaw that makes the warrior face the world direction (dx,dz) */
  static yawToward(dx: number, dz: number): number {
    return Math.atan2(-dx, -dz);
  }

  /** briefly glow (the 炮架 screen piece, selections…) */
  glow(color: THREE.ColorRepresentation, dur = 0.7): void {
    if (!this.glowSprite) {
      this.glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      this.glowSprite.position.y = 0.55;
      this.glowSprite.scale.setScalar(1.7);
      this.glowSprite.renderOrder = 40;
      this.root.add(this.glowSprite);
    }
    (this.glowSprite.material as THREE.SpriteMaterial).color.set(color);
    this.glowT = dur;
    this.glowDur = dur;
    this.glowSprite.visible = true;
  }
  private glowDur = 1;

  update(dt: number): void {
    this.animator.update(dt);
    // roll wheels with the distance travelled along the warrior's heading
    if (this.rig.wheels.length) {
      const dx = this.root.position.x - this.lastPos.x, dz = this.root.position.z - this.lastPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-5) {
        const fx = -Math.sin(this.facing), fz = -Math.cos(this.facing);
        const dir = Math.sign(dx * fx + dz * fz) || 1;
        this.wheelAngle -= (dir * dist) / this.rig.wheelRadius;
        for (const w of this.rig.wheels) w.rotation.x = this.wheelAngle;
      }
    }
    this.lastPos.copy(this.root.position);
    if (this.glowSprite && this.glowT > 0) {
      this.glowT -= dt;
      const u = Math.max(0, this.glowT / this.glowDur);
      (this.glowSprite.material as THREE.SpriteMaterial).opacity = Math.sin(u * Math.PI) * 0.9;
      if (this.glowT <= 0) this.glowSprite.visible = false;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    const procedural = !this.rig.mixer; // GLB clones share geometry with their siblings
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Sprite).isSprite) {
        (m.material as THREE.Material).dispose();
      } else if (m.isMesh && procedural && this.rig.root.getObjectById(m.id)) {
        // procedural warrior geometry is built per piece; discs / materials are shared & cached
        m.geometry.dispose();
        const mat = m.material as THREE.Material;
        if (mat.userData.own) mat.dispose();
      }
    });
  }
}
