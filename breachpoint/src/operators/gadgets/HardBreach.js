// HardBreach.js — ATTACKER. Destroys a REINFORCED (hard) wall, opening the
// otherwise-unbreakable. Place on a wall in front; after a short fuse it
// explodes, clearing a large opening via explodeAt({hardBreach:true}).

import * as THREE from 'three';
import { Gadget } from './Gadget.js';
import { castRay } from '../../util/raycast.js';
import { explodeAt } from '../../world/Destruction.js';

export class HardBreach extends Gadget {
  constructor(ctx) {
    super(ctx, { id: 'hardbreach', name: 'THERMAL CUTTER', charges: 2, cooldown: 0.5 });
  }

  _activate(target) {
    const { scene, world } = this.ctx;
    // Find a wall directly ahead within reach.
    const hit = castRay(target.origin, target.dir, world.solids, 3.5);
    if (!hit) { this.charges++; return false; } // refund if nothing to place on
    const surf = hit.object.userData.destructible;
    if (!surf || !surf.isHardened) {
      // Only meaningful on reinforced walls; refund otherwise.
      this.charges++;
      this.emit({ type: 'gadget', text: 'Hard breach needs a reinforced wall' });
      return false;
    }

    const at = hit.point.clone();
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff3a1a, emissiveIntensity: 0.8 })
    );
    marker.position.copy(at).addScaledVector(hit.normal || target.dir, -0.05);
    scene.add(marker);

    let fuse = 2.0;
    this.active.push({
      tick: (dt) => {
        fuse -= dt;
        marker.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(fuse * 12)) * 0.8;
        if (fuse <= 0) {
          const n = explodeAt(world, at, 1.7, { hardBreach: true });
          this.emit({ type: 'breach', point: at, panels: n, hard: true });
          this.ctx.audio?.play('breach', at);
          this._boom = { marker, life: 0.2 };
          this.deadFlag = true;
        }
      },
      get dead() { return this.deadFlag === true; },
      deadFlag: false,
      cleanup: () => scene.remove(marker),
    });
    this.ctx.audio?.play('place', at);
    return true;
  }
}
