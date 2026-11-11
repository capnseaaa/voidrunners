# VOIDRUNNERS

A single-player 3D arcade space racing game set in the middle of a war: circuit races, open-space battles and races across the hull of a dying battleship, with combat, capital ships, enemy fighters, salvage, four playable ships, nine AI rivals, upgrades and a 17-event campaign. It runs in desktop and mobile browsers and deploys as a static site.

Everything is procedural: 3D models, tracks, textures, particles, music and sound effects are generated in code. There is no backend, no account, no paid API and no external asset. After the page has loaded it needs no network connection.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Fire primary weapon (unlimited; it overheats) |
| `Shift` | Boost (hold). Tap it while a missile is inbound to drop flares |
| `E` | Fire missile (limited; +2 each lap and from red pickups) |
| `Q` | Special ship ability |
| `R` | Reset to the track |
| `Esc` | Pause |

All keys can be held together. Some keyboards drop a key when several are held (a hardware limit), so there are alternates: `J` or left mouse fires, `K` boosts, `L` or right mouse launches missiles, `I` is the ability.

Weapons auto-aim at the bracketed target. Priority: a rival or enemy fighter dead ahead, then the nearest exposed capital ship system, then anything in the wider forward cone. With nothing ahead they swing to whoever is on your tail: the rear gun fires and missiles launch backwards.

### Touch and tilt

On a phone or tablet the game shows touch controls: a steering pad, BRAKE, FIRE, BOOST, MSL and ABILITY. The ship accelerates by itself unless you brake (Settings → Auto-accelerate). Each control tracks its own finger, so they work together.

Tilt steering is optional: Settings → Tilt steering → On. iPhone and iPad ask for motion access at that point; the prompt only appears from a tap, and only on an `https` page (GitHub Pages is). Settings also has sensitivity, a "Set centre" calibration and an invert switch. The steering pad stays on screen as a fallback.

## The game

- **Events**: 17 across four stages. Each stage has a circuit race, a capital ship challenge, at least one open-space battle or battleship surface race, and a championship.
  - **Circuit races**: 10 racers, 3 laps of about 45 seconds, two alternative routes, hazards, boost pads, salvage and a capital ship beside the route. Positions come from checkpoint count and track progress.
  - **Open-space battles**: no track. 135 seconds of free flight in a battle zone with enemy fighters and a capital ship. The highest score wins; a wrecked ship re-enters from the edge.
  - **Battleship surface races**: a circuit across the hull of a giant ship: flight deck, gun deck, tunnel, hangar and a gap to cross. The ship is under fire, and it breaks up lap by lap: deck sections are blown out, wreckage and fires appear, and the camera lists. Racers hover across the holes, so the route stays passable.
- **Combat**: every racer has hull and shields, shown as bars over rivals. Hits spark and flash; a ship at zero hull explodes and rebuilds after about 2.4 seconds. Wrecking a rival pays a bounty at once (boost, a missile, 200 credits) and costs them time.
- **Threats**: the radar by the speed readout shows nearby craft, with the lower half behind you. A missile warning and a lock warning tell you when to drop flares or fight back.
- **Enemy fighters**: they dive in, sit on a racer's tail and strafe. Anyone can shoot them down.
- **Capital ships**: they fire gun bursts and guided missiles and bombard the route. Each system does something:
  - *Shield generator*: protects every other system until it dies.
  - *Weapon batteries*: each one lost means less incoming fire.
  - *Engines*: each one lost cuts the ship's power, slowing all its weapons. The killer gets overdrive.
  - *Cargo bay*: runs repairs on damaged systems until it dies, then spills salvage.
  - Shot-off systems drop wreckage onto the route for a while.
- **Ships**: COMET (speed, Afterburn), BRUISER (tank, Bulwark shield), PHANTOM (agility, Phase Dash), VULTURE (salvage ×1.6, Mag-Collector). You start with COMET. The others unlock by clearing events and paying credits.
- **AI rivals**: Ace (attacker), Rookie (nervous), Tank (brawler), Scavenger, Ghost (evasive), Psycho (berserker), Veteran (tactician), Showoff (daredevil), Mercenary (gunship). They use the same ship class, physics and weapons as the player, and they react to position, health and threats: the cautious weave and hug the far wall when hurt, the brawlers ram, the berserker gets worse when damaged, the nervous one panics under fire. Their current mood shows beside their name in the standings.
- **Progression**: credits pay for standard upgrades (levels 1–3) and ships. Salvage is also needed for advanced upgrades (levels 4–5). Five categories: engines, handling, armour, weapons, shields. Upgrades are per ship.
- **Saving**: progress, currencies, ships, upgrades, records and settings are stored in the browser's LocalStorage under the key `voidrunners.save` (versioned and validated; older saves are migrated). Settings → *Reset Save Data* wipes progress after a confirmation.

## Local development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # dev server with hot reload (http://localhost:5173)
npm test           # game-logic tests, including full headless runs of every event
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
      capital.ts                  capital ship systems, guns, missiles and bombardment
      drones.ts                   enemy fighters
      layout.ts                   seeded placement of pads, salvage and hazards
    render/                       Three.js presentation: ships, track, scenery, capital ship, particles
    audio/                        Web Audio synthesiser: music, engine and effects
    input/                        keyboard, mouse, touch and tilt
tests/                            Vitest suites
tools/probe.test.ts               balance probe (prints a table of a simulated race)
```

The simulation has no rendering or DOM dependencies. The same code runs in the browser and in the headless tests.

## Graphics settings

Settings → Quality: **Low** (no bloom, native 1× resolution, fewer particles and scenery), **Medium** (default), **High** (full resolution, more effects). The setting applies from the next race.

## Developer shortcuts

- `?dev&race=s3r1` starts an event directly. Ids: `s<stage>r1` circuit, `s<stage>r2` capital challenge, `s<stage>b` battle, `s<stage>s` surface race, `s<stage>r3` championship. It ignores unlock state, but results are still saved.
- `?autopilot` lets the AI fly the player's ship.
- Balance probe: `cp tools/probe.test.ts tests/_probe.test.ts && RACES=s1r1,s2r1 SHIP=comet LVL=0 npx vitest run tests/_probe.test.ts --silent=false`

## Known limitations

- No gamepad input.
- Tilt steering depends on the browser exposing motion sensors. If it does not, or access is refused, the touch pad is used.
- Needs WebGL 2. If the renderer cannot start, the game shows an error panel instead of a blank screen.
- Browsers block audio until the first click or key press, so sound starts after the first interaction.
- AI rivals keep racing after you finish; the results screen shows the classification filling in live.
