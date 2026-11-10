// Race simulation: owns every gameplay system and advances them with a
// delta-time step. It has no rendering, audio or DOM dependencies, so the
// same code runs in the browser and in headless tests.
import { Vector3 } from 'three';
import type { RaceDef } from '../data/campaign';
import { AI_RACERS, computeStats, uniformLevels, type ShipDef, type UpgradeLevels } from '../data/ships';
import { Rng } from '../core/rng';
import { getTrack } from '../tracks';
import { newFrame, pointAt, type Track } from '../tracks/track';
import { AiController } from './ai';
import { Capital } from './capital';
import { EventQueue } from './events';
import { buildLayout, makePickup, type Layout, type Obstacle, type Pickup, type PickupKind } from './layout';
import { SHIP_RADIUS, Ship } from './ship';
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
/** Racer blasters are tuned to chew through capital ship armour; against other racers they sting rather than shred. */
const SHIP_BOLT_SCALE = 0.3;
const TARGET_RANGE_SHIP = 300;
export const TARGET_RANGE_CAP = 520;
const tmp = new Vector3();
const fr = newFrame();

export class RaceSim {
  readonly cfg: RaceConfig;
  readonly race: RaceDef;
  readonly track: Track;
  readonly ships: Ship[] = [];
  readonly ai: (AiController | null)[] = [];
  readonly projectiles = new ProjectilePool(420);
  readonly capital: Capital;
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
  private readonly rng: Rng;
  private tick = 0;

  constructor(cfg: RaceConfig) {
    this.cfg = cfg;
    this.race = cfg.race;
    this.laps = cfg.race.laps;
    this.track = getTrack(cfg.race.track);
    this.rng = new Rng(cfg.race.seed + 5);
    this.layout = buildLayout(this.track, cfg.race);

    const player = new Ship(0, 'YOU', cfg.playerShip, computeStats(cfg.playerShip, cfg.playerUpgrades));
    player.isPlayer = true;
    this.player = player;
    this.ships.push(player);
    const aiLevels = uniformLevels(cfg.race.aiLevel);
    AI_RACERS.forEach((r, i) => {
      this.ships.push(new Ship(i + 1, r.name, r.ship, computeStats(r.ship, aiLevels)));
    });
    this.capital = new Capital(this.track, cfg.race, this.ships.length);

    // controllers: the player's AI only drives in autopilot mode or after the finish
    const veteran = AI_RACERS.find((r) => r.id === 'veteran')!.personality;
    this.ai.push(new AiController(player, { ...veteran, mistakeRate: 0.2, capitalBias: 0.8 }, 1, cfg.race.seed + 99));
    AI_RACERS.forEach((r, i) => this.ai.push(new AiController(this.ships[i + 1], r.personality, cfg.race.aiSkill, cfg.race.seed + 13 * (i + 1))));

    // starting grid: AI in shuffled order, the player starts from the back row
    const aiOrder = this.ships.slice(1).map((s) => s.index);
    for (let i = aiOrder.length - 1; i > 0; i--) { const j = this.rng.int(0, i); [aiOrder[i], aiOrder[j]] = [aiOrder[j], aiOrder[i]]; }
    const grid = [...aiOrder, 0];
    const L = this.track.length;
    grid.forEach((shipIdx, slot) => {
      const row = Math.floor(slot / 2), col = slot % 2;
      const s = L - 16 - row * 14 - col * 7;
      const ship = this.ships[shipIdx];
      ship.placeOnTrack(this.track, 0, s, col ? 7.5 : -7.5);
      ship.total = ship.prog - L;
    });
    for (let i = 0; i < this.ships.length; i++) this.order.push(i);
    this.updateStandings();
  }

  // ------------------------------------------------------------------ step
  step(dt: number): void {
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
      this.updateProgress(s, L);
      this.checkPads(s);
      this.checkObstacles(s, dt);
      if (!s.alive) continue;
      const dot = s.hx * s.trackHx + s.hz * s.trackHz;
      s.wrongWayT = dot < -0.35 && s.speed > 6 ? s.wrongWayT + dt : 0;
      if ((this.tick + i) % 6 === 0) this.selectTarget(s);
      this.fireWeapons(s);
    }
    this.shipCollisions();
    this.updateObstacles(dt);
    this.updateProjectiles(dt);
    this.capital.update(dt, this);
    this.updatePickups(dt);
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
    this.order.sort((a, b) => {
      const A = ships[a], B = ships[b];
      if (A.finished || B.finished) {
        if (A.finished && B.finished) return A.finishPos - B.finishPos;
        return A.finished ? -1 : 1;
      }
      if (A.cpCount !== B.cpCount) return B.cpCount - A.cpCount;
      return B.total - A.total;
    });
    for (let i = 0; i < this.order.length; i++) ships[this.order[i]].place = i + 1;
  }

  private checkEnd(dt: number): void {
    if (this.phase !== 'racing') return;
    let aiLeft = 0;
    for (let i = 1; i < this.ships.length; i++) if (!this.ships[i].finished) aiLeft++;
    const p = this.player;
    if (!p.finished && aiLeft === 0) {
      this.graceT += dt;
      if (this.graceT > 60) this.finishShip(p, true);
    }
    // safety net: never leave the race hanging if a straggler cannot finish
    if (p.finished && aiLeft > 0 && this.time - this.playerFinishedAt > 240) {
      for (const idx of [...this.order]) { const s = this.ships[idx]; if (!s.finished) this.finishShip(s, true); }
    }
    if (this.ships.every((s) => s.finished)) { this.phase = 'done'; this.updateStandings(); }
  }

  // ---------------------------------------------------------------- damage
  /** Apply damage to a ship. attacker: ship index, or -1 for environment/capital. Returns damage dealt. */
  damageShip(s: Ship, amount: number, attacker: number, fromX: number, fromZ: number): number {
    if (!s.alive || s.invuln > 0 || s.phased || s.finished || amount <= 0) return 0;
    if (s.bulwark) amount *= 0.12;
    let applied = 0;
    if (s.shield > 0) {
      const a = Math.min(s.shield, amount);
      s.shield -= a; amount -= a; applied += a;
      this.events.push('shieldHit', s.index, s.x, s.y, s.z, a);
    }
    if (amount > 0) {
      const a = Math.min(s.hp, amount);
      s.hp -= a; applied += a;
      this.events.push('hit', s.index, s.x, s.y, s.z, a);
    }
    s.shieldDelayT = s.stats.shieldDelay;
    s.hitFlash = 0.45;
    s.hitDirX = fromX - s.x; s.hitDirZ = fromZ - s.z;
    s.lastHitT = 0; s.lastHitBy = attacker;
    if (attacker >= 0 && attacker !== s.index) this.ships[attacker].racerDamage += applied;
    if (s.hp <= 0) this.destroyShip(s, attacker, false);
    return applied;
  }

  private destroyShip(s: Ship, attacker: number, manualReset: boolean): void {
    s.dead = manualReset ? 1.3 : 2.5;
    s.deaths += manualReset ? 0 : 1;
    s.hp = 0;
    s.vx = 0; s.vz = 0; s.fwdSpeed = 0; s.boosting = false; s.abilityT = 0; s.padT = 0;
    this.events.push('shipDestroyed', s.index, s.x, s.y, s.z, manualReset ? 0 : 1, attacker, s.def.colors.primary);
    if (!manualReset) {
      if (attacker >= 0 && attacker !== s.index) this.ships[attacker].racerKills++;
      // a wreck spills a little salvage for whoever is following
      for (let k = 0; k < 3; k++) {
        const sAt = (s.idx + s.f) * this.track.paths[s.pathId].step + 14 + k * 9;
        const d = Math.max(-(s.hw - 4), Math.min(s.hw - 4, s.d + (k - 1) * 5));
        pointAt(this.track.paths[s.pathId], sAt, d, tmp, fr);
        this.spawnPickup('scrap', 1, s.pathId, sAt, d, tmp.x, tmp.y + 1.6, tmp.z, s.x, s.y, s.z, 22);
      }
    }
  }

  private respawn(s: Ship): void {
    const path = this.track.paths[s.pathId];
    const total = s.total;
    s.placeOnTrack(this.track, s.pathId, (s.idx + s.f) * path.step, 0);
    s.total = total;
    s.dead = 0;
    s.hp = s.stats.armour; s.shield = s.stats.shield * 0.5; s.shieldDelayT = 0;
    s.invuln = 2.5; s.heat = 0; s.overheated = false;
    s.boost = Math.max(s.boost, 40); s.boostLock = false;
    s.stuckT = 0; s.wrongWayT = 0;
    this.events.push('respawn', s.index, s.x, s.y, s.z);
  }

  addSalvage(s: Ship, value: number): void {
    s.salvage += value * s.stats.salvageMult;
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
        s.boost = Math.min(100, s.boost + 20); s.boostLock = false;
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
          this.damageShip(s, 32, -1, o.x, o.z);
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
          if (-vn > 24) this.damageShip(s, (-vn - 24) * 0.4, -1, o.x, o.z);
          if (o.maxHp > 0) { o.hp -= -vn * 0.9; if (o.hp <= 0) this.destroyObstacle(o); }
          if (!s.alive) return;
        }
      }
    }
  }

  private destroyObstacle(o: Obstacle): void {
    o.alive = false; o.respawnT = o.respawnDelay;
    this.events.push('obstacleDestroyed', -1, o.x, o.y + 1.5, o.z, o.r, o.id, 0xffffff, o.kind);
  }

  private updateObstacles(dt: number): void {
    const obs = this.layout.obstacles;
    const L = this.track.length;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (!o.alive) {
        o.respawnT -= dt;
        if (o.respawnT <= 0) { o.alive = true; o.hp = o.maxHp; }
        continue;
      }
      if (o.kind === 'vent') {
        o.timer += dt;
        o.active = o.timer % o.period > o.period - 1.3;
        continue;
      }
      if (o.speed !== 0 || o.amp !== 0) {
        if (o.speed !== 0) o.s = (o.s + o.speed * dt) % L;
        if (o.amp !== 0) o.d = o.baseD + o.amp * Math.sin(this.time * o.freq * 6.283 + o.phase);
        pointAt(this.track.paths[o.path], o.s, o.d, tmp, fr);
        if (o.kind === 'traffic') { const lim = fr.hw - o.r - 1; o.d = Math.max(-lim, Math.min(lim, o.baseD)); }
        o.x = tmp.x; o.y = tmp.y; o.z = tmp.z;
      }
    }
  }

  // --------------------------------------------------------------- combat
  /** Auto-aim target selection shared by the player and the AI. */
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
        const dot = (dx * hx + dz * hz) / (dist || 1);
        if (dot < -0.25) continue;
        const score = dist * (1.35 - dot);
        if (score < compScore) { compScore = score; comp = i; }
      }
    }
    let ship = -1, shipScore = 1e9;
    for (let i = 0; i < this.ships.length; i++) {
      const o = this.ships[i];
      if (o === s || !o.alive || o.finished || o.phased) continue;
      const dx = o.x - s.x, dz = o.z - s.z;
      if (dx > TARGET_RANGE_SHIP || dx < -TARGET_RANGE_SHIP || dz > TARGET_RANGE_SHIP || dz < -TARGET_RANGE_SHIP) continue;
      if (Math.abs(o.y - s.y) > 14) continue;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > TARGET_RANGE_SHIP || dist < 1) continue;
      const dot = (dx * hx + dz * hz) / dist;
      if (dot < 0.962) continue;
      const score = dist * (1 + (1 - dot) * 22);
      if (score < shipScore) { shipScore = score; ship = i; }
    }
    if (ship >= 0 && (s.preferRacers || comp < 0)) { s.targetKind = 1; s.targetIdx = ship; }
    else if (comp >= 0) { s.targetKind = 2; s.targetIdx = comp; }
    else { s.targetKind = 0; s.targetIdx = -1; }
  }

  private targetValid(s: Ship): boolean {
    if (s.targetKind === 1) { const o = this.ships[s.targetIdx]; return !!o && o.alive && !o.phased && !o.finished; }
    if (s.targetKind === 2) { const c = this.capital.components[s.targetIdx]; return !!c && this.capital.vulnerable(c); }
    return false;
  }

  private fireWeapons(s: Ship): void {
    if (s.finished || this.phase !== 'racing') return;
    const c = s.ctl;
    const hx = s.hx, hz = s.hz;
    const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    if (c.fire && s.fireCd <= 0 && !s.overheated) {
      s.fireCd = 1 / s.stats.fireRate;
      s.sinceFire = 0;
      s.heat += 100 / (s.stats.fireRate * 6);
      if (s.heat >= 100) { s.heat = 100; s.overheated = true; this.events.push('overheat', s.index, s.x, s.y, s.z); }
      s.gunSide = -s.gunSide;
      const gx = s.x + hx * 2.2 + -hz * 1.1 * s.gunSide, gy = s.y, gz = s.z + hz * 2.2 + hx * 1.1 * s.gunSide;
      const speed = BOLT_SPEED + Math.max(0, s.fwdSpeed) * 0.6;
      let dx = hx * cp, dy = sp, dz = hz * cp;
      if (this.targetValid(s)) {
        let tx: number, ty: number, tz: number;
        if (s.targetKind === 1) {
          const o = this.ships[s.targetIdx];
          const lead = Math.hypot(o.x - gx, o.z - gz) / speed;
          tx = o.x + o.vx * lead; ty = o.y; tz = o.z + o.vz * lead;
        } else { const k = this.capital.components[s.targetIdx]; tx = k.x; ty = k.y; tz = k.z; }
        const l = Math.hypot(tx - gx, ty - gy, tz - gz) || 1;
        dx = (tx - gx) / l; dy = (ty - gy) / l; dz = (tz - gz) / l;
      }
      const p = this.projectiles.spawn();
      p.kind = BOLT; p.owner = s.index;
      p.x = p.px = gx; p.y = p.py = gy; p.z = p.pz = gz;
      p.vx = dx * speed; p.vy = dy * speed; p.vz = dz * speed; p.speed = speed;
      p.life = 1.3; p.damage = s.stats.weaponDamage; p.tKind = 0; p.tIdx = -1; p.color = s.def.colors.glow;
      this.events.push('shoot', s.index, gx, gy, gz);
    }
    if (c.missile && s.missiles > 0 && s.missileCd <= 0) {
      s.missiles--; s.missileCd = 1.1;
      const speed = Math.max(170, s.fwdSpeed + 70);
      const p = this.projectiles.spawn();
      p.kind = MISSILE; p.owner = s.index;
      p.x = p.px = s.x + hx * 3; p.y = p.py = s.y - 0.3; p.z = p.pz = s.z + hz * 3;
      p.vx = hx * cp * speed; p.vy = sp * speed; p.vz = hz * cp * speed; p.speed = speed;
      p.life = 5; p.damage = 32;
      if (this.targetValid(s)) { p.tKind = s.targetKind; p.tIdx = s.targetIdx; } else { p.tKind = 0; p.tIdx = -1; }
      p.color = s.def.colors.glow;
      this.events.push('missile', s.index, p.x, p.y, p.z);
    }
  }

  private updateProjectiles(dt: number): void {
    const items = this.projectiles.items;
    const ships = this.ships, cap = this.capital, obs = this.layout.obstacles;
    const capR = cap.length / 2 + 120;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.kind === MISSILE) this.explodeMissile(p, null, -1);
        p.active = false;
        continue;
      }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      if (p.kind === MISSILE) {
        p.speed = Math.min(340, p.speed + 170 * dt);
        let tx = 0, ty = 0, tz = 0, has = false;
        if (p.tKind === 1) { const o = ships[p.tIdx]; if (o.alive && !o.phased && !o.finished) { tx = o.x; ty = o.y; tz = o.z; has = true; if (Math.abs(o.x - p.x) < 90 && Math.abs(o.z - p.z) < 90) o.threatT = 0.4; } }
        else if (p.tKind === 2) { const k = cap.components[p.tIdx]; if (k.alive) { tx = k.x; ty = k.y; tz = k.z; has = true; } }
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
        let dx = p.vx / sp, dy = p.vy / sp, dz = p.vz / sp;
        if (has) {
          const l = Math.hypot(tx - p.x, ty - p.y, tz - p.z) || 1;
          const k = Math.min(1, 3.4 * dt);
          dx += ((tx - p.x) / l - dx) * k; dy += ((ty - p.y) / l - dy) * k; dz += ((tz - p.z) / l - dz) * k;
          const n = Math.hypot(dx, dy, dz) || 1; dx /= n; dy /= n; dz /= n;
        } else p.tKind = 0;
        p.vx = dx * p.speed; p.vy = dy * p.speed; p.vz = dz * p.speed;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

      const pad = p.kind === MISSILE ? 2.2 : 0.9;
      let consumed = false;
      for (let j = 0; j < ships.length && !consumed; j++) {
        const s = ships[j];
        if (j === p.owner || !s.alive || s.phased || s.finished) continue;
        const ddx = s.x - p.x, ddz = s.z - p.z;
        if (ddx > 20 || ddx < -20 || ddz > 20 || ddz < -20) continue;
        if (segSphere(p.px, p.py, p.pz, p.x, p.y, p.z, s.x, s.y, s.z, SHIP_RADIUS + pad) >= 0) {
          if (p.kind === MISSILE) this.explodeMissile(p, s, -1);
          else this.damageShip(s, p.kind === BOLT ? p.damage * SHIP_BOLT_SCALE : p.damage, p.owner, p.px, p.pz);
          consumed = true;
        }
      }
      if (!consumed && p.kind !== CAP_BOLT) {
        if (Math.abs(p.x - cap.cx) < capR && Math.abs(p.z - cap.cz) < capR) {
          for (let j = 0; j < cap.components.length; j++) {
            const k = cap.components[j];
            if (!k.alive) continue;
            if (segSphere(p.px, p.py, p.pz, p.x, p.y, p.z, k.x, k.y, k.z, k.r + pad * 0.5) >= 0) {
              if (p.kind === MISSILE) this.explodeMissile(p, null, j);
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
              if (p.kind === MISSILE) this.explodeMissile(p, null, -1);
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

  private explodeMissile(p: Projectile, direct: Ship | null, comp: number): void {
    this.events.push('explosion', p.owner, p.x, p.y, p.z, 7, -1, p.color, 'missile');
    if (comp >= 0) this.capital.damage(this.capital.components[comp], p.damage * 3, p.owner, this, p.x, p.y, p.z);
    for (const s of this.ships) {
      if (s.index === p.owner || !s.alive) continue;
      if (s === direct) { this.damageShip(s, p.damage, p.owner, p.px, p.pz); continue; }
      const d = Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z);
      if (d < 11) this.damageShip(s, p.damage * 0.5 * (1 - d / 11), p.owner, p.x, p.z);
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
            if (-rv > 26) {
              const dmg = (-rv - 26) * 0.3;
              this.damageShip(a, dmg * (mb / ma), b.index, b.x, b.z);
              this.damageShip(b, dmg * (ma / mb), a.index, a.x, a.z);
            }
          }
        }
      }
    }
  }
}
