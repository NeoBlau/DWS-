/*
 * Vehicle dynamics for the driving simulator.
 *
 * Planar rigid body (x, y, yaw) with four wheels. Each wheel has its own spin dynamics and a tyre model
 * (Pacejka-style magic formula with combined slip), loads from static weight plus longitudinal and lateral
 * weight transfer. The engine follows a measured-shape torque curve with turbo lag, coupled through a
 * torque converter with lock-up to an automatic gearbox, open differentials, and (Fortuner) a transfer case.
 * ABS, traction control and stability control act on the brakes and engine torque — and can be switched off.
 * Mechanical sympathy: the hardware has temperatures and a health that the driver can destroy — transmission
 * fluid cooked by a slipping torque converter, a neutral drop, reverse or Park selected while rolling, a forced
 * downshift that over-revs the engine, revving a cold engine, overheating, a hot turbo switched off, faded brakes,
 * part-time 4WD driven on dry asphalt (driveline wind-up). The ECU / TCU protections can be switched off to see why
 * they exist. Warm-up and cooling are about 3× faster than in reality so the effects show within minutes.
 * Numbers are representative of the two cars, not manufacturer data.
 *
 * World: X east, Y north (2D, counter-clockwise yaw ψ). Car frame: x forward, y to the left.
 */

export const G = 9.81
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export interface CarSpec {
  id: 'fortuner' | 'bmw'
  mass: number; Iz: number; cgH: number; a: number; b: number; track: number; R: number; Iw: number
  awd: boolean; diesel: boolean
  idle: number; redline: number; curve: [number, number][]; boostTau: number; boostShare: number; Ie: number
  gears: number[]; reverse: number; final: number; low: number; K: number
  eff: number; vmax: number // driveline efficiency, governed top speed km/h
  byWire: boolean // electronic shifter (BMW): the TCU simply ignores R / P requests at speed
  partTime: boolean // part-time 4WD with a locked centre (Fortuner): 4H / 4L only on loose surfaces
  brakeF: number; brakeR: number; CdA: number; Crr: number; steerMax: number; rollK: number; pitchK: number; frontRoll: number
}
export const FORTUNER: CarSpec = {
  id: 'fortuner', mass: 2150, Iz: 3900, cgH: 0.78, a: 1.25, b: 1.495, track: 1.545, R: 0.385, Iw: 2.0, awd: true, diesel: true,
  idle: 750, redline: 4200, curve: [[600, 220], [1000, 330], [1400, 450], [1600, 500], [2800, 500], [3400, 421], [4000, 330], [4400, 250]], boostTau: 0.7, boostShare: 0.45, Ie: 0.32,
  gears: [3.6, 2.09, 1.49, 1.0, 0.69, 0.58], reverse: 3.73, final: 3.909, low: 2.566, K: 108, eff: 0.86, vmax: 180, byWire: false, partTime: true,
  brakeF: 2600, brakeR: 1500, CdA: 1.25, Crr: 0.013, steerMax: 0.6, rollK: 0.013, pitchK: 0.01, frontRoll: 0.55,
}
export const BMW: CarSpec = {
  id: 'bmw', mass: 1680, Iz: 2700, cgH: 0.52, a: 1.47, b: 1.505, track: 1.6, R: 0.335, Iw: 1.4, awd: false, diesel: false,
  idle: 700, redline: 6500, curve: [[600, 180], [1000, 260], [1450, 350], [4800, 350], [5200, 340], [6000, 300], [6700, 250]], boostTau: 0.4, boostShare: 0.4, Ie: 0.2,
  gears: [5.0, 3.2, 2.143, 1.72, 1.314, 1.0, 0.822, 0.64], reverse: 3.46, final: 2.81, low: 1, K: 100, eff: 0.93, vmax: 250, byWire: true, partTime: false,
  brakeF: 2800, brakeR: 1800, CdA: 0.6, Crr: 0.011, steerMax: 0.58, rollK: 0.006, pitchK: 0.006, frontRoll: 0.52,
}
export const CAR_SPECS = { fortuner: FORTUNER, bmw: BMW }

/* ------------------------------------------------------------------ test track surfaces */
export interface Surface { id: 'asphalt' | 'wet' | 'ice' | 'gravel' | 'grass'; mu: number; rr: number }
const S_ASPH: Surface = { id: 'asphalt', mu: 1.0, rr: 0 }, S_WET: Surface = { id: 'wet', mu: 0.62, rr: 0.002 }, S_ICE: Surface = { id: 'ice', mu: 0.12, rr: 0 }
const S_GRAV: Surface = { id: 'gravel', mu: 0.6, rr: 0.03 }, S_GRASS: Surface = { id: 'grass', mu: 0.45, rr: 0.05 }
export const TRACK = {
  pad: { x0: -220, x1: 220, y0: -220, y1: 220 },
  wet: { x: 110, y: 110, r: 50 },
  ice: { x0: -200, x1: -90, y0: 50, y1: 200 },
  gravel: { x0: -200, x1: -70, y0: -200, y1: -70 },
  strip: { x0: 220, x1: 1500, y0: -14, y1: 14 },
  cones: Array.from({ length: 16 }, (_, i) => [-140 + i * 18, -120] as [number, number]),
}
export function surfaceAt(x: number, y: number): Surface {
  const T = TRACK
  if (x >= T.strip.x0 && x <= T.strip.x1 && y >= T.strip.y0 && y <= T.strip.y1) return S_ASPH
  if (x < T.pad.x0 || x > T.pad.x1 || y < T.pad.y0 || y > T.pad.y1) return S_GRASS
  if (Math.hypot(x - T.wet.x, y - T.wet.y) < T.wet.r) return S_WET
  if (x >= T.ice.x0 && x <= T.ice.x1 && y >= T.ice.y0 && y <= T.ice.y1) return S_ICE
  if (x >= T.gravel.x0 && x <= T.gravel.x1 && y >= T.gravel.y0 && y <= T.gravel.y1) return S_GRAV
  return S_ASPH
}

/* ------------------------------------------------------------------ state */
export type DriveMode = '2H' | '4H' | '4L'
export type Sel = 'P' | 'R' | 'N' | 'D'
export interface CarControls { throttle: number; brake: number; steer: number; handbrake: number; select: Sel; manual: boolean; shiftReq: number; mode: DriveMode; abs: boolean; tcs: boolean; esc: boolean; ignition: boolean; prot: boolean }
/** temperatures (°C) and health (1 = new, 0 = destroyed) of the hardware */
export interface Hardware {
  coolant: number; oil: number; atf: number; turbo: number; disc: number[]
  eng: number; trans: number; xfer: number; turboH: number; pawl: number
  windup: number; vac: number; engageT: number; limp: boolean; wasOn: boolean
}
export interface Wheel { omega: number; fz: number; kappa: number; alpha: number; fx: number; fy: number; abs: boolean; lift: boolean; surface: Surface['id'] }
export interface CarEvent { t: number; e: string; v?: number }
export interface Car {
  spec: CarSpec
  t: number
  x: number; y: number; psi: number; u: number; v: number; r: number
  wheels: Wheel[] // FL, FR, RL, RR
  rpm: number; boost: number; engineOn: boolean; starting: number; onT: number
  gear: number // −1 reverse, 0 neutral, 1..n
  shiftT: number; lockup: boolean
  delta: number // road-wheel steer angle, + = left
  ax: number; ay: number; roll: number; pitch: number
  ctl: CarControls
  rolled: boolean; liftT: number
  esc: boolean; tcs: boolean // currently intervening
  timer: { armed: boolean; start: number | null; t100: number | null; d400: number | null; x0: number; y0: number }
  events: CarEvent[]
  wheelTorque: number
  hw: Hardware
  flagEng?: boolean
}
export function createCar(spec: CarSpec): Car {
  const w = (): Wheel => ({ omega: 0, fz: 0, kappa: 0, alpha: 0, fx: 0, fy: 0, abs: false, lift: false, surface: 'asphalt' })
  return {
    spec, t: 0, x: -160, y: 0, psi: 0, u: 0, v: 0, r: 0, wheels: [w(), w(), w(), w()],
    rpm: 0, boost: 0, engineOn: false, starting: 0, onT: 0, gear: 0, shiftT: 0, lockup: false, delta: 0, ax: 0, ay: 0, roll: 0, pitch: 0,
    ctl: { throttle: 0, brake: 0, steer: 0, handbrake: 0, select: 'P', manual: false, shiftReq: 0, mode: spec.awd ? '2H' : '2H', abs: true, tcs: true, esc: true, ignition: false, prot: true },
    rolled: false, liftT: 0, esc: false, tcs: false, timer: { armed: true, start: null, t100: null, d400: null, x0: 0, y0: 0 }, events: [], wheelTorque: 0,
    hw: { coolant: AMB, oil: AMB, atf: AMB, turbo: AMB, disc: [AMB, AMB, AMB, AMB], eng: 1, trans: 1, xfer: 1, turboH: 1, pawl: 1, windup: 0, vac: 1, engageT: 0, limp: false, wasOn: false },
  }
}
const AMB = 15 // ambient °C
/** a warm engine (for the timing runs and the Study links) */
export function warmUp(c: Car) { const h = c.hw; h.coolant = 88; h.oil = 85; h.atf = 75 }

/* ------------------------------------------------------------------ selector & transfer case: the driver's requests go through here */
export function selectGear(c: Car, s: Sel) {
  const k = c.ctl, h = c.hw, sp = c.spec, kmh = c.u * 3.6
  if (s === k.select) return
  const prot = k.prot || sp.byWire
  // reverse while rolling forward (or drive while rolling back): the clutches would have to stop the car
  if ((s === 'R' && kmh > 5) || (s === 'D' && kmh < -5)) {
    if (prot) { ev(c, 'revRefused'); return }
    const dmg = clamp((Math.abs(kmh) - 5) / 25, 0, 1)
    h.trans = Math.max(0, h.trans - 0.15 - 0.85 * dmg)
    c.u *= 0.75
    ev(c, h.trans <= 0 ? 'transFail' : 'reverseShock')
  }
  // Park while moving: a by-wire shifter refuses; a mechanical lever drops the pawl onto the spinning gear
  if (s === 'P' && Math.abs(kmh) > 3 && sp.byWire) { ev(c, 'pRefused'); return }
  // neutral drop: revving in N / P, then selecting a gear
  if ((k.select === 'N' || k.select === 'P') && (s === 'D' || s === 'R') && c.engineOn && c.rpm > 1500) {
    if (k.prot) { h.engageT = 0.8; ev(c, 'engageDelay') } // the TCU waits for the engine to drop and fills the clutch slowly
    else {
      const shock = clamp((c.rpm - 1200) / 2600, 0, 1)
      h.trans = Math.max(0, h.trans - 0.25 * shock)
      const drv = sp.awd && k.mode !== '2H' ? [0, 1, 2, 3] : [2, 3]
      drv.forEach((i) => { c.wheels[i].omega += (s === 'D' ? 1 : -1) * shock * 25 / drv.length })
      ev(c, h.trans <= 0 ? 'transFail' : 'neutralDrop')
    }
  }
  k.select = s
}
export function requestMode(c: Car, m: DriveMode) {
  const k = c.ctl, h = c.hw, kmh = Math.abs(c.u * 3.6)
  if (!c.spec.awd || m === k.mode) return
  if (h.xfer <= 0 && m !== '2H') { ev(c, 'xferBroken'); return }
  if (m === '4L' || k.mode === '4L') {
    // low range engages only when stopped with the transmission in N (the 4L lamp blinks otherwise)
    if (kmh > 2 || k.select !== 'N') { ev(c, '4LRefused'); return }
  } else if (kmh > 100) { h.xfer = Math.max(0, h.xfer - 0.05); ev(c, 'xferGrind'); return }
  k.mode = m
}

function ev(c: Car, e: string, v?: number) {
  for (let i = c.events.length - 1; i >= 0 && c.t - c.events[i].t < 3; i--) if (c.events[i].e === e) return
  c.events.push({ t: c.t, e, v }); if (c.events.length > 60) c.events.shift()
}

/* ------------------------------------------------------------------ engine */
function curveAt(sp: CarSpec, rpm: number) {
  const c = sp.curve
  if (rpm <= c[0][0]) return c[0][1]
  for (let i = 0; i < c.length - 1; i++) if (rpm <= c[i + 1][0]) { const [r0, t0] = c[i], [r1, t1] = c[i + 1]; return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0) }
  return c[c.length - 1][1]
}
const friction = (rpm: number) => 12 + rpm * 0.012
export function engineTorque(sp: CarSpec, rpm: number, thr: number, boost: number) {
  const full = curveAt(sp, rpm) * (1 - sp.boostShare + sp.boostShare * boost)
  return thr * (full + friction(rpm)) - friction(rpm)
}
const ratioOf = (c: Car) => {
  const sp = c.spec
  if (c.gear === 0) return 0
  const g = c.gear < 0 ? -sp.reverse : sp.gears[c.gear - 1]
  return g * sp.final * (c.ctl.mode === '4L' ? sp.low : 1)
}

/* ------------------------------------------------------------------ tyre */
// combined-slip magic formula: one curve for the resultant slip, split by direction
// C = 2.2: full grip at ≈ 10 % slip, ≈ 75 % when locked — a sliding tyre has less grip and no steering
const MF = (s: number) => Math.sin(2.2 * Math.atan(10 * s - 0.97 * (10 * s - Math.atan(10 * s))))

/* ------------------------------------------------------------------ step */
export const H = 1 / 240
export function stepCar(c: Car, dt = H) {
  if (c.rolled) return
  const sp = c.spec, k = c.ctl, L = sp.a + sp.b, m = sp.mass
  /* steering: rate-limited, speed-sensitive authority */
  const authority = clamp(1 - Math.abs(c.u) / 55, 0.28, 1)
  const target = k.steer * sp.steerMax * authority
  // without the engine there is no power-steering pump: the wheel turns slowly and heavily
  const ps = c.engineOn ? 1.6 : 0.45
  c.delta += clamp(target - c.delta, -ps * dt, ps * dt)

  /* gear selector and automatic shifting */
  const speedAbs = Math.abs(c.u)
  if (k.select === 'P' || k.select === 'N') c.gear = 0
  else if (k.select === 'R') c.gear = -1
  else if (c.gear <= 0) c.gear = 1
  c.shiftT = Math.max(0, c.shiftT - dt)
  const ratio = ratioOf(c)
  const driven = sp.awd && k.mode !== '2H' ? [0, 1, 2, 3] : [2, 3]
  const wDrv = driven.reduce((s, i) => s + c.wheels[i].omega, 0) / driven.length
  const rpmAt = (g: number) => Math.abs(wDrv * sp.gears[g - 1] * sp.final * (k.mode === '4L' ? sp.low : 1)) * 60 / (2 * Math.PI)
  if (k.select === 'D' && c.shiftT === 0) {
    const n = sp.gears.length
    if (k.manual) {
      if (k.shiftReq > 0 && c.gear < n) { c.gear++; c.shiftT = 0.25; ev(c, 'shift', c.gear) }
      if (k.shiftReq < 0 && c.gear > 1) {
        const after = rpmAt(c.gear - 1)
        if (after < sp.redline) { c.gear--; c.shiftT = 0.25; ev(c, 'shift', c.gear) }
        else if (k.prot) ev(c, 'downshiftRefused', after)
        else {
          // a forced downshift: the wheels drive the engine past anything the rev limiter can stop
          c.gear--; c.shiftT = 0.25
          const over = (after - sp.redline) / (0.25 * sp.redline)
          c.hw.eng = Math.max(0, c.hw.eng - clamp(over, 0, 1) * 0.6)
          if (after > sp.redline * 1.25) { c.hw.eng = 0; ev(c, 'engineSeized', after) } else ev(c, 'overrev', after)
        }
      }
      if (c.gear > 1 && rpmAt(c.gear) < sp.idle * 0.85) { c.gear--; c.shiftT = 0.25 } // protects against stalling
    } else {
      const up = sp.idle + (sp.redline - sp.idle) * (0.32 + 0.6 * k.throttle)
      const rpmNow = rpmAt(c.gear)
      if (c.gear < n && rpmNow > up && speedAbs > 2) { c.gear++; c.shiftT = 0.35; ev(c, 'shift', c.gear) }
      else if (c.gear > 1 && (rpmNow < Math.max(sp.idle + 250, up * 0.5) || (k.throttle > 0.9 && rpmAt(c.gear - 1) < sp.redline * 0.88 && rpmNow < up * 0.75))) { c.gear--; c.shiftT = 0.35; ev(c, 'shift', c.gear) }
    }
  }
  k.shiftReq = 0
  // limp-home: an overheated or damaged transmission holds 3rd gear
  const h = c.hw
  h.limp = k.prot && (h.atf > 135 || (h.trans < 0.35 && h.trans > 0))
  if (h.limp && k.select === 'D') { if (c.gear !== 3) { c.gear = 3; ev(c, 'limp') } }

  /* engine & torque converter */
  if (k.ignition && !c.engineOn && c.starting === 0) { c.starting = 0.0001; ev(c, 'starter') }
  if (!k.ignition) {
    // switched off: a turbo that is still glowing has no oil flow — the oil in its bearing cokes
    if (c.engineOn && h.turbo > 480 && Math.abs(c.u) < 1) { h.turboH = Math.max(0, h.turboH - (h.turbo - 420) / 900); ev(c, h.turboH <= 0 ? 'turboDead' : 'turboCoked') }
    c.engineOn = false; c.starting = 0
  }
  let thr = c.engineOn ? k.throttle : 0
  if (h.engageT > 0) { h.engageT -= dt; thr = Math.min(thr, 0.05) }
  if (k.prot && h.atf > 125) { thr = Math.min(thr, 0.4); ev(c, 'atfProtect') } // TCU asks the ECU for less torque
  if (k.prot && h.coolant > 115) { thr = Math.min(thr, 0.5); ev(c, 'overheat') }
  if (c.engineOn && c.rpm < sp.idle) thr = Math.max(thr, clamp((sp.idle - c.rpm) / 250, 0, 0.4)) // idle governor
  if (c.rpm > sp.redline) thr = 0 // rev limiter
  if (c.u * 3.6 > sp.vmax) thr = Math.min(thr, Math.max(0, 1 - (c.u * 3.6 - sp.vmax) / 3) * 0.6) // electronic speed limiter
  // traction control: cut torque while a driven wheel spins
  c.tcs = false
  if (k.tcs && c.engineOn) {
    const spin = Math.max(...driven.map((i) => c.wheels[i].kappa))
    if (spin > 0.12 && speedAbs > 0.5) { thr *= clamp(1 - (spin - 0.12) * 6, 0.15, 1); c.tcs = true }
  }
  if (c.shiftT > 0) thr *= 0.35 // torque reduction during a shift
  const boostTgt = c.engineOn ? clamp(thr * (c.rpm - sp.idle * 1.2) / (sp.redline * 0.35), 0, 1) : 0
  c.boost += (boostTgt - c.boost) * Math.min(1, dt / sp.boostTau)
  if (h.turboH <= 0) c.boost = 0
  let Te = engineTorque(sp, c.rpm, thr, c.boost) * (h.eng < 0.5 ? 0.6 : 1)
  if (c.starting > 0) {
    c.starting += dt; Te = c.rpm < 250 ? 60 : 0
    if (h.eng <= 0) { if (c.starting > 1.5) { c.starting = 0; k.ignition = false; ev(c, 'engineSeized') } Te = 0; c.rpm = 0 }
    else if (c.starting > 0.9) { c.engineOn = true; c.starting = 0; c.onT = c.t; ev(c, 'engineOn') }
  }
  if (!c.engineOn && c.starting === 0) Te = -friction(c.rpm) * 2
  const we = (c.rpm * 2 * Math.PI) / 60
  const wt = wDrv * ratio
  c.lockup = c.gear >= 2 && Math.abs(c.u) > 11 && c.shiftT === 0 && k.select === 'D'
  let Tturbine = 0, Tpump = 0
  if (ratio === 0) {
    c.rpm = Math.max(0, c.rpm + ((Te) / sp.Ie) * dt * 60 / (2 * Math.PI))
  } else if (c.lockup) {
    c.rpm = Math.max(0, (wt * 60) / (2 * Math.PI))
    Tturbine = Te
  } else {
    const SR = we > 1 ? wt / we : 0
    const s = 1 - SR
    const Tp = (c.rpm / sp.K) ** 2 * clamp(s * 2.2, -1, 1)
    Tpump = Tp
    Tturbine = Tp * (s > 0 ? Math.max(1, 2.0 - 1.15 * SR) : 1)
    c.rpm = Math.max(0, c.rpm + ((Te - Tp) / sp.Ie) * dt * 60 / (2 * Math.PI))
  }
  if (c.engineOn && c.rpm < 350 && c.starting === 0 && c.t - c.onT > 1.5) { c.engineOn = false; k.ignition = false; ev(c, 'stall') }
  // a burnt-out transmission: the clutch packs slip and hardly any torque reaches the wheels
  const Tdrive = Tturbine * ratio * sp.eff * (h.trans <= 0 ? 0.05 : 1)
  // the converter turns the slip between engine and turbine into heat in the fluid
  const slipW = Math.abs(Tpump * (we - wt))
  c.wheelTorque = Tdrive

  /* loads with weight transfer */
  const fzF = (m * G * sp.b) / (2 * L), fzR = (m * G * sp.a) / (2 * L)
  const dLong = (m * c.ax * sp.cgH) / L / 2
  const dLat = (m * c.ay * sp.cgH) / sp.track
  const fz = [fzF - dLong - sp.frontRoll * dLat, fzF - dLong + sp.frontRoll * dLat, fzR + dLong - (1 - sp.frontRoll) * dLat, fzR + dLong + (1 - sp.frontRoll) * dLat]
  const pos: [number, number][] = [[sp.a, sp.track / 2], [sp.a, -sp.track / 2], [-sp.b, sp.track / 2], [-sp.b, -sp.track / 2]]

  /* stability control: compare the yaw rate with what the driver asks for */
  c.esc = false
  const escBrake = [0, 0, 0, 0]
  if (k.esc && Math.abs(c.u) > 4) {
    const rRef = clamp((c.u * c.delta) / (L * (1 + 0.0022 * c.u * c.u)), -(0.85 * G) / Math.abs(c.u), (0.85 * G) / Math.abs(c.u))
    const err = c.r - rRef
    if (Math.abs(err) > 0.09) {
      c.esc = true; thr *= 0.5
      if (err > 0) escBrake[1] = clamp((err - 0.09) * 9000, 0, 2500) // turning too far left: brake the front right
      else escBrake[0] = clamp((-err - 0.09) * 9000, 0, 2500)
      if ((err > 0 && c.delta < 0) || (err < 0 && c.delta > 0)) { escBrake[err > 0 ? 1 : 0] *= 0.5 }
      if (Math.abs(rRef) > 0.05 && Math.sign(err) !== Math.sign(rRef)) { escBrake[rRef > 0 ? 2 : 3] = clamp((Math.abs(err) - 0.09) * 6000, 0, 1800) } // understeer: inner rear
    }
    // rollover mitigation for the tall SUV
    if (Math.abs(c.ay) > 0.8 * (sp.track / (2 * sp.cgH)) * G) { c.esc = true; escBrake[c.ay > 0 ? 1 : 0] += 2500 }
    if (c.esc) ev(c, 'esc')
  }

  /* tyres */
  let Fx = 0, Fy = 0, Mz = 0
  // brake booster: vacuum from the running engine; with the engine off a few presses empty it
  if (c.engineOn) h.vac = Math.min(1, h.vac + dt * 0.5)
  else { h.vac = Math.max(0, h.vac - k.brake * dt * 0.35); if (h.vac < 0.2 && k.brake > 0.3 && Math.abs(c.u) > 2) ev(c, 'vacuumLost') }
  const brakeIn = k.brake * (0.3 + 0.7 * h.vac)
  let lifted = 0
  for (let i = 0; i < 4; i++) {
    const w = c.wheels[i]
    const [px, py] = pos[i]
    const front = i < 2
    const d = front ? c.delta : 0
    const vx = c.u - c.r * py, vy = c.v + c.r * px
    const cd = Math.cos(d), sd = Math.sin(d)
    const vl = vx * cd + vy * sd, vt = -vx * sd + vy * cd
    const wx = c.x + pos[i][0] * Math.cos(c.psi) - pos[i][1] * Math.sin(c.psi), wy = c.y + pos[i][0] * Math.sin(c.psi) + pos[i][1] * Math.cos(c.psi)
    const surf = surfaceAt(wx, wy)
    w.surface = surf.id
    w.fz = Math.max(0, fz[i]); w.lift = fz[i] <= 0
    if (w.lift) lifted++
    const den = Math.max(Math.abs(vl), 3)
    const kappa = clamp((w.omega * sp.R - vl) / den, -1, 1)
    const tanA = vt / den
    w.kappa = kappa; w.alpha = Math.atan(tanA)
    const sig = Math.hypot(kappa, tanA)
    const Fmax = surf.mu * w.fz
    const F = sig > 1e-6 ? Fmax * MF(sig) : 0
    let fx = sig > 1e-6 ? (F * kappa) / sig : 0
    const fy = sig > 1e-6 ? (-F * tanA) / sig : 0
    fx -= (sp.Crr + surf.rr) * w.fz * Math.tanh(vl / 0.5)
    w.fx = fx; w.fy = fy
    // wheel spin: drive torque − brake torque − tyre reaction
    const drv = driven.includes(i) ? Tdrive / driven.length : 0
    // hot discs fade: the pad friction falls above ≈ 550 °C
    const fade = 1 - clamp((h.disc[i] - 550) / 400, 0, 0.6)
    // Park: the pawl locks the output shaft — unless the car is rolling, then it ratchets over the teeth
    const pawlHold = k.select === 'P' && !front && h.pawl > 0 && Math.abs(c.u) < 0.8 ? 8000 : 0
    // driveline wind-up in 4H / 4L on a high-grip surface: the axles fight each other
    const bind = front && sp.partTime && k.mode !== '2H' ? 1800 * clamp(h.windup / 0.6, 0, 1.5) : 0
    let Tb = ((front ? sp.brakeF : sp.brakeR) * brakeIn + escBrake[i] + (!front ? k.handbrake * 3200 : 0)) * fade + pawlHold + bind
    w.abs = false
    if (k.abs && kappa < -0.12 && Math.abs(vl) > 2 && k.handbrake < 0.1) { Tb *= 0.25; w.abs = true } // ABS releases the locking wheel
    const Tbr = Tb * Math.tanh(w.omega / 0.4)
    // the disc soaks up the braking power and sheds it to the air
    h.disc[i] += ((Math.abs(Tbr - pawlHold - bind) * Math.abs(w.omega)) / (front ? 3500 : 2500) - (h.disc[i] - AMB) * (0.0015 + 0.00025 * Math.abs(c.u))) * dt
    // linearly-implicit wheel update: the tyre is a very stiff spring on the wheel's spin, so include its
    // derivative dFx/dω in the step (an explicit step at 240 Hz would oscillate on a light, fast wheel)
    const kap2 = clamp(((w.omega + 0.5) * sp.R - vl) / den, -1, 1), sig2 = Math.hypot(kap2, tanA)
    const fx2 = sig2 > 1e-6 ? (Fmax * MF(sig2) * kap2) / sig2 : 0
    const dFdw = Math.max(0, ((fx2 - (fx + (sp.Crr + surf.rr) * w.fz * Math.tanh(vl / 0.5))) / 0.5))
    const Ieff = sp.Iw + (driven.includes(i) && ratio !== 0 ? (sp.Ie * ratio * ratio) / driven.length : 0)
    const wNext = w.omega + ((drv - fx * sp.R - Tbr) * dt / Ieff) / (1 + (dFdw * sp.R * dt) / Ieff)
    w.omega = Math.sign(wNext) !== Math.sign(w.omega) && Tb > Math.abs(drv) && w.omega !== 0 ? 0 : wNext
    // back to the car frame
    const fxc = fx * cd - fy * sd, fyc = fx * sd + fy * cd
    Fx += fxc; Fy += fyc; Mz += px * fyc - py * fxc
  }
  if (c.wheels.some((w) => w.abs)) ev(c, 'abs')
  if (c.tcs) ev(c, 'tcs')

  /* aerodynamics */
  Fx -= 0.5 * 1.225 * sp.CdA * c.u * Math.abs(c.u)

  /* integrate the body */
  const axb = Fx / m, ayb = Fy / m
  c.u += (axb + c.r * c.v) * dt
  c.v += (ayb - c.r * c.u) * dt
  c.r += (Mz / sp.Iz) * dt
  // standing still with the brakes on: static friction holds the car
  if (Math.abs(c.u) < 0.08 && Math.abs(c.v) < 0.08 && (brakeIn > 0.2 || k.select === 'P' || k.handbrake > 0.5) && Math.abs(Tdrive) < (sp.brakeR * 2 * brakeIn + 4000)) { c.u = 0; c.v = 0; c.r = 0; c.wheels.forEach((w) => { w.omega = 0 }) }
  const cs = Math.cos(c.psi), sn = Math.sin(c.psi)
  c.x += (c.u * cs - c.v * sn) * dt
  c.y += (c.u * sn + c.v * cs) * dt
  c.psi += c.r * dt
  // filtered accelerations for weight transfer and the body's pitch / roll on its springs
  c.ax += (axb - c.ax) * Math.min(1, dt * 8)
  c.ay += (ayb - c.ay) * Math.min(1, dt * 8)
  c.roll += (-c.ay * sp.rollK - c.roll) * Math.min(1, dt * 6)
  c.pitch += (c.ax * sp.pitchK - c.pitch) * Math.min(1, dt * 6)

  /* rollover: both wheels on one side unloaded for long enough */
  const sideLift = (c.wheels[0].lift && c.wheels[2].lift) || (c.wheels[1].lift && c.wheels[3].lift)
  c.liftT = sideLift ? c.liftT + dt : Math.max(0, c.liftT - dt * 2)
  if (lifted >= 1) ev(c, 'wheelLift')
  if (c.liftT > 0.45) { c.rolled = true; ev(c, 'rollover') }

  /* ---------- temperatures and wear (≈ 3× faster than real so effects show in minutes) */
  const load = c.engineOn ? clamp(thr, 0, 1) : 0
  const Pe = c.engineOn ? Math.max(0, Te) * we : 0
  // coolant: heat from combustion; the thermostat opens 82→95 °C; radiator flow rises with speed and the fan
  const open = clamp((h.coolant - 82) / 13, 0, 1), fan = h.coolant > 98 ? 1 : 0
  const qIn = c.engineOn ? 3500 + Pe * 0.55 : 0
  const qOut = open * (h.coolant - AMB) * (260 + 55 * Math.abs(c.u) + fan * 420) + (h.coolant - AMB) * 6
  h.coolant += ((qIn - qOut) / 9000) * dt
  h.oil += ((h.coolant + 12 * load - h.oil) / 25) * dt
  if (h.coolant > 112) ev(c, 'overheat')
  if (h.coolant > 124) { h.eng = Math.max(0, h.eng - dt * 0.05); ev(c, 'headGasket') } // head gasket / warped head
  // cold oil is thick and does not reach the bearings and cam lobes in time: high revs wear the engine
  if (c.engineOn && h.oil < 50 && c.rpm > sp.redline * 0.62) { h.eng = Math.max(0, h.eng - dt * 0.004); ev(c, 'coldRev') }
  if (h.eng < 0.5 && !c.flagEng) { c.flagEng = true; ev(c, 'engineDamaged') }
  if (h.eng <= 0 && c.engineOn) { c.engineOn = false; k.ignition = false; ev(c, 'engineSeized') }
  // transmission fluid: converter slip and shifts heat it; the cooler in the radiator sheds it
  h.atf += ((slipW + (c.shiftT > 0 ? 1500 * load : 0) - (h.atf - Math.max(AMB, h.coolant - 10)) * (25 + 12 * Math.abs(c.u))) / 7000) * dt
  if (h.atf > 120) ev(c, 'atfHot')
  if (h.atf > 150) { h.trans = Math.max(0, h.trans - dt * 0.06 * (h.atf - 150) / 20); if (h.trans <= 0) ev(c, 'transFail') }
  // turbine housing: follows exhaust temperature; idling lets it cool before shut-down
  const tT = c.engineOn ? 160 + 700 * load * clamp(c.rpm / sp.redline, 0.25, 1) + (sp.diesel ? 0 : 80 * load) : AMB
  h.turbo += ((tT - h.turbo) / (tT > h.turbo ? 6 : 25)) * dt
  // Park selected while rolling (mechanical lever): the pawl ratchets on the parking gear
  if (k.select === 'P' && Math.abs(c.u) > 0.8 && h.pawl > 0) { h.pawl = Math.max(0, h.pawl - Math.abs(c.u) * dt * 0.012); ev(c, h.pawl <= 0 ? 'pawlBroken' : 'pawl') }
  // part-time 4WD: on grip the front axle travels further than the rear in a turn; with a locked centre that
  // difference twists the shafts (wind-up) until a tyre slips — on asphalt it cannot, so it binds and breaks
  if (sp.partTime && k.mode !== '2H') {
    const mu = c.wheels.reduce((sum, w) => sum + (w.surface === 'asphalt' ? 1 : w.surface === 'wet' ? 0.62 : 0.4), 0) / 4
    const grow = Math.abs(c.u) * (1 / Math.cos(c.delta) - 1) * (k.mode === '4L' ? 2.566 : 1)
    if (mu > 0.85) h.windup += grow * dt * 2.5
    else h.windup = Math.max(0, h.windup - dt * (0.6 + Math.abs(c.u) * 0.1))
    if (h.windup > 0.3) ev(c, 'windup')
    if (h.windup > 1) { h.xfer = Math.max(0, h.xfer - dt * 0.06 * (h.windup - 1)); if (h.xfer <= 0) { k.mode = '2H'; h.windup = 0; ev(c, 'xferBroken') } }
  } else h.windup = Math.max(0, h.windup - dt)
  const maxDisc = Math.max(...h.disc)
  if (maxDisc > 550) ev(c, 'brakeFade')
  h.wasOn = c.engineOn

  /* 0–100 km/h and 400 m timer */
  const kmh = c.u * 3.6
  const tm = c.timer
  if (kmh < 0.5 && k.throttle < 0.05) { tm.armed = true; tm.start = null }
  if (tm.armed && tm.start === null && kmh > 0.5) { tm.start = c.t; tm.x0 = c.x; tm.y0 = c.y; tm.t100 = null; tm.d400 = null }
  if (tm.start !== null) {
    if (tm.t100 === null && kmh >= 100) { tm.t100 = c.t - tm.start; ev(c, 't100', tm.t100) }
    if (tm.d400 === null && Math.hypot(c.x - tm.x0, c.y - tm.y0) >= 400) { tm.d400 = c.t - tm.start; ev(c, 'd400', tm.d400); tm.armed = false }
  }
  c.t += dt
}
export function advanceCar(c: Car, s: number) { let n = Math.round(s / H); while (n-- > 0) stepCar(c, H) }
