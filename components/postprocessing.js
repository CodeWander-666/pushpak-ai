// ====================================================
// postprocessing.js – Cinematic Industry‑Grade Post‑Processing
// ====================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import RAPIER from '@dimforge/rapier3d-compat';
// ---------- GameContext (set by main.js) ----------
export let GameContext = null;
export function setGameContext(ctx) { GameContext = ctx; }

// ---------- PostConfiguration – Central Settings ----------
export const PostConfig = {
  ENABLED: true,
  QUALITY: 'ultra',          // 'low', 'medium', 'high', 'ultra'
  RESOLUTION_SCALE: 1.0,
  BLOOM: {
    enabled: true,
    strength: 1.5,
    radius: 0.4,
    threshold: 0.2,
    samples: { low: 2, medium: 3, high: 4, ultra: 5 },
  },
  SSAO: {
    enabled: true,
    radius: 0.5,
    intensity: 1.5,
    bias: 0.01,
    samples: { low: 8, medium: 12, high: 16, ultra: 24 },
  },
  DOF: {
    enabled: false,
    focusDistance: 10,
    aperture: 0.1,
    maxBlur: 1.0,
  },
  MOTION_BLUR: {
    enabled: false,
    intensity: 0.5,
    samples: { low: 4, medium: 8, high: 12, ultra: 16 },
  },
  COLOR_GRADING: {
    enabled: true,
    lutPath: 'assets/luts/cinematic_lut.png',
    intensity: 1.0,
  },
  VIGNETTE: {
    enabled: true,
    intensity: 0.3,
    radius: 0.5,
  },
  FILM_GRAIN: {
    enabled: false,
    intensity: 0.05,
    seed: 0,
  },
  CHROMATIC_ABERRATION: {
    enabled: false,
    offset: 0.002,
  },
  TONE_MAPPING: {
    enabled: true,
    mode: 'ACES',     // 'ACES', 'Filmic', 'Reinhard', 'Uncharted2'
    exposure: 1.2,
  },
  DEBUG: true,
};

// ---------- Helper: Load LUT Texture ----------
async function loadLUTTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
}

// ---------- Custom Passes (Shaders) ----------

// Vignette Pass
class VignettePass extends Pass {
  constructor(intensity = 0.3, radius = 0.5) {
    super();
    this.name = 'VignettePass';
    this.intensity = intensity;
    this.radius = radius;
    this.uniforms = {
      tDiffuse: { value: null },
      intensity: { value: intensity },
      radius: { value: radius },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float intensity;
        uniform float radius;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float dist = distance(vUv, vec2(0.5, 0.5));
          float vignette = 1.0 - smoothstep(radius, 1.0, dist) * intensity;
          gl_FragColor = vec4(color.rgb * vignette, color.a);
        }
      `,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }
  setSize(width, height) {}
}

// Film Grain Pass
class FilmGrainPass extends Pass {
  constructor(intensity = 0.05, seed = 0) {
    super();
    this.name = 'FilmGrainPass';
    this.intensity = intensity;
    this.seed = seed;
    this.uniforms = {
      tDiffuse: { value: null },
      intensity: { value: intensity },
      seed: { value: seed },
      time: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float intensity;
        uniform float seed;
        uniform float time;
        varying vec2 vUv;
        float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float grain = random(vUv + time) * 2.0 - 1.0;
          color.rgb += grain * intensity;
          gl_FragColor = color;
        }
      `,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer, deltaTime) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.time.value += deltaTime;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }
  setSize(width, height) {}
}

// Chromatic Aberration Pass
class ChromaticAberrationPass extends Pass {
  constructor(offset = 0.002) {
    super();
    this.name = 'ChromaticAberrationPass';
    this.offset = offset;
    this.uniforms = {
      tDiffuse: { value: null },
      offset: { value: offset },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float offset;
        varying vec2 vUv;
        void main() {
          float r = texture2D(tDiffuse, vUv + vec2(offset, 0.0)).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, vUv - vec2(offset, 0.0)).b;
          gl_FragColor = vec4(r, g, b, 1.0);
        }
      `,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }
  setSize(width, height) {}
}

// Tone Mapping Pass (custom ACES, Filmic, etc.)
class ToneMappingPass extends Pass {
  constructor(mode = 'ACES', exposure = 1.0) {
    super();
    this.name = 'ToneMappingPass';
    this.mode = mode;
    this.exposure = exposure;
    this.uniforms = {
      tDiffuse: { value: null },
      exposure: { value: exposure },
    };
    const shader = this.getShader(mode);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: shader,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  getShader(mode) {
    switch (mode) {
      case 'ACES':
        return `
          uniform sampler2D tDiffuse;
          uniform float exposure;
          varying vec2 vUv;
          // ACES filmic tone map approximation
          vec3 ACES(vec3 x) {
            float a = 2.51;
            float b = 0.03;
            float c = 2.43;
            float d = 0.59;
            float e = 0.14;
            return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
          }
          void main() {
            vec3 color = texture2D(tDiffuse, vUv).rgb * exposure;
            color = ACES(color);
            gl_FragColor = vec4(color, 1.0);
          }
        `;
      case 'Filmic':
        return `
          uniform sampler2D tDiffuse;
          uniform float exposure;
          varying vec2 vUv;
          vec3 filmic(vec3 x) {
            vec3 X = max(vec3(0.0), x - 0.004);
            vec3 result = (X * (6.2 * X + 0.5)) / (X * (6.2 * X + 1.7) + 0.06);
            return pow(result, vec3(2.2));
          }
          void main() {
            vec3 color = texture2D(tDiffuse, vUv).rgb * exposure;
            color = filmic(color);
            gl_FragColor = vec4(color, 1.0);
          }
        `;
      default: // Reinhard
        return `
          uniform sampler2D tDiffuse;
          uniform float exposure;
          varying vec2 vUv;
          void main() {
            vec3 color = texture2D(tDiffuse, vUv).rgb * exposure;
            color = color / (vec3(1.0) + color);
            gl_FragColor = vec4(color, 1.0);
          }
        `;
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }
  setSize(width, height) {}
}

// ---------- Main PostManager ----------
export class PostManager {
  constructor() {
    this.composer = null;
    this.passes = {}; // named passes for later reference
    this.config = PostConfig;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.lutTexture = null;
    this.init();
  }

  async init() {
    if (!GameContext) {
      console.error('PostManager: GameContext not set');
      return;
    }
    this.renderer = GameContext.renderer;
    this.scene = GameContext.scene;
    this.camera = GameContext.camera;
    if (!this.renderer || !this.scene || !this.camera) {
      console.error('PostManager: Missing renderer, scene, or camera');
      return;
    }

    // Load LUT if enabled
    if (this.config.COLOR_GRADING.enabled) {
      try {
        this.lutTexture = await loadLUTTexture(this.config.COLOR_GRADING.lutPath);
      } catch (e) {
        console.warn('PostManager: Failed to load LUT texture, disabling color grading');
        this.config.COLOR_GRADING.enabled = false;
      }
    }

    this.createComposer();
    this.setupResizeListener();
    if (this.config.DEBUG) this.setupDebugGUI();
  }

  createComposer() {
    try {
      // Clean up old composer
      if (this.composer) this.composer = null;
      // Create new composer with optional resolution scaling
      const width = this.renderer.domElement.width * this.config.RESOLUTION_SCALE;
      const height = this.renderer.domElement.height * this.config.RESOLUTION_SCALE;
      this.composer = new EffectComposer(this.renderer);
      this.composer.setSize(width, height);

      // Add passes in order
      this.addPass('render', new RenderPass(this.scene, this.camera));

      // Bloom
      if (this.config.BLOOM.enabled) {
        try {
          const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            this.config.BLOOM.strength,
            this.config.BLOOM.radius,
            this.config.BLOOM.threshold
          );
          this.addPass('bloom', bloomPass);
        } catch (e) {
          console.warn('Bloom pass failed to create, disabling', e);
          this.config.BLOOM.enabled = false;
        }
      }

      // SSAO
      if (this.config.SSAO.enabled) {
        try {
          const samples = this.config.SSAO.samples[this.config.QUALITY];
          const ssaoPass = new SAOPass(this.scene, this.camera, width, height);
          ssaoPass.params = {
            output: SAOPass.OUTPUT.Default,
            saoBias: this.config.SSAO.bias,
            saoIntensity: this.config.SSAO.intensity,
            saoScale: 1,
            saoKernelRadius: this.config.SSAO.radius,
            saoMinResolution: 0,
            saoBlur: true,
            saoBlurRadius: 2,
            saoBlurStdDev: 1,
            saoSamples: samples,
          };
          this.addPass('ssao', ssaoPass);
        } catch (e) {
          console.warn('SSAO pass failed to create, disabling', e);
          this.config.SSAO.enabled = false;
        }
      }

      // DOF
      if (this.config.DOF.enabled) {
        try {
          const dofPass = new BokehPass(this.scene, this.camera, {
            focus: this.config.DOF.focusDistance,
            aperture: this.config.DOF.aperture,
            maxblur: this.config.DOF.maxBlur,
            width: width,
            height: height,
          });
          this.addPass('dof', dofPass);
        } catch (e) {
          console.warn('DOF pass failed to create, disabling', e);
          this.config.DOF.enabled = false;
        }
      }

      // Motion Blur (requires velocity pass, simplified here)
      if (this.config.MOTION_BLUR.enabled) {
        console.warn('MotionBlur not implemented in this demo, disabling');
        this.config.MOTION_BLUR.enabled = false;
      }

      // Color Grading (LUT)
      if (this.config.COLOR_GRADING.enabled && this.lutTexture) {
        try {
          const lutPass = new LUTPass();
          lutPass.lut = this.lutTexture;
          lutPass.intensity = this.config.COLOR_GRADING.intensity;
          this.addPass('lut', lutPass);
        } catch (e) {
          console.warn('LUT pass failed to create, disabling', e);
          this.config.COLOR_GRADING.enabled = false;
        }
      }

      // Vignette
      if (this.config.VIGNETTE.enabled) {
        try {
          const vignettePass = new VignettePass(
            this.config.VIGNETTE.intensity,
            this.config.VIGNETTE.radius
          );
          this.addPass('vignette', vignettePass);
        } catch (e) {
          console.warn('Vignette pass failed to create, disabling', e);
          this.config.VIGNETTE.enabled = false;
        }
      }

      // Film Grain
      if (this.config.FILM_GRAIN.enabled) {
        try {
          const grainPass = new FilmGrainPass(
            this.config.FILM_GRAIN.intensity,
            this.config.FILM_GRAIN.seed
          );
          this.addPass('grain', grainPass);
        } catch (e) {
          console.warn('FilmGrain pass failed to create, disabling', e);
          this.config.FILM_GRAIN.enabled = false;
        }
      }

      // Chromatic Aberration
      if (this.config.CHROMATIC_ABERRATION.enabled) {
        try {
          const caPass = new ChromaticAberrationPass(this.config.CHROMATIC_ABERRATION.offset);
          this.addPass('chromatic', caPass);
        } catch (e) {
          console.warn('ChromaticAberration pass failed to create, disabling', e);
          this.config.CHROMATIC_ABERRATION.enabled = false;
        }
      }

      // Tone Mapping (if not already handled by renderer)
      if (this.config.TONE_MAPPING.enabled) {
        try {
          const tonePass = new ToneMappingPass(
            this.config.TONE_MAPPING.mode,
            this.config.TONE_MAPPING.exposure
          );
          this.addPass('tone', tonePass);
        } catch (e) {
          console.warn('ToneMapping pass failed to create, disabling', e);
          this.config.TONE_MAPPING.enabled = false;
        }
      }

    } catch (e) {
      console.error('PostManager: Failed to create composer', e);
      this.composer = null;
      this.config.ENABLED = false;
      GameContext.eventBus?.emit('post:fatalError', { error: e });
    }
  }

  addPass(name, pass) {
    if (!this.composer) return;
    this.composer.addPass(pass);
    this.passes[name] = pass;
  }

  setupResizeListener() {
    window.addEventListener('resize', this.onResize.bind(this));
  }

  onResize() {
    if (!this.composer) return;
    const width = this.renderer.domElement.width * this.config.RESOLUTION_SCALE;
    const height = this.renderer.domElement.height * this.config.RESOLUTION_SCALE;
    try {
      this.composer.setSize(width, height);
    } catch (e) {
      console.warn('PostManager: resize failed', e);
    }
  }

  setQuality(level) {
    if (!['low','medium','high','ultra'].includes(level)) {
      console.warn(`Invalid quality level: ${level}`);
      return;
    }
    this.config.QUALITY = level;
    // Rebuild composer to apply new quality settings
    this.createComposer();
    GameContext.eventBus?.emit('post:qualityChanged', { quality: level });
  }

  setEffectEnabled(name, enabled) {
    if (!this.config.hasOwnProperty(name)) return;
    this.config[name].enabled = enabled;
    this.createComposer(); // rebuild passes
    GameContext.eventBus?.emit('post:effectToggled', { effect: name, enabled });
  }

  render() {
    if (this.composer && this.config.ENABLED) {
      try {
        this.composer.render();
      } catch (e) {
        console.error('PostManager: composer.render() failed', e);
        // Fallback to direct render
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // For animated passes (film grain uses time)
  update(deltaTime) {
    if (this.passes.grain) {
      this.passes.grain.uniforms.time.value += deltaTime;
    }
  }

  setupDebugGUI() {
    if (typeof lil === 'undefined') return;
    const gui = new lil.GUI({ title: 'Post‑Processing' });
    const config = this.config;

    // Master toggle
    gui.add(config, 'ENABLED').name('Enable Post');
    gui.add(config, 'QUALITY', ['low','medium','high','ultra']).name('Quality').onChange(() => this.setQuality(config.QUALITY));

    // Bloom folder
    if (config.BLOOM) {
      const folder = gui.addFolder('Bloom');
      folder.add(config.BLOOM, 'enabled').name('Enable').onChange(val => this.setEffectEnabled('BLOOM', val));
      folder.add(config.BLOOM, 'strength', 0, 5).name('Strength');
      folder.add(config.BLOOM, 'radius', 0, 1).name('Radius');
      folder.add(config.BLOOM, 'threshold', 0, 1).name('Threshold');
      folder.open();
    }

    // SSAO folder
    if (config.SSAO) {
      const folder = gui.addFolder('SSAO');
      folder.add(config.SSAO, 'enabled').name('Enable').onChange(val => this.setEffectEnabled('SSAO', val));
      folder.add(config.SSAO, 'intensity', 0, 5).name('Intensity');
      folder.add(config.SSAO, 'radius', 0, 2).name('Radius');
      folder.add(config.SSAO, 'bias', 0, 0.1).name('Bias');
      folder.open();
    }

    // DOF folder
    if (config.DOF) {
      const folder = gui.addFolder('Depth of Field');
      folder.add(config.DOF, 'enabled').name('Enable').onChange(val => this.setEffectEnabled('DOF', val));
      folder.add(config.DOF, 'focusDistance', 0, 20).name('Focus Distance');
      folder.add(config.DOF, 'aperture', 0, 1).name('Aperture');
      folder.add(config.DOF, 'maxBlur', 0, 5).name('Max Blur');
      folder.open();
    }

    // Color Grading folder
    if (config.COLOR_GRADING) {
      const folder = gui.addFolder('Color Grading');
      folder.add(config.COLOR_GRADING, 'enabled').name('Enable').onChange(val => this.setEffectEnabled('COLOR_GRADING', val));
      folder.add(config.COLOR_GRADING, 'intensity', 0, 2).name('Intensity');
      folder.open();
    }

    // Vignette folder
    if (config.VIGNETTE) {
      const folder = gui.addFolder('Vignette');
      folder.add(config.VIGNETTE, 'enabled').name('Enable').onChange(val => this.setEffectEnabled('VIGNETTE', val));
      folder.add(config.VIGNETTE, 'intensity', 0, 1).name('Intensity');
      folder.add(config.VIGNETTE, 'radius', 0, 1).name('Radius');
      folder.open();
    }

    // Film Grain folder
    if (config.FILM_GRAIN) {
      const folder = gui.addFolder('Film Grain');
      folder.add(config.FILM_GRAIN, 'enabled').name('Enable').onChange(val => this.setEffectEnabled('FILM_GRAIN', val));
      folder.add(config.FILM_GRAIN, 'intensity', 0, 0.2).name('Intensity');
      folder.open();
    }

    // Chromatic Aberration folder
    if (config.CHROMATIC_ABERRATION) {
      const folder = gui.addFolder('Chromatic Aberration');
      folder.add(config.CHROMATIC_ABERRATION, 'enabled').name('Enable').onChange(val => this.setEffectEnabled('CHROMATIC_ABERRATION', val));
      folder.add(config.CHROMATIC_ABERRATION, 'offset', 0, 0.01).name('Offset');
      folder.open();
    }

    // Tone Mapping folder
    if (config.TONE_MAPPING) {
      const folder = gui.addFolder('Tone Mapping');
      folder.add(config.TONE_MAPPING, 'enabled').name('Enable').onChange(val => this.setEffectEnabled('TONE_MAPPING', val));
      folder.add(config.TONE_MAPPING, 'mode', ['ACES','Filmic','Reinhard']).name('Mode');
      folder.add(config.TONE_MAPPING, 'exposure', 0, 3).name('Exposure');
      folder.open();
    }
  }
}

// ---------- Default Export ----------
export default {
  setGameContext,
  PostManager,
  PostConfig,
};