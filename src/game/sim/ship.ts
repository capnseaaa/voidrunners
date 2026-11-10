// Ship state and arcade flight physics. Player and AI ships are the same
// class driven through the same Controls structure - there is no separate
// AI movement model.
import { ABILITIES, type AbilityId, type ShipDef, type ShipStats } from '../data/ships';
import { clamp } from '../core/rng';
import { frameAt, locateOn, newFrame, wrapDelta, type Frame, type Track, type TrackPath, type TrackPos } from '../tracks/track';
import type { EventQueue } from './events';

export const SHIP_RADIUS = 2.3;
export const HOVER = 1.7;
const BRAKE_DECEL = 72;
const TWO_PI = Math.PI * 2;

export interface Controls {
  throttle: number; brake: number; steer: number; // steer: +1 = right
  fire: boolean; missile: boolean; boost: boolean; ability: boolean; reset: boolean;
}

export function newControls(): Controls {
  return { throttle: 0, brake: 0, steer: 0, fire: false, missile: false, boost: false, ability: false, reset: false };
}

const cur: TrackPos = { path: 0, idx: 0, f: 0, d: 0 };
const cand: TrackPos = { path: 0, idx: 0, f: 0, d: 0 };
const fr: Frame = newFrame();

export class Ship {
  readonly index: number;
  readonly name: string;
  readonly def: ShipDef;
  readonly stats: ShipStats;
  readonly ability: AbilityId;
  isPlayer = false;
  ctl: Controls = newControls();

  // transform
  x = 0; y = 0; z = 0;
  yaw = 0; pitch = 0; roll = 0;
  vx = 0; vz = 0;
  fwdSpeed = 0; latSpeed = 0;
  steer = 0; // smoothed steering
  // track state
  pathId = 0; idx = 0; f = 0; d = 0; hw = 20;
  prog = 0; total = 0; // main-line progress and cumulative progress
  cpCount = 0; lap = 0; // checkpoints passed (incl. start line) and completed laps
  finished = false; finishTime = 0; finishPos = 0; dnf = false;
  lapStart = 0; bestLap = 0; lastLap = 0;
  wrongWayT = 0; stuckT = 0;
  // status
  hp: number; shield: number; shieldDelayT = 0;
  boost = 60; boostLock = false; boosting = false;
  missiles: number; missileCd = 0;
  heat = 0; overheated = false; fireCd = 0; sinceFire = 9;
  abilityT = 0; abilityCd = 0; abilityHeld = false;
  padT = 0; overdriveT = 0;
  invuln = 0; dead = 0; deaths = 0;
  hitFlash = 0; hitDirX = 0; hitDirZ = 0; lastHitBy = -1; lastHitT = 99;
  gunSide = 1;
  // targeting (0 none, 1 ship, 2 capital component)
  targetKind = 0; targetIdx = -1; targetT = 0;
  // scoring
  salvage = 0; racerDamage = 0; racerKills = 0;
  capitalDamage = 0; capitalKills = 0; capitalKillBonus = 0;

  constructor(index: number, name: string, def: ShipDef, stats: ShipStats) {
    this.index = index; this.name = name; this.def = def; this.stats = stats; this.ability = def.ability;
    this.hp = stats.armour; this.shield = stats.shield; this.missiles = stats.missiles;
  }

  get alive(): boolean { return this.dead <= 0; }
  get phased(): boolean { return this.ability === 'dash' && this.abilityT > 0; }
  get bulwark(): boolean { return this.ability === 'bulwark' && this.abilityT > 0; }
  get magnet(): boolean { return this.ability === 'magnet' && this.abilityT > 0; }
  get bursting(): boolean { return this.ability === 'burst' && this.abilityT > 0; }
  get speed(): number { return Math.hypot(this.vx, this.vz); }
  /** Unit forward vector components in the horizontal plane. */
  get hx(): number { return Math.sin(this.yaw); }
  get hz(): number { return Math.cos(this.yaw); }

  placeOnTrack(track: Track, pathId: number, s: number, d: number): void {
    const path = track.paths[pathId];
    const len = path.length;
    const ss = path.closed ? ((s % len) + len) % len : clamp(s, 0, len - 0.01);
    const i = Math.floor(ss / path.step);
    frameAt(path, i, ss / path.step - i, fr);
    this.pathId = pathId; this.idx = i; this.f = ss / path.step - i; this.d = d; this.hw = fr.hw;
    this.x = fr.x + fr.rx * d; this.z = fr.z + fr.rz * d; this.y = fr.y + HOVER;
    this.yaw = Math.atan2(fr.hx, fr.hz);
    this.vx = 0; this.vz = 0; this.fwdSpeed = 0; this.latSpeed = 0; this.steer = 0;
    this.prog = fr.prog;
  }

  /** Advance timers, steering, thrust and track collision. */
  integrate(dt: number, track: Track, ev: EventQueue, racing: boolean): void {
    const st = this.stats, c = this.ctl;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.lastHitT += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.padT > 0) this.padT -= dt;
    if (this.overdriveT > 0) this.overdriveT -= dt;
    if (this.abilityT > 0) this.abilityT -= dt;
    if (this.abilityCd > 0) this.abilityCd -= dt;
    if (this.missileCd > 0) this.missileCd -= dt;
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.threatT > 0) this.threatT -= dt;
    this.sinceFire += dt;
    if (this.sinceFire > 0.3) {
      this.heat = Math.max(0, this.heat - 30 * dt);
      if (this.overheated && this.heat < 35) this.overheated = false;
    }
    if (this.shieldDelayT > 0) this.shieldDelayT -= dt;
    else if (this.shield < st.shield) this.shield = Math.min(st.shield, this.shield + st.shieldRegen * dt);

    const canAct = racing;
    const thrIn = canAct ? c.throttle : 0;
    const brakeIn = canAct ? c.brake : 0;
    const steerIn = canAct ? clamp(c.steer, -1, 1) : 0;

    // ability activation (edge triggered)
    if (canAct && c.ability && !this.abilityHeld && this.abilityCd <= 0 && this.abilityT <= 0) {
      const info = ABILITIES[this.ability];
      this.abilityT = info.duration; this.abilityCd = info.cooldown;
      ev.push('ability', this.index, this.x, this.y, this.z);
    }
    this.abilityHeld = c.ability;

    // steering
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 9);
    const sp = Math.abs(this.fwdSpeed);
    const auth = Math.min(1, 0.4 + sp / 45) * (1 - 0.1 * Math.min(1, sp / 170));
    this.yaw -= this.steer * st.turnRate * auth * dt * (this.fwdSpeed < -1 ? -1 : 1);
    if (this.yaw > Math.PI) this.yaw -= TWO_PI; else if (this.yaw < -Math.PI) this.yaw += TWO_PI;

    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw);
    const rx = -hz, rz = hx;
    let vF = this.vx * hx + this.vz * hz;
    let vL = this.vx * rx + this.vz * rz;

    // thrust modifiers
    let topMul = 1, accMul = 1, thr = thrIn;
    const wasBoosting = this.boosting;
    this.boosting = canAct && c.boost && this.boost > 0 && !this.boostLock;
    if (this.boosting) {
      topMul = 1.3; accMul = 2; thr = 1;
      if (this.overdriveT <= 0) this.boost -= 27 * dt;
      if (this.boost <= 0) { this.boost = 0; this.boostLock = true; this.boosting = false; }
      if (!wasBoosting) ev.push('boostStart', this.index, this.x, this.y, this.z);
    } else {
      this.boost = Math.min(100, this.boost + 3.6 * dt);
      if (this.boost >= 15) this.boostLock = false;
    }
    if (this.padT > 0) { topMul = Math.max(topMul, 1.26) + (this.boosting ? 0.08 : 0); accMul = Math.max(accMul, 2.8); thr = Math.max(thr, 0.6); }
    if (this.overdriveT > 0) { topMul = Math.max(topMul, 1.3); accMul = Math.max(accMul, 2.4); }
    if (this.bursting) { topMul = 1.58; accMul = 4.4; thr = 1; }
    const top = st.topSpeed * topMul;
    if (this.phased && this.abilityT > ABILITIES.dash.duration - 0.38) vF = Math.max(vF, st.topSpeed * 1.7);

    if (thr > 0 && vF < top) {
      const r = vF > 0 ? vF / top : 0;
      vF += thr * st.accel * accMul * (1 - r * r) * dt;
    }
    if (vF > top) vF -= (vF - top) * 1.5 * dt;
    if (thr === 0 && brakeIn === 0) vF -= vF * 0.45 * dt;
    if (brakeIn > 0) { vF -= brakeIn * BRAKE_DECEL * dt; if (vF < -24) vF = -24; }
    vL *= Math.exp(-st.grip * dt);

    this.vx = hx * vF + rx * vL;
    this.vz = hz * vF + rz * vL;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.resolveTrack(track, ev);

    // re-derive after wall response
    this.fwdSpeed = this.vx * hx + this.vz * hz;
    this.latSpeed = this.vx * rx + this.vz * rz;
    const targetRoll = clamp(this.steer * 0.55 + this.latSpeed * 0.012, -0.9, 0.9);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 7);
  }

  private resolveTrack(track: Track, ev: EventQueue): void {
    const main = track.main;
    let path: TrackPath = track.paths[this.pathId];
    const over = locateOn(path, this.x, this.z, this.idx, cur);
    let margin = path.samples[cur.idx].hw - Math.abs(cur.d);

    if (path.id === 0) {
      const mn = main.samples.length;
      for (let b = 1; b < track.paths.length; b++) {
        const br = track.paths[b];
        const n = br.samples.length;
        let rel = cur.idx - br.fromIdx;
        if (rel > mn / 2) rel -= mn; else if (rel < -mn / 2) rel += mn;
        let valid = false;
        if (rel >= -2 && rel <= br.forkEnd + 4) {
          const o2 = locateOn(br, this.x, this.z, clamp(rel, 0, br.forkEnd + 4), cand);
          valid = o2 >= 0 && cand.idx <= br.forkEnd + 6;
        } else {
          let relEnd = cur.idx - br.toIdx;
          if (relEnd > mn / 2) relEnd -= mn; else if (relEnd < -mn / 2) relEnd += mn;
          const mergeLen = n - 1 - br.mergeStart;
          if (relEnd >= -(mergeLen + 4) && relEnd <= 2) {
            const o2 = locateOn(br, this.x, this.z, clamp(n - 1 + relEnd, br.mergeStart - 4, n - 1), cand);
            valid = o2 <= 0 && cand.idx >= br.mergeStart - 6 && cand.idx < n - 1;
          }
        }
        if (valid) {
          const m2 = br.samples[cand.idx].hw - Math.abs(cand.d);
          if (m2 > margin + 1) { path = br; margin = m2; cur.path = cand.path; cur.idx = cand.idx; cur.f = cand.f; cur.d = cand.d; break; }
        }
      }
    } else {
      const n = path.samples.length;
      if (over > 0 || cur.idx >= n - 1) {
        locateOn(main, this.x, this.z, path.toIdx, cur); path = main;
        margin = main.samples[cur.idx].hw - Math.abs(cur.d);
      } else if (over < 0) {
        locateOn(main, this.x, this.z, path.fromIdx, cur); path = main;
        margin = main.samples[cur.idx].hw - Math.abs(cur.d);
      } else {
        let hint = -1;
        if (cur.idx <= path.forkEnd + 4) hint = path.fromIdx + cur.idx;
        else if (cur.idx >= path.mergeStart - 4) hint = path.toIdx - (n - 1 - cur.idx);
        if (hint >= 0) {
          locateOn(main, this.x, this.z, hint, cand);
          const m2 = main.samples[cand.idx].hw - Math.abs(cand.d);
          if (m2 > margin + 1) { path = main; margin = m2; cur.path = 0; cur.idx = cand.idx; cur.f = cand.f; cur.d = cand.d; }
        }
      }
    }

    frameAt(path, cur.idx, cur.f, fr);
    const room = fr.hw - SHIP_RADIUS;
    if (Math.abs(cur.d) > room) {
      const side = cur.d > 0 ? 1 : -1;
      const pen = Math.abs(cur.d) - room;
      this.x -= side * pen * fr.rx; this.z -= side * pen * fr.rz;
      cur.d = side * room;
      const vn = (this.vx * fr.rx + this.vz * fr.rz) * side; // speed into the wall
      if (vn > 0) {
        this.vx -= side * fr.rx * vn * 1.25; this.vz -= side * fr.rz * vn * 1.25;
        const scrub = 1 - Math.min(0.45, vn / 140);
        this.vx *= scrub; this.vz *= scrub;
        if (vn > 9) ev.push('wallHit', this.index, this.x + side * fr.rx * SHIP_RADIUS, this.y, this.z + side * fr.rz * SHIP_RADIUS, vn);
        if (vn > 30 && this.invuln <= 0 && !this.phased) this.wallDamage = Math.max(this.wallDamage, (vn - 30) * 0.3);
        // nudge the nose back along the track so scraping does not pin the ship
        const want = Math.atan2(fr.hx, fr.hz);
        let dy = want - this.yaw;
        if (dy > Math.PI) dy -= TWO_PI; else if (dy < -Math.PI) dy += TWO_PI;
        if (Math.abs(dy) < 1.4) this.yaw += dy * Math.min(1, vn / 60) * 0.25;
      }
    }

    this.pathId = path.id; this.idx = cur.idx; this.f = cur.f; this.d = cur.d; this.hw = fr.hw;
    this.y += (fr.y + HOVER - this.y) * 0.5;
    this.pitch = Math.atan(fr.ty);
    const delta = wrapDelta(fr.prog, this.prog, track.length);
    this.total += delta;
    this.prog = fr.prog;
    this.trackHx = fr.hx; this.trackHz = fr.hz; this.curv = fr.curv;
  }

  threatT = 0; // >0 while a missile is closing in
  preferRacers = false; // targeting preference (AI personalities); the player always prefers the capital ship
  place = 0; // current race position, 1-based
  wallDamage = 0; // pending self-inflicted damage, applied by the race (needs the damage pipeline)
  trackHx = 0; trackHz = 1; curv = 0;
}
