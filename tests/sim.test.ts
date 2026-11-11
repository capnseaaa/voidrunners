import { describe, expect, it } from 'vitest';
import { RACES } from '../src/game/data/campaign';
import { ABILITIES, getPlayerShip, uniformLevels, ZERO_UPGRADES, type UpgradeLevels } from '../src/game/data/ships';
import { RaceSim, T_COMP, T_DRONE, T_SHIP } from '../src/game/sim/race';
import { MISSILE } from '../src/game/sim/weapons';
import { SHIP_RADIUS, type Ship } from '../src/game/sim/ship';
import { frameAt, newFrame } from '../src/game/tracks/track';

const DT = 1 / 60;

function make(raceId = 's1r1', ship = 'comet', up: UpgradeLevels = ZERO_UPGRADES, autopilot = false): RaceSim {
  const race = RACES.find((r) => r.id === raceId)!;
  return new RaceSim({ race, playerShip: getPlayerShip(ship), playerUpgrades: up, autopilot });
}
function run(sim: RaceSim, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) { sim.step(DT); each?.(); sim.events.clear(); }
}
function toGreen(sim: RaceSim): void { while (sim.phase === 'grid') { sim.step(DT); sim.events.clear(); } }
/** Park every AI ship far away so a test can study the player in isolation. */
function isolate(sim: RaceSim): void {
  sim.ships.slice(1).forEach((s, i) => { s.placeOnTrack(sim.track, 0, sim.track.length * 0.5 + i * 30, 0); s.dead = 1e9; });
}
function count(sim: RaceSim, type: string): number {
  let n = 0;
  for (let i = 0; i < sim.events.count; i++) if (sim.events.list[i].type === type) n++;
  return n;
}

describe('race start', () => {
  it('fields the player and nine AI racers on a grid behind the line, and holds them until GO', () => {
    const sim = make();
    expect(sim.ships).toHaveLength(10);
    expect(sim.ships.filter((s) => s.isPlayer)).toHaveLength(1);
    expect(sim.player.place).toBe(10);
    for (const s of sim.ships) { expect(s.total).toBeLessThan(0); expect(Math.abs(s.d)).toBeLessThan(s.hw - SHIP_RADIUS); }
    sim.player.ctl.throttle = 1;
    run(sim, 2);
    expect(sim.phase).toBe('grid');
    expect(sim.ships.every((s) => s.speed < 0.5)).toBe(true);
    toGreen(sim);
    run(sim, 2);
    expect(sim.player.fwdSpeed).toBeGreaterThan(40);
    expect(sim.ships.every((s) => s.fwdSpeed > 20)).toBe(true);
  });
});

describe('flight physics', () => {
  it('accelerates toward (never past) top speed; engine upgrades make the ship faster', () => {
    const speeds: number[] = [];
    for (const lv of [0, 5]) {
      const sim = make('s1r1', 'comet', { ...ZERO_UPGRADES, engines: lv });
      toGreen(sim); isolate(sim);
      sim.layout.pads.length = 0; // no boost pads: measure the bare engine
      sim.player.placeOnTrack(sim.track, 0, 20, 0);
      sim.player.ctl.throttle = 1;
      let max = 0;
      run(sim, 7, () => { max = Math.max(max, sim.player.fwdSpeed); });
      expect(max).toBeGreaterThan(sim.player.stats.topSpeed * 0.93);
      expect(max).toBeLessThanOrEqual(sim.player.stats.topSpeed * 1.001);
      speeds.push(max);
    }
    expect(speeds[1]).toBeGreaterThan(speeds[0] * 1.1);
  });

  it('steers left and right, brakes, and gives each ship distinct handling', () => {
    const turn: Record<string, number> = {};
    const sprint: Record<string, number> = {};
    for (const id of ['comet', 'bruiser', 'phantom', 'vulture']) {
      const sim = make('s4r1', id);
      toGreen(sim); isolate(sim);
      const p = sim.player;
      p.placeOnTrack(sim.track, 0, 20, 0);
      p.ctl.throttle = 1;
      run(sim, 2);
      sprint[id] = p.fwdSpeed;
      const yaw0 = p.yaw;
      p.ctl.steer = 1; run(sim, 0.4);
      const right = p.yaw - yaw0;
      p.ctl.steer = -1; run(sim, 0.8);
      const left = p.yaw - (yaw0 + right);
      expect(right).toBeLessThan(-0.2);
      expect(left).toBeGreaterThan(0.4);
      turn[id] = -right;
      p.ctl.steer = 0; p.ctl.throttle = 0; p.ctl.brake = 1;
      const v = p.fwdSpeed; run(sim, 0.5);
      expect(p.fwdSpeed).toBeLessThan(v - 25);
    }
    expect(turn.phantom).toBeGreaterThan(turn.comet * 1.2);
    expect(turn.comet).toBeGreaterThan(turn.bruiser);
    expect(sprint.comet).toBeGreaterThan(sprint.phantom);
    expect(sprint.phantom).toBeGreaterThan(sprint.bruiser);
  });

  it('keeps a ship inside the track walls and reports the collision', () => {
    const sim = make();
    toGreen(sim); isolate(sim);
    const p = sim.player;
    p.placeOnTrack(sim.track, 0, 30, 0);
    p.ctl.throttle = 1; p.ctl.steer = 1;
    let hits = 0, worst = -1e9;
    const fr = newFrame();
    run(sim, 6, () => {
      hits += count(sim, 'wallHit');
      frameAt(sim.track.paths[p.pathId], p.idx, p.f, fr);
      worst = Math.max(worst, Math.abs(p.d) - (fr.hw - SHIP_RADIUS));
    });
    expect(hits).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0.05);
  });

  it('boost drains its meter and raises speed; boost pads kick and recharge', () => {
    const sim = make();
    toGreen(sim); isolate(sim);
    const p = sim.player;
    p.placeOnTrack(sim.track, 0, 20, 0);
    p.ctl.throttle = 1; run(sim, 5);
    const cruise = p.fwdSpeed, b0 = p.boost;
    p.ctl.boost = true; run(sim, 2);
    expect(p.boost).toBeLessThan(b0 - 30);
    expect(p.fwdSpeed).toBeGreaterThan(cruise * 1.12);
    p.ctl.boost = false;
    const pad = sim.layout.pads[0];
    p.placeOnTrack(sim.track, pad.path, pad.s - 12, pad.d);
    p.boost = 10; p.padT = 0;
    let got = 0;
    run(sim, 1.2, () => { got += count(sim, 'boostPad'); });
    expect(got).toBe(1);
    expect(p.boost).toBeGreaterThan(25);
  });
});

describe('ship abilities', () => {
  const press = (sim: RaceSim) => { sim.player.ctl.ability = true; sim.step(DT); sim.events.clear(); sim.player.ctl.ability = false; };

  it('COMET afterburner bursts far beyond top speed, then goes on cooldown', () => {
    const sim = make('s1r1', 'comet');
    toGreen(sim); isolate(sim);
    const p = sim.player;
    p.placeOnTrack(sim.track, 0, 20, 0); p.ctl.throttle = 1; run(sim, 4);
    press(sim);
    expect(p.bursting).toBe(true);
    let max = 0; run(sim, ABILITIES.burst.duration, () => { max = Math.max(max, p.fwdSpeed); });
    expect(max).toBeGreaterThan(p.stats.topSpeed * 1.35);
    expect(p.abilityCd).toBeGreaterThan(5);
    const t = p.abilityT; press(sim);
    expect(p.abilityT).toBeLessThanOrEqual(Math.max(0, t)); // cannot re-trigger during cooldown
  });

  it('BRUISER bulwark soaks almost all incoming damage', () => {
    const sim = make('s1r1', 'bruiser');
    toGreen(sim); isolate(sim);
    const p = sim.player;
    const plain = sim.damageShip(p, 40, -1, 0, 0);
    expect(plain).toBeCloseTo(40, 5);
    press(sim);
    expect(p.bulwark).toBe(true);
    expect(sim.damageShip(p, 40, -1, 0, 0)).toBeLessThan(6);
  });

  it('PHANTOM phase dash lunges forward and ignores damage while phased', () => {
    const sim = make('s1r1', 'phantom');
    toGreen(sim); isolate(sim);
    const p = sim.player;
    p.placeOnTrack(sim.track, 0, 20, 0); p.ctl.throttle = 1; run(sim, 3);
    const v = p.fwdSpeed;
    press(sim);
    expect(p.phased).toBe(true);
    expect(p.fwdSpeed).toBeGreaterThan(v * 1.4);
    expect(sim.damageShip(p, 50, -1, 0, 0)).toBe(0);
    run(sim, ABILITIES.dash.duration + 0.1);
    expect(p.phased).toBe(false);
    expect(sim.damageShip(p, 5, -1, 0, 0)).toBeGreaterThan(0);
  });

  it('VULTURE magnet drags distant salvage in, and its hold is worth more', () => {
    const sim = make('s1r1', 'vulture');
    toGreen(sim); isolate(sim);
    const p = sim.player;
    p.placeOnTrack(sim.track, 0, 400, 0);
    for (const q of sim.layout.pickups) q.active = false;
    const spawn = () => sim.spawnPickup('scrap', 1, 0, 430, 10, p.x + p.hx * 30 + 10, p.y, p.z + p.hz * 30, p.x + p.hx * 30 + 10, p.y, p.z + p.hz * 30, 30);
    spawn();
    run(sim, 2);
    expect(p.salvage).toBe(0); // out of reach without the magnet
    press(sim);
    expect(p.magnet).toBe(true);
    run(sim, 2);
    expect(p.salvage).toBeCloseTo(1.6, 5); // 1 scrap x 1.6 salvage multiplier
  });
});

describe('combat', () => {
  it('blaster bolts damage rivals through shields then hull, and credit the attacker', () => {
    const sim = make();
    toGreen(sim); isolate(sim);
    const p = sim.player, t = sim.ships[1];
    p.placeOnTrack(sim.track, 0, 100, 0);
    t.dead = 0; t.placeOnTrack(sim.track, 0, 170, 0);
    sim.ai[1] = null as never; // target sits still
    const stepNoAi = (sec: number) => { for (let i = 0; i < sec / DT; i++) { t.ctl.throttle = 0; sim.step(DT); sim.events.clear(); } };
    sim.ai[1] = { update() { /* inert */ } } as never;
    sim.selectTarget(p);
    expect(p.targetKind).toBe(T_SHIP);
    expect(p.targetIdx).toBe(1);
    expect(p.targetRear).toBe(false);
    const hp0 = t.hp + t.shield;
    p.ctl.fire = true; stepNoAi(2);
    expect(t.shield).toBeLessThan(t.stats.shield);
    expect(t.hp + t.shield).toBeLessThan(hp0 - 8);
    expect(p.racerDamage).toBeGreaterThan(8);
    expect(p.heat).toBeGreaterThan(20);
  });

  it('blasters overheat under sustained fire and recover', () => {
    const sim = make();
    toGreen(sim); isolate(sim);
    const p = sim.player;
    p.ctl.fire = true; run(sim, 7);
    expect(p.overheated).toBe(true);
    const shots = sim.projectiles.activeCount;
    run(sim, 1.5);
    expect(sim.projectiles.activeCount).toBeLessThanOrEqual(shots);
    p.ctl.fire = false; run(sim, 3.5);
    expect(p.overheated).toBe(false);
  });

  it('missiles are limited, home on a rival and can wreck it; the wreck respawns', () => {
    const sim = make();
    toGreen(sim); isolate(sim);
    const p = sim.player, t = sim.ships[2];
    sim.ai[2] = { update() { /* inert */ } } as never;
    p.placeOnTrack(sim.track, 0, 100, 0);
    t.dead = 0; t.placeOnTrack(sim.track, 0, 190, 6);
    t.hp = 20; t.shield = 0;
    sim.selectTarget(p);
    const m0 = p.missiles;
    p.ctl.missile = true; sim.step(DT); p.ctl.missile = false;
    expect(p.missiles).toBe(m0 - 1);
    let destroyed = 0, respawned = 0;
    run(sim, 6, () => { destroyed += count(sim, 'shipDestroyed'); respawned += count(sim, 'respawn'); });
    expect(destroyed).toBe(1);
    expect(p.racerKills).toBe(1);
    expect(t.deaths).toBe(1);
    expect(respawned).toBe(1);
    expect(t.alive).toBe(true);
    expect(t.hp).toBe(t.stats.armour);
    p.missiles = 0; p.missileCd = 0; p.ctl.missile = true;
    const before = sim.projectiles.activeCount; sim.step(DT);
    expect(sim.projectiles.activeCount).toBeLessThanOrEqual(before);
  });

  it('weapon upgrades increase damage per shot and rate of fire in play', () => {
    const dealt: number[] = [];
    for (const lv of [0, 5]) {
      const sim = make('s1r1', 'comet', { ...ZERO_UPGRADES, weapons: lv });
      toGreen(sim); isolate(sim);
      const p = sim.player, t = sim.ships[1];
      sim.ai[1] = { update() { /* inert */ } } as never;
      p.placeOnTrack(sim.track, 0, 100, 0);
      t.dead = 0; t.placeOnTrack(sim.track, 0, 160, 0);
      t.hp = 1e6; t.shield = 0; t.shieldDelayT = 1e9;
      sim.selectTarget(p);
      p.ctl.fire = true; run(sim, 3);
      dealt.push(p.racerDamage);
    }
    expect(dealt[1]).toBeGreaterThan(dealt[0] * 1.4);
  });
});

describe('capital ship', () => {
  it('has shield generator, weapon batteries, engines and a cargo bay with per-component health', () => {
    const cap = make().capital;
    const types = cap.components.map((c) => c.type);
    expect(types.filter((t) => t === 'shield')).toHaveLength(1);
    expect(types.filter((t) => t === 'battery').length).toBeGreaterThanOrEqual(3);
    expect(types.filter((t) => t === 'engine').length).toBeGreaterThanOrEqual(2);
    expect(types.filter((t) => t === 'cargo')).toHaveLength(1);
    expect(cap.hp).toBe(cap.maxHp);
    expect(cap.length).toBeGreaterThan(450);
  });

  it('shield generator protects everything else until it is destroyed', () => {
    const sim = make();
    toGreen(sim);
    const cap = sim.capital, p = sim.player;
    const gen = cap.components.find((c) => c.type === 'shield')!;
    const gun = cap.components.find((c) => c.type === 'battery')!;
    expect(cap.damage(gun, 200, 0, sim, 0, 0, 0)).toBe(0);
    expect(gun.hp).toBe(gun.maxHp);
    expect(cap.damage(gen, 200, 0, sim, 0, 0, 0)).toBe(200);
    expect(gen.hp).toBe(gen.maxHp - 200);
    cap.damage(gen, 1e6, 0, sim, 0, 0, 0);
    expect(gen.alive).toBe(false);
    expect(cap.shieldUp).toBe(false);
    expect(cap.damage(gun, 150, 0, sim, 0, 0, 0)).toBe(150);
    expect(gun.hp).toBe(gun.maxHp - 150);
    // only the damaged component changed
    for (const c of cap.components) if (c !== gun && c !== gen) expect(c.hp).toBe(c.maxHp);
    expect(p.capitalDamage).toBe(gen.maxHp + 150);
    expect(p.capitalKills).toBe(1);
    expect(p.capitalKillBonus).toBeGreaterThan(0);
  });

  it('racer weapons really damage components (projectile hits, not scripted)', () => {
    const sim = make();
    toGreen(sim); isolate(sim);
    const cap = sim.capital, p = sim.player;
    const gen = cap.components.find((c) => c.type === 'shield')!;
    p.placeOnTrack(sim.track, 0, gen.trackS - 150, 0);
    sim.selectTarget(p);
    expect(p.targetKind).toBe(T_COMP);
    expect(cap.components[p.targetIdx].type).toBe('shield'); // only the generator is exposed
    p.ctl.fire = true;
    let hits = 0;
    run(sim, 1.5, () => { hits += count(sim, 'componentHit'); });
    expect(hits).toBeGreaterThan(3);
    expect(gen.hp).toBeLessThan(gen.maxHp);
    expect(cap.damageBy[0]).toBeCloseTo(gen.maxHp - gen.hp, 3);
    // a missile hits much harder than a bolt
    const hp = gen.hp;
    p.ctl.fire = false; p.ctl.missile = true; sim.step(DT); p.ctl.missile = false;
    run(sim, 3);
    expect(hp - gen.hp).toBeGreaterThan(p.stats.weaponDamage * 5);
  });

  it('fires on racers and bombards the track; fewer batteries mean fewer hazards', () => {
    const volume = (killBatteries: number): number => {
      const sim = make('s1r2');
      toGreen(sim);
      const cap = sim.capital;
      const guns = cap.components.filter((c) => c.type === 'battery');
      for (let i = 0; i < killBatteries; i++) { guns[i].alive = false; guns[i].hp = 0; }
      const mid = (sim.track.capitalFromS + sim.track.capitalToS) / 2;
      let n = 0;
      for (let k = 0; k < 60 * 90; k++) {
        // hold every racer in the encounter zone, invulnerable, so only the capital ship acts
        sim.ships.forEach((s, i) => { s.placeOnTrack(sim.track, 0, mid - 200 + i * 40, 0); s.invuln = 1; s.dead = 0; });
        cap.update(DT, sim);
        n += count(sim, 'capitalFire') + count(sim, 'strikeWarn') * 3 + count(sim, 'enemyMissile') * 3;
        sim.events.clear();
      }
      return n;
    };
    const full = volume(0), one = volume(3), none = volume(4);
    expect(full).toBeGreaterThan(60);
    expect(one).toBeLessThan(full * 0.6);
    expect(none).toBe(0);
  });

  it('capital weapons hurt: bolts and bombardment damage racers', () => {
    const sim = make('s1r2');
    toGreen(sim);
    const mid = (sim.track.capitalFromS + sim.track.capitalToS) / 2;
    let dmg = 0;
    for (let k = 0; k < 60 * 60; k++) {
      sim.ships.forEach((s, i) => { if (s.alive) { const hp = s.hp + s.shield; s.placeOnTrack(sim.track, 0, mid - 200 + i * 40, 0); void hp; } });
      sim.ai.forEach((_, i) => { sim.ai[i] = { update() { /* inert */ } } as never; });
      sim.step(DT);
      for (let i = 0; i < sim.events.count; i++) { const e = sim.events.list[i]; if (e.type === 'hit' || e.type === 'shieldHit') dmg += e.a; }
      sim.events.clear();
    }
    expect(dmg).toBeGreaterThan(100);
  });

  it('destroying an engine grants overdrive; destroying the cargo bay drops valuable salvage', () => {
    const sim = make();
    toGreen(sim);
    const cap = sim.capital, p = sim.player;
    cap.damage(cap.components.find((c) => c.type === 'shield')!, 1e6, 1, sim, 0, 0, 0);
    const dyn = () => sim.layout.pickups.filter((q) => q.dynamic && q.active);
    expect(p.overdriveT).toBe(0);
    p.boost = 5;
    cap.damage(cap.components.find((c) => c.type === 'engine')!, 1e6, 0, sim, 0, 0, 0);
    expect(p.overdriveT).toBeGreaterThan(5);
    expect(p.boost).toBe(100);
    expect(dyn().filter((q) => q.kind === 'overdrive').length).toBe(3);
    const s0 = p.salvage;
    cap.damage(cap.components.find((c) => c.type === 'cargo')!, 1e6, 0, sim, 0, 0, 0);
    const cargo = dyn().filter((q) => q.kind === 'cargo');
    expect(cargo.length).toBeGreaterThanOrEqual(10);
    expect(cargo.every((q) => q.value >= 3)).toBe(true);
    expect(p.salvage).toBeGreaterThan(s0);
    // drops land on the drivable ribbon
    const fr = newFrame();
    for (const q of cargo) { frameAt(sim.track.main, Math.floor(q.s / sim.track.main.step), 0, fr); expect(Math.abs(q.d)).toBeLessThan(fr.hw); }
    // overdrive really is faster
    expect(cap.destroyed).toBe(false);
    for (const c of cap.components) cap.damage(c, 1e6, 2, sim, 0, 0, 0);
    expect(cap.destroyed).toBe(true);
    expect(cap.hp).toBe(0);
    // contribution is tracked per racer
    expect(cap.damageBy[0]).toBeGreaterThan(0);
    expect(cap.damageBy[1]).toBeGreaterThan(0);
    expect(cap.damageBy[2]).toBeGreaterThan(0);
    expect(cap.damageBy.reduce((a, b) => a + b, 0)).toBeCloseTo(cap.totalDamage, 3);
    expect(cap.totalDamage).toBeCloseTo(cap.maxHp, 3);
  });
});

describe('salvage and hazards', () => {
  it('collecting salvage adds to the hold and the pickup respawns later', () => {
    const sim = make();
    toGreen(sim); isolate(sim);
    const p = sim.player;
    const q = sim.layout.pickups.find((k) => k.kind === 'scrap' && k.path === 0)!;
    p.placeOnTrack(sim.track, 0, q.s - 15, q.d);
    p.ctl.throttle = 1;
    run(sim, 1.5);
    expect(p.salvage).toBeGreaterThanOrEqual(1);
    expect(q.active).toBe(false);
    run(sim, 14);
    expect(q.active).toBe(true);
  });

  it('solid hazards stop a ship and hurt it', () => {
    const sim = make('s2r1');
    toGreen(sim); isolate(sim);
    const p = sim.player;
    const o = sim.layout.obstacles.find((k) => k.kind === 'asteroid' && k.amp === 0 && k.path === 0)!;
    o.maxHp = 0; // make it indestructible for the test
    p.placeOnTrack(sim.track, 0, o.s - 60, o.d);
    p.vx = p.hx * 110; p.vz = p.hz * 110; p.ctl.throttle = 1;
    const hp = p.hp + p.shield;
    let bumps = 0;
    run(sim, 1, () => { bumps += count(sim, 'wallHit'); });
    expect(bumps).toBeGreaterThan(0);
    expect(p.hp + p.shield).toBeLessThan(hp);
    expect(Math.hypot(p.x - o.x, p.z - o.z)).toBeGreaterThanOrEqual(o.r + SHIP_RADIUS - 0.01);
  });
});

function shipSummary(s: Ship) {
  return { name: s.name, pos: s.finishPos, time: s.finishTime, dnf: s.dnf, salvage: s.salvage, cap: s.capitalDamage, racer: s.racerDamage };
}

describe('rear-facing combat and countermeasures', () => {
  const setup = () => {
    const sim = make();
    toGreen(sim); isolate(sim);
    const p = sim.player, t = sim.ships[3];
    sim.ai[3] = { update() { /* inert */ } } as never;
    p.placeOnTrack(sim.track, 0, 300, 0);
    t.dead = 0; t.placeOnTrack(sim.track, 0, 230, 2); // 70 units behind the player
    return { sim, p, t };
  };

  it('locks a pursuer behind the ship and the rear gun hits it', () => {
    const { sim, p, t } = setup();
    sim.selectTarget(p);
    expect(p.targetKind).toBe(T_SHIP);
    expect(p.targetIdx).toBe(3);
    expect(p.targetRear).toBe(true);
    const hp = t.hp + t.shield;
    p.ctl.fire = true;
    let lockSeen = false;
    run(sim, 2, () => { if (t.lockedT > 0 && t.lockedBy === 0) lockSeen = true; });
    expect(t.hp + t.shield).toBeLessThan(hp - 5);
    expect(lockSeen).toBe(true); // the target is warned that it is being fired on
  });

  it('launches missiles backwards onto a pursuer', () => {
    const { sim, p, t } = setup();
    t.hp = 15; t.shield = 0;
    sim.selectTarget(p);
    p.ctl.missile = true; sim.step(DT); p.ctl.missile = false;
    const m = sim.projectiles.items.find((q) => q.active && q.kind === MISSILE)!;
    expect(m.vx * p.hx + m.vz * p.hz).toBeLessThan(0); // leaves the tail rail heading backwards
    run(sim, 3);
    expect(t.deaths).toBe(1);
    expect(p.racerKills).toBe(1);
  });

  it('wrecking a rival pays a bounty on the spot: boost and a missile', () => {
    const { sim, p, t } = setup();
    p.boost = 10; p.missiles = 1;
    let bounty = 0;
    sim.damageShip(t, 1e5, 0, p.x, p.z);
    for (let i = 0; i < sim.events.count; i++) if (sim.events.list[i].type === 'bounty') bounty++;
    expect(bounty).toBe(1);
    expect(p.boost).toBeGreaterThanOrEqual(50);
    expect(p.missiles).toBe(2);
    expect(p.score).toBeGreaterThan(100);
  });

  it('warns of an inbound enemy missile and flares (tap boost) break its lock', () => {
    const fire = (sim: RaceSim) => {
      const p = sim.player;
      const m = sim.projectiles.spawn();
      m.kind = MISSILE; m.owner = -1; m.x = m.px = p.x - p.hx * 150; m.y = m.py = p.y; m.z = m.pz = p.z - p.hz * 150;
      m.speed = 150; m.maxSpeed = 188; m.turn = 2.2; m.vx = p.hx * 150; m.vy = 0; m.vz = p.hz * 150;
      m.life = 7; m.damage = 26; m.tKind = T_SHIP; m.tIdx = 0;
    };
    // no countermeasures: it hits
    const a = make(); toGreen(a); isolate(a);
    a.player.placeOnTrack(a.track, 0, 300, 0);
    fire(a);
    let warned = false;
    const hpA = a.player.hp + a.player.shield;
    run(a, 3, () => { if (a.player.missileLockT > 0) warned = true; });
    expect(warned).toBe(true);
    expect(a.player.hp + a.player.shield).toBeLessThan(hpA);
    // flares: tap boost while it is tracking
    const b = make(); toGreen(b); isolate(b);
    b.player.placeOnTrack(b.track, 0, 300, 0);
    fire(b);
    const hpB = b.player.hp + b.player.shield;
    let flares = 0;
    run(b, 0.3);
    b.player.ctl.boost = true; b.step(DT); flares += count(b, 'flare'); b.events.clear(); b.player.ctl.boost = false;
    run(b, 3);
    expect(flares).toBe(1);
    expect(b.player.hp + b.player.shield).toBe(hpB);
    expect(b.player.flareCd).toBeGreaterThan(0); // and they need time to reload
  });
});

describe('enemy fighters', () => {
  it('chase racers, shoot them from behind, and can be shot down for a reward', () => {
    const sim = make('s2r2');
    expect(sim.drones.drones.length).toBeGreaterThan(0);
    toGreen(sim); isolate(sim);
    const p = sim.player, d = sim.drones.drones[0];
    sim.player.placeOnTrack(sim.track, 0, 300, 0);
    p.ctl.throttle = 1;
    // bring one in right behind the player
    d.active = true; d.hp = d.maxHp = 30; d.x = p.x - p.hx * 60; d.z = p.z - p.hz * 60; d.y = p.y + 2; d.target = 0; d.retargetT = 99; d.attackT = 99; d.breakT = 0; d.fireT = 0;
    let fired = 0, dmg = 0, locked = false;
    run(sim, 5, () => {
      fired += count(sim, 'droneFire');
      for (let i = 0; i < sim.events.count; i++) { const e = sim.events.list[i]; if ((e.type === 'hit' || e.type === 'shieldHit') && e.ship === 0) dmg += e.a; }
      if (p.lockedT > 0) locked = true;
      d.retargetT = 99;
    });
    expect(fired).toBeGreaterThan(3);
    expect(dmg).toBeGreaterThan(0);
    expect(locked).toBe(true);
    expect(Math.hypot(d.x - p.x, d.z - p.z)).toBeLessThan(160); // it kept up
    // the rear gun picks it up and kills it
    sim.selectTarget(p);
    expect(p.targetKind).toBe(T_DRONE);
    expect(p.targetRear).toBe(true);
    p.ctl.fire = true;
    let down = 0;
    run(sim, 6, () => { down += count(sim, 'droneDestroyed'); d.retargetT = 99; if (d.active) d.attackT = 99; });
    expect(down).toBeGreaterThanOrEqual(1);
    expect(p.droneKills).toBeGreaterThanOrEqual(1);
    expect(p.score).toBeGreaterThanOrEqual(100);
  });
});

describe('capital ship systems matter', () => {
  it('engines feed the guns: each one lost slows the whole ship', () => {
    const cap = make().capital;
    expect(cap.power).toBe(1);
    const engines = cap.components.filter((c) => c.type === 'engine');
    engines[0].alive = false;
    expect(cap.power).toBeCloseTo(0.7, 5);
    engines[1].alive = false;
    expect(cap.power).toBeCloseTo(0.4, 5);
  });

  it('the cargo bay runs repairs: damaged systems heal until it is destroyed', () => {
    const sim = make();
    toGreen(sim);
    const cap = sim.capital;
    const gen = cap.components.find((c) => c.type === 'shield')!;
    cap.damage(gen, 300, 1, sim, 0, 0, 0);
    const hp = gen.hp;
    for (let i = 0; i < 600; i++) { cap.update(DT, sim); sim.events.clear(); }
    expect(gen.hp).toBeGreaterThan(hp + 10);
    expect(cap.repairing).toBe(true);
    cap.damage(gen, 1e6, 1, sim, 0, 0, 0);
    const gun = cap.components.find((c) => c.type === 'battery')!;
    cap.damage(cap.components.find((c) => c.type === 'cargo')!, 1e6, 1, sim, 0, 0, 0);
    expect(cap.repairing).toBe(false);
    cap.damage(gun, 100, 1, sim, 0, 0, 0);
    const g2 = gun.hp;
    for (let i = 0; i < 600; i++) { cap.update(DT, sim); sim.events.clear(); }
    expect(gun.hp).toBe(g2);
  });

  it('launches guided missiles and drops wreckage onto the route when systems are shot off', () => {
    const sim = make('s1r2');
    toGreen(sim);
    const cap = sim.capital;
    const mid = (sim.track.capitalFromS + sim.track.capitalToS) / 2;
    let missiles = 0;
    for (let k = 0; k < 60 * 60; k++) {
      sim.ships.forEach((s, i) => { s.placeOnTrack(sim.track, 0, mid - 200 + i * 40, 0); s.invuln = 1; s.dead = 0; });
      cap.update(DT, sim);
      missiles += count(sim, 'enemyMissile');
      sim.events.clear();
    }
    expect(missiles).toBeGreaterThan(3);
    const slots = () => sim.layout.obstacles.filter((o) => o.slot && o.alive).length;
    expect(slots()).toBe(0);
    sim.ships.forEach((s) => s.placeOnTrack(sim.track, 0, 100, 0)); // clear the zone
    cap.damage(cap.components.find((c) => c.type === 'shield')!, 1e6, 0, sim, 0, 0, 0);
    expect(slots()).toBeGreaterThan(0);
  });
});

describe('open-space battles', () => {
  it('fly free inside the battle zone, are scored by points, and end on the clock', () => {
    const race = RACES.find((r) => r.mode === 'battle')!;
    const sim = make(race.id, 'comet', ZERO_UPGRADES, true);
    expect(sim.mode).toBe('battle');
    expect(sim.track.arena).toBeGreaterThan(0);
    let far = 0, steps = 0, downs = 0, playerDeaths = 0;
    while (sim.phase !== 'done' && steps < 60 * 300) {
      sim.step(DT); steps++;
      downs += count(sim, 'droneDestroyed');
      for (let i = 0; i < sim.events.count; i++) { const e = sim.events.list[i]; if (e.type === 'shipDestroyed' && e.a === 1 && e.ship === 0) playerDeaths++; }
      sim.events.clear();
      for (const s of sim.ships) far = Math.max(far, Math.hypot(s.x, s.z));
    }
    expect(sim.phase).toBe('done');
    expect(sim.time).toBeGreaterThanOrEqual(race.timeLimit);
    expect(sim.time).toBeLessThan(race.timeLimit + 1);
    expect(far).toBeLessThanOrEqual(sim.track.arena + 0.5);
    expect(downs).toBeGreaterThan(20);
    expect(sim.ships.every((s) => s.finished && !s.dnf)).toBe(true);
    const order = sim.ships.slice().sort((a, b) => a.finishPos - b.finishPos);
    expect(order.map((s) => s.finishPos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 1; i < order.length; i++) expect(order[i].score).toBeLessThanOrEqual(order[i - 1].score);
    expect(sim.ships.filter((s) => s.droneKills > 0).length).toBeGreaterThanOrEqual(7);
    expect(sim.capital.totalDamage).toBeGreaterThan(0);
    expect(sim.player.score).toBeGreaterThan(0);
    expect(playerDeaths).toBe(sim.player.deaths); // the player's ship can be destroyed here too
  });

  it('a wrecked ship re-enters from the edge of the zone', () => {
    const sim = make(RACES.find((r) => r.mode === 'battle')!.id);
    toGreen(sim);
    const p = sim.player;
    sim.damageShip(p, 1e6, -1, 0, 0);
    expect(p.alive).toBe(false);
    run(sim, 2.6);
    expect(p.alive).toBe(true);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(sim.track.arena * 0.7);
    expect(p.invuln).toBeGreaterThan(0);
  });
});

describe('battleship surface races', () => {
  it('the ship breaks up lap by lap: new wreckage and fires appear at each phase', () => {
    const sim = make('s4s', 'comet', uniformLevels(4), true);
    expect(sim.race.dying).toBe(true);
    const live = () => sim.layout.obstacles.filter((o) => o.phase > 0 && o.alive).length;
    expect(live()).toBe(0);
    const seen: number[] = [];
    let steps = 0, strikes = 0;
    const counts: number[] = [0, 0, 0];
    while (sim.phase !== 'done' && steps < 60 * 400) {
      sim.step(DT); steps++;
      for (let i = 0; i < sim.events.count; i++) { const e = sim.events.list[i]; if (e.type === 'phase') { seen.push(e.a); counts[e.a] = live(); } if (e.type === 'strike') strikes++; }
      sim.events.clear();
    }
    expect(seen).toEqual([1, 2]);
    expect(counts[1]).toBeGreaterThan(5);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(sim.warPhase).toBe(2);
    expect(strikes).toBeGreaterThan(8); // stray fleet fire lands on the hull throughout
    expect(sim.ships.every((s) => s.finished && !s.dnf && s.lap === 3)).toBe(true); // the route stays passable to the end
  });
});

describe('AI pilots', () => {
  it('are imperfect shots, while the player\'s aim assist is exact', () => {
    const sim = make();
    expect(sim.player.aimError).toBe(0);
    const errs = sim.ships.slice(1).map((s) => s.aimError);
    expect(Math.min(...errs)).toBeGreaterThan(0.03);
    const by = Object.fromEntries(sim.ships.slice(1).map((s) => [s.name, s.aimError]));
    expect(by.MERCENARY).toBeLessThan(by.ROOKIE);
  });

  it('cautious racers stop picking fights when badly hurt; berserkers do the opposite', () => {
    const hostileShots = (name: string, hpFrac: number): number => {
      const sim = make('s1r1');
      toGreen(sim); isolate(sim);
      const a = sim.ships.find((s) => s.name === name)!, t = sim.player;
      sim.ai[0] = { update() { /* inert */ } } as never;
      let shots = 0;
      for (let k = 0; k < 60 * 40; k++) {
        a.dead = 0; a.invuln = 0; a.heat = 0; a.overheated = false;
        a.placeOnTrack(sim.track, 0, 400, 0); t.placeOnTrack(sim.track, 0, 470, 0); t.invuln = 1;
        a.hp = a.stats.armour * hpFrac; a.lastHitT = 99;
        sim.selectTarget(a);
        sim.ai[a.index]!.update(DT, sim);
        if (a.ctl.fire && a.targetKind === T_SHIP) shots++;
      }
      return shots;
    };
    expect(hostileShots('TANK', 0.2)).toBe(0); // cautious brawler: survival first
    expect(hostileShots('PSYCHO', 0.2)).toBeGreaterThan(hostileShots('PSYCHO', 1) * 0.9);
    expect(hostileShots('PSYCHO', 0.2)).toBeGreaterThan(200);
  });
});

describe('full races', () => {
  const agg: Record<string, { salvage: number; cap: number; racer: number; shortcut: number; risky: number; pos: number }> = {};

  it.each(RACES.filter((r) => r.mode === 'race').map((r) => [r.id, r.name] as const))('%s %s: all ten racers race three laps and finish under identical rules', (id) => {
    const sim = make(id, 'comet', uniformLevels(Math.min(5, Math.round(RACES.find((r) => r.id === id)!.aiLevel))), true);
    const L = sim.track.length, K = sim.track.checkpoints.length;
    const prev = sim.ships.map((s) => ({ x: s.x, z: s.z, alive: true, total: s.total }));
    const onPath = sim.ships.map(() => [0, 0, 0]);
    const maxSpeed = sim.ships.map(() => 0);
    const shots = sim.ships.map(() => 0);
    let steps = 0, teleports = 0, order = true;
    while (sim.phase !== 'done' && steps < 60 * 600) {
      sim.step(DT); steps++;
      for (let i = 0; i < sim.events.count; i++) { const e = sim.events.list[i]; if ((e.type === 'shoot' || e.type === 'missile') && e.ship >= 0) shots[e.ship]++; }
      sim.events.clear();
      for (const s of sim.ships) {
        const p = prev[s.index];
        if (s.alive && p.alive) {
          const moved = Math.hypot(s.x - p.x, s.z - p.z);
          // nothing moves faster than the physics allows (dash peak is 1.7x top speed), plus collision push-out slack
          if (moved > s.stats.topSpeed * 1.75 * DT + 6) teleports++;
          if (!s.finished) maxSpeed[s.index] = Math.max(maxSpeed[s.index], s.fwdSpeed);
          if (!s.finished) onPath[s.index][s.pathId]++;
        }
        p.x = s.x; p.z = s.z; p.alive = s.alive;
      }
      // live positions always follow checkpoint count, then progress
      if (steps % 30 === 0) {
        for (let k = 1; k < sim.order.length; k++) {
          const a = sim.ships[sim.order[k - 1]], b = sim.ships[sim.order[k]];
          if (!a.finished && !b.finished && (a.cpCount < b.cpCount || (a.cpCount === b.cpCount && a.total < b.total))) order = false;
        }
      }
    }
    expect(sim.phase).toBe('done');
    expect(teleports).toBe(0);
    expect(order).toBe(true);
    const fin = sim.ships.map(shipSummary).sort((a, b) => a.pos - b.pos);
    expect(fin.map((f) => f.pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(fin.every((f) => !f.dnf)).toBe(true);
    for (let i = 1; i < fin.length; i++) expect(fin[i].time).toBeGreaterThanOrEqual(fin[i - 1].time);
    for (const s of sim.ships) {
      expect(s.lap).toBe(3);
      expect(s.cpCount).toBe(3 * K + 1); // start line + every checkpoint of every lap, in order
      expect(s.total).toBeGreaterThanOrEqual(3 * L - 1);
      expect(s.bestLap).toBeGreaterThan(28);
      expect(maxSpeed[s.index]).toBeLessThanOrEqual(s.stats.topSpeed * 1.75);
      expect(shots[s.index]).toBeGreaterThan(0); // everyone fires weapons at some point
    }
    // race length target: about 2 to 2.5 minutes (the fastest AI on a late, fully upgraded grid dips under)
    expect(fin[0].time).toBeGreaterThan(95);
    expect(fin[0].time).toBeLessThan(160);
    expect(fin[9].time).toBeLessThan(210);
    // the capital ship was attacked by many racers and damage was attributed
    const cap = sim.capital;
    expect(cap.totalDamage).toBeGreaterThan(cap.maxHp * 0.25);
    expect(cap.damageBy.filter((d) => d > 0).length).toBeGreaterThanOrEqual(5);
    expect(cap.damageBy.reduce((a, b) => a + b, 0)).toBeCloseTo(cap.totalDamage, 2);
    expect(sim.ships.filter((s) => s.salvage > 0).length).toBeGreaterThanOrEqual(8);
    for (const s of sim.ships) {
      const a = (agg[s.name] ??= { salvage: 0, cap: 0, racer: 0, shortcut: 0, risky: 0, pos: 0 });
      a.salvage += s.salvage; a.cap += s.capitalDamage; a.racer += s.racerDamage; a.pos += s.finishPos;
      sim.track.paths.forEach((p, i) => { if (p.kind === 'shortcut') a.shortcut += onPath[s.index][i]; if (p.kind === 'risky') a.risky += onPath[s.index][i]; });
    }
  });

  it('AI personalities show up in the results across the campaign', () => {
    const names = Object.keys(agg).filter((n) => n !== 'YOU');
    expect(names).toHaveLength(9);
    const top = (k: keyof (typeof agg)[string], n = 1) => [...names].sort((a, b) => agg[b][k] - agg[a][k]).slice(0, n);
    if (process.env.SHOW) console.log(Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, Math.round(b)]))])));
    expect(top('salvage')[0]).toBe('SCAVENGER');
    expect(top('cap', 2)).toContain('MERCENARY');
    expect(top('racer', 2)).toContain('PSYCHO');
    expect(top('shortcut')[0]).toBe('GHOST');
    expect(top('risky')[0]).toBe('SHOWOFF');
    // Ace is quick, Rookie is not
    expect(agg.ACE.pos).toBeLessThan(agg.ROOKIE.pos);
  });
});
