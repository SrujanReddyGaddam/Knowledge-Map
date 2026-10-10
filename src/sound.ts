// Synthesised UI sounds (WebAudio, no audio files). Several click "voices" to pick from.
// Created lazily because browsers require a user gesture before audio can start.
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let bus: DynamicsCompressorNode | null = null;   // limiter so a high volume can never clip or crackle
let master = 3;

/** Volume 0-100. 75 matches what used to be the slider's maximum; 100 is another ~30% louder. The limiter keeps peaks clean. */
export function setVolume(pct: number) { master = 0.4 + (Math.max(0, Math.min(100, pct)) / 100) * 4.8; }

function audio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  if (!bus) {
    bus = ctx.createDynamicsCompressor();
    bus.threshold.value = -9; bus.knee.value = 8; bus.ratio.value = 10; bus.attack.value = 0.002; bus.release.value = 0.09;
    bus.connect(ctx.destination);
  }
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.15), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

const jitter = (v: number, pct: number) => v * (1 + (Math.random() * 2 - 1) * pct);

type Env = (c: AudioContext, t: number, out: AudioNode) => void;

/** gain envelope node: fast attack to `peak`, exponential decay over `decay` seconds */
function envelope(c: AudioContext, t: number, peak: number, attack: number, decay: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}
function noiseBurst(c: AudioContext, t: number, out: AudioNode, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number) {
  const s = c.createBufferSource(); s.buffer = noise;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  s.connect(f).connect(envelope(c, t, peak, 0.001, decay)).connect(out); s.start(t, Math.random() * 0.06, decay + 0.02);
}
function tone(c: AudioContext, t: number, out: AudioNode, from: number, to: number, sweep: number, peak: number, decay: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + sweep);
  o.connect(envelope(c, t, peak, 0.002, decay)).connect(out); o.start(t); o.stop(t + decay + 0.05);
}

export const VARIANTS: { id: string; name: string; hint: string }[] = [
  { id: 'soft', name: 'Soft tap', hint: 'gentle, slightly woody' },
  { id: 'wood', name: 'Wood block', hint: 'hollow and warm' },
  { id: 'crisp', name: 'Crisp click', hint: 'dry and light' },
  { id: 'bubble', name: 'Bubble pop', hint: 'round, rising' },
  { id: 'keys', name: 'Key thock', hint: 'deep keyboard' },
  { id: 'glass', name: 'Glass tink', hint: 'bright and airy' },
];

const VOICES: Record<string, Env> = {
  soft: (c, t, out) => {
    noiseBurst(c, t, out, 'bandpass', jitter(3200, 0.12), 1.3, 0.5, 0.045);
    tone(c, t, out, jitter(210, 0.08), 75, 0.07, 0.38, 0.1);
    noiseBurst(c, t, out, 'highpass', 6000, 0.7, 0.12, 0.012);
  },
  wood: (c, t, out) => {
    noiseBurst(c, t, out, 'bandpass', jitter(1300, 0.08), 7, 0.55, 0.05);
    tone(c, t, out, jitter(560, 0.05), 400, 0.05, 0.4, 0.09);
    tone(c, t, out, jitter(1120, 0.05), 800, 0.04, 0.12, 0.05);
  },
  crisp: (c, t, out) => {
    noiseBurst(c, t, out, 'highpass', jitter(5200, 0.12), 0.8, 0.5, 0.014);
    tone(c, t, out, jitter(2200, 0.06), 1400, 0.01, 0.1, 0.012);
  },
  bubble: (c, t, out) => {
    tone(c, t, out, jitter(300, 0.1), jitter(950, 0.1), 0.06, 0.42, 0.09);
    noiseBurst(c, t, out, 'bandpass', 2400, 2, 0.1, 0.02);
  },
  keys: (c, t, out) => {
    noiseBurst(c, t, out, 'lowpass', jitter(1100, 0.1), 0.7, 0.7, 0.035);
    tone(c, t, out, jitter(150, 0.06), 62, 0.1, 0.55, 0.14);
    noiseBurst(c, t, out, 'highpass', 4500, 0.7, 0.18, 0.01);
  },
  glass: (c, t, out) => {
    tone(c, t, out, jitter(2300, 0.04), 2250, 0.1, 0.22, 0.18);
    tone(c, t, out, jitter(3450, 0.04), 3400, 0.1, 0.12, 0.13);
    noiseBurst(c, t, out, 'highpass', 7000, 0.7, 0.1, 0.01);
  },
};

/** Play a click in the chosen voice. */
export function play(id: string, volume = 1) {
  try {
    const voice = VOICES[id] ?? VOICES.soft, c = audio(), t = c.currentTime;
    const out = c.createGain(); out.gain.value = 0.85 * volume * master;
    const pan = c.createStereoPanner(); pan.pan.value = (Math.random() * 2 - 1) * 0.25;
    const soften = c.createBiquadFilter(); soften.type = 'lowpass'; soften.frequency.value = id === 'glass' || id === 'crisp' ? 12000 : 7500;
    out.connect(soften).connect(pan).connect(bus!);
    voice(c, t, out);
  } catch { /* audio unavailable */ }
}

/** Hover: a barely-there dry tick, much quieter than a click. */
export function tick() {
  try {
    const c = audio(), t = c.currentTime, out = c.createGain(); out.gain.value = 0.5 * Math.min(master, 2); out.connect(bus!);
    noiseBurst(c, t, out, 'bandpass', jitter(4800, 0.15), 2, 0.14, 0.016);
  } catch { /* audio unavailable */ }
}
