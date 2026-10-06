import { useEffect } from 'react'
import { useApp, getApp } from '../store'
import { liveRuntime } from '../models/runtime'

/**
 * Procedural ambience (no audio files): engine harmonics follow live rpm, a turbo whine follows boost,
 * the jet is filtered noise + fan tone that follows N1, and short clicks mark mechanical actions.
 * Off by default; the AudioContext is only created after the user turns sound on (a click).
 */
class Synth {
  ctx: AudioContext
  master: GainNode
  eng: OscillatorNode[] = []
  engGain: GainNode
  engFilter: BiquadFilterNode
  turbo: OscillatorNode
  turboGain: GainNode
  noise: AudioBufferSourceNode
  jetFilter: BiquadFilterNode
  jetGain: GainNode
  fan: OscillatorNode
  fanGain: GainNode
  constructor() {
    this.ctx = new AudioContext()
    const c = this.ctx
    this.master = c.createGain(); this.master.gain.value = 0.0; this.master.connect(c.destination)
    this.engFilter = c.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 420; this.engFilter.Q.value = 3
    this.engGain = c.createGain(); this.engGain.gain.value = 0
    this.engFilter.connect(this.engGain).connect(this.master)
    ;[1, 2, 0.5].forEach((m, i) => { const o = c.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'triangle'; o.frequency.value = 30 * m; o.connect(this.engFilter); o.start(); this.eng.push(o) })
    this.turbo = c.createOscillator(); this.turbo.type = 'sine'; this.turboGain = c.createGain(); this.turboGain.gain.value = 0
    this.turbo.connect(this.turboGain).connect(this.master); this.turbo.start()
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    this.noise = c.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true
    this.jetFilter = c.createBiquadFilter(); this.jetFilter.type = 'bandpass'; this.jetFilter.Q.value = 0.6
    this.jetGain = c.createGain(); this.jetGain.gain.value = 0
    this.noise.connect(this.jetFilter).connect(this.jetGain).connect(this.master); this.noise.start()
    this.fan = c.createOscillator(); this.fan.type = 'sine'; this.fanGain = c.createGain(); this.fanGain.gain.value = 0
    this.fan.connect(this.fanGain).connect(this.master); this.fan.start()
  }
  update(on: boolean, kind: 'car' | 'aircraft' | null) {
    const t = this.ctx.currentTime, rt = liveRuntime.current
    const s = (p: AudioParam, v: number, k = 0.15) => p.setTargetAtTime(v, t, k)
    s(this.master.gain, on ? 0.5 : 0, 0.3)
    if (kind === 'car') {
      const f = Math.max(8, (rt.rpm / 60) * 2) // 4-cyl: two firing pulses per revolution
      this.eng.forEach((o, i) => s(o.frequency, f * [1, 2, 0.5][i], 0.08))
      s(this.engGain.gain, rt.rpm > 50 ? 0.16 + Math.min(0.2, rt.rpm / 25000) : 0)
      s(this.engFilter.frequency, 260 + rt.rpm * 0.25)
      s(this.turbo.frequency, 1800 + rt.rpm * 1.6)
      s(this.turboGain.gain, rt.rpm > 1400 ? Math.min(0.025, (rt.rpm - 1400) / 80000) : 0)
      s(this.jetGain.gain, 0); s(this.fanGain.gain, 0)
    } else if (kind === 'aircraft') {
      s(this.engGain.gain, 0); s(this.turboGain.gain, 0)
      s(this.jetFilter.frequency, 380 + rt.n1 * 1600)
      s(this.jetGain.gain, rt.n1 * 0.32 + rt.apu * 0.05)
      s(this.fan.frequency, 120 + rt.n1 * 900)
      s(this.fanGain.gain, rt.n1 * 0.03 + rt.apu * 0.012)
    } else { s(this.engGain.gain, 0); s(this.turboGain.gain, 0); s(this.jetGain.gain, 0); s(this.fanGain.gain, 0) }
  }
  click(kind: 'click' | 'hyd' = 'click') {
    const c = this.ctx, t = c.currentTime
    const o = c.createOscillator(), g = c.createGain()
    o.type = kind === 'hyd' ? 'sawtooth' : 'square'
    o.frequency.setValueAtTime(kind === 'hyd' ? 180 : 1400, t)
    o.frequency.exponentialRampToValueAtTime(kind === 'hyd' ? 420 : 300, t + (kind === 'hyd' ? 0.9 : 0.05))
    g.gain.setValueAtTime(kind === 'hyd' ? 0.04 : 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'hyd' ? 1.0 : 0.07))
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.1)
  }
}

let synth: Synth | null = null

export function useSound() {
  const sound = useApp((s) => s.sound)
  const pulse = useApp((s) => s.pulse)
  const screen = useApp((s) => s.screen)
  const vehicleId = useApp((s) => s.vehicleId)
  useEffect(() => {
    if (sound && !synth) { try { synth = new Synth() } catch { getApp().set({ sound: false }) } }
    if (synth && sound) synth.ctx.resume()
    if (!synth) return
    const kind = screen === 'machine' && vehicleId ? (vehicleId === 'a320' ? 'aircraft' : 'car') : null
    const id = setInterval(() => synth?.update(sound, kind), 100)
    return () => clearInterval(id)
  }, [sound, screen, vehicleId])
  useEffect(() => { if (sound && synth && pulse) synth.click(vehicleId === 'a320' ? 'hyd' : 'click') }, [pulse]) // eslint-disable-line
}
