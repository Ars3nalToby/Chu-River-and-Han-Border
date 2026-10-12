import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PT } from '../game/rules';
import { Animator, ClipName, IAnimator } from './animator';
import { buildWarrior, WarriorRig } from './warrior';

/**
 * Warrior provider with two asset tracks, detected at runtime:
 *  Track A — if /models/{general,advisor,elephant,horse,chariot,cannon,soldier}.glb exist they are used
 *            (clips whose names contain "Idle" / "Move" / "Attack"; Red & Black share one GLB, only materials change).
 *  Track B — otherwise the procedural Qin-terracotta warriors from warrior.ts.
 */
const FILES: Record<number, string> = {
  [PT.General]: 'general', [PT.Advisor]: 'advisor', [PT.Elephant]: 'elephant', [PT.Horse]: 'horse',
  [PT.Chariot]: 'chariot', [PT.Cannon]: 'cannon', [PT.Soldier]: 'soldier',
};

const glbs = new Map<number, GLTF>();
export let trackA = false;

async function probe(name: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}models/${name}.glb`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // the dev server answers unknown paths with index.html — insist on the glTF magic number
    if (buf.byteLength < 12 || new DataView(buf).getUint32(0, true) !== 0x46546c67) return null;
    return buf;
  } catch {
    return null;
  }
}

export async function warriorProviderReady(): Promise<void> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader.setDRACOLoader(draco);
  await Promise.all(
    Object.entries(FILES).map(async ([type, name]) => {
      const buf = await probe(name);
      if (!buf) return;
      try {
        const gltf = await loader.parseAsync(buf, '');
        glbs.set(+type, gltf);
      } catch (e) {
        console.warn(`[models] ${name}.glb failed to parse — using the procedural warrior`, e);
      }
    }),
  );
  trackA = glbs.size > 0;
  if (trackA) console.info(`[models] Track A: using GLB statues for ${[...glbs.keys()].map((k) => FILES[k]).join(', ')}`);
  draco.dispose();
}

const SIDE_TINT = [
  { color: new THREE.Color(0xa65a3c), rough: 0.75, metal: 0.05 },
  { color: new THREE.Color(0x2e2a24), rough: 0.45, metal: 0.6 },
];

function glbRig(type: PT, side: 0 | 1, gltf: GLTF): WarriorRig {
  const model = SkeletonUtils.clone(gltf.scene) as THREE.Group;
  const tint = SIDE_TINT[side];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    const src = m.material as THREE.MeshStandardMaterial;
    const mat = (src.clone ? src.clone() : new THREE.MeshStandardMaterial()) as THREE.MeshStandardMaterial;
    mat.color.copy(tint.color);
    mat.roughness = tint.rough;
    mat.metalness = tint.metal;
    m.material = mat;
  });
  // normalise: stand on the plinth, ~1.25 tall (or ≤ 0.7 across)
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const k = Math.min(1.25 / Math.max(size.y, 1e-3), 0.7 / Math.max(size.x, size.z, 1e-3));
  model.scale.setScalar(k);
  const box2 = new THREE.Box3().setFromObject(model);
  const c = box2.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box2.min.y + 0.026, -c.z);

  const root = new THREE.Group();
  const sway = new THREE.Group();
  root.add(sway);
  sway.add(model);
  const rig: WarriorRig = {
    type, root, sway, wheels: [], wheelRadius: 0.15, discOffsetZ: 0.06, attackStyle: 'overhead', height: size.y * k,
  };
  let muzzle: THREE.Object3D | undefined;
  model.traverse((o) => {
    if (/muzzle/i.test(o.name)) muzzle = o;
  });
  if (type === PT.Cannon) {
    if (!muzzle) {
      muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.45, -0.5);
      sway.add(muzzle);
    }
    rig.muzzle = muzzle;
    rig.attackStyle = 'fire';
  }
  rig.mixer = new THREE.AnimationMixer(model);
  (rig as WarriorRig & { clips: THREE.AnimationClip[] }).clips = gltf.animations;
  return rig;
}

class GlbAnimator implements IAnimator {
  enabled = true;
  private actions: Partial<Record<ClipName, THREE.AnimationAction>> = {};
  private cur: ClipName = 'idle';

  constructor(private rig: WarriorRig, phase: number) {
    const clips = (rig as WarriorRig & { clips: THREE.AnimationClip[] }).clips ?? [];
    const find = (re: RegExp) => clips.find((c) => re.test(c.name));
    const map: [ClipName, RegExp][] = [['idle', /idle/i], ['move', /move|walk|run/i], ['attack', /attack|strike/i]];
    for (const [n, re] of map) {
      const clip = find(re);
      if (!clip) continue;
      const a = rig.mixer!.clipAction(clip);
      if (n === 'attack') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[n] = a;
    }
    const idle = this.actions.idle;
    if (idle) {
      idle.play();
      idle.time = phase;
    }
    // fallback: no clips at all → procedural idle sway keeps the statue alive
    if (!Object.keys(this.actions).length) this.cur = 'idle';
    rig.mixer!.addEventListener('finished', () => {
      if (this.cur === 'attack') this.play('idle', 0.18);
    });
  }

  get clipName(): ClipName {
    return this.cur;
  }

  play(clip: ClipName, fade = 0.18): void {
    if (clip === this.cur && clip !== 'attack') return;
    const next = this.actions[clip] ?? this.actions.idle;
    const prev = this.actions[this.cur];
    this.cur = clip;
    if (!next) return;
    next.reset().play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);
  }

  setMoveSpeed(s: number): void {
    const m = this.actions.move;
    if (m) m.timeScale = s;
  }

  update(dt: number): void {
    if (this.enabled) this.rig.mixer!.update(dt);
  }
}

export function createWarrior(type: PT, side: 0 | 1): WarriorRig {
  const g = glbs.get(type);
  return g ? glbRig(type, side, g) : buildWarrior(type, side);
}

export function createAnimator(rig: WarriorRig, phase: number): IAnimator {
  return rig.mixer ? new GlbAnimator(rig, phase) : new Animator(rig, phase);
}
