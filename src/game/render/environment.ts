// Sky and per-track scenery. Everything here is decoration: gameplay objects
// (road, hazards, capital ship) are built elsewhere from simulation data.
import {
  AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group,
  InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, Points, Quaternion,
  ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Texture, TorusGeometry, Vector3, Euler,
} from 'three';
import { Rng } from '../core/rng';
import type { Capital } from '../sim/capital';
import { sectionAt, type Sample, type Track } from '../tracks/track';
import { buildHull } from './capitalMesh';
import type { Fx } from './fx';
import type { Theme } from './themes';
import { canvasTexture, hex, Kit, rockGeometry, windowTexture } from './util';

export interface Environment {
  group: Group; // world-space scenery
  sky: Group; // follows the camera
  update(dt: number, time: number, cam: Vector3, fx: Fx): void;
  dispose(): void;
}

type Quality = 'low' | 'medium' | 'high';
const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), v3 = new Vector3(), s3 = new Vector3();
const col = new Color();

function mat4(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): Matrix4 {
  return m4.compose(v3.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s3.set(sx, sy, sz));
}

class Builder {
  readonly group = new Group();
  readonly sky = new Group();
  readonly disposables: { dispose(): void }[] = [];
  readonly updaters: ((dt: number, time: number, cam: Vector3, fx: Fx) => void)[] = [];
  readonly rng: Rng;
  readonly density: number;

  constructor(readonly track: Track, readonly theme: Theme, readonly quality: Quality, readonly glow: Texture, readonly cap: Capital) {
    this.rng = new Rng(track.length | 0);
    this.density = quality === 'low' ? 0.4 : quality === 'medium' ? 0.75 : 1;
  }

  own<T extends { dispose(): void }>(d: T): T { this.disposables.push(d); return d; }

  instanced(geo: BufferGeometry, mat: Material, max: number): { mesh: InstancedMesh; add(m: Matrix4, color?: number): void; done(): void } {
    this.own(geo); this.own(mat);
    const mesh = new InstancedMesh(geo, mat, Math.max(1, max));
    let n = 0;
    return {
      mesh,
      add: (m: Matrix4, color?: number) => { if (n >= max) return; mesh.setMatrixAt(n, m); if (color !== undefined) mesh.setColorAt(n, col.set(color)); n++; },
      done: () => { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); this.group.add(mesh); },
    };
  }

  /** Distance from a point to the capital ship's hull axis (keeps scenery out of the hull). */
  capDist(x: number, z: number): number {
    const c = this.cap;
    const dx = x - c.cx, dz = z - c.cz;
    const along = Math.max(-c.length / 2 - 40, Math.min(c.length / 2 + 60, dx * c.dirX + dz * c.dirZ));
    return Math.hypot(dx - c.dirX * along, dz - c.dirZ * along);
  }

  /** Horizontal clearance from every route (coarse; for placing scenery). */
  clearOfTrack(x: number, y: number, z: number, r: number): boolean {
    for (const p of this.track.paths) {
      const ss = p.samples;
      for (let i = 0; i < ss.length; i += 3) {
        const s = ss[i];
        const dx = s.x - x, dz = s.z - z;
        const lim = s.hw + r + 8;
        if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
        if (dx * dx + dz * dz < lim * lim && Math.abs(s.y - y) < r + 26) return false;
      }
    }
    return true;
  }

  randomSample(): Sample { const ss = this.track.main.samples; return ss[this.rng.int(0, ss.length - 1)]; }
}

// ------------------------------------------------------------------- sky
function buildSky(b: Builder): void {
  const t = b.theme;
  const mat = b.own(new ShaderMaterial({
    uniforms: {
      uTop: { value: new Color(t.skyTop) }, uBottom: { value: new Color(t.skyBottom) },
      uNebA: { value: new Color(t.nebulaA) }, uNebB: { value: new Color(t.nebulaB) }, uStars: { value: t.stars },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uTop, uBottom, uNebA, uNebB; uniform float uStars; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y * 0.5 + 0.5;
        vec3 c = mix(uBottom, uTop, smoothstep(0.25, 0.85, h));
        float n1 = fbm(d * 2.2 + 3.1), n2 = fbm(d * 3.7 - 1.7);
        c += uNebA * pow(smoothstep(0.42, 0.85, n1), 2.0) * 0.55;
        c += uNebB * pow(smoothstep(0.48, 0.9, n2), 2.0) * 0.5;
        vec3 g = floor(d * 190.0);
        float st = hash(g);
        float star = smoothstep(0.9965, 1.0, st) * (0.5 + 0.5 * hash(g + 7.0));
        vec3 g2 = floor(d * 80.0);
        star += smoothstep(0.9988, 1.0, hash(g2 + 3.0)) * 1.6;
        c += vec3(star) * uStars * mix(vec3(1.0), mix(vec3(0.6,0.8,1.0), vec3(1.0,0.8,0.6), hash(g + 2.0)), 0.6);
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: BackSide, depthWrite: false, fog: false,
  }));
  const geo = b.own(new SphereGeometry(9000, 32, 20));
  const dome = new Mesh(geo, mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  b.sky.add(dome);
}

function skySprite(b: Builder, dir: [number, number, number], size: number, color: number, opacity = 1): Sprite {
  const mat = b.own(new SpriteMaterial({ map: b.glow, color, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false }));
  const sp = new Sprite(mat);
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  sp.position.set((dir[0] / l) * 8000, (dir[1] / l) * 8000, (dir[2] / l) * 8000);
  sp.scale.setScalar(size);
  b.sky.add(sp);
  return sp;
}

function planet(b: Builder, dir: [number, number, number], radius: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, emissive = 0.0): Mesh {
  const tex = b.own(canvasTexture(512, 256, draw, false));
  const mat = b.own(new MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: emissive, fog: false }));
  const mesh = new Mesh(b.own(new SphereGeometry(radius, 40, 24)), mat);
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  mesh.position.set((dir[0] / l) * 7000, (dir[1] / l) * 7000, (dir[2] / l) * 7000);
  b.sky.add(mesh);
  return mesh;
}

/** Drifting dust motes around the camera: cheap, wraps in the shader, sells the speed. */
function spaceDust(b: Builder, color: number, count: number): void {
  const n = Math.round(count * b.density);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = b.rng.range(0, 320);
  const geo = b.own(new BufferGeometry());
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  const mat = b.own(new ShaderMaterial({
    uniforms: { uCam: { value: new Vector3() }, uColor: { value: new Color(color) } },
    vertexShader: `uniform vec3 uCam; varying float vA;
      void main(){ vec3 p = mod(position - uCam, 320.0) - 160.0; vec4 mv = viewMatrix * vec4(p + uCam, 1.0);
        vA = smoothstep(160.0, 60.0, length(p)); gl_PointSize = clamp(150.0 / max(1.0, -mv.z), 1.0, 5.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(uColor * smoothstep(1.0, 0.2, d) * vA, 1.0); }`,
    blending: AdditiveBlending, depthWrite: false, transparent: true,
  }));
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  b.group.add(pts);
  b.updaters.push((_dt, _t, cam) => { (mat.uniforms.uCam.value as Vector3).copy(cam); });
}

/** Small glowing marker buoys along both edges of every route. */
function edgeBuoys(b: Builder, spacing: number): void {
  const geo = new OctahedronGeometry(0.55, 0);
  const mat = new MeshBasicMaterial({ color: 0xffffff });
  let total = 0;
  for (const p of b.track.paths) total += Math.ceil(p.samples.length / spacing) * 2;
  const inst = b.instanced(geo, mat, total);
  for (const p of b.track.paths) for (let i = 0; i < p.samples.length; i += spacing) {
    const s = p.samples[i];
    for (const side of [-1, 1]) {
      inst.add(mat4(s.x + s.rx * side * (s.hw + 1.2), s.y + 3.2, s.z + s.rz * side * (s.hw + 1.2), 0, 0, 0, 1, 1.6, 1), side < 0 ? b.theme.rail : b.theme.railAlt);
    }
  }
  inst.done();
}

// --------------------------------------------------------- NEON FRONTIER
function tunnelShell(b: Builder, samples: Sample[], from: number, to: number, closed: boolean, color: number): void {
  // enclosed tunnel: side walls + ceiling over [from, to) sample indices
  const pos: number[] = [], uv: number[] = [];
  const H = 15;
  const n = samples.length;
  const quad = (a: number[], bb: number[], c: number[], d: number[], u0: number, u1: number) => {
    pos.push(...a, ...bb, ...c, ...c, ...bb, ...d);
    uv.push(u0, 0, u1, 0, u0, 1, u0, 1, u1, 0, u1, 1);
  };
  for (let i = from; i < to - 1; i++) {
    const s0 = samples[closed ? i % n : i], s1 = samples[closed ? (i + 1) % n : i + 1];
    if (!s0 || !s1) break;
    const u0 = i / 4, u1 = (i + 1) / 4;
    for (const side of [-1, 1]) {
      const w0 = s0.hw + 2.6, w1 = s1.hw + 2.6;
      const a = [s0.x + s0.rx * side * w0, s0.y + 2, s0.z + s0.rz * side * w0], bb = [s1.x + s1.rx * side * w1, s1.y + 2, s1.z + s1.rz * side * w1];
      const c = [s0.x + s0.rx * side * w0 * 0.82, s0.y + H, s0.z + s0.rz * side * w0 * 0.82], d = [s1.x + s1.rx * side * w1 * 0.82, s1.y + H, s1.z + s1.rz * side * w1 * 0.82];
      quad(a, bb, c, d, u0, u1);
      if (side === 1) {
        const c2 = [s0.x - s0.rx * w0 * 0.82, s0.y + H, s0.z - s0.rz * w0 * 0.82], d2 = [s1.x - s1.rx * w1 * 0.82, s1.y + H, s1.z - s1.rz * w1 * 0.82];
        quad(c, d, c2, d2, u0, u1);
      }
    }
  }
  if (!pos.length) return;
  const geo = b.own(new BufferGeometry());
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.computeVertexNormals();
  const tex = b.own(canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(color); ctx.fillRect(0, 54, w * 0.7, 6); ctx.fillRect(0, 108, w, 3);
    ctx.fillStyle = '#ffd9a0'; for (let x = 6; x < w; x += 32) ctx.fillRect(x, 22, 14, 7);
  }));
  const mat = b.own(new MeshStandardMaterial({ color: 0x1a1d30, metalness: 0.6, roughness: 0.5, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.4, side: DoubleSide }));
  b.group.add(new Mesh(geo, mat));
}

function tunnelRibs(b: Builder, list: { s: Sample; color: number }[]): void {
  const kit = new Kit();
  kit.add('f', new BoxGeometry(0.14, 15, 1.2), 1, 7.5, 0, 0, 0, 0.012);
  kit.add('f', new BoxGeometry(0.14, 15, 1.2), -1, 7.5, 0, 0, 0, -0.012);
  kit.add('f', new BoxGeometry(1.8, 1.0, 1.2), 0, 15, 0);
  const frameMat = new MeshStandardMaterial({ color: 0x2a2e48, metalness: 0.7, roughness: 0.35 });
  const g = kit.build({ f: frameMat, hull: frameMat });
  const frameGeo = (g.children[0] as Mesh).geometry;
  const kit2 = new Kit();
  kit2.add('g', new BoxGeometry(0.05, 13, 0.5), 0.93, 7.5, 0);
  kit2.add('g', new BoxGeometry(0.05, 13, 0.5), -0.93, 7.5, 0);
  kit2.add('g', new BoxGeometry(1.5, 0.3, 0.5), 0, 14.4, 0);
  const glowMat = new MeshBasicMaterial({ color: 0xffffff });
  const g2 = kit2.build({ g: glowMat, hull: glowMat });
  const glowGeo = (g2.children[0] as Mesh).geometry;
  const frames = b.instanced(frameGeo, frameMat, list.length);
  const glows = b.instanced(glowGeo, glowMat, list.length);
  for (const { s, color } of list) {
    const yaw = Math.atan2(s.hx, s.hz);
    frames.add(mat4(s.x, s.y, s.z, 0, yaw, 0, s.hw + 2.9, 1, 1));
    glows.add(mat4(s.x, s.y, s.z, 0, yaw, 0, s.hw + 2.9, 1, 1), color);
  }
  frames.done(); glows.done();
}

function buildNeon(b: Builder): void {
  const { track, rng, theme } = b;
  const main = track.main, ms = main.samples;
  planet(b, [-0.5, 0.25, -0.8], 1500, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1b3a8a'); g.addColorStop(0.5, '#3f6fd8'); g.addColorStop(1, '#152a66');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { ctx.fillStyle = `rgba(${150 + Math.random() * 100},${180 + Math.random() * 60},255,${0.08 + Math.random() * 0.12})`; ctx.fillRect(0, Math.random() * h, w, 3 + Math.random() * 12); }
  }, 0.12);
  skySprite(b, [0.6, 0.5, 0.4], 1500, 0xbfd8ff, 0.9);
  spaceDust(b, 0x6688cc, 500);

  // tunnels: enclosed shells with lit ribs
  const ribs: { s: Sample; color: number }[] = [];
  let runStart = -1;
  for (let i = 0; i <= ms.length; i++) {
    const inT = i < ms.length && sectionAt(track, ms[i].u) === 'tunnel';
    if (inT && runStart < 0) runStart = i;
    if (!inT && runStart >= 0) { tunnelShell(b, ms, runStart, i, false, theme.rail); runStart = -1; }
    if (inT && i % 3 === 0) ribs.push({ s: ms[i], color: (i / 3) % 2 ? theme.rail : theme.railAlt });
  }
  for (let p = 1; p < track.paths.length; p++) {
    const br = track.paths[p];
    tunnelShell(b, br.samples, br.forkEnd + 10, br.mergeStart - 10, false, p === 1 ? 0x7dff5a : 0xff9a2a);
    for (let i = br.forkEnd + 10; i < br.mergeStart - 10; i += 3) ribs.push({ s: br.samples[i], color: p === 1 ? 0x7dff5a : 0xff9a2a });
  }
  tunnelRibs(b, ribs);

  // station towers with lit windows, above and below the roadway
  const winTex = [0, 1, 2].map((i) => b.own(windowTexture(11 + i, i === 0 ? ['#ffe6a8', '#fff3d0', '#ffb84a'] : i === 1 ? ['#7af0ff', '#d8fbff', '#3fa9ff'] : ['#ff7ad9', '#ffd0f2', '#b06bff'], 0.3)));
  const boxGeo = new BoxGeometry(1, 1, 1);
  const towerCount = Math.round(520 * b.density);
  const towers = winTex.map((t, i) => b.instanced(i === 0 ? boxGeo : boxGeo.clone(), new MeshStandardMaterial({ color: 0x1c2036, metalness: 0.5, roughness: 0.6, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.25 }), Math.ceil(towerCount / 3) + 2));
  const capGeo = new BoxGeometry(1, 1, 1);
  const caps = b.instanced(capGeo, new MeshBasicMaterial({ color: 0xffffff }), towerCount);
  for (let i = 0; i < towerCount; i++) {
    const s = b.randomSample();
    if (sectionAt(track, s.u) === 'tunnel' && rng.chance(0.7)) continue;
    const side = rng.sign();
    const lat = s.hw + 26 + Math.pow(rng.next(), 1.6) * 420;
    const x = s.x + s.rx * side * lat, z = s.z + s.rz * side * lat;
    const w = rng.range(18, 46), d = rng.range(18, 46), h = rng.range(60, 300);
    if (!b.clearOfTrack(x, s.y, z, Math.max(w, d) * 0.75) || b.capDist(x, z) < 130) continue;
    const top = s.y + rng.range(-30, 110);
    const yaw = Math.atan2(s.hx, s.hz) + (rng.chance(0.5) ? 0 : Math.PI / 2);
    towers[i % 3].add(mat4(x, top - h / 2, z, 0, yaw, 0, w, h, d));
    caps.add(mat4(x, top + 0.6, z, 0, yaw, 0, w * 0.92, 1.2, d * 0.92), rng.pick([theme.rail, theme.railAlt, 0xffe14a, 0xff7a1a]));
  }
  towers.forEach((t) => t.done()); caps.done();

  // neon signage
  const words = ['NOVA COLA', 'STAR*LITE', 'KOSMO 88', 'HI-FI', '24H DOCK', 'ARCADE', 'VOID GAS', 'ORBIT INN'];
  const signCols = ['#ff2bd6', '#00e5ff', '#ffe14a', '#7dff5a', '#ff7a1a'];
  const signGeo = b.own(new PlaneGeometry(26, 9));
  const signMats = words.map((wd, i) => {
    const c1 = signCols[i % signCols.length], c2 = signCols[(i + 2) % signCols.length];
    const tex = b.own(canvasTexture(512, 176, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(4,4,14,0.95)'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = c2; ctx.lineWidth = 7; ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.shadowColor = c1; ctx.shadowBlur = 22; ctx.fillStyle = c1;
      ctx.font = 'italic bold 84px Impact, Arial Black, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(wd, w / 2, h / 2 + 4); ctx.fillText(wd, w / 2, h / 2 + 4);
    }, false));
    return b.own(new MeshBasicMaterial({ map: tex, side: DoubleSide, toneMapped: false }));
  });
  const signCount = Math.round(44 * b.density);
  for (let i = 0; i < signCount; i++) {
    const s = ms[Math.floor(((i + 0.5) / signCount) * ms.length)];
    if (sectionAt(track, s.u) === 'tunnel') continue;
    const side = i % 2 ? 1 : -1;
    const lat = s.hw + rng.range(10, 22);
    const x = s.x + s.rx * side * lat, z = s.z + s.rz * side * lat;
    if (b.capDist(x, z) < 110 || !b.clearOfTrack(x, s.y, z, 6)) continue;
    const sign = new Mesh(signGeo, signMats[i % signMats.length]);
    sign.position.set(x, s.y + rng.range(11, 24), z);
    sign.rotation.y = Math.atan2(s.hx, s.hz) + Math.PI - side * 0.5;
    b.group.add(sign);
    const post = new Mesh(boxGeo, towers[0].mesh.material as Material);
    post.scale.set(1.2, 60, 1.2);
    post.position.set(x, sign.position.y - 34, z);
    b.group.add(post);
  }

  // the station's great ring, far behind the circuit
  let cx = 0, cz = 0;
  for (const s of ms) { cx += s.x; cz += s.z; }
  cx /= ms.length; cz /= ms.length;
  const ringMat = b.own(new MeshStandardMaterial({ color: 0x232842, metalness: 0.6, roughness: 0.5, emissiveMap: winTex[1], emissive: 0xffffff, emissiveIntensity: 0.9 }));
  winTex[1].repeat.set(1, 1);
  const ring = new Mesh(b.own(new TorusGeometry(3300, 70, 10, 120)), ringMat);
  ring.position.set(cx, -500, cz);
  ring.rotation.set(Math.PI / 2 - 0.22, 0, 0.1);
  b.group.add(ring);
  const ring2 = new Mesh(b.own(new TorusGeometry(3300, 9, 6, 120)), b.own(new MeshBasicMaterial({ color: theme.rail })));
  ring2.position.copy(ring.position); ring2.rotation.copy(ring.rotation); ring2.scale.setScalar(1.024);
  b.group.add(ring2);
  edgeBuoys(b, 14);
}

// ------------------------------------------------------------ DEAD ORBIT
function buildOrbit(b: Builder): void {
  const { rng, track, theme } = b;
  planet(b, [0.7, 0.18, -0.6], 1900, (ctx, w, h) => {
    ctx.fillStyle = '#3a3542'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      const r = 2 + Math.random() * 16, x = Math.random() * w, y = Math.random() * h;
      ctx.fillStyle = `rgba(${20 + Math.random() * 30},${18 + Math.random() * 26},${30 + Math.random() * 30},0.5)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
      ctx.strokeStyle = 'rgba(120,110,140,0.25)'; ctx.stroke();
    }
    // glowing fractures of the shattered moon
    ctx.shadowColor = '#b06bff'; ctx.shadowBlur = 10; ctx.strokeStyle = '#d9a8ff'; ctx.lineWidth = 2.4;
    for (let i = 0; i < 9; i++) {
      let x = Math.random() * w, y = Math.random() * h;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 9; k++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.3) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }, 0.55);
  skySprite(b, [-0.5, 0.6, 0.4], 1300, 0xd8e4ff, 1);
  spaceDust(b, 0x8877aa, 700);

  const rockMat = new MeshStandardMaterial({ color: 0x6b6470, roughness: 0.95, metalness: 0.05, flatShading: true });
  const total = Math.round(1000 * b.density);
  const geos = [rockGeometry(3, 1, 0.34), rockGeometry(8, 1, 0.4), rockGeometry(21, 2, 0.28)];
  const sets = geos.map((g, i) => b.instanced(g, i === 0 ? rockMat : rockMat.clone(), Math.ceil(total / 3) + 4));
  const tints = [0x6b6470, 0x57525e, 0x7a6f72, 0x4c4a58];
  for (let i = 0; i < total; i++) {
    const s = b.randomSample();
    const side = rng.sign();
    const far = rng.chance(0.14);
    const r = far ? rng.range(50, 170) : rng.range(3, 12) + Math.pow(rng.next(), 3) * 30;
    const sec = sectionAt(track, s.u);
    const spread = sec === 'open' ? 520 : 300;
    const lat = s.hw + r * 1.3 + 12 + (far ? rng.range(300, 1500) : Math.pow(rng.next(), 1.7) * spread);
    const x = s.x + s.rx * side * lat, z = s.z + s.rz * side * lat;
    const y = s.y + rng.range(-1, 1) * (far ? 500 : 60 + lat * 0.4);
    if (!b.clearOfTrack(x, y, z, r * 1.25) || b.capDist(x, z) < 110 + r) continue;
    sets[i % 3].add(mat4(x, y, z, rng.range(0, 6), rng.range(0, 6), rng.range(0, 6), r, r * rng.range(0.7, 1.1), r), rng.pick(tints));
  }
  sets.forEach((st) => st.done());

  // derelict wreckage: hull plates and girders tumbling in the wreck stretch
  const plateMat = new MeshStandardMaterial({ color: 0x3a4050, metalness: 0.8, roughness: 0.45 });
  const plates = b.instanced(new BoxGeometry(1, 0.08, 1), plateMat, Math.round(160 * b.density));
  const girders = b.instanced(new BoxGeometry(0.5, 0.5, 1), plateMat.clone(), Math.round(120 * b.density));
  for (let i = 0; i < 300 * b.density; i++) {
    const s = b.randomSample();
    const sec = sectionAt(track, s.u);
    if (sec !== 'wreck' && !rng.chance(0.25)) continue;
    const lat = s.hw + 10 + rng.range(0, 160);
    const side = rng.sign();
    const x = s.x + s.rx * side * lat, z = s.z + s.rz * side * lat, y = s.y + rng.range(-50, 60);
    if (!b.clearOfTrack(x, y, z, 14) || b.capDist(x, z) < 120) continue;
    if (i % 2) plates.add(mat4(x, y, z, rng.range(0, 6), rng.range(0, 6), rng.range(0, 6), rng.range(6, 22), 1, rng.range(6, 22)));
    else girders.add(mat4(x, y, z, rng.range(0, 6), rng.range(0, 6), rng.range(0, 6), 1, 1, rng.range(14, 50)));
  }
  plates.done(); girders.done();
  edgeBuoys(b, 9);
  void theme;
}

// ------------------------------------------------------------ SOLAR SCAR
function vnoise(x: number, z: number): number {
  const h = (a: number, c: number) => { const n = Math.sin(a * 127.1 + c * 311.7) * 43758.5453; return n - Math.floor(n); };
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - w) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * w;
}
const fbm2 = (x: number, z: number) => vnoise(x, z) * 0.55 + vnoise(x * 2.1 + 9, z * 2.1 + 4) * 0.3 + vnoise(x * 4.3 + 2, z * 4.3 + 7) * 0.15;
const sstep = (a: number, c: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (c - a))); return t * t * (3 - 2 * t); };

interface TerrainSample { x: number; z: number; y: number; hw: number; canyon: number }

function buildSolar(b: Builder): void {
  const { track, rng, theme } = b;
  skySprite(b, [0.5, 0.42, -0.4], 3800, 0xfff0c0, 1);
  skySprite(b, [0.5, 0.42, -0.4], 1100, 0xffffff, 1);
  planet(b, [-0.6, 0.5, 0.5], 500, (ctx, w, h) => { ctx.fillStyle = '#d9b48a'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 60; i++) { ctx.fillStyle = 'rgba(120,70,40,0.3)'; ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 14, 0, 6.3); ctx.fill(); } }, 0.25);
  spaceDust(b, 0xffc890, 420);

  // --- terrain: desert floor that hugs the roadway, rising into canyon walls
  const pts: TerrainSample[] = [];
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of track.paths) {
    const ss = p.samples;
    for (let i = 0; i < ss.length; i += 2) {
      const s = ss[i];
      let canyon = 0;
      if (p.id === 0) {
        // smooth ramp in/out of canyon sections
        for (const sec of track.def.sections) if (sec.kind === 'canyon') canyon = Math.max(canyon, Math.min(1, (s.u - sec.from) / 0.5, (sec.to - s.u) / 0.5));
        canyon = Math.max(0, canyon);
      } else canyon = p.id === 1 ? 1 : 0.5;
      pts.push({ x: s.x, z: s.z, y: s.y, hw: s.hw, canyon });
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    }
  }
  const CELL = 90;
  const grid = new Map<number, TerrainSample[]>();
  const key = (cx: number, cz: number) => cx * 100003 + cz;
  for (const p of pts) { const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)); let l = grid.get(k); if (!l) { l = []; grid.set(k, l); } l.push(p); }
  const pad = 1700;
  const sizeX = maxX - minX + pad * 2, sizeZ = maxZ - minZ + pad * 2;
  const res = b.quality === 'low' ? 34 : b.quality === 'medium' ? 26 : 20;
  const nx = Math.ceil(sizeX / res), nz = Math.ceil(sizeZ / res);
  const geo = b.own(new PlaneGeometry(sizeX, sizeZ, nx, nz));
  geo.rotateX(-Math.PI / 2);
  geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const pa = geo.attributes.position;
  const colors = new Float32Array(pa.count * 3);
  const sand = new Color(0xd9a05b), rock = new Color(0xa8552a), dark = new Color(0x6e2f1c), c = new Color();
  const heightAt = (x: number, z: number): number => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best: TerrainSample | null = null, bd = 1e12;
    for (let ring = 0; ring <= 5; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) for (let iz = cz - ring; iz <= cz + ring; iz++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
        const l = grid.get(key(ix, iz));
        if (!l) continue;
        for (const p of l) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } }
      }
      if (best && Math.sqrt(bd) < ring * CELL) break;
    }
    const dune = fbm2(x * 0.004, z * 0.004);
    const farGround = -70 + dune * 70 + fbm2(x * 0.02, z * 0.02) * 10;
    const bs = best as TerrainSample | null;
    if (!bs) return farGround;
    const d = Math.sqrt(bd);
    const edge = bs.hw + 9;
    const near = bs.y - 7;
    let h = near + (farGround - near) * sstep(170, 520, d);
    const n = fbm2(x * 0.013 + 5, z * 0.013 + 1);
    const wall = sstep(edge, edge + 52, d) * (48 + 60 * n) * (1 - 0.6 * sstep(190, 520, d));
    const berm = sstep(edge + 25, edge + 150, d) * 9 * n * (1 - sstep(170, 520, d));
    h += wall * bs.canyon + berm * (1 - bs.canyon);
    return h;
  };
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), z = pa.getZ(i);
    const h = heightAt(x, z);
    pa.setY(i, h);
    const t = sstep(-40, 60, h + fbm2(x * 0.03, z * 0.03) * 30 - 10);
    c.copy(sand).lerp(rock, t).lerp(dark, sstep(0.75, 1, t) * 0.7);
    c.multiplyScalar(0.82 + fbm2(x * 0.05 + 3, z * 0.05) * 0.36);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new Mesh(geo, b.own(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 })));
  b.group.add(terrain);

  // --- heliostat field + collector towers on the plain
  const mirrorGeo = new BoxGeometry(8, 0.3, 6);
  const mirrorMat = new MeshStandardMaterial({ color: 0xcfe8ff, metalness: 1, roughness: 0.08, emissive: 0x4488aa, emissiveIntensity: 0.25 });
  const postGeo = new CylinderGeometry(0.35, 0.5, 5, 6);
  const postMat = new MeshStandardMaterial({ color: 0x4a3a30, metalness: 0.5, roughness: 0.6 });
  const maxM = Math.round(520 * b.density);
  const mirrors = b.instanced(mirrorGeo, mirrorMat, maxM), posts = b.instanced(postGeo, postMat, maxM);
  const ms = track.main.samples;
  const towers: Vector3[] = [];
  const plainSamples = ms.filter((s) => sectionAt(track, s.u) === 'plain');
  for (const frac of [0.22, 0.55, 0.85]) {
    const s = plainSamples[Math.floor(plainSamples.length * frac)];
    if (!s) continue;
    const side = b.cap.nx * s.rx + b.cap.nz * s.rz > 0 ? -1 : 1; // opposite the capital ship
    const x = s.x + s.rx * side * 330, z = s.z + s.rz * side * 330;
    const gy = heightAt(x, z);
    towers.push(new Vector3(x, gy + 150, z));
    const tower = new Mesh(b.own(new CylinderGeometry(7, 13, 150, 10)), postMat);
    tower.position.set(x, gy + 75, z);
    b.group.add(tower);
    const head = new Mesh(b.own(new SphereGeometry(13, 16, 12)), b.own(new MeshBasicMaterial({ color: new Color(0xfff2c0).multiplyScalar(2.2) })));
    head.position.set(x, gy + 156, z);
    b.group.add(head);
    const sp = new Sprite(b.own(new SpriteMaterial({ map: b.glow, color: 0xffd890, blending: AdditiveBlending, depthWrite: false, transparent: true })));
    sp.position.copy(head.position); sp.scale.setScalar(190);
    b.group.add(sp);
  }
  for (let i = 0; i < maxM * 3; i++) {
    const s = plainSamples[rng.int(0, Math.max(0, plainSamples.length - 1))];
    if (!s || !towers.length) break;
    const side = rng.sign();
    const lat = s.hw + 30 + rng.range(0, 420);
    const x = Math.round((s.x + s.rx * side * lat) / 16) * 16, z = Math.round((s.z + s.rz * side * lat) / 16) * 16;
    if (!b.clearOfTrack(x, s.y, z, 10)) continue;
    const gy = heightAt(x, z);
    let tw = towers[0];
    for (const t of towers) if (t.distanceToSquared(v3.set(x, gy, z)) < tw.distanceToSquared(v3)) tw = t;
    const yaw = Math.atan2(tw.x - x, tw.z - z);
    posts.add(mat4(x, gy + 2.5, z, 0, 0, 0, 1, 1, 1));
    mirrors.add(mat4(x, gy + 5.4, z, -0.55, yaw, 0, 1, 1, 1));
  }
  mirrors.done(); posts.done();

  // --- military installations in the base stretches
  const bunkerMat = new MeshStandardMaterial({ color: 0x8a7a5a, metalness: 0.2, roughness: 0.85 });
  const bunkers = b.instanced(new BoxGeometry(1, 1, 1), bunkerMat, 90);
  const lightGeo = new BoxGeometry(1, 1, 1);
  const lights = b.instanced(lightGeo, new MeshBasicMaterial({ color: 0xffffff }), 140);
  const baseSamples = ms.filter((s) => sectionAt(track, s.u) === 'base');
  const dishes: Mesh[] = [];
  const dishMat = b.own(new MeshStandardMaterial({ color: 0xb8b0a0, metalness: 0.6, roughness: 0.4, side: DoubleSide }));
  const dishGeo = b.own(new ConeGeometry(11, 5, 14, 1, true));
  for (let i = 0; i < 80; i++) {
    const s = baseSamples[rng.int(0, Math.max(0, baseSamples.length - 1))];
    if (!s) break;
    const side = rng.sign();
    const lat = s.hw + 22 + rng.range(0, 200);
    const x = s.x + s.rx * side * lat, z = s.z + s.rz * side * lat;
    if (!b.clearOfTrack(x, s.y, z, 22)) continue;
    const gy = heightAt(x, z);
    const yaw = Math.atan2(s.hx, s.hz);
    const kind = i % 4;
    if (kind === 0) { // watch tower
      bunkers.add(mat4(x, gy + 14, z, 0, yaw, 0, 3, 28, 3));
      bunkers.add(mat4(x, gy + 30, z, 0, yaw, 0, 9, 5, 9));
      lights.add(mat4(x, gy + 34, z, 0, yaw, 0, 1.2, 2.4, 1.2), 0xff3020);
    } else if (kind === 1 && dishes.length < 5) { // radar dish
      bunkers.add(mat4(x, gy + 6, z, 0, yaw, 0, 6, 12, 6));
      const dish = new Mesh(dishGeo, dishMat);
      dish.position.set(x, gy + 17, z); dish.rotation.x = 2.2;
      const holder = new Group(); holder.add(dish); holder.position.set(0, 0, 0);
      dish.position.set(0, 0, 0); holder.position.set(x, gy + 17, z);
      b.group.add(holder);
      dishes.push(holder as unknown as Mesh);
    } else { // bunker / hangar
      const w = rng.range(14, 34), d = rng.range(14, 40), h = rng.range(6, 14);
      bunkers.add(mat4(x, gy + h / 2 - 1, z, 0, yaw, 0, w, h, d));
      lights.add(mat4(x - s.rx * side * (w / 2 + 0.2), gy + h * 0.6, z - s.rz * side * (w / 2 + 0.2), 0, yaw, 0, 0.5, 1, d * 0.7), rng.chance(0.5) ? theme.rail : theme.railAlt);
    }
  }
  bunkers.done(); lights.done();
  b.updaters.push((_dt, time) => { for (let i = 0; i < dishes.length; i++) dishes[i].rotation.y = time * (0.5 + i * 0.13); });

  // --- rock spires along the canyon rim
  const spireGeo = rockGeometry(31, 1, 0.3);
  const spires = b.instanced(spireGeo, new MeshStandardMaterial({ color: 0xa8552a, roughness: 1, flatShading: true }), Math.round(260 * b.density));
  for (let i = 0; i < 520 * b.density; i++) {
    const s = b.randomSample();
    if (sectionAt(track, s.u) !== 'canyon') continue;
    const side = rng.sign();
    const lat = s.hw + rng.range(34, 150);
    const x = s.x + s.rx * side * lat, z = s.z + s.rz * side * lat;
    if (!b.clearOfTrack(x, s.y, z, 16)) continue;
    const r = rng.range(8, 20);
    spires.add(mat4(x, heightAt(x, z) + r * 1.2, z, rng.range(-0.2, 0.2), rng.range(0, 6), rng.range(-0.2, 0.2), r, r * rng.range(2, 4.5), r), rng.pick([0xa8552a, 0x8f4422, 0xc06a34]));
  }
  spires.done();
  edgeBuoys(b, 14);
}

// ---------------------------------------------------------- WARZONE ZERO
function buildWarzone(b: Builder): void {
  const { track, rng, theme } = b;
  planet(b, [-0.3, -0.35, -0.9], 2600, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a0c10'); g.addColorStop(0.5, '#6a1c14'); g.addColorStop(1, '#1c0808');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.shadowColor = '#ff7a20'; ctx.shadowBlur = 12;
    for (let i = 0; i < 70; i++) { ctx.fillStyle = `rgba(255,${120 + Math.random() * 100},40,${0.3 + Math.random() * 0.5})`; ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 5, 0, 6.3); ctx.fill(); }
  }, 0.7);
  skySprite(b, [0.3, 0.7, -0.5], 1200, 0xffd0b0, 1);
  spaceDust(b, 0xaa6655, 600);

  let cx = 0, cz = 0;
  const ms = track.main.samples;
  for (const s of ms) { cx += s.x; cz += s.z; }
  cx /= ms.length; cz /= ms.length;

  // the two fleets
  const fleet: { pos: Vector3; faction: number }[] = [];
  const nShips = b.quality === 'low' ? 4 : 7;
  for (let i = 0; i < nShips; i++) {
    const faction = i % 2;
    const ang = (i / nShips) * 6.283 + rng.range(-0.2, 0.2);
    const dist = rng.range(2300, 3600);
    const len = rng.range(700, 1300);
    const hull = buildHull(len, faction ? 0x58424a : 0x424a5c, faction ? 0xff3d5a : 0x35d8ff, faction ? 0xff5040 : 0x40c8ff, 100 + i * 17, b.quality === 'low' ? 10 : 40, 1);
    const pos = new Vector3(cx + Math.cos(ang) * dist, rng.range(-350, 700), cz + Math.sin(ang) * dist);
    hull.group.position.copy(pos);
    hull.group.rotation.set(rng.range(-0.15, 0.15), rng.range(0, 6.283), rng.range(-0.25, 0.25));
    hull.group.scale.setScalar(rng.range(1.2, 2));
    b.group.add(hull.group);
    b.disposables.push(...(hull.mats as unknown as { dispose(): void }[]));
    b.disposables.push({ dispose: () => hull.group.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); }) });
    fleet.push({ pos, faction });
  }
  fleet.push({ pos: new Vector3(b.cap.cx, b.cap.cy + 40, b.cap.cz), faction: 1 });

  // capital-scale beam exchanges between the fleets
  const beamGeo = b.own(new CylinderGeometry(1, 1, 1, 6, 1, true));
  beamGeo.rotateX(Math.PI / 2);
  const beams: { mesh: Mesh; t: number; life: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const mat = b.own(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false }));
    const mesh = new Mesh(beamGeo, mat);
    mesh.visible = false; mesh.frustumCulled = false;
    b.group.add(mesh);
    beams.push({ mesh, t: 1, life: 0 });
  }
  let beamT = 0.5, flakT = 1;
  const from = new Vector3(), to = new Vector3();
  b.updaters.push((dt, _time, _cam, fx) => {
    beamT -= dt; flakT -= dt;
    if (beamT <= 0) {
      beamT = 0.25 + Math.random() * 0.9;
      const bm = beams.find((k) => k.t >= k.life);
      if (bm) {
        const a = fleet[Math.floor(Math.random() * fleet.length)];
        let c2 = fleet[Math.floor(Math.random() * fleet.length)];
        for (let k = 0; k < 4 && c2.faction === a.faction; k++) c2 = fleet[Math.floor(Math.random() * fleet.length)];
        from.copy(a.pos).add(v3.set((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 300));
        to.copy(c2.pos).add(v3.set((Math.random() - 0.5) * 500, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 500));
        bm.mesh.position.copy(from).lerp(to, 0.5);
        bm.mesh.lookAt(to);
        bm.mesh.scale.set(7, 7, from.distanceTo(to));
        (bm.mesh.material as MeshBasicMaterial).color.set(a.faction ? 0xff4030 : 0x40d0ff);
        bm.t = 0; bm.life = 0.25 + Math.random() * 0.5; bm.mesh.visible = true;
        if (Math.random() < 0.6) fx.explosion(to.x, to.y, to.z, 30 + Math.random() * 40, a.faction ? 0xff6030 : 0x60c0ff);
      }
    }
    if (flakT <= 0) {
      flakT = 0.5 + Math.random() * 1.4;
      const a = fleet[Math.floor(Math.random() * (fleet.length - 1))];
      fx.explosion(a.pos.x + (Math.random() - 0.5) * 900, a.pos.y + (Math.random() - 0.5) * 400, a.pos.z + (Math.random() - 0.5) * 900, 18 + Math.random() * 26, 0xffa040);
    }
    for (const bm of beams) {
      if (bm.t >= bm.life) { if (bm.mesh.visible) bm.mesh.visible = false; continue; }
      bm.t += dt;
      (bm.mesh.material as MeshBasicMaterial).opacity = Math.sin(Math.min(1, bm.t / bm.life) * Math.PI) * 0.9;
    }
  });

  // wreckage drifting beside the racing line
  const metal = new MeshStandardMaterial({ color: 0x4a4048, metalness: 0.8, roughness: 0.5 });
  const plates = b.instanced(new BoxGeometry(1, 0.1, 1), metal, Math.round(260 * b.density));
  const girders = b.instanced(new BoxGeometry(0.6, 0.6, 1), metal.clone(), Math.round(200 * b.density));
  const chunks = b.instanced(rockGeometry(55, 1, 0.45), new MeshStandardMaterial({ color: 0x3a3238, metalness: 0.7, roughness: 0.6, flatShading: true }), Math.round(200 * b.density));
  const hot = b.instanced(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffffff }), Math.round(120 * b.density));
  for (let i = 0; i < 760 * b.density; i++) {
    const s = b.randomSample();
    const sec = sectionAt(track, s.u);
    if (sec === 'open' && !rng.chance(0.3)) continue;
    const side = rng.sign();
    const lat = s.hw + 12 + Math.pow(rng.next(), 1.5) * (sec === 'wreck' ? 260 : 420);
    const x = s.x + s.rx * side * lat, z = s.z + s.rz * side * lat, y = s.y + rng.range(-90, 110);
    const r = rng.range(5, 26);
    if (!b.clearOfTrack(x, y, z, r) || b.capDist(x, z) < 120 + r) continue;
    const k = i % 3;
    if (k === 0) plates.add(mat4(x, y, z, rng.range(0, 6), rng.range(0, 6), rng.range(0, 6), r * 1.6, 1.4, r));
    else if (k === 1) girders.add(mat4(x, y, z, rng.range(0, 6), rng.range(0, 6), rng.range(0, 6), 1.4, 1.4, r * 3));
    else { chunks.add(mat4(x, y, z, rng.range(0, 6), rng.range(0, 6), rng.range(0, 6), r, r * 0.6, r * 1.4)); if (rng.chance(0.6)) hot.add(mat4(x, y, z, rng.range(0, 6), rng.range(0, 6), 0, r * 0.5, 0.5, r * 0.3), rng.chance(0.5) ? 0xff6020 : 0xffb040); }
  }
  plates.done(); girders.done(); chunks.done(); hot.done();
  edgeBuoys(b, 12);
  void theme;
}

export function buildEnvironment(track: Track, theme: Theme, quality: Quality, glow: Texture, cap: Capital): Environment {
  const b = new Builder(track, theme, quality, glow, cap);
  buildSky(b);
  switch (track.def.id) {
    case 'neon': buildNeon(b); break;
    case 'orbit': buildOrbit(b); break;
    case 'solar': buildSolar(b); break;
    case 'warzone': buildWarzone(b); break;
  }
  return {
    group: b.group, sky: b.sky,
    update(dt, time, cam, fx) { b.sky.position.copy(cam); for (const u of b.updaters) u(dt, time, cam, fx); },
    dispose() {
      for (const d of b.disposables) d.dispose();
      b.group.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); });
    },
  };
}
