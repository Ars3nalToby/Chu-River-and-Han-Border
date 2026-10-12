import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, VignetteEffect,
  ToneMappingEffect, ToneMappingMode, Effect, BlendFunction,
} from 'postprocessing';

export type Quality = 'low' | 'high' | 'ultra';

export interface QualitySettings {
  name: Quality;
  pixelRatioCap: number;
  shadowMap: number;
  bloom: boolean;
  smaa: boolean;
  grain: boolean;
  /** river shader: full fresnel + moon reflection vs cheap scrolling */
  riverFancy: boolean;
  embers: number;
  mist: number;
  motes: number;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low:   { name: 'low',   pixelRatioCap: 1, shadowMap: 1024, bloom: false, smaa: false, grain: false, riverFancy: false, embers: 120, mist: 6,  motes: 60 },
  high:  { name: 'high',  pixelRatioCap: 2, shadowMap: 2048, bloom: true,  smaa: true,  grain: false, riverFancy: true,  embers: 320, mist: 14, motes: 180 },
  ultra: { name: 'ultra', pixelRatioCap: 2, shadowMap: 4096, bloom: true,  smaa: true,  grain: true,  riverFancy: true,  embers: 800, mist: 28, motes: 420 },
};

/** Multiplies linear HDR colour — stands in for renderer.toneMappingExposure inside the composer chain. */
class ExposureEffect extends Effect {
  constructor(exposure = 1.2) {
    super('ExposureEffect', /* glsl */ `
      uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
      }`, { blendFunction: BlendFunction.SET, uniforms: new Map<string, THREE.Uniform>([['exposure', new THREE.Uniform(exposure)]]) });
  }
}

/** Subtle animated film grain, applied after tone mapping (Ultra only). */
class GrainEffect extends Effect {
  constructor() {
    super('GrainEffect', /* glsl */ `
      uniform float time;
      uniform float amount;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float g = hash(uv * vec2(1920.0, 1080.0)) - 0.5;
        float lum = dot(inputColor.rgb, vec3(0.299, 0.587, 0.114));
        outputColor = vec4(inputColor.rgb + g * amount * (1.0 - lum * 0.6), inputColor.a);
      }`, { blendFunction: BlendFunction.SET, uniforms: new Map<string, THREE.Uniform>([['time', new THREE.Uniform(0)], ['amount', new THREE.Uniform(0.014)]]) });
  }
  update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt: number) {
    (this.uniforms.get('time') as THREE.Uniform).value = (((this.uniforms.get('time') as THREE.Uniform).value as number) + dt * 7.3) % 100;
  }
}

export class Gfx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  quality: QualitySettings = QUALITY.high;
  private composer: EffectComposer | null = null;
  private bloom!: BloomEffect;
  private bloomPass!: EffectPass;
  private smaaPass!: EffectPass;
  private gradePass!: EffectPass;
  private grain!: GrainEffect;
  private grainOn = false;
  private listeners: ((q: QualitySettings) => void)[] = [];
  private shadowDirty = true;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);

    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.2;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false; // we flag needsUpdate only when something moved

    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.FogExp2(0x0a0d14, 0.018);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    this.camera.position.set(0, 6, 11);

    this.buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildComposer() {
    const c = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    c.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new BloomEffect({
      intensity: 1.15, luminanceThreshold: 0.92, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72,
    });
    this.bloomPass = new EffectPass(this.camera, this.bloom);
    c.addPass(this.bloomPass);

    this.grain = new GrainEffect();
    this.gradePass = this.makeGradePass(false);
    c.addPass(this.gradePass);

    this.smaaPass = new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
    c.addPass(this.smaaPass);
    this.composer = c;
  }

  private makeGradePass(withGrain: boolean): EffectPass {
    const effects: Effect[] = [
      new ExposureEffect(1.2),
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
    ];
    if (withGrain) effects.push(this.grain);
    effects.push(new VignetteEffect({ offset: 0.3, darkness: 0.5 }));
    return new EffectPass(this.camera, ...effects);
  }

  onQuality(l: (q: QualitySettings) => void) {
    this.listeners.push(l);
  }

  setQuality(q: Quality): void {
    const s = QUALITY[q];
    this.quality = s;
    this.applyPipeline();
    this.resize();
    this.shadowDirty = true;
    for (const l of this.listeners) l(s);
  }

  /** enable/disable passes to match the quality tier */
  private applyPipeline() {
    const s = this.quality;
    this.bloomPass.enabled = s.bloom;
    this.smaaPass.enabled = s.smaa;
    // grain: swap pass membership instead of branching in the shader
    if (s.grain !== this.grainOn && this.composer) {
      this.grainOn = s.grain;
      this.composer.removePass(this.gradePass);
      this.composer.removePass(this.smaaPass);
      this.gradePass = this.makeGradePass(s.grain);
      this.composer.addPass(this.gradePass);
      this.composer.addPass(this.smaaPass);
    }
  }

  /** Low tier skips the composer entirely and uses renderer tone mapping. */
  private get useComposer() {
    return this.quality.name !== 'low';
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h, false);
  }

  invalidateShadows(): void {
    this.shadowDirty = true;
  }

  render(): void {
    if (this.shadowDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    if (this.useComposer && this.composer) {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.composer.render();
    } else {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.2;
      this.renderer.render(this.scene, this.camera);
    }
  }
}
