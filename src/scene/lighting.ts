import * as THREE from 'three';
import type { Gfx } from '../core/renderer';
import { noise2 } from '../core/util';

/**
 * Light rig — warm firelit Red camp vs cold moonlit Black camp.
 * Intensities follow the brief; LS scales candela values to this scene's units.
 */
const LS = 1.0;

export interface FlickerLight {
  light: THREE.PointLight;
  base: number;
  seed: number;
  amp: number;
}

export class Lighting {
  readonly redKey: THREE.PointLight;
  readonly blackPoint: THREE.PointLight;
  readonly moon: THREE.DirectionalLight;
  readonly spot: THREE.SpotLight;
  readonly strike: THREE.PointLight;
  readonly braziers: FlickerLight[] = [];
  private strikeDecay = 0;

  constructor(private gfx: Gfx) {
    const scene = gfx.scene;

    scene.add(new THREE.AmbientLight(0x1a2236, 0.34));
    scene.add(new THREE.HemisphereLight(0x33426a, 0x2a1a12, 0.2));

    // Red side key: warm, behind Red at height ~5
    this.redKey = new THREE.PointLight(0xffb066, 6.5 * LS * 3.6, 17, 1.3);
    this.redKey.position.set(0, 5, 9.5);
    scene.add(this.redKey);

    // warm fill hugging the Red half so the firelit side reads orange even at the river
    const redFill = new THREE.PointLight(0xff9a52, 11, 12, 1.5);
    redFill.position.set(0, 3.0, 3.6);
    scene.add(redFill);

    // Black side: cold moonlight directional + cool point
    this.moon = new THREE.DirectionalLight(0x9db8ff, 1.2 * 1.5);
    this.moon.position.set(-5, 16, -18);
    this.moon.target.position.set(0, 0, -2);
    scene.add(this.moon, this.moon.target);

    this.blackPoint = new THREE.PointLight(0x8fb6ff, 4 * LS * 3.4, 17, 1.2);
    this.blackPoint.position.set(0, 4.5, -9);
    scene.add(this.blackPoint);

    // Main shadow caster — neutral so it does not flatten the warm/cool split
    this.spot = new THREE.SpotLight(0xfff0dc, 46, 48, 0.55, 0.6, 1.4);
    this.spot.position.set(1.5, 15, 4.5);
    this.spot.target.position.set(0, 0, 0);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(2048, 2048);
    this.spot.shadow.bias = -0.00035;
    this.spot.shadow.normalBias = 0.025;
    this.spot.shadow.camera.near = 6;
    this.spot.shadow.camera.far = 30;
    this.spot.shadow.radius = 3;
    scene.add(this.spot, this.spot.target);

    // brazier lights (flicker handled in update)
    const addBrazier = (x: number, z: number, color: number, intensity: number, dist: number, seed: number) => {
      const l = new THREE.PointLight(color, intensity, dist, 1.6);
      l.position.set(x, 1.7, z);
      scene.add(l);
      this.braziers.push({ light: l, base: intensity, seed, amp: 0.28 });
      return l;
    };
    addBrazier(-4.9, 8.0, 0xff8a3d, 26, 18, 1.3);
    addBrazier(4.9, 8.0, 0xff8a3d, 26, 18, 7.9);
    addBrazier(-4.9, -8.0, 0xffa060, 7, 12, 3.1); // one dimmer brazier on the Black side

    // impact flash
    this.strike = new THREE.PointLight(0xffb84d, 0, 12, 2);
    this.strike.position.set(0, 1, 0);
    scene.add(this.strike);

    gfx.onQuality((q) => {
      this.spot.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.spot.shadow.map?.dispose();
      this.spot.shadow.map = null;
    });
  }

  /** Flash the strike light at a world position */
  flash(pos: THREE.Vector3, intensity = 55, decay = 0.3): void {
    this.strike.position.copy(pos).y += 0.8;
    this.strike.intensity = intensity;
    this.strikeDecay = intensity / decay;
  }

  update(dt: number, time: number): void {
    for (const b of this.braziers) {
      const f =
        0.5 * Math.sin(time * 9.1 + b.seed) + 0.3 * Math.sin(time * 15.7 + b.seed * 2.3) + (noise2(time * 6 + b.seed * 10, b.seed) - 0.5);
      b.light.intensity = b.base * (1 + b.amp * f);
      b.light.position.x += (Math.sin(time * 5 + b.seed) * 0.01);
    }
    if (this.strike.intensity > 0) {
      this.strike.intensity = Math.max(0, this.strike.intensity - this.strikeDecay * dt);
    }
  }
}

/**
 * Small procedural "studio": warm emissive panels on the Red side, cool on the Black side.
 * PMREM-filtered so lacquer clearcoat, bronze and gold have something to reflect.
 */
export function buildEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x03050a);
  const panel = (w: number, h: number, color: number, intensity: number, pos: [number, number, number]) => {
    const c = new THREE.Color(color).multiplyScalar(intensity);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  // warm side (+Z, Red)
  panel(14, 6, 0xffa050, 5.5, [0, 6, 14]);
  panel(5, 5, 0xff7a30, 7, [-11, 3, 9]);
  panel(5, 5, 0xff7a30, 7, [11, 3, 9]);
  // cool side (−Z, Black)
  panel(16, 6, 0x7fa6ff, 3.6, [0, 8, -14]);
  panel(5, 8, 0x9db8ff, 3.2, [-12, 5, -8]);
  panel(5, 8, 0x9db8ff, 3.2, [12, 5, -8]);
  // sky dome glow and floor bounce
  panel(30, 30, 0x1a2540, 0.7, [0, 18, 0]);
  panel(30, 30, 0x120a06, 0.5, [0, -8, 0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.04);
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
  return rt.texture;
}
