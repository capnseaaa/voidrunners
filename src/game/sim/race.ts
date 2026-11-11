// Race simulation: owns every gameplay system and advances them with a
// delta-time step. It has no rendering, audio or DOM dependencies, so the
// same code runs in the browser and in headless tests.
//
// Two modes share everything here: circuit races (track progress decides the
// order) and open-space battles (free flight, score decides the order).
import { Vector3 } from 'three';
import type { RaceDef, RaceMode } from '../data/campaign';
import { AI_RACERS, computeStats, uniformLevels, type ShipDef, type UpgradeLevels } from '../data/ships';
import { Rng } from '../core/rng';
import { getTrack } from '../tracks';
import { newFrame, pointAt, type Track } from '../tracks/track';
import { AiController } from './ai';
import { Capital } from './capital';
import { DRONE_RADIUS, DroneWing } from './drones';
import { EventQueue } from './events';
import { buildArenaLayout, buildLayout, makePickup, type Layout, type Obstacle, type Pickup, type PickupKind } from './layout';
import { HOVER, SHIP_RADIUS, Ship } from './ship';
import { BOLT, CAP_BOLT, MISSILE, ProjectilePool, segSphere, type Projectile } from './weapons';

export interface RaceConfig {
  race: RaceDef;
  playerShip: ShipDef;
  playerUpgrades: UpgradeLevels;
  autopilot?: boolean; // AI drives the player's ship (tests / attract mode)
}

export type Phase = 'grid' | 'racing' | 'done';

export const COUNTDOWN_TIME = 3.6;
const BOLT_SPEED = 430;
/** Blaster damage against small craft, relative to the nominal (anti-armour) figure. */
const SHIP_BOLT_SCALE = 0.7;
const MISSILE_SHIP_DAMAGE = 46;
const TARGET_RANGE_SHIP = 380;
const TARGET_RANGE_REAR = 230;
export const TARGET_RANGE_CAP = 520;
/** targetKind values */
export const T_NONE = 0, T_SHIP = 1, T_COMP = 2, T_DRONE = 3;
const tmp = new Vector3();
const fr = newFrame();

export class RaceSim {
  readonly cfg: RaceConfig;
  readonly race: RaceDef;
  readonly mode: RaceMode;
  readonly track: Track;
  readonly ships: Ship[] = [];
  readonly ai: (AiController | null)[] = [];
  readonly projectiles = new ProjectilePool(460);
  readonly capital: Capital;
  readonly drones: DroneWing;
  readonly layout: Layout;
  readonly events = new EventQueue();
  readonly order: number[] = [];
  readonly laps: number;
  readonly player: Ship;
  phase: Phase = 'grid';
  countdown = COUNTDOWN_TIME;
  time = 0;
  finishCount = 0;
  graceT = 0;
  playerFinishedAt = -1;
  /** Escalation of the surrounding battle: 0, 1, 2. Surface races break the ship up as it rises. */
  warPhase = 0;
  over = false; // battle: time has run out
  private readonly rng: Rng;
  private tick = 0;
  private bombardT = 6;

  constructor(cfg: RaceConfig) {
    this.cfg = cfg;
    this.race = cfg.race;
    this.mode = cfg.race.mode;
    this.laps = cfg.race.laps;
    this.track = getTrack(cfg.race.track);
    this.rng = new Rng(cfg.race.seed + 5);
    this.layout = this.mode === 'battle' ? buildArenaLayout(this.track, cfg.race) : buildLayout(this.track, cfg.race);

    const player = new Ship(0, 'YOU', cfg.playerShip, computeStats(cfg.playerShip, cfg.playerUpgrades));
    player.isPlayer = true;
    this.player = player;
    this.ships.push(player);
    const aiLevels = uniformLevels(cfg.race.aiLevel);
    AI_RACERS.forEach((r, i) => {
      this.ships.push(new Ship(i + 1, r.name, r.ship, computeStats(r.ship, aiLevels)));
    });
    this.capital = new Capital(this.track, cfg.race, this.ships.length);
    this.drones = new DroneWing(cfg.race);

    // controllers: the player's AI only drives in autopilot mode or after the finish
    const veteran = AI_RACERS.find((r) => r.id === 'veteran')!.personality;
    this.ai.push(new AiController(player, { ...veteran, mistakeRate: 0.2, capitalBias: 0.8 }, 1, cfg.race.seed + 99));
    AI_RACERS.forEach((r, i) => this.ai.push(new AiController(this.ships[i + 1], r.personality, cfg.race.aiSkill, cfg.race.seed + 13 * (i + 1))));
    if (!cfg.autopilot) player.aimError = 0; // the human's aim assist is exact; AI pilots are imperfect shots

    // starting grid: AI in shuffled order, the player starts from the back row
    const aiOrder = this.ships.slice(1).map((s) => s.index);
    for (let i = aiOrder.length - 1; i > 0; i--) { const j = this.rng.int(0, i); [aiOrder[i], aiOrder[j]] = [aiOrder[j], aiOrder[i]]; }
    const grid = [...aiOrder, 0];
    const L = this.track.length;
    grid.forEach((shipIdx, slot) => {
      const ship = this.ships[shipIdx];
      const row = Math.floor(slot / 2), col = slot % 2;
      if (this.mode === 'battle') {
        // launch line at the southern edge of the battle zone, noses toward the fight
        ship.x = (slot - 4.5) * 16; ship.z = -this.track.arena * 0.82 - row * 3; ship.y = HOVER;
        ship.yaw = 0; ship.pathId = 0; ship.idx = 0;
      } else {
        ship.placeOnTrack(this.track, 0, L - 16 - row * 14 - col * 7, col ? 7.5 : -7.5);
        ship.total = ship.prog - L;
      }
    });
    for (let i = 0; i < this.ships.length; i++) this.order.push(i);
    this.updateStandings();
  }

  /** Seconds left in a battle event. */
  get timeLeft(): number { return Math.max(0, this.race.timeLimit - this.time); }

  // ------------------------------------------------------------------ step
  step(dt: number): void {
    if (!(dt > 0)) return;
    this.tick++;
    if (this.phase === 'grid') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (this.countdown <= 0) { this.phase = 'racing'; this.events.push('go'); }
      else if (after !== before && after <= 3) this.events.push('countdown', -1, 0, 0, 0, after);
    }
    const racing = this.phase !== 'grid';
    if (this.phase === 'racing') this.time += dt;

    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i];
      if (i > 0 || this.cfg.autopilot || s.finished) this.ai[i]!.update(dt, this);
    }

    const L = this.track.length;
    const battle = this.mode === 'battle';
    for (let i = 0; i < this.ships.length; i++) {
      const s = this.ships[i];
      if (s.dead > 0) {
        s.dead -= dt;
        if (s.dead <= 0) this.respawn(s);
        continue;
      }
      s.integrate(dt, this.track, this.events, racing);
      if (s.wallDamage > 0) { this.damageShip(s, s.wallDamage, -1, s.x, s.z); s.wallDamage = 0; if (!s.alive) continue; }
      if (!racing) continue;
      if (s.ctl.reset && !s.finished) { this.destroyShip(s, -1, true); continue; }
      if (!battle) { this.updateProgress(s, L); this.checkPads(s); }
      this.checkObstacles(s, dt);
      if (!s.alive) continue;
      const dot = s.hx * s.trackHx + s.hz * s.trackHz;
      s.wrongWayT = dot < -0.35 && s.speed > 6 ? s.wrongWayT + dt : 0;
      if ((this.tick + i) % 5 === 0) this.selectTarget(s);
      this.fireWeapons(s);
    }
    this.shipCollisions();
    this.updateObstacles(dt);
    this.drones.update(dt, this);
    this.updateProjectiles(dt);
    this.capital.update(dt, this);
    this.updatePickups(dt);
    this.updateWar(dt);
    this.updateStandings();
    this.checkEnd(dt);
  }

  // -------------------------------------------------------------- progress
  private updateProgress(s: Ship, L: number): void {
    if (s.finished) return;
    const K = this.track.checkpoints.length;
    const cpLen = L / K;
    while (s.total >= s.cpCount * cpLen) {
      const passed = s.cpCount;
      s.cpCount++;
      if (passed % K === 0) {
        const lapsDone = passed / K;
        if (lapsDone > 0) {
          s.lastLap = this.time - s.lapStart;
          if (s.bestLap === 0 || s.lastLap < s.bestLap) s.bestLap = s.lastLap;
          s.lapStart = this.time;
          s.lap = lapsDone;
          s.missiles = Math.min(s.stats.missiles, s.missiles + 2);
          this.events.push('lap', s.index, s.x, s.y, s.z, lapsDone);
          if (lapsDone >= this.laps) { this.finishShip(s, false); return; }
        }
      } else {
        this.events.push('checkpoint', s.index, s.x, s.y, s.z, passed % K);
      }
    }
  }

  private finishShip(s: Ship, dnf: boolean): void {
    s.finished = true; s.dnf = dnf;
    s.finishTime = this.time;
    s.finishPos = ++this.finishCount;
    s.invuln = 1e9;
    if (s.isPlayer) this.playerFinishedAt = this.time;
    this.events.push('finish', s.index, s.x, s.y, s.z, s.finishPos);
  }

  private updateStandings(): void {
    const ships = this.ships;
    const battle = this.mode === 'battle';
    this.order.sort((a, b) => {
      const A = ships[a], B = ships[b];
      if (A.finished || B.finished) {
        if (A.finished && B.finished) return A.finishPos - B.finishPos;
        return A.finished ? -1 : 1;
      }
      if (battle) return B.score - A.score || a - b;
      if (A.cpCount !== B.cpCount) return B.cpCount - A.cpCount;
      return B.total - A.total;
    });
    for (let i = 0; i < this.order.length; i++) ships[this.order[i]].place = i + 1;
  }

  private checkEnd(dt: number): void {
    if (this.phase !== 'racing') return;
    if (this.mode === 'battle') {
      if (!this.over && this.time >= this.race.timeLimit) {
        this.over = true;
        this.events.push('timeUp');
        for (const idx of [...this.order]) this.finishShip(this.ships[idx], false);
        this.phase = 'done';
        this.updateStandings();
      }
      return;
    }
    let aiLeft = 0;
    for (let i = 1; i < this.ships.length; i++) if (!this.ships[i].finished) aiLeft++;
    const p = this.player;
    if (!p.finished && aiLeft === 0) {
      this.graceT += dt;
      if (this.graceT > 45) this.finishShip(p, true);
    }
    // safety net: never leave the race hanging if a straggler cannot finish
    if (p.finished && aiLeft > 0 && this.time - this.playerFinishedAt > 150) {
      for (const idx of [...this.order]) { const s = this.ships[idx]; if (!s.finished) this.finishShip(s, true); }
    }
    if (this.ships.every((s) => s.finished)) { this.phase = 'done'; this.updateStandings(); }
  }

  // ------------------------------------------------------- the wider war
  private updateWar(dt: number): void {
    if (this.phase !== 'racing') return;
    // surface races: the ship under the racers dies lap by lap
    if (this.race.dying) {
      let lead = 0;
      for (const s of this.ships) if (s.lap > lead) lead = s.lap;
      const want = Math.min(2, lead);
      if (want > this.warPhase) {
        this.warPhase = want;
        for (const o of this.layout.obstacles) {
          if (o.dormant && !o.slot && o.phase === want) {
            o.dormant = false; o.alive = true; o.hp = o.maxHp;
            this.events.push('explosion', -1, o.x, o.y + 2, o.z, 9, -1, 0xff8030, 'debris');
          }
        }
        this.events.push('phase', -1, 0, 0, 0, want);
      }
    }
    // stray capital-scale fire from the fleet battle lands on the route
    if (this.race.bombard > 0 && !this.over) {
      this.bombardT -= dt;
      if (this.bombardT <= 0) {
        this.bombardT = (60 / (this.race.bombard * (1 + this.warPhase * 0.7))) * this.rng.range(0.6, 1.4);
        let pick: Ship | null = null, n = 0;
        for (const s of this.ships) if (s.alive && !s.finished) { n++; if (this.rng.next() < 1 / n) pick = s; }
        if (pick) this.capital.strikeAt(pick, this, 1.5, 11);
      }
    }
  }

  /** A capital ship system was shot off: wreckage lands on the route below it for a while. */
  dropDebris(trackS: number, fromX: number, fromY: number, fromZ: number): void {
    if (this.mode === 'battle') return;
    let placed = 0;
    const slots = this.layout.obstacles.filter((o) => o.slot && o.dormant).sort((a, b) => Math.abs(a.baseS - trackS) - Math.abs(b.baseS - trackS));
    for (const o of slots) {
      if (placed >= 2) break;
      // never drop wreckage on top of a racer
      if (this.ships.some((s) => s.alive && Math.hypot(s.x - o.x, s.z - o.z) < 26)) continue;
      o.dormant = false; o.alive = true; o.hp = o.maxHp; o.ttl = 26;
      this.events.push('explosion', -1, o.x, o.y + 2, o.z, 7, -1, 0xff8030, 'debris');
      placed++;
    }
    void fromX; void fromY; void fromZ;
  }

  // ---------------------------------------------------------------- damage
  /** Apply damage to a ship. attacker: ship index, or -1 for environment / capital ship / fighters. Returns damage dealt. */
  damageShip(s: Ship, amount: number, attacker: number, fromX: number, fromZ: number): number {
    if (!s.alive || s.invuln > 0 || s.phased || s.finished || amount <= 0) return 0;
    if (s.bulwark) amount *= 0.12;
    let applied = 0;
    if (s.shield > 0) {
      const a = Math.min(s.shield, amount);
      s.shield -= a; amount -= a; applied += a;
      this.events.push('shieldHit', s.index, s.x, s.y, s.z, a, attacker);
    }
    if (amount > 0) {
      const a = Math.min(s.hp, amount);
      s.hp -= a; applied += a;
      this.events.push('hit', s.index, s.x, s.y, s.z, a, attacker);
    }
    s.shieldDelayT = s.stats.shieldDelay;
    s.hitFlash = 0.45;
    s.hitDirX = fromX - s.x; s.hitDirZ = fromZ - s.z;
    s.lastHitT = 0; s.lastHitBy = attacker;
    if (attacker >= 0 && attacker !== s.index) { const a = this.ships[attacker]; a.racerDamage += applied; a.score += applied * 0.3; }
    if (s.hp <= 0) this.destroyShip(s, attacker, false);
    return applied;
  }

  private destroyShip(s: Ship, attacker: number, manualReset: boolean): void {
    s.dead = manualReset ? 1.3 : 2.4;
    s.deaths += manualReset ? 0 : 1;
    s.hp = 0;
    s.vx = 0; s.vz = 0; s.fwdSpeed = 0; s.boosting = false; s.abilityT = 0; s.padT = 0;
    this.events.push('shipDestroyed', s.index, s.x, s.y, s.z, manualReset ? 0 : 1, attacker, s.def.colors.primary);
    if (manualReset) return;
    s.score = Math.max(0, s.score - 60);
    if (attacker >= 0 && attacker !== s.index) {
      // bounty: a kill is worth something right now, not just on the results screen
      const k = this.ships[attacker];
      k.racerKills++; k.score += 150;
      k.boost = Math.min(100, k.boost + 40); k.boostLock = false;
      k.missiles = Math.min(k.stats.missiles + 2, k.missiles + 1);
      this.events.push('bounty', k.index, k.x, k.y, k.z, 200, s.index);
    }
    // a wreck spills a little salvage for whoever is following
    for (let k = 0; k < 3; k++) {
      if (this.mode === 'battle') {
        this.spawnPickup('scrap', 1, 0, 0, 0, s.x + (k - 1) * 7, 1.7, s.z + (k % 2) * 6, s.x, s.y, s.z, 22);
        continue;
      }
      const sAt = (s.idx + s.f) * this.track.paths[s.pathId].step + 14 + k * 9;
      const d = Math.max(-(s.hw - 4), Math.min(s.hw - 4, s.d + (k - 1) * 5));
      pointAt(this.track.paths[s.pathId], sAt, d, tmp, fr);
      this.spawnPickup('scrap', 1, s.pathId, sAt, d, tmp.x, tmp.y + 1.6, tmp.z, s.x, s.y, s.z, 22);
    }
  }

  private respawn(s: Ship): void {
    if (this.mode === 'battle') {
      // re-enter from the edge of the battle zone, pointed at the middle
      const a = this.rng.range(0, 6.283), r = this.track.arena * 0.86;
      s.x = Math.cos(a) * r; s.z = Math.sin(a) * r; s.y = HOVER;
      s.yaw = Math.atan2(-s.x, -s.z);
      s.vx = Math.sin(s.yaw) * 50; s.vz = Math.cos(s.yaw) * 50;
    } else {
      const path = this.track.paths[s.pathId];
      const total = s.total;
      s.placeOnTrack(this.track, s.pathId, (s.idx + s.f) * path.step, 0);
      s.total = total;
    }
    s.dead = 0;
    s.hp = s.stats.armour; s.shield = s.stats.shield * 0.5; s.shieldDelayT = 0;
    s.invuln = 2.5; s.heat = 0; s.overheated = false;
    s.boost = Math.max(s.boost, 40); s.boostLock = false;
    s.stuckT = 0; s.wrongWayT = 0; s.missileLockT = 0; s.lockedT = 0;
    this.events.push('respawn', s.index, s.x, s.y, s.z);
  }

  addSalvage(s: Ship, value: number): void {
    s.salvage += value * s.stats.salvageMult;
    s.score += value * 10;
  }

  // ------------------------------------------------------------- pickups
  spawnPickup(kind: PickupKind, value: number, path: number, sAt: number, d: number, hx: number, hy: number, hz: number, fromX: number, fromY: number, fromZ: number, ttl: number): void {
    const list = this.layout.pickups;
    let p: Pickup | undefined;
    for (let i = 0; i < list.length; i++) if (list[i].dynamic && !list[i].active && list[i].respawnT <= 0) { p = list[i]; break; }
    const len = this.track.paths[path].length;
    const sW = path === 0 ? ((sAt % len) + len) % len : sAt;
    if (!p) { p = makePickup(kind, value, path, sW, d, hx, hy, hz, true, ttl); list.push(p); }
    p.kind = kind; p.value = value; p.path = path; p.s = sW; p.d = d;
    p.hx = hx; p.hy = hy; p.hz = hz; p.x = fromX; p.y = fromY; p.z = fromZ;
    p.active = true; p.dynamic = true; p.ttl = ttl; p.respawnT = 0;
  }

  private updatePickups(dt: number): void {
    const list = this.layout.pickups;
    const ships = this.ships;
    const racing = this.phase === 'racing';
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.active) {
        if (!p.dynamic && p.respawnT > 0) { p.respawnT -= dt; if (p.respawnT <= 0) { p.active = true; p.x = p.hx; p.y = p.hy; p.z = p.hz; } }
        continue;
      }
      if (p.dynamic) {
        p.ttl -= dt;
        if (p.ttl <= 0) { p.active = false; continue; }
      }
      // drift back to the home position (drops fall onto the track, magnet releases snap back)
      const k = Math.min(1, dt * 2.2);
      p.x += (p.hx - p.x) * k; p.y += (p.hy - p.y) * k; p.z += (p.hz - p.z) * k;
      if (!racing) continue;
      for (let j = 0; j < ships.length; j++) {
        const s = ships[j];
        if (!s.alive || s.finished) continue;
        const dx = s.x - p.x, dz = s.z - p.z;
        if (dx > 62 || dx < -62 || dz > 62 || dz < -62) continue;
        const dy = s.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const reach = s.stats.salvageMult > 1.2 ? 6 : 4.4;
        if (dist < reach) { this.collect(s, p); break; }
        if (s.magnet && dist < 60 && p.kind !== 'missile') {
          const pull = Math.min(dist, 150 * dt);
          p.x += (dx / dist) * pull; p.y += (dy / dist) * pull; p.z += (dz / dist) * pull;
        }
      }
    }
  }

  private collect(s: Ship, p: Pickup): void {
    p.active = false;
    if (!p.dynamic) p.respawnT = 13;
    switch (p.kind) {
      case 'scrap': case 'core': case 'cargo': this.addSalvage(s, p.value); break;
      case 'overdrive': s.overdriveT = 8; s.boost = 100; s.boostLock = false; this.events.push('overdrive', s.index, s.x, s.y, s.z); break;
      case 'missile': s.missiles = Math.min(s.stats.missiles + 2, s.missiles + p.value); break;
    }
    this.events.push('pickup', s.index, p.x, p.y, p.z, p.value, -1, 0xffffff, p.kind);
  }

  private checkPads(s: Ship): void {
    if (s.padT > 0.9) return;
    const pads = this.layout.pads;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      const dx = s.x - p.x, dz = s.z - p.z;
      if (dx * dx + dz * dz < (p.r + 1.5) * (p.r + 1.5) && Math.abs(s.y - p.y) < 6) {
        s.padT = 1.5;
        s.boost = Math.min(100, s.boost + 14); s.boostLock = false;
        this.events.push('boostPad', s.index, s.x, s.y, s.z);
        return;
      }
    }
  }

  // ----------------------------------------------------------- obstacles
  private checkObstacles(s: Ship, dt: number): void {
    const obs = this.layout.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (!o.alive) continue;
      const dx = s.x - o.x, dz = s.z - o.z;
      if (dx > 14 || dx < -14 || dz > 14 || dz < -14 || Math.abs(s.y - o.y) > 8) continue;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (o.kind === 'vent') {
        if (o.active && dist < o.r) this.damageShip(s, 38 * dt, -1, o.x, o.z);
        continue;
      }
      if (s.phased) continue;
      if (o.kind === 'mine') {
        if (dist < o.r + SHIP_RADIUS + 2.4) {
          this.destroyObstacle(o);
          this.damageShip(s, 28, -1, o.x, o.z);
          s.vx *= 0.7; s.vz *= 0.7;
          if (!s.alive) return;
        }
        continue;
      }
      const rr = o.r + SHIP_RADIUS;
      if (dist < rr && dist > 0.001) {
        const nx = dx / dist, nz = dz / dist;
        s.x = o.x + nx * rr; s.z = o.z + nz * rr;
        const vn = s.vx * nx + s.vz * nz;
        if (vn < 0) {
          s.vx -= nx * vn * 1.35; s.vz -= nz * vn * 1.35;
          s.vx *= 0.82; s.vz *= 0.82;
          this.events.push('wallHit', s.index, o.x + nx * o.r, s.y, o.z + nz * o.r, -vn, -2);
          if (-vn > 24) this.damageShip(s, (-vn - 24) * 0.28, -1, o.x, o.z);
          if (o.maxHp > 0) { o.hp -= -vn * 0.9; if (o.hp <= 0) this.destroyObstacle(o); }
          if (!s.alive) return;
        }
      }
    }
  }

  private destroyObstacle(o: Obstacle): void {
    o.alive = false; o.respawnT = o.respawnDelay;
    if (o.slot) { o.dormant = true; o.ttl = 0; }
    this.events.push('obstacleDestroyed', -1, o.x, o.y + 1.5, o.z, o.r, o.id, 0xffffff, o.kind);
  }

  private updateObstacles(dt: number): void {
    const obs = this.layout.obstacles;
    const L = this.track.length;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (!o.alive) {
        if (o.dormant) continue;
        o.respawnT -= dt;
        if (o.respawnT <= 0) { o.alive = true; o.hp = o.maxHp; }
        continue;
      }
      if (o.ttl > 0) {
        o.ttl -= dt;
        if (o.ttl <= 0) { o.alive = false; o.dormant = true; continue; }
      }
      if (o.kind === 'vent') {
        o.timer += dt;
        o.active = o.timer % o.period > o.period - 1.3;
        continue;
      }
      if (o.speed !== 0 || o.amp !== 0) {
        if (o.speed !== 0) o.s = (o.s + o.speed * dt) % L;
        if (o.amp !== 0) o.d = o.baseD + o.amp * Math.sin(this.time * o.freq * 6.283 + o.phaseOff);
        pointAt(this.track.paths[o.path], o.s, o.d, tmp, fr);
        if (o.kind === 'traffic') { const lim = fr.hw - o.r - 1; o.d = Math.max(-lim, Math.min(lim, o.baseD)); }
        o.x = tmp.x; o.y = tmp.y; o.z = tmp.z;
      }
    }
  }

  // --------------------------------------------------------------- combat
  /**
   * Auto-aim target selection shared by the player and the AI.
   * Priority: a hostile small craft squarely in front of the nose, then an exposed
   * capital ship system, then any hostile in the wider forward cone, then one on the tail
   * (engaged by the rear gun and rear-launched missiles).
   */
  selectTarget(s: Ship): void {
    const hx = s.hx, hz = s.hz;
    let comp = -1, compScore = 1e9;
    const cap = this.capital;
    if (!cap.destroyed) {
      for (let i = 0; i < cap.components.length; i++) {
        const c = cap.components[i];
        if (!cap.vulnerable(c)) continue;
        const dx = c.x - s.x, dz = c.z - s.z, dy = c.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > TARGET_RANGE_CAP) continue;
        const dot = (dx * hx + dz * hz) / (Math.hypot(dx, dz) || 1);
        if (dot < -0.25) continue;
        const score = dist * (1.35 - dot);
        if (score < compScore) { compScore = score; comp = i; }
      }
    }
    // small craft: racers and enemy fighters
    let fKind = T_NONE, fIdx = -1, fScore = 1e9, fNarrow = false;
    let rKind = T_NONE, rIdx = -1, rScore = 1e9;
    const consider = (kind: number, idx: number, ox: number, oy: number, oz: number, bias: number) => {
      const dx = ox - s.x, dz = oz - s.z;
      if (dx > TARGET_RANGE_SHIP || dx < -TARGET_RANGE_SHIP || dz > TARGET_RANGE_SHIP || dz < -TARGET_RANGE_SHIP) return;
      if (Math.abs(oy - s.y) > 30) return;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > TARGET_RANGE_SHIP || dist < 1) return;
      const dot = (dx * hx + dz * hz) / dist;
      if (dot > 0.9) {
        const score = dist * (1 + (1 - dot) * 22) * bias;
        if (score < fScore) { fScore = score; fKind = kind; fIdx = idx; fNarrow = dot > 0.985 && dist < 290; }
      } else if (dot < -0.8 && dist < TARGET_RANGE_REAR) {
        const score = dist * bias;
        if (score < rScore) { rScore = score; rKind = kind; rIdx = idx; }
      }
    };
    for (let i = 0; i < this.ships.length; i++) {
      const o = this.ships[i];
      if (o === s || !o.alive || o.finished || o.phased) continue;
      consider(T_SHIP, i, o.x, o.y, o.z, 1);
    }
    const dr = this.drones.drones;
    for (let i = 0; i < dr.length; i++) if (dr[i].active) consider(T_DRONE, i, dr[i].x, dr[i].y, dr[i].z, 0.8);

    s.targetRear = false;
    if (fIdx >= 0 && (fNarrow || s.preferRacers || comp < 0)) { s.targetKind = fKind; s.targetIdx = fIdx; }
    else if (comp >= 0) { s.targetKind = T_COMP; s.targetIdx = comp; }
    else if (fIdx >= 0) { s.targetKind = fKind; s.targetIdx = fIdx; }
    else if (rIdx >= 0) { s.targetKind = rKind; s.targetIdx = rIdx; s.targetRear = true; }
    else { s.targetKind = T_NONE; s.targetIdx = -1; }
  }

  targetValid(s: Ship): boolean {
    if (s.targetKind === T_SHIP) { const o = this.ships[s.targetIdx]; return !!o && o.alive && !o.phased && !o.finished; }
    if (s.targetKind === T_COMP) { const c = this.capital.components[s.targetIdx]; return !!c && this.capital.vulnerable(c); }
    if (s.targetKind === T_DRONE) { const d = this.drones.drones[s.targetIdx]; return !!d && d.active; }
    return false;
  }

  private fireWeapons(s: Ship): void {
    if (s.finished || this.phase !== 'racing') return;
    const c = s.ctl;
    const hx = s.hx, hz = s.hz;
    const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    const valid = this.targetValid(s);
    const rear = valid && s.targetRear;
    if (valid && s.targetKind === T_SHIP && (c.fire || c.missile)) { const o = this.ships[s.targetIdx]; o.lockedT = 0.7; o.lockedBy = s.index; }
    if (c.fire && s.fireCd <= 0 && !s.overheated) {
      s.fireCd = (rear ? 1.5 : 1) / s.stats.fireRate; // the rear turret cycles slower than the main guns
      s.sinceFire = 0;
      s.heat += 100 / (s.stats.fireRate * 6);
      if (s.heat >= 100) { s.heat = 100; s.overheated = true; this.events.push('overheat', s.index, s.x, s.y, s.z); }
      s.gunSide = -s.gunSide;
      const fwd = rear ? -1.8 : 2.2;
      const gx = s.x + hx * fwd + -hz * 1.1 * s.gunSide * (rear ? 0.3 : 1), gy = s.y + (rear ? 0.6 : 0), gz = s.z + hz * fwd + hx * 1.1 * s.gunSide * (rear ? 0.3 : 1);
      const speed = BOLT_SPEED + Math.max(0, s.fwdSpeed) * (rear ? 0 : 0.6);
      let dx = hx * cp, dy = sp, dz = hz * cp;
      if (valid) {
        let tx: number, ty: number, tz: number;
        if (s.targetKind === T_COMP) { const k = this.capital.components[s.targetIdx]; tx = k.x; ty = k.y; tz = k.z; }
        else {
          let ox: number, oy: number, oz: number, ovx: number, ovz: number;
          if (s.targetKind === T_SHIP) { const o = this.ships[s.targetIdx]; ox = o.x; oy = o.y; oz = o.z; ovx = o.vx; ovz = o.vz; }
          else { const o = this.drones.drones[s.targetIdx]; ox = o.x; oy = o.y; oz = o.z; ovx = o.vx; ovz = o.vz; }
          const dist = Math.hypot(ox - gx, oz - gz);
          const lead = dist / speed;
          tx = ox + ovx * lead; ty = oy; tz = oz + ovz * lead;
          if (s.aimError > 0) { tx += this.rng.range(-1, 1) * s.aimError * dist; tz += this.rng.range(-1, 1) * s.aimError * dist; }
        }
        const l = Math.hypot(tx - gx, ty - gy, tz - gz) || 1;
        dx = (tx - gx) / l; dy = (ty - gy) / l; dz = (tz - gz) / l;
      }
      const p = this.projectiles.spawn();
      p.kind = BOLT; p.owner = s.index;
      p.x = p.px = gx; p.y = p.py = gy; p.z = p.pz = gz;
      p.vx = dx * speed; p.vy = dy * speed; p.vz = dz * speed; p.speed = speed;
      p.life = 1.3; p.damage = s.stats.weaponDamage; p.tKind = 0; p.tIdx = -1; p.color = s.def.colors.glow;
      this.events.push('shoot', s.index, gx, gy, gz, rear ? 1 : 0);
    }
    if (c.missile && s.missiles > 0 && s.missileCd <= 0) {
      s.missiles--; s.missileCd = 0.9;
      const dir = rear ? -1 : 1; // rear launch: drops off the tail rail and turns onto the pursuer
      const speed = rear ? 150 : Math.max(170, s.fwdSpeed + 70);
      const p = this.projectiles.spawn();
      p.kind = MISSILE; p.owner = s.index;
      p.x = p.px = s.x + hx * 3 * dir; p.y = p.py = s.y - 0.3; p.z = p.pz = s.z + hz * 3 * dir;
      p.vx = hx * cp * speed * dir; p.vy = sp * speed * dir; p.vz = hz * cp * speed * dir; p.speed = speed;
      p.maxSpeed = 340; p.turn = rear ? 5 : 3.4;
      p.life = 5; p.damage = MISSILE_SHIP_DAMAGE;
      if (valid) { p.tKind = s.targetKind; p.tIdx = s.targetIdx; } else { p.tKind = 0; p.tIdx = -1; }
      p.color = s.def.colors.glow;
      this.events.push('missile', s.index, p.x, p.y, p.z, rear ? 1 : 0);
    }
  }

  private updateProjectiles(dt: number): void {
    const items = this.projectiles.items;
    const ships = this.ships, cap = this.capital, obs = this.layout.obstacles, drones = this.drones.drones;
    const capR = cap.length / 2 + 120;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.kind === MISSILE) this.explodeMissile(p, null, -1, -1);
        p.active = false;
        continue;
      }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      if (p.kind === MISSILE) {
        p.speed = Math.min(p.maxSpeed, p.speed + 170 * dt);
        let tx = 0, ty = 0, tz = 0, has = false;
        if (p.tKind === T_SHIP) {
          const o = ships[p.tIdx];
          if (o.alive && !o.phased && !o.finished) {
            tx = o.x; ty = o.y; tz = o.z; has = true;
            const dist = Math.hypot(o.x - p.x, o.z - p.z);
            o.missileLockT = 0.35; if (dist < o.missileDist) o.missileDist = dist;
            if (dist < 90) o.threatT = 0.4;
            // countermeasures: flares pull the seeker off inside its terminal run
            if (o.flareT > 0 && dist < 170) {
              // the seeker swings after the decoys: it veers off the ship's line and burns out
              has = false; p.tKind = 0; p.life = Math.min(p.life, 0.6); o.missileDist = 1e9; o.missileLockT = 0;
              const a = (this.rng.next() < 0.5 ? -1 : 1) * 0.75, ca = Math.cos(a), sa = Math.sin(a);
              const vx = p.vx * ca - p.vz * sa, vz = p.vx * sa + p.vz * ca;
              p.vx = vx; p.vz = vz; p.vy = p.speed * 0.35;
            }
          }
        } else if (p.tKind === T_COMP) { const k = cap.components[p.tIdx]; if (k.alive) { tx = k.x; ty = k.y; tz = k.z; has = true; } }
        else if (p.tKind === T_DRONE) { const d = drones[p.tIdx]; if (d.active) { tx = d.x; ty = d.y; tz = d.z; has = true; } }
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
        let dx = p.vx / sp, dy = p.vy / sp, dz = p.vz / sp;
        if (has) {
          const l = Math.hypot(tx - p.x, ty - p.y, tz - p.z) || 1;
          const k = Math.min(1, p.turn * dt);
          dx += ((tx - p.x) / l - dx) * k; dy += ((ty - p.y) / l - dy) * k; dz += ((tz - p.z) / l - dz) * k;
          const n = Math.hypot(dx, dy, dz) || 1; dx /= n; dy /= n; dz /= n;
        } else p.tKind = 0;
        p.vx = dx * p.speed; p.vy = dy * p.speed; p.vz = dz * p.speed;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

      const pad = p.kind === MISSILE ? 2.2 : 0.9;
      const friendly = p.owner >= 0; // fired by a racer
      let consumed = false;
      for (let j = 0; j < ships.length && !consumed; j++) {
        const s = ships[j];
        if (j === p.owner || !s.alive || s.phased || s.finished) continue;
        const ddx = s.x - p.x, ddz = s.z - p.z;
        if (ddx > 20 || ddx < -20 || ddz > 20 || ddz < -20) continue;
        if (segSphere(p.px, p.py, p.pz, p.x, p.y, p.z, s.x, s.y, s.z, SHIP_RADIUS + pad) >= 0) {
          if (p.kind === MISSILE) this.explodeMissile(p, s, -1, -1);
          else this.damageShip(s, p.kind === BOLT ? p.damage * SHIP_BOLT_SCALE : p.damage, p.owner, p.px, p.pz);
          consumed = true;
        }
      }
      if (!consumed && friendly) {
        for (let j = 0; j < drones.length; j++) {
          const d = drones[j];
          if (!d.active) continue;
          const ddx = d.x - p.x, ddz = d.z - p.z;
          if (ddx > 20 || ddx < -20 || ddz > 20 || ddz < -20) continue;
          if (segSphere(p.px, p.py, p.pz, p.x, p.y, p.z, d.x, d.y, d.z, DRONE_RADIUS + pad) >= 0) {
            if (p.kind === MISSILE) this.explodeMissile(p, null, -1, j);
            else { this.drones.hit(d, p.damage, p.owner, this); this.events.push('hit', -1, p.x, p.y, p.z, p.damage, p.owner); }
            consumed = true; break;
          }
        }
        if (!consumed && Math.abs(p.x - cap.cx) < capR && Math.abs(p.z - cap.cz) < capR) {
          for (let j = 0; j < cap.components.length; j++) {
            const k = cap.components[j];
            if (!k.alive) continue;
            if (segSphere(p.px, p.py, p.pz, p.x, p.y, p.z, k.x, k.y, k.z, k.r + pad * 0.5) >= 0) {
              if (p.kind === MISSILE) this.explodeMissile(p, null, j, -1);
              else cap.damage(k, p.damage, p.owner, this, p.x, p.y, p.z);
              consumed = true; break;
            }
          }
        }
        if (!consumed) {
          for (let j = 0; j < obs.length; j++) {
            const o = obs[j];
            if (!o.alive || !o.solid) continue;
            const ddx = o.x - p.x, ddz = o.z - p.z;
            if (ddx > 16 || ddx < -16 || ddz > 16 || ddz < -16) continue;
            if (segSphere(p.px, p.py, p.pz, p.x, p.y, p.z, o.x, o.y + 1.5, o.z, o.r + 0.4) >= 0) {
              if (p.kind === MISSILE) this.explodeMissile(p, null, -1, -1);
              else this.events.push('hit', -1, p.x, p.y, p.z, 1);
              if (o.maxHp > 0) { o.hp -= p.kind === MISSILE ? 80 : p.damage; if (o.hp <= 0) this.destroyObstacle(o); }
              consumed = true; break;
            }
          }
        }
      }
      if (consumed) p.active = false;
    }
  }

  private explodeMissile(p: Projectile, direct: Ship | null, comp: number, drone: number): void {
    this.events.push('explosion', p.owner, p.x, p.y, p.z, 7, -1, p.color, 'missile');
    if (comp >= 0) this.capital.damage(this.capital.components[comp], 30 * 3, p.owner, this, p.x, p.y, p.z);
    if (drone >= 0) this.drones.hit(this.drones.drones[drone], 200, p.owner, this);
    for (const s of this.ships) {
      if (s.index === p.owner || !s.alive) continue;
      if (s === direct) { this.damageShip(s, p.damage, p.owner, p.px, p.pz); continue; }
      const d = Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z);
      if (d < 11) this.damageShip(s, p.damage * 0.5 * (1 - d / 11), p.owner, p.x, p.z);
    }
    if (p.owner >= 0) {
      for (const d of this.drones.drones) {
        if (!d.active || d.index === drone) continue;
        if (Math.hypot(d.x - p.x, d.y - p.y, d.z - p.z) < 12) this.drones.hit(d, 40, p.owner, this);
      }
    }
  }

  private shipCollisions(): void {
    const ships = this.ships;
    const minD = SHIP_RADIUS * 1.9;
    for (let i = 0; i < ships.length; i++) {
      const a = ships[i];
      if (!a.alive || a.phased) continue;
      for (let j = i + 1; j < ships.length; j++) {
        const b = ships[j];
        if (!b.alive || b.phased) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        if (dx > minD || dx < -minD || dz > minD || dz < -minD || Math.abs(b.y - a.y) > 5) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        const ma = a.stats.mass, mb = b.stats.mass, inv = 1 / (ma + mb);
        const pen = minD - d;
        a.x -= nx * pen * mb * inv; a.z -= nz * pen * mb * inv;
        b.x += nx * pen * ma * inv; b.z += nz * pen * ma * inv;
        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rv < 0) {
          const jimp = (-(1 + 0.4) * rv) / (1 / ma + 1 / mb);
          a.vx -= (jimp / ma) * nx; a.vz -= (jimp / ma) * nz;
          b.vx += (jimp / mb) * nx; b.vz += (jimp / mb) * nz;
          if (this.phase === 'racing') {
            this.events.push('wallHit', a.index, (a.x + b.x) / 2, a.y, (a.z + b.z) / 2, -rv, b.index);
            if (-rv > 22) {
              // ramming: the heavier ship comes off better
              const dmg = (-rv - 22) * 0.32;
              this.damageShip(a, dmg * (mb / ma), b.index, b.x, b.z);
              this.damageShip(b, dmg * (ma / mb), a.index, a.x, a.z);
            }
          }
        }
      }
    }
  }
}
