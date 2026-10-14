import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Sky, Environment, OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom, SMAA, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import { create } from 'zustand'
import { useApp, getApp } from '../../store'
import { updateCarAudio, stopCarAudio } from './carAudio'
import { VEHICLES } from '../../vehicles'
import { CarModel } from '../../models/CarModel'
import type { CarLayout } from '../../models/carLayout'
import type { Runtime } from '../../models/runtime'
import { useT, useLang, T, type Txt } from '../i18n'
import { pollPad, BTN, PAD } from '../gamepad'
import { CAR_SPECS, TRACK, createCar, stepCar, selectGear, requestMode, warmUp, H, G, type Car, type DriveMode, type Hardware } from './carPhysics'

/*
 * Driving simulator on a proving ground. The physics (carPhysics.ts) runs at 240 Hz; this file draws the
 * car (the same procedural model as the 3D tours), the ground, the instruments and the live explanation.
 * World mapping: physics (X, Y) → three (x, z), yaw ψ → rotation.y = −ψ, so the model's +z side is the car's left.
 */
type CarId = 'fortuner' | 'bmw'
type Cam = 'chase' | 'driver' | 'hood' | 'wheel' | 'orbit'
const useDrive = create<{ car: CarId; cam: Cam; paused: boolean; epoch: number; set: (p: Partial<{ car: CarId; cam: Cam; paused: boolean; epoch: number }>) => void }>((set) => ({
  car: 'fortuner', cam: 'chase', paused: false, epoch: 0, set: (p) => set(p),
}))
const D: { car: Car; keys: Set<string>; wheelAngle: number } = { car: createCar(CAR_SPECS.fortuner), keys: new Set(), wheelAngle: 0 }
function reset(id: CarId) { D.car = createCar(CAR_SPECS[id]); useDrive.getState().set({ car: id, epoch: useDrive.getState().epoch + 1 }) }

/* ------------------------------------------------------------------ inputs: keyboard + gamepad */
const ramp = (v: number, t: number, up: number, down: number, dt: number) => v + Math.max(-down * dt, Math.min(up * dt, t - v))
function applyInputs(c: Car, dt: number) {
  const k = c.ctl, has = (...x: string[]) => x.some((y) => D.keys.has(y))
  const gp = pollPad()
  if (gp.connected && (gp.rt > 0.02 || gp.lt > 0.02 || gp.lx)) {
    k.throttle = gp.rt; k.brake = gp.lt; k.steer = -gp.lx
  } else {
    k.throttle = ramp(k.throttle, has('KeyW', 'ArrowUp') ? 1 : 0, 2.5, 5, dt)
    k.brake = ramp(k.brake, has('KeyS', 'ArrowDown') ? 1 : 0, 4, 6, dt)
    const st = (has('KeyA', 'ArrowLeft') ? 1 : 0) - (has('KeyD', 'ArrowRight') ? 1 : 0)
    k.steer = ramp(k.steer, st, 2.2, 3.5, dt)
  }
  k.handbrake = has('Space') || (gp.connected && gp.held[BTN.A]) ? 1 : 0
  if (gp.connected) {
    const P = gp.pressed
    if (P[BTN.RB]) { k.manual = true; k.shiftReq = 1 }
    if (P[BTN.LB]) { k.manual = true; k.shiftReq = -1 }
    if (P[BTN.X]) k.ignition = !k.ignition
    if (P[BTN.BACK]) selectGear(c, ({ P: 'R', R: 'N', N: 'D', D: 'P' } as const)[k.select])
    if (P[BTN.Y]) cycleCam()
    if (P[BTN.START]) useDrive.getState().set({ paused: !useDrive.getState().paused })
    if (P[BTN.B]) k.manual = !k.manual
  }
}
function cycleCam() { const m: Cam[] = ['chase', 'driver', 'hood', 'wheel', 'orbit']; const s = useDrive.getState(); s.set({ cam: m[(m.indexOf(s.cam) + 1) % m.length] }) }

/* ------------------------------------------------------------------ physics loop + car */
function Loop() {
  const acc = useRef(0)
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1)
    if (useDrive.getState().paused) { acc.current = 0; return }
    applyInputs(D.car, dt)
    acc.current += dt
    let n = 0
    while (acc.current >= H && n < 60) { stepCar(D.car, H); acc.current -= H; n++ }
    const avgW = D.car.wheels.reduce((s, w) => s + w.omega, 0) / 4
    D.wheelAngle += avgW * dt
    updateCarAudio(D.car, useDrive.getState().cam, dt)
  })
  return null
}
function CarBody({ id }: { id: CarId }) {
  const def = VEHICLES[id]
  const L = def.layout as CarLayout
  const sp = CAR_SPECS[id]
  const g = useRef<THREE.Group>(null!), body = useRef<THREE.Group>(null!)
  const drive = useMemo(() => (rt: Runtime) => {
    const c = D.car
    rt.rpm = c.rpm; rt.crank += (c.rpm / 60) * Math.PI * 2 * 0.02; rt.turbo += c.boost * 0.6 + 0.02; rt.fan += c.engineOn ? 0.1 : 0
    rt.speed = Math.abs(c.u); rt.wheel = D.wheelAngle; rt.steer = -c.delta / 0.42
    rt.brakeHeat = Math.max(0, Math.min(1, rt.brakeHeat + c.ctl.brake * Math.abs(c.u) * 0.0006 - 0.002))
    rt.bounce = 0
  }, [])
  useFrame(() => {
    const c = D.car
    g.current.position.set(c.x, 0, c.y)
    g.current.rotation.y = -c.psi
    body.current.rotation.set(c.rolled ? -1.6 : c.roll, 0, c.pitch)
    body.current.position.set(sp.a - (sp.a + sp.b) / 2, c.rolled ? 1.0 : 0, 0)
  })
  return <group ref={g}><group ref={body}><CarModel def={def} drive={drive} /></group><SlipRings /></group>
}
/** friction circles drawn under each tyre: how much of the available grip is used, and in which direction */
function SlipRings() {
  const refs = useRef<THREE.Mesh[]>([])
  const mats = useMemo(() => [0, 1, 2, 3].map(() => new THREE.MeshBasicMaterial({ color: '#36e07a', transparent: true, opacity: 0.85, depthWrite: false })), [])
  const geo = useMemo(() => new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2), [])
  useFrame(() => {
    const c = D.car, sp = c.spec
    const pos = [[sp.a, sp.track / 2], [sp.a, -sp.track / 2], [-sp.b, sp.track / 2], [-sp.b, -sp.track / 2]]
    c.wheels.forEach((w, i) => {
      const m = refs.current[i]; if (!m) return
      const use = w.fz > 0 ? Math.hypot(w.fx, w.fy) / (Math.max(1, w.fz) * (w.surface === 'ice' ? 0.12 : w.surface === 'wet' ? 0.62 : w.surface === 'gravel' ? 0.6 : w.surface === 'grass' ? 0.45 : 1)) : 0
      m.position.set(pos[i][0], 0.03, pos[i][1])
      const sliding = Math.abs(w.kappa) > 0.15 || Math.abs(w.alpha) > 0.14
      mats[i].color.set(w.abs ? '#5cd8ff' : sliding ? '#ff4a3d' : use > 0.8 ? '#ffb02e' : '#36e07a')
      m.scale.setScalar(0.6 + Math.min(1.2, use) * 0.8)
      m.visible = useDrive.getState().cam !== 'driver'
    })
  })
  return <group>{mats.map((m, i) => <mesh key={i} ref={(o) => { if (o) refs.current[i] = o }} geometry={geo} material={m} renderOrder={3} />)}</group>
}

/* ------------------------------------------------------------------ proving ground */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, rep: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  return t
}
function grain(g: CanvasRenderingContext2D, w: number, h: number, base: string, n: number, a: number, light = false) {
  g.fillStyle = base; g.fillRect(0, 0, w, h)
  for (let i = 0; i < n; i++) { const v = light ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2) }
}
function Ground() {
  const m = useMemo(() => {
    const asph = canvasTex(512, 512, (g) => { grain(g, 512, 512, '#46484b', 40000, 0.25) }, [80, 80])
    const grass = canvasTex(512, 512, (g) => { g.fillStyle = '#4f6b3a'; g.fillRect(0, 0, 512, 512); for (let i = 0; i < 30000; i++) { g.fillStyle = `rgba(${30 + Math.random() * 60},${70 + Math.random() * 60},${20 + Math.random() * 30},0.5)`; g.fillRect(Math.random() * 512, Math.random() * 512, 1, 3) } }, [600, 600])
    const gravel = canvasTex(256, 256, (g) => { g.fillStyle = '#8d8270'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 6000; i++) { const c = 90 + Math.random() * 90; g.fillStyle = `rgb(${c},${c * 0.93},${c * 0.82})`; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 0.8 + Math.random() * 2, 0, 7); g.fill() } }, [40, 40])
    return {
      asph: new THREE.MeshStandardMaterial({ map: asph, roughness: 0.9 }),
      wet: new THREE.MeshPhysicalMaterial({ color: '#2b2e33', roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, polygonOffset: true, polygonOffsetFactor: -1 }),
      ice: new THREE.MeshPhysicalMaterial({ color: '#d8e9f2', roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, polygonOffset: true, polygonOffsetFactor: -1 }),
      gravel: new THREE.MeshStandardMaterial({ map: gravel, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
      grass: new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
      paint: new THREE.MeshStandardMaterial({ color: '#f0f0ea', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }),
      cone: new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.6 }),
      white: new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.6 }),
    }
  }, [])
  const T0 = TRACK
  const plane = (x0: number, x1: number, y0: number, y1: number, mat: THREE.Material, h: number) => (
    <mesh position={[(x0 + x1) / 2, h, (y0 + y1) / 2]} rotation-x={-Math.PI / 2} material={mat} receiveShadow><planeGeometry args={[x1 - x0, y1 - y0]} /></mesh>
  )
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[600, -0.02, 0]} material={m.grass} receiveShadow><planeGeometry args={[6000, 6000]} /></mesh>
      {plane(T0.pad.x0, T0.pad.x1, T0.pad.y0, T0.pad.y1, m.asph, 0)}
      {plane(T0.strip.x0, T0.strip.x1, T0.strip.y0, T0.strip.y1, m.asph, 0)}
      <mesh position={[T0.wet.x, 0.01, T0.wet.y]} rotation-x={-Math.PI / 2} material={m.wet} receiveShadow><circleGeometry args={[T0.wet.r, 64]} /></mesh>
      {plane(T0.ice.x0, T0.ice.x1, T0.ice.y0, T0.ice.y1, m.ice, 0.01)}
      {plane(T0.gravel.x0, T0.gravel.x1, T0.gravel.y0, T0.gravel.y1, m.gravel, 0.01)}
      {/* strip markings: start line, 100 m ticks, 400 m finish */}
      {Array.from({ length: 13 }, (_, i) => <mesh key={i} position={[T0.strip.x0 + 20 + i * 100, 0.02, 0]} rotation-x={-Math.PI / 2} material={m.paint}><planeGeometry args={[i === 0 || i === 4 ? 1.2 : 0.4, i === 0 || i === 4 ? 28 : 6]} /></mesh>)}
      {Array.from({ length: 60 }, (_, i) => <mesh key={`c${i}`} position={[T0.strip.x0 + 10 + i * 21, 0.02, 0]} rotation-x={-Math.PI / 2} material={m.paint}><planeGeometry args={[9, 0.25]} /></mesh>)}
      {/* slalom cones */}
      {T0.cones.map(([x, y], i) => (
        <group key={i} position={[x, 0, y]}>
          <mesh position={[0, 0.35, 0]} material={m.cone} castShadow><coneGeometry args={[0.16, 0.7, 16]} /></mesh>
          <mesh position={[0, 0.42, 0]} material={m.white}><cylinderGeometry args={[0.095, 0.115, 0.1, 16]} /></mesh>
          <mesh position={[0, 0.02, 0]} material={m.cone}><boxGeometry args={[0.38, 0.04, 0.38]} /></mesh>
        </group>
      ))}
      {/* skid-pad circle line */}
      <mesh position={[60, 0.02, -100]} rotation-x={-Math.PI / 2} material={m.paint}><ringGeometry args={[29.8, 30.2, 128]} /></mesh>
    </group>
  )
}
function SkyLight() {
  const sun = useRef<THREE.DirectionalLight>(null!)
  const sunPos: [number, number, number] = [-400, 520, 300]
  useFrame(() => {
    const c = D.car
    sun.current.position.set(c.x - 40, 60, c.y + 30)
    sun.current.target.position.set(c.x, 0, c.y); sun.current.target.updateMatrixWorld()
  })
  return (
    <>
      <Sky distance={450000} sunPosition={sunPos} turbidity={4} rayleigh={1.1} mieCoefficient={0.004} mieDirectionalG={0.82} />
      <Environment resolution={256} frames={1} environmentIntensity={0.7}><Sky distance={450000} sunPosition={sunPos} turbidity={4} rayleigh={1.1} /></Environment>
      <hemisphereLight args={['#bcd4f2', '#4d5642', 0.45]} />
      <directionalLight ref={sun} intensity={2.4} color="#fff0d8" castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0003} shadow-normalBias={0.02}
        shadow-camera-left={-15} shadow-camera-right={15} shadow-camera-top={15} shadow-camera-bottom={-15} shadow-camera-near={1} shadow-camera-far={200} />
      <fog attach="fog" args={['#c9d7e6', 300, 2800]} />
    </>
  )
}

/* ------------------------------------------------------------------ cameras */
function Cameras({ orbit }: { orbit: React.MutableRefObject<OrbitImpl | null> }) {
  const { camera } = useThree() as { camera: THREE.PerspectiveCamera }
  const id = useDrive((s) => s.car)
  const L = VEHICLES[id].layout as CarLayout
  const sp = CAR_SPECS[id]
  const rel = useRef(new THREE.Vector3(-8, 3, 0)), look = useMemo(() => new THREE.Vector3(), []), last = useRef({ x: 0, y: 0 })
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1), c = D.car, mode = useDrive.getState().cam
    const cs = Math.cos(c.psi), sn = Math.sin(c.psi)
    // car-frame point (forward, up, left) → world
    const W = (f: number, u: number, l: number, out: THREE.Vector3) => out.set(c.x + f * cs - l * sn, u, c.y + f * sn + l * cs)
    const off = sp.a - (sp.a + sp.b) / 2 // model origin relative to the CG
    if (orbit.current) orbit.current.enabled = mode === 'orbit'
    let fov = 55
    if (mode === 'chase') {
      const dist = id === 'fortuner' ? 8.5 : 7.5
      const want = new THREE.Vector3(-cs * dist, 2.8, -sn * dist)
      rel.current.lerp(want, 1 - Math.exp(-dt * 4))
      camera.position.set(c.x + rel.current.x, rel.current.y, c.y + rel.current.z)
      W(3, 0.9, 0, look); camera.lookAt(look)
    } else if (mode === 'driver') {
      const [sx, sy, sz] = L.steeringWheel
      W(off + sx - 0.42, sy + 0.3, sz, camera.position)
      W(off + sx + 10, sy - 0.4, sz, look); camera.lookAt(look); fov = 62
    } else if (mode === 'hood') {
      W(off + L.front - 0.9, L.belt + 0.2, 0, camera.position); W(off + L.front + 12, L.belt - 0.3, 0, look); camera.lookAt(look); fov = 60
    } else if (mode === 'wheel') {
      W(sp.a + 1.6, 0.45, sp.track / 2 + 1.0, camera.position); W(sp.a, 0.35, sp.track / 2, look); camera.lookAt(look); fov = 50
    } else if (mode === 'orbit' && orbit.current) {
      camera.position.x += c.x - last.current.x; camera.position.z += c.y - last.current.y
      orbit.current.target.set(c.x, 0.8, c.y); orbit.current.update()
    }
    last.current = { x: c.x, y: c.y }
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix() }
  })
  return null
}

/* ------------------------------------------------------------------ instruments */
function useCarSnap() {
  const [v, setV] = useState(() => snap())
  useEffect(() => { const id = setInterval(() => setV(snap()), 66); return () => clearInterval(id) }, [])
  return v
}
function snap() {
  const c = D.car, sp = c.spec, L = sp.a + sp.b
  const fzFront = c.wheels[0].fz + c.wheels[1].fz, fzAll = c.wheels.reduce((s, w) => s + w.fz, 0) || 1
  const aF = (c.wheels[0].alpha + c.wheels[1].alpha) / 2, aR = (c.wheels[2].alpha + c.wheels[3].alpha) / 2
  return {
    kmh: c.u * 3.6, rpm: c.rpm, gear: c.gear, sel: c.ctl.select, manual: c.ctl.manual, mode: c.ctl.mode, boost: c.boost, on: c.engineOn, ign: c.ctl.ignition,
    ax: c.ax / G, ay: c.ay / G, frontPct: (fzFront / fzAll) * 100, abs: c.wheels.some((w) => w.abs), tcs: c.tcs, esc: c.esc, lockup: c.lockup,
    absOn: c.ctl.abs, tcsOn: c.ctl.tcs, escOn: c.ctl.esc, surface: c.wheels[0].surface, aF, aR, beta: Math.atan2(c.v, Math.max(0.5, Math.abs(c.u))),
    hw: JSON.parse(JSON.stringify(c.hw)) as Hardware, prot: c.ctl.prot, partTime: sp.partTime, byWire: sp.byWire, diesel: sp.diesel, t: c.t, evs: c.events.slice(-6),
    t100: c.timer.t100, d400: c.timer.d400, rolled: c.rolled, lift: c.wheels.some((w) => w.lift), ssf: sp.track / (2 * sp.cgH), torque: c.wheelTorque, L,
    redline: sp.redline, awd: sp.awd, events: c.events.slice(-1)[0], throttle: c.ctl.throttle, brake: c.ctl.brake,
  }
}
type Snap = ReturnType<typeof snap>
function Gauge({ value, max, label, red, unit }: { value: number; max: number; label: string; red?: number; unit: string }) {
  const a = (v: number) => (-225 + (Math.min(max, Math.max(0, v)) / max) * 270) * (Math.PI / 180)
  const R = 62
  const step = max > 1000 ? 1000 : 20
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  return (
    <svg viewBox="0 0 160 150" className="ds-gauge" role="img" aria-label={label}>
      <circle cx={80} cy={80} r={72} fill="#0b0e13" stroke="#2a313c" />
      {red !== undefined && <path d={`M${80 + Math.cos(a(red)) * R} ${80 + Math.sin(a(red)) * R} A${R} ${R} 0 0 1 ${80 + Math.cos(a(max)) * R} ${80 + Math.sin(a(max)) * R}`} stroke="#ff4a3d" strokeWidth={6} fill="none" />}
      {ticks.map((tv, i) => <g key={i}><line x1={80 + Math.cos(a(tv)) * 54} y1={80 + Math.sin(a(tv)) * 54} x2={80 + Math.cos(a(tv)) * 66} y2={80 + Math.sin(a(tv)) * 66} stroke="#c9d2dd" strokeWidth={1.5} /><text x={80 + Math.cos(a(tv)) * 42} y={84 + Math.sin(a(tv)) * 42} fill="#9aa4b2" fontSize={9} textAnchor="middle" fontFamily="ui-monospace,monospace">{Math.round(max > 1000 ? tv / 1000 : tv)}</text></g>)}
      <line x1={80} y1={80} x2={80 + Math.cos(a(value)) * 60} y2={80 + Math.sin(a(value)) * 60} stroke="#ff7a2a" strokeWidth={3} strokeLinecap="round" />
      <circle cx={80} cy={80} r={5} fill="#ff7a2a" />
      <text x={80} y={118} fill="#f2f4f6" fontSize={16} textAnchor="middle" fontFamily="ui-monospace,monospace">{Math.round(Math.abs(max > 1000 ? value : value))}</text>
      <text x={80} y={134} fill="#9aa4b2" fontSize={9} textAnchor="middle" fontFamily="ui-monospace,monospace">{unit}</text>
    </svg>
  )
}
function Instruments({ v }: { v: Snap }) {
  const lamp = (on: boolean, active: boolean, txt: string) => <span className={`ds-lamp ${!on ? 'off' : active ? 'act' : ''}`}>{txt}{!on && ' OFF'}</span>
  return (
    <div className="ds-cluster glass">
      <Gauge value={v.rpm} max={v.redline > 5000 ? 8000 : 5000} red={v.redline} label="Tachometer" unit="RPM" />
      <div className="ds-mid">
        <b className="ds-gear">{v.sel === 'D' ? (v.manual ? `M${v.gear}` : `D${v.gear}`) : v.sel}</b>
        <div className="ds-lamps">{lamp(v.absOn, v.abs, 'ABS')}{lamp(v.tcsOn, v.tcs, 'TCS')}{lamp(v.escOn, v.esc, 'ESC')}</div>
        {v.awd && <small>{v.mode}</small>}
        <small>{v.lockup ? 'LOCK-UP' : 'CONVERTER'}</small>
        <div className="ds-boost"><i style={{ width: `${v.boost * 100}%` }} /></div><small>TURBO</small>
      </div>
      <Gauge value={Math.abs(v.kmh)} max={v.redline > 5000 ? 280 : 200} label="Speedometer" unit="KM/H" />
      <GMeter v={v} />
    </div>
  )
}
function GMeter({ v }: { v: Snap }) {
  return (
    <svg viewBox="0 0 120 120" className="ds-gm" role="img" aria-label="G-meter">
      <circle cx={60} cy={60} r={54} fill="#0b0e13" stroke="#2a313c" />
      {[0.5, 1].map((r) => <circle key={r} cx={60} cy={60} r={r * 48} fill="none" stroke="#2a313c" />)}
      <line x1={6} x2={114} y1={60} y2={60} stroke="#2a313c" /><line y1={6} y2={114} x1={60} x2={60} stroke="#2a313c" />
      <circle cx={60 - v.ay * 48} cy={60 - v.ax * 48} r={6} fill="#5cd8ff" />
      <text x={60} y={114} fill="#9aa4b2" fontSize={8} textAnchor="middle" fontFamily="ui-monospace,monospace">{Math.hypot(v.ax, v.ay).toFixed(2)} g</text>
    </svg>
  )
}

/* ------------------------------------------------------------------ narration */
function narrate(v: Snap): { title: Txt; body: Txt } {
  const f = (n: number, d = 0) => n.toFixed(d)
  // the hardware just told us something: explain it first
  for (let i = v.evs.length - 1; i >= 0; i--) { const e = v.evs[i]; if (v.t - e.t < 8 && HEALTH[e.e]) return HEALTH[e.e](v) }
  if (v.on && v.hw.oil < 50 && v.rpm > v.redline * 0.5) return HEALTH.coldRev(v)
  if (v.rolled) return { title: T('Опрокидывание', 'Rollover'), body: T(`Боковое ускорение превысило запас устойчивости: у этой машины t/2h ≈ ${f(v.ssf, 2)} — при таком ускорении в g внутренние колёса отрываются. У высокого внедорожника запас меньше, чем у седана; ESC как раз ограничивает поворот, чтобы этого не случилось.`, `Lateral acceleration exceeded the stability margin: this car's t/2h ≈ ${f(v.ssf, 2)} — at that many g the inner wheels lift. A tall SUV has less margin than a sedan; ESC limits the turn to prevent exactly this.`) }
  if (!v.ign) return { title: T('Машина заглушена', 'Engine off'), body: T('Нажмите «Зажигание» (клавиша I или X на геймпаде): стартер раскрутит коленвал, пойдёт впрыск, и двигатель выйдет на холостой ход. Затем селектор в D (клавиша D).', 'Press Ignition (key I or X on a gamepad): the starter cranks the engine, fuel is injected and it settles at idle. Then put the selector in D (key D).') }
  if (v.lift) return { title: T('Колесо оторвалось!', 'A wheel lifted!'), body: T(`Боковое ускорение ${f(Math.abs(v.ay), 2)} g переносит вес наружу: внутренние колёса почти не нагружены. Порог опрокидывания для этой машины ≈ ${f(v.ssf, 2)} g (t/2h).`, `Lateral acceleration of ${f(Math.abs(v.ay), 2)} g moves the weight outward: the inner wheels are almost unloaded. This car's rollover threshold is ≈ ${f(v.ssf, 2)} g (t/2h).`) }
  if (v.abs) return { title: T('Работает ABS', 'ABS active'), body: T('Колесо начинало блокироваться: ABS 10–15 раз в секунду отпускает и снова сжимает тормоз, удерживая проскальзывание около 10 % — там шина держит лучше всего и машина продолжает слушаться руля. Попробуйте выключить ABS и затормозить на мокром круге.', 'A wheel was about to lock: ABS releases and re-applies the brake 10–15 times a second, holding slip near 10 % where the tyre grips best and the car still steers. Try switching ABS off and braking on the wet circle.') }
  if (v.esc) return { title: T('Работает ESC', 'ESC active'), body: T(`Машина поворачивает не так, как вы рулите (угол заноса ${f(Math.abs(v.beta) * 57.3, 0)}°). Система подтормаживает одно колесо — это создаёт момент, возвращающий машину на траекторию, и снижает тягу.`, `The car is not turning the way you steer (slip angle ${f(Math.abs(v.beta) * 57.3, 0)}°). The system brakes a single wheel — that creates a yaw moment back onto your line — and cuts engine torque.`) }
  if (v.tcs) return { title: T('Работает TCS', 'Traction control'), body: T('Ведущие колёса начали буксовать: момент двигателя больше, чем шина может передать на это покрытие (μ × нагрузка). Система снизила тягу, чтобы вернуть сцепление.', 'The driven wheels started to spin: engine torque exceeds what the tyre can transmit on this surface (μ × load). The system cut torque to restore grip.') }
  if (Math.abs(v.ay) > 0.35) {
    const over = Math.abs(v.aR) > Math.abs(v.aF) + 0.02, under = Math.abs(v.aF) > Math.abs(v.aR) + 0.03
    return { title: T(over ? 'Избыточная поворачиваемость' : under ? 'Недостаточная поворачиваемость' : 'Поворот', over ? 'Oversteer' : under ? 'Understeer' : 'Cornering'), body: T(`Боковое ускорение ${f(Math.abs(v.ay), 2)} g. Углы увода: перед ${f(Math.abs(v.aF) * 57.3, 1)}°, зад ${f(Math.abs(v.aR) * 57.3, 1)}°. ${over ? 'Задние шины скользят сильнее — зад выносит. Уберите газ плавно и доверните руль в сторону заноса.' : under ? 'Передние шины работают на пределе — машина «плывёт» наружу. Сбросьте скорость, а не добавляйте руль.' : 'Шины на переднем и заднем мостах загружены поровну — нейтральный поворот.'}`, `Lateral ${f(Math.abs(v.ay), 2)} g. Slip angles: front ${f(Math.abs(v.aF) * 57.3, 1)}°, rear ${f(Math.abs(v.aR) * 57.3, 1)}°. ${over ? 'The rear tyres slide more — the tail steps out. Ease off and steer into the slide.' : under ? 'The front tyres are at their limit — the car pushes wide. Slow down rather than adding steering.' : 'Front and rear tyres share the load — neutral handling.'}`) }
  }
  if (v.brake > 0.3 && v.kmh > 10) return { title: T('Торможение', 'Braking'), body: T(`Замедление ${f(-v.ax, 2)} g. Вес переносится вперёд: на передние колёса сейчас ${f(v.frontPct)} % веса. Поэтому передние тормоза мощнее задних, а нос «клюёт».`, `Decelerating at ${f(-v.ax, 2)} g. Weight shifts forward: the front wheels now carry ${f(v.frontPct)} % of the weight. That is why front brakes are bigger and the nose dives.`) }
  if (v.throttle > 0.6 && v.kmh > 2) return { title: T('Разгон', 'Acceleration'), body: T(`Передача ${v.gear}, ${f(v.rpm)} об/мин, турбонаддув ${f(v.boost * 100)} %. Момент на колёсах ≈ ${f(v.torque)} Н·м — двигатель × передаточное число × главная пара${v.lockup ? '' : ' × гидротрансформатор (он умножает момент, пока колёса медленнее мотора)'}. Вес уходит назад: на передних колёсах ${f(v.frontPct)} %.`, `Gear ${v.gear}, ${f(v.rpm)} rpm, boost ${f(v.boost * 100)} %. Wheel torque ≈ ${f(v.torque)} N·m — engine × gear ratio × final drive${v.lockup ? '' : ' × torque converter (it multiplies torque while the wheels lag the engine)'}. Weight moves back: ${f(v.frontPct)} % on the front wheels.`) }
  if (v.surface !== 'asphalt') return { title: T('Покрытие', 'Surface'), body: T({ wet: 'Мокрый асфальт: коэффициент сцепления ≈ 0,6 вместо ≈ 1,0 на сухом — тормозной путь в 1,6 раза длиннее.', ice: 'Лёд: сцепление ≈ 0,12 — в 8 раз меньше, чем на асфальте. Всё делайте плавно.', gravel: 'Гравий: сцепление ≈ 0,6 и большое сопротивление качению.', grass: 'Трава: сцепление ≈ 0,45, машина вязнет.' }[v.surface as 'wet'] ?? '', { wet: 'Wet asphalt: friction ≈ 0.6 instead of ≈ 1.0 dry — braking distance is 1.6× longer.', ice: 'Ice: friction ≈ 0.12 — eight times less than asphalt. Do everything gently.', gravel: 'Gravel: friction ≈ 0.6 and high rolling resistance.', grass: 'Grass: friction ≈ 0.45, the car bogs down.' }[v.surface as 'wet'] ?? '') }
  return { title: T('Полигон', 'Proving ground'), body: T('Прямая для замеров справа (0–100 км/ч и 400 м засекаются сами), мокрый круг, лёд, гравий и змейка из конусов. Кольца под колёсами показывают, сколько сцепления использует каждая шина: зелёный — запас, жёлтый — у предела, красный — скользит, голубой — работает ABS.', 'The timing strip is to the right (0–100 km/h and 400 m are timed automatically), plus a wet circle, ice, gravel and a cone slalom. Rings under the wheels show how much grip each tyre uses: green — margin, yellow — near the limit, red — sliding, blue — ABS.') }
}

/* ------------------------------------------------------------------ what the hardware says, and why */
const HEALTH: Record<string, (v: Snap) => { title: Txt; body: Txt }> = {
  atfHot: (v) => ({ title: T(`Масло АКПП ${Math.round(v.hw.atf)} °C`, `Transmission fluid ${Math.round(v.hw.atf)} °C`), body: T('Гидротрансформатор передаёт момент через масло: пока турбина медленнее насоса (машина стоит на тормозе, буксует, тянет в гору на низкой передаче), вся разница мощностей превращается в нагрев масла. Нормально 70–95 °C; выше 120 °C масло окисляется, фрикционы начинают гореть. Именно поэтому «стоп-тест» на заводе длится не больше 5 секунд.', 'The torque converter transmits torque through oil: while the turbine is slower than the pump (car held on the brake, wheels stuck, climbing in a low gear) the whole power difference heats the fluid. Normal is 70–95 °C; above 120 °C the oil oxidises and the clutch linings start to burn. That is why a factory stall test lasts no more than 5 seconds.') }),
  atfProtect: (v) => ({ title: T('Защита АКПП: ограничение момента', 'Transmission protection: torque limited'), body: T(`Масло ${Math.round(v.hw.atf)} °C. Блок управления коробкой попросил двигатель снизить момент — меньше проскальзывания, меньше нагрева. Отпустите газ, дайте машине ехать: на ходу с блокировкой гидротрансформатора масло остывает в радиаторе.`, `Fluid at ${Math.round(v.hw.atf)} °C. The transmission computer asked the engine for less torque — less slip, less heat. Lift off and let the car roll: with the converter locked up the fluid cools in the radiator.`) }),
  limp: () => ({ title: T('Аварийный режим АКПП', 'Transmission limp mode'), body: T('Коробка перегрета или повреждена: блок управления зафиксировал 3-ю передачу — так можно доехать до сервиса, не сжигая фрикционы переключениями.', 'The transmission is overheated or damaged: the computer locked it in 3rd — enough to reach a workshop without burning the clutches by shifting.') }),
  transFail: () => ({ title: T('Коробка сгорела', 'Transmission destroyed'), body: T('Фрикционные пакеты разрушены (перегрев, удар при включении R на ходу или «бросок» с высоких оборотов). Двигатель ревёт, а момент до колёс почти не доходит — проскальзывание. Ремонт — переборка АКПП.', 'The clutch packs are destroyed (overheating, reverse engaged while moving, or a neutral drop at high revs). The engine revs but almost no torque reaches the wheels — they slip. The fix is a gearbox rebuild.') }),
  neutralDrop: () => ({ title: T('«Бросок» из нейтрали', 'Neutral drop'), body: T('Двигатель раскручен на N, затем включён D: маховик и гидротрансформатор с накопленной энергией ударом передают её через фрикцион на валы, шестерни и полуоси. Ресурс коробки съеден за одну секунду. Включайте передачу только на холостых.', 'The engine was revved in N, then D selected: the flywheel and converter dump their stored energy through a clutch into the shafts, gears and axles in one hit. Gearbox life gone in a second. Select a gear only at idle.') }),
  engageDelay: () => ({ title: T('Коробка задержала включение', 'Engagement delayed'), body: T('Вы включили передачу на высоких оборотах. Блок управления не стал включать фрикцион сразу: он придушил двигатель и плавно заполнил пакет маслом. Выключите защиты — и увидите, что бывает без этого.', 'You selected a gear at high revs. The computer did not slam the clutch: it cut the engine and filled the clutch pack gently. Switch the protections off to see what happens without them.') }),
  revRefused: (v) => ({ title: T('R на ходу запрещён', 'Reverse refused at speed'), body: v.byWire ? T('Селектор «по проводам»: он только просит, решает блок управления. На ходу вперёд задний ход не включится.', 'Shift-by-wire selector: it only asks, the computer decides. Reverse will not engage while rolling forward.') : T('Блок управления заблокировал клапан заднего хода: чтобы включить R на ходу, фрикцион пришлось бы остановить машину целиком — он бы сгорел. Сначала остановитесь.', 'The computer blocked the reverse valve: to engage R while moving forward the clutch would have to stop the whole car — it would burn. Stop first.') }),
  reverseShock: () => ({ title: T('Задний ход на ходу!', 'Reverse at speed!'), body: T('Защиты выключены, и фрикцион заднего хода попытался остановить движущуюся машину: удар, рывок, ресурс коробки сильно уменьшен.', 'With the protections off the reverse clutch tried to stop a moving car: a bang, a jerk and a big chunk of gearbox life gone.') }),
  pRefused: () => ({ title: T('P на ходу игнорируется', 'Park ignored at speed'), body: T('Электронный селектор: блок управления не опустит стояночную собачку, пока машина едет — включит P сам после остановки.', 'Electronic selector: the computer will not drop the parking pawl while the car moves — it engages P itself once stopped.') }),
  pawl: () => ({ title: T('Трещит стояночная собачка', 'Parking pawl ratcheting'), body: T('Механический селектор в P на ходу: собачка бьётся о зубья стояночной шестерни и отскакивает, не входя в зацепление. Каждый удар — износ. Если она войдёт на скорости — сломается.', 'Mechanical selector in P while rolling: the pawl hits the parking gear teeth and bounces off. Every hit wears it. If it drops in at speed, it breaks.') }),
  pawlBroken: () => ({ title: T('Собачка сломана', 'Parking pawl broken'), body: T('Положение P больше не удерживает машину — на уклоне она покатится. Всегда сначала полная остановка и ручной тормоз, потом P.', 'P no longer holds the car — on a slope it will roll away. Always stop completely and set the handbrake first, then P.') }),
  downshiftRefused: () => ({ title: T('Понижение отклонено', 'Downshift refused'), body: T('На пониженной передаче двигатель раскрутился бы выше красной зоны — и ограничитель оборотов тут не поможет: крутят колёса, а не топливо. Коробка отказала. Сначала сбросьте скорость.', 'In the lower gear the engine would spin past the red line — and the rev limiter cannot help, because the wheels drive it, not the fuel. The gearbox refused. Slow down first.') }),
  overrev: () => ({ title: T('Перекрут двигателя', 'Mechanical over-rev'), body: T('Принудительное понижение: колёса раскрутили коленвал выше предела. Клапаны не успевают закрываться за кулачками («зависают»), шатуны растягиваются. Двигатель повреждён — мощность упала.', 'A forced downshift: the wheels spun the crank beyond its limit. The valves cannot follow the cams (valve float) and the con-rods stretch. The engine is damaged — power is down.') }),
  engineSeized: () => ({ title: T('Двигатель разрушен', 'Engine destroyed'), body: T('Клапаны встретились с поршнями (или перегрев сорвал прокладку и заклинил поршни). Двигатель не заводится — только замена.', 'The valves met the pistons (or overheating blew the gasket and seized the pistons). The engine will not start — it needs replacing.') }),
  engineDamaged: () => ({ title: T('Двигатель повреждён', 'Engine damaged'), body: T('Компрессия упала, мощность ≈ 60 % от нормы. Машина едет, но это уже работа для моториста.', 'Compression is down, power ≈ 60 % of normal. It still drives, but it is a job for an engine shop.') }),
  coldRev: (v) => ({ title: T(`Двигатель холодный: масло ${Math.round(v.hw.oil)} °C`, `Engine cold: oil ${Math.round(v.hw.oil)} °C`), body: T('Холодное масло густое: на высоких оборотах оно не успевает дойти до вкладышей и кулачков, и детали трутся «насухо». Пока масло не прогрелось до ≈ 60 °C, держите обороты ниже половины тахометра и не давите газ в пол.', 'Cold oil is thick: at high revs it does not reach the bearings and cam lobes in time and parts rub almost dry. Until the oil is at ≈ 60 °C keep below half the rev counter and do not floor it.') }),
  overheat: (v) => ({ title: T(`Перегрев: ОЖ ${Math.round(v.hw.coolant)} °C`, `Overheating: coolant ${Math.round(v.hw.coolant)} °C`), body: T('Тепла от сгорания больше, чем радиатор успевает отдать: большая нагрузка на малой скорости (стоп-тест, буксование, ползание в гору). Термостат открыт полностью, вентилятор на максимуме. Выше 120 °C ведёт головку блока и пробивает прокладку. Сбросьте газ, дайте поработать на холостых.', 'More heat from combustion than the radiator can shed: heavy load at low speed (stall test, wheelspin, crawling uphill). The thermostat is wide open and the fan at full. Above 120 °C the head warps and the gasket blows. Lift off and let it idle.') }),
  headGasket: () => ({ title: T('Пробило прокладку ГБЦ', 'Head gasket failing'), body: T('Перегрев деформировал головку: газы идут в систему охлаждения, антифриз — в цилиндры. Двигатель теряет компрессию.', 'Overheating warped the head: combustion gas enters the coolant and coolant enters the cylinders. The engine loses compression.') }),
  turboCoked: () => ({ title: T('Турбина выключена горячей', 'Turbo shut down hot'), body: T('Корпус турбины был раскалён (> 480 °C), а вы заглушили мотор: масло в подшипнике остановилось и закоксовалось. После активной езды дайте поработать 30–60 с на холостых — турбина остынет потоком масла и воздуха.', 'The turbine housing was glowing (> 480 °C) when you switched off: the oil in its bearing stopped and coked. After hard driving idle for 30–60 s — oil and air cool the turbo down.') }),
  turboDead: () => ({ title: T('Турбина вышла из строя', 'Turbo failed'), body: T('Подшипник разрушен, наддува нет — мощность как у атмосферного мотора, и много сизого дыма.', 'The bearing is gone, no boost — power like a non-turbo engine and lots of blue smoke.') }),
  brakeFade: (v) => ({ title: T(`Тормоза перегреты: ${Math.round(Math.max(...v.hw.disc))} °C`, `Brakes overheating: ${Math.round(Math.max(...v.hw.disc))} °C`), body: T('Каждое торможение превращает кинетическую энергию в тепло дисков. Выше ≈ 550 °C смола колодок газует, и трение падает — педаль та же, а машина тормозит хуже («фейдинг»). На спусках тормозите двигателем: ручной режим и низкая передача.', 'Every stop turns kinetic energy into disc heat. Above ≈ 550 °C the pad resin outgasses and friction falls — same pedal, less braking (fade). On long descents use engine braking: manual mode and a low gear.') }),
  vacuumLost: () => ({ title: T('Нет усилителя тормозов', 'No brake assist'), body: T('Двигатель заглушен: вакуумный усилитель отдал запас за пару нажатий, педаль стала «деревянной». Тормоза работают, но давить надо в 3 раза сильнее. Рулевой усилитель тоже не работает.', 'The engine is off: the vacuum booster used its reserve in a couple of presses and the pedal went hard. The brakes still work but need 3× the force. Power steering is gone too.') }),
  windup: (v) => ({ title: T('Скручивание трансмиссии (4H на асфальте)', 'Driveline wind-up (4H on asphalt)'), body: T(`У Fortuner подключаемый полный привод без межосевого дифференциала: в 4H передний и задний валы вращаются строго одинаково. В повороте передние колёса проходят больший путь — на сухом асфальте шины не могут проскользнуть, и валы закручиваются (сейчас ${(v.hw.windup * 100).toFixed(0)} %). Руль тяжелеет, машина «подпрыгивает», раздатка ломается. 4H — только на грязи, снегу, гравии.`, `The Fortuner's part-time 4WD has no centre differential: in 4H the front and rear shafts turn exactly together. In a turn the front wheels travel further — on dry asphalt the tyres cannot slip, so the shafts twist (now ${(v.hw.windup * 100).toFixed(0)} %). Steering gets heavy, the car crow-hops, the transfer case breaks. 4H is for mud, snow and gravel only.`) }),
  xferBroken: () => ({ title: T('Раздатка сломана', 'Transfer case broken'), body: T('Цепь или шлицы раздаточной коробки не выдержали скручивания. Остался только задний привод (2H).', 'The transfer-case chain or splines gave way under wind-up. Only rear-wheel drive (2H) is left.') }),
  '4LRefused': () => ({ title: T('4L не включается', '4L will not engage'), body: T('Понижающий ряд раздатки — это шестерни без синхронизатора. Включать только при полной остановке и селекторе в N; иначе зубья не войдут в зацепление (лампа 4L мигает).', 'The low range is an unsynchronised gear set. Engage only fully stopped with the selector in N; otherwise the teeth will not mesh (the 4L lamp blinks).') }),
  xferGrind: () => ({ title: T('Скрежет в раздатке', 'Transfer case grinding'), body: T('2H ↔ 4H «на ходу» можно, но не быстрее 100 км/ч: синхронизатор не успевает выровнять скорости переднего вала.', '2H ↔ 4H on the fly is allowed, but not above 100 km/h: the synchroniser cannot match the front shaft speed in time.') }),
}

function HealthCard({ v }: { v: Snap }) {
  const t = useT()
  const bar = (val: number, lo: number, hi: number, warn: number, bad: number, label: Txt, unit = '°C') => {
    const col = val >= bad ? '#ff4a3d' : val >= warn ? '#ffb02e' : val < lo + (warn - lo) * 0.35 ? '#5cd8ff' : '#36e07a'
    return <div className="ds-hb"><small>{t(label)}</small><i><b style={{ width: `${Math.max(2, Math.min(100, ((val - lo) / (hi - lo)) * 100))}%`, background: col }} /></i><em style={{ color: col }}>{Math.round(val)}{unit}</em></div>
  }
  const health = (h: number, label: Txt) => <span className={`ds-hp ${h <= 0 ? 'dead' : h < 0.5 ? 'bad' : h < 0.95 ? 'warn' : ''}`}>{t(label)} {Math.round(h * 100)}%</span>
  return (
    <div className="ds-health">
      <span className="eyebrow">{t(T('Механика и температуры', 'Hardware & temperatures'))}</span>
      {bar(v.hw.coolant, 0, 130, 108, 118, T('ОЖ', 'Coolant'))}
      {bar(v.hw.oil, 0, 150, 125, 140, T('Масло ДВС', 'Engine oil'))}
      {bar(v.hw.atf, 0, 180, 115, 135, T('Масло АКПП', 'Gearbox fluid'))}
      {bar(v.hw.turbo, 0, 900, 480, 760, T('Турбина', 'Turbo'))}
      {bar(Math.max(...v.hw.disc), 0, 800, 450, 550, T('Тормоза', 'Brakes'))}
      {v.partTime && bar(v.hw.windup * 100, 0, 130, 30, 100, T('Скручивание', 'Wind-up'), '%')}
      <div className="ds-hps">{health(v.hw.eng, T('Двигатель', 'Engine'))}{health(v.hw.trans, T('АКПП', 'Gearbox'))}{v.partTime && health(v.hw.xfer, T('Раздатка', 'Transfer'))}{health(v.hw.turboH, T('Турбо', 'Turbo'))}{!v.byWire && health(v.hw.pawl, T('Собачка P', 'P pawl'))}</div>
      {v.hw.limp && <small className="ds-limp">LIMP · 3</small>}
    </div>
  )
}

/* ------------------------------------------------------------------ panel + shell */
function Panel() {
  const t = useT()
  const ui = useDrive()
  const [, force] = useState(0)
  const c = D.car, k = c.ctl
  const hv = useCarSnap()
  const set = (f: () => void) => { f(); force((n) => n + 1) }
  const [pad, setPad] = useState('')
  const sound = useApp((st) => st.sound)
  useEffect(() => { const id = setInterval(() => setPad(PAD.connected ? PAD.id : ''), 1000); return () => clearInterval(id) }, [])
  return (
    <aside className="ds-panel glass">
      <div className="fs-seg wrap">
        {(['fortuner', 'bmw'] as CarId[]).map((id) => <button key={id} className={`btn sm ${ui.car === id ? 'on' : ''}`} onClick={() => reset(id)}>{id === 'fortuner' ? 'Toyota Fortuner 2.8D' : 'BMW 530i'}</button>)}
      </div>
      <div className="fs-seg wrap">
        <button className={`btn sm ${k.ignition ? 'on' : ''}`} onClick={() => set(() => { k.ignition = !k.ignition })}>{t(T('Зажигание (I)', 'Ignition (I)'))}</button>
        {(['P', 'R', 'N', 'D'] as const).map((s) => <button key={s} className={`btn sm ${k.select === s ? 'on' : ''}`} onClick={() => set(() => { selectGear(c, s) })}>{s}</button>)}
        <button className={`btn sm ${k.manual ? 'on' : ''}`} onClick={() => set(() => { k.manual = !k.manual })}>{t(T('Ручной (M)', 'Manual (M)'))}</button>
      </div>
      {c.spec.awd && <div className="fs-seg wrap">
        <span className="eyebrow">{t(T('Привод', 'Drive'))}</span>
        {(['2H', '4H', '4L'] as DriveMode[]).map((m) => <button key={m} className={`btn sm ${k.mode === m ? 'on' : ''}`} onClick={() => set(() => { requestMode(c, m) })}>{m}</button>)}
      </div>}
      <div className="fs-seg wrap">
        <span className="eyebrow">{t(T('Системы', 'Assists'))}</span>
        <button className={`btn sm ${k.abs ? 'on' : ''}`} onClick={() => set(() => { k.abs = !k.abs })}>ABS</button>
        <button className={`btn sm ${k.tcs ? 'on' : ''}`} onClick={() => set(() => { k.tcs = !k.tcs })}>TCS</button>
        <button className={`btn sm ${k.esc ? 'on' : ''}`} onClick={() => set(() => { k.esc = !k.esc })}>ESC</button>
        <button className={`btn sm ${k.prot ? 'on' : ''}`} title={t(T('Защиты блоков управления двигателем и коробкой: задержка включения, запрет R на ходу, запрет перекрута, ограничение момента при перегреве', 'Engine and gearbox computer protections: delayed engagement, no reverse at speed, no over-rev downshift, torque limit when hot'))} onClick={() => set(() => { k.prot = !k.prot })}>{t(T('Защиты ЭБУ', 'ECU guards'))}</button>
        <button className="btn sm" onClick={() => set(() => warmUp(c))}>{t(T('Прогреть', 'Warm up'))}</button>
      </div>
      <HealthCard v={hv} />
      <div className="fs-seg wrap">
        <span className="eyebrow">{t(T('Камера (C)', 'Camera (C)'))}</span>
        {([['chase', T('Сзади', 'Chase')], ['driver', T('Водитель', 'Driver')], ['hood', T('Капот', 'Hood')], ['wheel', T('Колесо', 'Wheel')], ['orbit', T('Свободно', 'Free')]] as [Cam, Txt][]).map(([m, l]) => <button key={m} className={`btn sm ${ui.cam === m ? 'on' : ''}`} onClick={() => ui.set({ cam: m })}>{t(l)}</button>)}
      </div>
      <div className="fs-seg wrap">
        <button className="btn sm" onClick={() => reset(ui.car)}>{t(T('На старт', 'Reset'))}</button>
        <button className={`btn sm ${ui.paused ? 'on' : ''}`} onClick={() => ui.set({ paused: !ui.paused })}>{t(T('Пауза', 'Pause'))}</button>
        <button className={`btn sm ${sound ? 'on' : ''}`} onClick={() => { getApp().set({ sound: !sound }); if (sound) stopCarAudio() }}>{t(T('Звук', 'Sound'))}</button>
      </div>
      <p className="fs-pad">{pad ? t(T('🎮 Геймпад: RT газ · LT тормоз · левый стик руль · A ручник · RB/LB передачи · X зажигание · Back селектор · Y камера', '🎮 Gamepad: RT throttle · LT brake · left stick steer · A handbrake · RB/LB shift · X ignition · Back selector · Y camera')) : t(T('🎮 Подключите геймпад и нажмите любую кнопку', '🎮 Connect a gamepad and press any button'))}</p>
    </aside>
  )
}
export function DriveSim() {
  const t = useT()
  const { lang, setLang } = useLang()
  const quality = useApp((s) => s.quality)
  const ui = useDrive()
  const v = useCarSnap()
  const orbit = useRef<OrbitImpl | null>(null)
  useEffect(() => { reset(useDrive.getState().car); return () => stopCarAudio() }, [])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      D.keys.add(e.code)
      if (e.repeat) return
      const k = D.car.ctl
      if (e.code === 'KeyI') k.ignition = !k.ignition
      if (e.code === 'KeyP') selectGear(D.car, 'P')
      if (e.code === 'KeyR') selectGear(D.car, 'R')
      if (e.code === 'KeyN') selectGear(D.car, 'N')
      if (e.code === 'KeyF') selectGear(D.car, 'D')
      if (e.code === 'KeyM') k.manual = !k.manual
      if (e.code === 'KeyE' || e.code === 'ShiftLeft') { k.manual = true; k.shiftReq = 1 }
      if (e.code === 'KeyQ' || e.code === 'ControlLeft') { k.manual = true; k.shiftReq = -1 }
      if (e.code === 'KeyC') cycleCam()
      if (e.code === 'Digit1') requestMode(D.car, '2H')
      if (e.code === 'Digit2') requestMode(D.car, '4H')
      if (e.code === 'Digit3') requestMode(D.car, '4L')
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
    }
    const up = (e: KeyboardEvent) => D.keys.delete(e.code)
    const blur = () => D.keys.clear()
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    if (import.meta.env.DEV) Object.assign(window, { __drive: { D, reset, ui: useDrive, step: (s: number) => { let n = Math.round(s / H); while (n-- > 0) stepCar(D.car, H) }, updateCarAudio } })
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  const n = narrate(v)
  return (
    <div className="fs ds">
      <Canvas className="fs-canvas" shadows dpr={quality === 'high' ? [1, 1.6] : [1, 1.2]} camera={{ fov: 55, near: 0.05, far: 6000, position: [-170, 3, 0] }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.85; gl.shadowMap.type = THREE.PCFSoftShadowMap; gl.localClippingEnabled = true }}>
        <Loop />
        <SkyLight />
        <Ground />
        <CarBody key={ui.car + ui.epoch} id={ui.car} />
        <Cameras orbit={orbit} />
        <OrbitControls ref={orbit as never} enableDamping minDistance={2} maxDistance={60} enabled={false} />
        {quality === 'high' && <EffectComposer multisampling={0}><SMAA /><Bloom mipmapBlur intensity={0.4} luminanceThreshold={1.1} /><Vignette offset={0.3} darkness={0.4} /></EffectComposer>}
      </Canvas>
      <header className="fs-top">
        <button className="btn sm" onClick={() => useApp.getState().set({ screen: 'landing' })}>← {t(T('Назад', 'Back'))}</button>
        <div className="fs-title"><span className="eyebrow">{t(T('Автосимулятор · полигон', 'Driving simulator · proving ground'))}</span><h1>{ui.car === 'fortuner' ? 'Toyota Fortuner 2.8D' : 'BMW 530i'}</h1></div>
        <div className="seg xp-lang"><button className={lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>RU</button><button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button></div>
      </header>
      <section className="fs-narr glass" aria-live="polite"><span className="eyebrow">{t(T('Что происходит', 'What is happening'))}</span><h2>{t(n.title)}</h2><p>{t(n.body)}</p>
        <div className="ds-times"><span>0–100: <b>{v.t100 ? `${v.t100.toFixed(1)} s` : '—'}</b></span><span>400 m: <b>{v.d400 ? `${v.d400.toFixed(1)} s` : '—'}</b></span></div>
      </section>
      <Instruments v={v} />
      <Panel />
      {v.rolled && <div className="fs-crash glass"><b>{t(T('Машина опрокинулась', 'The car rolled over'))}</b><button className="btn primary" onClick={() => reset(ui.car)}>{t(T('Заново', 'Try again'))}</button></div>}
      <p className="fs-note">{t(T('Модель представительная, цифры приблизительные. W/↑ газ · S/↓ тормоз · A/D руль · Пробел ручник · I зажигание · P/R/N, F = D · E/Q передачи (ручной) · 1/2/3 привод · C камера', 'Representative model, approximate figures. W/↑ throttle · S/↓ brake · A/D steer · Space handbrake · I ignition · P/R/N, F = D · E/Q shift (manual) · 1/2/3 drive mode · C camera'))}</p>
    </div>
  )
}
