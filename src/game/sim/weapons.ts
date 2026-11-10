// Pooled projectiles: blaster bolts, homing missiles and capital ship bolts.

export const BOLT = 0, MISSILE = 1, CAP_BOLT = 2;

export class Projectile {
  active = false;
  kind = BOLT;
  owner = -1; // ship index, or -1 for the capital ship
  x = 0; y = 0; z = 0;
  px = 0; py = 0; pz = 0; // previous position (swept collision + trail rendering)
  vx = 0; vy = 0; vz = 0;
  speed = 0;
  life = 0;
  damage = 0;
  tKind = 0; tIdx = -1; // homing target (1 ship, 2 capital component)
  color = 0xffffff;
}

export class ProjectilePool {
  readonly items: Projectile[] = [];
  private cursor = 0;

  constructor(size: number) {
    for (let i = 0; i < size; i++) this.items.push(new Projectile());
  }

  /** Returns an inactive projectile, or the oldest slot when the pool is saturated. */
  spawn(): Projectile {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      const p = this.items[(this.cursor + k) % n];
      if (!p.active) { this.cursor = (this.cursor + k + 1) % n; p.active = true; return p; }
    }
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % n;
    p.active = true;
    return p;
  }

  get activeCount(): number {
    let c = 0;
    for (const p of this.items) if (p.active) c++;
    return c;
  }
}

/**
 * Swept sphere test: does the segment P0->P1 pass within r of C?
 * Returns the parametric hit position 0..1 or -1.
 */
export function segSphere(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cx: number, cy: number, cz: number, r: number): number {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const fx = cx - x0, fy = cy - y0, fz = cz - z0;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? (fx * dx + fy * dy + fz * dz) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ex = fx - dx * t, ey = fy - dy * t, ez = fz - dz * t;
  return ex * ex + ey * ey + ez * ez <= r * r ? t : -1;
}
