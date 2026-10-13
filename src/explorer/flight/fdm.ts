import * as THREE from 'three'
import { DEST_X, RWY_LEN, RWY_W, AIRPORTS, surfaceAt } from './airports'

/*
 * Flight dynamics model — rigid body, 6 degrees of freedom, for any aircraft described by a Spec.
 *
 * Nothing here is scripted: the aircraft moves only because of forces and moments —
 * aerodynamics (coefficients vs α, β, rates, control surfaces, flaps, ground effect), engine thrust,
 * gravity and three spring–damper landing-gear struts with tyre friction. The pilot's inputs go through
 * a fly-by-wire control law (Normal law with protections, or Direct law) to actuators with rate limits.
 * Mistakes have consequences: limits are enforced by damage — jammed or torn flaps, a stuck or collapsed
 * gear leg, an overstressed or failed structure, a struck tail or engine, flame-out when the fuel runs out.
 *
 * Frames
 *   world: x along the runway, y up, z to the right when looking down the runway (+x)
 *   body : x to the nose, y up through the roof, z out of the right wing; origin at the centre of gravity
 * Rates: p = roll (ω.x, right wing down +), q = pitch (ω.z, nose up +), r = yaw (−ω.y, nose right +).
 *
 * Numbers are representative, not certified data.
 */

export const DEG = Math.PI / 180
export const KT = 0.514444
export const FT = 0.3048
export const G = 9.80665
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const approach = (v: number, target: number, rate: number, dt: number) => v + clamp(target - v, -rate * dt, rate * dt)
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/* ------------------------------------------------------------------ aircraft description */
export interface Conf { id: string; slat: number; flap: number; cl0: number; as: number; cd: number; cm: number; vfe: number }
export interface Spec {
  id: 'a320' | 'strizh'
  oew: number; payload: number; fuelMax: number; fuelStart: number // kg
  refMass: number // the struts and inertia are sized for this mass
  S: number; b: number; c: number; iw: number; CLA: number; CD0: number; CDgear: number; e: number
  I: THREE.Vector3 // body x (roll), y (yaw), z (pitch) at refMass
  tMax: number; eng: THREE.Vector3[]; ffScale: number; revFrac: number
  cgLayout: THREE.Vector3 // CG in the drawing frame (ground at y = 0 with static struts)
  confs: Conf[]
  vmo: number; mmo: number; vle: number; vlo: number; nzMax: number; nzMaxFlaps: number
  noseGear: THREE.Vector3; mainGear: THREE.Vector3 // drawing frame, wheel contact with static struts (main: right leg)
  hard: { id: string; kind: ContactKind; p: THREE.Vector3 }[]
  wingY: number // height of the wing above the CG (for ground effect)
  Cm0: number; CmA: number; CmE: number; CmT: number; CmQ: number
  Cla: number; ClP: number; Cnr: number; Cnb: number; Cnd: number
}

export const A320: Spec = {
  id: 'a320', oew: 42600, payload: 13500, fuelMax: 18700, fuelStart: 8000, refMass: 64000,
  S: 122.6, b: 34.1, c: 4.19, iw: 2 * DEG, CLA: 5.6, CD0: 0.0215, CDgear: 0.018, e: 0.78,
  I: V3(1.35e6, 4.3e6, 3.1e6),
  tMax: 120000, eng: [V3(2.5, -1.2, -5.75), V3(2.5, -1.2, 5.75)], ffScale: 1, revFrac: 0.32,
  cgLayout: V3(-0.63, 3.0, 0),
  confs: [
    { id: '0', slat: 0, flap: 0, cl0: 0.2, as: 13, cd: 0, cm: 0, vfe: 350 },
    { id: '1', slat: 18, flap: 0, cl0: 0.36, as: 17, cd: 0.004, cm: -0.008, vfe: 230 },
    { id: '1+F', slat: 18, flap: 10, cl0: 0.62, as: 16, cd: 0.012, cm: -0.035, vfe: 215 },
    { id: '2', slat: 22, flap: 15, cl0: 0.8, as: 16, cd: 0.022, cm: -0.05, vfe: 200 },
    { id: '3', slat: 22, flap: 20, cl0: 0.92, as: 16, cd: 0.032, cm: -0.065, vfe: 185 },
    { id: 'FULL', slat: 27, flap: 40, cl0: 1.1, as: 17.5, cd: 0.068, cm: -0.11, vfe: 177 },
  ],
  vmo: 350, mmo: 0.82, vle: 280, vlo: 250, nzMax: 2.5, nzMaxFlaps: 2.0,
  noseGear: V3(11.0, 0, 0), mainGear: V3(-1.64, 0, 3.795),
  hard: [
    { id: 'tail', kind: 'tail', p: V3(-13.0, 2.35, 0) },
    { id: 'engL', kind: 'engine', p: V3(1.9, 0.55, -5.75) }, { id: 'engR', kind: 'engine', p: V3(1.9, 0.55, 5.75) },
    { id: 'tipL', kind: 'wingtip', p: V3(-4.4, 3.4, -16.9) }, { id: 'tipR', kind: 'wingtip', p: V3(-4.4, 3.4, 16.9) },
    { id: 'bellyF', kind: 'belly', p: V3(9.0, 1.4, 0) }, { id: 'bellyA', kind: 'belly', p: V3(-3.0, 1.33, 0) },
  ],
  wingY: -0.6,
  Cm0: 0.05, CmA: -1.35, CmE: 1.2, CmT: 2.5, CmQ: -28,
  Cla: 0.11, ClP: -0.46, Cnr: -0.2, Cnb: 0.13, Cnd: 0.09,
}
/** kept for components written against the A320 only */
export const AC = { ...A320, mass: A320.refMass }
export const CONFS = A320.confs
export const LEVER = ['0', '1', '2', '3', 'FULL'] as const

export function confAt(f: number, confs: Conf[] = A320.confs) {
  const i = clamp(Math.floor(f), 0, confs.length - 1), j = Math.min(confs.length - 1, i + 1), k = clamp(f - i, 0, 1)
  const a = confs[i], b = confs[j], L = (p: number, q: number) => p + (q - p) * k
  return { slat: L(a.slat, b.slat), flap: L(a.flap, b.flap), cl0: L(a.cl0, b.cl0), as: L(a.as, b.as) * DEG, cd: L(a.cd, b.cd), cm: L(a.cm, b.cm), vfe: L(a.vfe, b.vfe) }
}

/* ------------------------------------------------------------------ runways & ground */
export const RWY = { len: RWY_LEN, width: RWY_W }
export const DEST = DEST_X
export const GS_ANGLE = 3 * DEG
export const AIM = DEST + 300 // glide-slope origin / aiming point
export function onRunway(x: number, z: number) { return surfaceAt(x, z) === 'runway' }

/* ------------------------------------------------------------------ contact points (body frame) */
export type ContactKind = 'nose' | 'main' | 'tail' | 'engine' | 'wingtip' | 'belly'
interface Contact { id: string; kind: ContactKind; r: THREE.Vector3; k: number; c: number; leg: number }
export const STATIC_STROKE = 0.22
function contactsOf(sp: Spec) {
  const W = sp.refMass * G
  const L = (p: THREE.Vector3, dy = 0) => p.clone().add(V3(0, dy, 0)).sub(sp.cgLayout)
  // share of weight on the nose leg from the geometry (CG between nose and mains)
  const noseShare = (sp.cgLayout.x - sp.mainGear.x) / (sp.noseGear.x - sp.mainGear.x)
  const gear: Contact[] = [
    { id: 'nose', kind: 'nose', r: L(sp.noseGear, -STATIC_STROKE), k: (noseShare * W) / STATIC_STROKE, c: 4.6e4, leg: 0 },
    { id: 'mainL', kind: 'main', r: L(V3(sp.mainGear.x, 0, -sp.mainGear.z), -STATIC_STROKE), k: (((1 - noseShare) / 2) * W) / STATIC_STROKE, c: 2.4e5, leg: 1 },
    { id: 'mainR', kind: 'main', r: L(sp.mainGear, -STATIC_STROKE), k: (((1 - noseShare) / 2) * W) / STATIC_STROKE, c: 2.4e5, leg: 2 },
  ]
  const hard: Contact[] = sp.hard.map((h) => ({ id: h.id, kind: h.kind, r: L(h.p), k: 4e6, c: 4e5, leg: -1 }))
  return { gear, hard, static: gear.map((g) => g.k * STATIC_STROKE) }
}

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
  parkBrake: boolean
  master: [boolean, boolean] // engine master switches
  push: boolean // pushback tug connected
  law: Law
  trim: -1 | 0 | 1 // manual pitch trim (direct law)
}
export interface Surfaces {
  elev: number; ail: number; rud: number; ths: number
  splL: number; splR: number; gndSpl: number
  conf: number; confTarget: number
  gear: number // 0 up … 1 down & locked
  steer: number // nose wheel angle rad
}
export type EngState = 'off' | 'starting' | 'run' | 'failed'
export interface Engine { state: EngState; n1: number; egt: number; tStart: number; why?: string }
export interface Damage {
  flaps: 0 | 1 | 2 // ok / jammed / torn on one side
  flapSide: 1 | -1
  gearStuck: boolean
  legs: [boolean, boolean, boolean] // collapsed: nose, left, right
  structure: number // 0 … 1 (1 = failed)
  tail: boolean
  belly: boolean
}
export interface Derived {
  V: number; tas: number; ias: number; gs: number; mach: number; rho: number; qbar: number
  alpha: number; beta: number; gamma: number; theta: number; phi: number; psi: number
  p: number; q: number; r: number; nz: number; vs: number; alt: number; ra: number
  lift: number; drag: number; thrust: [number, number]; weight: number; mass: number
  egt: [number, number]; ff: [number, number]
  wow: boolean; mainsOn: boolean; noseOn: boolean; struts: number[]
  alphaProt: number; alphaMax: number; alphaStall: number; stall: boolean; inProt: boolean
  onRunway: boolean; surface: string; confId: string; vfe: number; vls: number; vs1g: number; flare: boolean
  decel: number; ge: number
  stand: { id: string; airport: string; dist: number; lat: number } | null
}
export type SimEvent =
  | 'liftoff' | 'touchdown' | 'hardLanding' | 'tailstrike' | 'crash' | 'stall' | 'alphaProt' | 'alphaFloor' | 'bankLimit'
  | 'gearUp' | 'gearDown' | 'flaps' | 'groundSpoilers' | 'reverse' | 'stopped' | 'vfe' | 'overspeed' | 'offRunway' | 'flare' | 'v1' | 'vr' | 'positiveClimb'
  | 'flapJam' | 'flapTorn' | 'gearDamage' | 'gearCollapse' | 'overstress' | 'engineStart' | 'engineRun' | 'engineFail' | 'engineStrike' | 'flameout'
  | 'fuelLow' | 'toConfig' | 'parkBrakeOn' | 'bellyLanding' | 'parked' | 'pushback' | 'grass'
export interface Sim {
  spec: Spec
  t: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  quat: THREE.Quaternion
  w: THREE.Vector3
  n1: [number, number]
  eng: [Engine, Engine]
  fuel: number
  ctl: Controls
  srf: Surfaces
  dmg: Damage
  fbw: { blend: number; qInt: number; pInt: number; holdG: boolean; gammaRef: number; holdP: boolean; phiRef: number; alphaFloor: boolean; floorLever: number; flareTheta: number; flareT: number; abBrake: number; abActive: boolean; overT: number; jamT: number }
  d: Derived
  airborne: boolean
  everAirborne: boolean
  crashed: string | null
  arrived: boolean
  touchdownVs: number | null
  maxNz: number
  fuelUsed: number
  events: { t: number; e: SimEvent; v?: number }[]
  flags: Record<string, boolean>
}

export function defaultControls(): Controls {
  return { stickX: 0, stickY: 0, pedal: 0, lever: 0, rev: 0, flapLever: 0, gearDown: true, speedbrake: 0, spoilersArmed: false, autobrake: 0, brake: 0, parkBrake: false, master: [true, true], push: false, law: 'normal', trim: 0 }
}

export type Start = 'gate' | 'runway' | 'approach' | 'cruise'
export function createSim(start: Start = 'runway', spec: Spec = A320): Sim {
  const run = (): Engine => ({ state: 'run', n1: 19.5, egt: 420, tStart: 0 })
  const s: Sim = {
    spec, t: 0, pos: V3(80, spec.cgLayout.y, 0), vel: V3(0, 0, 0), quat: new THREE.Quaternion(), w: V3(0, 0, 0),
    n1: [19.5, 19.5], eng: [run(), run()], fuel: spec.fuelStart, ctl: defaultControls(),
    srf: { elev: 0, ail: 0, rud: 0, ths: 0, splL: 0, splR: 0, gndSpl: 0, conf: 0, confTarget: 0, gear: 1, steer: 0 },
    dmg: { flaps: 0, flapSide: 1, gearStuck: false, legs: [false, false, false], structure: 0, tail: false, belly: false },
    fbw: { blend: 0, qInt: 0, pInt: 0, holdG: false, gammaRef: 0, holdP: false, phiRef: 0, alphaFloor: false, floorLever: 0, flareTheta: 0, flareT: 0, abBrake: 0, abActive: false, overT: 0, jamT: 0 },
    d: {} as Derived, airborne: false, everAirborne: false, crashed: null, arrived: false, touchdownVs: null, maxNz: 1, fuelUsed: 0, events: [], flags: {},
  }
  if (start === 'gate') {
    // cold aircraft at stand 2 of the departure airport: engines off, parking brake set, nose to the terminal
    const st = AIRPORTS[0].stands[1]
    s.pos.set(st.x, spec.cgLayout.y, st.z)
    s.quat.setFromAxisAngle(V3(0, 1, 0), -st.heading)
    s.eng = [{ state: 'off', n1: 0, egt: 25, tStart: 0 }, { state: 'off', n1: 0, egt: 25, tStart: 0 }]
    s.n1 = [0, 0]
    Object.assign(s.ctl, { master: [false, false], parkBrake: true })
  } else if (start === 'approach') {
    // 7 NM final, on the 3° glide path, configuration 3, gear down, ~150 kt
    const dist = 7 * 1852, alt = Math.tan(GS_ANGLE) * dist + 15
    const V = 150 * KT, gam = -GS_ANGLE, th = 3.2 * DEG
    s.pos.set(AIM - dist, alt, 0)
    s.vel.set(Math.cos(gam) * V, Math.sin(gam) * V, 0)
    s.quat.setFromEuler(new THREE.Euler(0, 0, th, 'YZX'))
    Object.assign(s.ctl, { flapLever: 3, gearDown: true, lever: 0.42, spoilersArmed: true, autobrake: 1 })
    Object.assign(s.srf, { conf: 4, confTarget: 4, gear: 1, ths: 3.8 * DEG })
    s.n1 = [55, 55]; s.eng.forEach((e) => { e.n1 = 55 }); s.fuel = 3500; s.airborne = true; s.everAirborne = true; s.fbw.blend = 1
  } else if (start === 'cruise') {
    const V = 250 * KT * 1.16, th = 2.2 * DEG
    s.pos.set(9000, 3000, 0)
    s.vel.set(V, 0, 0)
    s.quat.setFromEuler(new THREE.Euler(0, 0, th, 'YZX'))
    Object.assign(s.ctl, { flapLever: 0, gearDown: false, lever: 0.55 })
    Object.assign(s.srf, { conf: 0, confTarget: 0, gear: 0, ths: 0.9 * DEG })
    s.n1 = [72, 72]; s.eng.forEach((e) => { e.n1 = 72 }); s.fuel = 6500; s.airborne = true; s.everAirborne = true; s.fbw.blend = 1
  }
  s.flags.gearLever = s.ctl.gearDown
  derive(s, 0)
  return s
}
export const massOf = (s: Sim) => s.spec.oew + s.spec.payload + s.fuel

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
function thrustOf(sp: Spec, n1: number, rev: boolean, sigma: number, mach: number) {
  if (n1 < 12) return 0
  const f = clamp((n1 - N1_IDLE_GND) / (96 - N1_IDLE_GND), 0, 1)
  const lapse = Math.pow(sigma, 0.8) * (1 - 0.4 * mach + 0.18 * mach * mach)
  const sub = clamp((n1 - 12) / (N1_IDLE_GND - 12), 0, 1) // below idle (spooling up during start) thrust is tiny
  if (rev) return -sp.tMax * sp.revFrac * Math.pow(clamp((n1 - N1_IDLE_GND) / (N1_MAXREV - N1_IDLE_GND), 0, 1), 1.4) * lapse
  return sp.tMax * (0.035 * sub + 0.965 * Math.pow(f, 1.7)) * lapse
}

/* ------------------------------------------------------------------ temporaries */
const _vb = V3(0, 0, 0), _f = V3(0, 0, 0), _m = V3(0, 0, 0), _tmp = V3(0, 0, 0), _tmp2 = V3(0, 0, 0)
const _qi = new THREE.Quaternion(), _pw = V3(0, 0, 0), _vp = V3(0, 0, 0), _roll = V3(0, 0, 0), _lat = V3(0, 0, 0)
const _fw = V3(0, 0, 0), _iw = V3(0, 0, 0), _dq = new THREE.Quaternion(), _fwd = V3(0, 0, 0)
const UP = V3(0, 1, 0)
const CONTACTS = new Map<string, ReturnType<typeof contactsOf>>()
const contacts = (sp: Spec) => { let c = CONTACTS.get(sp.id); if (!c) { c = contactsOf(sp); CONTACTS.set(sp.id, c) } return c }

export function event(s: Sim, e: SimEvent, v?: number) {
  // the same event within a few seconds is one event
  // (for per-engine / per-leg events the value says which one, so those are compared too)
  const byIndex = e === 'engineStart' || e === 'engineRun' || e === 'flameout' || e === 'engineStrike' || e === 'gearCollapse' || e === 'flaps' || e === 'engineFail'
  for (let i = s.events.length - 1; i >= 0 && s.t - s.events[i].t < 4; i--) if (s.events[i].e === e && (!byIndex || s.events[i].v === v)) return
  s.events.push({ t: s.t, e, v })
  if (s.events.length > 80) s.events.shift()
}

/* ------------------------------------------------------------------ derived quantities */
function derive(s: Sim, dt: number) {
  const d = s.d, sp = s.spec
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
  const upy = V3(0, 1, 0).applyQuaternion(s.quat).y
  d.theta = Math.asin(clamp(fwd.y, -1, 1))
  d.psi = Math.atan2(fwd.z, fwd.x)
  d.phi = Math.atan2(-right.y, upy)
  d.p = s.w.x; d.q = s.w.z; d.r = -s.w.y
  d.vs = (s.vel.y / FT) * 60
  d.alt = s.pos.y / FT
  d.ra = Math.max(0, (s.pos.y - sp.cgLayout.y) / FT)
  const conf = confAt(s.srf.conf, sp.confs)
  d.confId = sp.confs[Math.round(s.srf.conf)].id
  d.vfe = conf.vfe
  d.alphaStall = conf.as - sp.iw
  d.alphaProt = d.alphaStall - 2.8 * DEG
  d.alphaMax = d.alphaStall - 0.8 * DEG
  d.mass = massOf(s)
  d.weight = d.mass * G
  const clmax = conf.cl0 + sp.CLA * conf.as
  d.vs1g = Math.sqrt((2 * d.weight) / (1.225 * sp.S * clmax)) / KT
  d.vls = d.vs1g * (s.srf.conf < 0.5 ? 1.28 : 1.23)
  d.surface = surfaceAt(s.pos.x, s.pos.z)
  d.onRunway = d.surface === 'runway'
  // nearest stand (docking guidance)
  let best: Derived['stand'] = null
  for (const ap of AIRPORTS) for (const st of ap.stands) {
    const dx = st.x - s.pos.x, dz = st.z - s.pos.z
    if (Math.hypot(dx, dz) > 140) continue
    const hx = Math.cos(st.heading), hz = Math.sin(st.heading)
    const along = dx * hx + dz * hz, lat = -dx * hz + dz * hx
    if (!best || Math.abs(along) + Math.abs(lat) < Math.abs(best.dist) + Math.abs(best.lat)) best = { id: st.id, airport: ap.id, dist: along, lat }
  }
  d.stand = best
  if (dt === 0) {
    d.lift = 0; d.drag = 0; d.thrust = [0, 0]; d.egt = [s.eng[0].egt, s.eng[1].egt]; d.ff = [0, 0]; d.nz = 1; d.wow = !s.airborne; d.mainsOn = d.wow; d.noseOn = d.wow
    d.struts = [STATIC_STROKE * 0.6, STATIC_STROKE * 0.6, STATIC_STROKE * 0.6]; d.stall = false; d.inProt = false; d.flare = false; d.decel = 0; d.ge = 1
  }
}

/* ------------------------------------------------------------------ fly-by-wire */
function flyByWire(s: Sim, dt: number) {
  const c = s.ctl, d = s.d, f = s.fbw, r = s.srf, sp = s.spec
  const V = Math.max(d.V, 30), gn = G / V
  const qref = 3500 * (d.mass / sp.refMass), sched = clamp(qref / Math.max(d.qbar, 300), 0.25, 4)
  // ground → flight mode blending (A320: direct "ground law" on the runway, normal law in the air)
  f.blend = approach(f.blend, s.airborne ? 1 : 0, 0.35, dt)

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
      gdot = (sy > 0 ? 1.2 : 1.6) * sy * gn // stick = load-factor demand
    }
    const phiC = clamp(d.phi, -33 * DEG, 33 * DEG)
    const qTurn = gn * Math.sin(d.phi) * Math.tan(phiC)
    let qCmd = gdot * Math.cos(d.phi) + qTurn
    // load-factor protection: +2.5 g / −1 g clean, +2 g / 0 g with flaps
    const flapsOut = s.srf.conf > 0.5
    const nzMax = flapsOut ? sp.nzMaxFlaps : sp.nzMax, nzMin = flapsOut ? 0 : -1
    if (s.airborne) {
      qCmd = Math.min(qCmd, (nzMax - 1) * gn + qTurn - 1.5 * Math.max(0, d.nz - nzMax + 0.1) * gn)
      qCmd = Math.max(qCmd, (nzMin - 1) * gn + qTurn + 1.5 * Math.max(0, nzMin + 0.1 - d.nz) * gn)
    }
    // α-protection: above α-prot the stick commands angle of attack, never beyond α-max
    const prot = d.alpha > d.alphaProt - 0.6 * DEG && s.airborne
    if (prot) {
      const aCmd = d.alphaProt + Math.max(0, sy) * (d.alphaMax - d.alphaProt)
      qCmd = Math.min(qCmd, 1.1 * (aCmd - d.alpha))
      if (!d.inProt && d.alpha > d.alphaProt) event(s, 'alphaProt')
    }
    d.inProt = prot && d.alpha > d.alphaProt - 0.2 * DEG
    // α-floor: automatic TOGA thrust when α keeps rising inside the protection
    if (s.airborne && d.ra > 100 && d.alpha > d.alphaProt + 0.5 * (d.alphaMax - d.alphaProt) && !f.alphaFloor) {
      f.alphaFloor = true; f.floorLever = c.lever; event(s, 'alphaFloor')
    }
    if (f.alphaFloor && Math.abs(c.lever - f.floorLever) > 0.05) f.alphaFloor = false
    // pitch-attitude protection +30° / −15°
    qCmd = Math.min(qCmd, 0.8 * (30 * DEG - d.theta))
    qCmd = Math.max(qCmd, 0.8 * (-15 * DEG - d.theta))
    // high-speed protection: gentle nose-up above VMO + 6 kt
    if (d.ias > sp.vmo + 6) qCmd += 0.004 * (d.ias - sp.vmo - 6)
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
    const b = prot ? 1 : f.blend
    elevCmd = direct * (1 - b) + normal * b
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
  r.ail = approach(r.ail, clamp(ailCmd, -25 * DEG, 25 * DEG), 60 * DEG, dt)

  /* ---------- yaw: pedals + yaw damper + turn coordination */
  const maxRud = clamp(25 - (d.ias - 160) * 0.098, 3.5, 25) * DEG
  let rudCmd = c.pedal * maxRud
  if (c.law === 'normal' && s.airborne) {
    const rTurn = gn * Math.sin(d.phi) * Math.cos(d.theta)
    rudCmd += (-0.9 * (d.r - rTurn) + 1.4 * d.beta) * f.blend
  }
  r.rud = approach(r.rud, clamp(rudCmd, -maxRud, maxRud), 40 * DEG, dt)
  // nose-wheel steering: tiller authority at taxi speed, pedals only (±6°) at speed, up to 75° when towed
  const steerMax = c.push ? 75 : d.gs < 12 ? 70 : d.gs < 30 ? 30 : 6
  r.steer = approach(r.steer, (s.dmg.legs[0] ? 0 : c.pedal) * steerMax * DEG, 25 * DEG, dt)
}

/* ------------------------------------------------------------------ systems: flaps, gear, spoilers, brakes, engines, damage */
function systems(s: Sim, dt: number) {
  const c = s.ctl, r = s.srf, d = s.d, sp = s.spec, dm = s.dmg, f = s.fbw
  /* flaps: lever 1 gives 1+F on the ground / at low speed, auto-retracts to 1 above 210 kt */
  let tgt = [0, 1, 3, 4, 5][clamp(Math.round(c.flapLever), 0, 4)]
  if (c.flapLever === 1) {
    const was1F = r.confTarget === 2
    tgt = !s.airborne || (was1F && d.ias < 210) ? 2 : 1
  }
  if (dm.flaps === 0) {
    if (tgt !== r.confTarget) { r.confTarget = tgt; event(s, 'flaps', tgt) }
    r.conf = approach(r.conf, r.confTarget, 0.14, dt)
  }
  // flaps beyond their placard speed: first the actuators jam, much faster and a panel tears away
  if (r.conf > 0.3 && s.airborne) {
    const over = d.ias - d.vfe
    if (over > 35 && dm.flaps < 2) { dm.flaps = 2; dm.flapSide = s.t % 2 < 1 ? 1 : -1; event(s, 'flapTorn') }
    else if (over > 12) { f.jamT += dt; if (f.jamT > 2.5 && dm.flaps === 0) { dm.flaps = 1; event(s, 'flapJam') } }
    else f.jamT = Math.max(0, f.jamT - dt)
  }

  /* landing gear: hydraulic retraction, interlocked by weight on wheels; limited by speed */
  if (!c.gearDown && d.wow) c.gearDown = true
  if (dm.gearStuck) c.gearDown = true
  const gearTgt = c.gearDown ? 1 : 0
  if (s.flags.gearLever !== c.gearDown) {
    event(s, gearTgt ? 'gearDown' : 'gearUp')
    if (d.ias > sp.vlo + 15 && s.airborne) { dm.gearStuck = true; c.gearDown = true; event(s, 'gearDamage') } // operated too fast: doors torn
    s.flags.gearLever = c.gearDown
  }
  if (r.gear > 0.05 && d.ias > sp.vle + 20 && s.airborne && !dm.gearStuck) { dm.gearStuck = true; c.gearDown = true; event(s, 'gearDamage') }
  r.gear = approach(r.gear, gearTgt, 1 / 9, dt)

  /* ground spoilers: armed + both mains on the ground + levers at idle (or reverse) */
  const gndCond = d.mainsOn && (c.lever < 0.05 || c.rev > 0) && d.gs > 40
  const deploy = (c.spoilersArmed || c.rev > 0) && gndCond
  if (deploy && r.gndSpl < 0.05) event(s, 'groundSpoilers')
  r.gndSpl = approach(r.gndSpl, deploy || (r.gndSpl > 0.5 && d.mainsOn && c.lever < 0.05 && d.gs > 5) ? 1 : 0, 1.5, dt)
  const sb = s.airborne ? c.speedbrake * (d.inProt ? 0 : 1) : c.speedbrake * 0.5
  const roll = clamp((Math.abs(r.ail) / (25 * DEG) - 0.25) / 0.75, 0, 1)
  r.splL = approach(r.splL, clamp(Math.max(r.gndSpl, sb * 0.6 + (r.ail < 0 ? roll : 0)), 0, 1), 1.4, dt)
  r.splR = approach(r.splR, clamp(Math.max(r.gndSpl, sb * 0.6 + (r.ail > 0 ? roll : 0)), 0, 1), 1.4, dt)
  if (c.rev > 0 && (!d.mainsOn || c.lever > 0.05)) c.rev = 0

  /* autobrake */
  if (c.autobrake && r.gndSpl > 0.8 && d.gs > 5) f.abActive = true
  if (c.brake > 0.3 || d.gs < 3 || c.lever > 0.1) f.abActive = false
  if (f.abActive) f.abBrake = clamp(f.abBrake + ((c.autobrake === 2 ? 3.0 : 1.7) - d.decel) * 0.6 * dt, 0, 1)
  else f.abBrake = approach(f.abBrake, 0, 2, dt)

  /* take-off configuration check, like the real "T.O CONFIG" warning when take-off thrust is set */
  if (!s.everAirborne && !s.airborne && c.lever > 0.8 && !s.flags.toCfg) {
    s.flags.toCfg = true
    const bad = r.confTarget < 2 || r.confTarget > 4 || c.speedbrake > 0.05 || c.parkBrake || dm.flaps > 0
    if (bad) event(s, 'toConfig')
  }
  if (c.lever < 0.5) s.flags.toCfg = false

  /* structure: limit load and ultimate load (1.5 × limit), dive speed */
  const nzLim = r.conf > 0.5 ? sp.nzMaxFlaps : sp.nzMax
  if (s.airborne && (d.nz > nzLim + 0.15 || d.nz < -1.15)) {
    dm.structure = Math.min(1, dm.structure + dt * Math.max(0, Math.abs(d.nz) - nzLim) * 0.4)
    event(s, 'overstress', d.nz)
  }
  if (d.nz > nzLim * 1.5 || d.nz < -1.5 * 1.5 || dm.structure >= 1) crash(s, 'structure')
  if (d.ias > sp.vmo + 45 || d.mach > sp.mmo + 0.07) crash(s, 'flutter')

  /* fuel */
  const burn = ((d.ff[0] + d.ff[1]) / 3600) * dt
  s.fuel = Math.max(0, s.fuel - burn); s.fuelUsed += burn
  if (s.fuel < 1000 && !s.flags.fuelLow) { s.flags.fuelLow = true; event(s, 'fuelLow') }

  /* pushback and parking brake */
  if (c.push && (d.gs > 6 || s.airborne || c.lever > 0.2)) c.push = false
  if (c.push && !s.flags.push) event(s, 'pushback')
  s.flags.push = c.push
}

/* ------------------------------------------------------------------ one physics step */
export const H = 1 / 240
export function step(s: Sim, dt = H) {
  if (s.crashed) return
  const c = s.ctl, r = s.srf, d = s.d, sp = s.spec, dm = s.dmg
  derive(s, dt)
  flyByWire(s, dt)
  systems(s, dt)
  const mass = d.mass, W = d.weight, ms = mass / sp.refMass

  _f.set(0, 0, 0); _m.set(0, 0, 0)
  _qi.copy(s.quat).invert()
  _vb.copy(s.vel).applyQuaternion(_qi)
  const V = d.V
  const conf = confAt(r.conf, sp.confs)

  /* ---------- aerodynamics */
  const hw = Math.max(0.5, s.pos.y + sp.wingY)
  const g16 = (16 * hw) / sp.b, phiGe = (g16 * g16) / (1 + g16 * g16)
  d.ge = phiGe
  let lift = 0, drag = 0
  if (V > 1) {
    const qS = d.qbar * sp.S
    const aw = d.alpha + sp.iw
    const qh = (d.q * sp.c) / (2 * V), ph = (d.p * sp.b) / (2 * V), rh = (d.r * sp.b) / (2 * V)
    // a torn flap removes half of the flap lift increment and rolls the aircraft toward the good side's opposite
    const flapLoss = dm.flaps === 2 ? 0.5 * Math.max(0, conf.cl0 - sp.confs[0].cl0) : 0
    const cl0 = conf.cl0 - flapLoss
    const clmax = cl0 + sp.CLA * conf.as
    let CL: number, stall = 0
    if (aw <= conf.as) CL = cl0 + sp.CLA * aw
    else { const o = aw - conf.as; stall = o; CL = Math.max(clmax * 0.6, clmax - 2.2 * o - 7 * o * o) }
    if (aw < -0.25) CL = cl0 + sp.CLA * -0.25
    CL *= 1 + 0.1 * (1 - phiGe)
    CL += 0.25 * r.elev + 0.15 * r.ths + 4.5 * qh
    CL -= 0.55 * r.gndSpl + 0.14 * ((r.splL + r.splR) / 2) * (1 - r.gndSpl)
    const kInd = 1 / (Math.PI * sp.e * ((sp.b * sp.b) / sp.S))
    const CD = sp.CD0 + conf.cd + sp.CDgear * r.gear + kInd * phiGe * CL * CL + 0.05 * r.gndSpl + 0.03 * ((r.splL + r.splR) / 2) + 0.35 * d.beta * d.beta + 0.9 * stall
      + (d.mach > 0.72 ? 0.25 * (d.mach - 0.72) ** 2 : 0) + (dm.gearStuck ? 0.01 : 0) + (dm.flaps === 2 ? 0.01 : 0)
      + (s.eng[0].state !== 'run' ? 0.0015 : 0) + (s.eng[1].state !== 'run' ? 0.0015 : 0)
    const CY = -0.85 * d.beta - 0.22 * r.rud
    const Cm = sp.Cm0 + conf.cm - flapLoss * 0.1 + sp.CmA * aw + sp.CmE * r.elev + sp.CmT * r.ths + sp.CmQ * qh - 0.035 * (1 - phiGe) - 0.4 * stall + 0.012 * r.gear - 0.05 * r.gndSpl
    // in a deep stall one wing usually stalls first: the aircraft drops a wing toward the sideslip
    const wingDrop = stall > 2 * DEG ? -0.02 * Math.sign(d.beta || 1) * Math.min(1, (stall - 2 * DEG) / (4 * DEG)) : 0
    const Cl = -0.1 * d.beta + sp.ClP * ph + 0.1 * rh + sp.Cla * r.ail + 0.06 * (r.splR - r.splL) + 0.012 * r.rud + wingDrop
      + (dm.flaps === 2 ? 0.03 * dm.flapSide * Math.min(1, flapLoss / 0.3) : 0)
    const Cn = sp.Cnb * d.beta + sp.Cnr * rh - 0.035 * ph - 0.008 * r.ail + sp.Cnd * r.rud
    lift = CL * qS; drag = CD * qS
    const ca = Math.cos(d.alpha), sa = Math.sin(d.alpha)
    _f.x += lift * sa - drag * ca
    _f.y += lift * ca + drag * sa
    _f.z += CY * qS
    _m.x += Cl * qS * sp.b
    _m.y += -Cn * qS * sp.b
    _m.z += Cm * qS * sp.c
    d.stall = stall > 0
    if (stall > 0.5 * DEG && s.airborne) event(s, 'stall')
  }
  d.lift = lift; d.drag = drag

  /* ---------- engines: start, run, fail, flame-out */
  const atm = isa(s.pos.y)
  const idle = s.airborne ? N1_IDLE_FLT : N1_IDLE_GND
  const lever = s.fbw.alphaFloor ? 1 : c.lever
  const tgtRun = c.rev === 2 ? N1_MAXREV : c.rev === 1 ? N1_IDLE_GND + 6 : leverN1(lever, idle)
  const windmill = Math.min(18, d.ias * 0.07) // an unpowered fan still turns in the airflow
  for (let i = 0; i < 2; i++) {
    const e = s.eng[i]
    const master = c.master[i]
    if (e.state === 'off' && master && s.fuel > 0) { e.state = 'starting'; e.tStart = s.t; event(s, 'engineStart', i + 1) }
    if ((e.state === 'run' || e.state === 'starting') && !master) e.state = 'off'
    if ((e.state === 'run' || e.state === 'starting') && s.fuel <= 0) { e.state = 'failed'; e.why = 'fuel'; event(s, 'flameout', i + 1) }
    if (e.state === 'failed' && !master && s.fuel > 0 && e.why === 'fuel') e.state = 'off'
    let tgt: number, k: number
    if (e.state === 'run') { tgt = tgtRun; k = tgt > e.n1 ? (e.n1 < 50 ? 0.2 : 0.5) : 0.45 }
    else if (e.state === 'starting') {
      // air starter spins the core; fuel and ignition at ≈ 6 s; self-sustaining by ≈ 18 s
      const ts = s.t - e.tStart
      tgt = ts < 6 ? 6 : N1_IDLE_GND + 0.5; k = ts < 6 ? 0.5 : 0.18
      if (e.n1 > N1_IDLE_GND - 0.3) { e.state = 'run'; event(s, 'engineRun', i + 1) }
    } else { tgt = windmill; k = 0.12 }
    e.n1 += (tgt - e.n1) * Math.min(1, k * dt)
    s.n1[i] = e.n1
    const running = e.state === 'run'
    const T = running || (e.state === 'starting' && s.t - e.tStart > 6) ? thrustOf(sp, e.n1, running && c.rev > 0, atm.sigma, d.mach) : 0
    d.thrust[i] = T
    const fT = clamp((e.n1 - N1_IDLE_GND) / (96 - N1_IDLE_GND), 0, 1)
    const lit = running || (e.state === 'starting' && s.t - e.tStart > 6)
    const egtT = lit ? 420 + 430 * fT + (e.state === 'starting' ? 260 * Math.exp(-((s.t - e.tStart - 9) ** 2) / 6) : 0) : 25 + Math.max(0, e.egt - 25) * 0.995
    e.egt += (egtT - e.egt) * Math.min(1, dt * 0.8)
    d.egt[i] = e.egt
    d.ff[i] = lit ? (300 + 2700 * Math.pow(fT, 1.4)) * sp.ffScale * Math.max(0.55, atm.sigma ** 0.5) : 0
    _tmp.set(T, 0, 0)
    _f.add(_tmp)
    _m.add(_tmp2.copy(sp.eng[i]).cross(_tmp))
  }
  if (c.rev > 0 && !s.flags.rev) event(s, 'reverse')
  s.flags.rev = c.rev > 0

  /* ---------- gravity (world) → body */
  _tmp.set(0, -W, 0).applyQuaternion(_qi)
  _f.add(_tmp)

  /* ---------- landing gear & hard points */
  const C = contacts(sp)
  let mainsOn = 0, noseOn = false, wowAny = false
  const brake = Math.max(c.brake, s.fbw.abBrake, c.parkBrake ? 1 : 0)
  _fwd.set(1, 0, 0).applyQuaternion(s.quat)
  _roll.copy(_fwd); _roll.y = 0; _roll.normalize()
  d.struts = [0, 0, 0]
  const list = r.gear > 0.99 ? [...C.gear.filter((g) => !dm.legs[g.leg]), ...C.hard] : C.hard
  for (const ct of list) {
    _pw.copy(ct.r).applyQuaternion(s.quat).add(s.pos)
    const pen = -_pw.y
    if (ct.leg >= 0) d.struts[ct.leg] = clamp(STATIC_STROKE * 1.6 - Math.max(0, pen), 0, STATIC_STROKE * 1.6)
    if (pen <= 0) continue
    _vp.copy(s.w).cross(ct.r).applyQuaternion(s.quat).add(s.vel)
    let N = ct.k * ms * pen - ct.c * ms * _vp.y
    if (N < 0) N = 0
    const isWheel = ct.kind === 'nose' || ct.kind === 'main'
    if (ct.kind === 'nose') _tmp.copy(_roll).applyAxisAngle(UP, -r.steer)
    else _tmp.copy(_roll)
    _lat.copy(_tmp).cross(UP).negate()
    const vRoll = _vp.dot(_tmp), vLat = _vp.dot(_lat)
    const surf = surfaceAt(_pw.x, _pw.z)
    let mu = 0.5, muLat = 0.5
    if (isWheel) {
      mu = 0.015 + (ct.kind === 'main' ? 0.45 * brake : 0)
      muLat = 0.75
      if (surf === 'grass') { mu += 0.08; muLat = 0.45 }
      // structural limits of a leg: vertical overload or a big side load (landing in a crab)
      const lim = C.static[ct.leg] * (ct.kind === 'nose' ? 3.0 : 3.4) * ms
      if (N > lim || (Math.abs(vLat) > 5 && N > C.static[ct.leg] * 0.8) || (surf === 'grass' && d.gs > 70 && ct.kind === 'nose')) {
        dm.legs[ct.leg] = true; event(s, 'gearCollapse', ct.leg)
        continue
      }
    } else {
      mu = 0.4; muLat = 0.4
    }
    let Fr = -mu * N * Math.tanh(vRoll / 0.3)
    const Fl = -muLat * N * Math.tanh(vLat / 0.2)
    // pushback tug on the nose gear: pushes backwards at walking pace, steering the nose wheel
    if (ct.kind === 'nose' && c.push) Fr += clamp((-1.3 - vRoll) * 40000, -30000, 30000)
    _fw.set(0, N, 0).addScaledVector(_tmp, Fr).addScaledVector(_lat, Fl)
    _tmp.copy(_fw).applyQuaternion(_qi)
    _f.add(_tmp)
    _m.add(_tmp2.copy(ct.r).cross(_tmp))
    if (isWheel) { wowAny = true; if (ct.kind === 'main') mainsOn++; else noseOn = true }
    else {
      const vy = Math.abs(_vp.y), fast = d.gs > 60
      if (ct.kind === 'tail') { if (!dm.tail) { dm.tail = true; event(s, 'tailstrike') } if (vy > 3) crash(s, 'tail') }
      else if (ct.kind === 'engine') {
        const i = ct.id === 'engL' ? 0 : 1
        if (s.eng[i].state !== 'failed' || s.eng[i].why !== 'strike') { s.eng[i].state = 'failed'; s.eng[i].why = 'strike'; event(s, 'engineStrike', i + 1) }
        if (vy > 3 || (fast && Math.abs(d.phi) > 12 * DEG)) crash(s, 'engine')
      } else if (ct.kind === 'wingtip') { if (vy > 2 || fast) crash(s, 'wingtip') }
      else { if (!dm.belly) { dm.belly = true; event(s, 'bellyLanding') } if (vy > 4) crash(s, 'belly') }
    }
  }

  /* ---------- integrate (semi-implicit Euler) */
  const fWorld = _tmp.copy(_f).applyQuaternion(s.quat)
  s.vel.addScaledVector(fWorld, dt / mass)
  s.pos.addScaledVector(s.vel, dt)
  const Ix = sp.I.x * ms, Iy = sp.I.y * ms, Iz = sp.I.z * ms
  _iw.set(Ix * s.w.x, Iy * s.w.y, Iz * s.w.z)
  _tmp2.copy(s.w).cross(_iw)
  _m.sub(_tmp2)
  s.w.x += (_m.x / Ix) * dt
  s.w.y += (_m.y / Iy) * dt
  s.w.z += (_m.z / Iz) * dt
  _dq.set(s.w.x * dt * 0.5, s.w.y * dt * 0.5, s.w.z * dt * 0.5, 0)
  _dq.premultiply(s.quat)
  s.quat.set(s.quat.x + _dq.x, s.quat.y + _dq.y, s.quat.z + _dq.z, s.quat.w + _dq.w).normalize()

  /* ---------- bookkeeping */
  _tmp2.set(0, -W, 0).applyQuaternion(_qi)
  d.nz = (_f.y - _tmp2.y) / W
  s.maxNz = Math.max(s.maxNz, d.nz)
  d.mainsOn = mainsOn >= 1; d.noseOn = noseOn; d.wow = wowAny || dm.belly
  d.decel = s.vel.length() > 1 ? -fWorld.dot(s.vel) / (s.vel.length() * mass) : 0
  const wasAir = s.airborne
  const touching = wowAny || (dm.belly && s.pos.y < sp.cgLayout.y)
  if (s.airborne && touching) {
    s.airborne = false
    s.touchdownVs = d.vs
    event(s, 'touchdown', d.vs)
    const fps = -d.vs / 60
    if (fps > 22) crash(s, 'hard')
    else if (fps > 10) event(s, 'hardLanding', d.vs)
    if (!d.onRunway && d.gs > 40) event(s, 'offRunway')
  } else if (!s.airborne && !wowAny && s.pos.y > sp.cgLayout.y + 0.5 && !dm.belly) {
    s.airborne = true
    s.everAirborne = true
    event(s, 'liftoff', d.ias)
  }
  if (s.pos.y < -2) crash(s, 'terrain')
  if (wasAir && s.airborne && d.vs > 300 && d.ra > 35 && d.ra < 400) event(s, 'positiveClimb')
  if (!s.airborne && d.gs < 1 && s.everAirborne) event(s, 'stopped')
  if (s.airborne && d.ias > (d.confId === '0' ? sp.vmo : d.vfe) + 4) event(s, d.confId === '0' ? 'overspeed' : 'vfe')
  if (!s.airborne && d.surface === 'grass' && d.gs > 5) event(s, d.gs > 30 ? 'offRunway' : 'grass')
  if (c.parkBrake && !s.flags.pb) event(s, 'parkBrakeOn')
  s.flags.pb = c.parkBrake
  // arrival: parked on a stand of the destination with the brake set and the engines off
  if (!s.arrived && s.everAirborne && !s.airborne && d.gs < 0.5 && c.parkBrake && d.stand?.airport === 'B' && Math.abs(d.stand.dist) < 4 && Math.abs(d.stand.lat) < 2.5
    && s.eng.every((e) => e.state !== 'run' && e.state !== 'starting')) { s.arrived = true; event(s, 'parked') }
  s.t += dt
}

export function crash(s: Sim, why: string) {
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
/** training failure: shut an engine down in flight */
export function failEngine(s: Sim, i: 0 | 1) { s.eng[i].state = 'failed'; s.eng[i].why = 'training'; event(s, 'engineFail', i + 1) }
