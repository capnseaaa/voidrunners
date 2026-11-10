// Ship, upgrade and AI racer data. This module is simulation-safe: it has no
// rendering imports so it can be used by headless tests.

export type AbilityId = 'burst' | 'bulwark' | 'dash' | 'magnet';
export type UpgradeCategory = 'engines' | 'handling' | 'armour' | 'weapons' | 'shields';
export const UPGRADE_CATEGORIES: UpgradeCategory[] = ['engines', 'handling', 'armour', 'weapons', 'shields'];
export const MAX_UPGRADE_LEVEL = 5;

export type UpgradeLevels = Record<UpgradeCategory, number>;
export const ZERO_UPGRADES: UpgradeLevels = { engines: 0, handling: 0, armour: 0, weapons: 0, shields: 0 };

export interface BaseStats {
  topSpeed: number; // world units / s
  accel: number; // units / s^2 at standstill
  turnRate: number; // rad / s
  grip: number; // lateral velocity damping (1/s)
  armour: number; // hull health
  shield: number; // shield strength
  shieldRegen: number; // per second
  weaponDamage: number; // per blaster bolt
  fireRate: number; // bolts / s
  missiles: number; // per race
  salvageMult: number;
  mass: number; // collision weighting
}

export interface ShipColors {
  primary: number;
  secondary: number;
  glow: number; // engine / weapon colour
}

export interface ShipDef {
  id: string;
  name: string;
  role: string;
  blurb: string;
  model: string;
  colors: ShipColors;
  ability: AbilityId;
  stats: BaseStats;
}

export interface AbilityInfo {
  id: AbilityId;
  name: string;
  desc: string;
  duration: number;
  cooldown: number;
}

export const ABILITIES: Record<AbilityId, AbilityInfo> = {
  burst: { id: 'burst', name: 'AFTERBURN', desc: 'Short, violent speed burst far beyond normal top speed.', duration: 2.2, cooldown: 13 },
  bulwark: { id: 'bulwark', name: 'BULWARK', desc: 'Temporary damage shield that soaks almost all incoming fire.', duration: 5, cooldown: 17 },
  dash: { id: 'dash', name: 'PHASE DASH', desc: 'Phase out of reality and lunge forward through shots and ships.', duration: 1.1, cooldown: 9 },
  magnet: { id: 'magnet', name: 'MAG-COLLECTOR', desc: 'Magnetic field drags nearby salvage straight into the hold.', duration: 6.5, cooldown: 13 },
};

export const PLAYER_SHIPS: ShipDef[] = [
  {
    id: 'comet', name: 'COMET', role: 'SPEED SPECIALIST',
    blurb: 'A needle of chrome strapped to an oversized fusion torch. Fastest thing on the circuit, and about as sturdy as a soda can.',
    model: 'comet', colors: { primary: 0xff7a1a, secondary: 0xf2f2f5, glow: 0x35d8ff }, ability: 'burst',
    stats: { topSpeed: 124, accel: 64, turnRate: 1.6, grip: 5.2, armour: 90, shield: 60, shieldRegen: 7, weaponDamage: 6, fireRate: 7, missiles: 4, salvageMult: 1, mass: 0.8 },
  },
  {
    id: 'bruiser', name: 'BRUISER', role: 'HEAVY TANK',
    blurb: 'Surplus gunboat hull with racing engines bolted on as an afterthought. Slow off the line, impossible to push around.',
    model: 'bruiser', colors: { primary: 0xd4302b, secondary: 0x3a3f4a, glow: 0xffb020 }, ability: 'bulwark',
    stats: { topSpeed: 113, accel: 42, turnRate: 1.38, grip: 6.2, armour: 175, shield: 95, shieldRegen: 8, weaponDamage: 9.5, fireRate: 6.2, missiles: 8, salvageMult: 1, mass: 1.6 },
  },
  {
    id: 'phantom', name: 'PHANTOM', role: 'AGILITY ACE',
    blurb: 'Experimental phase-drive interceptor. Turns like it is on rails and can step sideways out of the universe when things get crowded.',
    model: 'phantom', colors: { primary: 0x8a3dff, secondary: 0x16142a, glow: 0xff3df0 }, ability: 'dash',
    stats: { topSpeed: 117, accel: 56, turnRate: 2.15, grip: 8, armour: 85, shield: 55, shieldRegen: 8, weaponDamage: 6, fireRate: 8, missiles: 5, salvageMult: 1, mass: 0.85 },
  },
  {
    id: 'vulture', name: 'VULTURE', role: 'SALVAGE SPECIALIST',
    blurb: 'A scrapper\'s rig with a wide intake maw and a magnetic collector array. Balanced, dependable and always leaves richer than it arrived.',
    model: 'vulture', colors: { primary: 0x12c8a8, secondary: 0xe8c43a, glow: 0x7dff5a }, ability: 'magnet',
    stats: { topSpeed: 116, accel: 51, turnRate: 1.7, grip: 6.2, armour: 118, shield: 72, shieldRegen: 8, weaponDamage: 7, fireRate: 6.6, missiles: 6, salvageMult: 1.6, mass: 1.1 },
  },
];

export interface Personality {
  skill: number; // 0..1 racing line / braking precision
  aggression: number; // 0..1 fires on and harasses racers
  mistakeRate: number; // expected mistakes per minute
  salvageBias: number; // 0..1 willingness to leave the line for salvage
  shortcutBias: number; // 0..1 probability weight for shortcut routes
  riskBias: number; // 0..1 probability weight for risky routes
  capitalBias: number; // 0..1 focus on capital ship targets
  boostUse: number; // 0..1 how eagerly boost is spent
}

export interface AiRacerDef {
  id: string;
  name: string;
  tagline: string;
  ship: ShipDef;
  personality: Personality;
}

function aiShip(id: string, name: string, model: string, colors: ShipColors, ability: AbilityId, s: Partial<BaseStats>): ShipDef {
  const base: BaseStats = { topSpeed: 113, accel: 50, turnRate: 1.65, grip: 6, armour: 110, shield: 65, shieldRegen: 7.5, weaponDamage: 7, fireRate: 6.5, missiles: 6, salvageMult: 1, mass: 1 };
  return { id, name, role: 'AI', blurb: '', model, colors, ability, stats: { ...base, ...s } };
}

export const AI_RACERS: AiRacerDef[] = [
  {
    id: 'ace', name: 'ACE', tagline: 'Aggressive and fast',
    ship: aiShip('ace', 'Stiletto', 'stiletto', { primary: 0xf5f5ff, secondary: 0xe01030, glow: 0xff5030 }, 'burst',
      { topSpeed: 121, accel: 59, turnRate: 1.68, armour: 92, shield: 55, mass: 0.85 }),
    personality: { skill: 0.97, aggression: 0.7, mistakeRate: 0.35, salvageBias: 0.15, shortcutBias: 0.55, riskBias: 0.4, capitalBias: 0.3, boostUse: 0.95 },
  },
  {
    id: 'rookie', name: 'ROOKIE', tagline: 'Inexperienced, makes mistakes',
    ship: aiShip('rookie', 'Puddlejumper', 'puddle', { primary: 0xffe040, secondary: 0x3d6bff, glow: 0x9be8ff }, 'burst',
      { topSpeed: 113, accel: 47, turnRate: 1.55, armour: 105, shield: 60 }),
    personality: { skill: 0.72, aggression: 0.2, mistakeRate: 4.2, salvageBias: 0.3, shortcutBias: 0.2, riskBias: 0.25, capitalBias: 0.25, boostUse: 0.45 },
  },
  {
    id: 'tank', name: 'TANK', tagline: 'Durable and heavily armed',
    ship: aiShip('tank', 'Ironclad', 'ironclad', { primary: 0x5c6b3a, secondary: 0x2b2f24, glow: 0xff8a20 }, 'bulwark',
      { topSpeed: 112, accel: 41, turnRate: 1.38, grip: 6.4, armour: 185, shield: 100, weaponDamage: 9.5, missiles: 9, mass: 1.7 }),
    personality: { skill: 0.86, aggression: 0.6, mistakeRate: 0.7, salvageBias: 0.15, shortcutBias: 0.15, riskBias: 0.2, capitalBias: 0.6, boostUse: 0.7 },
  },
  {
    id: 'scavenger', name: 'SCAVENGER', tagline: 'Prioritises salvage',
    ship: aiShip('scavenger', 'Magpie', 'magpie', { primary: 0xb8651e, secondary: 0x2ad0c0, glow: 0x60ffb0 }, 'magnet',
      { topSpeed: 115, accel: 50, turnRate: 1.72, armour: 112, shield: 70, salvageMult: 1.6, mass: 1.05 }),
    personality: { skill: 0.85, aggression: 0.2, mistakeRate: 0.9, salvageBias: 1, shortcutBias: 0.3, riskBias: 0.5, capitalBias: 0.35, boostUse: 0.6 },
  },
  {
    id: 'ghost', name: 'GHOST', tagline: 'Takes shortcuts',
    ship: aiShip('ghost', 'Wraith', 'wraith', { primary: 0xc8d4e8, secondary: 0x202838, glow: 0x9ad0ff }, 'dash',
      { topSpeed: 114, accel: 55, turnRate: 2.05, grip: 7.6, armour: 86, shield: 56, mass: 0.85 }),
    personality: { skill: 0.9, aggression: 0.25, mistakeRate: 0.6, salvageBias: 0.2, shortcutBias: 1, riskBias: 0.35, capitalBias: 0.2, boostUse: 0.8 },
  },
  {
    id: 'psycho', name: 'PSYCHO', tagline: 'Attacks other racers',
    ship: aiShip('psycho', 'Hellion', 'hellion', { primary: 0x1c1c1c, secondary: 0xff1a6a, glow: 0xff2a2a }, 'bulwark',
      { topSpeed: 115, accel: 53, turnRate: 1.62, armour: 122, shield: 62, weaponDamage: 9, fireRate: 8, missiles: 9, mass: 1.15 }),
    personality: { skill: 0.84, aggression: 1, mistakeRate: 1.4, salvageBias: 0.1, shortcutBias: 0.35, riskBias: 0.5, capitalBias: 0.1, boostUse: 0.85 },
  },
  {
    id: 'veteran', name: 'VETERAN', tagline: 'Consistent',
    ship: aiShip('veteran', 'Old Guard', 'oldguard', { primary: 0x2a55b8, secondary: 0xd8d8d8, glow: 0x50b0ff }, 'burst',
      { topSpeed: 116, accel: 53, turnRate: 1.72, armour: 116, shield: 70 }),
    personality: { skill: 0.94, aggression: 0.4, mistakeRate: 0.12, salvageBias: 0.25, shortcutBias: 0.4, riskBias: 0.15, capitalBias: 0.4, boostUse: 0.8 },
  },
  {
    id: 'showoff', name: 'SHOWOFF', tagline: 'Takes risky routes',
    ship: aiShip('showoff', 'Peacock', 'peacock', { primary: 0xff3db8, secondary: 0x30e0ff, glow: 0xffe85a }, 'dash',
      { topSpeed: 119, accel: 57, turnRate: 1.92, grip: 6.8, armour: 82, shield: 50, mass: 0.85 }),
    personality: { skill: 0.88, aggression: 0.45, mistakeRate: 1.8, salvageBias: 0.3, shortcutBias: 0.5, riskBias: 1, capitalBias: 0.3, boostUse: 1 },
  },
  {
    id: 'mercenary', name: 'MERCENARY', tagline: 'Prioritises capital ship targets',
    ship: aiShip('mercenary', 'Contract', 'contract', { primary: 0x6a6f7a, secondary: 0xf0a020, glow: 0xffd040 }, 'bulwark',
      { topSpeed: 114, accel: 49, turnRate: 1.58, armour: 132, shield: 76, weaponDamage: 9, fireRate: 7, missiles: 10, mass: 1.25 }),
    personality: { skill: 0.88, aggression: 0.35, mistakeRate: 0.6, salvageBias: 0.2, shortcutBias: 0.3, riskBias: 0.3, capitalBias: 1, boostUse: 0.7 },
  },
];

export function getPlayerShip(id: string): ShipDef {
  return PLAYER_SHIPS.find((s) => s.id === id) ?? PLAYER_SHIPS[0];
}

// ---------------------------------------------------------------- upgrades

export interface UpgradeInfo {
  id: UpgradeCategory;
  name: string;
  desc: string;
}

export const UPGRADES: Record<UpgradeCategory, UpgradeInfo> = {
  engines: { id: 'engines', name: 'ENGINES', desc: 'Top speed and acceleration.' },
  handling: { id: 'handling', name: 'HANDLING', desc: 'Turn rate and lateral grip.' },
  armour: { id: 'armour', name: 'ARMOUR', desc: 'Hull health.' },
  weapons: { id: 'weapons', name: 'WEAPONS', desc: 'Blaster damage and fire rate.' },
  shields: { id: 'shields', name: 'SHIELDS', desc: 'Shield strength and recharge.' },
};

export interface UpgradeCost { credits: number; salvage: number }

// Levels 1-3 are standard upgrades bought with credits. Levels 4-5 are
// advanced upgrades which additionally need salvage.
const COSTS: UpgradeCost[] = [
  { credits: 400, salvage: 0 },
  { credits: 800, salvage: 0 },
  { credits: 1300, salvage: 0 },
  { credits: 1800, salvage: 45 },
  { credits: 2600, salvage: 90 },
];

/** Cost to go from `currentLevel` to `currentLevel + 1`, or null when maxed. */
export function upgradeCost(currentLevel: number): UpgradeCost | null {
  if (currentLevel < 0 || currentLevel >= MAX_UPGRADE_LEVEL) return null;
  return COSTS[currentLevel];
}

export interface ShipStats extends BaseStats {
  shieldDelay: number;
}

/** Apply upgrade levels (fractional levels allowed for AI tuning) to base stats. */
export function computeStats(def: ShipDef, lv: UpgradeLevels): ShipStats {
  const b = def.stats;
  return {
    ...b,
    topSpeed: b.topSpeed * (1 + 0.028 * lv.engines),
    accel: b.accel * (1 + 0.07 * lv.engines),
    turnRate: b.turnRate * (1 + 0.05 * lv.handling),
    grip: b.grip * (1 + 0.06 * lv.handling),
    armour: b.armour * (1 + 0.14 * lv.armour),
    weaponDamage: b.weaponDamage * (1 + 0.09 * lv.weapons),
    fireRate: b.fireRate * (1 + 0.05 * lv.weapons),
    shield: b.shield * (1 + 0.14 * lv.shields),
    shieldRegen: b.shieldRegen * (1 + 0.14 * lv.shields),
    shieldDelay: 3.2 - 0.2 * lv.shields,
  };
}

export function uniformLevels(level: number): UpgradeLevels {
  return { engines: level, handling: level, armour: level, weapons: level, shields: level };
}

/** Normalised 0..1 ratings used by the hangar stat bars. */
export function statRatings(s: ShipStats) {
  const n = (v: number, lo: number, hi: number) => Math.max(0.04, Math.min(1, (v - lo) / (hi - lo)));
  return {
    speed: n(s.topSpeed, 95, 145),
    accel: n(s.accel, 35, 90),
    handling: n(s.turnRate, 1.2, 2.75),
    armour: n(s.armour, 60, 300),
    firepower: n(s.weaponDamage * s.fireRate, 30, 100),
    shields: n(s.shield, 40, 165),
  };
}
