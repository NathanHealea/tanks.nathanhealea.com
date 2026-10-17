// All sounds are synthesized with Web Audio, so there are no asset files to cache or license.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = loadMuted();

function loadMuted(): boolean {
  try {
    return localStorage.getItem('tanks.muted') === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem('tanks.muted', value ? '1' : '0');
  } catch {
    // Storage can be unavailable in private mode; the setting just won't persist.
  }
  if (master) master.gain.value = value ? 0 : 0.6;
}

/** Must be called from a user gesture: browsers keep audio suspended until then. */
export function unlockAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function ready(): AudioContext | null {
  return ctx && master && !muted && ctx.state === 'running' ? ctx : null;
}

function envelope(gain: GainNode, t: number, peak: number, attack: number, decay: number): void {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noise(filterType: BiquadFilterType, freq: number, endFreq: number, peak: number, decay: number, q = 1): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(endFreq, t + decay);
  const gain = ctx.createGain();
  envelope(gain, t, peak, 0.004, decay);
  src.connect(filter).connect(gain).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + decay + 0.05);
}

function tone(type: OscillatorType, freq: number, endFreq: number, peak: number, decay: number): void {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(endFreq, t + decay);
  const gain = ctx.createGain();
  envelope(gain, t, peak, 0.005, decay);
  osc.connect(gain).connect(master!);
  osc.start(t);
  osc.stop(t + decay + 0.05);
}

export const sfx = {
  shot() {
    tone('sine', 150, 55, 0.5, 0.14);
    noise('lowpass', 2200, 300, 0.25, 0.1);
  },
  pop() {
    // A balloon pop is a very sharp broadband crack with almost no tail.
    noise('highpass', 900, 3000, 0.9, 0.05);
    noise('bandpass', 1800, 500, 0.5, 0.12, 0.8);
    tone('triangle', 520, 180, 0.15, 0.09);
  },
  bounce() {
    tone('sine', 1100, 700, 0.12, 0.06);
  },
  fizzle() {
    noise('bandpass', 900, 400, 0.15, 0.08, 2);
  },
  clash() {
    tone('square', 1500, 900, 0.06, 0.05);
    noise('highpass', 2500, 4000, 0.15, 0.04);
  },
  mineDrop() {
    tone('square', 300, 280, 0.05, 0.05);
  },
  explode() {
    noise('lowpass', 1200, 80, 0.9, 0.7);
    tone('sine', 90, 35, 0.6, 0.5);
  },
};
