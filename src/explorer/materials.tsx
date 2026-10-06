import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SceneState, FlowId } from './core'
import { baseState } from './core'
import { curve, glowSprite } from '../utils/geom'
import type { Vec3 } from '../data/types'

/* ------------------------------------------------------------------ live smoothed scene state */
export const S: SceneState = baseState()
export const PLAY = { k: 1 } // 0 when paused, playback speed otherwise (mechanisms integrate with it)

/** section plane used for the cutaway (normal -Z: everything with z > constant is removed) */
export const CUT = new THREE.Plane(new THREE.Vector3(0, 0, -1), 50)
export const CUTS = [CUT]
/** secondary section plane for parts that sit off the main plane (e.g. the turbocharger) */
export const CUT2 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 50)

/* ------------------------------------------------------------------ material registry */
interface Entry { m: THREE.MeshPhysicalMaterial; base: THREE.Color; baseEm: THREE.Color; baseEmI: number; casing: boolean; comp?: string; keepLit?: boolean; noXray?: boolean }
const registry = new Set<Entry>()
const ACCENT = new THREE.Color('#ffb36b')

export interface MatOpts {
  color: string
  metal?: number
  rough?: number
  casing?: boolean // clipped by the cutaway, turns to glass in x-ray
  comp?: string // component id, highlighted when in focus
  emissive?: string
  emissiveIntensity?: number
  opacity?: number
  keepLit?: boolean // not darkened in flow mode (e.g. flames, glowing parts)
  clear?: number // clearcoat
  side?: THREE.Side
  plane?: THREE.Plane
  noXray?: boolean
}

export function makeMat(o: MatOpts) {
  const m = new THREE.MeshPhysicalMaterial({
    color: o.color, metalness: o.metal ?? 0.7, roughness: o.rough ?? 0.35, clearcoat: o.clear ?? 0,
    clearcoatRoughness: 0.2, transparent: o.opacity !== undefined && o.opacity < 1, opacity: o.opacity ?? 1,
    emissive: o.emissive ?? '#000000', emissiveIntensity: o.emissiveIntensity ?? 1, side: o.side ?? THREE.FrontSide,
  })
  if (o.casing) { m.clippingPlanes = [o.plane ?? CUT]; m.clipShadows = true }
  const e: Entry = { m, base: m.color.clone(), baseEm: m.emissive.clone(), baseEmI: m.emissiveIntensity, casing: !!o.casing, comp: o.comp, keepLit: o.keepLit, noXray: o.noXray }
  registry.add(e)
  return { m, dispose: () => { registry.delete(e); m.dispose() } }
}

export function useMat(o: MatOpts) {
  const r = useMemo(() => makeMat(o), [o.color, o.metal, o.rough, o.casing, o.comp, o.emissive, o.opacity]) // eslint-disable-line
  useEffect(() => () => r.dispose(), [r])
  return r.m
}

/** called once per frame by the director */
export function updateMaterials(time: number) {
  const pulse = 0.5 + Math.sin(time * 3.4) * 0.5
  registry.forEach((e) => {
    const focused = !!e.comp && S.focus.includes(e.comp)
    const dim = focused || e.keepLit ? 0 : S.dim
    e.m.color.copy(e.base).multiplyScalar(1 - dim * 0.82)
    if (focused) { e.m.emissive.copy(ACCENT); e.m.emissiveIntensity = 0.12 + pulse * 0.28 }
    else { e.m.emissive.copy(e.baseEm); e.m.emissiveIntensity = e.baseEmI * (1 - dim * 0.7) }
    if (e.casing) {
      const op = e.noXray ? 1 : 1 - S.xray * 0.86
      const tr = op < 0.99
      if (e.m.transparent !== tr) { e.m.transparent = tr; e.m.needsUpdate = true }
      e.m.opacity = op
      e.m.depthWrite = op > 0.5
    }
  })
}

/* ------------------------------------------------------------------ cutaway with filled section caps */
let roBase = 10
/**
 * A casing mesh cut by the section plane. The cut face is filled with a coloured cap using the
 * stencil technique (back faces +1, front faces −1; the cap draws where the count is non-zero),
 * so the cross-section looks solid like a real training cutaway instead of a hollow shell.
 */
export function Casing({ geometry, material, cap = '#e2793a', position, rotation, scale, castShadow = true, plane = CUT }: {
  geometry: THREE.BufferGeometry; material: THREE.Material; cap?: string
  position?: Vec3; rotation?: [number, number, number]; scale?: number | Vec3; castShadow?: boolean; plane?: THREE.Plane
}) {
  const ro = useMemo(() => (roBase += 3), [])
  const [back, front, capMat] = useMemo(() => {
    const base = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: [plane] }
    const b = new THREE.MeshBasicMaterial({ ...base, side: THREE.BackSide, stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp })
    const f = new THREE.MeshBasicMaterial({ ...base, side: THREE.FrontSide, stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp })
    const c = new THREE.MeshStandardMaterial({ color: cap, side: THREE.DoubleSide, metalness: 0.2, roughness: 0.55, emissive: cap, emissiveIntensity: 0.18, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp })
    return [b, f, c]
  }, [cap, plane])
  const capRef = useRef<THREE.Mesh>(null!)
  const grp = useRef<THREE.Group>(null!)
  const inv = useMemo(() => new THREE.Matrix4(), [])
  const p = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const show = (S.xray < 0.5 || plane !== CUT) && plane.constant < 20
    capRef.current.visible = show
    if (!show) return
    // place the cap on the section plane in this group's local space
    grp.current.updateWorldMatrix(true, false)
    inv.copy(grp.current.matrixWorld).invert()
    plane.coplanarPoint(p).applyMatrix4(inv)
    capRef.current.position.copy(p)
    capRef.current.quaternion.copy(grp.current.getWorldQuaternion(new THREE.Quaternion()).invert())
  })
  useEffect(() => () => { back.dispose(); front.dispose(); capMat.dispose() }, [back, front, capMat])
  return (
    <group ref={grp} position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geometry} material={material} castShadow={castShadow} receiveShadow renderOrder={ro} />
      <mesh geometry={geometry} material={back} renderOrder={ro + 1} />
      <mesh geometry={geometry} material={front} renderOrder={ro + 1} />
      <mesh ref={capRef} material={capMat} renderOrder={ro + 2} onAfterRender={(gl) => gl.clearStencil()}>
        <planeGeometry args={[30, 30]} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ explode offset */
export function Explode({ off, children, delay = 0 }: { off: Vec3; children: ReactNode; delay?: number }) {
  const g = useRef<THREE.Group>(null!)
  useFrame(() => {
    const k = Math.max(0, Math.min(1, (S.explode - delay) / Math.max(0.01, 1 - delay)))
    const e = k * k * (3 - 2 * k)
    g.current.position.set(off[0] * e, off[1] * e, off[2] * e)
  })
  return <group ref={g}>{children}</group>
}
export const exploded = (p: Vec3, off: Vec3, delay = 0): Vec3 => {
  const k = Math.max(0, Math.min(1, (S.explode - delay) / Math.max(0.01, 1 - delay)))
  const e = k * k * (3 - 2 * k)
  return [p[0] + off[0] * e, p[1] + off[1] * e, p[2] + off[2] * e]
}

/* ------------------------------------------------------------------ particle flows */
/**
 * Glowing particles travelling along a spline. Each particle owns its position u ∈ [0,1] and moves with
 * `rate * profile(u)` so a stream can visibly accelerate (through a compressor) or slow down.
 */
export function Flow({ id, points, color, count = 80, size = 0.02, rate, profile, jitter = 0, tension = 0.35, gate }: {
  id: FlowId; points: Vec3[]; color: (u: number, out: THREE.Color) => void; count?: number; size?: number
  rate: () => number; profile?: (u: number) => number; jitter?: number; tension?: number; gate?: () => number
}) {
  const { lut, len } = useMemo(() => {
    const c = curve(points, tension)
    const N = 400
    const lut = new Float32Array((N + 1) * 3)
    for (let i = 0; i <= N; i++) { const q = c.getPointAt(i / N); lut.set([q.x, q.y, q.z], i * 3) }
    return { lut, len: c.getLength() }
  }, [points, tension])
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    return g
  }, [count])
  const u = useMemo(() => Float32Array.from({ length: count }, () => Math.random()), [count])
  const jit = useMemo(() => Float32Array.from({ length: count * 3 }, () => (Math.random() - 0.5) * jitter), [count, jitter])
  const mat = useMemo(() => new THREE.PointsMaterial({ size, map: glowSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }), [size])
  const pts = useRef<THREE.Points>(null!)
  const col = useMemo(() => new THREE.Color(), [])
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05) * PLAY.k
    const want = (S.flows[id] ?? 0) * (gate ? gate() : 1)
    mat.opacity += (want - mat.opacity) * (1 - Math.exp(-Math.min(dtRaw, 0.05) * 5))
    pts.current.visible = mat.opacity > 0.01
    if (!pts.current.visible) return
    const r = rate()
    const P = geo.attributes.position as THREE.BufferAttribute, C = geo.attributes.color as THREE.BufferAttribute
    for (let i = 0; i < count; i++) {
      u[i] += (dt * r * (profile ? profile(u[i]) : 1)) / Math.max(0.05, len)
      if (u[i] >= 1) u[i] -= 1
      const j = Math.floor(u[i] * 400) * 3
      P.setXYZ(i, lut[j] + jit[i * 3], lut[j + 1] + jit[i * 3 + 1], lut[j + 2] + jit[i * 3 + 2])
      color(u[i], col)
      const f = Math.min(1, u[i] * 14, (1 - u[i]) * 14)
      C.setXYZ(i, col.r * f, col.g * f, col.b * f)
    }
    P.needsUpdate = true; C.needsUpdate = true
  })
  return <points ref={pts} geometry={geo} material={mat} frustumCulled={false} />
}

export const solid = (hex: string) => { const c = new THREE.Color(hex); return (_: number, out: THREE.Color) => { out.copy(c) } }
export const ramp = (stops: [number, string][]) => {
  const cs = stops.map(([u, h]) => [u, new THREE.Color(h)] as const)
  return (u: number, out: THREE.Color) => {
    for (let i = 0; i < cs.length - 1; i++) if (u <= cs[i + 1][0]) { const k = (u - cs[i][0]) / Math.max(1e-4, cs[i + 1][0] - cs[i][0]); out.copy(cs[i][1]).lerp(cs[i + 1][1], Math.max(0, Math.min(1, k))); return }
    out.copy(cs[cs.length - 1][1])
  }
}
