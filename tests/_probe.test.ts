import { test } from 'vitest';
import { RACES } from '../src/game/data/campaign';
import { PLAYER_SHIPS, uniformLevels } from '../src/game/data/ships';
import { RaceSim } from '../src/game/sim/race';

test('probe', () => {
  const ids = (process.env.RACES || 's1r1').split(',');
  const shipId = process.env.SHIP || 'comet';
  const lvl = Number(process.env.LVL || 0);
  for (const id of ids) {
    const race = RACES.find((r) => r.id === id)!;
    const sim = new RaceSim({ race, playerShip: PLAYER_SHIPS.find((s) => s.id === shipId)!, playerUpgrades: uniformLevels(lvl), autopilot: true });
    const dt = 1 / 60;
    let steps = 0;
    const evc: Record<string, number> = {};
    const capLog: string[] = [];
    while (sim.phase !== 'done' && steps < 60 * 900) {
      sim.step(dt); steps++;
      for (let i = 0; i < sim.events.count; i++) {
        const e = sim.events.list[i];
        evc[e.type] = (evc[e.type] || 0) + 1;
        if (e.type === 'componentDestroyed') capLog.push(`${sim.time.toFixed(0)}s ${sim.capital.components[e.other].name} by ${e.ship >= 0 ? sim.ships[e.ship].name : '?'}`);
      }
      sim.events.clear();
    }
    console.log(`\n=== ${id} ${race.track} phase=${sim.phase} time=${sim.time.toFixed(1)} capital ${(100 * (1 - sim.capital.hp / sim.capital.maxHp)).toFixed(0)}% destroyed=${sim.capital.destroyed}`);
    for (const idx of sim.order) {
      const s = sim.ships[idx];
      console.log(`${String(s.finishPos).padStart(2)} ${s.name.padEnd(10)} t=${s.finishTime.toFixed(1)} best=${s.bestLap.toFixed(1)} dnf=${s.dnf} deaths=${s.deaths} salv=${s.salvage.toFixed(0)} rdmg=${s.racerDamage.toFixed(0)} kills=${s.racerKills} cap=${s.capitalDamage.toFixed(0)} ck=${s.capitalKills} mis=${s.missiles}`);
    }
    console.log(capLog.join(' | '));
    console.log(JSON.stringify(evc));
  }
});
