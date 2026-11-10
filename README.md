# VOIDRUNNERS

A single-player 3D arcade space racing game with combat, capital ship boss encounters, salvage, four playable ships, nine AI rivals, ship upgrades and a 12-race campaign. It runs in a desktop browser and deploys as a static site.

Everything is procedural: 3D models, tracks, textures, particles, music and sound effects are generated in code. There is no backend, no account, no paid API and no external asset. After the page has loaded it needs no network connection.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Fire blasters (unlimited; they overheat) |
| `Shift` | Launch a missile (limited; +2 each lap and from red pickups) |
| `E` | Boost (hold) |
| `Q` | Ship ability |
| `R` | Reset to the track |
| `Esc` | Pause |

Blasters and missiles auto-aim at the bracketed target: a rival dead ahead, or the nearest exposed capital ship system when the battleship is in range.

## The game

- **Races**: 10 racers, 3 laps, checkpoints, two alternative routes per track, hazards, boost pads, salvage, and one capital ship per race. Positions come from checkpoint count and track progress.
- **Ships**: COMET (speed, Afterburn), BRUISER (tank, Bulwark shield), PHANTOM (agility, Phase Dash), VULTURE (salvage ×1.6, Mag-Collector). You start with COMET. The others unlock by clearing campaign races and paying credits.
- **AI rivals**: Ace, Rookie, Tank, Scavenger, Ghost, Psycho, Veteran, Showoff and Mercenary. They use the same ship class, physics, weapons and rules as the player.
- **Capital ships**: shield generator, four weapon batteries, two engines and a cargo bay, each with its own health. The generator shields the rest. Batteries drive the incoming fire and bombardment. An engine kill grants overdrive. The cargo bay drops salvage. Damage is credited per racer.
- **Progression**: credits pay for standard upgrades (levels 1–3) and ships. Salvage is also needed for advanced upgrades (levels 4–5). Five categories: engines, handling, armour, weapons, shields. Upgrades are per ship.
- **Campaign**: Neon Frontier, Dead Orbit, Solar Scar, Warzone Zero. Each stage has a standard race, a capital ship challenge and a championship. Finish 6th or better to unlock the next race (4th or better in a championship). Every finish pays something.
- **Saving**: progress, currencies, ships, upgrades, records and settings are stored in the browser's LocalStorage under the key `voidrunners.save` (versioned, validated on load). Settings → *Reset Save Data* wipes progress after a confirmation.

## Local development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # dev server with hot reload (http://localhost:5173)
npm test           # game-logic tests, including full headless races on all 12 events
npm run build      # type-check, then production build into dist/
npm run preview    # serve the production build locally
```

## Deploying to GitHub Pages

The repository includes `.github/workflows/deploy.yml`. It installs dependencies, runs the tests, builds the site and publishes `dist/` to GitHub Pages.

1. In the repository on GitHub open **Settings → Pages**. Under **Build and deployment** set **Source** to **GitHub Actions**. This is a one-time manual step, and the workflow fails at "Configure Pages" until it is done.
2. Push to the repository's default branch, or open **Actions → Deploy to GitHub Pages → Run workflow**. The workflow deploys from the default branch whatever its name is; pushes to other branches are skipped.
3. When the run finishes, the game is at `https://<owner>.github.io/<repository>/`. The exact URL is shown on the workflow run and under Settings → Pages.

The base path is not hardcoded. `vite.config.ts` reads it from the `VITE_BASE` environment variable, and the workflow sets it from the Pages configuration. Without `VITE_BASE` the build uses relative asset URLs (`./`), so `dist/` also works from any sub-folder on any static host.

```bash
VITE_BASE=/my-repo/ npm run build   # explicit base path, if you ever need one
```

## Project layout

```
src/
  main.tsx, App.tsx, styles.css   React shell and CRT-style UI
  ui/                             menus, hangar, HUD, pause, results, 3D ship preview
  game/
    Game.ts                       race orchestrator: loop, input, audio and HUD publishing
    hudStore.ts                   throttled bridge from the simulation to React
    data/                         ships, AI racers, upgrades, campaign, rewards
    save/                         versioned LocalStorage save, migration, progression rules
    tracks/                       track builder (splines → sampled ribbons) and the 4 circuits
    sim/                          rendering-free simulation
      race.ts                     race manager: laps, checkpoints, standings, damage, pickups
      ship.ts                     ship state and arcade physics (shared by player and AI)
      ai.ts                       AI drivers (they only write control inputs)
      weapons.ts                  pooled projectiles
      capital.ts                  capital ship components, guns and bombardment
      layout.ts                   seeded placement of pads, salvage and hazards
    render/                       Three.js presentation: ships, track, scenery, capital ship, particles
    audio/                        Web Audio synthesiser: music, engine and effects
    input/                        keyboard
tests/                            Vitest suites
tools/probe.test.ts               balance probe (prints a table of a simulated race)
```

The simulation has no rendering or DOM dependencies. The same code runs in the browser and in the headless tests.

## Graphics settings

Settings → Quality: **Low** (no bloom, native 1× resolution, fewer particles and scenery), **Medium** (default), **High** (full resolution, more effects). The setting applies from the next race.

## Developer shortcuts

- `?dev&race=s3r1` starts a race directly (`s<stage>r<race>`, e.g. `s1r1` … `s4r3`). It ignores unlock state, but results are still saved.
- `?autopilot` lets the AI fly the player's ship.
- Balance probe: `cp tools/probe.test.ts tests/_probe.test.ts && RACES=s1r1,s2r1 SHIP=comet LVL=0 npx vitest run tests/_probe.test.ts --silent=false`

## Known limitations

- Desktop keyboard only. There is no touch or gamepad input.
- Needs WebGL 2. If the renderer cannot start, the game shows an error panel instead of a blank screen.
- Browsers block audio until the first click or key press, so sound starts after the first interaction.
- AI rivals keep racing after you finish; the results screen shows the classification filling in live.
