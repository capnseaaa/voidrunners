// Tiny external store that carries simulation readouts to the React HUD at a
// throttled rate, so React never re-renders per animation frame.
import type { ComponentType } from './sim/capital';

export interface HudStanding { name: string; isPlayer: boolean; finished: boolean; dnf: boolean; time: number; color: string; place: number; lap: number }
export interface HudMessage { id: number; text: string; kind: 'info' | 'good' | 'bad' | 'boss'; t: number }
export interface HudComponent { name: string; type: ComponentType; hp: number; alive: boolean; vulnerable: boolean; targeted: boolean }

export interface HudState {
  phase: 'grid' | 'racing' | 'done';
  countdown: number;
  time: number;
  position: number;
  lap: number; laps: number;
  lapTime: number; lastLap: number; bestLap: number;
  speed: number; speedFrac: number;
  hp: number; hpMax: number; shield: number; shieldMax: number;
  boost: number; boostLock: boolean; boosting: boolean; overdrive: number;
  missiles: number; missileMax: number; missileReady: number;
  heat: number; overheated: boolean;
  abilityName: string; abilityReady: number; abilityActive: boolean;
  salvage: number;
  bossName: string; bossHp: number; bossShield: boolean; bossDestroyed: boolean; bossNear: boolean;
  components: HudComponent[];
  standings: HudStanding[];
  messages: HudMessage[];
  wrongWay: boolean;
  dead: number;
  hitAngle: number; hitT: number; // radians relative to the nose, time since hit
  targetName: string; targetHp: number;
  finished: boolean;
  dots: { x: number; z: number; color: string; isPlayer: boolean }[];
  fps: number;
}

type Listener = () => void;

export class HudStore {
  private state: HudState | null = null;
  private readonly listeners = new Set<Listener>();
  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  getSnapshot = (): HudState | null => this.state;
  publish(s: HudState): void { this.state = s; for (const l of this.listeners) l(); }
  reset(): void { this.state = null; for (const l of this.listeners) l(); }
}

export const hudStore = new HudStore();
