// Loop.js — fixed-timestep update + uncapped render.
//
// Game logic (movement, physics, AI) runs at a fixed step so behaviour is
// deterministic and framerate-independent. Rendering happens once per animation
// frame using an interpolation alpha. Phase 0 only renders, but the structure is
// here so later phases drop their sim into update(dt) without re-plumbing.

export class Loop {
  /**
   * @param {(dt:number)=>void} update fixed-step sim callback (seconds)
   * @param {(alpha:number)=>void} render render callback (0..1 interp alpha)
   * @param {number} hz simulation frequency
   */
  constructor(update, render, hz = 60) {
    this.update = update;
    this.render = render;
    this.step = 1 / hz;
    this.maxFrame = 0.25; // clamp huge gaps (tab refocus) to avoid spiral-of-death
    this._acc = 0;
    this._last = 0;
    this._running = false;
    this._raf = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now() / 1000;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  _tick() {
    if (!this._running) return;
    const now = performance.now() / 1000;
    let frame = now - this._last;
    this._last = now;
    if (frame > this.maxFrame) frame = this.maxFrame;

    this._acc += frame;
    while (this._acc >= this.step) {
      this.update(this.step);
      this._acc -= this.step;
    }

    const alpha = this._acc / this.step;
    this.render(alpha);

    this._raf = requestAnimationFrame(this._tick);
  }
}
