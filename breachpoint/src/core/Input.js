// Input.js — keyboard / mouse state + pointer-lock management.
//
// Phase 0 scope: own the pointer-lock lifecycle and expose a clean, pollable
// snapshot of input state. Movement/weapon code in later phases reads from this
// rather than wiring its own listeners, so all input lives in one place.

export class Input {
  /**
   * @param {HTMLElement} domElement element that requests pointer lock (the canvas)
   */
  constructor(domElement) {
    this.dom = domElement;

    // Held-key map keyed by KeyboardEvent.code (layout-independent).
    this.keys = new Map();

    // Mouse button state (0 = left, 2 = right).
    this.mouse = { left: false, right: false };

    // Accumulated look delta since last consume(). Consumed each frame so we
    // don't double-apply movement; this avoids drift when frames are uneven.
    this.lookDelta = { x: 0, y: 0 };

    this.locked = false;

    // Listeners fired on lock state changes, so the UI can show/hide prompts.
    this._lockListeners = new Set();

    this._bind();
  }

  _bind() {
    // --- keyboard ---
    window.addEventListener('keydown', (e) => {
      // Don't swallow refresh / devtools shortcuts.
      this.keys.set(e.code, true);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);
    });

    // --- mouse buttons ---
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });

    // Suppress the context menu so right-click can be used for ADS.
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- mouse look (only while locked) ---
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDelta.x += e.movementX || 0;
      this.lookDelta.y += e.movementY || 0;
    });

    // --- pointer lock state ---
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) {
        // Clear transient state so we don't "stick" a held button on unlock.
        this.mouse.left = false;
        this.mouse.right = false;
        this.keys.clear();
      }
      this._lockListeners.forEach((fn) => fn(this.locked));
    });
  }

  /** Request pointer lock (call from a user gesture, e.g. a click). */
  requestLock() {
    if (this.locked) return;
    this.dom.requestPointerLock?.();
  }

  /** Subscribe to lock/unlock; returns an unsubscribe fn. */
  onLockChange(fn) {
    this._lockListeners.add(fn);
    return () => this._lockListeners.delete(fn);
  }

  isDown(code) {
    return this.keys.get(code) === true;
  }

  /** Read and reset the accumulated look delta. Call once per frame. */
  consumeLookDelta() {
    const d = { x: this.lookDelta.x, y: this.lookDelta.y };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return d;
  }
}
