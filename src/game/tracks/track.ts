// Track construction and queries. A track is a closed main ribbon plus
// branch ribbons (alternative routes) that fork from and rejoin the main line.
// Everything gameplay-relevant (collision, progress, checkpoints, AI routing)
// is derived from the same sampled data the renderer uses, so route geometry
// and checkpoints always agree.
import { CatmullRomCurve3, Vector3 } from 'three';
import type { TrackId } from '../data/campaign';

export type BranchKind = 'shortcut' | 'risky' | 'scenic';

export interface BranchDef {
  name: string;
  kind: BranchKind;
  from: number; // main control point index where the branch forks
  to: number; // main control point index where it rejoins
  points: number[][]; // [x, y, z] intermediate control points
  hw: number; // half width
}

export interface SectionDef { from: number; to: number; kind: string } // main control-point indices (fractional allowed)

export interface PadDef { path: number; at: number; d: number } // path index, fraction of path length, lateral -1..1

export interface CapitalPlacement {
  from: number; // main control index range the hull lies beside
  to: number;
  side: 1 | -1;
  dist: number; // lateral distance from the track centre line to the hull axis
  height: number; // hull axis height above the track
}

export interface TrackDef {
  id: TrackId;
  name: string;
  scale: number;
  yScale: number;
  step: number;
  main: number[][]; // [x, y, z, halfWidth]
  branches: BranchDef[];
  sections: SectionDef[];
  pads: PadDef[];
  capital: CapitalPlacement;
  checkpoints: number;
}

export interface Sample {
  x: number; y: number; z: number;
  tx: number; ty: number; tz: number; // unit tangent (3D)
  hx: number; hz: number; // unit horizontal tangent
  rx: number; rz: number; // unit horizontal right vector
  hw: number;
  s: number; // distance along own path
  prog: number; // equivalent main-line progress
  curv: number; // signed horizontal curvature (positive = turning right)
  u: number; // control-point parameter (main only)
}

export interface TrackPath {
  id: number;
  name: string;
  kind: 'main' | BranchKind;
  closed: boolean;
  samples: Sample[];
  length: number;
  step: number;
  // branch-only
  fromIdx: number;
  toIdx: number;
  forkEnd: number; // last branch sample index still overlapping the main ribbon at the fork
  mergeStart: number; // first branch sample index overlapping the main ribbon at the merge
}

export interface Checkpoint { index: number; prog: number }

export interface TrackPos { path: number; idx: number; f: number; d: number }

export interface Track {
  def: TrackDef;
  paths: TrackPath[];
  main: TrackPath;
  length: number;
  checkpoints: Checkpoint[];
  capitalFromS: number;
  capitalToS: number;
}

const UP = new Vector3(0, 1, 0);

function resample(dense: Vector3[], denseU: number[], closed: boolean, step: number) {
  // cumulative arc length
  const n = dense.length;
  const cum: number[] = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dense[i].distanceTo(dense[i - 1]));
  let total = cum[n - 1];
  if (closed) total += dense[n - 1].distanceTo(dense[0]);
  const count = Math.max(8, Math.round(total / step));
  const actualStep = total / (closed ? count : count - 1);
  const pts: Vector3[] = [];
  const us: number[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = Math.min(i * actualStep, total);
    while (j < n - 2 && cum[j + 1] < target) j++;
    let a = dense[j], b = dense[j + 1], ca = cum[j], cb = cum[j + 1], ua = denseU[j], ub = denseU[j + 1];
    if (closed && target > cum[n - 1]) { a = dense[n - 1]; b = dense[0]; ca = cum[n - 1]; cb = total; ua = denseU[n - 1]; ub = denseU[n - 1] + (denseU[1] - denseU[0]); }
    const f = cb > ca ? Math.min(1, Math.max(0, (target - ca) / (cb - ca))) : 0;
    pts.push(new Vector3().lerpVectors(a, b, f));
    us.push(ua + (ub - ua) * f);
  }
  return { pts, us, step: actualStep, total };
}

function makeSamples(pts: Vector3[], us: number[], closed: boolean, step: number, widthAt: (u: number, i: number) => number): Sample[] {
  const n = pts.length;
  const out: Sample[] = [];
  const t = new Vector3();
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    t.subVectors(next, prev).normalize();
    const hl = Math.hypot(t.x, t.z) || 1;
    const hx = t.x / hl, hz = t.z / hl;
    // right = horizontal tangent x up
    const rx = -hz, rz = hx;
    out.push({ x: pts[i].x, y: pts[i].y, z: pts[i].z, tx: t.x, ty: t.y, tz: t.z, hx, hz, rx, rz, hw: widthAt(us[i], i), s: i * step, prog: 0, curv: 0, u: us[i] });
  }
  // signed curvature from heading change, then smooth
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = out[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = out[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const cross = a.hx * b.hz - a.hz * b.hx; // sin of heading change (positive = turning toward +right)
    const dot = a.hx * b.hx + a.hz * b.hz;
    raw.push(Math.atan2(cross, dot) / (2 * step));
  }
  for (let i = 0; i < n; i++) {
    let acc = 0, w = 0;
    for (let k = -3; k <= 3; k++) {
      const j = closed ? (i + k + n) % n : Math.min(n - 1, Math.max(0, i + k));
      acc += raw[j]; w++;
    }
    out[i].curv = acc / w;
  }
  return out;
}

export function buildTrack(def: TrackDef): Track {
  const sc = def.scale, ys = def.yScale;
  const ctrl = def.main.map((p) => new Vector3(p[0] * sc, p[1] * ys, p[2] * sc));
  const widths = def.main.map((p) => p[3]);
  const nc = ctrl.length;
  const curve = new CatmullRomCurve3(ctrl, true, 'centripetal');
  const DENSE = nc * 60;
  const dense: Vector3[] = [], denseU: number[] = [];
  for (let i = 0; i < DENSE; i++) { const t = i / DENSE; dense.push(curve.getPoint(t)); denseU.push(t * nc); }
  const rs = resample(dense, denseU, true, def.step);
  const widthMain = (u: number) => {
    const i0 = Math.floor(u) % nc, i1 = (i0 + 1) % nc, f = u - Math.floor(u);
    const sm = f * f * (3 - 2 * f);
    return widths[i0] + (widths[i1] - widths[i0]) * sm;
  };
  const mainSamples = makeSamples(rs.pts, rs.us, true, rs.step, widthMain);
  for (const s of mainSamples) s.prog = s.s;
  const main: TrackPath = { id: 0, name: 'main', kind: 'main', closed: true, samples: mainSamples, length: rs.total, step: rs.step, fromIdx: 0, toIdx: 0, forkEnd: 0, mergeStart: 0 };
  const paths: TrackPath[] = [main];

  const idxAtU = (u: number) => {
    // main sample index whose control parameter is closest to u
    let best = 0, bd = 1e9;
    for (let i = 0; i < mainSamples.length; i++) { const d = Math.abs(mainSamples[i].u - u); if (d < bd) { bd = d; best = i; } }
    return best;
  };

  def.branches.forEach((b, bi) => {
    const fromIdx = idxAtU(b.from), toIdx = idxAtU(b.to);
    const ms = mainSamples;
    const P = (i: number) => { const s = ms[(i + ms.length) % ms.length]; return new Vector3(s.x, s.y, s.z); };
    const lead = Math.round(60 / rs.step);
    const pts = [P(fromIdx - lead), P(fromIdx), ...b.points.map((p) => new Vector3(p[0] * sc, p[1] * ys, p[2] * sc)), P(toIdx), P(toIdx + lead)];
    const c = new CatmullRomCurve3(pts, false, 'centripetal');
    const np = pts.length;
    const t0 = 1 / (np - 1), t1 = (np - 2) / (np - 1);
    const D = (np - 3) * 60;
    const bd: Vector3[] = [], bu: number[] = [];
    for (let i = 0; i <= D; i++) { const t = t0 + (t1 - t0) * (i / D); bd.push(c.getPoint(t)); bu.push(i / D); }
    const brs = resample(bd, bu, false, def.step);
    const n = brs.pts.length;
    const blend = Math.round(110 / brs.step);
    const wFrom = ms[fromIdx].hw, wTo = ms[toIdx].hw;
    const samples = makeSamples(brs.pts, brs.us, false, brs.step, (_u, i) => {
      const a = Math.min(1, i / blend), z = Math.min(1, (n - 1 - i) / blend);
      let w = b.hw;
      if (a < 1) w = wFrom + (b.hw - wFrom) * (a * a * (3 - 2 * a));
      if (z < 1) w = Math.max(w, wTo + (b.hw - wTo) * (z * z * (3 - 2 * z)));
      return w;
    });
    const fromS = ms[fromIdx].s, toS = ms[toIdx].s;
    if (!(toS > fromS)) throw new Error(`Branch ${b.name} must not span the finish line`);
    for (const s of samples) s.prog = fromS + (toS - fromS) * (s.s / brs.total);
    const path: TrackPath = { id: bi + 1, name: b.name, kind: b.kind, closed: false, samples, length: brs.total, step: brs.step, fromIdx, toIdx, forkEnd: 0, mergeStart: n - 1 };
    paths.push(path);
  });

  const track: Track = { def, paths, main, length: main.length, checkpoints: [], capitalFromS: 0, capitalToS: 0 };

  // fork / merge overlap extents
  for (let p = 1; p < paths.length; p++) {
    const path = paths[p];
    const n = path.samples.length;
    let fe = 0;
    for (let i = 0; i < n; i++) {
      const s = path.samples[i];
      if (insidePath(main, s.x, s.z, path.fromIdx + i, 30, s.hw * 0.9)) fe = i; else break;
    }
    let msi = n - 1;
    for (let i = n - 1; i >= 0; i--) {
      const s = path.samples[i];
      if (insidePath(main, s.x, s.z, path.toIdx - (n - 1 - i), 30, s.hw * 0.9)) msi = i; else break;
    }
    path.forkEnd = Math.min(fe + 2, n - 1);
    path.mergeStart = Math.max(msi - 2, 0);
  }

  for (let k = 0; k < def.checkpoints; k++) track.checkpoints.push({ index: k, prog: (k * main.length) / def.checkpoints });
  track.capitalFromS = mainSamples[idxAtU(def.capital.from)].s;
  track.capitalToS = mainSamples[idxAtU(def.capital.to)].s;
  return track;
}

/** True when (x,z) is within `margin` of the ribbon of `path` near sample `hint`. */
export function insidePath(path: TrackPath, x: number, z: number, hint: number, window: number, margin: number): boolean {
  const n = path.samples.length;
  for (let k = -window; k <= window; k++) {
    let i = hint + k;
    if (path.closed) i = ((i % n) + n) % n; else if (i < 0 || i >= n) continue;
    const s = path.samples[i];
    const dx = x - s.x, dz = z - s.z;
    const along = dx * s.hx + dz * s.hz;
    if (along < -path.step || along > path.step) continue;
    const d = dx * s.rx + dz * s.rz;
    if (Math.abs(d) < s.hw + margin) return true;
  }
  return false;
}

const wrapIdx = (path: TrackPath, i: number) => {
  const n = path.samples.length;
  return path.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
};

/**
 * Project (x,z) onto `path`, walking from the hint index. Returns the lateral
 * offset in `out.d` and the signed overshoot past the path ends in the return
 * value (0 when inside the path's extent; open paths only).
 */
export function locateOn(path: TrackPath, x: number, z: number, hint: number, out: TrackPos): number {
  const ss = path.samples, n = ss.length, step = path.step;
  let i = wrapIdx(path, hint);
  let along = 0;
  for (let iter = 0; iter < 40; iter++) {
    const s = ss[i];
    along = (x - s.x) * s.hx + (z - s.z) * s.hz;
    if (along > step) {
      if (!path.closed && i >= n - 1) break;
      i = path.closed ? (i + 1) % n : i + 1;
    } else if (along < 0) {
      if (!path.closed && i <= 0) break;
      i = path.closed ? (i - 1 + n) % n : i - 1;
    } else break;
  }
  const s = ss[i];
  let over = 0;
  if (!path.closed) {
    if (i >= n - 1 && along > 0) { over = along; }
    else if (i <= 0 && along < 0) { over = along; }
  }
  const f = Math.max(0, Math.min(1, along / step));
  // interpolate the frame for a smoother lateral estimate
  const s2 = ss[path.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  const cx = s.x + (s2.x - s.x) * f, cz = s.z + (s2.z - s.z) * f;
  const rx = s.rx + (s2.rx - s.rx) * f, rz = s.rz + (s2.rz - s.rz) * f;
  const rl = Math.hypot(rx, rz) || 1;
  out.path = path.id; out.idx = i; out.f = f;
  out.d = ((x - cx) * rx + (z - cz) * rz) / rl;
  return over;
}

export interface Frame {
  x: number; y: number; z: number;
  hx: number; hz: number; rx: number; rz: number; ty: number;
  hw: number; prog: number; curv: number;
}

export function frameAt(path: TrackPath, idx: number, f: number, out: Frame): Frame {
  const ss = path.samples, n = ss.length;
  const a = ss[wrapIdx(path, idx)];
  const b = ss[path.closed ? (wrapIdx(path, idx) + 1) % n : Math.min(n - 1, idx + 1)];
  out.x = a.x + (b.x - a.x) * f; out.y = a.y + (b.y - a.y) * f; out.z = a.z + (b.z - a.z) * f;
  let hx = a.hx + (b.hx - a.hx) * f, hz = a.hz + (b.hz - a.hz) * f;
  const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l;
  out.hx = hx; out.hz = hz; out.rx = -hz; out.rz = hx;
  out.ty = a.ty + (b.ty - a.ty) * f;
  out.hw = a.hw + (b.hw - a.hw) * f;
  let dp = b.prog - a.prog;
  if (path.closed && dp < 0) dp += path.length;
  out.prog = a.prog + dp * f;
  out.curv = a.curv + (b.curv - a.curv) * f;
  return out;
}

export function newFrame(): Frame {
  return { x: 0, y: 0, z: 0, hx: 0, hz: 1, rx: 1, rz: 0, ty: 0, hw: 10, prog: 0, curv: 0 };
}

/** Sample index on `path` for a distance along it. */
export function idxAtS(path: TrackPath, s: number): number {
  const n = path.samples.length;
  let i = Math.floor(s / path.step);
  if (path.closed) i = ((i % n) + n) % n; else i = Math.max(0, Math.min(n - 1, i));
  return i;
}

/** World position for (path, distance, lateral offset). */
export function pointAt(path: TrackPath, s: number, d: number, out: Vector3, fr: Frame = newFrame()): Vector3 {
  const len = path.length;
  let ss = s;
  if (path.closed) ss = ((s % len) + len) % len; else ss = Math.max(0, Math.min(len - 0.001, s));
  const i = Math.floor(ss / path.step);
  const f = ss / path.step - i;
  frameAt(path, i, f, fr);
  return out.set(fr.x + fr.rx * d, fr.y, fr.z + fr.rz * d);
}

/** Main-line sample index for a progress value. */
export function mainIdxAtProg(track: Track, prog: number): number {
  return idxAtS(track.main, prog);
}

/** Wrapped signed difference a-b on a loop of length L, in (-L/2, L/2]. */
export function wrapDelta(a: number, b: number, L: number): number {
  let d = (a - b) % L;
  if (d > L / 2) d -= L; else if (d <= -L / 2) d += L;
  return d;
}

export function progInRange(prog: number, from: number, to: number, L: number): boolean {
  const p = ((prog % L) + L) % L;
  return from <= to ? p >= from && p <= to : p >= from || p <= to;
}

/** Main-line sample index closest to a control-point parameter. */
export function mainIdxAtU(track: Track, u: number): number {
  const ms = track.main.samples;
  let best = 0, bd = 1e9;
  for (let i = 0; i < ms.length; i++) { const d = Math.abs(ms[i].u - u); if (d < bd) { bd = d; best = i; } }
  return best;
}

/** Section kind for a main-line sample (first matching section wins). */
export function sectionAt(track: Track, u: number): string {
  for (const s of track.def.sections) if (u >= s.from && u < s.to) return s.kind;
  return 'open';
}
