# WARL 5 SIEGE

*Codename: BREACHPOINT* — a browser-based, single-player-with-bots **siege-style tactical FPS** built with Three.js + Vite.

Asymmetric attack/defend rounds, a preparation/drone phase, destructible walls, wall reinforcement, gadget-based operators, and bomb-defusal with no respawns. **100% original assets, names, and branding** — mechanics are inspired by the tactical-shooter genre, content is entirely our own.

## Run it

```bash
cd breachpoint
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173) in Chrome. **Click the canvas** to engage pointer lock and look around with the mouse.

## Build status

| Phase | System | State |
|------:|--------|-------|
| 0 | Project setup: Vite + Three.js, full-window canvas, DOM HUD overlay, pointer lock, fixed-timestep loop | ✅ done |
| 1 | Core FPS feel: movement, lean, crouch, ADS, hitscan weapon, recoil, practice arena | ✅ done |
| 2 | Map (SAFEHOUSE) + layered destruction system | ✅ done |
| 3 | Round structure, bomb objective, drone phase, spectator | ✅ done |
| 4 | Operators & gadgets (10 originals + attachments) | ✅ done |
| 5 | Bot AI: navmesh, perception, behaviour FSM, 5v5 | ✅ done |
| 6 | UI / HUD: operator select, kill feed, scoreboard, drone UI, markers | ✅ done |
| 7 | Audio (positional Web Audio), screen shake, menu + settings | ✅ done |

## How to play

1. `npm run dev`, open the URL in Chrome, click **PLAY VS BOTS** → pick a mode.
2. **Operator Select** (15s): click an operator card, then `ENTER` to ready up.
3. **Prep** (45s): if attacking, drive the **recon drone** to scout; if defending,
   `V` to reinforce walls and `F` to place gadgets near the site.
4. **Action** (3:00): attackers breach in and plant the defuser (`G` in a site,
   hold ~7s), then protect it for 45s. Defenders hold both sites; after a plant,
   hold `G` on the device to disable it. No respawns — on death you spectate a
   teammate. First team to 4 rounds wins; sides swap each round.

## Controls

| Action | Bind | | Action | Bind |
|--------|------|-|--------|------|
| Move | `W` `A` `S` `D` | | Fire | Left Mouse |
| Look | Mouse | | Aim (ADS) | Right Mouse (hold) |
| Sprint | `Shift` | | Reload | `R` |
| Crouch | `Ctrl` / `C` | | Signature gadget | `F` |
| Lean L/R | `Q` / `E` | | Plant / Defuse | `G` (hold) |
| Reinforce (prep) | `V` | | Scoreboard | `Tab` (hold) |
| Ready up / skip | `Enter` | | Settings / pause | `Esc` |

## Operators (all original)

**Attackers** — RAMROD (hard breach), EMBER (flash), ORACLE (sonar scan),
MAUL (silent breach), AEGIS (ballistic shield).
**Defenders** — BRAMBLE (proximity trap), STATIC (drone jammer), WARDEN
(deployable camera), RIPOST (reactive countermine), BULWARK (bulletproof cover).

## Architecture

```
src/
  main.js              entry, boot sequence, game wiring
  core/                GameState, Loop (fixed timestep), Input (pointer lock), Audio
  player/              PlayerController, FirstPersonCamera, Weapon, Loadout
  world/               MapLoader, Destruction, Reinforcement, mapDefs/
  entities/            Bot, BotBrain, Drone, Bomb
  operators/           operators.js + gadgets/ (uniform equip/use/tick/cleanup API)
  ui/                  HUD, OperatorSelect, Scoreboard, KillFeed, DronePhaseUI
  util/                math, raycast
```

**Design principle:** single-player-with-bots first. No netcode — but systems are
kept modular so an authoritative-server layer could be added later.

### Loop model
Game logic runs on a **fixed timestep** (`core/Loop.js`, 60 Hz) for deterministic,
framerate-independent simulation; rendering happens once per animation frame.

### Input model
All keyboard/mouse/pointer-lock state lives in `core/Input.js`. Game systems poll
a snapshot each frame rather than registering their own listeners.

## Controls (Phase 1)

| Action | Bind |
|--------|------|
| Move | `W` `A` `S` `D` |
| Look | Mouse (click canvas to lock) |
| Fire (auto) | Left Mouse |
| Aim down sights | Right Mouse (hold) |
| Reload | `R` |
| Crouch | `Ctrl` / `C` (hold) |
| Lean left / right | `Q` / `E` (hold) |
| Sprint | `Shift` (hold, forward; blocks firing) |

**Feel notes:** movement uses acceleration/friction (no instant snap); the rifle has
a fixed, learnable recoil pattern you counter by pulling down; spread shrinks when
still + crouched + aiming and grows while moving; headshots (top of a dummy) are
lethal. Dummies topple on death and respawn after ~3s.
