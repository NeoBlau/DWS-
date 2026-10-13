import { useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { AX, AILERON, FIN, FLAPS, HSTAB, SLATS, SPOILERS, WING, fusR, fusY, span, wingAt } from '../../models/aircraftLayout'
import { cyl, fuselage, glowSprite, loft, memo, tyre, between, type Section } from '../../utils/geom'
import { revolve, bladeRing } from '../diesel/geometry'
import { applyFinish, type Finish } from '../surface'
import { AC, DEG, STATIC_STROKE, confAt, G } from './fdm'
import { FS, useFlight } from './state'
import { Cockpit, PANES, surfacePatch } from './Cockpit'
import type { Vec3 } from '../../data/types'

/*
 * Procedural A320 in the drawing frame of aircraftLayout (x to the nose, y up, ground at y = 0, +z = right wing).
 * Every moving part reads the flight model each frame — nothing here is keyframed.
 */

/* ------------------------------------------------------------------ materials */
function mat(o: THREE.MeshPhysicalMaterialParameters & { finish?: Finish }) {
  const { finish, ...p } = o
  const m = new THREE.MeshPhysicalMaterial(p)
  applyFinish(m, finish ?? 'none')
  return m
}
function useMats() {
  return useMemo(() => ({
    paint: mat({ color: '#f1f0ec', vertexColors: true, roughness: 0.42, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.12, envMapIntensity: 0.7, finish: 'paint' }),
    white: mat({ color: '#eeeeea', roughness: 0.42, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.12, envMapIntensity: 0.7, finish: 'paint' }),
    wing: mat({ color: '#d9dcdf', roughness: 0.5, metalness: 0.05, clearcoat: 0.3, clearcoatRoughness: 0.25, envMapIntensity: 0.6, finish: 'paint' }),
    wingDark: mat({ color: '#c3c9cf', roughness: 0.45, metalness: 0.1, clearcoat: 0.3, finish: 'paint' }),
    leMetal: mat({ color: '#c4cad0', roughness: 0.25, metalness: 0.9, finish: 'machined' }),
    tail: mat({ color: '#163a70', roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, finish: 'paint' }),
    glass: mat({ color: '#0b1218', roughness: 0.03, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.86, envMapIntensity: 1.4 }),
    tyre: mat({ color: '#141518', roughness: 0.88, metalness: 0, finish: 'rubber' }),
    chrome: mat({ color: '#e9edf1', roughness: 0.1, metalness: 1, finish: 'machined' }),
    gearPaint: mat({ color: '#d7dbe0', roughness: 0.38, metalness: 0.2, clearcoat: 0.4, finish: 'paint' }),
    hub: mat({ color: '#9aa2ab', roughness: 0.3, metalness: 0.9, finish: 'machined' }),
    fan: mat({ color: '#a7b0ba', roughness: 0.26, metalness: 1, finish: 'machined' }),
    spinner: mat({ color: '#d9dee3', roughness: 0.2, metalness: 0.85, finish: 'machined' }),
    dark: mat({ color: '#15181c', roughness: 0.65, metalness: 0.2 }),
    core: mat({ color: '#8e959c', roughness: 0.4, metalness: 0.85, finish: 'machined' }),
    plug: mat({ color: '#8a7b6c', roughness: 0.5, metalness: 0.8, finish: 'cast' }),
  }), [])
}
type Mats = ReturnType<typeof useMats>

/* ------------------------------------------------------------------ hinged surface */
function Hinged({ id, sections, c0, c1, hingeC, material, drive, vertical }: {
  id: string; sections: Section[]; c0: number; c1: number; hingeC: number; material: THREE.Material
  /** returns [angle rad (+ = trailing edge down / right), translate x, translate y] */
  drive: () => [number, number, number]; vertical?: boolean
}) {
  const geo = loft(`a3${id}`, sections, { c0, c1, vertical })
  const a = sections[0], b = sections[sections.length - 1]
  const A = useMemo(() => new THREE.Vector3(a.le - hingeC * a.chord, a.y, a.z), [a, hingeC])
  const B = useMemo(() => new THREE.Vector3(b.le - hingeC * b.chord, b.y, b.z), [b, hingeC])
  const axis = useMemo(() => B.clone().sub(A).normalize(), [A, B])
  const g = useRef<THREE.Group>(null!)
  useFrame(() => {
    const [ang, tx, ty] = drive()
    // + angle about the root→tip axis moves the trailing edge down (horizontal) / to the right (vertical)
    g.current.quaternion.setFromAxisAngle(axis, ang)
    g.current.position.set(A.x + tx, A.y + ty, A.z)
  })
  return (
    <group ref={g} position={A}>
      <mesh geometry={geo} material={material} position={[-A.x, -A.y, -A.z]} castShadow receiveShadow />
    </group>
  )
}

/* ------------------------------------------------------------------ fuselage with a simple generic livery */
function Fuselage({ m }: { m: Mats }) {
  const geo = useMemo(() => {
    const xs: number[] = []
    for (let i = 0; i <= 220; i++) { const u = i / 220; xs.push(AX.tail + (AX.nose - AX.tail) * (1 - Math.cos(u * Math.PI)) / 2) }
    const g = fuselage('a320-fs', xs, fusR, fusY, 72).clone()
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3)
    const white = new THREE.Color('#f6f7f9'), belly = new THREE.Color('#bfc5cc'), stripe = new THREE.Color('#1b4a8a'), stripe2 = new THREE.Color('#5aa0e6')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      const r = Math.max(0.001, fusR(x)), cy = (y - fusY(x)) / r // +1 top … −1 bottom
      let c = white
      if (cy < -0.55) c = belly
      else if (cy > -0.36 && cy < -0.26 && x < 15.5 && x > -15) c = stripe
      else if (cy > -0.25 && cy < -0.22 && x < 14.5 && x > -14) c = stripe2
      void z
      col.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [])
  // windshield / cockpit side windows: patches lying on the fuselage surface (outside view), plus wipers
  const panes = useMemo(() => PANES.map(([a, b, c, d]) => surfacePatch(a, b, Math.min(c, d), Math.max(c, d), 0.012)), [])
  // cabin window row
  const windows = useMemo(() => {
    const geo = new THREE.CapsuleGeometry(0.1, 0.13, 4, 10)
    const im = new THREE.InstancedMesh(geo, m.glass, 120)
    const o = new THREE.Object3D()
    let n = 0
    for (const s of [1, -1]) for (let x = 12.6; x > -11.5; x -= 0.535) {
      if (Math.abs(x - 11.9) < 0.6 || Math.abs(x - 0.4) < 0.5 || Math.abs(x + 0.4) < 0.3) continue // doors & overwing exits
      const a = s * 1.32, r = fusR(x) + 0.004
      o.position.set(x, fusY(x) + Math.cos(a) * r, Math.sin(a) * r)
      o.rotation.set(a - Math.PI / 2, 0, 0) // local z along the surface normal
      o.scale.set(1, 1, 0.12)
      o.updateMatrix(); im.setMatrixAt(n++, o.matrix)
    }
    im.count = n
    return im
  }, [m])
  return (
    <group>
      <mesh geometry={geo} material={m.paint} castShadow receiveShadow />
      {panes.map((g, i) => <mesh key={i} geometry={g} material={m.glass} renderOrder={4} />)}
      {[1, -1].map((sd) => <mesh key={sd} position={[17.62, 3.86, sd * 0.42]} rotation={[sd * 0.5, 0, 1.05]} material={m.dark}><boxGeometry args={[0.025, 0.62, 0.02]} /></mesh>)}
      <primitive object={windows} />
    </group>
  )
}

/* ------------------------------------------------------------------ wing (built for +z, mirrored for −z) */
const flapDeg = () => confAt(FS.sim.srf.conf).flap
const slatDeg = () => confAt(FS.sim.srf.conf).slat
function Wing({ side, m }: { side: 1 | -1; m: Mats }) {
  const k = side === 1 ? 'R' : 'L'
  const spl = () => (side === 1 ? FS.sim.srf.splR : FS.sim.srf.splL)
  return (
    <group scale={[1, 1, side]}>
      <mesh geometry={loft('a3wbox', WING, { c0: 0.1, c1: 0.76 })} material={m.wing} castShadow receiveShadow />
      {[[1.6, 2.6], [5.0, 6.4], [16.6, 16.9]].map(([a, b], i) => <mesh key={i} geometry={loft(`a3wle${i}`, span(a, b, 2), { c0: 0, c1: 0.11 })} material={m.leMetal} castShadow />)}
      {[[16.2, 16.9], [6.2, 6.4], [12.3, 12.5]].map(([a, b], i) => <mesh key={i} geometry={loft(`a3wte${i}`, span(a, b, 2), { c0: 0.75, c1: 1 })} material={m.wing} castShadow />)}
      {/* sharklet */}
      <mesh geometry={loft('a3shark', [
        { le: -4.42, y: 3.42, z: 16.88, chord: 1.42, t: 0.1 }, { le: -4.95, y: 4.2, z: 17.22, chord: 0.95, t: 0.1 }, { le: -5.55, y: 5.45, z: 17.36, chord: 0.55, t: 0.1 },
      ], { vertical: true })} material={m.white} castShadow />
      {/* slats: move forward and droop */}
      {SLATS.map(([a, b], i) => (
        <Hinged key={`s${i}`} id={`slat${i}`} sections={span(a, b, 2)} c0={0} c1={0.11} hingeC={0.11} material={m.leMetal}
          drive={() => { const s = slatDeg() / 27; return [-s * 22 * DEG, s * 0.42, -s * 0.13] }} />
      ))}
      {/* Fowler flaps: slide aft, then rotate down */}
      {FLAPS.map(([a, b], i) => (
        <Hinged key={`f${i}`} id={`flap${i}`} sections={span(a, b, 2)} c0={0.76} c1={1} hingeC={0.76} material={m.wingDark}
          drive={() => { const f = flapDeg(); return [f * DEG * 0.85, -Math.min(1, f / 20) * 0.8, -Math.min(1, f / 20) * 0.16] }} />
      ))}
      <Hinged id="ail" sections={span(AILERON[0], AILERON[1], 2)} c0={0.76} c1={1} hingeC={0.76} material={m.wingDark}
        drive={() => [(side === 1 ? -1 : 1) * FS.sim.srf.ail, 0, 0]} />
      {SPOILERS.map(([a, b], i) => (
        <Hinged key={`sp${i}`} id={`spl${i}`} sections={span(a, b, 2).map((s) => ({ ...s, t: s.t * 0.35, y: s.y + s.t * s.chord * 0.45 }))} c0={0.6} c1={0.75} hingeC={0.6} material={m.wingDark}
          drive={() => { const g = FS.sim.srf.gndSpl; const v = i === 0 ? g : spl(); return [-v * 48 * DEG, 0, 0] }} />
      ))}
      <Engine m={m} />
      <MainGear m={m} side={side} />
      <WingLights side={side} k={k} />
    </group>
  )
}

/* ------------------------------------------------------------------ engine: nacelle, fan, reverser doors */
function Engine({ m }: { m: Mats }) {
  const fan = useRef<THREE.Group>(null!)
  const doors = useRef<THREE.Group[]>([])
  const nacelle = revolve('a3nac', [[2.24, 0.84], [2.31, 0.9], [2.24, 0.98], [1.9, 1.04], [1.0, 1.08], [0.0, 1.07], [-0.8, 1.0], [-1.35, 0.87], [-1.35, 0.8], [-0.4, 0.83], [1.4, 0.83], [2.0, 0.82], [2.24, 0.84]], 72)
  const lip = revolve('a3lip', [[2.18, 0.83], [2.31, 0.88], [2.27, 0.97], [2.14, 0.99], [2.14, 0.95], [2.2, 0.88], [2.12, 0.84], [2.18, 0.83]], 72)
  const core = revolve('a3core', [[-0.4, 0.001], [-0.4, 0.6], [-1.35, 0.6], [-2.3, 0.46], [-2.55, 0.41], [-2.55, 0.35], [-2.4, 0.001]], 56)
  const plug = revolve('a3plug', [[-2.4, 0.001], [-2.4, 0.33], [-2.75, 0.24], [-3.25, 0.02]], 40)
  const spinner = revolve('a3spin', [[1.25, 0.001], [1.25, 0.25], [1.5, 0.22], [1.72, 0.12], [1.86, 0.001]], 40)
  const blades = bladeRing('a3fan', 36, 0.22, 0.815, 0.34, 0.014, 0.62)
  const doorGeo = useMemo(() => {
    const pts = [[-0.2, 1.075], [-1.05, 0.93], [-1.05, 0.895], [-0.2, 1.04], [-0.2, 1.075]].map(([x, r]) => new THREE.Vector2(r, x))
    return [0, 1, 2, 3].map((i) => memo(`a3door${i}`, () => { const g = new THREE.LatheGeometry(pts, 14, (i * Math.PI) / 2 + 0.25, Math.PI / 2 - 0.5); g.rotateZ(-Math.PI / 2); g.computeVertexNormals(); return g }))
  }, [])
  useFrame((_, dt) => {
    const s = FS.sim
    const n1 = (s.n1[0] + s.n1[1]) / 2
    fan.current.rotation.x -= ((n1 / 100) * 5000 / 60) * Math.PI * 2 * Math.min(dt, 0.05) * 0.12 // slowed for the eye: real N1 would strobe
    const open = s.ctl.rev > 0 ? 1 : 0
    doors.current.forEach((d, i) => {
      if (!d) return
      const cur = d.userData.k ?? 0
      const k = cur + (open - cur) * Math.min(1, dt * 2.5)
      d.userData.k = k
      const phi = (i * Math.PI) / 2 + Math.PI / 4
      // pivot on the forward edge, rotate outward about the local tangent
      const ax = new THREE.Vector3(1, 0, 0).cross(new THREE.Vector3(0, -Math.sin(phi), Math.cos(phi))).normalize()
      d.quaternion.setFromAxisAngle(ax, -k * 32 * DEG)
    })
  })
  return (
    <group position={[AX.engineX, AX.engineY, AX.engineZ]}>
      <mesh geometry={nacelle} material={m.white} castShadow receiveShadow />
      <mesh geometry={lip} material={m.leMetal} />
      <mesh geometry={core} material={m.core} castShadow />
      <mesh geometry={plug} material={m.plug} />
      <mesh position={[1.22, 0, 0]} rotation={[0, 0, Math.PI / 2]} geometry={cyl(0.8, 0.8, 0.05, 48)} material={m.dark} />
      <group ref={fan} position={[1.42, 0, 0]}>
        <mesh geometry={blades} material={m.fan} />
        <mesh geometry={spinner} material={m.spinner} position={[-1.42, 0, 0]} />
      </group>
      {doorGeo.map((g, i) => {
        const phi = (i * Math.PI) / 2 + Math.PI / 4
        const pv: Vec3 = [-0.2, -Math.sin(phi) * 1.06, Math.cos(phi) * 1.06]
        return (
          <group key={i} position={pv} ref={(o) => { if (o) doors.current[i] = o }}>
            <mesh geometry={g} material={m.white} position={[-pv[0], -pv[1], -pv[2]]} castShadow />
          </group>
        )
      })}
      {/* pylon */}
      <mesh geometry={loft('a3pylon', [{ le: 2.3, y: 0.95, z: 0, chord: 3.6, t: 0.11 }, { le: 1.3, y: 1.15, z: 0, chord: 3.2, t: 0.1 }], { vertical: true })} material={m.white} castShadow />
    </group>
  )
}

/* ------------------------------------------------------------------ landing gear */
const strutExt = (i: number) => (FS.sim.d.struts?.[i] ?? STATIC_STROKE * 0.6) - STATIC_STROKE * 0.6
function Wheel({ r, w, m, idx }: { r: number; w: number; m: Mats; idx: number }) {
  const g = useRef<THREE.Group>(null!)
  useFrame(() => { g.current.rotation.z = -FS.wheelRot[idx] })
  return (
    <group ref={g}>
      <mesh geometry={tyre(r, w)} material={m.tyre} castShadow />
      <mesh geometry={cyl(r * 0.6, r * 0.6, w * 0.8, 28)} rotation={[Math.PI / 2, 0, 0]} material={m.hub} />
      <mesh geometry={cyl(r * 0.25, r * 0.25, w * 0.9, 16)} rotation={[Math.PI / 2, 0, 0]} material={m.chrome} />
    </group>
  )
}
function MainGear({ m, side }: { m: Mats; side: 1 | -1 }) {
  const pivot = useRef<THREE.Group>(null!), lower = useRef<THREE.Group>(null!)
  const gi = side === 1 ? 2 : 1
  const leg = 1.365
  useFrame(() => {
    const g = FS.sim.srf.gear
    pivot.current.rotation.x = (1 - g) * 88 * DEG
    lower.current.position.y = -leg - strutExt(gi)
    pivot.current.visible = g > 0.01
  })
  const brace = between([0, -0.55, 0], [0.0, 0.25, -1.3])
  return (
    <group ref={pivot} position={[AX.mainGearX, 1.95, AX.mainGearZ]}>
      <mesh geometry={cyl(0.13, 0.12, 0.95, 20)} position={[0, -0.47, 0]} material={m.gearPaint} castShadow />
      <mesh geometry={cyl(0.05, 0.05, brace.length, 10)} position={brace.position} quaternion={brace.quaternion} material={m.gearPaint} />
      <group ref={lower}>
        <mesh geometry={cyl(0.09, 0.09, 0.75, 20)} position={[0, 0.42, 0]} material={m.chrome} castShadow />
        <mesh geometry={cyl(0.07, 0.07, 1.05, 14)} rotation={[Math.PI / 2, 0, 0]} material={m.gearPaint} />
        <group position={[0, 0, 0.45]}><Wheel r={0.585} w={0.4} m={m} idx={gi} /></group>
        <group position={[0, 0, -0.45]}><Wheel r={0.585} w={0.4} m={m} idx={gi} /></group>
      </group>
    </group>
  )
}
function NoseGear({ m }: { m: Mats }) {
  const pivot = useRef<THREE.Group>(null!), lower = useRef<THREE.Group>(null!), steer = useRef<THREE.Group>(null!)
  useFrame(() => {
    const s = FS.sim
    pivot.current.rotation.z = (1 - s.srf.gear) * 92 * DEG
    lower.current.position.y = -0.92 - strutExt(0)
    steer.current.rotation.y = -s.srf.steer
    pivot.current.visible = s.srf.gear > 0.01
  })
  return (
    <group ref={pivot} position={[AX.noseGearX, 1.3, 0]}>
      <mesh geometry={cyl(0.1, 0.09, 0.6, 18)} position={[0, -0.3, 0]} material={m.gearPaint} castShadow />
      <group ref={steer}>
        <group ref={lower}>
          <mesh geometry={cyl(0.07, 0.07, 0.55, 16)} position={[0, 0.3, 0]} material={m.chrome} />
          <mesh geometry={cyl(0.05, 0.05, 0.5, 12)} rotation={[Math.PI / 2, 0, 0]} material={m.gearPaint} />
          <group position={[0, 0, 0.19]}><Wheel r={0.38} w={0.25} m={m} idx={0} /></group>
          <group position={[0, 0, -0.19]}><Wheel r={0.38} w={0.25} m={m} idx={0} /></group>
          <TaxiLight />
        </group>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ lights */
function Glow({ color, size, position, blink }: { color: string; size: number; position: Vec3; blink?: (t: number) => number }) {
  const m = useMemo(() => new THREE.SpriteMaterial({ map: glowSprite(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), [color])
  const s = useRef<THREE.Sprite>(null!)
  useFrame((st) => { const k = blink ? blink(st.clock.elapsedTime) : 1; s.current.visible = k > 0.01; s.current.material.opacity = k })
  return <sprite ref={s} material={m} position={position} scale={size} />
}
const strobe = (t: number) => { const f = t % 1.1; return f < 0.05 || (f > 0.12 && f < 0.17) ? 1 : 0 }
const beacon = (t: number) => (t % 1.2 < 0.12 ? 1 : 0)
function WingLights({ side }: { side: 1 | -1; k: string }) {
  // side 1 is the right wing (+z): green; left: red
  const ll = useRef<THREE.Group>(null!)
  useFrame(() => { ll.current.visible = FS.sim.srf.gear > 0.9 })
  return (
    <group>
      <Glow color={side === 1 ? '#2cff6a' : '#ff2a2a'} size={0.9} position={[-4.35, 3.45, 17.0]} />
      <Glow color="#ffffff" size={2.2} position={[-4.5, 3.45, 17.05]} blink={strobe} />
      <group ref={ll}><Glow color="#fff6dc" size={2.6} position={[2.6, 2.05, 2.4]} /></group>
    </group>
  )
}
function TaxiLight() { return <Glow color="#fff3d6" size={1.2} position={[0.25, 0.25, 0]} /> }

/* ------------------------------------------------------------------ forces (lift, weight, thrust, drag) */
function Arrow({ color, get }: { color: string; get: () => { dir: THREE.Vector3; mag: number; at: Vec3 } }) {
  const g = useRef<THREE.Group>(null!), shaft = useRef<THREE.Mesh>(null!), head = useRef<THREE.Mesh>(null!)
  const m = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }), [color])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  useFrame(() => {
    const { dir, mag, at } = get()
    const L = Math.max(0.01, Math.min(26, mag))
    g.current.position.set(...at)
    g.current.quaternion.setFromUnitVectors(up, dir)
    shaft.current.scale.set(1, L, 1); shaft.current.position.y = L / 2
    head.current.position.y = L + 0.6
    g.current.visible = mag > 0.2
  })
  return (
    <group ref={g} renderOrder={20}>
      <mesh ref={shaft} material={m} renderOrder={20}><cylinderGeometry args={[0.16, 0.16, 1, 10]} /></mesh>
      <mesh ref={head} material={m} renderOrder={20}><coneGeometry args={[0.5, 1.2, 14]} /></mesh>
    </group>
  )
}
function Forces() {
  const on = useFlight((s) => s.forces && s.cam !== 'cockpit' && s.cam !== 'wing')
  const W = AC.mass * G
  const sc = 12 / W // 1 g = 12 m
  const v = useMemo(() => ({ l: new THREE.Vector3(), d: new THREE.Vector3(), t: new THREE.Vector3(1, 0, 0), w: new THREE.Vector3(), q: new THREE.Quaternion() }), [])
  const cg: Vec3 = [AC.cgLayout.x, AC.cgLayout.y, 0]
  if (!on) return null
  return (
    <group>
      <Arrow color="#4fb3ff" get={() => { const d = FS.sim.d; v.l.set(Math.sin(d.alpha), Math.cos(d.alpha), 0); return { dir: v.l, mag: d.lift * sc, at: [cg[0], cg[1] + 1.2, 0] } }} />
      <Arrow color="#ffae3d" get={() => { v.q.copy(FS.sim.quat).invert(); v.w.set(0, -1, 0).applyQuaternion(v.q); return { dir: v.w, mag: 12, at: [cg[0], cg[1] - 1.2, 0] } }} />
      <Arrow color="#58e08a" get={() => { const d = FS.sim.d; return { dir: v.t.set(1, 0, 0), mag: (d.thrust[0] + d.thrust[1]) * sc * 3, at: [AX.nose + 0.5, AX.axisY - 0.6, 0] } }} />
      <Arrow color="#ff5b5b" get={() => { const d = FS.sim.d; v.d.set(-Math.cos(d.alpha), Math.sin(d.alpha), 0); return { dir: v.d, mag: d.drag * sc * 3, at: [AX.tail - 0.5, AX.axisY + 0.3, 0] } }} />
    </group>
  )
}

function CockpitIfInside() {
  const inside = useFlight((s) => s.cam === 'cockpit')
  return inside ? <Cockpit /> : null
}

/* ------------------------------------------------------------------ the aircraft */
export function A320({ children }: { children?: ReactNode }) {
  const m = useMats()
  const tailBlue = m.tail
  const ths = useRef<THREE.Group>(null!)
  useFrame(() => { ths.current.rotation.z = -FS.sim.srf.ths })
  const hs: Section[] = HSTAB
  const thsPivot: Vec3 = [-15.6, 4.7, 0]
  return (
    // the body frame origin is the centre of gravity: shift the drawing so the CG sits at 0
    <group position={[-AC.cgLayout.x, -AC.cgLayout.y, 0]}>
      <Fuselage m={m} />
      <CockpitIfInside />
      <Wing side={1} m={m} />
      <Wing side={-1} m={m} />
      <NoseGear m={m} />
      {/* fin + rudder */}
      <mesh geometry={loft('a3fin', FIN, { vertical: true, c0: 0, c1: 0.7 })} material={tailBlue} castShadow />
      <Hinged id="rud" sections={FIN} c0={0.7} c1={1} hingeC={0.7} material={tailBlue} vertical drive={() => [FS.sim.srf.rud, 0, 0]} />
      {/* trimmable horizontal stabiliser + elevators */}
      <group ref={ths} position={thsPivot}>
        <group position={[-thsPivot[0], -thsPivot[1], 0]}>
          {[1, -1].map((s) => (
            <group key={s} scale={[1, 1, s]}>
              <mesh geometry={loft('a3hs', hs, { c0: 0, c1: 0.7 })} material={m.white} castShadow />
              <Hinged id="elev" sections={hs} c0={0.7} c1={1} hingeC={0.7} material={m.wingDark} drive={() => [-FS.sim.srf.elev, 0, 0]} />
            </group>
          ))}
        </group>
      </group>
      {/* tail cone light, beacons */}
      <Glow color="#ffffff" size={0.8} position={[AX.tail - 0.1, 4.8, 0]} />
      <Glow color="#ff3020" size={1.4} position={[2, AX.axisY + AX.R + 0.08, 0]} blink={beacon} />
      <Glow color="#ff3020" size={1.4} position={[2, AX.axisY - AX.R - 0.08, 0]} blink={(t) => beacon(t + 0.6)} />
      <group position={[AC.cgLayout.x, AC.cgLayout.y, 0]}>{children}</group>
      <Forces />
    </group>
  )
}
void wingAt
