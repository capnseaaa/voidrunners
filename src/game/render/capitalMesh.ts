// The capital ship: a chunky retro battleship hull with separately modelled
// destructible components and a shield envelope.
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, CylinderGeometry, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Texture, TorusGeometry,
} from 'three';
import { Rng } from '../core/rng';
import { HULL_HALF_HEIGHT, HULL_HALF_WIDTH, type Capital, type Component } from '../sim/capital';
import type { Fx } from './fx';
import type { Theme } from './themes';
import { canvasTexture, Kit, taperBox, windowTexture, zCyl, hex } from './util';

export interface CapitalVisual { group: Group; update(dt: number, time: number, fx: Fx): void; dispose(): void }

/** World-scale box-projected UVs so window / plating textures tile evenly on any hull size. */
export function boxProjectUV(geo: BufferGeometry, scale: number): void {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i) / scale, p.getY(i) / scale);
    else if (ay >= az) uv.setXY(i, p.getX(i) / scale, p.getZ(i) / scale);
    else uv.setXY(i, p.getX(i) / scale, p.getY(i) / scale);
  }
  uv.needsUpdate = true;
}

function platingTexture(base: number): Texture {
  const rng = new Rng(77);
  const col = new Color(base);
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = hex(base); ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const k = rng.range(0.75, 1.2);
      ctx.fillStyle = `rgb(${Math.min(255, col.r * 255 * k) | 0},${Math.min(255, col.g * 255 * k) | 0},${Math.min(255, col.b * 255 * k) | 0})`;
      ctx.fillRect(rng.int(0, 15) * 16, rng.int(0, 15) * 16, rng.int(1, 5) * 16, rng.int(1, 3) * 16);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 16; i++) { ctx.beginPath(); ctx.moveTo(i * 16, 0); ctx.lineTo(i * 16, h); ctx.moveTo(0, i * 16); ctx.lineTo(w, i * 16); ctx.stroke(); }
  });
}

/** Generic hull used both for the encounter ship and for distant fleet silhouettes. */
export function buildHull(length: number, hullColor: number, stripe: number, glow: number, seed: number, detail: number, trackSide: number): { group: Group; mats: Material[]; engineGlow: MeshBasicMaterial; hullMat: MeshStandardMaterial } {
  const L = length, W = HULL_HALF_WIDTH, H = HULL_HALF_HEIGHT;
  const rng = new Rng(seed);
  const plating = platingTexture(hullColor);
  const windows = windowTexture(seed, ['#ffe9b0', '#fff', hex(glow), '#ffd070'], 0.16);
  const hullMat = new MeshStandardMaterial({ map: plating, emissiveMap: windows, emissive: 0xffffff, emissiveIntensity: 1.1, metalness: 0.55, roughness: 0.6 });
  const darkMat = new MeshStandardMaterial({ color: 0x15161e, metalness: 0.7, roughness: 0.5 });
  const stripeMat = new MeshBasicMaterial({ color: new Color(stripe).multiplyScalar(1.4) });
  const engineGlow = new MeshBasicMaterial({ color: new Color(glow).multiplyScalar(2) });
  const k = new Kit();
  // main body: stern block + bow wedge (bow is at -z)
  k.add('hull', new BoxGeometry(W * 2, H * 1.55, L * 0.55), 0, 0, L * 0.225);
  k.add('hull', taperBox(W * 2, H * 1.55, L * 0.45, 1, 1, 0.16, 0.3), 0, 0, -L * 0.275);
  // decks and superstructure
  k.add('hull', taperBox(W * 1.35, H * 0.5, L * 0.6, 1, 1, 0.5, 1), 0, H * 0.98, L * 0.12);
  k.add('hull', taperBox(W * 0.85, H * 0.55, L * 0.26, 0.9, 1, 0.7, 1), 0, H * 1.5, L * 0.2);
  k.add('hull', new BoxGeometry(W * 0.5, H * 0.9, L * 0.07), 0, H * 2.15, L * 0.27);
  k.add('stripe', new BoxGeometry(W * 0.52, H * 0.12, L * 0.072), 0, H * 2.35, L * 0.27);
  k.add('dark', new BoxGeometry(W * 0.2, H * 0.5, L * 0.03), 0, H * 2.8, L * 0.28);
  // keel
  k.add('hull', taperBox(W * 0.9, H * 0.6, L * 0.62, 1, 1, 0.3, 0.4), 0, -H * 1.0, L * 0.06);
  k.add('dark', taperBox(W * 0.3, H * 0.5, L * 0.3, 1, 1, 0.5, 0.5), 0, -H * 1.5, L * 0.1);
  // stern engine block; the two nozzles on the track-facing flank are destructible components
  k.add('dark', new BoxGeometry(W * 1.9, H * 1.45, L * 0.04), 0, 0, L * 0.5);
  for (const x of [0, -trackSide * W * 0.72]) for (const y of [10, -12]) {
    k.add('dark', zCyl(12, 15, 32, 16), x, y, L * 0.5 + 16);
    k.add('engine', zCyl(11, 11, 0.6, 16), x, y, L * 0.5 + 31);
  }
  // hull stripes
  for (const s of [1, -1]) {
    k.add('stripe', new BoxGeometry(0.8, 2.6, L * 0.5), s * (W + 0.3), H * 0.35, L * 0.2);
    k.add('stripe', new BoxGeometry(0.8, 1.2, L * 0.5), s * (W + 0.3), -H * 0.45, L * 0.2);
  }
  // spires
  k.add('dark', new BoxGeometry(1.2, 40, 1.2), W * 0.3, H * 2.2, L * 0.16);
  k.add('dark', new BoxGeometry(1.2, 28, 1.2), -W * 0.4, H * 2.0, L * 0.05);
  // greebles
  for (let i = 0; i < detail; i++) {
    const z = rng.range(-0.15, 0.46) * L;
    const w = rng.range(4, 14), h = rng.range(2, 8), d = rng.range(6, 30);
    const where = rng.int(0, 2);
    if (where === 0) k.add(rng.chance(0.3) ? 'dark' : 'hull', new BoxGeometry(w, h, d), rng.range(-W * 0.6, W * 0.6), H * 1.23 + h / 2, z);
    else if (where === 1) k.add(rng.chance(0.4) ? 'dark' : 'hull', new BoxGeometry(h, w, d), -trackSide * (W + h / 2), rng.range(-H * 0.6, H * 0.6), z);
    else k.add('hull', new BoxGeometry(w, h, d), rng.range(-W * 0.8, W * 0.8), H * 0.775 + h / 2, rng.range(-0.3, -0.05) * L);
  }
  // deck gun emplacements (decorative)
  for (let i = 0; i < 5; i++) {
    const z = (-0.32 + i * 0.1) * L;
    k.add('dark', new CylinderGeometry(7, 8, 4, 10), 0, H * 0.82 + (i > 1 ? H * 0.46 : 0), z);
    k.add('dark', zCyl(1.2, 1.2, 22, 8), 2.4, H * 0.9 + (i > 1 ? H * 0.46 : 0) + 2, z - 12);
    k.add('dark', zCyl(1.2, 1.2, 22, 8), -2.4, H * 0.9 + (i > 1 ? H * 0.46 : 0) + 2, z - 12);
  }
  const group = k.build({ hull: hullMat, dark: darkMat, stripe: stripeMat, engine: engineGlow });
  group.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.material === hullMat) boxProjectUV(m.geometry, 90); });
  return { group, mats: [hullMat, darkMat, stripeMat, engineGlow, plating as unknown as Material, windows as unknown as Material], engineGlow, hullMat };
}

interface CompVis { comp: Component; live: Group; wreck: Group; flash: Mesh; spin?: Mesh; flame?: Mesh; fireT: number; wasAlive: boolean }

export function buildCapitalVisual(cap: Capital, theme: Theme, glowTex: Texture, trackSide: number): CapitalVisual {
  const root = new Group();
  const disposables: { dispose(): void }[] = [];
  const hull = buildHull(cap.length, theme.capitalHull, theme.capitalStripe, theme.capitalGlow, 4242 + cap.length, 150, trackSide);
  const hullGroup = new Group();
  hullGroup.add(hull.group);
  hullGroup.position.set(cap.cx, cap.cy, cap.cz);
  const yaw = Math.atan2(cap.dirX, cap.dirZ);
  hullGroup.rotation.y = yaw;
  root.add(hullGroup);
  disposables.push(...(hull.mats as unknown as { dispose(): void }[]));

  // engine wash sprites on the fixed nozzles
  const washMat = new SpriteMaterial({ map: glowTex, color: theme.capitalGlow, blending: AdditiveBlending, depthWrite: false, transparent: true });
  disposables.push(washMat);
  const washes: Sprite[] = [];
  for (const x of [0, -trackSide * HULL_HALF_WIDTH * 0.72]) for (const y of [10, -12]) {
    const sp = new Sprite(washMat);
    sp.position.set(x, y, cap.length * 0.5 + 38);
    sp.scale.setScalar(90);
    hull.group.add(sp);
    washes.push(sp);
  }

  // shield envelope
  const shieldMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uHit: { value: 0 }, uColor: { value: new Color(0x40d8ff) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uAlpha, uHit; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float grid = smoothstep(0.92, 1.0, abs(sin(vP.z * 40.0 + uTime * 1.5))) + smoothstep(0.94, 1.0, abs(sin(vP.y * 22.0)));
        float a = (f * 0.55 + grid * 0.07 + uHit * 0.35) * uAlpha;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    blending: AdditiveBlending, depthWrite: false, transparent: true,
  });
  const shieldGeo = new SphereGeometry(1, 40, 24);
  const shield = new Mesh(shieldGeo, shieldMat);
  shield.scale.set(HULL_HALF_WIDTH + 34, HULL_HALF_HEIGHT * 2 + 46, cap.length * 0.5 + 60);
  shield.position.y = 14;
  hullGroup.add(shield);
  disposables.push(shieldMat, shieldGeo);

  // ------------------------------------------------------------ components
  const mats = {
    hull: new MeshStandardMaterial({ color: 0x3a3f52, metalness: 0.7, roughness: 0.4 }),
    dark: new MeshStandardMaterial({ color: 0x14151c, metalness: 0.7, roughness: 0.5 }),
    red: new MeshBasicMaterial({ color: new Color(0xff3030).multiplyScalar(1.6) }),
    cyan: new MeshBasicMaterial({ color: new Color(0x40e8ff).multiplyScalar(1.7) }),
    yellow: new MeshStandardMaterial({ color: 0xe8b820, metalness: 0.4, roughness: 0.5 }),
    orange: new MeshStandardMaterial({ color: 0xd85a18, metalness: 0.4, roughness: 0.5 }),
    blue: new MeshStandardMaterial({ color: 0x2a6ad8, metalness: 0.4, roughness: 0.5 }),
    engine: new MeshBasicMaterial({ color: new Color(theme.capitalGlow).multiplyScalar(2.2) }),
    char: new MeshStandardMaterial({ color: 0x0c0a0a, metalness: 0.4, roughness: 0.9, emissive: 0x501000, emissiveIntensity: 0.6 }),
  };
  disposables.push(...Object.values(mats));
  const flashGeo = new SphereGeometry(1, 14, 10);
  const flameGeo = zCyl(11, 0.5, 1, 14, true);
  flameGeo.translate(0, 0, 0.5);
  const flameMat = new MeshBasicMaterial({ color: theme.capitalGlow, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false });
  disposables.push(flashGeo, flameGeo, flameMat);
  const comps: CompVis[] = [];
  // unit vectors: toward the track (-n) and along the hull
  const tx = -cap.nx, tz = -cap.nz;
  const faceTrack = Math.atan2(tx, tz);
  for (const comp of cap.components) {
    const kit = new Kit();
    const wk = new Kit();
    let spin: Mesh | undefined, flame: Mesh | undefined;
    const r = comp.r;
    if (comp.type === 'battery') {
      kit.add('hull', new CylinderGeometry(r * 0.8, r * 0.95, r * 0.6, 12), 0, -r * 0.3, 0);
      kit.add('dark', taperBox(r * 1.1, r * 0.7, r * 1.3, 0.7, 0.7), 0, r * 0.25, r * 0.1);
      for (const s of [1, -1]) { kit.add('dark', zCyl(r * 0.11, r * 0.11, r * 1.5, 8), s * r * 0.3, r * 0.25, r * 1.2); kit.add('red', zCyl(r * 0.13, r * 0.13, r * 0.12, 8), s * r * 0.3, r * 0.25, r * 1.95); }
      kit.add('red', new BoxGeometry(r * 0.9, r * 0.1, r * 0.1), 0, r * 0.64, r * 0.3);
      wk.add('char', new CylinderGeometry(r * 0.7, r * 0.95, r * 0.5, 7), 0, -r * 0.3, 0);
      wk.add('char', taperBox(r * 0.8, r * 0.4, r, 0.4, 0.3), 0, r * 0.1, 0, 0.3, 0.2, 0.2);
    } else if (comp.type === 'shield') {
      kit.add('hull', new CylinderGeometry(r * 0.9, r * 1.05, r * 0.5, 14), 0, -r * 0.55, 0);
      kit.add('cyan', new SphereGeometry(r * 0.62, 18, 12), 0, 0.05 * r, 0);
      for (const a of [0, 1, 2]) kit.add('dark', new BoxGeometry(r * 0.12, r * 1.3, r * 0.12), Math.cos(a * 2.09) * r * 0.8, 0, Math.sin(a * 2.09) * r * 0.8, 0, 0, 0);
      wk.add('char', new CylinderGeometry(r * 0.8, r * 1.05, r * 0.5, 9), 0, -r * 0.55, 0);
      wk.add('char', new SphereGeometry(r * 0.45, 6, 4), 0, -r * 0.2, 0, 0, 0, 0, 1, 0.5, 1);
    } else if (comp.type === 'cargo') {
      const rng = new Rng(9);
      const cols = ['yellow', 'orange', 'blue'];
      for (let ix = -1; ix <= 1; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = -1; iz <= 1; iz++) {
        if (rng.chance(0.15)) continue;
        kit.add(rng.pick(cols), new BoxGeometry(r * 0.52, r * 0.5, r * 0.62), ix * r * 0.56, -r * 0.3 + iy * r * 0.54, iz * r * 0.66);
      }
      kit.add('dark', new BoxGeometry(r * 1.9, r * 0.12, r * 2.2), 0, -r * 0.62, 0);
      for (const s of [1, -1]) kit.add('dark', new BoxGeometry(r * 0.1, r * 1.3, r * 0.1), s * r * 0.9, 0, r * 1.05);
      wk.add('char', new BoxGeometry(r * 1.7, r * 0.12, r * 2.0), 0, -r * 0.62, 0, 0, 0, 0.1);
      wk.add('char', new BoxGeometry(r * 0.5, r * 0.4, r * 0.6), r * 0.3, -r * 0.35, -r * 0.4, 0.3, 0.4, 0.2);
    } else {
      kit.add('dark', zCyl(r * 0.72, r * 0.9, r * 2, 16), 0, 0, r * 0.7);
      kit.add('hull', zCyl(r * 0.95, r * 0.95, r * 0.3, 16), 0, 0, r * 0.2);
      kit.add('engine', zCyl(r * 0.66, r * 0.66, 0.5, 16), 0, 0, r * 1.66);
      wk.add('char', zCyl(r * 0.72, r * 0.8, r * 1.2, 9), 0, 0, r * 0.3, 0.1, 0.1, 0);
    }
    const live = kit.build(mats);
    const wreck = wk.build(mats);
    wreck.visible = false;
    const holder = new Group();
    holder.position.set(comp.x, comp.y, comp.z);
    holder.rotation.y = comp.type === 'engine' ? yaw : faceTrack;
    holder.add(live, wreck);
    if (comp.type === 'shield') {
      const tg = new TorusGeometry(r * 0.85, r * 0.06, 8, 28);
      spin = new Mesh(tg, mats.cyan);
      live.add(spin);
      disposables.push(tg);
    }
    if (comp.type === 'engine') {
      flame = new Mesh(flameGeo, flameMat);
      flame.position.z = r * 1.7;
      flame.scale.set(1, 1, 70);
      live.add(flame);
      const sp = new Sprite(washMat);
      sp.position.z = r * 2; sp.scale.setScalar(90);
      live.add(sp);
    }
    const fm = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    const flash = new Mesh(flashGeo, fm);
    flash.scale.setScalar(r * 1.25);
    holder.add(flash);
    disposables.push(fm);
    root.add(holder);
    comps.push({ comp, live, wreck, flash, spin, flame, fireT: 0, wasAlive: true });
  }

  let shieldAlpha = 1;
  let boomT = 0;
  const rng = new Rng(5);
  return {
    group: root,
    update(dt, time, fx) {
      shieldMat.uniforms.uTime.value = time;
      shieldAlpha += ((cap.shieldUp ? 1 : 0) - shieldAlpha) * Math.min(1, dt * 2.5);
      shieldMat.uniforms.uAlpha.value = shieldAlpha;
      shieldMat.uniforms.uHit.value = cap.shieldFlash;
      shield.visible = shieldAlpha > 0.01;
      for (const cv of comps) {
        const c = cv.comp;
        (cv.flash.material as MeshBasicMaterial).opacity = c.flash * 0.55;
        if (cv.spin) { cv.spin.rotation.x = time * 1.4; cv.spin.rotation.y = time * 2.1; }
        if (cv.flame) cv.flame.scale.z = 60 + Math.sin(time * 31) * 6;
        if (!c.alive && cv.wasAlive) { cv.wasAlive = false; cv.live.visible = false; cv.wreck.visible = true; }
        if (!c.alive) {
          cv.fireT -= dt;
          if (cv.fireT <= 0) { cv.fireT = 0.07 / fx.density; fx.fire(c.x, c.y, c.z, c.r * 0.6); }
        } else if (c.hp < c.maxHp * 0.5) {
          cv.fireT -= dt;
          if (cv.fireT <= 0) { cv.fireT = 0.22 / fx.density; fx.sparks(c.x - cap.nx * c.r * 0.6, c.y, c.z - cap.nz * c.r * 0.6, 2, 0xffa040, 10); }
        }
      }
      if (cap.destroyed) {
        // crippled: secondary explosions ripple down the hull, lights die, the ship lists
        const t = cap.destroyedT;
        if (t < 9) {
          boomT -= dt;
          if (boomT <= 0) {
            boomT = rng.range(0.12, 0.4);
            const u = rng.range(-0.45, 0.45);
            const lat = rng.range(-1, 1) * HULL_HALF_WIDTH, up = rng.range(-20, 50);
            fx.explosion(cap.cx + cap.dirX * u * cap.length - cap.nx * lat, hullGroup.position.y + up, cap.cz + cap.dirZ * u * cap.length - cap.nz * lat, rng.range(8, 20), rng.chance(0.5) ? 0xffa030 : theme.capitalGlow, 0, 0, 0, theme.capitalHull);
          }
        }
        const k = Math.min(1, t / 14);
        hullGroup.rotation.z = trackSide * -0.16 * k * k * (3 - 2 * k);
        hullGroup.rotation.x = 0.05 * k;
        hullGroup.position.y = cap.cy - 26 * k * k;
        hull.hullMat.emissiveIntensity = t < 6 ? (Math.sin(time * 40) > 0.2 ? 1.1 : 0.1) * (1 - t / 6) : 0.04;
        hull.engineGlow.color.setScalar(Math.max(0.05, 1 - t / 3));
        for (const w of washes) w.visible = t < 2;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      root.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); });
    },
  };
}
