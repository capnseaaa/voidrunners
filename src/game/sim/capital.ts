// Capital ship encounter: a huge battleship parked beside a stretch of the
// track with four destructible component types, its own guns and an
// orbital-strike style bombardment of the racing line.
import { Vector3 } from 'three';
import type { RaceDef } from '../data/campaign';
import { Rng } from '../core/rng';
import { idxAtS, newFrame, pointAt, progInRange, type Track } from '../tracks/track';
import type { RaceSim } from './race';
import { CAP_BOLT } from './weapons';

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
export const CAPITAL_NAMES: Record<string, string> = { neon: 'ISV TOLLGATE', orbit: 'HMS GRAVEDIGGER', solar: 'DSS HELIOS WRATH', warzone: 'FLAGSHIP ABSOLUTION' };

const BASE_HP: Record<ComponentType, number> = { shield: 800, battery: 420, engine: 650, cargo: 800 };
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
  private readonly rng: Rng;
  private readonly aggro: number;
  private readonly boltDamage: number;
  readonly zoneFrom: number; readonly zoneTo: number;

  constructor(track: Track, race: RaceDef, shipCount: number) {
    this.name = CAPITAL_NAMES[track.def.id] ?? 'CAPITAL SHIP';
    this.rng = new Rng(race.seed * 31 + 7);
    this.aggro = race.capitalAggro;
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
    this.length = len * 0.94;
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
    if (shipIdx >= 0) { this.damageBy[shipIdx] += dealt; race.ships[shipIdx].capitalDamage += dealt; }
    race.events.push('componentHit', shipIdx, hx, hy, hz, dealt, c.index);
    if (c.hp <= 0) this.destroyComponent(c, shipIdx, race);
    return dealt;
  }

  private destroyComponent(c: Component, shipIdx: number, race: RaceSim): void {
    c.alive = false; c.hp = 0;
    const killer = shipIdx >= 0 ? race.ships[shipIdx] : null;
    if (killer) { killer.capitalKills++; killer.capitalKillBonus += COMPONENT_KILL_BONUS[c.type]; }
    race.events.push('componentDestroyed', shipIdx, c.x, c.y, c.z, c.r, c.index, 0xffa040, COMPONENT_LABEL[c.type]);
    const track = race.track;
    if (c.type === 'shield') {
      this.shieldUp = false;
    } else if (c.type === 'engine') {
      // overdrive reward: the killer is supercharged, and overdrive cells rain onto the track
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
    if (!this.destroyed && this.components.every((k) => !k.alive)) {
      this.destroyed = true;
      race.events.push('capitalDestroyed', shipIdx, this.cx, this.cy, this.cz, this.length);
    }
  }

  update(dt: number, race: RaceSim): void {
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    for (const c of this.components) c.flash = Math.max(0, c.flash - dt * 4);
    if (this.destroyed) this.destroyedT += dt;
    const racing = race.phase === 'racing';

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
      c.fireT -= dt;
      if (c.fireT <= 0) {
        c.fireT = (2.6 / this.aggro) * this.rng.range(0.75, 1.35);
        let pick = -1, n = 0;
        for (const s of race.ships) {
          if (!s.alive || s.finished) continue;
          const d2 = (s.x - c.x) ** 2 + (s.z - c.z) ** 2;
          if (d2 < 430 * 430) { n++; if (this.rng.next() < 1 / n) pick = s.index; }
        }
        if (pick >= 0) { c.targetShip = pick; c.burstLeft = 3; c.burstT = 0; }
      }
    }

    // ---- bombardment: telegraphed blasts on the racing line, scaled by surviving batteries
    if (racing && batteries > 0) {
      this.strikeT -= dt;
      if (this.strikeT <= 0) {
        this.strikeT = (3.4 / this.aggro) * Math.pow(4 / batteries, 0.7) * this.rng.range(0.7, 1.3);
        let pick = -1, n = 0;
        for (const s of race.ships) {
          if (!s.alive || s.finished || s.pathId !== 0) continue;
          if (progInRange(s.prog, this.zoneFrom, this.zoneTo, race.track.length)) { n++; if (this.rng.next() < 1 / n) pick = s.index; }
        }
        if (pick >= 0) {
          const s = race.ships[pick];
          const st = this.strikes.find((k) => !k.active);
          if (st) {
            const delay = 1.6;
            const ahead = s.speed * delay * this.rng.range(0.85, 1.15) + 6;
            const sAt = s.prog + ahead;
            pointAt(race.track.main, sAt, 0, tmp, fr);
            const d = Math.max(-(fr.hw - 4), Math.min(fr.hw - 4, s.d + this.rng.range(-9, 9)));
            pointAt(race.track.main, sAt, d, tmp, fr);
            st.active = true; st.x = tmp.x; st.y = tmp.y; st.z = tmp.z; st.t = 0; st.delay = delay; st.r = 12;
            st.path = 0; st.s = ((sAt % race.track.length) + race.track.length) % race.track.length; st.d = d;
            race.events.push('strikeWarn', -1, st.x, st.y, st.z, st.r);
          }
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
          if (dist < st.r + 2 && Math.abs(s.y - st.y) < 10) race.damageShip(s, 30 * (1 - 0.5 * dist / (st.r + 2)), -1, st.x, st.z);
        }
      }
    }
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
