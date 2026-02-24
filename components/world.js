// ====================================================
// world.js – Advanced Scientific World Environment
// ====================================================

// ---------- GameContext (set by main.js) ----------
export let GameContext = null;
export function setGameContext(ctx) { GameContext = ctx; }

// ---------- World Configuration ----------
export const WorldConfig = {
  ENABLED: true,
  SCENE_BACKGROUND: 0x111122,
  FOG_ENABLED: true,
  FOG_MODE: 'exponential',          // 'linear', 'exponential', 'height'
  FOG_COLOR: 0x111122,
  FOG_DENSITY: 0.02,
  FOG_NEAR: 20,
  FOG_FAR: 80,
  FOG_HEIGHT_FALLOFF: 0.5,

  // Terrain
  TERRAIN_ENABLED: true,
  TERRAIN_SIZE: 1000,
  TERRAIN_RESOLUTION: 128,           // vertices per side
  TERRAIN_HEIGHT_SCALE: 50,
  TERRAIN_NOISE_OCTAVES: 6,
  TERRAIN_NOISE_PERSISTENCE: 0.5,
  TERRAIN_NOISE_LACUNARITY: 2.0,
  TERRAIN_HEIGHTMAP_TEXTURE: null,   // optional path
  TERRAIN_TEXTURES: {
    low: 'assets/textures/grass.jpg',
    mid: 'assets/textures/dirt.jpg',
    high: 'assets/textures/rock.jpg',
  },
  TERRAIN_TEXTURE_TILING: 50,

  // Static Objects
  STATIC_OBJECTS_MANIFEST: 'assets/world/objects.json',
  STATIC_OBJECTS_POOL_SIZE: 100,
  STATIC_OBJECTS_LOD_ENABLED: true,
  STATIC_OBJECTS_LOD_DISTANCES: [50, 200, 500],

  // Lighting
  AMBIENT_INTENSITY: 0.4,
  AMBIENT_COLOR: 0x404060,
  DIRECTIONAL_LIGHT_ENABLED: true,
  DIRECTIONAL_LIGHT_INTENSITY: 1.2,
  DIRECTIONAL_LIGHT_COLOR: 0xffeedd,
  DIRECTIONAL_LIGHT_POSITION: { x: 5, y: 10, z: 7 },
  SHADOW_MAP_SIZE: 2048,
  SHADOW_CASCADE_COUNT: 3,
  DAY_NIGHT_CYCLE_ENABLED: true,
  TIME_SCALE: 0.1,                   // seconds per in‑game minute
  INITIAL_TIME: 12.0,                // noon (hours)

  // Sky & Atmosphere
  SKY_ENABLED: true,
  SKY_MODE: 'procedural',             // 'box', 'procedural', 'atmospheric'
  SKYBOX_TEXTURE: 'assets/textures/skybox/',
  ATMOSPHERE_TURBIDITY: 2.0,
  ATMOSPHERE_RAYLEIGH: 1.0,
  ATMOSPHERE_MIE: 1.0,
  CLOUDS_ENABLED: true,
  CLOUDS_DENSITY: 0.5,
  CLOUDS_SPEED: 0.01,
  CLOUDS_HEIGHT: 100,
  STARS_ENABLED: true,
  STARS_INTENSITY: 0.5,

  // Weather
  WEATHER_ENABLED: false,
  WEATHER_TYPE: 'clear',              // 'rain', 'snow', 'fog'
  WIND_DIRECTION: { x: 1, y: 0, z: 0.5 },
  WIND_SPEED: 1.0,

  // Performance
  LOD_ENABLED: true,
  OCCLUSION_CULLING_ENABLED: false,
  INSTANCING_ENABLED: true,

  // Debug
  DEBUG: true,
};

// ---------- Math Utilities ----------
const MathUtils = {
  // Bilinear interpolation
  bilinearInterpolate(x, y, p00, p01, p10, p11) {
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
  },

  // Simplex noise wrapper (simplified – in practice use a library)
  simplexNoise2D(x, y, octaves = 1, persistence = 0.5, lacunarity = 2.0) {
    // Placeholder: returns sum of octaves using a noise function
    // For real implementation, include SimplexNoise from external lib
    let value = 0;
    let amplitude = 1.0;
    let frequency = 1.0;
    for (let i = 0; i < octaves; i++) {
      // This would call actual noise
      value += amplitude * (Math.sin(x * frequency) * Math.cos(y * frequency)); // dummy
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return value * 0.5 + 0.5; // normalize roughly
  },
};

// ---------- Terrain ----------
class Terrain {
  constructor(worldManager) {
    this.world = worldManager;
    this.config = WorldConfig;
    this.mesh = null;
    this.heightmap = null;
    this.physicsBody = null;
  }

  async generate() {
    if (!this.config.TERRAIN_ENABLED) return;

    const res = this.config.TERRAIN_RESOLUTION;
    const size = this.config.TERRAIN_SIZE;
    const heightScale = this.config.TERRAIN_HEIGHT_SCALE;

    // Create heightmap (2D array)
    this.heightmap = [];
    for (let z = 0; z < res; z++) {
      this.heightmap[z] = [];
      for (let x = 0; x < res; x++) {
        // Normalized coordinates
        const nx = x / (res - 1) - 0.5;
        const nz = z / (res - 1) - 0.5;
        // Procedural height using fractal noise
        let h = MathUtils.simplexNoise2D(
          nx * 4.0,
          nz * 4.0,
          this.config.TERRAIN_NOISE_OCTAVES,
          this.config.TERRAIN_NOISE_PERSISTENCE,
          this.config.TERRAIN_NOISE_LACUNARITY
        );
        // Apply height scale and center
        this.heightmap[z][x] = h * heightScale;
      }
    }

    // Build mesh geometry
    const geometry = this.buildGeometryFromHeightmap();
    // Create material with texture splatting
    const material = this.createSplatMaterial();
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'Terrain';
    GameContext.scene.add(this.mesh);

    // Create physics heightfield
    if (GameContext.physics) {
      this.createPhysicsHeightfield();
    }
  }

  buildGeometryFromHeightmap() {
    const res = this.config.TERRAIN_RESOLUTION;
    const size = this.config.TERRAIN_SIZE;
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const normals = [];
    const uvs = [];

    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const y = this.heightmap[z][x];
        vertices.push((x / (res - 1) - 0.5) * size, y, (z / (res - 1) - 0.5) * size);
        uvs.push(x / (res - 1), z / (res - 1));
        // Normals computed later
      }
    }

    const indices = [];
    for (let z = 0; z < res - 1; z++) {
      for (let x = 0; x < res - 1; x++) {
        const a = z * res + x;
        const b = z * res + x + 1;
        const c = (z + 1) * res + x;
        const d = (z + 1) * res + x + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  createSplatMaterial() {
    // Simplified: use a shader that blends based on height
    // In production, you'd load textures and create a custom material
    return new THREE.MeshStandardMaterial({ color: 0x8a6e4b, flatShading: false });
  }

  createPhysicsHeightfield() {
    if (!GameContext.physics || !GameContext.physics.world) return;
    const RAPIER = GameContext.physics.constructor?.RAPIER; // Not ideal
    // Heightfield creation would use RAPIER.ColliderDesc.heightfield
    // For brevity, we skip detailed implementation.
    // In practice, you'd pass the heightmap to physics engine.
  }

  getHeightAt(x, z) {
    if (!this.heightmap) return 0;
    // Convert world coordinates to grid indices
    const size = this.config.TERRAIN_SIZE;
    const res = this.config.TERRAIN_RESOLUTION;
    const half = size / 2;
    const gridX = (x + half) / size * (res - 1);
    const gridZ = (z + half) / size * (res - 1);
    const ix = Math.floor(gridX);
    const iz = Math.floor(gridZ);
    if (ix < 0 || ix >= res - 1 || iz < 0 || iz >= res - 1) return 0;
    const fx = gridX - ix;
    const fz = gridZ - iz;
    const h00 = this.heightmap[iz][ix];
    const h01 = this.heightmap[iz][ix + 1];
    const h10 = this.heightmap[iz + 1][ix];
    const h11 = this.heightmap[iz + 1][ix + 1];
    // Bilinear interpolation
    return MathUtils.bilinearInterpolate(fx, fz, h00, h01, h10, h11);
  }
}

// ---------- Static Objects ----------
class StaticObjects {
  constructor(worldManager) {
    this.world = worldManager;
    this.config = WorldConfig;
    this.objects = [];
    this.instancedMeshes = new Map();
  }

  async loadManifest() {
    if (!this.config.STATIC_OBJECTS_MANIFEST) return;
    try {
      const response = await fetch(this.config.STATIC_OBJECTS_MANIFEST);
      const manifest = await response.json();
      for (const entry of manifest.objects) {
        await this.spawnObject(entry);
      }
    } catch (e) {
      console.error('Failed to load static objects manifest', e);
    }
  }

  async spawnObject(entry) {
    const { model, position, rotation, scale, instances } = entry;
    if (instances && instances.length > 0 && this.config.INSTANCING_ENABLED) {
      // Instancing
      if (!this.instancedMeshes.has(model)) {
        const geom = await this.loadModelGeometry(model);
        const mat = new THREE.MeshStandardMaterial();
        const instancedMesh = new THREE.InstancedMesh(geom, mat, instances.length);
        this.instancedMeshes.set(model, instancedMesh);
        GameContext.scene.add(instancedMesh);
      }
      const mesh = this.instancedMeshes.get(model);
      // Set matrix for each instance
      instances.forEach((inst, idx) => {
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(inst.position[0], inst.position[1], inst.position[2]),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(inst.rotation[0], inst.rotation[1], inst.rotation[2])),
          new THREE.Vector3(inst.scale[0], inst.scale[1], inst.scale[2])
        );
        mesh.setMatrixAt(idx, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    } else {
      // Single mesh
      const mesh = await this.loadModel(model, position, rotation, scale);
      GameContext.scene.add(mesh);
      this.objects.push(mesh);
    }
  }

  async loadModel(path, pos, rot, sca) {
    // Placeholder – use GLTFLoader
    return new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({color:0xaaaaaa}));
  }

  async loadModelGeometry(path) {
    return new THREE.BoxGeometry(1,1,1);
  }

  update(cameraPosition) {
    if (!this.config.STATIC_OBJECTS_LOD_ENABLED) return;
    // Simple LOD: hide objects beyond certain distance (demo)
    const lodDist = this.config.STATIC_OBJECTS_LOD_DISTANCES[1];
    this.objects.forEach(obj => {
      const dist = obj.position.distanceTo(cameraPosition);
      obj.visible = dist < lodDist;
    });
  }
}

// ---------- LightingController ----------
class LightingController {
  constructor(worldManager) {
    this.world = worldManager;
    this.config = WorldConfig;
    this.ambientLight = null;
    this.directionalLight = null;
    this.currentTime = this.config.INITIAL_TIME;
  }

  init() {
    // Ambient
    this.ambientLight = new THREE.AmbientLight(
      this.config.AMBIENT_COLOR,
      this.config.AMBIENT_INTENSITY
    );
    GameContext.scene.add(this.ambientLight);

    // Directional
    if (this.config.DIRECTIONAL_LIGHT_ENABLED) {
      this.directionalLight = new THREE.DirectionalLight(
        this.config.DIRECTIONAL_LIGHT_COLOR,
        this.config.DIRECTIONAL_LIGHT_INTENSITY
      );
      this.directionalLight.position.copy(
        new THREE.Vector3(
          this.config.DIRECTIONAL_LIGHT_POSITION.x,
          this.config.DIRECTIONAL_LIGHT_POSITION.y,
          this.config.DIRECTIONAL_LIGHT_POSITION.z
        )
      );
      this.directionalLight.castShadow = true;
      this.directionalLight.shadow.mapSize.width = this.config.SHADOW_MAP_SIZE;
      this.directionalLight.shadow.mapSize.height = this.config.SHADOW_MAP_SIZE;
      this.directionalLight.shadow.camera.near = 0.5;
      this.directionalLight.shadow.camera.far = 200;
      this.directionalLight.shadow.camera.left = -100;
      this.directionalLight.shadow.camera.right = 100;
      this.directionalLight.shadow.camera.top = 100;
      this.directionalLight.shadow.camera.bottom = -100;
      GameContext.scene.add(this.directionalLight);
    }
  }

  update(deltaTime) {
    if (this.config.DAY_NIGHT_CYCLE_ENABLED) {
      this.currentTime += deltaTime * this.config.TIME_SCALE / 60; // per frame adjust
      this.currentTime %= 24;
      const angle = (this.currentTime / 24) * 2 * Math.PI - Math.PI / 2; // sun rises at 6am
      const radius = 100;
      const sunPos = new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        0
      );
      if (this.directionalLight) {
        this.directionalLight.position.copy(sunPos);
        // Adjust intensity based on sun height
        const intensityFactor = Math.max(0, Math.sin(angle));
        this.directionalLight.intensity = this.config.DIRECTIONAL_LIGHT_INTENSITY * intensityFactor;
      }
    }
  }

  getCurrentTime() {
    return this.currentTime;
  }
}

// ---------- SkyController ----------
class SkyController {
  constructor(worldManager) {
    this.world = worldManager;
    this.config = WorldConfig;
    this.skyMesh = null;
  }

  init() {
    if (!this.config.SKY_ENABLED) return;

    if (this.config.SKY_MODE === 'box') {
      // Skybox
      const loader = new THREE.CubeTextureLoader();
      const texture = loader.load([
        `${this.config.SKYBOX_TEXTURE}px.jpg`,
        `${this.config.SKYBOX_TEXTURE}nx.jpg`,
        `${this.config.SKYBOX_TEXTURE}py.jpg`,
        `${this.config.SKYBOX_TEXTURE}ny.jpg`,
        `${this.config.SKYBOX_TEXTURE}pz.jpg`,
        `${this.config.SKYBOX_TEXTURE}nz.jpg`,
      ]);
      GameContext.scene.background = texture;
    } else if (this.config.SKY_MODE === 'procedural') {
      // Simple gradient background
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#87CEEB');
      grad.addColorStop(1, '#F0E68C');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 2, 512);
      const texture = new THREE.CanvasTexture(canvas);
      GameContext.scene.background = texture;
    } else if (this.config.SKY_MODE === 'atmospheric') {
      // Placeholder for atmospheric scattering shader
      // Could add a skydome mesh with custom shader
    }

    // Clouds (simplified)
    if (this.config.CLOUDS_ENABLED) {
      // Add a transparent plane with cloud texture moving with wind
    }
  }

  update(deltaTime) {
    // Cloud movement, star rotation, etc.
  }
}

// ---------- EnvironmentEffects ----------
class EnvironmentEffects {
  constructor(worldManager) {
    this.world = worldManager;
    this.config = WorldConfig;
    this.fog = null;
    this.particleSystems = [];
  }

  init() {
    if (this.config.FOG_ENABLED) {
      if (this.config.FOG_MODE === 'linear') {
        this.fog = new THREE.Fog(
          this.config.FOG_COLOR,
          this.config.FOG_NEAR,
          this.config.FOG_FAR
        );
      } else if (this.config.FOG_MODE === 'exponential') {
        this.fog = new THREE.FogExp2(this.config.FOG_COLOR, this.config.FOG_DENSITY);
      }
      GameContext.scene.fog = this.fog;
    }

    if (this.config.WEATHER_ENABLED) {
      this.createWeather();
    }
  }

  createWeather() {
    // Particle system for rain/snow
    const particleCount = 1000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      positions[i*3] = (Math.random() - 0.5) * 200;
      positions[i*3+1] = Math.random() * 100;
      positions[i*3+2] = (Math.random() - 0.5) * 200;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.2 });
    const particles = new THREE.Points(geometry, material);
    GameContext.scene.add(particles);
    this.particleSystems.push(particles);
  }

  update(deltaTime) {
    // Animate particles
    this.particleSystems.forEach(ps => {
      ps.rotation.y += deltaTime * 0.01; // just for demo
    });
  }
}

// ---------- WorldQueries ----------
class WorldQueries {
  constructor(worldManager) {
    this.world = worldManager;
  }

  getHeightAt(x, z) {
    return this.world.terrain ? this.world.terrain.getHeightAt(x, z) : 0;
  }

  raycast(origin, direction, maxDist = 1000) {
    // Use Three.js Raycaster
    const raycaster = new THREE.Raycaster(origin, direction, 0, maxDist);
    const intersects = raycaster.intersectObjects(GameContext.scene.children, true);
    return intersects;
  }

  getMinimapData() {
    // Return low‑resolution heightmap for UI
    if (!this.world.terrain || !this.world.terrain.heightmap) return null;
    const hm = this.world.terrain.heightmap;
    const stride = Math.max(1, Math.floor(hm.length / 32));
    const minimap = [];
    for (let z = 0; z < hm.length; z += stride) {
      const row = [];
      for (let x = 0; x < hm[z].length; x += stride) {
        row.push(hm[z][x]);
      }
      minimap.push(row);
    }
    return minimap;
  }
}

// ---------- WorldManager ----------
export class WorldManager {
  constructor() {
    this.config = WorldConfig;
    this.terrain = null;
    this.staticObjects = null;
    this.lighting = null;
    this.sky = null;
    this.effects = null;
    this.queries = null;
  }

  async init() {
    if (!GameContext) {
      console.error('WorldManager: GameContext not set');
      return;
    }

    try {
      // Terrain
      this.terrain = new Terrain(this);
      await this.terrain.generate();

      // Static Objects
      this.staticObjects = new StaticObjects(this);
      await this.staticObjects.loadManifest();

      // Lighting
      this.lighting = new LightingController(this);
      this.lighting.init();

      // Sky
      this.sky = new SkyController(this);
      this.sky.init();

      // Environment Effects
      this.effects = new EnvironmentEffects(this);
      this.effects.init();

      // Queries
      this.queries = new WorldQueries(this);

      // Emit ready event
      GameContext.eventBus?.emit('world:ready');
      if (WorldConfig.DEBUG) console.log('WorldManager initialized');
    } catch (e) {
      GameContext.eventBus?.emit('world:error', { error: e, context: 'init' });
      console.error('WorldManager init failed', e);
    }
  }

  update(deltaTime) {
    if (!GameContext) return;

    // Update lighting (day/night)
    if (this.lighting) this.lighting.update(deltaTime);

    // Update sky (clouds, stars)
    if (this.sky) this.sky.update(deltaTime);

    // Update effects (particles, fog)
    if (this.effects) this.effects.update(deltaTime);

    // Update static objects LOD (if needed)
    if (this.staticObjects && GameContext.player) {
      this.staticObjects.update(GameContext.player.getPosition());
    }
  }

  // Public query methods
  getHeightAt(x, z) {
    return this.queries ? this.queries.getHeightAt(x, z) : 0;
  }

  raycast(origin, direction, maxDist) {
    return this.queries ? this.queries.raycast(origin, direction, maxDist) : [];
  }

  getMinimapData() {
    return this.queries ? this.queries.getMinimapData() : null;
  }

  dispose() {
    // Clean up all resources
    // (implementation omitted for brevity)
  }
}

// ---------- Default Export ----------
export default {
  setGameContext,
  WorldManager,
  WorldConfig,
};