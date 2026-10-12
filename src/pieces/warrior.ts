import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PT } from '../game/rules';
import { makeCanvas } from '../core/textures';
import { fbm2, noise2 } from '../core/util';

/**
 * Procedural stylised Qin-terracotta warriors (Track B).
 * Everything is built from primitives / lathes, merged per material slot, with named pivots
 * (arms, cape, wheels, barrel…) that the Animator drives.
 *
 * Local frame: origin = centre of the statue's plinth on top of the disc, +Y up, the warrior faces −Z.
 */

export interface WarriorRig {
  type: PT;
  root: THREE.Group;
  /** everything above the plinth — idle sway, bob and lean act on this */
  sway: THREE.Group;
  armR?: THREE.Group;
  weaponR?: THREE.Group;
  armL?: THREE.Group;
  head?: THREE.Group;
  cape?: THREE.Group;
  /** mount / vehicle body (horse, elephant, chariot, cannon carriage) for rear-ups and lunges */
  mount?: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  barrel?: THREE.Group;
  muzzle?: THREE.Object3D;
  trunk?: THREE.Group;
  /** how far toward the owner's back the figure stands on the disc */
  discOffsetZ: number;
  /** rough pose params the animator reads */
  attackStyle: 'overhead' | 'thrust' | 'fire' | 'charge' | 'stomp';
  /** world-space-ish height for effects (shatter origin etc.) */
  height: number;
  /** replaceable with GLB animation (Track A) */
  mixer?: THREE.AnimationMixer;
  dispose?: () => void;
}

type Slot = 'statue' | 'metal';
const c = (hex: number) => new THREE.Color(hex);

/* ──────────────────────────── palettes + materials ──────────────────────────── */

interface Palette {
  skin: THREE.Color; robe: THREE.Color; armor: THREE.Color; accent: THREE.Color; cloth: THREE.Color;
  hair: THREE.Color; horse: THREE.Color; wood: THREE.Color; stone: THREE.Color;
}
const PAL: Palette[] = [
  // Red — terracotta #A65A3C with vermilion armour accents
  {
    skin: c(0x9b7556), robe: c(0x94694c), armor: c(0x7a5840), accent: c(0x9a3326), cloth: c(0x66190f),
    hair: c(0x2a1c14), horse: c(0x8e5d40), wood: c(0x4c321e), stone: c(0x6a645c),
  },
  // Black — dark bronze #2E2A24 with verdigris hints
  {
    skin: c(0x3c372e), robe: c(0x2e2a24), armor: c(0x26231e), accent: c(0x4a8f7f), cloth: c(0x15171f),
    hair: c(0x101010), horse: c(0x2a2722), wood: c(0x241a12), stone: c(0x5b5f64),
  },
];

let grainTex: THREE.CanvasTexture | null = null;
/** fine mottled grain so terracotta / bronze breaks up the light instead of reading as smooth plastic */
function grainTexture(): THREE.CanvasTexture {
  if (grainTex) return grainTex;
  const S = 256;
  const { c, g } = makeCanvas(S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = 120 + fbm2(x * 0.05, y * 0.05, 4) * 90 + (noise2(x * 0.9, y * 0.9) - 0.5) * 70;
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v)); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTex = new THREE.CanvasTexture(c);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.repeat.set(1.3, 1.3);
  grainTex.anisotropy = 4;
  return grainTex;
}

const matCache: Record<string, THREE.Material> = {};
export function warriorMaterial(side: 0 | 1, slot: Slot): THREE.MeshStandardMaterial {
  const key = `${side}${slot}`;
  if (!matCache[key]) {
    if (slot === 'statue') {
      matCache[key] = new THREE.MeshStandardMaterial(
        side === 0
          ? { vertexColors: true, roughness: 0.9, metalness: 0.02, bumpMap: grainTexture(), bumpScale: 0.9 }
          : { vertexColors: true, roughness: 0.5, metalness: 0.55, bumpMap: grainTexture(), bumpScale: 0.7 },
      );
    } else {
      matCache[key] = new THREE.MeshStandardMaterial(
        side === 0
          ? { vertexColors: true, roughness: 0.38, metalness: 0.85 }
          : { vertexColors: true, roughness: 0.34, metalness: 0.85 },
      );
    }
  }
  return matCache[key] as THREE.MeshStandardMaterial;
}

/* ──────────────────────────── geometry builder ──────────────────────────── */

class Parts {
  private lists: Record<Slot, THREE.BufferGeometry[]> = { statue: [], metal: [] };
  /** translation applied to every part added while set (used to merge the head into the body mesh) */
  offset: [number, number, number] = [0, 0, 0];
  add(slot: Slot, geo: THREE.BufferGeometry, tint: THREE.Color, o: { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] } = {}): this {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r ?? [0, 0, 0])));
    const pp = o.p ?? [0, 0, 0];
    m.compose(new THREE.Vector3(pp[0] + this.offset[0], pp[1] + this.offset[1], pp[2] + this.offset[2]), q, new THREE.Vector3(...(o.s ?? [1, 1, 1])));
    const g = geo.index ? geo : geo; // all primitives used are indexed
    g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // faint vertical shading so the statues feel baked-AO'd (darker low, lighter high)
      const y = g.attributes.position.getY(i);
      const x = g.attributes.position.getX(i), z = g.attributes.position.getZ(i);
      // weathering: low-frequency grime + faint baked vertical AO
      const grime = 0.86 + 0.2 * (0.5 + 0.5 * Math.sin(x * 37.1 + y * 23.7) * Math.cos(z * 29.3 + y * 11.3));
      const k = (0.86 + Math.min(0.2, Math.max(-0.1, y * 0.1))) * grime;
      col[i * 3] = tint.r * k; col[i * 3 + 1] = tint.g * k; col[i * 3 + 2] = tint.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.lists[slot].push(g);
    return this;
  }
  mesh(side: 0 | 1, castShadow = true): THREE.Group {
    const grp = new THREE.Group();
    for (const slot of ['statue', 'metal'] as Slot[]) {
      const l = this.lists[slot];
      if (!l.length) continue;
      const geo = mergeGeometries(l, false)!;
      l.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(geo, warriorMaterial(side, slot));
      mesh.castShadow = castShadow;
      mesh.receiveShadow = false;
      grp.add(mesh);
    }
    return grp;
  }
}

const cyl = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sph = (r: number, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const lathe = (pts: [number, number][], seg = 16) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const torus = (r: number, t: number, ts = 8, rs = 18) => new THREE.TorusGeometry(r, t, ts, rs);

/** a limb segment from point a to point b */
function limb(parts: Parts, slot: Slot, tint: THREE.Color, a: [number, number, number], b: [number, number, number], r0: number, r1: number) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = cyl(r1, r0, len, 8);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  parts.add(slot, g, tint, { p: [mid.x, mid.y, mid.z], r: [e.x, e.y, e.z] });
}

/* ──────────────────────────── humanoid ──────────────────────────── */

type Headgear = 'topknot' | 'cap' | 'crest' | 'tablet' | 'helmet';
type Weapon = 'ge' | 'sword' | 'staff' | 'spear' | 'halberd' | 'none';

interface HumanoidOpts {
  headgear: Headgear;
  weapon: Weapon;
  shield?: boolean;
  cape?: boolean;
  legs?: boolean;      // draw legs/skirt (false for riders)
  twoHanded?: boolean; // sword held in front with both hands
  armored?: boolean;
}

interface Humanoid {
  group: THREE.Group;
  armR: THREE.Group;
  weaponR: THREE.Group;
  armL: THREE.Group;
  head: THREE.Group;
  cape?: THREE.Group;
  height: number;
}

function humanoid(side: 0 | 1, o: HumanoidOpts): Humanoid {
  const P = PAL[side];
  const g = new THREE.Group();

  /* static body */
  const st = new Parts();
  if (o.legs !== false) {
    // greaves + boots
    for (const sx of [-1, 1]) {
      st.add('statue', cyl(0.036, 0.046, 0.3, 9), P.robe, { p: [sx * 0.05, 0.17, 0] });
      st.add('statue', box(0.075, 0.04, 0.12), P.hair, { p: [sx * 0.05, 0.02, -0.02] });
      st.add('metal', cyl(0.04, 0.04, 0.05, 9), P.armor, { p: [sx * 0.05, 0.2, 0] });
    }
    // layered armour skirt: three overlapping flared lames
    for (let i = 0; i < 3; i++) {
      const y = 0.3 + i * 0.075;
      st.add('statue', cyl(0.11 - i * 0.004, 0.14 - i * 0.004, 0.09, 14), i % 2 ? P.armor : P.robe, { p: [0, y, 0] });
      st.add('statue', torus(0.14 - i * 0.004, 0.005, 5, 18), P.armor, { p: [0, y - 0.04, 0], r: [Math.PI / 2, 0, 0] });
    }
    // front apron
    st.add('statue', box(0.1, 0.21, 0.012), P.accent, { p: [0, 0.33, -0.132] });
  } else {
    // seated riders: simple thigh block
    st.add('statue', box(0.2, 0.08, 0.16), P.robe, { p: [0, 0.34, 0] });
  }
  const waistY = 0.5;
  // torso — barrel with broad shoulders
  const torso = lathe([[0.001, 0], [0.09, 0.0], [0.095, 0.06], [0.112, 0.17], [0.118, 0.27], [0.09, 0.33], [0.05, 0.36], [0.001, 0.37]], 18);
  st.add('statue', torso, P.robe, { p: [0, waistY, 0], s: [1.12, 1, 0.82] });
  // chest armour — stacked lames + central plate
  for (let i = 0; i < 4; i++) {
    st.add('statue', cyl(0.108 - i * 0.002, 0.118 - i * 0.002, 0.052, 16), i % 2 ? P.armor : P.robe, { p: [0, waistY + 0.04 + i * 0.058, 0], s: [1.12, 1, 0.82] });
  }
  st.add('metal', box(0.085, 0.17, 0.014), P.accent, { p: [0, waistY + 0.17, -0.098] });
  for (const k of [-1, 1]) st.add('metal', sph(0.011, 6, 5), c(0xc9a24a), { p: [k * 0.03, waistY + 0.22, -0.108] });
  // belt + buckle
  st.add('statue', torus(0.108, 0.012, 6, 20), P.accent, { p: [0, waistY, 0], r: [Math.PI / 2, 0, 0], s: [1.12, 0.82, 1] });
  st.add('metal', box(0.04, 0.035, 0.012), c(0xc9a24a), { p: [0, waistY, -0.096] });
  // shoulders: pauldrons
  for (const sx of [-1, 1]) {
    st.add('statue', sph(0.062, 12, 8), P.armor, { p: [sx * 0.135, waistY + 0.335, 0], s: [1.05, 0.62, 1] });
    st.add('statue', torus(0.058, 0.006, 5, 14), P.armor, { p: [sx * 0.135, waistY + 0.305, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.7] });
  }
  // neck + gorget
  st.add('statue', cyl(0.032, 0.038, 0.09, 10), P.skin, { p: [0, waistY + 0.4, 0] });
  st.add('statue', torus(0.048, 0.014, 6, 14), P.armor, { p: [0, waistY + 0.37, 0], r: [Math.PI / 2, 0, 0] });

  /* head — merged into the static body mesh (one draw call fewer per statue) */
  const head = new THREE.Group(); // kept for API symmetry; heads no longer pivot
  const hd = st;
  hd.offset = [0, waistY + 0.465, 0];
  hd.add('statue', sph(0.058, 16, 12), P.skin, { s: [0.92, 1.1, 0.96] });
  // brow, nose, moustache — enough for a terracotta face
  hd.add('statue', box(0.075, 0.012, 0.02), P.hair, { p: [0, 0.02, -0.052] });
  hd.add('statue', box(0.014, 0.03, 0.02), P.skin, { p: [0, -0.003, -0.058] });
  for (const sx of [-1, 1]) hd.add('statue', sph(0.008, 6, 5), P.hair, { p: [sx * 0.022, 0.008, -0.052], s: [1, 0.7, 0.6] });
  hd.add('statue', box(0.06, 0.01, 0.014), P.hair, { p: [0, -0.024, -0.054] });
  hd.add('statue', box(0.01, 0.018, 0.012), P.hair, { p: [0.02, -0.037, -0.05], r: [0, 0, 0.3] });
  hd.add('statue', box(0.01, 0.018, 0.012), P.hair, { p: [-0.02, -0.037, -0.05], r: [0, 0, -0.3] });
  switch (o.headgear) {
    case 'topknot':
      hd.add('statue', sph(0.06, 12, 8), P.hair, { p: [0, 0.018, 0.012], s: [0.98, 0.78, 1.0] });
      hd.add('statue', sph(0.03, 10, 8), P.hair, { p: [0.034, 0.075, 0.0] });
      hd.add('metal', torus(0.026, 0.006, 5, 10), P.accent, { p: [0.034, 0.052, 0], r: [Math.PI / 2, 0, 0] });
      break;
    case 'cap':
      hd.add('statue', cyl(0.062, 0.066, 0.05, 14), P.armor, { p: [0, 0.04, 0] });
      hd.add('statue', torus(0.064, 0.006, 5, 16), P.armor, { p: [0, 0.018, 0], r: [Math.PI / 2, 0, 0] });
      hd.add('statue', sph(0.026, 8, 6), P.hair, { p: [0, 0.09, 0.004] });
      break;
    case 'tablet': // 長冠 — the long flat official's cap: reads clearly from above
      hd.add('statue', cyl(0.056, 0.062, 0.05, 14), P.armor, { p: [0, 0.035, 0] });
      hd.add('statue', box(0.075, 0.016, 0.26), P.accent, { p: [0, 0.075, -0.01] });
      hd.add('metal', box(0.082, 0.007, 0.268), c(0xc9a24a), { p: [0, 0.087, -0.01] });
      break;
    case 'crest': // general: bird-tail crested helmet with cheek flaps
      hd.add('statue', sph(0.066, 14, 10), P.armor, { p: [0, 0.02, 0.0], s: [1, 0.85, 1.02] });
      hd.add('metal', torus(0.066, 0.01, 6, 18), P.accent, { p: [0, 0.01, 0], r: [Math.PI / 2, 0, 0] });
      for (const sx of [-1, 1]) hd.add('statue', box(0.014, 0.07, 0.07), P.armor, { p: [sx * 0.062, -0.025, 0.0] });
      // fan crest
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.28;
        hd.add('metal', box(0.012, 0.15, 0.022), i === 2 ? P.accent : P.armor, { p: [0, 0.14, 0.03 + Math.abs(a) * 0.02], r: [0.35 - Math.abs(a) * 0.2, 0, a] });
      }
      hd.add('metal', cone(0.016, 0.06, 6), c(0xc9a24a), { p: [0, 0.09, -0.04] });
      break;
    case 'helmet':
      hd.add('statue', sph(0.064, 14, 10), P.armor, { p: [0, 0.02, 0.0], s: [1, 0.8, 1] });
      hd.add('metal', cone(0.016, 0.05, 6), P.accent, { p: [0, 0.095, 0] });
      break;
  }
  hd.offset = [0, 0, 0];

  const staticGroup = st.mesh(side);

  /* arms — pivots at the shoulders, hanging down */
  const mkArm = (sx: number, withWeapon: boolean): { arm: THREE.Group; weapon: THREE.Group } => {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.135, waistY + 0.335, 0);
    const ap = new Parts();
    limb(ap, 'statue', P.robe, [0, 0, 0], [sx * 0.01, -0.12, -0.015], 0.03, 0.026);
    ap.add('metal', cyl(0.034, 0.034, 0.04, 8), P.accent, { p: [sx * 0.005, -0.065, -0.008] });
    limb(ap, 'statue', P.robe, [sx * 0.01, -0.12, -0.015], [sx * 0.012, -0.2, -0.1], 0.026, 0.021);
    ap.add('statue', sph(0.024, 8, 6), P.skin, { p: [sx * 0.012, -0.21, -0.11] });
    ap.add('metal', torus(0.025, 0.006, 5, 10), P.accent, { p: [sx * 0.012, -0.19, -0.09], r: [Math.PI / 2 - 0.7, 0, 0] });
    arm.add(ap.mesh(side));
    const weapon = new THREE.Group();
    weapon.position.set(sx * 0.012, -0.21, -0.11);
    arm.add(weapon);
    void withWeapon;
    return { arm, weapon };
  };
  const R = mkArm(1, true);
  const L = mkArm(-1, false);

  /* weapons held in the right hand (local frame: hand at the origin, weapon along +Y) */
  const wp = new Parts();
  const gold = c(0xc9a24a);
  const steel = side === 0 ? c(0xb9a27a) : c(0x8d9a98);
  switch (o.weapon) {
    case 'ge': // dagger-axe: long shaft, horizontal blade with a hooked tip and a tassel
      wp.add('statue', cyl(0.011, 0.012, 0.95, 7), P.wood, { p: [0, 0.3, 0] });
      wp.add('metal', box(0.17, 0.03, 0.008), steel, { p: [0.085, 0.77, 0] });
      wp.add('metal', cone(0.016, 0.08, 4), steel, { p: [0.18, 0.77, 0], r: [0, 0, -Math.PI / 2] });
      wp.add('metal', box(0.02, 0.1, 0.008), steel, { p: [0.0, 0.84, 0] });
      wp.add('metal', cone(0.016, 0.07, 4), steel, { p: [0, 0.92, 0] });
      wp.add('statue', cyl(0.004, 0.013, 0.13, 6), P.accent, { p: [0.0, 0.67, 0.0] });
      break;
    case 'halberd':
      wp.add('statue', cyl(0.011, 0.012, 1.0, 7), P.wood, { p: [0, 0.32, 0] });
      wp.add('metal', box(0.012, 0.16, 0.008), steel, { p: [0, 0.9, 0] });
      wp.add('metal', cone(0.02, 0.1, 4), steel, { p: [0, 1.03, 0] });
      wp.add('metal', box(0.09, 0.03, 0.008), steel, { p: [0.05, 0.82, 0] });
      wp.add('statue', cyl(0.004, 0.012, 0.12, 6), P.accent, { p: [0, 0.74, 0] });
      break;
    case 'spear':
      wp.add('statue', cyl(0.01, 0.011, 1.1, 7), P.wood, { p: [0, 0.35, 0] });
      wp.add('metal', cone(0.02, 0.14, 4), steel, { p: [0, 0.97, 0] });
      wp.add('statue', cyl(0.004, 0.016, 0.1, 6), P.accent, { p: [0, 0.86, 0] });
      break;
    case 'staff': // advisor: ringed staff with tassels
      wp.add('statue', cyl(0.012, 0.013, 1.05, 8), P.wood, { p: [0, 0.3, 0] });
      wp.add('metal', torus(0.05, 0.009, 6, 18), gold, { p: [0, 0.85, 0] });
      wp.add('metal', torus(0.026, 0.006, 6, 14), gold, { p: [0, 0.76, 0], r: [0, Math.PI / 2, 0] });
      wp.add('metal', sph(0.017, 8, 6), gold, { p: [0, 0.92, 0] });
      wp.add('statue', cyl(0.003, 0.012, 0.16, 6), P.accent, { p: [0.03, 0.7, 0] });
      break;
    case 'sword': // jian held point-down in both hands
      wp.add('metal', box(0.03, 0.5, 0.008), steel, { p: [0, -0.3, 0] });
      wp.add('metal', cone(0.015, 0.06, 4), steel, { p: [0, -0.58, 0], r: [Math.PI, Math.PI / 4, 0] });
      wp.add('metal', box(0.13, 0.016, 0.026), gold, { p: [0, -0.04, 0] });
      wp.add('statue', cyl(0.013, 0.013, 0.11, 8), P.wood, { p: [0, 0.03, 0] });
      wp.add('metal', sph(0.02, 8, 6), gold, { p: [0, 0.095, 0] });
      break;
    case 'none':
      break;
  }
  if (o.weapon !== 'none') R.weapon.add(wp.mesh(side));

  /* shield: rectangular, studded, strapped to the left forearm */
  if (o.shield) {
    const sp = new Parts();
    sp.add('statue', box(0.2, 0.31, 0.022), P.armor, { p: [-0.05, 0.0, -0.075] });
    sp.add('metal', box(0.205, 0.022, 0.026), P.accent, { p: [-0.05, 0.155, -0.075] });
    sp.add('metal', box(0.205, 0.022, 0.026), P.accent, { p: [-0.05, -0.155, -0.075] });
    sp.add('metal', box(0.02, 0.31, 0.026), P.accent, { p: [-0.05, 0.0, -0.077] });
    for (const [x, y] of [[-0.1, 0.1], [0, 0.1], [-0.1, -0.1], [0, -0.1], [-0.05, 0]]) sp.add('metal', sph(0.011, 6, 5), gold, { p: [x, y, -0.09] });
    sp.add('statue', box(0.2, 0.02, 0.02), P.hair, { p: [-0.05, 0, -0.06] });
    L.weapon.add(sp.mesh(side));
  }

  /* cape: separate pivot hanging from the shoulders */
  let cape: THREE.Group | undefined;
  if (o.cape) {
    cape = new THREE.Group();
    cape.position.set(0, waistY + 0.34, 0.07);
    const geo = new THREE.PlaneGeometry(0.3, 0.62, 14, 12);
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i);
      const drop = 1 - (y + 0.31) / 0.62; // 0 at the neck, 1 at the hem
      pa.setZ(i, 0.03 * drop * Math.cos(x * 34) + 0.012 * Math.cos(x * 15 + 1) + drop * 0.09 + Math.pow(Math.abs(x) / 0.15, 2) * 0.03);
    }
    geo.translate(0, -0.31, 0);
    geo.computeVertexNormals();
    const col = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const t = 1 - (pa.getY(i) + 0.62) / 0.62; // 0 at hem, 1 at neck
      const k = 0.7 + 0.5 * t;
      col[i * 3] = P.cloth.r * k; col[i * 3 + 1] = P.cloth.g * k; col[i * 3 + 2] = P.cloth.b * k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
    mat.userData.own = true;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    cape.add(m);
    // gold trim line
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.014, 0.01), warriorMaterial(side, 'metal'));
    const tg = trim.geometry;
    const tcol = new Float32Array(tg.attributes.position.count * 3);
    for (let i = 0; i < tcol.length; i += 3) { tcol[i] = 0.79; tcol[i + 1] = 0.64; tcol[i + 2] = 0.29; }
    tg.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
    trim.position.set(0, -0.62, 0.09);
    cape.add(trim);
  }

  const bodyGroup = new THREE.Group();
  bodyGroup.add(staticGroup, head, R.arm, L.arm);
  if (cape) bodyGroup.add(cape);
  g.add(bodyGroup);
  g.userData.bodyGroup = bodyGroup;
  return { group: g, armR: R.arm, weaponR: R.weapon, armL: L.arm, head, cape, height: waistY + 0.58 };
}

/* ──────────────────────────── plinth ──────────────────────────── */

function plinth(side: 0 | 1, r = 0.135): THREE.Mesh {
  const P = PAL[side];
  const p = new Parts();
  p.add('statue', lathe([[0.001, 0], [r + 0.01, 0], [r + 0.012, 0.012], [r, 0.022], [r - 0.01, 0.026], [0.001, 0.026]], 28), P.stone);
  const m = p.mesh(side);
  return m.children[0] as THREE.Mesh;
}

/* ──────────────────────────── per-type rigs ──────────────────────────── */

function newRig(type: PT): WarriorRig {
  const root = new THREE.Group();
  const sway = new THREE.Group();
  root.add(sway);
  return { type, root, sway, wheels: [], wheelRadius: 0.15, discOffsetZ: 0.14, attackStyle: 'overhead', height: 1.2 };
}

function attachHumanoid(rig: WarriorRig, h: Humanoid) {
  rig.armR = h.armR;
  rig.weaponR = h.weaponR;
  rig.armL = h.armL;
  rig.head = h.head;
  rig.cape = h.cape;
}

function buildGeneral(side: 0 | 1): WarriorRig {
  const rig = newRig(PT.General);
  const h = humanoid(side, { headgear: 'crest', weapon: 'sword', cape: true, twoHanded: true });
  h.group.position.y = 0.026;
  rig.sway.add(plinth(side), h.group);
  attachHumanoid(rig, h);
  // two-handed grip: both arms forward-in, weapon point-down in front
  rig.height = 1.38;
  rig.attackStyle = 'overhead';
  rig.discOffsetZ = 0.25;
  return rig;
}

function buildAdvisor(side: 0 | 1): WarriorRig {
  const rig = newRig(PT.Advisor);
  const h = humanoid(side, { headgear: 'tablet', weapon: 'staff' });
  h.group.position.y = 0.026;
  rig.sway.add(plinth(side), h.group);
  attachHumanoid(rig, h);
  rig.height = 1.22;
  rig.attackStyle = 'overhead';
  rig.discOffsetZ = 0.25;
  return rig;
}

function buildSoldier(side: 0 | 1): WarriorRig {
  const rig = newRig(PT.Soldier);
  const h = humanoid(side, { headgear: 'topknot', weapon: 'ge', shield: true });
  h.group.position.y = 0.026;
  rig.sway.add(plinth(side), h.group);
  attachHumanoid(rig, h);
  rig.height = 1.2;
  rig.discOffsetZ = 0.25;
  return rig;
}

function wheel(side: 0 | 1, r: number, spokes = 8): THREE.Group {
  const P = PAL[side];
  const w = new THREE.Group();
  const p = new Parts();
  p.add('statue', torus(r, 0.022, 8, 24), P.wood);
  p.add('metal', torus(r - 0.002, 0.008, 6, 24), P.accent, { p: [0, 0, 0.015] });
  p.add('metal', cyl(0.04, 0.04, 0.07, 10), c(0xa9873c), { r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI;
    p.add('statue', box(r * 2 - 0.01, 0.012, 0.012), P.wood, { r: [0, 0, a] });
  }
  const inner = new THREE.Group();
  inner.add(p.mesh(side));
  inner.rotation.y = Math.PI / 2; // wheel plane = YZ (axle along X)
  w.add(inner); // spin the outer group about X
  return w;
}

function buildChariot(side: 0 | 1): WarriorRig {
  const rig = newRig(PT.Chariot);
  const P = PAL[side];
  const mount = new THREE.Group();
  const car = new Parts();
  // carriage box with bronze trim
  car.add('statue', box(0.34, 0.12, 0.34), P.wood, { p: [0, 0.27, 0.03] });
  car.add('metal', box(0.35, 0.02, 0.35), P.accent, { p: [0, 0.335, 0.03] });
  car.add('statue', box(0.34, 0.1, 0.02), P.armor, { p: [0, 0.4, -0.15] });
  car.add('metal', box(0.34, 0.016, 0.026), c(0xc9a24a), { p: [0, 0.455, -0.15] });
  // axle
  car.add('statue', cyl(0.018, 0.018, 0.56, 8), P.wood, { p: [0, 0.16, 0.03], r: [0, 0, Math.PI / 2] });
  // pole + yoke
  car.add('statue', cyl(0.016, 0.02, 0.62, 8), P.wood, { p: [0, 0.23, -0.4], r: [Math.PI / 2 - 0.08, 0, 0] });
  car.add('statue', cyl(0.014, 0.014, 0.3, 8), P.wood, { p: [0, 0.26, -0.7], r: [0, 0, Math.PI / 2] });
  for (const sx of [-1, 1]) car.add('metal', sph(0.026, 8, 6), c(0xc9a24a), { p: [sx * 0.15, 0.26, -0.7] });
  // umbrella canopy support (Qin-style) — a bronze mast and a small conical parasol
  car.add('metal', cyl(0.008, 0.008, 0.5, 6), c(0xa9873c), { p: [0.12, 0.62, 0.12] });
  car.add('statue', lathe([[0.001, 0.12], [0.2, 0.0], [0.23, -0.02]], 18), P.accent, { p: [0.12, 0.87, 0.12] });
  mount.add(car.mesh(side));
  for (const sx of [-1, 1]) {
    const w = wheel(side, 0.155);
    w.position.set(sx * 0.255, 0.16, 0.03);
    mount.add(w);
    rig.wheels.push(w);
  }
  // charioteer with a long spear
  const h = humanoid(side, { headgear: 'cap', weapon: 'halberd' });
  h.group.scale.setScalar(0.74);
  h.group.position.set(0, 0.345, 0.06);
  mount.add(h.group);
  mount.position.y = 0.026;
  rig.sway.add(plinth(side, 0.2), mount);
  rig.mount = mount;
  attachHumanoid(rig, h);
  rig.wheelRadius = 0.155;
  rig.height = 1.12;
  rig.discOffsetZ = 0.1;
  rig.attackStyle = 'charge';
  return rig;
}

function buildHorse(side: 0 | 1): WarriorRig {
  const rig = newRig(PT.Horse);
  const P = PAL[side];
  const mount = new THREE.Group();
  const hp = new Parts();
  // barrel, chest, haunch
  hp.add('statue', sph(0.15, 16, 12), P.horse, { p: [0, 0.42, 0.02], s: [0.95, 0.95, 1.7] });
  hp.add('statue', sph(0.13, 14, 10), P.horse, { p: [0, 0.46, -0.17], s: [1, 1.08, 1] });
  hp.add('statue', sph(0.14, 14, 10), P.horse, { p: [0, 0.44, 0.2], s: [0.95, 1, 1] });
  // neck + head
  limb(hp, 'statue', P.horse, [0, 0.5, -0.2], [0, 0.78, -0.3], 0.085, 0.056);
  hp.add('statue', sph(0.06, 12, 8), P.horse, { p: [0, 0.82, -0.31], s: [0.9, 1.1, 1.0] });
  limb(hp, 'statue', P.horse, [0, 0.82, -0.31], [0, 0.7, -0.45], 0.05, 0.034);
  hp.add('statue', sph(0.036, 10, 8), P.horse, { p: [0, 0.69, -0.46] });
  for (const sx of [-1, 1]) hp.add('statue', cone(0.018, 0.07, 5), P.horse, { p: [sx * 0.034, 0.9, -0.29], r: [-0.3, 0, sx * 0.15] });
  // mane (accent) + tail
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    hp.add('statue', box(0.02, 0.06, 0.05), P.hair, { p: [0, 0.53 + t * 0.28, -0.2 - t * 0.1], r: [0.5 - t * 0.3, 0, 0] });
  }
  limb(hp, 'statue', P.hair, [0, 0.5, 0.33], [0, 0.22, 0.46], 0.03, 0.012);
  // legs: upper + lower with hoof
  for (const [lx, lz] of [[-0.075, -0.17], [0.075, -0.17], [-0.075, 0.22], [0.075, 0.22]]) {
    const front = lz < 0;
    limb(hp, 'statue', P.horse, [lx, 0.4, lz], [lx, 0.2, lz + (front ? -0.015 : 0.03)], 0.045, 0.028);
    limb(hp, 'statue', P.horse, [lx, 0.2, lz + (front ? -0.015 : 0.03)], [lx, 0.045, lz + (front ? -0.03 : 0.0)], 0.026, 0.024);
    hp.add('metal', cyl(0.03, 0.034, 0.035, 8), P.accent, { p: [lx, 0.03, lz + (front ? -0.03 : 0.0)] });
  }
  // saddle blanket + harness
  hp.add('metal', box(0.26, 0.015, 0.3), P.accent, { p: [0, 0.575, 0.03] });
  hp.add('metal', torus(0.145, 0.012, 6, 16), c(0xc9a24a), { p: [0, 0.45, -0.1], r: [0, 0, 0], s: [1, 1, 1] });
  mount.add(hp.mesh(side));
  // rider with spear
  const h = humanoid(side, { headgear: 'helmet', weapon: 'spear', legs: false });
  h.group.scale.setScalar(0.74);
  h.group.position.set(0, 0.21, 0.05);
  mount.add(h.group);
  mount.position.y = 0.026;
  rig.sway.add(plinth(side, 0.2), mount);
  rig.mount = mount;
  attachHumanoid(rig, h);
  rig.height = 1.2;
  rig.discOffsetZ = 0.1;
  rig.attackStyle = 'thrust';
  return rig;
}

function buildElephant(side: 0 | 1): WarriorRig {
  const rig = newRig(PT.Elephant);
  const P = PAL[side];
  const mount = new THREE.Group();
  const gray = side === 0 ? c(0x7b7873) : c(0x4a4e55);
  const ep = new Parts();
  ep.add('statue', sph(0.2, 18, 14), gray, { p: [0, 0.42, 0.03], s: [0.95, 0.92, 1.45] });
  ep.add('statue', sph(0.14, 16, 12), gray, { p: [0, 0.48, -0.22] });
  for (const [lx, lz] of [[-0.1, -0.2], [0.1, -0.2], [-0.1, 0.22], [0.1, 0.22]]) {
    limb(ep, 'statue', gray, [lx, 0.4, lz], [lx, 0.05, lz], 0.07, 0.06);
    ep.add('statue', cyl(0.066, 0.07, 0.03, 10), P.stone, { p: [lx, 0.02, lz] });
  }
  for (const sx of [-1, 1]) {
    // ears
    ep.add('statue', sph(0.09, 12, 8), gray, { p: [sx * 0.14, 0.54, -0.2], s: [0.25, 1.1, 1.0], r: [0, sx * 0.3, 0] });
    // tusks
    limb(ep, 'metal', c(0xe8dcc0), [sx * 0.05, 0.4, -0.3], [sx * 0.07, 0.3, -0.45], 0.016, 0.004);
  }
  // trunk: curved tube
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.5, -0.31), new THREE.Vector3(0, 0.36, -0.38), new THREE.Vector3(0, 0.2, -0.42),
    new THREE.Vector3(0, 0.12, -0.5), new THREE.Vector3(0, 0.2, -0.58),
  ]);
  const tube = new THREE.TubeGeometry(curve, 16, 0.045, 8, false);
  // taper the trunk
  const tp = tube.attributes.position;
  const tpos = new THREE.Vector3();
  for (let i = 0; i < tp.count; i++) {
    tpos.fromBufferAttribute(tp, i);
    let best = 0, bd = 1e9;
    for (let k = 0; k <= 16; k++) { const q = curve.getPoint(k / 16); const d = q.distanceTo(tpos); if (d < bd) { bd = d; best = k / 16; } }
    const c0 = curve.getPoint(best);
    const s = 1 - best * 0.55;
    tpos.sub(c0).multiplyScalar(s).add(c0);
    tp.setXYZ(i, tpos.x, tpos.y, tpos.z);
  }
  ep.add('statue', tube, gray);
  // caparison + howdah platform
  ep.add('statue', box(0.36, 0.04, 0.44), P.cloth, { p: [0, 0.6, 0.04] });
  ep.add('metal', box(0.37, 0.01, 0.45), c(0x8f7330), { p: [0, 0.624, 0.04] });
  for (const sz of [-1, 1]) ep.add('metal', box(0.38, 0.02, 0.012), c(0xc9a24a), { p: [0, 0.605, 0.04 + sz * 0.22] });
  ep.add('statue', box(0.02, 0.2, 0.42), P.cloth, { p: [-0.19, 0.5, 0.04] });
  ep.add('statue', box(0.02, 0.2, 0.42), P.cloth, { p: [0.19, 0.5, 0.04] });
  ep.add('metal', torus(0.06, 0.01, 6, 14), c(0xc9a24a), { p: [0, 0.36, -0.34], r: [Math.PI / 2, 0, 0] });
  mount.add(ep.mesh(side));
  const trunk = new THREE.Group(); // reserved for future trunk animation
  mount.add(trunk);
  rig.trunk = trunk;
  const h = humanoid(side, { headgear: 'cap', weapon: 'staff', legs: false });
  h.group.scale.setScalar(0.62);
  h.group.position.set(0, 0.33, 0.02);
  mount.add(h.group);
  mount.position.y = 0.026;
  rig.sway.add(plinth(side, 0.21), mount);
  rig.mount = mount;
  attachHumanoid(rig, h);
  rig.height = 1.18;
  rig.discOffsetZ = 0.08;
  rig.attackStyle = 'stomp';
  return rig;
}

function buildCannon(side: 0 | 1): WarriorRig {
  const rig = newRig(PT.Cannon);
  const P = PAL[side];
  const mount = new THREE.Group();
  const bronze = side === 0 ? c(0xa67c3a) : c(0x6d6a55);
  const cp = new Parts();
  // wooden carriage
  cp.add('statue', box(0.2, 0.06, 0.4), P.wood, { p: [0, 0.2, 0] });
  for (const sx of [-1, 1]) cp.add('statue', box(0.03, 0.14, 0.38), P.wood, { p: [sx * 0.1, 0.27, -0.01] });
  cp.add('statue', cyl(0.016, 0.016, 0.5, 8), P.wood, { p: [0, 0.15, -0.02], r: [0, 0, Math.PI / 2] });
  // trail
  cp.add('statue', box(0.06, 0.035, 0.22), P.wood, { p: [0, 0.14, 0.3], r: [-0.15, 0, 0] });
  mount.add(cp.mesh(side));
  for (const sx of [-1, 1]) {
    const w = wheel(side, 0.14, 6);
    w.position.set(sx * 0.24, 0.15, -0.02);
    mount.add(w);
    rig.wheels.push(w);
  }
  // barrel: lathe with reinforcing rings and flared muzzle; pivot at the trunnions
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.345, 0);
  const bp = new Parts();
  const prof: [number, number][] = [
    [0.001, 0.3], [0.07, 0.3], [0.078, 0.26], [0.074, 0.2], [0.066, 0.1], [0.058, 0.0], [0.052, -0.14], [0.05, -0.24], [0.062, -0.28], [0.066, -0.33], [0.058, -0.34], [0.03, -0.34],
  ];
  bp.add('metal', lathe(prof, 20), bronze, { r: [Math.PI / 2, 0, 0], p: [0, 0, 0] });
  for (const z of [0.2, 0.0, -0.18]) bp.add('metal', torus(0.075 - (0.2 - z) * 0.08, 0.009, 6, 20), c(0xc9a24a), { p: [0, 0, z], r: [0, 0, 0] });
  bp.add('metal', sph(0.034, 10, 8), bronze, { p: [0, 0.0, 0.33] });
  for (const sx of [-1, 1]) bp.add('metal', cyl(0.018, 0.018, 0.06, 8), bronze, { p: [sx * 0.095, 0, -0.02], r: [0, 0, Math.PI / 2] });
  barrel.add(bp.mesh(side));
  mount.add(barrel);
  rig.barrel = barrel;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.35);
  barrel.add(muzzle);
  rig.muzzle = muzzle;
  // gunner with a linstock
  const h = humanoid(side, { headgear: 'cap', weapon: 'staff', cape: false });
  h.group.scale.setScalar(0.62);
  h.group.position.set(0.26, 0.0, 0.2);
  h.group.rotation.y = -0.4;
  mount.add(h.group);
  mount.position.y = 0.026;
  rig.sway.add(plinth(side, 0.22), mount);
  rig.mount = mount;
  attachHumanoid(rig, h);
  rig.wheelRadius = 0.14;
  rig.height = 0.95;
  rig.discOffsetZ = 0.1;
  rig.attackStyle = 'fire';
  return rig;
}

export function buildWarrior(type: PT, side: 0 | 1): WarriorRig {
  switch (type) {
    case PT.General: return buildGeneral(side);
    case PT.Advisor: return buildAdvisor(side);
    case PT.Elephant: return buildElephant(side);
    case PT.Horse: return buildHorse(side);
    case PT.Chariot: return buildChariot(side);
    case PT.Cannon: return buildCannon(side);
    default: return buildSoldier(side);
  }
}
