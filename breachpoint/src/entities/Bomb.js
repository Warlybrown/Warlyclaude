// Bomb.js — bomb-defusal objective: the attacker's defuser plant + countdown.
//
// Flow (Siege-style):
//   1. Attackers reach a bomb site and channel a ~7s PLANT of the defuser.
//   2. Once planted, a ~45s detonation COUNTDOWN begins (audible beep speeds up).
//   3. Defenders can channel a ~8s DISABLE on the planted device to stop it.
//   4. Attackers win if the countdown reaches 0 (defuser detonates) or all
//      defenders die. Defenders win if they disable it or kill all attackers
//      before the plant.
//
// This class only models the objective timers/states; the orchestrator decides
// who is channeling based on proximity + hold input, and reads the state to
// drive HUD + win conditions.

import * as THREE from 'three';

export const BombState = {
  CARRIED: 'CARRIED', // not yet planted
  PLANTING: 'PLANTING',
  PLANTED: 'PLANTED',
  DISABLING: 'DISABLING',
  DETONATED: 'DETONATED',
  DISABLED: 'DISABLED',
};

export class Bomb {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts { plantTime, countdown, disableTime }
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.plantTime = opts.plantTime ?? 7;
    this.countdown = opts.countdown ?? 45;
    this.disableTime = opts.disableTime ?? 8;

    this.state = BombState.CARRIED;
    this.site = null; // which site it was planted at
    this.plantProgress = 0; // 0..1
    this.disableProgress = 0; // 0..1
    this.timeLeft = this.countdown;
    this._beepAccum = 0;
    this.events = [];

    // Visual: a small device placed when planted.
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.18, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x202428, emissive: 0x2e9bff, emissiveIntensity: 0.4 })
    );
    this.light = new THREE.PointLight(0x2e9bff, 0, 4, 2);
    this.mesh.visible = false;
    scene.add(this.mesh);
    scene.add(this.light);
  }

  reset() {
    this.state = BombState.CARRIED;
    this.site = null;
    this.plantProgress = 0;
    this.disableProgress = 0;
    this.timeLeft = this.countdown;
    this.mesh.visible = false;
    this.light.intensity = 0;
    this.events = [];
  }

  get planted() {
    return this.state === BombState.PLANTED || this.state === BombState.DISABLING;
  }

  get resolved() {
    return this.state === BombState.DETONATED || this.state === BombState.DISABLED;
  }

  /** Attacker is channeling a plant at `site` this tick. */
  tickPlant(dt, site) {
    if (this.state !== BombState.CARRIED && this.state !== BombState.PLANTING) return;
    this.state = BombState.PLANTING;
    this.plantProgress += dt / this.plantTime;
    if (this.plantProgress >= 1) this._completePlant(site);
  }

  /** Attacker stopped channeling before completing the plant. */
  cancelPlant() {
    if (this.state === BombState.PLANTING) {
      this.state = BombState.CARRIED;
      this.plantProgress = 0;
    }
  }

  _completePlant(site) {
    this.state = BombState.PLANTED;
    this.site = site;
    this.plantProgress = 1;
    this.timeLeft = this.countdown;
    this.mesh.position.copy(site.pos).add(new THREE.Vector3(0, 0.1, 0));
    this.mesh.visible = true;
    this.light.position.copy(this.mesh.position);
    this.events.push({ type: 'planted', site });
  }

  /** Defender is channeling a disable this tick. */
  tickDisable(dt) {
    if (this.state !== BombState.PLANTED && this.state !== BombState.DISABLING) return;
    this.state = BombState.DISABLING;
    this.disableProgress += dt / this.disableTime;
    if (this.disableProgress >= 1) {
      this.state = BombState.DISABLED;
      this.events.push({ type: 'disabled' });
    }
  }

  /** Defender stopped disabling. */
  cancelDisable() {
    if (this.state === BombState.DISABLING) {
      this.state = BombState.PLANTED;
      this.disableProgress = 0;
    }
  }

  update(dt) {
    if (this.state === BombState.PLANTED || this.state === BombState.DISABLING) {
      this.timeLeft -= dt;
      // Pulse the device light; speed scales with urgency.
      const urgency = 1 - this.timeLeft / this.countdown;
      this._beepAccum += dt;
      const interval = Math.max(0.12, 0.9 - urgency * 0.8);
      if (this._beepAccum >= interval) {
        this._beepAccum = 0;
        this.events.push({ type: 'beep', urgency });
        this.light.intensity = 2.5;
      }
      this.light.intensity = Math.max(0, this.light.intensity - dt * 8);
      if (this.timeLeft <= 0) {
        this.state = BombState.DETONATED;
        this.events.push({ type: 'detonated', site: this.site });
      }
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
