// ====================================================
// main.js – Ultimate Game Orchestrator
// ====================================================

// ---------- Global Imports ----------
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Stats from 'stats.js';
import GUI from 'lil-gui';
import RAPIER from '@dimforge/rapier3d-compat';
// Subsystem imports (all must export setGameContext and their main manager)
import { PhysicsManager, setGameContext as setPhysicsContext, PhysicsConfig } from './physics.js';
import { AIManager, setGameContext as setAIContext, AIConfig } from './ai.js';
import { AudioManager, setGameContext as setAudioContext, AudioConfig } from './audio.js';
import { Player, setGameContext as setPlayerContext, PlayerConfig } from './player.js';
import { UIManager, setGameContext as setUIContext, UIConfig } from './ui.js';
import { PostManager, setGameContext as setPostContext, PostConfig } from './postprocessing.js';
import { WorldManager, setGameContext as setWorldContext, WorldConfig } from './world.js';
import { InputHandler } from './input.js';
import { EventBus } from './events.js';

// Configuration (loaded from JSON, with fallback)
import defaultConfig from './config.json';

// ---------- Global Game Context ----------
export const GameContext = {
  // Core Three.js
  scene: null,
  camera: null,
  renderer: null,
  controls: null,

  // Managers (initialised later)
  physics: null,
  ai: null,
  audio: null,
  player: null,
  ui: null,
  post: null,
  world: null,
  input: null,
  eventBus: null,

  // State
  config: null,
  environment: {
    temperature: 20,
    airSpeed: 0,
    humidity: 0.5,
    luminance: 100,
    timeOfDay: 12,
  },
  debug: false,
  deltaTime: 0,
  elapsedTime: 0,
};

// ---------- Configuration Merging ----------
function mergeConfigs(defaultCfg, overrides) {
  const merged = { ...defaultCfg };
  for (const key in overrides) {
    if (typeof merged[key] === 'object' && merged[key] !== null && typeof overrides[key] === 'object') {
      merged[key] = mergeConfigs(merged[key], overrides[key]);
    } else {
      merged[key] = overrides[key];
    }
  }
  return merged;
}

// ---------- Asset Loading Helper ----------
async function loadPlayerMesh() {
  // Placeholder – in a real game you'd load a GLTF and return the skinned mesh
  return new THREE.Group();
}

// ---------- Initialization Sequence ----------
async function init() {
  console.time('⏱️ Game Initialization');
  const startTime = performance.now();

  // 1. Create Event Bus (first thing)
  const eventBus = new EventBus();
  GameContext.eventBus = eventBus;
  eventBus.emit('game:init:start');

  // 2. Merge configuration
  GameContext.config = mergeConfigs(defaultConfig, {});
  GameContext.debug = GameContext.config.DEBUG || false;

  // 3. Setup core Three.js
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(GameContext.config.WorldConfig?.SCENE_BACKGROUND || 0x111122);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(8, 6, 12);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = GameContext.config.PostConfig?.TONE_MAPPING?.exposure || 1.2;
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2;
  controls.target.set(0, 1, 0);

  GameContext.scene = scene;
  GameContext.camera = camera;
  GameContext.renderer = renderer;
  GameContext.controls = controls;

  // 4. Input Handler (depends on canvas)
  const input = new InputHandler({ canvas: renderer.domElement, eventBus });
  GameContext.input = input;

  // 5. Physics (async Rapier)
  try {
    setPhysicsContext(GameContext);
    const physics = new PhysicsManager();
    await physics.initWorld(); // ensure Rapier loaded
    GameContext.physics = physics;
    eventBus.emit('physics:ready');
  } catch (error) {
    eventBus.emit('game:error', { type: 'physics', error, fatal: true });
    console.error('Fatal: Physics failed to initialize', error);
    // Could fallback to no physics, but game likely needs it
  }

  // 6. World (depends on physics for terrain colliders)
  try {
    setWorldContext(GameContext);
    const world = new WorldManager();
    await world.init();
    GameContext.world = world;
    eventBus.emit('world:ready');
  } catch (error) {
    eventBus.emit('game:error', { type: 'world', error });
    // Fallback to empty world
  }

  // 7. Audio (depends on environment)
  try {
    setAudioContext(GameContext);
    const audio = new AudioManager();
    GameContext.audio = audio;
    eventBus.emit('audio:ready');
  } catch (error) {
    eventBus.emit('game:error', { type: 'audio', error });
  }

  // 8. AI (depends on physics and world)
  try {
    setAIContext(GameContext);
    const ai = new AIManager();
    GameContext.ai = ai;
    eventBus.emit('ai:ready');
  } catch (error) {
    eventBus.emit('game:error', { type: 'ai', error });
  }

  // 9. Player (depends on physics, world, input)
  try {
    setPlayerContext(GameContext);
    const playerMesh = await loadPlayerMesh();
    // Create physics character (assume physics manager has method)
    const physicsId = GameContext.physics?.createCharacter?.({
      mass: PlayerConfig.CHARACTER_MASS,
      position: { x: 0, y: 2, z: 0 },
      radius: PlayerConfig.CHARACTER_RADIUS,
      height: PlayerConfig.CHARACTER_HEIGHT,
    }) || 'player';
    const player = new Player(playerMesh, physicsId);
    GameContext.player = player;
    eventBus.emit('player:ready');
  } catch (error) {
    eventBus.emit('game:error', { type: 'player', error });
  }

  // 10. UI (depends on player, world)
  try {
    setUIContext(GameContext);
    const ui = new UIManager();
    GameContext.ui = ui;
    eventBus.emit('ui:ready');
  } catch (error) {
    eventBus.emit('game:error', { type: 'ui', error });
  }

  // 11. Post‑processing (depends on renderer, scene, camera)
  try {
    setPostContext(GameContext);
    const post = new PostManager();
    await post.init(); // may load LUT textures
    GameContext.post = post;
    eventBus.emit('post:ready');
  } catch (error) {
    eventBus.emit('game:error', { type: 'post', error });
    // Fallback: no post
  }

  // 12. Debug tools (if enabled)
  if (GameContext.debug) {
    const stats = new Stats();
    stats.dom.style.position = 'absolute';
    stats.dom.style.top = '20px';
    stats.dom.style.right = '20px';
    document.body.appendChild(stats.dom);
    GameContext.stats = stats;

    const gui = new GUI({ title: 'Debug Controls' });
    // Add folders for each subsystem
    if (GameContext.physics) {
      const physFolder = gui.addFolder('Physics');
      physFolder.add(PhysicsConfig, 'GRAVITY', -20, 0).name('Gravity').onChange(val => {
        if (GameContext.physics?.world) GameContext.physics.world.gravity.y = val;
      });
      physFolder.open();
    }
    // ... more GUI additions
    GameContext.gui = gui;
  }

  const endTime = performance.now();
  console.log(`✅ All systems ready in ${(endTime - startTime).toFixed(2)}ms`);
  eventBus.emit('game:ready', { duration: endTime - startTime });

  // Start the game loop
  requestAnimationFrame(gameLoop);
}

// ---------- Game Loop (Fixed Timestep + Variable) ----------
const FIXED_TIMESTEP = 1 / 60; // 60 Hz
const MAX_SUBSTEPS = 5;
let lastTime = performance.now();
let accumulator = 0;

function gameLoop(currentTime) {
  requestAnimationFrame(gameLoop);

  // Delta time (capped to avoid large jumps)
  const delta = Math.min(100, currentTime - lastTime) / 1000;
  lastTime = currentTime;
  accumulator += delta;

  // Store in context for other modules
  GameContext.deltaTime = delta;
  GameContext.elapsedTime = currentTime;

  // Fixed timestep updates (physics, AI, world, player motor)
  let steps = 0;
  while (accumulator >= FIXED_TIMESTEP && steps < MAX_SUBSTEPS) {
    if (GameContext.physics) GameContext.physics.step(FIXED_TIMESTEP);
    if (GameContext.ai) GameContext.ai.update(FIXED_TIMESTEP);
    if (GameContext.world) GameContext.world.update(FIXED_TIMESTEP);
    if (GameContext.player && GameContext.player.motor) {
      GameContext.player.motor.update(FIXED_TIMESTEP);
    }

    accumulator -= FIXED_TIMESTEP;
    steps++;
  }

  // Interpolation factor (alpha) for render smoothing
  const alpha = accumulator / FIXED_TIMESTEP;
  GameContext.alpha = alpha;

  // Variable updates (player animator/health, UI, audio, post‑effects)
  if (GameContext.player) GameContext.player.update(delta);
  if (GameContext.ui) GameContext.ui.update(delta);
  if (GameContext.audio) GameContext.audio.update(delta);
  if (GameContext.post) GameContext.post.update(delta);

  // Update environment data (could be driven by world)
  if (GameContext.world && GameContext.world.lighting) {
    GameContext.environment.timeOfDay = GameContext.world.lighting.getCurrentTime();
  }

  // Render: either post‑processing or direct
  if (GameContext.post && GameContext.post.config.ENABLED) {
    GameContext.post.render();
  } else {
    GameContext.renderer.render(GameContext.scene, GameContext.camera);
  }

  // Update debug stats
  if (GameContext.stats) GameContext.stats.update();

  // Emit frame end for monitoring
  GameContext.eventBus.emit('frame:end', { delta, alpha, steps });
}

// ---------- Resize Handler ----------
function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  GameContext.camera.aspect = width / height;
  GameContext.camera.updateProjectionMatrix();

  GameContext.renderer.setSize(width, height);

  if (GameContext.post) {
    GameContext.post.composer.setSize(width, height);
  }

  GameContext.eventBus.emit('window:resize', { width, height });
}

// ---------- Global Error Handlers ----------
function onError(event) {
  const error = event.error || event;
  console.error('❌ Uncaught error:', error);
  GameContext.eventBus?.emit('game:error', { type: 'uncaught', error, fatal: false });
  // Optionally show a user‑friendly message via UI
  if (GameContext.ui) {
    GameContext.ui.showNotification({ message: 'An error occurred. Check console.', color: '#ff0000' });
  }
}

function onUnhandledRejection(event) {
  console.error('❌ Unhandled rejection:', event.reason);
  GameContext.eventBus?.emit('game:error', { type: 'unhandledRejection', error: event.reason, fatal: false });
}

// ---------- Cleanup (Hot‑Reload / Page Unload) ----------
function dispose() {
  console.log('🔄 Disposing game...');
  GameContext.eventBus?.emit('game:dispose');

  if (GameContext.player) GameContext.player.dispose();
  if (GameContext.ai) GameContext.ai.dispose();
  if (GameContext.physics) GameContext.physics.dispose();
  if (GameContext.audio) GameContext.audio.dispose();
  if (GameContext.ui) GameContext.ui.dispose();
  if (GameContext.post) GameContext.post.dispose();
  if (GameContext.world) GameContext.world.dispose();

  // Remove global listeners
  window.removeEventListener('resize', onResize);
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onUnhandledRejection);

  // Remove Three.js canvas
  if (GameContext.renderer && GameContext.renderer.domElement.parentNode) {
    GameContext.renderer.domElement.parentNode.removeChild(GameContext.renderer.domElement);
  }

  console.log('✅ Disposed');
}

// ---------- Bootstrap ----------
window.addEventListener('load', () => {
  init().catch(err => {
    console.error('💥 Fatal init error:', err);
    document.body.innerHTML = `<div style="color:red; padding:20px;"><h1>Fatal Error</h1><pre>${err.stack}</pre></div>`;
  });
});

window.addEventListener('resize', onResize);
window.addEventListener('error', onError);
window.addEventListener('unhandledrejection', onUnhandledRejection);

// Optional: Cleanup on page unload
window.addEventListener('beforeunload', dispose);

// ---------- Export (for module usage) ----------
export { init, dispose };