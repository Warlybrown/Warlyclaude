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

const VERSION = '0.2.0 · phase 1';

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
  scene.background = new THREE.Color(0x0b1a12);
  scene.fog = new THREE.FogExp2(0x0b1a12, 0.012);

  const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 500);

  // --- lighting -------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x90ffb0, 0x0a140d, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(8, 14, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -30; key.shadow.camera.right = 30;
  key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
  scene.add(key);

  // --- world: practice arena ------------------------------------------------
  // `solids` are raycast-able meshes (walls/cover); `colliders` are AABBs for
  // movement; `targets` are damageable dummies. Later phases swap this for the
  // real map + destruction system but keep the same world contract.
  const world = { solids: [], colliders: [], targets: [] };

  const matFloor = new THREE.MeshStandardMaterial({ color: 0x12241a, roughness: 1 });
  const matWall = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.9 });
  const matCover = new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.8 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), matFloor);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(60, 60, 0x2e9bff, 0x143322);
  grid.material.transparent = true; grid.material.opacity = 0.25;
  scene.add(grid);

  /** Add a box that is both a visual solid and a movement collider. */
  function addBox(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    world.solids.push(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    world.colliders.push(box);
    return mesh;
  }

  // Perimeter walls.
  const HW = 25;
  addBox(2, 4, HW * 2, -HW, 2, 0, matWall);
  addBox(2, 4, HW * 2, HW, 2, 0, matWall);
  addBox(HW * 2, 4, 2, 0, 2, -HW, matWall);
  addBox(HW * 2, 4, 2, 0, 2, HW, matWall);

  // Cover blocks to test lean/crouch peeking.
  addBox(3, 1.1, 1, -6, 0.55, -4, matCover);
  addBox(1, 1.7, 4, 4, 0.85, -6, matCover);
  addBox(2.5, 2.4, 0.5, 0, 1.2, -12, matCover); // tall wall to lean around
  addBox(1, 1.1, 3, -10, 0.55, -10, matCover);
  addBox(6, 0.6, 1, 8, 0.3, -2, matCover); // low cover (crouch behind)

  // Dummy targets at varied ranges/heights.
  const targetSpawns = [
    new THREE.Vector3(0, 0, -16),
    new THREE.Vector3(-6, 0, -14),
    new THREE.Vector3(6, 0, -18),
    new THREE.Vector3(-12, 0, -8),
    new THREE.Vector3(10, 0, -12),
    new THREE.Vector3(0, 0, -22),
  ];
  for (const sp of targetSpawns) world.targets.push(new Target(scene, sp));

  // --- input / player / camera / weapon -------------------------------------
  const input = new Input(canvas);
  const player = new PlayerController(input, world);
  const fpCam = new FirstPersonCamera(camera, { fov: 80, adsFov: 55 });
  const weapon = new Weapon(WEAPON_DEFS.AR, scene, camera, world);
  const hud = new HUD(ui);

  lockPrompt.addEventListener('click', () => input.requestLock());
  input.onLockChange((locked) => lockPrompt.classList.toggle('hidden', locked));

  // Reload (R) and semi-auto edge detect handled here.
  let prevFire = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') weapon.reload();
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
