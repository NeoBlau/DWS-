import * as THREE from 'three'
import { memo, curve } from '../../utils/geom'
import { mergeGeos } from '../diesel/geometry'
import type { Vec3 } from '../../data/types'

/*
 * Representative CFM56-5B-class turbofan laid out along X (intake at +x), axis through the origin,
 * all dimensions in metres. Fan diameter ≈ 1.73 m. Stations are schematic, not a drawing of the real engine.
 */

/* ------------------------------------------------------------------ axial stations */
export const ST = {
  lip: 2.06,
  spinnerTip: 1.47,
  fan: 1.0,
  splitter: 0.82,
  ogv: 0.42,
  booster: [0.7, 0.6, 0.5], // LPC rotors (3 stages)
  hpc0: 0.2, hpcStep: 0.08, hpcN: 9, // HPC rotor x = hpc0 - i * hpcStep
  diffuser: -0.48,
  combFront: -0.55, combBack: -0.93,
  nozzleX: -0.53, nozzleR: 0.3,
  ngv: -0.975, hpt: -1.04,
  lpt: [-1.16, -1.28, -1.4, -1.52],
  fanExit: -0.96,
  coreExit: -1.95,
  plugTip: -2.42,
}
export const FAN_R = 0.865

/** HPC rotor geometry for stage i (0..8): blades get shorter as the air is squeezed */
export const hpcStage = (i: number) => ({ x: ST.hpc0 - i * ST.hpcStep, hub: 0.2 + i * 0.0068, tip: 0.34 - i * 0.0048 })
export const lptStage = (i: number) => ({ x: ST.lpt[i], hub: 0.27 + i * 0.006, tip: 0.375 + i * 0.026 })
export const boosterStage = (i: number) => ({ x: ST.booster[i], hub: 0.33 + i * 0.01, tip: 0.47 - i * 0.012 })

/* ------------------------------------------------------------------ explode offsets per module */
export const EX: Record<string, Vec3> = {
  inlet: [2.2, 0, 0],
  fan: [1.5, 0, 0],
  fanCase: [1.0, 0, 0],
  booster: [0.62, 0, 0],
  hpc: [0, 0, 0],
  comb: [-0.6, 0, 0],
  hpt: [-1.1, 0, 0],
  lpt: [-1.65, 0, 0],
  exhaust: [-2.25, 0, 0],
  cowl: [0, -1.35, 0],
  nacelle: [0, 1.9, 0],
  pylon: [0, 2.15, 0],
  wing: [0, 2.45, 0],
  none: [0, 0, 0],
}

/* ------------------------------------------------------------------ gas paths (x, r) */
/** core stream: inlet → fan root → booster → gooseneck → HPC → combustor → turbines → core nozzle → plume */
export const CORE_XR: [number, number][] = [
  [3.8, 0.22], [2.4, 0.25], [1.5, 0.3], [1.12, 0.37], [0.9, 0.42], [0.75, 0.41], [0.6, 0.405], [0.45, 0.39], [0.34, 0.33],
  [0.22, 0.275], [0.0, 0.27], [-0.25, 0.272], [-0.45, 0.275], [-0.56, 0.29], [-0.75, 0.3], [-0.93, 0.3], [-1.04, 0.305],
  [-1.2, 0.33], [-1.4, 0.36], [-1.58, 0.37], [-1.8, 0.335], [-1.97, 0.32], [-2.5, 0.31], [-3.8, 0.3],
]
/** bypass stream: around the fan tip region → OGVs → bypass duct → fan nozzle */
export const BYPASS_XR: [number, number][] = [
  [3.8, 0.7], [2.4, 0.76], [1.5, 0.74], [1.0, 0.72], [0.6, 0.73], [0.2, 0.74], [-0.4, 0.72], [-0.96, 0.69], [-1.6, 0.66], [-2.6, 0.63], [-3.8, 0.6],
]
export const ring = (xr: [number, number][], th: number): Vec3[] => xr.map(([x, r]) => [x, Math.cos(th) * r, -Math.sin(th) * r])

/** arc-length LUT of the canonical core path (θ = 0, i.e. in the section plane on top) */
function makeLut(xr: [number, number][]) {
  const c = curve(ring(xr, 0), 0.35)
  const N = 600
  const xs = new Float32Array(N + 1), ys = new Float32Array(N + 1)
  for (let i = 0; i <= N; i++) { const p = c.getPointAt(i / N); xs[i] = p.x; ys[i] = p.y }
  return { xs, ys, N, len: c.getLength() }
}
let coreLut: ReturnType<typeof makeLut> | null = null
let bypassLut: ReturnType<typeof makeLut> | null = null
export const CORE = () => (coreLut ??= makeLut(CORE_XR))
export const BYPASS = () => (bypassLut ??= makeLut(BYPASS_XR))
/** x position of a particle at path fraction u */
export const xAtU = (lut: { xs: Float32Array; N: number }, u: number) => lut.xs[Math.max(0, Math.min(lut.N, Math.floor(u * lut.N)))]
/** point of the core stream (θ = 0) at axial position x */
export function corePoint(x: number): Vec3 {
  const L = CORE()
  let i = 0
  while (i < L.N && L.xs[i + 1] > x) i++
  const a = L.xs[i], b = L.xs[Math.min(L.N, i + 1)]
  const k = Math.abs(b - a) < 1e-6 ? 0 : (a - x) / (a - b)
  return [x, L.ys[i] + (L.ys[Math.min(L.N, i + 1)] - L.ys[i]) * Math.max(0, Math.min(1, k)), 0]
}

/* ------------------------------------------------------------------ builders */
/**
 * Twisted, cambered fan blade (single surface, use DoubleSide): radial along +Y, axial along X.
 * Stagger rises from hub to tip like a real fan; n copies are merged around X.
 */
export function fanBlades(key: string, n: number, r0: number, r1: number, opts: { chord0: number; chord1: number; b0: number; b1: number; camber: number; sweep: number }) {
  return memo(`jetfan${key}`, () => {
    const NS = 12, NC = 7
    const base: number[] = []
    for (let i = 0; i < NS; i++) {
      const s = i / (NS - 1)
      const r = r0 + (r1 - r0) * s
      const b = opts.b0 + (opts.b1 - opts.b0) * s
      const c = opts.chord0 + (opts.chord1 - opts.chord0) * Math.sin(s * Math.PI * 0.6) / Math.sin(Math.PI * 0.6)
      for (let j = 0; j < NC; j++) {
        const u = j / (NC - 1) - 0.5
        const h = opts.camber * c * (1 - 4 * u * u)
        const ax = u * c * Math.cos(b) - Math.sin(b) * h - opts.sweep * s * s
        const tz = u * c * Math.sin(b) + Math.cos(b) * h
        base.push(ax, r, tz)
      }
    }
    const idx: number[] = []
    for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NC - 1; j++) {
      const a = i * NC + j, b = a + 1, c = a + NC, d = c + 1
      idx.push(a, c, b, b, c, d)
    }
    const parts: THREE.BufferGeometry[] = []
    for (let k = 0; k < n; k++) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(base.slice(), 3))
      g.setIndex(idx)
      g.rotateX((k / n) * Math.PI * 2)
      g.computeVertexNormals()
      parts.push(g)
    }
    return mergeGeos(parts)
  })
}

/** n box blades/vanes around X with stagger angle; r0..r1 radial, chord along X — closed solids */
export function vaneRing(key: string, n: number, r0: number, r1: number, chord: number, thick: number, stagger: number, lean = 0) {
  return memo(`jetvane${key}`, () => {
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < n; i++) {
      const b = new THREE.BoxGeometry(chord, r1 - r0, thick)
      b.translate(0, (r0 + r1) / 2, 0)
      b.rotateY(stagger)
      if (lean) b.rotateX(lean)
      b.rotateX((i / n) * Math.PI * 2)
      parts.push(b)
    }
    return mergeGeos(parts)
  })
}

/** several vane rows merged into one closed-solid geometry (static stators, cut by the section) */
export function statorRows(key: string, rows: { x: number; r0: number; r1: number; n: number; chord: number }[], stagger: number) {
  return memo(`jetstat${key}`, () => mergeGeos(rows.map((r, k) => {
    const g = vaneRing(`${key}-${k}`, r.n, r.r0, r.r1, r.chord, 0.006, stagger).clone()
    g.translate(r.x, 0, 0)
    return g
  })))
}

/** drum of discs: outer rim follows hub radius, discs reach down to a bore — the section shows a comb */
export function discDrum(key: string, discs: { x: number; hub: number; w: number }[], bore: number, wall = 0.018) {
  return memo(`jetdrum${key}`, () => {
    const sorted = discs.slice().sort((a, b) => a.x - b.x)
    const outer: [number, number][] = []
    const inner: [number, number][] = []
    sorted.forEach((d, k) => {
      outer.push([d.x - d.w, d.hub], [d.x + d.w, d.hub])
      inner.push([d.x - d.w * 0.6, bore], [d.x + d.w * 0.6, bore])
      const nx = sorted[k + 1]
      if (nx) {
        const mid = (d.x + nx.x) / 2
        const hr = (d.hub + nx.hub) / 2 - wall
        inner.push([d.x + d.w * 0.9, hr], [mid, hr], [nx.x - nx.w * 0.9, hr])
      }
    })
    // outline: inner (bore side) from front to back, then outer rim back to front
    const ol: [number, number][] = [...inner, ...outer.slice().reverse(), inner[0]]
    const pts = ol.map(([x, r]) => new THREE.Vector2(Math.max(0.0005, r), x))
    const g = new THREE.LatheGeometry(pts, 48)
    g.rotateZ(-Math.PI / 2)
    g.computeVertexNormals()
    return g
  })
}

/** side-profile slab (x, y) extruded ±w/2 along Z — pylon, bifurcation */
export function profileSlab(key: string, pts: [number, number][], w: number) {
  return memo(`jetslab${key}`, () => {
    const s = new THREE.Shape()
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)))
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 8 })
    g.translate(0, 0, -w / 2)
    g.computeVertexNormals()
    return g
  })
}

/** n small parts placed around X at radius r (built from one geometry factory) */
export function around(key: string, n: number, make: (i: number, a: number) => THREE.BufferGeometry, th0 = 0) {
  return memo(`jetaround${key}`, () => mergeGeos(Array.from({ length: n }, (_, i) => {
    const a = th0 + (i / n) * Math.PI * 2
    const g = make(i, a)
    g.rotateX(a)
    return g
  })))
}

/** spinner profile (ogive): radius at axial position x */
export const spinnerR = (x: number) => { const k = (x - 1.15) / (ST.spinnerTip - 1.15); return 0.29 * Math.sqrt(Math.max(0, 1 - k * k)) }

/** helix stripe on the spinner (a painted marking: it makes the rotation visible) */
export function spinnerSpiral(key: string) {
  return memo(`jetspiral${key}`, () => {
    class Spiral extends THREE.Curve<THREE.Vector3> {
      constructor() { super() }
      getPoint(t: number, target = new THREE.Vector3()) {
        const x = 1.16 + (ST.spinnerTip - 0.01 - 1.16) * t
        const r = spinnerR(x) + 0.006
        const a = t * Math.PI * 1.4
        return target.set(x, Math.cos(a) * r, Math.sin(a) * r)
      }
    }
    return new THREE.TubeGeometry(new Spiral(), 64, 0.014, 6, false)
  })
}
