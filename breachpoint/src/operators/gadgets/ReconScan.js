// ReconScan.js — ATTACKER. A pulse-scan gadget that reveals enemy positions in
// an area for a few seconds. On use, every enemy within radius is marked
// (regardless of LOS) and reported to the HUD spotting system for the duration.

import * as THREE from 'three';
import { Gadget } from './Gadget.js';

export class ReconScan extends Gadget {
  constructor(ctx) {
    super(ctx, { id: 'recon', name: 'SONAR PULSE', charges: 2, cooldown: 1 });
  }

  _activate(target) {
    const { scene, world } = this.ctx;
    const center = (target.point || target.origin).clone();
    const radius = 12;
    const dur = 5;

    // Expanding ring visual.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.4, 32),
      new THREE.MeshBasicMaterial({ color: 0x2e9bff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center).setY(0.05);
    scene.add(ring);

    // Tag enemies in range for the duration via the shared spot list.
    const tagged = (world.targets || []).filter(
      (e) => e.alive && (e.position || e.mesh.position).distanceTo(center) <= radius
    );
    for (const e of tagged) this.emit({ type: 'spot', entity: e, duration: dur });
    this.emit({ type: 'scan', count: tagged.length });

    let life = dur;
    this.active.push({
      tick: (dt) => {
        life -= dt;
        const t = 1 - life / dur;
        ring.scale.setScalar(1 + t * radius * 2.4);
        ring.material.opacity = 0.6 * (1 - t);
      },
      get dead() { return life <= 0; },
      cleanup: () => scene.remove(ring),
    });
    this.ctx.audio?.play('scan', center);
    return true;
  }
}
