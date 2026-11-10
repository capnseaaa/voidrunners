import { test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { getTrack } from '../src/game/tracks';

test('viz', () => {
  const out = process.env.VIZ_OUT;
  if (!out) return;
  let html = '<html><body style="background:#111;margin:0;display:grid;grid-template-columns:1fr 1fr;width:1600px">';
  for (const id of ['neon', 'orbit', 'solar', 'warzone'] as const) {
    const t = getTrack(id);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of t.paths) for (const s of p.samples) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }
    const pad = 150;
    let svg = `<svg width="800" height="640" viewBox="${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}" xmlns="http://www.w3.org/2000/svg">`;
    const cols = ['#4af', '#f84', '#8f4', '#f4f'];
    for (const p of t.paths) {
      const L = p.samples.map((s) => `${(s.x - s.rx * s.hw).toFixed(0)},${(s.z - s.rz * s.hw).toFixed(0)}`).join(' ');
      const R = p.samples.map((s) => `${(s.x + s.rx * s.hw).toFixed(0)},${(s.z + s.rz * s.hw).toFixed(0)}`).join(' ');
      svg += `<polyline points="${L}" fill="none" stroke="${cols[p.id]}" stroke-width="3"/><polyline points="${R}" fill="none" stroke="${cols[p.id]}" stroke-width="3"/>`;
      if (p.id > 0) {
        const a = p.samples[p.forkEnd], b = p.samples[p.mergeStart];
        svg += `<circle cx="${a.x}" cy="${a.z}" r="14" fill="yellow"/><circle cx="${b.x}" cy="${b.z}" r="14" fill="orange"/>`;
      }
    }
    const m = t.main.samples;
    for (const c of t.checkpoints) { const s = m[Math.floor(c.prog / t.main.step)]; svg += `<text x="${s.x}" y="${s.z}" fill="#fff" font-size="60">${c.index}</text>`; }
    const a = m[Math.floor(t.capitalFromS / t.main.step)], b = m[Math.floor(t.capitalToS / t.main.step)];
    const sd = t.def.capital.side * t.def.capital.dist;
    svg += `<line x1="${a.x + a.rx * sd}" y1="${a.z + a.rz * sd}" x2="${b.x + b.rx * sd}" y2="${b.z + b.rz * sd}" stroke="red" stroke-width="40"/>`;
    const s0 = m[0];
    svg += `<line x1="${s0.x}" y1="${s0.z}" x2="${s0.x + s0.hx * 150}" y2="${s0.z + s0.hz * 150}" stroke="#fff" stroke-width="12"/>`;
    let maxCurv = 0; for (const s of m) maxCurv = Math.max(maxCurv, Math.abs(s.curv));
    svg += `<text x="${minX}" y="${minZ - 60}" fill="#fff" font-size="70">${id} len=${t.length.toFixed(0)} minR=${(1 / maxCurv).toFixed(0)} ${t.paths.slice(1).map((p) => `${p.name}:${p.length.toFixed(0)} vs ${(m[p.toIdx].s - m[p.fromIdx].s).toFixed(0)} fe=${p.forkEnd} ms=${p.samples.length - 1 - p.mergeStart}`).join(' | ')}</text>`;
    svg += '</svg>';
    html += svg;
  }
  html += '</body></html>';
  writeFileSync(out, html);
});
