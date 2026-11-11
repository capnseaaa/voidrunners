// Tiny external store that carries simulation readouts to the React HUD at a
// throttled rate, so React never re-renders per animation frame.
import type { ComponentType } from './sim/capital';

export interface HudStanding { name: string; isPlayer: boolean; finished: boolean; dnf: boolean; time: number; color: string; place: number; lap: number; score: number; mood: string; alive: boolean }
export interface HudMessage { id: number; text: string; kind: 'info' | 'good' | 'bad' | 'boss'; t: number }
export interface HudComponent { name: string; type: ComponentType; hp: number; alive: boolean; vulnerable: boolean; targeted: boolean }
/** Radar contact relative to the player: x = right, y = ahead, in world units. */
export interface HudBlip { x: number; y: number; kind: 'racer' | 'fighter' | 'missile' | 'capital'; hostile: boolean; color: string }
export interface HudObjective { label: string; done: boolean; value: number; target: number }

export interface HudState {
  mode: 'race' | 'battle';
  phase: 'grid' | 'racing' | 'done';
  countdown: number;
  time: number; timeLeft: number;
  position: number;
  lap: number; laps: number;
  lapTime: number; lastLap: number; bestLap: number;
  score: number; droneKills: number; fighters: number;
  speed: number; speedFrac: number;
  hp: number; hpMax: number; shield: number; shieldMax: number;
  boost: number; boostLock: boolean; boosting: boolean; overdrive: number;
  missiles: number; missileMax: number; missileReady: number;
  heat: number; overheated: boolean;
  abilityName: string; abilityReady: number; abilityActive: boolean;
  salvage: number;
  bossName: string; bossHp: number; bossShield: boolean; bossDestroyed: boolean; bossNear: boolean; bossPower: number; bossRepair: boolean;
  components: HudComponent[];
  standings: HudStanding[];
  messages: HudMessage[];
  objectives: HudObjective[];
  wrongWay: boolean;
  dead: number;
  hitAngle: number; hitT: number; // radians relative to the nose, time since hit
  hitMarkT: number; // time since the player's weapons last connected
  targetName: string; targetHp: number; targetRear: boolean;
  missileWarn: number; // 0 = none, else 0..1 closeness of an inbound missile
  flareReady: boolean;
  lockedBy: string; // who has the player in their sights
  warPhase: number; dying: boolean;
  finished: boolean;
  dots: { x: number; z: number; color: string; isPlayer: boolean; enemy: boolean }[];
  blips: HudBlip[];
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
