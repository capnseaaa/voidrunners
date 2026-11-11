import { POSITION_CREDITS, type ObjectiveDef, type RaceDef } from './campaign';

/** Everything the reward calculation needs to know about the player's race. */
export interface RaceOutcome {
  position: number; // 1..10
  finished: boolean;
  time: number;
  bestLap: number;
  salvage: number; // salvage units banked (after ship multiplier)
  deaths: number;
  racerKills: number;
  racerDamage: number;
  capitalDamage: number;
  capitalTotalDamage: number; // by everyone
  capitalKills: number; // components the player finished off
  capitalDestroyed: boolean;
  capitalKillBonus: number; // credits from component kill rewards
  droneKills: number; // enemy fighters shot down
  score: number; // battle events: points scored
}

export interface ObjectiveResult { def: ObjectiveDef; done: boolean; value: number }

export interface RewardBreakdown {
  positionCredits: number;
  combatCredits: number;
  capitalCredits: number;
  objectiveCredits: number;
  salvageCredits: number;
  totalCredits: number;
  salvage: number;
  objectives: ObjectiveResult[];
  unlockedNext: boolean;
}

export function capitalShare(o: RaceOutcome): number {
  return o.capitalTotalDamage > 0 ? (o.capitalDamage / o.capitalTotalDamage) * 100 : 0;
}

export function evaluateObjective(def: ObjectiveDef, o: RaceOutcome): ObjectiveResult {
  switch (def.kind) {
    case 'position': return { def, done: o.finished && o.position <= def.target, value: o.position };
    case 'salvage': return { def, done: o.salvage >= def.target, value: o.salvage };
    case 'capitalShare': { const v = capitalShare(o); return { def, done: v >= def.target, value: Math.round(v) }; }
    case 'capitalKills': return { def, done: o.capitalKills >= def.target, value: o.capitalKills };
    case 'capitalDestroyed': return { def, done: o.capitalDestroyed, value: o.capitalDestroyed ? 1 : 0 };
    case 'noDeaths': return { def, done: o.finished && o.deaths === 0, value: o.deaths };
    case 'racerKills': return { def, done: o.racerKills >= def.target, value: o.racerKills };
    case 'droneKills': return { def, done: o.droneKills >= def.target, value: o.droneKills };
  }
}

/**
 * Credits: finishing position + combat (rival damage and wrecks) + capital ship
 * contribution (damage dealt and component kills) + objectives + a small payout
 * per salvage unit. Salvage itself is banked as the advanced upgrade currency.
 * There is always a positive payout, even for a last place or a DNF.
 */
export function computeRewards(race: RaceDef, o: RaceOutcome): RewardBreakdown {
  const pos = Math.max(1, Math.min(10, Math.round(o.position)));
  const positionCredits = POSITION_CREDITS[pos - 1];
  const combatCredits = Math.round(o.racerKills * 200 + o.racerDamage * 0.4 + o.droneKills * 60);
  const capitalCredits = Math.round(o.capitalDamage * 0.3 + o.capitalKillBonus);
  const objectives = race.objectives.map((d) => evaluateObjective(d, o));
  const objectiveCredits = objectives.reduce((a, r) => a + (r.done ? r.def.bonus : 0), 0);
  const salvage = Math.max(0, Math.round(o.salvage));
  const salvageCredits = salvage * 5;
  const totalCredits = positionCredits + combatCredits + capitalCredits + objectiveCredits + salvageCredits;
  return {
    positionCredits, combatCredits, capitalCredits, objectiveCredits, salvageCredits,
    totalCredits, salvage, objectives,
    unlockedNext: o.finished && pos <= race.unlockPos,
  };
}
