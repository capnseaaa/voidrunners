// All sound is synthesised with the Web Audio API: no samples, no downloads.
// The context is created lazily on the first user gesture (browser autoplay rules).

export type MusicId = 'menu' | 'neon' | 'orbit' | 'solar' | 'warzone' | 'battle' | 'surface';

// Hard, fast, four-on-the-floor arcade techno with rolling bass, gated snares,
// arpeggios and synth stabs: the sound of a 1980s vision of the future.
// chords are semitone offsets from the root; patterns are per 16th step.
interface Song {
  bpm: number; root: number; chords: number[][];
  bass: number[]; // semitone offset per step, -99 = rest (rolls off the kick)
  arp: number[]; lead: number[]; stab: number[]; // stab: 1 = chord hit on that step
  drive: number;
}

const R = -99;
const ROLL = [R, 0, 0, 12, R, 0, 0, 12, R, 0, 0, 12, R, 0, 12, 0];
const GALLOP = [0, R, 0, 0, 0, R, 0, 0, 0, R, 0, 0, 0, R, 12, 12];
const OCT = [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 7, 12];
const SONGS: Record<MusicId, Song> = {
  menu: { bpm: 112, root: 45, chords: [[0, 3, 7], [-4, 0, 3], [-9, -5, -2], [-2, 2, 5]], bass: [0, R, R, 0, R, R, 0, R, 0, R, R, 0, R, 0, R, R], arp: [0, 1, 2, 1, 3, 1, 2, 1, 0, 1, 2, 1, 3, 2, 1, 2], lead: [7, 0, 0, 5, 0, 0, 3, 0, 0, 0, 5, 0, 7, 0, 0, 0], stab: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], drive: 0.55 },
  neon: { bpm: 140, root: 40, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], bass: ROLL, arp: [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 3, 2, 4, 2], lead: [12, 0, 10, 0, 7, 0, 0, 5, 7, 0, 0, 0, 3, 0, 5, 0], stab: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0], drive: 1 },
  orbit: { bpm: 136, root: 38, chords: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-1, 2, 5]], bass: OCT, arp: [0, 3, 2, 0, 3, 2, 1, 0, 4, 3, 2, 0, 1, 2, 3, 4], lead: [0, 0, 7, 0, 0, 0, 8, 0, 0, 0, 7, 0, 0, 3, 0, 0], stab: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], drive: 0.95 },
  solar: { bpm: 144, root: 42, chords: [[0, 3, 7], [1, 5, 8], [-2, 2, 5], [-4, 0, 3]], bass: GALLOP, arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3], lead: [7, 0, 8, 7, 0, 5, 0, 3, 0, 0, 1, 0, 3, 0, 0, 0], stab: [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], drive: 1.1 },
  warzone: { bpm: 150, root: 36, chords: [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [-5, -1, 2]], bass: ROLL, arp: [0, 2, 3, 2, 0, 2, 4, 2, 0, 2, 3, 2, 4, 3, 2, 1], lead: [12, 0, 0, 12, 0, 10, 0, 0, 8, 0, 7, 0, 0, 0, 3, 0], stab: [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0], drive: 1.3 },
  battle: { bpm: 152, root: 33, chords: [[0, 3, 7], [0, 3, 8], [-2, 2, 5], [-4, 0, 5]], bass: GALLOP, arp: [0, 3, 2, 3, 4, 3, 2, 3, 0, 3, 2, 3, 4, 2, 3, 1], lead: [12, 0, 12, 0, 15, 0, 14, 0, 12, 0, 0, 10, 0, 7, 0, 0], stab: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0], drive: 1.35 },
  surface: { bpm: 146, root: 31, chords: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [1, 5, 8]], bass: OCT, arp: [0, 2, 4, 2, 3, 2, 1, 2, 0, 2, 4, 2, 3, 1, 2, 0], lead: [7, 0, 0, 8, 7, 0, 5, 0, 3, 0, 0, 5, 0, 7, 0, 0], stab: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0], drive: 1.25 },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private delay!: DelayNode;
  private pump!: GainNode; // side-chained to the kick
  private shaper!: WaveShaperNode;
  private intensity = 0.6;
  private noise!: AudioBuffer;
  private vol = { master: 0.8, music: 0.55, sfx: 0.8 };
  // engine voice
  private eng: { o1: OscillatorNode; o2: OscillatorNode; sub: OscillatorNode; filt: BiquadFilterNode; gain: GainNode; wind: AudioBufferSourceNode; windF: BiquadFilterNode; windG: GainNode } | null = null;
  // music
  private song: Song | null = null;
  private songId: MusicId | null = null;
  private step = 0;
  private nextT = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSfx: Record<string, number> = {};

  get ready(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  /** Must be called from a user gesture at least once. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        this.ctx = ctx;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
        this.master = ctx.createGain();
        this.master.connect(comp); comp.connect(ctx.destination);
        this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
        this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
        this.delay = ctx.createDelay(1);
        this.delay.delayTime.value = 0.28;
        const fb = ctx.createGain(); fb.gain.value = 0.36;
        const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2600;
        this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay); dl.connect(this.musicBus);
        this.pump = ctx.createGain(); this.pump.connect(this.musicBus);
        this.shaper = ctx.createWaveShaper();
        const curve = new Float32Array(512);
        for (let k = 0; k < 512; k++) { const x = (k / 511) * 2 - 1; curve[k] = Math.tanh(x * 2.4); }
        this.shaper.curve = curve; this.shaper.connect(this.pump);
        const len = ctx.sampleRate * 2;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolumes();
        if (this.songId) { const id = this.songId; this.songId = null; this.playMusic(id); }
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* audio unavailable: the game stays silent */ }
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.03);
  }

  suspend(): void { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend(); }
  resume(): void { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); }

  // ------------------------------------------------------------ helpers
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, dest: AudioNode, when = 0, attack = 0.004): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, dest: AudioNode, when = 0, qv = 0.8): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.Q.value = qv;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }

  /** Rate-limit a sound family so 10 ships firing does not saturate the mix. */
  private gate(key: string, minGap: number): boolean {
    if (!this.ready) return false;
    const t = this.ctx!.currentTime;
    if (t - (this.lastSfx[key] ?? -9) < minGap) return false;
    this.lastSfx[key] = t;
    return true;
  }

  // ---------------------------------------------------------------- sfx
  blaster(vol = 1, mine = true): void {
    if (!this.gate(mine ? 'bl' : 'blo', mine ? 0.04 : 0.09)) return;
    const v = (mine ? 0.16 : 0.06) * vol;
    this.tone('square', mine ? 1250 : 900, 180, 0.11, v, this.sfxBus);
    this.tone('sawtooth', mine ? 640 : 480, 90, 0.09, v * 0.7, this.sfxBus);
  }
  capitalGun(vol = 1): void {
    if (!this.gate('cg', 0.1)) return;
    this.tone('sawtooth', 300, 50, 0.28, 0.16 * vol, this.sfxBus);
    this.burst(0.2, 0.1 * vol, 'lowpass', 1800, 200, this.sfxBus);
  }
  missile(vol = 1): void {
    if (!this.gate('ms', 0.08)) return;
    this.burst(0.6, 0.22 * vol, 'bandpass', 500, 3200, this.sfxBus, 0, 1.5);
    this.tone('sawtooth', 160, 520, 0.45, 0.1 * vol, this.sfxBus);
  }
  explosion(size = 1, vol = 1): void {
    if (!this.gate('ex' + (size > 2 ? 'b' : 's'), 0.07)) return;
    const d = 0.5 + size * 0.35;
    this.burst(d, Math.min(0.75, 0.3 * vol * (0.6 + size * 0.35)), 'lowpass', 2400, 60, this.sfxBus);
    this.tone('sine', 120, 28, d * 0.8, Math.min(0.7, 0.35 * vol * (0.6 + size * 0.3)), this.sfxBus);
    if (size > 2) this.burst(d * 1.6, 0.2 * vol, 'lowpass', 500, 40, this.sfxBus, 0.08);
  }
  shieldHit(vol = 1): void {
    if (!this.gate('sh', 0.06)) return;
    this.tone('sine', 1900, 700, 0.18, 0.13 * vol, this.sfxBus);
    this.tone('triangle', 2850, 1200, 0.12, 0.06 * vol, this.sfxBus);
  }
  hullHit(vol = 1): void {
    if (!this.gate('hh', 0.06)) return;
    this.burst(0.14, 0.25 * vol, 'bandpass', 900, 300, this.sfxBus, 0, 2);
    this.tone('square', 150, 60, 0.12, 0.14 * vol, this.sfxBus);
  }
  scrape(strength: number): void {
    if (!this.gate('sc', 0.09)) return;
    const v = Math.min(0.3, 0.05 + strength * 0.006);
    this.burst(0.16, v, 'bandpass', 1400, 500, this.sfxBus, 0, 3);
    if (strength > 28) this.tone('sine', 90, 40, 0.2, v, this.sfxBus);
  }
  pickup(kind: string): void {
    if (!this.gate('pk', 0.03)) return;
    const base = kind === 'core' || kind === 'cargo' ? 880 : kind === 'overdrive' ? 660 : kind === 'missile' ? 520 : 1040;
    this.tone('square', base, base, 0.07, 0.08, this.sfxBus);
    this.tone('square', base * 1.5, base * 1.5, 0.1, 0.08, this.sfxBus, 0.06);
    if (kind === 'overdrive') this.tone('sawtooth', base * 2, base * 3, 0.3, 0.08, this.sfxBus, 0.12);
  }
  boostPad(): void {
    if (!this.gate('bp', 0.1)) return;
    this.tone('sawtooth', 200, 900, 0.35, 0.12, this.sfxBus);
    this.burst(0.4, 0.1, 'highpass', 800, 4000, this.sfxBus);
  }
  boostStart(): void {
    if (!this.gate('bs', 0.15)) return;
    this.burst(0.5, 0.14, 'bandpass', 300, 2600, this.sfxBus, 0, 1.2);
  }
  ability(kind: string): void {
    if (!this.ready) return;
    if (kind === 'burst') { this.tone('sawtooth', 120, 1400, 0.6, 0.2, this.sfxBus); this.burst(0.9, 0.2, 'bandpass', 400, 5000, this.sfxBus); }
    else if (kind === 'bulwark') { this.tone('sine', 220, 440, 0.5, 0.22, this.sfxBus); this.tone('sine', 330, 660, 0.5, 0.14, this.sfxBus, 0.05); }
    else if (kind === 'dash') { this.tone('sine', 2400, 200, 0.4, 0.16, this.sfxBus); this.burst(0.35, 0.18, 'highpass', 5000, 600, this.sfxBus); }
    else { this.tone('triangle', 300, 600, 0.3, 0.16, this.sfxBus); this.tone('triangle', 450, 900, 0.3, 0.12, this.sfxBus, 0.1); this.tone('triangle', 600, 1200, 0.35, 0.1, this.sfxBus, 0.2); }
  }
  overheat(): void { if (this.gate('oh', 0.5)) { this.tone('square', 300, 150, 0.3, 0.12, this.sfxBus); this.tone('square', 300, 150, 0.3, 0.12, this.sfxBus, 0.32); } }
  strikeWarn(): void { if (this.gate('sw', 0.25)) { this.tone('square', 980, 980, 0.09, 0.07, this.sfxBus); this.tone('square', 980, 980, 0.09, 0.07, this.sfxBus, 0.16); } }
  countdown(final: boolean): void {
    if (!this.ready) return;
    this.tone('square', final ? 1320 : 660, final ? 1320 : 660, final ? 0.7 : 0.22, 0.2, this.sfxBus);
    if (final) this.tone('square', 1980, 1980, 0.7, 0.08, this.sfxBus);
  }
  lap(final: boolean): void {
    if (!this.ready) return;
    const n = final ? [784, 988, 1175, 1568] : [784, 1175];
    n.forEach((f, i) => this.tone('square', f, f, 0.14, 0.11, this.sfxBus, i * 0.09));
  }
  ui(kind: 'move' | 'select' | 'back' | 'buy' | 'deny'): void {
    if (!this.ready) return;
    switch (kind) {
      case 'move': if (this.gate('uim', 0.03)) this.tone('square', 520, 520, 0.035, 0.05, this.sfxBus); break;
      case 'select': this.tone('square', 660, 660, 0.06, 0.09, this.sfxBus); this.tone('square', 990, 990, 0.09, 0.09, this.sfxBus, 0.06); break;
      case 'back': this.tone('square', 520, 390, 0.1, 0.08, this.sfxBus); break;
      case 'buy': [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.1, 0.1, this.sfxBus, i * 0.06)); break;
      case 'deny': this.tone('sawtooth', 140, 100, 0.2, 0.12, this.sfxBus); break;
    }
  }
  hitConfirm(): void { if (this.gate('hc', 0.05)) this.tone('square', 2300, 1700, 0.04, 0.075, this.sfxBus); }
  lockWarn(): void { if (this.gate('lw', 0.55)) { this.tone('square', 740, 740, 0.07, 0.07, this.sfxBus); this.tone('square', 620, 620, 0.07, 0.07, this.sfxBus, 0.09); } }
  /** Faster and higher as the missile closes. */
  missileWarn(closeness: number): void {
    if (!this.gate('mw', 0.42 - closeness * 0.3)) return;
    this.tone('sawtooth', 900 + closeness * 700, 900 + closeness * 700, 0.06, 0.12, this.sfxBus);
  }
  flare(): void { if (!this.ready) return; this.burst(0.5, 0.2, 'highpass', 2500, 9000, this.sfxBus); this.tone('sine', 1400, 2800, 0.25, 0.08, this.sfxBus); }
  bounty(): void { if (!this.ready) return; [1047, 1319, 1568, 2093].forEach((f, i) => this.tone('square', f, f, 0.09, 0.1, this.sfxBus, i * 0.05)); }
  klaxon(): void {
    if (!this.ready) return;
    for (let i = 0; i < 4; i++) this.tone('sawtooth', i % 2 ? 330 : 247, i % 2 ? 330 : 247, 0.3, 0.12, this.sfxBus, i * 0.32);
    this.burst(2.2, 0.3, 'lowpass', 300, 50, this.sfxBus);
  }
  victory(): void {
    if (!this.ready) return;
    const seq = [523, 659, 784, 1047, 784, 1047, 1319];
    seq.forEach((f, i) => { this.tone('square', f, f, i === seq.length - 1 ? 0.7 : 0.16, 0.13, this.sfxBus, i * 0.14); this.tone('sawtooth', f / 2, f / 2, 0.16, 0.07, this.sfxBus, i * 0.14); });
  }
  defeat(): void {
    if (!this.ready) return;
    [392, 370, 349, 262].forEach((f, i) => this.tone('sawtooth', f, f * 0.97, i === 3 ? 0.8 : 0.26, 0.12, this.sfxBus, i * 0.24));
  }

  // ------------------------------------------------------------- engine
  startEngine(): void {
    if (!this.ready || this.eng) return;
    const ctx = this.ctx!;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 400; filt.Q.value = 4;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), sub = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth'; sub.type = 'square';
    o2.detune.value = 14;
    const sg = ctx.createGain(); sg.gain.value = 0.5;
    o1.connect(filt); o2.connect(filt); sub.connect(sg); sg.connect(filt);
    filt.connect(gain); gain.connect(this.sfxBus);
    const wind = ctx.createBufferSource(); wind.buffer = this.noise; wind.loop = true;
    const windF = ctx.createBiquadFilter(); windF.type = 'bandpass'; windF.Q.value = 0.7;
    const windG = ctx.createGain(); windG.gain.value = 0;
    wind.connect(windF); windF.connect(windG); windG.connect(this.sfxBus);
    o1.start(); o2.start(); sub.start(); wind.start();
    this.eng = { o1, o2, sub, filt, gain, wind, windF, windG };
  }

  /** speed 0..~1.7 of top speed; throttle 0..1; hot = boosting / afterburner. */
  setEngine(speed: number, throttle: number, hot: number, alive: boolean): void {
    if (!this.eng || !this.ctx) return;
    const t = this.ctx.currentTime, e = this.eng;
    const f = 46 + speed * 118 + hot * 34;
    e.o1.frequency.setTargetAtTime(f, t, 0.06);
    e.o2.frequency.setTargetAtTime(f * 1.5, t, 0.06);
    e.sub.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    e.filt.frequency.setTargetAtTime(260 + speed * 1500 + hot * 1400 + throttle * 300, t, 0.08);
    e.gain.gain.setTargetAtTime(alive ? 0.035 + throttle * 0.04 + hot * 0.035 + speed * 0.02 : 0, t, 0.08);
    e.windF.frequency.setTargetAtTime(300 + speed * 1800, t, 0.1);
    e.windG.gain.setTargetAtTime(alive ? Math.min(0.12, speed * speed * 0.05 + hot * 0.03) : 0, t, 0.1);
  }

  stopEngine(): void {
    if (!this.eng) return;
    const e = this.eng;
    this.eng = null;
    try { e.gain.gain.value = 0; e.windG.gain.value = 0; e.o1.stop(); e.o2.stop(); e.sub.stop(); e.wind.stop(); e.gain.disconnect(); e.windG.disconnect(); } catch { /* already stopped */ }
  }

  // -------------------------------------------------------------- music
  playMusic(id: MusicId): void {
    if (this.songId === id && this.timer) return;
    this.songId = id;
    if (!this.ctx) return; // will start on unlock
    this.stopTimer();
    this.song = SONGS[id];
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.12;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  stopMusic(): void { this.songId = null; this.stopTimer(); }

  /** 0..1: how hard the track should be hitting right now (final lap, boss in range, ship breaking up). */
  setIntensity(v: number): void { this.intensity = Math.max(0, Math.min(1, v)); }

  private stopTimer(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private schedule(): void {
    const ctx = this.ctx, song = this.song;
    if (!ctx || !song || ctx.state !== 'running') return;
    const spb = 60 / song.bpm / 4;
    if (this.nextT < ctx.currentTime - 0.5) this.nextT = ctx.currentTime + 0.05; // tab was asleep
    while (this.nextT < ctx.currentTime + 0.2) {
      this.playStep(this.step, this.nextT - ctx.currentTime, song, spb);
      this.step++;
      this.nextT += spb;
    }
  }

  private playStep(step: number, when: number, song: Song, spb: number): void {
    const ctx = this.ctx!;
    const s16 = step % 16, bar = Math.floor(step / 16);
    const chord = song.chords[bar % song.chords.length];
    const hot = this.intensity > 0.85;
    // arrangement in 8-bar blocks: drive, build, full, breakdown. High intensity stays full.
    const block = hot ? 2 : Math.floor(bar / 8) % 4;
    const barIn = bar % 8;
    const full = block === 2, breakdown = block === 3 && barIn < 4;
    const bus = this.musicBus, pump = this.pump;
    const d = song.drive;
    const t = ctx.currentTime + when;
    // ---- kick: four on the floor, with a click, and it ducks everything on the pump bus
    if (s16 % 4 === 0 && !breakdown) {
      this.tone('sine', 175, 44, 0.16, 0.62 * Math.min(1, 0.7 + d * 0.3), bus, when, 0.001);
      this.burst(0.012, 0.22, 'highpass', 3000, 3000, bus, when);
      pump.gain.cancelScheduledValues(t);
      pump.gain.setValueAtTime(0.32, t);
      pump.gain.linearRampToValueAtTime(1, t + spb * 2.6);
    }
    // ---- gated snare / clap on 2 and 4
    if (s16 % 8 === 4 && block !== 0 && !breakdown) {
      this.burst(0.2, 0.3, 'bandpass', 1700, 1300, bus, when, 0.7);
      this.burst(0.03, 0.2, 'highpass', 5000, 5000, bus, when);
      this.tone('triangle', 240, 150, 0.09, 0.16, bus, when);
    }
    // ---- hats: open on the off-beat, closed sixteenths when the track is cooking
    if (s16 % 4 === 2) this.burst(0.07, 0.085, 'highpass', 8500, 8500, bus, when);
    if ((full || this.intensity > 0.5) && s16 % 2 === 1) this.burst(0.022, 0.04 + (s16 % 4 === 3 ? 0.02 : 0), 'highpass', 10000, 10000, bus, when);
    // ---- fills: tom run and snare roll into the next block, crash on the downbeat
    if (barIn === 7 && s16 >= 12) this.tone('sine', 220 - (s16 - 12) * 30, 70, 0.14, 0.3, bus, when, 0.002);
    if (barIn === 7 && block === 1 && s16 >= 8) this.burst(0.05, 0.1 + (s16 - 8) * 0.012, 'bandpass', 1900, 1500, bus, when, 0.8);
    if (barIn === 0 && s16 === 0 && bar > 0) this.burst(1.3, 0.13, 'highpass', 6000, 3500, bus, when);
    if (block === 3 && barIn === 3 && s16 === 0) this.burst(spb * 16, 0.1, 'bandpass', 400, 6000, bus, when, 2.5); // riser
    // ---- rolling bass
    const bn = song.bass[s16];
    if (bn !== R && !breakdown) this.bassNote(mtof(song.root + chord[0] + bn), spb * 0.92, 0.26, when);
    // ---- arpeggio (dry + delay)
    if (block !== 0 || bar % 2 === 1) {
      const idx = song.arp[s16];
      const note = song.root + 24 + chord[idx % 3] + (idx >= 3 ? 12 : 0) + (hot && s16 % 4 === 3 ? 12 : 0);
      this.tone('square', mtof(note), mtof(note), spb * 0.75, 0.04, this.delay, when, 0.003);
      this.tone('square', mtof(note) * 1.004, mtof(note), spb * 0.75, 0.034, pump, when, 0.003);
    }
    // ---- stabs: short detuned chord hits
    if ((full || breakdown) && song.stab[s16]) {
      for (const c of chord) {
        const f = mtof(song.root + 24 + c);
        this.tone('sawtooth', f, f, spb * 1.6, 0.03, pump, when, 0.004);
        this.tone('sawtooth', f * 1.008, f, spb * 1.6, 0.026, this.delay, when, 0.004);
      }
    }
    // ---- pad under everything
    if (s16 === 0) for (const c of chord) this.padNote(mtof(song.root + 12 + c), spb * 16, breakdown ? 0.05 : 0.028, when);
    // ---- lead line
    if (full && song.lead[s16] && bar % 2 === 0) {
      const note = song.root + 24 + song.lead[s16];
      this.leadNote(mtof(note), spb * 1.9, 0.06, when);
    }
  }

  private bassNote(f: number, dur: number, vol: number, when: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    o2.type = 'square'; o2.frequency.value = f / 2;
    fl.type = 'lowpass'; fl.Q.value = 9;
    fl.frequency.setValueAtTime(2600, t); fl.frequency.exponentialRampToValueAtTime(220, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(vol, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(this.shaper);
    o.start(t); o.stop(t + dur + 0.02); o2.start(t); o2.stop(t + dur + 0.02);
  }

  private leadNote(f: number, dur: number, vol: number, when: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 6; lg.gain.value = f * 0.008; lfo.connect(lg);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      lg.connect(o.frequency);
      o.connect(g); o.start(t); o.stop(t + dur + 0.03);
    }
    lfo.start(t); lfo.stop(t + dur + 0.03);
    g.connect(this.delay); g.connect(this.musicBus);
  }

  private padNote(f: number, dur: number, vol: number, when: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const fl = ctx.createBiquadFilter(), g = ctx.createGain();
    fl.type = 'lowpass'; fl.frequency.value = 1100;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const det of [-9, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(fl); o.start(t); o.stop(t + dur + 0.05);
    }
    fl.connect(g); g.connect(this.pump);
  }

  dispose(): void {
    this.stopTimer(); this.stopEngine();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}

/** One shared engine for menus and races. */
export const audio = new AudioEngine();
