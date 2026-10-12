import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Scheduler } from '../core/tween';
import { clamp, easeInOutCubic, lerp } from '../core/util';

export type CamPreset = 'player' | 'overhead' | 'side' | 'battlefield';
export const CAM_PRESETS: CamPreset[] = ['player', 'overhead', 'side', 'battlefield'];

interface Shot { pos: THREE.Vector3; target: THREE.Vector3; fov: number }

/** Presets are authored for a Red player; flipping rotates them 180° about the board's centre. */
const BASE: Record<CamPreset, { pos: [number, number, number]; target: [number, number, number]; fov: number }> = {
  player:      { pos: [0, 3.5, 11.8],    target: [0, 0.95, -2.0],  fov: 40 },
  overhead:    { pos: [0, 17.2, 3.1],    target: [0, 0, 0.35],     fov: 34 },
  side:        { pos: [-11.2, 3.1, 1.4], target: [0, 0.3, -0.3],   fov: 38 },
  battlefield: { pos: [-14.0, 5.6, 16.5], target: [1.4, 2.6, -6.0], fov: 56 },
};

export class CameraRig {
  readonly controls: OrbitControls;
  private flipped = false;
  private preset: CamPreset = 'player';
  private busy = false;
  private shakeAmp = 0;
  private shakeT = 0;
  private shakeDur = 0;
  private shakeOff = new THREE.Vector3();
  private keys = new Set<string>();
  private saved: Shot | null = null;
  private baseFov = 38;
  /** set by the game; true while a scripted camera move should block user input */
  userLocked = false;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, private sched: Scheduler) {
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.minDistance = 3.2;
    c.maxDistance = 38;
    c.maxPolarAngle = Math.PI * 0.495;
    c.minPolarAngle = 0.04;
    c.screenSpacePanning = false;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.zoomSpeed = 0.8;
    this.controls = c;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    this.apply(this.shotFor('player'));
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if ('wasdrf'.includes(k) && k.length === 1) {
      if (down) this.keys.add(k); else this.keys.delete(k);
    }
    if (k === 'shift') {
      if (down) this.keys.add('shift'); else this.keys.delete('shift');
    }
  }

  private shotFor(p: CamPreset, aspect = this.camera.aspect): Shot {
    const b = BASE[p];
    const s = this.flipped ? -1 : 1;
    const target = new THREE.Vector3(b.target[0] * s, b.target[1], b.target[2] * s);
    const pos = new THREE.Vector3(b.pos[0] * s, b.pos[1], b.pos[2] * s);
    // narrow (portrait) screens: pull back so the 9×10 board still fits
    const k = aspect < 1.25 ? clamp(Math.pow(1.35 / aspect, 0.8), 1, 2.1) : 1;
    pos.sub(target).multiplyScalar(k).add(target);
    return { pos, target, fov: b.fov };
  }

  private apply(s: Shot) {
    this.camera.position.copy(s.pos);
    this.controls.target.copy(s.target);
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  get currentPreset(): CamPreset {
    return this.preset;
  }

  setFlipped(f: boolean, animate = true) {
    if (f === this.flipped) return;
    this.flipped = f;
    this.goPreset(this.preset, animate ? 1.2 : 0);
  }

  /** 1.2s easeInOutCubic transition to a preset, orbiting around the target so it never cuts through the board */
  async goPreset(p: CamPreset, duration = 1.2): Promise<void> {
    this.preset = p;
    await this.moveTo(this.shotFor(p), duration);
  }

  private currentShot(): Shot {
    return { pos: this.camera.position.clone().sub(this.shakeOff), target: this.controls.target.clone(), fov: this.camera.fov };
  }

  private async moveTo(to: Shot, duration: number): Promise<void> {
    if (duration <= 0) {
      this.apply(to);
      return;
    }
    const from = this.currentShot();
    const sFrom = new THREE.Spherical().setFromVector3(from.pos.clone().sub(from.target));
    const sTo = new THREE.Spherical().setFromVector3(to.pos.clone().sub(to.target));
    // shortest azimuth path
    let dTheta = sTo.theta - sFrom.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    this.busy = true;
    this.controls.enabled = false;
    const sp = new THREE.Spherical();
    const off = new THREE.Vector3();
    await this.sched.tween(duration, (u) => {
      sp.radius = lerp(sFrom.radius, sTo.radius, u);
      sp.phi = lerp(sFrom.phi, sTo.phi, u);
      sp.theta = sFrom.theta + dTheta * u;
      const tgt = from.target.clone().lerp(to.target, u);
      off.setFromSpherical(sp);
      this.camera.position.copy(tgt).add(off);
      this.controls.target.copy(tgt);
      this.camera.fov = lerp(from.fov, to.fov, u);
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(tgt);
    }, easeInOutCubic, true);
    this.busy = false;
    this.controls.enabled = true;
    this.controls.update();
  }

  /** cinematic capture framing: swing in on the exchange, hold, caller restores afterwards */
  async frameAction(a: THREE.Vector3, b: THREE.Vector3, duration = 0.9): Promise<void> {
    this.saved = this.currentShot();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = 0.55;
    const dir = b.clone().sub(a).setY(0);
    const len = Math.max(1, dir.length());
    dir.normalize();
    // camera on the side of the exchange, low and close
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if (side.dot(this.camera.position.clone().sub(mid)) < 0) side.negate();
    const pos = mid.clone().addScaledVector(side, 3.2 + len * 0.45).add(new THREE.Vector3(0, 1.9, 0));
    await this.moveTo({ pos, target: mid, fov: 36 }, duration);
  }

  async restoreAfterAction(duration = 0.9): Promise<void> {
    if (!this.saved) return;
    const s = this.saved;
    this.saved = null;
    await this.moveTo(s, duration);
  }

  shake(amp = 0.04, dur = 0.25): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = dur;
    this.shakeDur = dur;
  }

  update(rawDt: number): void {
    // remove last frame's shake before the controls read the camera
    this.camera.position.sub(this.shakeOff);
    this.shakeOff.set(0, 0, 0);

    if (this.keys.size && !this.busy) this.fly(rawDt);
    if (!this.busy) this.controls.update();

    if (this.shakeT > 0) {
      this.shakeT -= rawDt;
      const u = Math.max(0, this.shakeT / this.shakeDur);
      const a = this.shakeAmp * u * u;
      this.shakeOff.set((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a);
      if (this.shakeT <= 0) this.shakeAmp = 0;
      this.camera.position.add(this.shakeOff);
    }
  }

  private fly(dt: number) {
    const speed = (this.keys.has('shift') ? 14 : 6) * dt;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const mv = new THREE.Vector3();
    if (this.keys.has('w')) mv.add(fwd);
    if (this.keys.has('s')) mv.sub(fwd);
    if (this.keys.has('d')) mv.add(right);
    if (this.keys.has('a')) mv.sub(right);
    if (this.keys.has('r')) mv.y += 1;
    if (this.keys.has('f')) mv.y -= 1;
    if (mv.lengthSq() === 0) return;
    mv.normalize().multiplyScalar(speed);
    this.camera.position.add(mv);
    this.controls.target.add(mv);
    this.controls.target.y = Math.max(0, this.controls.target.y);
    this.camera.position.y = Math.max(0.35, this.camera.position.y);
  }

  /** call on resize so portrait/landscape framing adapts */
  onAspectChange(): void {
    if (!this.busy) {
      // keep the user's orbit but re-apply the preset framing only if they have not touched the camera
    }
  }
}
