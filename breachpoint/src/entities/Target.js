// Target.js — a damageable practice dummy for Phase 1 weapon testing.
//
// A capsule body with a distinct "head" zone (above headY). Takes damage, dies,
// drops over, and auto-respawns after a delay so the arena stays populated.
// This is a placeholder; Phase 5 replaces it with full Bot AI, but it already
// implements the damage/headshot contract the Weapon expects.

import * as THREE from 'three';

export class Target {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} spawn feet position
   */
  constructor(scene, spawn) {
    this.scene = scene;
    this.spawn = spawn.clone();
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.alive = true;
    this._respawnT = 0;

    // Body: a capsule ~1.8m tall standing on its feet position.
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc24b4b, roughness: 0.7 });
    this.bodyMat = bodyMat;
    const geo = new THREE.CapsuleGeometry(0.34, 1.0, 6, 12);
    this.mesh = new THREE.Mesh(geo, bodyMat);
    this.mesh.castShadow = true;
    this.mesh.userData.targetRef = this;

    // A small head cap for visual headshot feedback.
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe07a5f, roughness: 0.6 });
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), headMat);
    this.head.userData.targetRef = this;
    this.head.castShadow = true;
    this.mesh.add(this.head);

    scene.add(this.mesh);
    this._place();
  }

  // World Y above which a hit counts as a headshot.
  get headY() {
    return this.spawn.y + 1.5;
  }

  _place() {
    // Capsule origin is its centre; stand it so feet sit at spawn.
    this.mesh.position.set(this.spawn.x, this.spawn.y + 0.85, this.spawn.z);
    this.mesh.rotation.set(0, 0, 0);
    this.head.position.set(0, 0.78, 0);
  }

  applyDamage(amount, isHead) {
    if (!this.alive) return false;
    this.health -= amount;
    // Flash on hit.
    this.bodyMat.emissive.setHex(isHead ? 0xffffff : 0x661111);
    this._flash = 0.08;
    if (this.health <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  _die() {
    this.alive = false;
    this.health = 0;
    this._respawnT = 3.0;
    // Topple over and darken.
    this.mesh.rotation.z = Math.PI / 2;
    this.mesh.position.y = this.spawn.y + 0.34;
    this.bodyMat.color.setHex(0x444444);
    this.head.material.color.setHex(0x333333);
  }

  respawn() {
    this.health = this.maxHealth;
    this.alive = true;
    this.bodyMat.color.setHex(0xc24b4b);
    this.bodyMat.emissive.setHex(0x000000);
    this.head.material.color.setHex(0xe07a5f);
    this._place();
  }

  update(dt) {
    if (this._flash > 0) {
      this._flash -= dt;
      if (this._flash <= 0) this.bodyMat.emissive.setHex(0x000000);
    }
    if (!this.alive) {
      this._respawnT -= dt;
      if (this._respawnT <= 0) this.respawn();
    }
  }
}
