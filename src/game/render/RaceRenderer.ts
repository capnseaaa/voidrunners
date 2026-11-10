// Presentation of a running RaceSim: builds the scene once, then mirrors the
// simulation state every frame. It never mutates the simulation.
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BoxGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight,
  DoubleSide, DynamicDrawUsage, FogExp2, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OctahedronGeometry, PerspectiveCamera, PMREMGenerator, Quaternion, RingGeometry, Scene, SphereGeometry, Sprite,
  SpriteMaterial, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer, Euler, BufferGeometry,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ABILITIES } from '../data/ships';
import { angleDelta, clamp } from '../core/rng';
import type { EventQueue } from '../sim/events';
import type { ObstacleKind } from '../sim/layout';
import { COUNTDOWN_TIME, type RaceSim } from '../sim/race';
import type { Ship } from '../sim/ship';
import { CAP_BOLT, MISSILE } from '../sim/weapons';
import { frameAt, newFrame } from '../tracks/track';
import { buildCapitalVisual, type CapitalVisual } from './capitalMesh';
import { buildEnvironment, type Environment } from './environment';
import { Fx } from './fx';
import { buildShipModel, type ShipModel } from './shipModels';
import { THEMES, type Theme } from './themes';
import { buildTrackVisual, type TrackVisual } from './trackMesh';
import { canvasTexture, glowTexture, Kit, rockGeometry, zCyl } from './util';

export type Quality = 'low' | 'medium' | 'high';

interface ShipVis { ship: Ship; model: ShipModel; shield: Mesh; tag: Sprite | null; trailT: number; phasedOn: boolean }
interface ObsVis { kind: ObstacleKind; body: InstancedMesh; glow: InstancedMesh | null; ids: number[] }

const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), v3 = new Vector3(), s3 = new Vector3(), col = new Color();
const Z = new Vector3(0, 0, 1), dir = new Vector3();
const ZERO = new Matrix4().makeScale(0, 0, 0);
const WHITE = new Color(0xffffff);
const PICKUP_COLOR: Record<string, number> = { scrap: 0xffb030, core: 0x40f0ff, cargo: 0xffe14a, overdrive: 0xff40e0, missile: 0xff4040 };
const PICKUP_SCALE: Record<string, number> = { scrap: 1, core: 1.5, cargo: 1.4, overdrive: 1.8, missile: 1.25 };

export class RaceRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly fx: Fx;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly theme: Theme;
  private readonly glowTex: Texture;
  private readonly env: Environment;
  private readonly trackVis: TrackVisual;
  private readonly capVis: CapitalVisual;
  private readonly ships: ShipVis[] = [];
  private readonly bolts: InstancedMesh;
  private readonly missiles: InstancedMesh;
  private readonly pickups: InstancedMesh;
  private readonly obs: ObsVis[] = [];
  private readonly strikeMarks: { ring: Mesh; disc: Mesh }[] = [];
  private readonly reticle: Sprite;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly fr = newFrame();
  private camYaw = 0; private camY = 0; private fov = 70; private shake = 0; private orbit = 0;
  private envTex: Texture | null = null;
  private time = 0;
  shakeEnabled = true;

  constructor(canvas: HTMLCanvasElement, private readonly sim: RaceSim, readonly quality: Quality) {
    this.theme = THEMES[sim.track.def.id];
    const theme = this.theme;
    this.renderer = new WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.25 : 1));
    this.camera = new PerspectiveCamera(70, 1, 0.5, 20000);
    this.scene.fog = new FogExp2(theme.fog, theme.fogDensity);
    this.glowTex = glowTexture();
    this.disposables.push(this.glowTex);

    this.buildEnvMap();
    const hemi = new HemisphereLight(theme.ambientSky, theme.ambientGround, theme.ambientIntensity);
    const sun = new DirectionalLight(theme.sun, theme.sunIntensity);
    sun.position.set(theme.sunDir[0], theme.sunDir[1], theme.sunDir[2]).multiplyScalar(100);
    this.scene.add(hemi, sun);

    this.fx = new Fx(quality);
    this.env = buildEnvironment(sim.track, theme, quality, this.glowTex, sim.capital);
    this.trackVis = buildTrackVisual(sim.track, sim.layout, theme, this.glowTex);
    this.capVis = buildCapitalVisual(sim.capital, theme, this.glowTex, sim.track.def.capital.side);
    this.scene.add(this.env.sky, this.env.group, this.trackVis.group, this.capVis.group, this.fx.group);

    // ---- ships
    const shieldGeo = new SphereGeometry(1, 16, 12);
    this.disposables.push(shieldGeo);
    for (const ship of sim.ships) {
      const model = buildShipModel(ship.def, this.glowTex);
      const shieldMat = new MeshBasicMaterial({ color: 0x60c8ff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: BackSide });
      const shield = new Mesh(shieldGeo, shieldMat);
      shield.scale.set(3.6, 2.2, 4.2);
      model.group.add(shield);
      let tag: Sprite | null = null;
      if (!ship.isPlayer) {
        const tex = canvasTexture(256, 64, (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          ctx.font = 'bold 34px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(ship.name, w / 2, h / 2);
          ctx.fillStyle = '#' + new Color(ship.def.colors.primary).lerp(new Color(0xffffff), 0.45).getHexString(); ctx.fillText(ship.name, w / 2, h / 2);
        }, false);
        const tm = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
        tag = new Sprite(tm);
        tag.renderOrder = 20;
        this.scene.add(tag);
        this.disposables.push(tex, tm);
      }
      this.disposables.push(shieldMat);
      this.scene.add(model.group);
      this.ships.push({ ship, model, shield, tag, trailT: 0, phasedOn: false });
    }

    // ---- projectiles
    const boltGeo = new BoxGeometry(0.28, 0.28, 1);
    const boltMat = new MeshBasicMaterial({ color: 0xffffff, blending: AdditiveBlending, transparent: true, depthWrite: false });
    this.bolts = new InstancedMesh(boltGeo, boltMat, sim.projectiles.items.length);
    this.bolts.instanceMatrix.setUsage(DynamicDrawUsage);
    this.bolts.frustumCulled = false;
    this.bolts.setColorAt(0, col.set(0xffffff));
    const mk = new Kit();
    mk.add('hull', zCyl(0.22, 0.22, 1.6, 8), 0, 0, 0);
    mk.add('hull', zCyl(0.22, 0.02, 0.6, 8), 0, 0, 1.1);
    mk.add('hull', new BoxGeometry(0.9, 0.06, 0.5), 0, 0, -0.6);
    mk.add('hull', new BoxGeometry(0.06, 0.9, 0.5), 0, 0, -0.6);
    const missMat = new MeshStandardMaterial({ color: 0xe8e8f0, metalness: 0.6, roughness: 0.3, emissive: 0x402010 });
    const mg = mk.build({ hull: missMat });
    this.missiles = new InstancedMesh((mg.children[0] as Mesh).geometry, missMat, 48);
    this.missiles.instanceMatrix.setUsage(DynamicDrawUsage);
    this.missiles.frustumCulled = false;
    this.scene.add(this.bolts, this.missiles);
    this.disposables.push(boltGeo, boltMat, missMat, this.missiles.geometry);

    // ---- pickups
    const pkGeo = new OctahedronGeometry(1, 0);
    const pkMat = new MeshBasicMaterial({ color: 0xffffff });
    this.pickups = new InstancedMesh(pkGeo, pkMat, 320);
    this.pickups.instanceMatrix.setUsage(DynamicDrawUsage);
    this.pickups.frustumCulled = false;
    this.pickups.setColorAt(0, col.set(0xffffff));
    this.scene.add(this.pickups);
    this.disposables.push(pkGeo, pkMat);

    this.buildObstacles();

    // ---- bombardment markers
    const ringGeo = new RingGeometry(0.9, 1, 40); ringGeo.rotateX(-Math.PI / 2);
    const discGeo = new CircleGeometry(1, 32); discGeo.rotateX(-Math.PI / 2);
    this.disposables.push(ringGeo, discGeo);
    for (let i = 0; i < sim.capital.strikes.length; i++) {
      const rm = new MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
      const dm = new MeshBasicMaterial({ color: 0xff3010, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
      const ring = new Mesh(ringGeo, rm), disc = new Mesh(discGeo, dm);
      ring.visible = disc.visible = false;
      this.scene.add(ring, disc);
      this.strikeMarks.push({ ring, disc });
      this.disposables.push(rm, dm);
    }

    // ---- target reticle
    const retTex = canvasTexture(128, 128, (ctx, w) => {
      ctx.clearRect(0, 0, w, w);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 7;
      const a = 14, b = 44, c = w - 14;
      for (const [x, y, dx, dy] of [[a, a, 1, 1], [c, a, -1, 1], [a, c, 1, -1], [c, c, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(x + dx * (b - a), y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * (b - a)); ctx.stroke();
      }
      ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(w / 2, w / 2, 7, 0, 6.3); ctx.stroke();
    }, false);
    const retMat = new SpriteMaterial({ map: retTex, color: 0xff5030, transparent: true, depthTest: false, depthWrite: false, fog: false });
    this.reticle = new Sprite(retMat);
    this.reticle.renderOrder = 30;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    this.disposables.push(retTex, retMat);

    if (quality !== 'low') {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new Vector2(256, 256), quality === 'high' ? 0.62 : 0.55, 0.55, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    const p = sim.player;
    this.camYaw = p.yaw; this.camY = p.y + 5;
  }

  private buildEnvMap(): void {
    // small procedural "studio" so chrome and paint have something to reflect
    const t = this.theme;
    const envScene = new Scene();
    const skyTex = canvasTexture(16, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#' + new Color(t.skyTop).lerp(new Color(t.nebulaA), 0.5).getHexString());
      g.addColorStop(0.47, '#' + new Color(t.nebulaB).lerp(new Color(0xffffff), 0.35).getHexString());
      g.addColorStop(0.5, '#ffffff');
      g.addColorStop(0.56, '#' + new Color(t.skyBottom).lerp(new Color(t.nebulaA), 0.4).getHexString());
      g.addColorStop(1, '#05040c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }, false);
    const dome = new Mesh(new SphereGeometry(50, 24, 16), new MeshBasicMaterial({ map: skyTex, side: BackSide }));
    envScene.add(dome);
    const panels: [number, number, number, number][] = [[30, 22, 10, 0xffffff], [-34, 8, -16, t.rail], [8, 10, 36, t.railAlt], [-6, 40, 0, t.sun]];
    const pg = new BoxGeometry(18, 10, 1);
    const pmats: Material[] = [];
    for (const [x, y, z, c] of panels) {
      const pm = new MeshBasicMaterial({ color: new Color(c).multiplyScalar(4) });
      pmats.push(pm);
      const m = new Mesh(pg, pm);
      m.position.set(x, y, z); m.lookAt(0, 0, 0);
      envScene.add(m);
    }
    const pmrem = new PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene, 0.03);
    this.envTex = rt.texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.9;
    pmrem.dispose();
    skyTex.dispose(); dome.geometry.dispose(); (dome.material as Material).dispose(); pg.dispose(); pmats.forEach((m) => m.dispose());
    this.disposables.push(rt);
  }

  private buildObstacles(): void {
    const kinds: ObstacleKind[] = ['pylon', 'traffic', 'asteroid', 'debris', 'rock', 'vent', 'mine'];
    const all = this.sim.layout.obstacles;
    const glowMat = () => new MeshBasicMaterial({ color: 0xffffff });
    for (const kind of kinds) {
      const ids: number[] = [];
      all.forEach((o, i) => { if (o.kind === kind) ids.push(i); });
      if (!ids.length) continue;
      let bodyGeo: BufferGeometry, bodyMat: Material, glowGeo: BufferGeometry | null = null;
      const one = (kit: Kit, mat: Material): BufferGeometry => (kit.build({ hull: mat }).children[0] as Mesh).geometry;
      switch (kind) {
        case 'pylon': {
          const tex = canvasTexture(64, 64, (ctx, w, h) => { ctx.fillStyle = '#16161c'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#e8b820'; for (let i = -4; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * 16, h); ctx.lineTo(i * 16 + 8, h); ctx.lineTo(i * 16 + 40, 0); ctx.lineTo(i * 16 + 32, 0); ctx.fill(); } });
          bodyMat = new MeshStandardMaterial({ map: tex, metalness: 0.4, roughness: 0.5 });
          this.disposables.push(tex);
          bodyGeo = new CylinderGeometry(0.82, 1, 5.4, 12); bodyGeo.translate(0, 2.7, 0);
          glowGeo = new CylinderGeometry(0.9, 0.9, 0.5, 12); glowGeo.translate(0, 5.6, 0);
          break;
        }
        case 'traffic': {
          bodyMat = new MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.4 });
          const k = new Kit();
          k.add('hull', new BoxGeometry(1.5, 0.9, 2.6), 0, 0.75, -0.2);
          k.add('hull', new BoxGeometry(1.3, 0.6, 0.9), 0, 0.6, 1.5);
          k.add('hull', new BoxGeometry(1.7, 0.16, 3.4), 0, 0.2, 0.1);
          bodyGeo = one(k, bodyMat);
          const g = new Kit();
          g.add('hull', new BoxGeometry(1.2, 0.2, 0.08), 0, 0.7, 1.97);
          g.add('hull', new BoxGeometry(1.4, 0.3, 0.08), 0, 0.8, -1.52);
          g.add('hull', new BoxGeometry(1.5, 0.06, 3.0), 0, 0.08, 0.1);
          glowGeo = one(g, bodyMat);
          break;
        }
        case 'asteroid': bodyMat = new MeshStandardMaterial({ color: 0x7a7280, roughness: 0.95, flatShading: true }); bodyGeo = rockGeometry(71, 1, 0.3); break;
        case 'debris': {
          bodyMat = new MeshStandardMaterial({ color: 0x5a5560, metalness: 0.8, roughness: 0.45, flatShading: true });
          const k = new Kit();
          k.add('hull', new BoxGeometry(1.7, 0.16, 1.2), 0, 0, 0, 0.4, 0.2, 0.3);
          k.add('hull', new BoxGeometry(0.3, 0.3, 2.2), 0.2, 0.1, 0, 0.9, 0.5, 0.1);
          k.add('hull', new BoxGeometry(1.1, 0.9, 0.7), -0.2, -0.1, 0.2, 0.2, 0.9, 0.5);
          bodyGeo = one(k, bodyMat);
          glowGeo = new BoxGeometry(0.5, 0.12, 0.5);
          break;
        }
        case 'rock': bodyMat = new MeshStandardMaterial({ color: 0xb0602e, roughness: 1, flatShading: true }); bodyGeo = rockGeometry(13, 1, 0.22); bodyGeo.scale(1, 3.2, 1); bodyGeo.translate(0, 2.4, 0); break;
        case 'vent': {
          bodyMat = new MeshStandardMaterial({ color: 0x2a2220, metalness: 0.7, roughness: 0.5 });
          bodyGeo = new CylinderGeometry(1, 1.06, 0.3, 20); bodyGeo.translate(0, 0.12, 0);
          glowGeo = new CylinderGeometry(0.78, 0.78, 0.34, 20); glowGeo.translate(0, 0.13, 0);
          break;
        }
        default: {
          bodyMat = new MeshStandardMaterial({ color: 0x2a2a34, metalness: 0.8, roughness: 0.35 });
          const k = new Kit();
          k.add('hull', new IcosahedronGeometry(0.8, 0), 0, 0, 0);
          for (const [x, y, z, rx, rz] of [[0, 1, 0, 0, 0], [0, -1, 0, Math.PI, 0], [1, 0, 0, 0, -Math.PI / 2], [-1, 0, 0, 0, Math.PI / 2], [0, 0, 1, Math.PI / 2, 0], [0, 0, -1, -Math.PI / 2, 0]]) {
            k.add('hull', new ConeGeometry(0.18, 0.7, 6), x, y, z, rx, 0, rz);
          }
          bodyGeo = one(k, bodyMat);
          glowGeo = new SphereGeometry(0.42, 10, 8);
        }
      }
      const body = new InstancedMesh(bodyGeo, bodyMat, ids.length);
      body.instanceMatrix.setUsage(DynamicDrawUsage);
      body.frustumCulled = false;
      if (kind === 'traffic') for (let i = 0; i < ids.length; i++) body.setColorAt(i, col.set([0xd8d8e0, 0xffb020, 0x30a0ff, 0xff4080][i % 4]));
      let glow: InstancedMesh | null = null;
      if (glowGeo) {
        const gm = glowMat();
        glow = new InstancedMesh(glowGeo, gm, ids.length);
        glow.instanceMatrix.setUsage(DynamicDrawUsage);
        glow.frustumCulled = false;
        for (let i = 0; i < ids.length; i++) glow.setColorAt(i, col.set(0xff3020));
        this.scene.add(glow);
        this.disposables.push(glowGeo, gm);
      }
      this.scene.add(body);
      this.disposables.push(bodyGeo, bodyMat);
      this.obs.push({ kind, body, glow, ids });
    }
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.fx.particles.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  addShake(a: number): void { this.shake = Math.min(1.6, this.shake + a); }

  // ------------------------------------------------------------- events
  consume(events: EventQueue): void {
    const fx = this.fx, sim = this.sim, cam = this.camera.position;
    const player = sim.player;
    for (let i = 0; i < events.count; i++) {
      const ev = events.list[i];
      const dist = ev.x === 0 && ev.z === 0 ? 0 : Math.hypot(ev.x - cam.x, ev.z - cam.z);
      const near = dist < 700;
      switch (ev.type) {
        case 'shoot': if (dist < 400) { const c = sim.ships[ev.ship].def.colors.glow; fx.puff(ev.x, ev.y, ev.z, c, 2.2, 0.07); } break;
        case 'missile': if (near) { fx.puff(ev.x, ev.y, ev.z, 0xffc070, 4, 0.2); fx.sparks(ev.x, ev.y, ev.z, 5, 0xffa040, 8); } break;
        case 'capitalFire': if (dist < 1200) fx.puff(ev.x, ev.y, ev.z, 0xff4030, 16, 0.14); break;
        case 'hit': if (near) fx.sparks(ev.x, ev.y, ev.z, 6, 0xffb060, 16); if (ev.ship === 0) this.addShake(0.25 + ev.a * 0.02); break;
        case 'shieldHit': if (near) fx.sparks(ev.x, ev.y, ev.z, 4, 0x60c8ff, 12); if (ev.ship === 0) this.addShake(0.12); break;
        case 'wallHit': if (near) fx.sparks(ev.x, ev.y, ev.z, clamp(ev.a * 0.25, 2, 14), 0xffd080, 10 + ev.a * 0.3); if (ev.ship === 0) this.addShake(clamp(ev.a * 0.012, 0, 0.7)); break;
        case 'explosion': if (dist < 1500) fx.explosion(ev.x, ev.y, ev.z, ev.a, ev.color); if (dist < 120) this.addShake(0.5 * (1 - dist / 120)); break;
        case 'shipDestroyed': {
          const s = sim.ships[ev.ship];
          if (ev.a > 0) { fx.explosion(ev.x, ev.y, ev.z, 9, 0xffa030, 0, 4, 0, s.def.colors.primary); fx.explosion(ev.x, ev.y + 1, ev.z, 5, s.def.colors.glow); }
          else fx.ring(ev.x, ev.y, ev.z, 14, 0xffffff, 0.5);
          if (ev.ship === 0) this.addShake(1.2); else if (dist < 150) this.addShake(0.5);
          break;
        }
        case 'respawn': fx.ring(ev.x, ev.y - 1, ev.z, 12, 0x80e0ff, 0.6); break;
        case 'pickup': if (near) { const c = PICKUP_COLOR[ev.text] ?? 0xffffff; fx.sparks(ev.x, ev.y, ev.z, 8, c, 9); fx.ring(ev.x, ev.y, ev.z, 5, c, 0.3); } break;
        case 'boostPad': if (near) { fx.ring(ev.x, ev.y - 1, ev.z, 10, this.theme.pad, 0.35); fx.sparks(ev.x, ev.y, ev.z, 10, this.theme.pad, 14); } break;
        case 'boostStart': if (near) fx.ring(ev.x, ev.y, ev.z, 6, sim.ships[ev.ship].def.colors.glow, 0.3, false); break;
        case 'overdrive': fx.ring(ev.x, ev.y, ev.z, 20, 0xff40e0, 0.7); fx.sparks(ev.x, ev.y, ev.z, 24, 0xff40e0, 22); break;
        case 'ability': {
          const s = sim.ships[ev.ship];
          const c = s.ability === 'burst' ? 0xffc040 : s.ability === 'bulwark' ? 0xffa020 : s.ability === 'dash' ? 0xd060ff : 0x7dff5a;
          if (near) { fx.ring(ev.x, ev.y, ev.z, s.ability === 'magnet' ? 40 : 12, c, 0.5, s.ability === 'magnet'); fx.sparks(ev.x, ev.y, ev.z, 14, c, 18); }
          break;
        }
        case 'componentHit': if (dist < 1400) fx.sparks(ev.x, ev.y, ev.z, 5, 0xffa040, 22); break;
        case 'capShieldHit': if (dist < 1400) { fx.sparks(ev.x, ev.y, ev.z, 4, 0x50e0ff, 18); if (Math.random() < 0.25) fx.ring(ev.x, ev.y, ev.z, 9, 0x50e0ff, 0.3, false); } break;
        case 'componentDestroyed': {
          fx.explosion(ev.x, ev.y, ev.z, 26, 0xffa030, 0, 0, 0, this.theme.capitalHull);
          fx.explosion(ev.x + 10, ev.y - 6, ev.z + 8, 14, this.theme.capitalGlow);
          fx.explosion(ev.x - 8, ev.y + 8, ev.z - 10, 16, 0xffe080);
          this.addShake(clamp(1.3 - dist / 600, 0.2, 1.3));
          break;
        }
        case 'capitalDestroyed': fx.explosion(ev.x, ev.y, ev.z, 60, 0xffffff, 0, 0, 0, this.theme.capitalHull); this.addShake(1.5); break;
        case 'strike': fx.explosion(ev.x, ev.y + 1, ev.z, 11, 0xff4020); if (dist < 90) this.addShake(0.8 * (1 - dist / 90)); break;
        case 'obstacleDestroyed': if (dist < 1200) fx.explosion(ev.x, ev.y, ev.z, clamp(ev.a * 1.5, 4, 9), ev.text === 'mine' ? 0xff3020 : ev.text === 'traffic' ? 0xffc040 : 0xb0a090, 0, 0, 0, ev.text === 'asteroid' ? 0x7a7280 : 0x888890); break;
        case 'go': this.addShake(0.3); break;
        default: break;
      }
    }
    void player;
  }

  // -------------------------------------------------------------- frame
  render(dt: number): void {
    this.time += dt;
    const time = this.time, sim = this.sim, fx = this.fx;
    const cam = this.camera;

    // ships
    for (const sv of this.ships) {
      const s = sv.ship, g = sv.model.group, body = sv.model.body;
      g.visible = s.alive;
      if (sv.tag) sv.tag.visible = false;
      if (!s.alive) continue;
      const bob = Math.sin(time * 2.3 + s.index * 1.7) * 0.12;
      g.position.set(s.x, s.y + bob, s.z);
      g.rotation.y = s.yaw;
      body.rotation.x = -s.pitch;
      body.rotation.z = s.roll;
      const st = s.stats;
      const speedFrac = clamp(s.fwdSpeed / st.topSpeed, 0, 1.6);
      const hot = s.bursting ? 2.4 : s.boosting || s.overdriveT > 0 ? 1.5 : s.padT > 0 ? 1.1 : 0;
      const thrust = clamp(0.25 + speedFrac * 0.9 + hot + (s.ctl.throttle > 0 ? 0.25 : 0), 0.15, 4.4);
      const flick = 0.9 + Math.sin(time * 47 + s.index) * 0.1;
      for (const f of sv.model.flames) f.scale.z = thrust * 2.2 * flick;
      for (const sp of sv.model.sprites) sp.scale.setScalar(sv.model.engineR * (3.5 + thrust * 2.2) * flick);
      // engine trail
      if (speedFrac > 0.2 && Math.hypot(s.x - cam.position.x, s.z - cam.position.z) < 500) {
        sv.trailT -= dt;
        if (sv.trailT <= 0) {
          sv.trailT = (s.isPlayer ? 0.016 : 0.035) / fx.density;
          const c = col.set(s.def.colors.glow); if (hot > 1.4) c.lerp(WHITE, 0.5);
          const hx = Math.sin(s.yaw), hz = Math.cos(s.yaw);
          for (const en of sv.model.engines) {
            const wx = s.x + hx * en.z + hz * en.x, wz = s.z + hz * en.z - hx * en.x;
            fx.particles.emit(wx, s.y + en.y + bob, wz, -hx * 8 + s.vx * 0.15, 0, -hz * 8 + s.vz * 0.15, c.r, c.g, c.b, sv.model.engineR * (2 + hot * 1.2), 0, 0.22 + hot * 0.12, 0);
          }
        }
      }
      // phase dash: go translucent
      const phased = s.phased;
      if (phased !== sv.phasedOn) {
        sv.phasedOn = phased;
        for (let i = 0; i < 5; i++) { const m = sv.model.materials[i]; m.transparent = phased; m.opacity = phased ? 0.22 : 1; m.depthWrite = !phased; m.needsUpdate = true; }
      }
      if (phased && Math.random() < 0.7) fx.puff(s.x, s.y, s.z, 0xb050ff, 3.5, 0.3, -s.vx * 0.2, 0, -s.vz * 0.2);
      if (s.magnet && Math.random() < 0.3) fx.ring(s.x, s.y - 1, s.z, 30, 0x7dff5a, 0.4);
      // shield bubble
      const sm = sv.shield.material as MeshBasicMaterial;
      let op = s.hitFlash * (s.shield > 0 ? 1.1 : 0.2);
      let sc = 0x60c8ff;
      if (s.bulwark) { op = 0.55 + Math.sin(time * 14) * 0.12; sc = 0xffa020; }
      else if (s.invuln > 0 && s.invuln < 100) { op = Math.max(op, 0.3 + Math.sin(time * 20) * 0.2); sc = 0xffffff; }
      else if (s.overdriveT > 0) { op = Math.max(op, 0.22); sc = 0xff40e0; }
      sm.opacity = op; sm.color.set(sc);
      sv.shield.visible = op > 0.01;
      // damaged ships smoke and spark
      if (s.hp < st.armour * 0.35 && Math.random() < 0.25) fx.fire(s.x, s.y + 0.5, s.z, 1.1);
      if (sv.tag) {
        const d = Math.hypot(s.x - cam.position.x, s.y - cam.position.y, s.z - cam.position.z);
        if (d < 340 && d > 8) {
          sv.tag.visible = true;
          sv.tag.position.set(s.x, s.y + 3.4 + d * 0.012, s.z);
          const k = clamp(d * 0.05, 3.2, 13);
          sv.tag.scale.set(k * 2.6, k * 0.65, 1);
          (sv.tag.material as SpriteMaterial).opacity = clamp(1.4 - d / 300, 0.25, 1);
        }
      }
    }

    // projectiles
    let nb = 0, nm = 0;
    for (const p of sim.projectiles.items) {
      if (!p.active) continue;
      dir.set(p.vx, p.vy, p.vz).normalize();
      q.setFromUnitVectors(Z, dir);
      if (p.kind === MISSILE) {
        if (nm < 48) { m4.compose(v3.set(p.x, p.y, p.z), q, s3.set(1.5, 1.5, 1.5)); this.missiles.setMatrixAt(nm++, m4); }
        fx.particles.emit(p.x - dir.x * 1.6, p.y - dir.y * 1.6, p.z - dir.z * 1.6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 1, 0.6, 0.25, 1.6, 0.2, 0.4, 0);
        fx.particles.emit(p.x - dir.x * 1.2, p.y - dir.y * 1.2, p.z - dir.z * 1.2, 0, 0, 0, 1, 0.95, 0.8, 2.6, 0, 0.06, 0);
      } else {
        const big = p.kind === CAP_BOLT;
        const len = big ? 12 : 8;
        m4.compose(v3.set(p.x - dir.x * len * 0.5, p.y - dir.y * len * 0.5, p.z - dir.z * len * 0.5), q, s3.set(big ? 2.6 : 1.3, big ? 2.6 : 1.3, len));
        this.bolts.setMatrixAt(nb, m4);
        this.bolts.setColorAt(nb, col.set(p.color).multiplyScalar(1.6));
        nb++;
      }
    }
    this.bolts.count = nb; this.missiles.count = nm;
    this.bolts.instanceMatrix.needsUpdate = true; this.missiles.instanceMatrix.needsUpdate = true;
    if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true;

    // pickups
    let np = 0;
    const pk = sim.layout.pickups;
    for (let i = 0; i < pk.length && np < 320; i++) {
      const p = pk[i];
      if (!p.active) continue;
      const dx = p.x - cam.position.x, dz = p.z - cam.position.z;
      if (dx * dx + dz * dz > 640000) continue;
      const sc = PICKUP_SCALE[p.kind] * (1 + Math.sin(time * 4 + i) * 0.12);
      m4.compose(v3.set(p.x, p.y + Math.sin(time * 2.4 + i * 0.7) * 0.35, p.z), q.setFromEuler(e.set(0, time * 2.2 + i, 0.5)), s3.set(sc * 0.8, sc * 1.25, sc * 0.8));
      this.pickups.setMatrixAt(np, m4);
      this.pickups.setColorAt(np, col.set(PICKUP_COLOR[p.kind]).multiplyScalar(1.5));
      np++;
    }
    this.pickups.count = np;
    this.pickups.instanceMatrix.needsUpdate = true;
    if (this.pickups.instanceColor) this.pickups.instanceColor.needsUpdate = true;

    // obstacles
    const obs = sim.layout.obstacles;
    for (const ov of this.obs) {
      for (let k = 0; k < ov.ids.length; k++) {
        const o = obs[ov.ids[k]];
        if (!o.alive) { ov.body.setMatrixAt(k, ZERO); if (ov.glow) ov.glow.setMatrixAt(k, ZERO); continue; }
        let gc = 0xff3020;
        switch (ov.kind) {
          case 'pylon': mat(o.x, o.y, o.z, 0, o.seed * 6, 0, o.r, 1, o.r); gc = Math.sin(time * 6 + o.seed * 9) > 0 ? 0xffb020 : 0x402000; break;
          case 'traffic': {
            frameAt(sim.track.paths[o.path], Math.floor(o.s / sim.track.paths[o.path].step), 0, this.fr);
            mat(o.x, o.y + 0.9 + Math.sin(time * 3 + o.seed * 9) * 0.15, o.z, 0, Math.atan2(this.fr.hx, this.fr.hz), 0, o.r * 0.78, o.r * 0.78, o.r * 0.78);
            gc = 0xff5030;
            break;
          }
          case 'asteroid': mat(o.x, o.y + 1.8, o.z, time * 0.2 + o.seed * 6, time * 0.13 + o.seed * 3, o.seed * 5, o.r, o.r * 0.85, o.r); break;
          case 'debris': mat(o.x, o.y + 1.8, o.z, time * 0.25 + o.seed * 6, o.seed * 3, time * 0.18, o.r, o.r, o.r); gc = 0xff7020; break;
          case 'rock': mat(o.x, o.y - 0.5, o.z, 0, o.seed * 6, 0, o.r * 0.95, o.r * 0.9, o.r * 0.95); break;
          case 'vent': {
            mat(o.x, o.y + 0.04, o.z, 0, 0, 0, o.r, 1, o.r);
            const rem = o.period - (o.timer % o.period);
            gc = o.active ? 0xffc040 : rem < 2.2 ? (Math.sin(time * 18) > 0 ? 0xff5010 : 0x401000) : 0x301008;
            if (o.active && Math.hypot(o.x - cam.position.x, o.z - cam.position.z) < 500) {
              for (let j = 0; j < 2; j++) fx.particles.emit(o.x + (Math.random() - 0.5) * o.r, o.y + 0.5, o.z + (Math.random() - 0.5) * o.r, (Math.random() - 0.5) * 6, 16 + Math.random() * 22, (Math.random() - 0.5) * 6, 1, 0.5 + Math.random() * 0.3, 0.1, o.r * 0.8, o.r * 0.2, 0.45, 0.4);
            }
            break;
          }
          default: mat(o.x, o.y + 1.6 + Math.sin(time * 2 + o.seed * 9) * 0.3, o.z, time * 0.6, time * 0.8 + o.seed * 6, 0, o.r * 0.85, o.r * 0.85, o.r * 0.85); gc = Math.sin(time * 9 + o.seed * 20) > 0.2 ? 0xff2010 : 0x400400;
        }
        ov.body.setMatrixAt(k, m4);
        if (ov.glow) { ov.glow.setMatrixAt(k, m4); ov.glow.setColorAt(k, col.set(gc).multiplyScalar(1.5)); }
      }
      ov.body.instanceMatrix.needsUpdate = true;
      if (ov.glow) { ov.glow.instanceMatrix.needsUpdate = true; if (ov.glow.instanceColor) ov.glow.instanceColor.needsUpdate = true; }
    }

    // bombardment markers
    const strikes = sim.capital.strikes;
    for (let i = 0; i < strikes.length; i++) {
      const st = strikes[i], mk = this.strikeMarks[i];
      mk.ring.visible = mk.disc.visible = st.active;
      if (!st.active) continue;
      const k = st.t / st.delay;
      mk.ring.position.set(st.x, st.y + 0.25, st.z); mk.ring.scale.setScalar(st.r);
      mk.disc.position.set(st.x, st.y + 0.2, st.z); mk.disc.scale.setScalar(st.r * k);
      (mk.ring.material as MeshBasicMaterial).opacity = 0.6 + Math.sin(time * (10 + k * 30)) * 0.4;
    }

    // target reticle
    const pl = sim.player;
    let tx = 0, ty = 0, tz = 0, has = false, rc = 0xff5030;
    if (pl.alive && !pl.finished) {
      if (pl.targetKind === 1) { const o = sim.ships[pl.targetIdx]; if (o && o.alive) { tx = o.x; ty = o.y; tz = o.z; has = true; } }
      else if (pl.targetKind === 2) { const c = sim.capital.components[pl.targetIdx]; if (c && c.alive) { tx = c.x; ty = c.y; tz = c.z; has = true; rc = 0xffc030; } }
    }
    this.reticle.visible = has;
    if (has) {
      this.reticle.position.set(tx, ty, tz);
      const d = cam.position.distanceTo(this.reticle.position);
      this.reticle.scale.setScalar(clamp(d * 0.075, 4, 60));
      (this.reticle.material as SpriteMaterial).color.set(rc);
      (this.reticle.material as SpriteMaterial).rotation = time * 1.2;
    }

    this.updateCamera(dt);
    this.capVis.update(dt, time, fx);
    this.env.update(dt, time, cam.position, fx);
    this.trackVis.update(time);
    fx.update(dt);

    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, cam);
  }

  private updateCamera(dt: number): void {
    const s = this.sim.player, cam = this.camera, sim = this.sim;
    const st = s.stats;
    const speedFrac = clamp(s.fwdSpeed / st.topSpeed, 0, 1.7);
    let back = 12.5 + speedFrac * 3.2, height = 4.5, lookAhead = 16, yawOff = 0;
    if (sim.phase === 'grid') {
      // opening sweep around the grid
      const k = clamp(sim.countdown / COUNTDOWN_TIME, 0, 1);
      yawOff = k * k * 2.6; back += k * 16; height += k * 7;
    } else if (s.finished) {
      this.orbit += dt * 0.5;
      yawOff = this.orbit; back = 17; height = 6; lookAhead = 0;
    }
    this.camYaw += angleDelta(s.yaw, this.camYaw) * Math.min(1, dt * (s.alive ? 6.5 : 1.5));
    const yaw = this.camYaw + yawOff;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const targetY = s.y + height - Math.sin(s.pitch) * back * 0.6;
    this.camY += (targetY - this.camY) * Math.min(1, dt * 7);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const sh = this.shakeEnabled ? this.shake * this.shake * 0.8 : 0;
    cam.position.set(s.x - fx * back + (Math.random() - 0.5) * sh, this.camY + (Math.random() - 0.5) * sh, s.z - fz * back + (Math.random() - 0.5) * sh);
    const lhx = Math.sin(s.yaw), lhz = Math.cos(s.yaw);
    cam.lookAt(s.x + lhx * lookAhead, s.y + 1.6 + Math.sin(s.pitch) * lookAhead, s.z + lhz * lookAhead);
    cam.rotateZ(-s.roll * 0.12);
    const targetFov = 68 + speedFrac * 13 + (s.bursting ? 12 : s.boosting || s.padT > 0 ? 7 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  dispose(): void {
    for (const sv of this.ships) sv.model.dispose();
    this.env.dispose(); this.trackVis.dispose(); this.capVis.dispose(); this.fx.dispose();
    for (const d of this.disposables) d.dispose();
    if (this.composer) { this.bloom?.dispose(); this.composer.dispose(); }
    this.scene.environment = null;
    this.renderer.dispose();
  }
}

function mat(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): void {
  m4.compose(v3.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s3.set(sx, sy, sz));
}
