// main.js — entry point & game orchestrator for WARL 5 SIEGE (BREACHPOINT).
//
// PHASE 3 (round structure & objective): drives the full match→round→phase
// machine, the bomb-defusal objective (plant/defuse), the prep/drone phase,
// per-side enemy setup, win-condition evaluation, and spectator-on-death.
//
// Bots are stubbed here (static dummy "enemies" + a scripted attacker plant) and
// replaced by real AI in Phase 5. Everything original — no third-party IP.

import * as THREE from 'three';
import { Input } from './core/Input.js';
import { Loop } from './core/Loop.js';
import { GameState, Phase, Team } from './core/GameState.js';
import { PlayerController } from './player/PlayerController.js';
import { FirstPersonCamera } from './player/FirstPersonCamera.js';
import { Weapon, WEAPON_DEFS } from './player/Weapon.js';
import { Target } from './entities/Target.js';
import { Bomb, BombState } from './entities/Bomb.js';
import { Drone } from './entities/Drone.js';
import { HUD } from './ui/HUD.js';
import { MapLoader } from './world/MapLoader.js';
import housesite, { FLOOR_H } from './world/mapDefs/housesite.js';
import { OPERATORS, operatorsBySide, Side } from './operators/operators.js';
import { Loadout } from './player/Loadout.js';
import { makeGadget } from './operators/gadgets/index.js';

const VERSION = '0.5.0 · phase 4';

function boot() {
  const app = document.getElementById('app');
  const ui = document.getElementById('ui');
  const statusEl = document.getElementById('status');
  const lockPrompt = document.getElementById('lock-prompt');

  // --- renderer / scene / camera --------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.id = 'game-canvas';
  app.insertBefore(canvas, ui);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 500);
  const droneCamera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.03, 300);

  // --- world ----------------------------------------------------------------
  const mapLoader = new MapLoader(scene);
  const world = mapLoader.load(housesite);
  world.targets = []; // damageable enemies (stub bots for now)

  // --- core objects ---------------------------------------------------------
  const input = new Input(canvas);
  const player = new PlayerController(input, world);
  const fpCam = new FirstPersonCamera(camera, { fov: 80, adsFov: 55 });
  const weapon = new Weapon(WEAPON_DEFS.AR, scene, camera, world);
  const hud = new HUD(ui);
  const bomb = new Bomb(scene);
  const drone = new Drone(scene, world, droneCamera);
  const gs = new GameState({ roundsToWin: 4, maxRounds: 7, humanStartSide: Team.ATTACK });

  lockPrompt.addEventListener('click', () => { input.requestLock(); if (gs.phase === Phase.MENU) gs.startMatch(); });
  input.onLockChange((locked) => lockPrompt.classList.toggle('hidden', locked));

  // --- per-round mutable state ----------------------------------------------
  const round = {
    enemies: [],          // Target[] (opposing team)
    chosenSite: null,     // site the attackers will hit (AI) / planted at
    activeCamera: camera, // camera currently rendered
    spectating: false,
    plantHold: 0,         // human plant/defuse channel accumulator
    aiPlantStarted: false,
    operator: null,       // human operator this round
    loadout: null,        // Loadout (weapon tuning + utility)
    gadget: null,         // signature gadget instance
    spotted: new Map(),   // entity -> expiry timestamp (ms) for HUD reveal
  };

  // Shared context handed to gadgets (uniform API). onEvent routes gameplay
  // events (spotting, flash, breach) back into the orchestrator/HUD.
  const gadgetCtx = {
    scene, world, player, drone, audio: null,
    onEvent: (ev) => handleGadgetEvent(ev),
  };

  function markSpotted(entity, durationSec) {
    round.spotted.set(entity, performance.now() + durationSec * 1000);
  }

  function handleGadgetEvent(ev) {
    if (!ev) return;
    switch (ev.type) {
      case 'spot': markSpotted(ev.entity, ev.duration || 3); break;
      case 'flashed':
        if (ev.target === 'player') hud.flashBlind(ev.strength);
        break;
      case 'breach':
        hud.showBanner(ev.hard ? 'HARD BREACH' : 'WALL BREACHED',
          `${ev.panels} panels cleared`, 'atk', 1.2);
        break;
      case 'gadget':
        if (ev.text) hud.showBanner('GADGET', ev.text, null, 1.2);
        break;
      default: break;
    }
  }

  // --- input edges ----------------------------------------------------------
  let prevFire = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') weapon.reload();
    // Ready-up: skip remaining prep/select time.
    if (e.code === 'Enter' || e.code === 'Space') {
      if (gs.phase === Phase.OPERATOR_SELECT || gs.phase === Phase.PREP) gs.skipPhase();
    }
    // Drone spot (during prep, attacker).
    if (e.code === 'KeyT' && drone.active) {
      // spotting is automatic; T re-pings (no-op visual handled by HUD).
    }
    // Use signature gadget (F). Allowed in PREP (placement) and ACTION.
    if (e.code === 'KeyF' && round.gadget && (gs.phase === Phase.ACTION || gs.phase === Phase.PREP)) {
      if (round.spectating || !player.alive) return;
      const origin = player.getEyePosition();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      // Aim point on the nearest solid (for placement gadgets).
      const point = origin.clone().addScaledVector(dir, 2.5);
      const ok = round.gadget.use({ origin, dir, point, player });
      if (ok === false) hud.showBanner('GADGET', 'Cannot use here', null, 1.0);
    }
  });

  window.addEventListener('resize', () => {
    for (const c of [camera, droneCamera]) {
      c.aspect = window.innerWidth / window.innerHeight;
      c.updateProjectionMatrix();
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- helpers --------------------------------------------------------------
  function clearEnemies() {
    for (const e of round.enemies) scene.remove(e.mesh);
    round.enemies = [];
    world.targets = [];
  }

  function spawnEnemies(side) {
    clearEnemies();
    // side = the AI's side this round.
    const spawns = side === Team.DEFEND ? world.spawns.defenders : world.spawns.attackers;
    for (const sp of spawns) {
      const t = new Target(scene, sp);
      round.enemies.push(t);
      world.targets.push(t);
    }
  }

  function aliveEnemies() { return round.enemies.filter((e) => e.alive); }

  function setupRound() {
    // Reset reinforcement budget by reloading walls? For now keep budget; new
    // round reinforces are fresh because Phase 5 rebuilds the map. Reset count.
    world.reinforce.used = 0;
    // Reset destructible walls would need a rebuild; acceptable for prototype.

    bomb.reset();
    round.plantHold = 0;
    round.aiPlantStarted = false;
    round.spectating = false;

    // Choose the site attackers will hit (AI picks; if human attacks, they pick
    // by walking to one — we still pre-pick for AI-defense intel).
    round.chosenSite = world.sites[Math.floor(gs.round) % world.sites.length];

    // Place the human at their side's spawn.
    const humanSide = gs.humanSide;
    const humanSpawns = humanSide === Team.ATTACK ? world.spawns.attackers : world.spawns.defenders;
    const hs = humanSpawns[2] || humanSpawns[0];
    player.reset(hs, humanSide === Team.ATTACK ? Math.PI : 0);
    player.shieldSpeedMul = 1;

    // Spawn the AI team.
    spawnEnemies(gs.aiSide);

    // --- operator + loadout + signature gadget ---
    // Default pick: first operator of the human's side (full select UI = Phase 6).
    const sideKey = humanSide === Team.ATTACK ? Side.ATTACK : Side.DEFEND;
    const roster = operatorsBySide(sideKey);
    round.operator = round.pickedFor === sideKey && round.operator?.side === sideKey
      ? round.operator
      : roster[0];
    round.loadout = new Loadout(round.operator);
    round.loadout.resetUtility();

    // Tune the primary weapon from the operator + attachments and apply it.
    const baseDef = WEAPON_DEFS[round.operator.primary] || WEAPON_DEFS.AR;
    weapon.def = round.loadout.tuneWeapon(baseDef);
    weapon.ammo = weapon.def.magSize;
    weapon.reserve = weapon.def.reserve;
    weapon.reloading = false;
    fpCam.adsFov = 55 * (weapon.def._adsFovMul || 1);

    // Build the signature gadget.
    if (round.gadget) round.gadget.cleanup();
    round.gadget = makeGadget(round.operator.gadget, gadgetCtx);
    round.gadget?.equip();
    round.spotted.clear();

    // HUD teams (human side shows 1 real + 4 placeholder allies until Phase 5).
    hud.setTeams(5, round.enemies.length, humanSide, gs.aiSide);
  }

  // --- phase transitions ----------------------------------------------------
  gs.onPhaseChange((phase, prev) => {
    hud.hideBanner();
    if (phase === Phase.OPERATOR_SELECT) {
      setupRound();
      round.activeCamera = camera;
      drone.destroy();
      hud.setCombatVisible(false);
      hud.showBanner(`ROUND ${gs.round}`, `${gs.humanSide} · SELECT OPERATOR · [ENTER] ready`,
        gs.humanSide === Team.ATTACK ? 'atk' : 'def', 0);
    }
    if (phase === Phase.PREP) {
      hud.hideBanner();
      if (gs.humanSide === Team.ATTACK) {
        // Attacker drives the recon drone.
        drone.deploy(new THREE.Vector3(0, 0.22, 22), Math.PI);
        drone.setActive(true);
        round.activeCamera = droneCamera;
        hud.setCombatVisible(false);
      } else {
        // Defender sets up: reinforce walls (V), place on foot.
        round.activeCamera = camera;
        hud.setCombatVisible(true);
        // AI attackers (if any) idle outside during prep.
      }
      // AI defense auto-reinforces a couple of walls near the chosen site.
      if (gs.aiSide === Team.DEFEND) {
        world.reinforce.reinforceNearest(round.chosenSite.pos, 6);
        world.reinforce.reinforceNearest(new THREE.Vector3(round.chosenSite.pos.x + 4, round.chosenSite.pos.y, round.chosenSite.pos.z), 6);
      }
    }
    if (phase === Phase.ACTION) {
      drone.setActive(false);
      round.activeCamera = camera;
      hud.setCombatVisible(true);
      hud.showBanner('ACTION', gs.humanSide === Team.ATTACK ? 'BREACH & PLANT' : 'HOLD THE SITE',
        gs.humanSide === Team.ATTACK ? 'atk' : 'def', 1.6);
    }
    if (phase === Phase.ROUND_END) {
      const r = gs.lastRound;
      const won = r.winner === 'human';
      hud.setCombatVisible(false);
      hud.showBanner(
        won ? 'ROUND WON' : 'ROUND LOST',
        `${r.side} — ${r.reason}`,
        r.side === Team.ATTACK ? 'atk' : 'def', 0
      );
    }
    if (phase === Phase.MATCH_END) {
      const won = gs.matchWinner === 'human';
      hud.setCombatVisible(false);
      hud.showBanner(won ? 'VICTORY' : 'DEFEAT',
        `FINAL ${gs.score.human} — ${gs.score.ai}`, won ? 'atk' : 'def', 0);
    }
  });

  // --- action-phase logic ---------------------------------------------------
  function updateAction(dt) {
    const humanAttack = gs.humanSide === Team.ATTACK;

    // Bomb timers.
    bomb.update(dt);
    for (const ev of bomb.drainEvents()) {
      if (ev.type === 'planted') hud.showBanner('DEFUSER PLANTED', round.chosenSite?.name || '', 'atk', 2);
      if (ev.type === 'detonated') gs.endRound(humanAttack ? 'human' : 'ai', 'Defuser detonated');
      if (ev.type === 'disabled') gs.endRound(humanAttack ? 'ai' : 'human', 'Defuser disabled');
    }

    // --- human channeling (plant if attacker, disable if defender) ---
    const interacting = input.isDown('KeyG');
    if (humanAttack && !bomb.planted && bomb.state !== BombState.DETONATED) {
      // Plant if standing in a site radius.
      const site = world.sites.find((s) => player.position.distanceTo(s.pos) < s.radius &&
        Math.abs(player.position.y - s.pos.y) < 1.5);
      if (site && interacting && player.alive) {
        round.chosenSite = site;
        bomb.tickPlant(dt, site);
        hud.setChannel('PLANTING DEFUSER', bomb.plantProgress, 'atk');
      } else {
        bomb.cancelPlant();
        hud.setChannel('', null);
      }
    } else if (!humanAttack && bomb.planted) {
      const near = player.position.distanceTo(bomb.mesh.position) < 2.2;
      if (near && interacting && player.alive) {
        bomb.tickDisable(dt);
        hud.setChannel('DISABLING DEFUSER', bomb.disableProgress, 'def');
      } else {
        bomb.cancelDisable();
        hud.setChannel('', null);
      }
    } else {
      hud.setChannel('', null);
    }

    // --- stub AI: when the AI is ATTACKING, script a plant so defense resolves.
    if (gs.aiSide === Team.ATTACK && !bomb.planted && bomb.state !== BombState.DETONATED) {
      const planter = aliveEnemies()[0];
      if (planter) {
        // Walk the planter toward the chosen site, then channel.
        const sp = round.chosenSite.pos;
        const here = planter.spawn;
        const d = Math.hypot(sp.x - here.x, sp.z - here.z);
        if (d > 1.2) {
          // crude approach: nudge the spawn toward the site each tick
          here.x += Math.sign(sp.x - here.x) * Math.min(2 * dt, Math.abs(sp.x - here.x));
          here.z += Math.sign(sp.z - here.z) * Math.min(2 * dt, Math.abs(sp.z - here.z));
          here.y = sp.y;
          planter._place();
        } else {
          bomb.tickPlant(dt, round.chosenSite);
        }
      }
    }

    // --- win conditions by elimination ---
    if (aliveEnemies().length === 0) {
      gs.endRound('human', `${gs.aiSide === Team.DEFEND ? 'Defenders' : 'Attackers'} eliminated`);
    }
    if (!player.alive && !round.spectating) {
      // Phase 5 will spectate teammates; for now the round continues and the
      // human spectates. With no allies yet, human death + (attack side) means
      // the attack stalls → time will decide. Enter spectator cam.
      enterSpectator();
    }
  }

  // --- spectator ------------------------------------------------------------
  let specAngle = 0;
  function enterSpectator() {
    round.spectating = true;
    hud.setCombatVisible(false);
    hud.showBanner('DOWNED', 'SPECTATING · round continues', null, 2.2);
  }
  function updateSpectator(dt) {
    specAngle += dt * 0.2;
    const site = round.chosenSite || world.sites[0];
    const r = 10;
    camera.position.set(
      site.pos.x + Math.cos(specAngle) * r,
      site.pos.y + 6,
      site.pos.z + Math.sin(specAngle) * r
    );
    camera.lookAt(site.pos);
  }

  // --- spotting: reveal tagged enemies (drone, recon, cameras) --------------
  function applySpotting() {
    const now = performance.now();
    // Fold drone spots into the shared map.
    if (drone.alive) {
      for (const s of drone.spotted) markSpotted(s.entity, 0.4);
    }
    for (const e of round.enemies) {
      const exp = round.spotted.get(e);
      const lit = exp && exp > now && e.alive;
      // Highlight by emissive tint (a stand-in for screen-space markers; the
      // full HUD ping system arrives in Phase 6).
      if (e.bodyMat) {
        if (lit) e.bodyMat.emissive.setHex(0x2e9bff);
        else if (e._flash <= 0) e.bodyMat.emissive.setHex(0x000000);
      }
      if (exp && exp <= now) round.spotted.delete(e);
    }
  }

  // --- main loop ------------------------------------------------------------
  let fps = 0, frames = 0, fpsAccum = 0, lastFpsTime = performance.now();

  function update(dt) {
    gs.update(dt);

    // Enemy dummies tick (respawn disabled during a live round).
    for (const e of round.enemies) {
      e._respawnT = 999; // keep dead enemies down (no respawn in a round)
      e.update(dt);
    }

    // Signature gadget effects progress every frame (fuses, areas, spotting).
    if (round.gadget) round.gadget.tick(dt);
    applySpotting();

    if (gs.phase === Phase.PREP && drone.active && input.locked) {
      // Drive the drone.
      const look = input.consumeLookDelta();
      const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      const s = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
      drone.update(dt, { forward: f, strafe: s, lookX: look.x * 0.06 }, round.enemies);
    } else if (round.spectating && gs.phase === Phase.ACTION) {
      updateSpectator(dt);
    } else {
      // Player FPS update.
      if (gs.phase === Phase.ACTION || gs.phase === Phase.PREP) {
        player.update(dt);
      } else {
        input.consumeLookDelta();
      }
      const camState = player.getCameraState();
      const recoil = weapon.getRecoil();
      camState.recoilPitch = recoil.pitch;
      camState.recoilYaw = recoil.yaw;
      fpCam.update(camState, dt);

      // Firing (only in action, only if alive, not flash-blinded).
      const canShoot = gs.phase === Phase.ACTION && player.alive && !round.spectating && !hud.isBlinded;
      const def = weapon.def;
      const firing = input.mouse.left && player.canFire && canShoot;
      const ctx = {
        firing: def.automatic ? firing : firing && !prevFire,
        ads: player.ads, moving: player.moving, speed01: player.speed01,
        crouch01: player.crouch01, canFire: player.canFire && canShoot,
      };
      prevFire = input.mouse.left;
      weapon.update(dt, ctx);
      for (const ev of weapon.drainEvents()) hud.onWeaponEvent(ev);

      // Defender reinforce on V (prep).
    }

    // Per-phase logic.
    if (gs.phase === Phase.ACTION) updateAction(dt);

    // HUD.
    updateHud(dt);
  }

  // Reinforce key (defender prep).
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && gs.phase === Phase.PREP && gs.humanSide === Team.DEFEND) {
      const ok = world.reinforce.reinforceNearest(player.position, 3.5);
      if (ok) hud.showBanner('REINFORCED', `${world.reinforce.remaining} charges left`, 'def', 1.2);
    }
  });

  function updateHud(dt) {
    // Objective bar.
    let phaseLabel = gs.phase;
    let objective = '';
    let timer = gs.timeRemaining;
    let plantMode = false;

    if (gs.phase === Phase.OPERATOR_SELECT) { phaseLabel = 'OPERATOR SELECT'; objective = 'CHOOSE LOADOUT · [ENTER] READY'; }
    else if (gs.phase === Phase.PREP) {
      phaseLabel = 'PREP';
      objective = gs.humanSide === Team.ATTACK
        ? 'DRONE: scout & spot · [WASD] drive'
        : 'REINFORCE: [V] near a wall';
    } else if (gs.phase === Phase.ACTION) {
      phaseLabel = 'ACTION';
      if (bomb.planted) {
        timer = bomb.timeLeft; plantMode = true;
        objective = gs.humanSide === Team.ATTACK
          ? '<b class="atk">PROTECT THE DEFUSER</b>'
          : '<b class="def">DISABLE — hold [G] on device</b>';
      } else {
        objective = gs.humanSide === Team.ATTACK
          ? '<b class="atk">PLANT</b> — hold [G] in a site'
          : '<b class="def">DEFEND</b> both sites';
      }
    } else if (gs.phase === Phase.ROUND_END) { phaseLabel = 'ROUND OVER'; }

    hud.setObjective({
      phaseLabel, timer, objective, plantMode,
      round: gs.round, scoreH: gs.score.human, scoreA: gs.score.ai,
    });

    // Alive pips (human side: only the human is real for now).
    const humanAlive = [player.alive, true, true, true, true];
    const aiAlive = round.enemies.map((e) => e.alive);
    hud.setAlive(humanAlive, aiAlive);

    // Signature gadget readout.
    if (round.gadget) {
      hud.setGadget(round.gadget.name, round.gadget.charges, round.gadget.ready);
    }

    // Combat HUD readout.
    const ctx = { ads: player.ads, speed01: player.speed01, crouch01: player.crouch01 };
    hud.update({
      spread: weapon.getSpread(ctx),
      ammo: weapon.ammo, reserve: weapon.reserve, reloading: weapon.reloading,
      weaponName: weapon.def.name, crouch01: player.crouch01,
      lean: player.leanTarget, leanAllowed: player.leanAllowed,
      ads: player.ads, sprinting: player.sprinting,
    }, dt);
  }

  function render() {
    renderer.render(scene, round.activeCamera);
  }

  const loop = new Loop(update, render, 60);
  loop.start();

  // Status / FPS.
  setInterval(() => {
    statusEl.textContent = `WARL 5 SIEGE · ${VERSION}\n${input.locked ? 'LOCKED' : 'click to lock'} · ${fps} fps · ${gs.phase}`;
  }, 250);
  function sampleFps() {
    frames++; const now = performance.now(); fpsAccum += now - lastFpsTime; lastFpsTime = now;
    if (fpsAccum >= 500) { fps = Math.round((frames * 1000) / fpsAccum); frames = 0; fpsAccum = 0; }
    requestAnimationFrame(sampleFps);
  }
  requestAnimationFrame(sampleFps);

  const game = { THREE, renderer, scene, camera, input, loop, player, weapon, world, hud, gs, bomb, drone, round, FLOOR_H };
  window.__BREACHPOINT__ = game;
  statusEl.textContent = `WARL 5 SIEGE · ${VERSION}\nready · click to start`;
  console.log('[BREACHPOINT] phase 3 boot complete', VERSION);
  return game;
}

boot();
