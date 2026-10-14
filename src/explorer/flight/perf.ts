import { isa, G, KT, type Spec } from './fdm'
import { model, massNow, type Model } from './physics'
import { aeroForces, type Ctl } from './vlm'
import { engineStep, newEngine, bliFan, type Amb } from './propulsion'
import type { MassState } from './mass'

/*
 * Performance figures from the very models the simulator flies with — no separate formulas:
 *  · trimmed level flight: angle of attack and pitch trim (stabiliser or elevons) from the vortex lattice, so that
 *    lift = weight and the pitching moment about the actual CG is zero; the drag that comes out includes trim drag;
 *  · thrust = drag found on the gas-path engine model (FADEC target by bisection), fuel flow read off it.
 */
const CTL0: Ctl = { elev: 0, ths: 0, ail: 0, rud: 0, splL: 0, splR: 0, gnd: 0, flap: 0, slat: 0, gear: 0, flapL: 1, flapR: 1 }

/** mass state with this much fuel, loaded the way the simulator loads it (wing tanks first, then the centre) */
function loaded(m: Model, sp: Spec, fuel: number): MassState {
  const w = Math.min(fuel / 2, sp.wingCap)
  return massNow(m, sp.payload, { L: w, C: Math.max(0, fuel - 2 * w), R: w })
}

/** trimmed level flight at true airspeed V: returns α, trim setting and the forces, or null if it cannot trim */
export function trimLevel(m: Model, ms: MassState, altM: number, V: number) {
  const atm = isa(altM), W = ms.m * G, tailless = !m.geo.surfaces.some((s) => s.id === 'htail')
  const ev = (al: number, tr: number) => aeroForces(m.aero, { rho: atm.rho, a: atm.a, mu: atm.mu, v: [V * Math.cos(al), -V * Math.sin(al), 0], w: [0, 0, 0], cg: ms.cg,
    ctl: tailless ? { ...CTL0, elev: tr } : { ...CTL0, ths: tr }, ground: { on: false, n: [0, 1, 0], d: 0 }, t: 0 })
  // starting guess: the angle that gives lift = weight with neutral trim (secant), then Newton on both
  let al = 0, tr = 0
  { let a0 = 0, l0 = ev(0, 0).lift, a1 = 1.5 * Math.PI / 180, l1 = ev(a1, 0).lift
    for (let i = 0; i < 4 && Math.abs(l1 - l0) > 1; i++) { const a2 = a1 + ((W - l1) * (a1 - a0)) / (l1 - l0); a0 = a1; l0 = l1; a1 = Math.max(-0.1, Math.min(0.25, a2)); l1 = ev(a1, 0).lift }
    al = a1 }
  const h = 0.2 * Math.PI / 180
  for (let it = 0; it < 14; it++) {
    const r0 = ev(al, tr), e1 = r0.lift - W, e2 = r0.M[2]
    if (Math.abs(e1) < 2e-4 * W && Math.abs(e2) < 50) break
    const ra = ev(al + h, tr), rt = ev(al, tr + h)
    const a11 = (ra.lift - r0.lift) / h, a12 = (rt.lift - r0.lift) / h, a21 = (ra.M[2] - r0.M[2]) / h, a22 = (rt.M[2] - r0.M[2]) / h
    const det = a11 * a22 - a12 * a21
    if (Math.abs(det) < 1e-9) return null
    al -= (e1 * a22 - e2 * a12) / det
    tr -= (a11 * e2 - a21 * e1) / det
    if (Math.abs(al) > 0.3 || Math.abs(tr) > 0.5) return null
  }
  const r = ev(al, tr)
  if (Math.abs(r.lift - W) > 0.01 * W) return null
  return { alpha: al, trim: tr, ...r }
}

/** both engines' thrust and fuel flow at a FADEC target, run to steady state from the previous state */
function steadyEngines(m: Model, amb: Amb, target: number, eng: ReturnType<typeof newEngine>) {
  const g = m.geo.engine, des = m.des
  let o = engineStep(eng, g, des, amb, { target, fuel: true, ignite: true, starter: 0, rev: 0, bleed: 0, leverStart: 0, n2min: 0.66 }, 1 / 60)
  for (let k = 0; k < 1500; k++) o = engineStep(eng, g, des, amb, { target, fuel: true, ignite: true, starter: 0, rev: 0, bleed: 0, leverStart: 0, n2min: 0.66 }, 1 / 60)
  let T = o.thrust
  if (g.kind === 'turboelectric') T += ((g.fans ?? 8) / 2) * bliFan((o.Pshaft * 0.975) / ((g.fans ?? 8) / 2), amb.V, amb.rho, des.fan!.Ae, g.bli ?? 0)
  return { thrust: 2 * T, ff: 2 * o.ff, n1: o.n1, n2: o.n2 }
}

/**
 * steady cruise at the given fuel load, altitude and Mach number. ff in kg/h (both engines), perSeat100km in kg of
 * fuel per seat per 100 km. `ok` is false when the engines cannot hold that point.
 */
export function cruise(sp: Spec, fuel: number, altM: number, mach: number) {
  const m = model(sp.id, sp.confs), ms = loaded(m, sp, fuel), atm = isa(altM), V = mach * atm.a
  const tr = trimLevel(m, ms, altM, V)
  const D = tr ? tr.drag : NaN
  const amb: Amb = { T0: atm.T, p0: atm.p, M: mach, V, rho: atm.rho }
  const eng = newEngine(true, m.geo.engine)
  let lo = 0.5, hi = 1.0, best = steadyEngines(m, amb, 0.75, eng)
  for (let i = 0; i < 12 && tr; i++) {
    const mid = (lo + hi) / 2
    best = steadyEngines(m, amb, mid, eng)
    if (best.thrust > D) hi = mid; else lo = mid
  }
  const ok = !!tr && Math.abs(best.thrust - D) < 0.03 * D
  const km_h = V * 3.6
  return {
    ok, mass: ms.m, alpha: tr?.alpha ?? NaN, trim: tr?.trim ?? NaN, CL: tr?.CL ?? NaN, LD: tr ? tr.lift / tr.drag : NaN, D, ff: best.ff, n1: best.n1, n2: best.n2, tas: V / KT,
    dragParts: tr ? { induced: tr.dragInduced, parasite: tr.dragParasite, wave: tr.dragWave } : null,
    perSeat100km: (best.ff / km_h) * 100 / sp.seats, co2PerSeat100km: sp.fuelKind === 'lh2' ? 0 : ((best.ff / km_h) * 100 / sp.seats) * 3.16,
  }
}

/** best trimmed lift-to-drag ratio of the clean aircraft (M 0.5 at 10 km — below drag rise), over a range of weights */
export function ldMax(sp: Spec) {
  const m = model(sp.id, sp.confs), ms0 = loaded(m, sp, sp.fuelMax / 2), atm = isa(10000), V = 0.5 * atm.a
  let best = 0
  for (let k = 0.5; k <= 1.6; k += 0.05) {
    const ms = { ...ms0, m: ms0.m * k }
    const tr = trimLevel(m, ms, 10000, V)
    if (tr) best = Math.max(best, tr.lift / tr.drag)
  }
  return best
}

/** approach speed: 1.23 × the 1-g stall speed in the landing configuration (maximum lift from the lattice sweep) + 5 kt */
export function vapp(sp: Spec, fuel: number) {
  const m = model(sp.id, sp.confs), ms = loaded(m, sp, fuel)
  const clmax = m.stall[m.stall.length - 1].clmax
  return Math.sqrt((2 * ms.m * G) / (1.225 * m.aero.Sref * clmax)) / KT * 1.23 + 5
}
export const aspectRatio = (sp: Spec) => { const a = model(sp.id, sp.confs).aero; return (a.bref * a.bref) / a.Sref }
