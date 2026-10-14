import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { AX, fusY } from '../../models/aircraftLayout'
import { cyl, glowSprite, loft, tyre, type Section } from '../../utils/geom'
import { revolve } from '../diesel/geometry'
import { fanBlades, vaneRing } from '../jet/geometry'
import { DEG, STRIZH } from './fdm'
import { STRIZH_WING, STRIZH_ENG, STRIZH_STRUT, STRIZH_GEAR, STRIZH_FIN, STRIZH_HS, STRIZH_DX } from './geometry'
import { FS } from './state'
import { useMats, Fuselage, Hinged, NoseGear, Glow, strobe, beacon, Forces, CockpitIfInside, flapDeg, slatDeg, strutExt, Wheel, type Mats } from './Aircraft'
import type { Vec3 } from '../../data/types'

/*
 * «Стриж-180»: high truss-braced wing (span 47.3 m, aspect ratio ≈ 19, folding tips), struts from fuselage
 * sponsons that also house the main gear, two wing-mounted open-fan engines (Ø ≈ 4 m), T-tail.
 * Same drawing frame as the A320 (x to the nose, y up, ground at y = 0); the forward fuselage and flight deck are shared.
 */

/* ------------------------------------------------------------------ wing planform (right side, +z) */
const WING: Section[] = STRIZH_WING
function wingAt(z: number): Section {
  let i = 0
  while (i < WING.length - 2 && z > WING[i + 1].z) i++
  const a = WING[i], b = WING[i + 1], k = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)))
  return { le: a.le + (b.le - a.le) * k, y: a.y + (b.y - a.y) * k, z, chord: a.chord + (b.chord - a.chord) * k, t: a.t + (b.t - a.t) * k }
}
const span = (z0: number, z1: number, n = 3) => Array.from({ length: n }, (_, i) => wingAt(z0 + ((z1 - z0) * i) / (n - 1)))
const ENG: Vec3 = STRIZH_ENG
const [STRUT_LOW, STRUT_HIGH] = STRIZH_STRUT as [Vec3, Vec3]

function Bar({ a, b, w, t, material }: { a: Vec3; b: Vec3; w: number; t: number; material: THREE.Material }) {
  // a streamlined strut: flat box with its chord along the flight direction
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b)
  const mid = va.clone().add(vb).multiplyScalar(0.5), dir = vb.clone().sub(va), len = dir.length()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return <mesh position={mid} quaternion={q} material={material} castShadow><boxGeometry args={[w, len, t]} /></mesh>
}

function OpenFan({ m }: { m: Mats }) {
  const fan = useRef<THREE.Group>(null!)
  const g = useMemo(() => ({
    core: revolve('strCore', [[2.6, 0.001], [2.6, 0.32], [2.2, 0.52], [1.2, 0.6], [-0.6, 0.62], [-1.6, 0.5], [-2.2, 0.36], [-2.2, 0.001]], 48),
    spinner: revolve('strSpin', [[1.55, 0.001], [1.55, 0.5], [2.0, 0.42], [2.45, 0.22], [2.7, 0.001]], 40),
    blades: fanBlades('strizh', 12, 0.5, 2.0, { chord0: 0.42, chord1: 0.22, b0: 0.5, b1: 1.2, camber: 0.06, sweep: 0.35 }),
    vanes: vaneRing('strOgv', 10, 0.6, 1.75, 0.3, 0.03, 0.15),
    plug: revolve('strPlug', [[-2.2, 0.001], [-2.2, 0.3], [-2.9, 0.05], [-2.95, 0.001]], 32),
  }), [])
  useFrame((_, dt) => { fan.current.rotation.x -= ((FS.sim.n1[0] + FS.sim.n1[1]) / 200) * 9 * Math.min(dt, 0.05) })
  const pylon = loft('strPylon', [{ le: 2.0, y: 0.4, z: 0, chord: 3.6, t: 0.09 }, { le: 0.6, y: 0.62, z: 0, chord: 2.6, t: 0.08 }], { vertical: true })
  return (
    <group position={ENG}>
      <mesh geometry={g.core} material={m.white} castShadow />
      <group ref={fan} position={[1.6, 0, 0]}>
        <mesh geometry={g.blades} material={m.fan} castShadow />
        <mesh geometry={g.spinner} material={m.spinner} position={[-1.6, 0, 0]} />
      </group>
      <group position={[0.9, 0, 0]}><mesh geometry={g.vanes} material={m.leMetal} /></group>
      <mesh geometry={g.plug} material={m.plug} />
      <mesh geometry={pylon} material={m.white} castShadow />
    </group>
  )
}

function MainGear({ m, side }: { m: Mats; side: 1 | -1 }) {
  const pivot = useRef<THREE.Group>(null!), lower = useRef<THREE.Group>(null!)
  const gi = side === 1 ? 2 : 1, leg = 0.82
  useFrame(() => {
    const g = FS.sim.srf.gear
    pivot.current.rotation.z = (1 - g) * 85 * DEG // folds forward into the sponson
    lower.current.position.y = -leg - strutExt(gi)
    pivot.current.visible = g > 0.01
  })
  return (
    <group ref={pivot} position={STRIZH_GEAR}>
      <mesh geometry={cyl(0.12, 0.11, 0.6, 18)} position={[0, -0.3, 0]} material={m.gearPaint} castShadow />
      <group ref={lower}>
        <mesh geometry={cyl(0.085, 0.085, 0.5, 18)} position={[0, 0.3, 0]} material={m.chrome} />
        <mesh geometry={cyl(0.06, 0.06, 0.9, 12)} rotation={[Math.PI / 2, 0, 0]} material={m.gearPaint} />
        <group position={[0, 0, 0.38]}><Wheel r={0.585} w={0.38} m={m} idx={gi} /></group>
        <group position={[0, 0, -0.38]}><Wheel r={0.585} w={0.38} m={m} idx={gi} /></group>
      </group>
    </group>
  )
}

function Side({ side, m }: { side: 1 | -1; m: Mats }) {
  const spl = () => (side === 1 ? FS.sim.srf.splR : FS.sim.srf.splL)
  const accent = m.tail
  return (
    <group scale={[1, 1, side]}>
      <mesh geometry={loft('strWing', WING, { c0: 0.12, c1: 0.72 })} material={m.wing} castShadow receiveShadow />
      <mesh geometry={loft('strWte', span(13.2, 18.4, 2), { c0: 0.72, c1: 1 })} material={m.wing} castShadow />
      <mesh geometry={loft('strWte2', span(22.6, 23.65, 2), { c0: 0.72, c1: 1 })} material={m.wing} castShadow />
      {/* folding-tip hinge line: the outer 5.6 m fold up at the gate so the aircraft fits a 36 m stand */}
      <mesh position={[wingAt(18).le - wingAt(18).chord * 0.5, wingAt(18).y + 0.13, 18]} material={m.dark}><boxGeometry args={[wingAt(18).chord, 0.02, 0.05]} /></mesh>
      {/* Krueger flaps hinge down from under the leading edge and keep the upper surface laminar */}
      {[[2.2, 8.5], [8.5, 15], [15, 22.5]].map(([a, b], i) => (
        <Hinged key={`k${i}`} id={`strK${i}`} sections={span(a, b, 2)} c0={0} c1={0.12} hingeC={0.12} material={m.leMetal}
          drive={() => { const s = slatDeg() / 25; return [-s * 35 * DEG, s * 0.25, -s * 0.2] }} />
      ))}
      {/* double-slotted Fowler flaps */}
      {[[2.2, 7.6], [7.6, 13.2]].map(([a, b], i) => (
        <Hinged key={`f${i}`} id={`strF${i}`} sections={span(a, b, 2)} c0={0.72} c1={1} hingeC={0.72} material={m.wingDark}
          drive={() => { const f = flapDeg(); return [f * DEG * 0.9, -Math.min(1, f / 20) * 0.6, -Math.min(1, f / 20) * 0.14] }} />
      ))}
      <Hinged id="strAil" sections={span(18.4, 22.6, 2)} c0={0.72} c1={1} hingeC={0.72} material={m.wingDark} drive={() => [(side === 1 ? -1 : 1) * FS.sim.srf.ail, 0, 0]} />
      {[[3, 6], [6, 9], [9, 12], [12, 15], [15, 18]].map(([a, b], i) => (
        <Hinged key={`sp${i}`} id={`strSp${i}`} sections={span(a, b, 2).map((s) => ({ ...s, t: s.t * 0.35, y: s.y + s.t * s.chord * 0.45 }))} c0={0.55} c1={0.72} hingeC={0.55} material={m.wingDark}
          drive={() => { const g = FS.sim.srf.gndSpl; return [-(i === 0 ? g : Math.max(g, spl())) * 48 * DEG, 0, 0] }} />
      ))}
      {/* truss: main strut from the sponson, jury strut to the wing */}
      <Bar a={STRUT_LOW} b={STRUT_HIGH} w={0.62} t={0.12} material={m.wing} />
      <Bar a={[(STRUT_LOW[0] + STRUT_HIGH[0]) / 2, (STRUT_LOW[1] + STRUT_HIGH[1]) / 2, (STRUT_LOW[2] + STRUT_HIGH[2]) / 2]} b={[-1.6 + STRIZH_DX, 5.05, 7.6]} w={0.35} t={0.08} material={m.wing} />
      {/* sponson: houses the main gear and anchors the strut */}
      <mesh position={[STRIZH_GEAR[0] + 0.05, 1.45, 2.05]} scale={[4.2, 0.95, 0.85]} material={m.white} castShadow><sphereGeometry args={[1, 32, 16]} /></mesh>
      <OpenFan m={m} />
      <MainGear m={m} side={side} />
      <Glow color={side === 1 ? '#2cff6a' : '#ff2a2a'} size={0.9} position={[-5.05 + STRIZH_DX, 4.62, 23.75]} />
      <Glow color="#ffffff" size={2.2} position={[-5.2 + STRIZH_DX, 4.62, 23.8]} blink={strobe} />
      {/* winglet-free tip: a small raked fairing */}
      <mesh geometry={loft('strTip', [{ le: -5.0 + STRIZH_DX, y: 4.6, z: 23.65, chord: 1.2, t: 0.09 }, { le: -5.5 + STRIZH_DX, y: 4.62, z: 24.0, chord: 0.6, t: 0.06 }])} material={accent} />
    </group>
  )
}

export function StrizhModel() {
  const base = useMats()
  const m = useMemo(() => { const tail = base.tail.clone(); tail.color.set('#0b6e62'); return { ...base, tail } }, [base])
  const ths = useRef<THREE.Group>(null!)
  useFrame(() => { ths.current.rotation.z = -FS.sim.srf.ths })
  const FIN: Section[] = STRIZH_FIN
  const HS: Section[] = STRIZH_HS
  const pivot: Vec3 = [-15.9, 11.0, 0]
  const sprite = useMemo(() => glowSprite(), [])
  void sprite; void tyre; void fusY
  return (
    <group position={[-STRIZH.cgLayout.x, -STRIZH.cgLayout.y, 0]}>
      <Fuselage m={m} stripe="#0b7a6c" stripe2Hex="#4fd1b8" />
      <CockpitIfInside />
      {/* wing-to-fuselage fairing on the crown */}
      <mesh position={[-1.0 + STRIZH_DX, 5.0, 0]} scale={[5.2, 0.55, 2.0]} material={m.white} castShadow><sphereGeometry args={[1, 40, 16]} /></mesh>
      <Side side={1} m={m} />
      <Side side={-1} m={m} />
      <NoseGear m={m} />
      {/* T-tail */}
      <mesh geometry={loft('strFin', FIN, { vertical: true, c0: 0, c1: 0.7 })} material={m.tail} castShadow />
      <Hinged id="strRud" sections={FIN} c0={0.7} c1={1} hingeC={0.7} material={m.tail} vertical drive={() => [FS.sim.srf.rud, 0, 0]} />
      <group ref={ths} position={pivot}>
        <group position={[-pivot[0], -pivot[1], 0]}>
          {[1, -1].map((s) => (
            <group key={s} scale={[1, 1, s]}>
              <mesh geometry={loft('strHs', HS, { c0: 0, c1: 0.7 })} material={m.white} castShadow />
              <Hinged id="strElev" sections={HS} c0={0.7} c1={1} hingeC={0.7} material={m.wingDark} drive={() => [-FS.sim.srf.elev, 0, 0]} />
            </group>
          ))}
        </group>
      </group>
      <Glow color="#ffffff" size={0.8} position={[AX.tail - 0.1, 4.8, 0]} />
      <Glow color="#ff3020" size={1.4} position={[2, AX.axisY - AX.R - 0.08, 0]} blink={(t) => beacon(t + 0.6)} />
      <Glow color="#ff3020" size={1.2} position={[-14.5, 11.3, 0]} blink={beacon} />
      <Forces />
    </group>
  )
}
