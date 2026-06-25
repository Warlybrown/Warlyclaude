// main.js — entry point & boot sequence for WARL 5 SIEGE (codename BREACHPOINT).
//
// PHASE 0 (project setup) scope:
//   * Spin up a full-window Three.js renderer + a green-tinted empty scene.
//   * Mount the DOM UI overlay on top of the canvas.
//   * Engage pointer lock on click; show/hide the lock prompt accordingly.
//   * Run the fixed-timestep loop (rendering only for now).
//
// Later phases hang the game-state machine, player, world, and entities off the
// `game` object created here. Everything original — no third-party IP.

import * as THREE from 'three';
import { Input } from './core/Input.js';
import { Loop } from './core/Loop.js';

const VERSION = '0.1.0 · phase 0';

function boot() {
  const app = document.getElementById('app');
  const ui = document.getElementById('ui');
  const statusEl = document.getElementById('status');
  const lockPrompt = document.getElementById('lock-prompt');

  // --- renderer -------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.id = 'game-canvas';
  // Canvas sits beneath the #ui overlay (which is z-index 10).
  app.insertBefore(canvas, ui);

  // --- scene ----------------------------------------------------------------
  const scene = new THREE.Scene();
  // Green-tinted backdrop + fog, per the phase-0 acceptance target.
  scene.background = new THREE.Color(0x0b1a12);
  scene.fog = new THREE.FogExp2(0x0b1a12, 0.012);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.05,
    1000
  );
  camera.position.set(0, 1.7, 6); // ~eye height, looking toward origin
  camera.lookAt(0, 1, 0);

  // --- minimal lighting + reference geometry --------------------------------
  // A ground grid + a slowly spinning marker so we can SEE that the render loop
  // is alive and the scene is truly rendering (an "empty" scene would look dead).
  const hemi = new THREE.HemisphereLight(0x88ffaa, 0x0a140d, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(5, 10, 7);
  key.castShadow = true;
  scene.add(key);

  const grid = new THREE.GridHelper(80, 80, 0x2e9bff, 0x12361f);
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x0e2417, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2e9bff, roughness: 0.4, metalness: 0.1 })
  );
  marker.position.set(0, 1, 0);
  marker.castShadow = true;
  scene.add(marker);

  // --- input / pointer lock -------------------------------------------------
  const input = new Input(canvas);

  // Yaw/pitch driven by mouse while locked — proves look works in phase 0.
  const look = { yaw: 0, pitch: 0 };
  const SENS = 0.0022;
  const PITCH_LIMIT = Math.PI / 2 - 0.05;

  lockPrompt.addEventListener('click', () => input.requestLock());
  input.onLockChange((locked) => {
    lockPrompt.classList.toggle('hidden', locked);
  });

  // --- resize ---------------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- simulation + render --------------------------------------------------
  let elapsed = 0;
  let frames = 0;
  let fpsAccum = 0;
  let fps = 0;

  function update(dt) {
    elapsed += dt;
    marker.rotation.y += dt * 0.8;
    marker.rotation.x += dt * 0.3;

    // Apply mouse look (free-look camera placeholder until PlayerController).
    if (input.locked) {
      const d = input.consumeLookDelta();
      look.yaw -= d.x * SENS;
      look.pitch -= d.y * SENS;
      look.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch));
      const euler = new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  const loop = new Loop(update, render, 60);
  loop.start();

  // Lightweight FPS / status readout so phase-0 boot is observable.
  setInterval(() => {
    statusEl.textContent =
      `WARL 5 SIEGE · ${VERSION}\n` +
      `${input.locked ? 'POINTER LOCKED' : 'click to lock'} · ${fps} fps · t=${elapsed.toFixed(0)}s`;
  }, 250);

  // FPS sampling via rAF (independent of the sim loop).
  let lastFpsTime = performance.now();
  function sampleFps() {
    frames++;
    const now = performance.now();
    fpsAccum += now - lastFpsTime;
    lastFpsTime = now;
    if (fpsAccum >= 500) {
      fps = Math.round((frames * 1000) / fpsAccum);
      frames = 0;
      fpsAccum = 0;
    }
    requestAnimationFrame(sampleFps);
  }
  requestAnimationFrame(sampleFps);

  // Expose for debugging / later phases.
  const game = { THREE, renderer, scene, camera, input, loop };
  window.__BREACHPOINT__ = game;

  statusEl.textContent = `WARL 5 SIEGE · ${VERSION}\nready · click to lock`;
  console.log('[BREACHPOINT] boot complete', VERSION);
  return game;
}

boot();
