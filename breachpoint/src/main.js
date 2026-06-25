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
import { Bomb, BombState } from './entities/Bomb.js';
import { Drone } from './entities/Drone.js';
import { HUD } from './ui/HUD.js';
import { OperatorSelect } from './ui/OperatorSelect.js';
import { KillFeed } from './ui/KillFeed.js';
import { Scoreboard } from './ui/Scoreboard.js';
import { DronePhaseUI } from './ui/DronePhaseUI.js';
import { MapLoader } from './world/MapLoader.js';
import housesite, { FLOOR_H } from './world/mapDefs/housesite.js';
import { OPERATORS, operatorsBySide, Side } from './operators/operators.js';
import { Loadout } from './player/Loadout.js';
import { makeGadget } from './operators/gadgets/index.js';
import { Navmesh } from './world/Navmesh.js';
import { Bot } from './entities/Bot.js';
import { BotBrain } from './entities/BotBrain.js';
import { AudioManager } from './core/Audio.js';
import { Menu } from './ui/Menu.js';

const VERSION = '0.6.0 · phase 5';

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
  world.targets = []; // damageable enemies (the enemy bot team)

  // Ensure every object's world matrix is current before the navmesh raycasts
  // against them (newly-added meshes like the ground plane otherwise have a
  // stale matrixWorld until the first render, and downward floor-rays miss them).
  scene.updateMatrixWorld(true);

  // Build the navigation graph from the loaded map (one-time).
  // Bounds cover the building AND the southern exterior approach so attacker
  // bots can path from their outdoor spawns through the doorways.
  const nav = new Navmesh(world, { spacing: 2.0, bounds: { minX: -15, maxX: 15, minZ: -15, maxZ: 25 } });

  // Player-facing settings (surfaced in the menu). Difficulty drives bot skill.
  const settings = { difficulty: 0.5, sensitivity: 1.0, fov: 80, volume: 0.6 };
  const audio = new AudioManager();

  // --- core objects ---------------------------------------------------------
  const input = new Input(canvas);
  const player = new PlayerController(input, world);
  const fpCam = new FirstPersonCamera(camera, { fov: 80, adsFov: 55 });
  const weapon = new Weapon(WEAPON_DEFS.AR, scene, camera, world, audio);
  const hud = new HUD(ui);
  const opSelect = new OperatorSelect(ui);
  const killFeed = new KillFeed(ui);
  const scoreboard = new Scoreboard(ui);
  const droneUI = new DronePhaseUI(ui);
  const bomb = new Bomb(scene);
  const drone = new Drone(scene, world, droneCamera);
  const gs = new GameState({ roundsToWin: 4, maxRounds: 7, humanStartSide: Team.ATTACK });

  // --- main menu + settings -------------------------------------------------
  const menu = new Menu(ui, settings);
  function applySettings() {
    player.sensitivity = 0.0022 * settings.sensitivity;
    fpCam.baseFov = settings.fov;
    audio.setVolume(settings.volume);
  }
  menu.onSettingsChange = applySettings;
  menu.onStart = () => {
    menu.hide();
    applySettings();
    audio.resume();
    gs.startMatch();
    input.requestLock();
    audio.play('roundStart');
  };
  // Hide the boot lock-prompt; the menu owns the entry flow now.
  lockPrompt.classList.add('hidden');
  // While a match is live, clicking the canvas re-acquires pointer lock; the
  // boot prompt doubles as a "click to resume" hint when unlocked mid-match.
  canvas.addEventListener('click', () => { if (gs.phase !== Phase.MENU && !menu.visible) input.requestLock(); });
  input.onLockChange((locked) => {
    if (gs.phase !== Phase.MENU && !menu.visible) lockPrompt.classList.toggle('hidden', locked);
  });
  // Esc opens settings (pointer unlocks automatically); Esc again / Back resumes.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && gs.phase !== Phase.MENU) {
      menu.show('settings', true);
    }
  });

  // Audio occlusion: muffle sounds heard through walls (low-pass).
  const _occRay = new THREE.Raycaster();
  audio.occlusionTest = (pos) => {
    const from = audio.listenerPos;
    const dir = new THREE.Vector3().subVectors(pos, from);
    const dist = dir.length();
    if (dist < 0.6) return false;
    dir.normalize();
    _occRay.set(from, dir);
    _occRay.far = dist - 0.4;
    return _occRay.intersectObjects(world.solids, true).length > 0;
  };

  // --- screen shake (explosions, breaches, taking damage) -------------------
  let shakeAmt = 0;
  const addShake = (a) => { shakeAmt = Math.min(1, shakeAmt + a); };

  // --- per-round mutable state ----------------------------------------------
  const round = {
    enemies: [],          // Bot[] (opposing team, shootable by player)
    allies: [],           // Bot[] (friendly team)
    chosenSite: null,     // site the attackers will hit (AI) / planted at
    activeCamera: camera, // camera currently rendered
    spectating: false,
    plantHold: 0,         // human plant/defuse channel accumulator
    aiPlantStarted: false,
    operator: null,       // human operator this round
    pickedOperator: null, // player's selected operator (from OperatorSelect)
    loadout: null,        // Loadout (weapon tuning + utility)
    gadget: null,         // signature gadget instance
    spotted: new Map(),   // entity -> expiry timestamp (ms) for HUD reveal
  };

  // Operator-select interactions: pick a card → re-equip live; ENTER readies up.
  opSelect.onPick = (op) => {
    round.pickedOperator = op;
    opSelect.setSelected(op);
    setupRound(); // re-apply operator/loadout/gadget immediately so the pick sticks
  };
  opSelect.onReady = () => gs.skipPhase();

  // Shared context handed to gadgets (uniform API). onEvent routes gameplay
  // events (spotting, flash, breach) back into the orchestrator/HUD.
  const gadgetCtx = {
    scene, world, player, drone, audio,
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
        addShake(ev.hard ? 0.6 : 0.3);
        break;
      case 'gadget':
        if (ev.text) hud.showBanner('GADGET', ev.text, null, 1.2);
        break;
      default: break;
    }
  }

  // --- input edges ----------------------------------------------------------
  let prevFire = false;
  let scoreboardVisible = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); scoreboardVisible = true; scoreboard.show(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') { scoreboardVisible = false; scoreboard.hide(); }
  });
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
  function clearBots() {
    for (const b of world.bots) scene.remove(b.mesh);
    world.bots = [];
    round.enemies = [];   // enemy bot team (shootable by player)
    round.allies = [];    // friendly bot team
    world.targets = [];
  }

  // Damage hook so bot hits on the player flash the HUD + can kill → spectate.
  const botHooks = {
    damagePlayer: (dmg, fromPos) => {
      player.lastHitFrom = fromPos;
      hud.flashDamage();
    },
  };

  /** Spawn both bot teams + attach brains. Player is the 5th on the human team. */
  function spawnTeams() {
    clearBots();
    world._player = player;
    const humanSide = gs.humanSide;
    const aiSide = gs.aiSide;

    const mkBot = (side, team, op, spawn) => {
      const bot = new Bot(scene, world, { side, team, operator: op, difficulty: settings.difficulty, hooks: botHooks });
      bot.spawnAt(spawn.clone ? spawn.clone() : new THREE.Vector3(spawn.x, spawn.y, spawn.z),
        side === Team.ATTACK ? Math.PI : 0);
      world.bots.push(bot);
      return bot;
    };

    // Enemy team (AI side): 5 bots.
    const aiOps = operatorsBySide(aiSide === Team.ATTACK ? Side.ATTACK : Side.DEFEND);
    const aiSpawns = aiSide === Team.ATTACK ? world.spawns.attackers : world.spawns.defenders;
    for (let i = 0; i < 5; i++) {
      const b = mkBot(aiSide, 'ai', aiOps[i % aiOps.length], aiSpawns[i % aiSpawns.length]);
      round.enemies.push(b);
      world.targets.push(b); // player can shoot the enemy team
    }

    // Ally team (human side): 4 bots (player is the 5th).
    const allyOps = operatorsBySide(humanSide === Team.ATTACK ? Side.ATTACK : Side.DEFEND);
    const allySpawns = humanSide === Team.ATTACK ? world.spawns.attackers : world.spawns.defenders;
    for (let i = 0; i < 4; i++) {
      const b = mkBot(humanSide, 'human', allyOps[(i + 1) % allyOps.length], allySpawns[(i + (i >= 2 ? 1 : 0)) % allySpawns.length]);
      round.allies.push(b);
    }

    // Attach brains with side-appropriate context.
    const attackingSide = Team.ATTACK; // whichever team is ATTACK targets the site
    // Both sides reference the objective site: attackers advance to it, defenders
    // anchor on it. (Defenders "committing" to the bomb site keeps rounds decisive.)
    for (const b of round.enemies) {
      b.brain = new BotBrain(b, {
        nav, world, bomb,
        getEnemies: () => [player, ...round.allies],
        getSite: () => round.chosenSite,
      });
    }
    for (const b of round.allies) {
      b.brain = new BotBrain(b, {
        nav, world, bomb,
        getEnemies: () => round.enemies,
        getSite: () => round.chosenSite,
      });
    }
  }

  function aliveEnemies() { return round.enemies.filter((e) => e.alive); }
  function aliveAllies() { return round.allies.filter((e) => e.alive); }

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
    round.chosenSite = world.sites[(gs.round - 1) % world.sites.length];

    // Place the human at their side's spawn.
    const humanSide = gs.humanSide;
    const humanSpawns = humanSide === Team.ATTACK ? world.spawns.attackers : world.spawns.defenders;
    const hs = humanSpawns[2] || humanSpawns[0];
    player.reset(hs, humanSide === Team.ATTACK ? Math.PI : 0);
    player.shieldSpeedMul = 1;

    // Spawn both bot teams (enemies + allies).
    spawnTeams();

    // --- operator + loadout + signature gadget ---
    // Use the player's pick for this side (set by OperatorSelect); else default.
    const sideKey = humanSide === Team.ATTACK ? Side.ATTACK : Side.DEFEND;
    const roster = operatorsBySide(sideKey);
    const picked = round.pickedOperator && round.pickedOperator.side === sideKey
      ? round.pickedOperator : roster[0];
    round.operator = picked;
    round.loadout = new Loadout(round.operator);
    round.loadout.resetUtility();

    // Tune the primary weapon from the operator + attachments and apply it.
    const baseDef = WEAPON_DEFS[round.operator.primary] || WEAPON_DEFS.AR;
    weapon.def = round.loadout.tuneWeapon(baseDef);
    weapon.owner = { name: round.operator.callsign, side: humanSide, isPlayer: true };
    weapon.ammo = weapon.def.magSize;
    weapon.reserve = weapon.def.reserve;
    weapon.reloading = false;
    fpCam.adsFov = 55 * (weapon.def._adsFovMul || 1);

    // Reset per-round K/D for everyone, and clear the kill feed.
    player.kills = 0; player.deaths = 0; player.lastAttacker = null;
    _prevHealth = player.maxHealth;
    killFeed.clear();
    resetDeathTracking();

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
      droneUI.hide();
      hud.setCombatVisible(false);
      // Show the operator-select grid for the human's side.
      const sideKey = gs.humanSide === Team.ATTACK ? Side.ATTACK : Side.DEFEND;
      opSelect.show(operatorsBySide(sideKey), gs.humanSide, gs.round,
        gs.score.human, gs.score.ai, round.operator);
      if (gs.round > 1) audio.play('roundStart');
    }
    if (phase === Phase.PREP) {
      hud.hideBanner();
      opSelect.hide();
      if (gs.humanSide === Team.ATTACK) {
        // Attacker drives the recon drone.
        drone.deploy(new THREE.Vector3(0, 0.22, 22), Math.PI);
        drone.setActive(true);
        round.activeCamera = droneCamera;
        hud.setCombatVisible(false);
        droneUI.showAttacker();
      } else {
        // Defender sets up: reinforce walls (V), place on foot.
        round.activeCamera = camera;
        hud.setCombatVisible(true);
        droneUI.showDefender();
      }
      // AI defense auto-reinforces a couple of walls near the chosen site.
      if (gs.aiSide === Team.DEFEND) {
        world.reinforce.reinforceNearest(round.chosenSite.pos, 6);
        world.reinforce.reinforceNearest(new THREE.Vector3(round.chosenSite.pos.x + 4, round.chosenSite.pos.y, round.chosenSite.pos.z), 6);
      }
    }
    if (phase === Phase.ACTION) {
      drone.setActive(false);
      droneUI.hide();
      opSelect.hide();
      round.activeCamera = camera;
      hud.setCombatVisible(true);
      hud.showBanner('ACTION', gs.humanSide === Team.ATTACK ? 'BREACH & PLANT' : 'HOLD THE SITE',
        gs.humanSide === Team.ATTACK ? 'atk' : 'def', 1.6);
    }
    if (phase === Phase.ROUND_END) {
      const r = gs.lastRound;
      const won = r.winner === 'human';
      hud.setCombatVisible(false);
      hud.setChannel('', null);
      opSelect.hide(); droneUI.hide();
      hud.showBanner(
        won ? 'ROUND WON' : 'ROUND LOST',
        `${r.side} — ${r.reason}`,
        r.side === Team.ATTACK ? 'atk' : 'def', 0
      );
      audio.play(won ? 'win' : 'lose');
    }
    if (phase === Phase.MATCH_END) {
      const won = gs.matchWinner === 'human';
      hud.setCombatVisible(false);
      opSelect.hide(); droneUI.hide();
      // MVP = the human-team member with the most kills.
      const team = [{ name: round.operator?.callsign || 'YOU', k: player.kills },
        ...round.allies.map((a) => ({ name: a.operator?.callsign, k: a.kills }))];
      const mvp = team.sort((a, b) => b.k - a.k)[0];
      hud.showBanner(won ? 'VICTORY' : 'DEFEAT',
        `FINAL ${gs.score.human} — ${gs.score.ai} · MVP ${mvp.name} (${mvp.k})`, won ? 'atk' : 'def', 0);
      audio.play(won ? 'win' : 'lose');
      // Return to menu shortly so another match can be started.
      setTimeout(() => { if (gs.phase === Phase.MATCH_END) menu.show('title'); }, 5000);
    }
  });

  // --- action-phase logic ---------------------------------------------------
  function updateAction(dt) {
    const humanAttack = gs.humanSide === Team.ATTACK;

    // Bomb timers.
    bomb.update(dt);
    for (const ev of bomb.drainEvents()) {
      if (ev.type === 'planted') { hud.showBanner('DEFUSER PLANTED', round.chosenSite?.name || '', 'atk', 2); audio.play('plant', bomb.mesh.position); }
      if (ev.type === 'beep') audio.play('beep', bomb.mesh.position);
      if (ev.type === 'detonated') { audio.play('breach', bomb.mesh.position); addShake(1); gs.endRound(humanAttack ? 'human' : 'ai', 'Defuser detonated'); }
      if (ev.type === 'disabled') { audio.play('defuse', bomb.mesh.position); gs.endRound(humanAttack ? 'ai' : 'human', 'Defuser disabled'); }
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

    // (Attacker bots plant via their BotBrain; no scripted stub needed.)

    // --- win conditions by elimination ---
    // Human team = player + ally bots. AI team = enemy bots.
    const humanTeamAlive = player.alive || aliveAllies().length > 0;
    const enemyAlive = aliveEnemies().length > 0;
    if (!enemyAlive) {
      gs.endRound('human', `${gs.aiSide === Team.DEFEND ? 'Defenders' : 'Attackers'} eliminated`);
    } else if (!humanTeamAlive) {
      gs.endRound('ai', `${gs.humanSide === Team.DEFEND ? 'Defenders' : 'Attackers'} eliminated`);
    }

    // Enter spectator when the human dies but the round continues (allies live).
    if (!player.alive && !round.spectating) enterSpectator();
  }

  // --- spectator ------------------------------------------------------------
  let specAngle = 0;
  function enterSpectator() {
    round.spectating = true;
    hud.setCombatVisible(false);
    hud.showBanner('DOWNED', 'SPECTATING · round continues', null, 2.2);
  }
  function updateSpectator(dt) {
    specAngle += dt * 0.6;
    // Spectate a living ally in third-person if any; otherwise orbit the site.
    const ally = aliveAllies()[0];
    if (ally) {
      const fwd = new THREE.Vector3(-Math.sin(ally.yaw), 0, -Math.cos(ally.yaw));
      camera.position.copy(ally.position).addScaledVector(fwd, -2.4).add(new THREE.Vector3(0, 2.2, 0));
      camera.lookAt(ally.position.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(fwd, 3));
    } else {
      const site = round.chosenSite || world.sites[0];
      const r = 10;
      camera.position.set(site.pos.x + Math.cos(specAngle) * r, site.pos.y + 6, site.pos.z + Math.sin(specAngle) * r);
      camera.lookAt(site.pos);
    }
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

  // --- kill feed: detect deaths each tick + attribute to last attacker -------
  const _prevAlive = new Map();
  function nameOf(c) {
    if (c === player) return round.operator?.callsign || 'YOU';
    if (c && c.isPlayer) return c.name; // weapon.owner
    return c?.operator?.callsign || '—';
  }
  function sideOf(c) {
    if (c === player) return gs.humanSide;
    if (c && c.isPlayer) return c.side;
    return c?.side || '—';
  }
  function pollDeaths() {
    const combatants = [player, ...world.bots];
    for (const c of combatants) {
      const was = _prevAlive.get(c);
      if (was === undefined) { _prevAlive.set(c, c.alive); continue; }
      if (was && !c.alive) {
        // c just died — attribute to its last attacker.
        const killer = c.lastAttacker;
        c.deaths = (c.deaths || 0) + 1;
        if (killer) killer.kills = (killer.kills || 0) + 1;
        killFeed.add({
          killer: nameOf(killer), killerSide: sideOf(killer),
          victim: nameOf(c), victimSide: sideOf(c),
          weapon: killer === player || killer?.isPlayer ? weapon.def.name : 'GUNFIRE',
          headshot: false,
          killerIsYou: killer === player || killer?.isPlayer,
          victimIsYou: c === player,
        });
        // Player took the kill → flash damage dir already handled on hit.
      }
      _prevAlive.set(c, c.alive);
    }
  }
  function resetDeathTracking() { _prevAlive.clear(); }

  // --- scoreboard roster ----------------------------------------------------
  function buildScoreboard() {
    const humanTeam = [
      { name: round.operator?.callsign || 'YOU', k: player.kills, d: player.deaths, alive: player.alive, you: true },
      ...round.allies.map((a) => ({ name: a.operator?.callsign || 'ALLY', k: a.kills, d: a.deaths, alive: a.alive, you: false })),
    ];
    const aiTeam = round.enemies.map((e) => ({ name: e.operator?.callsign || 'ENEMY', k: e.kills, d: e.deaths, alive: e.alive, you: false }));
    return { humanSide: gs.humanSide, aiSide: gs.aiSide, scoreH: gs.score.human, scoreA: gs.score.ai, humanTeam, aiTeam };
  }

  // --- spotted-enemy screen markers -----------------------------------------
  const _proj = new THREE.Vector3();
  function projectSpotMarkers() {
    const now = performance.now();
    const list = [];
    for (const e of round.enemies) {
      const exp = round.spotted.get(e);
      if (!exp || exp <= now || !e.alive) continue;
      const head = e.position.clone().add(new THREE.Vector3(0, 1.7, 0));
      _proj.copy(head).project(camera);
      const onScreen = _proj.z < 1 && _proj.x > -1 && _proj.x < 1 && _proj.y > -1 && _proj.y < 1;
      list.push({
        x: (_proj.x * 0.5 + 0.5) * window.innerWidth,
        y: (-_proj.y * 0.5 + 0.5) * window.innerHeight,
        dist: player.position.distanceTo(e.position),
        onScreen,
      });
    }
    hud.setSpotMarkers(list);
  }

  // --- main loop ------------------------------------------------------------
  let fps = 0, frames = 0, fpsAccum = 0, lastFpsTime = performance.now();
  let _prevHealth = 100;

  function update(dt) {
    gs.update(dt);

    // Bots think + act only during the action phase (no respawn in a round).
    // Sound events are pruned each tick so hearing stays "fresh".
    if (gs.phase === Phase.ACTION) {
      for (const b of world.bots) b.update(dt);
      // Play freshly-created bot sound events positionally (occlusion-aware).
      for (const s of world.soundEvents) {
        if (s.played) continue;
        s.played = true;
        if (s.type === 'shot') audio.play('shot', s.pos);
        else if (s.type === 'step') audio.play('step', s.pos);
        else if (s.type === 'breach') { audio.play('breach', s.pos); addShake(0.25); }
      }
      if (world.soundEvents.length > 64) world.soundEvents.splice(0, world.soundEvents.length - 64);
      pollDeaths();
      // Damage-direction indicator when the player's health drops.
      if (player.health < _prevHealth && player.lastHitFrom) {
        const to = player.lastHitFrom.clone().sub(player.position);
        const ang = Math.atan2(to.x, -to.z) - player.yaw; // relative to facing
        hud.setDamageDir(ang);
        addShake(0.25);
      }
      _prevHealth = player.health;
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

    // Audio listener follows the active camera; apply + decay screen shake.
    audio.setListener(round.activeCamera);
    if (shakeAmt > 0) {
      const s = shakeAmt * shakeAmt * 0.25;
      round.activeCamera.position.x += (Math.random() * 2 - 1) * s;
      round.activeCamera.position.y += (Math.random() * 2 - 1) * s;
      round.activeCamera.position.z += (Math.random() * 2 - 1) * s;
      shakeAmt = Math.max(0, shakeAmt - dt * 2.2);
    }

    // HUD.
    updateHud(dt);
    killFeed.update(dt);

    // Spotted-enemy markers (action phase, player view).
    if (gs.phase === Phase.ACTION && !round.spectating) projectSpotMarkers();
    else hud.setSpotMarkers([]);

    // Prep-phase drone/defender overlay numbers.
    if (gs.phase === Phase.PREP) {
      if (gs.humanSide === Team.ATTACK) {
        droneUI.update({ battery: Math.max(0, gs.timeRemaining / 45 * 100), hp: (drone.health / 20) * 100,
          spotted: drone.spotted.length, objective: round.chosenSite?.name || 'SCANNING…' });
      } else {
        droneUI.update({ reinforce: world.reinforce.remaining });
      }
    }

    // Live scoreboard while held.
    if (scoreboardVisible) scoreboard.render(buildScoreboard());
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

    if (gs.phase === Phase.OPERATOR_SELECT) { phaseLabel = 'OPERATOR SELECT'; objective = 'CHOOSE LOADOUT · [ENTER] READY'; opSelect.setTimer(gs.timeRemaining); }
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

    // Alive pips: player + ally bots vs enemy bots.
    const humanAlive = [player.alive, ...round.allies.map((a) => a.alive)];
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

  // Open on the main menu.
  menu.show('title');

  const game = { THREE, renderer, scene, camera, input, loop, player, weapon, world, hud, gs, bomb, drone, round, nav, settings, audio, menu, OPERATORS, FLOOR_H };
  window.__BREACHPOINT__ = game;
  statusEl.textContent = `WARL 5 SIEGE · ${VERSION}\nready · click to start`;
  console.log('[BREACHPOINT] phase 3 boot complete', VERSION);
  return game;
}

boot();
