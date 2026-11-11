import { useEffect, useRef, useSyncExternalStore } from 'react';
import { TYPE_LABEL, type RaceDef } from '../game/data/campaign';
import type { Game } from '../game/Game';
import { hudStore, type HudState } from '../game/hudStore';
import { ControlsGuide, fmtTime } from './common';

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
      ctx.fillStyle = d.color;
      if (d.enemy) ctx.fillRect(X(d.x) - 2, Y(d.z) - 2, 4, 4);
      else { ctx.beginPath(); ctx.arc(X(d.x), Y(d.z), 2.6, 0, 6.3); ctx.fill(); }
    }
    const me = hud.dots.find((d) => d.isPlayer);
    if (me) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(me.x), Y(me.z), 4, 0, 6.3); ctx.fill(); ctx.stroke(); }
  }, [game, hud]);
  return <canvas ref={ref} className="mini" />;
}

/** Close-range radar: the player's nose points up, so anything in the lower half is behind. */
function Radar({ hud }: { hud: HudState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = 116;
    if (c.width !== S * dpr) { c.width = S * dpr; c.height = S * dpr; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const m = S / 2, R = m - 4, range = 280;
    const danger = hud.missileWarn > 0 || !!hud.lockedBy;
    ctx.fillStyle = danger ? 'rgba(60,6,12,0.72)' : 'rgba(6,10,28,0.66)';
    ctx.beginPath(); ctx.arc(m, m, R, 0, 6.3); ctx.fill();
    ctx.strokeStyle = danger ? '#ff3d5a' : 'rgba(0,229,255,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,229,255,0.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(m, m, R * 0.5, 0, 6.3); ctx.moveTo(m - R, m); ctx.lineTo(m + R, m); ctx.moveTo(m, m - R); ctx.lineTo(m, m + R); ctx.stroke();
    // rear arc: where the tail gun and rear-launched missiles can reach
    ctx.fillStyle = 'rgba(255,225,74,0.1)';
    ctx.beginPath(); ctx.moveTo(m, m); ctx.arc(m, m, R * 0.82, Math.PI / 2 - 0.64, Math.PI / 2 + 0.64); ctx.closePath(); ctx.fill();
    for (const b of hud.blips) {
      const d = Math.hypot(b.x, b.y);
      const k = Math.min(1, d / range);
      const a = Math.atan2(b.x, b.y);
      const px = m + Math.sin(a) * k * R, py = m - Math.cos(a) * k * R;
      ctx.fillStyle = b.kind === 'missile' ? '#fff' : b.color;
      if (b.kind === 'missile') { ctx.beginPath(); ctx.moveTo(px, py - 5); ctx.lineTo(px + 4, py + 4); ctx.lineTo(px - 4, py + 4); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#ff3d5a'; ctx.lineWidth = 1.5; ctx.stroke(); }
      else if (b.kind === 'fighter') ctx.fillRect(px - 3, py - 3, 6, 6);
      else if (b.kind === 'capital') { ctx.globalAlpha = 0.7; ctx.fillRect(px - 2, py - 2, 4, 4); ctx.globalAlpha = 1; }
      else { ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 6.3); ctx.fill(); }
      if (b.hostile && b.kind !== 'missile') { ctx.strokeStyle = '#ff3d5a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, 6.5, 0, 6.3); ctx.stroke(); }
    }
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath(); ctx.moveTo(m, m - 6); ctx.lineTo(m + 4, m + 5); ctx.lineTo(m - 4, m + 5); ctx.closePath(); ctx.fill();
  }, [hud]);
  return <canvas ref={ref} className="radar" />;
}

export function Hud({ game, showMinimap, touch }: { game: Game; showMinimap: boolean; touch: boolean }) {
  const hud = useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot);
  if (!hud) return null;
  const hullFrac = hud.hp / hud.hpMax;
  const racing = hud.phase === 'racing' && !hud.finished;
  const battle = hud.mode === 'battle';
  return (
    <div className={`hud ${touch ? 'touch' : ''}`}>
      {hud.hitT < 0.35 && racing && <div className="flash" style={{ opacity: 1 - hud.hitT / 0.35 }} />}
      {hud.hitT < 1.1 && racing && <div className="hitdir" style={{ transform: `rotate(${(-hud.hitAngle * 180) / Math.PI}deg)`, opacity: 1 - hud.hitT / 1.1 }} />}
      {hud.hitMarkT < 0.22 && racing && <div className="hitmark" style={{ opacity: 1 - hud.hitMarkT / 0.22 }}>✕</div>}

      <div className="box tl">
        <div className="pos">{hud.position}<small>/10</small></div>
        {battle ? (
          <>
            <div className="lapline">SCORE {hud.score.toLocaleString()}</div>
            <div className="timeline">
              <span>TIME LEFT</span><span style={{ color: hud.timeLeft < 20 ? 'var(--red)' : undefined }}>{fmtTime(hud.timeLeft)}</span>
              <span>FIGHTERS</span><span>{hud.droneKills} down · {hud.fighters} active</span>
            </div>
          </>
        ) : (
          <>
            <div className="lapline">LAP {hud.lap}/{hud.laps}{hud.dying && hud.warPhase > 0 ? <span className="tagwarn">{hud.warPhase === 1 ? ' BREAKING UP' : ' GOING DOWN'}</span> : null}</div>
            <div className="timeline">
              <span>TIME</span><span>{fmtTime(hud.time)}</span>
              <span>LAP</span><span>{fmtTime(hud.lapTime)}</span>
              <span>BEST</span><span>{fmtTime(hud.bestLap)}</span>
            </div>
          </>
        )}
        <div className="objs">
          {hud.objectives.map((o) => <div key={o.label} className={o.done ? 'done' : ''}>{o.done ? '✔' : '○'} {o.label}</div>)}
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
        {!hud.bossDestroyed && (
          <div className="bossstat">
            <span className={hud.bossShield ? 'on' : 'off'}>SHIELD {hud.bossShield ? 'UP' : 'DOWN'}</span>
            <span className={hud.bossPower >= 1 ? 'on' : 'off'}>POWER {Math.round(hud.bossPower * 100)}%</span>
            <span className={hud.bossRepair ? 'on' : 'off'}>REPAIRS {hud.bossRepair ? 'ON' : 'OFF'}</span>
          </div>
        )}
      </div>

      {hud.targetName && racing && (
        <div className="target">
          {hud.targetRear ? '▼ REAR GUN: ' : '⌖ '}{hud.targetName}
          <div className="mbar"><i style={{ width: `${hud.targetHp * 100}%` }} /></div>
        </div>
      )}

      <div className="box tr">
        {showMinimap && <Minimap game={game} hud={hud} />}
        <div className="stand">
          {hud.standings.map((s) => (
            <div key={s.name} style={{ display: 'contents' }}>
              <span className={s.isPlayer ? 'me' : ''}>{s.place}</span>
              <span className={s.isPlayer ? 'me' : s.finished ? 'fin' : ''} style={s.isPlayer ? undefined : { color: s.finished ? undefined : s.color, opacity: s.alive ? 1 : 0.4 }}>
                {s.name}{s.mood && <em>{s.mood}</em>}
              </span>
              <span className={s.finished ? 'fin' : ''}>{battle ? s.score : s.finished ? (s.dnf ? 'DNF' : fmtTime(s.time)) : `L${s.lap}`}</span>
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
        <Radar hud={hud} />
        <div>
          <div className="speed">{hud.speed}<small>KM/H</small></div>
          <div className={`mbar boost ${hud.overdrive > 0 ? 'od' : hud.boostLock ? 'lock' : ''}`}><i style={{ width: `${hud.boost}%` }} /></div>
          <div className="keyhint">{hud.overdrive > 0 ? `OVERDRIVE ${hud.overdrive.toFixed(1)}s` : hud.boostLock ? 'BOOST RECHARGING' : touch ? 'BOOST' : 'BOOST [SHIFT]'}{' · '}<span style={{ color: hud.flareReady ? 'var(--green)' : 'var(--dim)' }}>FLARES {hud.flareReady ? 'READY' : '···'}</span></div>
        </div>
      </div>

      <div className="box br">
        <div className="meter"><span>HEAT</span><div className={`mbar heat ${hud.overheated ? 'over' : ''}`}><i style={{ width: `${hud.heat}%` }} /></div><span className="keyhint">{touch ? '' : 'SPC'}</span></div>
        <div className="meter">
          <span>MSL ×{hud.missiles}</span>
          <div className="missiles">{Array.from({ length: Math.max(hud.missileMax, hud.missiles) }, (_, i) => <i key={i} className={i < hud.missiles ? '' : 'off'} />)}</div>
          <span className="keyhint">{hud.missileReady < 1 ? '···' : touch ? '' : 'E'}</span>
        </div>
        <div className="meter"><span style={{ fontSize: 10 }}>{hud.abilityName}</span><div className={`mbar abil ${hud.abilityActive ? 'active' : hud.abilityReady >= 1 ? 'ready' : ''}`}><i style={{ width: `${(hud.abilityActive ? 1 : hud.abilityReady) * 100}%` }} /></div><span className="keyhint">{hud.abilityActive ? 'ON' : hud.abilityReady >= 1 ? (touch ? 'RDY' : 'Q') : '···'}</span></div>
      </div>

      <div className="msgs">
        {hud.messages.map((m) => <div key={m.id} className={`msg ${m.kind}`} style={{ opacity: m.t > 3.2 ? Math.max(0, (4 - m.t) / 0.8) : 1 }}>{m.text}</div>)}
      </div>

      {racing && hud.dead <= 0 && hud.missileWarn > 0 && (
        <div className="alert missile">▲ MISSILE INBOUND ▲<small>{hud.flareReady ? (touch ? 'TAP BOOST: FLARES' : 'TAP SHIFT: FLARES') : 'FLARES RELOADING - EVADE'}</small></div>
      )}
      {racing && hud.dead <= 0 && hud.missileWarn === 0 && hud.lockedBy && <div className="alert lock">◉ {hud.lockedBy} HAS YOU TARGETED</div>}
      {hud.wrongWay && racing && hud.dead <= 0 && <div className="warn">WRONG WAY</div>}
      {hud.dead > 0 && racing && <div className="warn" style={{ color: 'var(--orange)', textShadow: '0 0 20px var(--orange)' }}>REBUILDING {hud.dead.toFixed(1)}</div>}
      <div className="fps">{hud.fps} FPS</div>
    </div>
  );
}

/** Countdown, plus a briefing card with the event's goals and the controls before every start. */
export function Countdown({ race, touch }: { race: RaceDef; touch: boolean }) {
  const hud = useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot);
  if (!hud) return null;
  if (hud.phase === 'grid') {
    const n = Math.ceil(hud.countdown);
    return (
      <div className="count">
        {n > 3 ? <span key="r" style={{ fontSize: 'clamp(34px, 8vh, 80px)' }}>GET READY</span> : <span key={n}>{n}</span>}
        <div className="brief">
          <div className="bt">{race.name} · {TYPE_LABEL[race.type]}</div>
          <div className="bd">
            {race.mode === 'battle' ? `Score the most points in ${Math.round(race.timeLimit / 60 * 10) / 10} minutes: shoot down fighters, hit the capital ship, grab salvage.`
              : race.type === 'surface' ? 'Three laps across the hull of a battleship under fire. Deck sections are lost as the fight goes on; you hover across the gaps.'
              : 'Three laps. Fight for position, and hit the capital ship as you pass.'}
          </div>
          <ControlsGuide compact touch={touch} />
        </div>
      </div>
    );
  }
  if (hud.phase === 'racing' && hud.time < 1.1) return <div className="count"><span key="go" className="go">GO!</span></div>;
  return null;
}
