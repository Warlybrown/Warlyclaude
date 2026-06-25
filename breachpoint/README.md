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
| 2 | Map + destruction system | — |
| 3 | Round structure & bomb objective | — |
| 4 | Operators & gadgets | — |
| 5 | Bot AI | — |
| 6 | UI / HUD | — |
| 7 | Audio, polish & juice | — |

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
