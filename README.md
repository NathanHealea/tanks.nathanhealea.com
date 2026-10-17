# Tanks

A three-quarter view tank game for the browser and your phone. Drive with WASD, aim with the mouse, bank shots off the walls, and pop every enemy tank across 50 levels.

**Play it:** https://tanks.nathanhealea.com

![Level 1: your blue tank behind cover, a tan turret across the board, and the dotted aim line](docs/screenshot.png)

Hit a tank and it bursts like a balloon: it swells, snaps into rubbery shreds of its own color, and leaves a scuffed X on the floor. The game installs as an app (a progressive web app, or PWA) and plays offline once loaded.

## How to play

Clear the board to finish a level. You carry two shells and two mines. When you've used both, they reload: shells take 2 seconds, mines take 8. Shells bounce off walls once, and your own rebound can pop you.

| Action | Keyboard and mouse | Touch |
| --- | --- | --- |
| Drive | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Drag on the left half of the screen |
| Aim | Mouse, or <kbd>←</kbd> <kbd>→</kbd> | Touch the right half |
| Fire | Left click or <kbd>Space</kbd> | Lift your finger from the right half |
| Drop a mine | Right click or <kbd>F</kbd> | **Mine** button |
| Pause | <kbd>Esc</kbd> or <kbd>P</kbd> | **Pause** button |

Mines go off when an enemy drives near one or after 9 seconds. The blast pops every tank in range, yours included, and breaks cork blocks. The plain wood blocks don't break.

On a phone, play in landscape.

## The enemies

A new tank type joins the mix every 10 levels. Each level after that draws its enemies from every type unlocked so far.

| From level | Tank | Color | Speed | Shells | Shell bounces | Mines | What to expect |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Turret | Tan | Doesn't move | 2 | 1 | 0 | Stays put and takes its time |
| 11 | Roamer | Olive | 2.0 | 2 | 1 | 0 | Drives around looking for an angle |
| 21 | Hunter | Brick red | 2.6 | 2 | 1 | 2 | Fast, closes in, drops mines |
| 31 | Rocket | Teal | 1.6 | 1 | 0 | 0 | Slow, but its shell is nearly twice as fast as yours |
| 41 | Ace | Purple | 2.8 | 3 | 2 | 2 | Quick, and its shells bounce twice |

Your tank moves at 2.4. Speeds are in floor tiles per second.

### Difficulty curve

Enemy skill follows `1 − (10 − level/5)² / 100`. It starts near zero and climbs quickly through the early levels, then flattens toward 1.0 at level 50:

| Level | 1 | 10 | 20 | 30 | 40 | 50 |
| --- | --- | --- | --- | --- | --- | --- |
| Skill | 0.04 | 0.36 | 0.64 | 0.84 | 0.96 | 1.00 |

Skill sets how fast enemies aim, how often they fire and how fast they move. Past 0.5 (level 15), they also bank shots off the walls, dodge your shells and drop mines, if their type carries them.

Enemy count grows from 1 on the first levels to 8 by level 49.

## Run it locally

You need Node 22.12 or newer.

```sh
npm install
npm run dev
```

Open the URL Vite prints. `npm run dev` also serves on your local network, so a phone on the same Wi-Fi can connect. One catch: under WSL2 your phone usually can't reach the dev server. Deploy instead (see below), or turn on WSL's mirrored networking.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build; the service worker only runs here |
| `npm run typecheck` | Type-check without building |
| `npm run deploy` | Build and publish to Cloudflare |

## Deploy

The site is a static-assets Cloudflare Worker with no server code. `wrangler.json` defines it, and it's served at `tanks.nathanhealea.com`.

1. Create a Cloudflare API token that can deploy Workers and manage the `nathanhealea.com` zone. The zone access is what lets the deploy attach the custom domain.
2. Put it in `.env` at the project root. `.env` is git-ignored.
   ```sh
   CLOUDFLARE_API_TOKEN=your-token
   ```
3. Run `npm run deploy`.

Every file is served with `Cache-Control: max-age=0, must-revalidate`, so a new deploy shows up on the next page load. An installed copy on a phone may need to be closed and reopened once.

## How the code is laid out

```
src/
  game/      simulation: plain TypeScript, no React, no three.js
    sim.ts       step(state, inputs) advances the world one 60 Hz tick
    ai.ts        enemy aiming, bank-shot tracing, grid pathfinding
    levels.ts    50 seeded level layouts and the difficulty curve
    tanks.ts     per-type stats and the order types unlock
    config.ts    shared tuning: reload times, bullet size, mine fuse
    session.ts   fixed-timestep clock around step()
  render/    three.js scene through @react-three/fiber: tanks, arena, particles, camera
  input/     keyboard and mouse, turned into a PlayerInput each frame
  ui/        HUD and touch controls
  audio/     synthesized sound effects (Web Audio, no audio files)
public/      manifest, service worker, icons
```

Levels are generated rather than drawn by hand. Each level number has a fixed seed, so every player gets the same 50 maps. The generator throws out any layout where an enemy can see your spawn or can't be reached by driving.

## Tuning

| To change | Edit |
| --- | --- |
| Reload times, mine fuse and blast radius, tank size | `src/game/config.ts` |
| Each enemy type's speed, shells, bounces and mines | `src/game/tanks.ts` |
| How enemies aim, fire, dodge and wander | `PROFILES` and `scaled()` in `src/game/ai.ts` |
| Difficulty curve, enemy count, level layouts | `src/game/levels.ts` |
| Lives | `MAX_LIVES` in `src/game/config.ts` |

## Built for two players later

The simulation is ready for networked play over WebSockets:

- **One function moves the game:** `step(state, inputs)` advances the world, and it's the only thing that does.
- **State is plain JSON:** it can be snapshotted and sent over the wire as-is.
- **Seeded randomness:** random numbers come from a seed stored in that state, so every machine draws the same ones.
- **Inputs are small:** each player sends a `PlayerInput` (move vector, turret angle, fire, mine), keyed by player ID.
- **Spawns are ready:** every level already has a player 2 spawn point.

The plan is to swap `LocalSession` for a networked session. One host, a player's machine or a server, runs `step()` with both players' inputs and sends out the state. Each client sends only its own input.

## Built with

[React](https://react.dev), [three.js](https://threejs.org) through [@react-three/fiber](https://r3f.docs.pmnd.rs), [Vite](https://vite.dev), TypeScript, and [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/) for hosting.
