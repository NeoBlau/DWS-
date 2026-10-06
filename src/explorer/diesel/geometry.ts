import * as THREE from 'three'
import { memo } from '../../utils/geom'

/*
 * Section-friendly solids. Everything that gets cut by the section plane must be a closed mesh,
 * and its internal passages must be real holes so the filled cap shows walls, bores and jackets.
 */

export type Hole = { c: [number, number]; r: number } | { rect: [number, number, number, number]; round?: number }

/** plan-view slab (x, z) extruded upward by h, with holes; bottom at y = 0 */
export function slab(key: string, w: number, d: number, h: number, holes: Hole[] = [], round = 0.012) {
  return memo(`slab${key}`, () => {
    const s = roundedRect(-w / 2, -d / 2, w / 2, d / 2, round)
    holes.forEach((hl) => {
      if ('c' in hl) { const p = new THREE.Path(); p.absarc(hl.c[0], -hl.c[1], hl.r, 0, Math.PI * 2, true); s.holes.push(p) }
      else { const [x0, z0, x1, z1] = hl.rect; s.holes.push(roundedRect(x0, -z1, x1, -z0, hl.round ?? 0.008, true)) }
    })
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 28 })
    g.rotateX(-Math.PI / 2)
    g.computeVertexNormals()
    return g
  })
}

function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, path = false) {
  const s = path ? new THREE.Path() : new THREE.Shape()
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2)
  if (path) {
    // holes must wind opposite to the outline
    s.moveTo(x0 + r, y0); s.quadraticCurveTo(x0, y0, x0, y0 + r); s.lineTo(x0, y1 - r); s.quadraticCurveTo(x0, y1, x0 + r, y1)
    s.lineTo(x1 - r, y1); s.quadraticCurveTo(x1, y1, x1, y1 - r); s.lineTo(x1, y0 + r); s.quadraticCurveTo(x1, y0, x1 - r, y0); s.lineTo(x0 + r, y0)
  } else {
    s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r); s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1)
    s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0)
  }
  return s as THREE.Shape
}

/** closed solid of revolution around X from an (x, r) outline (outer then inner, returning) */
export function revolve(key: string, outline: [number, number][], seg = 56) {
  return memo(`rev${key}`, () => {
    const pts = outline.map(([x, r]) => new THREE.Vector2(Math.max(0.0005, r), x))
    const g = new THREE.LatheGeometry(pts, seg)
    g.rotateZ(-Math.PI / 2)
    g.computeVertexNormals()
    return g
  })
}

/** hollow tube (closed solid) along X: outer radius, inner radius, length, centred */
export function hollow(key: string, ro: number, ri: number, len: number, seg = 48) {
  return revolve(`hol${key}`, [[-len / 2, ri], [-len / 2, ro], [len / 2, ro], [len / 2, ri], [-len / 2, ri]], seg)
}

/** cam lobe: base circle + nose, thickness along X, nose pointing −Y at rotation 0 */
export function camLobe(base: number, lift: number, thick: number) {
  return memo(`lobe${base}|${lift}|${thick}`, () => {
    const s = new THREE.Shape()
    const N = 48
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2
      const d = Math.cos(a + Math.PI / 2) // nose toward −Y
      const r = base + lift * Math.pow(Math.max(0, d), 2.2)
      const x = Math.cos(a) * r, y = Math.sin(a) * r
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y)
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false })
    g.translate(0, 0, -thick / 2)
    g.rotateY(Math.PI / 2)
    return g
  })
}

/** crank web with counterweight: rounded arm toward the pin (+Y) and a sector opposite */
export function crankWeb(r: number, thick: number) {
  return memo(`web${r}|${thick}`, () => {
    const s = new THREE.Shape()
    const cw = r * 1.75
    s.moveTo(-0.022, 0)
    s.lineTo(-0.02, r)
    s.absarc(0, r, 0.02, Math.PI, 0, true)
    s.lineTo(0.022, 0)
    s.absarc(0, 0, cw, -0.15, -Math.PI + 0.15, true)
    s.lineTo(-0.022, 0)
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1, curveSegments: 24 })
    g.translate(0, 0, -thick / 2)
    g.rotateY(Math.PI / 2)
    return g
  })
}

/** blades around X: count, radius in/out, chord, twist — returns merged geometry */
export function bladeRing(key: string, n: number, r0: number, r1: number, chord: number, thick: number, twist: number) {
  return memo(`blades${key}`, () => {
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < n; i++) {
      const b = new THREE.BoxGeometry(chord, r1 - r0, thick)
      b.translate(0, (r0 + r1) / 2, 0)
      b.rotateY(twist)
      b.rotateX((i / n) * Math.PI * 2)
      parts.push(b)
    }
    return mergeGeos(parts)
  })
}

export function mergeGeos(list: THREE.BufferGeometry[]) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g))
  let n = 0
  geos.forEach((g) => { n += g.attributes.position.count })
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3)
  let o = 0
  geos.forEach((g) => {
    pos.set(g.attributes.position.array as Float32Array, o * 3)
    if (!g.attributes.normal) g.computeVertexNormals()
    nor.set(g.attributes.normal.array as Float32Array, o * 3)
    o += g.attributes.position.count
  })
  const m = new THREE.BufferGeometry()
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return m
}
