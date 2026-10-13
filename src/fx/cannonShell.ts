import * as THREE from 'three';
import type { Scheduler } from '../core/tween';
import { softDotTexture } from '../core/textures';
import { easeOutCubic } from '../core/util';
import type { ParticleFx } from './particles';
import type { Lighting } from '../scene/lighting';

/** Glowing shell on a high parabola, muzzle flash, impact explosion. */
export class CannonFx {
  readonly group = new THREE.Group();
  private shell: THREE.Mesh;
  private shellGlow: THREE.Sprite;
  private flash: THREE.Sprite;
  private ring: THREE.Mesh;
  private flashT = 0;
  private ringT = 0;
  private muzzleT = 0;
  private muzzle: THREE.Sprite;

  constructor(private fx: ParticleFx, private sched: Scheduler, private lighting: Lighting) {
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 14, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.8), fog: false }),
    );
    this.shell.visible = false;
    this.shellGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDotTexture(), color: new THREE.Color(3, 1.3, 0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.shellGlow.scale.setScalar(0.9);
    this.shell.add(this.shellGlow);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDotTexture(), color: new THREE.Color(2.6, 1.5, 0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.flash.visible = false;
    this.muzzle = this.flash.clone();
    this.muzzle.material = (this.flash.material as THREE.SpriteMaterial).clone();
    this.muzzle.visible = false;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.group.add(this.shell, this.flash, this.muzzle, this.ring);
  }

  /** muzzle flash + smoke at world position `p` */
  fireFlash(p: THREE.Vector3, dir: THREE.Vector3): void {
    this.muzzle.position.copy(p);
    this.muzzle.visible = true;
    this.muzzleT = 0.18;
    this.lighting.flash(p, 40, 0.25);
    for (let i = 0; i < 12; i++) {
      const v = dir.clone().multiplyScalar(0.8 + Math.random() * 1.8).add(new THREE.Vector3((Math.random() - 0.5) * 0.7, Math.random() * 0.6, (Math.random() - 0.5) * 0.7));
      this.fx.smokeSys.emit(p, v, { life: 1.1 + Math.random() * 0.6, size: 0.15, sizeEnd: 0.8, color: 0x4a4a4e, colorEnd: 0x222328, alpha: 0.5, drag: 1.6, gravity: -0.15, spread: 0.1 });
    }
    this.fx.sparks(p, 16, 0.9);
  }

  /**
   * Fly the shell from `from` to `to` over a high arc that clears `screen` (the 炮架).
   * Resolves at impact. `onApex` fires roughly when the shell passes over the screen piece.
   */
  fly(from: THREE.Vector3, to: THREE.Vector3, screen: THREE.Vector3 | null, onOverScreen?: () => void): Promise<void> {
    const A = from.clone(), B = to.clone();
    const flat = Math.hypot(B.x - A.x, B.z - A.z);
    // choose arc height so the path is ≥ 2.0 above the board at the screen piece
    let h = Math.max(2.4, flat * 0.32);
    let ts = 0.5;
    if (screen) {
      const d = Math.hypot(screen.x - A.x, screen.z - A.z);
      ts = Math.min(0.95, Math.max(0.05, d / Math.max(0.001, flat)));
      for (let guard = 0; guard < 30; guard++) {
        const y = A.y + (B.y - A.y) * ts + 4 * h * ts * (1 - ts);
        if (y >= 2.1) break;
        h *= 1.15;
      }
    }
    const dur = 0.75 + flat * 0.11;
    this.shell.visible = true;
    let overFired = false;
    return this.sched.tween(dur, (u) => {
      const t = u;
      const x = A.x + (B.x - A.x) * t;
      const z = A.z + (B.z - A.z) * t;
      const y = A.y + (B.y - A.y) * t + 4 * h * t * (1 - t);
      this.shell.position.set(x, y, z);
      const pulse = 0.9 + Math.sin(u * 60) * 0.12;
      this.shellGlow.scale.setScalar(0.9 * pulse);
      this.fx.trail(this.shell.position, 0.14);
      if (!overFired && screen && t >= ts) {
        overFired = true;
        onOverScreen?.();
      }
    }).then(() => {
      this.shell.visible = false;
    });
  }

  /** big impact flash + shock ring + smoke + sparks */
  explode(p: THREE.Vector3): void {
    this.flash.position.copy(p).setY(p.y + 0.3);
    this.flash.visible = true;
    this.flashT = 0.4;
    this.ring.position.set(p.x, 0.04, p.z);
    this.ring.visible = true;
    this.ringT = 0.45;
    this.lighting.flash(p, 120, 0.35);
    this.fx.smoke(p.clone().setY(p.y + 0.3), 14, 1.3);
    this.fx.sparks(p.clone().setY(p.y + 0.4), 36, 1.4);
    this.fx.dust(p.clone().setY(0.05), 12, 2.4);
  }

  update(dt: number): void {
    if (this.flashT > 0) {
      this.flashT -= dt;
      const u = 1 - Math.max(0, this.flashT) / 0.4;
      this.flash.scale.setScalar(0.4 + easeOutCubic(u) * 2.2);
      (this.flash.material as THREE.SpriteMaterial).opacity = 1 - u;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      const u = 1 - Math.max(0, this.muzzleT) / 0.18;
      this.muzzle.scale.setScalar(0.3 + u * 1.4);
      (this.muzzle.material as THREE.SpriteMaterial).opacity = 1 - u;
      if (this.muzzleT <= 0) this.muzzle.visible = false;
    }
    if (this.ringT > 0) {
      this.ringT -= dt;
      const u = 1 - Math.max(0, this.ringT) / 0.45;
      this.ring.scale.setScalar(0.25 + easeOutCubic(u) * 1.7);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = (1 - u) * (1 - u) * 0.8;
      if (this.ringT <= 0) this.ring.visible = false;
    }
  }
}
