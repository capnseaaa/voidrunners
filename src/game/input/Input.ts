// Player input: keyboard, mouse buttons, touch controls and device tilt.
// Every source is tracked independently and merged each frame, so steering,
// boosting and firing can all be held at once.
//
//   W / Up        accelerate          Space / J / left mouse    fire
//   S / Down      brake, reverse      Shift / K                 boost (tap with a missile inbound: flares)
//   A D / arrows  steer               E / L / right mouse       missile
//   R             reset to track      Q / I                     ship ability
import type { Controls } from '../sim/ship';
import type { Settings } from '../save/save';

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight',
  'KeyE', 'KeyQ', 'KeyR', 'Escape', 'KeyP', 'KeyJ', 'KeyK', 'KeyL', 'KeyI',
]);

export interface TouchState {
  steer: number; // -1..1
  gas: boolean; brake: boolean; fire: boolean; boost: boolean; missile: boolean; ability: boolean;
}

export type GyroPermission = 'granted' | 'denied' | 'unsupported' | 'unknown';

interface OrientationCtor { requestPermission?: () => Promise<string> }

/** True when this device reports orientation events at all (permission may still be needed). */
export function gyroSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/** iOS Safari requires an explicit permission prompt, raised from a user gesture. Other browsers grant silently. */
export async function requestGyroPermission(): Promise<GyroPermission> {
  if (!gyroSupported()) return 'unsupported';
  const ctor = (window as unknown as { DeviceOrientationEvent: OrientationCtor }).DeviceOrientationEvent;
  if (typeof ctor.requestPermission === 'function') {
    try { return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied'; }
    catch { return 'denied'; }
  }
  return 'granted';
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/** Latest raw tilt angle in degrees, shared so Settings can calibrate against it. */
export const tilt = { raw: 0, seen: false };

function onOrientation(ev: DeviceOrientationEvent): void {
  if (ev.beta === null || ev.gamma === null) return;
  // which device axis is "roll" depends on how the screen is turned
  const angle = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : Number((window as unknown as { orientation?: number }).orientation ?? 0);
  let a: number;
  if (angle === 90) a = ev.beta; else if (angle === 270 || angle === -90) a = -ev.beta; else a = ev.gamma;
  tilt.raw = a; tilt.seen = true;
}

let tiltListening = false;
export function listenTilt(): void {
  if (tiltListening || !gyroSupported()) return;
  tiltListening = true;
  window.addEventListener('deviceorientation', onOrientation);
}

export class Input {
  private readonly down = new Set<string>();
  private mouseFire = false; private mouseMissile = false;
  readonly touch: TouchState = { steer: 0, gas: false, brake: false, fire: false, boost: false, missile: false, ability: false };
  touchActive = false; // touch controls are on screen
  autoThrottle = true;
  gyro = false; gyroSens = 1; gyroZero = 0; gyroInvert = false;
  onPause: (() => void) | null = null;
  enabled = true;
  private target: HTMLElement | null = null;

  configure(s: Settings, touchActive: boolean): void {
    this.touchActive = touchActive;
    this.autoThrottle = s.autoThrottle;
    this.gyro = s.gyro && touchActive;
    this.gyroSens = s.gyroSensitivity; this.gyroZero = s.gyroZero; this.gyroInvert = s.gyroInvert;
    if (this.gyro) listenTilt();
  }

  private readonly keydown = (ev: KeyboardEvent) => {
    if (!GAME_KEYS.has(ev.code)) return;
    const el = ev.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    ev.preventDefault();
    if (ev.code === 'Escape' || ev.code === 'KeyP') { if (!ev.repeat) this.onPause?.(); return; }
    this.down.add(ev.code);
  };
  private readonly keyup = (ev: KeyboardEvent) => { this.down.delete(ev.code); };
  private readonly blur = () => { this.clear(); };
  private readonly mousedown = (ev: MouseEvent) => { if (ev.button === 0) this.mouseFire = true; else if (ev.button === 2) this.mouseMissile = true; };
  private readonly mouseup = (ev: MouseEvent) => { if (ev.button === 0) this.mouseFire = false; else if (ev.button === 2) this.mouseMissile = false; };
  private readonly nomenu = (ev: Event) => ev.preventDefault();

  /** `target` receives mouse buttons (the game canvas). */
  attach(target?: HTMLElement): void {
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.blur);
    if (target) {
      this.target = target;
      target.addEventListener('mousedown', this.mousedown);
      window.addEventListener('mouseup', this.mouseup);
      target.addEventListener('contextmenu', this.nomenu);
    }
  }

  detach(): void {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.blur);
    if (this.target) {
      this.target.removeEventListener('mousedown', this.mousedown);
      window.removeEventListener('mouseup', this.mouseup);
      this.target.removeEventListener('contextmenu', this.nomenu);
    }
    this.clear();
  }

  clear(): void {
    this.down.clear();
    this.mouseFire = this.mouseMissile = false;
    const t = this.touch;
    t.steer = 0; t.gas = t.brake = t.fire = t.boost = t.missile = t.ability = false;
  }

  /** Current tilt steering, -1..1. */
  tiltSteer(): number {
    if (!this.gyro || !tilt.seen) return 0;
    let v = (tilt.raw - this.gyroZero) / (24 / this.gyroSens);
    if (this.gyroInvert) v = -v;
    // small dead zone so a resting hand does not wander
    const dead = 0.06;
    v = Math.abs(v) < dead ? 0 : (v - Math.sign(v) * dead) / (1 - dead);
    return Math.max(-1, Math.min(1, v));
  }

  /** Write the merged input state into a ship's controls. */
  apply(c: Controls): void {
    const d = this.down, t = this.touch;
    if (!this.enabled) { c.throttle = 0; c.brake = 0; c.steer = 0; c.fire = c.missile = c.boost = c.ability = c.reset = false; return; }
    const kbBrake = d.has('KeyS') || d.has('ArrowDown');
    const brake = kbBrake || t.brake;
    let throttle = d.has('KeyW') || d.has('ArrowUp') || t.gas;
    if (this.touchActive && this.autoThrottle && !brake) throttle = true;
    c.throttle = throttle ? 1 : 0;
    c.brake = brake ? 1 : 0;
    const left = d.has('KeyA') || d.has('ArrowLeft'), right = d.has('KeyD') || d.has('ArrowRight');
    let steer = (right ? 1 : 0) - (left ? 1 : 0);
    if (steer === 0) steer = t.steer !== 0 ? t.steer : this.tiltSteer();
    c.steer = steer;
    c.fire = d.has('Space') || d.has('KeyJ') || this.mouseFire || t.fire;
    c.boost = d.has('ShiftLeft') || d.has('ShiftRight') || d.has('KeyK') || t.boost;
    c.missile = d.has('KeyE') || d.has('KeyL') || this.mouseMissile || t.missile;
    c.ability = d.has('KeyQ') || d.has('KeyI') || t.ability;
    c.reset = d.has('KeyR');
  }
}
