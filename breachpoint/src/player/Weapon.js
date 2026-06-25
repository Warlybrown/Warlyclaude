// Weapon.js — hitscan firing, recoil, spread, ADS interaction, reload, FX.
//
// Feel goals (Siege-style):
//   * Hitscan ray from camera centre, offset by a spread cone.
//   * LEARNABLE recoil: a fixed per-shot kick pattern (vertical climb + a
//     left/right drift) the player counters by pulling down. Recoil is applied
//     as a separate camera offset that auto-recovers after the trigger releases,
//     so the pattern is repeatable, not random.
//   * Spread (bloom) is the random component: large while moving/hip-fire, small
//     while still + crouched + ADS. This is what rewards holding angles.
//   * Lethal headshots, body damage with (stubbed) falloff, hit markers.
//   * Object-pooled tracers + impact sparks; a muzzle flash light.
//
// The weapon reads recoil/spread *modifiers* from the player state each frame so
// movement and stance feed back into accuracy.

import * as THREE from 'three';
import { clamp, damp, signedRand } from '../util/math.js';
import { castRay, castRayAll } from '../util/raycast.js';

// Default archetype: a controllable assault rifle.
export const WEAPON_DEFS = {
  AR: {
    name: 'VK-9 CARBINE',
    rpm: 720,
    damage: 42,
    headshotMult: 2.6, // ~109 dmg → lethal headshot
    magSize: 30,
    reserve: 120,
    reloadTime: 2.3,
    // Per-shot recoil kick (radians). Climbs fast then plateaus; slight S-drift.
    recoilPattern: [
      [0.009, 0.000], [0.012, 0.002], [0.014, -0.003], [0.016, 0.004],
      [0.017, 0.005], [0.018, -0.006], [0.018, -0.004], [0.019, 0.006],
      [0.019, 0.007], [0.020, 0.003], [0.020, -0.007], [0.020, -0.008],
    ],
    recoilRecover: 9, // how fast the offset eases back when not firing
    // Spread cone half-angle (radians) by condition.
    spread: {
      base: 0.012, // standing still hip-fire
      moving: 0.05, // added when moving at full speed
      adsMul: 0.18, // multiplier when aiming
      crouchMul: 0.6, // multiplier when crouched
    },
    automatic: true,
    falloffStart: 28, // metres before damage starts dropping
    falloffEnd: 60, // metres at which damage hits its floor
    falloffFloor: 0.55, // fraction of base damage at long range
  },

  // High-RPM SMG: faster, lower per-shot damage, snappier recoil.
  SMG: {
    name: 'TKR-45 VECTOR', rpm: 920, damage: 32, headshotMult: 2.8,
    magSize: 32, reserve: 128, reloadTime: 2.1,
    recoilPattern: [
      [0.007, 0.001], [0.009, -0.002], [0.011, 0.003], [0.012, -0.003],
      [0.013, 0.004], [0.013, -0.004], [0.014, 0.003], [0.014, -0.005],
    ],
    recoilRecover: 11,
    spread: { base: 0.014, moving: 0.045, adsMul: 0.22, crouchMul: 0.65 },
    automatic: true, falloffStart: 18, falloffEnd: 42, falloffFloor: 0.45,
  },

  // Slow, heavy marksman/DMR: high damage, semi-auto.
  DMR: {
    name: 'LRS-7 MARKSMAN', rpm: 360, damage: 62, headshotMult: 2.4,
    magSize: 20, reserve: 80, reloadTime: 2.6,
    recoilPattern: [[0.022, 0.002], [0.024, -0.003], [0.025, 0.004]],
    recoilRecover: 7,
    spread: { base: 0.008, moving: 0.06, adsMul: 0.1, crouchMul: 0.5 },
    automatic: false, falloffStart: 40, falloffEnd: 80, falloffFloor: 0.7,
  },

  // Pump shotgun: pellet spread, devastating close, useless far.
  SHOTGUN: {
    name: 'M0-12 BREACHER', rpm: 75, damage: 14, headshotMult: 1.6,
    magSize: 7, reserve: 35, reloadTime: 3.4, pellets: 8,
    recoilPattern: [[0.05, 0.0]],
    recoilRecover: 6,
    spread: { base: 0.06, moving: 0.08, adsMul: 0.7, crouchMul: 0.85 },
    automatic: false, falloffStart: 6, falloffEnd: 18, falloffFloor: 0.1,
  },

  // Sidearm pistol.
  PISTOL: {
    name: 'P9 SIDEARM', rpm: 450, damage: 34, headshotMult: 2.5,
    magSize: 15, reserve: 60, reloadTime: 1.7,
    recoilPattern: [[0.014, 0.002], [0.015, -0.003]],
    recoilRecover: 12,
    spread: { base: 0.02, moving: 0.05, adsMul: 0.3, crouchMul: 0.7 },
    automatic: false, falloffStart: 14, falloffEnd: 34, falloffFloor: 0.4,
  },
};

export class Weapon {
  /**
   * @param {object} def one of WEAPON_DEFS
   * @param {THREE.Scene} scene for FX
   * @param {THREE.PerspectiveCamera} camera hitscan origin/orientation
   * @param {object} world { solids, targets } target list is damageable entities
   * @param {Audio} [audio]
   */
  constructor(def, scene, camera, world, audio = null) {
    this.def = def;
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.audio = audio;

    this.ammo = def.magSize;
    this.reserve = def.reserve;
    this.reloading = false;
    this._reloadT = 0;
    this._fireCooldown = 0;
    this._shotInBurst = 0; // index into recoil pattern
    this._timeSinceShot = 999;

    // Recoil offset (added to aim/camera by main via getRecoil()).
    this.recoilPitch = 0;
    this.recoilYaw = 0;

    // Events drained by the HUD each frame.
    this.events = [];

    this._initFX();
  }

  get secondsPerShot() {
    return 60 / this.def.rpm;
  }

  // ---- effects pools --------------------------------------------------------
  _initFX() {
    // Muzzle flash: a short-lived point light + a billboard sprite.
    this.muzzleLight = new THREE.PointLight(0xffd9a0, 0, 6, 2);
    this.scene.add(this.muzzleLight);

    // Tracer pool: thin stretched boxes reused per shot.
    this._tracerPool = [];
    this._tracers = [];
    const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5);
    tracerGeo.rotateX(Math.PI / 2); // align to +Z
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xfff0c0,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
      m.visible = false;
      this.scene.add(m);
      this._tracerPool.push(m);
    }

    // Impact spark pool: tiny emissive quads.
    this._sparkPool = [];
    this._sparks = [];
    const sparkGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffcf80 });
    for (let i = 0; i < 32; i++) {
      const m = new THREE.Mesh(sparkGeo, sparkMat.clone());
      m.visible = false;
      this.scene.add(m);
      this._sparkPool.push(m);
    }
  }

  _spawnTracer(from, to) {
    const m = this._tracerPool.pop();
    if (!m) return;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.scale.set(1, 1, len);
    m.lookAt(to);
    m.material.opacity = 0.9;
    m.visible = true;
    this._tracers.push({ m, life: 0.06 });
  }

  _spawnSpark(point, normal) {
    const m = this._sparkPool.pop();
    if (!m) return;
    m.position.copy(point);
    if (normal) m.position.addScaledVector(normal, 0.02);
    m.scale.setScalar(1);
    m.visible = true;
    this._sparks.push({ m, life: 0.12 });
  }

  // ---- firing ---------------------------------------------------------------
  /**
   * @param {object} ctx { firing, ads, moving, speed01, crouch01, canFire }
   */
  update(dt, ctx) {
    this._fireCooldown -= dt;
    this._timeSinceShot += dt;

    // Reload progress.
    if (this.reloading) {
      this._reloadT -= dt;
      if (this._reloadT <= 0) this._finishReload();
    }

    // Manual reload request handled by main calling reload(); auto-reload on dry
    // is left to the player for tactical feel.

    // Recoil recovery when not actively firing this frame.
    const firingNow = ctx.firing && ctx.canFire && !this.reloading && this.ammo > 0;
    if (!firingNow || !this.def.automatic) {
      const rec = this.def.recoilRecover;
      this.recoilPitch = damp(this.recoilPitch, 0, rec, dt);
      this.recoilYaw = damp(this.recoilYaw, 0, rec, dt);
    }
    // Reset burst index once the trigger has been off for a beat.
    if (!ctx.firing && this._timeSinceShot > 0.12) this._shotInBurst = 0;

    if (firingNow && this._fireCooldown <= 0) {
      this._fire(ctx);
      this._fireCooldown = this.secondsPerShot;
      if (!this.def.automatic) {
        // semi: require trigger release — handled by main edge-detect
      }
    }

    this._updateFX(dt);
  }

  _fire(ctx) {
    this.ammo--;
    this._timeSinceShot = 0;

    // --- spread cone based on stance/movement ---
    const s = this.def.spread;
    let cone = s.base + s.moving * clamp(ctx.speed01, 0, 1);
    if (ctx.ads) cone *= s.adsMul;
    if (ctx.crouch01 > 0.5) cone *= s.crouchMul;

    // Build the shot direction = camera forward + random cone offset.
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const trueUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, signedRand() * cone);
    dir.addScaledVector(trueUp, signedRand() * cone);
    dir.normalize();

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);

    // --- hitscan with penetration through soft walls ---
    // Walk all intersections front-to-back. Soft destructible panels get
    // punched into holes and the bullet continues at reduced damage; a
    // structural/hard surface or a hit target stops the ray.
    const candidates = [...this.world.solids, ...this.world.targets.map((t) => t.mesh)];
    const hits = castRayAll(origin, dir, candidates, 200);
    let mult = 1;
    let endPoint = origin.clone().addScaledVector(dir, 100);
    let penetrations = 0;
    const MAX_PEN = 3;

    for (const h of hits) {
      const obj = h.object;
      // Target?
      const target = this.world.targets.find(
        (t) => t.mesh === obj || obj.userData.targetRef === t
      );
      if (target && target.alive) {
        const isHead = h.point.y >= target.headY;
        const dmg = this._damageAt(h.distance, isHead) * mult;
        if (this.owner) target.lastAttacker = this.owner;
        const dead = target.applyDamage(dmg, isHead, this.owner);
        this.events.push({ type: 'hit', headshot: isHead, killed: dead, dmg, target });
        if (dead) this.events.push({ type: 'kill', target, headshot: isHead });
        endPoint = h.point.clone();
        break; // bullet stops in the body
      }

      // Destructible panel?
      const surf = obj.userData.destructible;
      if (surf) {
        if (surf.isHardened) {
          // Reinforced/hard wall: stop, spark, no penetration.
          this._spawnSpark(h.point, h.face ? h.face.normal : null);
          endPoint = h.point.clone();
          break;
        }
        // Soft: punch a small hole and keep going with falloff.
        surf.damageAt(h.point, 0.45);
        this._spawnSpark(h.point, h.face ? h.face.normal : null);
        mult *= 0.62; // penetration damage loss
        penetrations++;
        if (penetrations >= MAX_PEN || mult < 0.15) {
          endPoint = h.point.clone();
          break;
        }
        continue;
      }

      // Solid structural geometry: stop here.
      this._spawnSpark(h.point, h.face ? h.face.normal.clone().transformDirection(obj.matrixWorld) : null);
      endPoint = h.point.clone();
      break;
    }

    this._spawnTracer(origin, endPoint);

    // --- recoil kick (apply this shot's pattern entry) ---
    const pat = this.def.recoilPattern;
    const idx = clamp(this._shotInBurst, 0, pat.length - 1);
    const [kp, ky] = pat[idx];
    // ADS and crouch tame recoil a touch (mechanical compensation).
    const tame = (ctx.ads ? 0.78 : 1) * (ctx.crouch01 > 0.5 ? 0.9 : 1);
    this.recoilPitch += kp * tame;
    this.recoilYaw += (ky + signedRand() * 0.0015) * tame;
    this._shotInBurst++;

    // --- muzzle flash ---
    this.muzzleLight.position.copy(origin).addScaledVector(dir, 0.4);
    this.muzzleLight.intensity = 4;

    if (this.audio) this.audio.play('shot', origin);

    if (this.ammo <= 0) this.events.push({ type: 'dry' });
  }

  _damageAt(dist, isHead) {
    const d = this.def;
    let dmg = d.damage;
    if (dist > d.falloffStart) {
      const t = clamp(
        (dist - d.falloffStart) / (d.falloffEnd - d.falloffStart),
        0,
        1
      );
      dmg *= 1 - (1 - d.falloffFloor) * t;
    }
    if (isHead) dmg *= d.headshotMult;
    return dmg;
  }

  reload() {
    if (this.reloading) return;
    if (this.ammo >= this.def.magSize) return;
    if (this.reserve <= 0) return;
    this.reloading = true;
    this._reloadT = this.def.reloadTime;
    this.events.push({ type: 'reloadStart' });
    if (this.audio) this.audio.play('reload', this.camera.position);
  }

  _finishReload() {
    this.reloading = false;
    const need = this.def.magSize - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take;
    this.reserve -= take;
    this.events.push({ type: 'reloadEnd' });
  }

  _updateFX(dt) {
    // Muzzle light decay.
    if (this.muzzleLight.intensity > 0) {
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 60);
    }
    // Tracers fade + recycle.
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      t.life -= dt;
      t.m.material.opacity = clamp(t.life / 0.06, 0, 1) * 0.9;
      if (t.life <= 0) {
        t.m.visible = false;
        this._tracerPool.push(t.m);
        this._tracers.splice(i, 1);
      }
    }
    // Sparks shrink + recycle.
    for (let i = this._sparks.length - 1; i >= 0; i--) {
      const sp = this._sparks[i];
      sp.life -= dt;
      sp.m.scale.setScalar(clamp(sp.life / 0.12, 0, 1));
      if (sp.life <= 0) {
        sp.m.visible = false;
        this._sparkPool.push(sp.m);
        this._sparks.splice(i, 1);
      }
    }
  }

  /** Current spread half-angle, for the dynamic crosshair. */
  getSpread(ctx) {
    const s = this.def.spread;
    let cone = s.base + s.moving * clamp(ctx.speed01, 0, 1);
    if (ctx.ads) cone *= s.adsMul;
    if (ctx.crouch01 > 0.5) cone *= s.crouchMul;
    return cone;
  }

  getRecoil() {
    return { pitch: this.recoilPitch, yaw: this.recoilYaw };
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
