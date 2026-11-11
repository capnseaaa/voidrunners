import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { audio } from '../game/audio/AudioEngine';
import { RACES, TYPE_LABEL, type RaceDef } from '../game/data/campaign';
import { capitalShare } from '../game/data/rewards';
import { getPlayerShip } from '../game/data/ships';
import { Game, type RaceResult } from '../game/Game';
import { hudStore } from '../game/hudStore';
import type { SaveData, Settings } from '../game/save/save';
import { Btn, ControlsGuide, fmtTime, ordinal } from './common';
import { Countdown, Hud } from './Hud';
import { TouchControls } from './TouchControls';
import { isTouchDevice } from '../game/input/Input';
import { SettingsPanel } from './Menus';

interface Props {
  race: RaceDef;
  save: SaveData;
  autopilot: boolean;
  onSettings: (s: Settings) => void;
  onResult: (r: RaceResult) => { nextUnlocked: boolean };
  onRestart: () => void;
  onNext: (r: RaceDef) => void;
  onExit: (to: 'campaign' | 'hangar' | 'title') => void;
}

export function RaceScreen({ race, save, autopilot, onSettings, onResult, onRestart, onNext, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [pauseTab, setPauseTab] = useState<'menu' | 'settings' | 'controls'>('menu');
  const [result, setResult] = useState<RaceResult | null>(null);
  const [nextUnlocked, setNextUnlocked] = useState(false);
  const gameRef = useRef<Game | null>(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const hasResult = useRef(false);
  // settings at race start (quality needs a restart; the rest applies live)
  const startSettings = useRef(save.settings);
  const touch = save.settings.touchControls === 'on' || (save.settings.touchControls === 'auto' && isTouchDevice());
  const touchRef = useRef(touch);
  touchRef.current = touch;

  useEffect(() => {
    let disposed = false;
    let g: Game | null = null;
    // let the loading overlay paint before the (synchronous) scene build
    const t = setTimeout(() => {
      if (disposed || !canvasRef.current) return;
      try {
        const ship = getPlayerShip(save.selectedShip);
        g = new Game(canvasRef.current, {
          race, ship, upgrades: save.upgrades[ship.id], settings: startSettings.current, touch: touchRef.current, autopilot,
          onFinish: (r) => { hasResult.current = true; const out = resultRef.current(r); setNextUnlocked(out.nextUnlocked); setResult(r); },
          onPauseToggle: () => { if (!hasResult.current) setPaused((p) => !p); },
        });
        gameRef.current = g;
        (window as unknown as { __voidrunners?: unknown }).__voidrunners = g;
        g.start();
        setGame(g);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 60);
    return () => {
      disposed = true;
      clearTimeout(t);
      if (g) g.dispose();
      gameRef.current = null;
      (window as unknown as { __voidrunners?: unknown }).__voidrunners = undefined;
    };
    // the race screen is remounted (keyed) for every new race or restart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { gameRef.current?.setPaused(paused); if (!paused) setPauseTab('menu'); }, [paused]);
  useEffect(() => { gameRef.current?.applySettings(save.settings, touch); }, [save.settings, touch]);
  // auto-pause when the tab is hidden
  useEffect(() => {
    const onVis = () => { if (document.hidden && !hasResult.current && gameRef.current) setPaused(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const next = RACES[race.index + 1];

  return (
    <div className="race">
      <canvas ref={canvasRef} className="view" />
      {!game && !error && (
        <div className="loading">
          <div>{race.name.toUpperCase()}</div>
          <div className="ld"><i /></div>
          <div style={{ fontSize: 11, color: 'var(--dim)' }}>BUILDING CIRCUIT…</div>
        </div>
      )}
      {error && (
        <div className="modal">
          <div className="panel">
            <h2>Could not start the race</h2>
            <p>Your browser could not initialise the 3D renderer (WebGL). Try enabling hardware acceleration, lowering graphics quality in Settings, or using another browser.</p>
            <p className="err">{error}</p>
            <Btn onClick={() => onExit('title')}>Back to menu</Btn>
          </div>
        </div>
      )}
      {game && <Hud game={game} showMinimap={save.settings.showMinimap} touch={touch} />}
      {game && !result && <Countdown race={race} touch={touch} />}
      {game && touch && !result && !paused && <TouchControls game={game} gyro={save.settings.gyro} autoThrottle={save.settings.autoThrottle} onPause={() => setPaused(true)} />}
      {paused && !result && (
        <div className="modal">
          <div className="panel scroll">
            <h2>Paused</h2>
            {pauseTab === 'menu' && (
              <div className="menu" style={{ width: '100%' }}>
                <Btn kind="primary" autoFocus onClick={() => setPaused(false)}>Resume</Btn>
                <Btn onClick={onRestart}>Restart Race</Btn>
                <Btn onClick={() => setPauseTab('controls')}>Controls</Btn>
                <Btn onClick={() => setPauseTab('settings')}>Settings</Btn>
                <Btn kind="danger" sound="back" onClick={() => onExit('campaign')}>Quit to Campaign</Btn>
              </div>
            )}
            {pauseTab === 'controls' && (<><ControlsGuide touch={touch} /><div style={{ marginTop: 14 }}><Btn sound="back" onClick={() => setPauseTab('menu')}>◀ Back</Btn></div></>)}
            {pauseTab === 'settings' && (<><SettingsPanel settings={save.settings} onChange={onSettings} /><Btn sound="back" onClick={() => setPauseTab('menu')}>◀ Back</Btn></>)}
          </div>
        </div>
      )}
      {result && <Results result={result} nextUnlocked={nextUnlocked} next={next} onRestart={onRestart} onNext={onNext} onExit={onExit} />}
    </div>
  );
}

function Results({ result, nextUnlocked, next, onRestart, onNext, onExit }: { result: RaceResult; nextUnlocked: boolean; next: RaceDef | undefined; onRestart: () => void; onNext: (r: RaceDef) => void; onExit: (to: 'campaign' | 'hangar' | 'title') => void }) {
  const hud = useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot);
  const { outcome: o, rewards: rw, race } = result;
  useEffect(() => { audio.ui('select'); }, []);
  const share = capitalShare(o);
  return (
    <div className="modal results">
      <div className="panel scroll">
        <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div className="label">{race.name} · {TYPE_LABEL[race.type]} · Event {race.index + 1}/{RACES.length}</div>
            <div className="bigpos">{o.finished ? ordinal(o.position) : 'DNF'} <span style={{ fontSize: 22, color: 'var(--text)' }}>of 10</span></div>
          </div>
          <div className="kv" style={{ fontSize: 13 }}>
            {race.mode === 'battle' ? (<><span>Score</span><span>{o.score.toLocaleString()}</span><span>Fighters shot down</span><span>{o.droneKills}</span></>)
              : (<><span>Race time</span><span>{fmtTime(o.time)}</span><span>Best lap</span><span>{fmtTime(o.bestLap)}</span></>)}
            <span>Times wrecked</span><span>{o.deaths}</span>
          </div>
        </div>
        <div className="results-grid">
          <div>
            <div className="label">Rewards</div>
            <div className="line"><span>Finishing position ({ordinal(o.position)})</span><span>{rw.positionCredits} ¢</span></div>
            <div className="line"><span>Combat ({o.racerKills} rivals wrecked{o.droneKills ? `, ${o.droneKills} fighters` : ''}, {Math.round(o.racerDamage)} dmg)</span><span>{rw.combatCredits} ¢</span></div>
            <div className="line"><span>Capital ship ({Math.round(o.capitalDamage)} dmg · {share.toFixed(0)}% · {o.capitalKills} kills)</span><span>{rw.capitalCredits} ¢</span></div>
            <div className="line"><span>Salvage recovered ({rw.salvage})</span><span>{rw.salvageCredits} ¢</span></div>
            {rw.objectives.map((ob) => (
              <div className="line" key={ob.def.label}>
                <span className={ob.done ? 'ok' : 'no'}>{ob.done ? '✔' : '✘'} {ob.def.label}</span>
                <span className={ob.done ? 'ok' : 'no'}>{ob.done ? `+${ob.def.bonus} ¢` : '—'}</span>
              </div>
            ))}
            <div className="line total"><span>Total</span><span>+{rw.totalCredits.toLocaleString()} ¢ &nbsp; <span style={{ color: 'var(--teal)' }}>+{rw.salvage} ⬢</span></span></div>
            {rw.unlockedNext
              ? <div className="unlock">{next ? (nextUnlocked ? `▲ NEXT RACE UNLOCKED: ${next.name.toUpperCase()}` : '✔ RACE CLEARED') : '★ CAMPAIGN COMPLETE — WARZONE ZERO CHAMPION ★'}</div>
              : <div className="lockmsg">Finish {ordinal(race.unlockPos)} or better to unlock the next race. Spend your winnings on upgrades and try again.</div>}
            <div className="label" style={{ marginTop: 10 }}>Capital ship damage</div>
            {result.contributions.slice(0, 5).map((c) => (
              <div className="line" key={c.name}><span style={{ color: c.isPlayer ? 'var(--yellow)' : c.color }}>{c.name}</span><span>{c.damage} · {c.share.toFixed(0)}%{c.kills ? ` · ${c.kills}✖` : ''}</span></div>
            ))}
          </div>
          <div>
            <div className="label">Classification {hud && hud.phase !== 'done' ? '(race still running)' : ''}</div>
            {(hud?.standings ?? []).map((s) => (
              <div className="line" key={s.name}>
                <span style={{ color: s.isPlayer ? 'var(--yellow)' : s.color }}>{s.place}. {s.name}</span>
                <span style={{ color: s.finished ? 'var(--green)' : 'var(--dim)' }}>{race.mode === 'battle' ? `${s.score.toLocaleString()} pts` : s.finished ? (s.dnf ? 'DNF' : fmtTime(s.time)) : `on lap ${s.lap}`}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          {next && nextUnlocked && <Btn kind="primary" autoFocus onClick={() => onNext(next)}>Next Race ▶</Btn>}
          <Btn onClick={onRestart}>Race Again</Btn>
          <Btn onClick={() => onExit('hangar')}>Hangar &amp; Upgrades</Btn>
          <Btn sound="back" onClick={() => onExit('campaign')}>Campaign</Btn>
        </div>
      </div>
    </div>
  );
}
