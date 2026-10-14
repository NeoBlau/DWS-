import { noise, filter, gain, osc, sm, out, type NoiseColor } from './bus'

/*
 * Continuous sound sources driven by the simulation. Each is built from three blocks — a tone, a filtered noise and
 * a noise chopped into pulses — mixed into a group with its own level and stereo position. Frequencies come from
 * the physics: firing frequency of a piston engine = rpm / 60 × cylinders / 2; blade-passing frequency of a fan
 * = blades × rpm / 60; the jet roar grows with thrust, the wind with dynamic pressure.
 */
export class Group {
  g: GainNode; pan: StereoPannerNode
  private parts: AudioNode[] = []
  constructor(public c: AudioContext, dest: AudioNode = out()) {
    this.g = gain(c, 0); this.pan = c.createStereoPanner(); this.g.connect(this.pan).connect(dest)
  }
  own<T extends AudioNode>(n: T) { this.parts.push(n); return n }
  level(v: number, tau = 0.1) { sm(this.g.gain, v, tau) }
  place(p: number) { sm(this.pan.pan, Math.max(-1, Math.min(1, p)), 0.2) }
  dispose() {
    const t = this.c.currentTime
    this.g.gain.setTargetAtTime(0, t, 0.05)
    setTimeout(() => { for (const n of this.parts) { try { (n as AudioScheduledSourceNode).stop?.() } catch { /* already stopped */ } n.disconnect() } this.g.disconnect(); this.pan.disconnect() }, 400)
  }
}

/** an oscillator, optionally through a filter */
export class Tone {
  o: OscillatorNode; f?: BiquadFilterNode; g: GainNode
  constructor(grp: Group, type: OscillatorType, freq: number, ft?: BiquadFilterType, ff = 1000, q = 1) {
    const c = grp.c
    this.o = grp.own(osc(c, type, freq)); this.g = grp.own(gain(c, 0))
    if (ft) { this.f = grp.own(filter(c, ft, ff, q)); this.o.connect(this.f).connect(this.g) } else this.o.connect(this.g)
    this.g.connect(grp.g)
  }
  set(freq: number, level: number, ff?: number, tau = 0.08) {
    sm(this.o.frequency, Math.max(1, freq), tau); sm(this.g.gain, level, tau)
    if (ff !== undefined && this.f) sm(this.f.frequency, Math.max(20, ff), tau)
  }
}
/** filtered noise */
export class Hiss {
  f: BiquadFilterNode; g: GainNode
  constructor(grp: Group, color: NoiseColor, ft: BiquadFilterType, ff: number, q = 0.7) {
    const c = grp.c, s = grp.own(noise(c, color))
    this.f = grp.own(filter(c, ft, ff, q)); this.g = grp.own(gain(c, 0))
    s.connect(this.f).connect(this.g).connect(grp.g)
  }
  set(ff: number, level: number, tau = 0.1) { sm(this.f.frequency, Math.max(20, ff), tau); sm(this.g.gain, level, tau) }
}
/** noise chopped into pulses at `rate` per second (combustion events, diesel knock, ABS, runway joints) */
export class Pulses {
  f: BiquadFilterNode; g: GainNode; am: GainNode; lfo: OscillatorNode; depth: GainNode
  constructor(grp: Group, color: NoiseColor, ft: BiquadFilterType, ff: number, q = 1, wave: OscillatorType = 'square') {
    const c = grp.c, s = grp.own(noise(c, color))
    this.f = grp.own(filter(c, ft, ff, q)); this.am = grp.own(gain(c, 0.5)); this.g = grp.own(gain(c, 0))
    this.lfo = grp.own(osc(c, wave, 10)); this.depth = grp.own(gain(c, 0.5))
    this.lfo.connect(this.depth).connect(this.am.gain) // gain swings 0..1 at the pulse rate
    s.connect(this.f).connect(this.am).connect(this.g).connect(grp.g)
  }
  set(rate: number, ff: number, level: number, tau = 0.06) { sm(this.lfo.frequency, Math.max(0.1, rate), tau); sm(this.f.frequency, Math.max(20, ff), tau); sm(this.g.gain, level, tau) }
}

const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/* ------------------------------------------------------------------ piston engine */
export interface PistonIn { rpm: number; load: number; on: boolean; crank: boolean; boost: number; diesel: boolean; cyl: number; inside: boolean; cold?: number }
/** four-stroke engine: firing pulses, exhaust note opening with load, diesel knock, turbo whistle, starter */
export class Piston {
  grp: Group; fire: Tone; sub: Tone; exhaust: Pulses; knock: Pulses; intake: Hiss; turbo: Tone; turboAir: Hiss; starter: Tone
  constructor(c: AudioContext) {
    const g = this.grp = new Group(c)
    this.fire = new Tone(g, 'sawtooth', 30, 'lowpass', 400, 2.5)
    this.sub = new Tone(g, 'sine', 15)
    this.exhaust = new Pulses(g, 'pink', 'lowpass', 600, 1.2)
    this.knock = new Pulses(g, 'white', 'bandpass', 3200, 1.5)
    this.intake = new Hiss(g, 'pink', 'bandpass', 600, 1.2)
    this.turbo = new Tone(g, 'sine', 3000)
    this.turboAir = new Hiss(g, 'white', 'bandpass', 4000, 8)
    this.starter = new Tone(g, 'sawtooth', 200, 'lowpass', 900, 1)
  }
  update(p: PistonIn) {
    const running = p.on || p.crank
    const rpm = p.crank && !p.on ? 220 : p.rpm
    const firing = (rpm / 60) * (p.cyl / 2)
    const L = Math.max(0, Math.min(1, p.load)), r = rpm / 6500, muf = p.inside ? 0.55 : 1
    this.fire.set(firing, running ? (0.09 + 0.12 * L) * muf : 0, (p.diesel ? 260 : 320) + firing * (2.2 + 4 * L) * (p.inside ? 0.6 : 1))
    this.sub.set(firing / 2, running ? 0.06 + 0.05 * L : 0)
    this.exhaust.set(firing, 180 + firing * (3 + 5 * L), running ? (0.1 + 0.25 * L + 0.1 * r) * muf : 0)
    // diesel combustion knock: strongest at idle and when cold, partly masked under load
    const knock = p.diesel ? (0.05 + 0.05 * (p.cold ?? 0)) * (1 - 0.4 * L) : 0.008
    this.knock.set(firing, p.diesel ? 2600 : 4200, running ? knock : 0)
    this.intake.set(400 + rpm * 0.12, running ? 0.06 * L * (0.3 + r) : 0)
    const b = Math.max(0, Math.min(1.2, p.boost))
    this.turbo.set((p.diesel ? 2400 : 4200) + b * (p.diesel ? 3600 : 5200), running ? 0.014 * b * b * (p.inside ? 0.6 : 1) : 0)
    this.turboAir.set((p.diesel ? 3000 : 5200) + 2500 * b, running ? 0.03 * b * b : 0)
    this.starter.set(180 + 40 * Math.random(), p.crank && !p.on ? 0.05 : 0, 700)
    this.grp.level(1)
  }
  dispose() { this.grp.dispose() }
}

/* ------------------------------------------------------------------ jet engines */
export interface JetIn { n1: number; n2: number; power: number; lit: boolean; starting: boolean; rev: number; inside: boolean; behind: number; pan: number; ign: boolean }
/** turbofan: fan blade-passing tone, "buzz-saw" (supersonic fan tips) at high power, core whine, jet roar */
export class Turbofan {
  grp: Group; bpf: Tone; saw: Tone; core: Tone; roar: Hiss; rumble: Hiss; starter: Tone; air: Hiss; ign: Pulses
  constructor(c: AudioContext, private blades = 36, private rpm1 = 5000, private rpm2 = 14460) {
    const g = this.grp = new Group(c)
    this.bpf = new Tone(g, 'sawtooth', 1000, 'bandpass', 1000, 6)
    this.saw = new Tone(g, 'sawtooth', 80, 'lowpass', 1400, 1.5)
    this.core = new Tone(g, 'sine', 2000)
    this.roar = new Hiss(g, 'pink', 'lowpass', 600, 0.6)
    this.rumble = new Hiss(g, 'brown', 'lowpass', 90, 0.8)
    this.starter = new Tone(g, 'sine', 400)
    this.air = new Hiss(g, 'white', 'highpass', 3500, 0.7)
    this.ign = new Pulses(g, 'white', 'highpass', 5000, 0.7, 'square')
  }
  update(p: JetIn) {
    const shaft = (p.n1 * this.rpm1) / 60, inside = p.inside ? 0.35 : 1
    const front = 1 - 0.5 * p.behind, back = 0.5 + 0.8 * p.behind
    this.bpf.set(this.blades * shaft, 0.05 * p.n1 * p.n1 * front * inside, this.blades * shaft)
    this.saw.set(shaft, 0.12 * sstep(0.82, 0.96, p.n1) * front * inside, 900 + 900 * p.n1)
    this.core.set((p.n2 * this.rpm2) / 60 * 0.18, 0.012 * p.n2 * inside)
    const pw = Math.max(0, p.power) + (p.rev ? 0.35 : 0)
    this.roar.set(220 + 1700 * pw * (p.inside ? 0.5 : 1), (p.lit ? 0.04 + 0.5 * Math.pow(pw, 1.3) : 0.01 * p.n1) * back * inside)
    this.rumble.set(70 + 60 * pw, p.lit ? (0.12 + 0.35 * pw) * (p.inside ? 0.7 : 1) : 0)
    this.starter.set(500 + 2600 * p.n2, p.starting ? 0.035 * inside : 0)
    this.air.set(3500, p.starting ? 0.02 * inside : 0)
    this.ign.set(1.4, 6000, p.starting && p.ign && !p.lit ? 0.05 : 0)
    this.grp.place(p.pan)
    this.grp.level(1)
  }
  dispose() { this.grp.dispose() }
}
/** open fan: two contra-rotating blade rows give two low blade tones and their interaction tone — the "drone" */
export class OpenRotor {
  grp: Group; row1: Tone; row2: Tone; inter: Tone; roar: Hiss; core: Tone; starter: Tone
  constructor(c: AudioContext, private rpm1 = 1100, private rpm2 = 22000) {
    const g = this.grp = new Group(c)
    this.row1 = new Tone(g, 'sawtooth', 200, 'lowpass', 900, 1.5)
    this.row2 = new Tone(g, 'sawtooth', 180, 'lowpass', 900, 1.5)
    this.inter = new Tone(g, 'triangle', 380)
    this.roar = new Hiss(g, 'pink', 'lowpass', 500, 0.6)
    this.core = new Tone(g, 'sine', 2000)
    this.starter = new Tone(g, 'sine', 400)
  }
  update(p: JetIn) {
    const rps = (p.n1 * this.rpm1) / 60, inside = p.inside ? 0.45 : 1, pw = Math.max(0, p.power)
    const f1 = 12 * rps, f2 = 10 * rps * 0.985
    this.row1.set(f1, (0.05 + 0.14 * pw) * p.n1 * inside, 500 + 900 * pw)
    this.row2.set(f2, (0.04 + 0.12 * pw) * p.n1 * inside, 500 + 900 * pw)
    this.inter.set(f1 + f2, 0.03 * pw * p.n1 * inside)
    this.roar.set(200 + 900 * pw, p.lit ? (0.05 + 0.2 * pw) * inside : 0)
    this.core.set((p.n2 * this.rpm2) / 60 * 0.1, 0.01 * p.n2 * inside)
    this.starter.set(450 + 2400 * p.n2, p.starting ? 0.03 * inside : 0)
    this.grp.place(p.pan)
    this.grp.level(1)
  }
  dispose() { this.grp.dispose() }
}
/** turbo-electric: rotating-detonation core (a gritty high buzz), inverter whine of the motors, ducted-fan tone */
export class ElectricFans {
  grp: Group; whine: Tone; whine2: Tone; fan: Tone; det: Pulses; roar: Hiss; starter: Tone
  constructor(c: AudioContext) {
    const g = this.grp = new Group(c)
    this.whine = new Tone(g, 'sine', 1200); this.whine2 = new Tone(g, 'triangle', 2400)
    this.fan = new Tone(g, 'sawtooth', 1000, 'bandpass', 1000, 5)
    this.det = new Pulses(g, 'white', 'bandpass', 4500, 2, 'sawtooth')
    this.roar = new Hiss(g, 'pink', 'lowpass', 400, 0.6)
    this.starter = new Tone(g, 'sine', 600)
  }
  update(p: JetIn & { fanPower: number }) {
    const inside = p.inside ? 0.4 : 1, fp = Math.max(0, Math.min(1, p.fanPower))
    const rps = (Math.sqrt(fp) * 6200) / 60
    this.whine.set(900 + 2600 * Math.sqrt(fp), 0.022 * fp * inside + (fp > 0.01 ? 0.004 : 0))
    this.whine2.set(1800 + 5200 * Math.sqrt(fp), 0.006 * fp * inside)
    this.fan.set(18 * rps, 0.05 * fp * inside, 18 * rps)
    this.det.set(160 + 260 * p.n2, 4200 + 1200 * p.n2, p.lit ? (0.02 + 0.06 * p.n2) * inside : 0)
    this.roar.set(200 + 600 * fp, p.lit ? (0.03 + 0.18 * fp) * inside : 0)
    this.starter.set(700 + 2800 * p.n2, p.starting ? 0.03 * inside : 0)
    this.grp.place(p.pan)
    this.grp.level(1)
  }
  dispose() { this.grp.dispose() }
}
