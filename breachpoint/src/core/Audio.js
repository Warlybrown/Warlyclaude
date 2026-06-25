// Audio.js — Web Audio API SFX manager (synth placeholders, positional 3D).
//
// No asset files: every sound is synthesized from oscillators + filtered noise
// with short envelopes. Sounds are positional — gain falls with distance and a
// stereo pan is derived from the listener's (camera's) orientation. An optional
// occlusion test muffles sounds heard through walls (low-pass + attenuation),
// which matters in a sound-driven tactical shooter.
//
// The AudioContext is created lazily and resumed on the first user gesture
// (pointer lock), per browser autoplay policy.

import * as THREE from 'three';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.enabled = true;
    this._noiseBuf = null;

    // Listener pose, updated each frame from the active camera.
    this.listenerPos = new THREE.Vector3();
    this.listenerRight = new THREE.Vector3(1, 0, 0);
    this.listenerFwd = new THREE.Vector3(0, 0, -1);

    // Optional occlusion test set by the orchestrator: (worldPos) => boolean.
    this.occlusionTest = null;

    this._lastPlay = new Map(); // throttle identical sounds
  }

  /** Create/resume the context (call from a user gesture). */
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this._buildNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  _buildNoise() {
    const n = this.ctx.sampleRate * 0.5;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
  }

  /** Update listener pose from the active camera each frame. */
  setListener(camera) {
    camera.getWorldPosition(this.listenerPos);
    this.listenerFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  }

  /** Compute {gain, pan, occluded} for a world position. */
  _spatial(pos, range) {
    if (!pos) return { gain: 1, pan: 0, occluded: false };
    const to = new THREE.Vector3().subVectors(pos, this.listenerPos);
    const dist = to.length();
    let gain = Math.max(0, 1 - dist / range);
    gain *= gain; // perceptual falloff
    to.normalize();
    const pan = THREE.MathUtils.clamp(to.dot(this.listenerRight), -1, 1);
    let occluded = false;
    if (gain > 0.02 && this.occlusionTest) occluded = this.occlusionTest(pos);
    return { gain, pan, occluded };
  }

  /**
   * Play a named sound, optionally at a world position.
   * @param {string} name
   * @param {THREE.Vector3} [pos]
   */
  play(name, pos = null) {
    if (!this.enabled || !this.ctx) return;
    // Throttle floods of the same sound (e.g. many footsteps in a tick).
    const now = this.ctx.currentTime;
    const key = name + (pos ? `${pos.x | 0},${pos.z | 0}` : '');
    if (now - (this._lastPlay.get(key) || 0) < 0.03) return;
    this._lastPlay.set(key, now);

    const recipe = RECIPES[name];
    if (!recipe) return;
    const range = recipe.range || 40;
    const sp = this._spatial(pos, range);
    if (pos && sp.gain <= 0.01) return; // inaudible

    // Per-sound chain: source → [lowpass if occluded] → panner → gain → master.
    const out = this.ctx.createGain();
    out.gain.value = (recipe.gain ?? 0.5) * (pos ? sp.gain : 1);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pos ? sp.pan : 0;
    let head = panner;
    if (sp.occluded) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 480; // muffled through walls
      panner.connect(lp); lp.connect(out);
      out.gain.value *= 0.6;
    } else {
      panner.connect(out);
    }
    out.connect(this.master);

    recipe.build(this.ctx, panner, this._noiseBuf, now);
  }
}

// --- synth recipes ---------------------------------------------------------
// Each builds its nodes and connects into `dest`, scheduling an envelope.

function env(ctx, node, t0, a, d, peak = 1) {
  const g = node.gain;
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peak, t0 + a);
  g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function noiseBurst(ctx, dest, buf, t0, dur, freq, q, peak) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = ctx.createGain();
  env(ctx, g, t0, 0.002, dur, peak);
  src.connect(bp); bp.connect(g); g.connect(dest);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

function tone(ctx, dest, t0, type, f0, f1, dur, peak) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(f0, t0);
  if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  const g = ctx.createGain();
  env(ctx, g, t0, 0.004, dur, peak);
  o.connect(g); g.connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

const RECIPES = {
  shot: { gain: 0.5, range: 70, build: (c, d, n, t) => {
    noiseBurst(c, d, n, t, 0.09, 1400, 0.7, 1);
    tone(c, d, t, 'square', 180, 60, 0.07, 0.5);
  } },
  reload: { gain: 0.4, range: 18, build: (c, d, n, t) => {
    noiseBurst(c, d, n, t, 0.04, 2600, 1, 0.5);
    noiseBurst(c, d, n, t + 0.18, 0.05, 1800, 1, 0.6);
    tone(c, d, t + 0.3, 'square', 220, 160, 0.05, 0.3);
  } },
  step: { gain: 0.18, range: 16, build: (c, d, n, t) => noiseBurst(c, d, n, t, 0.05, 320, 0.8, 0.5) },
  drone: { gain: 0.12, range: 22, build: (c, d, n, t) => tone(c, d, t, 'sawtooth', 90, 110, 0.18, 0.3) },
  breach: { gain: 0.7, range: 90, build: (c, d, n, t) => {
    noiseBurst(c, d, n, t, 0.4, 220, 0.5, 1);
    tone(c, d, t, 'sine', 90, 30, 0.5, 0.8);
  } },
  melee: { gain: 0.5, range: 30, build: (c, d, n, t) => {
    noiseBurst(c, d, n, t, 0.12, 500, 0.6, 0.9);
    tone(c, d, t, 'square', 120, 50, 0.1, 0.5);
  } },
  beep: { gain: 0.35, range: 30, build: (c, d, n, t) => tone(c, d, t, 'sine', 1500, 1500, 0.08, 0.6) },
  plant: { gain: 0.4, range: 24, build: (c, d, n, t) => {
    tone(c, d, t, 'square', 440, 660, 0.12, 0.4);
    tone(c, d, t + 0.13, 'square', 660, 880, 0.12, 0.4);
  } },
  defuse: { gain: 0.4, range: 24, build: (c, d, n, t) => {
    tone(c, d, t, 'square', 880, 440, 0.2, 0.4);
  } },
  place: { gain: 0.35, range: 16, build: (c, d, n, t) => noiseBurst(c, d, n, t, 0.05, 900, 1, 0.5) },
  flash: { gain: 0.6, range: 40, build: (c, d, n, t) => {
    noiseBurst(c, d, n, t, 0.25, 5000, 0.3, 1);
    tone(c, d, t, 'sine', 2000, 200, 0.25, 0.5);
  } },
  scan: { gain: 0.3, range: 30, build: (c, d, n, t) => tone(c, d, t, 'sine', 600, 2400, 0.3, 0.4) },
  throw: { gain: 0.25, range: 18, build: (c, d, n, t) => noiseBurst(c, d, n, t, 0.06, 700, 1, 0.4) },
  jammer: { gain: 0.25, range: 20, build: (c, d, n, t) => tone(c, d, t, 'sawtooth', 200, 60, 0.3, 0.3) },
  click: { gain: 0.3, range: 6, build: (c, d, n, t) => tone(c, d, t, 'square', 800, 800, 0.03, 0.3) },
  roundStart: { gain: 0.4, range: 6, build: (c, d, n, t) => {
    tone(c, d, t, 'sine', 330, 330, 0.18, 0.5);
    tone(c, d, t + 0.18, 'sine', 495, 495, 0.25, 0.5);
  } },
  win: { gain: 0.5, range: 6, build: (c, d, n, t) => {
    tone(c, d, t, 'sine', 440, 440, 0.16, 0.5);
    tone(c, d, t + 0.16, 'sine', 554, 554, 0.16, 0.5);
    tone(c, d, t + 0.32, 'sine', 660, 660, 0.32, 0.5);
  } },
  lose: { gain: 0.5, range: 6, build: (c, d, n, t) => {
    tone(c, d, t, 'sine', 440, 440, 0.16, 0.5);
    tone(c, d, t + 0.16, 'sine', 370, 370, 0.16, 0.5);
    tone(c, d, t + 0.32, 'sine', 294, 294, 0.4, 0.5);
  } },
};
