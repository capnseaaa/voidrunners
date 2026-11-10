// Shared procedural geometry / texture helpers for the renderer.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, ExtrudeGeometry, Group, IcosahedronGeometry,
  LinearFilter, Material, Matrix4, Mesh, Object3D, RepeatWrapping, Shape, SRGBColorSpace, Texture, Vector3, Euler, Quaternion,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const v3 = new Vector3();
const s3 = new Vector3();

/** Collects geometry per material key and merges it into one mesh per material. */
export class Kit {
  private readonly parts = new Map<string, BufferGeometry[]>();

  add(mat: string, geo: BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (geo.index) geo.dispose();
    m4.compose(v3.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s3.set(sx, sy, sz));
    g.applyMatrix4(m4);
    // keep only the attributes every part shares so merging never fails
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    let list = this.parts.get(mat);
    if (!list) { list = []; this.parts.set(mat, list); }
    list.push(g);
    return this;
  }

  /** Mirror helper: adds the part at +x and -x. */
  pair(mat: string, make: (side: number) => BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    this.add(mat, make(1), x, y, z, rx, ry, rz);
    this.add(mat, make(-1), -x, y, z, rx, -ry, -rz);
    return this;
  }

  build(materials: Record<string, Material>): Group {
    const group = new Group();
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeVertexNormals();
      const mesh = new Mesh(merged, materials[key] ?? materials.hull);
      mesh.name = key;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** Box whose +z end is scaled by (tx, ty) - a wedge / tapered hull section. */
export function taperBox(w: number, h: number, d: number, tx = 1, ty = 1, bx = 1, by = 1): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const front = p.getZ(i) > 0;
    p.setX(i, p.getX(i) * (front ? tx : bx));
    p.setY(i, p.getY(i) * (front ? ty : by));
  }
  g.computeVertexNormals();
  return g;
}

/** Cylinder along the z axis. r0 at -z, r1 at +z. */
export function zCyl(r0: number, r1: number, len: number, seg = 12, open = false): BufferGeometry {
  const g = new CylinderGeometry(r1, r0, len, seg, 1, open);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Flat plate from an outline in the (x, z) plane, extruded to a thickness in y. */
export function plate(points: number[][], thickness: number): BufferGeometry {
  const shape = new Shape();
  points.forEach((p, i) => (i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1])));
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  return g;
}

/** Lumpy rock from a displaced icosahedron. */
export function rockGeometry(seed: number, detail = 1, rough = 0.35): BufferGeometry {
  const rng = new Rng(seed);
  const base = new IcosahedronGeometry(1, detail);
  const g = base.index ? base.toNonIndexed() : base.clone();
  base.dispose();
  const p = g.attributes.position;
  const cache = new Map<string, number>();
  const sx = rng.range(0.7, 1.3), sy = rng.range(0.6, 1.1), sz = rng.range(0.7, 1.3);
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) { k = 1 + rng.range(-rough, rough); cache.set(key, k); }
    p.setXYZ(i, p.getX(i) * k * sx, p.getY(i) * k * sy, p.getZ(i) * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat = true): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) { t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

/** Soft radial glow sprite texture. */
export function glowTexture(): Texture {
  const t = canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  }, false);
  t.minFilter = LinearFilter;
  return t;
}

/** Random lit-window pattern used on buildings and capital ship hulls. */
export function windowTexture(seed: number, colors: string[], density = 0.35): CanvasTexture {
  const rng = new Rng(seed);
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    const cols = 16, rows = 32;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!rng.chance(density)) continue;
      ctx.fillStyle = rng.pick(colors);
      ctx.globalAlpha = rng.range(0.5, 1);
      ctx.fillRect(x * (w / cols) + 3, y * (h / rows) + 2, w / cols - 6, h / rows - 5);
    }
    ctx.globalAlpha = 1;
  });
}

export function hex(c: number): string {
  return '#' + new Color(c).getHexString();
}

/** Dispose every geometry, material and texture under an object. */
export function disposeObject(root: Object3D): void {
  const seen = new Set<unknown>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.geometry && !seen.has(mesh.geometry)) { seen.add(mesh.geometry); mesh.geometry.dispose(); }
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const v of Object.values(m as unknown as Record<string, unknown>)) {
        if (v && (v as Texture).isTexture && !seen.has(v)) { seen.add(v); (v as Texture).dispose(); }
      }
      m.dispose();
    }
  });
}
