import type { TrackId } from '../data/campaign';
import { ARENA, DEAD_ORBIT, HULK, NEON_FRONTIER, SOLAR_SCAR, WARZONE_ZERO } from './defs';
import { buildTrack, type Track, type TrackDef } from './track';

export const TRACK_DEFS: Record<TrackId, TrackDef> = {
  neon: NEON_FRONTIER,
  orbit: DEAD_ORBIT,
  solar: SOLAR_SCAR,
  warzone: WARZONE_ZERO,
  hulk: HULK,
  arena: ARENA,
};

const cache = new Map<TrackId, Track>();

/** Tracks are immutable once built, so they are cached and shared. */
export function getTrack(id: TrackId): Track {
  let t = cache.get(id);
  if (!t) { t = buildTrack(TRACK_DEFS[id]); cache.set(id, t); }
  return t;
}
