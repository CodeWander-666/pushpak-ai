// ====================================================
// ai.js – Ultimate Professional AI Subsystem
// Fully integrated with main.js (GameContext, EventBus)
// ====================================================

// ---------- AI Configuration ----------
export const AIConfig = {
  DEFAULT_MAX_SPEED: 5,
  DEFAULT_MAX_FORCE: 10,
  WANDER_RADIUS: 5,
  WANDER_DISTANCE: 10,
  OBSTACLE_AVOIDANCE_RADIUS: 2,
  PATHFINDING_UPDATE_INTERVAL: 0.5, // seconds
  DEBUG: true,
  MAX_AGENTS_PER_FRAME: 50, // for time‑slicing if needed
};

// ---------- GameContext (must be set by main.js) ----------
// Global context – assume it's available on window or imported.
// We'll use a local reference that can be set by the manager.
export let GameContext = null;
export function setGameContext(ctx) {
  GameContext = ctx;
}

// ---------- Base Agent Class ----------
export class Agent {
  constructor(entity, config = {}) {
    this.id = Symbol('agent'); // unique identifier
    this.entity = entity; // reference to physics body / visual mesh
    this.behaviors = {}; // steering behaviors (keyed by name)
    this.activeBehavior = null;
    this.decisionMaker = null; // FSM, BehaviorTree, etc.
    this.sensors = {}; // perception modules
    this.maxSpeed = config.maxSpeed ?? AIConfig.DEFAULT_MAX_SPEED;
    this.maxForce = config.maxForce ?? AIConfig.DEFAULT_MAX_FORCE;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.target = null;
    this.path = []; // waypoints from pathfinding
    this.lastUpdateTime = 0;
    this.updateInterval = 0; // for LOD (0 = every frame)
    this.frameCounter = 0;
  }

  // Called by AIManager every fixed timestep (unless LOD skips)
  update(deltaTime, doPathfinding) {
    // Update sensors
    for (const sensor of Object.values(this.sensors)) {
      try {
        sensor.update(deltaTime);
      } catch (error) {
        GameContext?.eventBus.emit('ai:error', { agent: this, error });
      }
    }

    // Decision making (choose behavior)
    if (this.decisionMaker) {
      try {
        this.decisionMaker.update(deltaTime);
      } catch (error) {
        GameContext?.eventBus.emit('ai:error', { agent: this, error });
      }
    }

    // Compute steering force
    let force = { x: 0, y: 0, z: 0 };
    if (this.activeBehavior) {
      try {
        force = this.activeBehavior.compute(this);
      } catch (error) {
        GameContext?.eventBus.emit('ai:error', { agent: this, error });
      }
    }
    this.applyForce(force, deltaTime);

    // Pathfinding update (if needed)
    if (doPathfinding && this.target) {
      this.updatePath();
    }
  }

  applyForce(force, deltaTime) {
    // Clamp force
    const len = Math.hypot(force.x, force.y, force.z);
    if (len > this.maxForce) {
      force.x = (force.x / len) * this.maxForce;
      force.y = (force.y / len) * this.maxForce;
      force.z = (force.z / len) * this.maxForce;
    }

    // Update velocity
    this.velocity.x += force.x * deltaTime;
    this.velocity.y += force.y * deltaTime;
    this.velocity.z += force.z * deltaTime;

    // Clamp speed
    const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
    if (speed > this.maxSpeed) {
      this.velocity.x = (this.velocity.x / speed) * this.maxSpeed;
      this.velocity.y = (this.velocity.y / speed) * this.maxSpeed;
      this.velocity.z = (this.velocity.z / speed) * this.maxSpeed;
    }

    // Apply to physics body (Rapier)
    if (this.entity.body && GameContext?.physics) {
      GameContext.physics.setLinearVelocity(this.entity.body, this.velocity);
    }
  }

  setTarget(target) {
    this.target = target;
  }

  updatePath() {
    if (GameContext?.pathfinder) {
      this.path = GameContext.pathfinder.findPath(this.entity.position, this.target);
    }
  }

  dispose() {
    for (const sensor of Object.values(this.sensors)) {
      if (sensor.dispose) sensor.dispose();
    }
    if (this.decisionMaker?.dispose) this.decisionMaker.dispose();
    GameContext?.eventBus.emit('ai:agent:disposed', { agent: this });
  }
}

// ---------- Steering Behaviors ----------

// WanderBehavior
export class WanderBehavior {
  constructor() {
    this.theta = 0;
  }

  compute(agent) {
    this.theta += (Math.random() - 0.5) * 0.5;
    const direction = {
      x: Math.cos(this.theta),
      y: 0,
      z: Math.sin(this.theta),
    };
    const target = {
      x: agent.entity.position.x + direction.x * AIConfig.WANDER_DISTANCE,
      y: agent.entity.position.y,
      z: agent.entity.position.z + direction.z * AIConfig.WANDER_DISTANCE,
    };
    // Seek target
    const desired = {
      x: target.x - agent.entity.position.x,
      y: 0,
      z: target.z - agent.entity.position.z,
    };
    const len = Math.hypot(desired.x, desired.y, desired.z);
    if (len > 0) {
      desired.x = (desired.x / len) * agent.maxSpeed;
      desired.z = (desired.z / len) * agent.maxSpeed;
    }
    const steer = {
      x: desired.x - agent.velocity.x,
      y: 0,
      z: desired.z - agent.velocity.z,
    };
    return steer;
  }
}

// SeekBehavior
export class SeekBehavior {
  compute(agent) {
    if (!agent.target) return { x: 0, y: 0, z: 0 };
    const desired = {
      x: agent.target.x - agent.entity.position.x,
      y: agent.target.y - agent.entity.position.y,
      z: agent.target.z - agent.entity.position.z,
    };
    const len = Math.hypot(desired.x, desired.y, desired.z);
    if (len > 0) {
      desired.x = (desired.x / len) * agent.maxSpeed;
      desired.y = (desired.y / len) * agent.maxSpeed;
      desired.z = (desired.z / len) * agent.maxSpeed;
    }
    const steer = {
      x: desired.x - agent.velocity.x,
      y: desired.y - agent.velocity.y,
      z: desired.z - agent.velocity.z,
    };
    return steer;
  }
}

// FleeBehavior
export class FleeBehavior {
  compute(agent) {
    if (!agent.target) return { x: 0, y: 0, z: 0 };
    const desired = {
      x: agent.entity.position.x - agent.target.x,
      y: agent.entity.position.y - agent.target.y,
      z: agent.entity.position.z - agent.target.z,
    };
    const len = Math.hypot(desired.x, desired.y, desired.z);
    if (len > 0) {
      desired.x = (desired.x / len) * agent.maxSpeed;
      desired.y = (desired.y / len) * agent.maxSpeed;
      desired.z = (desired.z / len) * agent.maxSpeed;
    }
    const steer = {
      x: desired.x - agent.velocity.x,
      y: desired.y - agent.velocity.y,
      z: desired.z - agent.velocity.z,
    };
    return steer;
  }
}

// PursuitBehavior
export class PursuitBehavior {
  compute(agent) {
    if (!agent.target || !agent.target.velocity) return { x: 0, y: 0, z: 0 };
    const toTarget = {
      x: agent.target.position.x - agent.entity.position.x,
      y: agent.target.position.y - agent.entity.position.y,
      z: agent.target.position.z - agent.entity.position.z,
    };
    const distance = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
    const speed = Math.hypot(agent.velocity.x, agent.velocity.y, agent.velocity.z);
    const time = distance / (speed || 1);
    const futurePos = {
      x: agent.target.position.x + agent.target.velocity.x * time,
      y: agent.target.position.y + agent.target.velocity.y * time,
      z: agent.target.position.z + agent.target.velocity.z * time,
    };
    const desired = {
      x: futurePos.x - agent.entity.position.x,
      y: futurePos.y - agent.entity.position.y,
      z: futurePos.z - agent.entity.position.z,
    };
    const len = Math.hypot(desired.x, desired.y, desired.z);
    if (len > 0) {
      desired.x = (desired.x / len) * agent.maxSpeed;
      desired.y = (desired.y / len) * agent.maxSpeed;
      desired.z = (desired.z / len) * agent.maxSpeed;
    }
    const steer = {
      x: desired.x - agent.velocity.x,
      y: desired.y - agent.velocity.y,
      z: desired.z - agent.velocity.z,
    };
    return steer;
  }
}

// FlockingBehavior (simplified – requires neighbor detection)
export class FlockingBehavior {
  constructor() {
    this.separationWeight = 1.5;
    this.alignmentWeight = 1.0;
    this.cohesionWeight = 1.0;
  }

  compute(agent) {
    // This would require access to nearby agents from AIManager
    // For now, returns zero.
    return { x: 0, y: 0, z: 0 };
  }
}

// ---------- Decision Making ----------

// Finite State Machine
export class FSM {
  constructor(agent) {
    this.agent = agent;
    this.states = new Map();
    this.currentState = null;
  }

  addState(name, state) {
    this.states.set(name, state);
  }

  changeState(name) {
    if (!this.states.has(name)) {
      console.warn(`State ${name} not found`);
      return;
    }
    if (this.currentState) {
      try {
        this.currentState.exit(this.agent);
      } catch (error) {
        GameContext?.eventBus.emit('ai:error', { agent: this.agent, error });
      }
    }
    this.currentState = this.states.get(name);
    if (this.currentState) {
      try {
        this.currentState.enter(this.agent);
      } catch (error) {
        GameContext?.eventBus.emit('ai:error', { agent: this.agent, error });
      }
    }
  }

  update(deltaTime) {
    if (this.currentState) {
      try {
        this.currentState.update(this.agent, deltaTime);
      } catch (error) {
        GameContext?.eventBus.emit('ai:error', { agent: this.agent, error });
      }
    }
  }
}

// Example state templates (can be used as is or extended)
export const WanderState = {
  enter: (agent) => {
    agent.activeBehavior = agent.behaviors.wander || new WanderBehavior();
  },
  update: (agent, delta) => {
    if (agent.sensors.vision?.seesPlayer) {
      agent.decisionMaker?.changeState('chase');
    }
  },
  exit: (agent) => {
    agent.activeBehavior = null;
  },
};

export const ChaseState = {
  enter: (agent) => {
    agent.activeBehavior = agent.behaviors.seek || new SeekBehavior();
  },
  update: (agent, delta) => {
    agent.setTarget(agent.sensors.vision?.lastKnownPlayerPosition);
    if (agent.sensors.vision && !agent.sensors.vision.seesPlayer) {
      agent.decisionMaker?.changeState('wander');
    }
  },
  exit: (agent) => {
    agent.activeBehavior = null;
  },
};

// Behavior Tree Node base
class Node {
  constructor() { this.state = 'READY'; }
  tick(agent) { /* override */ }
}

export class BehaviorTree {
  constructor(root) {
    this.root = root;
  }
  update(agent) {
    if (this.root) this.root.tick(agent);
  }
}

// Utility AI (placeholder)
export class UtilityAI {
  constructor(agent, options = {}) {
    this.agent = agent;
    this.options = options;
  }
  update(deltaTime) {
    // Compute utilities for each behavior and select highest
  }
}

// ---------- Sensors ----------

export class VisionSensor {
  constructor(agent, range = 10, fov = Math.PI / 2) {
    this.agent = agent;
    this.range = range;
    this.fieldOfView = fov;
    this.seesPlayer = false;
    this.lastKnownPlayerPosition = null;
    this.lastDetectionTime = 0;
  }

  update(deltaTime) {
    const player = GameContext?.state?.player;
    if (!player) return;

    const toPlayer = {
      x: player.position.x - this.agent.entity.position.x,
      y: player.position.y - this.agent.entity.position.y,
      z: player.position.z - this.agent.entity.position.z,
    };
    const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
    if (dist > this.range) {
      this.seesPlayer = false;
      return;
    }

    // Line‑of‑sight check
    const hit = GameContext?.physics?.raycast(
      this.agent.entity.position,
      player.position
    );
    const visible = !hit || hit.body === player.body;
    if (visible) {
      // Angle check (using agent's forward direction if available)
      const forward = this.agent.entity.forward || { x: 0, y: 0, z: 1 };
      const toPlayerNorm = {
        x: toPlayer.x / dist,
        y: toPlayer.y / dist,
        z: toPlayer.z / dist,
      };
      const dot = forward.x * toPlayerNorm.x + forward.z * toPlayerNorm.z;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle <= this.fieldOfView / 2) {
        this.seesPlayer = true;
        this.lastKnownPlayerPosition = { ...player.position };
        this.lastDetectionTime = performance.now();
        GameContext?.eventBus.emit('ai:playerSpotted', { agent: this.agent, player });
        return;
      }
    }
    this.seesPlayer = false;
  }
}

export class HearingSensor {
  constructor(agent, range = 20) {
    this.agent = agent;
    this.range = range;
    this.heardSomething = false;
    this.lastHeardPosition = null;
    this.lastHeardTime = 0;

    // Listen for sound events
    GameContext?.eventBus.on('sound:emitted', (data) => {
      const dx = data.position.x - this.agent.entity.position.x;
      const dy = data.position.y - this.agent.entity.position.y;
      const dz = data.position.z - this.agent.entity.position.z;
      const distSq = dx*dx + dy*dy + dz*dz;
      if (distSq <= this.range * this.range) {
        this.heardSomething = true;
        this.lastHeardPosition = data.position;
        this.lastHeardTime = performance.now();
        GameContext?.eventBus.emit('ai:heard', { agent: this.agent, source: data });
      }
    });
  }

  update(deltaTime) {
    // Can fade out after some time if needed
  }

  dispose() {
    GameContext?.eventBus.off('sound:emitted');
  }
}

export class TouchSensor {
  constructor(agent) {
    this.agent = agent;
    this.touching = new Set();

    // Listen to physics collision events
    GameContext?.eventBus.on('physics:collision', (data) => {
      if (data.bodyA === this.agent.entity.body || data.bodyB === this.agent.entity.body) {
        const other = data.bodyA === this.agent.entity.body ? data.bodyB : data.bodyA;
        this.touching.add(other);
        GameContext?.eventBus.emit('ai:touching', { agent: this.agent, other });
      }
    });
  }

  update(deltaTime) {
    // Could clear on each frame if collisions are reported per‑frame
  }

  dispose() {
    GameContext?.eventBus.off('physics:collision');
  }
}

// ---------- Pathfinding (Interfaces) ----------

export class NavMesh {
  constructor(geometry) {
    // Build navmesh from geometry – not implemented
  }

  findPath(start, end) {
    // Placeholder
    return [end];
  }
}

export class AStar {
  constructor(grid) { /* ... */ }
  findPath(start, end) { return []; }
}

// ---------- Debug Drawer ----------
export class DebugDrawer {
  constructor() {
    this.lines = [];
    this.spheres = [];
    this.group = new THREE.Group(); // requires THREE global
    GameContext?.renderer?.scene?.add(this.group);
  }

  drawLine(from, to, color = 0xff00ff) {
    if (!GameContext?.renderer) return;
    const material = new THREE.LineBasicMaterial({ color });
    const points = [new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z)];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    this.group.add(line);
    this.lines.push(line);
  }

  drawSphere(center, radius, color = 0xff00ff) {
    const geometry = new THREE.SphereGeometry(radius, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color, wireframe: true });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.set(center.x, center.y, center.z);
    this.group.add(sphere);
    this.spheres.push(sphere);
  }

  drawAgent(agent) {
    if (agent.sensors.vision) {
      this.drawSphere(agent.entity.position, agent.sensors.vision.range, 0x00ff00);
    }
    if (agent.path && agent.path.length) {
      for (let i = 0; i < agent.path.length - 1; i++) {
        this.drawLine(agent.path[i], agent.path[i + 1], 0xffff00);
      }
    }
  }

  clear() {
    for (const obj of this.lines) this.group.remove(obj);
    for (const obj of this.spheres) this.group.remove(obj);
    this.lines = [];
    this.spheres = [];
  }

  dispose() {
    this.clear();
    GameContext?.renderer?.scene?.remove(this.group);
  }
}

// ---------- AIManager (Core Orchestrator) ----------
export class AIManager {
  constructor() {
    this.agents = new Set();
    this.pendingAdd = [];
    this.pendingRemove = [];
    this.debugDrawer = AIConfig.DEBUG ? new DebugDrawer() : null;
    this.lastPathfindingUpdate = 0;
    this.spatialGrid = null; // for optimizations (optional)
    this.frameCount = 0;

    // Bind event handlers
    this.onEntitySpawn = this.onEntitySpawn.bind(this);
    this.onEntityDespawn = this.onEntityDespawn.bind(this);

    if (GameContext?.eventBus) {
      GameContext.eventBus.on('entity:spawn', this.onEntitySpawn);
      GameContext.eventBus.on('entity:despawn', this.onEntityDespawn);
    }
  }

  onEntitySpawn(data) {
    const entity = data.entity || data;
    const agent = new Agent(entity);
    this.pendingAdd.push(agent);
    GameContext?.eventBus.emit('ai:agent:added', { agent });
  }

  onEntityDespawn(data) {
    const agent = data.agent || data;
    this.pendingRemove.push(agent);
  }

  update(deltaTime) {
    // Process pending adds/removes
    for (const agent of this.pendingAdd) this.agents.add(agent);
    this.pendingAdd.length = 0;
    for (const agent of this.pendingRemove) {
      this.agents.delete(agent);
      agent.dispose();
    }
    this.pendingRemove.length = 0;

    // Pathfinding timing
    this.lastPathfindingUpdate += deltaTime;
    const doPathfinding = this.lastPathfindingUpdate >= AIConfig.PATHFINDING_UPDATE_INTERVAL;
    if (doPathfinding) this.lastPathfindingUpdate = 0;

    // Update each agent (with optional time‑slicing / LOD)
    for (const agent of this.agents) {
      // Simple LOD: skip agents far from player (if player exists)
      const player = GameContext?.state?.player;
      if (player) {
        const dx = player.position.x - agent.entity.position.x;
        const dy = player.position.y - agent.entity.position.y;
        const dz = player.position.z - agent.entity.position.z;
        const distSq = dx*dx + dy*dy + dz*dz;
        if (distSq > 10000) { // 100 units
          // Very far: update less frequently (skip most frames)
          if ((this.frameCount % 10) !== 0) continue;
        } else if (distSq > 2500) { // 50 units
          if ((this.frameCount % 3) !== 0) continue;
        }
      }

      try {
        agent.update(deltaTime, doPathfinding);
      } catch (error) {
        GameContext?.eventBus.emit('ai:error', { agent, error });
        console.warn('AI agent error, removing:', error);
        this.pendingRemove.push(agent); // quarantine
      }
    }

    // Debug visualization
    if (this.debugDrawer) {
      this.debugDrawer.clear();
      for (const agent of this.agents) {
        this.debugDrawer.drawAgent(agent);
      }
    }

    this.frameCount++;
  }

  dispose() {
    if (GameContext?.eventBus) {
      GameContext.eventBus.off('entity:spawn', this.onEntitySpawn);
      GameContext.eventBus.off('entity:despawn', this.onEntityDespawn);
    }
    for (const agent of this.agents) agent.dispose();
    this.agents.clear();
    this.pendingAdd = [];
    this.pendingRemove = [];
    if (this.debugDrawer) {
      this.debugDrawer.dispose();
      this.debugDrawer = null;
    }
  }
}

// ---------- Default Export ----------
export default {
  setGameContext,
  AIManager,
  Agent,
  WanderBehavior,
  SeekBehavior,
  FleeBehavior,
  PursuitBehavior,
  FlockingBehavior,
  FSM,
  WanderState,
  ChaseState,
  BehaviorTree,
  UtilityAI,
  VisionSensor,
  HearingSensor,
  TouchSensor,
  NavMesh,
  AStar,
  DebugDrawer,
  AIConfig,
};