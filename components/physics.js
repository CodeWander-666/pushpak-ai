// ====================================================
// physics.js – Ultimate Physics Subsystem
// ====================================================
import RAPIER from '@dimforge/rapier3d-compat';
// ---------- GameContext (set by main.js) ----------
export let GameContext = null;
export function setGameContext(ctx) { GameContext = ctx; }

// ---------- Physics Configuration ----------
export const PhysicsConfig = {
  GRAVITY: -9.81,
  FIXED_TIMESTEP: 1/60,
  MAX_SUBSTEPS: 5,
  MATERIALS: {
    SKIN: { restitution: 0.2, friction: 0.8, density: 1100 },
    BONE: { restitution: 0.1, friction: 0.5, density: 1900 },
    CLOTH: { restitution: 0.1, friction: 0.6, density: 600 },
    WATER: { density: 1000, drag: 0.5 },
    AIR: { density: 1.2, drag: 0.1 },
  },
  CHARACTER_MASS: 80,
  CHARACTER_RADIUS: 0.4,
  CHARACTER_HEIGHT: 1.8,
  CHARACTER_MAX_SPEED: 5,
  CHARACTER_MAX_FORCE: 20,
  JUMP_FORCE: 8,
  MUSCLE_TORQUE_COEFF: 200,
  WATER_DENSITY: 1000,
  AIR_DENSITY: 1.2,
  DRAG_COEFF_SPHERE: 0.47,
  METABOLIC_BASAL: 80,
  SPECIFIC_HEAT_BODY: 3470,
  SWEAT_LATENT_HEAT: 2.26e6,
  CONVECTION_COEFF: 10,
  RADIATION_COEFF: 5.67e-8,
  EYE_FOCAL_LENGTH: 0.017,
  PUPIL_MIN_RADIUS: 0.001,
  PUPIL_MAX_RADIUS: 0.004,
  BALANCE_PID: { kp: 100, ki: 10, kd: 5 },
  GAIT_PID: { kp: 50, ki: 5, kd: 2 },
  DEBUG: true,
};

// ---------- PID Controller ----------
export class PID {
  constructor({ kp, ki, kd }) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.integral = 0;
    this.prevError = 0;
  }

  update(error, dt) {
    this.integral += error * dt;
    const derivative = (error - this.prevError) / dt;
    const output = this.kp * error + this.ki * this.integral + this.kd * derivative;
    this.prevError = error;
    return output;
  }
}

// ---------- RigidBody Wrapper ----------
export class RigidBody {
  constructor(world, options) {
    this.world = world;
    this.body = options.body;
    this.collider = options.collider;
    this.userData = options.userData || {};
    this.mass = options.mass || 1;
    this.material = options.material || 'SKIN';
  }

  applyForce(force, wake = true) {
    this.body.applyForce(force, wake);
  }

  applyImpulse(impulse, wake = true) {
    this.body.applyImpulse(impulse, wake);
  }

  applyImpulseAtPoint(impulse, point, wake = true) {
    this.body.applyImpulseAtPoint(impulse, point, wake);
  }

  applyTorque(torque, wake = true) {
    this.body.applyTorque(torque, wake);
  }

  setLinearVelocity(vel) { this.body.setLinvel(vel); }
  setAngularVelocity(vel) { this.body.setAngvel(vel); }
  getPosition() { return this.body.translation(); }
  getRotation() { return this.body.rotation(); }

  getKineticEnergy() {
    const v = this.body.linvel();
    const ω = this.body.angvel();
    const I = this.body.massProperties().principalInertia;
    return 0.5 * this.mass * (v.x*v.x + v.y*v.y + v.z*v.z) +
           0.5 * (I.x*ω.x*ω.x + I.y*ω.y*ω.y + I.z*ω.z*ω.z);
  }

  dispose() {
    this.world.removeCollider(this.collider);
    this.world.removeRigidBody(this.body);
  }
}

// ---------- CharacterPhysics ----------
export class CharacterPhysics {
  constructor(world, config = PhysicsConfig) {
    this.world = world;
    this.config = config;
    this.body = null;
    this.meshGroup = null;
    this.onGround = false;
    this.jumpRequested = false;
    this.jumpCooldown = 0;
    this.balancePID = new PID(config.BALANCE_PID);
    this.gaitPID = new PID(config.GAIT_PID);
    this.muscleTorques = { hip:0, knee:0, ankle:0, shoulder:0, elbow:0 };
    this.tendonStrain = 0;
    this.bodyTemperature = 37.0;
    this.sweatRate = 0;
    this.pupilRadius = config.PUPIL_MAX_RADIUS;
    this.headRotation = { x:0, y:0, z:0, w:1 };
  }

  init() {
    const bodyDesc = Rapier.RigidBodyDesc.dynamic()
      .setTranslation(0, 2, 0)
      .setLinvel(0,0,0);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = Rapier.ColliderDesc.capsule(
      this.config.CHARACTER_HEIGHT/2,
      this.config.CHARACTER_RADIUS
    );
    const collider = this.world.createCollider(colliderDesc, body);
    this.body = new RigidBody(this.world, { body, collider, mass: this.config.CHARACTER_MASS });
  }

  update(deltaTime) {
    this.detectGround();
    const moveDir = this.getMoveDirection();
    this.applyLocomotionForces(moveDir, deltaTime);

    if (this.jumpRequested && this.onGround && this.jumpCooldown <= 0) {
      this.applyJump();
      this.jumpRequested = false;
    }
    this.jumpCooldown -= deltaTime;

    this.updateTendonEnergy(deltaTime);
    this.applyBalanceCorrection(deltaTime);
    this.applyGaitPattern(deltaTime);
    this.applyRotationalTorques(deltaTime);
    this.updateThermalState(deltaTime);
  }

  detectGround() {
    const pos = this.body.getPosition();
    const rayStart = { x: pos.x, y: pos.y, z: pos.z };
    const rayEnd = { x: pos.x, y: pos.y - this.config.CHARACTER_HEIGHT/2 - 0.1, z: pos.z };
    const hit = this.world.castRay(rayStart, rayEnd);
    this.onGround = !!hit;
  }

  getMoveDirection() {
    if (!GameContext?.input) return null;
    const dir = { x:0, y:0, z:0 };
    if (GameContext.input.isPressed('moveForward')) dir.z = -1;
    if (GameContext.input.isPressed('moveBackward')) dir.z = 1;
    if (GameContext.input.isPressed('moveLeft')) dir.x = -1;
    if (GameContext.input.isPressed('moveRight')) dir.x = 1;
    const len = Math.hypot(dir.x, dir.z);
    if (len > 0) {
      dir.x /= len;
      dir.z /= len;
    }
    return dir;
  }

  getTurnInput() {
    if (!GameContext?.input) return 0;
    let turn = 0;
    if (GameContext.input.isPressed('turnLeft')) turn = 1;
    if (GameContext.input.isPressed('turnRight')) turn = -1;
    return turn;
  }

  applyLocomotionForces(dir, dt) {
    if (!dir) return;
    const desiredVel = {
      x: dir.x * this.config.CHARACTER_MAX_SPEED,
      y: 0,
      z: dir.z * this.config.CHARACTER_MAX_SPEED,
    };
    const currentVel = this.body.body.linvel();
    const deltaV = {
      x: desiredVel.x - currentVel.x,
      y: 0,
      z: desiredVel.z - currentVel.z,
    };
    let impulse = {
      x: deltaV.x * this.config.CHARACTER_MASS,
      y: 0,
      z: deltaV.z * this.config.CHARACTER_MASS,
    };
    const impLen = Math.hypot(impulse.x, impulse.y, impulse.z);
    const maxImpulse = this.config.CHARACTER_MAX_FORCE * dt;
    if (impLen > maxImpulse) {
      const scale = maxImpulse / impLen;
      impulse.x *= scale;
      impulse.y *= scale;
      impulse.z *= scale;
    }
    this.body.applyImpulse(impulse);
  }

  applyJump() {
    const impulse = { x:0, y: this.config.JUMP_FORCE, z:0 };
    this.body.applyImpulse(impulse);
    this.jumpCooldown = 0.2;
  }

  updateTendonEnergy(dt) {
    const vel = this.body.body.linvel();
    if (this.onGround && vel.y < -0.1) {
      this.tendonStrain += 0.1 * dt;
    } else {
      this.tendonStrain *= 0.9;
    }
    if (this.tendonStrain > 0) {
      const elasticForce = { x:0, y: this.tendonStrain * 500, z:0 };
      this.body.applyForce(elasticForce);
    }
  }

  applyBalanceCorrection(dt) {
    const com = this.body.getPosition();
    // Simplified support point at feet (0,y,z)
    const error = { x: com.x, z: com.z };
    const correction = this.balancePID.update(error, dt);
    const torque = { x:0, y: correction.x * 10, z:0 };
    this.body.applyTorque(torque);
  }

  applyGaitPattern(dt) {
    const phase = (performance.now() * 0.01) % (2*Math.PI);
    const leftLeg = Math.sin(phase);
    const rightLeg = Math.sin(phase + Math.PI);
    this.muscleTorques.hip = leftLeg * 100;
    this.muscleTorques.knee = Math.abs(leftLeg) * 50;
    // (In a full simulation, apply torques to bones)
  }

  applyRotationalTorques(dt) {
    const desiredTurn = this.getTurnInput();
    if (desiredTurn) {
      const inertia = this.body.body.massProperties().principalInertia.y;
      const torque = { x:0, y: desiredTurn * inertia * 10, z:0 };
      this.body.applyTorque(torque);
    }
  }

  updateThermalState(dt) {
    const workRate = this.body.getKineticEnergy() / dt;
    const metabolicRate = this.config.METABOLIC_BASAL + workRate * 4;
    const skinTemp = this.bodyTemperature;
    const ambientTemp = GameContext?.environment?.temperature || 20;
    const area = 1.8;
    const convection = this.config.CONVECTION_COEFF * area * (skinTemp - ambientTemp);
    const radiation = 0.95 * 5.67e-8 * area *
      (Math.pow(skinTemp + 273.15, 4) - Math.pow(ambientTemp + 273.15, 4));
    let evaporation = 0;
    if (skinTemp > 37 && this.sweatRate > 0) {
      evaporation = this.sweatRate * this.config.SWEAT_LATENT_HEAT;
    }
    const netHeat = metabolicRate - convection - radiation - evaporation;
    const heatCapacity = this.config.SPECIFIC_HEAT_BODY * this.config.CHARACTER_MASS;
    this.bodyTemperature += netHeat * dt / heatCapacity;
    const error = this.bodyTemperature - 37.0;
    this.sweatRate = Math.max(0, error * 0.001);
  }

  getPupilRadius(luminance) {
    const target = luminance > 1000 ? this.config.PUPIL_MIN_RADIUS : this.config.PUPIL_MAX_RADIUS;
    this.pupilRadius += (target - this.pupilRadius) * 0.1;
    return this.pupilRadius;
  }
}

// ---------- FluidSimulator ----------
export class FluidSimulator {
  constructor(world, config) {
    this.world = world;
    this.config = config;
    this.fluids = [];
  }

  addFluidRegion(region) {
    this.fluids.push(region);
  }

  computeIntersection(body, fluid) {
    // Simplified: treat body as sphere at its position
    const pos = body.getPosition();
    const r = PhysicsConfig.CHARACTER_RADIUS;
    const dist = Math.hypot(pos.x - fluid.x, pos.y - fluid.y, pos.z - fluid.z);
    if (dist > r) return { volume:0, area:0 };
    const volume = (4/3) * Math.PI * r*r*r * 0.5; // half submerged approximation
    const area = Math.PI * r*r; // cross‑section
    return { volume, area };
  }

  applyBuoyancyAndDrag(body) {
    for (const fluid of this.fluids) {
      const inter = this.computeIntersection(body, fluid);
      if (inter.volume > 0) {
        const buoyant = { x:0, y: fluid.density * 9.81 * inter.volume, z:0 };
        body.applyForce(buoyant);
        const vel = body.body.linvel();
        const speed = Math.hypot(vel.x, vel.y, vel.z);
        if (speed > 0) {
          const dragMag = 0.5 * fluid.density * speed*speed *
            this.config.DRAG_COEFF_SPHERE * inter.area;
          const dragDir = { x: -vel.x/speed, y: -vel.y/speed, z: -vel.z/speed };
          const drag = { x: dragDir.x * dragMag, y: dragDir.y * dragMag, z: dragDir.z * dragMag };
          body.applyForce(drag);
        }
      }
    }
  }

  computePressureDrop(flowRate, r1, r2) {
    const v1 = flowRate / (Math.PI * r1*r1);
    const v2 = flowRate / (Math.PI * r2*r2);
    return 0.5 * 1060 * (v2*v2 - v1*v1);
  }

  computeWallTension(pressure, radius) {
    return pressure * radius;
  }

  computeNetFiltration(P_cap, P_if, π_cap, π_if, Kf, σ=1) {
    return Kf * ((P_cap - P_if) - σ*(π_cap - π_if));
  }
}

// ---------- Thermodynamics ----------
export class Thermodynamics {
  constructor(config) {
    this.config = config;
    this.bodyTemperature = 37.0;
    this.sweatRate = 0;
    this.shivering = false;
  }

  update(metabolicRate, ambientTemp, airSpeed, humidity, dt) {
    const skinTemp = this.bodyTemperature;
    const area = 1.8;
    const h = this.config.CONVECTION_COEFF * (1 + 0.5 * airSpeed);
    const convection = h * area * (skinTemp - ambientTemp);
    const radiation = 0.95 * 5.67e-8 * area *
      (Math.pow(skinTemp+273.15,4) - Math.pow(ambientTemp+273.15,4));
    let evaporation = 0;
    if (skinTemp > 36.5 && this.sweatRate > 0) {
      evaporation = this.sweatRate * this.config.SWEAT_LATENT_HEAT;
    }
    const net = metabolicRate - convection - radiation - evaporation;
    const heatCapacity = this.config.SPECIFIC_HEAT_BODY * PhysicsConfig.CHARACTER_MASS;
    this.bodyTemperature += net * dt / heatCapacity;
    const error = this.bodyTemperature - 37.0;
    this.sweatRate = Math.max(0, error * 0.001);
    if (this.bodyTemperature < 36.0) {
      this.shivering = true;
    } else {
      this.shivering = false;
    }
  }
}

// ---------- Acoustics ----------
export class Acoustics {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.materialSoundMap = {
      SKIN: { pitchBase:200, volumeBase:0.3 },
      BONE: { pitchBase:800, volumeBase:0.7 },
      CLOTH: { pitchBase:100, volumeBase:0.1 },
    };
  }

  onCollision(bodyA, bodyB, contact) {
    const force = contact.force;
    const impulse = force * 0.01; // rough approximation
    const volume = Math.min(1, impulse / 100);
    const matA = bodyA.material;
    const matB = bodyB.material;
    const pitch = (this.materialSoundMap[matA]?.pitchBase + this.materialSoundMap[matB]?.pitchBase) / 2;
    this.eventBus?.emit('sound:play', {
      type: 'sfx',
      options: {
        url: `sounds/impact_${matA}_${matB}.wav`,
        gain: volume,
        pitch: pitch / 440,
        position: contact.point,
      }
    });
  }

  computeDopplerShift(sourceVel, listenerVel, sourceDir, freq) {
    const c = 343;
    const rel = (sourceVel.x - listenerVel.x)*sourceDir.x +
                (sourceVel.y - listenerVel.y)*sourceDir.y +
                (sourceVel.z - listenerVel.z)*sourceDir.z;
    return freq * c / (c - rel);
  }
}

// ---------- Bioelectricity ----------
export class Bioelectricity {
  constructor() {
    this.heartDipole = { magnitude:1, direction:[0,1,0] };
    this.heartPos = { x:0, y:1.2, z:0 };
  }

  updateHeartDipole() {
    const t = performance.now() * 0.001;
    this.heartDipole.magnitude = 1 + 0.5 * Math.sin(2 * Math.PI * 1.2 * t);
  }

  computeECG(electrodePos) {
    const dx = electrodePos.x - this.heartPos.x;
    const dy = electrodePos.y - this.heartPos.y;
    const dz = electrodePos.z - this.heartPos.z;
    const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const rx = dx / r, ry = dy / r, rz = dz / r;
    const dot = this.heartDipole.magnitude *
                (rx*this.heartDipole.direction[0] +
                 ry*this.heartDipole.direction[1] +
                 rz*this.heartDipole.direction[2]);
    return dot / (r * r) * 1e6;
  }
}

// ---------- Optics ----------
export class Optics {
  constructor(config) {
    this.config = config;
    this.pupilRadius = config.PUPIL_MAX_RADIUS;
    this.lensCurvature = 1 / config.EYE_FOCAL_LENGTH;
  }

  refract(incidentDir, normal, n1, n2) {
    const cosI = -incidentDir.dot(normal);
    const sinI = Math.sqrt(1 - cosI*cosI);
    const sinR = (n1 / n2) * sinI;
    if (sinR > 1) return null;
    const cosR = Math.sqrt(1 - sinR*sinR);
    return incidentDir.clone().add(normal.clone().multiplyScalar(cosR - cosI)).normalize();
  }

  focus(distance) {
    const n = 1.4;
    const R = distance > 5 ? 0.01 : 0.008;
    this.lensCurvature = (n - 1) * (2 / R);
  }

  updatePupil(luminance) {
    const target = luminance > 1000 ? this.config.PUPIL_MIN_RADIUS : this.config.PUPIL_MAX_RADIUS;
    this.pupilRadius += (target - this.pupilRadius) * 0.1;
  }

  computeVisualAcuity() {
    const wavelength = 550e-9;
    return 1.22 * wavelength / (2 * this.pupilRadius);
  }
}

// ---------- PhysicsManager (Orchestrator) ----------
export class PhysicsManager {
  constructor() {
    this.world = null;
    this.bodies = new Map();
    this.characters = new Map();
    this.fluidSim = null;
    this.thermo = null;
    this.acoustics = null;
    this.bio = null;
    this.optics = null;
    this.fixedAccumulator = 0;
    this.initWorld();
    this.setupEventListeners();
  }

  async initWorld() {
    const RAPIER = await import('https://cdn.skypack.dev/@dimforge/rapier3d');
    const gravity = { x: 0, y: PhysicsConfig.GRAVITY, z: 0 };
    this.world = new RAPIER.World(gravity);
    this.fluidSim = new FluidSimulator(this.world, PhysicsConfig);
    this.thermo = new Thermodynamics(PhysicsConfig);
    this.acoustics = new Acoustics(GameContext?.eventBus);
    this.bio = new Bioelectricity();
    this.optics = new Optics(PhysicsConfig);
    GameContext?.eventBus?.emit('physics:ready');
  }

  step(deltaTime) {
    if (!this.world) return;
    this.fixedAccumulator += deltaTime;
    let steps = 0;
    while (this.fixedAccumulator >= PhysicsConfig.FIXED_TIMESTEP && steps < PhysicsConfig.MAX_SUBSTEPS) {
      this.world.step();
      this.fixedAccumulator -= PhysicsConfig.FIXED_TIMESTEP;
      steps++;

      for (const char of this.characters.values()) {
        char.update(PhysicsConfig.FIXED_TIMESTEP);
      }
      for (const body of this.bodies.values()) {
        if (this.fluidSim) this.fluidSim.applyBuoyancyAndDrag(body);
      }
      this.processCollisions();
    }

    if (this.thermo && GameContext?.environment) {
      this.thermo.update(
        100, // placeholder metabolic rate
        GameContext.environment.temperature || 20,
        GameContext.environment.airSpeed || 0,
        0.5, // humidity
        deltaTime
      );
    }
    if (this.bio) this.bio.updateHeartDipole();
    if (this.optics && GameContext?.environment) {
      this.optics.updatePupil(GameContext.environment.luminance || 100);
    }
    if (PhysicsConfig.DEBUG) this.debugDraw();
  }

  processCollisions() {
    // This would iterate over contact pairs; Rapier provides contact events via world.contacts()
    // For simplicity, we omit detailed implementation here.
  }

  createBody(options) {
    if (!this.world) return null;
    const body = new RigidBody(this.world, options);
    this.bodies.set(body.body.handle, body);
    return body;
  }

  createCharacter(options = {}) {
    const char = new CharacterPhysics(this.world);
    char.init();
    this.characters.set(char.body.body.handle, char);
    return char;
  }

  setupEventListeners() {
    GameContext?.eventBus?.on('physics:applyForce', (data) => {
      const body = this.bodies.get(data.id);
      if (body) body.applyForce(data.force);
    });
    GameContext?.eventBus?.on('physics:applyImpulse', (data) => {
      const body = this.bodies.get(data.id);
      if (body) body.applyImpulse(data.impulse);
    });
  }

  debugDraw() {
    // Stub for debug visualization
  }
}

// ---------- Default Export ----------
export default {
  setGameContext,
  PhysicsManager,
  RigidBody,
  CharacterPhysics,
  FluidSimulator,
  Thermodynamics,
  Acoustics,
  Bioelectricity,
  Optics,
  PID,
  PhysicsConfig,
};