// The four circuits. Coordinates are design units: [x, y, z, halfWidth].
import type { TrackDef } from './track';

export const NEON_FRONTIER: TrackDef = {
  id: 'neon', name: 'NEON FRONTIER', scale: 0.52, yScale: 0.6, step: 6, checkpoints: 10,
  main: [
    [0, 0, 0, 24], [500, 0, 0, 24], [1000, 10, 0, 24], [1400, 30, 150, 22], [1550, 50, 500, 20],
    [1400, 40, 850, 20], [1000, 10, 950, 18], [700, -10, 800, 18], [400, -20, 1000, 20], [100, -30, 1250, 22],
    [300, -10, 1600, 22], [800, 20, 1700, 22], [1300, 40, 1650, 22], [1700, 60, 1900, 22], [1400, 30, 2300, 24],
    [700, 0, 2350, 27], [0, 0, 2350, 27], [-600, -10, 2250, 27], [-1000, -30, 1900, 22], [-1050, -50, 1300, 22],
    [-800, -40, 800, 20], [-900, -20, 300, 20], [-600, 0, 0, 24],
  ],
  branches: [
    { name: 'Service Duct', kind: 'shortcut', from: 8, to: 11, hw: 10, points: [[330, -40, 1140], [430, -50, 1340], [620, -10, 1560]] },
    { name: 'Reactor Bypass', kind: 'risky', from: 18, to: 20, hw: 12, points: [[-820, -70, 1600], [-720, -90, 1300], [-730, -70, 1000]] },
  ],
  sections: [
    { from: 4.6, to: 8.2, kind: 'tunnel' }, { from: 18.6, to: 21.4, kind: 'tunnel' },
    { from: 0, to: 4.6, kind: 'city' }, { from: 8.2, to: 14, kind: 'city' }, { from: 14, to: 18.6, kind: 'dock' }, { from: 21.4, to: 23, kind: 'city' },
  ],
  pads: [
    { path: 0, at: 1.2, d: 0.4 }, { path: 0, at: 2.1, d: -0.4 }, { path: 0, at: 5.6, d: 0 }, { path: 0, at: 11.4, d: 0.3 },
    { path: 0, at: 14.6, d: -0.5 }, { path: 0, at: 16.2, d: 0.5 }, { path: 0, at: 19.2, d: 0 }, { path: 0, at: 21.8, d: -0.3 },
    { path: 1, at: 0.55, d: 0 }, { path: 2, at: 0.3, d: 0 }, { path: 2, at: 0.6, d: 0 },
  ],
  capital: { from: 14.5, to: 17.0, side: -1, dist: 125, height: 50 },
};

export const DEAD_ORBIT: TrackDef = {
  id: 'orbit', name: 'DEAD ORBIT', scale: 0.66, yScale: 0.7, step: 6, checkpoints: 10,
  main: [
    [0, 0, 0, 21], [500, 0, 0, 21], [950, 30, -150, 19], [1300, 80, -500, 17], [1250, 120, -950, 17],
    [900, 90, -1250, 17], [450, 40, -1150, 18], [150, 0, -850, 17], [-250, -40, -950, 17], [-600, -80, -1300, 18],
    [-1100, -60, -1350, 20], [-1500, -20, -1050, 21], [-1600, 20, -550, 24], [-1550, 40, 0, 24], [-1450, 20, 500, 24],
    [-1100, -20, 850, 19], [-650, -50, 700, 17], [-500, -30, 300, 18], [-350, 0, 50, 20],
  ],
  branches: [
    { name: 'Fracture Gap', kind: 'shortcut', from: 3, to: 6, hw: 9.5, points: [[1130, 60, -790], [840, 30, -1010]] },
    { name: 'Inner Belt', kind: 'risky', from: 9, to: 12, hw: 12, points: [[-850, -130, -1050], [-1150, -150, -1000], [-1270, -70, -700]] },
  ],
  sections: [
    { from: 2, to: 9, kind: 'dense' }, { from: 9, to: 12, kind: 'wreck' }, { from: 12, to: 14.5, kind: 'open' }, { from: 14.5, to: 19, kind: 'dense' }, { from: 0, to: 2, kind: 'open' },
  ],
  pads: [
    { path: 0, at: 0.8, d: 0.3 }, { path: 0, at: 4.4, d: 0 }, { path: 0, at: 7.5, d: -0.3 }, { path: 0, at: 10.4, d: 0.4 },
    { path: 0, at: 12.3, d: -0.5 }, { path: 0, at: 13.6, d: 0.5 }, { path: 0, at: 16.4, d: 0 },
    { path: 1, at: 0.5, d: 0 }, { path: 2, at: 0.3, d: 0 }, { path: 2, at: 0.62, d: 0 },
  ],
  capital: { from: 11.8, to: 14.3, side: 1, dist: 125, height: 55 },
};

export const SOLAR_SCAR: TrackDef = {
  id: 'solar', name: 'SOLAR SCAR', scale: 0.68, yScale: 0.6, step: 6, checkpoints: 10,
  main: [
    [-1100, 10, 900, 24], [-1000, 20, 300, 24], [-600, 30, 20, 24], [0, 30, 0, 27], [700, 30, 0, 29],
    [1400, 30, 100, 29], [1900, 20, 400, 26], [2000, 0, 900, 24], [1700, -20, 1300, 20], [1300, -40, 1200, 17],
    [1000, -50, 1500, 16], [600, -50, 1350, 16], [300, -40, 1650, 16], [-100, -30, 1500, 17], [-500, -10, 1700, 19],
    [-1000, 0, 1500, 22],
  ],
  branches: [
    { name: "Smuggler's Cut", kind: 'shortcut', from: 10, to: 12, hw: 9.5, points: [[700, -75, 1625], [450, -65, 1690]] },
    { name: 'Gun Line', kind: 'risky', from: 13, to: 15, hw: 12, points: [[-400, -5, 1440], [-700, 10, 1400]] },
  ],
  sections: [
    { from: 2.5, to: 7.2, kind: 'plain' }, { from: 7.2, to: 14.2, kind: 'canyon' }, { from: 14.2, to: 16, kind: 'base' }, { from: 0, to: 2.5, kind: 'base' },
  ],
  pads: [
    { path: 0, at: 0.5, d: 0 }, { path: 0, at: 3.4, d: 0.5 }, { path: 0, at: 4.4, d: -0.5 }, { path: 0, at: 5.6, d: 0.2 },
    { path: 0, at: 7.6, d: 0 }, { path: 0, at: 11.5, d: 0 }, { path: 0, at: 14.6, d: 0.3 },
    { path: 1, at: 0.5, d: 0 }, { path: 2, at: 0.3, d: 0 }, { path: 2, at: 0.65, d: 0 },
  ],
  capital: { from: 3.0, to: 5.3, side: -1, dist: 130, height: 65 },
};

export const WARZONE_ZERO: TrackDef = {
  id: 'warzone', name: 'WARZONE ZERO', scale: 0.62, yScale: 0.65, step: 6, checkpoints: 10,
  main: [
    [0, 0, 0, 28], [700, 20, 0, 28], [1400, 60, -200, 28], [2000, 100, -700, 26], [2100, 60, -1300, 26],
    [1700, 0, -1750, 24], [1100, -40, -1700, 24], [800, -60, -1300, 22], [400, -40, -1500, 22], [0, 0, -1900, 24],
    [-600, 40, -2000, 26], [-1200, 60, -1700, 28], [-1500, 40, -1100, 29], [-1500, 0, -500, 29], [-1150, -10, -80, 28],
    [-600, 0, 0, 28],
  ],
  branches: [
    { name: 'Crossfire Alley', kind: 'risky', from: 2, to: 4, hw: 12, points: [[1700, 130, -600], [1900, 120, -1000]] },
    { name: 'Hull Breach', kind: 'shortcut', from: 6, to: 8, hw: 10, points: [[750, -90, -1660]] },
  ],
  sections: [
    { from: 0, to: 2, kind: 'open' }, { from: 2, to: 5, kind: 'crossfire' }, { from: 5, to: 9, kind: 'wreck' }, { from: 9, to: 14, kind: 'fleet' }, { from: 14, to: 16, kind: 'open' },
  ],
  pads: [
    { path: 0, at: 0.9, d: 0.4 }, { path: 0, at: 1.7, d: -0.4 }, { path: 0, at: 4.5, d: 0 }, { path: 0, at: 9.4, d: 0.3 },
    { path: 0, at: 11.6, d: -0.5 }, { path: 0, at: 12.6, d: 0.5 }, { path: 0, at: 14.5, d: 0 },
    { path: 1, at: 0.3, d: 0 }, { path: 1, at: 0.62, d: 0 }, { path: 2, at: 0.5, d: 0 },
  ],
  capital: { from: 11.4, to: 13.4, side: 1, dist: 130, height: 60 },
};

// A circuit laid across the hull of a colossal battleship: flight deck, bow gun
// deck, a maintenance tunnel, the main hangar, a leap across a gap in the hull
// and a pass around the engine block. "breakA"/"breakB" stretches of deck are
// blown away as the ship dies (laps 2 and 3); racers hover across the holes.
export const HULK: TrackDef = {
  id: 'hulk', name: 'BATTLESHIP SURFACE', scale: 0.86, yScale: 0.7, step: 6, checkpoints: 10,
  main: [
    [-800, 0, 350, 28], [-200, 0, 350, 28], [500, 0, 350, 28], [1100, 8, 330, 24], [1500, 25, 200, 20],
    [1600, 30, -50, 20], [1450, 20, -300, 20], [1050, 5, -380, 18], [500, -15, -350, 18], [0, -20, -400, 22],
    [-500, -15, -350, 24], [-1000, 0, -380, 22], [-1400, 10, -250, 20], [-1550, 15, 50, 20], [-1350, 5, 300, 22],
  ],
  branches: [
    { name: 'Forward Gun Deck', kind: 'shortcut', from: 3, to: 6, hw: 10, points: [[1310, 10, 150], [1390, 12, -110]] },
    { name: 'Engine Trench', kind: 'risky', from: 11, to: 14, hw: 12, points: [[-1200, -25, -150], [-1280, -25, 100]] },
  ],
  sections: [
    { from: 1.5, to: 1.63, kind: 'breakA' }, { from: 4.42, to: 4.56, kind: 'breakB' }, { from: 12.42, to: 12.56, kind: 'breakB' },
    { from: 10.72, to: 10.9, kind: 'gap' },
    { from: 6.6, to: 8.5, kind: 'tunnel' }, { from: 8.5, to: 10.4, kind: 'hangar' },
    { from: 0, to: 3, kind: 'deck' }, { from: 3, to: 6.6, kind: 'bow' }, { from: 10.4, to: 12, kind: 'stern' }, { from: 12, to: 14, kind: 'engines' }, { from: 14, to: 15, kind: 'deck' },
  ],
  pads: [
    { path: 0, at: 0.9, d: 0.4 }, { path: 0, at: 2.2, d: -0.4 }, { path: 0, at: 5.2, d: 0 }, { path: 0, at: 7.4, d: 0 },
    { path: 0, at: 9.2, d: 0.5 }, { path: 0, at: 10.55, d: 0 }, { path: 0, at: 13.3, d: 0 }, { path: 0, at: 14.5, d: -0.3 },
    { path: 1, at: 0.5, d: 0 }, { path: 2, at: 0.35, d: 0 }, { path: 2, at: 0.65, d: 0 },
  ],
  capital: { from: 0.95, to: 2.75, side: 1, dist: 150, height: 45 },
};

// Open-space battle zone. The ring is only a reference line (drops and the capital
// ship are placed relative to it); ships fly freely inside arenaRadius.
const RING = 520;
export const ARENA: TrackDef = {
  id: 'arena', name: 'BATTLE ZONE', scale: 1, yScale: 1, step: 6, checkpoints: 4,
  main: Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2) * RING, 0, Math.sin((i / 12) * Math.PI * 2) * RING, 40]),
  branches: [],
  sections: [{ from: 0, to: 12, kind: 'open' }],
  pads: [],
  capital: { from: 1, to: 5, side: -1, dist: 150, height: 62 },
  arenaRadius: 1150,
};
