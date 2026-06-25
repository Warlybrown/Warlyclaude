// main.js — entry point & boot sequence for WARL 5 SIEGE (codename BREACHPOINT).
//
// PHASE 1 (core FPS feel):
//   * First-person movement (accel/friction, crouch, lean, sprint, ADS).
//   * Hitscan weapon with learnable recoil, spread, reload, FX.
//   * A practice arena (floor, cover, walls) + dummy targets to shoot.
//   * Minimal HUD (dynamic crosshair, ammo, hit markers, stance/lean).
//
// Later phases hang the game-state machine, real map, destruction, operators,
// and bots off the `game` object created here. Everything original — no IP.

import * as THREE from 'three';
import { Input } from './core/Input.js';
import { Loop } from './core/Loop.js';
import { PlayerController } from './player/PlayerController.js';
import { FirstPersonCamera } from './player/FirstPersonCamera.js';
import { Weapon, WEAPON_DEFS } from './player/Weapon.js';
import { Target } from './entities/Target.js';
import { HUD } from './ui/HUD.js';
import { MapLoader } from './world/MapLoader.js';
import { explodeAt } from './world/Destruction.js';
import housesite, { FLOOR_H } from './world/mapDefs/housesite.js';

const VERSION = '0.3.0 · phase 2';

function boot() {
  const app = document.getElementById('app');
  const ui = document.getElementById('ui');
  const statusEl = document.getElementById('status');
  const lockPrompt = document.getElementById('lock-prompt');

  // --- renderer -------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.id = 'game-canvas';
  app.insertBefore(canvas, ui);

  // --- scene / camera -------------------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 500);

  // --- world: load the SAFEHOUSE map ----------------------------------------
  // MapLoader returns the shared world contract (solids, colliders,
  // destructibles, sites, spawns, reinforce). We add `targets` for Phase-2
  // weapon/destruction testing; Phase 5 replaces these with real bots.
  const mapLoader = new MapLoader(scene);
  const world = mapLoader.load(housesite);
  world.targets = [];

  // A few practice dummies inside the building to test shoot-through-walls.
  const dummySpawns = [
    new THREE.Vector3(-8, 0, 0),   // in STORAGE (ground site)
    new THREE.Vector3(-8, 0, -2),
    new THREE.Vector3(4, FLOOR_H, 8), // in OFFICE (upper site)
    new THREE.Vector3(0, 0, -6),
    new THREE.Vector3(6, 0, 4),
  ];
  for (const sp of dummySpawns) world.targets.push(new Target(scene, sp));

  // --- input / player / camera / weapon -------------------------------------
  const input = new Input(canvas);
  const player = new PlayerController(input, world);
  // Spawn the player at an attacker exterior spawn, facing the building (-Z).
  const spawn = world.spawns.attackers[2];
  player.position.set(spawn.x, spawn.y, spawn.z);
  player.yaw = Math.PI;
  const fpCam = new FirstPersonCamera(camera, { fov: 80, adsFov: 55 });
  const weapon = new Weapon(WEAPON_DEFS.AR, scene, camera, world);
  const hud = new HUD(ui);

  lockPrompt.addEventListener('click', () => input.requestLock());
  input.onLockChange((locked) => lockPrompt.classList.toggle('hidden', locked));

  // Reload (R). Phase-2 test keys: F = breach charge ahead, V = reinforce wall.
  let prevFire = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') weapon.reload();
    if (e.code === 'KeyF') {
      // Throw a "breach" explosion ~2m in front of the eye.
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const at = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 2);
      const n = explodeAt(world, at, 1.6);
      console.log(`[breach] removed ${n} panels`);
    }
    if (e.code === 'KeyV') {
      const ok = world.reinforce.reinforceNearest(player.position, 4);
      console.log(`[reinforce] ${ok ? 'reinforced wall' : 'no wall in range'} · ${world.reinforce.remaining} left`);
    }
  });

  // --- resize ---------------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- sim + render ---------------------------------------------------------
  let elapsed = 0;
  let fps = 0, frames = 0, fpsAccum = 0, lastFpsTime = performance.now();

  function update(dt) {
    elapsed += dt;
    player.update(dt);
    for (const t of world.targets) t.update(dt);

    // First apply the player's pose to the camera so the weapon's hitscan uses
    // an up-to-date camera orientation (minus recoil, which we add as offset).
    const camState = player.getCameraState();
    // Inject the weapon recoil into the camera state for the visual layer.
    const recoil = weapon.getRecoil();
    camState.recoilPitch = recoil.pitch;
    camState.recoilYaw = recoil.yaw;
    fpCam.update(camState, dt);

    // Build firing context. Automatic weapon fires while LMB held + allowed.
    const def = weapon.def;
    const firing = input.mouse.left && player.canFire;
    const ctx = {
      firing: def.automatic ? firing : firing && !prevFire, // semi: rising edge
      ads: player.ads,
      moving: player.moving,
      speed01: player.speed01,
      crouch01: player.crouch01,
      canFire: player.canFire,
    };
    prevFire = input.mouse.left;
    weapon.update(dt, ctx);

    // Drain weapon events into the HUD.
    for (const ev of weapon.drainEvents()) hud.onWeaponEvent(ev);

    // HUD readout.
    hud.update(
      {
        spread: weapon.getSpread(ctx),
        ammo: weapon.ammo,
        reserve: weapon.reserve,
        reloading: weapon.reloading,
        weaponName: def.name,
        crouch01: player.crouch01,
        lean: player.leanTarget,
        leanAllowed: player.leanAllowed,
        ads: player.ads,
        sprinting: player.sprinting,
      },
      dt
    );
  }

  function render() {
    renderer.render(scene, camera);
  }

  const loop = new Loop(update, render, 60);
  loop.start();

  // Status + FPS.
  setInterval(() => {
    statusEl.textContent =
      `WARL 5 SIEGE · ${VERSION}\n` +
      `${input.locked ? 'LOCKED' : 'click to lock'} · ${fps} fps`;
  }, 250);
  function sampleFps() {
    frames++;
    const now = performance.now();
    fpsAccum += now - lastFpsTime; lastFpsTime = now;
    if (fpsAccum >= 500) { fps = Math.round((frames * 1000) / fpsAccum); frames = 0; fpsAccum = 0; }
    requestAnimationFrame(sampleFps);
  }
  requestAnimationFrame(sampleFps);

  const game = { THREE, renderer, scene, camera, input, loop, player, weapon, world, hud };
  window.__BREACHPOINT__ = game;
  statusEl.textContent = `WARL 5 SIEGE · ${VERSION}\nready · click to lock`;
  console.log('[BREACHPOINT] phase 1 boot complete', VERSION);
  return game;
}

boot();
