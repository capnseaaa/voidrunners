import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../game/audio/AudioEngine';
import { RACES, SHIP_UNLOCKS, STAGES, TYPE_LABEL, type RaceDef } from '../game/data/campaign';
import { gyroSupported, isTouchDevice, listenTilt, requestGyroPermission, tilt } from '../game/input/Input';
import {
  ABILITIES, computeStats, MAX_UPGRADE_LEVEL, PLAYER_SHIPS, statRatings, UPGRADE_CATEGORIES, upgradeCost, UPGRADES, getPlayerShip,
  type UpgradeCategory,
} from '../game/data/ships';
import { buyShip, buyUpgrade, canBuyUpgrade, isRaceUnlocked, isStageUnlocked, shipLockState, type SaveData, type Settings } from '../game/save/save';
import { Backdrop, Btn, ControlsGuide, fmtTime, ordinal, TopBar, Wallet } from './common';
import { ShipPreview } from './ShipPreview';

export type Screen = 'title' | 'campaign' | 'hangar' | 'upgrades' | 'records' | 'settings';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const TYPE_COLOR: Record<string, string> = { standard: 'var(--cyan)', capital: 'var(--red)', championship: 'var(--yellow)', battle: 'var(--mag)', surface: 'var(--orange)' };

// ------------------------------------------------------------------ title
export function Title({ save, go }: { save: SaveData; go: (s: Screen) => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
      const btns = Array.from(menuRef.current?.querySelectorAll('button') ?? []);
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      const n = e.code === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[i < 0 ? 0 : n]?.focus();
      audio.ui('move');
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const done = RACES.filter((r) => save.races[r.id]?.completed).length;
  return (
    <div className="screen title">
      <Wallet save={save} />
      <div className="logo">VOIDRUNNERS</div>
      <div className="tagline">RACE · FIGHT · SALVAGE · SURVIVE</div>
      <div className="menu" ref={menuRef}>
        <Btn kind="primary" autoFocus onClick={() => go('campaign')}>▶ Play</Btn>
        <Btn onClick={() => go('hangar')}>Ship Hangar</Btn>
        <Btn onClick={() => go('upgrades')}>Upgrades</Btn>
        <Btn onClick={() => go('records')}>Race Records</Btn>
        <Btn onClick={() => go('settings')}>Settings</Btn>
      </div>
      <div className="foot">CAMPAIGN {done}/{RACES.length} · FLYING {getPlayerShip(save.selectedShip).name} · WASD FLY · SPACE FIRE · SHIFT BOOST · E MISSILE · Q ABILITY</div>
    </div>
  );
}

const EVENT_BLURB: Record<string, string> = {
  standard: 'Three fast laps of the circuit with a capital ship parked on the route. Shoot rivals for position, bounties and boost.',
  capital: 'A circuit race under the guns of a tougher capital ship. Its shield generator, batteries, engines and cargo bay each do something; take them apart.',
  championship: 'The stage final. The strongest grid, more hazards, and a top-four finish needed to move on.',
  battle: 'No track. A free-flight fight in an open battle zone: enemy fighters hunt you, a capital ship anchors the middle, and the highest score wins.',
  surface: 'A race across the hull of an enormous battleship: flight deck, gun decks, tunnels and the hangar. The ship is under fire, and sections of deck are lost as the laps go by.',
};

// --------------------------------------------------------------- campaign
export function Campaign({ save, onBack, onLaunch, go, initialRace }: { save: SaveData; onBack: () => void; onLaunch: (r: RaceDef) => void; go: (s: Screen) => void; initialRace?: string }) {
  const firstOpen = useMemo(() => {
    const open = RACES.filter((r) => isRaceUnlocked(save, r));
    return (open.find((r) => !save.races[r.id]?.completed) ?? open[open.length - 1]).id;
  }, [save]);
  const [sel, setSel] = useState(initialRace && isRaceUnlocked(save, RACES.find((r) => r.id === initialRace) ?? RACES[0]) ? initialRace : firstOpen);
  const race = RACES.find((r) => r.id === sel) ?? RACES[0];
  const rec = save.races[race.id];
  const ship = getPlayerShip(save.selectedShip);
  return (
    <div className="screen">
      <TopBar title="Campaign" save={save} onBack={onBack} />
      <div className="campaign-body">
        <div className="stages scroll">
          {STAGES.map((st) => {
            const open = isStageUnlocked(save, st.id);
            return (
              <div key={st.id} className={`panel stage ${open ? '' : 'locked'}`} style={{ borderColor: st.color }}>
                <div className="label">Stage {st.id + 1} {open ? '' : '· LOCKED'}</div>
                <h3 style={{ color: st.color, textShadow: `0 0 12px ${st.color}` }}>{st.name}</h3>
                <p>{st.tagline}</p>
                {RACES.filter((r) => r.stage === st.id).map((r) => {
                  const unlocked = isRaceUnlocked(save, r);
                  const rr = save.races[r.id];
                  return (
                    <button key={r.id} className={`race-btn ${sel === r.id ? 'sel' : ''}`} disabled={!unlocked}
                      onMouseEnter={() => audio.ui('move')} onClick={() => { audio.ui('select'); setSel(r.id); }} onDoubleClick={() => unlocked && onLaunch(r)}>
                      <span className="num">{r.index + 1}</span>
                      <span className="nm">{r.name}<br /><span className="st" style={{ color: TYPE_COLOR[r.type] }}>{TYPE_LABEL[r.type]}</span></span>
                      <span className={`st ${rr?.completed ? 'done' : ''}`}>{!unlocked ? '🔒' : rr?.completed ? `✔ ${ordinal(rr.bestPosition)}` : rr?.bestPosition ? `best ${ordinal(rr.bestPosition)}` : 'NEW'}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="panel detail scroll">
          <div className="label">Event {race.index + 1} of {RACES.length} · {STAGES[race.stage].name}</div>
          <h3>{race.name}</h3>
          <div><span className="tag" style={{ color: TYPE_COLOR[race.type] }}>{TYPE_LABEL[race.type]}</span></div>
          <p style={{ margin: 0, color: 'var(--dim)', fontSize: 12.5, lineHeight: 1.45 }}>{EVENT_BLURB[race.type]}</p>
          <div className="kv">
            <span>Format</span><span>{race.mode === 'battle' ? `${Math.round(race.timeLimit)} s · score attack · 10 pilots` : `${race.laps} laps · 10 racers`}</span>
            <span>To advance</span><span>Finish {ordinal(race.unlockPos)} or better</span>
            <span>Best finish</span><span>{rec?.bestPosition ? ordinal(rec.bestPosition) : '—'}</span>
            {race.mode === 'battle'
              ? <><span>Best score</span><span>{rec?.bestScore ? rec.bestScore.toLocaleString() : '—'}</span></>
              : <><span>Best time</span><span>{fmtTime(rec?.bestTime ?? 0)}</span><span>Best lap</span><span>{fmtTime(rec?.bestLap ?? 0)}</span></>}
          </div>
          <div>
            <div className="label" style={{ marginBottom: 4 }}>Bonus objectives</div>
            {race.objectives.map((o) => <div className="obj" key={o.label}><span>{o.label}</span><b>+{o.bonus} ¢</b></div>)}
          </div>
          <div className="kv">
            <span>Your ship</span><span style={{ color: hex(ship.colors.primary) }}>{ship.name} · {ship.role}</span>
          </div>
          <div className="spacer" />
          <div className="row">
            <Btn kind="primary" disabled={!isRaceUnlocked(save, race)} onClick={() => onLaunch(race)}>▶ Launch</Btn>
            <Btn onClick={() => go('hangar')}>Change Ship</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- hangar
export function Hangar({ save, setSave, onBack, tab: initialTab }: { save: SaveData; setSave: (s: SaveData) => void; onBack: () => void; tab: 'ship' | 'upgrades' }) {
  const [viewId, setViewId] = useState(save.selectedShip);
  const [tab, setTab] = useState(initialTab);
  const [hover, setHover] = useState<UpgradeCategory | null>(null);
  const ship = getPlayerShip(viewId);
  const lock = shipLockState(save, ship.id);
  const unlock = SHIP_UNLOCKS.find((u) => u.ship === ship.id)!;
  const levels = save.upgrades[ship.id];
  const stats = computeStats(ship, levels);
  const next = hover && levels[hover] < MAX_UPGRADE_LEVEL ? computeStats(ship, { ...levels, [hover]: levels[hover] + 1 }) : null;
  const rate = statRatings(stats), rateNext = next ? statRatings(next) : null;
  const rows: [string, keyof typeof rate, string][] = [
    ['Top speed', 'speed', `${Math.round(stats.topSpeed * 6)}`], ['Accel', 'accel', stats.accel.toFixed(0)], ['Handling', 'handling', stats.turnRate.toFixed(2)],
    ['Armour', 'armour', stats.armour.toFixed(0)], ['Firepower', 'firepower', (stats.weaponDamage * stats.fireRate).toFixed(0)], ['Shields', 'shields', stats.shield.toFixed(0)],
  ];
  const ability = ABILITIES[ship.ability];
  const reqRace = unlock.afterRace ? RACES.find((r) => r.id === unlock.afterRace) : null;

  return (
    <div className="screen">
      <TopBar title="Ship Hangar" save={save} onBack={onBack} />
      <div className="hangar-body">
        <div className="ship-list scroll">
          {PLAYER_SHIPS.map((s) => {
            const st = shipLockState(save, s.id);
            return (
              <button key={s.id} className={`ship-card ${viewId === s.id ? 'sel' : ''}`} style={{ ['--c' as string]: hex(s.colors.primary) }}
                onMouseEnter={() => audio.ui('move')} onClick={() => { audio.ui('select'); setViewId(s.id); if (st === 'owned') setSave({ ...save, selectedShip: s.id }); }}>
                <div className="n" style={{ color: hex(s.colors.primary) }}>{s.name}</div>
                <div className="r">{s.role}</div>
                <div className="s">{st === 'owned' ? (save.selectedShip === s.id ? <span style={{ color: 'var(--green)' }}>● ACTIVE</span> : 'Owned') : st === 'available' ? <span style={{ color: 'var(--yellow)' }}>For sale</span> : <span style={{ color: 'var(--dim)' }}>🔒 Locked</span>}</div>
              </button>
            );
          })}
        </div>
        <div className="panel preview">
          <ShipPreview ship={ship} dim={lock === 'locked'} />
          <div className="cap">
            <div className="label">{ship.role}</div>
            <h3 style={{ color: hex(ship.colors.primary), textShadow: `0 0 14px ${hex(ship.colors.primary)}` }}>{ship.name}</h3>
            <p>{ship.blurb}</p>
          </div>
        </div>
        <div className="panel scroll">
          <div className="tabs">
            <button className={`tab ${tab === 'ship' ? 'on' : ''}`} onClick={() => { audio.ui('move'); setTab('ship'); }}>Ship Data</button>
            <button className={`tab ${tab === 'upgrades' ? 'on' : ''}`} onClick={() => { audio.ui('move'); setTab('upgrades'); }}>Upgrades</button>
          </div>
          {rows.map(([label, key, val]) => (
            <div className="statrow" key={key}>
              <span>{label}</span>
              <div className="bar">
                {rateNext && rateNext[key] > rate[key] + 0.001 && <i className="gain" style={{ width: `${rateNext[key] * 100}%` }} />}
                <i style={{ width: `${rate[key] * 100}%` }} />
              </div>
              <span style={{ textAlign: 'right' }}>{val}</span>
            </div>
          ))}
          {tab === 'ship' ? (
            <>
              <div className="ability">
                <div className="label">Ability · <kbd>Q</kbd> · {ability.cooldown}s cooldown</div>
                <b>{ability.name}</b>
                <div style={{ fontSize: 12.5, marginTop: 3 }}>{ability.desc}</div>
              </div>
              <div className="kv" style={{ marginBottom: 12 }}>
                <span>Missiles</span><span>{stats.missiles} per race (+2 each lap)</span>
                <span>Salvage yield</span><span>×{stats.salvageMult.toFixed(1)}</span>
              </div>
              {lock === 'owned' && (
                <Btn kind="primary" disabled={save.selectedShip === ship.id} onClick={() => setSave({ ...save, selectedShip: ship.id })}>
                  {save.selectedShip === ship.id ? 'Active Ship' : 'Fly This Ship'}
                </Btn>
              )}
              {lock === 'available' && (
                <>
                  <div className="lockmsg">Unlocked for purchase.</div>
                  <Btn kind="primary" disabled={save.credits < unlock.cost} sound="none"
                    onClick={() => { const n = buyShip(save, ship.id); if (n) { audio.ui('buy'); setSave(n); } else audio.ui('deny'); }}>
                    Buy for {unlock.cost.toLocaleString()} ¢
                  </Btn>
                  {save.credits < unlock.cost && <div className="lockmsg">You need {(unlock.cost - save.credits).toLocaleString()} more credits.</div>}
                </>
              )}
              {lock === 'locked' && (
                <div className="lockmsg">🔒 Complete “{reqRace?.name}” ({STAGES[reqRace?.stage ?? 0].name}) to unlock, then buy for {unlock.cost.toLocaleString()} ¢.</div>
              )}
            </>
          ) : (
            <div onMouseLeave={() => setHover(null)}>
              {lock !== 'owned' && <div className="lockmsg">Own this ship to upgrade it.</div>}
              {UPGRADE_CATEGORIES.map((cat) => {
                const lv = levels[cat];
                const cost = upgradeCost(lv);
                const can = canBuyUpgrade(save, ship.id, cat);
                return (
                  <div className="upg" key={cat} onMouseEnter={() => setHover(cat)}>
                    <div>
                      <div className="nm">{UPGRADES[cat].name} <span className="label">LV {lv}/{MAX_UPGRADE_LEVEL}</span></div>
                      <div className="ds">{UPGRADES[cat].desc}</div>
                      <div className="pips">{[0, 1, 2, 3, 4].map((i) => <i key={i} className={`${i < lv ? 'on' : ''} ${i >= 3 ? 'adv' : ''}`} />)}</div>
                    </div>
                    <div className="cost">
                      {cost ? (
                        <>
                          <div><span className={save.credits >= cost.credits ? 'c' : 'no'}>{cost.credits.toLocaleString()} ¢</span>{cost.salvage > 0 && <> + <span className={save.salvage >= cost.salvage ? 's' : 'no'}>{cost.salvage} ⬢</span></>}</div>
                          <div style={{ marginTop: 4 }}>
                            <Btn kind="small" disabled={!can} sound="none" title={lv >= 3 ? 'Advanced upgrade: needs salvage' : 'Standard upgrade'}
                              onClick={() => { const n = buyUpgrade(save, ship.id, cat); if (n) { audio.ui('buy'); setSave(n); } else audio.ui('deny'); }}>
                              {lv >= 3 ? 'Advanced' : 'Upgrade'}
                            </Btn>
                          </div>
                        </>
                      ) : <span style={{ color: 'var(--green)' }}>MAXED</span>}
                    </div>
                  </div>
                );
              })}
              <div className="label" style={{ marginTop: 10, lineHeight: 1.6 }}>Levels 1–3 cost credits. Levels 4–5 are advanced and also need salvage. Hover an upgrade to preview the stat change.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- records
export function Records({ save, onBack }: { save: SaveData; onBack: () => void }) {
  const t = save.totals;
  return (
    <div className="screen">
      <TopBar title="Race Records" save={save} onBack={onBack} />
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 26 }}>
          {[['Races', t.races], ['Wins', t.wins], ['Credits earned', t.creditsEarned.toLocaleString()], ['Salvage earned', t.salvageEarned], ['Capital components destroyed', t.capitalKills], ['Rivals wrecked', t.racerKills]].map(([k, v]) => (
            <div key={k as string}><div className="label">{k}</div><div style={{ fontFamily: 'var(--display)', fontSize: 22, color: 'var(--yellow)' }}>{v}</div></div>
          ))}
        </div>
      </div>
      <div className="panel scroll" style={{ flex: 1, minHeight: 0, padding: 0 }}>
        <table className="rec">
          <thead><tr><th>#</th><th>Race</th><th>Type</th><th>Status</th><th>Best finish</th><th>Best time / score</th><th>Best lap</th><th>Ship</th><th>Attempts</th></tr></thead>
          <tbody>
            {STAGES.map((st) => [
              <tr className="stage-row" key={`s${st.id}`}><td colSpan={9} style={{ color: st.color }}>Stage {st.id + 1} — {st.name}</td></tr>,
              ...RACES.filter((r) => r.stage === st.id).map((r) => {
                const rec = save.races[r.id];
                const open = isRaceUnlocked(save, r);
                return (
                  <tr key={r.id} style={{ opacity: open ? 1 : 0.45 }}>
                    <td>{r.index + 1}</td><td>{r.name}</td><td>{TYPE_LABEL[r.type]}</td>
                    <td style={{ color: rec?.completed ? 'var(--green)' : 'var(--dim)' }}>{!open ? 'Locked' : rec?.completed ? 'Cleared' : rec?.attempts ? 'Attempted' : 'Open'}</td>
                    <td>{rec?.bestPosition ? ordinal(rec.bestPosition) : '—'}</td><td>{r.mode === 'battle' ? (rec?.bestScore ? `${rec.bestScore.toLocaleString()} pts` : '—') : fmtTime(rec?.bestTime ?? 0)}</td><td>{r.mode === 'battle' ? '—' : fmtTime(rec?.bestLap ?? 0)}</td>
                    <td>{rec?.bestShip ? getPlayerShip(rec.bestShip).name : '—'}</td><td>{rec?.attempts ?? 0}</td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- settings
export function SettingsPanel({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const vol = (label: string, key: 'masterVolume' | 'musicVolume' | 'sfxVolume') => (
    <div className="setrow">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={settings[key]} aria-label={label}
        onChange={(e) => set(key, Number(e.target.value))} onPointerUp={() => audio.ui('select')} />
      <span>{Math.round(settings[key] * 100)}%</span>
    </div>
  );
  return (
    <div>
      <div className="label">Graphics</div>
      <div className="setrow">
        <span>Quality</span>
        <div className="seg">
          {(['low', 'medium', 'high'] as const).map((qv) => <button key={qv} className={settings.quality === qv ? 'on' : ''} onClick={() => { audio.ui('select'); set('quality', qv); }}>{qv}</button>)}
        </div>
        <span />
      </div>
      <div className="label" style={{ fontSize: 10, marginTop: -4, marginBottom: 8 }}>Low: no bloom, fewer particles and scenery. High: full resolution and effects. Applies to the next race.</div>
      <div className="setrow"><span>Camera shake</span><div className="seg"><button className={settings.cameraShake ? 'on' : ''} onClick={() => set('cameraShake', true)}>On</button><button className={!settings.cameraShake ? 'on' : ''} onClick={() => set('cameraShake', false)}>Off</button></div><span /></div>
      <div className="setrow"><span>Minimap</span><div className="seg"><button className={settings.showMinimap ? 'on' : ''} onClick={() => set('showMinimap', true)}>On</button><button className={!settings.showMinimap ? 'on' : ''} onClick={() => set('showMinimap', false)}>Off</button></div><span /></div>
      <div className="label" style={{ marginTop: 14 }}>Audio</div>
      {vol('Master volume', 'masterVolume')}
      {vol('Music', 'musicVolume')}
      {vol('Effects', 'sfxVolume')}
      <div className="label" style={{ marginTop: 14 }}>Touch and tilt (phones and tablets)</div>
      <div className="setrow"><span>Touch controls</span><div className="seg">{(['auto', 'on', 'off'] as const).map((m) => <button key={m} className={settings.touchControls === m ? 'on' : ''} onClick={() => { audio.ui('select'); set('touchControls', m); }}>{m}</button>)}</div><span /></div>
      <div className="setrow"><span>Auto-accelerate</span><div className="seg"><button className={settings.autoThrottle ? 'on' : ''} onClick={() => set('autoThrottle', true)}>On</button><button className={!settings.autoThrottle ? 'on' : ''} onClick={() => set('autoThrottle', false)}>Off</button></div><span /></div>
      <TiltSettings settings={settings} onChange={onChange} />
    </div>
  );
}

/** Tilt (gyro) steering: enable with a permission prompt where the browser needs one, sensitivity, calibration, invert. */
function TiltSettings({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [status, setStatus] = useState('');
  const [reading, setReading] = useState(0);
  useEffect(() => {
    if (!settings.gyro) return;
    listenTilt();
    const id = setInterval(() => setReading(tilt.seen ? tilt.raw : NaN), 200);
    return () => clearInterval(id);
  }, [settings.gyro]);
  const supported = gyroSupported();
  const enable = async () => {
    audio.ui('select');
    const res = await requestGyroPermission();
    if (res === 'granted') { listenTilt(); onChange({ ...settings, gyro: true }); setStatus('Tilt steering on. Hold the device how you like to play, then press Calibrate.'); }
    else if (res === 'denied') { onChange({ ...settings, gyro: false }); setStatus('Motion access was refused. Allow "Motion & Orientation Access" for this site in the browser settings, then try again. Touch steering still works.'); }
    else setStatus('This browser has no motion sensors. Touch steering is used instead.');
  };
  const live = settings.gyro && Number.isFinite(reading);
  const steer = live ? Math.max(-1, Math.min(1, ((reading - settings.gyroZero) / (24 / settings.gyroSensitivity)) * (settings.gyroInvert ? -1 : 1))) : 0;
  return (
    <>
      <div className="setrow">
        <span>Tilt steering</span>
        <div className="seg">
          <button className={settings.gyro ? 'on' : ''} disabled={!supported} onClick={enable}>On</button>
          <button className={!settings.gyro ? 'on' : ''} onClick={() => { onChange({ ...settings, gyro: false }); setStatus(''); }}>Off</button>
        </div>
        <span />
      </div>
      {settings.gyro && (
        <>
          <div className="setrow">
            <span>Tilt sensitivity</span>
            <input type="range" min={0.4} max={2.5} step={0.1} value={settings.gyroSensitivity} aria-label="Tilt sensitivity" onChange={(e) => onChange({ ...settings, gyroSensitivity: Number(e.target.value) })} />
            <span>{settings.gyroSensitivity.toFixed(1)}×</span>
          </div>
          <div className="setrow">
            <span>Calibrate</span>
            <div className="seg">
              <button disabled={!live} onClick={() => { audio.ui('select'); onChange({ ...settings, gyroZero: Math.max(-60, Math.min(60, tilt.raw)) }); setStatus('Calibrated: this angle is now straight ahead.'); }}>Set centre</button>
              <button className={settings.gyroInvert ? 'on' : ''} onClick={() => onChange({ ...settings, gyroInvert: !settings.gyroInvert })}>Invert</button>
            </div>
            <span />
          </div>
          <div className="tiltbar" aria-hidden><i style={{ left: `${50 + steer * 46}%` }} /></div>
          <div className="label" style={{ fontSize: 10 }}>{live ? 'Tilt the device: the marker shows your steering.' : 'Waiting for the motion sensor. On iPhone and iPad, press On to grant access. Sensors need a secure (https) page.'}</div>
        </>
      )}
      {!supported && <div className="label" style={{ fontSize: 10 }}>No motion sensor reported by this browser: touch steering is used.</div>}
      {status && <div className="lockmsg" style={{ fontSize: 12 }}>{status}</div>}
      {isTouchDevice() ? null : <div className="label" style={{ fontSize: 10, marginTop: 4 }}>These apply when the game runs on a touch device.</div>}
    </>
  );
}

export function SettingsScreen({ save, setSave, onBack, onReset }: { save: SaveData; setSave: (s: SaveData) => void; onBack: () => void; onReset: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="screen">
      <TopBar title="Settings" save={save} onBack={onBack} />
      <div className="settings-grid">
        <div className="panel scroll">
          <SettingsPanel settings={save.settings} onChange={(s) => setSave({ ...save, settings: s })} />
          <div className="label" style={{ marginTop: 18 }}>Save data</div>
          <p style={{ color: 'var(--dim)', fontSize: 12.5 }}>Progress is stored in this browser (LocalStorage). Resetting erases credits, salvage, ships, upgrades, campaign progress and records. Settings are kept.</p>
          <Btn kind="danger" onClick={() => setConfirm(true)}>Reset Save Data…</Btn>
        </div>
        <div className="panel scroll">
          <div className="label" style={{ marginBottom: 10 }}>Controls (keyboard)</div>
          <ControlsGuide />
          <p style={{ color: 'var(--dim)', fontSize: 12, lineHeight: 1.5 }}>
            All keys can be held together: steer, boost and fire at once. If your keyboard drops a key when several are held (a hardware limit on some models),
            use the alternates: <kbd>J</kbd> or left mouse to fire, <kbd>K</kbd> boost, <kbd>L</kbd> or right mouse for missiles, <kbd>I</kbd> ability, arrow keys to steer.
          </p>
          <div className="label" style={{ margin: '14px 0 10px' }}>Controls (touch)</div>
          <ControlsGuide touch />
          <p style={{ color: 'var(--dim)', fontSize: 12.5, lineHeight: 1.5, marginTop: 16 }}>
            Weapons auto-aim at the bracketed target: a rival or fighter dead ahead first, then the nearest exposed capital ship system.
            With nothing ahead they swing to whoever is on your tail: the rear gun fires and missiles launch backwards. The radar by the speed readout shows who is behind you.
            A missile warning means tap boost to drop flares. Wreck a rival for a bounty, boost and a missile. On the capital ship, kill the shield generator first; engines cut its power and the cargo bay stops its repairs.
          </p>
        </div>
      </div>
      {confirm && (
        <div className="modal">
          <div className="panel">
            <h2>Erase all progress?</h2>
            <p>This permanently deletes your campaign progress, credits, salvage, unlocked ships, upgrades and race records. It cannot be undone.</p>
            <div className="row">
              <Btn autoFocus sound="back" onClick={() => setConfirm(false)}>Cancel</Btn>
              <Btn kind="danger" onClick={() => { setConfirm(false); onReset(); }}>Yes, erase everything</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { Backdrop };
