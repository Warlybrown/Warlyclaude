// Reactive.js — DEFENDER. A reactive counter-charge mounted on a wall. If that
// wall is breached (panels removed near the charge) or an enemy crosses in
// front of it, it fires a counter-blast that damages attackers in the opening
// and reveals them — punishing breaches.

import * as THREE from 'three';
import { Gadget } from './Gadget.js';
import { castRay } from '../../util/raycast.js';

export class Reactive extends Gadget {
  constructor(ctx) {
    super(ctx, { id: 'reactive', name: 'COUNTERMINE', charges: 2, cooldown: 0.5 });
  }

  _activate(target) {
    const { scene, world } = this.ctx;
    const hit = castRay(target.origin, target.dir, world.solids, 4);
    if (!hit) { this.charges++; return false; }
    const surf = hit.object.userData.destructible;
    const at = hit.point.clone();
    const normal = hit.normal ? hit.normal.clone() : target.dir.clone().negate();

    const dev = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x1a1410, emissive: 0xff8a2e, emissiveIntensity: 0.5 })
    );
    dev.position.copy(at).addScaledVector(normal, 0.05);
    scene.add(dev);

    // Baseline integrity of the host surface (to detect a breach).
    const baseIntegrity = surf ? surf.integrity : 1;
    let armed = 0.6;
    this.active.push({
      tick: (dt) => {
        if (armed > 0) { armed -= dt; return; }
        const breached = surf && surf.integrity < baseIntegrity - 0.08;
        // Enemy crossing in front of the device (the breach opening).
        const enemies = world.targets || [];
        const front = enemies.find((e) => e.alive && (e.position || e.mesh.position).distanceTo(at) < 2.2);
        if (breached || front) {
          // Counter-blast.
          const flash = new THREE.PointLight(0xff8a2e, 6, 6, 2);
          flash.position.copy(at);
          scene.add(flash);
          for (const e of enemies) {
            if (e.alive && (e.position || e.mesh.position).distanceTo(at) < 2.4) e.applyDamage(55, false);
          }
          this.emit({ type: 'reactive', point: at });
          this.ctx.audio?.play('breach', at);
          this._flash = flash; this._flashLife = 0.2; this._fired = true;
        }
        if (this._flash) {
          this._flashLife -= dt;
          this._flash.intensity = Math.max(0, this._flashLife / 0.2) * 6;
        }
      },
      get dead() { return this._fired === true && (this._flashLife ?? 0) <= 0; },
      cleanup: () => { scene.remove(dev); if (this._flash) scene.remove(this._flash); },
    });
    this.emit({ type: 'place', point: at });
    return true;
  }
}
