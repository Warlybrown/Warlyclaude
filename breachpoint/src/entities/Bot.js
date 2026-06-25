// Bot.js — an AI combatant (attacker or defender). Shootable by the player and
// other bots (it implements the same damage/headshot contract as Target), moves
// along navmesh paths with collide-and-slide, perceives enemies via a vision
// cone + LOS and reacts to sound, and fights with a probabilistic hitscan model.
//
// The decision-making lives in BotBrain (FSM); this class is the "body" + senses
// + combat resolution. Bots obey the no-respawn / objective / win-condition rules
// because the orchestrator only ever reads their alive state and objective acts.

import * as THREE from 'three';
import { clamp } from '../util/math.js';
import { castRay } from '../util/raycast.js';

let _id = 0;

export class Bot {
  /**
   * @param {THREE.Scene} scene
   * @param {object} world shared world
   * @param {object} cfg { side:'ATTACK'|'DEFEND', team:'human'|'ai', operator,
   *                        difficulty:0..1, hooks:{damagePlayer} }
   */
  constructor(scene, world, cfg) {
    this.scene = scene;
    this.world = world;
    this.id = _id++;
    this.side = cfg.side;
    this.team = cfg.team;
    this.operator = cfg.operator || null;
    this.difficulty = cfg.difficulty ?? 0.5;
    this.hooks = cfg.hooks || {};

    this.alive = true;
    this.maxHealth = 100;
    this.health = 100;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.radius = 0.34;
    this.speed = 2.6 + (this.operator?.speed ?? 2) * 0.25;
    this.blindT = 0;

    // Perception tuning scales with difficulty.
    this.viewRange = 26;
    this.fovCos = Math.cos((100 * Math.PI) / 180 / 2);
    this.reactionTime = 0.35 - this.difficulty * 0.22; // seconds to open fire
    this.accuracy = 0.45 + this.difficulty * 0.45; // base hit chance at mid range
    this._reactAccum = 0;

    // Combat weapon model (simplified, from operator primary).
    this.fireInterval = 0.12;
    this._fireCd = 0;
    this.damage = 24;

    // Body mesh (capsule + head) — same hit contract as Target.
    const color = this.team === 'ai' ? 0xc24b4b : 0x4b78c2;
    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    this.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.0, 6, 10), this.bodyMat);
    this.mesh.castShadow = true;
    this.mesh.userData.targetRef = this;
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe0b070, roughness: 0.6 });
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 10), headMat);
    this.head.position.set(0, 0.78, 0);
    this.head.userData.targetRef = this;
    this.mesh.add(this.head);
    scene.add(this.mesh);

    // Nav state.
    this.path = [];
    this.pathIdx = 0;
    this._repathCd = 0;

    // Brain attached by orchestrator.
    this.brain = null;
    this.target = null;       // current enemy entity in sight
    this.lastSeenPos = null;  // last known enemy position (for hunting)
    this.investigate = null;  // sound-driven point of interest
  }

  get headY() { return this.position.y + 1.5; }

  spawnAt(pos, yaw = 0) {
    this.position.copy(pos);
    this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    this.alive = true;
    this.health = this.maxHealth;
    this.path = []; this.pathIdx = 0;
    this.target = null; this.lastSeenPos = null; this.investigate = null;
    this.mesh.visible = true;
    this._place();
  }

  _place() {
    this.mesh.position.set(this.position.x, this.position.y + 0.85, this.position.z);
    this.mesh.rotation.set(0, this.yaw, 0);
  }

  applyBlind(seconds) { this.blindT = Math.max(this.blindT, seconds); }

  applyDamage(amount, isHead) {
    if (!this.alive) return false;
    this.health -= amount;
    this.bodyMat.emissive.setHex(isHead ? 0xffffff : 0x550000);
    this._flash = 0.08;
    // Being shot draws attention to the shooter direction (handled by brain via
    // lastSeenPos when it can see; otherwise it becomes alert).
    this.alerted = 2.5;
    if (this.health <= 0) { this._die(); return true; }
    return false;
  }

  _die() {
    this.alive = false;
    this.health = 0;
    this.mesh.rotation.z = Math.PI / 2;
    this.mesh.position.y = this.position.y + 0.34;
    this.bodyMat.color.setHex(0x333333);
  }

  // ---- senses --------------------------------------------------------------
  eye() { return new THREE.Vector3(this.position.x, this.position.y + 1.45, this.position.z); }

  /** Can this bot currently see `entity`? Updates target/lastSeenPos. */
  canSee(entity) {
    if (!entity || entity.alive === false) return false;
    if (this.blindT > 0.2) return false; // flashed
    const ep = (entity.getEyePosition ? entity.getEyePosition() : (entity.position || entity.mesh.position).clone());
    const eye = this.eye();
    const to = ep.clone().sub(eye);
    const dist = to.length();
    if (dist > this.viewRange) return false;
    to.normalize();
    const facing = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (to.dot(facing) < this.fovCos && dist > 2) return false; // outside FOV (but feel close threats)
    // LOS against solids (live — respects holes).
    const hit = castRay(eye, to, this.world.solids, dist - 0.4);
    return !hit;
  }

  // ---- movement ------------------------------------------------------------
  setPath(waypoints) {
    this.path = waypoints || [];
    this.pathIdx = 0;
  }

  hasPath() { return this.path.length > 0 && this.pathIdx < this.path.length; }

  /** Step toward the current waypoint; returns true if the path is complete. */
  _followPath(dt) {
    if (!this.hasPath()) return true;
    const wp = this.path[this.pathIdx];
    const to = new THREE.Vector3(wp.x - this.position.x, 0, wp.z - this.position.z);
    const d = to.length();
    if (d < 0.7) {
      this.pathIdx++;
      // Step up/down to the waypoint's floor height.
      this.position.y = wp.y;
      return this.pathIdx >= this.path.length;
    }
    to.normalize();
    this.velocity.x = to.x * this.speed;
    this.velocity.z = to.z * this.speed;
    this.position.x += this.velocity.x * dt;
    this._resolve('x');
    this.position.z += this.velocity.z * dt;
    this._resolve('z');
    // Face movement direction unless aiming at a target.
    if (!this.target) this.yaw = Math.atan2(-to.x, -to.z);
    return false;
  }

  _resolve(axis) {
    const pos = this.position, r = this.radius;
    for (const box of this.world.colliders) {
      if (box.max.y < pos.y + 0.2 || box.min.y > pos.y + 1.6) continue; // height filter
      const cx = clamp(pos.x, box.min.x, box.max.x);
      const cz = clamp(pos.z, box.min.z, box.max.z);
      const dx = pos.x - cx, dz = pos.z - cz;
      if (dx * dx + dz * dz >= r * r) continue;
      if (axis === 'x') { pos.x = pos.x < cx ? cx - r : cx + r; this.velocity.x = 0; }
      else { pos.z = pos.z < cz ? cz - r : cz + r; this.velocity.z = 0; }
    }
  }

  // ---- combat --------------------------------------------------------------
  /** Aim at + shoot a target this tick if reacted. Returns true if it fired. */
  fireAt(entity, dt) {
    if (!entity || !entity.alive) return false;
    const ep = (entity.getEyePosition ? entity.getEyePosition() : (entity.position || entity.mesh.position).clone());
    // Turn to face.
    const to = ep.clone().sub(this.position);
    this.yaw = Math.atan2(-to.x, -to.z);

    this._fireCd -= dt;
    if (this._fireCd > 0) return false;
    this._fireCd = this.fireInterval;

    const dist = to.length();
    // Hit chance falls with distance + target speed, rises with difficulty.
    let chance = this.accuracy * clamp(1 - (dist - 6) / 40, 0.25, 1);
    if (entity.moving) chance *= 0.8;
    if (this.blindT > 0) chance *= 0.2;
    const hit = Math.random() < chance;
    if (hit) {
      const headRoll = Math.random() < 0.15 + this.difficulty * 0.2;
      const dmg = this.damage * (headRoll ? 3.0 : 1);
      if (entity.takeDamage) {
        entity.takeDamage(dmg, this.position.clone());
        if (entity === this.world._player && this.hooks.damagePlayer) this.hooks.damagePlayer(dmg, this.position.clone());
      } else if (entity.applyDamage) {
        entity.applyDamage(dmg, headRoll);
      }
    }
    // Gunfire is a sound event other bots can hear.
    this.world.soundEvents.push({ pos: this.position.clone(), type: 'shot', time: performance.now() });
    return true;
  }

  update(dt) {
    if (this._flash > 0) { this._flash -= dt; if (this._flash <= 0 && this.alive) this.bodyMat.emissive.setHex(0x000000); }
    if (this.blindT > 0) this.blindT -= dt;
    if (this.alerted > 0) this.alerted -= dt;
    if (!this.alive) return;

    // Footstep sound when moving fast.
    if (this.velocity.lengthSq() > 1) {
      this._stepCd = (this._stepCd ?? 0) - dt;
      if (this._stepCd <= 0) {
        this._stepCd = 0.42;
        this.world.soundEvents.push({ pos: this.position.clone(), type: 'step', time: performance.now() });
      }
    }

    if (this.brain) this.brain.update(dt);
    this._place();
  }
}
