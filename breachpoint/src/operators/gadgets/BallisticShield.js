// BallisticShield.js — ATTACKER. Deploys a portable ballistic shield that
// frontally blocks bullets. While equipped, the carrier moves slower and cannot
// ADS, but a shield collider absorbs incoming fire from the front arc. Modeled
// as a solid mesh parented in front of the player + a movement-speed penalty
// flag the controller reads.

import * as THREE from 'three';
import { Gadget } from './Gadget.js';

export class BallisticShield extends Gadget {
  constructor(ctx) {
    super(ctx, { id: 'shield', name: 'BULWARK SHIELD', charges: 1, cooldown: 0 });
    this.deployed = false;
  }

  _activate() {
    const { scene } = this.ctx;
    if (this.deployed) { this._stow(); return true; }
    // A shield panel that we position in front of the player each tick.
    this.panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 1.2, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.5, metalness: 0.6 })
    );
    this.panel.userData.shield = this;
    scene.add(this.panel);
    this.deployed = true;
    this.charges = 1; // re-toggleable
    this.ctx.player.shieldSpeedMul = 0.6; // controller reads this for slow walk
    this.emit({ type: 'shield', deployed: true });
    return true;
  }

  _stow() {
    if (this.panel) this.ctx.scene.remove(this.panel);
    this.panel = null;
    this.deployed = false;
    this.ctx.player.shieldSpeedMul = 1;
    this.emit({ type: 'shield', deployed: false });
  }

  tick(dt) {
    super.tick(dt);
    if (this.deployed && this.panel) {
      const p = this.ctx.player;
      const eye = p.getEyePosition();
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      this.panel.position.copy(eye).addScaledVector(fwd, 0.6).setY(p.position.y + 1.0);
      this.panel.lookAt(this.panel.position.clone().add(fwd));
    }
  }

  cleanup() { this._stow(); super.cleanup(); }
}
