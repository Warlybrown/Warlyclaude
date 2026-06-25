// Jammer.js — DEFENDER. A deployable signal jammer that disables attacker
// drones and electronic gadgets within a radius (counter-intel). Drones inside
// the field are disrupted (cannot spot / lose control), and recon scans in the
// field are nullified. Modeled as a placed device exposing a jam zone the
// orchestrator/drone read.

import * as THREE from 'three';
import { Gadget } from './Gadget.js';

export class Jammer extends Gadget {
  constructor(ctx) {
    super(ctx, { id: 'jammer', name: 'NULLFIELD', charges: 2, cooldown: 0.5 });
  }

  _activate(target) {
    const { scene, world } = this.ctx;
    const at = (target.point || target.origin).clone().setY(0.2);
    const device = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x222a22, emissive: 0x22ff66, emissiveIntensity: 0.4 })
    );
    device.position.copy(at);
    scene.add(device);

    const zone = { center: at, radius: 7 };
    if (!world.jamZones) world.jamZones = [];
    world.jamZones.push(zone);

    let pulse = 0;
    this.active.push({
      tick: (dt) => {
        pulse += dt;
        device.material.emissiveIntensity = 0.3 + Math.abs(Math.sin(pulse * 3)) * 0.4;
        // Disrupt a drone caught inside.
        const drone = this.ctx.drone;
        if (drone?.alive && drone.position.distanceTo(at) < zone.radius) {
          drone.jammed = true;
        }
      },
      get dead() { return false; },
      cleanup: () => {
        scene.remove(device);
        const i = world.jamZones.indexOf(zone); if (i >= 0) world.jamZones.splice(i, 1);
      },
    });
    this.emit({ type: 'jammer', point: at });
    return true;
  }
}
