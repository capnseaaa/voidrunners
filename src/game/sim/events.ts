// Pooled simulation events. The simulation never touches rendering or audio;
// it only reports what happened and the presentation layer reacts.

export type SimEventType =
  | 'countdown' | 'go' | 'shoot' | 'missile' | 'capitalFire' | 'hit' | 'shieldHit' | 'wallHit' | 'explosion'
  | 'shipDestroyed' | 'respawn' | 'pickup' | 'boostPad' | 'boostStart' | 'ability' | 'lap' | 'finish' | 'checkpoint'
  | 'componentHit' | 'capShieldHit' | 'componentDestroyed' | 'capitalDestroyed' | 'strikeWarn' | 'strike'
  | 'overdrive' | 'message' | 'obstacleDestroyed' | 'overheat';

export interface SimEvent {
  type: SimEventType;
  ship: number; // primary ship index (or -1)
  other: number; // secondary index (attacker, component, ...)
  x: number; y: number; z: number;
  a: number; // generic magnitude
  color: number;
  text: string;
}

export class EventQueue {
  readonly list: SimEvent[] = [];
  count = 0;

  push(type: SimEventType, ship = -1, x = 0, y = 0, z = 0, a = 0, other = -1, color = 0xffffff, text = ''): void {
    let e = this.list[this.count];
    if (!e) { e = { type, ship, other, x, y, z, a, color, text }; this.list[this.count] = e; }
    else { e.type = type; e.ship = ship; e.other = other; e.x = x; e.y = y; e.z = z; e.a = a; e.color = color; e.text = text; }
    this.count++;
  }

  clear(): void { this.count = 0; }
}
