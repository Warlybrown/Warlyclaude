// MeleeBreach.js — ATTACKER. A heavy breaching tool that smashes SOFT walls and
// hatches fast and quietly. Each use clears a sizeable opening in the soft
// surface directly ahead (no fuse). Useless against reinforced walls.

import { Gadget } from './Gadget.js';
import { castRay } from '../../util/raycast.js';

export class MeleeBreach extends Gadget {
  constructor(ctx) {
    super(ctx, { id: 'meleebreach', name: 'BREACHING MAUL', charges: 99, cooldown: 0.35 });
  }

  _activate(target) {
    const { world } = this.ctx;
    const hit = castRay(target.origin, target.dir, world.solids, 2.2);
    if (!hit) return false;
    const surf = hit.object.userData.destructible;
    if (!surf || surf.isHardened) {
      this.emit({ type: 'gadget', text: 'Maul only breaks soft surfaces' });
      return false;
    }
    const n = surf.damageAt(hit.point, 0.9);
    this.emit({ type: 'breach', point: hit.point, panels: n, hard: false });
    this.ctx.audio?.play('melee', hit.point);
    return true;
  }
}
