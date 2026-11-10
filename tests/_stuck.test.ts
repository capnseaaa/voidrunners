import { test } from 'vitest';
import { RACES } from '../src/game/data/campaign';
import { PLAYER_SHIPS, uniformLevels } from '../src/game/data/ships';
import { RaceSim } from '../src/game/sim/race';

test('stuck', () => {
  const ids = (process.env.RACES || 's1r1').split(',');
  for (const id of ids) {
    const race = RACES.find((r) => r.id === id)!;
    const sim = new RaceSim({ race, playerShip: PLAYER_SHIPS[0], playerUpgrades: uniformLevels(0), autopilot: true });
    const dt = 1 / 60;
    let steps = 0;
    const last = sim.ships.map((s) => ({ t: 0, total: s.total, n: 0 }));
    while (sim.phase !== 'done' && steps < 60 * 520) {
      sim.step(dt); steps++;
      sim.events.clear();
      if (sim.phase !== 'racing') continue;
      for (const s of sim.ships) {
        const l = last[s.index];
        if (s.finished) continue;
        if (Math.abs(s.total - l.total) > 40) { l.total = s.total; l.t = sim.time; }
        else if (sim.time - l.t > 6 && l.n < 6 && steps % 60 === 0) {
          l.n++;
          const p = sim.track.paths[s.pathId];
          const br = sim.track.paths.slice(1).map((b) => `${b.name}[from ${b.fromIdx} to ${b.toIdx} n=${b.samples.length} fe=${b.forkEnd} ms=${b.mergeStart}]`).join(' ');
          console.log(`${id} t=${sim.time.toFixed(1)} ${s.name} path=${s.pathId} idx=${s.idx}/${p.samples.length} d=${s.d.toFixed(1)} hw=${s.hw.toFixed(1)} spd=${s.fwdSpeed.toFixed(1)} dead=${s.dead.toFixed(1)} headingDot=${(s.hx * s.trackHx + s.hz * s.trackHz).toFixed(2)} ctl=${JSON.stringify(s.ctl)} stuckT=${s.stuckT.toFixed(1)} total=${s.total.toFixed(0)} | ${br}`);
        }
      }
    }
  }
});
