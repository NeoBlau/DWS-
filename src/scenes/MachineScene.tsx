import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { useApp, getApp } from '../store'
import type { VehicleDef } from '../data/types'
import { CarModel } from '../models/CarModel'
import { AircraftModel } from '../models/AircraftModel'
import { Flows } from '../systems/Flows'
import { gridTexture } from '../utils/geom'
import { selectComponent } from '../utils/actions'
import { liveRuntime } from '../models/runtime'
import { setHover } from '../components/hover'

function Env() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.55
    return () => { env.dispose(); pm.dispose() }
  }, [gl, scene])
  return null
}

function Floor({ def }: { def: VehicleDef }) {
  const S = def.scale
  const tex = useMemo(() => { const t = gridTexture('#3b4b5c'); t.repeat.set(24, 24); return t }, [])
  const fade = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256
    const x = c.getContext('2d')!
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g; x.fillRect(0, 0, 256, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  const shadow = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128
    const x = c.getContext('2d')!
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g; x.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])
  const mat = useRef<THREE.MeshBasicMaterial>(null!)
  const grp = useRef<THREE.Group>(null!)
  useFrame((_, dt) => {
    const rt = liveRuntime.current
    tex.offset.x += (def.kind === 'car' ? rt.speed * 0.35 : rt.groundSpeed * 0.02) * dt / (S * 2)
    const s = getApp()
    const zone = def.walk.find((w) => w.id === s.walkZone)
    const target = zone?.lift ? 0.05 : 0.5
    mat.current.opacity += (target - mat.current.opacity) * (1 - Math.exp(-dt * 4))
    grp.current.position.y = def.kind === 'aircraft' ? -rt.altitude : 0
    grp.current.visible = rt.altitude < 400
  })
  return (
    <group ref={grp}>
      <Runway def={def} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[60 * S, 60 * S]} />
        <meshBasicMaterial ref={mat} map={tex} alphaMap={fade} transparent opacity={0.5} depthWrite={false} color="#9fb8d0" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} scale={def.kind === 'car' ? [6.2, 2.8, 1] : [44, 40, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} opacity={0.9} />
      </mesh>
    </group>
  )
}

/** night-to-day sky for the flight scenario: background and fog follow altitude */
function Sky({ def }: { def: VehicleDef }) {
  const { scene } = useThree()
  const base = useMemo(() => new THREE.Color('#05070a'), [])
  const low = useMemo(() => new THREE.Color('#0d1d2e'), [])
  const high = useMemo(() => new THREE.Color('#1c4370'), [])
  const tmp = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    const s = getApp()
    const flying = def.kind === 'aircraft' && s.tray === 'flight'
    const alt = liveRuntime.current.altitude
    if (flying) tmp.copy(low).lerp(high, Math.min(1, alt / 300)); else tmp.copy(base)
    const bg = scene.background as THREE.Color
    if (bg?.isColor) bg.lerp(tmp, 1 - Math.exp(-dt * 2))
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(bg)
  })
  return null
}

function Runway({ def }: { def: VehicleDef }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 512
    const x = c.getContext('2d')!
    x.fillStyle = '#14181d'; x.fillRect(0, 0, 64, 512)
    x.fillStyle = '#d9e2ea'; x.fillRect(31, 0, 2, 220)
    x.fillRect(2, 0, 2, 512); x.fillRect(60, 0, 2, 512)
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 6); return t
  }, [])
  const g = useRef<THREE.Mesh>(null!)
  useFrame((_, dt) => {
    const rt = liveRuntime.current
    if (!g.current) return
    tex.offset.y += rt.groundSpeed * dt / 100
    g.current.visible = getApp().tray === 'flight'
  })
  if (def.kind !== 'aircraft') return null
  return (
    <mesh ref={g} rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0.003, 0]}>
      <planeGeometry args={[45, 600]} />
      <meshBasicMaterial map={tex} transparent opacity={0.9} depthWrite={false} />
    </mesh>
  )
}

/** glowing section plane drawn where CUTAWAY slices the body */
function SectionPlane({ def }: { def: VehicleDef }) {
  const m = useRef<THREE.MeshBasicMaterial>(null!)
  const l = useRef<THREE.LineBasicMaterial>(null!)
  const box = def.kind === 'car' ? { w: 5.2, h: 1.9, cx: -0.1, cy: 0.95 } : { w: 39, h: 12, cx: 0, cy: 5.6 }
  const tex = useMemo(() => { const t = gridTexture('#8fd6ff'); t.repeat.set(box.w / (def.kind === 'car' ? 0.4 : 3), box.h / (def.kind === 'car' ? 0.4 : 3)); return t }, []) // eslint-disable-line
  const edge = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => new THREE.Vector3((x * box.w) / 2, (y * box.h) / 2, 0)))
    return g
  }, []) // eslint-disable-line
  useFrame((_, dt) => {
    const on = getApp().cutaway
    m.current.opacity += ((on ? 0.07 : 0) - m.current.opacity) * (1 - Math.exp(-dt * 4))
    l.current.opacity = m.current.opacity * 6
  })
  return (
    <group position={[box.cx, box.cy, 0]}>
      <mesh>
        <planeGeometry args={[box.w, box.h]} />
        <meshBasicMaterial ref={m} map={tex} color="#8fd6ff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <line>
        <primitive object={edge} attach="geometry" />
        <lineBasicMaterial ref={l} color="#8fd6ff" transparent opacity={0} />
      </line>
    </group>
  )
}

/** projects hotspot anchors to screen space every frame; the DOM layer reads hotspotScreen */
export const hotspotScreen = new Map<string, { x: number; y: number; vis: boolean }>()
function Projector({ def }: { def: VehicleDef }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    def.components.forEach((c) => {
      v.set(...c.pos).project(camera)
      const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
      hotspotScreen.set(c.id, { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, vis })
    })
  })
  return null
}

/** shifts the projection so the machine sits in the free space left of the right-hand panel */
function ViewShift() {
  const { camera, size } = useThree()
  const cur = useRef(0)
  useFrame((_, dt) => {
    const s = getApp()
    const want = window.innerWidth > 900 && (s.panels.systems || !!s.selected) && !s.learn ? Math.min(190, size.width * 0.12) : 0
    cur.current += (want - cur.current) * (1 - Math.exp(-dt * 4))
    const cam = camera as THREE.PerspectiveCamera
    if (Math.abs(cur.current) < 0.5) { if (cam.view) cam.clearViewOffset() }
    else cam.setViewOffset(size.width, size.height, cur.current, 0, size.width, size.height)
  })
  return null
}

/** on portrait screens pull wide shots back so the whole machine fits; close-ups stay untouched */
function fit(pos: [number, number, number], target: [number, number, number], scale: number): [number, number, number] {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight)
  const d = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2])
  if (aspect >= 1 || d < 3.5 * scale) return pos
  const k = Math.min(2.1, 0.95 / aspect)
  return [target[0] + (pos[0] - target[0]) * k, target[1] + (pos[1] - target[1]) * k, target[2] + (pos[2] - target[2]) * k]
}

function CameraRig({ def }: { def: VehicleDef }) {
  const ref = useRef<CameraControls>(null!)
  const shotKey = useApp((s) => s.shotKey)
  const first = useRef(true)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.smoothTime = 0.62
    c.draggingSmoothTime = 0.14
    c.dollyToCursor = true
    c.minDistance = 0.12 * def.scale
    c.maxDistance = 18 * def.scale
    c.maxPolarAngle = Math.PI * 0.98
    const o = def.overview
    if (first.current) {
      first.current = false
      // cinematic intro: start wide and high, settle into the overview
      const p = fit(o.pos, o.target, def.scale)
      c.setLookAt(p[0] * 1.9, p[1] * 2.6, p[2] * 1.9, ...o.target, false)
      c.setLookAt(...p, ...o.target, true)
    }
  }, [def])
  useEffect(() => {
    const s = getApp().shot
    const c = ref.current
    if (!s || !c || shotKey === 0) return
    let cancelled = false
    ;(async () => {
      if (s.via) { await c.setLookAt(...s.via, ...s.target, true); if (cancelled) return }
      await c.setLookAt(...fit(s.pos, s.target, def.scale), ...s.target, true)
    })()
    return () => { cancelled = true }
  }, [shotKey])
  return <CameraControls ref={ref} makeDefault />
}

function Effects() {
  const q = useApp((s) => s.quality)
  if (q === 'low') return null
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.82} luminanceSmoothing={0.25} radius={0.7} />
      <Vignette eskil={false} offset={0.22} darkness={0.72} />
    </EffectComposer>
  )
}

function Model({ def }: { def: VehicleDef }) {
  return (
    <group
      onPointerMove={(e) => {
        e.stopPropagation()
        const p = (e.object.userData.part ?? {}) as { comps?: string[] }
        const c = p.comps?.map((id) => def.components.find((k) => k.id === id)).find(Boolean)
        setHover(c ? c.name : null, e.nativeEvent.clientX, e.nativeEvent.clientY)
      }}
      onPointerOut={() => setHover(null, 0, 0)}
      onClick={(e) => {
        if (e.delta > 6) return
        e.stopPropagation()
        const p = (e.object.userData.part ?? {}) as { comps?: string[] }
        const c = p.comps?.map((id) => def.components.find((k) => k.id === id)).find(Boolean)
        if (c) selectComponent(def, c.id)
      }}
    >
      {def.kind === 'car' ? <CarModel def={def} /> : <AircraftModel def={def} />}
    </group>
  )
}

export function MachineScene({ def, paused }: { def: VehicleDef; paused?: boolean }) {
  const quality = useApp((s) => s.quality)
  return (
    <Canvas
      key={def.id}
      className="scene"
      frameloop={paused ? 'never' : 'always'}
      dpr={quality === 'high' ? [1, 1.75] : [1, 1.25]}
      gl={{ antialias: quality !== 'high', localClippingEnabled: true, powerPreference: 'high-performance' } as THREE.WebGLRendererParameters}
      camera={{ fov: def.kind === 'car' ? 38 : 42, near: 0.02 * def.scale, far: 900 * def.scale, position: def.overview.pos }}
      onCreated={({ gl }) => { gl.localClippingEnabled = true; gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05 }}
    >
      <color attach="background" args={['#05070a']} />
      <fog attach="fog" args={['#05070a', 14 * def.scale, 46 * def.scale]} />
      <Env />
      <Sky def={def} />
      <hemisphereLight args={['#bcd7ff', '#0b0f14', 0.35]} />
      <directionalLight position={[6 * def.scale, 9 * def.scale, 5 * def.scale]} intensity={1.6} color="#f4f8ff" />
      <directionalLight position={[-7 * def.scale, 4 * def.scale, -6 * def.scale]} intensity={0.9} color="#7fb6ff" />
      <pointLight position={[0, 3 * def.scale, -4 * def.scale]} intensity={6 * def.scale} distance={12 * def.scale} color="#5d8bd6" />
      <Suspense fallback={null}>
        <Model def={def} />
        <Flows def={def} />
        <SectionPlane def={def} />
        <Floor def={def} />
        <Projector def={def} />
      </Suspense>
      <CameraRig def={def} />
      <ViewShift />
      <Effects />
    </Canvas>
  )
}
