// Versioned LocalStorage persistence with validation, migration and safe defaults.
import { RACES, SHIP_UNLOCKS, type RaceDef } from '../data/campaign';
import { MAX_UPGRADE_LEVEL, PLAYER_SHIPS, UPGRADE_CATEGORIES, upgradeCost, ZERO_UPGRADES, type UpgradeCategory, type UpgradeLevels } from '../data/ships';
import type { RewardBreakdown, RaceOutcome } from '../data/rewards';

export const SAVE_KEY = 'voidrunners.save';
export const SAVE_VERSION = 2;

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  cameraShake: boolean;
  showMinimap: boolean;
}

export interface RaceRecord {
  completed: boolean; // finished well enough to unlock the next race
  attempts: number;
  bestPosition: number; // 0 = none
  bestTime: number; // 0 = none
  bestLap: number; // 0 = none
  bestShip: string;
}

export interface SaveData {
  version: number;
  credits: number;
  salvage: number;
  selectedShip: string;
  unlockedShips: string[];
  upgrades: Record<string, UpgradeLevels>;
  races: Record<string, RaceRecord>;
  totals: { races: number; wins: number; creditsEarned: number; salvageEarned: number; capitalKills: number; racerKills: number };
  settings: Settings;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultSettings(): Settings {
  return { quality: 'medium', masterVolume: 0.8, musicVolume: 0.55, sfxVolume: 0.8, cameraShake: true, showMinimap: true };
}

export function defaultSave(): SaveData {
  const upgrades: Record<string, UpgradeLevels> = {};
  for (const s of PLAYER_SHIPS) upgrades[s.id] = { ...ZERO_UPGRADES };
  return {
    version: SAVE_VERSION,
    credits: 0,
    salvage: 0,
    selectedShip: 'comet',
    unlockedShips: ['comet'],
    upgrades,
    races: {},
    totals: { races: 0, wins: 0, creditsEarned: 0, salvageEarned: 0, capitalKills: 0, racerKills: 0 },
    settings: defaultSettings(),
  };
}

const num = (v: unknown, def: number, lo = 0, hi = Number.MAX_SAFE_INTEGER): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;

/** Coerce arbitrary parsed JSON into a valid SaveData. Never throws. */
export function sanitizeSave(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  d.credits = Math.floor(num(r.credits, 0));
  d.salvage = Math.floor(num(r.salvage, 0));
  const shipIds = PLAYER_SHIPS.map((s) => s.id);
  if (Array.isArray(r.unlockedShips)) {
    for (const id of r.unlockedShips) if (shipIds.includes(id) && !d.unlockedShips.includes(id)) d.unlockedShips.push(id);
  }
  if (typeof r.selectedShip === 'string' && d.unlockedShips.includes(r.selectedShip)) d.selectedShip = r.selectedShip;
  if (r.upgrades && typeof r.upgrades === 'object') {
    for (const id of shipIds) {
      const u = r.upgrades[id];
      if (u && typeof u === 'object') {
        for (const c of UPGRADE_CATEGORIES) d.upgrades[id][c] = Math.floor(num(u[c], 0, 0, MAX_UPGRADE_LEVEL));
      }
    }
  }
  if (r.races && typeof r.races === 'object') {
    for (const race of RACES) {
      const rr = r.races[race.id];
      if (rr && typeof rr === 'object') {
        d.races[race.id] = {
          completed: !!rr.completed,
          attempts: Math.floor(num(rr.attempts, 0)),
          bestPosition: Math.floor(num(rr.bestPosition, 0, 0, 10)),
          bestTime: num(rr.bestTime, 0),
          bestLap: num(rr.bestLap, 0),
          bestShip: typeof rr.bestShip === 'string' ? rr.bestShip : '',
        };
      }
    }
  }
  if (r.totals && typeof r.totals === 'object') {
    for (const k of Object.keys(d.totals) as (keyof SaveData['totals'])[]) d.totals[k] = Math.floor(num(r.totals[k], 0));
  }
  if (r.settings && typeof r.settings === 'object') {
    const s = r.settings;
    if (s.quality === 'low' || s.quality === 'medium' || s.quality === 'high') d.settings.quality = s.quality;
    d.settings.masterVolume = num(s.masterVolume, d.settings.masterVolume, 0, 1);
    d.settings.musicVolume = num(s.musicVolume, d.settings.musicVolume, 0, 1);
    d.settings.sfxVolume = num(s.sfxVolume, d.settings.sfxVolume, 0, 1);
    if (typeof s.cameraShake === 'boolean') d.settings.cameraShake = s.cameraShake;
    if (typeof s.showMinimap === 'boolean') d.settings.showMinimap = s.showMinimap;
  }
  return d;
}

/** Upgrade older save layouts to the current version. */
export function migrateSave(raw: any): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  let data = raw;
  const v = typeof data.version === 'number' ? data.version : 0;
  if (v < 1) {
    // v0 (pre-release) stored one global upgrade set under "upgradeLevels".
    if (data.upgradeLevels && !data.upgrades) data = { ...data, upgrades: { comet: data.upgradeLevels } };
  }
  if (v < 2) {
    // v1 had a single "volume" setting.
    if (data.settings && typeof data.settings.volume === 'number' && data.settings.masterVolume === undefined) {
      data = { ...data, settings: { ...data.settings, masterVolume: data.settings.volume } };
    }
  }
  return { ...data, version: SAVE_VERSION };
}

function getStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* storage blocked */ }
  return null;
}

export function loadSave(storage: StorageLike | null = getStorage()): SaveData {
  if (!storage) return defaultSave();
  try {
    const txt = storage.getItem(SAVE_KEY);
    if (!txt) return defaultSave();
    return sanitizeSave(migrateSave(JSON.parse(txt)));
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, storage: StorageLike | null = getStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ ...data, version: SAVE_VERSION }));
    return true;
  } catch {
    return false;
  }
}

/** Wipe progress. Settings are kept so audio/graphics choices survive a reset. */
export function resetSave(keep: Settings | null, storage: StorageLike | null = getStorage()): SaveData {
  const d = defaultSave();
  if (keep) d.settings = { ...keep };
  if (storage) {
    try { storage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    writeSave(d, storage);
  }
  return d;
}

// ------------------------------------------------------------ progression

export function isRaceUnlocked(save: SaveData, race: RaceDef): boolean {
  if (race.index === 0) return true;
  const prev = RACES[race.index - 1];
  return !!save.races[prev.id]?.completed;
}

export function isStageUnlocked(save: SaveData, stage: number): boolean {
  return isRaceUnlocked(save, RACES[stage * 3]);
}

export function nextRace(race: RaceDef): RaceDef | null {
  return RACES[race.index + 1] ?? null;
}

export type ShipLockState = 'owned' | 'available' | 'locked';

export function shipLockState(save: SaveData, shipId: string): ShipLockState {
  if (save.unlockedShips.includes(shipId)) return 'owned';
  const u = SHIP_UNLOCKS.find((x) => x.ship === shipId);
  if (!u) return 'locked';
  if (u.afterRace && !save.races[u.afterRace]?.completed) return 'locked';
  return 'available';
}

export function buyShip(save: SaveData, shipId: string): SaveData | null {
  if (shipLockState(save, shipId) !== 'available') return null;
  const u = SHIP_UNLOCKS.find((x) => x.ship === shipId)!;
  if (save.credits < u.cost) return null;
  return { ...save, credits: save.credits - u.cost, unlockedShips: [...save.unlockedShips, shipId], selectedShip: shipId };
}

export function canBuyUpgrade(save: SaveData, shipId: string, cat: UpgradeCategory): boolean {
  if (!save.unlockedShips.includes(shipId)) return false;
  const cost = upgradeCost(save.upgrades[shipId][cat]);
  return !!cost && save.credits >= cost.credits && save.salvage >= cost.salvage;
}

export function buyUpgrade(save: SaveData, shipId: string, cat: UpgradeCategory): SaveData | null {
  if (!canBuyUpgrade(save, shipId, cat)) return null;
  const level = save.upgrades[shipId][cat];
  const cost = upgradeCost(level)!;
  return {
    ...save,
    credits: save.credits - cost.credits,
    salvage: save.salvage - cost.salvage,
    upgrades: { ...save.upgrades, [shipId]: { ...save.upgrades[shipId], [cat]: level + 1 } },
  };
}

/** Fold a finished race into the save: currencies, records, unlock flags, totals. */
export function applyRaceResult(save: SaveData, race: RaceDef, shipId: string, o: RaceOutcome, rw: RewardBreakdown): SaveData {
  const prev: RaceRecord = save.races[race.id] ?? { completed: false, attempts: 0, bestPosition: 0, bestTime: 0, bestLap: 0, bestShip: '' };
  const rec: RaceRecord = { ...prev, attempts: prev.attempts + 1 };
  if (o.finished) {
    if (rec.bestPosition === 0 || o.position < rec.bestPosition) rec.bestPosition = o.position;
    if (rec.bestTime === 0 || o.time < rec.bestTime) { rec.bestTime = o.time; rec.bestShip = shipId; }
  }
  if (o.bestLap > 0 && (rec.bestLap === 0 || o.bestLap < rec.bestLap)) rec.bestLap = o.bestLap;
  if (rw.unlockedNext) rec.completed = true;
  return {
    ...save,
    credits: save.credits + rw.totalCredits,
    salvage: save.salvage + rw.salvage,
    races: { ...save.races, [race.id]: rec },
    totals: {
      races: save.totals.races + 1,
      wins: save.totals.wins + (o.finished && o.position === 1 ? 1 : 0),
      creditsEarned: save.totals.creditsEarned + rw.totalCredits,
      salvageEarned: save.totals.salvageEarned + rw.salvage,
      capitalKills: save.totals.capitalKills + o.capitalKills,
      racerKills: save.totals.racerKills + o.racerKills,
    },
  };
}
