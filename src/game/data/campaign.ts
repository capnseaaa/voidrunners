// Campaign structure: 4 stages x 3 races, objectives, rewards and unlock rules.

export type RaceType = 'standard' | 'capital' | 'championship';
export type TrackId = 'neon' | 'orbit' | 'solar' | 'warzone';

export type ObjectiveKind = 'position' | 'salvage' | 'capitalShare' | 'capitalKills' | 'capitalDestroyed' | 'noDeaths' | 'racerKills';

export interface ObjectiveDef {
  kind: ObjectiveKind;
  target: number;
  bonus: number;
  label: string;
}

export interface RaceDef {
  id: string;
  index: number; // 0..11
  stage: number; // 0..3
  slot: number; // 0..2
  name: string;
  type: RaceType;
  track: TrackId;
  laps: number;
  aiLevel: number; // upgrade level applied to AI ships (same upgrade maths as the player)
  aiSkill: number; // 0..1 multiplier on AI driving precision
  capitalHp: number; // capital ship health multiplier
  capitalAggro: number; // capital ship fire-rate multiplier
  hazard: number; // hazard density multiplier
  seed: number;
  unlockPos: number; // finishing position needed to unlock the next race
  objectives: ObjectiveDef[];
}

export interface StageDef {
  id: number;
  name: string;
  track: TrackId;
  tagline: string;
  color: string;
}

export const STAGES: StageDef[] = [
  { id: 0, name: 'NEON FRONTIER', track: 'neon', tagline: 'Industrial ring-station. Tunnels, signage and commuter traffic.', color: '#00e5ff' },
  { id: 1, name: 'DEAD ORBIT', track: 'orbit', tagline: 'A shattered moon. Narrow lanes through drifting rock and wreckage.', color: '#b06bff' },
  { id: 2, name: 'SOLAR SCAR', track: 'solar', tagline: 'Scorched canyon world. Collector fields and gun emplacements.', color: '#ff9a2a' },
  { id: 3, name: 'WARZONE ZERO', track: 'warzone', tagline: 'Two fleets tearing each other apart. The race runs straight through.', color: '#ff3d5a' },
];

const POS = (target: number, bonus: number): ObjectiveDef => ({ kind: 'position', target, bonus, label: target === 1 ? 'Win the race' : `Finish in the top ${target}` });
const SALV = (target: number, bonus: number): ObjectiveDef => ({ kind: 'salvage', target, bonus, label: `Collect ${target} salvage` });
const SHARE = (target: number, bonus: number): ObjectiveDef => ({ kind: 'capitalShare', target, bonus, label: `Deal ${target}% of all capital ship damage` });
const KILLS = (target: number, bonus: number): ObjectiveDef => ({ kind: 'capitalKills', target, bonus, label: `Destroy ${target} capital ship component${target > 1 ? 's' : ''}` });
const DESTROYED = (bonus: number): ObjectiveDef => ({ kind: 'capitalDestroyed', target: 1, bonus, label: 'Capital ship fully disabled' });
const NODEATH = (bonus: number): ObjectiveDef => ({ kind: 'noDeaths', target: 0, bonus, label: 'Finish without being destroyed' });
const RKILLS = (target: number, bonus: number): ObjectiveDef => ({ kind: 'racerKills', target, bonus, label: `Wreck ${target} rival${target > 1 ? 's' : ''}` });

const RACE_NAMES: string[][] = [
  ['Ringside Sprint', 'Dreadnought Customs', 'Frontier Cup'],
  ['Gravel Run', 'The Graveyard Shift', 'Orbit Decay Cup'],
  ['Canyon Burn', 'Siege of the Scar', 'Solar Crown'],
  ['No Man\'s Sky', 'Flagship Down', 'Zero Hour Grand Prix'],
];

function buildRaces(): RaceDef[] {
  const out: RaceDef[] = [];
  const types: RaceType[] = ['standard', 'capital', 'championship'];
  for (let stage = 0; stage < 4; stage++) {
    for (let slot = 0; slot < 3; slot++) {
      const index = stage * 3 + slot;
      const type = types[slot];
      const t = index / 11;
      const objectives: ObjectiveDef[] = [];
      if (type === 'standard') {
        objectives.push(POS(3, 200), SALV(12 + stage * 4, 150), NODEATH(150));
      } else if (type === 'capital') {
        objectives.push(SHARE(12, 300), KILLS(1 + (stage > 1 ? 1 : 0), 250), DESTROYED(300));
      } else {
        objectives.push(POS(1, 500), RKILLS(1 + (stage > 1 ? 1 : 0), 200), SALV(15 + stage * 5, 150));
      }
      out.push({
        id: `s${stage + 1}r${slot + 1}`,
        index, stage, slot,
        name: RACE_NAMES[stage][slot],
        type,
        track: STAGES[stage].track,
        laps: 3,
        aiLevel: [0, 0.35, 0.7, 1.1, 1.5, 1.9, 2.3, 2.7, 3.1, 3.6, 4.1, 4.6][index],
        aiSkill: 0.74 + 0.26 * Math.min(1, t * 1.1),
        capitalHp: (type === 'capital' ? 1.15 : type === 'championship' ? 1.0 : 0.85) * (1 + stage * 0.14),
        capitalAggro: (type === 'capital' ? 1.35 : 1) * (1 + stage * 0.12),
        hazard: type === 'championship' ? 1.25 : 1,
        seed: 1000 + index * 77,
        unlockPos: type === 'championship' ? 4 : 6,
        objectives,
      });
    }
  }
  return out;
}

export const RACES: RaceDef[] = buildRaces();

export function getRace(id: string): RaceDef {
  const r = RACES.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown race ${id}`);
  return r;
}

// Credits by finishing position (1-based): 1000, 800, 650, 450, 450, 300, 300, 200, 200, 200.
export const POSITION_CREDITS = [1000, 800, 650, 450, 450, 300, 300, 200, 200, 200];

export interface ShipUnlock { ship: string; afterRace: string | null; cost: number }

export const SHIP_UNLOCKS: ShipUnlock[] = [
  { ship: 'comet', afterRace: null, cost: 0 },
  { ship: 'vulture', afterRace: 's1r2', cost: 1800 },
  { ship: 'bruiser', afterRace: 's1r3', cost: 3000 },
  { ship: 'phantom', afterRace: 's2r3', cost: 4500 },
];
