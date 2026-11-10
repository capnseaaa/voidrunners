// Builds the drivable track visuals from the exact sampled data the physics
// uses: road ribbons, edge barriers (omitted where routes join), checkpoint
// gates, the start/finish line, boost pads and route signs.
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, Texture, Vector3,
} from 'three';
import type { Layout } from '../sim/layout';
import { frameAt, idxAtS, insidePath, newFrame, type Track, type TrackPath } from '../tracks/track';
import type { Theme } from './themes';
import { canvasTexture, hex, Kit } from './util';

export interface TrackVisual { group: Group; update(time: number): void; dispose(): void }

function roadTextures(theme: Theme): { map: Texture; emissive: Texture } {
  const draw = (emissive: boolean) => canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = emissive ? '#000' : theme.road;
    ctx.fillRect(0, 0, w, h);
    if (!emissive) {
      // plating
      for (let y = 0; y < h; y += 64) {
        ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fillRect(0, y, w, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, y + 2, w, 2);
      }
      for (let x = 32; x < w; x += 64) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(x, 0, 1, h); }
      for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 1 + Math.random() * 12); }
    }
    ctx.fillStyle = theme.roadLine;
    // edge bands
    ctx.globalAlpha = emissive ? 0.95 : 0.8;
    ctx.fillRect(4, 0, 7, h); ctx.fillRect(w - 11, 0, 7, h);
    // lane dashes
    ctx.globalAlpha = emissive ? 0.55 : 0.5;
    for (let y = 0; y < h; y += 128) { ctx.fillRect(w / 2 - 2, y + 16, 4, 60); }
    ctx.globalAlpha = emissive ? 0.22 : 0.25;
    for (let y = 0; y < h; y += 64) { ctx.fillRect(w * 0.25 - 1, y + 10, 2, 22); ctx.fillRect(w * 0.75 - 1, y + 10, 2, 22); }
    // speed chevrons
    ctx.globalAlpha = emissive ? 0.16 : 0.2;
    ctx.lineWidth = 3; ctx.strokeStyle = theme.roadLine;
    for (let y = 250; y < h; y += 256) { ctx.beginPath(); ctx.moveTo(w * 0.38, y); ctx.lineTo(w * 0.5, y - 26); ctx.lineTo(w * 0.62, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
  });
  return { map: draw(false), emissive: draw(true) };
}

/** For each sample and side, is the edge open (lying inside a connected route)? */
function openEdges(track: Track, path: TrackPath): { left: boolean[]; right: boolean[] } {
  const n = path.samples.length;
  const left = new Array<boolean>(n).fill(false), right = new Array<boolean>(n).fill(false);
  const main = track.main, mn = main.samples.length;
  for (let i = 0; i < n; i++) {
    const s = path.samples[i];
    for (const side of [-1, 1]) {
      const ex = s.x + s.rx * s.hw * side, ez = s.z + s.rz * s.hw * side;
      let open = false;
      if (path.id === 0) {
        for (let b = 1; b < track.paths.length && !open; b++) {
          const br = track.paths[b], bn = br.samples.length;
          let rel = i - br.fromIdx; if (rel > mn / 2) rel -= mn; else if (rel < -mn / 2) rel += mn;
          if (rel >= -4 && rel <= br.forkEnd + 10) open = insidePath(br, ex, ez, Math.max(0, rel), 14, -1.2);
          let relEnd = i - br.toIdx; if (relEnd > mn / 2) relEnd -= mn; else if (relEnd < -mn / 2) relEnd += mn;
          const ml = bn - 1 - br.mergeStart;
          if (!open && relEnd >= -(ml + 10) && relEnd <= 4) open = insidePath(br, ex, ez, Math.min(bn - 1, bn - 1 + relEnd), 14, -1.2);
        }
      } else {
        if (i <= path.forkEnd + 10) open = insidePath(main, ex, ez, path.fromIdx + i, 14, -1.2);
        else if (i >= path.mergeStart - 10) open = insidePath(main, ex, ez, path.toIdx - (n - 1 - i), 14, -1.2);
      }
      if (side < 0) left[i] = open; else right[i] = open;
    }
  }
  return { left, right };
}

export function buildTrackVisual(track: Track, layout: Layout, theme: Theme, glowTex: Texture): TrackVisual {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const tex = roadTextures(theme);
  disposables.push(tex.map, tex.emissive);
  const roadMat = new MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 1.5, metalness: 0.55, roughness: 0.42, side: DoubleSide });
  const wallMat = new MeshStandardMaterial({ color: 0x1a1d2c, metalness: 0.7, roughness: 0.4, side: DoubleSide });
  const railL = new MeshBasicMaterial({ color: new Color(theme.rail).multiplyScalar(1.5) });
  const railR = new MeshBasicMaterial({ color: new Color(theme.railAlt).multiplyScalar(1.5) });
  disposables.push(roadMat, wallMat, railL, railR);

  for (const path of track.paths) {
    const ss = path.samples, n = ss.length;
    const count = path.closed ? n + 1 : n;
    const pos = new Float32Array(count * 2 * 3), uv = new Float32Array(count * 2 * 2), nor = new Float32Array(count * 2 * 3);
    for (let k = 0; k < count; k++) {
      const s = ss[k % n];
      const v = (k * path.step) / 30;
      pos.set([s.x - s.rx * s.hw, s.y, s.z - s.rz * s.hw, s.x + s.rx * s.hw, s.y, s.z + s.rz * s.hw], k * 6);
      uv.set([0, v, 1, v], k * 4);
      nor.set([0, 1, 0, 0, 1, 0], k * 6);
    }
    const idx: number[] = [];
    for (let k = 0; k < count - 1; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setIndex(idx);
    const road = new Mesh(geo, roadMat);
    // branches sit a hair above the main ribbon so overlapping junction surfaces never z-fight
    if (path.id > 0) road.position.y = 0.04;
    group.add(road);
    disposables.push(geo);

    // barriers
    const open = openEdges(track, path);
    for (const side of [-1, 1]) {
      const flags = side < 0 ? open.left : open.right;
      const wp: number[] = [], rp: number[] = [];
      for (let k = 0; k < count - 1; k++) {
        const i0 = k % n, i1 = (k + 1) % n;
        if (flags[i0] || flags[i1]) continue;
        const a = ss[i0], b = ss[i1];
        const ax = a.x + a.rx * a.hw * side, az = a.z + a.rz * a.hw * side;
        const bx = b.x + b.rx * b.hw * side, bz = b.z + b.rz * b.hw * side;
        const aox = ax + a.rx * side * 0.7, aoz = az + a.rz * side * 0.7;
        const box = bx + b.rx * side * 0.7, boz = bz + b.rz * side * 0.7;
        const H = 2.1;
        // inner face
        wp.push(ax, a.y - 0.5, az, bx, b.y - 0.5, bz, aox, a.y + H, aoz, aox, a.y + H, aoz, bx, b.y - 0.5, bz, box, b.y + H, boz);
        // glowing rail cap
        const acx = aox + a.rx * side * 0.5, acz = aoz + a.rz * side * 0.5;
        const bcx = box + b.rx * side * 0.5, bcz = boz + b.rz * side * 0.5;
        rp.push(aox, a.y + H, aoz, box, b.y + H, boz, acx, a.y + H, acz, acx, a.y + H, acz, box, b.y + H, boz, bcx, b.y + H, bcz);
        // lower inner glow strip
        rp.push(ax, a.y + 0.05, az, bx, b.y + 0.05, bz, ax + (aox - ax) * 0.12, a.y + 0.35, az + (aoz - az) * 0.12,
          ax + (aox - ax) * 0.12, a.y + 0.35, az + (aoz - az) * 0.12, bx, b.y + 0.05, bz, bx + (box - bx) * 0.12, b.y + 0.35, bz + (boz - bz) * 0.12);
      }
      if (wp.length) {
        const wg = new BufferGeometry();
        wg.setAttribute('position', new BufferAttribute(new Float32Array(wp), 3));
        wg.computeVertexNormals();
        group.add(new Mesh(wg, wallMat));
        const rg = new BufferGeometry();
        rg.setAttribute('position', new BufferAttribute(new Float32Array(rp), 3));
        const rail = new Mesh(rg, side < 0 ? railL : railR);
        (rail.material as MeshBasicMaterial).side = DoubleSide;
        group.add(rail);
        disposables.push(wg, rg);
      }
    }
  }

  // underside ribs: give the ribbon some physical structure
  {
    const main = track.main;
    const every = 3;
    const ribGeo = new BoxGeometry(1, 0.7, 1.4);
    const ribMat = new MeshStandardMaterial({ color: 0x23263a, metalness: 0.6, roughness: 0.5 });
    let total = 0;
    for (const p of track.paths) total += Math.ceil(p.samples.length / every);
    const ribs = new InstancedMesh(ribGeo, ribMat, total);
    const m = new Matrix4(), q = new Quaternion(), v = new Vector3(), sc = new Vector3(), zAxis = new Vector3(0, 0, 1), dir = new Vector3();
    let c = 0;
    for (const p of track.paths) for (let i = 0; i < p.samples.length; i += every) {
      const s = p.samples[i];
      dir.set(s.tx, s.ty, s.tz);
      q.setFromUnitVectors(zAxis, dir);
      m.compose(v.set(s.x, s.y - 0.5, s.z), q, sc.set(s.hw * 2 + 2.6, 1, 1));
      ribs.setMatrixAt(c++, m);
    }
    ribs.count = c;
    group.add(ribs);
    disposables.push(ribGeo, ribMat);
    void main;
  }

  // checkpoint gates and the start / finish line
  const fr = newFrame();
  const gateMats = {
    dark: new MeshStandardMaterial({ color: 0x20243a, metalness: 0.7, roughness: 0.35 }),
    hull: new MeshStandardMaterial({ color: 0x20243a, metalness: 0.7, roughness: 0.35 }),
    glow: new MeshBasicMaterial({ color: new Color(theme.gate).multiplyScalar(1.6) }),
    finish: new MeshBasicMaterial({ color: 0xffffff }),
  };
  disposables.push(...Object.values(gateMats));
  const kit = new Kit();
  for (const cp of track.checkpoints) {
    const i = idxAtS(track.main, cp.prog);
    frameAt(track.main, i, 0, fr);
    const yaw = Math.atan2(fr.hx, fr.hz);
    const finish = cp.index === 0;
    const H = finish ? 15 : 11, w = fr.hw + 2.2;
    for (const side of [-1, 1]) {
      const px = fr.x + fr.rx * w * side, pz = fr.z + fr.rz * w * side;
      kit.add('dark', new BoxGeometry(1.6, H, 1.6), px, fr.y + H / 2 - 1, pz, 0, yaw, 0);
      kit.add('glow', new BoxGeometry(0.4, H * 0.8, 1.8), px - fr.rx * 0.75 * side, fr.y + H / 2 - 1, pz - fr.rz * 0.75 * side, 0, yaw, 0);
    }
    kit.add('dark', new BoxGeometry(w * 2 + 1.6, finish ? 2.6 : 1.4, 1.6), fr.x, fr.y + H - 1, fr.z, 0, yaw, 0);
    kit.add(finish ? 'finish' : 'glow', new BoxGeometry(w * 2 - 2, 0.35, 1.9), fr.x, fr.y + H - (finish ? 2.5 : 1.9), fr.z, 0, yaw, 0);
  }
  group.add(kit.build(gateMats));

  // chequered start line
  {
    frameAt(track.main, 0, 0, fr);
    const checker = canvasTexture(256, 32, (ctx, w, h) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { ctx.fillStyle = (x + y) % 2 ? '#fff' : '#111'; ctx.fillRect(x * (w / 16), y * (h / 2), w / 16, h / 2); }
    }, false);
    const geo = new PlaneGeometry(fr.hw * 2 - 1, 5);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({ map: checker, toneMapped: false });
    const line = new Mesh(geo, mat);
    line.position.set(fr.x, fr.y + 0.08, fr.z);
    line.rotation.y = Math.atan2(fr.hx, fr.hz);
    group.add(line);
    disposables.push(checker, geo, mat);
  }

  // boost pads
  const padTex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 14; ctx.lineJoin = 'miter';
    for (let y = 0; y < 3; y++) { const yy = 118 - y * 42; ctx.beginPath(); ctx.moveTo(14, yy); ctx.lineTo(w / 2, yy - 34); ctx.lineTo(w - 14, yy); ctx.stroke(); }
  });
  const padMat = new MeshBasicMaterial({ map: padTex, color: new Color(theme.pad).multiplyScalar(1.7), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const padGeo = new PlaneGeometry(11, 14);
  padGeo.rotateX(-Math.PI / 2);
  padGeo.rotateY(Math.PI); // texture "up" points along +z (direction of travel)
  const padBase = new MeshBasicMaterial({ color: new Color(theme.pad).multiplyScalar(0.22), transparent: true, opacity: 0.85 });
  disposables.push(padTex, padMat, padGeo, padBase);
  for (const p of layout.pads) {
    const base = new Mesh(padGeo, padBase);
    base.position.set(p.x, p.y + 0.1, p.z);
    base.rotation.y = Math.atan2(p.hx, p.hz);
    const top = new Mesh(padGeo, padMat);
    top.position.y = 0.06;
    base.add(top);
    group.add(base);
  }

  // route signs ahead of each fork
  for (let b = 1; b < track.paths.length; b++) {
    const br = track.paths[b];
    const main = track.main, mn = main.samples.length;
    const at = main.samples[(br.fromIdx - Math.round(110 / main.step) + mn) % mn];
    const probe = br.samples[Math.min(br.samples.length - 1, br.forkEnd + 6)];
    const ref = main.samples[(br.fromIdx + br.forkEnd + 6) % mn];
    const side = (probe.x - ref.x) * ref.rx + (probe.z - ref.z) * ref.rz > 0 ? 1 : -1;
    const label = br.kind === 'shortcut' ? 'SHORTCUT' : br.kind === 'risky' ? 'HIGH RISK' : 'ALT ROUTE';
    const col = br.kind === 'shortcut' ? '#7dff5a' : '#ff9a2a';
    const tex2 = canvasTexture(512, 160, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(5,6,18,0.92)'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = col; ctx.font = 'bold 54px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const arrow = side > 0 ? '▶' : '◀';
      ctx.fillText(side > 0 ? `${label} ${arrow}` : `${arrow} ${label}`, w / 2, 58);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Arial, sans-serif';
      ctx.fillText(br.name.toUpperCase(), w / 2, 118);
    }, false);
    const geo = new PlaneGeometry(22, 6.9);
    const mat = new MeshBasicMaterial({ map: tex2, side: DoubleSide, toneMapped: false });
    const sign = new Mesh(geo, mat);
    sign.position.set(at.x + at.rx * side * (at.hw * 0.45), at.y + 12.5, at.z + at.rz * side * (at.hw * 0.45));
    sign.rotation.y = Math.atan2(at.hx, at.hz) + Math.PI;
    group.add(sign);
    const postGeo = new BoxGeometry(0.6, 12, 0.6);
    const post = new Mesh(postGeo, gateMats.dark);
    post.position.set(at.x + at.rx * side * (at.hw + 1.5), at.y + 6, at.z + at.rz * side * (at.hw + 1.5));
    group.add(post);
    const armGeo = new BoxGeometry(at.hw * 0.55 + 12, 0.5, 0.5);
    const arm = new Mesh(armGeo, gateMats.dark);
    arm.position.set(at.x + at.rx * side * (at.hw * 0.72), at.y + 16.2, at.z + at.rz * side * (at.hw * 0.72));
    arm.rotation.y = Math.atan2(at.hx, at.hz);
    group.add(arm);
    disposables.push(tex2, geo, mat, postGeo, armGeo);
  }
  void glowTex;

  return {
    group,
    update(time: number) { padTex.offset.y = -(time * 1.6) % 1; },
    dispose() { for (const d of disposables) d.dispose(); group.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); }); },
  };
}
