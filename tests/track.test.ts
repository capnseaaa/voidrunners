import { describe, expect, it } from 'vitest';
import { RACES, type TrackId } from '../src/game/data/campaign';
import { buildLayout } from '../src/game/sim/layout';
import { getTrack } from '../src/game/tracks';
import { insidePath, locateOn, newFrame, pointAt, type TrackPos } from '../src/game/tracks/track';
import { Vector3 } from 'three';

const IDS: TrackId[] = ['neon', 'orbit', 'solar', 'warzone'];

describe.each(IDS)('track %s', (id) => {
  const track = getTrack(id);
  const main = track.main;

  it('is a closed loop of sensible length with evenly spaced samples', () => {
    expect(track.length).toBeGreaterThan(9000);
    expect(track.length).toBeLessThan(14000);
    const ss = main.samples;
    for (let i = 0; i < ss.length; i++) {
      const a = ss[i], b = ss[(i + 1) % ss.length];
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      expect(d).toBeGreaterThan(main.step * 0.8);
      expect(d).toBeLessThan(main.step * 1.2);
      expect(a.hw).toBeGreaterThanOrEqual(14);
    }
  });

  it('has at least two alternative routes that fork from and rejoin the main line', () => {
    expect(track.paths.length).toBeGreaterThanOrEqual(3);
    for (const b of track.paths.slice(1)) {
      const first = b.samples[0], last = b.samples[b.samples.length - 1];
      const from = main.samples[b.fromIdx], to = main.samples[b.toIdx];
      expect(Math.hypot(first.x - from.x, first.z - from.z)).toBeLessThan(2);
      expect(Math.hypot(last.x - to.x, last.z - to.z)).toBeLessThan(2);
      expect(b.toIdx).toBeGreaterThan(b.fromIdx);
      expect(b.forkEnd).toBeGreaterThan(2);
      expect(b.mergeStart).toBeLessThan(b.samples.length - 3);
      // the middle of the branch is genuinely separate from the main ribbon
      const mid = b.samples[Math.floor(b.samples.length / 2)];
      let separate = true;
      for (let i = b.fromIdx; i <= b.toIdx; i += 2) if (insidePath(main, mid.x, mid.z, i, 1, 0) && Math.abs(main.samples[i].y - mid.y) < 10) separate = false;
      expect(separate).toBe(true);
    }
  });

  it('maps branch progress continuously onto main-line progress', () => {
    for (const b of track.paths.slice(1)) {
      const fromS = main.samples[b.fromIdx].s, toS = main.samples[b.toIdx].s;
      expect(b.samples[0].prog).toBeCloseTo(fromS, 3);
      expect(b.samples[b.samples.length - 1].prog).toBeCloseTo(toS, 0);
      for (let i = 1; i < b.samples.length; i++) expect(b.samples[i].prog).toBeGreaterThan(b.samples[i - 1].prog);
    }
  });

  it('places checkpoints in order around the lap, starting at the finish line', () => {
    const cps = track.checkpoints;
    expect(cps.length).toBeGreaterThanOrEqual(8);
    expect(cps[0].prog).toBe(0);
    for (let i = 1; i < cps.length; i++) expect(cps[i].prog - cps[i - 1].prog).toBeCloseTo(track.length / cps.length, 3);
  });

  it('projects points back onto the route geometry consistently', () => {
    const v = new Vector3(), fr = newFrame();
    const out: TrackPos = { path: 0, idx: 0, f: 0, d: 0 };
    for (const p of track.paths) {
      for (const [frac, d] of [[0.2, 0], [0.5, 5], [0.8, -6]] as const) {
        const s = p.length * frac;
        pointAt(p, s, d, v, fr);
        locateOn(p, v.x, v.z, Math.floor(s / p.step), out);
        expect(out.d).toBeCloseTo(d, 0);
        expect(Math.abs((out.idx + out.f) * p.step - s)).toBeLessThan(1.5);
      }
    }
  });

  it('puts every pad, pickup and hazard on drivable track for all three race variants', () => {
    const v = new Vector3(), fr = newFrame();
    for (const race of RACES.filter((r) => r.track === id)) {
      const layout = buildLayout(track, race);
      expect(layout.pads.length).toBeGreaterThanOrEqual(8);
      expect(layout.pickups.length).toBeGreaterThan(60);
      expect(layout.obstacles.length).toBeGreaterThan(20);
      for (const item of [...layout.pads, ...layout.pickups, ...layout.obstacles]) {
        pointAt(track.paths[item.path], item.s, 0, v, fr);
        expect(Math.abs(item.d)).toBeLessThan(fr.hw);
      }
      // nothing blocks the starting grid
      for (const o of layout.obstacles) if (o.path === 0) expect(o.baseS > 200 && o.baseS < track.length - 280).toBe(true);
      // both alternative routes hold something worth the detour
      for (let b = 1; b < track.paths.length; b++) expect(layout.pickups.some((p) => p.path === b)).toBe(true);
    }
  });

  it('has a capital ship encounter stretch away from the start line', () => {
    expect(track.capitalToS).toBeGreaterThan(track.capitalFromS + 800);
    expect(track.capitalFromS).toBeGreaterThan(600);
  });
});
