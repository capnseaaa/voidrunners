// Capital ship encounter: a huge battleship parked beside a stretch of the
// track with four destructible component types, its own guns and an
// orbital-strike style bombardment of the racing line.
import { Vector3 } from 'three';
import type { RaceDef } from '../data/campaign';
import { Rng } from '../core/rng';
import { idxAtS, newFrame, pointAt, progInRange, type Track } from '../tracks/track';
import type { RaceSim } from './race';
import type { Ship } from './ship';
import { CAP_BOLT, MISSILE } from './weapons';

export type ComponentType = 'shield' | 'battery' | 'engine' | 'cargo';

export interface Component {
  index: number;
  type: ComponentType;
  name: string;
  u: number; // position along the hull, -0.5 (bow) .. 0.5 (stern)
  x: number; y: number; z: number;
  r: number;
  hp: number; maxHp: number;
  alive: boolean;
  flash: number;
  fireT: number; burstLeft: number; burstT: number; targetShip: number;
  trackS: number; // main-line distance closest to this component
  lastHitBy: number;
}

export interface Strike { active: boolean; x: number; y: number; z: number; t: number; delay: number; r: number; path: number; s: number; d: number }

export const COMPONENT_KILL_BONUS: Record<ComponentType, number> = { shield: 150, battery: 100, engine: 200, cargo: 150 };
export const COMPONENT_LABEL: Record<ComponentType, string> = { shield: 'SHIELD GENERATOR', battery: 'WEAPON BATTERY', engine: 'ENGINE', cargo: 'CARGO BAY' };
/** What each system does for the ship, and so what killing it achieves. */
export const COMPONENT_EFFECT: Record<ComponentType, string> = {
  shield: 'ALL SYSTEMS EXPOSED',
  battery: 'INCOMING FIRE REDUCED',
  engine: 'POWER FAILING - WEAPONS SLOWED',
  cargo: 'REPAIRS OFFLINE - SALVAGE SPILLED',
};
export const CAPITAL_NAMES: Record<string, string> = { neon: 'ISV TOLLGATE', orbit: 'HMS GRAVEDIGGER', solar: 'DSS HELIOS WRATH', warzone: 'FLAGSHIP ABSOLUTION' };
const SURFACE_ENEMY: Record<string, string> = { neon: 'RAIDER KESTREL', orbit: 'CORSAIR MAW', solar: 'DSS SUNDERER', warzone: 'DREADNOUGHT NEMESIS' };

const BASE_HP: Record<ComponentType, number> = { shield: 640, battery: 350, engine: 540, cargo: 660 };
const RADIUS: Record<ComponentType, number> = { shield: 17, battery: 12, engine: 17, cargo: 19 };
export const HULL_HALF_WIDTH = 48;
export const HULL_HALF_HEIGHT = 30;

const tmp = new Vector3();
const fr = newFrame();

export class Capital {
  readonly name: string;
  // hull placement
  cx = 0; cy = 0; cz = 0;
  dirX = 0; dirZ = 1; // unit vector bow -> stern (the direction racers travel past the hull)
  nx = 1; nz = 0; // unit vector from the track toward the hull
  length = 900;
  readonly components: Component[] = [];
  readonly strikes: Strike[] = [];
  readonly damageBy: number[];
  totalDamage = 0;
  maxHp = 0;
  shieldUp = true;
  destroyed = false;
  destroyedT = 0;
  shieldFlash = 0;
  private strikeT = 4;
  private missileT = 6;
  private readonly battle: boolean;
  private readonly rng: Rng;
  private readonly aggro: number;
  private readonly boltDamage: number;
  readonly zoneFrom: number; readonly zoneTo: number;

  constructor(track: Track, race: RaceDef, shipCount: number) {
    this.name = (track.def.id === 'hulk' ? SURFACE_ENEMY[race.theme] : CAPITAL_NAMES[race.theme]) ?? 'CAPITAL SHIP';
    this.rng = new Rng(race.seed * 31 + 7);
    this.aggro = race.capitalAggro;
    this.battle = race.mode === 'battle';
    this.boltDamage = 7 + race.stage * 1.2;
    this.damageBy = new Array(shipCount).fill(0);
    const main = track.main, cap = track.def.capital;
    const iA = idxAtS(main, track.capitalFromS), iB = idxAtS(main, track.capitalToS);
    const A = main.samples[iA], B = main.samples[iB];
    let dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    dx /= len; dz /= len;
    // right-of-travel is (-dz, dx); "side" picks which flank the hull sits on
    const nx = -dz * cap.side, nz = dx * cap.side;
    let dev = 0, ySum = 0, cnt = 0;
    for (let i = iA; i <= iB; i++) {
      const s = main.samples[i];
      dev = Math.max(dev, (s.x - A.x) * nx + (s.z - A.z) * nz);
      ySum += s.y; cnt++;
    }
    const off = dev + cap.dist;
    this.dirX = dx; this.dirZ = dz; this.nx = nx; this.nz = nz;
    this.length = Math.min(len * 0.94, 1150);
    this.cx = (A.x + B.x) / 2 + nx * off;
    this.cz = (A.z + B.z) / 2 + nz * off;
    this.cy = ySum / cnt + cap.height;
    this.zoneFrom = (track.capitalFromS - 260 + track.length) % track.length;
    this.zoneTo = (track.capitalToS + 120) % track.length;

    const add = (type: ComponentType, name: string, u: number, lat: number, up: number) => {
      const x = this.cx + dx * u * this.length - nx * HULL_HALF_WIDTH * lat;
      const z = this.cz + dz * u * this.length - nz * HULL_HALF_WIDTH * lat;
      const y = this.cy + up;
      // nearest main-line sample inside the encounter stretch
      let best = iA, bd = 1e12;
      for (let i = iA; i <= iB; i++) { const s = main.samples[i]; const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
      const hp = Math.round(BASE_HP[type] * race.capitalHp);
      this.components.push({ index: this.components.length, type, name, u, x, y, z, r: RADIUS[type], hp, maxHp: hp, alive: true, flash: 0, fireT: this.rng.range(1, 3), burstLeft: 0, burstT: 0, targetShip: -1, trackS: main.samples[best].s, lastHitBy: -1 });
      this.maxHp += hp;
    };
    add('battery', 'BATTERY A', -0.37, 0.95, -4);
    add('shield', 'SHIELD GEN', -0.2, 0.9, 16);
    add('battery', 'BATTERY B', -0.06, 0.98, -6);
    add('cargo', 'CARGO BAY', 0.1, 0.92, -18);
    add('battery', 'BATTERY C', 0.23, 0.98, -6);
    add('battery', 'BATTERY D', 0.35, 0.95, -4);
    add('engine', 'ENGINE 1', 0.47, 0.72, 10);
    add('engine', 'ENGINE 2', 0.47, 0.72, -12);
    for (let i = 0; i < 10; i++) this.strikes.push({ active: false, x: 0, y: 0, z: 0, t: 0, delay: 0, r: 12, path: 0, s: 0, d: 0 });
  }

  get hp(): number {
    let h = 0;
    for (const c of this.components) h += Math.max(0, c.hp);
    return h;
  }

  aliveCount(type: ComponentType): number {
    let n = 0;
    for (const c of this.components) if (c.type === type && c.alive) n++;
    return n;
  }

  /** Whether a component can currently be damaged. */
  vulnerable(c: Component): boolean {
    return c.alive && (c.type === 'shield' || !this.shieldUp);
  }

  /** Apply weapon damage from a racer. Returns the damage actually dealt. */
  damage(c: Component, amount: number, shipIdx: number, race: RaceSim, hx: number, hy: number, hz: number): number {
    if (!c.alive) return 0;
    if (!this.vulnerable(c)) {
      this.shieldFlash = 1;
      race.events.push('capShieldHit', shipIdx, hx, hy, hz, amount, c.index);
      return 0;
    }
    const dealt = Math.min(c.hp, amount);
    c.hp -= dealt;
    c.flash = 1;
    c.lastHitBy = shipIdx;
    this.totalDamage += dealt;
    if (shipIdx >= 0) { this.damageBy[shipIdx] += dealt; race.ships[shipIdx].capitalDamage += dealt; race.ships[shipIdx].score += dealt * 0.25; }
    race.events.push('componentHit', shipIdx, hx, hy, hz, dealt, c.index);
    if (c.hp <= 0) this.destroyComponent(c, shipIdx, race);
    return dealt;
  }

  private destroyComponent(c: Component, shipIdx: number, race: RaceSim): void {
    c.alive = false; c.hp = 0;
    const killer = shipIdx >= 0 ? race.ships[shipIdx] : null;
    if (killer) { killer.capitalKills++; killer.capitalKillBonus += COMPONENT_KILL_BONUS[c.type]; killer.score += 400; }
    race.events.push('componentDestroyed', shipIdx, c.x, c.y, c.z, c.r, c.index, 0xffa040, COMPONENT_LABEL[c.type]);
    const track = race.track;
    if (c.type === 'shield') {
      this.shieldUp = false;
    } else if (c.type === 'engine') {
      // overdrive reward: the killer is supercharged, and overdrive cells rain onto the route
      if (killer) { killer.overdriveT = 10; killer.boost = 100; killer.boostLock = false; race.events.push('overdrive', killer.index, killer.x, killer.y, killer.z); }
      for (let k = 0; k < 3; k++) {
        const s = c.trackS + 50 + k * 34;
        const d = (k - 1) * 9;
        pointAt(track.main, s, d, tmp, fr);
        race.spawnPickup('overdrive', 0, 0, s, d, tmp.x, tmp.y + 1.6, tmp.z, c.x, c.y, c.z, 32);
      }
    } else if (c.type === 'cargo') {
      if (killer) race.addSalvage(killer, 5);
      for (let k = 0; k < 14; k++) {
        const s = c.trackS + this.rng.range(-70, 240);
        pointAt(track.main, s, 0, tmp, fr);
        const d = this.rng.range(-(fr.hw - 5), fr.hw - 5);
        pointAt(track.main, s, d, tmp, fr);
        race.spawnPickup('cargo', 3, 0, s, d, tmp.x, tmp.y + 1.6, tmp.z, c.x, c.y, c.z, 50);
      }
    }
    // shot-off wreckage tumbles onto the route below
    race.dropDebris(c.trackS, c.x, c.y, c.z);
    if (!this.destroyed && this.components.every((k) => !k.alive)) {
      this.destroyed = true;
      for (const st of this.strikes) st.active = false;
      race.events.push('capitalDestroyed', shipIdx, this.cx, this.cy, this.cz, this.length);
    }
  }

  /** Reactor output: each dead engine slows every weapon on the ship. */
  get power(): number {
    let dead = 0, n = 0;
    for (const c of this.components) if (c.type === 'engine') { n++; if (!c.alive) dead++; }
    return n ? 1 - 0.3 * dead : 1;
  }

  /** Damage-control crews work out of the cargo bay; while it survives, damaged systems are patched up. */
  get repairing(): boolean {
    for (const c of this.components) if (c.type === 'cargo') return c.alive;
    return false;
  }

  /** Telegraphed blast on the route ahead of a ship (also used for stray fleet fire). */
  strikeAt(s: Ship, race: RaceSim, delay = 1.6, radius = 12): boolean {
    const st = this.strikes.find((k) => !k.active);
    if (!st) return false;
    const track = race.track;
    if (track.arena > 0) {
      const lead = delay * this.rng.range(0.8, 1.15);
      st.x = s.x + s.vx * lead + this.rng.range(-8, 8); st.z = s.z + s.vz * lead + this.rng.range(-8, 8); st.y = 0;
      st.path = 0; st.s = 0; st.d = 0;
    } else {
      const path = track.paths[s.pathId];
      const ahead = s.speed * delay * this.rng.range(0.85, 1.15) + 6;
      const sAt = (s.idx + s.f) * path.step + ahead;
      if (!path.closed && sAt > path.length - 20) return false;
      pointAt(path, sAt, 0, tmp, fr);
      const d = Math.max(-(fr.hw - 4), Math.min(fr.hw - 4, s.d + this.rng.range(-9, 9)));
      pointAt(path, sAt, d, tmp, fr);
      st.x = tmp.x; st.y = tmp.y; st.z = tmp.z;
      st.path = s.pathId; st.s = path.closed ? ((sAt % path.length) + path.length) % path.length : sAt; st.d = d;
    }
    st.active = true; st.t = 0; st.delay = delay; st.r = radius;
    race.events.push('strikeWarn', -1, st.x, st.y, st.z, st.r);
    return true;
  }

  update(dt: number, race: RaceSim): void {
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    const repair = this.repairing && !this.destroyed;
    for (const c of this.components) {
      c.flash = Math.max(0, c.flash - dt * 4);
      if (repair && c.alive && c.hp < c.maxHp && c.flash <= 0) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.007 * dt);
    }
    if (this.destroyed) this.destroyedT += dt;
    const racing = race.phase === 'racing';
    const power = this.power;
    const reach = this.battle ? 560 : 430;

    // ---- gun batteries: aimed three-round bursts at racers in range
    let batteries = 0;
    for (const c of this.components) {
      if (c.type !== 'battery' || !c.alive) continue;
      batteries++;
      if (!racing) continue;
      if (c.burstLeft > 0) {
        c.burstT -= dt;
        if (c.burstT <= 0) {
          c.burstT = 0.14; c.burstLeft--;
          const t = race.ships[c.targetShip];
          if (t && t.alive) this.fireBolt(c, t.x, t.y, t.z, t.vx, t.vz, race);
        }
        continue;
      }
      c.fireT -= dt * power;
      if (c.fireT <= 0) {
        c.fireT = (2.2 / this.aggro) * this.rng.range(0.75, 1.35);
        let pick = -1, n = 0;
        for (const s of race.ships) {
          if (!s.alive || s.finished) continue;
          const d2 = (s.x - c.x) ** 2 + (s.z - c.z) ** 2;
          if (d2 < reach * reach) { n++; if (this.rng.next() < 1 / n) pick = s.index; }
        }
        if (pick >= 0) { c.targetShip = pick; c.burstLeft = 3; c.burstT = 0; }
      }
    }

    if (racing && batteries > 0) {
      // ---- bombardment: telegraphed blasts on the racing line, scaled by surviving batteries
      this.strikeT -= dt * power;
      if (this.strikeT <= 0) {
        this.strikeT = (3.0 / this.aggro) * Math.pow(4 / batteries, 0.7) * this.rng.range(0.7, 1.3);
        const pick = this.pickInZone(race);
        if (pick) this.strikeAt(pick, race);
      }
      // ---- guided missiles: slower than a bolt, but they follow. Flares or raw speed shake them.
      this.missileT -= dt * power;
      if (this.missileT <= 0) {
        this.missileT = (7.5 / this.aggro) * Math.pow(4 / batteries, 0.6) * this.rng.range(0.7, 1.3);
        const pick = this.pickInZone(race);
        if (pick) {
          const alive = this.components.filter((c) => c.type === 'battery' && c.alive);
          this.fireMissile(alive[Math.floor(this.rng.next() * alive.length)], pick, race);
        }
      }
    }
    for (const st of this.strikes) {
      if (!st.active) continue;
      st.t += dt;
      if (st.t >= st.delay) {
        st.active = false;
        race.events.push('strike', -1, st.x, st.y, st.z, st.r);
        for (const s of race.ships) {
          if (!s.alive) continue;
          const dist = Math.hypot(s.x - st.x, s.z - st.z);
          if (dist < st.r + 2 && Math.abs(s.y - st.y) < 10) race.damageShip(s, 26 * (1 - 0.5 * dist / (st.r + 2)), -1, st.x, st.z);
        }
      }
    }
  }

  private pickInZone(race: RaceSim): Ship | null {
    let pick: Ship | null = null, n = 0;
    for (const s of race.ships) {
      if (!s.alive || s.finished) continue;
      const inZone = this.battle
        ? Math.hypot(s.x - this.cx, s.z - this.cz) < this.length * 0.5 + 420
        : s.pathId === 0 && progInRange(s.prog, this.zoneFrom, this.zoneTo, race.track.length);
      if (inZone) { n++; if (this.rng.next() < 1 / n) pick = s; }
    }
    return pick;
  }

  private fireMissile(c: Component, t: Ship, race: RaceSim): void {
    const mx = c.x - this.nx * c.r, my = c.y - 2, mz = c.z - this.nz * c.r;
    let dx = t.x - mx, dy = t.y - my, dz = t.z - mz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const p = race.projectiles.spawn();
    p.kind = MISSILE; p.owner = -1;
    p.x = p.px = mx; p.y = p.py = my; p.z = p.pz = mz;
    p.speed = 120; p.maxSpeed = 188; p.turn = 2.2;
    p.vx = dx * p.speed; p.vy = dy * p.speed; p.vz = dz * p.speed;
    p.life = 7; p.damage = 26; p.tKind = 1; p.tIdx = t.index; p.color = 0xff5030;
    race.events.push('enemyMissile', t.index, mx, my, mz, 0, c.index);
  }

  private fireBolt(c: Component, tx: number, ty: number, tz: number, tvx: number, tvz: number, race: RaceSim): void {
    const speed = 235;
    // muzzle sits on the track-facing side of the battery
    const mx = c.x - this.nx * c.r * 0.8, my = c.y - 3, mz = c.z - this.nz * c.r * 0.8;
    const dist = Math.hypot(tx - mx, ty - my, tz - mz);
    const lead = dist / speed;
    const spread = 5.5;
    const ax = tx + tvx * lead + this.rng.range(-spread, spread);
    const ay = ty + this.rng.range(-1, 1);
    const az = tz + tvz * lead + this.rng.range(-spread, spread);
    let dx = ax - mx, dy = ay - my, dz = az - mz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const p = race.projectiles.spawn();
    p.kind = CAP_BOLT; p.owner = -1;
    p.x = p.px = mx; p.y = p.py = my; p.z = p.pz = mz;
    p.vx = dx * speed; p.vy = dy * speed; p.vz = dz * speed; p.speed = speed;
    p.life = 2.6; p.damage = this.boltDamage; p.tKind = 0; p.tIdx = -1; p.color = 0xff3030;
    race.events.push('capitalFire', -1, mx, my, mz, 0, c.index);
  }
}
