import * as THREE from 'three';
import type { Gfx, QualitySettings } from '../core/renderer';
import { mistTexture } from '../core/textures';
import { mulberry32 } from '../core/util';
import { GROUND_Y, WATER_HALF } from '../core/constants';

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uMoonDir;
uniform float uFancy;
uniform float uBarrier;     // elephant selected → faint glowing barrier
uniform float uEdge;        // foam width factor
uniform float uFlowSpeed;
varying vec2 vUv;
varying vec3 vWorld;

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1.0,0.0)), f.x), mix(h21(i+vec2(0.0,1.0)), h21(i+vec2(1.0,1.0)), f.x), f.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p*2.07 + 17.3; a *= 0.5; } return s; }

vec3 waterNormal(vec2 p, float t){
  // two scrolling noise layers → height field → finite-difference normal
  vec2 f = vec2(t * uFlowSpeed, 0.0);
  float e = 0.06;
  float h  = fbm(p * 1.7 - f) + 0.5 * fbm(p * 3.9 + vec2(t * 0.08, -t * 0.11));
  float hx = fbm((p + vec2(e, 0.0)) * 1.7 - f) + 0.5 * fbm((p + vec2(e, 0.0)) * 3.9 + vec2(t * 0.08, -t * 0.11));
  float hz = fbm((p + vec2(0.0, e)) * 1.7 - f) + 0.5 * fbm((p + vec2(0.0, e)) * 3.9 + vec2(t * 0.08, -t * 0.11));
  return normalize(vec3((h - hx) * 1.1, 1.0, (h - hz) * 1.1));
}

void main() {
  vec3 col;
  float alpha = 1.0;
  float edge = min(vUv.y, 1.0 - vUv.y);          // 0 at the banks
  if (uFancy > 0.5) {
    vec3 n = waterNormal(vWorld.xz, uTime);
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
    vec3 R = reflect(-V, n);
    // reflected sky: dark blue-black with a pale moon-side sheen and warm Red-side glow
    vec3 sky = mix(vec3(0.015, 0.025, 0.05), vec3(0.07, 0.11, 0.2), clamp(R.y * 1.3 + 0.2, 0.0, 1.0));
    sky += vec3(0.5, 0.2, 0.06) * smoothstep(0.1, 1.0, R.z) * 0.12;
    float moon = pow(max(dot(R, normalize(uMoonDir)), 0.0), 140.0) * 4.0;
    float moonSoft = pow(max(dot(R, normalize(uMoonDir)), 0.0), 18.0) * 0.5;
    vec3 deep = vec3(0.004, 0.017, 0.026);
    col = mix(deep, sky, 0.12 + fres * 0.7);
    col += vec3(0.75, 0.88, 1.2) * moon + vec3(0.1, 0.17, 0.3) * moonSoft;
    // slow bright ripples
    float rip = smoothstep(0.62, 0.92, fbm(vWorld.xz * 6.0 + vec2(-uTime * 0.6, uTime * 0.15)));
    col += vec3(0.20, 0.30, 0.42) * rip * 0.10;
    // foam at the banks
    float fn = fbm(vWorld.xz * 9.0 + vec2(-uTime * 0.5, uTime * 0.2));
    float foam = smoothstep(0.16 * uEdge, 0.0, edge - fn * 0.06) * 0.6;
    col = mix(col, vec3(0.20, 0.27, 0.34), foam * (0.3 + 0.4 * fn));
  } else {
    float t = fbm(vWorld.xz * 3.0 - vec2(uTime * uFlowSpeed, 0.0));
    col = mix(vec3(0.015, 0.04, 0.06), vec3(0.08, 0.13, 0.2), t);
    col = mix(col, vec3(0.5, 0.6, 0.7), smoothstep(0.15, 0.0, edge) * 0.4);
  }
  // elephant barrier shimmer
  if (uBarrier > 0.001) {
    float s = 0.5 + 0.5 * sin(vWorld.x * 7.0 - uTime * 3.0 + vnoise(vWorld.xz * 4.0) * 5.0);
    col += vec3(0.2, 0.62, 0.9) * (0.3 + 0.7 * s) * uBarrier * 0.8;
  }
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

function makeWaterMaterial(fancy: boolean, edge: number, flow: number): THREE.ShaderMaterial {
  const u = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(-0.3, 0.27, -0.92) },
      uFancy: { value: fancy ? 1 : 0 },
      uBarrier: { value: 0 },
      uEdge: { value: edge },
      uFlowSpeed: { value: flow },
    },
  ]);
  return new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, fog: true });
}

/**
 * The river: a shallow channel on the board top plus a wider ribbon of the same water
 * flowing at ground level beneath the plinth (so the board reads as a bridge over the Chu-Han river).
 */
export class River {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private mist: { s: THREE.Sprite; vx: number; x0: number }[] = [];
  private barrierTarget = 0;
  private barrier = 0;

  constructor(gfx: Gfx, boardWidth: number) {
    // channel on the board
    const chanMat = makeWaterMaterial(true, 1.0, 0.22);
    const chan = new THREE.Mesh(new THREE.PlaneGeometry(boardWidth + 1.2, WATER_HALF * 2, 1, 1), chanMat);
    chan.rotation.x = -Math.PI / 2;
    chan.position.set(0, -0.1, 0);
    chan.renderOrder = 1;
    this.group.add(chan);
    this.mats.push(chanMat);

    // ground-level ribbon (wider than the tunnel, runs out to the horizon)
    const ribMat = makeWaterMaterial(true, 0.35, 0.5);
    const rib = new THREE.Mesh(new THREE.PlaneGeometry(900, 3.4, 1, 1), ribMat);
    rib.rotation.x = -Math.PI / 2;
    rib.position.set(0, GROUND_Y + 0.05, 0);
    this.group.add(rib);
    this.mats.push(ribMat);

    // low mist drifting over the channel and the ribbon
    const tex = [mistTexture(3), mistTexture(6)];
    const r = mulberry32(77);
    for (let i = 0; i < 20; i++) {
      const onBoard = i < 8;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex[i % 2], color: new THREE.Color(0.2, 0.27, 0.4), transparent: true, depthWrite: false,
        opacity: onBoard ? 0.1 : 0.2,
      }));
      if (onBoard) {
        s.scale.set(2.8 + r() * 1.4, 0.6, 1);
        s.position.set((r() - 0.5) * (boardWidth + 4), 0.16 + r() * 0.12, (r() - 0.5) * 0.3);
      } else {
        s.scale.set(6 + r() * 6, 1.6, 1);
        s.position.set((r() - 0.5) * 40, GROUND_Y + 0.4 + r() * 0.5, (r() - 0.5) * 3);
      }
      s.renderOrder = 6;
      this.group.add(s);
      this.mist.push({ s, vx: 0.08 + r() * 0.12, x0: s.position.x });
    }

    this.applyQuality(gfx.quality);
    gfx.onQuality((q) => this.applyQuality(q));
  }

  private applyQuality(q: QualitySettings) {
    for (const m of this.mats) m.uniforms.uFancy.value = q.riverFancy ? 1 : 0;
    this.mist.forEach((m, i) => (m.s.visible = q.name !== 'low' || i % 3 === 0));
  }

  /** elephant selected → river glows faintly as the barrier it cannot cross */
  setBarrier(on: boolean) {
    this.barrierTarget = on ? 1 : 0;
  }

  update(dt: number, time: number) {
    this.barrier += (this.barrierTarget - this.barrier) * Math.min(1, dt * 6);
    for (const m of this.mats) {
      m.uniforms.uTime.value = time;
      m.uniforms.uBarrier.value = this.barrier;
    }
    for (const m of this.mist) {
      m.s.position.x += m.vx * dt;
      if (m.s.position.x > 24) m.s.position.x = -24;
    }
  }
}
