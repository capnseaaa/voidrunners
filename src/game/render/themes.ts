// Per-track colour and atmosphere settings shared by the track mesh,
// environment and capital ship builders.
import type { TrackId } from '../data/campaign';

export interface Theme {
  road: string; roadLine: string; rail: number; railAlt: number; gate: number;
  skyTop: number; skyBottom: number; nebulaA: number; nebulaB: number; stars: number;
  fog: number; fogDensity: number;
  sun: number; sunIntensity: number; ambientSky: number; ambientGround: number; ambientIntensity: number;
  sunDir: [number, number, number];
  capitalHull: number; capitalStripe: number; capitalGlow: number;
  pad: number;
}

export const THEMES: Record<TrackId, Theme> = {
  neon: {
    road: '#0b0f24', roadLine: '#00e5ff', rail: 0x00e5ff, railAlt: 0xff2bd6, gate: 0xff2bd6,
    skyTop: 0x05021a, skyBottom: 0x2a0a4a, nebulaA: 0x1238a8, nebulaB: 0xc01890, stars: 1,
    fog: 0x0a0424, fogDensity: 0.00042,
    sun: 0xbfd8ff, sunIntensity: 1.6, ambientSky: 0x4466ff, ambientGround: 0xff3399, ambientIntensity: 1.0,
    sunDir: [0.4, 0.8, 0.3],
    capitalHull: 0x4a5670, capitalStripe: 0x00e5ff, capitalGlow: 0x35d8ff, pad: 0xffe14a,
  },
  orbit: {
    road: '#120c22', roadLine: '#b06bff', rail: 0xb06bff, railAlt: 0x2affc8, gate: 0x2affc8,
    skyTop: 0x020208, skyBottom: 0x0d1028, nebulaA: 0x302070, nebulaB: 0x0a5a60, stars: 1.3,
    fog: 0x05050f, fogDensity: 0.00035,
    sun: 0xd8e4ff, sunIntensity: 1.9, ambientSky: 0x6a70c0, ambientGround: 0x203040, ambientIntensity: 0.75,
    sunDir: [-0.5, 0.6, 0.4],
    capitalHull: 0x4a4458, capitalStripe: 0xb06bff, capitalGlow: 0xc48aff, pad: 0x2affc8,
  },
  solar: {
    road: '#2a1408', roadLine: '#ffb020', rail: 0xffb020, railAlt: 0x30e0ff, gate: 0x30e0ff,
    skyTop: 0x3a1c50, skyBottom: 0xff8a3a, nebulaA: 0xff5a20, nebulaB: 0xffc060, stars: 0.15,
    fog: 0xd8703a, fogDensity: 0.00034,
    sun: 0xfff0c8, sunIntensity: 2.6, ambientSky: 0xffb070, ambientGround: 0x803818, ambientIntensity: 1.0,
    sunDir: [0.5, 0.55, -0.4],
    capitalHull: 0x6a5648, capitalStripe: 0xff9a2a, capitalGlow: 0xffc040, pad: 0x30e0ff,
  },
  warzone: {
    road: '#1c0a10', roadLine: '#ff3d5a', rail: 0xff3d5a, railAlt: 0xffa020, gate: 0xffa020,
    skyTop: 0x06020a, skyBottom: 0x3a0a14, nebulaA: 0x8a1020, nebulaB: 0x6a3008, stars: 1,
    fog: 0x16050a, fogDensity: 0.0003,
    sun: 0xffd0b0, sunIntensity: 1.8, ambientSky: 0xa04060, ambientGround: 0x402010, ambientIntensity: 0.85,
    sunDir: [0.3, 0.7, -0.5],
    capitalHull: 0x58424a, capitalStripe: 0xff3d5a, capitalGlow: 0xff5040, pad: 0xffa020,
  },
};
