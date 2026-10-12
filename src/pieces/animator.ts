import { PT } from '../game/rules';
import { clamp, easeInCubic, easeInOutCubic, easeOutCubic, lerp } from '../core/util';
import type { WarriorRig } from './warrior';

export type ClipName = 'idle' | 'move' | 'attack';

interface Pose {
  rise: number; bob: number; lean: number; sway: number; twist: number; squash: number; lunge: number;
  armR: number; tip: number; armL: number;
  headX: number; headY: number; cape: number;
  mountPitch: number; barrel: number; barrelPitch: number;
}

const POSE_KEYS = ['rise', 'bob', 'lean', 'sway', 'twist', 'squash', 'lunge', 'armR', 'tip', 'armL', 'headX', 'headY', 'cape', 'mountPitch', 'barrel', 'barrelPitch'] as const;
const blank = (): Pose => ({ rise: 0, bob: 0, lean: 0, sway: 0, twist: 0, squash: 0, lunge: 0, armR: 0, tip: 0, armL: 0, headX: 0, headY: 0, cape: 0, mountPitch: 0, barrel: 0, barrelPitch: 0 });
const lerpPose = (a: Pose, b: Pose, t: number, out: Pose): Pose => {
  for (const k of POSE_KEYS) out[k] = lerp(a[k], b[k], t);
  return out;
};

/** per-type resting arm pose. `tip` is the weapon's absolute angle (0 = vertical) */
function rest(type: PT): { armR: number; tip: number; armL: number } {
  switch (type) {
    case PT.General: return { armR: 0.5, tip: 0.0, armL: 0.55 };
    case PT.Advisor: return { armR: 0.28, tip: 0.0, armL: 0.15 };
    case PT.Soldier: return { armR: 0.22, tip: 0.0, armL: 0.55 };
    case PT.Horse: return { armR: 0.55, tip: -0.35, armL: 0.35 };
    case PT.Chariot: return { armR: 0.35, tip: -0.1, armL: 0.25 };
    case PT.Elephant: return { armR: 0.3, tip: 0.0, armL: 0.2 };
    default: return { armR: 0.5, tip: 0.0, armL: 0.2 };
  }
}

type Partial_ = Partial<Pose>;
interface AttackStyle { k1: Partial_; k2: Partial_ }
const STYLES: Record<WarriorRig['attackStyle'], AttackStyle> = {
  overhead: {
    k1: { armR: 2.5, tip: 0.8, lean: 0.2, twist: 0.25, armL: 0.9, cape: 0.25, headX: -0.15 },
    k2: { armR: 0.7, tip: -1.7, lean: -0.4, twist: -0.22, armL: 0.2, cape: -0.2, headX: 0.12, lunge: -0.04 },
  },
  thrust: {
    k1: { armR: 0.6, tip: -0.9, mountPitch: 0.4, lean: 0.12, rise: 0.04 },
    k2: { armR: 1.5, tip: -1.5, mountPitch: -0.06, lean: -0.22, lunge: -0.12 },
  },
  charge: {
    k1: { armR: 0.7, tip: -1.0, lean: 0.14, lunge: 0.07, mountPitch: 0.04 },
    k2: { armR: 1.5, tip: -1.5, lean: -0.2, lunge: -0.22, mountPitch: -0.03 },
  },
  fire: {
    k1: { armR: 2.1, tip: 0.4, barrel: -0.015, barrelPitch: 0.04 },
    k2: { armR: 0.5, tip: 0.0, barrel: 0.15, barrelPitch: -0.06, lean: 0.04 },
  },
  stomp: {
    k1: { mountPitch: 0.36, lean: 0.1, rise: 0.05, armR: 1.4, tip: 0.5 },
    k2: { mountPitch: -0.1, lean: -0.1, lunge: -0.08, armR: 0.5, tip: 0.0 },
  },
};

export const ATTACK_ANTICIPATION = 0.25;
export const ATTACK_STRIKE = 0.2;
const ATTACK_RECOVER = 0.4;
export const ATTACK_TOTAL = ATTACK_ANTICIPATION + ATTACK_STRIKE + ATTACK_RECOVER;

/**
 * Hand-authored procedural animation for a WarriorRig. Clips are evaluated to Poses and cross-faded
 * (default 0.18s) so state changes never pop.
 */
export interface IAnimator {
  enabled: boolean;
  readonly clipName: ClipName;
  play(clip: ClipName, fade?: number): void;
  setMoveSpeed(s: number): void;
  update(dt: number): void;
}

export class Animator implements IAnimator {
  enabled = true;
  private clip: ClipName = 'idle';
  private clipTime = 0;
  private time = 0;
  private from: Pose = blank();
  private cur: Pose = blank();
  private tmp: Pose = blank();
  private fade = 1;
  private fadeDur = 0.18;
  private base: ReturnType<typeof rest>;
  private moveSpeed = 1;

  constructor(private rig: WarriorRig, private phase: number) {
    this.base = rest(rig.type);
    this.time = phase;
    this.evaluate('idle', this.time, this.cur);
    this.from = { ...this.cur };
    this.apply(this.cur);
  }

  get clipName(): ClipName {
    return this.clip;
  }

  play(clip: ClipName, fade = 0.18): void {
    if (clip === this.clip && clip !== 'attack') return;
    // snapshot what is currently displayed as the "from" pose
    this.from = { ...this.cur };
    this.clip = clip;
    this.clipTime = 0;
    this.fade = 0;
    this.fadeDur = Math.max(1e-3, fade);
  }

  setMoveSpeed(s: number) {
    this.moveSpeed = s;
  }

  private evaluate(clip: ClipName, t: number, out: Pose): Pose {
    const b = this.base;
    const rig = this.rig;
    const p = Object.assign(out, blank());
    const mounted = !!rig.mount;
    // ---- idle (also the base of every other clip) ----
    const breath = Math.sin(t * 1.7);
    p.squash = 0.011 * breath;
    p.sway = 0.018 * Math.sin(t * 0.9 + 0.7);
    p.twist = 0.02 * Math.sin(t * 0.6);
    p.armR = b.armR + 0.03 * Math.sin(t * 1.3);
    p.tip = b.tip;
    p.armL = b.armL + 0.03 * Math.sin(t * 1.1 + 1);
    p.headY = 0.12 * Math.sin(t * 0.5);
    p.headX = 0.03 * Math.sin(t * 0.8);
    p.cape = 0.06 + 0.05 * Math.sin(t * 1.1);
    if (mounted) {
      p.mountPitch = 0.012 * Math.sin(t * 1.3);
      p.bob = 0.004 * Math.sin(t * 1.9);
    }
    if (clip === 'move') {
      const f = 1.9 * this.moveSpeed;
      const s = Math.sin(t * Math.PI * 2 * f);
      p.bob = (mounted ? 0.018 : 0.03) * Math.abs(s);
      p.lean = -0.1;
      p.sway = 0.03 * s;
      p.armR += 0.35 * s;
      p.tip -= 0.35 * s;
      p.armL -= 0.35 * s;
      p.cape = 0.35 + 0.1 * Math.sin(t * 9);
      p.squash = 0;
      if (mounted) p.mountPitch = -0.03 + 0.03 * s;
      if (rig.attackStyle === 'fire') p.barrelPitch = 0;
    } else if (clip === 'attack') {
      const st = STYLES[rig.attackStyle];
      const A = ATTACK_ANTICIPATION, S = ATTACK_STRIKE;
      const rest_: Pose = { ...p };
      const k1 = Object.assign({ ...rest_ }, st.k1);
      const k2 = Object.assign({ ...rest_ }, st.k2);
      if (t < A) lerpPose(rest_, k1, easeOutCubic(clamp(t / A)), p);
      else if (t < A + S) lerpPose(k1, k2, easeInCubic(clamp((t - A) / S)), p);
      else lerpPose(k2, rest_, easeInOutCubic(clamp((t - A - S) / ATTACK_RECOVER)), p);
    }
    return p;
  }

  update(dt: number): void {
    this.time += dt;
    this.clipTime += dt;
    // attack returns to idle on its own
    if (this.clip === 'attack' && this.clipTime >= ATTACK_TOTAL) this.play('idle', 0.12);
    const evalT = this.clip === 'attack' ? this.clipTime : this.time;
    const target = this.evaluate(this.clip, evalT, this.tmp);
    this.fade = Math.min(1, this.fade + dt / this.fadeDur);
    const w = this.fade * this.fade * (3 - 2 * this.fade);
    lerpPose(this.from, target, w, this.cur);
    if (this.enabled) this.apply(this.cur);
  }

  private apply(p: Pose): void {
    const r = this.rig;
    r.sway.position.set(0, p.rise + p.bob, p.lunge);
    r.sway.rotation.set(p.lean, p.twist, p.sway);
    r.sway.scale.set(1, 1 + p.squash, 1);
    if (r.armR) r.armR.rotation.x = p.armR;
    if (r.weaponR) r.weaponR.rotation.x = p.tip - p.armR;
    if (r.armL) r.armL.rotation.x = p.armL;
    if (r.head) r.head.rotation.set(p.headX, p.headY, 0);
    if (r.cape) r.cape.rotation.x = p.cape;
    if (r.mount) r.mount.rotation.x = p.mountPitch;
    if (r.barrel) { r.barrel.position.z = p.barrel; r.barrel.rotation.x = p.barrelPitch; }
  }
}
