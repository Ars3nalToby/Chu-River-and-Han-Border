import * as THREE from 'three';

export interface EmitOpts {
  life: number;
  size: number;
  sizeEnd?: number;
  color: THREE.ColorRepresentation;
  colorEnd?: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
  /** spawn jitter of the position */
  spread?: number;
}

const VERT = /* glsl */ `
attribute vec4 aColor; attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(0.0, aSize * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying vec4 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

/** CPU-simulated soft point sprites. One draw call per system. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private p0: Float32Array; // size, sizeEnd, alpha, gravity
  private c0: Float32Array; // rgb start
  private c1: Float32Array; // rgb end
  private drag: Float32Array;
  private head = 0;
  private live = 0;
  private mat: THREE.ShaderMaterial;

  constructor(private max: number, additive: boolean) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.p0 = new Float32Array(max * 4);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 30 : 25;
  }

  setScale(s: number) {
    this.mat.uniforms.uScale.value = s;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, o: EmitOpts): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const j = o.spread ?? 0;
    this.pos[i * 3] = p.x + (Math.random() - 0.5) * j;
    this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * j;
    this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * j;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.p0[i * 4] = o.size; this.p0[i * 4 + 1] = o.sizeEnd ?? o.size; this.p0[i * 4 + 2] = o.alpha ?? 1; this.p0[i * 4 + 3] = o.gravity ?? 0;
    const a = new THREE.Color(o.color), b = new THREE.Color(o.colorEnd ?? o.color);
    this.c0[i * 3] = a.r; this.c0[i * 3 + 1] = a.g; this.c0[i * 3 + 2] = a.b;
    this.c1[i * 3] = b.r; this.c1[i * 3 + 1] = b.g; this.c1[i * 3 + 2] = b.b;
    this.drag[i] = o.drag ?? 0;
    this.live = Math.min(this.max, this.live + 1);
  }

  update(dt: number): void {
    if (!this.live) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > this.life[i]) {
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      any = true;
      this.age[i] += dt;
      const u = Math.min(1, this.age[i] / this.life[i]);
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.p0[i * 4 + 3] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.p0[i * 4] + (this.p0[i * 4 + 1] - this.p0[i * 4]) * u;
      this.col[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * u;
      this.col[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * u;
      this.col[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * u;
      // quick fade-in, long fade-out
      this.col[i * 4 + 3] = this.p0[i * 4 + 2] * Math.min(1, u * 8) * (1 - u) * (1 - u * 0.2);
    }
    if (!any) this.live = 0;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}

const rnd = (a = -1, b = 1) => a + Math.random() * (b - a);

/** Facade for the handful of particle looks the game needs. */
export class ParticleFx {
  readonly group = new THREE.Group();
  readonly dustSys = new ParticleSystem(500, false);
  readonly smokeSys = new ParticleSystem(300, false);
  readonly sparkSys = new ParticleSystem(500, true);
  private v = new THREE.Vector3();

  constructor() {
    this.group.add(this.dustSys.points, this.smokeSys.points, this.sparkSys.points);
  }

  setScale(s: number) {
    this.dustSys.setScale(s);
    this.smokeSys.setScale(s);
    this.sparkSys.setScale(s);
  }

  /** soft landing puff */
  dust(p: THREE.Vector3, n = 8, strength = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.25 + Math.random() * 0.5) * strength;
      this.v.set(Math.cos(a) * s, 0.12 + Math.random() * 0.25 * strength, Math.sin(a) * s);
      this.dustSys.emit(p, this.v, {
        life: 0.7 + Math.random() * 0.5, size: 0.12 + Math.random() * 0.1, sizeEnd: 0.4 + Math.random() * 0.3 * strength,
        color: 0x8a8070, colorEnd: 0x5a5448, alpha: 0.38, drag: 2.2, gravity: -0.05, spread: 0.12,
      });
    }
  }

  smoke(p: THREE.Vector3, n = 10, scale = 1): void {
    for (let i = 0; i < n; i++) {
      this.v.set(rnd(-0.5, 0.5) * scale, 0.4 + Math.random() * 0.8, rnd(-0.5, 0.5) * scale);
      this.smokeSys.emit(p, this.v, {
        life: 1.2 + Math.random() * 0.9, size: 0.25 * scale, sizeEnd: 1.0 * scale + Math.random() * 0.6,
        color: 0x3a3a3e, colorEnd: 0x1c1d22, alpha: 0.55, drag: 1.4, gravity: -0.2, spread: 0.2,
      });
    }
  }

  sparks(p: THREE.Vector3, n = 20, power = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      const s = (1.5 + Math.random() * 3.5) * power;
      this.v.set(Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 0.6, Math.sin(a) * Math.cos(e) * s);
      this.sparkSys.emit(p, this.v, {
        life: 0.35 + Math.random() * 0.5, size: 0.05 + Math.random() * 0.05, sizeEnd: 0.01,
        color: new THREE.Color(3.2, 1.7, 0.5), colorEnd: new THREE.Color(1.4, 0.25, 0.04), alpha: 1, gravity: 6, drag: 0.8,
      });
    }
  }

  /** soft golden motion streak (chariot charge) */
  streak(p: THREE.Vector3, size = 0.2): void {
    this.v.set(rnd(-0.05, 0.05), rnd(0, 0.08), rnd(-0.05, 0.05));
    this.sparkSys.emit(p, this.v, {
      life: 0.32, size, sizeEnd: 0.02, color: new THREE.Color(1.1, 0.85, 0.5), colorEnd: new THREE.Color(0.3, 0.25, 0.2), alpha: 0.38, drag: 3,
    });
  }

  /** glowing ember trail dot (shell / debris) */
  trail(p: THREE.Vector3, size = 0.12): void {
    this.v.set(rnd(-0.15, 0.15), rnd(0, 0.25), rnd(-0.15, 0.15));
    this.sparkSys.emit(p, this.v, {
      life: 0.5 + Math.random() * 0.3, size, sizeEnd: 0.02,
      color: new THREE.Color(3, 1.3, 0.3), colorEnd: new THREE.Color(0.8, 0.12, 0.02), alpha: 0.9, gravity: -0.4, drag: 1.2,
    });
  }

  update(dt: number): void {
    this.dustSys.update(dt);
    this.smokeSys.update(dt);
    this.sparkSys.update(dt);
  }
}
