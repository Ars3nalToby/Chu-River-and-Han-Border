import * as THREE from 'three';
import type { Gfx } from '../core/renderer';
import { COLORS, sqWorld } from '../core/constants';
import { FONT_UI, FONT_BRUSH, makeCanvas } from '../core/textures';
import { easeOutCubic } from '../core/util';

const MARK_VERT = /* glsl */ `
attribute float aKind; attribute float aPhase;
varying vec2 vUv; varying float vKind; varying float vPhase;
void main(){
  vUv = uv; vKind = aKind; vPhase = aPhase;
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}`;
const MARK_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying float vKind; varying float vPhase;
void main(){
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float pulse = 0.5 + 0.5 * sin(uTime * 3.2 + vPhase);
  vec3 col; float a;
  if (vKind < 0.5) {
    // glowing ink dot: dark core, jade halo
    float core = smoothstep(0.34, 0.26, r);
    float rim = smoothstep(0.40, 0.34, r) * (1.0 - core);
    float halo = exp(-r * r * 5.5) * (0.45 + 0.35 * pulse);
    vec3 jade = vec3(0.22, 1.0, 0.66);
    col = jade * (halo * 0.9 + rim * 1.6) * (1.0 - core) + vec3(0.01, 0.025, 0.022) * core;
    a = clamp(max(core * 0.94, halo * 0.55 + rim), 0.0, 1.0);
  } else {
    // capture: vermilion ring
    float ring = smoothstep(0.1, 0.0, abs(r - 0.78 + 0.03 * pulse));
    float halo = exp(-pow((r - 0.78) * 4.5, 2.0)) * (0.5 + 0.4 * pulse);
    vec3 red = vec3(1.0, 0.16, 0.08);
    col = red * (ring * 2.0 + halo * 1.1);
    a = clamp(ring + halo * 0.6, 0.0, 1.0);
  }
  gl_FragColor = vec4(col, a);
}`;

const glyphCache = new Map<string, THREE.CanvasTexture>();
function glyphTexture(text: string, big: boolean): THREE.CanvasTexture {
  const key = text + (big ? '#' : '');
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const W = 256, H = 128;
  const { c, g } = makeCanvas(W, H);
  g.clearRect(0, 0, W, H);
  const label = text;
  g.font = big ? `600 44px ${FONT_UI}` : `64px ${FONT_BRUSH}`;
  const w = Math.min(W - 12, g.measureText(label).width + 40);
  g.fillStyle = 'rgba(12,6,6,0.92)';
  g.strokeStyle = '#ff5a40';
  g.lineWidth = 5;
  const x = (W - w) / 2, y = 22, h = H - 44;
  g.beginPath();
  g.roundRect(x, y, w, h, 18);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffd9cc';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, W / 2, H / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  glyphCache.set(key, t);
  return t;
}

interface Warn { s: THREE.Sprite; t: number; dur: number }

export class Highlights {
  readonly group = new THREE.Group();
  private markers: THREE.InstancedMesh;
  private markerMat: THREE.ShaderMaterial;
  private kindAttr: THREE.InstancedBufferAttribute;
  private phaseAttr: THREE.InstancedBufferAttribute;
  private ring: THREE.Mesh;
  private ringGlow: THREE.Mesh;
  private ringT = 0;
  private ringOn = false;
  private trace: THREE.Mesh;
  private traceMat: THREE.ShaderMaterial;
  private traceDots: THREE.Mesh[] = [];
  private traceOn = 0;
  private warns: Warn[] = [];
  private m4 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  static readonly MAX = 48;

  constructor(gfx: Gfx) {
    void gfx;
    /* destination markers */
    const geo = new THREE.PlaneGeometry(0.62, 0.62);
    geo.rotateX(-Math.PI / 2);
    this.markerMat = new THREE.ShaderMaterial({
      vertexShader: MARK_VERT, fragmentShader: MARK_FRAG, transparent: true, depthWrite: false, premultipliedAlpha: false,
      uniforms: { uTime: { value: 0 } },
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.markers = new THREE.InstancedMesh(geo, this.markerMat, Highlights.MAX);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 4;
    this.kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(Highlights.MAX), 1);
    this.phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(Highlights.MAX), 1);
    geo.setAttribute('aKind', this.kindAttr);
    geo.setAttribute('aPhase', this.phaseAttr);
    this.group.add(this.markers);

    /* jade selection ring */
    const jade = new THREE.Color(0.25, 1.6, 1.0);
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.026, 8, 56),
      new THREE.MeshBasicMaterial({ color: jade, transparent: true, opacity: 0.95, depthWrite: false, fog: false }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.ringGlow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 40),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uC: { value: new THREE.Color(0.1, 0.8, 0.5) }, uI: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform vec3 uC; uniform float uI; void main(){ float r = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.45, r) * 0.55 * uI; gl_FragColor = vec4(uC * a, a); }`,
      }),
    );
    this.ringGlow.rotation.x = -Math.PI / 2;
    this.ringGlow.visible = false;
    this.ringGlow.renderOrder = 4;
    this.group.add(this.ring, this.ringGlow);

    /* last-move gold trace */
    this.traceMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uI: { value: 0 }, uC: { value: new THREE.Color(COLORS.gold).multiplyScalar(1.4) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uT; uniform float uI; uniform vec3 uC;
        void main(){ float along = vUv.x; float across = abs(vUv.y - 0.5) * 2.0;
          float line = smoothstep(1.0, 0.2, across); float flow = 0.55 + 0.45 * sin((along * 14.0 - uT * 2.0));
          float a = line * (0.25 + 0.75 * along) * flow * uI * 0.8; gl_FragColor = vec4(uC * a, a); }`,
    });
    const tg = new THREE.PlaneGeometry(1, 0.06);
    tg.rotateX(-Math.PI / 2);
    tg.translate(0.5, 0, 0);
    this.trace = new THREE.Mesh(tg, this.traceMat);
    this.trace.visible = false;
    this.trace.renderOrder = 3;
    this.group.add(this.trace);
    for (let i = 0; i < 2; i++) {
      const d = new THREE.Mesh(
        new THREE.RingGeometry(i ? 0.1 : 0.34, i ? 0.17 : 0.375, 36),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.gold).multiplyScalar(1.3), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
      );
      d.rotation.x = -Math.PI / 2;
      d.visible = false;
      d.renderOrder = 3;
      this.group.add(d);
      this.traceDots.push(d);
    }
  }

  /* ---------------- selection ---------------- */

  select(sq: number | null): void {
    this.ringOn = sq !== null;
    this.ring.visible = this.ringGlow.visible = this.ringOn;
    if (sq !== null) {
      sqWorld(sq, this.v);
      this.ring.position.set(this.v.x, 0.03, this.v.z);
      this.ringGlow.position.set(this.v.x, 0.012, this.v.z);
      this.ringT = 0;
    }
  }

  setTargets(targets: { sq: number; capture: boolean }[]): void {
    const n = Math.min(Highlights.MAX, targets.length);
    for (let i = 0; i < n; i++) {
      sqWorld(targets[i].sq, this.v);
      this.m4.makeTranslation(this.v.x, 0.024, this.v.z);
      this.markers.setMatrixAt(i, this.m4);
      this.kindAttr.setX(i, targets[i].capture ? 1 : 0);
      this.phaseAttr.setX(i, (i * 0.7) % 6.28);
    }
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
    this.kindAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
  }

  clear(): void {
    this.select(null);
    this.markers.count = 0;
  }

  /* ---------------- last move ---------------- */

  showLastMove(from: number, to: number): void {
    const a = sqWorld(from, new THREE.Vector3()), b = sqWorld(to, new THREE.Vector3());
    const d = b.clone().sub(a);
    const len = Math.hypot(d.x, d.z);
    this.trace.position.set(a.x, 0.02, a.z);
    this.trace.scale.set(Math.max(0.01, len), 1, 1);
    this.trace.rotation.y = -Math.atan2(d.z, d.x);
    this.trace.visible = true;
    this.traceDots[0].position.set(a.x, 0.02, a.z);
    this.traceDots[1].position.set(b.x, 0.02, b.z);
    this.traceDots[0].visible = this.traceDots[1].visible = true;
    this.traceOn = 1;
  }

  clearLastMove(): void {
    this.traceOn = 0;
    this.trace.visible = false;
    this.traceDots.forEach((d) => (d.visible = false));
  }

  /* ---------------- rule-teaching glyphs ---------------- */

  /** float a short warning glyph above a piece (the blocker of a horse leg / elephant eye) */
  warn(sq: number, text: string, big = false, dur = 1.8, scale = 0): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTexture(text, big), transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
    sqWorld(sq, this.v);
    s.position.set(this.v.x, 1.65, this.v.z);
    const k = scale || (big ? 1.5 : 0.8);
    s.scale.set(k * 2, k, 1);
    s.renderOrder = 60;
    this.group.add(s);
    this.warns.push({ s, t: 0, dur });
  }

  update(dt: number, time: number): void {
    this.markerMat.uniforms.uTime.value = time;
    this.traceMat.uniforms.uT.value = time;
    this.traceMat.uniforms.uI.value += (this.traceOn - this.traceMat.uniforms.uI.value) * Math.min(1, dt * 4);
    if (this.ringOn) {
      this.ringT += dt;
      const p = 1 + 0.05 * Math.sin(this.ringT * 5);
      this.ring.scale.setScalar(p);
      (this.ringGlow.material as THREE.ShaderMaterial).uniforms.uI.value = 0.7 + 0.3 * Math.sin(this.ringT * 5);
    }
    for (let i = this.warns.length - 1; i >= 0; i--) {
      const w = this.warns[i];
      w.t += dt;
      const u = w.t / w.dur;
      (w.s.material as THREE.SpriteMaterial).opacity = Math.min(1, w.t * 6) * (1 - Math.max(0, (u - 0.6) / 0.4));
      w.s.position.y = 1.65 + easeOutCubic(Math.min(1, u)) * 0.25;
      if (u >= 1) {
        w.s.removeFromParent();
        (w.s.material as THREE.SpriteMaterial).dispose();
        this.warns.splice(i, 1);
      }
    }
  }
}
