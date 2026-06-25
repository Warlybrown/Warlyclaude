// PlayerController.js — first-person movement, stance, lean, collision.
//
// Owns the player's LOGICAL state and steps it each fixed tick. The camera's
// visual transform is applied separately by FirstPersonCamera from the snapshot
// returned by getCameraState().
//
// Design choices (Siege-style tactical feel):
//   * Acceleration + friction, never instant snap.
//   * No jump (keeps engagements grounded and deliberate).
//   * Crouch lowers eye height + hitbox and reduces speed; usable to "pie".
//   * Lean (Q/E) peeks the camera sideways past cover; raycast-validated so you
//     can't lean *through* a wall.
//   * Sprint is faster but blocks firing/ADS (enforced by Weapon/main).
//   * Collide-and-slide against axis-aligned box colliders in the XZ plane.

import * as THREE from 'three';
import { clamp, damp, moveToward } from '../util/math.js';
import { castRay } from '../util/raycast.js';

const STAND_EYE = 1.62;
const CROUCH_EYE = 1.05;
const PITCH_LIMIT = Math.PI / 2 - 0.04;

// Movement tuning (metres/second). Medium "2-speed" operator hardcoded for now.
const SPEED = {
  walk: 3.0,
  crouch: 1.55,
  sprint: 5.0,
  adsMul: 0.55, // multiplier while aiming down sights
};
const ACCEL = 38; // m/s^2 toward target velocity
const FRICTION = 12; // higher = stops quicker when no input

export class PlayerController {
  /**
   * @param {Input} input
   * @param {object} world  { colliders: THREE.Box3[], solids: THREE.Object3D[] }
   */
  constructor(input, world) {
    this.input = input;
    this.world = world;

    this.position = new THREE.Vector3(0, 0, 8); // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI; // face -Z toward the arena
    this.pitch = 0;

    this.radius = 0.34; // capsule radius for collision
    this.crouch01 = 0; // 0 stand .. 1 crouch (smoothed)
    this.eyeHeight = STAND_EYE;

    this.leanTarget = 0; // -1 left, +1 right (input)
    this.leanAllowed = true; // gated by wall raycast
    this.sprinting = false;
    this.ads = false;
    this.moving = false;
    this.speed01 = 0; // current horizontal speed normalized to walk speed

    this.sensitivity = 0.0022;
    this._lastLookDelta = { x: 0, y: 0 };

    this.alive = true;
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.lastHitFrom = null; // world pos of last damage source (for dir indicator)
    this.onDeath = null;
  }

  /** Apply damage from an optional world-space source position. */
  takeDamage(amount, fromPos = null) {
    if (!this.alive) return;
    this.health -= amount;
    this.lastHitFrom = fromPos;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      if (this.onDeath) this.onDeath();
    }
  }

  /** Respawn/reset for a new round at a spawn position. */
  reset(pos, yaw = Math.PI) {
    this.position.set(pos.x, pos.y, pos.z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.crouch01 = 0;
    this.ads = false;
    this.sprinting = false;
  }

  /** True if the player may fire (not sprinting). */
  get canFire() {
    return this.alive && !this.sprinting;
  }

  update(dt) {
    if (!this.alive) return;
    const input = this.input;

    // --- look ---
    const look = input.consumeLookDelta();
    this._lastLookDelta = look;
    if (input.locked) {
      this.yaw -= look.x * this.sensitivity * (this.ads ? 0.7 : 1);
      this.pitch -= look.y * this.sensitivity * (this.ads ? 0.7 : 1);
      this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    }

    // --- stance: crouch (hold) ---
    const wantCrouch = input.isDown('ControlLeft') || input.isDown('ControlRight') ||
      input.isDown('KeyC');
    this.crouch01 = damp(this.crouch01, wantCrouch ? 1 : 0, 14, dt);
    this.eyeHeight = STAND_EYE + (CROUCH_EYE - STAND_EYE) * this.crouch01;

    // --- ADS (hold right mouse), blocked while sprinting ---
    const wantAds = input.mouse.right;

    // --- desired horizontal movement (camera-relative) ---
    let ix = 0;
    let iz = 0;
    if (input.isDown('KeyW')) iz -= 1;
    if (input.isDown('KeyS')) iz += 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('KeyD')) ix += 1;
    const hasInput = ix !== 0 || iz !== 0;

    // Sprint: forward-ish only, not while crouching/aiming.
    const wantSprint = (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    this.sprinting = wantSprint && hasInput && iz < 0 && this.crouch01 < 0.5 && !wantAds;
    this.ads = wantAds && !this.sprinting;

    // Pick base speed for the current stance/state.
    let speed = SPEED.walk;
    if (this.sprinting) speed = SPEED.sprint;
    else if (this.crouch01 > 0.5) speed = SPEED.crouch;
    if (this.ads) speed *= SPEED.adsMul;

    // Build a world-space target velocity from input on the XZ plane.
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    wish.addScaledVector(forward, -iz);
    wish.addScaledVector(right, ix);
    if (wish.lengthSq() > 0) wish.normalize();
    const targetVel = wish.multiplyScalar(hasInput ? speed : 0);

    // Accelerate / apply friction toward the target velocity.
    const rate = hasInput ? ACCEL : FRICTION;
    this.velocity.x = moveToward(this.velocity.x, targetVel.x, rate * dt);
    this.velocity.z = moveToward(this.velocity.z, targetVel.z, rate * dt);

    // Integrate + collide-and-slide.
    const delta = new THREE.Vector3(this.velocity.x * dt, 0, this.velocity.z * dt);
    this._moveAndSlide(delta);

    // Bookkeeping for camera/HUD.
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed01 = clamp(horizSpeed / SPEED.walk, 0, 1.4);
    this.moving = horizSpeed > 0.15;

    // --- lean input + wall validation ---
    let lean = 0;
    if (input.isDown('KeyQ')) lean -= 1;
    if (input.isDown('KeyE')) lean += 1;
    this.leanTarget = lean;
    this.leanAllowed = lean === 0 ? true : this._canLean(lean);
  }

  /** Move with simple axis-separated collide-and-slide against AABB colliders. */
  _moveAndSlide(delta) {
    const pos = this.position;
    const r = this.radius;

    // Move X then Z so we slide along walls instead of stopping dead.
    pos.x += delta.x;
    this._resolveAxis('x', r);
    pos.z += delta.z;
    this._resolveAxis('z', r);
  }

  _resolveAxis(axis, r) {
    const pos = this.position;
    for (const box of this.world.colliders) {
      // Treat the player as a circle of radius r on the XZ plane vs the box.
      const closestX = clamp(pos.x, box.min.x, box.max.x);
      const closestZ = clamp(pos.z, box.min.z, box.max.z);
      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= r * r) continue;

      // Penetrating: push out along the colliding axis.
      if (axis === 'x') {
        if (pos.x > box.min.x && pos.x < box.max.x) {
          // Inside on X — push to nearest face.
          const toMin = Math.abs(pos.x - (box.min.x - r));
          const toMax = Math.abs(pos.x - (box.max.x + r));
          pos.x = toMin < toMax ? box.min.x - r : box.max.x + r;
        } else {
          pos.x = pos.x < closestX ? closestX - r : closestX + r;
        }
        this.velocity.x = 0;
      } else {
        if (pos.z > box.min.z && pos.z < box.max.z) {
          const toMin = Math.abs(pos.z - (box.min.z - r));
          const toMax = Math.abs(pos.z - (box.max.z + r));
          pos.z = toMin < toMax ? box.min.z - r : box.max.z + r;
        } else {
          pos.z = pos.z < closestZ ? closestZ - r : closestZ + r;
        }
        this.velocity.z = 0;
      }
    }
  }

  /**
   * Validate a lean: cast a short ray from the eye out along the lean direction.
   * If a wall is closer than the lean distance, disallow (so we don't clip
   * through cover). Returns true if leaning is safe.
   */
  _canLean(dir) {
    const eye = new THREE.Vector3(
      this.position.x,
      this.position.y + this.eyeHeight,
      this.position.z
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const rayDir = right.multiplyScalar(dir).normalize();
    const hit = castRay(eye, rayDir, this.world.solids, 0.7);
    return !hit; // blocked if anything within 0.7m to that side
  }

  /** Snapshot consumed by FirstPersonCamera each render frame. */
  getCameraState() {
    return {
      position: this.position,
      yaw: this.yaw,
      pitch: this.pitch,
      eyeHeight: this.eyeHeight,
      leanTarget: this.leanTarget,
      leanAllowed: this.leanAllowed,
      speed01: this.speed01,
      moving: this.moving,
      ads: this.ads,
      lookDelta: this._lastLookDelta,
    };
  }

  /** World-space eye position (used by Weapon for the hitscan origin). */
  getEyePosition() {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + this.eyeHeight,
      this.position.z
    );
  }
}
