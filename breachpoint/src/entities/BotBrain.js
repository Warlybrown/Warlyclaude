// BotBrain.js — finite-state behaviour for a Bot.
//
// Shared states: ENGAGE (shoot a seen enemy), HUNT (move to last-known / sound),
// plus side-specific goals:
//   Attacker: ADVANCE toward the objective site → PLANT (channel) → DEFEND_PLANT.
//             Breaches a soft wall if one blocks the path.
//   Defender: HOLD an angle near site → ROAM patrol → DISABLE a planted defuser.
//
// Perception each tick: pick the best visible enemy (ENGAGE); if none, decay to
// HUNT toward lastSeenPos / a heard sound; otherwise pursue the side goal.

import * as THREE from 'three';
import { explodeAt } from '../world/Destruction.js';
import { castRay } from '../util/raycast.js';

export const State = {
  ADVANCE: 'ADVANCE', ENGAGE: 'ENGAGE', HUNT: 'HUNT', PLANT: 'PLANT',
  DEFEND_PLANT: 'DEFEND_PLANT', HOLD: 'HOLD', ROAM: 'ROAM', DISABLE: 'DISABLE',
};

export class BotBrain {
  /**
   * @param {Bot} bot
   * @param {object} ctx { nav, world, getEnemies, getSite, bomb, gameSide }
   */
  constructor(bot, ctx) {
    this.bot = bot;
    this.ctx = ctx;
    this.state = bot.side === 'ATTACK' ? State.ADVANCE : State.HOLD;
    this._think = 0;        // perception throttle
    this._repath = 0;
    this._stateT = 0;
    this._holdSpot = null;
  }

  update(dt) {
    const bot = this.bot;
    this._think -= dt;
    this._stateT += dt;

    // --- perception (throttled) ---
    if (this._think <= 0) {
      this._think = 0.12;
      this._perceive();
    }

    // --- act on state ---
    switch (this.state) {
      case State.ENGAGE: this._engage(dt); break;
      case State.HUNT: this._hunt(dt); break;
      case State.ADVANCE: this._advance(dt); break;
      case State.PLANT: this._plant(dt); break;
      case State.DEFEND_PLANT: this._defendPlant(dt); break;
      case State.HOLD: this._hold(dt); break;
      case State.ROAM: this._roam(dt); break;
      case State.DISABLE: this._disable(dt); break;
      default: break;
    }
  }

  _perceive() {
    const bot = this.bot;
    const enemies = this.ctx.getEnemies();
    let best = null, bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (bot.canSee(e)) {
        const d = bot.position.distanceTo(e.position || e.mesh.position);
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    if (best) {
      bot.target = best;
      bot.lastSeenPos = (best.position || best.mesh.position).clone();
      this._enter(State.ENGAGE);
    } else if (bot.target) {
      // Lost sight — go hunt the last known position.
      bot.target = null;
      this._enter(State.HUNT);
    } else {
      // Heard something?
      const sound = this._nearestSound();
      if (sound && this.state !== State.PLANT && this.state !== State.DEFEND_PLANT) {
        bot.investigate = sound.clone();
        if (this.state !== State.ENGAGE) this._enter(State.HUNT);
      }
    }
  }

  _nearestSound() {
    const bot = this.bot;
    const now = performance.now();
    let best = null, bestD = 14; // hearing radius (m)
    for (const s of this.ctx.world.soundEvents) {
      if (now - s.time > 800) continue;
      const d = bot.position.distanceTo(s.pos);
      if (d < bestD) { bestD = d; best = s.pos; }
    }
    return best;
  }

  _enter(state) {
    if (this.state === state) return;
    this.state = state;
    this._stateT = 0;
    this._repath = 0;
  }

  // --- shared combat ---
  _engage(dt) {
    const bot = this.bot;
    if (!bot.target || !bot.target.alive || !bot.canSee(bot.target)) {
      this._enter(bot.target ? State.HUNT : (bot.side === 'ATTACK' ? State.ADVANCE : State.HOLD));
      return;
    }
    // Strafe-hold: stop and shoot. Occasionally jukes by clearing velocity.
    bot.velocity.multiplyScalar(0.6);
    bot.fireAt(bot.target, dt);
  }

  _hunt(dt) {
    const bot = this.bot;
    const goal = bot.lastSeenPos || bot.investigate;
    if (!goal) { this._enter(bot.side === 'ATTACK' ? State.ADVANCE : State.HOLD); return; }
    this._moveTo(goal, dt, () => {
      bot.lastSeenPos = null; bot.investigate = null;
      this._enter(bot.side === 'ATTACK' ? State.ADVANCE : State.ROAM);
    });
  }

  // --- attacker goals ---
  _advance(dt) {
    const bot = this.bot;
    const site = this.ctx.getSite();
    if (!site) return;
    // If the defuser is already planted by my team, switch to defending it.
    if (this.ctx.bomb?.planted && this.ctx.bomb.site) { this._enter(State.DEFEND_PLANT); return; }
    this._moveTo(site.pos, dt, () => this._enter(State.PLANT), () => this._tryBreach());
  }

  _plant(dt) {
    const bot = this.bot;
    const site = this.ctx.getSite();
    const bomb = this.ctx.bomb;
    if (!site || !bomb) return;
    if (bomb.planted) { this._enter(State.DEFEND_PLANT); return; }
    const d = bot.position.distanceTo(site.pos);
    if (d > site.radius * 0.8) { this._enter(State.ADVANCE); return; }
    // If an enemy appears, fight first.
    if (bot.target) { this._enter(State.ENGAGE); return; }
    bot.velocity.set(0, 0, 0);
    bomb.tickPlant(dt, site);
  }

  _defendPlant(dt) {
    const bot = this.bot;
    const bomb = this.ctx.bomb;
    if (!bomb?.planted) { this._enter(State.ADVANCE); return; }
    // Hold near the planted device, watching outward.
    const guard = bomb.mesh.position.clone().add(new THREE.Vector3(Math.sin(bot.id) * 2, 0, Math.cos(bot.id) * 2));
    this._moveTo(guard, dt, () => { bot.velocity.multiplyScalar(0.5); });
  }

  // --- defender goals ---
  _hold(dt) {
    const bot = this.bot;
    const bomb = this.ctx.bomb;
    if (bomb?.planted) { this._enter(State.DISABLE); return; }
    const site = this.ctx.getSite();
    if (!site) { bot.velocity.set(0, 0, 0); return; }
    if (!this._holdSpot) {
      const ang = bot.id * 1.7;
      this._holdSpot = site.pos.clone().add(new THREE.Vector3(Math.cos(ang) * 3, 0, Math.sin(ang) * 3));
    }
    this._moveTo(this._holdSpot, dt, () => {
      // Arrived: watch toward the site centre / likely entry; idle-scan.
      bot.velocity.set(0, 0, 0);
      const site = this.ctx.getSite();
      const look = site.pos.clone().sub(bot.position);
      bot.yaw = Math.atan2(-look.x, -look.z) + Math.sin(this._stateT * 0.6) * 0.5;
      if (this._stateT > 6 + (bot.id % 3) * 2) this._enter(State.ROAM);
    });
  }

  _roam(dt) {
    const bot = this.bot;
    const bomb = this.ctx.bomb;
    if (bomb?.planted) { this._enter(State.DISABLE); return; }
    // Patrol to a random nav node, then return to holding.
    if (!this._roamGoal) {
      const nodes = this.ctx.nav.nodes;
      this._roamGoal = nodes[Math.floor(Math.random() * nodes.length)]?.pos.clone();
    }
    this._moveTo(this._roamGoal, dt, () => { this._roamGoal = null; this._holdSpot = null; this._enter(State.HOLD); });
  }

  _disable(dt) {
    const bot = this.bot;
    const bomb = this.ctx.bomb;
    if (!bomb?.planted) { this._enter(State.HOLD); return; }
    const d = bot.position.distanceTo(bomb.mesh.position);
    if (d > 2) { this._moveTo(bomb.mesh.position, dt); return; }
    if (bot.target) { this._enter(State.ENGAGE); return; }
    bot.velocity.set(0, 0, 0);
    bomb.tickDisable(dt);
  }

  // --- helpers --------------------------------------------------------------
  /** Path toward a goal; calls onArrive() when within ~1m. onBlocked() if stuck. */
  _moveTo(goal, dt, onArrive = null, onBlocked = null) {
    const bot = this.bot;
    this._repath -= dt;
    const flatD = Math.hypot(goal.x - bot.position.x, goal.z - bot.position.z);
    if (flatD < 1.0 && Math.abs(goal.y - bot.position.y) < 1.4) { onArrive?.(); return; }

    if (this._repath <= 0 || !bot.hasPath()) {
      this._repath = 1.2;
      const path = this.ctx.nav.findPath(bot.position, goal);
      // Trim leading waypoints the bot has already passed: drop path[0] while the
      // bot is closer to path[1] than path[0] is. Without this, each repath snaps
      // the target back to the nearest (often behind) node and the bot oscillates.
      while (path.length > 1 && bot.position.distanceTo(path[1]) <= path[0].distanceTo(path[1])) {
        path.shift();
      }
      bot.setPath(path.length ? path : [goal.clone()]);
      this._lastPos = bot.position.clone();
    }
    const done = bot._followPath(dt);

    // Stuck detection: if barely moved since last repath, we may be at a wall.
    if (this._lastPos) {
      this._stuckCheck = (this._stuckCheck ?? 0) + dt;
      if (this._stuckCheck > 0.5) {
        const moved = bot.position.distanceTo(this._lastPos);
        this._lastPos = bot.position.clone();
        this._stuckCheck = 0;
        if (moved < 0.15) { onBlocked?.(); this._repath = 0; }
      }
    }
    if (done) onArrive?.();
  }

  /** Attacker: if a destructible wall is right in front on the way, breach it. */
  _tryBreach() {
    const bot = this.bot;
    const fwd = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const hit = castRay(bot.eye(), fwd, this.ctx.world.solids, 1.2);
    if (!hit) return;
    const surf = hit.object.userData.destructible;
    if (!surf) return;
    if (surf.isHardened) {
      // Hard-breach if this attacker carries the tool (Ramrod), else reroute.
      if (bot.operator?.gadget === 'hardbreach') {
        explodeAt(this.ctx.world, hit.point, 1.6, { hardBreach: true });
      }
    } else {
      surf.damageAt(hit.point, 0.85); // smash soft wall to continue
      this.ctx.world.soundEvents.push({ pos: hit.point.clone(), type: 'breach', time: performance.now() });
    }
  }
}
