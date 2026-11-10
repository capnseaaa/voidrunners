// Keyboard input. Tracks key state by KeyboardEvent.code so layout and
// modifier state never desynchronise, and clears everything on blur.
import type { Controls } from '../sim/ship';

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'KeyR', 'Escape', 'KeyP']);

export class Input {
  private readonly down = new Set<string>();
  onPause: (() => void) | null = null;
  enabled = true;

  private readonly keydown = (ev: KeyboardEvent) => {
    if (!GAME_KEYS.has(ev.code)) return;
    const el = ev.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    ev.preventDefault();
    if (ev.code === 'Escape' || ev.code === 'KeyP') { if (!ev.repeat) this.onPause?.(); return; }
    this.down.add(ev.code);
  };
  private readonly keyup = (ev: KeyboardEvent) => { this.down.delete(ev.code); };
  private readonly blur = () => { this.down.clear(); };

  attach(): void {
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.blur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.blur);
    this.down.clear();
  }

  clear(): void { this.down.clear(); }

  /** Write the current key state into a ship's controls. */
  apply(c: Controls): void {
    const d = this.down;
    if (!this.enabled) { c.throttle = 0; c.brake = 0; c.steer = 0; c.fire = c.missile = c.boost = c.ability = c.reset = false; return; }
    c.throttle = d.has('KeyW') || d.has('ArrowUp') ? 1 : 0;
    c.brake = d.has('KeyS') || d.has('ArrowDown') ? 1 : 0;
    const left = d.has('KeyA') || d.has('ArrowLeft'), right = d.has('KeyD') || d.has('ArrowRight');
    c.steer = (right ? 1 : 0) - (left ? 1 : 0);
    c.fire = d.has('Space');
    c.missile = d.has('ShiftLeft') || d.has('ShiftRight');
    c.boost = d.has('KeyE');
    c.ability = d.has('KeyQ');
    c.reset = d.has('KeyR');
  }
}
