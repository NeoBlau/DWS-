import * as THREE from 'three'
import { DEST_X, RWY_LEN, RWY_W, AIRPORTS, surfaceAt } from './airports'
import { createSys, stepSystems, burnFuel, power, ACT, type Sys } from './systems'
import { model, massNow, type Model } from './physics'
import { aeroForces } from './vlm'
import { engineStep, newEngine, bliFan, type EngState as GasState } from './propulsion'
import type { MassState } from './mass'

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
  id: 'a320' | 'strizh' | 'vortex'
  arch: 'hyd' | 'electric' // hydraulic + bleed-air systems, or «more-electric» (EHA actuators, electric start, electric packs)
  wingCap: number // fuel each wing tank holds, kg (the rest goes to the centre tank)
  fuelArm: number // lateral distance of the wing-tank fuel from the centreline, m
  crossTie?: boolean // turbo-electric: every fan is fed from a common bus, so losing one core gives no asymmetric thrust
  v1: number; vr: number // take-off decision and rotation speeds at typical mass, kt
  fuelKind: 'jet' | 'lh2'; lhv: number // fuel and its lower heating value, MJ/kg
  fuelLow: number // low-fuel warning, kg
  mdd: number // Mach where wave drag starts to build (supercritical design)
  cruiseAt: { mach: number; alt: number } // design cruise point (alt in m)
  oew: number; payload: number; fuelMax: number; fuelStart: number // kg
  refMass: number // the struts and inertia are sized for this mass
  S: number; b: number; c: number; iw: number; CLA: number; CD0: number; CDgear: number; e: number
  I: THREE.Vector3 // body x (roll), y (yaw), z (pitch) at refMass
  tMax: number; eng: THREE.Vector3[]; ffScale: number; revFrac: number
  tsfc0: number // thrust-specific fuel consumption at rest, kg per N per hour (rises with Mach)
  idleFF: number // kg/h per engine at ground idle
  seats: number
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
  id: 'a320', arch: 'hyd', v1: 140, vr: 145, fuelKind: 'jet', lhv: 43.2, fuelLow: 1000, mdd: 0.72, cruiseAt: { mach: 0.78, alt: 10668 }, wingCap: 6100, fuelArm: 5, oew: 42600, payload: 13500, fuelMax: 18700, fuelStart: 8000, refMass: 64000,
  S: 122.6, b: 34.1, c: 4.19, iw: 2 * DEG, CLA: 5.6, CD0: 0.0215, CDgear: 0.018, e: 0.78,
  I: V3(1.35e6, 4.3e6, 3.1e6),
  tMax: 120000, eng: [V3(2.5, -1.2, -5.75), V3(2.5, -1.2, 5.75)], ffScale: 1, revFrac: 0.32, tsfc0: 0.0306, idleFF: 280, seats: 180,
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
/**
 * «Стриж-180» — a clean-sheet 180-seat design: high truss-braced wing of aspect ratio ≈ 19 with folding tips,
 * natural-laminar-flow airfoil, two open-fan engines (bypass ≈ 60) on the wing, thermoplastic CFRP structure,
 * electric flight-control actuators, Krueger leading edges and double-slotted flaps, T-tail.
 */
export const STRIZH: Spec = {
  id: 'strizh', arch: 'electric', v1: 128, vr: 132, fuelKind: 'jet', lhv: 43.2, fuelLow: 900, mdd: 0.72, cruiseAt: { mach: 0.74, alt: 10668 }, wingCap: 5200, fuelArm: 6.5, oew: 37800, payload: 13500, fuelMax: 15000, fuelStart: 6500, refMass: 58000,
  S: 118, b: 47.3, c: 2.55, iw: 2.5 * DEG, CLA: 5.9, CD0: 0.0186, CDgear: 0.016, e: 0.86,
  I: V3(2.4e6, 4.6e6, 2.9e6),
  tMax: 100000, eng: [V3(6.23, 1.85, -6.8), V3(6.23, 1.85, 6.8)], ffScale: 1, revFrac: 0.3, tsfc0: 0.0245, idleFF: 220, seats: 180,
  cgLayout: V3(-0.63, 3.0, 0),
  confs: [
    { id: '0', slat: 0, flap: 0, cl0: 0.22, as: 13, cd: 0, cm: 0, vfe: 340 },
    { id: '1', slat: 25, flap: 0, cl0: 0.4, as: 18, cd: 0.004, cm: -0.008, vfe: 230 },
    { id: '1+F', slat: 25, flap: 12, cl0: 0.7, as: 17, cd: 0.011, cm: -0.035, vfe: 215 },
    { id: '2', slat: 25, flap: 20, cl0: 0.92, as: 17, cd: 0.02, cm: -0.05, vfe: 200 },
    { id: '3', slat: 25, flap: 28, cl0: 1.08, as: 16.5, cd: 0.03, cm: -0.065, vfe: 190 },
    { id: 'FULL', slat: 25, flap: 40, cl0: 1.3, as: 18, cd: 0.06, cm: -0.1, vfe: 180 },
  ],
  vmo: 340, mmo: 0.82, vle: 270, vlo: 250, nzMax: 2.5, nzMaxFlaps: 2.0,
  noseGear: V3(11.0, 0, 0), mainGear: V3(0.31, 0, 2.3),
  hard: [
    { id: 'tail', kind: 'tail', p: V3(-13.0, 2.35, 0) },
    { id: 'engL', kind: 'engine', p: V3(5.6, 2.85, -6.8) }, { id: 'engR', kind: 'engine', p: V3(5.6, 2.85, 6.8) },
    { id: 'tipL', kind: 'wingtip', p: V3(-1.8, 4.6, -23.6) }, { id: 'tipR', kind: 'wingtip', p: V3(-1.8, 4.6, 23.6) },
    { id: 'bellyF', kind: 'belly', p: V3(9.0, 1.4, 0) }, { id: 'bellyA', kind: 'belly', p: V3(-3.0, 1.33, 0) },
  ],
  wingY: 2.2,
  Cm0: 0.03, CmA: -1.5, CmE: 1.3, CmT: 2.7, CmQ: -30,
  Cla: 0.09, ClP: -0.6, Cnr: -0.25, Cnb: 0.15, Cnd: 0.1,
}
/**
 * «Вихрь-240» — blended wing body for 240 passengers. New principles working together:
 *  · pressure-gain combustion: two turbo-generator cores burn hydrogen in a rotating detonation combustor —
 *    detonation waves race round an annulus at ≈ 2 km/s, so combustion raises pressure instead of losing it
 *    (Humphrey / Fickett–Jacobs cycle) — ≈ 15 % less fuel energy than a constant-pressure (Brayton) core;
 *  · liquid hydrogen at 20 K is both the fuel and the coolant of superconducting generators, cables and motors
 *    (≈ 99.5 % efficient), so power can be split freely between 8 electric fans;
 *  · the fans sit on the upper aft body and swallow its slow boundary layer (boundary-layer ingestion): they
 *    re-energise the wake instead of accelerating fresh air — ≈ 8 % less propulsive power;
 *  · the whole body lifts; outer wing panels fold at the gate (52 m in the air, 36 m on the ground);
 *  · any core can feed every fan: losing one core gives no asymmetric thrust at all.
 * Numbers are a conceptual design computed with the same model as the A320, not certified data.
 */
export const VORTEX: Spec = {
  id: 'vortex', arch: 'electric', v1: 110, vr: 115, fuelKind: 'lh2', lhv: 120, fuelLow: 400, crossTie: true, mdd: 0.8, cruiseAt: { mach: 0.84, alt: 13100 },
  wingCap: 0, fuelArm: 0, oew: 64000, payload: 22800, fuelMax: 4000, fuelStart: 2600, refMass: 92000,
  S: 553, b: 56, c: 11.9, iw: 1.5 * DEG, CLA: 4.6, CD0: 0.0086, CDgear: 0.0045, e: 0.92,
  I: V3(4.6e6, 9.4e6, 6.2e6),
  tMax: 140000, eng: [V3(-0.37, 1.5, -3.6), V3(-0.37, 1.5, 3.6)], ffScale: 1, revFrac: 0.38, tsfc0: 0.0071, idleFF: 60, seats: 240,
  cgLayout: V3(-0.63, 3.0, 0),
  confs: [
    { id: '0', slat: 0, flap: 0, cl0: 0.08, as: 15, cd: 0, cm: 0, vfe: 340 },
    { id: '1', slat: 20, flap: 0, cl0: 0.16, as: 17.5, cd: 0.003, cm: 0, vfe: 230 },
    { id: '1+F', slat: 20, flap: 5, cl0: 0.26, as: 17, cd: 0.006, cm: -0.008, vfe: 215 },
    { id: '2', slat: 20, flap: 8, cl0: 0.32, as: 17, cd: 0.009, cm: -0.012, vfe: 200 },
    { id: '3', slat: 20, flap: 12, cl0: 0.38, as: 16.5, cd: 0.013, cm: -0.016, vfe: 190 },
    { id: 'FULL', slat: 20, flap: 16, cl0: 0.44, as: 16.5, cd: 0.02, cm: -0.022, vfe: 180 },
  ],
  vmo: 340, mmo: 0.86, vle: 270, vlo: 250, nzMax: 2.5, nzMaxFlaps: 2.0,
  noseGear: V3(11.0, 0, 0), mainGear: V3(2.7, 0, 4.0),
  hard: [
    { id: 'tail', kind: 'tail', p: V3(-2.9, 3.35, 0) },
    { id: 'engL', kind: 'engine', p: V3(-1.0, 3.9, -6.4) }, { id: 'engR', kind: 'engine', p: V3(-1.0, 3.9, 6.4) },
    { id: 'tipL', kind: 'wingtip', p: V3(-13.8, 4.35, -28) }, { id: 'tipR', kind: 'wingtip', p: V3(-13.8, 4.35, 28) },
    { id: 'bellyF', kind: 'belly', p: V3(12.0, 1.4, 0) }, { id: 'bellyA', kind: 'belly', p: V3(0, 1.9, 0) },
  ],
  wingY: 0.4,
  Cm0: 0.02, CmA: -0.42, CmE: 0.3, CmT: 0.42, CmQ: -7,
  Cla: 0.1, ClP: -0.42, Cnr: -0.16, Cnb: 0.07, Cnd: 0.06,
}
export const SPECS: Record<Spec['id'], Spec> = { a320: A320, strizh: STRIZH, vortex: VORTEX }

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
interface Contact { id: string; kind: ContactKind; p: THREE.Vector3; k: number; c: number; leg: number } // p: drawing frame
export const STATIC_STROKE = 0.22
/** gear springs sized so the struts sit at their static stroke under the real weight split nose / mains */
function contactsOf(sp: Spec, cg: number[], mass: number) {
  const W = mass * G
  const L = (p: THREE.Vector3, dy = 0) => p.clone().add(V3(0, dy, 0))
  const noseShare = clamp((cg[0] - sp.mainGear.x) / (sp.noseGear.x - sp.mainGear.x), 0.02, 0.5)
  const gear: Contact[] = [
    { id: 'nose', kind: 'nose', p: L(sp.noseGear, -STATIC_STROKE), k: (noseShare * W) / STATIC_STROKE, c: 0.72 * Math.sqrt(noseShare * W / STATIC_STROKE * noseShare * mass), leg: 0 },
    { id: 'mainL', kind: 'main', p: L(V3(sp.mainGear.x, 0, -sp.mainGear.z), -STATIC_STROKE), k: (((1 - noseShare) / 2) * W) / STATIC_STROKE, c: 0.6 * Math.sqrt((((1 - noseShare) / 2) * W) / STATIC_STROKE * ((1 - noseShare) / 2) * mass), leg: 1 },
    { id: 'mainR', kind: 'main', p: L(sp.mainGear, -STATIC_STROKE), k: (((1 - noseShare) / 2) * W) / STATIC_STROKE, c: 0.6 * Math.sqrt((((1 - noseShare) / 2) * W) / STATIC_STROKE * ((1 - noseShare) / 2) * mass), leg: 2 },
  ]
  const hard: Contact[] = sp.hard.map((h) => ({ id: h.id, kind: h.kind, p: h.p.clone(), k: 4e6, c: 4e5, leg: -1 }))
  return { gear, hard, static: gear.map((g) => g.k * STATIC_STROKE), m0: mass }
}
export type Contacts = ReturnType<typeof contactsOf>
/** the physical state the model carries along: engines (gas-path state), mass properties, contacts */
export interface Phys { m: Model; eng: [GasState, GasState]; ms: MassState; msT: number; contacts: Contacts; cgH: number; aeroTick?: boolean; aeroLast?: ReturnType<typeof aeroForces> }

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
  trim: -1 | 0 | 1 // manual pitch trim (direct law, mechanical back-up)
}
export interface Surfaces {
  elev: number; ail: number; rud: number; ths: number
  splL: number; splR: number; gndSpl: number
  conf: number; confTarget: number
  gear: number // 0 up … 1 down & locked
  steer: number // nose wheel angle rad
}
export type EngState = 'off' | 'starting' | 'run' | 'failed'
export interface Engine { state: EngState; n1: number; n2: number; egt: number; tStart: number; why?: string; lit: boolean; litT: number; cool: number }
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
  | 'extTorn' | 'rat' | 'apuStart' | 'apuAvail' | 'apuFail' | 'irAlign' | 'irMoved' | 'irNav' | 'lightOff' | 'startFault' | 'modeNotStart' | 'noPower' | 'imbalance' | 'cabAlt' | 'nwsLost' | 'gravityGear'
export interface Sim {
  spec: Spec
  sys: Sys
  phys: Phys
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
  const mdl = model(spec.id, spec.confs)
  spec.oew = mdl.oew
  const run = (): Engine => ({ state: 'run', n1: 19.5, n2: 58, egt: 420, tStart: 0, lit: true, litT: 0, cool: 0 })
  const s: Sim = {
    spec, sys: createSys(start === 'gate', spec.fuelStart, spec.wingCap), phys: undefined as unknown as Phys, t: 0, pos: V3(80, spec.cgLayout.y, 0), vel: V3(0, 0, 0), quat: new THREE.Quaternion(), w: V3(0, 0, 0),
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
    const off = (): Engine => ({ state: 'off', n1: 0, n2: 0, egt: 25, tStart: 0, lit: false, litT: 0, cool: 0 })
    s.eng = [off(), off()]
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
    s.n1 = [55, 55]; s.eng.forEach((e) => { e.n1 = 55; e.n2 = 78 }); setFuel(s, 3500); s.airborne = true; s.everAirborne = true; s.fbw.blend = 1
  } else if (start === 'cruise') {
    const V = 250 * KT * 1.16, th = 2.2 * DEG
    s.pos.set(9000, 3000, 0)
    s.vel.set(V, 0, 0)
    s.quat.setFromEuler(new THREE.Euler(0, 0, th, 'YZX'))
    Object.assign(s.ctl, { flapLever: 0, gearDown: false, lever: 0.55 })
    Object.assign(s.srf, { conf: 0, confTarget: 0, gear: 0, ths: 0.9 * DEG })
    s.n1 = [72, 72]; s.eng.forEach((e) => { e.n1 = 72; e.n2 = 87 }); setFuel(s, 6500); s.sys.cab = 2200; s.airborne = true; s.everAirborne = true; s.fbw.blend = 1
  }
  s.flags.gearLever = s.ctl.gearDown
  initPhys(s, start)
  derive(s, 0)
  if (start === 'approach' || start === 'cruise') trimSim(s)
  return s
}
function initPhys(s: Sim, start: Start) {
  const mdl = model(s.spec.id, s.spec.confs)
  const ms = massNow(mdl, s.spec.payload, s.sys.tank)
  const running = start !== 'gate'
  s.phys = { m: mdl, eng: [newEngine(running, mdl.geo.engine), newEngine(running, mdl.geo.engine)], ms, msT: 0, contacts: contactsOf(s.spec, ms.cg, ms.m), cgH: ms.cg[1] }
  if (!s.airborne) s.pos.y = ms.cg[1]
  if (start === 'approach' || start === 'cruise') s.phys.eng.forEach((e) => { e.N1 = 0.6; e.N2 = 0.8; e.T4 = 1200; e.Wf = 0.3 })
}
/** centre of gravity in % of the mean aerodynamic chord */
export const cgMac = (s: Sim) => ((s.phys.m.aero.xref - s.phys.ms.cg[0]) / s.phys.m.aero.cref) * 100
/**
 * trim for the airborne starts: find angle of attack and stabiliser setting that give lift = weight and no pitching
 * moment at the start speed, using the same aerodynamic model (Newton iterations)
 */
function trimSim(s: Sim) {
  const ph = s.phys, aero = ph.m.aero, conf = confAt(s.srf.conf, s.spec.confs), atm = isa(s.pos.y)
  const V = s.vel.length(), gam = Math.asin(clamp(s.vel.y / V, -1, 1)), W = ph.ms.m * G
  const ev = (al: number, ths: number) => aeroForces(aero, { rho: atm.rho, a: atm.a, mu: 1.7e-5, v: [V * Math.cos(al), -V * Math.sin(al), 0], w: [0, 0, 0], cg: ph.ms.cg,
    ctl: { elev: 0, ths, ail: 0, rud: 0, splL: 0, splR: 0, gnd: 0, flap: conf.flap, slat: conf.slat, gear: s.srf.gear, flapL: 1, flapR: 1 }, ground: { on: false, n: [0, 1, 0], d: 0 }, t: 0 })
  let al = 3 * DEG, th = 0
  for (let it = 0; it < 12; it++) {
    const r0 = ev(al, th), e1 = r0.lift - W * Math.cos(gam), e2 = r0.M[2]
    const ra = ev(al + 0.2 * DEG, th), rt = ev(al, th + 0.2 * DEG)
    const a11 = (ra.lift - r0.lift) / (0.2 * DEG), a12 = (rt.lift - r0.lift) / (0.2 * DEG), a21 = (ra.M[2] - r0.M[2]) / (0.2 * DEG), a22 = (rt.M[2] - r0.M[2]) / (0.2 * DEG)
    const det = a11 * a22 - a12 * a21
    if (Math.abs(det) < 1e-6) break
    al = clamp(al - (e1 * a22 - e2 * a12) / det, -4 * DEG, 14 * DEG)
    th = clamp(th - (a11 * e2 - a21 * e1) / det, -4 * DEG, 13.5 * DEG)
  }
  s.quat.setFromEuler(new THREE.Euler(0, 0, al + gam, 'YZX'))
  s.srf.ths = th
  // engines: find the fan-speed target whose thrust balances the drag on this path
  const drag = ev(al, th).drag + W * Math.sin(gam)
  const amb = { T0: atm.T, p0: atm.p, M: V / atm.a, V, rho: atm.rho }
  let lo = 0.2, hi = 1.0
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) / 2, e = newEngine(true, ph.m.geo.engine)
    let T = 0
    for (let k = 0; k < 2400; k++) T = engineThrust(s, e, mid, amb, H)
    if (2 * T > drag) hi = mid; else lo = mid
  }
  const tgt = (lo + hi) / 2
  ph.eng = [newEngine(true, ph.m.geo.engine), newEngine(true, ph.m.geo.engine)]
  for (let k = 0; k < 4800; k++) ph.eng.forEach((e) => engineThrust(s, e, tgt, amb, H))
  s.ctl.lever = leverFor(s.spec, tgt)
  s.n1 = [ph.eng[0].N1 * 100, ph.eng[1].N1 * 100]; s.eng.forEach((e, i) => { e.n1 = s.n1[i]; e.n2 = ph.eng[i].N2 * 100 })
}
/** thrust of one engine (with its share of the electric fans) at a FADEC target, for trimming */
function engineThrust(s: Sim, e: GasState, target: number, amb: { T0: number; p0: number; M: number; V: number; rho: number }, dt: number) {
  const g = s.phys.m.geo.engine, des = s.phys.m.des
  const o = engineStep(e, g, des, amb, { target, fuel: true, ignite: true, starter: 0, rev: 0, bleed: 0, leverStart: 0, n2min: 0.66 }, dt)
  let T = o.thrust
  if (g.kind === 'turboelectric') T += ((g.fans ?? 8) / 2) * bliFan((o.Pshaft * 0.975) / (g.fans ?? 8), amb.V, amb.rho, des.fan!.Ae, g.bli ?? 0)
  return T
}
/** FADEC target from the thrust lever: fan speed N1 (turbofan) or core speed N2 (open fan, turbo-electric) */
export function fadecTarget(sp: Spec, lever: number, rev: number, airborne: boolean) {
  const kind = model(sp.id, sp.confs).geo.engine.kind
  const n1 = rev === 2 ? N1_MAXREV : rev === 1 ? N1_IDLE_GND + 6 : leverN1(lever, airborne ? N1_IDLE_FLT : N1_IDLE_GND)
  if (kind === 'turbofan') return n1 / 100
  const f = clamp((n1 - N1_IDLE_GND) / (96 - N1_IDLE_GND), 0, 1)
  return 0.6 + (kind === 'turboelectric' ? 0.32 : 0.34) * f
}
function leverFor(sp: Spec, target: number) {
  let lo = 0, hi = 1
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fadecTarget(sp, m, 0, true) > target) hi = m; else lo = m }
  return (lo + hi) / 2
}
export const massOf = (s: Sim) => (s.phys ? s.phys.ms.m : s.spec.oew + s.spec.payload + s.fuel)
/** load fuel: wings first, then the centre tank */
export function setFuel(s: Sim, kg: number) {
  const w = Math.min(kg / 2, s.spec.wingCap)
  s.sys.tank = { L: w, C: Math.max(0, kg - 2 * w), R: w }
  s.fuel = kg
}

/* ------------------------------------------------------------------ atmosphere & engines */
export function isa(h: number) {
  const T = 288.15 - 0.0065 * Math.max(0, Math.min(h, 11000))
  const p = h <= 11000 ? 101325 * Math.pow(T / 288.15, 5.2559) : 22632 * Math.exp(-(h - 11000) / 6341.6)
  // troposphere: ρ ∝ T^4.256; above 11 km (isothermal stratosphere) ρ falls exponentially
  const rho = 1.225 * Math.pow(T / 288.15, 4.256) * (h > 11000 ? Math.exp(-(h - 11000) / 6341.6) : 1)
  return { T, p, rho, a: Math.sqrt(1.4 * 287.05 * T), sigma: rho / 1.225, mu: (1.458e-6 * T ** 1.5) / (T + 110.4) }
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
const _fw = V3(0, 0, 0), _iw = V3(0, 0, 0), _dq = new THREE.Quaternion(), _fwd = V3(0, 0, 0), _rc = V3(0, 0, 0)
const UP = V3(0, 1, 0)

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
  d.ra = Math.max(0, (s.pos.y - (s.phys?.cgH ?? sp.cgLayout.y)) / FT)
  const conf = confAt(s.srf.conf, sp.confs)
  d.confId = sp.confs[Math.round(s.srf.conf)].id
  d.vfe = conf.vfe
  // stall angle and maximum lift of this configuration — found by sweeping the aerodynamic model
  const st = model(sp.id, sp.confs).stall, ci = clamp(Math.floor(s.srf.conf), 0, st.length - 1), cj = Math.min(st.length - 1, ci + 1), ck = clamp(s.srf.conf - ci, 0, 1)
  d.alphaStall = st[ci].alpha + (st[cj].alpha - st[ci].alpha) * ck
  d.alphaProt = d.alphaStall - 2.8 * DEG
  d.alphaMax = d.alphaStall - 0.8 * DEG
  d.mass = massOf(s)
  d.weight = d.mass * G
  const clmax = st[ci].clmax + (st[cj].clmax - st[ci].clmax) * ck
  d.vs1g = Math.sqrt((2 * d.weight) / (1.225 * model(sp.id, sp.confs).aero.Sref * clmax)) / KT
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
  // the law the computers can actually provide (systems.ts): normal → alternate → direct → mechanical back-up
  const law = s.sys.law, isNormal = law === 'normal'
  const pE = power(s, ACT.elev), pA = power(s, ACT.ail), pR = power(s, ACT.rud), pT = power(s, ACT.ths)
  let elevCmd: number
  const direct = c.stickY * 30 * DEG * clamp(sched, 0.35, 1)
  if (law === 'direct' || law === 'mech') {
    // direct law: stick → elevator. Mechanical back-up: no computers at all — only the trim wheel and the rudder pedals
    elevCmd = law === 'mech' ? 0 : direct
    r.ths = clamp(r.ths + c.trim * 0.5 * DEG * dt * pT, -4 * DEG, 13.5 * DEG)
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
    const prot = isNormal && d.alpha > d.alphaProt - 0.6 * DEG && s.airborne
    if (prot) {
      const aCmd = d.alphaProt + Math.max(0, sy) * (d.alphaMax - d.alphaProt)
      qCmd = Math.min(qCmd, 1.1 * (aCmd - d.alpha))
      if (!d.inProt && d.alpha > d.alphaProt) event(s, 'alphaProt')
    }
    d.inProt = prot && d.alpha > d.alphaProt - 0.2 * DEG
    // α-floor: automatic TOGA thrust when α keeps rising inside the protection
    if (isNormal && s.airborne && d.ra > 100 && d.alpha > d.alphaProt + 0.5 * (d.alphaMax - d.alphaProt) && !f.alphaFloor) {
      f.alphaFloor = true; f.floorLever = c.lever; event(s, 'alphaFloor')
    }
    if (f.alphaFloor && Math.abs(c.lever - f.floorLever) > 0.05) f.alphaFloor = false
    // pitch-attitude protection +30° / −15° and high-speed protection (normal law only)
    if (isNormal) {
      qCmd = Math.min(qCmd, 0.8 * (30 * DEG - d.theta))
      qCmd = Math.max(qCmd, 0.8 * (-15 * DEG - d.theta))
      if (d.ias > sp.vmo + 6) qCmd += 0.004 * (d.ias - sp.vmo - 6)
    }
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
      r.ths = clamp(r.ths + clamp(0.45 * r.elev, -0.7 * DEG, 0.7 * DEG) * dt * pT, -4 * DEG, 13.5 * DEG)
    }
  }
  // take-off trim: on the ground the stabiliser is set from the configuration (the crew enters it in the FMS)
  if (!s.everAirborne && !s.airborne) r.ths = approach(r.ths, (s.srf.confTarget >= 2 ? 0.2 : -0.4) * DEG, 1 * DEG * pT, dt)
  // an actuator with no hydraulic pressure cannot hold its surface: it floats back with the airflow
  r.elev = pE > 0 ? approach(r.elev, clamp(elevCmd, -17 * DEG, 30 * DEG), 40 * DEG * pE, dt) : approach(r.elev, 0, 3 * DEG, dt)

  /* ---------- roll */
  let ailCmd: number
  if (law !== 'normal' || !s.airborne) {
    ailCmd = law === 'mech' ? 0 : c.stickX * 25 * DEG * clamp(sched, 0.3, 1)
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
  r.ail = pA > 0 ? approach(r.ail, clamp(ailCmd, -25 * DEG, 25 * DEG), 60 * DEG * pA, dt) : approach(r.ail, 0, 3 * DEG, dt)

  /* ---------- yaw: pedals + yaw damper + turn coordination */
  const maxRud = clamp(25 - (d.ias - 160) * 0.098, 3.5, 25) * DEG
  let rudCmd = c.pedal * maxRud
  if ((law === 'normal' || law === 'alternate') && s.airborne) {
    const rTurn = gn * Math.sin(d.phi) * Math.cos(d.theta)
    rudCmd += (-0.9 * (d.r - rTurn) + 1.4 * d.beta) * f.blend
  }
  r.rud = pR > 0 ? approach(r.rud, clamp(rudCmd, -maxRud, maxRud), 40 * DEG * pR, dt) : approach(r.rud, 0, 3 * DEG, dt)
  // nose-wheel steering: tiller authority at taxi speed, pedals only (±6°) at speed, up to 75° when towed.
  // It is driven by the yellow hydraulic system (A320) — no yellow pressure, no steering (the tug steers by itself)
  const steerMax = c.push ? 75 : d.gs < 12 ? 70 : d.gs < 30 ? 30 : 6
  const nws = c.push ? 1 : power(s, ACT.nws)
  if (!nws && Math.abs(c.pedal) > 0.5 && !s.airborne && d.gs > 1) event(s, 'nwsLost')
  r.steer = approach(r.steer, (s.dmg.legs[0] || !nws ? 0 : c.pedal) * steerMax * DEG, 25 * DEG, dt)
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
    // slats on green + blue, flaps on green + yellow: one system lost = half speed, both = frozen
    const pF = power(s, ACT.flap), pS = power(s, ACT.slat)
    r.conf = approach(r.conf, r.confTarget, 0.14 * (pF + pS) / 2, dt)
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
  // green system raises and lowers the gear; without it the gear can only free-fall down under gravity
  const pG = power(s, ACT.gear)
  if (gearTgt === 1 && pG === 0 && r.gear < 0.99 && !s.flags.gravGear) { s.flags.gravGear = true; event(s, 'gravityGear') }
  if (pG > 0) s.flags.gravGear = false
  r.gear = approach(r.gear, gearTgt, gearTgt ? (pG > 0 ? pG / 9 : 1 / 25) : pG / 9, dt)

  /* ground spoilers: armed + both mains on the ground + levers at idle (or reverse) */
  const gndCond = d.mainsOn && (c.lever < 0.05 || c.rev > 0) && d.gs > 40
  const deploy = (c.spoilersArmed || c.rev > 0) && gndCond
  if (deploy && r.gndSpl < 0.05) event(s, 'groundSpoilers')
  const pSp = power(s, ACT.spl)
  r.gndSpl = approach(r.gndSpl, deploy || (r.gndSpl > 0.5 && d.mainsOn && c.lever < 0.05 && d.gs > 5) ? 1 : 0, 1.5 * pSp, dt)
  const sb = s.airborne ? c.speedbrake * (d.inProt ? 0 : 1) : c.speedbrake * 0.5
  const roll = clamp((Math.abs(r.ail) / (25 * DEG) - 0.25) / 0.75, 0, 1)
  r.splL = approach(r.splL, pSp ? clamp(Math.max(r.gndSpl, sb * 0.6 + (r.ail < 0 ? roll : 0)), 0, 1) : 0, 1.4 * Math.max(pSp, 0.2), dt)
  r.splR = approach(r.splR, pSp ? clamp(Math.max(r.gndSpl, sb * 0.6 + (r.ail > 0 ? roll : 0)), 0, 1) : 0, 1.4 * Math.max(pSp, 0.2), dt)
  if (c.rev > 0 && (!d.mainsOn || c.lever > 0.05)) c.rev = 0

  /* autobrake */
  // autobrake works through the normal (green, anti-skid) brakes only
  if (c.autobrake && r.gndSpl > 0.8 && d.gs > 5) f.abActive = true
  if (c.brake > 0.3 || d.gs < 3 || c.lever > 0.1 || power(s, 'G') === 0) f.abActive = false
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

  /* fuel: burnt from the tank each engine is actually fed from */
  const apuFF = s.sys.apu.state === 'avail' || s.sys.apu.state === 'cooldown' || (s.sys.apu.state === 'starting' && s.sys.apu.n > 7) ? 120 : 0
  const burnt = burnFuel(s, d.ff, apuFF, dt)
  const tk = s.sys.tank
  s.fuel = tk.L + tk.C + tk.R; s.fuelUsed += burnt
  if (s.fuel < sp.fuelLow && !s.flags.fuelLow) { s.flags.fuelLow = true; event(s, 'fuelLow') }
  if (Math.abs(tk.L - tk.R) > 1500 && !s.flags.imb) { s.flags.imb = true; event(s, 'imbalance') }
  if (Math.abs(tk.L - tk.R) < 800) s.flags.imb = false
  if (s.sys.cab > 9550 && !s.flags.cab) { s.flags.cab = true; event(s, 'cabAlt') }
  if (s.sys.cab < 9000) s.flags.cab = false

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
  stepSystems(s, dt)
  flyByWire(s, dt)
  systems(s, dt)
  const ph = s.phys
  // mass, centre of gravity and inertia follow the fuel actually left in each tank
  ph.msT -= dt
  if (ph.msT <= 0) { ph.ms = massNow(ph.m, sp.payload, s.sys.tank); ph.msT = 0.5 }
  const mass = ph.ms.m, W = mass * G, ms = mass / ph.contacts.m0, cg = ph.ms.cg
  d.mass = mass; d.weight = W

  _f.set(0, 0, 0); _m.set(0, 0, 0)
  _qi.copy(s.quat).invert()
  _vb.copy(s.vel).applyQuaternion(_qi)
  const V = d.V
  const conf = confAt(r.conf, sp.confs)

  /* ---------- aerodynamics: vortex lattice on the real geometry (vlm.ts) */
  const atm = isa(s.pos.y)
  // the ground plane seen from the aircraft (for the mirror vortices of ground effect)
  _tmp.set(0, 1, 0).applyQuaternion(_qi)
  const gn = [_tmp.x, _tmp.y, _tmp.z]
  // the lattice is solved at 120 Hz (every other physics step); forces are held in between
  ph.aeroTick = !ph.aeroTick
  const aero = ph.aeroTick && ph.aeroLast ? ph.aeroLast : aeroForces(ph.m.aero, {
    rho: atm.rho, a: atm.a, mu: atm.mu, v: [_vb.x, _vb.y, _vb.z], w: [s.w.x, s.w.y, s.w.z], cg,
    ctl: { elev: r.elev, ths: r.ths, ail: r.ail, rud: r.rud, splL: r.splL, splR: r.splR, gnd: r.gndSpl, flap: conf.flap, slat: conf.slat, gear: r.gear,
      flapL: dm.flaps === 2 && dm.flapSide === -1 ? 0 : 1, flapR: dm.flaps === 2 && dm.flapSide === 1 ? 0 : 1 },
    ground: { on: s.pos.y < ph.m.aero.bref * 1.5, n: gn, d: gn[0] * cg[0] + gn[1] * cg[1] + gn[2] * cg[2] - s.pos.y }, t: s.t,
  })
  ph.aeroLast = aero
  _f.x += aero.F[0]; _f.y += aero.F[1]; _f.z += aero.F[2]
  _m.x += aero.M[0]; _m.y += aero.M[1]; _m.z += aero.M[2]
  d.lift = aero.lift; d.drag = aero.drag; d.ge = s.pos.y < ph.m.aero.bref ? s.pos.y / ph.m.aero.bref : 1
  d.stall = aero.wingStall > 0.2
  if (d.stall && s.airborne) event(s, 'stall')
  void V

  /* ---------- engines: gas-path model (propulsion.ts); this block is the start / run / fail logic around it */
  const y = s.sys, elecArch = sp.arch === 'electric'
  const g = ph.m.geo.engine, des = ph.m.des
  const amb = { T0: atm.T, p0: atm.p, M: d.mach, V: d.V, rho: atm.rho }
  const lever = s.fbw.alphaFloor ? 1 : c.lever
  // the starter: compressed air from the APU / another engine (A320) or the electric starter-generator (more-electric)
  const starter = elecArch ? (y.ac[0] || y.ac[1] ? 1 : 0) : clamp((y.bleed - 12) / 22, 0, 1)
  const ign = y.sw.engMode === 'start' && y.dcEss
  const bleedEach = !elecArch && (y.sw.packs[0] || y.sw.packs[1]) && y.bleedSrc.startsWith('ENG') ? 0.5 : 0
  let fanPowerTotal = 0
  const coreThrust = [0, 0]
  for (let i = 0; i < 2; i++) {
    const e = s.eng[i], ge = ph.eng[i]
    const master = c.master[i]
    const fed = y.feed[i] !== ''
    e.cool = Math.max(0, e.cool - dt)
    // start (or in-flight relight): master ON with the mode selector at IGN/START and the FADEC powered.
    // After an aborted start the FADEC waits until the master is cycled OFF → ON.
    const restartable = e.state === 'off' || (e.state === 'failed' && e.why !== 'strike')
    if (!master) s.flags['ab' + i] = false
    if (restartable && master && y.sw.engMode === 'start' && y.dcEss && e.cool === 0 && !s.flags['ab' + i]) {
      e.state = 'starting'; e.tStart = s.t; e.lit = false; e.litT = 0; y.startFault[i] = ''; event(s, 'engineStart', i + 1)
    }
    if (master && !s.flags['m' + i] && e.state === 'off') event(s, !y.dcEss ? 'noPower' : 'modeNotStart', i + 1)
    s.flags['m' + i] = master
    if ((e.state === 'run' || e.state === 'starting') && !master) { e.state = 'off' }
    if (e.state === 'failed' && !master && e.why !== 'strike') { e.state = 'off' }
    const starting = e.state === 'starting', running = e.state === 'run'
    const abort = (why: string, cool = 30) => { e.state = 'off'; e.cool = cool; s.flags['ab' + i] = true; y.startFault[i] = why; ge.lit = false; event(s, 'startFault', i + 1) }
    const out = engineStep(ge, g, des, amb, {
      target: fadecTarget(sp, lever, running ? c.rev : 0, s.airborne), fuel: (starting || running) && fed, ignite: starting && ign,
      starter: starting && ge.N2 < 0.5 ? 150e3 * starter * (1 - ge.N2 / 0.55) : 0, rev: running ? c.rev : 0, bleed: bleedEach,
      leverStart: starting ? c.lever : 0, n2min: s.airborne ? 0.66 : 0.58, starting,
    }, dt)
    if (starting) {
      const ts = s.t - e.tStart
      if (ge.lit && !e.litT) { e.litT = s.t; event(s, 'lightOff', i + 1) }
      if (!ge.lit && ts > 45) abort(ge.N2 < 0.16 ? (elecArch ? 'NO STARTER POWER' : 'START VALVE — BLEED PRESS LO') : !fed ? 'NO FUEL FEED' : 'IGN FAULT')
      else if (ge.lit && out.egt > 725) abort('EGT OVERLIMIT — HOT START', 40)
      else if (ge.lit && s.t - e.litT > 40 && ge.N2 < 0.5) abort('HUNG START')
      else if (ge.lit && ge.N2 >= 0.575) { e.state = 'run'; event(s, 'engineRun', i + 1) }
    }
    if (running && !ge.lit) { e.state = 'failed'; e.why = fed ? 'flameout' : 'fuel'; event(s, 'flameout', i + 1) }
    if (running && !fed && !e.why) { /* the gas path loses fuel pressure next step */ }
    e.lit = ge.lit
    e.n1 = out.n1; e.n2 = out.n2; e.egt = out.egt + 273.15 > 300 ? out.egt : 25
    s.n1[i] = e.n1
    d.egt[i] = e.egt
    d.ff[i] = out.ff
    coreThrust[i] = out.thrust
    fanPowerTotal += out.Pshaft
  }
  if (g.kind === 'turboelectric') {
    // generators → common bus → 8 electric fans that swallow the body's boundary layer
    const per = (fanPowerTotal * 0.975) / (g.fans ?? 8), half = (g.fans ?? 8) / 2
    let side = half * bliFan(per, d.V, atm.rho, des.fan!.Ae, g.bli ?? 0)
    if (c.rev > 0 && !s.airborne) side = -0.4 * half * bliFan(per, 0, atm.rho, des.fan!.Ae, 0)
    d.thrust[0] = coreThrust[0] + side; d.thrust[1] = coreThrust[1] + side
  } else { d.thrust[0] = coreThrust[0]; d.thrust[1] = coreThrust[1] }
  for (let i = 0; i < 2; i++) {
    _tmp.set(d.thrust[i], 0, 0)
    _f.add(_tmp)
    _m.add(_tmp2.set(sp.eng[i].x + sp.cgLayout.x - cg[0], sp.eng[i].y + sp.cgLayout.y - cg[1], sp.eng[i].z + sp.cgLayout.z - cg[2]).cross(_tmp))
  }
  // (uneven tanks: the CG moves sideways in the mass model, so lift — acting at the wing — rolls the aircraft by itself)
  if (c.rev > 0 && !s.flags.rev) event(s, 'reverse')
  s.flags.rev = c.rev > 0

  /* ---------- gravity (world) → body */
  _tmp.set(0, -W, 0).applyQuaternion(_qi)
  _f.add(_tmp)

  /* ---------- landing gear & hard points */
  const C = ph.contacts
  let mainsOn = 0, noseOn = false, wowAny = false
  // brakes: normal (green, with anti-skid) → alternate (yellow) → accumulator (a few full applications)
  const pGb = power(s, 'G'), pYb = power(s, 'Y')
  const pedalBrake = Math.max(c.brake, s.fbw.abBrake)
  let brakeAvail = pGb > 0 || pYb > 0 ? 1 : y.accu > 1000 ? 1 : y.accu / 1000
  if (pGb === 0 && pYb === 0 && pedalBrake > 0 && d.gs > 0.5) y.accu = Math.max(0, y.accu - pedalBrake * 350 * dt)
  if (sp.arch === 'electric') brakeAvail = y.dcEss ? 1 : 0 // electric brakes
  const brake = Math.max(pedalBrake * brakeAvail, c.parkBrake && (pYb > 0 || y.accu > 800 || sp.arch === 'electric') ? 1 : 0)
  _fwd.set(1, 0, 0).applyQuaternion(s.quat)
  _roll.copy(_fwd); _roll.y = 0; _roll.normalize()
  d.struts = [0, 0, 0]
  const list = r.gear > 0.99 ? [...C.gear.filter((g) => !dm.legs[g.leg]), ...C.hard] : C.hard
  for (const ct of list) {
    _rc.set(ct.p.x - cg[0], ct.p.y - cg[1], ct.p.z - cg[2])
    _pw.copy(_rc).applyQuaternion(s.quat).add(s.pos)
    const pen = -_pw.y
    if (ct.leg >= 0) d.struts[ct.leg] = clamp(STATIC_STROKE * 1.6 - Math.max(0, pen), 0, STATIC_STROKE * 1.6)
    if (pen <= 0) continue
    _vp.copy(s.w).cross(_rc).applyQuaternion(s.quat).add(s.vel)
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
    _m.add(_tmp2.copy(_rc).cross(_tmp))
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
  const Ix = ph.ms.I[0], Iy = ph.ms.I[1], Iz = ph.ms.I[2]
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
  const touching = wowAny || (dm.belly && s.pos.y < ph.cgH)
  if (s.airborne && touching) {
    s.airborne = false
    s.touchdownVs = d.vs
    event(s, 'touchdown', d.vs)
    const fps = -d.vs / 60
    if (fps > 22) crash(s, 'hard')
    else if (fps > 10) event(s, 'hardLanding', d.vs)
    if (!d.onRunway && d.gs > 40) event(s, 'offRunway')
  } else if (!s.airborne && !wowAny && s.pos.y > ph.cgH + 0.5 && !dm.belly) {
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
