// FirstPersonCamera.js — applies the player's pose to the THREE camera.
//
// The PlayerController owns the *logical* state (feet position, yaw/pitch,
// stance, lean, recoil). This class turns that state into a camera transform
// each frame: eye height, lateral lean offset + roll, ADS FOV, and weapon
// bob/sway. Keeping it separate keeps movement math readable and lets later
// phases (spectator, drone) reuse or swap the visual layer.

import * as THREE from 'three';
import { damp, lerp } from '../util/math.js';

export class FirstPersonCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} opts
   */
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.baseFov = opts.fov ?? 80;
    this.adsFov = opts.adsFov ?? 55;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();

    // Smoothed visual values (lerped toward targets each frame).
    this.fov = this.baseFov;
    this.lean = 0; // smoothed lean amount, -1..1
    this.eyeHeight = opts.standEye ?? 1.62;

    // Bob phase accumulator for walk head-bob.
    this._bobPhase = 0;
    this._swayOffset = new THREE.Vector2(0, 0);

    this.leanDistance = opts.leanDistance ?? 0.5; // metres of lateral peek
    this.leanRoll = opts.leanRoll ?? 0.12; // radians of camera tilt
  }

  /**
   * @param {object} s player state snapshot:
   *   { position:Vec3(feet), yaw, pitch, eyeHeight, leanTarget, leanAllowed,
   *     speed01, moving, ads, recoilPitch, recoilYaw, lookDelta }
   * @param {number} dt
   */
  update(s, dt) {
    const cam = this.camera;

    // --- FOV (ADS zoom) ---
    const targetFov = s.ads ? this.adsFov : this.baseFov;
    this.fov = damp(this.fov, targetFov, 14, dt);
    if (Math.abs(cam.fov - this.fov) > 0.001) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // --- lean (smoothed, and gated by leanAllowed from a wall raycast) ---
    const leanGoal = s.leanAllowed ? s.leanTarget : 0;
    this.lean = damp(this.lean, leanGoal, 12, dt);

    // --- eye height (crouch) ---
    this.eyeHeight = s.eyeHeight;

    // --- head bob while moving on the ground ---
    let bobY = 0;
    let bobX = 0;
    if (s.moving && s.speed01 > 0.05) {
      this._bobPhase += dt * lerp(6, 12, s.speed01);
      const amp = lerp(0.006, 0.03, s.speed01) * (s.ads ? 0.3 : 1);
      bobY = Math.sin(this._bobPhase * 2) * amp;
      bobX = Math.cos(this._bobPhase) * amp * 0.6;
    } else {
      this._bobPhase = 0;
    }

    // --- weapon/aim sway from mouse movement (subtle, eased back to centre) ---
    const swayTarget = new THREE.Vector2(
      -(s.lookDelta?.x ?? 0) * 0.0006,
      (s.lookDelta?.y ?? 0) * 0.0006
    );
    this._swayOffset.x = damp(this._swayOffset.x, swayTarget.x, 10, dt);
    this._swayOffset.y = damp(this._swayOffset.y, swayTarget.y, 10, dt);

    // --- compose orientation: yaw, pitch (+recoil), roll (from lean+sway) ---
    const pitch = s.pitch + (s.recoilPitch ?? 0) + this._swayOffset.y;
    const yaw = s.yaw + (s.recoilYaw ?? 0) + this._swayOffset.x;
    const roll = -this.lean * this.leanRoll;

    const euler = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    cam.quaternion.setFromEuler(euler);

    // --- compose position: feet + eye height + lateral lean offset + bob ---
    // Lean offset is along the camera's local right vector, projected flat.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    right.y = 0;
    right.normalize();

    cam.position.set(s.position.x, s.position.y + this.eyeHeight, s.position.z);
    cam.position.addScaledVector(right, this.lean * this.leanDistance);
    cam.position.y += bobY;
    cam.position.addScaledVector(right, bobX);
  }
}
