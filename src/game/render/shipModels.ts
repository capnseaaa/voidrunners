// Procedural ship models. Every ship is assembled from primitives and merged
// into a handful of meshes (one per material). All ships face +Z.
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, CylinderGeometry, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  SphereGeometry, Sprite, SpriteMaterial, Texture, Vector3,
} from 'three';
import type { ShipDef } from '../data/ships';
import { Kit, plate, taperBox, zCyl } from './util';

export interface ShipModel {
  group: Group; // root (position / yaw)
  body: Group; // banked / pitched child
  engines: Vector3[]; // nozzle positions in body space
  engineR: number;
  flames: Mesh[];
  sprites: Sprite[];
  materials: Material[];
  dispose(): void;
}

type Eng = [number, number, number]; // x, y, radius

interface Ctx { kit: Kit; engines: Eng[]; engineZ: number }

const box = (w: number, h: number, d: number): BufferGeometry => new BoxGeometry(w, h, d);
const disc = (r: number, h: number, seg = 16): BufferGeometry => new CylinderGeometry(r, r, h, seg);

function mirrorPlate(pts: number[][], side: number): number[][] {
  return pts.map((p) => [p[0] * side, p[1]]);
}

function wings(k: Kit, mat: string, pts: number[][], y: number, dihedral = 0, t = 0.09): void {
  k.add(mat, plate(mirrorPlate(pts, 1), t), 0, y, 0, 0, 0, dihedral);
  k.add(mat, plate(mirrorPlate(pts, -1), t), 0, y, 0, 0, 0, -dihedral);
}

/** Vertical fin from an outline given as (height, z). */
function fin(k: Kit, mat: string, pts: number[][], x: number, y: number, cant = 0, t = 0.08): void {
  k.add(mat, plate(pts, t), x, y, 0, 0, 0, Math.PI / 2 + cant);
}

function engine(c: Ctx, x: number, y: number, r: number, len: number, z: number, mat = 'dark'): void {
  c.kit.add(mat, zCyl(r * 0.92, r, len, 14), x, y, z + len / 2);
  c.kit.add('chrome', zCyl(r * 1.08, r * 1.02, len * 0.22, 14), x, y, z + len * 0.1);
  c.kit.add('glow', zCyl(r * 0.6, r * 0.6, 0.06, 14), x, y, z + 0.12);
  c.engines.push([x, y, r]);
  c.engineZ = Math.min(c.engineZ, z);
}

function guns(k: Kit, x: number, y: number, z: number, len: number, r = 0.1): void {
  for (const s of [1, -1]) {
    k.add('chrome', zCyl(r, r, len, 8), s * x, y, z);
    k.add('dark', zCyl(r * 1.5, r * 1.5, len * 0.18, 8), s * x, y, z + len * 0.42);
  }
}

const BUILDERS: Record<string, (c: Ctx) => void> = {
  // ------------------------------------------------------------ COMET
  comet(c) {
    const k = c.kit;
    k.add('trim', taperBox(0.95, 0.72, 3.6, 0.12, 0.2), 0, 0.05, 1.5);
    k.add('hull', taperBox(1.25, 0.95, 1.9, 0.76, 0.76, 0.9, 0.95), 0, 0.05, -1.0);
    k.add('hull', box(0.5, 0.06, 2.4), 0, 0.42, 1.2);
    engine(c, 0, 0.1, 1.02, 2.3, -3.2, 'chrome');
    k.add('dark', zCyl(1.18, 1.1, 0.5, 14), 0, 0.1, -3.0);
    wings(k, 'hull', [[0.5, 0.3], [2.7, -1.9], [2.7, -2.6], [0.5, -1.5]], 0.0, 0.06);
    wings(k, 'trim', [[1.2, -0.75], [2.0, -1.5], [2.0, -1.75], [1.2, -1.2]], 0.07, 0.06, 0.04);
    for (const s of [1, -1]) { k.add('chrome', zCyl(0.13, 0.13, 1.5, 8), s * 2.7, 0.14 * 1, -2.2); k.add('glow', box(0.06, 0.06, 0.8), s * 2.7, 0.3, -2.2); }
    fin(k, 'trim', [[0, -0.8], [1.35, -2.6], [1.35, -3.1], [0, -2.3]], 0, 0.45);
    k.add('canopy', taperBox(0.52, 0.36, 1.3, 0.35, 0.4), 0, 0.5, 0.75);
    guns(k, 0.42, -0.22, 1.7, 1.2, 0.07);
  },
  // ---------------------------------------------------------- BRUISER
  bruiser(c) {
    const k = c.kit;
    k.add('hull', taperBox(2.7, 1.25, 3.7, 0.68, 0.6), 0, 0, 0.2);
    for (const s of [1, -1]) {
      k.add('trim', taperBox(1.25, 1.05, 2.9, 0.75, 0.7), s * 1.75, -0.02, -0.5);
      k.add('dark', box(0.12, 0.7, 2.0), s * 2.42, 0, -0.6);
      k.add('hull', plate(mirrorPlate([[0, 0.4], [1.0, -0.2], [1.0, -1.5], [0, -1.3]], s), 0.16), s * 2.35, 0.1, -0.4);
      k.add('chrome', zCyl(0.24, 0.24, 2.8, 10), s * 1.3, -0.18, 1.9);
      k.add('dark', box(0.62, 0.5, 0.5), s * 1.3, -0.18, 3.1);
      k.add('dark', box(0.7, 0.6, 1.1), s * 1.3, -0.18, 0.9);
      k.add('glow', box(0.08, 0.08, 1.6), s * 0.95, 0.64, 0.2);
    }
    k.add('dark', taperBox(1.9, 0.5, 1.3, 0.45, 0.6), 0, -0.35, 2.5);
    k.add('trim', taperBox(1.3, 0.55, 1.6, 0.8, 0.7), 0, 0.8, -0.5);
    k.add('canopy', box(0.95, 0.2, 0.55), 0, 0.68, 0.85);
    k.add('chrome', disc(0.35, 0.2), 0, 1.15, -0.7);
    for (const [x, y] of [[0.72, 0.36], [-0.72, 0.36], [0.72, -0.34], [-0.72, -0.34]]) engine(c, x, y, 0.44, 1.2, -2.5);
    fin(k, 'hull', [[0, -1.0], [0.8, -1.9], [0.8, -2.4], [0, -2.2]], 1.6, 0.5, -0.2, 0.14);
    fin(k, 'hull', [[0, -1.0], [0.8, -1.9], [0.8, -2.4], [0, -2.2]], -1.6, 0.5, 0.2, 0.14);
  },
  // ---------------------------------------------------------- PHANTOM
  phantom(c) {
    const k = c.kit;
    k.add('hull', taperBox(0.72, 0.5, 4.8, 0.08, 0.16), 0, 0, 0.7);
    for (const s of [1, -1]) {
      k.add('trim', taperBox(0.36, 0.36, 3.7, 0.25, 0.35), s * 1.1, 0, -0.4);
      k.add('glow', box(0.05, 0.75, 1.0), s * 2.95, 0.22, 0.75);
      k.add('glow', box(0.05, 0.05, 2.6), s * 1.1, 0.2, -0.4);
      k.add('hull', plate([[0, 0], [0.95, -0.9], [0.95, -1.45], [0, -0.95]], 0.06), s * 1.1, 0.12, -1.5, 0, 0, Math.PI / 2 - s * 0.55);
    }
    wings(k, 'hull', [[0.3, -1.6], [2.95, 1.2], [2.95, 0.5], [0.95, -2.3], [0.3, -2.3]], 0, 0, 0.07);
    wings(k, 'trim', [[0.3, 0.7], [1.5, 0.35], [1.5, 0.1], [0.3, 0.1]], -0.05, 0, 0.05);
    k.add('canopy', taperBox(0.42, 0.3, 1.5, 0.25, 0.35), 0, 0.36, 0.45);
    k.add('glow', box(0.07, 0.05, 3.2), 0, 0.27, 0.6);
    engine(c, 1.1, 0, 0.3, 1.0, -2.75, 'chrome');
    engine(c, -1.1, 0, 0.3, 1.0, -2.75, 'chrome');
    guns(k, 0.28, -0.2, 2.0, 1.0, 0.06);
  },
  // ---------------------------------------------------------- VULTURE
  vulture(c) {
    const k = c.kit;
    k.add('hull', taperBox(1.85, 1.1, 3.3, 0.92, 0.82, 0.8, 0.85), 0, 0, -0.3);
    k.add('trim', taperBox(2.2, 1.0, 0.85, 1.14, 1.1), 0, -0.08, 1.7);
    k.add('dark', box(1.95, 0.66, 0.5), 0, -0.08, 2.05);
    for (const y of [-0.26, 0.1]) k.add('glow', box(1.7, 0.07, 0.08), 0, y, 2.32);
    for (const s of [1, -1]) {
      k.add('chrome', taperBox(0.3, 0.3, 2.7, 0.55, 0.55), s * 1.72, -0.22, 1.25, 0, s * 0.22, 0);
      k.add('glow', box(0.14, 0.55, 0.5), s * 2.0, -0.22, 2.7);
      k.add('trim', box(0.7, 0.05, 0.3), s * 1.8, 0.31, -1.0);
      k.add('trim', box(0.7, 0.05, 0.3), s * 1.8, 0.31, -0.4);
    }
    wings(k, 'hull', [[0.8, 0.4], [2.5, -0.6], [2.7, -1.9], [0.8, -1.7]], 0.2, 0.2, 0.12);
    k.add('chrome', disc(0.72, 0.1), 0, 0.92, -0.7, 0.25, 0, 0);
    k.add('dark', disc(0.1, 0.5, 8), 0, 0.72, -0.7);
    k.add('glow', disc(0.2, 0.14, 10), 0, 0.98, -0.72, 0.25, 0, 0);
    k.add('canopy', taperBox(0.85, 0.42, 1.05, 0.6, 0.5), 0, 0.62, 0.65);
    engine(c, 0.78, 0.05, 0.5, 1.3, -2.7);
    engine(c, -0.78, 0.05, 0.5, 1.3, -2.7);
    fin(k, 'trim', [[0, -1.0], [0.9, -2.0], [0.9, -2.5], [0, -2.1]], 0, 0.5);
  },
  // ------------------------------------------------------ AI: STILETTO
  stiletto(c) {
    const k = c.kit;
    k.add('hull', taperBox(0.8, 0.62, 4.4, 0.1, 0.18), 0, 0, 1.0);
    k.add('hull', taperBox(1.0, 0.7, 1.6, 0.8, 0.88), 0, 0, -1.6);
    wings(k, 'trim', [[0.4, -0.3], [2.3, -2.0], [2.3, -2.5], [0.4, -2.2]], 0, 0.05, 0.07);
    wings(k, 'trim', [[0.3, 1.9], [1.1, 1.3], [1.1, 1.1], [0.3, 1.3]], 0.05, 0, 0.05);
    fin(k, 'trim', [[0, -1.0], [1.5, -2.5], [1.5, -2.9], [0, -2.4]], 0, 0.3);
    k.add('canopy', taperBox(0.45, 0.32, 1.4, 0.3, 0.4), 0, 0.38, 0.5);
    k.add('glow', box(0.82, 0.05, 0.12), 0, 0.2, -0.6);
    engine(c, 0.36, 0, 0.36, 1.1, -3.0, 'chrome');
    engine(c, -0.36, 0, 0.36, 1.1, -3.0, 'chrome');
    guns(k, 0.5, -0.15, 1.2, 1.3, 0.06);
  },
  // -------------------------------------------------------- AI: PUDDLE
  puddle(c) {
    const k = c.kit;
    k.add('hull', taperBox(1.7, 1.3, 2.6, 0.55, 0.6, 0.75, 0.8), 0, 0.1, 0.2);
    k.add('trim', taperBox(1.0, 0.7, 1.0, 0.4, 0.5), 0, 0, 1.9);
    wings(k, 'trim', [[0.7, 0.3], [2.3, 0.1], [2.3, -0.8], [0.7, -1.0]], 0.0, 0, 0.14);
    for (const s of [1, -1]) k.add('hull', zCyl(0.22, 0.22, 1.3, 10), s * 2.3, 0, -0.35);
    k.add('canopy', new SphereGeometry(0.62, 12, 8), 0, 0.72, 0.4, 0, 0, 0, 1, 0.8, 1.2);
    k.add('chrome', disc(0.03, 1.1, 6), 0.4, 1.1, -0.6);
    k.add('glow', new SphereGeometry(0.09, 8, 6), 0.4, 1.66, -0.6);
    fin(k, 'hull', [[0, -0.5], [0.9, -1.1], [0.9, -1.6], [0, -1.5]], 0, 0.7);
    engine(c, 0, 0.1, 0.7, 1.3, -2.3);
  },
  // ------------------------------------------------------ AI: IRONCLAD
  ironclad(c) {
    const k = c.kit;
    k.add('hull', taperBox(2.5, 1.2, 4.0, 0.6, 0.65), 0, 0, 0);
    for (const s of [1, -1]) {
      k.add('trim', box(0.5, 1.3, 3.0), s * 1.55, -0.1, -0.3);
      k.add('hull', plate(mirrorPlate([[0, 0.2], [0.9, -0.4], [0.9, -1.3], [0, -1.3]], s), 0.2), s * 1.8, 0.2, -0.5);
      k.add('chrome', zCyl(0.16, 0.16, 2.2, 8), s * 0.42, 0.95, 0.9);
    }
    k.add('trim', disc(0.75, 0.45, 8), 0, 0.82, -0.2);
    k.add('dark', box(1.0, 0.3, 0.8), 0, 0.95, 0.2);
    k.add('canopy', box(1.1, 0.22, 0.4), 0, 0.5, 1.5);
    k.add('glow', box(0.5, 0.08, 0.08), 0, 0.3, 2.02);
    for (const x of [-0.8, 0, 0.8]) engine(c, x, 0, 0.42, 1.1, -2.8);
    fin(k, 'trim', [[0, -1.1], [0.7, -1.7], [0.7, -2.2], [0, -2.1]], 1.0, 0.55, 0, 0.16);
    fin(k, 'trim', [[0, -1.1], [0.7, -1.7], [0.7, -2.2], [0, -2.1]], -1.0, 0.55, 0, 0.16);
  },
  // -------------------------------------------------------- AI: MAGPIE
  magpie(c) {
    const k = c.kit;
    k.add('hull', taperBox(1.3, 0.9, 3.6, 0.5, 0.6), 0, 0.1, 0.2);
    for (const s of [1, -1]) {
      k.add('trim', taperBox(0.9, 0.9, 2.0, 0.85, 0.85, 0.85, 0.85), s * 1.45, -0.1, -0.5);
      k.add('dark', box(0.94, 0.12, 2.04), s * 1.45, -0.1, -0.5);
      k.add('chrome', taperBox(0.18, 0.18, 1.8, 0.5, 0.5), s * 0.9, -0.3, 2.2, 0, s * 0.35, 0);
      k.add('glow', box(0.1, 0.3, 0.3), s * 1.22, -0.3, 3.0);
    }
    wings(k, 'hull', [[1.8, 0.2], [2.9, -0.9], [2.9, -1.6], [1.8, -1.4]], 0.1, -0.15, 0.1);
    k.add('canopy', taperBox(0.6, 0.35, 1.0, 0.5, 0.5), 0, 0.62, 0.8);
    k.add('chrome', disc(0.45, 0.08), 0, 0.72, -0.9, 0.3, 0, 0);
    engine(c, 0.5, 0.1, 0.42, 1.2, -2.7);
    engine(c, -0.5, 0.1, 0.42, 1.2, -2.7);
  },
  // -------------------------------------------------------- AI: WRAITH
  wraith(c) {
    const k = c.kit;
    wings(k, 'hull', [[0, 2.8], [3.0, -1.6], [2.4, -2.0], [1.0, -1.2], [0, -2.0]], 0, 0.04, 0.16);
    k.add('trim', taperBox(0.9, 0.42, 3.4, 0.2, 0.3), 0, 0.14, 0.4);
    k.add('canopy', taperBox(0.5, 0.2, 1.3, 0.3, 0.4), 0, 0.38, 0.5);
    for (const s of [1, -1]) { k.add('glow', box(0.05, 0.05, 1.7), s * 1.9, 0.11, -0.9, 0, s * 0.62, 0); }
    engine(c, 0.55, 0.05, 0.26, 0.9, -2.3, 'trim');
    engine(c, -0.55, 0.05, 0.26, 0.9, -2.3, 'trim');
  },
  // ------------------------------------------------------- AI: HELLION
  hellion(c) {
    const k = c.kit;
    k.add('hull', taperBox(1.1, 0.8, 3.8, 0.3, 0.4), 0, 0, 0.3);
    for (const s of [1, -1]) {
      k.add('trim', taperBox(0.22, 0.22, 2.2, 0.05, 0.05), s * 0.85, -0.1, 2.3);
      k.add('trim', taperBox(0.16, 0.16, 1.4, 0.05, 0.05), s * 2.3, 0.05, 0.4);
      k.add('chrome', zCyl(0.15, 0.15, 2.0, 8), s * 0.5, -0.35, 1.6);
      fin(k, 'trim', [[0, -1.0], [1.2, -2.3], [1.0, -2.6], [0, -2.0]], s * 0.5, 0.3, -s * 0.5);
    }
    wings(k, 'hull', [[0.5, 0.4], [2.3, -0.2], [1.6, -0.8], [2.5, -1.7], [1.4, -1.5], [0.5, -2.0]], 0, 0, 0.09);
    k.add('canopy', taperBox(0.5, 0.3, 1.1, 0.3, 0.4), 0, 0.46, 0.5);
    k.add('glow', box(0.9, 0.06, 0.1), 0, 0.3, 1.3);
    engine(c, 0.45, 0, 0.4, 1.1, -2.7);
    engine(c, -0.45, 0, 0.4, 1.1, -2.7);
  },
  // ------------------------------------------------------ AI: OLDGUARD
  oldguard(c) {
    const k = c.kit;
    k.add('hull', taperBox(1.1, 0.9, 4.2, 0.3, 0.4), 0, 0, 0.3);
    k.add('trim', zCyl(0.5, 0.2, 0.9, 12), 0, 0, 2.85);
    wings(k, 'trim', [[0.5, 0.6], [2.6, 0.0], [2.6, -0.8], [0.5, -1.2]], -0.05, 0.06, 0.11);
    for (const s of [1, -1]) { k.add('hull', zCyl(0.2, 0.2, 1.7, 10), s * 2.6, 0.1, -0.4); k.add('chrome', zCyl(0.02, 0.2, 0.4, 10), s * 2.6, 0.1, 0.65); }
    wings(k, 'trim', [[0.4, -1.5], [1.4, -1.9], [1.4, -2.3], [0.4, -2.3]], 0.1, 0, 0.08);
    fin(k, 'hull', [[0, -1.0], [1.3, -2.0], [1.3, -2.4], [0, -2.3]], 0, 0.4);
    k.add('canopy', taperBox(0.55, 0.36, 1.3, 0.4, 0.4), 0, 0.52, 0.7);
    k.add('glow', box(0.06, 0.06, 1.2), 0, -0.47, 0.6);
    engine(c, 0.4, 0, 0.38, 1.0, -2.6, 'chrome');
    engine(c, -0.4, 0, 0.38, 1.0, -2.6, 'chrome');
  },
  // ------------------------------------------------------- AI: PEACOCK
  peacock(c) {
    const k = c.kit;
    k.add('hull', taperBox(0.85, 0.6, 4.4, 0.15, 0.25), 0, 0, 0.6);
    wings(k, 'hull', [[0.35, 0.8], [3.1, -1.8], [3.1, -2.2], [1.6, -1.5], [0.35, -1.7]], 0, 0.1, 0.07);
    wings(k, 'trim', [[0.9, -0.1], [2.9, -1.85], [2.9, -2.0], [0.9, -0.5]], 0.06, 0.1, 0.05);
    for (const cant of [-0.7, 0, 0.7]) fin(k, cant === 0 ? 'trim' : 'glow', [[0, -1.2], [1.3, -2.5], [1.3, -2.8], [0, -2.1]], 0, 0.25, cant, 0.05);
    k.add('canopy', taperBox(0.45, 0.3, 1.3, 0.3, 0.4), 0, 0.36, 0.7);
    engine(c, 0, 0, 0.44, 1.2, -2.8, 'chrome');
    engine(c, 0.85, -0.05, 0.2, 0.8, -2.2, 'trim');
    engine(c, -0.85, -0.05, 0.2, 0.8, -2.2, 'trim');
  },
  // ------------------------------------------------------ AI: CONTRACT
  contract(c) {
    const k = c.kit;
    k.add('hull', taperBox(1.6, 1.0, 3.8, 0.6, 0.6), 0, 0, 0.1);
    k.add('dark', new SphereGeometry(0.42, 10, 8), 0, -0.45, 1.5);
    k.add('glow', new SphereGeometry(0.16, 8, 6), 0, -0.6, 1.8);
    wings(k, 'hull', [[0.8, 0.2], [2.4, -0.1], [2.4, -1.0], [0.8, -1.3]], 0.05, 0, 0.14);
    for (const s of [1, -1]) {
      for (const x of [1.3, 1.9]) { k.add('trim', zCyl(0.15, 0.15, 1.5, 8), s * x, -0.2, -0.3); k.add('glow', zCyl(0.02, 0.15, 0.3, 8), s * x, -0.2, 0.6); }
      fin(k, 'trim', [[0, -1.0], [1.0, -2.0], [1.0, -2.4], [0, -2.1]], s * 0.6, 0.45, -s * 0.25);
    }
    k.add('canopy', taperBox(0.75, 0.35, 1.1, 0.6, 0.5), 0, 0.6, 0.9);
    k.add('trim', box(1.62, 0.12, 0.5), 0, 0.2, -0.9);
    engine(c, 0.5, 0, 0.42, 1.1, -2.7);
    engine(c, -0.5, 0, 0.42, 1.1, -2.7);
  },
};

export function buildShipModel(def: ShipDef, glowTex: Texture): ShipModel {
  const col = def.colors;
  const mats: Record<string, Material> = {
    hull: new MeshStandardMaterial({ color: col.primary, metalness: 0.55, roughness: 0.34 }),
    trim: new MeshStandardMaterial({ color: col.secondary, metalness: 0.6, roughness: 0.32 }),
    chrome: new MeshStandardMaterial({ color: 0xe8ecf4, metalness: 1, roughness: 0.12 }),
    dark: new MeshStandardMaterial({ color: 0x16161d, metalness: 0.7, roughness: 0.5 }),
    canopy: new MeshStandardMaterial({ color: 0x0a1626, metalness: 0.9, roughness: 0.08, emissive: new Color(col.glow).multiplyScalar(0.12) }),
    glow: new MeshBasicMaterial({ color: new Color(col.glow).multiplyScalar(1.25) }),
  };
  const ctx: Ctx = { kit: new Kit(), engines: [], engineZ: 0 };
  (BUILDERS[def.model] ?? BUILDERS.oldguard)(ctx);
  const body = ctx.kit.build(mats);
  const group = new Group();
  group.add(body);

  const flameMat = new MeshBasicMaterial({ color: col.glow, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false });
  const coreMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false });
  const spriteMat = new SpriteMaterial({ map: glowTex, color: col.glow, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 });
  const flames: Mesh[] = [];
  const sprites: Sprite[] = [];
  const engines: Vector3[] = [];
  let engineR = 0.4;
  const flameGeo = zCyl(0.03, 0.8, 1, 10, true);
  flameGeo.translate(0, 0, -0.5);
  for (const [x, y, r] of ctx.engines) {
    const outer = new Mesh(flameGeo, flameMat);
    outer.position.set(x, y, ctx.engineZ - 0.02);
    outer.scale.set(r, r, 2);
    const inner = new Mesh(flameGeo, coreMat);
    inner.scale.set(0.45, 0.45, 0.6);
    outer.add(inner);
    body.add(outer);
    flames.push(outer);
    const sp = new Sprite(spriteMat);
    sp.position.set(x, y, ctx.engineZ - 0.2);
    sp.scale.setScalar(r * 5);
    body.add(sp);
    sprites.push(sp);
    engines.push(new Vector3(x, y, ctx.engineZ));
    engineR = Math.max(engineR, r);
  }
  const materials = [...Object.values(mats), flameMat, coreMat, spriteMat];
  return {
    group, body, engines, engineR, flames, sprites, materials,
    dispose() {
      body.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); });
      flameGeo.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
