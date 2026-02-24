// ====================================================
// audio.js – High‑Fidelity Spatial Audio Subsystem
// ====================================================

// ---------- GameContext (set by main.js) ----------
export let GameContext = null;
export function setGameContext(ctx) { GameContext = ctx; }

// ---------- Audio Configuration ----------
export const AudioConfig = {
  SAMPLE_RATE: 48000,
  HRTF_ENABLED: true,
  ATTENUATION_MODEL: 'inverse',
  REFERENCE_DISTANCE: 1,
  MAX_DISTANCE: 100,
  ROLLOFF_FACTOR: 1,
  MASTER_VOLUME: 1.0,
  SFX_VOLUME: 1.0,
  MUSIC_VOLUME: 0.7,
  AMBIENT_VOLUME: 0.5,
  VOICE_VOLUME: 1.0,
  MAX_CONCURRENT_SFX: 32,
  DEBUG: true,
};

// ---------- AudioLoader – loads and caches buffers ----------
class AudioLoader {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: AudioConfig.SAMPLE_RATE,
      latencyHint: 'playback',
    });
    this.cache = new Map();
  }

  async loadSound(url) {
    if (this.cache.has(url)) return this.cache.get(url);
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    this.cache.set(url, audioBuffer);
    return audioBuffer;
  }

  getContext() {
    return this.audioContext;
  }
}

// ---------- Sound – main thread representation (uses Web Audio nodes) ----------
export class Sound {
  constructor(manager, id, buffer, options = {}) {
    this.manager = manager;
    this.id = id;
    this.buffer = buffer;
    this.type = options.type || 'sfx';
    this.spatial = options.spatial ?? (this.type === 'sfx');
    this.loop = options.loop || false;
    this.gain = options.gain || 1;
    this.pan = options.pan || 0; // only for non‑spatial
    this.playbackRate = options.playbackRate || 1;
    this.position = options.position ? { ...options.position } : null;
    this.priority = options.priority || 0;

    // Web Audio nodes
    this.source = null;
    this.gainNode = null;
    this.pannerNode = null;
    this.startedAt = 0;
    this.pausedAt = 0;
    this.isPlaying = false;
  }

  // Called by AudioManager when actually starting playback
  _createNodes() {
    const ctx = this.manager.loader.getContext();
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = this.loop;
    this.source.playbackRate.value = this.playbackRate;

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = this.gain * this.manager.getCategoryGain(this.type);

    if (this.spatial && this.position) {
      this.pannerNode = ctx.createPanner();
      this.pannerNode.panningModel = AudioConfig.HRTF_ENABLED ? 'HRTF' : 'equalpower';
      this.pannerNode.distanceModel = AudioConfig.ATTENUATION_MODEL;
      this.pannerNode.refDistance = AudioConfig.REFERENCE_DISTANCE;
      this.pannerNode.maxDistance = AudioConfig.MAX_DISTANCE;
      this.pannerNode.rolloffFactor = AudioConfig.ROLLOFF_FACTOR;
      this.pannerNode.positionX.value = this.position.x;
      this.pannerNode.positionY.value = this.position.y;
      this.pannerNode.positionZ.value = this.position.z;

      this.source.connect(this.gainNode).connect(this.pannerNode).connect(ctx.destination);
    } else {
      // stereo panning for non‑spatial sounds
      const stereoPanner = ctx.createStereoPanner();
      stereoPanner.pan.value = this.pan;
      this.source.connect(this.gainNode).connect(stereoPanner).connect(ctx.destination);
    }
  }

  play() {
    if (this.isPlaying) return;
    const ctx = this.manager.loader.getContext();
    this._createNodes();
    this.source.start(0, this.pausedAt);
    this.startedAt = ctx.currentTime - this.pausedAt;
    this.isPlaying = true;
    this.pausedAt = 0;
  }

  pause() {
    if (!this.isPlaying) return;
    const ctx = this.manager.loader.getContext();
    this.pausedAt = ctx.currentTime - this.startedAt;
    this.source.stop();
    this.source.disconnect();
    this.isPlaying = false;
  }

  stop() {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    this.gainNode?.disconnect();
    this.pannerNode?.disconnect();
    this.isPlaying = false;
    this.pausedAt = 0;
  }

  setPosition(x, y, z) {
    this.position = { x, y, z };
    if (this.pannerNode) {
      this.pannerNode.positionX.value = x;
      this.pannerNode.positionY.value = y;
      this.pannerNode.positionZ.value = z;
    }
  }

  setGain(val) {
    this.gain = val;
    if (this.gainNode) {
      this.gainNode.gain.value = this.gain * this.manager.getCategoryGain(this.type);
    }
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
    if (this.source) this.source.playbackRate.value = rate;
  }

  dispose() {
    this.stop();
  }
}

// ---------- AudioPool – manages reused sounds ----------
export class AudioPool {
  constructor(manager, buffer, poolSize = 5) {
    this.manager = manager;
    this.buffer = buffer;
    this.pool = [];
    this.index = 0;
    this._initPool(poolSize);
  }

  _initPool(size) {
    for (let i = 0; i < size; i++) {
      const sound = new Sound(this.manager, `pool-${i}-${Date.now()}`, this.buffer, {
        type: 'sfx',
        spatial: true,
      });
      this.pool.push(sound);
    }
  }

  play(options = {}) {
    const sound = this.pool[this.index];
    this.index = (this.index + 1) % this.pool.length;
    sound.setGain(options.gain ?? 1);
    sound.setPlaybackRate(options.pitch ?? 1);
    if (options.position) sound.setPosition(options.position.x, options.position.y, options.position.z);
    sound.play();
    return sound;
  }

  dispose() {
    for (const s of this.pool) s.dispose();
    this.pool = [];
  }
}

// ---------- AudioManager – main orchestrator ----------
export class AudioManager {
  constructor() {
    this.loader = new AudioLoader();
    this.activeSounds = new Map(); // id -> Sound
    this.pools = new Map(); // url -> AudioPool
    this.nextId = 0;
    this.categories = {
      master: AudioConfig.MASTER_VOLUME,
      sfx: AudioConfig.SFX_VOLUME,
      music: AudioConfig.MUSIC_VOLUME,
      ambient: AudioConfig.AMBIENT_VOLUME,
      voice: AudioConfig.VOICE_VOLUME,
    };
    this.muted = false;
    this.muteGain = 1;

    this.setupEventListeners();
  }

  getCategoryGain(category) {
    return this.categories[category] * this.categories.master * (this.muted ? 0 : 1);
  }

  setupEventListeners() {
    if (!GameContext?.eventBus) return;
    GameContext.eventBus.on('sound:play', (data) => this.playSound(data));
    GameContext.eventBus.on('sound:stop', (data) => this.stopSound(data));
    GameContext.eventBus.on('sound:stopAll', () => this.stopAll());
    GameContext.eventBus.on('sound:setVolume', (data) => this.setVolume(data.category, data.value));
    GameContext.eventBus.on('sound:mute', (mute) => this.setMute(mute));
  }

  async playSound(data) {
    const { url, type = 'sfx', options = {} } = data;
    try {
      const buffer = await this.loader.loadSound(url);
      const id = this.nextId++;
      const sound = new Sound(this, id, buffer, { type, ...options });
      this.activeSounds.set(id, sound);
      sound.play();

      // Enforce max concurrent SFX
      if (type === 'sfx') {
        const sfxs = [...this.activeSounds.values()].filter(s => s.type === 'sfx' && s.isPlaying);
        if (sfxs.length > AudioConfig.MAX_CONCURRENT_SFX) {
          // Stop the oldest low‑priority one
          sfxs.sort((a, b) => a.priority - b.priority);
          const toStop = sfxs[0];
          toStop.stop();
          this.activeSounds.delete(toStop.id);
        }
      }

      // Auto‑cleanup when non‑looping sound ends
      if (!sound.loop) {
        const duration = buffer.duration * 1000;
        setTimeout(() => {
          if (this.activeSounds.has(id)) {
            sound.dispose();
            this.activeSounds.delete(id);
          }
        }, duration + 100);
      }

      if (AudioConfig.DEBUG) {
        console.log(`[Audio] Played ${url} (id ${id})`);
      }
    } catch (error) {
      GameContext?.eventBus?.emit('audio:error', { url, error });
      if (AudioConfig.DEBUG) console.error(`[Audio] Failed to play ${url}`, error);
    }
  }

  stopSound(data) {
    const { id, url } = data;
    if (id && this.activeSounds.has(id)) {
      this.activeSounds.get(id).stop();
      this.activeSounds.delete(id);
    } else if (url) {
      for (const [id, sound] of this.activeSounds) {
        // naive: we don't store url; could extend Sound to store url
      }
    }
  }

  stopAll() {
    for (const sound of this.activeSounds.values()) {
      sound.stop();
      sound.dispose();
    }
    this.activeSounds.clear();
  }

  setVolume(category, value) {
    if (category in this.categories) {
      this.categories[category] = value;
      // update all active sounds
      for (const sound of this.activeSounds.values()) {
        if (sound.type === category) {
          sound.setGain(sound.gain); // recompute
        }
      }
    }
  }

  setMute(mute) {
    this.muted = mute;
    for (const sound of this.activeSounds.values()) {
      sound.setGain(sound.gain); // recompute
    }
  }

  // Create or get a pool for frequently used sounds (footsteps, etc.)
  getPool(url, poolSize = 5) {
    if (this.pools.has(url)) return this.pools.get(url);
    const buffer = this.loader.cache.get(url);
    if (!buffer) {
      console.warn(`[Audio] Cannot create pool for ${url}: not loaded yet`);
      return null;
    }
    const pool = new AudioPool(this, buffer, poolSize);
    this.pools.set(url, pool);
    return pool;
  }

  update(deltaTime) {
    // Update listener position from player/camera
    const player = GameContext?.state?.player;
    if (player && this.loader.audioContext.listener) {
      const listener = this.loader.audioContext.listener;
      if (listener.positionX) {
        listener.positionX.value = player.position.x;
        listener.positionY.value = player.position.y;
        listener.positionZ.value = player.position.z;
      }
      // orientation from camera (assume forward = (0,0,1), up = (0,1,0))
      listener.forwardX.value = 0;
      listener.forwardY.value = 0;
      listener.forwardZ.value = 1;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    }
  }

  dispose() {
    this.stopAll();
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.loader.audioContext.close();
  }
}

// ---------- Default Export ----------
export default {
  setGameContext,
  AudioManager,
  AudioConfig,
  Sound,
  AudioPool,
};