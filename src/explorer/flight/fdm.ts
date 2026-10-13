import * as THREE from 'three'

/*
 * A320 flight dynamics model — rigid body, 6 degrees of freedom.
 *
 * Nothing here is scripted: the aircraft moves only because of forces and moments —
 * aerodynamics (coefficients vs α, β, rates, control surfaces, flaps, ground effect), engine thrust,
 * gravity and three spring–damper landing-gear struts with tyre friction. The pilot's inputs go through
 * a fly-by-wire control law (Normal law with protections, or Direct law) to actuators with rate limits.
 *
 * Frames
 *   world: x along the runway, y up, z to the right when looking down the runway (+x)
 *   body : x to the nose, y up through the roof, z out of the right wing; origin at the centre of gravity
 * Rates: p = roll (ω.x, right wing down +), q = pitch (ω.z, nose up +), r = yaw (−ω.y, nose right +).
 *
 * Numbers are representative of an A320 at ~64 t; this is a training model, not certified data.
 */

export const DEG = Math.PI / 180
export const KT = 0.514444
export const FT = 0.3048
export const G = 9.80665
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const approach = (v: number, target: number, rate: number, dt: number) => v + clamp(target - v, -rate * dt, rate * dt)

/* ------------------------------------------------------------------ aircraft data */
export const AC = {
  mass: 64000,
  S: 122.6, // wing area m²
  b: 34.1, // span m
  c: 4.19, // mean aerodynamic chord m
  I: new THREE.Vector3(1.35e6, 4.3e6, 3.1e6), // body x (roll), y (yaw), z (pitch) kg·m²
  tMax: 120000, // N per engine, static sea level (CFM56-5B / LEAP-1A class)
  eng: [new THREE.Vector3(2.5, -1.2, -5.75), new THREE.Vector3(2.5, -1.2, 5.75)], // left, right
  cgLayout: new THREE.Vector3(-0.63, 3.0, 0), // CG in the drawing frame (ground at y = 0 with static struts)
  iw: 2 * DEG, // wing incidence vs fuselage datum
}

/** flap lever configurations. "1+F" is selected automatically from lever position 1 on the ground. */
export interface Conf { id: string; slat: number; flap: number; cl0: number; as: number; cd: number; cm: number; vfe: number }
export const CONFS: Conf[] = [
  { id: '0', slat: 0, flap: 0, cl0: 0.2, as: 13, cd: 0, cm: 0, vfe: 350 },
  { id: '1', slat: 18, flap: 0, cl0: 0.36, as: 17, cd: 0.004, cm: -0.008, vfe: 230 },
  { id: '1+F', slat: 18, flap: 10, cl0: 0.62, as: 16, cd: 0.012, cm: -0.035, vfe: 215 },
  { id: '2', slat: 22, flap: 15, cl0: 0.8, as: 16, cd: 0.022, cm: -0.05, vfe: 200 },
  { id: '3', slat: 22, flap: 20, cl0: 0.92, as: 16, cd: 0.032, cm: -0.065, vfe: 185 },
  { id: 'FULL', slat: 27, flap: 40, cl0: 1.1, as: 17.5, cd: 0.068, cm: -0.11, vfe: 177 },
]
export const LEVER = ['0', '1', '2', '3', 'FULL'] as const
const CONF_INDEX: Record<string, number> = { '0': 0, '1': 1, '1+F': 2, '2': 3, '3': 4, FULL: 5 }

function confAt(f: number) {
  const i = clamp(Math.floor(f), 0, CONFS.length - 1), j = Math.min(CONFS.length - 1, i + 1), k = clamp(f - i, 0, 1)
  const a = CONFS[i], b = CONFS[j], L = (p: number, q: number) => p + (q - p) * k
  return { slat: L(a.slat, b.slat), flap: L(a.flap, b.flap), cl0: L(a.cl0, b.cl0), as: L(a.as, b.as) * DEG, cd: L(a.cd, b.cd), cm: L(a.cm, b.cm), vfe: L(a.vfe, b.vfe) }
}

const CLA = 5.6 // lift curve slope per rad (wing + body)
const CD0 = 0.0215
const CD_GEAR = 0.018
const E_OSW = 0.78
const K_IND = 1 / (Math.PI * E_OSW * ((AC.b * AC.b) / AC.S))

/* ------------------------------------------------------------------ runways & ground */
export const RWY = { len: 3000, width: 45 }
export const DEST = 80000 // threshold of the arrival runway, ~43 NM straight ahead
export const GS_ANGLE = 3 * DEG
export const AIM = DEST + 300 // glide-slope origin / aiming point
export function onRunway(x: number, z: number) {
  return Math.abs(z) <= RWY.width / 2 + 2 && ((x >= -60 && x <= RWY.len + 60) || (x >= DEST - 60 && x <= DEST + RWY.len + 60))
}

/* ------------------------------------------------------------------ contact points (body frame) */
type ContactKind = 'nose' | 'main' | 'tail' | 'engine' | 'wingtip' | 'belly'
interface Contact { id: string; kind: ContactKind; r: THREE.Vector3; k: number; c: number }
const STATIC_STROKE = 0.22
const fromLayout = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).sub(AC.cgLayout)
const W = AC.mass * G
export const GEAR: Contact[] = [
  { id: 'nose', kind: 'nose', r: fromLayout(11.0, -STATIC_STROKE, 0), k: (0.085 * W) / STATIC_STROKE, c: 4.6e4 },
  { id: 'mainL', kind: 'main', r: fromLayout(-1.64, -STATIC_STROKE, -3.795), k: (0.4575 * W) / STATIC_STROKE, c: 2.4e5 },
  { id: 'mainR', kind: 'main', r: fromLayout(-1.64, -STATIC_STROKE, 3.795), k: (0.4575 * W) / STATIC_STROKE, c: 2.4e5 },
]
const HARD: Contact[] = [
  { id: 'tail', kind: 'tail', r: fromLayout(-13.0, 2.35, 0), k: 4e6, c: 4e5 },
  { id: 'engL', kind: 'engine', r: fromLayout(1.9, 0.55, -5.75), k: 4e6, c: 4e5 },
  { id: 'engR', kind: 'engine', r: fromLayout(1.9, 0.55, 5.75), k: 4e6, c: 4e5 },
  { id: 'tipL', kind: 'wingtip', r: fromLayout(-4.4, 3.4, -16.9), k: 4e6, c: 4e5 },
  { id: 'tipR', kind: 'wingtip', r: fromLayout(-4.4, 3.4, 16.9), k: 4e6, c: 4e5 },
  { id: 'bellyF', kind: 'belly', r: fromLayout(9.0, 1.4, 0), k: 4e6, c: 4e5 },
  { id: 'bellyA', kind: 'belly', r: fromLayout(-3.0, 1.33, 0), k: 4e6, c: 4e5 },
]

/* ------------------------------------------------------------------ state */
export type Law = 'normal' | 'direct'
export interface Controls {
  stickX: number // −1 left … +1 right
  stickY: number // −1 push … +1 pull
  pedal: number // −1 left … +1 right
  lever: number // thrust levers 0 IDLE … 1 TOGA
  rev: 0 | 1 | 2 // reverse: off / idle reverse / max reverse
  flapLever: number // 0..4 → 0, 1, 2, 3, FULL
  gearDown: boolean
  speedbrake: number // 0..1 in flight
  spoilersArmed: boolean
  autobrake: 0 | 1 | 2 // off, LO, MED
  brake: number // manual toe brakes 0..1
  law: Law
  trim: -1 | 0 | 1 // manual pitch trim (direct law)
}
export interface Surfaces {
  elev: number // rad, + = trailing edge up (nose up)
  ail: number // rad, + = roll right
  rud: number // rad, + = yaw right
  ths: number // rad, + = nose up trim
  splL: number; splR: number // spoiler panels 0..1 (roll + speedbrake + ground)
  gndSpl: number // ground spoilers 0..1
  conf: number // continuous configuration index 0..5
  confTarget: number
  gear: number // 0 up … 1 down & locked
  steer: number // nose wheel angle rad
}
export interface Derived {
  V: number; tas: number; ias: number; gs: number; mach: number; rho: number; qbar: number
  alpha: number; beta: number; gamma: number; theta: number; phi: number; psi: number
  p: number; q: number; r: number; nz: number; vs: number; alt: number; ra: number
  lift: number; drag: number; thrust: [number, number]; weight: number
  egt: [number, number]; ff: [number, number]
  wow: boolean; mainsOn: boolean; noseOn: boolean; struts: number[]
  alphaProt: number; alphaMax: number; alphaStall: number; stall: boolean; inProt: boolean
  onRunway: boolean; confId: string; vfe: number; vls: number; vs1g: number; flare: boolean
  decel: number; ge: number
}
export type SimEvent =
  | 'liftoff' | 'touchdown' | 'hardLanding' | 'tailstrike' | 'crash' | 'stall' | 'alphaProt' | 'alphaFloor' | 'bankLimit'
  | 'gearUp' | 'gearDown' | 'flaps' | 'groundSpoilers' | 'reverse' | 'stopped' | 'vfe' | 'overspeed' | 'offRunway' | 'flare' | 'v1' | 'vr' | 'positiveClimb'
export interface Sim {
  t: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  quat: THREE.Quaternion
  w: THREE.Vector3
  n1: [number, number]
  ctl: Controls
  srf: Surfaces
  fbw: { blend: number; qInt: number; pInt: number; holdG: boolean; gammaRef: number; holdP: boolean; phiRef: number; alphaFloor: boolean; floorLever: number; flareTheta: number; flareT: number; abBrake: number; abActive: boolean }
  d: Derived
  airborne: boolean
  everAirborne: boolean
  crashed: string | null
  touchdownVs: number | null
  maxNz: number
  events: { t: number; e: SimEvent; v?: number }[]
  flags: Record<string, boolean>
}

export function defaultControls(): Controls {
  return { stickX: 0, stickY: 0, pedal: 0, lever: 0, rev: 0, flapLever: 0, gearDown: true, speedbrake: 0, spoilersArmed: false, autobrake: 0, brake: 0, law: 'normal', trim: 0 }
}

export type Start = 'runway' | 'approach' | 'cruise'
export function createSim(start: Start = 'runway'): Sim {
  const s: Sim = {
    t: 0, pos: new THREE.Vector3(80, AC.cgLayout.y, 0), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), w: new THREE.Vector3(),
    n1: [19.5, 19.5], ctl: defaultControls(),
    srf: { elev: 0, ail: 0, rud: 0, ths: 0, splL: 0, splR: 0, gndSpl: 0, conf: 0, confTarget: 0, gear: 1, steer: 0 },
    fbw: { blend: 0, qInt: 0, pInt: 0, holdG: false, gammaRef: 0, holdP: false, phiRef: 0, alphaFloor: false, floorLever: 0, flareTheta: 0, flareT: 0, abBrake: 0, abActive: false },
    d: {} as Derived, airborne: false, everAirborne: false, crashed: null, touchdownVs: null, maxNz: 1, events: [], flags: {},
  }
  if (start === 'approach') {
    // 7 NM final, on the 3° glide path, configuration 3, gear down, ~150 kt
    const dist = 7 * 1852, alt = Math.tan(GS_ANGLE) * dist + 15
    const V = 150 * KT, gam = -GS_ANGLE, th = 3.2 * DEG
    s.pos.set(AIM - dist, alt, 0)
    s.vel.set(Math.cos(gam) * V, Math.sin(gam) * V, 0)
    s.quat.setFromEuler(new THREE.Euler(0, 0, th, 'YZX'))
    Object.assign(s.ctl, { flapLever: 3, gearDown: true, lever: 0.42, spoilersArmed: true, autobrake: 1 })
    Object.assign(s.srf, { conf: 4, confTarget: 4, gear: 1, ths: 3.8 * DEG })
    s.n1 = [55, 55]; s.airborne = true; s.everAirborne = true; s.fbw.blend = 1
  } else if (start === 'cruise') {
    const V = 250 * KT * 1.16, th = 2.2 * DEG
    s.pos.set(9000, 3000, 0)
    s.vel.set(V, 0, 0)
    s.quat.setFromEuler(new THREE.Euler(0, 0, th, 'YZX'))
    Object.assign(s.ctl, { flapLever: 0, gearDown: false, lever: 0.55 })
    Object.assign(s.srf, { conf: 0, confTarget: 0, gear: 0, ths: 0.9 * DEG })
    s.n1 = [72, 72]; s.airborne = true; s.everAirborne = true; s.fbw.blend = 1
  }
  derive(s, 0)
  return s
}

/* ------------------------------------------------------------------ atmosphere & engines */
export function isa(h: number) {
  const T = 288.15 - 0.0065 * Math.max(0, Math.min(h, 11000))
  const rho = 1.225 * Math.pow(T / 288.15, 4.256)
  return { T, rho, a: Math.sqrt(1.4 * 287.05 * T), sigma: rho / 1.225 }
}
export const DETENT = { IDLE: 0, CL: 0.6, FLX: 0.85, TOGA: 1 }
export function detentName(l: number) {
  if (l > 0.97) return 'TOGA'
  if (Math.abs(l - DETENT.FLX) < 0.03) return 'FLX/MCT'
  if (Math.abs(l - DETENT.CL) < 0.03) return 'CL'
  if (l < 0.03) return 'IDLE'
  return 'MAN'
}
function leverN1(l: number, idle: number) {
  const pts: [number, number][] = [[0, idle], [DETENT.CL, 85], [DETENT.FLX, 91.5], [1, 96]]
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, na] = pts[i], [b, nb] = pts[i + 1]
    if (l <= b) return na + ((nb - na) * (l - a)) / (b - a)
  }
  return 96
}
const N1_IDLE_GND = 19.5, N1_IDLE_FLT = 24, N1_MAXREV = 72
function thrustOf(n1: number, rev: boolean, sigma: number, mach: number) {
  const f = clamp((n1 - N1_IDLE_GND) / (96 - N1_IDLE_GND), 0, 1)
  const lapse = Math.pow(sigma, 0.8) * (1 - 0.4 * mach + 0.18 * mach * mach)
  if (rev) return -AC.tMax * 0.32 * Math.pow(clamp((n1 - N1_IDLE_GND) / (N1_MAXREV - N1_IDLE_GND), 0, 1), 1.4) * lapse
  return AC.tMax * (0.035 + 0.965 * Math.pow(f, 1.7)) * lapse
}

/* ------------------------------------------------------------------ temporaries */
const _vb = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Vector3(), _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3()
const _qi = new THREE.Quaternion(), _pw = new THREE.Vector3(), _vp = new THREE.Vector3(), _roll = new THREE.Vector3(), _lat = new THREE.Vector3()
const _fw = new THREE.Vector3(), _iw = new THREE.Vector3(), _dq = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

function event(s: Sim, e: SimEvent, v?: number) {
  // the same event within a few seconds is one event
  for (let i = s.events.length - 1; i >= 0 && s.t - s.events[i].t < 4; i--) if (s.events[i].e === e) return
  s.events.push({ t: s.t, e, v })
  if (s.events.length > 60) s.events.shift()
}

/* ------------------------------------------------------------------ derived quantities */
function derive(s: Sim, dt: number) {
  const d = s.d
  const atm = isa(s.pos.y)
  _qi.copy(s.quat).invert()
  _vb.copy(s.vel).applyQuaternion(_qi)
  const V = s.vel.length()
  d.V = V; d.tas = V / KT; d.rho = atm.rho; d.mach = V / atm.a; d.qbar = 0.5 * atm.rho * V * V
  d.ias = (V * Math.sqrt(atm.sigma)) / KT
  d.gs = Math.hypot(s.vel.x, s.vel.z) / KT
  d.alpha = V > 2 ? Math.atan2(-_vb.y, _vb.x) : 0
  d.beta = V > 2 ? Math.asin(clamp(_vb.z / V, -1, 1)) : 0
  d.gamma = V > 2 ? Math.asin(clamp(s.vel.y / V, -1, 1)) : 0
  const fwd = _tmp.set(1, 0, 0).applyQuaternion(s.quat), right = _tmp2.set(0, 0, 1).applyQuaternion(s.quat)
  const upy = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat).y
  d.theta = Math.asin(clamp(fwd.y, -1, 1))
  d.psi = Math.atan2(fwd.z, fwd.x)
  d.phi = Math.atan2(-right.y, upy)
  d.p = s.w.x; d.q = s.w.z; d.r = -s.w.y
  d.vs = s.vel.y / FT * 60
  d.alt = s.pos.y / FT
  d.ra = Math.max(0, (s.pos.y - AC.cgLayout.y) / FT)
  const conf = confAt(s.srf.conf)
  d.confId = CONFS[Math.round(s.srf.conf)].id
  d.vfe = conf.vfe
  d.alphaStall = conf.as - AC.iw
  d.alphaProt = d.alphaStall - 2.8 * DEG
  d.alphaMax = d.alphaStall - 0.8 * DEG
  const clmax = conf.cl0 + CLA * conf.as
  d.vs1g = Math.sqrt((2 * W) / (1.225 * AC.S * clmax)) / KT
  d.vls = d.vs1g * (s.srf.conf < 0.5 ? 1.28 : 1.23)
  d.onRunway = onRunway(s.pos.x, s.pos.z)
  d.weight = W
  if (dt === 0) {
    d.lift = 0; d.drag = 0; d.thrust = [0, 0]; d.egt = [420, 420]; d.ff = [300, 300]; d.nz = 1; d.wow = !s.airborne; d.mainsOn = d.wow; d.noseOn = d.wow
    d.struts = [STATIC_STROKE, STATIC_STROKE, STATIC_STROKE]; d.stall = false; d.inProt = false; d.flare = false; d.decel = 0; d.ge = 1
  }
}

/* ------------------------------------------------------------------ fly-by-wire */
function flyByWire(s: Sim, dt: number) {
  const c = s.ctl, d = s.d, f = s.fbw, r = s.srf
  const V = Math.max(d.V, 30), gn = G / V
  const qref = 3500, sched = clamp(qref / Math.max(d.qbar, 300), 0.25, 4)
  // ground → flight mode blending (A320: direct "ground law" on the runway, normal law in the air)
  f.blend = approach(f.blend, s.airborne ? 1 : 0, 0.2, dt)

  /* ---------- pitch */
  let elevCmd: number
  const direct = c.stickY * 30 * DEG * clamp(sched, 0.35, 1)
  if (c.law === 'direct') {
    elevCmd = direct
    r.ths = clamp(r.ths + c.trim * 0.5 * DEG * dt, -4 * DEG, 13.5 * DEG)
    d.inProt = false
  } else {
    const sy = c.stickY
    let gdot: number
    if (Math.abs(sy) < 0.03) {
      if (!f.holdG) { f.holdG = true; f.gammaRef = d.gamma }
      gdot = clamp(0.35 * (f.gammaRef - d.gamma), -3 * DEG, 3 * DEG)
    } else {
      f.holdG = false
      // stick = load-factor demand: full aft ≈ +1.5 g extra (flaps up), full forward ≈ −2 g
      gdot = (sy > 0 ? 1.2 : 1.6) * sy * gn
    }
    const phiC = clamp(d.phi, -33 * DEG, 33 * DEG)
    let qCmd = gdot * Math.cos(d.phi) + gn * Math.sin(d.phi) * Math.tan(phiC)
    // α-protection: above α-prot the stick commands angle of attack, never beyond α-max
    const prot = d.alpha > d.alphaProt - 0.6 * DEG && s.airborne
    if (prot) {
      const aCmd = d.alphaProt + Math.max(0, sy) * (d.alphaMax - d.alphaProt)
      qCmd = Math.min(qCmd, 1.1 * (aCmd - d.alpha) + gn * Math.cos(d.gamma) * 0.0)
      if (!d.inProt && d.alpha > d.alphaProt) event(s, 'alphaProt')
    }
    d.inProt = prot && d.alpha > d.alphaProt - 0.2 * DEG
    // α-floor: automatic TOGA thrust when α keeps rising inside the protection
    if (s.airborne && d.ra > 100 && d.alpha > d.alphaProt + 0.5 * (d.alphaMax - d.alphaProt) && !f.alphaFloor) {
      f.alphaFloor = true; f.floorLever = c.lever; event(s, 'alphaFloor')
    }
    if (f.alphaFloor && Math.abs(c.lever - f.floorLever) > 0.05) f.alphaFloor = false // pilot took the levers back
    // pitch-attitude protection +30° / −15°
    qCmd = Math.min(qCmd, 0.8 * (30 * DEG - d.theta))
    qCmd = Math.max(qCmd, 0.8 * (-15 * DEG - d.theta))
    // high-speed protection: gentle nose-up above VMO + 6 kt
    if (d.ias > 356) qCmd += 0.004 * (d.ias - 356)
    // flare mode below 50 ft: the law memorises the attitude and slowly lowers the nose — the pilot must flare
    if (s.airborne && d.ra < 50 && d.vs < 0 && s.srf.gear > 0.99) {
      if (!d.flare) { d.flare = true; f.flareTheta = d.theta; f.flareT = 0; event(s, 'flare') }
      f.flareT += dt
      const thT = f.flareTheta - Math.min(2 * DEG, (f.flareT / 8) * 2 * DEG)
      qCmd = 0.15 * (thT - d.theta) + sy * 8 * DEG
    } else if (d.ra > 60 || !s.airborne) d.flare = false
    const qe = qCmd - d.q
    f.qInt = clamp(f.qInt + qe * dt, -0.6, 0.6)
    if (!s.airborne) f.qInt *= 1 - Math.min(1, dt * 2)
    const normal = (2.6 * qe + 1.5 * f.qInt) * sched
    elevCmd = direct * (1 - f.blend) + normal * f.blend
    // auto-trim: the stabiliser slowly takes over the elevator's load so stick-free flight is trimmed
    if (s.airborne && f.blend > 0.9 && !d.inProt && !d.flare && d.nz > 0.5 && d.nz < 1.3) {
      r.ths = clamp(r.ths + clamp(0.45 * r.elev, -0.7 * DEG, 0.7 * DEG) * dt, -4 * DEG, 13.5 * DEG)
    }
  }
  // take-off trim: on the ground the stabiliser is set from the configuration (the crew enters it in the FMS)
  if (!s.everAirborne && !s.airborne) r.ths = approach(r.ths, (s.srf.confTarget >= 2 ? 0.2 : -0.4) * DEG, 1 * DEG, dt)
  r.elev = approach(r.elev, clamp(elevCmd, -17 * DEG, 30 * DEG), 40 * DEG, dt)

  /* ---------- roll */
  let ailCmd: number
  if (c.law === 'direct' || !s.airborne) {
    ailCmd = c.stickX * 25 * DEG * clamp(sched, 0.3, 1)
    f.pInt = 0; f.holdP = false
  } else {
    let pCmd: number
    if (Math.abs(c.stickX) < 0.03) {
      if (!f.holdP) { f.holdP = true; f.phiRef = clamp(d.phi, -33 * DEG, 33 * DEG) }
      pCmd = clamp(0.8 * (f.phiRef - d.phi), -8 * DEG, 8 * DEG) // bank hold; beyond 33° the aircraft rolls back to 33°
    } else {
      f.holdP = false
      pCmd = c.stickX * 15 * DEG
    }
    const lim = (d.inProt ? 45 : 67) * DEG
    if (Math.abs(d.phi) > lim - 2 * DEG) event(s, 'bankLimit')
    pCmd = Math.min(pCmd, 1.2 * (lim - d.phi))
    pCmd = Math.max(pCmd, 1.2 * (-lim - d.phi))
    const pe = pCmd - d.p
    f.pInt = clamp(f.pInt + pe * dt, -0.4, 0.4)
    ailCmd = ((2.4 * pe + 1.2 * f.pInt) * sched) * f.blend + c.stickX * 25 * DEG * (1 - f.blend)
  }
  const ail = clamp(ailCmd, -25 * DEG, 25 * DEG)
  r.ail = approach(r.ail, ail, 60 * DEG, dt)

  /* ---------- yaw: pedals + yaw damper + turn coordination */
  const maxRud = clamp(25 - (d.ias - 160) * 0.098, 3.5, 25) * DEG
  let rudCmd = c.pedal * maxRud
  if (c.law === 'normal' && s.airborne) {
    const rTurn = gn * Math.sin(d.phi) * Math.cos(d.theta)
    rudCmd += (-0.9 * (d.r - rTurn) + 1.4 * d.beta) * f.blend
  }
  r.rud = approach(r.rud, clamp(rudCmd, -maxRud, maxRud), 40 * DEG, dt)
  r.steer = approach(r.steer, c.pedal * (d.gs < 30 ? 40 : 6) * DEG, 20 * DEG, dt)
}

/* ------------------------------------------------------------------ systems: flaps, gear, spoilers, brakes */
function systems(s: Sim, dt: number) {
  const c = s.ctl, r = s.srf, d = s.d
  // flap lever → configuration; lever 1 gives 1+F on the ground / at low speed, auto-retracts to 1 above 210 kt
  let tgt = [0, 1, 3, 4, 5][clamp(Math.round(c.flapLever), 0, 4)]
  if (c.flapLever === 1) {
    const was1F = r.confTarget === 2
    tgt = !s.airborne || (was1F && d.ias < 210) ? 2 : 1
  }
  if (tgt !== r.confTarget) { r.confTarget = tgt; event(s, 'flaps', tgt) }
  r.conf = approach(r.conf, r.confTarget, 0.14, dt)
  // landing gear: hydraulic retraction interlocked by weight on wheels
  if (!c.gearDown && d.wow) c.gearDown = true
  const gearTgt = c.gearDown ? 1 : 0
  if (s.flags.gearLever !== c.gearDown) { if (s.flags.gearLever !== undefined) event(s, gearTgt ? 'gearDown' : 'gearUp'); s.flags.gearLever = c.gearDown }
  r.gear = approach(r.gear, gearTgt, 1 / 9, dt)
  // ground spoilers: armed + both mains on the ground + levers at idle (or reverse)
  const gndCond = d.mainsOn && (c.lever < 0.05 || c.rev > 0) && d.gs > 40
  const deploy = (c.spoilersArmed || c.rev > 0) && gndCond
  if (deploy && r.gndSpl < 0.05) event(s, 'groundSpoilers')
  r.gndSpl = approach(r.gndSpl, deploy || (r.gndSpl > 0.5 && d.mainsOn && c.lever < 0.05) ? 1 : 0, 1.5, dt)
  // spoiler panels: speedbrake (in flight) + roll spoilers + ground spoilers
  const sb = s.airborne ? c.speedbrake * (d.inProt ? 0 : 1) : 0
  const roll = clamp((Math.abs(r.ail) / (25 * DEG) - 0.25) / 0.75, 0, 1)
  const tgtL = Math.max(r.gndSpl, sb * 0.6 + (r.ail < 0 ? roll : 0))
  const tgtR = Math.max(r.gndSpl, sb * 0.6 + (r.ail > 0 ? roll : 0))
  r.splL = approach(r.splL, clamp(tgtL, 0, 1), 1.4, dt)
  r.splR = approach(r.splR, clamp(tgtR, 0, 1), 1.4, dt)
  // reverse only on the ground with levers at idle
  if (c.rev > 0 && (!d.mainsOn || c.lever > 0.05)) c.rev = 0
  // autobrake: decelerate at a set rate after the ground spoilers deploy
  const f = s.fbw
  if (c.autobrake && r.gndSpl > 0.8 && d.gs > 5) f.abActive = true
  if (c.brake > 0.3 || d.gs < 3 || c.lever > 0.1) f.abActive = false
  if (f.abActive) {
    const tgtDecel = c.autobrake === 2 ? 3.0 : 1.7
    f.abBrake = clamp(f.abBrake + (tgtDecel - d.decel) * 0.6 * dt, 0, 1)
  } else f.abBrake = approach(f.abBrake, 0, 2, dt)
}

/* ------------------------------------------------------------------ one physics step */
export const H = 1 / 240
export function step(s: Sim, dt = H) {
  if (s.crashed) return
  const c = s.ctl, r = s.srf, d = s.d
  derive(s, dt)
  flyByWire(s, dt)
  systems(s, dt)

  _f.set(0, 0, 0); _m.set(0, 0, 0)
  _qi.copy(s.quat).invert()
  _vb.copy(s.vel).applyQuaternion(_qi)
  const V = d.V
  const conf = confAt(r.conf)

  /* ---------- aerodynamics */
  // ground effect: wing height over span
  const hw = Math.max(0.5, s.pos.y - 0.6)
  const g16 = (16 * hw) / AC.b, phiGe = (g16 * g16) / (1 + g16 * g16)
  d.ge = phiGe
  let lift = 0, drag = 0
  if (V > 1) {
    const qS = d.qbar * AC.S
    const aw = d.alpha + AC.iw
    const qh = (d.q * AC.c) / (2 * V), ph = (d.p * AC.b) / (2 * V), rh = (d.r * AC.b) / (2 * V)
    let CL: number
    const clmax = conf.cl0 + CLA * conf.as
    let stall = 0
    if (aw <= conf.as) CL = conf.cl0 + CLA * aw
    else { const o = aw - conf.as; stall = o; CL = Math.max(clmax * 0.6, clmax - 2.2 * o - 7 * o * o) }
    if (aw < -0.25) CL = conf.cl0 + CLA * -0.25 // keep it sane in a dive
    CL *= 1 + 0.1 * (1 - phiGe)
    CL += 0.25 * r.elev + 0.5 * r.ths * 0.3 + 4.5 * qh
    CL -= 0.55 * r.gndSpl + 0.14 * ((r.splL + r.splR) / 2) * (1 - r.gndSpl)
    const CD = CD0 + conf.cd + CD_GEAR * r.gear + K_IND * phiGe * CL * CL + 0.05 * r.gndSpl + 0.03 * ((r.splL + r.splR) / 2) + 0.35 * d.beta * d.beta + 0.9 * stall + (d.mach > 0.7 ? 0.2 * (d.mach - 0.7) ** 2 : 0)
    const CY = -0.85 * d.beta - 0.22 * r.rud
    const Cm = 0.05 + conf.cm - 1.35 * aw + 1.2 * r.elev + 2.5 * r.ths - 28 * qh - 0.035 * (1 - phiGe) - 0.4 * stall + 0.012 * r.gear - 0.05 * r.gndSpl
    const Cl = -0.1 * d.beta - 0.46 * ph + 0.1 * rh + 0.11 * (r.ail / (25 * DEG)) * 0.44 + 0.06 * (r.splR - r.splL) + 0.012 * r.rud
    const Cn = 0.13 * d.beta - 0.2 * rh - 0.035 * ph - 0.008 * r.ail + 0.09 * r.rud
    lift = CL * qS; drag = CD * qS
    const ca = Math.cos(d.alpha), sa = Math.sin(d.alpha)
    _f.x += lift * sa - drag * ca
    _f.y += lift * ca + drag * sa
    _f.z += CY * qS
    // roll (body x), yaw (−body y), pitch (body z)
    _m.x += Cl * qS * AC.b
    _m.y += -Cn * qS * AC.b
    _m.z += Cm * qS * AC.c
    d.stall = stall > 0
    if (stall > 0.5 * DEG && s.airborne) event(s, 'stall')
  }
  d.lift = lift; d.drag = drag

  /* ---------- engines */
  const atm = isa(s.pos.y)
  const idle = s.airborne ? N1_IDLE_FLT : N1_IDLE_GND
  const lever = s.fbw.alphaFloor ? 1 : c.lever
  const tgtN1 = c.rev === 2 ? N1_MAXREV : c.rev === 1 ? N1_IDLE_GND + 6 : leverN1(lever, idle)
  for (let i = 0; i < 2; i++) {
    const n = s.n1[i]
    const k = tgtN1 > n ? (n < 50 ? 0.2 : 0.5) : 0.45
    s.n1[i] = n + (tgtN1 - n) * Math.min(1, k * dt)
    const T = thrustOf(s.n1[i], c.rev > 0, atm.sigma, d.mach)
    d.thrust[i] = T
    const fT = clamp((s.n1[i] - N1_IDLE_GND) / (96 - N1_IDLE_GND), 0, 1)
    d.egt[i] = 420 + 430 * fT
    d.ff[i] = 300 + 2700 * Math.pow(fT, 1.4)
    _tmp.set(T, 0, 0)
    _f.add(_tmp)
    _m.add(_tmp2.copy(AC.eng[i]).cross(_tmp))
  }
  if (c.rev > 0 && !s.flags.rev) event(s, 'reverse')
  s.flags.rev = c.rev > 0

  /* ---------- gravity (world) → body */
  _tmp.set(0, -W, 0).applyQuaternion(_qi)
  _f.add(_tmp)

  /* ---------- landing gear & hard points */
  let mainsOn = 0, noseOn = false, wowAny = false
  let brakeForceSum = 0
  const brake = Math.max(c.brake, s.fbw.abBrake)
  _roll.set(1, 0, 0).applyQuaternion(s.quat); _roll.y = 0; _roll.normalize()
  const contacts = r.gear > 0.99 ? GEAR : []
  const all = [...contacts, ...HARD]
  d.struts = [0, 0, 0]
  for (const ct of all) {
    _pw.copy(ct.r).applyQuaternion(s.quat).add(s.pos)
    const pen = -_pw.y
    const gi = GEAR.indexOf(ct)
    if (gi >= 0) d.struts[gi] = clamp(STATIC_STROKE * 1.6 - Math.max(0, pen), 0, STATIC_STROKE * 1.6) // visual strut extension
    if (pen <= 0) continue
    // velocity of the contact point
    _vp.copy(s.w).cross(ct.r).applyQuaternion(s.quat).add(s.vel)
    let N = ct.k * pen - ct.c * _vp.y
    if (N < 0) N = 0
    const isWheel = ct.kind === 'nose' || ct.kind === 'main'
    // tyre directions
    if (ct.kind === 'nose') _tmp.copy(_roll).applyAxisAngle(UP, -r.steer)
    else _tmp.copy(_roll)
    _lat.copy(_tmp).cross(UP).negate() // right of the rolling direction
    const vRoll = _vp.dot(_tmp), vLat = _vp.dot(_lat)
    let mu = 0.5, muLat = 0.5
    if (isWheel) {
      mu = 0.015 + (ct.kind === 'main' ? 0.45 * brake : 0)
      muLat = 0.75
      if (!onRunway(_pw.x, _pw.z)) { mu += 0.04; muLat = 0.5 }
    }
    const Fr = -mu * N * Math.tanh(vRoll / 0.3)
    const Fl = -muLat * N * Math.tanh(vLat / 0.2)
    if (ct.kind === 'main') brakeForceSum += -Fr
    _fw.set(0, N, 0).addScaledVector(_tmp, Fr).addScaledVector(_lat, Fl)
    _tmp.copy(_fw).applyQuaternion(_qi) // force in body frame
    _f.add(_tmp)
    _m.add(_tmp2.copy(ct.r).cross(_tmp))
    if (isWheel) { wowAny = true; if (ct.kind === 'main') mainsOn++; else noseOn = true }
    else {
      if (ct.kind === 'tail') { if (!s.flags.tail) { s.flags.tail = true; event(s, 'tailstrike') } }
      else if (Math.abs(_vp.y) > 1.5 || s.vel.length() > 25 || ct.kind === 'belly') crash(s, ct.kind === 'engine' ? 'engine' : ct.kind === 'wingtip' ? 'wingtip' : 'belly')
    }
  }
  if (s.flags.tail && d.theta < 9 * DEG) s.flags.tail = false

  /* ---------- integrate (semi-implicit Euler) */
  const fWorld = _tmp.copy(_f).applyQuaternion(s.quat)
  s.vel.addScaledVector(fWorld, dt / AC.mass)
  s.pos.addScaledVector(s.vel, dt)
  // Euler's rigid-body equation: I ω̇ = M − ω × (I ω)
  _iw.set(AC.I.x * s.w.x, AC.I.y * s.w.y, AC.I.z * s.w.z)
  _tmp2.copy(s.w).cross(_iw)
  _m.sub(_tmp2)
  s.w.x += (_m.x / AC.I.x) * dt
  s.w.y += (_m.y / AC.I.y) * dt
  s.w.z += (_m.z / AC.I.z) * dt
  _dq.set(s.w.x * dt * 0.5, s.w.y * dt * 0.5, s.w.z * dt * 0.5, 0)
  _dq.premultiply(s.quat)
  s.quat.set(s.quat.x + _dq.x, s.quat.y + _dq.y, s.quat.z + _dq.z, s.quat.w + _dq.w).normalize()

  /* ---------- bookkeeping */
  // load factor = non-gravitational force along the body vertical / weight
  _tmp2.set(0, -W, 0).applyQuaternion(_qi)
  d.nz = (_f.y - _tmp2.y) / W
  s.maxNz = Math.max(s.maxNz, d.nz)
  d.mainsOn = mainsOn >= 1; d.noseOn = noseOn; d.wow = wowAny
  d.decel = s.vel.length() > 1 ? -fWorld.dot(s.vel) / (s.vel.length() * AC.mass) : 0
  void brakeForceSum
  const wasAir = s.airborne
  if (s.airborne && wowAny) {
    s.airborne = false
    s.touchdownVs = d.vs
    event(s, 'touchdown', d.vs)
    const fps = -d.vs / 60
    if (fps > 20) crash(s, 'hard')
    else if (fps > 10) event(s, 'hardLanding', d.vs)
    if (!d.onRunway && d.gs > 40) event(s, 'offRunway')
  } else if (!s.airborne && !wowAny && s.pos.y > AC.cgLayout.y + 0.5) {
    s.airborne = true
    s.everAirborne = true
    event(s, 'liftoff', d.ias)
  }
  if (wasAir && s.airborne && d.vs > 300 && d.ra > 35 && d.ra < 400) event(s, 'positiveClimb')
  if (!s.airborne && d.gs < 1 && s.everAirborne) event(s, 'stopped')
  if (d.ias > (d.confId === '0' ? 350 : d.vfe) + 4 && s.airborne) event(s, d.confId === '0' ? 'overspeed' : 'vfe')
  if (!s.airborne && !d.onRunway && d.gs > 30) event(s, 'offRunway')
  s.t += dt
}

function crash(s: Sim, why: string) {
  if (s.crashed) return
  s.crashed = why
  s.vel.set(0, 0, 0); s.w.set(0, 0, 0)
  event(s, 'crash')
}

/** advance by `seconds` in fixed steps (used by the render loop and by tests) */
export function advance(s: Sim, seconds: number) {
  let n = Math.round(seconds / H)
  while (n-- > 0) step(s, H)
}
