// AnchorShield.js — DEFENDER. A deployable bulletproof cover panel the anchor
// plants on the ground to hold an angle on site. Unlike the attacker's carried
// shield, this is a static, free-standing bulletproof box added to world.solids
// and world.colliders, so it blocks bullets and movement until the round ends.

import * as THREE from 'three';
import { Gadget } from './Gadget.js';

export class AnchorShield extends Gadget {
  constructor(ctx) {
    super(ctx, { id: 'anchor', name: 'HOLDFAST COVER', charges: 1, cooldown: 0.5 });
  }

  _activate(target) {
    const { scene, world, player } = this.ctx;
    // Plant ~1.2m in front of the player, facing back toward them.
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const at = player.position.clone().addScaledVector(fwd, 1.2);
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.0, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: 0.6, metalness: 0.4 })
    );
    panel.position.set(at.x, 0.5, at.z);
    panel.rotation.y = player.yaw;
    panel.castShadow = true;
    scene.add(panel);

    // Register as solid + collider so it blocks fire and movement.
    world.solids.push(panel);
    const box = new THREE.Box3().setFromObject(panel);
    world.colliders.push(box);

    this.active.push({
      tick: () => {},
      get dead() { return false; },
      cleanup: () => {
        scene.remove(panel);
        const si = world.solids.indexOf(panel); if (si >= 0) world.solids.splice(si, 1);
        const ci = world.colliders.indexOf(box); if (ci >= 0) world.colliders.splice(ci, 1);
      },
    });
    this.emit({ type: 'anchor', point: at });
    return true;
  }
}
