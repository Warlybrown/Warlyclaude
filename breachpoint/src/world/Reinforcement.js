// Reinforcement.js — defender wall-reinforcement during the prep phase.
//
// Defenders have a limited number of reinforcement charges per round. Calling
// reinforce() on a reinforceable DestructibleSurface converts it to a hard
// (bulletproof) wall that only a dedicated hard-breach gadget can open. This
// module just tracks the budget and exposes the list of reinforceable walls.

export class ReinforcementManager {
  /**
   * @param {object} world shared world with `destructibles`
   * @param {number} charges total reinforcements available to the defense
   */
  constructor(world, charges = 10) {
    this.world = world;
    this.charges = charges;
    this.used = 0;
  }

  get remaining() {
    return this.charges - this.used;
  }

  /** Reinforceable, not-yet-reinforced surfaces. */
  available() {
    return this.world.destructibles.filter(
      (d) => d.type === 'reinforceable' && !d.reinforced
    );
  }

  /** Reinforce a specific surface; returns true on success. */
  reinforce(surface) {
    if (this.remaining <= 0) return false;
    if (!surface || surface.type !== 'reinforceable' || surface.reinforced) return false;
    if (surface.reinforce()) {
      this.used++;
      return true;
    }
    return false;
  }

  /** Convenience: reinforce the nearest reinforceable wall to a point. */
  reinforceNearest(point, maxDist = 3) {
    let best = null;
    let bestD = maxDist;
    for (const s of this.available()) {
      const d = s.def;
      const dist = Math.hypot((d.x ?? 0) - point.x, (d.z ?? 0) - point.z);
      if (dist < bestD) { bestD = dist; best = s; }
    }
    return best ? this.reinforce(best) : false;
  }
}
