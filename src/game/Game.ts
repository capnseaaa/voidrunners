// Orchestrates one race: owns the simulation, renderer and input, runs the
// delta-time loop, routes simulation events to audio / visuals and publishes
// HUD readouts. React talks to it only through this small surface.
import { audio } from './audio/AudioEngine';
import type { RaceDef } from './data/campaign';
import { computeRewards, type RaceOutcome, type RewardBreakdown } from './data/rewards';
import { ABILITIES, type ShipDef, type UpgradeLevels } from './data/ships';
import { hudStore, type HudMessage, type HudState } from './hudStore';
import { Input } from './input/Input';
import { RaceRenderer, type Quality } from './render/RaceRenderer';
import { COMPONENT_LABEL } from './sim/capital';
import { COUNTDOWN_TIME, RaceSim, TARGET_RANGE_CAP } from './sim/race';
import type { Settings } from './save/save';
import { angleDelta } from './core/rng';

export interface RaceResult {
  race: RaceDef;
  shipId: string;
  outcome: RaceOutcome;
  rewards: RewardBreakdown;
  contributions: { name: string; isPlayer: boolean; damage: number; share: number; kills: number; color: string }[];
}

export interface GameOptions {
  race: RaceDef;
  ship: ShipDef;
  upgrades: UpgradeLevels;
  settings: Settings;
  autopilot?: boolean;
  onFinish: (r: RaceResult) => void;
  onPauseToggle: () => void;
}

const MAX_STEP = 1 / 90;
const hexColor = (c: number) => '#' + c.toString(16).padStart(6, '0');

export class Game {
  readonly sim: RaceSim;
  readonly renderer: RaceRenderer;
  readonly input = new Input();
  /** Static minimap outline: one polyline per route, in world x/z. */
  readonly minimap: { pts: number[]; main: boolean }[] = [];
  readonly bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  timeScale = 1;
  paused = false;
  private raf = 0;
  private last = 0;
  private running = false;
  private hudT = 0;
  private msgId = 1;
  private messages: HudMessage[] = [];
  private finishedAt = -1;
  private reported = false;
  private result: RaceResult | null = null;
  private fpsAcc = 0; private fpsN = 0; private fps = 60;
  private wall = 0;
  private readonly ro: ResizeObserver;
  private lowHpBeep = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly opts: GameOptions) {
    this.sim = new RaceSim({ race: opts.race, playerShip: opts.ship, playerUpgrades: opts.upgrades, autopilot: opts.autopilot });
    this.renderer = new RaceRenderer(canvas, this.sim, opts.settings.quality as Quality);
    this.renderer.shakeEnabled = opts.settings.cameraShake;
    this.input.onPause = () => opts.onPauseToggle();
    this.input.attach();

    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of this.sim.track.paths) {
      const pts: number[] = [];
      for (let i = 0; i < p.samples.length; i += 3) {
        const s = p.samples[i];
        pts.push(s.x, s.z);
        minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
      }
      if (p.closed) pts.push(p.samples[0].x, p.samples[0].z);
      else { const e = p.samples[p.samples.length - 1]; pts.push(e.x, e.z); }
      this.minimap.push({ pts, main: p.id === 0 });
    }
    this.bounds = { minX, maxX, minZ, maxZ };

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    audio.playMusic(opts.race.track);
    audio.startEngine();
    this.publishHud(true);
  }

  private resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(320, el.clientWidth), h = Math.max(200, el.clientHeight);
    this.renderer.resize(w, h);
    if (this.paused || !this.running) this.renderer.render(0);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const real = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.paused) return;
      this.frame(real);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    this.input.clear();
    if (p) { audio.setEngine(0, 0, 0, false); }
    else { this.last = performance.now(); audio.startEngine(); }
  }

  applySettings(s: Settings): void {
    this.renderer.shakeEnabled = s.cameraShake;
  }

  /** Advance the game by a real-time delta (exposed for automated tests). */
  frame(real: number): void {
    const sim = this.sim;
    const dt = real * this.timeScale;
    this.fpsAcc += real; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    this.wall += real;

    const n = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      if (!this.opts.autopilot && !sim.player.finished) this.input.apply(sim.player.ctl);
      sim.step(h);
      this.handleEvents();
      this.renderer.consume(sim.events);
      sim.events.clear();
    }
    this.renderer.render(dt);

    const p = sim.player;
    const hot = p.bursting ? 1.4 : p.boosting || p.overdriveT > 0 ? 0.8 : p.padT > 0 ? 0.5 : 0;
    audio.setEngine(Math.max(0, p.fwdSpeed) / p.stats.topSpeed, p.ctl.throttle, hot, p.alive && sim.phase !== 'grid' ? true : p.alive);

    for (const m of this.messages) m.t += real;
    if (this.messages.length && this.messages[0].t > 4) this.messages = this.messages.filter((m) => m.t <= 4);

    if (p.finished && !this.reported) {
      if (this.finishedAt < 0) { this.finishedAt = this.wall; this.result = this.buildResult(); }
      if (this.wall - this.finishedAt > 2.6) { this.reported = true; this.opts.onFinish(this.result!); }
    }
    this.hudT -= real;
    if (this.hudT <= 0) { this.hudT = 0.07; this.publishHud(false); }
  }

  private say(text: string, kind: HudMessage['kind'] = 'info'): void {
    this.messages = [...this.messages.slice(-3), { id: this.msgId++, text, kind, t: 0 }];
  }

  private handleEvents(): void {
    const sim = this.sim, ev = sim.events, p = sim.player;
    const cam = this.renderer.camera.position;
    for (let i = 0; i < ev.count; i++) {
      const e = ev.list[i];
      const mine = e.ship === 0;
      const dist = Math.hypot(e.x - cam.x, e.z - cam.z);
      const vol = Math.max(0, 1 - dist / 420);
      switch (e.type) {
        case 'countdown': audio.countdown(false); break;
        case 'go': audio.countdown(true); break;
        case 'shoot': if (mine) audio.blaster(1, true); else if (vol > 0.05) audio.blaster(vol, false); break;
        case 'missile': if (mine || vol > 0.05) audio.missile(mine ? 1 : vol); break;
        case 'capitalFire': { const v = Math.max(0, 1 - dist / 800); if (v > 0.05) audio.capitalGun(v); break; }
        case 'hit': if (mine) audio.hullHit(1); else if (vol > 0.3) audio.hullHit(vol * 0.5); break;
        case 'shieldHit': if (mine) audio.shieldHit(1); else if (vol > 0.4) audio.shieldHit(vol * 0.4); break;
        case 'wallHit': if (mine) audio.scrape(e.a); break;
        case 'explosion': if (vol > 0.03 || mine) audio.explosion(1, Math.max(vol, mine ? 0.5 : 0)); break;
        case 'shipDestroyed':
          if (e.a > 0) {
            audio.explosion(2, mine ? 1 : Math.max(0.15, vol));
            if (mine) this.say(e.other > 0 ? `WRECKED BY ${sim.ships[e.other].name}` : 'SHIP DESTROYED', 'bad');
            else if (e.other === 0) this.say(`RIVAL WRECKED: ${sim.ships[e.ship].name}`, 'good');
          } else if (mine) this.say('RESETTING TO TRACK', 'info');
          break;
        case 'pickup': if (mine) { audio.pickup(e.text); if (e.text === 'missile') this.say('+2 MISSILES', 'good'); } break;
        case 'boostPad': if (mine) audio.boostPad(); break;
        case 'boostStart': if (mine) audio.boostStart(); break;
        case 'ability': if (mine) audio.ability(p.ability); break;
        case 'overheat': if (mine) { audio.overheat(); this.say('BLASTERS OVERHEATED', 'bad'); } break;
        case 'overdrive': if (mine) { audio.pickup('overdrive'); this.say('OVERDRIVE ENGAGED', 'good'); } break;
        case 'lap':
          if (mine) {
            const final = e.a === sim.laps - 1;
            audio.lap(final);
            if (e.a < sim.laps) this.say(final ? 'FINAL LAP' : `LAP ${e.a + 1} / ${sim.laps}`, 'info');
          }
          break;
        case 'finish':
          if (mine) { if (p.finishPos <= 3 && !p.dnf) audio.victory(); else audio.defeat(); this.say(p.dnf ? 'TIME OUT' : `FINISHED P${p.finishPos}`, p.finishPos <= 3 ? 'good' : 'info'); }
          else if (!p.finished && e.a === 1) this.say(`${sim.ships[e.ship].name} TAKES THE WIN`, 'info');
          break;
        case 'strikeWarn': { const v = Math.max(0, 1 - Math.hypot(e.x - p.x, e.z - p.z) / 160); if (v > 0.1) audio.strikeWarn(); break; }
        case 'strike': { const v = Math.max(0, 1 - dist / 500); if (v > 0.05) audio.explosion(1.5, v); break; }
        case 'componentDestroyed': {
          audio.explosion(4, Math.max(0.35, 1 - dist / 1500));
          const who = e.ship === 0 ? 'YOU' : e.ship > 0 ? sim.ships[e.ship].name : '';
          this.say(`${e.text} DESTROYED${who ? ' - ' + who : ''}`, e.ship === 0 ? 'good' : 'boss');
          if (sim.capital.components[e.other].type === 'shield') this.say('CAPITAL SHIELDS DOWN - ALL SYSTEMS EXPOSED', 'boss');
          break;
        }
        case 'capitalDestroyed': audio.explosion(5, 1); this.say(`${sim.capital.name} DISABLED`, 'good'); break;
        case 'obstacleDestroyed': if (vol > 0.05) audio.explosion(0.8, vol * 0.7); break;
        default: break;
      }
    }
  }

  private buildResult(): RaceResult {
    const sim = this.sim, p = sim.player, cap = sim.capital;
    const outcome: RaceOutcome = {
      position: p.finishPos, finished: !p.dnf, time: p.finishTime, bestLap: p.bestLap,
      salvage: Math.round(p.salvage), deaths: p.deaths, racerKills: p.racerKills, racerDamage: p.racerDamage,
      capitalDamage: p.capitalDamage, capitalTotalDamage: cap.totalDamage, capitalKills: p.capitalKills,
      capitalDestroyed: cap.destroyed, capitalKillBonus: p.capitalKillBonus,
    };
    const rewards = computeRewards(sim.race, outcome);
    const contributions = sim.ships.map((s) => ({
      name: s.name, isPlayer: s.isPlayer, damage: Math.round(s.capitalDamage), kills: s.capitalKills,
      share: cap.totalDamage > 0 ? (s.capitalDamage / cap.totalDamage) * 100 : 0, color: hexColor(s.def.colors.primary),
    })).sort((a, b) => b.damage - a.damage);
    return { race: sim.race, shipId: p.def.id, outcome, rewards, contributions };
  }

  private publishHud(initial: boolean): void {
    const sim = this.sim, p = sim.player, cap = sim.capital, st = p.stats;
    let targetName = '', targetHp = 0;
    if (p.targetKind === 1 && sim.ships[p.targetIdx]) { const o = sim.ships[p.targetIdx]; targetName = o.name; targetHp = (o.hp + o.shield) / (o.stats.armour + o.stats.shield); }
    else if (p.targetKind === 2 && cap.components[p.targetIdx]) { const c = cap.components[p.targetIdx]; targetName = COMPONENT_LABEL[c.type]; targetHp = c.hp / c.maxHp; }
    const near = !cap.destroyed && Math.hypot(p.x - cap.cx, p.z - cap.cz) < cap.length / 2 + TARGET_RANGE_CAP + 200;
    const hitAngle = angleDelta(Math.atan2(p.hitDirX, p.hitDirZ), p.yaw);
    const ability = ABILITIES[p.ability];
    const state: HudState = {
      phase: sim.phase,
      countdown: initial ? COUNTDOWN_TIME : sim.countdown,
      time: sim.time,
      position: p.finished ? p.finishPos : p.place,
      lap: Math.min(sim.laps, p.lap + 1), laps: sim.laps,
      lapTime: sim.time - p.lapStart, lastLap: p.lastLap, bestLap: p.bestLap,
      speed: Math.round(Math.max(0, p.fwdSpeed) * 6), speedFrac: Math.max(0, p.fwdSpeed) / st.topSpeed,
      hp: p.hp, hpMax: st.armour, shield: p.shield, shieldMax: st.shield,
      boost: p.boost, boostLock: p.boostLock, boosting: p.boosting, overdrive: Math.max(0, p.overdriveT),
      missiles: p.missiles, missileMax: st.missiles, missileReady: 1 - Math.max(0, p.missileCd) / 1.1,
      heat: p.heat, overheated: p.overheated,
      abilityName: ability.name, abilityReady: p.abilityT > 0 ? 0 : 1 - Math.max(0, p.abilityCd) / ability.cooldown, abilityActive: p.abilityT > 0,
      salvage: Math.round(p.salvage),
      bossName: cap.name, bossHp: cap.hp / cap.maxHp, bossShield: cap.shieldUp, bossDestroyed: cap.destroyed, bossNear: near,
      components: cap.components.map((c) => ({ name: c.name, type: c.type, hp: c.hp / c.maxHp, alive: c.alive, vulnerable: cap.vulnerable(c), targeted: p.targetKind === 2 && p.targetIdx === c.index })),
      standings: sim.order.map((idx, i) => { const s = sim.ships[idx]; return { name: s.name, isPlayer: s.isPlayer, finished: s.finished, dnf: s.dnf, time: s.finishTime, color: hexColor(s.def.colors.primary), place: i + 1, lap: Math.min(sim.laps, s.lap + 1) }; }),
      messages: this.messages,
      wrongWay: p.wrongWayT > 1.2,
      dead: Math.max(0, p.dead),
      hitAngle, hitT: p.lastHitT,
      targetName, targetHp,
      finished: p.finished,
      dots: sim.ships.map((s) => ({ x: s.x, z: s.z, color: hexColor(s.def.colors.primary), isPlayer: s.isPlayer })),
      fps: Math.round(this.fps),
    };
    hudStore.publish(state);
    // low-hull warning chirp
    if (p.alive && p.hp < st.armour * 0.25 && sim.phase === 'racing' && !p.finished) {
      this.lowHpBeep -= 0.07;
      if (this.lowHpBeep <= 0) { this.lowHpBeep = 0.9; audio.ui('move'); }
    }
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.input.detach();
    audio.stopEngine();
    this.renderer.dispose();
    hudStore.reset();
  }
}
