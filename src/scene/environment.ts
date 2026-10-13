import * as THREE from 'three';
import type { Gfx, QualitySettings } from '../core/renderer';
import { FONT_BRUSH, makeCanvas, mistTexture, softDotTexture } from '../core/textures';
import { fbm2, fbm2p, mulberry32, noise2, noise2p } from '../core/util';
import { GROUND_Y } from '../core/constants';

/** Positions shared with Lighting (brazier PointLights live there). */
export const BRAZIER_POS: [number, number][] = [
  [-4.9, 8.0],
  [4.9, 8.0],
  [-4.9, -8.0],
];

/* ───────────────────────────── helpers ───────────────────────────── */

function ridgeTexture(seed: number, body: [number, number, number], rim: [number, number, number], amp: number, freq: number, mist: [number, number, number]): THREE.CanvasTexture {
  const W = 2048, H = 384;
  const { c, g } = makeCanvas(W, H);
  g.clearRect(0, 0, W, H);
  const ridge = (x: number, shift: number) => {
    const a = (x / W) * Math.PI * 2;
    const n = fbm2(Math.cos(a) * freq + seed + shift, Math.sin(a) * freq + seed * 1.7, 6);
    // ridged noise → pointed crests with long saddles, like ink-wash mountains
    const ridged = 1 - Math.abs(n * 2 - 1);
    const peaks = Math.pow(ridged, 2.2) * 0.75 + Math.pow(n, 1.6) * 0.35;
    return H * (0.9 - amp * peaks);
  };
  // three offset washes → brushy edge
  for (let layer = 0; layer < 3; layer++) {
    const shift = layer * 0.31;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, ridge(x, shift) + layer * 5);
    g.lineTo(W, H);
    g.closePath();
    const grd = g.createLinearGradient(0, H * 0.15, 0, H);
    const a = layer === 0 ? 1 : 0.55;
    grd.addColorStop(0, `rgba(${body[0]},${body[1]},${body[2]},${a})`);
    grd.addColorStop(0.55, `rgba(${body[0]},${body[1]},${body[2]},${a * 0.9})`);
    grd.addColorStop(1, `rgba(${mist[0]},${mist[1]},${mist[2]},0.0)`);
    g.fillStyle = grd;
    g.fill();
  }
  // moon-lit rim along the crest
  g.beginPath();
  for (let x = 0; x <= W; x += 3) {
    const y = ridge(x, 0);
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokeStyle = `rgba(${rim[0]},${rim[1]},${rim[2]},0.28)`;
  g.lineWidth = 2;
  g.stroke();
  // vertical ink drips / mist veins
  const rnd = mulberry32(seed * 13);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W;
    const y0 = ridge(x, 0) + 10;
    const len = 30 + rnd() * 120;
    const grd = g.createLinearGradient(0, y0, 0, y0 + len);
    grd.addColorStop(0, `rgba(${mist[0]},${mist[1]},${mist[2]},0.0)`);
    grd.addColorStop(0.5, `rgba(${mist[0]},${mist[1]},${mist[2]},0.16)`);
    grd.addColorStop(1, `rgba(${mist[0]},${mist[1]},${mist[2]},0)`);
    g.fillStyle = grd;
    g.fillRect(x, y0, 3 + rnd() * 9, len);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function moonTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = makeCanvas(S);
  const grd = g.createRadialGradient(S / 2 - 40, S / 2 - 40, 20, S / 2, S / 2, S / 2 - 6);
  grd.addColorStop(0, '#f6f4ea');
  grd.addColorStop(0.7, '#d9dccf');
  grd.addColorStop(1, '#a8b0bd');
  g.save();
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // maria — soft grey patches
  for (let i = 0; i < 20; i++) {
    const x = 90 + noise2(i * 3.1, 1) * 330, y = 90 + noise2(i * 1.7, 9) * 330, r = 22 + noise2(i, 5) * 62;
    const m = g.createRadialGradient(x, y, 0, x, y, r);
    m.addColorStop(0, 'rgba(110,118,132,0.34)');
    m.addColorStop(1, 'rgba(110,118,132,0)');
    g.fillStyle = m;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function groundTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = makeCanvas(S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm2p((x / S) * 10, (y / S) * 10, 10, 4) * 0.7 + noise2p((x / S) * 128, (y / S) * 128, 128) * 0.3;
      const v = 18 + n * 36;
      const i = (y * S + x) * 4;
      img.data[i] = v * 0.92;
      img.data[i + 1] = v * 1.0;
      img.data[i + 2] = v * 0.95;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // sparse grass strokes
  const rnd = mulberry32(5);
  g.strokeStyle = 'rgba(40,52,38,0.35)';
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * S, y = rnd() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 4, y - 3 - rnd() * 6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(70, 70);
  t.anisotropy = 4;
  return t;
}

function bannerTexture(char: string, kind: 'han' | 'chu'): THREE.CanvasTexture {
  const W = 384, H = 576;
  const { c, g } = makeCanvas(W, H);
  const cloth = kind === 'han' ? ['#7d1d14', '#561009'] : ['#1a1d27', '#0d0f15'];
  const trim = kind === 'han' ? '#c9a24a' : '#9aa0a6';
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, cloth[0]);
  grd.addColorStop(1, cloth[1]);
  g.clearRect(0, 0, W, H);
  // swallow-tail silhouette (alpha cut)
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(W, 0);
  g.lineTo(W, H);
  g.lineTo(W * 0.62, H - 74);
  g.lineTo(0, H);
  g.closePath();
  g.fillStyle = grd;
  g.fill();
  g.save();
  g.clip();
  // weave
  g.globalAlpha = 0.07;
  for (let y = 0; y < H; y += 3) {
    g.fillStyle = y % 6 ? '#000' : '#fff';
    g.fillRect(0, y, W, 1);
  }
  g.globalAlpha = 1;
  // trim border
  g.strokeStyle = trim;
  g.lineWidth = 7;
  g.strokeRect(14, 14, W - 28, H - 28 - 20);
  g.lineWidth = 2;
  g.strokeRect(28, 28, W - 56, H - 56 - 20);
  // character
  g.font = `340px ${FONT_BRUSH}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = kind === 'han' ? '#f1dca0' : '#d4d9e2';
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 14;
  g.fillText(char, W / 2, H / 2 - 20);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** gentle rolling plain; flat around the board and along the river corridor */
export function terrainY(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const sm = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const mask = sm(15, 48, r) * sm(3.5, 11, Math.abs(z));
  const h = (fbm2(x * 0.018 + 40, z * 0.018 + 17, 4) - 0.42) * 9 + (fbm2(x * 0.06, z * 0.06, 2) - 0.5) * 1.2;
  return GROUND_Y + Math.max(-0.4, h) * mask;
}

/* ───────────────────────────── fire ───────────────────────────── */

const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FLAME_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float time; uniform float seed; uniform float power;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
void main(){
  vec2 p = vec2((vUv.x-0.5)*2.0, vUv.y);
  float n = fbm(vec2(p.x*2.2 + seed, p.y*2.6 - time*2.1));
  float n2 = fbm(vec2(p.x*4.0 - seed, p.y*4.5 - time*3.4));
  float width = mix(0.78, 0.06, pow(p.y, 0.85));
  float d = abs(p.x + (n-0.5)*0.55*p.y) / width;
  float body = smoothstep(1.0, 0.25, d + n2*0.22*p.y);
  body *= smoothstep(1.0, 0.18, p.y + n*0.38);
  body *= smoothstep(0.0, 0.07, p.y);
  float core = smoothstep(0.62, 0.0, d + p.y*0.5) * smoothstep(0.75, 0.05, p.y);
  vec3 col = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.62, 0.12), body);
  col = mix(col, vec3(1.0, 0.92, 0.62), core*0.85);
  float a = clamp(body, 0.0, 1.0);
  gl_FragColor = vec4(col * (1.2 + 1.3*core) * power, a);
}`;

function makeFlame(seed: number, power = 1): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1.0, 1.7, 1, 1);
  geo.translate(0, 0.85, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: { time: { value: 0 }, seed: { value: seed }, power: { value: power } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = (i * Math.PI) / 3;
    m.renderOrder = 20;
    g.add(m);
  }
  g.userData.mat = mat;
  return g;
}

function makeBrazier(): THREE.Group {
  const g = new THREE.Group();
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6b4b2a, roughness: 0.42, metalness: 0.88 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.6, metalness: 0.7 });
  // bowl (lathe)
  const prof: THREE.Vector2[] = [];
  const pts: [number, number][] = [[0, 0], [0.12, 0.0], [0.34, 0.08], [0.52, 0.28], [0.6, 0.5], [0.64, 0.62], [0.6, 0.66], [0.56, 0.6], [0.5, 0.45], [0.3, 0.2], [0.1, 0.1]];
  for (const [x, y] of pts) prof.push(new THREE.Vector2(x, y));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), bronze);
  bowl.position.y = 0.92;
  bowl.castShadow = true;
  g.add(bowl);
  // rim ring and bands
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.61, 0.035, 8, 40), bronze);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.58;
  g.add(rim);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 8, 36), dark);
  band.rotation.x = Math.PI / 2;
  band.position.y = 1.28;
  g.add(band);
  // legs: three tapered, splayed
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 1.05, 8), bronze);
    leg.position.set(Math.cos(a) * 0.27, 0.5, Math.sin(a) * 0.27);
    leg.rotation.z = Math.cos(a) * -0.2;
    leg.rotation.x = Math.sin(a) * 0.2;
    leg.castShadow = true;
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), dark);
    foot.position.set(Math.cos(a) * 0.36, 0.06, Math.sin(a) * 0.36);
    g.add(foot);
  }
  // glowing coals
  const coals = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.45, 0.08), fog: false }),
  );
  coals.rotation.x = -Math.PI / 2;
  coals.position.y = 1.42;
  g.add(coals);
  return g;
}

/* ───────────────────────────── banners ───────────────────────────── */

function makeBanner(kind: 'han' | 'chu', char: string, outwardSign: number): { group: THREE.Group; mat: THREE.MeshStandardMaterial; uniforms: { time: { value: number } } } {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.7, metalness: 0.1 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xa88a3c, roughness: 0.35, metalness: 0.9 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 5.6, 10), wood);
  pole.position.y = 2.8;
  pole.castShadow = true;
  g.add(pole);
  const spear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 4), brass);
  spear.position.y = 5.8;
  g.add(spear);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), brass);
  knob.position.y = 5.55;
  g.add(knob);
  // crossbar
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6), wood);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(-outwardSign * 0.7, 5.2, 0);
  g.add(bar);

  const uniforms = { time: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({
    map: bannerTexture(char, kind),
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
  });
  const poleOnRight = outwardSign > 0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.time;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float k = ${poleOnRight ? '1.0 - uv.x' : 'uv.x'};  // 0 at the pole edge, 1 at the free edge
       float w = sin(position.x * 3.4 + uTime * 2.6 + position.y * 1.1) * 0.5
               + sin(position.x * 6.1 - uTime * 3.7) * 0.18;
       transformed.z += w * (0.04 + 0.2 * k) * k * 1.6;
       transformed.y -= k * k * 0.05 * sin(uTime * 1.7 + position.x);`,
    );
  };
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.9, 24, 16), mat);
  cloth.position.set(-outwardSign * 0.7, 4.2, 0);
  g.add(cloth);
  return { group: g, mat, uniforms };
}

/* ───────────────────────────── main class ───────────────────────────── */

export class Environment {
  readonly group = new THREE.Group();
  private flames: THREE.Group[] = [];
  private bannerUniforms: { time: { value: number } }[] = [];
  private starMat: THREE.ShaderMaterial;
  private embers: THREE.Points;
  private emberMat: THREE.ShaderMaterial;
  private motes: THREE.Points;
  private moteMat: THREE.ShaderMaterial;
  private mist: { sprite: THREE.Sprite; speed: number; baseX: number; span: number }[] = [];
  private beam: THREE.Mesh;
  private sky: THREE.Mesh;

  constructor(private gfx: Gfx) {
    const scene = gfx.scene;
    scene.add(this.group);
    const g = this.group;

    /* sky dome */
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          varying vec3 vDir;
          void main(){
            float h = vDir.y;
            vec3 horizon = vec3(0.050, 0.066, 0.110);
            vec3 zenith  = vec3(0.006, 0.010, 0.026);
            vec3 col = mix(horizon, zenith, pow(clamp(h * 1.5, 0.0, 1.0), 0.55));
            // faint warm glow of the Red camp (+Z) and cold sheen from the Black side (−Z)
            float warm = smoothstep(-0.1, 0.9, vDir.z) * exp(-abs(h) * 7.0);
            float cold = smoothstep(0.1, -0.9, vDir.z) * exp(-abs(h) * 5.0);
            col += vec3(0.20, 0.085, 0.03) * warm * 0.55;
            col += vec3(0.03, 0.07, 0.15) * cold * 0.7;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.sky.renderOrder = -10;
    g.add(this.sky);

    /* stars */
    {
      const N = 1100;
      const pos = new Float32Array(N * 3), ph = new Float32Array(N), sz = new Float32Array(N);
      const r = mulberry32(99);
      for (let i = 0; i < N; i++) {
        const u = r(), v = r();
        const theta = u * Math.PI * 2;
        const y = Math.pow(v, 0.8) * 0.97 + 0.03;
        const rad = Math.sqrt(1 - y * y);
        pos.set([Math.cos(theta) * rad * 400, y * 400, Math.sin(theta) * rad * 400], i * 3);
        ph[i] = r() * 6.28;
        sz[i] = 0.7 + Math.pow(r(), 6) * 2.2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
      this.starMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 }, px: { value: 1 } },
        vertexShader: `attribute float aPhase; attribute float aSize; uniform float time; uniform float px; varying float vA;
          void main(){ vA = 0.55 + 0.45 * sin(time * (0.8 + aSize * 0.4) + aPhase);
            gl_PointSize = aSize * px * (1.0 + 0.2 * vA); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = smoothstep(0.5, 0.0, length(c));
          gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * 0.9 * vA, d * vA); }`,
      });
      const stars = new THREE.Points(geo, this.starMat);
      stars.renderOrder = -9;
      stars.frustumCulled = false;
      g.add(stars);
    }

    /* moon + halo */
    {
      const dir = new THREE.Vector3(0.34, 0.2, -0.92).normalize();
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softDotTexture(), color: new THREE.Color(0.38, 0.5, 0.85), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      }));
      halo.scale.setScalar(150);
      halo.position.copy(dir).multiplyScalar(360);
      halo.renderOrder = -8;
      const halo2 = halo.clone();
      halo2.material = (halo.material as THREE.SpriteMaterial).clone();
      (halo2.material as THREE.SpriteMaterial).color.set(0.18, 0.26, 0.5);
      halo2.scale.setScalar(300);
      const moon = new THREE.Sprite(new THREE.SpriteMaterial({
        map: moonTexture(), color: new THREE.Color(1.5, 1.5, 1.45), transparent: true, depthWrite: false, fog: false,
      }));
      moon.scale.setScalar(34);
      moon.position.copy(dir).multiplyScalar(358);
      moon.renderOrder = -7;
      g.add(halo2, halo, moon);
    }

    /* mountains — three ink-wash cylinders, no scene fog (hand-tuned haze instead) */
    {
      const layers = [
        { r: 300, h: 70, y: -4, seed: 3, body: [26, 38, 60] as [number, number, number], rim: [150, 180, 230] as [number, number, number], amp: 0.8, freq: 1.2, mist: [34, 48, 74] as [number, number, number], order: -6 },
        { r: 230, h: 52, y: -4, seed: 11, body: [14, 22, 38] as [number, number, number], rim: [120, 150, 200] as [number, number, number], amp: 0.78, freq: 1.5, mist: [26, 38, 62] as [number, number, number], order: -5 },
        { r: 165, h: 34, y: -3.5, seed: 29, body: [8, 13, 22] as [number, number, number], rim: [90, 120, 170] as [number, number, number], amp: 0.7, freq: 1.9, mist: [20, 30, 50] as [number, number, number], order: -4 },
      ];
      for (const L of layers) {
        const tex = ridgeTexture(L.seed, L.body, L.rim, L.amp, L.freq, L.mist);
        const m = new THREE.Mesh(
          new THREE.CylinderGeometry(L.r, L.r, L.h, 96, 1, true),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }),
        );
        m.position.y = L.y + L.h / 2;
        m.renderOrder = L.order;
        g.add(m);
      }
    }

    /* ground */
    {
      const gg = new THREE.PlaneGeometry(900, 900, 128, 128);
      gg.rotateX(-Math.PI / 2);
      const gp = gg.attributes.position;
      for (let i = 0; i < gp.count; i++) gp.setY(i, terrainY(gp.getX(i), gp.getZ(i)) - GROUND_Y);
      gg.computeVertexNormals();
      const ground = new THREE.Mesh(
        gg,
        new THREE.MeshStandardMaterial({ map: groundTexture(), color: 0xffffff, roughness: 0.96, metalness: 0 }),
      );
      ground.position.y = GROUND_Y;
      ground.receiveShadow = true;
      g.add(ground);

      // planted spears + boulders
      const r = mulberry32(21);
      const shaftGeo = new THREE.CylinderGeometry(0.018, 0.022, 2.6, 5);
      shaftGeo.translate(0, 1.3, 0);
      const bladeGeo = new THREE.ConeGeometry(0.06, 0.34, 4);
      bladeGeo.translate(0, 2.77, 0);
      const spearMat = new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 0.8 });
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x6f757c, roughness: 0.4, metalness: 0.85 });
      const N = 46;
      const shafts = new THREE.InstancedMesh(shaftGeo, spearMat, N);
      const blades = new THREE.InstancedMesh(bladeGeo, bladeMat, N);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        const a = r() * Math.PI * 2;
        const rad = 15 + r() * 40;
        p.set(Math.cos(a) * rad, terrainY(Math.cos(a) * rad, Math.sin(a) * rad) - 0.15, Math.sin(a) * rad);
        e.set((r() - 0.5) * 0.35, r() * 6, (r() - 0.5) * 0.35);
        q.setFromEuler(e);
        s.setScalar(0.8 + r() * 0.6);
        m4.compose(p, q, s);
        shafts.setMatrixAt(i, m4);
        blades.setMatrixAt(i, m4);
      }
      shafts.castShadow = true;
      g.add(shafts, blades);

      const rockGeo = new THREE.IcosahedronGeometry(1, 1);
      const pa = rockGeo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const k = 0.75 + noise2(pa.getX(i) * 2.1 + 5, pa.getZ(i) * 2.1 + pa.getY(i)) * 0.5;
        pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k * 0.7, pa.getZ(i) * k);
      }
      rockGeo.computeVertexNormals();
      const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.95 }), 38);
      for (let i = 0; i < 38; i++) {
        const a = r() * Math.PI * 2;
        const rad = 12 + r() * 60;
        const sc = 0.4 + r() * r() * 2.6;
        p.set(Math.cos(a) * rad, terrainY(Math.cos(a) * rad, Math.sin(a) * rad) + sc * 0.2, Math.sin(a) * rad);
        q.setFromEuler(e.set(r() * 3, r() * 6, r() * 3));
        m4.compose(p, q, s.set(sc * (1 + r() * 0.6), sc, sc * (1 + r() * 0.6)));
        rocks.setMatrixAt(i, m4);
      }
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      g.add(rocks);
    }

    /* distant camps: tents + campfires. Warm and busy behind Red, sparse and cold behind Black */
    {
      const r = mulberry32(303);
      const tentGeo = new THREE.ConeGeometry(1, 1, 7);
      tentGeo.translate(0, 0.5, 0);
      const mk = (color: number, n: number, zMin: number, zMax: number, glow: THREE.Color, fires: number) => {
        const tents = new THREE.InstancedMesh(tentGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }), n);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          const x = (r() - 0.5) * 70;
          const z = zMin + r() * (zMax - zMin);
          const w = 2.4 + r() * 1.6, h = 2.2 + r() * 1.6;
          p.set(x, terrainY(x, z) - 0.1, z);
          q.setFromEuler(e.set(0, r() * 6, 0));
          m4.compose(p, q, sc.set(w, h, w));
          tents.setMatrixAt(i, m4);
        }
        tents.castShadow = false;
        g.add(tents);
        for (let i = 0; i < fires; i++) {
          const x = (r() - 0.5) * 66, z = zMin + r() * (zMax - zMin);
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
          s.scale.setScalar(1.3 + r() * 1.1);
          s.position.set(x, terrainY(x, z) + 0.4, z);
          s.renderOrder = 12;
          g.add(s);
        }
      };
      mk(0x1e1612, 9, 22, 46, new THREE.Color(1.3, 0.42, 0.1), 12);      // Red camp (+Z, behind the player)
      mk(0x14171e, 7, -58, -30, new THREE.Color(0.5, 0.3, 0.12), 8);   // Black camp (−Z): fewer, dimmer fires
    }

    /* braziers + flames */
    BRAZIER_POS.forEach(([x, z], i) => {
      const b = makeBrazier();
      b.position.set(x, GROUND_Y, z);
      g.add(b);
      const f = makeFlame(i * 7.3 + 1, i === 2 ? 0.55 : 1);
      const sc = i === 2 ? 0.75 : 1.25;
      f.scale.setScalar(sc);
      f.position.set(x, GROUND_Y + 1.5, z);
      g.add(f);
      this.flames.push(f);
      // glow sprite
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softDotTexture(), color: new THREE.Color(i === 2 ? 0.5 : 1.1, i === 2 ? 0.22 : 0.42, 0.07), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      glow.scale.setScalar(i === 2 ? 2.6 : 3.6);
      glow.position.set(x, GROUND_Y + 2.1, z);
      g.add(glow);
    });

    /* banners: 漢 on Red's side, 楚 on Black's */
    const bannerSpots: [number, number, 'han' | 'chu', string][] = [
      [-8.0, 6.4, 'han', '漢'],
      [8.0, 6.4, 'han', '漢'],
      [-8.0, -6.4, 'chu', '楚'],
      [8.0, -6.4, 'chu', '楚'],
    ];
    for (const [x, z, kind, ch] of bannerSpots) {
      const b = makeBanner(kind, ch, Math.sign(x));
      b.group.position.set(x, GROUND_Y, z);
      g.add(b.group);
      this.bannerUniforms.push(b.uniforms);
    }

    /* embers */
    {
      const MAX = 800;
      const origin = new Float32Array(MAX * 3), ph = new Float32Array(MAX), sp = new Float32Array(MAX), sz = new Float32Array(MAX);
      const r = mulberry32(8);
      for (let i = 0; i < MAX; i++) {
        const b = i % 5 === 4 ? 2 : i % 2; // fewer from the dim brazier
        origin.set([BRAZIER_POS[b][0] + (r() - 0.5) * 0.7, GROUND_Y + 1.6, BRAZIER_POS[b][1] + (r() - 0.5) * 0.7], i * 3);
        ph[i] = r() * 10;
        sp[i] = 0.35 + r() * 0.8;
        sz[i] = 1 + r() * 2.2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(origin, 3));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      geo.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
      this.emberMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        uniforms: { time: { value: 0 }, px: { value: 1 } },
        vertexShader: `
          attribute float aPhase; attribute float aSpeed; attribute float aSize; uniform float time; uniform float px; varying float vL;
          void main(){
            float life = fract(aPhase * 0.173 + time * aSpeed * 0.11);
            vec3 p = position;
            p.y += life * 9.0 * (0.6 + aSpeed);
            p.x += sin(time * 0.9 + aPhase * 3.0) * (0.25 + life * 1.4) + life * 0.9;
            p.z += cos(time * 0.7 + aPhase * 2.0) * (0.25 + life * 1.0);
            vL = life;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = aSize * px * (6.0 / -mv.z) * (1.0 - life * 0.7) * (0.8 + 0.4 * sin(time * 13.0 + aPhase * 9.0));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `varying float vL; void main(){ float d = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          vec3 c = mix(vec3(2.4, 0.9, 0.2), vec3(1.2, 0.2, 0.03), vL); gl_FragColor = vec4(c, d * (1.0 - vL)); }`,
      });
      this.embers = new THREE.Points(geo, this.emberMat);
      this.embers.frustumCulled = false;
      g.add(this.embers);
    }

    /* dust motes drifting in the key-light volume */
    {
      const MAX = 420;
      const pos = new Float32Array(MAX * 3), ph = new Float32Array(MAX);
      const r = mulberry32(44);
      for (let i = 0; i < MAX; i++) {
        pos.set([(r() - 0.5) * 18, r() * 7.5 - 0.5, (r() - 0.5) * 20], i * 3);
        ph[i] = r() * 20;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      this.moteMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        uniforms: { time: { value: 0 }, px: { value: 1 } },
        vertexShader: `
          attribute float aPhase; uniform float time; uniform float px; varying float vA;
          void main(){
            vec3 p = position;
            p.x += sin(time * 0.17 + aPhase) * 0.9; p.y += sin(time * 0.23 + aPhase * 1.7) * 0.55; p.z += cos(time * 0.15 + aPhase * 0.7) * 0.9;
            // brighter inside the central light shaft above the board
            float shaft = exp(-dot(p.xz - vec2(0.8, 2.0), p.xz - vec2(0.8, 2.0)) * 0.03);
            vA = 0.15 + 0.85 * shaft * (0.6 + 0.4 * sin(time * 0.9 + aPhase * 5.0));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = px * clamp(26.0 / -mv.z, 1.0, 4.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `varying float vA; void main(){ float d = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * 0.9, d * vA * 0.5); }`,
      });
      this.motes = new THREE.Points(geo, this.moteMat);
      this.motes.frustumCulled = false;
      g.add(this.motes);
    }

    /* faint volumetric shaft from the key spot */
    {
      const geo = new THREE.ConeGeometry(8.2, 15, 40, 1, true);
      geo.translate(0, -7.5, 0);
      this.beam = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
          uniforms: { color: { value: new THREE.Color(0xffd9b0) } },
          vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
            void main(){ vH = position.y / -15.0; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
          fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV; varying float vH;
            void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = f * (1.0 - vH) * 0.016 * smoothstep(0.0, 0.1, vH);
              gl_FragColor = vec4(color * a * 2.0, a); }`,
        }),
      );
      this.beam.position.copy(new THREE.Vector3(1.5, 15, 4.5));
      this.beam.lookAt(0, 0, 0);
      this.beam.rotateX(Math.PI / 2); // cone axis → toward the board
      this.beam.renderOrder = 15;
      g.add(this.beam);
    }

    /* low ground mist banks */
    {
      const tex = [mistTexture(2), mistTexture(5), mistTexture(8)];
      const r = mulberry32(61);
      for (let i = 0; i < 28; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex[i % 3], color: new THREE.Color(0.10, 0.13, 0.22), transparent: true, opacity: 0.16 + r() * 0.12, depthWrite: false, fog: true,
        }));
        const sc = 9 + r() * 12;
        s.scale.set(sc * 1.6, sc * 0.2, 1);
        // keep the banks of mist out on the plain — never hovering over the board itself
        const ang = r() * Math.PI * 2, rad = 14 + r() * 48;
        s.position.set(Math.cos(ang) * rad, GROUND_Y + 0.3 + r() * 0.7, Math.sin(ang) * rad);
        s.renderOrder = 5;
        g.add(s);
        this.mist.push({ sprite: s, speed: 0.15 + r() * 0.3, baseX: s.position.x, span: 50 });
      }
    }

    this.applyQuality(gfx.quality);
    gfx.onQuality((q) => this.applyQuality(q));
  }

  private applyQuality(q: QualitySettings) {
    const px = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap);
    this.starMat.uniforms.px.value = px * 1.6;
    this.emberMat.uniforms.px.value = px * 2.6;
    this.moteMat.uniforms.px.value = px;
    this.embers.geometry.setDrawRange(0, q.embers);
    this.motes.geometry.setDrawRange(0, q.motes);
    this.beam.visible = q.name !== 'low';
    this.mist.forEach((m, i) => (m.sprite.visible = i < q.mist));
  }

  update(dt: number, time: number): void {
    this.starMat.uniforms.time.value = time;
    this.emberMat.uniforms.time.value = time;
    this.moteMat.uniforms.time.value = time;
    for (const f of this.flames) f.userData.mat.uniforms.time.value = time;
    for (const b of this.bannerUniforms) b.time.value = time;
    for (const m of this.mist) {
      m.sprite.position.x += m.speed * dt;
      if (m.sprite.position.x > m.baseX + m.span) m.sprite.position.x -= m.span * 2;
    }
  }
}
