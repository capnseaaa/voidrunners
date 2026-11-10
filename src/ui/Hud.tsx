import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Game } from '../game/Game';
import { hudStore, type HudState } from '../game/hudStore';
import { fmtTime } from './common';

const COMP_SHORT: Record<string, string> = { shield: 'SHLD', battery: 'GUN', engine: 'ENG', cargo: 'CRGO' };

function Minimap({ game, hud }: { game: Game; hud: HudState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 180, H = 150;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const b = game.bounds;
    const sc = Math.min((W - 16) / (b.maxX - b.minX), (H - 16) / (b.maxZ - b.minZ));
    const ox = (W - (b.maxX - b.minX) * sc) / 2, oz = (H - (b.maxZ - b.minZ) * sc) / 2;
    const X = (x: number) => ox + (x - b.minX) * sc, Y = (z: number) => oz + (z - b.minZ) * sc;
    for (const line of game.minimap) {
      ctx.beginPath();
      for (let i = 0; i < line.pts.length; i += 2) { if (i === 0) ctx.moveTo(X(line.pts[i]), Y(line.pts[i + 1])); else ctx.lineTo(X(line.pts[i]), Y(line.pts[i + 1])); }
      ctx.strokeStyle = line.main ? 'rgba(0,229,255,0.85)' : 'rgba(255,154,42,0.85)';
      ctx.lineWidth = line.main ? 2.4 : 1.6;
      ctx.stroke();
    }
    // capital ship marker
    const cap = game.sim.capital;
    if (!cap.destroyed) {
      ctx.strokeStyle = 'rgba(255,61,90,0.95)'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(X(cap.cx - cap.dirX * cap.length / 2), Y(cap.cz - cap.dirZ * cap.length / 2));
      ctx.lineTo(X(cap.cx + cap.dirX * cap.length / 2), Y(cap.cz + cap.dirZ * cap.length / 2));
      ctx.stroke();
    }
    for (const d of hud.dots) {
      if (d.isPlayer) continue;
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(X(d.x), Y(d.z), 2.6, 0, 6.3); ctx.fill();
    }
    const me = hud.dots.find((d) => d.isPlayer);
    if (me) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(me.x), Y(me.z), 4, 0, 6.3); ctx.fill(); ctx.stroke(); }
  }, [game, hud]);
  return <canvas ref={ref} />;
}

export function Hud({ game, showMinimap }: { game: Game; showMinimap: boolean }) {
  const hud = useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot);
  if (!hud) return null;
  const hullFrac = hud.hp / hud.hpMax;
  const racing = hud.phase === 'racing' && !hud.finished;
  return (
    <div className="hud">
      {hud.hitT < 0.35 && racing && <div className="flash" style={{ opacity: 1 - hud.hitT / 0.35 }} />}
      {hud.hitT < 1.1 && racing && <div className="hitdir" style={{ transform: `rotate(${(-hud.hitAngle * 180) / Math.PI}deg)`, opacity: 1 - hud.hitT / 1.1 }} />}

      <div className="box tl">
        <div className="pos">{hud.position}<small>/10</small></div>
        <div className="lapline">LAP {hud.lap}/{hud.laps}</div>
        <div className="timeline">
          <span>TIME</span><span>{fmtTime(hud.time)}</span>
          <span>LAP</span><span>{fmtTime(hud.lapTime)}</span>
          <span>BEST</span><span>{fmtTime(hud.bestLap)}</span>
        </div>
      </div>

      <div className="box boss" style={{ opacity: hud.bossNear || hud.bossDestroyed ? 1 : 0.72 }}>
        <div className="nm"><span>{hud.bossName}</span><span>{hud.bossDestroyed ? 'DISABLED' : hud.bossShield ? 'SHIELDS UP' : `${Math.round(hud.bossHp * 100)}%`}</span></div>
        <div className={`bossbar ${hud.bossShield ? 'shielded' : ''}`}><i style={{ width: `${hud.bossHp * 100}%` }} /></div>
        <div className="comps">
          {hud.components.map((c) => (
            <div key={c.name} className={`comp ${!c.alive ? 'dead' : !c.vulnerable ? 'prot' : ''} ${c.targeted ? 'tgt' : ''}`} title={c.name}>
              {COMP_SHORT[c.type]}
              <div className="cb"><i style={{ width: `${c.hp * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      {hud.targetName && racing && (
        <div className="target">
          ⌖ {hud.targetName}
          <div className="mbar"><i style={{ width: `${hud.targetHp * 100}%` }} /></div>
        </div>
      )}

      <div className="box tr">
        {showMinimap && <Minimap game={game} hud={hud} />}
        <div className="stand">
          {hud.standings.map((s) => (
            <div key={s.name} style={{ display: 'contents' }}>
              <span className={s.isPlayer ? 'me' : ''}>{s.place}</span>
              <span className={s.isPlayer ? 'me' : s.finished ? 'fin' : ''} style={s.isPlayer ? undefined : { color: s.finished ? undefined : s.color }}>{s.name}</span>
              <span className={s.finished ? 'fin' : ''}>{s.finished ? (s.dnf ? 'DNF' : fmtTime(s.time)) : `L${s.lap}`}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="box bl">
        <div className="meter"><span>HULL</span><div className={`mbar hull ${hullFrac < 0.3 ? 'low' : ''}`}><i style={{ width: `${hullFrac * 100}%` }} /></div><span>{Math.ceil(hud.hp)}</span></div>
        <div className="meter"><span>SHIELD</span><div className="mbar shield"><i style={{ width: `${(hud.shield / hud.shieldMax) * 100}%` }} /></div><span>{Math.ceil(hud.shield)}</span></div>
        <div className="salv">⬢ SALVAGE {hud.salvage}</div>
      </div>

      <div className="box bc">
        <div className="msgs" style={{ position: 'static', transform: 'none', marginBottom: 8 }} />
        <div className="speed">{hud.speed}<small>KM/H</small></div>
        <div className={`mbar boost ${hud.overdrive > 0 ? 'od' : hud.boostLock ? 'lock' : ''}`}><i style={{ width: `${hud.boost}%` }} /></div>
        <div className="keyhint">{hud.overdrive > 0 ? `OVERDRIVE ${hud.overdrive.toFixed(1)}s` : hud.boostLock ? 'BOOST RECHARGING' : 'BOOST [E]'}</div>
      </div>

      <div className="box br">
        <div className="meter"><span>HEAT</span><div className={`mbar heat ${hud.overheated ? 'over' : ''}`}><i style={{ width: `${hud.heat}%` }} /></div><span className="keyhint">SPC</span></div>
        <div className="meter">
          <span>MSL ×{hud.missiles}</span>
          <div className="missiles">{Array.from({ length: Math.max(hud.missileMax, hud.missiles) }, (_, i) => <i key={i} className={i < hud.missiles ? '' : 'off'} />)}</div>
          <span className="keyhint">{hud.missileReady < 1 ? '···' : 'SHFT'}</span>
        </div>
        <div className="meter"><span style={{ fontSize: 10 }}>{hud.abilityName}</span><div className={`mbar abil ${hud.abilityActive ? 'active' : hud.abilityReady >= 1 ? 'ready' : ''}`}><i style={{ width: `${(hud.abilityActive ? 1 : hud.abilityReady) * 100}%` }} /></div><span className="keyhint">{hud.abilityActive ? 'ON' : hud.abilityReady >= 1 ? 'Q' : '···'}</span></div>
      </div>

      <div className="msgs">
        {hud.messages.map((m) => <div key={m.id} className={`msg ${m.kind}`} style={{ opacity: m.t > 3.2 ? Math.max(0, (4 - m.t) / 0.8) : 1 }}>{m.text}</div>)}
      </div>

      {hud.wrongWay && racing && hud.dead <= 0 && <div className="warn">WRONG WAY</div>}
      {hud.dead > 0 && racing && <div className="warn" style={{ color: 'var(--orange)', textShadow: '0 0 20px var(--orange)' }}>REBUILDING {hud.dead.toFixed(1)}</div>}
      <div className="fps">{hud.fps} FPS</div>
    </div>
  );
}

export function Countdown() {
  const hud = useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot);
  if (!hud) return null;
  if (hud.phase === 'grid') {
    const n = Math.ceil(hud.countdown);
    if (n > 3) return <div className="count"><span key="r" style={{ fontSize: 'clamp(40px, 9vh, 90px)' }}>GET READY</span></div>;
    return <div className="count"><span key={n}>{n}</span></div>;
  }
  if (hud.phase === 'racing' && hud.time < 1.1) return <div className="count"><span key="go" className="go">GO!</span></div>;
  return null;
}
