// Trap.js — DEFENDER. Entry-denial placeable. Two modes bundled:
//   - barbed wire patch: slows any entity standing in it
//   - proximity charge: arms, then detonates when an enemy enters its radius,
//     dealing damage (entry denial).
// Placed on the floor at the aim point. We default to the proximity charge but
// expose both via def.mode.

import * as THREE from 'three';
import { Gadget } from './Gadget.js';
import { explodeAt } from '../../world/Destruction.js';

export class Trap extends Gadget {
  constructor(ctx, mode = 'proximity') {
    super(ctx, { id: 'trap', name: mode === 'wire' ? 'RAZOR WIRE' : 'PROXIMITY CHARGE', charges: 2, cooldown: 0.5 });
    this.mode = mode;
  }

  _activate(target) {
    const { scene } = this.ctx;
    const at = (target.point || target.origin).clone().setY(0.05);
    if (this.mode === 'wire') return this._wire(at);
    return this._prox(at);
  }

  _wire(at) {
    const wire = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.3, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x555047, roughness: 1, transparent: true, opacity: 0.7, wireframe: true })
    );
    wire.position.copy(at).setY(0.15);
    scene.add(wire);
    wire.userData.slowZone = { center: at, radius: 0.9, mul: 0.45 };
    if (!this.ctx.world.slowZones) this.ctx.world.slowZones = [];
    this.ctx.world.slowZones.push(wire.userData.slowZone);
    this.active.push({ tick: () => {}, get dead() { return false; },
      cleanup: () => {
        scene.remove(wire);
        const z = this.ctx.world.slowZones;
        const i = z.indexOf(wire.userData.slowZone); if (i >= 0) z.splice(i, 1);
      } });
    return true;
  }

  _prox(at) {
    const { scene, world } = this.ctx;
    const mine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.14, 0.1, 10),
      new THREE.MeshStandardMaterial({ color: 0x33240f, emissive: 0xff8a2e, emissiveIntensity: 0.5 })
    );
    mine.position.copy(at).setY(0.08);
    scene.add(mine);
    let armed = 1.0; // arming delay
    let blink = 0;
    this.active.push({
      tick: (dt) => {
        if (armed > 0) { armed -= dt; return; }
        blink += dt;
        mine.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(blink * 6)) * 0.6;
        // Detonate if an attacker (enemy of the placer) steps within radius.
        const enemies = world.targets || [];
        const trig = enemies.find((e) => e.alive && (e.position || e.mesh.position).distanceTo(at) < 1.1);
        const phit = this.ctx.player.alive && this.ctx.player.position.distanceTo(at) < 1.1;
        if (trig || phit) {
          explodeAt(world, at, 1.0);
          if (trig) trig.applyDamage(75, false);
          if (phit) this.ctx.player.takeDamage(60, at);
          this.emit({ type: 'trap', point: at });
          this.ctx.audio?.play('breach', at);
          this._done = true;
        }
      },
      get dead() { return this._done === true; },
      cleanup: () => scene.remove(mine),
    });
    return true;
  }
}
