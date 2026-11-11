import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Game } from '../game/Game';
import { gyroSupported, listenTilt, requestGyroPermission, tilt, type TouchState } from '../game/input/Input';

type HoldKey = 'gas' | 'brake' | 'fire' | 'boost' | 'missile' | 'ability';

/**
 * On-screen controls for phones and tablets. Every control tracks its own
 * pointer, so steering, boosting and firing work together. The steering pad is
 * always there, so tilt steering has a fallback when sensors are missing or refused.
 */
export function TouchControls({ game, gyro, autoThrottle, onPause }: { game: Game; gyro: boolean; autoThrottle: boolean; onPause: () => void }) {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [tiltState, setTiltState] = useState<'off' | 'waiting' | 'on' | 'denied'>(gyro ? 'waiting' : 'off');
  const t: TouchState = game.input.touch;

  // tilt: start listening; if no readings arrive (iOS needs a tap first) offer an enable button
  useEffect(() => {
    if (!gyro) { setTiltState('off'); return; }
    if (!gyroSupported()) { setTiltState('denied'); return; }
    listenTilt();
    const id = setInterval(() => { if (tilt.seen) { setTiltState('on'); clearInterval(id); } }, 300);
    return () => clearInterval(id);
  }, [gyro]);

  const enableTilt = async () => {
    const res = await requestGyroPermission();
    if (res === 'granted') { listenTilt(); setTiltState(tilt.seen ? 'on' : 'waiting'); } else setTiltState('denied');
  };

  const steerFrom = (ev: RPointerEvent) => {
    const pad = padRef.current;
    if (!pad) return;
    const r = pad.getBoundingClientRect();
    const v = Math.max(-1, Math.min(1, (ev.clientX - (r.left + r.width / 2)) / (r.width * 0.4)));
    t.steer = Math.abs(v) < 0.08 ? 0 : v;
    if (knobRef.current) knobRef.current.style.transform = `translateX(${v * r.width * 0.36}px)`;
  };
  const steerEnd = () => { t.steer = 0; if (knobRef.current) knobRef.current.style.transform = 'translateX(0)'; };

  const hold = (key: HoldKey) => ({
    onPointerDown: (ev: RPointerEvent) => { ev.preventDefault(); (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); t[key] = true; (ev.currentTarget as HTMLElement).classList.add('on'); },
    onPointerUp: (ev: RPointerEvent) => { t[key] = false; (ev.currentTarget as HTMLElement).classList.remove('on'); },
    onPointerCancel: (ev: RPointerEvent) => { t[key] = false; (ev.currentTarget as HTMLElement).classList.remove('on'); },
    onContextMenu: (ev: { preventDefault(): void }) => ev.preventDefault(),
  });

  return (
    <div className="touch-ui" onContextMenu={(e) => e.preventDefault()}>
      <button className="tc pause" onClick={onPause} aria-label="Pause">II</button>
      {gyro && tiltState !== 'on' && (
        <button className="tc tiltbtn" onClick={enableTilt}>{tiltState === 'denied' ? 'TILT UNAVAILABLE - USE PAD' : 'TAP TO ENABLE TILT STEERING'}</button>
      )}
      <div className="tleft">
        <div className="tc btn brake" {...hold('brake')}>BRAKE</div>
        {!autoThrottle && <div className="tc btn gas" {...hold('gas')}>GAS</div>}
        <div
          className={`steerpad ${gyro && tiltState === 'on' ? 'small' : ''}`} ref={padRef}
          onPointerDown={(ev) => { ev.preventDefault(); (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); steerFrom(ev); }}
          onPointerMove={(ev) => { if (ev.buttons || ev.pointerType === 'touch') steerFrom(ev); }}
          onPointerUp={steerEnd} onPointerCancel={steerEnd}
        >
          <span>◀</span><div className="knob" ref={knobRef} /><span>▶</span>
        </div>
      </div>
      <div className="tright">
        <div className="tc btn abil" {...hold('ability')}>ABILITY</div>
        <div className="tc btn msl" {...hold('missile')}>MSL</div>
        <div className="tc btn boost" {...hold('boost')}>BOOST</div>
        <div className="tc btn fire" {...hold('fire')}>FIRE</div>
      </div>
    </div>
  );
}
