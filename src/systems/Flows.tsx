import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { FlowDef, VehicleDef } from '../data/types'
import { FLOW_META } from '../data/flowMeta'
import { getApp } from '../store'
import { curve, glowSprite } from '../utils/geom'
import { liveRuntime } from '../models/runtime'

/**
 * One flow = a faint glowing pipe + a stream of additive particles moving along a spline.
 * Particles are a single THREE.Points per flow (cheap), positions sampled from a lookup table.
 */
function Flow({ f, scale, quality }: { f: FlowDef; scale: number; quality: 'high' | 'low' }) {
  const color = new THREE.Color(FLOW_META[f.kind].color)
  const { lut, length, tubeGeo } = useMemo(() => {
    const c = curve(f.points, 0.3)
    const length = c.getLength()
    const N = 256
    const lut = new Float32Array((N + 1) * 3)
    for (let i = 0; i <= N; i++) { const p = c.getPointAt(i / N); lut.set([p.x, p.y, p.z], i * 3) }
    const tubeGeo = new THREE.TubeGeometry(c, Math.max(8, Math.round(length * 24 / scale)), 0.007 * scale, 6, false)
    return { lut, length, tubeGeo }
  }, [f, scale])
  const count = Math.max(4, Math.min(220, Math.round((length / scale) * (f.density ?? 22) * (quality === 'low' ? 0.55 : 1))))
  const { geo, offsets } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    const offsets = Float32Array.from({ length: count }, (_, i) => (i + Math.random() * 0.6) / count)
    return { geo: g, offsets }
  }, [count])
  const grad = useMemo(() => f.gradient ? [new THREE.Color(f.gradient[0]), new THREE.Color(f.gradient[1])] : null, [f])
  const pointsMat = useMemo(() => new THREE.PointsMaterial({ size: 0.055 * scale, map: glowSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false, sizeAttenuation: true }), [scale])
  const tubeMat = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []) // eslint-disable-line
  const t = useRef(Math.random())
  const pts = useRef<THREE.Points>(null!)
  const tubeRef = useRef<THREE.Mesh>(null!)
  const tmp = useMemo(() => new THREE.Color(), [])

  useFrame((_, dt) => {
    const s = getApp()
    const on = s.activeFlows.includes(f.kind) || s.activePaths.includes(f.id)
    const strong = s.activePaths.includes(f.id) || s.flowIsolate
    const target = on ? (strong ? 1 : 0.75) : 0
    pointsMat.opacity += (target - pointsMat.opacity) * (1 - Math.exp(-dt * 5))
    tubeMat.opacity = pointsMat.opacity * (strong ? 0.32 : 0.18)
    const vis = pointsMat.opacity > 0.01
    pts.current.visible = vis; tubeRef.current.visible = vis
    if (!vis) return
    // speed follows the machine: faster with rpm / throttle, slow "illustrative" flow when off
    const rt = liveRuntime.current
    const k = f.kind === 'fuel' || f.kind === 'air' || f.kind === 'exhaust' ? 0.45 + Math.min(1.6, rt.rpm / 2200) + rt.n1 : 1
    t.current += (dt * (f.speed ?? 1) * 0.55 * k * scale) / Math.max(length, 0.2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const col = geo.attributes.color as THREE.BufferAttribute
    const N = 256
    for (let i = 0; i < count; i++) {
      const u = (offsets[i] + t.current) % 1
      const j = Math.floor(u * N) * 3
      pos.setXYZ(i, lut[j], lut[j + 1], lut[j + 2])
      if (grad) tmp.copy(grad[0]).lerp(grad[1], u); else tmp.copy(color)
      const fade = Math.min(1, u * 10, (1 - u) * 10)
      col.setXYZ(i, tmp.r * fade, tmp.g * fade, tmp.b * fade)
    }
    pos.needsUpdate = true; col.needsUpdate = true
  })

  return (
    <group>
      <mesh ref={tubeRef} geometry={tubeGeo} material={tubeMat} visible={false} />
      <points ref={pts} geometry={geo} material={pointsMat} visible={false} frustumCulled={false} />
    </group>
  )
}

export function Flows({ def }: { def: VehicleDef }) {
  const quality = getApp().quality
  return (
    <group>
      {def.flows.map((f) => <Flow key={f.id} f={f} scale={def.scale} quality={quality} />)}
    </group>
  )
}
