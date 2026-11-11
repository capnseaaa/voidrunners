// Enemy fighters. Light attack craft that chase racers, sit on their tail and
// strafe them. They are not racers: they ignore the track and exist to make
// the war around the race dangerous. Any racer can shoot them down.
import type { RaceDef } from '../data/campaign';
import { Rng } from '../core/rng';
import type { RaceSim } from './race';
import { CAP_BOLT, MISSILE } from './weapons';

export const DRONE_RADIUS = 3;

export class Drone {
  active = false;
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = 0; roll = 0;
  hp = 0; maxHp = 0;
  target = -1;
  retargetT = 0; fireT = 0; burst = 0; burstT = 0; missileT = 0;
  attackT = 0; breakT = 0; side = 1;
  respawnT = 0;
  flash = 0;
  constructor(readonly index: number) {}
}

export class DroneWing {
  readonly drones: Drone[] = [];
  killed = 0;
  private readonly rng: Rng;
  private readonly hp: number;
  private readonly damage: number;
  private readonly battle: boolean;

  constructor(race: RaceDef) {
    this.rng = new Rng(race.seed * 7 + 3);
    this.battle = race.mode === 'battle';
    this.hp = 34 * (1 + race.stage * 0.18);
    this.damage = 3.6 + race.stage * 0.5;
    for (let i = 0; i < race.drones; i++) {
      const d = new Drone(i);
      d.respawnT = this.battle ? 1 + i * 0.7 : 12 + i * 5; // staggered arrival
      this.drones.push(d);
    }
  }

  get activeCount(): number { let n = 0; for (const d of this.drones) if (d.active) n++; return n; }

  private spawn(d: Drone, race: RaceSim): void {
    const rng = this.rng;
    if (race.track.arena > 0) {
      const a = rng.range(0, 6.283), r = race.track.arena * 0.98;
      d.x = Math.cos(a) * r; d.z = Math.sin(a) * r; d.y = rng.range(2, 6);
    } else {
      // dive in from high and wide of a random racer
      let pick = race.ships[0], n = 0;
      for (const s of race.ships) if (s.alive && !s.finished) { n++; if (rng.next() < 1 / n) pick = s; }
      const a = rng.range(0, 6.283);
      d.x = pick.x + Math.cos(a) * 320; d.z = pick.z + Math.sin(a) * 320; d.y = pick.y + rng.range(60, 120);
    }
    d.vx = 0; d.vy = 0; d.vz = 0;
    d.hp = d.maxHp = this.hp;
    d.active = true; d.target = -1; d.retargetT = 0; d.fireT = rng.range(1, 2.5); d.burst = 0;
    d.attackT = rng.range(6, 9); d.breakT = 0; d.side = rng.sign(); d.missileT = rng.range(6, 12); d.flash = 0;
  }

  /** Returns damage dealt. */
  hit(d: Drone, amount: number, attacker: number, race: RaceSim): number {
    if (!d.active) return 0;
    const dealt = Math.min(d.hp, amount);
    d.hp -= dealt; d.flash = 1;
    if (d.hp <= 0) {
      d.active = false;
      d.respawnT = this.battle ? 2.5 : 9;
      this.killed++;
      race.events.push('droneDestroyed', attacker, d.x, d.y, d.z, 6, d.index);
      if (attacker >= 0) {
        const k = race.ships[attacker];
        k.droneKills++; k.score += 100;
        k.boost = Math.min(100, k.boost + 12);
        if (race.track.arena > 0) race.spawnPickup('scrap', 1, 0, 0, 0, d.x, 1.7, d.z, d.x, d.y, d.z, 25);
        else race.addSalvage(k, 1);
      }
    }
    return dealt;
  }

  update(dt: number, race: RaceSim): void {
    if (race.phase !== 'racing') return;
    const rng = this.rng, ships = race.ships;
    for (const d of this.drones) {
      if (!d.active) {
        d.respawnT -= dt;
        if (d.respawnT <= 0 && !race.over) this.spawn(d, race);
        continue;
      }
      d.flash = Math.max(0, d.flash - dt * 5);
      // ---- pick someone to hunt
      d.retargetT -= dt;
      const cur = d.target >= 0 ? ships[d.target] : null;
      if (d.retargetT <= 0 || !cur || !cur.alive || cur.finished) {
        d.retargetT = rng.range(2.5, 4.5);
        let best = -1, bd = 1e12;
        for (const s of ships) {
          if (!s.alive || s.finished || s.phased) continue;
          const dist = Math.hypot(s.x - d.x, s.z - d.z) * rng.range(0.6, 1.4);
          if (dist < bd) { bd = dist; best = s.index; }
        }
        d.target = best;
      }
      const t = d.target >= 0 ? ships[d.target] : null;
      // ---- flight: sit on the target's tail, break off now and then
      let gx = d.x, gy = d.y, gz = d.z, maxV = 120;
      if (t) {
        const thx = Math.sin(t.yaw), thz = Math.cos(t.yaw);
        maxV = t.stats.topSpeed * 1.13;
        if (d.breakT > 0) {
          d.breakT -= dt;
          gx = t.x - thz * d.side * 130 - thx * 40; gz = t.z + thx * d.side * 130 - thz * 40; gy = t.y + 26;
          if (d.breakT <= 0) { d.attackT = rng.range(6, 9); d.side = rng.sign(); }
        } else {
          d.attackT -= dt;
          gx = t.x - thx * 46 - thz * d.side * 7; gz = t.z - thz * 46 + thx * d.side * 7; gy = t.y + 2.2;
          if (d.attackT <= 0) d.breakT = rng.range(1.6, 2.6);
        }
      }
      let dx = gx - d.x, dy = gy - d.y, dz = gz - d.z;
      const dist = Math.hypot(dx, dz) || 1;
      const want = Math.min(maxV, 40 + dist * 1.6 + (t ? t.speed * 0.9 : 0));
      dx = (dx / dist) * want; dz = (dz / dist) * want;
      const ax = dx - d.vx, az = dz - d.vz;
      const al = Math.hypot(ax, az) || 1;
      const acc = Math.min(al, 95 * dt);
      d.vx += (ax / al) * acc; d.vz += (az / al) * acc;
      d.vy += (Math.max(-40, Math.min(40, dy * 2)) - d.vy) * Math.min(1, dt * 3);
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (race.track.arena > 0) {
        const r = Math.hypot(d.x, d.z), lim = race.track.arena + 40;
        if (r > lim) { d.x *= lim / r; d.z *= lim / r; }
      }
      const sp = Math.hypot(d.vx, d.vz);
      if (sp > 4) {
        const ny = Math.atan2(d.vx, d.vz);
        let dyaw = ny - d.yaw;
        if (dyaw > Math.PI) dyaw -= Math.PI * 2; else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
        d.yaw += dyaw * Math.min(1, dt * 8);
        d.roll += (Math.max(-1, Math.min(1, -dyaw * 3)) - d.roll) * Math.min(1, dt * 5);
      }
      if (!t || d.breakT > 0) continue;
      // ---- guns: short bursts when lined up behind the target
      const tx = t.x - d.x, tz = t.z - d.z;
      const range = Math.hypot(tx, tz);
      const facing = (tx * Math.sin(d.yaw) + tz * Math.cos(d.yaw)) / (range || 1);
      if (d.burst > 0) {
        d.burstT -= dt;
        if (d.burstT <= 0) {
          d.burstT = 0.11; d.burst--;
          const speed = 265;
          const lead = range / speed;
          const ex = t.x + t.vx * lead + rng.range(-4.5, 4.5) - d.x, ey = t.y - d.y + rng.range(-0.8, 0.8), ez = t.z + t.vz * lead + rng.range(-4.5, 4.5) - d.z;
          const l = Math.hypot(ex, ey, ez) || 1;
          const p = race.projectiles.spawn();
          p.kind = CAP_BOLT; p.owner = -1;
          p.x = p.px = d.x; p.y = p.py = d.y; p.z = p.pz = d.z;
          p.vx = (ex / l) * speed; p.vy = (ey / l) * speed; p.vz = (ez / l) * speed; p.speed = speed;
          p.life = 1.4; p.damage = this.damage; p.tKind = 0; p.tIdx = -1; p.color = 0xff4a2a;
          race.events.push('droneFire', t.index, d.x, d.y, d.z);
          t.lockedT = 0.7; t.lockedBy = -2;
        }
      } else {
        d.fireT -= dt;
        if (d.fireT <= 0 && range < 150 && facing > 0.9 && Math.abs(t.y - d.y) < 14) { d.burst = 4; d.burstT = 0; d.fireT = rng.range(1.5, 2.6); }
      }
      // ---- the odd missile (battles only)
      if (this.battle) {
        d.missileT -= dt;
        if (d.missileT <= 0 && range < 260 && facing > 0.7) {
          d.missileT = rng.range(11, 18);
          const p = race.projectiles.spawn();
          p.kind = MISSILE; p.owner = -1;
          p.x = p.px = d.x; p.y = p.py = d.y; p.z = p.pz = d.z;
          p.speed = Math.max(120, sp); p.maxSpeed = 186; p.turn = 2.1;
          p.vx = Math.sin(d.yaw) * p.speed; p.vy = 0; p.vz = Math.cos(d.yaw) * p.speed;
          p.life = 6; p.damage = 22; p.tKind = 1; p.tIdx = t.index; p.color = 0xff5030;
          race.events.push('enemyMissile', t.index, d.x, d.y, d.z, 0, -1);
        }
      }
    }
  }
}
