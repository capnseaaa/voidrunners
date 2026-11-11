import type { ReactNode } from 'react';
import { audio } from '../game/audio/AudioEngine';
import type { SaveData } from '../game/save/save';

export const fmtTime = (t: number): string => {
  if (!t || t <= 0) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function Btn(props: { children: ReactNode; onClick: () => void; kind?: 'primary' | 'danger' | 'small' | ''; disabled?: boolean; sound?: 'select' | 'back' | 'none'; autoFocus?: boolean; title?: string }) {
  return (
    <button
      className={`btn ${props.kind ?? ''}`}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      title={props.title}
      onMouseEnter={() => audio.ui('move')}
      onClick={() => { if (props.sound !== 'none') audio.ui(props.sound ?? 'select'); props.onClick(); }}
    >
      {props.children}
    </button>
  );
}

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <div className="stars" />
      <div className="sun" />
      <div className="grid" />
      <div className="fade" />
    </div>
  );
}

export function Wallet({ save }: { save: SaveData }) {
  return (
    <div className="wallet">
      <span className="cr" title="Credits: standard upgrades and ships">¢ {save.credits.toLocaleString()}</span>
      <span className="sv" title="Salvage: advanced upgrades">⬢ {save.salvage.toLocaleString()}</span>
    </div>
  );
}

export function TopBar({ title, save, onBack }: { title: string; save: SaveData; onBack: () => void }) {
  return (
    <div className="topbar">
      <Btn kind="small" sound="back" onClick={onBack}>◀ Back</Btn>
      <h2>{title}</h2>
      <div className="spacer" />
      <Wallet save={save} />
    </div>
  );
}

export function ControlsGuide({ compact, touch }: { compact?: boolean; touch?: boolean }) {
  if (touch) {
    const rows: [string, string][] = [
      ['Left pad / tilt', 'Steer'], ['Auto', 'Accelerate (hold BRAKE to slow)'], ['FIRE', 'Blasters (hold)'],
      ['BOOST', 'Boost (hold). Tap it with a missile inbound: flares'], ['MSL', 'Missile'], ['ABILITY', 'Ship ability'],
    ];
    return <div className={`keys ${compact ? 'compact' : ''}`}>{rows.map(([k, label]) => <div key={k} style={{ display: 'contents' }}><span><kbd>{k}</kbd></span><span>{label}</span></div>)}</div>;
  }
  const rows: [string[], string][] = compact ? [
    [['W'], 'Accelerate'], [['S'], 'Brake'], [['A', 'D'], 'Steer'], [['Space'], 'Fire'], [['Shift'], 'Boost / flares'], [['E'], 'Missile'], [['Q'], 'Ability'],
  ] : [
    [['W', '↑'], 'Accelerate'],
    [['S', '↓'], 'Brake / reverse'],
    [['A', 'D', '←', '→'], 'Steer left / right'],
    [['Space'], 'Fire primary weapon (unlimited, watch the heat)'],
    [['Shift'], 'Boost (hold). Tap it while a missile is inbound to drop flares'],
    [['E'], 'Fire missile (limited)'],
    [['Q'], 'Special ship ability'],
    [['R'], 'Reset to track'],
    [['Esc'], 'Pause'],
  ];
  return (
    <div className={`keys ${compact ? 'compact' : ''}`}>
      {rows.map(([keys, label]) => (
        <div key={label} style={{ display: 'contents' }}>
          <span>{keys.map((k) => <kbd key={k} style={{ marginRight: 4 }}>{k}</kbd>)}</span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
