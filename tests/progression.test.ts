import { describe, expect, it } from 'vitest';
import { POSITION_CREDITS, RACES, SHIP_UNLOCKS, STAGES } from '../src/game/data/campaign';
import { computeRewards, type RaceOutcome } from '../src/game/data/rewards';
import { AI_RACERS, computeStats, MAX_UPGRADE_LEVEL, PLAYER_SHIPS, UPGRADE_CATEGORIES, upgradeCost, uniformLevels, ZERO_UPGRADES } from '../src/game/data/ships';
import {
  applyRaceResult, buyShip, buyUpgrade, defaultSave, isRaceUnlocked, isStageUnlocked, loadSave, migrateSave, resetSave, sanitizeSave, SAVE_KEY, SAVE_VERSION,
  shipLockState, writeSave, type StorageLike,
} from '../src/game/save/save';

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

const outcome = (o: Partial<RaceOutcome> = {}): RaceOutcome => ({
  position: 1, finished: true, time: 250, bestLap: 80, salvage: 20, deaths: 0, racerKills: 0, racerDamage: 0,
  capitalDamage: 0, capitalTotalDamage: 0, capitalKills: 0, capitalDestroyed: false, capitalKillBonus: 0, ...o,
});

describe('campaign structure', () => {
  it('has 4 stages of 3 races: standard, capital challenge, championship', () => {
    expect(STAGES.map((s) => s.name)).toEqual(['NEON FRONTIER', 'DEAD ORBIT', 'SOLAR SCAR', 'WARZONE ZERO']);
    expect(RACES).toHaveLength(12);
    for (let st = 0; st < 4; st++) {
      const rs = RACES.filter((r) => r.stage === st);
      expect(rs.map((r) => r.type)).toEqual(['standard', 'capital', 'championship']);
      expect(rs.every((r) => r.laps === 3 && r.track === STAGES[st].track)).toBe(true);
    }
    expect(new Set(RACES.map((r) => r.id)).size).toBe(12);
  });

  it('pays the specified credits per finishing position', () => {
    expect(POSITION_CREDITS).toEqual([1000, 800, 650, 450, 450, 300, 300, 200, 200, 200]);
    for (let pos = 1; pos <= 10; pos++) {
      const rw = computeRewards(RACES[0], outcome({ position: pos, salvage: 0, deaths: 1 }));
      expect(rw.positionCredits).toBe(POSITION_CREDITS[pos - 1]);
    }
  });

  it('always awards progression currency, even for a last place or a DNF', () => {
    const last = computeRewards(RACES[0], outcome({ position: 10, salvage: 0, deaths: 9 }));
    expect(last.totalCredits).toBeGreaterThanOrEqual(200);
    const dnf = computeRewards(RACES[5], outcome({ position: 10, finished: false, salvage: 3 }));
    expect(dnf.totalCredits).toBeGreaterThan(0);
    expect(dnf.unlockedNext).toBe(false);
  });

  it('adds combat, capital ship, salvage and objective bonuses', () => {
    const base = computeRewards(RACES[1], outcome({ position: 5, salvage: 0 }));
    const rich = computeRewards(RACES[1], outcome({ position: 5, salvage: 30, racerKills: 2, racerDamage: 300, capitalDamage: 1500, capitalTotalDamage: 6000, capitalKills: 2, capitalKillBonus: 300, capitalDestroyed: true }));
    expect(rich.combatCredits).toBeGreaterThan(base.combatCredits);
    expect(rich.capitalCredits).toBeGreaterThan(700);
    expect(rich.salvage).toBe(30);
    expect(rich.objectives.every((o) => o.done)).toBe(true);
    expect(rich.objectiveCredits).toBe(RACES[1].objectives.reduce((a, o) => a + o.bonus, 0));
    expect(rich.totalCredits).toBe(rich.positionCredits + rich.combatCredits + rich.capitalCredits + rich.objectiveCredits + rich.salvageCredits);
  });
});

describe('ships and upgrades', () => {
  it('defines four distinct player ships with the required roles and abilities', () => {
    expect(PLAYER_SHIPS.map((s) => s.id)).toEqual(['comet', 'bruiser', 'phantom', 'vulture']);
    const [comet, bruiser, phantom, vulture] = PLAYER_SHIPS.map((s) => s.stats);
    expect(comet.topSpeed).toBeGreaterThan(Math.max(bruiser.topSpeed, phantom.topSpeed, vulture.topSpeed));
    expect(comet.accel).toBeGreaterThan(Math.max(bruiser.accel, phantom.accel, vulture.accel));
    expect(bruiser.armour).toBeGreaterThan(Math.max(comet.armour, phantom.armour, vulture.armour));
    expect(bruiser.weaponDamage).toBeGreaterThan(comet.weaponDamage);
    expect(phantom.turnRate).toBeGreaterThan(Math.max(comet.turnRate, bruiser.turnRate, vulture.turnRate));
    expect(vulture.salvageMult).toBeGreaterThan(1);
    expect(PLAYER_SHIPS.map((s) => s.ability)).toEqual(['burst', 'bulwark', 'dash', 'magnet']);
    expect(new Set(PLAYER_SHIPS.map((s) => s.model)).size).toBe(4);
  });

  it('defines nine named AI racers, each with its own ship model', () => {
    expect(AI_RACERS.map((r) => r.name)).toEqual(['ACE', 'ROOKIE', 'TANK', 'SCAVENGER', 'GHOST', 'PSYCHO', 'VETERAN', 'SHOWOFF', 'MERCENARY']);
    expect(new Set(AI_RACERS.map((r) => r.ship.model)).size).toBe(9);
    const by = Object.fromEntries(AI_RACERS.map((r) => [r.id, r.personality]));
    expect(by.rookie.mistakeRate).toBe(Math.max(...AI_RACERS.map((r) => r.personality.mistakeRate)));
    expect(by.scavenger.salvageBias).toBe(1);
    expect(by.ghost.shortcutBias).toBe(1);
    expect(by.psycho.aggression).toBe(1);
    expect(by.showoff.riskBias).toBe(1);
    expect(by.mercenary.capitalBias).toBe(1);
    expect(by.veteran.mistakeRate).toBe(Math.min(...AI_RACERS.map((r) => r.personality.mistakeRate)));
  });

  it('every upgrade level changes real gameplay stats', () => {
    for (const ship of PLAYER_SHIPS) {
      let prev = computeStats(ship, ZERO_UPGRADES);
      for (let lv = 1; lv <= MAX_UPGRADE_LEVEL; lv++) {
        const s = computeStats(ship, uniformLevels(lv));
        expect(s.topSpeed).toBeGreaterThan(prev.topSpeed);
        expect(s.accel).toBeGreaterThan(prev.accel);
        expect(s.turnRate).toBeGreaterThan(prev.turnRate);
        expect(s.armour).toBeGreaterThan(prev.armour);
        expect(s.weaponDamage).toBeGreaterThan(prev.weaponDamage);
        expect(s.fireRate).toBeGreaterThan(prev.fireRate);
        expect(s.shield).toBeGreaterThan(prev.shield);
        expect(s.shieldRegen).toBeGreaterThan(prev.shieldRegen);
        prev = s;
      }
    }
    // categories are independent
    const eng = computeStats(PLAYER_SHIPS[0], { ...ZERO_UPGRADES, engines: 3 });
    expect(eng.armour).toBe(PLAYER_SHIPS[0].stats.armour);
  });

  it('has five categories of five levels; levels 4-5 need salvage', () => {
    expect(UPGRADE_CATEGORIES).toHaveLength(5);
    for (let lv = 0; lv < 5; lv++) {
      const c = upgradeCost(lv)!;
      expect(c.credits).toBeGreaterThan(0);
      expect(c.salvage > 0).toBe(lv >= 3);
    }
    expect(upgradeCost(5)).toBeNull();
  });
});

describe('save data', () => {
  it('starts with safe defaults: Comet only, nothing unlocked beyond race 1', () => {
    const s = defaultSave();
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.unlockedShips).toEqual(['comet']);
    expect(isRaceUnlocked(s, RACES[0])).toBe(true);
    expect(isRaceUnlocked(s, RACES[1])).toBe(false);
    expect(isStageUnlocked(s, 1)).toBe(false);
  });

  it('round-trips through storage and survives corrupt data', () => {
    const st = new MemStorage();
    const s = { ...defaultSave(), credits: 1234, salvage: 56 };
    expect(writeSave(s, st)).toBe(true);
    expect(loadSave(st).credits).toBe(1234);
    st.setItem(SAVE_KEY, '{not json');
    expect(loadSave(st)).toEqual(defaultSave());
    st.setItem(SAVE_KEY, JSON.stringify({ version: 99, credits: -5, salvage: 'lots', unlockedShips: ['comet', 'deathstar', 'vulture'], selectedShip: 'deathstar', upgrades: { comet: { engines: 99, armour: -3 } }, settings: { quality: 'ultra', masterVolume: 7 } }));
    const fixed = loadSave(st);
    expect(fixed.credits).toBe(0);
    expect(fixed.salvage).toBe(0);
    expect(fixed.unlockedShips).toEqual(['comet', 'vulture']);
    expect(fixed.selectedShip).toBe('comet');
    expect(fixed.upgrades.comet.engines).toBe(5);
    expect(fixed.upgrades.comet.armour).toBe(0);
    expect(fixed.settings.quality).toBe('medium');
    expect(fixed.settings.masterVolume).toBe(1);
    expect(sanitizeSave(null)).toEqual(defaultSave());
  });

  it('migrates older save versions', () => {
    const v0 = { credits: 500, upgradeLevels: { engines: 2, handling: 1, armour: 0, weapons: 0, shields: 0 } };
    const m0 = sanitizeSave(migrateSave(v0));
    expect(m0.version).toBe(SAVE_VERSION);
    expect(m0.credits).toBe(500);
    expect(m0.upgrades.comet.engines).toBe(2);
    const v1 = { version: 1, credits: 10, settings: { volume: 0.3 } };
    expect(sanitizeSave(migrateSave(v1)).settings.masterVolume).toBeCloseTo(0.3);
  });

  it('reset wipes progress but keeps settings', () => {
    const st = new MemStorage();
    const s = { ...defaultSave(), credits: 9999, unlockedShips: ['comet', 'bruiser'] };
    s.settings.quality = 'high';
    writeSave(s, st);
    const r = resetSave(s.settings, st);
    expect(r.credits).toBe(0);
    expect(r.unlockedShips).toEqual(['comet']);
    expect(r.settings.quality).toBe('high');
    expect(loadSave(st).credits).toBe(0);
  });

  it('buys upgrades with credits, and advanced upgrades with credits plus salvage', () => {
    let s = defaultSave();
    expect(buyUpgrade(s, 'comet', 'engines')).toBeNull();
    s = { ...s, credits: 10000 };
    for (let i = 0; i < 3; i++) s = buyUpgrade(s, 'comet', 'engines')!;
    expect(s.upgrades.comet.engines).toBe(3);
    expect(s.credits).toBe(10000 - 400 - 800 - 1300);
    expect(buyUpgrade(s, 'comet', 'engines')).toBeNull(); // level 4 needs salvage
    s = { ...s, salvage: 200 };
    s = buyUpgrade(s, 'comet', 'engines')!;
    s = buyUpgrade(s, 'comet', 'engines')!;
    expect(s.upgrades.comet.engines).toBe(5);
    expect(s.salvage).toBe(200 - 45 - 90);
    expect(buyUpgrade(s, 'comet', 'engines')).toBeNull();
    expect(buyUpgrade(s, 'bruiser', 'engines')).toBeNull(); // not owned
  });

  it('unlocks ships through campaign progress plus credits', () => {
    let s = { ...defaultSave(), credits: 50000 };
    for (const u of SHIP_UNLOCKS.filter((x) => x.afterRace)) expect(shipLockState(s, u.ship)).toBe('locked');
    expect(buyShip(s, 'vulture')).toBeNull();
    const rw = computeRewards(RACES[0], outcome({ position: 2 }));
    s = applyRaceResult(s, RACES[0], 'comet', outcome({ position: 2 }), rw);
    s = applyRaceResult(s, RACES[1], 'comet', outcome({ position: 3 }), computeRewards(RACES[1], outcome({ position: 3 })));
    expect(shipLockState(s, 'vulture')).toBe('available');
    const bought = buyShip(s, 'vulture')!;
    expect(bought.unlockedShips).toContain('vulture');
    expect(bought.credits).toBe(s.credits - 1800);
    expect(shipLockState({ ...s, credits: 0 }, 'vulture')).toBe('available');
    expect(buyShip({ ...s, credits: 0 }, 'vulture')).toBeNull();
  });

  it('records results, banks rewards and unlocks the next race and stage', () => {
    let s = defaultSave();
    const bad = outcome({ position: 9, time: 300, bestLap: 95 });
    s = applyRaceResult(s, RACES[0], 'comet', bad, computeRewards(RACES[0], bad));
    expect(s.credits).toBeGreaterThan(0);
    expect(s.races.s1r1.completed).toBe(false);
    expect(isRaceUnlocked(s, RACES[1])).toBe(false);
    const good = outcome({ position: 4, time: 260, bestLap: 82 });
    s = applyRaceResult(s, RACES[0], 'comet', good, computeRewards(RACES[0], good));
    expect(s.races.s1r1).toMatchObject({ completed: true, attempts: 2, bestPosition: 4, bestTime: 260, bestLap: 82, bestShip: 'comet' });
    expect(isRaceUnlocked(s, RACES[1])).toBe(true);
    for (const r of [RACES[1], RACES[2]]) { const o = outcome({ position: 1 }); s = applyRaceResult(s, r, 'comet', o, computeRewards(r, o)); }
    expect(isStageUnlocked(s, 1)).toBe(true);
    expect(s.totals.races).toBe(4);
    expect(s.totals.wins).toBe(2);
    // a worse later result never overwrites a record
    const worse = outcome({ position: 8, time: 400, bestLap: 120 });
    s = applyRaceResult(s, RACES[0], 'comet', worse, computeRewards(RACES[0], worse));
    expect(s.races.s1r1).toMatchObject({ completed: true, bestPosition: 4, bestTime: 260, bestLap: 82 });
  });

  it('lets every race in the campaign be unlocked in order', () => {
    let s = defaultSave();
    for (const r of RACES) {
      expect(isRaceUnlocked(s, r)).toBe(true);
      const o = outcome({ position: r.unlockPos });
      s = applyRaceResult(s, r, 'comet', o, computeRewards(r, o));
    }
    expect(RACES.every((r) => s.races[r.id].completed)).toBe(true);
    expect(PLAYER_SHIPS.every((p) => shipLockState(s, p.id) !== 'locked')).toBe(true);
  });
});
