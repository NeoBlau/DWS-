import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { useApp } from '../store'
import { curve, glowSprite } from '../utils/geom'
import type { Vec3 } from '../data/types'

function Env() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env; scene.environmentIntensity = 0.6
    return () => { env.dispose(); pm.dispose() }
  }, [gl, scene])
  return null
}

export interface LabShot { pos: Vec3; target: Vec3 }

function Cam({ shot }: { shot: LabShot }) {
  const ref = useRef<CameraControls>(null!)
  const first = useRef(true)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.smoothTime = 0.7
    c.minDistance = 0.3
    c.maxDistance = 40
    if (first.current) { first.current = false; c.setLookAt(shot.pos[0] * 1.6, shot.pos[1] * 1.6 + 1, shot.pos[2] * 1.6, ...shot.target, false) }
    c.setLookAt(...shot.pos, ...shot.target, true)
  }, [shot.pos.join(','), shot.target.join(',')]) // eslint-disable-line
  return <CameraControls ref={ref} makeDefault />
}

/** shared Canvas for every deep-dive lab: lights, environment, smooth camera and bloom */
export function LabCanvas({ shot, children, clip }: { shot: LabShot; children: ReactNode; clip?: boolean }) {
  const quality = useApp((s) => s.quality)
  return (
    <Canvas className="scene" dpr={quality === 'high' ? [1, 1.75] : [1, 1.25]} camera={{ fov: 36, position: shot.pos, near: 0.02, far: 200 }}
      gl={{ localClippingEnabled: !!clip }} onCreated={({ gl }) => { gl.localClippingEnabled = true; gl.toneMapping = THREE.ACESFilmicToneMapping }}>
      <color attach="background" args={['#04070b']} />
      <Env />
      <hemisphereLight args={['#bcd7ff', '#05070a', 0.4]} />
      <directionalLight position={[5, 8, 6]} intensity={1.7} />
      <directionalLight position={[-6, 3, -5]} intensity={0.9} color="#7fb6ff" />
      {children}
      <Cam shot={shot} />
      {quality === 'high' && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.7} luminanceSmoothing={0.2} radius={0.7} />
          <Vignette eskil={false} offset={0.25} darkness={0.7} />
        </EffectComposer>
      )}
    </Canvas>
  )
}

/**
 * Particles streaming along a spline. `rate()` returns current speed (0 = stopped),
 * `color(u)` lets a stream change colour along its path (cold air → flame → exhaust).
 */
export function Stream({ points, rate, color, count = 60, size = 0.06, tension = 0.4, visible = () => true, jitter = 0 }: {
  points: Vec3[]; rate: () => number; color: (u: number, out: THREE.Color) => void; count?: number; size?: number; tension?: number; visible?: () => boolean; jitter?: number
}) {
  const { lut, len } = useMemo(() => {
    const c = curve(points, tension)
    const N = 300
    const lut = new Float32Array((N + 1) * 3)
    for (let i = 0; i <= N; i++) { const p = c.getPointAt(i / N); lut.set([p.x, p.y, p.z], i * 3) }
    return { lut, len: c.getLength() }
  }, [points, tension])
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    return g
  }, [count])
  const off = useMemo(() => Float32Array.from({ length: count }, () => Math.random()), [count])
  const jit = useMemo(() => Float32Array.from({ length: count * 3 }, () => (Math.random() - 0.5) * jitter), [count, jitter])
  const mat = useMemo(() => new THREE.PointsMaterial({ size, map: glowSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [size])
  const t = useRef(0)
  const pts = useRef<THREE.Points>(null!)
  const col = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    const on = visible()
    pts.current.visible = on
    if (!on) return
    t.current += (rate() * dt) / Math.max(0.3, len)
    const P = geo.attributes.position as THREE.BufferAttribute, Cc = geo.attributes.color as THREE.BufferAttribute
    for (let i = 0; i < count; i++) {
      const u = (off[i] + t.current) % 1
      const j = Math.floor(u * 300) * 3
      P.setXYZ(i, lut[j] + jit[i * 3], lut[j + 1] + jit[i * 3 + 1], lut[j + 2] + jit[i * 3 + 2])
      color(u, col)
      const f = Math.min(1, u * 12, (1 - u) * 12)
      Cc.setXYZ(i, col.r * f, col.g * f, col.b * f)
    }
    P.needsUpdate = true; Cc.needsUpdate = true
  })
  return <points ref={pts} geometry={geo} material={mat} frustumCulled={false} />
}

export const solid = (hex: string) => { const c = new THREE.Color(hex); return (_: number, out: THREE.Color) => { out.copy(c) } }
export const ramp = (stops: [number, string][]) => {
  const cs = stops.map(([u, h]) => [u, new THREE.Color(h)] as const)
  return (u: number, out: THREE.Color) => {
    for (let i = 0; i < cs.length - 1; i++) if (u <= cs[i + 1][0]) { const k = (u - cs[i][0]) / (cs[i + 1][0] - cs[i][0]); out.copy(cs[i][1]).lerp(cs[i + 1][1], Math.max(0, Math.min(1, k))); return }
    out.copy(cs[cs.length - 1][1])
  }
}

export function LabHeader({ eyebrow, title, text, onClose, children }: { eyebrow: string; title: string; text?: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="lab-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {children}
        <button className="btn" onClick={onClose}>Close ✕</button>
      </div>
    </div>
  )
}

export const mat = (color: string, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.35, ...o })
export const glass = (color = '#9fb6c8', opacity = 0.16, clip?: THREE.Plane[]) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: 0.2, roughness: 0.1, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: clip ?? null })
