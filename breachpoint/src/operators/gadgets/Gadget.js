// Gadget.js — base class establishing the uniform gadget API.
//
// Every gadget implements the same lifecycle so the loadout/HUD/AI can treat
// them interchangeably:
//   equip()        — selected; show preview / ready state
//   use(target)    — trigger once (consumes a charge). target = {origin,dir,point,player}
//   tick(dt)       — per-frame update for active effects (timers, areas)
//   cleanup()      — remove all spawned objects (round end)
//
// `ctx` is the shared gameplay context: { scene, world, player, drone, audio,
// onEvent }. Gadgets push gameplay events via ctx.onEvent for HUD/score.

export class Gadget {
  constructor(ctx, def = {}) {
    this.ctx = ctx;
    this.id = def.id || 'gadget';
    this.name = def.name || 'Gadget';
    this.charges = def.charges ?? 1;
    this.cooldown = def.cooldown ?? 0;
    this._cd = 0;
    this.active = [];      // spawned sub-objects/effects this gadget owns
    this.equipped = false;
  }

  get ready() { return this.charges > 0 && this._cd <= 0; }

  equip() { this.equipped = true; }
  unequip() { this.equipped = false; }

  /** Default: spend a charge + start cooldown, then delegate to _activate(). */
  use(target) {
    if (!this.ready) return false;
    this.charges--;
    this._cd = this.cooldown;
    return this._activate(target) !== false;
  }

  _activate() { /* override */ return true; }

  tick(dt) {
    if (this._cd > 0) this._cd -= dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      if (a.tick) a.tick(dt);
      if (a.dead) {
        if (a.cleanup) a.cleanup();
        this.active.splice(i, 1);
      }
    }
  }

  cleanup() {
    for (const a of this.active) if (a.cleanup) a.cleanup();
    this.active = [];
  }

  emit(ev) { this.ctx.onEvent?.(ev); }
}
