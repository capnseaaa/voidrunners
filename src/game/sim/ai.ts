// AI racer driver. It only ever writes to the ship's Controls, exactly like the
// keyboard does for the player, so AI ships obey identical physics and rules.
//
// Each racer's personality shapes what it does, and it reacts to its race
// position, its health and the threats around it: who is shooting at it,
// whether a missile is closing, whether it is being overtaken.
import { type Personality } from '../data/ships';
import { clamp, Rng } from '../core/rng';
import { locateOn, progInRange, wrapDelta, type Sample, type TrackPos } from '../tracks/track';
import { T_COMP, T_DRONE, T_SHIP, type RaceSim } from './race';
import type { Ship } from './ship';

const BRAKE_A = 56;
const probe: TrackPos = { path: 0, idx: 0, f: 0, d: 0 };

/** What the racer is currently up to; surfaced to the HUD so rivals read as characters. */
export type Mood = 'racing' | 'hunting' | 'fleeing' | 'berserk' | 'scavenging' | 'ramming' | 'sieging';

export class AiController {
  readonly ship: Ship;
  readonly pers: Personality;
  readonly skill: number; // effective 0..1
  private readonly raceSkill: number;
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
  private flareDelay = 0; private flareTap = 0;
  private twitchT = 0; private twitch = 0; private panicBoost = 0;
  private t = 0;
  private lastTotal = -1e9; private noProgT = 0;
  // battle mode
  private goalT = 0; private goalKind = 0; private goalIdx = -1; private gx = 0; private gz = 0; private passT = 0;
  mood: Mood = 'racing';
  cruise = false; // post-finish cool-down driving

  constructor(ship: Ship, pers: Personality, raceSkill: number, seed: number) {
    this.ship = ship; this.pers = pers;
    this.skill = clamp(pers.skill * raceSkill, 0.3, 1);
    this.raceSkill = raceSkill;
    this.rng = new Rng(seed);
    this.lane = this.rng.range(-1, 1);
    ship.preferRacers = pers.aggression > 0.8;
    ship.aimError = 0.05 + (1 - pers.gunnery * (0.6 + 0.4 * raceSkill)) * 0.13;
  }

  update(dt: number, race: RaceSim): void {
    const s = this.ship, c = s.ctl;
    c.fire = false; c.missile = false; c.ability = false; c.reset = false; c.boost = false;
    if (!s.alive || race.phase === 'grid') { c.throttle = 0; c.brake = 0; c.steer = 0; return; }
    this.t += dt;
    this.think(dt, race);
    if (race.mode === 'battle') this.flyBattle(dt, race); else this.driveCircuit(dt, race);
  }

  // ------------------------------------------------------------ state of mind
  private hpFrac = 1;
  private hurt = false; // low on hull
  private chased = false; // taking fire from behind
  private think(dt: number, race: RaceSim): void {
    const s = this.ship, p = this.pers, rng = this.rng;
    this.hpFrac = s.hp / s.stats.armour;
    this.hurt = this.hpFrac < 0.42;
    this.chased = s.lockedT > 0 || (s.lastHitT < 1.2 && s.hitDirX * s.hx + s.hitDirZ * s.hz < 0);
    // how willing it is to shoot at other racers right now
    this.hostileT -= dt;
    if (this.hostileT <= 0) {
      this.hostileT = rng.range(3, 6);
      let chance = (0.07 + p.aggression * 0.42) * (0.45 + 0.55 * this.raceSkill);
      if (s.place >= 7) chance += 0.12 * p.aggression; // frustrated at the back
      this.hostile = rng.chance(chance);
    }
    let hostile = this.hostile;
    if (this.hurt) {
      if (p.caution > 0.5) hostile = false; // survival first
      else if (p.aggression > 0.8) hostile = true; // nothing left to lose
    }
    if (s.lastHitT < 2.5 && s.lastHitBy >= 0 && p.aggression > 0.35) hostile = true; // payback
    this.hostileNow = hostile && !this.cruise && !s.finished;
    // missile warning: tap boost to dump flares. Sharper pilots react sooner.
    if (s.missileLockT > 0 && s.missileDist < 150 && s.flareCd <= 0) {
      this.flareDelay += dt;
      if (this.flareDelay > 0.15 + (1 - this.skill) * 1.6 - p.caution * 0.2) { this.flareTap = 0.12; this.flareDelay = 0; }
    } else this.flareDelay = 0;
    // unstable pilots twitch and panic
    if (p.erratic > 0) {
      this.twitchT -= dt;
      if (this.twitchT <= 0) {
        this.twitchT = rng.range(1.2, 4.5) / (0.3 + p.erratic);
        this.twitch = rng.chance(0.4 * p.erratic) ? rng.range(-1, 1) * (0.5 + p.erratic) : 0;
        if (rng.chance(0.22 * p.erratic)) this.panicBoost = rng.range(0.5, 1.4);
      }
    }
    if (this.panicBoost > 0) this.panicBoost -= dt;
    if (this.flareTap > 0) this.flareTap -= dt;
    this.mood = this.hurt && p.caution > 0.5 ? 'fleeing' : this.hurt && p.aggression > 0.8 ? 'berserk' : 'racing';
    void race;
  }
  private hostileNow = false;

  /** Weapons, shared by both modes. */
  private shoot(dt: number, race: RaceSim, engageCapital: boolean): void {
    const s = this.ship, c = s.ctl, p = this.pers, rng = this.rng;
    if (s.heat > 86) this.holdFire = true; else if (s.heat < 32) this.holdFire = false;
    const cz = race.capital;
    const reserve = p.capitalBias > 0.5 && !cz.destroyed ? Math.ceil(s.stats.missiles * 0.5) : 0;
    if (s.targetKind === T_SHIP && s.targetIdx >= 0) {
      const tgt = race.ships[s.targetIdx];
      const dist = Math.hypot(tgt.x - s.x, tgt.z - s.z);
      // hunters fire at anyone; most racers only shoot back at whoever is on their tail
      const want = s.targetRear ? (this.chased || this.hostileNow) && p.caution < 0.9 : this.hostileNow;
      // short bursts with pauses, not a continuous stream
      c.fire = want && !this.holdFire && (this.t + s.index * 0.37) % 2.6 < 1.0 + p.aggression * 0.4;
      if (want && s.missiles > reserve && dist < 260 && dist > 25 && rng.chance(dt * (s.targetRear ? 0.3 : 0.14) * (0.3 + p.aggression))) c.missile = true;
      if (want && !s.targetRear && p.aggression > 0.6) this.mood = this.mood === 'berserk' ? 'berserk' : 'hunting';
    } else if (s.targetKind === T_DRONE) {
      c.fire = !this.holdFire && (p.caution < 0.8 || !this.hurt);
      if (s.missiles > reserve && rng.chance(dt * 0.12)) c.missile = true;
    } else if (s.targetKind === T_COMP) {
      c.fire = engageCapital && !this.holdFire;
      if (engageCapital && s.missiles > 0 && rng.chance(dt * (0.2 + 0.7 * p.capitalBias))) c.missile = true;
      if (engageCapital && p.capitalBias > 0.7) this.mood = 'sieging';
    }
    if (p.erratic > 0.5 && this.twitch !== 0 && !this.holdFire) c.fire = true; // spraying wildly
  }

  private useAbility(dt: number, race: RaceSim, straight: boolean, blocked: boolean): void {
    const s = this.ship, c = s.ctl, st = s.stats;
    if (s.abilityCd > 0 || s.abilityT > 0) return;
    let useIt = false;
    switch (s.ability) {
      case 'burst': useIt = straight && s.fwdSpeed > st.topSpeed * 0.7; break;
      case 'bulwark': useIt = (s.lastHitT < 0.4 && (s.shield < st.shield * 0.5 || s.hp < st.armour * 0.6)) || s.threatT > 0; break;
      case 'dash': useIt = s.threatT > 0 || (blocked && straight) || (s.lastHitT < 0.3 && s.shield <= 0) || (straight && s.fwdSpeed > st.topSpeed * 0.8); break;
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

  // ================================================================ circuits
  private driveCircuit(dt: number, race: RaceSim): void {
    const s = this.ship, c = s.ctl, p = this.pers, rng = this.rng;
    const track = race.track, st = s.stats;
    const main = track.main;
    const mn = main.samples.length;
    const cruise = this.cruise || s.finished;
    const behind = s.place >= 7, leading = s.place <= 2;

    // ------------------------------------------------ route decisions
    if (s.pathId === 0) {
      for (let b = 1; b < track.paths.length; b++) {
        const br = track.paths[b];
        let ahead = br.fromIdx - s.idx;
        if (ahead < -mn / 2) ahead += mn;
        if (ahead > 0 && ahead * main.step < 340 && this.decidedLap[b] !== s.lap) {
          this.decidedLap[b] = s.lap;
          let prob = br.kind === 'shortcut' ? 0.12 + 0.86 * p.shortcutBias : br.kind === 'risky' ? 0.08 + 0.88 * p.riskBias : 0.3;
          if (behind) prob += 0.2; // gamble to catch up
          if (this.hurt && p.caution > 0.5 && br.kind === 'risky') prob *= 0.2; // not in this state
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
    // daredevils carry more speed into corners; the cautious and the hurt leave margin
    const cornerK = st.turnRate * 0.74 * (0.8 + 0.25 * this.skill) * (0.94 + 0.12 * p.nerve) * (this.hurt && p.caution > 0.5 ? 0.93 : 1);
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
      // pressure makes the nervous worse
      const pressure = this.chased ? 1 + p.erratic * 1.5 : 1;
      if (rng.chance((p.mistakeRate / 60) * (1.5 - this.skill * 0.5) * pressure)) {
        this.mistakeT = rng.range(0.6, 1.5);
        this.mistakeKind = rng.int(0, 2);
      }
    }
    const blundering = this.mistakeT > 0;

    const pathLen = track.paths[s.pathId].length;
    const myS = (s.idx + s.f) * track.paths[s.pathId].step;
    const onMain = s.pathId === 0;
    const ahead = (os: number) => (onMain ? wrapDelta(os, myS, pathLen) : os - myS);
    const lookDist = (28 + v * 0.95) * (0.75 + 0.35 * this.skill);
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
        if (!st2.active || st2.path !== s.pathId) continue;
        const ds = ahead(st2.s);
        if (ds < -4 || ds > v * (st2.delay - st2.t) + 16) continue;
        consider(st2.d, st2.r + 3, ds);
      }
    }
    // other racers: pass them, line up on them, or shove them
    let blocker: Ship | null = null;
    let ramD = NaN;
    for (const o of race.ships) {
      if (o === s || !o.alive || o.pathId !== s.pathId) continue;
      const ds = ahead((o.idx + o.f) * track.paths[o.pathId].step);
      if (p.ram > 0.5 && !cruise && Math.abs(ds) < 7 && Math.abs(o.d - s.d) < 13 && o.stats.mass <= s.stats.mass && !this.hurt) ramD = o.d;
      if (ds < 1.5 || ds > 70) continue;
      const closing = s.fwdSpeed - o.fwdSpeed;
      if (this.hostileNow && p.aggression > 0.8 && !cruise && ds > 12) {
        if (Math.abs(o.d - s.d) < 14 && !avoiding) dT = o.d; // line up the guns
      } else if (closing > 1 && ds < 12 + closing * 0.9) {
        consider(o.d, 5.2, ds);
        if (ds < 26) blocker = o;
      }
    }
    const cz = race.capital;
    const inZone = !cz.destroyed && progInRange(s.prog, cz.zoneFrom, cz.zoneTo, track.length);
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
          if (score < bestScore) { bestScore = score; dT = q.d; if (p.salvageBias > 0.8) this.mood = 'scavenging'; }
        }
      }
      if (!Number.isNaN(ramD)) { dT = ramD; this.mood = 'ramming'; }
      // the cautious hug the far wall while the capital ship's guns are live; more so when hurt
      if (inZone && p.caution > 0.55 && cz.aliveCount('battery') > 0) {
        const side = track.def.capital.side; // hull sits on this side of the road
        dT += (-side * roomNow * 0.6 - dT) * (this.hurt ? 0.9 : 0.45 * p.caution);
      }
      // under fire from behind: weave if careful, otherwise hold the line
      if (this.chased && p.caution > 0.4) dT += Math.sin(this.t * (4 + p.caution * 3)) * roomNow * 0.5 * p.caution;
    }
    if (s.threatT > 0 && !avoiding) dT += Math.sin(this.t * 5) * 8; // jink when a missile is inbound
    if (blundering && this.mistakeKind === 1) dT = Math.sign(-kAvg || this.lane) * (s.hw - 2); // runs wide
    if (this.twitch !== 0 && !avoiding) dT += this.twitch * roomNow * 0.5;

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
    // trailing racers and those being chased spend boost sooner; leaders with a cushion save it
    let thresh = this.boostOn ? 1 : 30 + 45 * (1 - p.boostUse);
    if (!this.boostOn) { if (behind || this.chased) thresh *= 0.55; else if (leading && p.nerve < 0.6) thresh += 15; }
    const okLine = brake === 0 && Math.abs(ang) < 0.25;
    this.boostOn = (straight || (p.nerve > 0.85 && vAllow > v * 1.05)) && okLine && s.boost > thresh && !s.boostLock;
    c.boost = this.boostOn || this.flareTap > 0 || (this.panicBoost > 0 && !s.boostLock);

    // ------------------------------------------------ weapons
    if (inZone && !this.wasInZone) {
      // everyone takes at least one run at the capital ship; specialists engage on every pass
      this.engage = rng.chance(0.35 + 0.65 * p.capitalBias) || (s.lap >= race.laps - 1 && !this.engagedOnce);
      if (this.hurt && p.caution > 0.6 && p.capitalBias < 0.9) this.engage = false;
      if (this.engage) this.engagedOnce = true;
    }
    this.wasInZone = inZone;
    this.shoot(dt, race, this.engage);
    this.useAbility(dt, race, s.ability === 'burst' ? longStraight && !avoiding : straight, blocker !== null);
  }

  // ================================================================= battles
  private flyBattle(dt: number, race: RaceSim): void {
    const s = this.ship, c = s.ctl, p = this.pers, rng = this.rng;
    const R = race.track.arena;
    const cap = race.capital;
    const flee = this.hurt && p.caution > 0.5;
    // ---- choose what to go after
    this.goalT -= dt;
    const goalGone = (this.goalKind === T_DRONE && !race.drones.drones[this.goalIdx]?.active)
      || (this.goalKind === T_COMP && !cap.vulnerable(cap.components[this.goalIdx]))
      || (this.goalKind === 4 && !race.layout.pickups[this.goalIdx]?.active)
      || (this.goalKind === T_SHIP && !race.ships[this.goalIdx]?.alive);
    if (this.goalT <= 0 || goalGone) {
      this.goalT = rng.range(2, 4);
      let best = 0, bi = -1, bs = -1;
      const rate = (kind: number, idx: number, x: number, z: number, weight: number) => {
        const d = Math.hypot(x - s.x, z - s.z);
        const score = (weight * rng.range(0.8, 1.2)) / (140 + d);
        if (score > bs) { bs = score; best = kind; bi = idx; }
      };
      if (!flee) race.drones.drones.forEach((d, i) => { if (d.active) rate(T_DRONE, i, d.x, d.z, 0.7 + p.aggression * 0.6); });
      if (!cap.destroyed && !flee) cap.components.forEach((k, i) => { if (cap.vulnerable(k)) rate(T_COMP, i, k.x, k.z, 0.25 + p.capitalBias * 1.5); });
      race.layout.pickups.forEach((q, i) => { if (q.active && q.kind !== 'missile') rate(4, i, q.x, q.z, (0.12 + p.salvageBias * 1.6) * (flee ? 3 : 1)); });
      if (p.aggression > 0.8 && !flee) race.ships.forEach((o, i) => { if (o !== s && o.alive) rate(T_SHIP, i, o.x, o.z, 0.75); });
      this.goalKind = best; this.goalIdx = bi;
    }
    let gx = 0, gz = 0;
    switch (this.goalKind) {
      case T_DRONE: { const d = race.drones.drones[this.goalIdx]; gx = d.x + d.vx * 0.4; gz = d.z + d.vz * 0.4; this.mood = flee ? 'fleeing' : 'hunting'; break; }
      case T_COMP: { const k = cap.components[this.goalIdx]; gx = k.x; gz = k.z; this.mood = 'sieging'; break; }
      case 4: { const q = race.layout.pickups[this.goalIdx]; gx = q.x; gz = q.z; this.mood = flee ? 'fleeing' : 'scavenging'; break; }
      case T_SHIP: { const o = race.ships[this.goalIdx]; gx = o.x + o.vx * 0.3; gz = o.z + o.vz * 0.3; this.mood = 'hunting'; break; }
      default: gx = 0; gz = 0;
    }
    // strafing runs: fly through the target, carry on, then come around again
    const gd = Math.hypot(gx - s.x, gz - s.z);
    if (this.goalKind === T_COMP && gd < 70 && this.passT <= 0) this.passT = rng.range(1.6, 2.6);
    if (this.passT > 0) { this.passT -= dt; gx = s.x + s.hx * 200; gz = s.z + s.hz * 200; }
    this.gx = gx; this.gz = gz;
    // keep inside the battle zone
    const r = Math.hypot(s.x, s.z);
    if (r > R - 170) { const k = clamp((r - (R - 170)) / 120, 0, 1); gx += (0 - gx) * k; gz += (0 - gz) * k; }
    let tx = gx - s.x, tz = gz - s.z;
    // dodge rocks, wreckage and incoming blasts dead ahead
    const hx = s.hx, hz = s.hz;
    const dodge = (ox: number, oz: number, rad: number, reach: number) => {
      const dx = ox - s.x, dz = oz - s.z;
      const along = dx * hx + dz * hz;
      if (along < 0 || along > reach) return;
      const lat = -dx * hz + dz * hx; // +right
      if (Math.abs(lat) > rad + 5) return;
      const push = (lat >= 0 ? -1 : 1) * (reach - along) * 2.2;
      tx += -hz * push; tz += hx * push;
    };
    for (const o of race.layout.obstacles) if (o.alive) dodge(o.x, o.z, o.r, 70);
    for (const st of cap.strikes) if (st.active) dodge(st.x, st.z, st.r, 60);
    if (this.chased && p.caution > 0.4) { const w = Math.sin(this.t * 5) * 60 * p.caution; tx += -hz * w; tz += hx * w; }
    if (this.twitch !== 0) { tx += -hz * this.twitch * 50; tz += hx * this.twitch * 50; }
    const ang = Math.atan2(hx * tz - hz * tx, hx * tx + hz * tz);
    c.steer = clamp(ang * 2.2, -1, 1);
    c.throttle = 1; c.brake = 0;
    if (Math.abs(ang) > 1.3 && s.fwdSpeed > s.stats.topSpeed * 0.6) { c.throttle = 0.3; c.brake = 0.4; }
    c.boost = (Math.abs(ang) < 0.3 && (gd > 320 || flee || this.chased) && s.boost > (this.boostOn ? 2 : 45) && !s.boostLock) || this.flareTap > 0 || (this.panicBoost > 0 && !s.boostLock);
    this.boostOn = c.boost;
    this.shoot(dt, race, !flee);
    this.useAbility(dt, race, Math.abs(ang) < 0.2 && gd > 250, false);
  }
}
