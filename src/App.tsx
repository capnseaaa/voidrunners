import { useCallback, useEffect, useRef, useState } from 'react';
import { audio } from './game/audio/AudioEngine';
import { RACES, type RaceDef } from './game/data/campaign';
import type { RaceResult } from './game/Game';
import { applyRaceResult, isRaceUnlocked, loadSave, resetSave, writeSave, type SaveData, type Settings } from './game/save/save';
import { Backdrop, Campaign, Hangar, Records, SettingsScreen, Title, type Screen } from './ui/Menus';
import { RaceScreen } from './ui/RaceScreen';

interface RaceCtx { race: RaceDef; nonce: number }

export function App() {
  const [save, setSaveState] = useState<SaveData>(() => loadSave());
  const [screen, setScreen] = useState<Screen>('title');
  const [raceCtx, setRaceCtx] = useState<RaceCtx | null>(() => {
    // developer shortcut: ?dev&race=s3r1 jumps straight into a race (see README)
    if (typeof location === 'undefined') return null;
    const q = new URLSearchParams(location.search);
    const r = q.has('dev') ? RACES.find((x) => x.id === q.get('race')) : undefined;
    return r ? { race: r, nonce: 1 } : null;
  });
  const [lastRace, setLastRace] = useState<string | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  const autopilot = useRef(typeof location !== 'undefined' && new URLSearchParams(location.search).has('autopilot'));

  /** Single write path: every state change is persisted immediately. */
  const setSave = useCallback((s: SaveData) => {
    saveRef.current = s;
    setSaveState(s);
    writeSave(s);
  }, []);

  // audio unlock on the first user gesture, and keep volumes in sync with settings
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);
  useEffect(() => {
    audio.setVolumes(save.settings.masterVolume, save.settings.musicVolume, save.settings.sfxVolume);
  }, [save.settings.masterVolume, save.settings.musicVolume, save.settings.sfxVolume]);
  useEffect(() => { if (!raceCtx) audio.playMusic('menu'); }, [raceCtx]);

  const launch = useCallback((race: RaceDef) => {
    if (!isRaceUnlocked(saveRef.current, race)) return;
    setLastRace(race.id);
    setRaceCtx((c) => ({ race, nonce: (c?.nonce ?? 0) + 1 }));
  }, []);

  const onResult = useCallback((r: RaceResult) => {
    const next = applyRaceResult(saveRef.current, r.race, r.shipId, r.outcome, r.rewards);
    setSave(next);
    const nr = RACES[r.race.index + 1];
    return { nextUnlocked: !!nr && isRaceUnlocked(next, nr) };
  }, [setSave]);

  if (raceCtx) {
    return (
      <div className="app crt">
        <div className="rotate"><i>▯</i>ROTATE YOUR DEVICE<br />VOIDRUNNERS PLAYS IN LANDSCAPE</div>
        <RaceScreen
          key={raceCtx.nonce}
          race={raceCtx.race}
          save={save}
          autopilot={autopilot.current}
          onSettings={(s: Settings) => setSave({ ...saveRef.current, settings: s })}
          onResult={onResult}
          onRestart={() => setRaceCtx((c) => (c ? { race: c.race, nonce: c.nonce + 1 } : c))}
          onNext={(r) => launch(r)}
          onExit={(to) => { setRaceCtx(null); setScreen(to); }}
        />
      </div>
    );
  }

  return (
    <div className="app crt">
      <div className="rotate"><i>▯</i>ROTATE YOUR DEVICE<br />VOIDRUNNERS PLAYS IN LANDSCAPE</div>
      <Backdrop />
      {screen === 'title' && <Title save={save} go={setScreen} />}
      {screen === 'campaign' && <Campaign save={save} initialRace={lastRace} onBack={() => setScreen('title')} onLaunch={launch} go={setScreen} />}
      {(screen === 'hangar' || screen === 'upgrades') && <Hangar key={screen} save={save} setSave={setSave} tab={screen === 'upgrades' ? 'upgrades' : 'ship'} onBack={() => setScreen('title')} />}
      {screen === 'records' && <Records save={save} onBack={() => setScreen('title')} />}
      {screen === 'settings' && <SettingsScreen save={save} setSave={setSave} onBack={() => setScreen('title')} onReset={() => { setSave(resetSave(saveRef.current.settings)); setLastRace(undefined); }} />}
    </div>
  );
}
