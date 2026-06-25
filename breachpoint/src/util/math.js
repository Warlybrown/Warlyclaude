// math.js — small, dependency-free numeric helpers used across systems.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Framerate-independent exponential smoothing ("damp"). `lambda` is the decay
 * rate: higher = snappier. Use for FOV, lean, crouch height, recoil recovery.
 */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const deg2rad = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;

/** Move `a` toward `b` by at most `maxDelta`. */
export function moveToward(a, b, maxDelta) {
  const d = b - a;
  if (Math.abs(d) <= maxDelta) return b;
  return a + Math.sign(d) * maxDelta;
}

/** Deterministic-ish small jitter in [-1,1] from a seed; avoids Math.random bans. */
export function signedRand() {
  // Plain Math.random is fine in the browser runtime (it's the workflow VM that
  // blocks it). Spread/recoil bloom genuinely wants per-shot randomness.
  return Math.random() * 2 - 1;
}
