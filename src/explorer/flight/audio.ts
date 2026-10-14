import * as THREE from 'three'
import { audio, isOn, shot, say, silence } from '../../audio/bus'
import { Group, Tone, Hiss, Pulses, Piston, Turbofan, OpenRotor, ElectricFans } from '../../audio/voices'
import { KT, type Sim } from './fdm'
import type { CamMode } from './state'
import { warnings } from './Hud'

/*
 * The aircraft as you would hear it. Every layer follows a physical quantity of the simulation:
 *  · engines by type — turbofan (fan blade tone 36 × N1, buzz-saw at high N1, core whine, jet roar), open fan
 *    (two contra-rotating blade rows and their interaction tone) or turbo-electric (detonation core, motor
 *    inverters, ducted fans); air-starter whine and igniter ticks during a start, a "whoomp" at light-off;
 *  · APU in the tail; wind growing with dynamic pressure, extra buffet from the gear and spoilers; runway rumble and
 *    the joints between concrete slabs; hydraulic motors while gear or flaps move; the pushback tug;
 *  · events: touchdown thump and tyre squeal, scrapes, a bang on engine failure, the crash;
 *  · cockpit: master warning (continuous repetitive chime) and master caution (single chime) from the ECAM list,
 *    stall cricket and voice, overspeed, and the automatic callouts (radio height, "retard", V1, rotate, GPWS).
 */
type Eng = Turbofan | OpenRotor | ElectricFans
interface Rig {
  sim: Sim; kind: string; eng: Eng[]
  air: Group; wind: Hiss; hiss: Hiss; buffet: Hiss
  ground: Group; rumble: Hiss; joints: Pulses
  sys: Group; apu: Tone; apuAir: Hiss; hyd: Tone; avionics: Hiss
  tug: Piston | null
  lastEv: number; lastRa: number; called: Set<string>; warn: Set<string>; tWarn: number; tStall: number; tGpws: number; tBank: number; tOver: number; gear: number; clock: number
}
let rig: Rig | null = null
const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion()

function build(c: AudioContext, s: Sim): Rig {
  const kind = s.phys.m.geo.engine.kind
  const mk = (): Eng => kind === 'openfan' ? new OpenRotor(c) : kind === 'turboelectric' ? new ElectricFans(c) : new Turbofan(c)
  const air = new Group(c), ground = new Group(c), sys = new Group(c)
  const r: Rig = {
    sim: s, kind, eng: [mk(), mk()],
    air, wind: new Hiss(air, 'pink', 'bandpass', 600, 0.5), hiss: new Hiss(air, 'white', 'highpass', 2500, 0.7), buffet: new Hiss(air, 'brown', 'lowpass', 60, 0.8),
    ground, rumble: new Hiss(ground, 'brown', 'lowpass', 90, 0.9), joints: new Pulses(ground, 'brown', 'lowpass', 200, 1, 'square'),
    sys, apu: new Tone(sys, 'sine', 1200), apuAir: new Hiss(sys, 'white', 'bandpass', 2400, 1.5), hyd: new Tone(sys, 'sawtooth', 380, 'lowpass', 900, 2), avionics: new Hiss(sys, 'pink', 'highpass', 1800, 0.6),
    tug: null,
    lastEv: s.t, lastRa: s.d.ra ?? 0, called: new Set(), warn: new Set(warnings().filter((w) => w.lvl !== 'green').map((w) => w.txt)), tWarn: 0, tStall: 0, tGpws: 0, tBank: 0, tOver: 0, gear: s.srf.gear, clock: 0,
  }
  air.level(1); ground.level(1); sys.level(1)
  return r
}
function teardown() {
  if (!rig) return
  rig.eng.forEach((e) => e.dispose()); rig.air.dispose(); rig.ground.dispose(); rig.sys.dispose(); rig.tug?.dispose()
  rig = null
}

export function startAudio() { audio() }
export function stopAudio() { teardown(); if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel() }

/** called every frame by the flight loop; `camera` gives where the listener is relative to the aircraft */
export function updateAudio(s: Sim, cam: CamMode, camera: THREE.Camera | null, dt: number) {
  if (!isOn()) { if (rig) { teardown(); silence() } return }
  const c = audio()
  if (!c) return
  if (!rig || rig.sim !== s) { teardown(); rig = build(c, s) }
  const R = rig
  R.clock += dt
  if (R.clock < 1 / 30) return // parameters at 30 Hz are plenty; the audio thread interpolates
  const step = R.clock; R.clock = 0
  const d = s.d, y = s.sys, inside = cam === 'cockpit'
  // where the listener is: ahead of / behind the aircraft (jet roar is loudest aft, fan tone ahead)
  let behind = 0.3, side = 0
  if (camera && !inside) {
    _q.copy(s.quat).invert()
    _v.copy(camera.position).sub(_p.set(0, s.pos.y, 0)).applyQuaternion(_q)
    const n = _v.length() || 1
    behind = Math.max(0, Math.min(1, 0.5 - (0.5 * _v.x) / n)); side = Math.max(-1, Math.min(1, _v.z / n))
  }
  /* ---------- engines */
  const ph = s.phys
  for (let i = 0; i < 2; i++) {
    const e = s.eng[i], g = ph.eng[i]
    const pw = Math.max(0, Math.min(1, (g.N2 - 0.55) / 0.43))
    const pan = (inside ? (i === 0 ? -0.55 : 0.55) : (i === 0 ? -0.35 : 0.35) - side * 0.4)
    const p = { n1: g.N1, n2: g.N2, power: pw, lit: g.lit, starting: e.state === 'starting', rev: s.ctl.rev, inside, behind, pan, ign: y.sw.engMode === 'start' }
    const v = R.eng[i]
    if (v instanceof ElectricFans) v.update({ ...p, fanPower: g.lit ? pw : 0 })
    else v.update(p)
  }
  /* ---------- air and ground */
  const q = d.qbar ?? 0, ias = d.ias ?? 0
  R.wind.set(300 + ias * 5, Math.min(0.4, (ias / 320) ** 2 * (inside ? 0.45 : 0.3)))
  R.hiss.set(inside ? 2200 : 3500, Math.min(0.12, (ias / 320) ** 2 * (inside ? 0.12 : 0.05)))
  const spl = Math.max(s.srf.splL, s.srf.splR, s.srf.gndSpl)
  R.buffet.set(45 + ias * 0.2, Math.min(0.5, (q / 9000) * (0.25 * s.srf.gear + 0.6 * spl) + (d.stall && s.airborne ? 0.35 : 0)))
  const onGround = !s.airborne, gs = (d.gs ?? 0) * KT
  R.rumble.set(60 + gs * 1.2, onGround ? Math.min(0.45, gs / 70) * (inside ? 0.8 : 1) : 0)
  R.joints.set(Math.max(0.2, gs / 5), 160, onGround && gs > 1 ? Math.min(0.25, gs / 120) : 0)
  /* ---------- systems */
  const apu = y.apu.n
  R.apu.set(1150 * apu + 60, apu > 0.02 ? (inside ? 0.004 : 0.02) * apu : 0)
  R.apuAir.set(2400, apu > 0.05 ? (inside ? 0.004 : 0.02) * apu : 0)
  const gearMoving = s.srf.gear > 0.01 && s.srf.gear < 0.99, flapsMoving = Math.abs(s.srf.conf - s.srf.confTarget) > 0.01
  R.hyd.set(gearMoving ? 420 : 340, (gearMoving ? 0.03 : 0) + (flapsMoving ? 0.02 : 0), 900)
  R.avionics.set(1800, inside && (y.acEss || y.dcEss) ? 0.012 : 0)
  if ((s.srf.gear >= 0.99 && R.gear < 0.99) || (s.srf.gear <= 0.01 && R.gear > 0.01)) shot('clunk', inside ? 0.5 : 0.8)
  R.gear = s.srf.gear
  // pushback tug: a diesel engine under load
  if (s.ctl.push && !R.tug) R.tug = new Piston(c)
  if (R.tug) { R.tug.update({ rpm: s.ctl.push ? 1500 : 800, load: s.ctl.push ? 0.6 : 0, on: s.ctl.push, crank: false, boost: 0.3, diesel: true, cyl: 6, inside }); if (!s.ctl.push) { R.tug.dispose(); R.tug = null } }
  /* ---------- events */
  for (const ev of s.events) {
    if (ev.t <= R.lastEv) continue
    const pan = ev.v === 1 ? -0.5 : ev.v === 2 ? 0.5 : 0
    switch (ev.e) {
      case 'touchdown': { const vs = Math.abs(s.touchdownVs ?? 200); shot('thump', Math.min(1, 0.25 + vs / 700)); if (gs > 60) shot('squeal', Math.min(1, 0.4 + vs / 900)); break }
      case 'lightOff': shot('whoomp', inside ? 0.4 : 0.8, pan); break
      case 'engineFail': case 'flameout': case 'engineStrike': shot('bang', inside ? 0.6 : 1, pan); break
      case 'crash': shot('crash', 1); break
      case 'gearCollapse': case 'bellyLanding': case 'tailstrike': shot('scrape', 0.9); shot('thump', 0.8); break
      case 'flapJam': case 'flapTorn': shot('bang', 0.4); break
      case 'overstress': shot('scrape', 0.3); break
      case 'parkBrakeOn': if (inside) shot('switch', 0.6); break
      case 'groundSpoilers': shot('blowoff', 0.25); break
      case 'v1': say('V one', { english: true }); break
      case 'vr': say('Rotate', { english: true }); break
      case 'positiveClimb': say('Positive climb', { english: true }); break
      case 'stall': shot('cricket', 1); say('Stall. Stall.', { english: true, urgent: true }); R.tStall = 0; break
    }
  }
  R.lastEv = Math.max(R.lastEv, s.events.length ? s.events[s.events.length - 1].t : R.lastEv)
  /* ---------- callouts and warnings (cockpit sounds, heard in every view) */
  const ra = d.ra ?? 0
  if (onGround && ias > 98 && ias < 103 && s.ctl.lever > 0.5 && !R.called.has('100kt')) { R.called.add('100kt'); say('One hundred knots', { english: true }) }
  if (s.airborne && d.vs < 0) {
    const RA = [[2500, 'Twenty five hundred'], [1000, 'One thousand'], [500, 'Five hundred'], [100, 'Hundred'], [50, 'Fifty'], [40, 'Forty'], [30, 'Thirty'], [20, 'Twenty'], [10, 'Ten']] as const
    for (const [h, w] of RA) if (R.lastRa > h && ra <= h && !R.called.has('ra' + h)) { R.called.add('ra' + h); say(w, { english: true, urgent: h <= 50 }) }
    if (R.lastRa > 20 && ra <= 20 && s.ctl.lever > 0.05 && s.srf.gear > 0.9) say('Retard. Retard.', { english: true, urgent: true })
  }
  if (s.airborne && ra > 2600) for (const k of [...R.called]) if (k.startsWith('ra')) R.called.delete(k)
  if (onGround && gs < 5) R.called.delete('100kt')
  R.lastRa = ra
  R.tStall += step; R.tGpws += step; R.tBank += step; R.tOver += step; R.tWarn += step
  if (d.stall && s.airborne && R.tStall > 1.6) { R.tStall = 0; shot('cricket', 1); say('Stall', { english: true, urgent: true }) }
  if (s.airborne && ra < 2450 && ra > 30 && R.tGpws > 2.5) {
    if (d.vs < -2600 - 0.8 * ra) { R.tGpws = 0; say('Pull up', { english: true, urgent: true }); shot('warn', 0.6) }
    else if (d.vs < -1700 - 0.6 * ra) { R.tGpws = 0; say('Sink rate', { english: true, urgent: true }) }
    else if (ra < 500 && s.srf.gear < 0.5 && d.vs < 0 && ias < 190) { R.tGpws = 0; say('Too low, gear', { english: true, urgent: true }) }
  }
  if (s.airborne && Math.abs(d.phi) > 35 * Math.PI / 180 && R.tBank > 3) { R.tBank = 0; say('Bank angle. Bank angle.', { english: true, urgent: true }) }
  if (ias > s.spec.vmo + 4 && R.tOver > 1.1) { R.tOver = 0; shot('crc', 0.8) }
  if (R.tWarn > 0.5) {
    R.tWarn = 0
    const now = warnings().filter((w) => w.lvl !== 'green')
    const fresh = now.filter((w) => !R.warn.has(w.txt))
    if (fresh.some((w) => w.lvl === 'red')) shot('crc', 0.9)
    else if (fresh.length) shot('chime', 0.8)
    R.warn = new Set(now.map((w) => w.txt))
  }
}
