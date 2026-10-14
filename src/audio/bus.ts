import { getApp } from '../store'
import { useLang } from '../explorer/i18n'

/*
 * One audio engine for the whole app: a single AudioContext, a master gain into a gentle compressor (many layers
 * may sound at once without clipping), cached noise buffers, smoothing helpers, one-shot effects and spoken
 * callouts. Everything is synthesised — no sound files, so the single-file build stays self-contained.
 * Sound is off until the user turns it on (browsers only allow audio after a click).
 */
let ctx: AudioContext | null = null
let master: GainNode | null = null
const buffers = new Map<string, AudioBuffer>()

export const isOn = () => getApp().sound
/** the context, created / resumed on demand; null while sound is off or audio is unavailable */
export function audio(): AudioContext | null {
  if (!isOn()) return null
  if (!ctx) {
    try {
      ctx = new AudioContext()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2
      master = ctx.createGain(); master.gain.value = 0.8
      master.connect(comp).connect(ctx.destination)
      if (import.meta.env.DEV) Object.assign(window, { __audio: { ctx, master } })
    } catch { ctx = null; getApp().set({ sound: false }); return null }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}
export const out = () => master!
/** quieten everything (sound switched off or the tab hidden) */
export function silence() { if (ctx && ctx.state === 'running') void ctx.suspend() }

/** smooth a parameter toward v with time constant tau (seconds) */
export function sm(p: AudioParam, v: number, tau = 0.08) {
  if (!ctx) return
  p.setTargetAtTime(Number.isFinite(v) ? v : 0, ctx.currentTime, tau)
}

/* ------------------------------------------------------------------ noise */
export type NoiseColor = 'white' | 'pink' | 'brown'
function noiseBuffer(c: AudioContext, color: NoiseColor) {
  const key = color
  let b = buffers.get(key)
  if (b) return b
  b = c.createBuffer(1, c.sampleRate * 3, c.sampleRate)
  const d = b.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1
    if (color === 'white') d[i] = w * 0.5
    else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 }
    else { // Paul Kellet's pink filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926
    }
  }
  buffers.set(key, b)
  return b
}
/** a looping noise source, started at a random point so layers do not phase-lock */
export function noise(c: AudioContext, color: NoiseColor) {
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c, color); s.loop = true
  s.start(0, Math.random() * 2.5)
  return s
}
export function filter(c: AudioContext, type: BiquadFilterType, f: number, q = 0.7) {
  const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n
}
export function gain(c: AudioContext, v = 0) { const g = c.createGain(); g.gain.value = v; return g }
export function osc(c: AudioContext, type: OscillatorType, f: number) { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o }

/* ------------------------------------------------------------------ one-shot effects */
type Shot = 'click' | 'switch' | 'clunk' | 'thump' | 'squeal' | 'bang' | 'crash' | 'scrape' | 'whoomp' | 'chime' | 'crc' | 'cricket' | 'beep' | 'warn' | 'blowoff' | 'ratchet' | 'tick' | 'grind' | 'shift'
/** play a short synthesised effect; level 0..1, pan −1..1 */
export function shot(kind: Shot, level = 1, pan = 0) {
  const c = audio()
  if (!c || !master) return
  const t = c.currentTime
  const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(master)
  const env = (g: GainNode, a: number, peak: number, d: number, at = t) => { g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * level), at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + d) }
  const tone = (type: OscillatorType, f0: number, f1: number, a: number, peak: number, d: number, at = t) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + a + d)
    env(g, a, peak, d, at); o.connect(g).connect(p); o.start(at); o.stop(at + a + d + 0.05)
  }
  const burst = (color: NoiseColor, type: BiquadFilterType, f0: number, f1: number, q: number, a: number, peak: number, d: number, at = t) => {
    const s = c.createBufferSource(); s.buffer = noiseBuffer(c, color)
    const f = filter(c, type, f0, q); f.frequency.setValueAtTime(f0, at); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + a + d)
    const g = c.createGain(); env(g, a, peak, d, at)
    s.connect(f).connect(g).connect(p); s.start(at, Math.random() * 2); s.stop(at + a + d + 0.05)
  }
  switch (kind) {
    case 'click': tone('square', 2400, 900, 0.001, 0.05, 0.03); break
    case 'switch': tone('square', 1700, 600, 0.001, 0.09, 0.04); burst('white', 'highpass', 3000, 3000, 0.7, 0.001, 0.05, 0.02); break
    case 'tick': tone('square', 3200, 3000, 0.001, 0.05, 0.012); break
    case 'clunk': tone('sine', 120, 55, 0.004, 0.5, 0.25); burst('brown', 'lowpass', 900, 200, 0.8, 0.002, 0.5, 0.18); break
    case 'shift': tone('sine', 90, 50, 0.004, 0.25, 0.12); burst('pink', 'bandpass', 700, 300, 1.2, 0.002, 0.12, 0.08); break
    case 'thump': tone('sine', 75, 38, 0.003, 0.9, 0.35); burst('brown', 'lowpass', 500, 120, 0.7, 0.003, 0.8, 0.3); break
    case 'squeal': burst('white', 'bandpass', 2100, 1500, 6, 0.01, 0.35, 0.45); burst('white', 'bandpass', 3300, 2600, 8, 0.01, 0.15, 0.35); break
    case 'bang': burst('white', 'lowpass', 6000, 300, 0.6, 0.002, 1, 0.6); tone('sine', 70, 30, 0.002, 0.8, 0.8); break
    case 'crash': burst('white', 'lowpass', 5000, 150, 0.5, 0.005, 1, 2.2); burst('brown', 'lowpass', 300, 60, 0.6, 0.01, 1, 2.6); tone('sine', 55, 25, 0.01, 0.9, 1.6)
      for (let i = 0; i < 6; i++) burst('white', 'bandpass', 900 + Math.random() * 2500, 400, 3, 0.002, 0.4, 0.15 + Math.random() * 0.2, t + 0.1 + Math.random() * 1.2); break
    case 'scrape': burst('white', 'bandpass', 1400, 600, 2.5, 0.05, 0.6, 1.4); burst('white', 'bandpass', 3800, 2000, 4, 0.05, 0.25, 1.2); break
    case 'grind': for (let i = 0; i < 10; i++) burst('white', 'bandpass', 1800 + Math.random() * 1200, 1200, 5, 0.002, 0.3, 0.05, t + i * 0.045); break
    case 'whoomp': burst('brown', 'lowpass', 120, 600, 0.9, 0.25, 0.9, 0.9); break
    case 'blowoff': burst('white', 'bandpass', 3800, 900, 1.6, 0.01, 0.45, 0.55); break
    case 'ratchet': for (let i = 0; i < 7; i++) tone('square', 1500, 700, 0.001, 0.12, 0.025, t + i * 0.06); break
    case 'chime': tone('sine', 1320, 1300, 0.005, 0.32, 1.2); tone('sine', 2640, 2600, 0.005, 0.08, 0.7); break // master caution: single chime
    case 'crc': for (let i = 0; i < 3; i++) { tone('triangle', 880, 870, 0.004, 0.25, 0.16, t + i * 0.36); tone('triangle', 1320, 1300, 0.004, 0.18, 0.16, t + i * 0.36 + 0.17) } break // continuous repetitive chime
    case 'cricket': for (let i = 0; i < 3; i++) tone('square', 4200, 4000, 0.002, 0.08, 0.05, t + i * 0.09); break // stall warning cricket
    case 'beep': tone('square', 2050, 2050, 0.003, 0.12, 0.12); break
    case 'warn': for (let i = 0; i < 3; i++) tone('square', 1900, 1900, 0.003, 0.14, 0.13, t + i * 0.22); break
  }
}

/* ------------------------------------------------------------------ voice callouts */
let lastSay = 0
/**
 * speak a callout. Aircraft automatic callouts are in English, as in a real cockpit (`english`); others follow the
 * interface language. `urgent` interrupts whatever is being said.
 */
export function say(text: string | { ru: string; en: string }, opts: { english?: boolean; urgent?: boolean; rate?: number; pitch?: number } = {}) {
  if (!isOn() || typeof speechSynthesis === 'undefined') return
  const lang = opts.english ? 'en' : useLang.getState().lang
  const str = typeof text === 'string' ? text : text[lang]
  const now = performance.now()
  if (!opts.urgent && speechSynthesis.speaking && now - lastSay < 1500) return
  if (opts.urgent) speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(str)
  u.lang = lang === 'ru' ? 'ru-RU' : 'en-US'
  u.rate = opts.rate ?? 1.15; u.pitch = opts.pitch ?? 0.9; u.volume = 0.9
  const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith(lang === 'ru' ? 'ru' : 'en'))
  if (v) u.voice = v
  speechSynthesis.speak(u)
  lastSay = now
}
