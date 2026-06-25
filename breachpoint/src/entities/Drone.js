// Drone.js — rollable recon drone the attacker drives during prep (and can
// redeploy in the action phase).
//
// A small, fast ground vehicle with its own chase camera. It can hop small
// ledges, and "spot" enemies in view (tagging them on the attacker HUD for a
// few seconds). Defenders can destroy it by shooting it. Movement reuses the
// same collide-and-slide approach as the player but at drone scale.

import * as THREE from 'three';
import { clamp } from '../util/math.js';
import { castRay } from '../util/raycast.js';

export class Drone {
  /**
   * @param {THREE.Scene} scene
   * @param {object} world shared world (solids, colliders, targets/enemies)
   * @param {THREE.PerspectiveCamera} camera the drone uses when active
   */
  constructor(scene, world, camera) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;

    this.position = new THREE.Vector3(0, 0.2, 20);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI;
    this.radius = 0.22;
    this.alive = true;
    this.active = false;
    this.health = 20;

    this.speed = 6.5;
    this.accel = 40;
    this.friction = 10;

    // Body: a small disc with a camera eye.
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.18, 12),
      new THREE.MeshStandardMaterial({ color: 0x1d2730, roughness: 0.5, metalness: 0.4 })
    );
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x2e9bff, emissive: 0x2e9bff, emissiveIntensity: 0.8 })
    );
    eye.position.set(0, 0.06, 0.18);
    this.mesh.add(body, eye);
    this.mesh.userData.drone = this;
    scene.add(this.mesh);
    this.mesh.visible = false;

    this._spotCooldown = 0;
    this.spotted = []; // {entity, time}
  }

  deploy(pos, yaw = Math.PI) {
    this.position.copy(pos);
    this.position.y = 0.22;
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.alive = true;
    this.health = 20;
    this.mesh.visible = true;
  }

  setActive(on) {
    this.active = on;
  }

  takeDamage(d) {
    if (!this.alive) return;
    this.health -= d;
    if (this.health <= 0) this.destroy();
  }

  destroy() {
    this.alive = false;
    this.mesh.visible = false;
    this.active = false;
  }

  /**
   * @param {number} dt
   * @param {object} input { forward, strafe, lookX } movement intents (-1..1)
   * @param {Array} enemies entities with .alive and .mesh/.position for spotting
   */
  update(dt, input, enemies = []) {
    if (!this.alive) return;

    // Steering: yaw from look, planar movement relative to facing.
    this.yaw -= (input.lookX || 0) * dt * 2.4;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    wish.addScaledVector(fwd, input.forward || 0);
    wish.addScaledVector(right, input.strafe || 0);
    const has = wish.lengthSq() > 0;
    if (has) wish.normalize().multiplyScalar(this.speed);

    const rate = has ? this.accel : this.friction;
    this.velocity.x += (wish.x - this.velocity.x) * Math.min(1, rate * dt);
    this.velocity.z += (wish.z - this.velocity.z) * Math.min(1, rate * dt);

    // Integrate + collide (XZ only; drone hugs the ground).
    this.position.x += this.velocity.x * dt;
    this._resolve('x');
    this.position.z += this.velocity.z * dt;
    this._resolve('z');
    this.position.y = 0.22;

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;

    // Chase camera: slightly behind + above, looking forward.
    if (this.active) {
      const camPos = this.position.clone()
        .addScaledVector(fwd, -0.6)
        .add(new THREE.Vector3(0, 0.5, 0));
      this.camera.position.copy(camPos);
      this.camera.lookAt(this.position.clone().addScaledVector(fwd, 3).setY(0.4));
    }

    // Spotting: every ~0.3s, tag enemies in the forward cone with clear LOS.
    this._spotCooldown -= dt;
    if (this._spotCooldown <= 0) {
      this._spotCooldown = 0.3;
      this._spot(enemies, fwd);
    }
    // Age out spots.
    const now = performance.now();
    this.spotted = this.spotted.filter((s) => now - s.time < 4000);
  }

  _spot(enemies, fwd) {
    const eye = this.position.clone().add(new THREE.Vector3(0, 0.1, 0));
    for (const e of enemies) {
      if (!e.alive) continue;
      const ep = e.position ? e.position.clone().add(new THREE.Vector3(0, 1, 0)) : e.mesh.position.clone();
      const to = ep.clone().sub(eye);
      const dist = to.length();
      if (dist > 22) continue;
      to.normalize();
      if (to.dot(fwd) < 0.4) continue; // outside ~66° cone
      // LOS check against solids.
      const hit = castRay(eye, to, this.world.solids, dist - 0.4);
      if (hit) continue; // blocked
      // Spotted.
      if (!this.spotted.find((s) => s.entity === e)) {
        this.spotted.push({ entity: e, time: performance.now() });
      } else {
        this.spotted.find((s) => s.entity === e).time = performance.now();
      }
    }
  }

  _resolve(axis) {
    const pos = this.position;
    const r = this.radius;
    for (const box of this.world.colliders) {
      // Drone is short; ignore tall-only collisions above it.
      if (box.min.y > 0.5) continue;
      const cx = clamp(pos.x, box.min.x, box.max.x);
      const cz = clamp(pos.z, box.min.z, box.max.z);
      const dx = pos.x - cx, dz = pos.z - cz;
      if (dx * dx + dz * dz >= r * r) continue;
      if (axis === 'x') { pos.x = pos.x < cx ? cx - r : cx + r; this.velocity.x = 0; }
      else { pos.z = pos.z < cz ? cz - r : cz + r; this.velocity.z = 0; }
    }
  }
}
