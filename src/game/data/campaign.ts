// Campaign structure: 4 stages, 17 events. Each stage mixes circuit races,
// a capital ship challenge, and open-space battles and/or capital ship
// surface races, and ends with a championship.

export type RaceType = 'standard' | 'capital' | 'championship' | 'battle' | 'surface';
/** Visual theme / stage setting. */
export type ThemeId = 'neon' | 'orbit' | 'solar' | 'warzone';
/** Geometry: one of the four circuits, the battleship hull circuit, or the open arena. */
export type TrackId = ThemeId | 'hulk' | 'arena';
export type RaceMode = 'race' | 'battle';

export type ObjectiveKind = 'position' | 'salvage' | 'capitalShare' | 'capitalKills' | 'capitalDestroyed' | 'noDeaths' | 'racerKills' | 'droneKills';

export interface ObjectiveDef {
  kind: ObjectiveKind;
  target: number;
  bonus: number;
  label: string;
}

export interface RaceDef {
  id: string;
  index: number; // position in the campaign order
  stage: number; // 0..3
  slot: number; // position within the stage
  name: string;
  type: RaceType;
  mode: RaceMode;
  track: TrackId;
  theme: ThemeId;
  laps: number;
  timeLimit: number; // battle events: seconds
  aiLevel: number; // upgrade level applied to AI ships (same upgrade maths as the player)
  aiSkill: number; // 0..1 multiplier on AI driving precision
  capitalHp: number; // capital ship health multiplier
  capitalAggro: number; // capital ship fire-rate multiplier
  hazard: number; // hazard density multiplier
  drones: number; // enemy fighters kept in the fight
  bombard: number; // stray capital-scale strikes per minute landing on the route
  dying: boolean; // surface races: the ship breaks up lap by lap
  seed: number;
  unlockPos: number; // finishing position needed to unlock the next event
  objectives: ObjectiveDef[];
}

export interface StageDef {
  id: number;
  name: string;
  track: ThemeId;
  tagline: string;
  color: string;
}

export const STAGES: StageDef[] = [
  { id: 0, name: 'NEON FRONTIER', track: 'neon', tagline: 'Industrial ring-station. Tunnels, signage and commuter traffic.', color: '#00e5ff' },
  { id: 1, name: 'DEAD ORBIT', track: 'orbit', tagline: 'A shattered moon. Narrow lanes through drifting rock and wreckage.', color: '#b06bff' },
  { id: 2, name: 'SOLAR SCAR', track: 'solar', tagline: 'Scorched canyon world. Collector fields and gun emplacements.', color: '#ff9a2a' },
  { id: 3, name: 'WARZONE ZERO', track: 'warzone', tagline: 'Two fleets tearing each other apart. The race runs straight through.', color: '#ff3d5a' },
];

export const TYPE_LABEL: Record<RaceType, string> = {
  standard: 'Circuit Race', capital: 'Capital Ship Challenge', championship: 'Championship', battle: 'Open-Space Battle', surface: 'Battleship Surface Race',
};

const POS = (target: number, bonus: number): ObjectiveDef => ({ kind: 'position', target, bonus, label: target === 1 ? 'Take first place' : `Finish in the top ${target}` });
const SALV = (target: number, bonus: number): ObjectiveDef => ({ kind: 'salvage', target, bonus, label: `Collect ${target} salvage` });
const SHARE = (target: number, bonus: number): ObjectiveDef => ({ kind: 'capitalShare', target, bonus, label: `Deal ${target}% of all capital ship damage` });
const KILLS = (target: number, bonus: number): ObjectiveDef => ({ kind: 'capitalKills', target, bonus, label: `Destroy ${target} capital ship system${target > 1 ? 's' : ''}` });
const DESTROYED = (bonus: number): ObjectiveDef => ({ kind: 'capitalDestroyed', target: 1, bonus, label: 'Capital ship fully disabled' });
const NODEATH = (bonus: number): ObjectiveDef => ({ kind: 'noDeaths', target: 0, bonus, label: 'Finish without being destroyed' });
const RKILLS = (target: number, bonus: number): ObjectiveDef => ({ kind: 'racerKills', target, bonus, label: `Wreck ${target} rival${target > 1 ? 's' : ''}` });
const DRONES = (target: number, bonus: number): ObjectiveDef => ({ kind: 'droneKills', target, bonus, label: `Shoot down ${target} enemy fighters` });

interface Ev { key: string; type: RaceType; name: string }

const PLAN: Ev[][] = [
  [{ key: 'r1', type: 'standard', name: 'Ringside Sprint' }, { key: 'r2', type: 'capital', name: 'Dreadnought Customs' }, { key: 'b', type: 'battle', name: 'Ringside Skirmish' }, { key: 'r3', type: 'championship', name: 'Frontier Cup' }],
  [{ key: 'r1', type: 'standard', name: 'Gravel Run' }, { key: 'r2', type: 'capital', name: 'The Graveyard Shift' }, { key: 's', type: 'surface', name: 'Hulk Runner' }, { key: 'r3', type: 'championship', name: 'Orbit Decay Cup' }],
  [{ key: 'r1', type: 'standard', name: 'Canyon Burn' }, { key: 'r2', type: 'capital', name: 'Siege of the Scar' }, { key: 'b', type: 'battle', name: 'Helios Intercept' }, { key: 'r3', type: 'championship', name: 'Solar Crown' }],
  [{ key: 'r1', type: 'standard', name: "No Man's Sky" }, { key: 'r2', type: 'capital', name: 'Flagship Down' }, { key: 'b', type: 'battle', name: 'Fleet Action' }, { key: 's', type: 'surface', name: 'Death of the Absolution' }, { key: 'r3', type: 'championship', name: 'Zero Hour Grand Prix' }],
];

function buildRaces(): RaceDef[] {
  const out: RaceDef[] = [];
  const total = PLAN.reduce((a, s) => a + s.length, 0);
  PLAN.forEach((events, stage) => {
    events.forEach((ev, slot) => {
      const index = out.length;
      const t = index / (total - 1);
      const type = ev.type;
      const theme = STAGES[stage].track;
      const objectives: ObjectiveDef[] = [];
      if (type === 'standard') objectives.push(POS(3, 200), SALV(8 + stage * 3, 150), NODEATH(150));
      else if (type === 'capital') objectives.push(SHARE(12, 300), KILLS(1 + (stage > 1 ? 1 : 0), 250), DESTROYED(300));
      else if (type === 'battle') objectives.push(DRONES(5 + stage * 2, 300), KILLS(1, 250), POS(3, 200));
      else if (type === 'surface') objectives.push(POS(3, 250), RKILLS(1, 200), NODEATH(200));
      else objectives.push(POS(1, 500), RKILLS(1 + (stage > 1 ? 1 : 0), 200), SALV(10 + stage * 3, 150));
      const dying = type === 'surface' && stage === 3;
      out.push({
        id: `s${stage + 1}${ev.key}`,
        index, stage, slot,
        name: ev.name,
        type,
        mode: type === 'battle' ? 'battle' : 'race',
        track: type === 'battle' ? 'arena' : type === 'surface' ? 'hulk' : theme,
        theme,
        laps: 3,
        timeLimit: type === 'battle' ? 135 : 0,
        aiLevel: Math.round(t * 46) / 10,
        aiSkill: 0.74 + 0.26 * Math.min(1, t * 1.1),
        capitalHp: (type === 'capital' ? 1.15 : type === 'battle' ? 1.3 : type === 'championship' ? 1.0 : 0.85) * (1 + stage * 0.14),
        capitalAggro: (type === 'capital' || type === 'battle' ? 1.35 : 1) * (1 + stage * 0.12),
        hazard: type === 'championship' ? 1.25 : 1,
        drones: type === 'battle' ? 8 + stage : type === 'capital' ? (stage >= 1 ? 3 : 2) : type === 'championship' && stage >= 2 ? 3 : type === 'surface' ? 3 : theme === 'warzone' ? 2 : 0,
        bombard: type === 'surface' ? (dying ? 7 : 4) : type === 'battle' ? 5 : theme === 'warzone' ? 3 : 0,
        dying: type === 'surface',
        seed: 1000 + (stage * 5 + slot) * 77 + (ev.key.length === 1 ? 31 : 0),
        unlockPos: type === 'championship' ? 4 : type === 'battle' ? 7 : 6,
        objectives,
      });
    });
  });
  return out;
}

export const RACES: RaceDef[] = buildRaces();

export function getRace(id: string): RaceDef {
  const r = RACES.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown race ${id}`);
  return r;
}

export function stageRaces(stage: number): RaceDef[] {
  return RACES.filter((r) => r.stage === stage);
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
