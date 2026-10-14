import type { EngineGeo } from './geometry'

/*
 * Gas-turbine engine from component physics (a 0-D two-spool model, stations as in SAE AS755):
 *
 *   inlet (ram) → fan / booster → HP compressor → combustor → HP turbine → LP (or power) turbine → nozzles
 *
 * Compressors: pressure rise ∝ corrected speed², air flow ∝ corrected speed; turbines: work from the actual
 * expansion available between turbine entry pressure and the exhaust (so with little pressure — at a start —
 * they give almost nothing and the starter has to do the work); core air flow set by the choked HP-turbine
 * nozzle (W·√T4 / p4 = const); combustor temperature from the fuel energy; spool speeds from the power balance
 * of turbine against compressor and accessories on each shaft's inertia; thrust from the nozzle exit velocities
 * (choked or fully expanded) minus ram drag. The FADEC only meters fuel: it chases a fan-speed (or power) target
 * within acceleration / deceleration and temperature limits. Thrust lapse with altitude and speed, specific fuel
 * consumption, EGT, spool-up time, start, hung start, flame-out and windmilling all follow from this.
 *
 * The design point (sea-level static take-off) is matched once: turbine expansion ratios are chosen so that
 * each turbine exactly drives its compressor there — like an engine designer would. Everything off-design
 * is computed, not tabulated.
 *
 * Open fan: the LP turbine drives a variable-pitch rotor; thrust from actuator-disc momentum theory with a
 * profile efficiency that falls when the blade tips go transonic. Turbo-electric: a free power turbine drives
 * generators; electric ducted fans that ingest the body's boundary layer turn that power into thrust.
 */

const CP = 1005, CPG = 1150, GA = 1.4, GG = 1.33, R = 287
const EXA = (GA - 1) / GA, EXG = (GG - 1) / GG
const SLS = { T: 288.15, p: 101325 }

export interface Design {
  W2: number; Wc: number; fpr: number; lpc: number; hpc: number; T4: number
  Kch: number // W4·√T4 / p4
  piH: number; piL: number; piTot: number // turbine expansion ratios at design
  Wf: number // design fuel flow, kg/s
  p3: number // design compressor delivery pressure, Pa
  Pacc: number
  rotor?: { A: number; P: number } // open fan: disc area, design shaft power
  fan?: { Ae: number; P: number } // electric fans: exit area per fan, design power per core
}
export interface EngState { N1: number; N2: number; T4: number; Wf: number; lit: boolean; wfInt: number; P: number; prevErr: number }
export interface Amb { T0: number; p0: number; M: number; V: number; rho: number }
export interface EngOut { thrust: number; ff: number; egt: number; n1: number; n2: number; p3: number; T4: number; Phpt: number; Phpc: number; Pshaft: number; W2: number; oilP: number }

const etaC = 0.86, etaF = 0.89, etaT = 0.9, etaM = 0.99
const turbineTau = (pi: number) => 1 - etaT * (1 - Math.pow(Math.max(1, pi), -EXG))

/* ------------------------------------------------------------------ design-point matching */
export function design(g: EngineGeo): Design {
  const Tt2 = SLS.T, pt2 = SLS.p
  const core = g.kind === 'turbofan' ? g.W / (1 + g.bpr) : g.W
  const fan = g.kind === 'turbofan' ? g.fpr : 1
  const T21 = Tt2 * (1 + (Math.pow(fan, EXA) - 1) / etaF)
  const T25 = T21 * (1 + (Math.pow(g.lpc, EXA) - 1) / etaC)
  const pt25 = pt2 * fan * g.lpc
  const T3 = T25 * (1 + (Math.pow(g.hpc, EXA) - 1) / etaC), pt3 = pt25 * g.hpc
  const Wf = (core * CPG * (g.T4 - T3)) / (0.99 * g.lhv - CPG * g.T4)
  const W4 = core + Wf, pt4 = pt3 * g.pgain
  const Phpc = core * CP * (T3 - T25), Pacc = 120e3
  // HP turbine: just enough expansion to drive the compressor and accessories
  const tauH = 1 - (Phpc + Pacc) / (etaM * W4 * CPG * g.T4)
  const piH = Math.pow(1 - (1 - tauH) / etaT, -1 / EXG)
  const T45 = g.T4 * tauH, pt45 = pt4 / piH
  const Kch = (W4 * Math.sqrt(g.T4)) / pt4
  let piL: number, rotor: Design['rotor'], fanD: Design['fan']
  if (g.kind === 'turbofan') {
    const Pfan = g.W * CP * (T21 - Tt2) + core * CP * (T25 - T21)
    const tauL = 1 - Pfan / (etaM * W4 * CPG * T45)
    piL = Math.pow(1 - (1 - tauL) / etaT, -1 / EXG)
  } else {
    // power turbine expands down to just above ambient; the shaft power goes to the rotor / generators
    piL = pt45 / (1.12 * SLS.p)
    const tauL = turbineTau(piL), P = etaM * W4 * CPG * T45 * (1 - tauL) - core * CP * (T25 - Tt2)
    if (g.kind === 'openfan') rotor = { A: (Math.PI * g.fanD * g.fanD) / 4, P }
    else fanD = { Ae: 0.82 * (Math.PI * g.fanD * g.fanD) / 4, P }
  }
  return { W2: g.W, Wc: core, fpr: fan, lpc: g.lpc, hpc: g.hpc, T4: g.T4, Kch, piH, piL, piTot: piH * piL, Wf, p3: pt3, Pacc, rotor, fan: fanD }
}

export function newEngine(running: boolean, g: EngineGeo): EngState {
  return running ? { N1: g.kind === 'turbofan' ? 0.2 : 0.6, N2: 0.6, T4: 900, Wf: 0.08, lit: true, wfInt: 0, P: 0, prevErr: 0 } : { N1: 0, N2: 0, T4: 288, Wf: 0, lit: false, wfInt: 0, P: 0, prevErr: 0 }
}

/** nozzle: exit velocity and pressure thrust per unit flow for total conditions pt, Tt into ambient p0 */
function nozzle(pt: number, Tt: number, p0: number, g: number, cp: number) {
  const crit = Math.pow((g + 1) / 2, g / (g - 1))
  const pr = pt / p0
  if (pr <= 1) return { V: 0, Fp: 0 }
  if (pr >= crit) {
    const Te = (Tt * 2) / (g + 1), Ve = Math.sqrt(g * R * Te), pe = pt / crit
    const rhoe = pe / (R * Te)
    return { V: Ve * 0.985, Fp: (pe - p0) / (rhoe * Ve) } // pressure thrust per unit mass flow (A = W / ρV)
  }
  return { V: 0.985 * Math.sqrt(2 * cp * Tt * (1 - Math.pow(1 / pr, (g - 1) / g))), Fp: 0 }
}

export interface Cmd {
  target: number // FADEC target: N1 (turbofan) or core N2 (open fan, turbo-electric), fraction
  fuel: boolean // fuel valve open (master ON, tank feeding)
  ignite: boolean // igniters firing
  starter: number // starter power available, W
  rev: number // 0 / 1 idle reverse / 2 max reverse
  bleed: number // air taken for the cabin, kg/s
  leverStart: number // thrust-lever position during a start (over-fuelling)
  n2min?: number // idle core speed
  starting?: boolean // start sequence in progress (start fuel schedule and EGT limiter)
  fanPower?: number // turbo-electric: electrical power drawn by the fans, W (from the shared bus)
}

/** one integration step of one engine */
export function engineStep(e: EngState, g: EngineGeo, d: Design, a: Amb, cmd: Cmd, dt: number): EngOut {
  // inlet
  const Tt2 = a.T0 * (1 + 0.2 * a.M * a.M), pt2 = a.p0 * Math.pow(1 + 0.2 * a.M * a.M, 3.5) * 0.995
  const th2 = Tt2 / SLS.T, de2 = pt2 / SLS.p
  const N1c = e.N1 / Math.sqrt(th2)
  // fan and booster (LP spool)
  const fanPR = g.kind === 'turbofan' ? 1 + (d.fpr - 1) * Math.pow(Math.max(0, N1c), 2.1) : 1
  const W2 = g.kind === 'turbofan' ? (d.W2 * Math.pow(Math.max(0, N1c), 1.25) * de2) / Math.sqrt(th2) : 0
  const T21 = Tt2 * (1 + (Math.pow(fanPR, EXA) - 1) / etaF)
  const lpcN = g.kind === 'turbofan' ? N1c : e.N2 / Math.sqrt(th2)
  const lpcPR = 1 + (d.lpc - 1) * Math.pow(Math.max(0, lpcN), 2)
  const T25 = T21 * (1 + (Math.pow(lpcPR, EXA) - 1) / etaC), pt25 = pt2 * fanPR * lpcPR
  // HP compressor
  const N2c = e.N2 / Math.sqrt(T25 / 380)
  const hpcPR = 1 + (d.hpc - 1) * Math.pow(Math.max(0, N2c), 2.4)
  const T3 = T25 * (1 + (Math.pow(hpcPR, EXA) - 1) / etaC), pt3 = pt25 * hpcPR
  // core flow through the choked HP-turbine nozzle guide vanes
  const pt4 = pt3 * g.pgain
  const W4 = Math.max(0.05, (d.Kch * pt4) / Math.sqrt(Math.max(250, e.T4)))
  const Wc = Math.max(0.05, W4 - e.Wf - cmd.bleed)
  // combustor
  const T4t = e.lit && e.Wf > 0 ? T3 + (e.Wf * 0.99 * g.lhv) / (W4 * CPG) : T3
  e.T4 += (Math.min(2300, T4t) - e.T4) * Math.min(1, dt / 0.06)
  // turbines: the available expansion is shared in the design proportions
  const piAvail = Math.max(1, pt4 / (a.p0 * 1.03))
  // the HP turbine (choked nozzle right behind the combustor) gets its expansion first; the LP turbine
  // takes most of what is left, the nozzle the rest — at low power the LP turbine is starved
  const piH = Math.min(d.piH, Math.pow(piAvail, 0.8))
  const piL = g.kind === 'turbofan' ? Math.min(d.piL, Math.pow(piAvail / piH, 0.72)) : Math.max(1, piAvail / piH / 1.06)
  const tauH = turbineTau(piH), tauL = turbineTau(piL)
  const Phpt = etaM * W4 * CPG * e.T4 * (1 - tauH)
  const T45 = e.T4 * tauH
  const Plpt = etaM * W4 * CPG * T45 * (1 - tauL)
  const T5 = T45 * tauL, pt5 = pt4 / piH / piL
  const Phpc = Wc * CP * (T3 - T25)
  const Plpc = Wc * CP * (T25 - T21) + (g.kind === 'turbofan' ? 0 : 0)
  const Pfan = g.kind === 'turbofan' ? W2 * CP * (T21 - Tt2) : 0
  // windmilling: the airstream drives the unpowered rotors
  const wind = 0.5 * a.rho * a.V * a.V * a.V * (Math.PI * g.fanD * g.fanD) / 4 * 0.02
  // HP spool
  const w2 = Math.max(30, e.N2 * ((g.n2 * 2 * Math.PI) / 60))
  const dP2 = Phpt - Phpc - d.Pacc * e.N2 * e.N2 + cmd.starter + wind * 0.15 - 3000 * e.N2 * e.N2
  e.N2 = Math.max(0, e.N2 + (dP2 / (g.I2 * w2)) * dt / ((g.n2 * 2 * Math.PI) / 60))
  // LP spool and what it drives
  let thrust = 0, Pshaft = 0
  const w1 = Math.max(10, e.N1 * ((g.n1 * 2 * Math.PI) / 60))
  if (g.kind === 'turbofan') {
    const dP1 = Plpt - Pfan - Plpc + wind - 2000 * e.N1
    e.N1 = Math.max(0, e.N1 + (dP1 / (g.I1 * w1)) * dt / ((g.n1 * 2 * Math.PI) / 60))
    // nozzles: bypass (cold) and core (hot)
    const W13 = Math.max(0, W2 - Wc)
    const nb = nozzle(pt2 * fanPR * 0.98, T21, a.p0, GA, CP), nc = nozzle(pt5 * 0.98, T5, a.p0, GG, CPG)
    const Fb = W13 * (nb.V + nb.Fp), Fc = (Wc + e.Wf) * (nc.V + nc.Fp)
    if (cmd.rev > 0) thrust = -0.42 * W13 * nb.V + Fc * 0.6 - (W13 + Wc) * a.V
    else thrust = Fb + Fc - (W13 + Wc) * a.V
    Pshaft = Pfan
  } else if (g.kind === 'openfan') {
    // the variable-pitch rotor absorbs the power turbine's output at its governed speed
    Pshaft = Math.max(0, Plpt - Plpc)
    e.N1 += ((e.N2 > 0.5 ? 0.6 + 0.4 * Math.min(1, Pshaft / (d.rotor!.P * 0.9)) : e.N2) - e.N1) * Math.min(1, dt / 1.5)
    const tipM = Math.hypot((Math.PI * g.fanD * e.N1 * g.n1) / 60, a.V) / Math.sqrt(1.4 * R * a.T0)
    const etaP = 0.88 * (tipM > 1.0 ? Math.max(0.5, 1 - 2.2 * (tipM - 1.0)) : 1)
    thrust = actuatorDisc(Pshaft * etaP, a.V, a.rho, d.rotor!.A)
    if (cmd.rev > 0) thrust = -0.45 * actuatorDisc(Pshaft * etaP, 0, a.rho, d.rotor!.A) * Math.min(1, cmd.rev === 2 ? 1 : 0.4)
    const nc = nozzle(pt5 * 0.98, T5, a.p0, GG, CPG)
    thrust += (Wc + e.Wf) * nc.V - Wc * a.V
  } else {
    // turbo-electric: the power turbine drives generators; the fans' thrust is computed by the airframe from the bus power
    Pshaft = Math.max(0, Plpt - Plpc) * 0.99
    const demand = cmd.fanPower ?? Pshaft
    const dP1 = Pshaft - demand - 1500 * e.N1
    e.N1 = Math.max(0, Math.min(1.05, e.N1 + (dP1 / (g.I1 * w1)) * dt / ((g.n1 * 2 * Math.PI) / 60)))
    const nc = nozzle(pt5 * 0.98, T5, a.p0, GG, CPG)
    thrust = (Wc + e.Wf) * nc.V - Wc * a.V
  }
  e.P = Pshaft
  // FADEC: meters fuel toward the target speed, inside the surge (acceleration) and flame-out (deceleration) limits
  if (cmd.fuel && e.lit) {
    const speed = g.kind === 'turbofan' ? e.N1 : e.N2
    // the FADEC also keeps the core above its idle speed (enough air for the packs, generators and anti-ice)
    const err = Math.max(cmd.target - speed, 1.5 * ((cmd.n2min ?? 0.58) - e.N2))
    const ratio = d.Wf / d.p3 // design fuel flow per unit compressor delivery pressure ("ratio units")
    // acceleration schedule (surge margin) and the turbine-temperature limiter; a thrust lever left open during a
    // start over-rides the start schedule and over-fuels the engine
    const t4lim = cmd.starting && cmd.leverStart < 0.05 ? 1120 : d.T4 * 1.06
    const wfMax = ratio * pt3 * (cmd.starting ? 0.9 : 1.15) * (1 + 1.5 * cmd.leverStart) * (e.T4 > t4lim ? 0.85 : 1)
    const wfMin = ratio * pt3 * 0.32
    // PI governor acting on the fuel flow (velocity form)
    const want = e.Wf + (2.2 * (err - e.prevErr) + 1.1 * err * dt) * d.Wf
    e.prevErr = err
    e.Wf = Math.max(wfMin, Math.min(wfMax, want))
    if (e.N2 > 1.05) e.Wf *= 0.98
  } else if (cmd.fuel && cmd.ignite && e.N2 >= 0.16) {
    // light-off: the start fuel schedule
    e.lit = true; e.Wf = d.Wf * 0.025 * (1 + 2.5 * cmd.leverStart)
  } else { e.Wf = 0; if (!cmd.fuel) e.lit = false }
  if (e.lit && e.N2 < 0.1) e.lit = false // blown out
  // EGT: measured between the turbines (station 4.95)
  const egt = T45 - 0.35 * (T45 - T5)
  return { thrust, ff: e.Wf * 3600, egt: egt - 273.15, n1: e.N1 * 100, n2: e.N2 * 100, p3: pt3, T4: e.T4, Phpt, Phpc, Pshaft, W2, oilP: e.N2 > 0.2 ? 12 + 40 * e.N2 : e.N2 * 60 }
}

/** thrust of a disc of area A absorbing power P at flight speed V (momentum theory), Newton iterations */
export function actuatorDisc(P: number, V: number, rho: number, A: number) {
  if (P <= 0) return 0
  let T = Math.pow(P * P * 2 * rho * A, 1 / 3) // static guess
  for (let i = 0; i < 20; i++) {
    const vi = 0.5 * (-V + Math.sqrt(V * V + (2 * T) / (rho * A)))
    const f = T * (V + vi) - P
    const dvi = 1 / (2 * rho * A * Math.sqrt(V * V + (2 * T) / (rho * A)))
    const df = V + vi + T * dvi
    T = Math.max(1, T - f / df)
  }
  return T
}

/**
 * electric ducted fan with boundary-layer ingestion: the inlet takes in air slowed by the body's skin friction
 * (velocity deficit `bli`), so the same thrust needs less power. Returns the net thrust of one fan.
 */
export function bliFan(P: number, V: number, rho: number, Ae: number, bli: number) {
  if (P <= 0) return 0
  const Vin = V * (1 - bli)
  let Vj = Math.max(Vin + 5, 40)
  for (let i = 0; i < 25; i++) {
    const f = 0.5 * rho * Ae * Vj * (Vj * Vj - Vin * Vin) - P * 0.9
    const df = 0.5 * rho * Ae * (3 * Vj * Vj - Vin * Vin)
    Vj = Math.max(Vin + 0.1, Vj - f / df)
  }
  return rho * Ae * Vj * (Vj - Vin)
}
