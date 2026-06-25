// FlashThrow.js — ATTACKER. Throws a flash device that detonates after a short
// fuse and blinds/disorients any entity with line-of-sight in range. Blinded
// entities are reported via events; the orchestrator applies a screen-white +
// accuracy penalty to the player, and reduced perception to bots.

import * as THREE from 'three';
import { Gadget } from './Gadget.js';
import { castRay } from '../../util/raycast.js';

export class FlashThrow extends Gadget {
  constructor(ctx) {
    super(ctx, { id: 'flash', name: 'PULSE FLASH', charges: 2, cooldown: 0.4 });
  }

  _activate(target) {
    const { scene, world } = this.ctx;
    // Spawn a projectile that arcs forward then detonates.
    const proj = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xcfd6dd, emissive: 0x8899aa, emissiveIntensity: 0.6 })
    );
    proj.position.copy(target.origin);
    scene.add(proj);
    const vel = target.dir.clone().multiplyScalar(12).add(new THREE.Vector3(0, 2.5, 0));
    let fuse = 1.4;
    let dead = false;

    this.active.push({
      tick: (dt) => {
        fuse -= dt;
        vel.y -= 9.8 * dt;
        proj.position.addScaledVector(vel, dt);
        if (proj.position.y < 0.1) { proj.position.y = 0.1; vel.set(0, 0, 0); }
        if (fuse <= 0 && !dead) {
          dead = true;
          this._detonate(proj.position.clone());
          this._flashLight = new THREE.PointLight(0xffffff, 0, 12, 2);
          this._flashLight.position.copy(proj.position);
          scene.add(this._flashLight);
          this._flashLife = 0.25;
        }
        if (this._flashLight) {
          this._flashLife -= dt;
          this._flashLight.intensity = Math.max(0, this._flashLife / 0.25) * 12;
        }
      },
      get dead() { return dead && (this._flashLife ?? 0) <= 0; },
      _flashLife: 0,
      cleanup: () => { scene.remove(proj); if (this._flashLight) scene.remove(this._flashLight); },
    });
    this.ctx.audio?.play('throw', target.origin);
    return true;
  }

  _detonate(at) {
    const { world, player } = this.ctx;
    const blinded = [];
    // Targets / bots in LOS within range.
    for (const e of world.targets || []) {
      if (!e.alive) continue;
      const ep = (e.position || e.mesh.position).clone().add(new THREE.Vector3(0, 1.2, 0));
      const d = ep.distanceTo(at);
      if (d > 12) continue;
      const dir = ep.clone().sub(at).normalize();
      if (castRay(at, dir, world.solids, d - 0.3)) continue; // wall blocks flash
      const t = 1 - d / 12;
      if (e.applyBlind) e.applyBlind(2.5 * t);
      blinded.push(e);
    }
    // The human, if facing it with LOS.
    if (player?.alive) {
      const pe = player.getEyePosition();
      const d = pe.distanceTo(at);
      if (d < 12 && !castRay(at, pe.clone().sub(at).normalize(), world.solids, d - 0.3)) {
        this.emit({ type: 'flashed', strength: (1 - d / 12), target: 'player' });
      }
    }
    this.emit({ type: 'flash', point: at, blinded: blinded.length });
    this.ctx.audio?.play('flash', at);
  }
}
