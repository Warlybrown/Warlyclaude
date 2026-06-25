// Navmesh.js — waypoint graph + A* pathfinding generated from the map.
//
// Generation: sample a grid over the building footprint. For each (x,z) column,
// cast a ray straight down and create a walkable NODE at every floor surface it
// hits (this naturally produces nodes on the ground floor, the upper floor, and
// the stairs). Two nodes connect if they are grid-adjacent, within a climbable
// step in height, and the segment between them is clear of STRUCTURAL geometry.
//
// Clearance uses world.staticColliders only — so destructible (soft/reinforced)
// walls do NOT block navigation. Bots can therefore path toward where a soft
// wall is and breach it; once a hole opens, the panel colliders are gone and
// movement is unobstructed. Reinforced walls are handled by the brain (attackers
// hard-breach or reroute) rather than the graph.

import * as THREE from 'three';

const _ray = new THREE.Raycaster();

export class Navmesh {
  /**
   * @param {object} world shared world (solids, staticColliders)
   * @param {object} opts { spacing, bounds }
   */
  constructor(world, opts = {}) {
    this.world = world;
    this.spacing = opts.spacing ?? 2.0;
    this.bounds = opts.bounds ?? { minX: -14, maxX: 14, minZ: -14, maxZ: 14 };
    this.nodes = []; // { id, pos:Vector3, neighbors:[{id,cost}] }
    this._build();
  }

  _build() {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const s = this.spacing;
    const cols = new Map(); // "i,j" -> node ids at that column

    let id = 0;
    for (let x = minX; x <= maxX; x += s) {
      for (let z = minZ; z <= maxZ; z += s) {
        const floors = this._floorsAt(x, z);
        const ij = `${Math.round((x - minX) / s)},${Math.round((z - minZ) / s)}`;
        const ids = [];
        for (const fy of floors) {
          // Headroom: skip if a wall occupies body height here.
          if (this._blockedAt(x, fy + 1.0, z)) continue;
          const node = { id: id++, pos: new THREE.Vector3(x, fy, z), neighbors: [], ij };
          this.nodes.push(node);
          ids.push(node.id);
        }
        if (ids.length) cols.set(ij, ids);
      }
    }

    // Connect grid-adjacent columns.
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const iOf = (ij) => ij.split(',').map(Number);
    for (const node of this.nodes) {
      const [i, j] = iOf(node.ij);
      for (const [di, dj] of dirs) {
        const nij = `${i + di},${j + dj}`;
        const others = cols.get(nij);
        if (!others) continue;
        for (const oid of others) {
          const other = this.nodes[oid];
          if (!other) continue;
          if (Math.abs(other.pos.y - node.pos.y) > 1.3) continue; // too big a step
          if (!this._segmentClear(node.pos, other.pos)) continue;
          const cost = node.pos.distanceTo(other.pos);
          node.neighbors.push({ id: oid, cost });
          other.neighbors.push({ id: node.id, cost });
        }
      }
    }
  }

  /** Heights of floor surfaces in this column (downward ray vs solids). */
  _floorsAt(x, z) {
    _ray.set(new THREE.Vector3(x, 9, z), new THREE.Vector3(0, -1, 0));
    _ray.far = 12;
    const hits = _ray.intersectObjects(this.world.solids, true);
    const ys = [];
    for (const h of hits) {
      if (!h.face) continue;
      // Transform the face normal to world space — the ground plane is rotated,
      // so its raw (local) normal points +Z, not +Y. Without this the exterior
      // ground is never recognised as a walkable floor.
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.y > 0.5) {
        const ry = Math.round(h.point.y * 10) / 10; // dedup near-equal heights
        if (!ys.includes(ry)) ys.push(ry);
      }
    }
    return ys;
  }

  /** Is body-height blocked by a STATIC wall at this point? */
  _blockedAt(x, y, z) {
    const p = new THREE.Vector3(x, y, z);
    for (const b of this.world.staticColliders) {
      if (p.x >= b.min.x - 0.2 && p.x <= b.max.x + 0.2 &&
          p.z >= b.min.z - 0.2 && p.z <= b.max.z + 0.2 &&
          y >= b.min.y && y <= b.max.y) return true;
    }
    return false;
  }

  /** Is the horizontal segment between two nodes clear of structural walls? */
  _segmentClear(a, b) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = Math.min(a.y, b.y) + 1.0;
    if (this._blockedAt(mid.x, mid.y, mid.z)) return false;
    // Sample a couple more points along the segment.
    for (const t of [0.25, 0.75]) {
      const p = a.clone().lerp(b, t); p.y = Math.min(a.y, b.y) + 1.0;
      if (this._blockedAt(p.x, p.y, p.z)) return false;
    }
    return true;
  }

  /** Nearest node to a world position (optionally on a matching floor). */
  nearest(pos) {
    let best = null, bestD = Infinity;
    for (const n of this.nodes) {
      const d = n.pos.distanceToSquared(pos) + Math.abs(n.pos.y - pos.y) * 4;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /**
   * A* path of world-space waypoints from `from` to `to`.
   * @returns {THREE.Vector3[]} waypoints (empty if no path)
   */
  findPath(from, to) {
    const start = this.nearest(from);
    const goal = this.nearest(to);
    if (!start || !goal) return [];
    if (start === goal) return [goal.pos.clone()];

    const open = new Set([start.id]);
    const came = new Map();
    const g = new Map([[start.id, 0]]);
    const f = new Map([[start.id, start.pos.distanceTo(goal.pos)]]);

    while (open.size) {
      // Pick lowest f.
      let cur = null, curF = Infinity;
      for (const id of open) { const v = f.get(id) ?? Infinity; if (v < curF) { curF = v; cur = id; } }
      if (cur === goal.id) return this._reconstruct(came, cur);
      open.delete(cur);
      const node = this.nodes[cur];
      for (const nb of node.neighbors) {
        const tentative = (g.get(cur) ?? Infinity) + nb.cost;
        if (tentative < (g.get(nb.id) ?? Infinity)) {
          came.set(nb.id, cur);
          g.set(nb.id, tentative);
          f.set(nb.id, tentative + this.nodes[nb.id].pos.distanceTo(goal.pos));
          open.add(nb.id);
        }
      }
    }
    return [];
  }

  _reconstruct(came, cur) {
    const path = [this.nodes[cur].pos.clone()];
    while (came.has(cur)) {
      cur = came.get(cur);
      path.unshift(this.nodes[cur].pos.clone());
    }
    return path;
  }
}
