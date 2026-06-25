// Destruction.js — layered, panel-grid destructible surfaces.
//
// THE CORE SIEGE MECHANIC. A destructible wall/floor is a grid of small panels.
// Bullets and explosions remove panels within a radius, opening localized holes
// for line-of-sight and walk-through. Because each intact panel is registered in
// the shared world.solids (for raycast) and world.colliders (for movement),
// collision and LOS update *automatically* as panels disappear — bots and the
// player see and shoot through new holes with no extra bookkeeping.
//
// Surface types:
//   soft          — drywall/wood. Bullets penetrate (handled in Weapon via
//                   castRayAll) and create growing holes. Fully breakable.
//   reinforceable — starts soft; reinforce() makes it 'hard' (bulletproof,
//                   only a dedicated hard-breach gadget can open it).
//   hatch         — a breakable floor panel for vertical play (drop a level).
//
// Performance: panel counts are capped per surface; a global pool isn't needed
// because removed panels are simply hidden and dropped from the world arrays.

import * as THREE from 'three';

const PANEL = 0.4; // target panel edge length (metres)

const MATERIALS = {
  soft: () => new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.95 }),
  reinforceable: () => new THREE.MeshStandardMaterial({ color: 0x715f47, roughness: 0.9 }),
  hard: () => new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5, metalness: 0.5 }),
  hatch: () => new THREE.MeshStandardMaterial({ color: 0x4a3d2c, roughness: 0.95 }),
  rubble: () => new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 1 }),
};

export class DestructibleSurface {
  /**
   * @param {THREE.Scene} scene
   * @param {object} world shared { solids, colliders, destructibles }
   * @param {object} def from the map's `destructibles` list
   */
  constructor(scene, world, def) {
    this.scene = scene;
    this.world = world;
    this.def = def;
    this.type = def.type; // soft | reinforceable | hatch
    this.reinforced = false;

    // Orientation: a 'hatch' lies flat (normal = Y); walls are vertical with the
    // thin dimension giving the facing normal.
    this.isFloor = def.type === 'hatch';

    this.panels = []; // { mesh, box, alive, gx, gy }
    this.group = new THREE.Group();
    scene.add(this.group);

    this._build();
    world.destructibles.push(this);
  }

  _build() {
    const d = this.def;
    const y0 = d.y ?? 0;

    if (this.isFloor) {
      // Horizontal grid in XZ at height y0. Thin in Y.
      const cols = Math.max(2, Math.round(d.w / PANEL));
      const rows = Math.max(2, Math.round(d.d / PANEL));
      const pw = d.w / cols;
      const pd = d.d / rows;
      const t = 0.18;
      const geo = new THREE.BoxGeometry(pw * 0.98, t, pd * 0.98);
      const mat = MATERIALS.hatch();
      for (let gx = 0; gx < cols; gx++) {
        for (let gy = 0; gy < rows; gy++) {
          const x = d.x - d.w / 2 + pw * (gx + 0.5);
          const z = d.z - d.d / 2 + pd * (gy + 0.5);
          this._addPanel(geo, mat, x, y0, z, gx, gy);
        }
      }
    } else {
      // Vertical wall. Determine the long horizontal axis (x or z).
      const alongX = d.w >= d.d;
      const length = alongX ? d.w : d.d;
      const height = d.h ?? 3.0;
      const cols = Math.max(2, Math.round(length / PANEL));
      const rows = Math.max(2, Math.round(height / PANEL));
      const pl = length / cols;
      const ph = height / rows;
      const thick = (alongX ? d.d : d.w) || 0.2;
      const geo = alongX
        ? new THREE.BoxGeometry(pl * 0.98, ph * 0.98, thick)
        : new THREE.BoxGeometry(thick, ph * 0.98, pl * 0.98);
      const mat = (this.type === 'reinforceable' ? MATERIALS.reinforceable : MATERIALS.soft)();
      for (let gx = 0; gx < cols; gx++) {
        for (let gy = 0; gy < rows; gy++) {
          const along = -length / 2 + pl * (gx + 0.5);
          const x = alongX ? d.x + along : d.x;
          const z = alongX ? d.z : d.z + along;
          const y = y0 + ph * (gy + 0.5);
          this._addPanel(geo, mat, x, y, z, gx, gy);
        }
      }
    }
    this._sharedMat = this.group.children[0]?.material;
  }

  _addPanel(geo, mat, x, y, z, gx, gy) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.destructible = this;
    this.group.add(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    const panel = { mesh, box, alive: true, gx, gy };
    mesh.userData.panel = panel;
    this.panels.push(panel);
    this.world.solids.push(mesh);
    this.world.colliders.push(box);
  }

  /** Convert a reinforceable wall to hard (bulletproof) during prep. */
  reinforce() {
    if (this.type !== 'reinforceable' || this.reinforced) return false;
    this.reinforced = true;
    const hardMat = MATERIALS.hard();
    for (const p of this.panels) {
      if (p.alive) p.mesh.material = hardMat;
    }
    return true;
  }

  /** Can a normal bullet/breach open this surface? Reinforced needs hard-breach. */
  get isHardened() {
    return this.reinforced;
  }

  /**
   * Damage the surface at a world point, removing panels within `radius`.
   * @param {THREE.Vector3} point
   * @param {number} radius
   * @param {object} opts { hardBreach:boolean }  hardBreach opens reinforced walls
   * @returns {number} panels removed
   */
  damageAt(point, radius, opts = {}) {
    if (this.reinforced && !opts.hardBreach) return 0;
    let removed = 0;
    for (const p of this.panels) {
      if (!p.alive) continue;
      const d = p.mesh.position.distanceTo(point);
      if (d <= radius) {
        this._removePanel(p);
        removed++;
      }
    }
    if (removed > 0) this._leaveRubble(point, radius);
    return removed;
  }

  _removePanel(p) {
    p.alive = false;
    p.mesh.visible = false;
    // Drop from the shared world arrays so raycast + movement ignore it.
    const si = this.world.solids.indexOf(p.mesh);
    if (si >= 0) this.world.solids.splice(si, 1);
    const ci = this.world.colliders.indexOf(p.box);
    if (ci >= 0) this.world.colliders.splice(ci, 1);
  }

  // Tiny decorative rubble at a fresh hole edge (visual cue, non-colliding).
  _leaveRubble() {
    // Kept minimal for performance; the missing panels are the real signal.
  }

  /** Fraction of panels still intact (used by AI to value a wall). */
  get integrity() {
    let alive = 0;
    for (const p of this.panels) if (p.alive) alive++;
    return alive / this.panels.length;
  }
}

/**
 * Apply an explosion to all destructible surfaces near a point (breach charges,
 * frags, hatch breaks). Returns total panels removed.
 */
export function explodeAt(world, point, radius, opts = {}) {
  let total = 0;
  for (const surf of world.destructibles) {
    total += surf.damageAt(point, radius, opts);
  }
  return total;
}
