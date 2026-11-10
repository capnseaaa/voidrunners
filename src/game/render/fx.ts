// Effect emitters built on the pooled particle / debris systems, plus pooled
// shockwave rings and flash lights for explosions.
import { AdditiveBlending, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PointLight, RingGeometry } from 'three';
import { DebrisSystem, ParticleSystem } from './particles';

const c = new Color();
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Fx {
  readonly group = new Group();
  readonly particles: ParticleSystem;
  readonly debris: DebrisSystem;
  private readonly rings: { mesh: Mesh; t: number; life: number; size: number }[] = [];
  private readonly lights: { light: PointLight; t: number; life: number; power: number }[] = [];
  private readonly ringGeo = new RingGeometry(0.82, 1, 40);
  readonly density: number;

  constructor(quality: 'low' | 'medium' | 'high') {
    this.density = quality === 'low' ? 0.45 : quality === 'medium' ? 0.8 : 1.15;
    this.particles = new ParticleSystem(quality === 'low' ? 1600 : quality === 'medium' ? 3600 : 6000);
    this.debris = new DebrisSystem(quality === 'low' ? 90 : 220);
    this.group.add(this.particles.points, this.debris.mesh);
    for (let i = 0; i < 10; i++) {
      const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(this.ringGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, t: 0, life: 0, size: 1 });
    }
    for (let i = 0; i < (quality === 'low' ? 1 : 3); i++) {
      const light = new PointLight(0xffffff, 0, 260, 1.6);
      this.group.add(light);
      this.lights.push({ light, t: 0, life: 0, power: 0 });
    }
  }

  private n(count: number): number { return Math.max(1, Math.round(count * this.density)); }

  flashLight(x: number, y: number, z: number, color: number, power: number, life: number): void {
    let best = this.lights[0];
    for (const l of this.lights) if (l.t >= l.life) { best = l; break; }
    if (!best) return;
    best.light.position.set(x, y, z); best.light.color.set(color);
    best.t = 0; best.life = life; best.power = power;
  }

  ring(x: number, y: number, z: number, size: number, color: number, life = 0.5, flat = true): void {
    let r = this.rings[0];
    for (const k of this.rings) if (k.t >= k.life) { r = k; break; }
    r.t = 0; r.life = life; r.size = size;
    r.mesh.position.set(x, y, z);
    r.mesh.rotation.set(flat ? -Math.PI / 2 : Math.random() * 3, flat ? 0 : Math.random() * 3, 0);
    (r.mesh.material as MeshBasicMaterial).color.set(color);
    r.mesh.visible = true;
  }

  explosion(x: number, y: number, z: number, size: number, color: number, bvx = 0, bvy = 0, bvz = 0, debrisColor = 0x888888): void {
    const p = this.particles;
    c.set(color);
    p.emit(x, y, z, 0, 0, 0, 1, 0.95, 0.8, size * 7, size * 2, 0.16);
    for (let i = 0, n = this.n(size * 2.6 + 6); i < n; i++) {
      const a = Math.random() * 6.283, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), sp = rnd(1, 5) * size;
      const hot = Math.random();
      p.emit(x, y, z, bvx * 0.4 + Math.cos(a) * r * sp, bvy + u * sp, bvz * 0.4 + Math.sin(a) * r * sp,
        hot > 0.6 ? 1 : c.r * 1.1 + 0.2, hot > 0.6 ? 0.8 : c.g * 0.9 + 0.25, hot > 0.6 ? 0.4 : c.b * 0.9 + 0.05,
        size * rnd(0.9, 1.9), 0, rnd(0.35, 0.95), 2.2);
    }
    for (let i = 0, n = this.n(size * 1.6 + 6); i < n; i++) {
      const a = Math.random() * 6.283, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), sp = rnd(8, 20) * size;
      p.emit(x, y, z, bvx + Math.cos(a) * r * sp, bvy + u * sp, bvz + Math.sin(a) * r * sp, 1, 0.75, 0.35, rnd(0.35, 0.8), 0, rnd(0.4, 1.1), 1.2);
    }
    // lingering embers
    for (let i = 0, n = this.n(size + 3); i < n; i++) {
      p.emit(x + rnd(-1, 1) * size, y + rnd(-1, 1) * size * 0.5, z + rnd(-1, 1) * size, bvx * 0.2 + rnd(-2, 2), rnd(1, 4), bvz * 0.2 + rnd(-2, 2), 0.5, 0.16, 0.06, size * rnd(1.5, 2.6), size * 3, rnd(0.9, 1.8), 0.6);
    }
    this.ring(x, y, z, size * 6, color, 0.45 + size * 0.02, size < 12);
    this.flashLight(x, y + 2, z, color, 30 + size * 22, 0.35 + size * 0.02);
    if (size >= 3) this.debris.burst(x, y, z, Math.round(this.n(size * 1.6)), size * 6, 0.25 + size * 0.07, 1.6 + size * 0.1, debrisColor, bvx * 0.6, bvy, bvz * 0.6);
  }

  sparks(x: number, y: number, z: number, count: number, color: number, speed = 14, dx = 0, dy = 0, dz = 0): void {
    c.set(color);
    for (let i = 0, n = this.n(count); i < n; i++) {
      this.particles.emit(x, y, z, dx + rnd(-1, 1) * speed, dy + rnd(-0.4, 1) * speed, dz + rnd(-1, 1) * speed, c.r + 0.3, c.g + 0.3, c.b + 0.3, rnd(0.25, 0.6), 0, rnd(0.2, 0.55), 1.5);
    }
  }

  puff(x: number, y: number, z: number, color: number, size: number, life: number, vx = 0, vy = 0, vz = 0): void {
    c.set(color);
    this.particles.emit(x, y, z, vx, vy, vz, c.r, c.g, c.b, size, size * 0.2, life, 0.8);
  }

  /** Slow dim smoke/fire used for burning wrecks. */
  fire(x: number, y: number, z: number, size: number): void {
    const hot = Math.random() > 0.5;
    this.particles.emit(x + rnd(-1, 1) * size * 0.4, y, z + rnd(-1, 1) * size * 0.4, rnd(-2, 2), rnd(4, 12), rnd(-2, 2), hot ? 1 : 0.6, hot ? 0.5 : 0.15, 0.06, size * rnd(0.6, 1.2), size * 1.6, rnd(0.6, 1.4), 0.5);
  }

  update(dt: number): void {
    this.particles.update(dt);
    this.debris.update(dt);
    for (const r of this.rings) {
      if (r.t >= r.life) { if (r.mesh.visible) r.mesh.visible = false; continue; }
      r.t += dt;
      const k = Math.min(1, r.t / r.life);
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(0.2 + r.size * e);
      (r.mesh.material as MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }
    for (const l of this.lights) {
      if (l.t >= l.life) { l.light.intensity = 0; continue; }
      l.t += dt;
      l.light.intensity = l.power * Math.max(0, 1 - l.t / l.life) * 40;
    }
  }

  dispose(): void {
    this.particles.dispose(); this.debris.dispose(); this.ringGeo.dispose();
    for (const r of this.rings) (r.mesh.material as MeshBasicMaterial).dispose();
  }
}
