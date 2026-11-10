// AI racer driver. It only ever writes to the ship's Controls, exactly like the
// keyboard does for the player, so AI ships obey identical physics and rules.
import { ABILITIES, type Personality } from '../data/ships';
import { clamp, Rng } from '../core/rng';
import { locateOn, progInRange, wrapDelta, type Sample, type TrackPos } from '../tracks/track';
import type { RaceSim } from './race';
import type { Ship } from './ship';

const BRAKE_A = 56;
const probe: TrackPos = { path: 0, idx: 0, f: 0, d: 0 };

export class AiController {
  readonly ship: Ship;
  readonly pers: Personality;
  readonly skill: number; // effective 0..1
  private readonly rng: Rng;
  private readonly take: boolean[] = [];
  private readonly decidedLap: number[] = [];
  private lane: number;
  private dT = 0;
  private mistakeT = 0; private mistakeKind = 0; private mistakeRoll = 0;
  private hostile = false; private hostileT = 0;
  private engage = false; private wasInZone = false; private engagedOnce = false;
  private boostOn = false;
  private holdFire = false;
  private reverseT = 0;
  private abilityDelay = 0;
  private t = 0;
  private lastTotal = -1e9; private noProgT = 0;
  cruise = false; // post-finish cool-down driving

  constructor(ship: Ship, pers: Personality, raceSkill: number, seed: number) {
    this.ship = ship; this.pers = pers;
    this.skill = clamp(pers.skill * raceSkill, 0.3, 1);
    this.rng = new Rng(seed);
    this.lane = this.rng.range(-1, 1);
    ship.preferRacers = pers.aggression > 0.8;
  }

  update(dt: number, race: RaceSim): void {
    const s = this.ship, c = s.ctl, p = this.pers, rng = this.rng;
    c.fire = false; c.missile = false; c.ability = false; c.reset = false; c.boost = false;
    if (!s.alive || race.phase === 'grid') { c.throttle = 0; c.brake = 0; c.steer = 0; return; }
    this.t += dt;
    const track = race.track, st = s.stats;
    const main = track.main;
    const mn = main.samples.length;
    const cruise = this.cruise || s.finished;

    // ------------------------------------------------ route decisions
    if (s.pathId === 0) {
      for (let b = 1; b < track.paths.length; b++) {
        const br = track.paths[b];
        let ahead = br.fromIdx - s.idx;
        if (ahead < -mn / 2) ahead += mn;
        if (ahead > 0 && ahead * main.step < 340 && this.decidedLap[b] !== s.lap) {
          this.decidedLap[b] = s.lap;
          const prob = br.kind === 'shortcut' ? 0.12 + 0.86 * p.shortcutBias : br.kind === 'risky' ? 0.08 + 0.88 * p.riskBias : 0.3;
          this.take[b] = !cruise && rng.chance(prob);
        }
      }
    }

    // ------------------------------------------------ look ahead along the planned route
    let pid = s.pathId, idx = s.idx;
    if (pid === 0) {
      for (let b = 1; b < track.paths.length; b++) {
        if (!this.take[b] || this.decidedLap[b] !== s.lap) continue;
        const br = track.paths[b];
        let rel = s.idx - br.fromIdx;
        if (rel > mn / 2) rel -= mn;
        if (rel >= 0 && rel <= br.forkEnd + 2) {
          // still in the fork overlap: commit only if the ship can actually reach the branch ribbon
          locateOn(br, s.x, s.z, rel, probe);
          if (rel <= br.forkEnd * 0.5 || br.samples[probe.idx].hw - Math.abs(probe.d) > 1) { pid = b; idx = probe.idx; }
          else this.take[b] = false;
        }
      }
    }
    const v = Math.max(s.fwdSpeed, 18);
    const stepLen = main.step;
    const Ld = 15 + v * 0.4;
    const burstReady = s.ability === 'burst' && s.abilityCd <= 0 && s.abilityT <= 0;
    const N = Math.min(96, Math.ceil(Math.max(Ld * 2, (v * v) / (2 * BRAKE_A) + 36, burstReady ? 540 : 236) / stepLen));
    const cornerK = st.turnRate * 0.74 * (0.8 + 0.25 * this.skill);
    let vAllow = 1e9, kSum = 0, kN = 0, straight = true, longStraight = true;
    let look: Sample | null = null;
    for (let k = 1; k <= N; k++) {
      const path = track.paths[pid];
      idx++;
      if (pid === 0) {
        if (idx >= mn) idx = 0;
        for (let b = 1; b < track.paths.length; b++) {
          if (this.take[b] && this.decidedLap[b] === s.lap && idx === track.paths[b].fromIdx) { pid = b; idx = 0; }
        }
      } else if (idx >= path.samples.length - 1) { idx = path.toIdx; pid = 0; }
      const smp = track.paths[pid].samples[idx];
      const D = k * stepLen;
      let vs = cornerK / Math.max(Math.abs(smp.curv), 1e-4);
      if (smp.hw < 13) vs *= 0.94;
      const va = Math.sqrt(vs * vs + 2 * BRAKE_A * D);
      if (va < vAllow) vAllow = va;
      if (D <= Ld * 2) { kSum += smp.curv; kN++; }
      if (!look && D >= Ld) look = smp;
      if (D < 236 && vs < st.topSpeed * 1.22) straight = false;
      if (vs < st.topSpeed * 1.5) longStraight = false;
    }
    if (!look) look = track.paths[pid].samples[idx];

    // ------------------------------------------------ lateral target
    const kAvg = kN ? kSum / kN : 0;
    const roomNow = s.hw - 4.5;
    let want = clamp(kAvg * 170, -1, 1) * roomNow * 0.55 * this.skill;
    if (Math.abs(kAvg) < 0.002) want += this.lane * roomNow * 0.42;
    this.dT += (want - this.dT) * Math.min(1, dt * 2.5);
    let dT = this.dT;

    // mistakes: brief lapses of judgement
    this.mistakeRoll -= dt;
    if (this.mistakeT > 0) this.mistakeT -= dt;
    else if (this.mistakeRoll <= 0 && !cruise) {
      this.mistakeRoll = 1;
      if (rng.chance((p.mistakeRate / 60) * (1.5 - this.skill * 0.5))) {
        this.mistakeT = rng.range(0.6, 1.5);
        this.mistakeKind = rng.int(0, 2);
      }
    }
    const blundering = this.mistakeT > 0;

    const pathLen = track.paths[s.pathId].length;
    const myS = (s.idx + s.f) * track.paths[s.pathId].step;
    const onMain = s.pathId === 0;
    const ahead = (os: number) => (onMain ? wrapDelta(os, myS, pathLen) : os - myS);
    const lookDist = 28 + v * 0.95;
    let avoidDs = 1e9, avoidD = 0, avoiding = false;
    const consider = (od: number, R: number, ds: number) => {
      if (ds >= avoidDs) return;
      if (Math.abs(od - dT) > R && Math.abs(od - s.d) > R) return;
      const lo = od - R - 0.8, hi = od + R + 0.8;
      const lim = s.hw - 3.2;
      const loOk = lo > -lim, hiOk = hi < lim;
      let pick: number;
      if (loOk && hiOk) pick = Math.abs(lo - s.d) < Math.abs(hi - s.d) ? lo : hi;
      else if (loOk) pick = lo; else if (hiOk) pick = hi;
      else pick = od > 0 ? -lim : lim;
      avoidDs = ds; avoidD = pick; avoiding = true;
    };
    if (!(blundering && this.mistakeKind === 2)) {
      const obs = race.layout.obstacles;
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (!o.alive || o.path !== s.pathId) continue;
        const ds = ahead(o.s);
        if (ds < -3 || ds > lookDist) continue;
        if (o.kind === 'vent' && !o.active && o.period - (o.timer % o.period) > 2.4) continue;
        consider(o.d, o.r + (o.kind === 'mine' ? 6 : 3.4) + o.amp * 0.3, ds);
      }
      for (const st2 of race.capital.strikes) {
        if (!st2.active || !onMain) continue;
        const ds = ahead(st2.s);
        if (ds < -4 || ds > v * (st2.delay - st2.t) + 16) continue;
        consider(st2.d, st2.r + 3, ds);
      }
    }
    // other racers
    let blocker: Ship | null = null;
    for (const o of race.ships) {
      if (o === s || !o.alive || o.pathId !== s.pathId) continue;
      const ds = ahead((o.idx + o.f) * track.paths[o.pathId].step);
      if (ds < 1.5 || ds > 70) continue;
      const closing = s.fwdSpeed - o.fwdSpeed;
      if (this.hostile && p.aggression > 0.8 && !cruise && ds > 12) {
        if (Math.abs(o.d - s.d) < 14 && !avoiding) dT = o.d; // line up the guns
      } else if (closing > 1 && ds < 12 + closing * 0.9) {
        consider(o.d, 5.2, ds);
        if (ds < 26) blocker = o;
      }
    }
    if (avoiding) dT = avoidD;
    else if (!cruise) {
      // boost pads and salvage, when nothing needs dodging
      let got = false;
      const padReach = 5 + 10 * p.boostUse;
      for (const pad of race.layout.pads) {
        if (pad.path !== s.pathId) continue;
        const ds = ahead(pad.s);
        if (ds > 10 && ds < 130 && Math.abs(pad.d - s.d) < padReach) { dT = pad.d; got = true; break; }
      }
      if (!got || p.salvageBias > 0.8) {
        const reach = 3 + 15 * p.salvageBias;
        let bestScore = 1e9;
        const pk = race.layout.pickups;
        for (let i = 0; i < pk.length; i++) {
          const q = pk[i];
          if (!q.active || q.path !== s.pathId) continue;
          if (q.kind === 'missile' && s.missiles >= st.missiles) continue;
          const ds = ahead(q.s);
          if (ds < 8 || ds > 110) continue;
          const off = Math.abs(q.d - s.d);
          if (off > reach * (q.value >= 3 || q.kind === 'overdrive' ? 1.6 : 1)) continue;
          const score = ds + off * 3;
          if (score < bestScore) { bestScore = score; dT = q.d; }
        }
      }
    }
    if (s.threatT > 0 && !avoiding) dT += Math.sin(this.t * 5) * 8; // jink when a missile is inbound
    if (blundering && this.mistakeKind === 1) dT = Math.sign(-kAvg || this.lane) * (s.hw - 2); // runs wide

    // ------------------------------------------------ steering (pure pursuit)
    const dl = clamp(dT, -(look.hw - 3.4), look.hw - 3.4);
    const tx = look.x + look.rx * dl - s.x, tz = look.z + look.rz * dl - s.z;
    const hx = s.hx, hz = s.hz;
    const cross = hx * tz - hz * tx, dot = hx * tx + hz * tz;
    const ang = Math.atan2(cross, dot);
    let steer = clamp(ang * 2.4, -1, 1);
    if (blundering && this.mistakeKind === 0) steer = clamp(steer + Math.sin(this.t * 11) * 0.7, -1, 1);

    // ------------------------------------------------ speed control
    let throttle = 1, brake = 0;
    const cap = cruise ? Math.min(vAllow, st.topSpeed * 0.62) : vAllow;
    if (!(blundering && this.mistakeKind === 1) || cruise) {
      if (v > cap * 1.08) { throttle = 0; brake = 1; }
      else if (v > cap) { throttle = 0; brake = 0.3; }
    }
    if (Math.abs(ang) > 1.0) { throttle = Math.min(throttle, 0.5); }

    // stuck recovery: back off, then call for a track reset (same penalty the player pays)
    if (s.speed < 5 && race.phase === 'racing') s.stuckT += dt; else s.stuckT = Math.max(0, s.stuckT - dt * 2);
    if (s.stuckT > 1.1 && this.reverseT <= 0 && s.stuckT < 3.6) this.reverseT = 0.9;
    if (this.reverseT > 0) { this.reverseT -= dt; throttle = 0; brake = 1; steer = -steer; }
    if (s.stuckT > 4) { c.reset = true; s.stuckT = 0; }
    // no forward progress for a while (wedged, spun around): reset to the track
    if (Math.abs(s.total - this.lastTotal) > 30) { this.lastTotal = s.total; this.noProgT = 0; }
    else if (race.phase === 'racing') { this.noProgT += dt; if (this.noProgT > 6) { c.reset = true; this.noProgT = 0; } }

    c.steer = steer; c.throttle = throttle; c.brake = brake;
    if (cruise) return;

    // ------------------------------------------------ boost
    const thresh = this.boostOn ? 1 : 30 + 45 * (1 - p.boostUse);
    this.boostOn = straight && brake === 0 && s.boost > thresh && !s.boostLock && Math.abs(ang) < 0.25;
    c.boost = this.boostOn;

    // ------------------------------------------------ weapons
    this.hostileT -= dt;
    if (this.hostileT <= 0) { this.hostileT = rng.range(3, 6); this.hostile = rng.chance(0.09 + p.aggression * 0.45); }
    const cz = race.capital;
    const inZone = !cz.destroyed && progInRange(s.prog, cz.zoneFrom, cz.zoneTo, track.length);
    if (inZone && !this.wasInZone) {
      // everyone takes at least one run at the capital ship; specialists engage on every pass
      this.engage = rng.chance(0.35 + 0.65 * p.capitalBias) || (s.lap >= race.laps - 1 && !this.engagedOnce);
      if (this.engage) this.engagedOnce = true;
    }
    this.wasInZone = inZone;
    if (s.heat > 86) this.holdFire = true; else if (s.heat < 32) this.holdFire = false;
    const reserve = p.capitalBias > 0.5 && !cz.destroyed ? Math.ceil(st.missiles * 0.5) : 0;
    if (s.targetKind === 1 && s.targetIdx >= 0) {
      const tgt = race.ships[s.targetIdx];
      const dist = Math.hypot(tgt.x - s.x, tgt.z - s.z);
      c.fire = this.hostile && !this.holdFire;
      if (this.hostile && s.missiles > reserve && dist < 250 && dist > 25 && rng.chance(dt * 0.22 * p.aggression)) c.missile = true;
    } else if (s.targetKind === 2) {
      c.fire = this.engage && !this.holdFire;
      if (this.engage && s.missiles > 0 && rng.chance(dt * (0.2 + 0.7 * p.capitalBias))) c.missile = true;
    }

    // ------------------------------------------------ ship ability
    if (s.abilityCd <= 0 && s.abilityT <= 0) {
      let useIt = false;
      switch (s.ability) {
        case 'burst': useIt = longStraight && s.fwdSpeed > st.topSpeed * 0.7 && !avoiding; break;
        case 'bulwark': useIt = (s.lastHitT < 0.4 && (s.shield < st.shield * 0.5 || s.hp < st.armour * 0.6)) || s.threatT > 0; break;
        case 'dash': useIt = s.threatT > 0 || (blocker !== null && straight) || (s.lastHitT < 0.3 && s.shield <= 0) || (straight && s.fwdSpeed > st.topSpeed * 0.8); break;
        case 'magnet': {
          let n = 0;
          for (const q of race.layout.pickups) if (q.active && q.kind !== 'missile' && Math.abs(q.x - s.x) < 60 && Math.abs(q.z - s.z) < 60) n++;
          useIt = n >= 2;
          break;
        }
      }
      if (useIt) {
        this.abilityDelay += dt;
        if (this.abilityDelay > 0.25 + (1 - this.skill) * 1.5) { c.ability = true; this.abilityDelay = 0; }
      } else this.abilityDelay = 0;
    }
    void ABILITIES;
  }
}
