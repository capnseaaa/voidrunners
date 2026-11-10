// Procedural placement of boost pads, salvage pickups and hazards for a race.
// Seeded so each race has a stable layout.
import { Vector3 } from 'three';
import type { RaceDef } from '../data/campaign';
import { Rng } from '../core/rng';
import { mainIdxAtU, newFrame, pointAt, sectionAt, type Track, type TrackPath } from '../tracks/track';

export type ObstacleKind = 'pylon' | 'traffic' | 'asteroid' | 'debris' | 'rock' | 'vent' | 'mine';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  path: number;
  s: number; d: number; baseS: number; baseD: number;
  x: number; y: number; z: number;
  r: number;
  solid: boolean;
  hp: number; maxHp: number; // maxHp 0 = indestructible
  alive: boolean; respawnT: number; respawnDelay: number;
  speed: number; // along-path motion (traffic)
  amp: number; freq: number; phase: number; // lateral drift
  period: number; timer: number; active: boolean; // vents
  seed: number;
}

export interface Pad { path: number; s: number; d: number; x: number; y: number; z: number; hx: number; hz: number; r: number }

export type PickupKind = 'scrap' | 'core' | 'cargo' | 'overdrive' | 'missile';

export interface Pickup {
  kind: PickupKind;
  value: number;
  path: number; s: number; d: number;
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number; // home position
  active: boolean;
  respawnT: number;
  dynamic: boolean; ttl: number;
  vx: number; vy: number; vz: number;
}

export interface Layout { pads: Pad[]; obstacles: Obstacle[]; pickups: Pickup[] }

const tmp = new Vector3();
const fr = newFrame();

export function makePickup(kind: PickupKind, value: number, path: number, s: number, d: number, x: number, y: number, z: number, dynamic = false, ttl = 0): Pickup {
  return { kind, value, path, s, d, x, y, z, hx: x, hy: y, hz: z, active: true, respawnT: 0, dynamic, ttl, vx: 0, vy: 0, vz: 0 };
}

function hwAt(path: TrackPath, s: number): number {
  pointAt(path, s, 0, tmp, fr);
  return fr.hw;
}

export function buildLayout(track: Track, race: RaceDef): Layout {
  const rng = new Rng(race.seed);
  const L = track.length;
  const main = track.main;
  const pads: Pad[] = [];
  const obstacles: Obstacle[] = [];
  const pickups: Pickup[] = [];

  // ---------------------------------------------------------------- pads
  for (const p of track.def.pads) {
    const path = track.paths[p.path];
    const s = p.path === 0 ? main.samples[mainIdxAtU(track, p.at)].s : p.at * path.length;
    const hw = hwAt(path, s);
    const d = p.d * Math.max(0, hw - 7);
    pointAt(path, s, d, tmp, fr);
    pads.push({ path: p.path, s, d, x: tmp.x, y: tmp.y, z: tmp.z, hx: fr.hx, hz: fr.hz, r: 6 });
  }

  // main-line exclusion zones (progress ranges) where no hazards are placed
  const zones: [number, number][] = [[L - 300, L + 1], [-1, 220]];
  for (let i = 1; i < track.paths.length; i++) {
    const b = track.paths[i];
    const fromS = main.samples[b.fromIdx].s, toS = main.samples[b.toIdx].s;
    zones.push([fromS - 50, fromS + b.forkEnd * b.step + 40]);
    zones.push([toS - (b.samples.length - 1 - b.mergeStart) * b.step - 40, toS + 50]);
  }
  zones.push([track.capitalFromS - 60, track.capitalToS + 60]);
  const excluded = (s: number) => zones.some(([a, b]) => s >= a && s <= b);
  const nearPad = (path: number, s: number) => pads.some((p) => p.path === path && Math.abs(p.s - s) < 40);

  let oid = 0;
  const addObstacle = (kind: ObstacleKind, path: number, s: number, d: number, r: number): Obstacle => {
    const pth = track.paths[path];
    pointAt(pth, s, d, tmp, fr);
    const o: Obstacle = {
      id: oid++, kind, path, s, d, baseS: s, baseD: d, x: tmp.x, y: tmp.y, z: tmp.z, r,
      solid: kind !== 'vent', hp: 0, maxHp: 0, alive: true, respawnT: 0, respawnDelay: 30,
      speed: 0, amp: 0, freq: 0, phase: rng.range(0, 6.28), period: 0, timer: 0, active: false, seed: rng.next(),
    };
    if (kind === 'traffic') { o.maxHp = 40; o.speed = rng.range(28, 44); o.respawnDelay = 18; }
    if (kind === 'asteroid') { o.maxHp = 30 + r * 10; o.respawnDelay = 45; }
    if (kind === 'debris') { o.maxHp = 45; o.respawnDelay = 45; }
    if (kind === 'mine') { o.maxHp = 10; o.respawnDelay = 28; }
    if (kind === 'vent') { o.period = rng.range(3.4, 4.6); o.timer = rng.range(0, 4); }
    o.hp = o.maxHp;
    obstacles.push(o);
    return o;
  };

  const placeOnMain = (kind: ObstacleKind, count: number, rMin: number, rMax: number, filter?: (sec: string) => boolean): void => {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 40) {
      tries++;
      const s = rng.range(0, L);
      if (excluded(s) || nearPad(0, s)) continue;
      const smp = main.samples[Math.floor(s / main.step) % main.samples.length];
      if (filter && !filter(sectionAt(track, smp.u))) continue;
      if (obstacles.some((o) => o.path === 0 && Math.abs(o.baseS - s) < 48)) continue;
      const r = rng.range(rMin, rMax);
      const room = smp.hw - r - 1.5;
      const d = rng.range(-room, room);
      const o = addObstacle(kind, 0, s, d, r);
      if (kind === 'asteroid' && rng.chance(0.4)) { o.amp = Math.min(room - Math.abs(d), rng.range(4, 10)); o.freq = rng.range(0.25, 0.6); }
      placed++;
    }
  };

  const hz = race.hazard;
  switch (track.def.id) {
    case 'neon':
      placeOnMain('pylon', Math.round(10 * hz), 2.2, 2.8);
      placeOnMain('traffic', Math.round(13 * hz), 3.2, 3.6);
      break;
    case 'orbit':
      placeOnMain('asteroid', Math.round(30 * hz), 3, 6.5);
      placeOnMain('debris', Math.round(8 * hz), 3, 4.5, (s) => s === 'wreck' || s === 'dense');
      break;
    case 'solar':
      placeOnMain('rock', Math.round(15 * hz), 3, 4.2);
      placeOnMain('vent', Math.round(11 * hz), 6, 7);
      break;
    case 'warzone':
      placeOnMain('debris', Math.round(18 * hz), 3, 5);
      placeOnMain('mine', Math.round(15 * hz), 2, 2);
      break;
  }

  // Branch hazards: alternating-side blockers so there is always a clear lane.
  const branchKind: Record<string, ObstacleKind[]> = {
    neon: ['pylon', 'traffic'], orbit: ['asteroid', 'asteroid'], solar: ['rock', 'vent'], warzone: ['debris', 'mine'],
  };
  for (let i = 1; i < track.paths.length; i++) {
    const b = track.paths[i];
    const start = (b.forkEnd + 6) * b.step, end = (b.mergeStart - 6) * b.step;
    const spacing = b.kind === 'shortcut' ? 115 : 85;
    let side = rng.sign();
    for (let s = start + 30; s < end - 20; s += spacing * rng.range(0.85, 1.15)) {
      if (nearPad(i, s)) continue;
      const hw = hwAt(b, s);
      const kinds = branchKind[track.def.id];
      let kind = b.kind === 'shortcut' ? kinds[0] : rng.pick(kinds);
      if (kind === 'traffic') kind = 'pylon';
      const r = kind === 'vent' ? 4.5 : kind === 'mine' ? 2 : 2.4;
      addObstacle(kind, i, s, side * hw * 0.48, r);
      side = -side;
    }
  }

  // ------------------------------------------------------------- pickups
  const addPickup = (kind: PickupKind, value: number, path: number, s: number, d: number): void => {
    const pth = track.paths[path];
    pointAt(pth, s, d, tmp, fr);
    pickups.push(makePickup(kind, value, path, s, d, tmp.x, tmp.y + 1.6, tmp.z));
  };
  let s = 260;
  let cluster = 0;
  while (s < L - 200) {
    const hw = hwAt(main, s);
    const d0 = rng.range(-(hw - 7), hw - 7);
    const blocked = (ss: number, dd: number) => obstacles.some((o) => o.path === 0 && Math.abs(o.baseS - ss) < o.r + 6 && Math.abs(o.baseD - dd) < o.r + o.amp + 4);
    if (cluster % 9 === 4) {
      if (!blocked(s, d0)) addPickup('missile', 2, 0, s, d0);
    } else if (rng.chance(0.5)) {
      for (let k = 0; k < 4; k++) if (!blocked(s + k * 10, d0)) addPickup(k === 3 && rng.chance(0.3) ? 'core' : 'scrap', k === 3 ? 1 : 1, 0, s + k * 10, d0);
    } else {
      for (let k = -1; k <= 1; k++) { const dd = Math.max(-(hw - 4), Math.min(hw - 4, d0 + k * 7)); if (!blocked(s, dd)) addPickup('scrap', 1, 0, s, dd); }
    }
    cluster++;
    s += rng.range(230, 330);
  }
  for (const p of pickups) if (p.kind === 'core') p.value = 3;
  for (let i = 1; i < track.paths.length; i++) {
    const b = track.paths[i];
    const start = (b.forkEnd + 8) * b.step, end = (b.mergeStart - 8) * b.step;
    const n = b.kind === 'shortcut' ? 3 : 7;
    for (let k = 0; k < n; k++) {
      const ss = start + ((end - start) * (k + 0.5)) / n;
      const hw = hwAt(b, ss);
      let d = rng.range(-(hw - 4), hw - 4);
      const o = obstacles.find((ob) => ob.path === i && Math.abs(ob.baseS - ss) < 14);
      if (o) d = -Math.sign(o.baseD || 1) * hw * 0.4;
      addPickup('core', 3, i, ss, d);
    }
  }
  return { pads, obstacles, pickups };
}
