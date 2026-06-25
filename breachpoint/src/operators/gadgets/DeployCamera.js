// DeployCamera.js — DEFENDER. A bulletproof deployable intel camera the
// defender can place on a surface and look through (toggling to its view). It
// can spot attackers in its cone like the drone. Attackers can destroy it.

import * as THREE from 'three';
import { Gadget } from './Gadget.js';
import { castRay } from '../../util/raycast.js';

export class DeployCamera extends Gadget {
  constructor(ctx) {
    super(ctx, { id: 'camera', name: 'WATCHER CAM', charges: 1, cooldown: 0.5 });
  }

  _activate(target) {
    const { scene, world } = this.ctx;
    const hit = castRay(target.origin, target.dir, world.solids, 4);
    const at = hit ? hit.point.clone() : target.origin.clone().addScaledVector(target.dir, 2);
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x14181c, emissive: 0xff8a2e, emissiveIntensity: 0.5 })
    );
    body.position.copy(at);
    if (hit?.normal) body.position.addScaledVector(hit.normal, 0.05);
    scene.add(body);

    const cam = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 100);
    cam.position.copy(body.position);
    const lookDir = hit?.normal ? hit.normal.clone().negate() : target.dir.clone();
    cam.lookAt(body.position.clone().add(lookDir));

    const placed = { body, cam, alive: true, lookDir, pos: body.position.clone() };
    if (!world.cameras) world.cameras = [];
    world.cameras.push(placed);
    body.userData.deployCam = placed;

    let spotCd = 0;
    this.active.push({
      tick: (dt) => {
        if (!placed.alive) { this._gone = true; return; }
        spotCd -= dt;
        if (spotCd <= 0) {
          spotCd = 0.4;
          for (const e of world.targets || []) {
            if (!e.alive) continue;
            const ep = (e.position || e.mesh.position).clone().add(new THREE.Vector3(0, 1, 0));
            const to = ep.clone().sub(placed.pos);
            const dist = to.length(); to.normalize();
            if (dist > 16 || to.dot(lookDir) < 0.3) continue;
            if (castRay(placed.pos, to, world.solids, dist - 0.3)) continue;
            this.emit({ type: 'spot', entity: e, duration: 1.5 });
          }
        }
      },
      get dead() { return this._gone === true; },
      cleanup: () => {
        scene.remove(body);
        const i = world.cameras.indexOf(placed); if (i >= 0) world.cameras.splice(i, 1);
      },
    });
    this.emit({ type: 'camera', point: at });
    return true;
  }
}
