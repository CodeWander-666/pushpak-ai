// ====================================================
// player.js – Ultimate Professional Player Subsystem
// ====================================================

// ---------- GameContext (set by main.js) ----------
export let GameContext = null;
export function setGameContext(ctx) { GameContext = ctx; }

// ---------- Player Configuration ----------
export const PlayerConfig = {
  WALK_SPEED: 2.5,
  RUN_SPEED: 5.0,
  JUMP_FORCE: 8,
  ACCELERATION: 20,
  TURN_SPEED: 180,
  MAX_HEALTH: 100,
  MAX_STAMINA: 100,
  STAMINA_DRAIN_RUN: 10,
  STAMINA_REGEN: 5,
  INTERACT_DISTANCE: 2.0,
  INTERACT_HIGHLIGHT_COLOR: 0xffaa00,
  CAMERA_HEIGHT: 1.8,
  CAMERA_OFFSET: { x: 0, y: 1.5, z: 5 },
  DEBUG: true,
};

// ---------- PlayerInput ----------
class PlayerInput {
  constructor(player) {
    this.player = player;
    this.moveDir = { x: 0, z: 0 };
    this.wantsRun = false;
    this.jumpPressed = false;
    this.interactPressed = false;
  }

  update() {
    if (!GameContext?.input) {
      if (PlayerConfig.DEBUG) console.warn('PlayerInput: GameContext.input missing');
      return;
    }
    const input = GameContext.input;
    // Movement
    let dx = 0, dz = 0;
    if (input.isPressed('moveForward')) dz -= 1;
    if (input.isPressed('moveBackward')) dz += 1;
    if (input.isPressed('moveLeft')) dx -= 1;
    if (input.isPressed('moveRight')) dx += 1;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      this.moveDir.x = dx / len;
      this.moveDir.z = dz / len;
    } else {
      this.moveDir.x = 0;
      this.moveDir.z = 0;
    }
    // Run toggle
    this.wantsRun = input.isPressed('run');
    // Jump (edge detection)
    const jumpNow = input.isPressed('jump');
    this.jumpPressed = jumpNow && !this.jumpWasPressed;
    this.jumpWasPressed = jumpNow;
    // Interact (edge)
    const interactNow = input.isPressed('interact');
    this.interactPressed = interactNow && !this.interactWasPressed;
    this.interactWasPressed = interactNow;
  }

  getMoveDirection() { return this.moveDir; }
  wantsRun() { return this.wantsRun; }
  justJumped() { return this.jumpPressed; }
  justInteracted() { return this.interactPressed; }
}

// ---------- PlayerMotor ----------
class PlayerMotor {
  constructor(player) {
    this.player = player;
    this.physicsId = player.physicsId;
  }

  update(deltaTime) {
    if (!GameContext?.physics) {
      if (PlayerConfig.DEBUG) console.warn('PlayerMotor: physics missing');
      return;
    }
    const body = GameContext.physics.getCharacterBody(this.physicsId);
    if (!body) {
      // Attempt to re‑acquire
      this.physicsId = GameContext.physics.getCharacterId(this.player.mesh) ?? this.physicsId;
      if (PlayerConfig.DEBUG) console.warn('PlayerMotor: re‑acquired physics body');
      return;
    }

    const dir = this.player.input.getMoveDirection();
    const wantsRun = this.player.input.wantsRun();
    const maxSpeed = wantsRun ? PlayerConfig.RUN_SPEED : PlayerConfig.WALK_SPEED;

    // Desired velocity in horizontal plane
    const desiredVel = {
      x: dir.x * maxSpeed,
      y: 0,
      z: dir.z * maxSpeed,
    };
    const currentVel = body.getLinearVelocity();
    const deltaV = {
      x: desiredVel.x - currentVel.x,
      y: 0,
      z: desiredVel.z - currentVel.z,
    };
    // Impulse = m * deltaV
    const mass = PlayerConfig.CHARACTER_MASS || 80; // fallback
    let impulse = {
      x: deltaV.x * mass,
      y: 0,
      z: deltaV.z * mass,
    };
    // Limit impulse to max force * dt
    const maxImpulse = PlayerConfig.ACCELERATION * mass * deltaTime;
    const impLen = Math.hypot(impulse.x, impulse.y, impulse.z);
    if (impLen > maxImpulse) {
      const scale = maxImpulse / impLen;
      impulse.x *= scale;
      impulse.y *= scale;
      impulse.z *= scale;
    }
    body.applyImpulse(impulse);

    // Jump
    if (this.player.input.justJumped() && body.onGround) {
      body.applyImpulse({ x: 0, y: PlayerConfig.JUMP_FORCE, z: 0 });
      GameContext.eventBus?.emit('player:jump', { position: body.getPosition() });
    }

    // Store state for animator
    this.player.velocity = currentVel;
    this.player.onGround = body.onGround;
  }

  handleCollision(data) {
    // Could be used for landing detection, but we rely on body.onGround
  }
}

// ---------- PlayerAnimator ----------
class PlayerAnimator {
  constructor(player) {
    this.player = player;
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.init();
  }

  init() {
    if (!this.player.mesh) return;
    // Assume mesh has animations loaded via GLTF
    if (this.player.mesh.animations && this.player.mesh.animations.length) {
      this.mixer = new THREE.AnimationMixer(this.player.mesh);
      // Map animation names to clips (convention: 'idle', 'walk', 'run', 'jump')
      this.player.mesh.animations.forEach(clip => {
        if (clip.name.toLowerCase().includes('idle')) this.actions.idle = clip;
        if (clip.name.toLowerCase().includes('walk')) this.actions.walk = clip;
        if (clip.name.toLowerCase().includes('run')) this.actions.run = clip;
        if (clip.name.toLowerCase().includes('jump')) this.actions.jump = clip;
        if (clip.name.toLowerCase().includes('land')) this.actions.land = clip;
      });
      // Start with idle
      if (this.actions.idle) {
        this.currentAction = this.mixer.clipAction(this.actions.idle);
        this.currentAction.play();
      }
    } else {
      if (PlayerConfig.DEBUG) console.warn('PlayerAnimator: mesh has no animations');
    }
  }

  update(deltaTime) {
    if (!this.mixer) return;
    // Determine desired state from player velocity and onGround
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    const isRunning = speed > PlayerConfig.WALK_SPEED * 0.8; // threshold
    let desiredAnim = 'idle';
    if (!this.player.onGround) {
      desiredAnim = 'jump';
    } else if (speed > 0.1) {
      desiredAnim = isRunning ? 'run' : 'walk';
    } else {
      desiredAnim = 'idle';
    }

    // Transition
    if (this.currentAction && this.currentAction.getClip().name !== desiredAnim) {
      const nextClip = this.actions[desiredAnim];
      if (nextClip) {
        const nextAction = this.mixer.clipAction(nextClip);
        this.currentAction.crossFadeTo(nextAction, 0.2, true);
        this.currentAction = nextAction;
        this.currentAction.play();
      }
    }
    this.mixer.update(deltaTime);
  }

  dispose() {
    if (this.mixer) this.mixer.stopAllAction();
  }
}

// ---------- PlayerHealth ----------
class PlayerHealth {
  constructor(player) {
    this.player = player;
    this.health = PlayerConfig.MAX_HEALTH;
    this.stamina = PlayerConfig.MAX_STAMINA;
  }

  takeDamage(amount, source) {
    if (amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    GameContext.eventBus?.emit('player:damage', { health: this.health, amount, source });
    if (this.health <= 0) {
      GameContext.eventBus?.emit('player:death', { source });
    }
  }

  heal(amount) {
    if (amount <= 0) return;
    this.health = Math.min(PlayerConfig.MAX_HEALTH, this.health + amount);
    GameContext.eventBus?.emit('player:heal', { health: this.health });
  }

  update(deltaTime) {
    // Stamina drain/regen
    const wantsRun = this.player.input.wantsRun();
    if (wantsRun && this.stamina > 0) {
      this.stamina = Math.max(0, this.stamina - PlayerConfig.STAMINA_DRAIN_RUN * deltaTime);
    } else {
      this.stamina = Math.min(PlayerConfig.MAX_STAMINA, this.stamina + PlayerConfig.STAMINA_REGEN * deltaTime);
    }
    // Emit for UI
    GameContext.eventBus?.emit('player:stamina', { stamina: this.stamina });
  }
}

// ---------- PlayerInteraction ----------
class PlayerInteraction {
  constructor(player) {
    this.player = player;
    this.highlighted = null;
  }

  update(deltaTime) {
    if (!GameContext?.physics) return;
    // Raycast from camera center
    const camera = GameContext.renderer?.camera; // assume camera stored in context
    if (!camera) return;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(GameContext.scene?.children || []);
    let hitInteractable = null;
    for (const hit of intersects) {
      if (hit.object.userData?.interactable) {
        hitInteractable = hit.object;
        break;
      }
    }
    // Highlight
    if (this.highlighted !== hitInteractable) {
      if (this.highlighted) {
        // restore original material
        this.highlighted.material.emissive?.setHex(0);
      }
      if (hitInteractable) {
        hitInteractable.material.emissive?.setHex(PlayerConfig.INTERACT_HIGHLIGHT_COLOR);
      }
      this.highlighted = hitInteractable;
    }
  }

  trigger() {
    if (this.highlighted) {
      GameContext.eventBus?.emit('player:interact', { object: this.highlighted });
    }
  }
}

// ---------- PlayerCamera ----------
class PlayerCamera {
  constructor(player) {
    this.player = player;
  }

  getTarget() {
    // Look at player's chest
    return this.player.position.clone().add(new THREE.Vector3(0, 1, 0));
  }

  getPosition() {
    // Third‑person offset relative to player
    const offset = PlayerConfig.CAMERA_OFFSET;
    // Rotate offset by player's yaw
    const yaw = this.player.mesh.rotation.y;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const rotatedOffset = {
      x: offset.x * cos - offset.z * sin,
      y: offset.y,
      z: offset.x * sin + offset.z * cos,
    };
    return this.player.position.clone().add(new THREE.Vector3(rotatedOffset.x, rotatedOffset.y, rotatedOffset.z));
  }
}

// ---------- PlayerDebug ----------
class PlayerDebug {
  constructor(player) {
    this.player = player;
    this.gui = null;
    this.initGUI();
  }

  initGUI() {
    if (!PlayerConfig.DEBUG) return;
    // Assuming lil-gui is available globally
    if (typeof lil === 'undefined') return;
    this.gui = new lil.GUI({ title: 'Player Debug' });
    this.gui.add(PlayerConfig, 'WALK_SPEED', 0, 10);
    this.gui.add(PlayerConfig, 'RUN_SPEED', 0, 10);
    this.gui.add(PlayerConfig, 'JUMP_FORCE', 0, 20);
    this.gui.add(PlayerConfig, 'ACCELERATION', 0, 50);
    this.gui.add(PlayerConfig, 'MAX_HEALTH', 1, 200);
    this.gui.add(PlayerConfig, 'MAX_STAMINA', 1, 200);
  }

  update() {
    if (!PlayerConfig.DEBUG) return;
    // Draw debug lines (if renderer available)
    if (!GameContext?.renderer) return;
    // Could draw velocity vector, bounding box, etc.
  }
}

// ---------- Main Player Class ----------
export class Player {
  constructor(visualMesh, physicsId) {
    this.mesh = visualMesh;
    this.physicsId = physicsId;
    this.config = PlayerConfig;

    // Sub‑components
    this.input = new PlayerInput(this);
    this.motor = new PlayerMotor(this);
    this.animator = new PlayerAnimator(this);
    this.health = new PlayerHealth(this);
    this.interaction = new PlayerInteraction(this);
    this.camera = new PlayerCamera(this);
    this.debug = new PlayerDebug(this);

    // State cache
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.onGround = false;

    this.setupEventListeners();
    this.syncFromPhysics();
  }

  setupEventListeners() {
    GameContext?.eventBus?.on('physics:collision', this.handleCollision.bind(this));
    GameContext?.eventBus?.on('input:action', this.handleAction.bind(this));
  }

  handleCollision(data) {
    this.motor.handleCollision(data);
  }

  handleAction(action) {
    if (action === 'interact') this.interaction.trigger();
  }

  update(deltaTime) {
    // Input first
    this.input.update();

    // Physics motor
    this.motor.update(deltaTime);

    // Health/stamina
    this.health.update(deltaTime);

    // Interaction raycast
    this.interaction.update(deltaTime);

    // Camera (no update needed, just getters)
    this.camera.update?.(deltaTime);

    // Sync visual from physics
    this.syncFromPhysics();

    // Animation after position known
    this.animator.update(deltaTime);

    // Debug
    this.debug.update();
  }

  syncFromPhysics() {
    if (!GameContext?.physics) return;
    try {
      const body = GameContext.physics.getCharacterBody(this.physicsId);
      if (!body) {
        console.warn('Player: physics body not found');
        return;
      }
      const pos = body.getPosition();
      const rot = body.getRotation();
      this.mesh.position.set(pos.x, pos.y, pos.z);
      this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      this.position.copy(this.mesh.position);
      this.velocity.copy(body.getLinearVelocity());
      this.onGround = body.onGround; // assume CharacterPhysics exposes onGround
    } catch (error) {
      GameContext?.eventBus?.emit('player:error', { error, context: 'syncFromPhysics' });
      if (PlayerConfig.DEBUG) console.error('Player sync error:', error);
    }
  }

  // Public getters
  getPosition() { return this.position; }
  getCameraTarget() { return this.camera.getTarget(); }
  getCameraPosition() { return this.camera.getPosition(); }

  // Public actions
  takeDamage(amount, source) { this.health.takeDamage(amount, source); }
  heal(amount) { this.health.heal(amount); }

  dispose() {
    GameContext?.eventBus?.off('physics:collision', this.handleCollision);
    GameContext?.eventBus?.off('input:action', this.handleAction);
    this.animator.dispose();
  }
}

// ---------- Default Export ----------
export default {
  setGameContext,
  Player,
  PlayerConfig,
};