import type { Sim } from './fdm'

/*
 * Engine, wind and rumble synthesised with WebAudio (no sound files): filtered noise for the jet roar and
 * airflow, a tone for the fan whine that follows N1, and low thumps for the runway.
 */
let ctx: AudioContext | null = null
let nodes: { roar: GainNode; roarF: BiquadFilterNode; whine: OscillatorNode; whineG: GainNode; wind: GainNode; windF: BiquadFilterNode; rumble: GainNode; master: GainNode } | null = null

function noiseBuffer(c: AudioContext) {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0)
  let last = 0
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 } // brown noise
  return b
}
export function startAudio() {
  if (ctx) { void ctx.resume(); return }
  try {
    ctx = new AudioContext()
    const c = ctx, buf = noiseBuffer(c)
    const src = (): AudioBufferSourceNode => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s }
    const master = c.createGain(); master.gain.value = 0.5; master.connect(c.destination)
    const roarF = c.createBiquadFilter(); roarF.type = 'lowpass'; roarF.frequency.value = 400
    const roar = c.createGain(); roar.gain.value = 0; src().connect(roarF).connect(roar).connect(master)
    const whine = c.createOscillator(); whine.type = 'sawtooth'; whine.frequency.value = 300
    const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 6; wf.frequency.value = 2400
    const whineG = c.createGain(); whineG.gain.value = 0; whine.connect(wf).connect(whineG).connect(master); whine.start()
    const windF = c.createBiquadFilter(); windF.type = 'highpass'; windF.frequency.value = 600
    const wind = c.createGain(); wind.gain.value = 0; src().connect(windF).connect(wind).connect(master)
    const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 90
    const rumble = c.createGain(); rumble.gain.value = 0; src().connect(rf).connect(rumble).connect(master)
    nodes = { roar, roarF, whine, whineG, wind, windF, rumble, master }
  } catch { ctx = null }
}
export function stopAudio() { if (ctx) void ctx.suspend() }
export function updateAudio(s: Sim, muted: boolean) {
  if (!ctx || !nodes) return
  const t = ctx.currentTime, n1 = (s.n1[0] + s.n1[1]) / 200, d = s.d
  const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.12)
  set(nodes.master.gain, muted ? 0 : 0.5)
  set(nodes.roar.gain, 0.05 + n1 * n1 * 0.55 + (s.ctl.rev ? 0.2 : 0))
  set(nodes.roarF.frequency, 180 + n1 * 1400)
  set(nodes.whine.frequency, 180 + n1 * 520)
  set(nodes.whineG.gain, 0.012 + n1 * 0.03)
  set(nodes.wind.gain, Math.min(0.35, (d.ias / 300) ** 2 * 0.35))
  set(nodes.windF.frequency, 500 + d.ias * 6)
  set(nodes.rumble.gain, d.wow ? Math.min(0.6, d.gs / 120) : 0)
}
