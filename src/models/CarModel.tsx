import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Part, VehicleCtx, useVehicle } from './Part'
import { RuntimeCtx, newRuntime, approach, useRuntime, liveRuntime, type Runtime } from './runtime'
import type { CarLayout } from './carLayout'
import type { VehicleDef, Vec3 } from '../data/types'
import { getApp } from '../store'
import { between, capsule, carBody, cyl, gear, memo, rbox, sphere, spring, taper, torus, tube, tyre } from '../utils/geom'

const VIS = 0.075 // slow-motion factor for rotating internals (real rpm would just blur)

/* ------------------------------------------------------------------ body shape */
function roundedPolyline(s: THREE.Shape | THREE.Path, pts: [number, number][], r = 0.18, start = true) {
  pts.forEach((p, i) => {
    if (i === 0) { if (start) s.moveTo(p[0], p[1]); else s.lineTo(p[0], p[1]); return }
    if (i === pts.length - 1) { s.lineTo(p[0], p[1]); return }
    const a = pts[i - 1], b = pts[i + 1]
    const d1 = Math.hypot(p[0] - a[0], p[1] - a[1]), d2 = Math.hypot(b[0] - p[0], b[1] - p[1])
    const k = Math.min(r, d1 * 0.42, d2 * 0.42)
    const p1: [number, number] = [p[0] + ((a[0] - p[0]) / d1) * k, p[1] + ((a[1] - p[1]) / d1) * k]
    const p2: [number, number] = [p[0] + ((b[0] - p[0]) / d2) * k, p[1] + ((b[1] - p[1]) / d2) * k]
    s.lineTo(p1[0], p1[1]); s.quadraticCurveTo(p[0], p[1], p2[0], p2[1])
  })
}

function bodyShape(L: CarLayout) {
  const s = new THREE.Shape()
  roundedPolyline(s, L.profile, 0.22)
  const hw = L.wheelbase / 2, ar = L.archR, cy = L.wheelR
  const dy = L.sill - cy
  const dx = Math.sqrt(Math.max(0.01, ar * ar - dy * dy))
  const a0 = Math.atan2(dy, -dx), a1 = Math.atan2(dy, dx)
  s.lineTo(-hw - dx, L.sill)
  s.absarc(-hw, cy, ar, a0, a1, true)
  s.lineTo(hw - dx, L.sill)
  s.absarc(hw, cy, ar, a0, a1, true)
  s.lineTo(L.profile[0][0], L.profile[0][1])
  return s
}

function Body({ L, id }: { L: CarLayout; id: string }) {
  const tapering = { front: L.front, rear: L.rear, belt: L.belt, roof: L.roof }
  const geo = useMemo(() => carBody(id, bodyShape(L), L.width, tapering), [id]) // eslint-disable-line
  const edges = useMemo(() => memo(`edges${id}`, () => new THREE.EdgesGeometry(geo, 28)), [geo, id])
  const glass = useMemo(() => memo(`glass${id}`, () => {
    const sh = new THREE.Shape(); roundedPolyline(sh, [...L.window, L.window[0]], 0.08)
    const depth = L.width - 0.1
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 12 })
    g.translate(0, 0, -depth / 2)
    taper(g, L.width, { ...tapering, grow: 0.052 })
    g.computeVertexNormals()
    return g
  }), [id]) // eslint-disable-line
  const quad = (key: string, [b, t]: [Vec3, Vec3], wb: number, wt: number) => memo(`quad${id}${key}`, () => {
    const g = new THREE.BufferGeometry()
    const v = [b[0], b[1], wb, b[0], b[1], -wb, t[0], t[1], wt, t[0], t[1], -wt]
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
    g.setIndex([0, 1, 2, 1, 3, 2]); g.computeVertexNormals(); return g
  })
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#8fd6ff', transparent: true, opacity: 0 }), [])
  useFrame((_, dt) => {
    const s = getApp()
    const on = s.xray || s.cutaway || s.flowIsolate || !!s.selected || !!s.focusSystem || !!s.learn
    lineMat.opacity = approach(lineMat.opacity, on ? (s.flowIsolate ? 0.12 : 0.32) : 0.035, 5, dt)
    const want = s.cutaway
    if ((lineMat.clippingPlanes?.length ?? 0) !== (want ? 1 : 0)) { lineMat.clippingPlanes = want ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)] : null; lineMat.needsUpdate = true }
  })
  const W = L.width / 2
  return (
    <group>
      <Part kind="paint" color={L.paint} shell clip layer="body" system="body" comp="body">
        <mesh geometry={geo} castShadow />
      </Part>
      <lineSegments geometry={edges} material={lineMat} />
      <Part kind="glass" shell clip layer="body" system="body">
        <mesh geometry={glass} />
        <mesh geometry={quad('ws', L.windshield, W * 0.86, W * 0.74)} position={[0, 0.02, 0]} />
        {L.rearGlass && <mesh geometry={quad('rg', L.rearGlass, W * 0.74, W * 0.8)} position={[0, 0.02, 0]} />}
      </Part>
      <Lights L={L} />
      <Hood L={L} />
      <Door L={L} />
      <Tailgate L={L} />
    </group>
  )
}

function Lights({ L }: { L: CarLayout }) {
  const on = (m: THREE.MeshPhysicalMaterial) => {
    const run = getApp().sim.engine === 'running'
    m.emissiveIntensity = approach(m.emissiveIntensity, run ? 2.6 : 0.25, 4, 1 / 60)
  }
  const [hx, hy, hz] = L.lights.head, [tx, ty, tz] = L.lights.tail
  return (
    <>
      <Part kind="light" color="#eaf4ff" emissive="#dff0ff" layer="body" system="electrical" comp="lights" onMat={on}>
        {[1, -1].map((s) => <mesh key={s} geometry={rbox(0.12, 0.09, 0.32, 0.03)} position={[hx, hy, hz * s]} />)}
      </Part>
      <Part kind="light" color="#5a0d12" emissive="#ff2a3a" layer="body" system="electrical" comp="lights" onMat={on}>
        {[1, -1].map((s) => <mesh key={s} geometry={rbox(0.06, 0.12, 0.3, 0.02)} position={[tx, ty, tz * s]} />)}
      </Part>
    </>
  )
}

function Hood({ L }: { L: CarLayout }) {
  const rt = useRuntime()
  const pivot = useRef<THREE.Group>(null!)
  const { x0, x1, y0, y1 } = L.hood
  const len = Math.hypot(x0 - x1, y0 - y1), ang = Math.atan2(y0 - y1, x0 - x1)
  useFrame(() => { pivot.current.rotation.z = rt.hood * 0.95 })
  return (
    <group position={[x1, y1 + 0.012, 0]} ref={pivot}>
      <group rotation={[0, 0, ang]}>
        <Part kind="paint" color={L.paint} layer="body" system="body" comp="hood" opacity={1} onMat={(m) => { m.opacity = Math.min(m.opacity, rt.hood > 0.02 ? 1 : 0) }}>
          <mesh geometry={rbox(len, 0.025, L.width * 0.82, 0.012)} position={[len / 2, 0, 0]} />
        </Part>
      </group>
    </group>
  )
}

function Door({ L }: { L: CarLayout }) {
  const rt = useRuntime()
  const pivot = useRef<THREE.Group>(null!)
  const { x0, x1, y0, y1 } = L.door
  const len = x1 - x0, h = y1 - y0
  useFrame(() => { pivot.current.rotation.y = rt.door * 1.1 })
  return (
    <group position={[x1, 0, L.width / 2 - 0.02]} ref={pivot}>
      <Part kind="paint" color={L.paint} layer="body" system="body" comp="door" onMat={(m) => { m.opacity = Math.min(m.opacity, rt.door > 0.02 ? 1 : 0) }}>
        <mesh geometry={rbox(len, h, 0.05, 0.02)} position={[-len / 2, y0 + h / 2, 0.02]} />
        <mesh geometry={rbox(len * 0.9, h * 0.32, 0.03, 0.01)} position={[-len / 2, y1 + h * 0.12, -0.05]} />
      </Part>
    </group>
  )
}

function Tailgate({ L }: { L: CarLayout }) {
  const rt = useRuntime()
  const pivot = useRef<THREE.Group>(null!)
  const [hx, hy] = L.tailgate.hinge, [tx, ty] = L.tailgate.to
  const len = Math.hypot(tx - hx, ty - hy), ang = Math.atan2(ty - hy, tx - hx)
  useFrame(() => { pivot.current.rotation.z = -rt.trunk * 1.05 })
  return (
    <group position={[hx - 0.012, hy, 0]} ref={pivot}>
      <group rotation={[0, 0, ang]}>
        <Part kind="paint" color={L.paint} layer="body" system="trunk" comp="trunk" onMat={(m) => { m.opacity = Math.min(m.opacity, rt.trunk > 0.02 ? 1 : 0) }}>
          <mesh geometry={rbox(len, 0.03, L.width * 0.8, 0.012)} position={[len / 2, 0, 0]} />
        </Part>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ wheels */
function Wheel({ L, x, z, front }: { L: CarLayout; x: number; z: number; front: boolean }) {
  const rt = useRuntime()
  const steerG = useRef<THREE.Group>(null!)
  const spinG = useRef<THREE.Group>(null!)
  const hub = useRef<THREE.Group>(null!)
  const R = L.wheelR, W = L.tireW
  const side = Math.sign(z)
  useFrame(() => {
    steerG.current.rotation.y = front ? rt.steer * 0.42 : 0
    spinG.current.rotation.z = -rt.wheel
    hub.current.position.y = R + Math.sin(rt.bounce + x * 2.1 + z) * 0.025 * Math.min(1, rt.speed / 6)
  })
  const heat = (m: THREE.MeshPhysicalMaterial) => {
    m.emissive.setRGB(1, 0.32 + 0.3 * (1 - rt.brakeHeat), 0.08)
    m.emissiveIntensity = rt.brakeHeat * 3.2
  }
  return (
    <group position={[x, 0, z]}>
      <group ref={hub} position={[0, R, 0]}>
        <group ref={steerG}>
          <group ref={spinG}>
            <Part kind="rubber" layer="suspension" system="suspension" comp={['wheels', front ? 'frontSusp' : 'rearSusp']} side={side as 1 | -1}>
              <mesh geometry={tyre(R, W)} castShadow />
            </Part>
            <Part kind="metal" layer="suspension" system="suspension" comp="wheels" side={side as 1 | -1}>
              <mesh geometry={cyl(R * 0.64, R * 0.64, W * 0.5, 32)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, side * W * 0.18]} />
              {Array.from({ length: 5 }, (_, i) => (
                <mesh key={i} geometry={rbox(R * 0.58, R * 0.1, 0.03, 0.01)} rotation={[0, 0, (i / 5) * Math.PI * 2]} position={[Math.cos((i / 5) * Math.PI * 2) * R * 0.3, Math.sin((i / 5) * Math.PI * 2) * R * 0.3, side * W * 0.44]} />
              ))}
            </Part>
            <Part kind="steel" layer="brakes" system="brakes" comp={['brakeDisc', 'brakes']} side={side as 1 | -1} onMat={heat}>
              <mesh geometry={cyl(R * 0.52, R * 0.52, 0.03, 40)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -side * 0.02]} />
            </Part>
          </group>
          <Part kind="accent" color={L.caliper} layer="brakes" system="brakes" comp={['caliper', 'brakes']} side={side as 1 | -1}>
            <mesh geometry={rbox(0.16, 0.1, 0.075, 0.02)} position={[R * 0.36, R * 0.3, -side * 0.02]} rotation={[0, 0, -0.7]} />
          </Part>
        </group>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ engine */
function Engine({ L }: { L: CarLayout }) {
  const rt = useRuntime()
  const E = L.engine
  const n = E.cyl, pitch = (E.len * 0.86) / n
  const r = 0.046, rodL = 0.15
  const deck = E.crankY + rodL + r + 0.045
  const bore = E.bore
  const xs = Array.from({ length: n }, (_, i) => E.x + E.len * 0.43 - pitch * (i + 0.5))
  const phase = [0, Math.PI, Math.PI, 0, 0, Math.PI]
  const fire = [0, 3, 1, 2] // cylinder index -> firing slot (1-3-4-2)
  const pistons = useRef<THREE.Group[]>([])
  const rods = useRef<THREE.Mesh[]>([])
  const flames = useRef<THREE.Mesh[]>([])
  const crank = useRef<THREE.Group>(null!)
  const cams = useRef<THREE.Group>(null!)
  const valves = useRef<THREE.Mesh[]>([])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const a = rt.crank
    crank.current.rotation.x = a
    cams.current.rotation.x = a / 2
    xs.forEach((_, i) => {
      const ang = a + phase[i]
      const py = E.crankY + r * Math.cos(ang) + Math.sqrt(rodL * rodL - (r * Math.sin(ang)) ** 2)
      pistons.current[i]?.position.set(0, py, 0)
      const pinZ = r * Math.sin(ang), pinY = E.crankY + r * Math.cos(ang)
      const rod = rods.current[i]
      if (rod) {
        tmp.set(0, py - pinY, -pinZ).normalize()
        rod.quaternion.setFromUnitVectors(up, tmp)
        rod.position.set(0, (py + pinY) / 2, pinZ / 2)
      }
      const cyc = ((a % (Math.PI * 4)) + Math.PI * 4) % (Math.PI * 4)
      const slot = (cyc - fire[i] * Math.PI + Math.PI * 4) % (Math.PI * 4)
      const f = flames.current[i]
      if (f) { const on = rt.rpm > 300 && slot < 0.9; f.visible = on; f.scale.setScalar(on ? 1 - slot / 1.1 : 0.01) }
      const vi = valves.current[i * 2], ve = valves.current[i * 2 + 1]
      if (vi) vi.position.y = deck + 0.035 - (slot > Math.PI * 3 ? Math.sin(slot - Math.PI * 3) * 0.012 : 0)
      if (ve) ve.position.y = deck + 0.035 - (slot > Math.PI * 2 && slot < Math.PI * 3 ? Math.sin(slot - Math.PI * 2) * 0.012 : 0)
    })
  })
  const blockH = deck - (E.crankY - 0.08)
  return (
    <group>
      {/* block + head: see-through castings so the moving internals stay visible */}
      <Part kind="casing" clip layer="engine" system="engine" comp={['engine', 'cylinders']}>
        <mesh geometry={rbox(E.len, blockH, 0.44, 0.03)} position={[E.x, E.crankY - 0.08 + blockH / 2, 0]} />
      </Part>
      <Part kind="casing" color="#b8c7d4" clip layer="engine" system="engine" comp={['cylinderHead', 'engine']} opacity={0.3}>
        <mesh geometry={rbox(E.len * 0.98, 0.12, 0.42, 0.03)} position={[E.x, deck + 0.06, 0]} />
      </Part>
      <Part kind="dark" layer="engine" system="engine" comp={['cylinderHead', 'engine']}>
        <mesh geometry={rbox(E.len * 0.9, 0.045, 0.26, 0.02)} position={[E.x, deck + 0.142, 0.03]} />
      </Part>
      <Part kind="casing" clip layer="engine" system="engine" comp={['cylinders', 'engine']} opacity={0.28}>
        {xs.map((x, i) => <mesh key={i} geometry={cyl(bore / 2 + 0.006, bore / 2 + 0.006, deck - E.crankY - 0.06, 28)} position={[x, (deck + E.crankY + 0.06) / 2, 0]} />)}
      </Part>
      <Part kind="metal" layer="engine" system="engine" comp={['pistons', 'engine']}>
        {xs.map((x, i) => (
          <group key={i} position={[x, 0, 0]}>
            <group ref={(o) => { if (o) pistons.current[i] = o }}>
              <mesh geometry={cyl(bore / 2 - 0.003, bore / 2 - 0.003, 0.06, 28)} />
              <mesh geometry={torus(bore / 2 - 0.002, 0.003, 28)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} />
            </group>
          </group>
        ))}
      </Part>
      <Part kind="steel" layer="engine" system="engine" comp={['connectingRods', 'engine']}>
        {xs.map((x, i) => (
          <group key={i} position={[x, 0, 0]}>
            <mesh ref={(o) => { if (o) rods.current[i] = o }} geometry={rbox(0.02, rodL, 0.032, 0.008)} />
          </group>
        ))}
      </Part>
      <Part kind="metal" color="#c9d2da" layer="engine" system="engine" comp={['crankshaft', 'engine']}>
        <group ref={crank} position={[0, E.crankY, 0]}>
          <mesh geometry={cyl(0.026, 0.026, E.len * 1.02, 20)} rotation={[0, 0, Math.PI / 2]} position={[E.x, 0, 0]} />
          {xs.map((x, i) => (
            <group key={i} position={[x, 0, 0]} rotation={[phase[i], 0, 0]}>
              <mesh geometry={rbox(0.022, 0.1, 0.08, 0.01)} position={[-0.02, r / 2, 0]} />
              <mesh geometry={rbox(0.022, 0.1, 0.08, 0.01)} position={[0.02, r / 2, 0]} />
              <mesh geometry={cyl(0.02, 0.02, 0.05, 16)} rotation={[0, 0, Math.PI / 2]} position={[0, r, 0]} />
              <mesh geometry={rbox(0.03, 0.06, 0.12, 0.02)} position={[0, -0.04, 0]} />
            </group>
          ))}
        </group>
      </Part>
      <Part kind="metal" color="#d7dee5" layer="engine" system="engine" comp={['camshaft', 'cylinderHead']}>
        <group ref={cams} position={[0, deck + 0.085, 0]}>
          <mesh geometry={cyl(0.012, 0.012, E.len * 0.95, 12)} rotation={[0, 0, Math.PI / 2]} position={[E.x, 0, 0.05]} />
          <mesh geometry={cyl(0.012, 0.012, E.len * 0.95, 12)} rotation={[0, 0, Math.PI / 2]} position={[E.x, 0, -0.05]} />
        </group>
        {xs.map((x, i) => (
          <group key={i}>
            <mesh ref={(o) => { if (o) valves.current[i * 2] = o }} geometry={cyl(0.016, 0.004, 0.05, 12)} position={[x, deck + 0.035, 0.035]} />
            <mesh ref={(o) => { if (o) valves.current[i * 2 + 1] = o }} geometry={cyl(0.014, 0.004, 0.05, 12)} position={[x, deck + 0.035, -0.035]} />
          </group>
        ))}
      </Part>
      {/* combustion flashes */}
      <group>
        {xs.map((x, i) => (
          <mesh key={i} ref={(o) => { if (o) flames.current[i] = o }} position={[x, deck - 0.012, 0]} geometry={sphere(bore / 2.3, 16)} visible={false}>
            <meshBasicMaterial color={L.petrol ? '#ffb347' : '#ff7a2e'} transparent opacity={0.85} toneMapped={false} />
          </mesh>
        ))}
      </group>
      {/* injectors: diesel straight down the middle; petrol direct injection from the side + spark plugs */}
      <Part kind="metal" color="#e8eef3" layer="engine" system="fuel" comp={['injectors', 'fuelSystem']}>
        {xs.map((x, i) => L.petrol
          ? <mesh key={i} geometry={cyl(0.008, 0.006, 0.11, 10)} position={[x, deck + 0.02, 0.13]} rotation={[0.55, 0, 0]} />
          : <mesh key={i} geometry={cyl(0.009, 0.006, 0.13, 10)} position={[x, deck + 0.1, 0]} />)}
      </Part>
      {L.petrol && (
        <Part kind="accent" color="#b28cff" layer="engine" system="electrical" comp={['sparkPlugs', 'ignition']}>
          {xs.map((x, i) => <mesh key={i} geometry={rbox(0.034, 0.12, 0.034, 0.008)} position={[x, deck + 0.17, -0.0]} />)}
        </Part>
      )}
      {/* common rail */}
      <Part kind="metal" color="#dfe6ec" layer="engine" system="fuel" comp={['commonRail', 'fuelRail']}>
        <mesh geometry={cyl(0.017, 0.017, E.len * 0.86, 16)} rotation={[0, 0, Math.PI / 2]} position={[E.x, L.petrol ? deck + 0.05 : deck + 0.17, L.petrol ? 0.15 : 0.1]} />
      </Part>
      {/* intake & exhaust manifolds */}
      <Part kind="dark" layer="engine" system="engine" comp={['intakeManifold', 'intercooler']}>
        <mesh geometry={rbox(E.len * 0.9, 0.08, 0.1, 0.03)} position={[E.x, deck + 0.04, 0.27]} />
      </Part>
      <Part kind="steel" color="#8a6b5c" layer="exhaust" system="exhaust" comp={['exhaustManifold', 'exhaust']}>
        <mesh geometry={rbox(E.len * 0.86, 0.06, 0.07, 0.025)} position={[E.x, deck + 0.0, -0.27]} />
      </Part>
      {/* oil pan, flywheel, front pulleys */}
      <Part kind="steel" layer="engine" system="engine" comp={['oilPan', 'oilPump']}>
        <mesh geometry={rbox(E.len * 0.85, 0.11, 0.36, 0.03)} position={[E.x, E.crankY - 0.14, 0]} />
      </Part>
      <Part kind="steel" layer="engine" system="engine" comp={['flywheel', 'engine']}>
        <mesh geometry={cyl(0.17, 0.17, 0.03, 32)} rotation={[0, 0, Math.PI / 2]} position={[E.x - E.len / 2 - 0.02, E.crankY, 0]} />
      </Part>
      <Part kind="dark" layer="engine" system="engine" comp="engine">
        <mesh geometry={torus(0.07, 0.008, 24)} rotation={[0, Math.PI / 2, 0]} position={[E.x + E.len / 2 + 0.04, E.crankY + 0.06, 0]} />
      </Part>
      <Turbo L={L} />
    </group>
  )
}

function Turbo({ L }: { L: CarLayout }) {
  const rt = useRuntime()
  const w1 = useRef<THREE.Group>(null!), w2 = useRef<THREE.Group>(null!)
  useFrame(() => { w1.current.rotation.z = rt.turbo; w2.current.rotation.z = rt.turbo })
  const blades = (r: number) => Array.from({ length: 9 }, (_, i) => (
    <mesh key={i} geometry={rbox(r, 0.006, 0.04, 0.002)} position={[Math.cos((i / 9) * Math.PI * 2) * r * 0.5, Math.sin((i / 9) * Math.PI * 2) * r * 0.5, 0]} rotation={[0.35, 0, (i / 9) * Math.PI * 2]} />
  ))
  const [x, y, z] = L.turbo
  return (
    <group position={[x, y, z]} rotation={[0, Math.PI / 2, 0]}>
      <Part kind="casing" color="#ff9b6b" clip layer="engine" system="engine" comp="turbo" opacity={0.3}>
        <mesh geometry={torus(0.065, 0.035, 28)} position={[0, 0, -0.06]} />
      </Part>
      <Part kind="casing" color="#8fd6ff" clip layer="engine" system="engine" comp="turbo" opacity={0.3}>
        <mesh geometry={torus(0.07, 0.035, 28)} position={[0, 0, 0.07]} />
      </Part>
      <Part kind="metal" color="#e9a77f" layer="engine" system="engine" comp="turbo">
        <group ref={w1} position={[0, 0, -0.06]}>{blades(0.075)}<mesh geometry={cyl(0.015, 0.03, 0.05, 16)} rotation={[Math.PI / 2, 0, 0]} /></group>
      </Part>
      <Part kind="metal" color="#cfe8ff" layer="engine" system="engine" comp="turbo">
        <group ref={w2} position={[0, 0, 0.07]}>{blades(0.08)}<mesh geometry={cyl(0.015, 0.03, 0.05, 16)} rotation={[-Math.PI / 2, 0, 0]} /></group>
        <mesh geometry={cyl(0.008, 0.008, 0.14, 8)} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={cyl(0.035, 0.035, 0.05, 20)} rotation={[Math.PI / 2, 0, 0]} />
      </Part>
    </group>
  )
}

/* ------------------------------------------------------------------ ancillaries */
function Ancillaries({ L }: { L: CarLayout }) {
  const rt = useRuntime()
  const fan = useRef<THREE.Group>(null!)
  const alt = useRef<THREE.Group>(null!)
  useFrame(() => { fan.current.rotation.x = rt.fan; alt.current.rotation.x = rt.crank * 2.4 })
  const R = L.radiator
  return (
    <group>
      <Part kind="accent" color="#3ddc97" layer="cooling" system="cooling" comp="radiator" opacity={0.75}>
        <mesh geometry={rbox(0.05, R.h, R.w, 0.01)} position={[R.x, R.y, 0]} />
      </Part>
      <Part kind="dark" layer="cooling" system="cooling" comp={['radiator', 'radiatorFan']}>
        <mesh geometry={rbox(0.03, R.h + 0.04, R.w + 0.04, 0.01)} position={[R.x - 0.035, R.y, 0]} />
      </Part>
      <Part kind="steel" layer="cooling" system="cooling" comp="radiatorFan">
        <group ref={fan} position={[R.x - 0.09, R.y, 0]}>
          {Array.from({ length: 7 }, (_, i) => <mesh key={i} geometry={rbox(0.008, R.h * 0.42, 0.06, 0.004)} rotation={[(i / 7) * Math.PI * 2, 0, 0]} position={[0, Math.cos((i / 7) * Math.PI * 2) * R.h * 0.2, Math.sin((i / 7) * Math.PI * 2) * R.h * 0.2]} />)}
          <mesh geometry={cyl(0.05, 0.05, 0.05, 16)} rotation={[0, 0, Math.PI / 2]} />
        </group>
      </Part>
      <Part kind="accent" color="#a6f0ff" layer="cooling" system="climate" comp="condenser" opacity={0.55}>
        <mesh geometry={rbox(0.025, R.h * 0.92, R.w, 0.008)} position={[L.condenser, R.y, 0]} />
      </Part>
      <Part kind="accent" color={L.intercooler.label === 'water' ? '#3ddc97' : '#6cc6ff'} layer="engine" system="engine" comp="intercooler" opacity={0.7}>
        <mesh geometry={rbox(...L.intercooler.size, 0.012)} position={L.intercooler.pos} />
      </Part>
      <Part kind="dark" layer="engine" system="engine" comp="airFilter">
        <mesh geometry={rbox(0.32, 0.16, 0.26, 0.04)} position={L.airbox} />
      </Part>
      <Part kind="steel" layer="cooling" system="cooling" comp={['waterPump', 'thermostat']}>
        <mesh geometry={cyl(0.045, 0.045, 0.06, 20)} rotation={[0, 0, Math.PI / 2]} position={L.waterPump} />
        <mesh geometry={sphere(0.03)} position={[L.engine.x + L.engine.len / 2 - 0.02, L.engine.crankY + 0.34, 0.12]} />
      </Part>
      <Part kind="accent" color="#a98bff" layer="electrical" system="electrical" comp="alternator">
        <group ref={alt} position={L.alternator}>
          <mesh geometry={cyl(0.065, 0.065, 0.13, 20)} rotation={[0, 0, Math.PI / 2]} />
          <mesh geometry={rbox(0.14, 0.02, 0.02, 0.005)} position={[0, 0.05, 0]} />
        </group>
      </Part>
      <Part kind="accent" color="#a98bff" layer="electrical" system="electrical" comp="starter">
        <mesh geometry={cyl(0.045, 0.045, 0.18, 18)} rotation={[0, 0, Math.PI / 2]} position={L.starter} />
      </Part>
      <Part kind="dark" layer="electrical" system="electrical" comp="battery">
        <mesh geometry={rbox(0.28, 0.2, 0.18, 0.015)} position={L.battery} />
      </Part>
      <Part kind="accent" color="#a98bff" layer="electrical" system="electrical" comp="battery">
        <mesh geometry={cyl(0.015, 0.015, 0.03, 10)} position={[L.battery[0] + 0.08, L.battery[1] + 0.11, L.battery[2]]} />
        <mesh geometry={cyl(0.015, 0.015, 0.03, 10)} position={[L.battery[0] - 0.08, L.battery[1] + 0.11, L.battery[2]]} />
      </Part>
      <Part kind="accent" color="#7a8fa6" layer="electrical" system="electrical" comp="ecu">
        <mesh geometry={rbox(0.18, 0.05, 0.14, 0.01)} position={L.ecu} />
      </Part>
      <Part kind="metal" color="#ffb27a" layer="engine" system="fuel" comp="hpPump">
        <mesh geometry={cyl(0.045, 0.045, 0.1, 18)} position={L.hpPump} />
      </Part>
      <Part kind="accent" color="#ff8a3d" layer="fuel" system="fuel" comp="fuelFilter">
        <mesh geometry={cyl(0.04, 0.04, 0.14, 18)} position={L.fuelFilter} />
      </Part>
      <Part kind="steel" layer="brakes" system="brakes" comp={['absUnit', 'abs']}>
        <mesh geometry={rbox(0.14, 0.12, 0.12, 0.015)} position={L.absUnit} />
      </Part>
      <Part kind="accent" color="#ff4d5e" layer="brakes" system="brakes" comp="absUnit" opacity={0.9}>
        <mesh geometry={rbox(0.05, 0.03, 0.1, 0.008)} position={[L.absUnit[0], L.absUnit[1] + 0.07, L.absUnit[2]]} />
      </Part>
      <Part kind="steel" layer="brakes" system="brakes" comp={['masterCylinder', 'brakePedal']}>
        <mesh geometry={cyl(0.11, 0.11, 0.09, 28)} rotation={[0, 0, Math.PI / 2]} position={L.booster} />
        <mesh geometry={cyl(0.025, 0.025, 0.16, 12)} rotation={[0, 0, Math.PI / 2]} position={[L.booster[0] + 0.12, L.booster[1], L.booster[2]]} />
      </Part>
      <Part kind="accent" color="#ff4d5e" layer="brakes" system="brakes" comp="masterCylinder">
        <mesh geometry={rbox(0.06, 0.05, 0.06, 0.01)} position={[L.booster[0] + 0.14, L.booster[1] + 0.05, L.booster[2]]} />
      </Part>
      <Part kind="steel" layer="cooling" system="climate" comp="acCompressor">
        <mesh geometry={cyl(0.055, 0.055, 0.15, 18)} rotation={[0, 0, Math.PI / 2]} position={L.acCompressor} />
      </Part>
      <Part kind="dark" layer="interior" system="climate" comp="hvac">
        <mesh geometry={rbox(0.28, 0.22, 0.6, 0.03)} position={L.hvac} />
      </Part>
    </group>
  )
}

/* ------------------------------------------------------------------ fuel & exhaust */
function FuelAndExhaust({ L, id }: { L: CarLayout; id: string }) {
  const T = L.tank
  const [sx, sy, sz] = T.size
  const ex = L.exhaust
  const catAt = (x0: number, x1: number, key: string, comp: string[], color?: string) => {
    const p = ex.reduce((best, q) => (Math.abs(q[0] - (x0 + x1) / 2) < Math.abs(best[0] - (x0 + x1) / 2) ? q : best), ex[0])
    return (
      <Part kind="metal" color={color} layer="exhaust" system="exhaust" comp={comp} key={key}>
        <mesh geometry={capsule(0.085, Math.abs(x0 - x1))} rotation={[0, 0, Math.PI / 2]} position={[(x0 + x1) / 2, p[1], p[2]]} />
      </Part>
    )
  }
  const M = L.muffler
  return (
    <group>
      <Part kind="tank" layer="fuel" system="fuel" comp={['fuelTank', 'feedPump']}>
        {T.saddle ? (
          <>
            <mesh geometry={rbox(sx, sy, sz * 0.4, 0.06)} position={[T.pos[0], T.pos[1], T.pos[2] + sz * 0.3]} />
            <mesh geometry={rbox(sx, sy, sz * 0.4, 0.06)} position={[T.pos[0], T.pos[1], T.pos[2] - sz * 0.3]} />
            <mesh geometry={rbox(sx * 0.9, sy * 0.4, sz * 0.3, 0.04)} position={[T.pos[0], T.pos[1] + sy * 0.3, T.pos[2]]} />
          </>
        ) : <mesh geometry={rbox(sx, sy, sz, 0.07)} position={T.pos} />}
      </Part>
      <Part kind="accent" color="#ff8a3d" layer="fuel" system="fuel" comp="feedPump">
        <mesh geometry={cyl(0.035, 0.035, sy * 0.8, 14)} position={[T.pos[0] + sx * 0.25, T.pos[1], T.pos[2] + (T.saddle ? sz * 0.3 : 0)]} />
      </Part>
      <Part kind="steel" color="#77685f" layer="exhaust" system="exhaust" comp={['exhaust', 'exhaustPipe']}>
        <mesh geometry={tube(`ex${id}`, ex, 0.032, 120)} />
      </Part>
      {catAt(L.cat.x0, L.cat.x1, 'cat', ['catalyst', 'aftertreatment'])}
      {L.dpf && catAt(L.dpf.x0, L.dpf.x1, 'dpf', ['dpf', 'aftertreatment'], '#c9b9ad')}
      <Part kind="metal" layer="exhaust" system="exhaust" comp="muffler">
        <mesh geometry={capsule(M.r, M.len)} rotation={M.transverse ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2]} position={M.pos} />
      </Part>
      <Part kind="metal" color="#dfe6ec" layer="exhaust" system="exhaust" comp="muffler">
        <mesh geometry={cyl(0.045, 0.045, 0.14, 16)} rotation={[0, 0, Math.PI / 2]} position={L.tailpipe} />
      </Part>
    </group>
  )
}

/* ------------------------------------------------------------------ driveline */
function Shaft({ a, b, r, comp, layer = 'transmission', rate = 1 }: { a: Vec3; b: Vec3; r: number; comp: string[]; layer?: string; rate?: number }) {
  const rt = useRuntime()
  const spin = useRef<THREE.Group>(null!)
  const { position, quaternion, length } = useMemo(() => between(a, b), [a, b])
  useFrame(() => { spin.current.rotation.y = rt.wheel * 3.4 * rate })
  return (
    <group position={position} quaternion={quaternion}>
      <Part kind="metal" layer={layer} system="transmission" comp={comp}>
        <group ref={spin}>
          <mesh geometry={cyl(r, r, length, 16)} />
          <mesh geometry={rbox(r * 3.2, 0.012, 0.012, 0.004)} position={[0, length * 0.2, 0]} />
          <mesh geometry={rbox(r * 3.2, 0.012, 0.012, 0.004)} position={[0, -length * 0.2, 0]} />
        </group>
      </Part>
    </group>
  )
}

function Driveline({ L, awd }: { L: CarLayout; awd: boolean }) {
  const rt = useRuntime()
  const G = L.gearbox
  const len = G.x0 - G.x1
  const planets = useRef<THREE.Group>(null!)
  const ring = useRef<THREE.Group>(null!)
  const tc = useRef<THREE.Group>(null!)
  useFrame(() => {
    tc.current.rotation.x = rt.crank
    planets.current.rotation.x = rt.crank * 0.6
    ring.current.rotation.x = rt.wheel * 3.4
  })
  const hw = L.wheelbase / 2, tz = L.track / 2
  const out: Vec3 = [G.x1 - 0.02, G.y - 0.02, 0]
  return (
    <group>
      <Part kind="casing" color="#9fb6c8" clip layer="transmission" system="transmission" comp={['transmission', 'torqueConverter']} opacity={0.24}>
        <mesh geometry={cyl(G.r * 0.62, G.r, len, 32, )} rotation={[0, 0, Math.PI / 2]} position={[(G.x0 + G.x1) / 2, G.y, 0]} />
      </Part>
      <Part kind="metal" color="#c9d6e2" layer="transmission" system="transmission" comp="torqueConverter">
        <group ref={tc} position={[G.x0 - 0.07, G.y, 0]}>
          <mesh geometry={torus(G.r * 0.62, G.r * 0.22, 32)} rotation={[0, Math.PI / 2, 0]} />
          {Array.from({ length: 12 }, (_, i) => <mesh key={i} geometry={rbox(0.01, G.r * 0.4, 0.05, 0.003)} rotation={[(i / 12) * Math.PI * 2, 0, 0]} position={[0, Math.cos((i / 12) * Math.PI * 2) * G.r * 0.6, Math.sin((i / 12) * Math.PI * 2) * G.r * 0.6]} />)}
        </group>
      </Part>
      <Part kind="accent" color="#9db7ff" layer="transmission" system="transmission" comp={['transmission', 'gears']}>
        <group ref={planets} position={[(G.x0 + G.x1) / 2 - 0.05, G.y, 0]}>
          {[0, 1, 2].map((k) => (
            <group key={k} position={[k * 0.14 - 0.14, 0, 0]}>
              <mesh geometry={gear(18, G.r * 0.32, 0.04)} rotation={[0, Math.PI / 2, 0]} />
              {[0, 1, 2].map((p) => <mesh key={p} geometry={gear(12, G.r * 0.2, 0.035)} rotation={[0, Math.PI / 2, 0]} position={[0, Math.cos((p * Math.PI * 2) / 3) * G.r * 0.5, Math.sin((p * Math.PI * 2) / 3) * G.r * 0.5]} />)}
            </group>
          ))}
        </group>
      </Part>
      {awd && L.transfer ? (
        <>
          <Part kind="casing" clip layer="transmission" system="transmission" comp="transferCase" color="#b6c6ff" opacity={0.35}>
            <mesh geometry={rbox(0.26, 0.2, 0.28, 0.05)} position={L.transfer} />
          </Part>
          <Shaft a={[L.transfer[0] - 0.12, L.transfer[1] - 0.04, 0]} b={[-hw + 0.12, L.rearDiff[1], 0]} r={0.032} comp={['driveshaft', 'rearDriveshaft']} />
          <Shaft a={[L.transfer[0] + 0.1, L.transfer[1] - 0.06, L.transfer[2] + 0.1]} b={[hw - 0.12, L.frontDiff![1], L.frontDiff![2]]} r={0.028} comp={['frontDriveshaft', 'driveshaft']} />
        </>
      ) : (
        <Shaft a={out} b={[-hw + 0.12, L.rearDiff[1], 0]} r={0.034} comp={['driveshaft']} />
      )}
      {/* rear differential + half shafts */}
      <Part kind="casing" clip layer="transmission" system="transmission" comp={['rearDiff', 'differential']} color="#b6c6ff" opacity={0.35}>
        <mesh geometry={sphere(0.15)} position={L.rearDiff} />
      </Part>
      <Part kind="accent" color="#9db7ff" layer="transmission" system="transmission" comp={['rearDiff', 'differential']}>
        <group ref={ring} position={L.rearDiff}><mesh geometry={gear(30, 0.1, 0.025)} rotation={[0, 0, 0]} position={[0, 0, 0.04]} /></group>
      </Part>
      <Shaft a={[L.rearDiff[0], L.wheelR, 0.12]} b={[L.rearDiff[0], L.wheelR, tz - 0.1]} r={0.025} comp={['axles', 'rearDiff']} rate={1} />
      <Shaft a={[L.rearDiff[0], L.wheelR, -0.12]} b={[L.rearDiff[0], L.wheelR, -tz + 0.1]} r={0.025} comp={['axles', 'rearDiff']} rate={1} />
      {awd && L.frontDiff && (
        <>
          <Part kind="casing" clip layer="transmission" system="transmission" comp={['frontDiff', 'differential']} color="#b6c6ff" opacity={0.35}>
            <mesh geometry={sphere(0.12)} position={L.frontDiff} />
          </Part>
          <Shaft a={[hw, L.wheelR, 0.14]} b={[hw, L.wheelR, tz - 0.1]} r={0.022} comp={['axles', 'frontDiff']} />
          <Shaft a={[hw, L.wheelR, 0.0]} b={[hw, L.wheelR, -tz + 0.1]} r={0.022} comp={['axles', 'frontDiff']} />
        </>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ chassis */
function Chassis({ L }: { L: CarLayout }) {
  const hw = L.wheelbase / 2, tz = L.track / 2, R = L.wheelR
  const arm = (a: Vec3, b: Vec3, key: string, comp: string, w = 0.03) => {
    const { position, quaternion, length } = between(a, b)
    return <mesh key={key} geometry={rbox(w, length, w * 1.6, 0.008)} position={position} quaternion={quaternion} />
  }
  return (
    <group>
      {L.frame ? (
        <Part kind="steel" color="#3b434b" layer="suspension" system="suspension" comp="frame">
          {[1, -1].map((s) => <mesh key={s} geometry={rbox(L.front - L.rear - 0.4, 0.14, 0.08, 0.02)} position={[(L.front + L.rear) / 2 + 0.05, L.sill - 0.02, s * 0.44]} />)}
          {[-1.9, -0.9, 0.2, 1.1, 1.9].map((x) => <mesh key={x} geometry={rbox(0.08, 0.08, 0.86, 0.02)} position={[x, L.sill - 0.02, 0]} />)}
        </Part>
      ) : (
        <Part kind="steel" color="#3b434b" layer="suspension" system="suspension" comp="subframes">
          <mesh geometry={rbox(0.6, 0.06, 1.0, 0.02)} position={[hw - 0.05, R + 0.02, 0]} />
          <mesh geometry={rbox(0.55, 0.06, 1.0, 0.02)} position={[-hw + 0.02, R + 0.02, 0]} />
        </Part>
      )}
      {/* floor */}
      <Part kind="dark" color="#20262c" layer="interior" system="cabin" comp="floor" opacity={0.9}>
        <mesh geometry={rbox(L.dash - L.rear - 0.35, 0.03, L.width - 0.22, 0.01)} position={[(L.dash + L.rear + 0.35) / 2, L.floorY, 0]} />
      </Part>
      {/* front: double wishbones + coil-over */}
      {[1, -1].map((s) => (
        <group key={s}>
          <Part kind="steel" color="#6f7a85" layer="suspension" system="suspension" comp="frontSusp" side={s as 1 | -1}>
            {arm([hw - 0.12, R - 0.1, s * 0.38], [hw, R - 0.08, s * (tz - 0.16)], 'l', 'frontSusp')}
            {arm([hw + 0.12, R - 0.1, s * 0.38], [hw, R - 0.08, s * (tz - 0.16)], 'l2', 'frontSusp')}
            {arm([hw - 0.08, R + 0.16, s * 0.42], [hw, R + 0.14, s * (tz - 0.2)], 'u', 'frontSusp', 0.024)}
            {arm([hw + 0.08, R + 0.16, s * 0.42], [hw, R + 0.14, s * (tz - 0.2)], 'u2', 'frontSusp', 0.024)}
          </Part>
          <Part kind="accent" color="#6cc6ff" layer="suspension" system="suspension" comp={['frontSusp', 'springs']} side={s as 1 | -1}>
            <mesh geometry={spring(0.06, 0.3, 6, 0.009)} position={[hw - 0.04, R + 0.22, s * (tz - 0.3)]} />
          </Part>
          <Part kind="metal" layer="suspension" system="suspension" comp={['frontSusp', 'shockAbsorbers']} side={s as 1 | -1}>
            <mesh geometry={cyl(0.024, 0.024, 0.4, 12)} position={[hw - 0.04, R + 0.22, s * (tz - 0.3)]} />
          </Part>
        </group>
      ))}
      {/* rear */}
      {L.rearAxle === 'live' ? (
        <>
          <Part kind="steel" color="#6f7a85" layer="suspension" system="suspension" comp={['rearSusp', 'rearAxle']}>
            <mesh geometry={cyl(0.045, 0.045, L.track - 0.2, 16)} rotation={[Math.PI / 2, 0, 0]} position={[-hw, R, 0]} />
            {[1, -1].map((s) => <group key={s}>{arm([-hw + 0.65, R - 0.05, s * 0.44], [-hw, R - 0.06, s * 0.48], `t${s}`, 'rearSusp')}{arm([-hw + 0.5, R + 0.16, s * 0.3], [-hw, R + 0.08, s * 0.16], `t2${s}`, 'rearSusp', 0.024)}</group>)}
          </Part>
          {[1, -1].map((s) => (
            <Part key={s} kind="accent" color="#6cc6ff" layer="suspension" system="suspension" comp={['rearSusp', 'springs']} side={s as 1 | -1}>
              <mesh geometry={spring(0.07, 0.26, 5, 0.01)} position={[-hw + 0.02, R + 0.2, s * 0.48]} />
            </Part>
          ))}
        </>
      ) : (
        [1, -1].map((s) => (
          <group key={s}>
            <Part kind="steel" color="#6f7a85" layer="suspension" system="suspension" comp="rearSusp" side={s as 1 | -1}>
              {arm([-hw + 0.2, R - 0.06, s * 0.36], [-hw, R - 0.08, s * (tz - 0.16)], 'a', 'rearSusp')}
              {arm([-hw - 0.2, R - 0.04, s * 0.36], [-hw - 0.02, R - 0.08, s * (tz - 0.16)], 'b', 'rearSusp')}
              {arm([-hw + 0.15, R + 0.14, s * 0.4], [-hw, R + 0.12, s * (tz - 0.2)], 'c', 'rearSusp', 0.022)}
              {arm([-hw - 0.15, R + 0.14, s * 0.4], [-hw, R + 0.12, s * (tz - 0.2)], 'd', 'rearSusp', 0.022)}
              {arm([-hw - 0.32, R + 0.0, s * 0.42], [-hw - 0.05, R - 0.02, s * (tz - 0.18)], 'e', 'rearSusp', 0.02)}
            </Part>
            <Part kind="accent" color="#6cc6ff" layer="suspension" system="suspension" comp={['rearSusp', 'springs']} side={s as 1 | -1}>
              <mesh geometry={spring(0.065, 0.24, 5, 0.009)} position={[-hw + 0.1, R + 0.18, s * (tz - 0.32)]} />
            </Part>
          </group>
        ))
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ steering + cabin */
function Cabin({ L, third }: { L: CarLayout; third: boolean }) {
  const rt = useRuntime()
  const wheel = useRef<THREE.Group>(null!)
  const bag = useRef<THREE.Mesh>(null!)
  const brakePedal = useRef<THREE.Group>(null!)
  const gasPedal = useRef<THREE.Group>(null!)
  useFrame(() => {
    wheel.current.rotation.x = rt.steer * 1.6
    const a = rt.airbag
    bag.current.scale.setScalar(0.001 + a * 1)
    bag.current.visible = a > 0.01
    const s = getApp().sim
    brakePedal.current.rotation.z = -s.brake * 0.35
    gasPedal.current.rotation.z = -s.throttle * 0.3
  })
  const [wx, wy, wz] = L.steeringWheel
  const seat = (x: number, z: number, key: string, w = 0.5, fold = false) => (
    <group key={key} position={[x, L.seatY, z]}>
      <mesh geometry={rbox(0.5, 0.12, w, 0.05)} />
      {!fold && <mesh geometry={rbox(0.12, 0.6, w * 0.95, 0.05)} position={[-0.25, 0.32, 0]} rotation={[0, 0, 0.2]} />}
      {!fold && <mesh geometry={rbox(0.1, 0.16, w * 0.5, 0.04)} position={[-0.32, 0.72, 0]} rotation={[0, 0, 0.15]} />}
    </group>
  )
  const col = between([wx + 0.05, wy - 0.04, wz], L.rack)
  return (
    <group>
      <Part kind="interior" color="#2e3238" layer="interior" system="cabin" comp="seats">
        {seat(L.seatsFront, 0.42, 'fl')}
        {seat(L.seatsFront, -0.42, 'fr')}
        {seat(L.seatsRear, 0, 'r', 1.35)}
        {third && L.seatsThird !== undefined && seat(L.seatsThird, 0, 't', 1.2)}
      </Part>
      <Part kind="interior" color="#1d2126" layer="interior" system="cabin" comp="dashboard">
        <mesh geometry={rbox(0.4, 0.2, L.width - 0.3, 0.07)} position={[L.dash, L.seatY + 0.38, 0]} />
        <mesh geometry={rbox(0.5, 0.18, 0.22, 0.04)} position={[L.dash - 0.4, L.seatY + 0.12, 0]} />
        <mesh geometry={rbox(0.05, 0.03, 0.04, 0.01)} position={[L.dash - 0.42, L.seatY + 0.26, 0]} />
      </Part>
      <Part kind="screen" layer="interior" system="cabin" comp="infotainment" emissive="#3b82d6" emissiveIntensity={0.9}>
        <mesh geometry={rbox(0.02, 0.17, 0.3, 0.008)} position={[L.dash - 0.2, L.seatY + 0.55, 0]} rotation={[0, 0, 0.25]} />
      </Part>
      <Part kind="screen" layer="interior" system="cabin" comp="cluster" emissive="#7cc8ff" emissiveIntensity={0.7}>
        <mesh geometry={rbox(0.02, 0.12, 0.3, 0.008)} position={[L.dash - 0.18, L.seatY + 0.5, 0.42]} rotation={[0, 0, 0.2]} />
      </Part>
      <Part kind="dark" layer="interior" system="steering" comp={['steeringWheel', 'airbag']}>
        <group position={[wx, wy, wz]} rotation={[0, 0, 0.45]}>
          <group ref={wheel}>
            <mesh geometry={torus(0.18, 0.016, 40)} rotation={[0, Math.PI / 2, 0]} />
            <mesh geometry={rbox(0.03, 0.3, 0.03, 0.01)} />
            <mesh geometry={rbox(0.03, 0.03, 0.34, 0.01)} />
          </group>
          <mesh geometry={cyl(0.07, 0.07, 0.06, 20)} rotation={[0, 0, Math.PI / 2]} />
          <mesh ref={bag} geometry={sphere(0.28, 24)} position={[-0.22, 0, 0]} scale={[0.6, 1, 1]}>
            <meshPhysicalMaterial color="#f3f4f0" roughness={0.6} transparent opacity={0.92} />
          </mesh>
        </group>
      </Part>
      <Part kind="steel" layer="interior" system="steering" comp={['steeringColumn', 'steeringRack']}>
        <mesh geometry={cyl(0.018, 0.018, col.length, 10)} position={col.position} quaternion={col.quaternion} />
      </Part>
      <Part kind="accent" color="#c8d3dd" layer="suspension" system="steering" comp="steeringRack">
        <mesh geometry={cyl(0.03, 0.03, L.track * 0.62, 16)} rotation={[Math.PI / 2, 0, 0]} position={L.rack} />
        {[1, -1].map((s) => {
          const tr = between([L.rack[0], L.rack[1], s * L.track * 0.3], [L.wheelbase / 2 - 0.12, L.wheelR, s * (L.track / 2 - 0.16)])
          return <mesh key={s} geometry={cyl(0.012, 0.012, tr.length, 8)} position={tr.position} quaternion={tr.quaternion} />
        })}
      </Part>
      <Part kind="metal" layer="interior" system="cabin" comp={['pedals', 'brakePedal']}>
        <group position={L.pedals}>
          <group ref={brakePedal}><mesh geometry={rbox(0.03, 0.2, 0.08, 0.01)} position={[0, -0.1, 0.06]} /></group>
          <group ref={gasPedal}><mesh geometry={rbox(0.03, 0.22, 0.05, 0.01)} position={[0, -0.11, -0.1]} /></group>
        </group>
      </Part>
      <Part kind="accent" color="#c9cfd6" layer="interior" system="cabin" comp="seatBelts" opacity={0.85}>
        {[0.42, -0.42].map((z) => {
          const b = between([L.seatsFront - 0.28, L.seatY + 0.68, z + Math.sign(z) * 0.2], [L.seatsFront - 0.02, L.seatY + 0.08, z - Math.sign(z) * 0.2])
          return <mesh key={z} geometry={rbox(0.01, b.length, 0.05, 0.003)} position={b.position} quaternion={b.quaternion} />
        })}
      </Part>
      {L.spare && (
        <Part kind="rubber" layer="interior" system="trunk" comp="spareWheel">
          <mesh geometry={tyre(L.wheelR * 0.95, L.tireW * 0.9)} rotation={[Math.PI / 2, 0, 0]} position={L.spare} />
        </Part>
      )}
      <Part kind="interior" color="#262a30" layer="interior" system="trunk" comp="trunk" opacity={0.9}>
        <mesh geometry={rbox(0.7, 0.025, L.width - 0.3, 0.01)} position={[L.rear + 0.45, L.floorY + (L.trunkBattery ? 0.12 : 0.18), 0]} />
      </Part>
    </group>
  )
}

/* ------------------------------------------------------------------ root */
export function CarModel({ def, showcase = false }: { def: VehicleDef; showcase?: boolean }) {
  const L = def.layout as CarLayout
  const rt = useMemo<Runtime>(() => newRuntime(), [])
  if (!showcase) liveRuntime.current = rt
  const diesel = !L.petrol
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const sim = getApp().sim
    if (showcase) { rt.rpm = 800; rt.crank += dt * 2.2; rt.turbo += dt * 6; rt.fan += dt * 3; return }
    const idle = diesel ? 750 : 700, red = diesel ? 4200 : 6500
    const target = sim.engine === 'off' ? 0 : sim.engine === 'starting' ? 220 : idle + sim.throttle * (red - idle) * 0.8
    rt.rpm = approach(rt.rpm, target, sim.engine === 'starting' ? 3 : 2.2, dt)
    rt.crank += (rt.rpm / 60) * Math.PI * 2 * VIS * dt
    rt.turbo += (rt.rpm / 1000) ** 2 * dt * 9
    rt.fan += (sim.engine === 'running' ? 6 : rt.rpm / 120) * dt
    const vTarget = sim.driving ? 4 + sim.throttle * 26 : 0
    if (sim.brake > 0.1) rt.speed = Math.max(0, rt.speed - dt * 9 * sim.brake)
    else rt.speed = approach(rt.speed, vTarget, 0.6, dt)
    rt.wheel += (rt.speed / L.wheelR) * dt * 0.35
    rt.bounce += rt.speed * dt * 0.9
    rt.brakeHeat = Math.max(0, Math.min(1, rt.brakeHeat + (sim.brake * (0.25 + rt.speed / 20) * dt * 1.4) - dt * 0.12))
    rt.steer = approach(rt.steer, sim.steer, 2.5, dt)
    rt.airbag = approach(rt.airbag, sim.airbag ? 1 : 0, sim.airbag ? 22 : 3, dt)
    const zone = def.walk.find((w) => w.id === getApp().walkZone)
    rt.hood = approach(rt.hood, sim.hood || zone?.open?.includes('hood') ? 1 : 0, 2.6, dt)
    rt.door = approach(rt.door, sim.door || zone?.open?.includes('door') ? 1 : 0, 2.6, dt)
    rt.trunk = approach(rt.trunk, sim.trunk || zone?.open?.includes('trunk') ? 1 : 0, 2.6, dt)
  })
  const hw = L.wheelbase / 2, tz = L.track / 2
  return (
    <VehicleCtx.Provider value={{ def, showcase }}>
      <RuntimeCtx.Provider value={rt}>
        <group>
          <Body L={L} id={def.id} />
          <Engine L={L} />
          <Ancillaries L={L} />
          <FuelAndExhaust L={L} id={def.id} />
          <Driveline L={L} awd={!!def.awd} />
          <Chassis L={L} />
          <Cabin L={L} third={def.id === 'fortuner'} />
          {[[hw, tz, true], [hw, -tz, true], [-hw, tz, false], [-hw, -tz, false]].map(([x, z, f]) => (
            <Wheel key={`${x}${z}`} L={L} x={x as number} z={z as number} front={f as boolean} />
          ))}
        </group>
      </RuntimeCtx.Provider>
    </VehicleCtx.Provider>
  )
}

export function useCarLayout() {
  const { def } = useVehicle()
  return def?.layout as CarLayout
}
