import * as THREE from 'three';
import type { Scheduler } from '../core/tween';
import type { Loop } from '../core/loop';
import type { Lighting } from '../scene/lighting';
import type { ParticleFx } from '../fx/particles';
import type { ShatterFx } from '../fx/shatter';
import type { CannonFx } from '../fx/cannonShell';
import type { Trays } from '../scene/trays';
import type { CameraRig } from '../camera/rig';
import type { Sfx } from '../audio/sfx';
import type { Settings } from '../ui/settings';
import { PieceView } from '../pieces/pieceView';
import { ATTACK_ANTICIPATION, ATTACK_STRIKE } from '../pieces/animator';
import { PT, fileOf, rankOf, Side } from './rules';
import { sqWorld, sqX, sqZ } from '../core/constants';
import { easeInCubic, easeInOutCubic, easeOutCubic, easeOutPow, easeInPow, easeInOutQuad, linear, Ease } from '../core/util';

export interface ChoreoCtx {
  sched: Scheduler;
  loop: Loop;
  lighting: Lighting;
  fx: ParticleFx;
  shatter: ShatterFx;
  cannon: CannonFx;
  trays: Trays;
  rig: CameraRig;
  sfx: Sfx;
  settings: () => Settings;
  baseTimeScale: () => number;
  /** the human's viewing side → which direction "up the board" is for effects */
  humanSide: () => Side;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Choreographer {
  constructor(private c: ChoreoCtx) {}

  /* ─────────────── helpers ─────────────── */

  private async turnTo(p: PieceView, yaw: number, dur = 0.2): Promise<void> {
    const from = p.facing;
    const d = wrapPi(yaw - from);
    if (Math.abs(d) < 0.01) return;
    await this.c.sched.tween(dur, (u) => p.setFacing(from + d * u), easeInOutQuad);
  }

  private hitStop(real = 0.25, scale = 0.35): void {
    this.c.loop.timeScale = scale;
    void this.c.sched.wait(real, true).then(() => (this.c.loop.timeScale = this.c.baseTimeScale()));
  }

  private posOf(sq: number): THREE.Vector3 {
    return sqWorld(sq, V());
  }

  /** waypoints for a move (world coords); horse: leg first, elephant: via the eye */
  private route(type: PT, from: number, to: number): THREE.Vector3[] {
    const A = this.posOf(from), B = this.posOf(to);
    const f0 = fileOf(from), r0 = rankOf(from), f1 = fileOf(to), r1 = rankOf(to);
    if (type === PT.Horse) {
      const df = f1 - f0, dr = r1 - r0;
      const leg = Math.abs(df) === 2 ? V(sqX(f0 + Math.sign(df)), 0, sqZ(r0)) : V(sqX(f0), 0, sqZ(r0 + Math.sign(dr)));
      return [A, leg, B];
    }
    if (type === PT.Elephant) return [A, V((A.x + B.x) / 2, 0, (A.z + B.z) / 2), B];
    return [A, B];
  }

  /** cut a route so it ends `gap` short of its final point (or ≥ minAdvance along the last leg) */
  private truncate(route: THREE.Vector3[], gap: number, minAdvance = 0.2): THREE.Vector3[] {
    const out = route.slice();
    const last = out[out.length - 1], prev = out[out.length - 2];
    const seg = last.clone().sub(prev);
    const len = seg.length();
    const adv = Math.max(minAdvance, len - gap);
    out[out.length - 1] = prev.clone().add(seg.normalize().multiplyScalar(Math.min(len, adv)));
    return out;
  }

  /**
   * march a piece along a route. Per-type character:
   * chariot — fast charge + streak; horse — leg then leap; elephant — heavy, two paced steps;
   * cannon — rolls; soldier — marching steps.
   */
  private async travel(p: PieceView, route: THREE.Vector3[], opts: { slideSound?: boolean; fraction?: number } = {}): Promise<void> {
    const { sched, sfx, fx } = this.c;
    const type = p.type;
    const segs: { a: THREE.Vector3; b: THREE.Vector3; len: number }[] = [];
    for (let i = 0; i < route.length - 1; i++) segs.push({ a: route[i], b: route[i + 1], len: route[i].distanceTo(route[i + 1]) });
    const total = segs.reduce((s, x) => s + x.len, 0);
    if (total < 1e-3) return;

    // yaw for the first segment, turn while starting to move
    const firstDir = segs[0].b.clone().sub(segs[0].a);
    const yaw0 = PieceView.yawToward(firstDir.x, firstDir.z);
    const turn = type === PT.Cannon ? 0.14 : 0.2;
    await this.turnTo(p, yaw0, turn);
    p.animator.play(type === PT.Cannon ? 'idle' : 'move');
    if (opts.slideSound !== false) sfx.woodSlide(0.4 + total * 0.08, 0.9);

    for (let i = 0; i < segs.length; i++) {
      const { a, b, len } = segs[i];
      const dir = b.clone().sub(a);
      if (i > 0) void this.turnTo(p, PieceView.yawToward(dir.x, dir.z), 0.12);
      let dur: number;
      let ease: Ease = easeInOutCubic;
      let leap = 0;
      switch (type) {
        case PT.Chariot: dur = 0.2 + 0.08 * len; ease = easeInOutCubic; break;
        case PT.Horse: dur = i === 0 ? 0.26 : 0.4; ease = i === 0 ? easeInCubic : easeOutCubic; leap = i === 1 ? 0.2 : 0; break;
        case PT.Elephant: dur = 0.62; ease = easeInOutCubic; break;
        case PT.Cannon: dur = 0.26 + 0.1 * len; break;
        case PT.Soldier: dur = 0.62; ease = easeInOutQuad; break;
        default: dur = 0.5; break;
      }
      let streakAcc = 0;
      let stepped = false;
      await sched.tween(dur, (u) => {
        p.root.position.lerpVectors(a, b, ease(u));
        if (leap) p.root.position.y = Math.sin(u * Math.PI) * leap;
        if (type === PT.Chariot) {
          streakAcc += 1;
          if (streakAcc % 2 === 0) fx.streak(p.root.position.clone().add(V(0, 0.22 + Math.random() * 0.4, 0)), 0.2);
        }
        if (type === PT.Soldier && !stepped && u > 0.5) {
          stepped = true;
          sfx.footstep(0.45);
        }
      });
      // footfall at the end of each segment
      if (type === PT.Elephant) {
        sfx.footstep(1.2);
        fx.dust(p.root.position.clone().setY(0.03), 7, 1.4);
        this.c.rig.shake(0.012, 0.15);
        if (i < segs.length - 1) await sched.wait(0.12);
      } else if (type === PT.Horse && i === 1) {
        sfx.footstep(0.8);
        sfx.footstep(0.5);
      } else if (type === PT.Soldier || type === PT.General || type === PT.Advisor) {
        sfx.footstep(0.7);
      }
    }
    p.root.position.y = 0;
  }

  /** landing settle + dust, return to idle, turn back toward the enemy */
  private async settle(p: PieceView, heavy = false): Promise<void> {
    const { sched, sfx, fx } = this.c;
    p.animator.play('idle', 0.18);
    sfx.woodClick(0.8);
    fx.dust(p.root.position.clone().setY(0.03), heavy ? 10 : 6, heavy ? 1.2 : 0.8);
    const y0 = p.root.position.y;
    void sched.tween(0.2, (u) => {
      p.root.position.y = y0 - Math.sin(u * Math.PI) * 0.018;
    });
    await this.turnTo(p, p.restFacing, 0.22);
  }

  /* ─────────────── move kinds ─────────────── */

  async normalMove(p: PieceView, from: number, to: number): Promise<void> {
    await this.travel(p, this.route(p.type, from, to));
    await this.settle(p, p.type === PT.Elephant);
  }

  /** impact beat shared by all melee/ranged captures */
  private impact(victim: PieceView, dir: THREE.Vector3, opts: { clang?: boolean; big?: boolean } = {}): void {
    const { sfx, lighting, rig, shatter, fx } = this.c;
    const pos = victim.root.position.clone();
    lighting.flash(pos, opts.big ? 90 : 55, 0.3);
    rig.shake(opts.big ? 0.08 : 0.04, 0.25);
    this.hitStop(0.25, 0.35);
    if (opts.clang !== false) sfx.bronzeClang(1, 0.9 + Math.random() * 0.3);
    sfx.terracottaShatter(1);
    fx.sparks(pos.clone().setY(0.7), 18, 1);
    shatter.shatterWarrior(victim, dir.clone().setY(0).normalize(), opts.big ? 40 : 32);
    shatter.splitDisc(victim, dir.clone().setY(0).normalize());
  }

  async meleeCapture(att: PieceView, victim: PieceView, from: number, to: number): Promise<void> {
    const { sched, rig, settings } = this.c;
    const A = this.posOf(from), B = this.posOf(to);
    const cin = settings().cinematic;
    const framing = cin ? rig.frameAction(A, B, 0.85) : Promise.resolve();

    // 1. attacker advances to just before the target
    const full = this.route(att.type, from, to);
    const approach = this.truncate(full, 0.82, 0.24);
    await this.travel(att, approach, { slideSound: true });
    const standing = att.root.position.clone();
    const toVictim = B.clone().sub(standing);
    await Promise.all([framing, this.turnTo(att, PieceView.yawToward(toVictim.x, toVictim.z), 0.18)]);

    // 2. attack: anticipation (0.25s) → strike (0.2s) → contact
    att.animator.play('attack', 0.1);
    await sched.wait(ATTACK_ANTICIPATION + ATTACK_STRIKE);
    // contact
    this.impact(victim, toVictim.clone().normalize());
    victim.dispose();

    // 3. attacker steps in
    await sched.wait(0.28);
    const stop = att.root.position.clone();
    const slide = this.c.sfx;
    slide.woodSlide(0.35, 0.8);
    await sched.tween(0.36, (u) => att.root.position.lerpVectors(stop, B, easeInOutCubic(u)));
    const restore = cin ? rig.restoreAfterAction(0.9) : Promise.resolve();
    await this.settle(att, att.type === PT.Elephant);
    await restore;
  }

  async cannonCapture(att: PieceView, victim: PieceView, from: number, to: number, screenSq: number, screen: PieceView | null): Promise<void> {
    const { sched, rig, sfx, cannon, settings, fx } = this.c;
    const A = this.posOf(from), B = this.posOf(to);
    const cin = settings().cinematic;
    const framing = cin ? rig.frameAction(A, B, 0.85) : Promise.resolve();
    const dir = B.clone().sub(A).setY(0).normalize();

    // 1. the cannon turns to bear on the target
    await Promise.all([framing, this.turnTo(att, PieceView.yawToward(dir.x, dir.z), 0.3)]);
    // 2. anticipation → fire (recoil at the start of the strike phase)
    att.animator.play('attack', 0.1);
    await sched.wait(ATTACK_ANTICIPATION);
    const muzzle = V();
    att.rig.muzzle?.getWorldPosition(muzzle);
    if (att.rig.muzzle && muzzle.lengthSq() < 1e-6) muzzle.copy(att.root.position).setY(0.5);
    sfx.cannonThump(1);
    rig.shake(0.03, 0.2);
    cannon.fireFlash(muzzle, dir);
    fx.dust(att.root.position.clone().setY(0.03), 8, 1.0);

    // 3. the shell arcs OVER the screen piece (炮架), which glows to show it
    const target = B.clone().setY(0.55);
    const screenPos = screen ? this.posOf(screenSq).setY(0.6) : null;
    const flight = Math.hypot(B.x - muzzle.x, B.z - muzzle.z) * 0.11 + 0.75;
    sfx.cannonWhistle(flight, 1);
    await cannon.fly(muzzle, target, screenPos, () => {
      screen?.glow(0xffd070, 0.8);
      sfx.pluck(587, 0.7);
    });

    // 4. impact
    sfx.explosion(1);
    cannon.explode(B.clone().setY(0.3));
    this.impact(victim, dir, { clang: false, big: true });
    victim.dispose();

    // 5. the cannon rolls up to the captured point
    await sched.wait(0.45);
    await this.travel(att, [att.root.position.clone(), B]);
    const restore = cin ? rig.restoreAfterAction(0.9) : Promise.resolve();
    await this.settle(att);
    await restore;
  }

  /** drop the captured replica into the captor's tray */
  async toTray(captor: Side, victimType: PT, victimSide: Side): Promise<void> {
    await this.c.trays.add(captor, victimType, victimSide);
  }

  /* ─────────────── game end ─────────────── */

  /** the losing general staggers, topples with a heavy ease, impacts with dust and two damped bounces */
  async fall(g: PieceView): Promise<void> {
    const { sched, sfx, fx, rig } = this.c;
    g.animator.enabled = false;
    const holder = g.rig.root;
    const sway = g.rig.sway;
    const base = g.rig.root.position.clone();
    // 1. stagger (~0.5s wobble that grows)
    sfx.bronzeClang(0.7, 0.7);
    await sched.tween(0.5, (u) => {
      const a = Math.sin(u * Math.PI * 5) * 0.16 * (0.4 + u * 0.6);
      sway.rotation.z = a;
      sway.rotation.x = -0.1 * u + Math.sin(u * 18) * 0.03;
    });
    // 2. topple (0.76s, power-2.25 ease): rotate about the plinth edge, forward (toward its facing)
    const startX = sway.rotation.x;
    const endX = -Math.PI / 2 + 0.03;
    const ease = easeInPow(2.25);
    let touched = false;
    await sched.tween(0.76, (u) => {
      const e = ease(u);
      sway.rotation.x = startX + (endX - startX) * e;
      sway.rotation.z *= 1 - u * 0.2;
      sway.position.y = Math.sin(e * Math.PI * 0.5) * 0.02;
      if (!touched && u > 0.97) {
        touched = true;
      }
    });
    // 3. impact + two damped bounces
    sfx.thud(1);
    sfx.terracottaShatter(0.5);
    rig.shake(0.07, 0.35);
    const tip = V(base.x, 0.1, base.z).add(g.root.position);
    fx.dust(tip.clone().setY(0.04), 20, 2.2);
    this.hitStop(0.2, 0.4);
    const rest = endX;
    for (const [amp, dur] of [[0.11, 0.2], [0.04, 0.16]] as [number, number][]) {
      await sched.tween(dur, (u) => {
        sway.rotation.x = rest + amp * Math.sin(u * Math.PI);
        sway.position.y = Math.sin(u * Math.PI) * amp * 0.5;
      }, linear);
      fx.dust(tip.clone().setY(0.04), 5, 1.0);
      sfx.footstep(amp > 0.08 ? 0.9 : 0.5);
    }
    sway.rotation.x = rest;
    void holder;
    void easeOutPow;
  }
}
