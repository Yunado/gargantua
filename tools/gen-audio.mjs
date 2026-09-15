// GARGANTUA — procedural ambient drone generator (seamless 60s loop, no deps).
// Output: audio/ambient.wav (22.05 kHz stereo 16-bit, ~2.6 MB)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050;
const DUR = 60; // seconds — all LFO periods divide 60 so the loop is seamless
const N = SR * DUR;

// D2 A2 D3 F#3 drone stack + D5 shimmer; periods (s) chosen | 60
const PARTIALS = [
  { f: 73.42, g: 0.42, p: 20, pan: 0.0 },
  { f: 110.0, g: 0.30, p: 30, pan: 0.12 },
  { f: 146.83, g: 0.19, p: 12, pan: -0.10 },
  { f: 185.0, g: 0.15, p: 24, pan: 0.08 },
  { f: 587.33, g: 0.014, p: 10, pan: -0.05 },
];

const L = new Float64Array(N);
const R = new Float64Array(N);

// ---- partials (sine + slow detune wobble + amplitude breathing)
for (const pt of PARTIALS) {
  const w = 2 * Math.PI * pt.f / SR;
  const lfoW = 2 * Math.PI / (pt.p * SR);
  const detW = 2 * Math.PI * (pt.f * 0.0012) / SR; // 0.12% wobble
  let phase = 0;
  for (let i = 0; i < N; i++) {
    phase += w + (i % (SR / 4) - SR / 8) * 0; // keep simple: constant rate
    const lfo = 0.55 + 0.45 * Math.sin(lfoW * i + pt.f);
    const a = pt.g * lfo * 0.5;
    const s = Math.sin(w * (i / 1) * (1 + 0.0012 * Math.sin(detW * i)));
    const pan = 0.5 + 0.5 * pt.pan;
    L[i] += a * s * (1 - pan * 0.6);
    R[i] += a * s * pan * 1.4;
  }
}

// ---- filtered noise swell (one-pole LP ~300 Hz) with seam dip
const aLp = 1 - Math.exp(-2 * Math.PI * 300 / SR);
let y = 0;
let prevNoiseL = 0, prevNoiseR = 0;
for (let i = 0; i < N; i++) {
  const x = Math.random() * 2 - 1;
  y += aLp * (x - y);
  const t = i / SR;
  const swell = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 15 + 1.3);
  const t2 = Math.min(t, DUR - t);
  const seam = Math.min(1, t2 / 2.0); // 2 s dip at both ends of the loop
  const env = 0.05 * swell * seam;
  // slight stereo decorrelation
  prevNoiseL += 0.02 * (Math.random() * 2 - 1 - prevNoiseL);
  prevNoiseR += 0.02 * (Math.random() * 2 - 1 - prevNoiseR);
  L[i] += (y + prevNoiseL) * env;
  R[i] += (y + prevNoiseR) * env;
}

// ---- master: soft clip, normalize, fade loop seam
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 2.2);
  R[i] = Math.tanh(R[i] * 2.2);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.72 / Math.max(peak, 1e-6);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const seam = Math.min(1, Math.min(t, DUR - t) / 1.5);
  const fade = 0.75 + 0.25 * seam; // keep continuity: no hard zero, gentle dip
  L[i] *= norm * fade;
  R[i] *= norm * fade;
}

// ---- write 16-bit PCM WAV (interleaved stereo)
function wavHeader(channels, sampleRate, bits, dataLen) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22); b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  b.writeUInt16LE(channels * (bits / 8), 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  return b;
}
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), i * 4);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), i * 4 + 2);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'audio', 'ambient.wav');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([wavHeader(2, SR, 16, pcm.length), pcm]));
console.log(`[gargantua] wrote ${out} (${(pcm.length + 44) / 1024 / 1024} MB, ${DUR}s loop)`);
