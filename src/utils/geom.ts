import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Vec3 } from '../data/types'

const cache = new Map<string, THREE.BufferGeometry>()
/** memoise geometry by key so React re-renders never rebuild meshes */
export function memo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = cache.get(key)
  if (!g) { g = make(); cache.set(key, g) }
  return g as T
}

export const rbox = (w: number, h: number, d: number, r = 0.02) =>
  memo(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01)))

export const cyl = (rt: number, rb: number, h: number, seg = 24) =>
  memo(`cy${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg))

export const sphere = (r: number, seg = 24) => memo(`sp${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)))
export const torus = (r: number, t: number, seg = 32) => memo(`to${r}|${t}|${seg}`, () => new THREE.TorusGeometry(r, t, 12, seg))
export const capsule = (r: number, len: number) => memo(`ca${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 16))

export function curve(points: Vec3[], tension = 0.35) {
  return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', tension)
}

export const tube = (key: string, points: Vec3[], r: number, seg = 64) =>
  memo(`tu${key}|${r}`, () => new THREE.TubeGeometry(curve(points), seg, r, 8, false))

/** straight cylinder between two points (shafts, links, struts) */
export function between(a: Vec3, b: Vec3) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b)
  const mid = va.clone().add(vb).multiplyScalar(0.5)
  const len = va.distanceTo(vb)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())
  return { position: mid.toArray() as Vec3, quaternion: q, length: len }
}

export function spring(r: number, h: number, turns: number, wire: number) {
  return memo(`spr${r}|${h}|${turns}|${wire}`, () => {
    class Helix extends THREE.Curve<THREE.Vector3> {
      constructor() { super() }
      getPoint(t: number, target = new THREE.Vector3()) {
        const a = t * Math.PI * 2 * turns
        return target.set(Math.cos(a) * r, t * h - h / 2, Math.sin(a) * r)
      }
    }
    return new THREE.TubeGeometry(new Helix(), Math.round(turns * 24), wire, 6, false)
  })
}

/** spur gear outline extruded along Z */
export function gear(teeth: number, r: number, depth: number, toothH = r * 0.12, hole = r * 0.25) {
  return memo(`gear${teeth}|${r}|${depth}`, () => {
    const s = new THREE.Shape()
    const n = teeth * 4
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const phase = i % 4
      const rr = phase === 1 || phase === 2 ? r + toothH / 2 : r - toothH / 2
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y)
    }
    const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); s.holes.push(h)
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: toothH * 0.15, bevelThickness: toothH * 0.15, bevelSegments: 1, curveSegments: 4 })
    g.translate(0, 0, -depth / 2)
    return g
  })
}

/** ring gear: internal teeth */
export function ringGear(teeth: number, r: number, outer: number, depth: number) {
  return memo(`ring${teeth}|${r}|${outer}|${depth}`, () => {
    const s = new THREE.Shape(); s.absarc(0, 0, outer, 0, Math.PI * 2, false)
    const h = new THREE.Path()
    const n = teeth * 4, toothH = r * 0.08
    for (let i = 0; i <= n; i++) {
      const a = -(i / n) * Math.PI * 2
      const phase = i % 4
      const rr = phase === 1 || phase === 2 ? r - toothH / 2 : r + toothH / 2
      if (i === 0) h.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else h.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    s.holes.push(h)
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 })
    g.translate(0, 0, -depth / 2)
    return g
  })
}

/** Tyre: lathe of a rounded rectangle cross-section, axis along Z */
export function tyre(r: number, w: number) {
  return memo(`tyre${r}|${w}`, () => {
    const pts: THREE.Vector2[] = []
    const inner = r * 0.66, side = w / 2, rr = Math.min(w * 0.28, r * 0.12)
    const add = (x: number, y: number) => pts.push(new THREE.Vector2(x, y))
    add(inner, -side * 0.9)
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); add(r - rr + Math.cos(a) * rr, -side + rr + Math.sin(a) * rr) }
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); add(r - rr + Math.cos(a) * rr, side - rr + Math.sin(a) * rr) }
    add(inner, side * 0.9)
    const g = new THREE.LatheGeometry(pts, 48)
    g.rotateX(Math.PI / 2)
    return g
  })
}

/**
 * Car body: extrude the side silhouette across the width, then pinch the ends in plan view
 * and lean the greenhouse inward (tumblehome) so it reads as a real car, not a slab.
 */
export function carBody(key: string, profile: THREE.Shape, width: number, opts: { front: number; rear: number; belt: number; roof: number; pinch?: number; tumble?: number; grow?: number }) {
  return memo(`body${key}|${opts.grow ?? 0}`, () => {
    const depth = width - 0.1
    const g = new THREE.ExtrudeGeometry(profile, { depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 4, curveSegments: 28, steps: 6 })
    g.translate(0, 0, -depth / 2)
    taper(g, width, opts)
    g.computeVertexNormals()
    return g
  })
}

export function taper(g: THREE.BufferGeometry, width: number, o: { front: number; rear: number; belt: number; roof: number; pinch?: number; tumble?: number; grow?: number }) {
  const p = g.attributes.position as THREE.BufferAttribute
  const pinch = o.pinch ?? 0.16, tumble = o.tumble ?? 0.2, grow = o.grow ?? 0
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const f = THREE.MathUtils.clamp((x - (o.front - 0.55)) / 0.55, 0, 1)
    const r = THREE.MathUtils.clamp(((o.rear + 0.4) - x) / 0.4, 0, 1)
    const t = THREE.MathUtils.clamp((y - o.belt) / (o.roof - o.belt), 0, 1)
    const s = (1 - pinch * f * f) * (1 - pinch * 0.5 * r * r) * (1 - tumble * t)
    p.setZ(i, z * s + Math.sign(z) * grow)
  }
  p.needsUpdate = true
}

/** a lofted, symmetric-airfoil surface through spanwise sections (wings, tails, fins) */
export interface Section { le: number; y: number; z: number; chord: number; t: number }
export function loft(key: string, sections: Section[], opts: { vertical?: boolean; c0?: number; c1?: number } = {}) {
  return memo(`loft${key}`, () => {
    const c0 = opts.c0 ?? 0, c1 = opts.c1 ?? 1
    const N = 14
    const prof: [number, number][] = []
    for (let i = 0; i <= N; i++) {
      const u = c0 + (c1 - c0) * (1 - Math.cos((i / N) * Math.PI)) / 2
      const th = 5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)
      prof.push([u, th])
    }
    const ring: [number, number][] = [...prof.map(([u, th]) => [u, th] as [number, number]), ...prof.slice().reverse().map(([u, th]) => [u, -th] as [number, number])]
    const pos: number[] = [], idx: number[] = []
    sections.forEach((s) => {
      ring.forEach(([u, th]) => {
        const x = s.le - u * s.chord
        const off = th * s.t * s.chord
        if (opts.vertical) pos.push(x, s.y, s.z + off)
        else pos.push(x, s.y + off, s.z)
      })
    })
    const R = ring.length
    for (let j = 0; j < sections.length - 1; j++) for (let i = 0; i < R - 1; i++) {
      const a = j * R + i, b = a + 1, c = a + R, d = c + 1
      idx.push(a, c, b, b, c, d)
    }
    // tip caps
    const cap = (j: number, flip: boolean) => {
      const base = j * R
      for (let i = 1; i < R - 2; i++) flip ? idx.push(base, base + i + 1, base + i) : idx.push(base, base + i, base + i + 1)
    }
    cap(0, true); cap(sections.length - 1, false)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  })
}

/** circular-section body of revolution along X with arbitrary radius and centre height (fuselage) */
export function fuselage(key: string, xs: number[], r: (x: number) => number, cy: (x: number) => number, seg = 40) {
  return memo(`fus${key}`, () => {
    const pos: number[] = [], idx: number[] = [], uv: number[] = []
    xs.forEach((x, j) => {
      const rr = Math.max(0.001, r(x)), c = cy(x)
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2
        pos.push(x, c + Math.cos(a) * rr, Math.sin(a) * rr)
        uv.push(i / seg, j / (xs.length - 1))
      }
    })
    const R = seg + 1
    for (let j = 0; j < xs.length - 1; j++) for (let i = 0; i < seg; i++) {
      const a = j * R + i, b = a + 1, c = a + R, d = c + 1
      idx.push(a, b, c, b, d, c)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  })
}

/** soft round sprite used by flow particles and glows */
let sprite: THREE.Texture | null = null
export function glowSprite() {
  if (sprite) return sprite
  const c = document.createElement('canvas'); c.width = c.height = 64
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.85)'); g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.fillRect(0, 0, 64, 64)
  sprite = new THREE.CanvasTexture(c)
  return sprite
}

/** fine grid texture for the floor */
export function gridTexture(lines = '#2a3440', bg = 'transparent') {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const x = c.getContext('2d')!
  if (bg !== 'transparent') { x.fillStyle = bg; x.fillRect(0, 0, 256, 256) }
  x.strokeStyle = lines; x.lineWidth = 1
  for (let i = 0; i <= 256; i += 32) { x.globalAlpha = i % 128 === 0 ? 0.9 : 0.35; x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, 256); x.stroke(); x.beginPath(); x.moveTo(0, i + 0.5); x.lineTo(256, i + 0.5); x.stroke() }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}
