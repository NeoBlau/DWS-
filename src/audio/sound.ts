import { useEffect } from 'react'
import { useApp, getApp } from '../store'
import { liveRuntime } from '../models/runtime'
import { live, exp } from '../explorer/core'
import { audio, shot, silence } from './bus'
import { Piston, Turbofan, Group, Tone } from './voices'

/*
 * Sound outside the two simulators (they drive their own): the vehicle anatomy screens and the engine explorers
 * follow the running model — crank rpm, throttle and boost of the piston engines, N1 / N2 and thrust of the
 * turbofan, the APU — and every button in the interface gives a soft click. Off until the user turns sound on.
 */
type Mode = 'diesel' | 'petrol' | 'jet' | null
let piston: Piston | null = null, fan: Turbofan | null = null, apuG: Group | null = null, apuT: Tone | null = null, mode: Mode = null

function stopAll() { piston?.dispose(); fan?.dispose(); apuG?.dispose(); piston = null; fan = null; apuG = null; apuT = null; mode = null }

function tick() {
  const st = getApp()
  const want: Mode = st.screen === 'machine' && st.vehicleId ? (st.vehicleId === 'a320' ? 'jet' : st.vehicleId === 'fortuner' ? 'diesel' : 'petrol')
    : st.screen === 'explorer' && (st.explorer === 'diesel' || st.explorer === 'petrol' || st.explorer === 'jet') ? st.explorer : null
  if (!st.sound || !want) { if (mode) stopAll(); if (!st.sound) silence(); return }
  const c = audio()
  if (!c) return
  if (want !== mode) { stopAll(); mode = want; if (want === 'jet') { fan = new Turbofan(c); apuG = new Group(c); apuT = new Tone(apuG, 'sine', 1200); apuG.level(1) } else piston = new Piston(c) }
  const rt = liveRuntime.current, inExplorer = st.screen === 'explorer'
  if (piston) {
    const rpm = inExplorer ? live.rpm ?? 0 : rt.rpm
    const load = inExplorer ? exp().throttle : Math.min(1, Math.max(0.1, (rt.rpm - 800) / 4000))
    const boost = inExplorer ? Math.min(1.2, (live.turboRpm ?? 0) / 140000) : Math.min(1, Math.max(0, (rt.rpm - 1400) / 2600))
    piston.update({ rpm, load, on: rpm > 300, crank: rpm > 50 && rpm < 300, boost, diesel: mode === 'diesel', cyl: 4, inside: false })
  }
  if (fan) {
    const n1 = inExplorer ? (live.n1 ?? 0) / 100 : rt.n1, n2 = inExplorer ? (live.n2 ?? 0) / 100 : Math.min(1, 0.55 + 0.45 * rt.n1)
    const lit = inExplorer ? (live.flame ?? 0) > 0 : rt.n1 > 0.15
    fan.update({ n1, n2, power: Math.max(0, Math.min(1, (n2 - 0.55) / 0.43)), lit, starting: !lit && n2 > 0.05, rev: 0, inside: false, behind: 0.4, pan: 0, ign: !lit && n2 > 0.15 })
    if (apuT) apuT.set(1150 * rt.apu + 60, inExplorer ? 0 : 0.02 * rt.apu)
  }
}

export function useSound() {
  const sound = useApp((s) => s.sound)
  const pulse = useApp((s) => s.pulse)
  const vehicleId = useApp((s) => s.vehicleId)
  useEffect(() => {
    const id = setInterval(tick, 50)
    return () => { clearInterval(id); stopAll() }
  }, [])
  useEffect(() => { if (sound) audio(); else { stopAll(); silence() } }, [sound])
  // a mechanical action in the anatomy view (a door, a valve, the gear)
  useEffect(() => { if (sound && pulse) shot(vehicleId === 'a320' ? 'clunk' : 'click', 0.5) }, [pulse]) // eslint-disable-line
  // every button: a soft click
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (getApp().sound && (e.target as HTMLElement | null)?.closest?.('button')) shot('click', 0.35) }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
}
