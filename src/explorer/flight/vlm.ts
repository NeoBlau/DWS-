import type { Geo, Surface, CtrlKind, Body } from './geometry'
import type { Section } from '../../utils/geom'

/*
 * Aerodynamics from geometry — a vortex-lattice method (one chordwise horseshoe per spanwise strip, Weissinger)
 * on the real wing, sharklets, tailplane and fin of the 3D model, plus a component drag build-up and slender-body
 * forces for the fuselage and nacelles.
 *
 * What comes out of the solution rather than being typed in: lift-curve slope and its change with aspect ratio
 * and Mach (Göthert/Prandtl–Glauert), spanwise lift distribution, induced drag, downwash on the tailplane,
 * the neutral point and static margin, pitch / roll / yaw damping, dihedral effect, adverse yaw, control
 * power of every flap and control surface, ground effect (mirror image vortices), tip stall and wing drop.
 * Section behaviour (camber, maximum lift, flap effectiveness by thin-airfoil theory, skin friction by Reynolds
 * number, form factors, Korn wave drag) is classical airfoil data, not aircraft-level tuning.
 */

export interface Panel {
  strip: number // index of the spanwise strip this chordwise panel belongs to
  f0: number; f1: number // chord fractions covered by this panel
  surf: Surface['id']; side: 1 | -1
  A: number[]; B: number[]; cp: number[]; mid: number[]; n: number[]; s: number[] // body/drawing frame
  chord: number; area: number; tc: number; cosL: number; station: number
  inc: number; camber: number; clmax: number; cm0: number; laminar: number
  ctrl: Partial<Record<CtrlKind, number>> // chord fraction of the device over this strip
  tank: boolean
  inBody: boolean // wing carry-through inside the fuselage: the body sets the flow there, it has no section stall of its own
}
export interface Ctl { elev: number; ths: number; ail: number; rud: number; splL: number; splR: number; gnd: number; flap: number; slat: number; gear: number; flapL: number; flapR: number } // flapL/R: 1 = flap there, 0 = torn off
interface Sys { mach: number; alpha: number; lu: Float64Array; piv: Int32Array; B: Float64Array[] }
export interface Strip { panels: number[]; surf: Surface['id']; side: 1 | -1; chord: number; area: number; mid: number[]; s: number[]; P: Panel }
export interface Aero {
  geo: Geo; panels: Panel[]; N: number; strips: Strip[]
  sys: Sys | null
  img: { key: number; t: number; V: Float64Array[] } | null // ground-image velocities at the control points, per strip of unit circulation
  gPrev: Float64Array
  bodies: { b: Body; vol: number; xv: number; yv: number; swet: number; len: number; dmax: number; plan: number; z: number }[]
  Sref: number; bref: number; cref: number; xref: number
  cache: { t: number }
  flat: { cp: Float64Array; mid: Float64Array; n: Float64Array; l: Float64Array; strip: Int32Array; tail: Uint8Array } // panel data packed for the hot loops
}

/* ------------------------------------------------------------------ geometry → panels */
const lerpS = (a: Section, b: Section, k: number): Section => ({ le: a.le + (b.le - a.le) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, chord: a.chord + (b.chord - a.chord) * k, t: a.t + (b.t - a.t) * k })
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: number[], b: number[]) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: number[], k: number) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: number[]) => Math.hypot(a[0], a[1], a[2])
const unit = (a: number[]) => mul(a, 1 / (len(a) || 1))

function stationAt(sections: Section[], u: number, vertical: boolean) {
  // arc-length parametrisation along the span
  const d = [0]
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1], b = sections[i]
    d.push(d[i - 1] + Math.hypot(b.z - a.z, b.y - a.y, vertical ? 0 : 0))
  }
  const L = d[d.length - 1], target = u * L
  let i = 0
  while (i < sections.length - 2 && target > d[i + 1]) i++
  const k = (target - d[i]) / Math.max(1e-9, d[i + 1] - d[i])
  return lerpS(sections[i], sections[i + 1], Math.max(0, Math.min(1, k)))
}

const CHORDWISE: Record<Surface['id'], number> = { wing: 2, htail: 2, fin: 2, winglet: 1 }
function buildPanels(geo: Geo) {
  const out: Panel[] = []
  const fus = geo.bodies.find((b) => b.kind === 'fuselage')
  for (const sf of geo.surfaces) {
    const N = sf.panels, NC = sf.chordwise ?? CHORDWISE[sf.id]
    const halves: (1 | -1)[] = sf.vertical && !sf.pair ? [1] : [1, -1]
    for (const side of halves) {
      for (let k = 0; k < N; k++) {
        // half-cosine spacing: dense toward the tip, where lift changes fastest
        const u0 = 1 - Math.cos((Math.PI / 2) * (k / N)), u1 = 1 - Math.cos((Math.PI / 2) * ((k + 1) / N)), um = (u0 + u1) / 2
        const S0 = stationAt(sf.sections, u0, !!sf.vertical), S1 = stationAt(sf.sections, u1, !!sf.vertical), Sm = stationAt(sf.sections, um, !!sf.vertical)
        const station = sf.vertical && !sf.pair ? Sm.y : Math.abs(Sm.z)
        const leA = [S0.le, S0.y, S0.z], leB = [S1.le, S1.y, S1.z]
        const cosL = Math.cos(Math.atan2(Math.abs((S0.le - 0.25 * S0.chord) - (S1.le - 0.25 * S1.chord)), Math.max(1e-6, Math.hypot(leA[1] - leB[1], leA[2] - leB[2]))))
        const strip = out.length ? out[out.length - 1].strip + 1 : 0
        for (let j = 0; j < NC; j++) {
          const f0 = j / NC, f1 = (j + 1) / NC
          const q = (S: Section, f: number) => [S.le - f * S.chord, S.y, S.z]
          let P0 = q(S0, f0 + 0.25 * (f1 - f0)), P1 = q(S1, f0 + 0.25 * (f1 - f0)), cp = q(Sm, f0 + 0.75 * (f1 - f0))
          if (sf.pair) {
            const root = sf.sections[0].y
            const rot = (p: number[]) => { const dy = p[1] - root, c = Math.cos(sf.cant ?? 0), sn = Math.sin(sf.cant ?? 0); return [p[0], root + dy * c, (sf.pair ?? 0) + dy * sn] }
            P0 = rot(P0); P1 = rot(P1); cp = rot(cp)
          }
          if (side === -1) { P0 = [P0[0], P0[1], -P0[2]]; P1 = [P1[0], P1[1], -P1[2]]; cp = [cp[0], cp[1], -cp[2]] }
          // the bound vortex always runs left → right (or bottom → top) so a positive circulation means positive lift
          let A = P0, B = P1
          if (!sf.vertical && A[2] > B[2]) { A = P1; B = P0 }
          const sv = unit(sub(B, A))
          const n = unit(cross([-1, 0, 0], sv))
          // planform area: chord (along the flow) × width across the flow — not the swept length of the bound vortex
          const span = Math.hypot(B[1] - A[1], B[2] - A[2])
          const ctrl: Panel['ctrl'] = {}
          // a device covers this chordwise panel by the overlap of [1 − cf, 1] (trailing edge) or [0, cf] (leading edge)
          for (const c of sf.ctrls) if (station >= c.z0 && station <= c.z1) {
            const lead = c.kind === 'slat' || c.kind === 'krueger'
            const lo = lead ? 0 : 1 - c.cf, hi = lead ? c.cf : 1
            const ov = Math.max(0, Math.min(f1, hi) - Math.max(f0, lo)) / (f1 - f0)
            if (ov > 0) ctrl[c.kind] = ov
          }
          out.push({
            strip, f0, f1, surf: sf.id, side, A, B, cp, mid: mul(add(A, B), 0.5), n, s: sv, chord: Sm.chord, area: span * Sm.chord * (f1 - f0), tc: Sm.t, cosL: Math.max(0.5, cosL), station,
            inc: sf.inc[0] + (sf.inc[1] - sf.inc[0]) * um, camber: sf.camber, clmax: sf.clmax, cm0: sf.cm0, laminar: sf.id === 'wing' && geo.engine.kind === 'openfan' ? 0.35 : 0.05,
            ctrl, tank: !!sf.tank && station >= sf.tank[0] && station <= sf.tank[1],
            inBody: sf.id === 'wing' && !!fus && station < 0.9 * fus.r(Sm.le - 0.4 * Sm.chord),
          })
        }
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ Biot–Savart */
const FAR = 2e4
/** velocity induced at P by a straight vortex segment P1→P2 of unit strength */
function seg(P: number[], P1: number[], P2: number[], out: number[]) {
  const r1x = P[0] - P1[0], r1y = P[1] - P1[1], r1z = P[2] - P1[2]
  const r2x = P[0] - P2[0], r2y = P[1] - P2[1], r2z = P[2] - P2[2]
  const cx = r1y * r2z - r1z * r2y, cy = r1z * r2x - r1x * r2z, cz = r1x * r2y - r1y * r2x
  const c2 = cx * cx + cy * cy + cz * cz
  const l1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z), l2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z)
  const r0x = P2[0] - P1[0], r0y = P2[1] - P1[1], r0z = P2[2] - P1[2]
  const core = 1e-4 * (r0x * r0x + r0y * r0y + r0z * r0z) + 1e-6
  if (c2 < core || l1 < 1e-6 || l2 < 1e-6) return
  const k = (r0x * (r1x / l1 - r2x / l2) + r0y * (r1y / l1 - r2y / l2) + r0z * (r1z / l1 - r2z / l2)) / (4 * Math.PI * c2)
  out[0] += k * cx; out[1] += k * cy; out[2] += k * cz
}
/** unit horseshoe: trailing leg from far downstream to A, bound A→B, trailing leg B → far downstream */
function horseshoe(P: number[], A: number[], B: number[], st: number, out: number[], skipBound = false, wake = [1, 0]) {
  // trailing legs follow the free stream: back along −x, rising at the angle of attack
  const Af = [A[0] - FAR * wake[0], A[1] + FAR * wake[1], A[2]], Bf = [B[0] - FAR * wake[0], B[1] + FAR * wake[1], B[2]]
  const p = [P[0] * st, P[1], P[2]], a = [A[0] * st, A[1], A[2]], b = [B[0] * st, B[1], B[2]]
  const af = [Af[0] * st, Af[1], Af[2]], bf = [Bf[0] * st, Bf[1], Bf[2]]
  seg(p, af, a, out)
  if (!skipBound) seg(p, a, b, out)
  seg(p, b, bf, out)
}

/** ground plane in the drawing frame, from the attitude and height (for mirror vortices) */
export interface GroundPlane { on: boolean; n: number[]; d: number } // points with dot(n,x) = d lie on the ground
function mirror(p: number[], g: GroundPlane) { const k = 2 * (dot(g.n, p) - g.d); return [p[0] - k * g.n[0], p[1] - k * g.n[1], p[2] - k * g.n[2]] }

function solveSystem(ae: Aero, mach: number, alpha: number): Sys {
  const P = ae.panels, N = P.length
  const beta = Math.sqrt(Math.max(0.15, 1 - mach * mach)), st = 1 / beta // Göthert: stretch x by 1/β
  const wake = [Math.cos(alpha), Math.sin(alpha)]
  const A = new Float64Array(N * N)
  const B = [new Float64Array(N * N), new Float64Array(N * N), new Float64Array(N * N)]
  const v = [0, 0, 0]
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      v[0] = v[1] = v[2] = 0
      horseshoe(P[i].cp, P[j].A, P[j].B, st, v, false, wake)
      A[i * N + j] = v[0] * st * P[i].n[0] + v[1] * P[i].n[1] + v[2] * P[i].n[2]
      v[0] = v[1] = v[2] = 0
      horseshoe(P[i].mid, P[j].A, P[j].B, st, v, i === j, wake)
      B[0][i * N + j] = v[0] * st; B[1][i * N + j] = v[1]; B[2][i * N + j] = v[2]
    }
  }
  // LU with partial pivoting
  const piv = new Int32Array(N)
  for (let k = 0; k < N; k++) {
    let p = k, mx = Math.abs(A[k * N + k])
    for (let i = k + 1; i < N; i++) { const a = Math.abs(A[i * N + k]); if (a > mx) { mx = a; p = i } }
    piv[k] = p
    if (p !== k) for (let j = 0; j < N; j++) { const t = A[k * N + j]; A[k * N + j] = A[p * N + j]; A[p * N + j] = t }
    const d = A[k * N + k] || 1e-12
    for (let i = k + 1; i < N; i++) {
      const f = (A[i * N + k] /= d)
      if (f) for (let j = k + 1; j < N; j++) A[i * N + j] -= f * A[k * N + j]
    }
  }
  return { mach, alpha, lu: A, piv, B }
}
/** velocity the mirror image (below the ground) of each strip's vortices induces at every control point and mid-point */
function groundImages(ae: Aero, g: GroundPlane) {
  const P = ae.panels, N = P.length, S = ae.strips.length
  const V = [new Float64Array(N * S), new Float64Array(N * S), new Float64Array(N * S), new Float64Array(N * S), new Float64Array(N * S), new Float64Array(N * S)]
  const v = [0, 0, 0]
  for (let k = 0; k < S; k++) {
    const st = ae.strips[k], p0 = P[st.panels[0]]
    const a = mirror(p0.B, g), b = mirror(p0.A, g) // a mirror image reverses the vortex direction
    for (let i = 0; i < N; i++) {
      v[0] = v[1] = v[2] = 0; horseshoe(P[i].cp, a, b, 1, v)
      V[0][i * S + k] = v[0]; V[1][i * S + k] = v[1]; V[2][i * S + k] = v[2]
      v[0] = v[1] = v[2] = 0; horseshoe(P[i].mid, a, b, 1, v)
      V[3][i * S + k] = v[0]; V[4][i * S + k] = v[1]; V[5][i * S + k] = v[2]
    }
  }
  return V
}
function luSolve(s: Sys, N: number, b: Float64Array) {
  const A = s.lu
  for (let k = 0; k < N; k++) { const p = s.piv[k]; if (p !== k) { const t = b[k]; b[k] = b[p]; b[p] = t } }
  for (let i = 1; i < N; i++) { let sum = b[i]; for (let j = 0; j < i; j++) sum -= A[i * N + j] * b[j]; b[i] = sum }
  for (let i = N - 1; i >= 0; i--) { let sum = b[i]; for (let j = i + 1; j < N; j++) sum -= A[i * N + j] * b[j]; b[i] = sum / A[i * N + i] }
}

/* ------------------------------------------------------------------ build */
function bodyProps(b: Body) {
  const n = 80, dx = (b.x1 - b.x0) / n
  let vol = 0, xv = 0, yv = 0, swet = 0, dmax = 0, plan = 0
  for (let i = 0; i < n; i++) {
    const x = b.x0 + (i + 0.5) * dx, r = Math.max(0, b.r(x))
    vol += Math.PI * r * r * dx; xv += Math.PI * r * r * dx * x; yv += Math.PI * r * r * dx * b.y(x)
    swet += 2 * Math.PI * r * dx; plan += 2 * r * dx; dmax = Math.max(dmax, 2 * r)
  }
  return { b, vol, xv: xv / Math.max(1e-9, vol), yv: yv / Math.max(1e-9, vol), swet: b.wet ?? swet, len: b.x1 - b.x0, dmax, plan, z: b.z }
}
export function buildAero(geo: Geo): Aero {
  const panels = buildPanels(geo)
  const wing = panels.filter((p) => p.surf === 'wing')
  const Sref = wing.reduce((s, p) => s + p.area, 0)
  const ys = wing.map((p) => Math.abs(p.mid[2]))
  const bref = 2 * Math.max(...ys) + 2 * (wing.reduce((m, p) => Math.max(m, Math.abs(p.B[2]), Math.abs(p.A[2])), 0) - Math.max(...ys))
  // mean aerodynamic chord: ∫c² / ∫c
  const cref = wing.reduce((s, p) => s + p.chord * p.area, 0) / Sref
  // leading edge of the mean aerodynamic chord (area × chord weighted)
  const xref = wing.reduce((s, p) => s + (p.mid[0] + (p.f0 + 0.25 * (p.f1 - p.f0)) * p.chord) * p.area * p.chord, 0) / wing.reduce((s, p) => s + p.area * p.chord, 0)
  const strips: Strip[] = []
  panels.forEach((p, i) => {
    let st = strips[p.strip]
    if (!st) { st = strips[p.strip] = { panels: [], surf: p.surf, side: p.side, chord: p.chord, area: 0, mid: [0, 0, 0], s: p.s, P: p }; }
    st.panels.push(i); st.area += p.area
  })
  for (const st of strips) { const a = panels[st.panels[0]]; const q = a.mid; st.mid = [q[0] - 0.0 * a.chord, q[1], q[2]] }
  const bodies: Aero['bodies'] = []
  for (const b of geo.bodies) { const pr = bodyProps(b); bodies.push(pr); if (b.mirror) bodies.push({ ...pr, z: -b.z }) }
  const N = panels.length
  const flat = { cp: new Float64Array(3 * N), mid: new Float64Array(3 * N), n: new Float64Array(3 * N), l: new Float64Array(3 * N), strip: new Int32Array(N), tail: new Uint8Array(N) }
  panels.forEach((p, i) => {
    for (let k = 0; k < 3; k++) { flat.cp[3 * i + k] = p.cp[k]; flat.mid[3 * i + k] = p.mid[k]; flat.n[3 * i + k] = p.n[k]; flat.l[3 * i + k] = p.B[k] - p.A[k] }
    flat.strip[i] = p.strip; flat.tail[i] = p.surf === 'htail' ? 1 : p.surf === 'fin' ? 2 : 0
  })
  return { geo, panels, N, strips, sys: null, img: null, gPrev: new Float64Array(strips.length), bodies, Sref, bref, cref, xref, cache: { t: -1 }, flat }
}

/* ------------------------------------------------------------------ section physics */
/** thin-airfoil flap effectiveness τ for a plain flap of chord fraction cf */
const tau = (cf: number) => { const th = Math.acos(2 * cf - 1); return 1 - (th - Math.sin(th)) / Math.PI }
/** large deflections lose effectiveness (flow separation on the flap) */
const etaD = (d: number) => { const a = Math.abs(d); return a < 0.17 ? 1 : Math.max(0.45, 1 - 0.95 * (a - 0.17)) }
function skinCf(Re: number, M: number, lam: number) {
  const turb = 0.455 / (Math.pow(Math.log10(Math.max(1e5, Re)), 2.58) * Math.pow(1 + 0.144 * M * M, 0.65))
  const laminar = 1.328 / Math.sqrt(Math.max(1e5, Re))
  return lam * laminar + (1 - lam) * turb
}

export interface AeroIn {
  rho: number; a: number; mu: number
  v: number[] // aircraft velocity of the CG, body frame
  w: number[] // body rates (x roll, y yaw, z pitch as in the FDM)
  cg: number[] // CG in the drawing frame
  ctl: Ctl
  ground: GroundPlane
  t: number
  fixWake?: number // use this wake angle (for sweeps), instead of following the angle of attack
}
export interface AeroOut {
  F: number[]; M: number[]
  lift: number; drag: number; dragInduced: number; dragParasite: number; dragWave: number
  CL: number; wingStall: number; stalledL: number; stalledR: number
  tailLift: number; finSide: number
}
const RHS = new Map<Aero, Float64Array>()
const WORK = new Map<Aero, { dAlpha: Float64Array; dClmax: Float64Array; dCd: Float64Array; kst: Float64Array; sepA: Float64Array; clS: Float64Array; Umid: number[][] }>()
function work(ae: Aero) {
  let w = WORK.get(ae)
  if (!w) { const N = ae.N, S = ae.strips.length; w = { dAlpha: new Float64Array(N), dClmax: new Float64Array(S), dCd: new Float64Array(S), kst: new Float64Array(S), sepA: new Float64Array(S), clS: new Float64Array(S), Umid: Array.from({ length: N }, () => [0, 0, 0]) }; WORK.set(ae, w) }
  return w
}
/** plain-flap effectiveness by thin-airfoil theory (kept for reference: the lattice now deflects the panels itself) */
export const flapTau = tau

export function aeroForces(ae: Aero, inp: AeroIn): AeroOut {
  const P = ae.panels, N = ae.N, SN = ae.strips.length
  const V = len(inp.v), M = V / inp.a
  // the influence system depends on Mach (Göthert stretch) and on the wake direction (angle of attack)
  const bucket = Math.round(Math.min(0.86, M) / 0.05) * 0.05
  const aB = inp.fixWake ?? Math.round(Math.atan2(-inp.v[1], Math.max(1, inp.v[0])) / (3 * Math.PI / 180)) * (3 * Math.PI / 180)
  if (!ae.sys || Math.abs(ae.sys.mach - bucket) > 1e-6 || Math.abs(ae.sys.alpha - aB) > 1e-6) ae.sys = solveSystem(ae, bucket, Math.max(-0.1, Math.min(0.3, aB)))
  const sys = ae.sys
  // near the ground: mirror-image vortices (ground effect), refreshed a few times a second
  if (inp.ground.on) {
    const key = Math.round(inp.ground.d * 4) / 4
    if (!ae.img || Math.abs(ae.img.key - key) > 1e-6 || inp.t - ae.img.t > 0.25) ae.img = { key, t: inp.t, V: groundImages(ae, inp.ground) }
  } else ae.img = null
  const beta = Math.sqrt(Math.max(0.15, 1 - bucket * bucket))
  let rhs = RHS.get(ae)
  if (!rhs || rhs.length !== N) { rhs = new Float64Array(N); RHS.set(ae, rhs) }
  const c = inp.ctl
  // per-panel geometry changes: incidence, camber, flaps and control surfaces really deflect the panels they cover
  const ws = work(ae)
  const dAlpha = ws.dAlpha, dClmax = ws.dClmax.fill(0), dCd = ws.dCd.fill(0)
  const flapR = (c.flap * Math.PI) / 180, slatF = Math.min(1, c.slat / 25)
  for (let i = 0; i < N; i++) {
    const p = P[i], k = p.ctrl
    let da = p.inc - p.camber
    const fs = p.side === 1 ? c.flapR : c.flapL
    if (k.flap !== undefined && flapR > 0 && fs > 0) {
      const ext = 0.28 * Math.min(1, flapR / 0.52) // Fowler: the flap slides aft and adds chord
      da += k.flap * etaD(flapR) * flapR * (1 + ext)
      if (p.f1 >= 0.999) { dClmax[p.strip] += 0.7 * Math.min(1, flapR / 0.6); dCd[p.strip] += 0.9 * Math.pow(0.3, 1.38) * Math.sin(flapR) ** 2 }
    }
    if ((k.slat !== undefined || k.krueger !== undefined) && slatF > 0) {
      da -= 0.25 * slatF * 0.4
      if (p.f0 === 0) { dClmax[p.strip] += (k.slat !== undefined ? 0.95 : 0.8) * slatF; dCd[p.strip] += 0.003 * slatF }
    }
    if (k.aileron !== undefined) da += k.aileron * etaD(c.ail) * c.ail * (p.side === 1 ? -1 : 1)
    if (k.elevon !== undefined) {
      const pitch = -(c.elev + c.ths * 0.6), roll = p.station > 13.9 ? c.ail * (p.side === 1 ? -1 : 1) : 0
      da += k.elevon * etaD(pitch + roll) * (pitch + roll)
    }
    if (p.surf === 'htail') { da -= c.ths; if (k.elevator !== undefined) da -= k.elevator * etaD(c.elev) * c.elev }
    if (k.rudder !== undefined) da += k.rudder * etaD(c.rud) * c.rud
    if (k.spoiler !== undefined) {
      const sp = Math.max(c.gnd, p.side === 1 ? c.splR : c.splL)
      da -= 0.45 * sp * k.spoiler
      if (p.f1 >= 0.999) { dClmax[p.strip] -= 0.45 * sp; dCd[p.strip] += 0.12 * sp }
    }
    dAlpha[i] = da
  }
  // local air velocity at each control point (aircraft motion + rotation) → boundary condition
  const w = inp.w, img = ae.img, cg = inp.cg, v = inp.v
  const Umid: number[][] = ws.Umid
  const FL = ae.flat, CP = FL.cp, MID = FL.mid, NN = FL.n
  const v0 = v[0], v1 = v[1], v2 = v[2], w0 = w[0], w1 = w[1], w2 = w[2], c0 = cg[0], c1 = cg[1], c2 = cg[2]
  for (let i = 0; i < N; i++) {
    const i3 = 3 * i
    const rx = CP[i3] - c0, ry = CP[i3 + 1] - c1, rz = CP[i3 + 2] - c2
    let ux = -(v0 + w1 * rz - w2 * ry), uy = -(v1 + w2 * rx - w0 * rz), uz = -(v2 + w0 * ry - w1 * rx)
    const mx = MID[i3] - c0, my = MID[i3 + 1] - c1, mz = MID[i3 + 2] - c2, um = Umid[i]
    um[0] = -(v0 + w1 * mz - w2 * my); um[1] = -(v1 + w2 * mx - w0 * mz); um[2] = -(v2 + w0 * my - w1 * mx)
    if (img) { const V0 = img.V[0], V1 = img.V[1], V2 = img.V[2], gp = ae.gPrev; for (let k = 0, ik = i * SN; k < SN; k++, ik++) { const g = gp[k]; ux += V0[ik] * g; uy += V1[ik] * g; uz += V2[ik] * g } }
    rhs[i] = -(ux * NN[i3] + uy * NN[i3 + 1] + uz * NN[i3 + 2]) - Math.sqrt(ux * ux + uy * uy + uz * uz) * dAlpha[i]
  }
  luSolve(sys, N, rhs)
  for (let i = 0; i < N; i++) rhs[i] /= beta // compressibility (Prandtl–Glauert on the stretched geometry)
  // strip circulation → section lift coefficient → stall
  const kst = ws.kst, sepA = ws.sepA.fill(0), clS = ws.clS
  let stL = 0, stR = 0, nW = 0
  const machF = 1 - 0.55 * Math.max(0, M - 0.3)
  for (let k = 0; k < SN; k++) {
    const st = ae.strips[k], p = st.P
    let g = 0
    for (const i of st.panels) g += rhs[i]
    ae.gPrev[k] = g
    const U = Umid[st.panels[0]], Ul = len(U) || 1e-6
    const clLin = (2 * g) / (Ul * p.chord)
    const clmax = (p.inBody ? 9 : p.clmax + dClmax[k]) * Math.sqrt(p.cosL) * machF
    const x = clLin >= 0 ? clLin / Math.max(0.2, clmax) : -clLin / Math.max(0.2, 0.75 * p.clmax)
    let f = 1, sep = 0
    if (x > 0.9) {
      if (x <= 1.05) f = (0.9 + 0.15 * Math.tanh((x - 0.9) / 0.15)) / x
      else { const fall = Math.max(0.55, 1.0 - 1.1 * (x - 1.05)); f = fall / x; sep = Math.min(1, (x - 1.0) * 1.5) }
    }
    kst[k] = f; sepA[k] = sep; clS[k] = clLin * f
    if (st.surf === 'wing' && !p.inBody) { nW++; if (x > 1.02) { if (st.side === 1) stR++; else stL++ } }
  }
  // forces: Kutta–Joukowski with induced velocities; profile and wave drag per strip
  const F = [0, 0, 0], Mo = [0, 0, 0]
  let dragPar = 0, dragW = 0, tail = 0, fin = 0
  const Bx = sys.B[0], By = sys.B[1], Bz = sys.B[2]
  const LL = FL.l, STR = FL.strip, TL = FL.tail, rho = inp.rho
  let F0 = 0, F1 = 0, F2 = 0, M0 = 0, M1 = 0, M2 = 0
  for (let i = 0; i < N; i++) {
    let vx = 0, vy = 0, vz = 0
    for (let j = 0, ij = i * N; j < N; j++, ij++) { const g = rhs[j]; vx += Bx[ij] * g; vy += By[ij] * g; vz += Bz[ij] * g }
    if (img) { const V3 = img.V[3], V4 = img.V[4], V5 = img.V[5], gp = ae.gPrev; for (let k = 0, ik = i * SN; k < SN; k++, ik++) { const g = gp[k]; vx += V3[ik] * g; vy += V4[ik] * g; vz += V5[ik] * g } }
    const U = Umid[i], i3 = 3 * i
    const g = rhs[i] * kst[STR[i]] * rho
    const lx = LL[i3], ly = LL[i3 + 1], lz = LL[i3 + 2]
    const tx = U[0] + vx, ty = U[1] + vy, tz = U[2] + vz
    const fx = (ty * lz - tz * ly) * g, fy = (tz * lx - tx * lz) * g, fz = (tx * ly - ty * lx) * g
    F0 += fx; F1 += fy; F2 += fz
    const rx = MID[i3] - c0, ry = MID[i3 + 1] - c1, rz = MID[i3 + 2] - c2
    M0 += ry * fz - rz * fy; M1 += rz * fx - rx * fz; M2 += rx * fy - ry * fx
    if (TL[i] === 1) tail += fy
    else if (TL[i] === 2) fin += fz
  }
  F[0] += F0; F[1] += F1; F[2] += F2; Mo[0] += M0; Mo[1] += M1; Mo[2] += M2
  for (let k = 0; k < SN; k++) {
    const st = ae.strips[k], p = st.P
    const U = Umid[st.panels[0]], Ul = len(U) || 1e-6, q = 0.5 * inp.rho * Ul * Ul
    const Re = (inp.rho * Ul * p.chord) / inp.mu
    const ff = (1 + (0.6 / 0.35) * p.tc + 100 * p.tc ** 4) * 1.34 * Math.pow(Math.max(0.05, M), 0.18) * Math.pow(p.cosL, 0.28)
    const cl = clS[k]
    let cd = 2 * skinCf(Re, M, p.laminar) * ff * 1.08 + 0.006 * cl * cl + dCd[k] + 1.1 * sepA[k] * sepA[k]
    const mdd = 0.95 / p.cosL - p.tc / (p.cosL * p.cosL) - Math.abs(cl) / (10 * p.cosL ** 3), mcr = mdd - 0.1077
    const cdw = M > mcr ? 20 * (M - mcr) ** 4 : 0
    cd += cdw
    const fd = mul(U, (q * st.area * cd) / Ul)
    F[0] += fd[0]; F[1] += fd[1]; F[2] += fd[2]
    // section moment about the quarter chord from the airfoil camber (the flaps' moment comes out of the lattice)
    const r = sub(p.mid, inp.cg), m = cross(r, fd), cmq = q * st.area * p.chord * p.cm0
    Mo[0] += m[0] + cmq * st.s[0]; Mo[1] += m[1] + cmq * st.s[1]; Mo[2] += m[2] + cmq * st.s[2]
    dragPar += q * st.area * (cd - cdw); dragW += q * st.area * cdw
  }
  // bodies: friction drag, Munk (potential-flow) moment and viscous cross-flow force
  const vhat = unit(inp.v)
  const qinf = 0.5 * inp.rho * V * V
  for (const b of ae.bodies) {
    const Re = (inp.rho * V * b.len) / inp.mu
    const fr = b.len / Math.max(0.1, b.dmax)
    const FF = b.b.kind === 'fuselage' ? 1 + 60 / fr ** 3 + fr / 400 : b.b.kind === 'strut' ? 1.6 : 1 + 0.35 / fr
    const Q = b.b.kind === 'fuselage' ? 1.0 : b.b.kind === 'nacelle' ? 1.3 : 1.4
    const D = qinf * skinCf(Re, M, 0) * FF * Q * b.swet * (b.b.kind === 'fuselage' ? 1.1 : 1) // + upsweep/base on the fuselage
    const at = [b.xv, b.yv, b.z]
    const fd = mul(vhat, -D)
    F[0] += fd[0]; F[1] += fd[1]; F[2] += fd[2]
    const md = cross(sub(at, inp.cg), fd); Mo[0] += md[0]; Mo[1] += md[1]; Mo[2] += md[2]
    dragPar += D
    if (V > 1 && b.b.kind !== 'strut') {
      // Munk moment: a body in a flow turns broadside — destabilising, ∝ volume
      const cosg = Math.max(-1, Math.min(1, vhat[0])), sin2g = 2 * cosg * Math.sqrt(Math.max(0, 1 - cosg * cosg))
      const ax = unit(cross(vhat, [1, 0, 0]))
      const k21 = fr > 6 ? 0.92 : 0.8
      const Mm = qinf * b.vol * k21 * sin2g
      if (len(cross(vhat, [1, 0, 0])) > 1e-6) { Mo[0] += Mm * ax[0]; Mo[1] += Mm * ax[1]; Mo[2] += Mm * ax[2] }
      // cross-flow drag (Allen): pushes the body sideways with the cross-flow
      const cross2 = [0, vhat[1], vhat[2]], cs = len(cross2)
      if (cs > 1e-4) {
        const Fc = qinf * 1.2 * 0.65 * b.plan * cs * cs
        const fc = mul(unit(cross2), -Fc)
        F[0] += fc[0]; F[1] += fc[1]; F[2] += fc[2]
        const mc = cross(sub(at, inp.cg), fc); Mo[0] += mc[0]; Mo[1] += mc[1]; Mo[2] += mc[2]
      }
    }
  }
  // landing gear: drag area of tyres and struts, acting low
  if (c.gear > 0.01 && V > 1) {
    const D = qinf * ae.geo.gearDrag * c.gear
    const fd = mul(vhat, -D)
    F[0] += fd[0]; F[1] += fd[1]; F[2] += fd[2]
    const md = cross(sub([-1, 0.8, 0], inp.cg), fd); Mo[0] += md[0]; Mo[1] += md[1]; Mo[2] += md[2]
    dragPar += D
  }
  // excrescences, gaps, antennas, leakage: 5 % of the parasite drag (Raymer)
  const ex = mul(vhat, -0.05 * dragPar)
  F[0] += ex[0]; F[1] += ex[1]; F[2] += ex[2]; dragPar *= 1.05
  // lift / drag in wind axes
  const drag = -dot(F, vhat)
  const liftDir = unit(cross(cross(vhat, [0, 1, 0]), vhat))
  const lift = V > 1 ? dot(F, liftDir) : 0
  const CL = qinf > 1 ? Math.abs(lift) / (qinf * ae.Sref) : 0
  return { F, M: Mo, lift, drag, dragInduced: drag - dragPar - dragW, dragParasite: dragPar, dragWave: dragW, CL, wingStall: (stL + stR) / Math.max(1, nW), stalledL: stL, stalledR: stR, tailLift: tail, finSide: fin }
}
