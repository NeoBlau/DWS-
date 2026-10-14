import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cyl, loft, type Section } from '../../utils/geom'
import { revolve } from '../diesel/geometry'
import { fanBlades, vaneRing } from '../jet/geometry'
import { DEG, VORTEX } from './fdm'
import { vortexPlanform, vortexTop, VORTEX_FAN_Z, VORTEX_FAN_X, VORTEX_FIN, VORTEX_FIN_Z, VORTEX_GEAR, VX } from './geometry'
import { FS } from './state'
import { useMats, Hinged, NoseGear, Glow, strobe, beacon, Forces, CockpitIfInside, flapDeg, slatDeg, strutExt, Wheel, type Mats } from './Aircraft'
import type { Vec3 } from '../../data/types'

/*
 * «Вихрь-240» — blended wing body. Same drawing frame as the A320 (x to the nose, y up, ground at y = 0,
 * centre of gravity at x −0.63, y 3.0), so the shared flight deck sits at the same eye point inside the nose.
 *   · centre body = the cabin (5 seat bays wide), lifting like a wing; outer wings fold at z = 18 m on the ground
 *   · 8 ducted electric fans on the upper aft body ingest its boundary layer
 *   · two hydrogen rotating-detonation turbo-generator cores inside the aft body exhaust at the trailing edge
 *   · two canted fins with rudders; elevons on the trailing edge do pitch and roll; Krueger leading edges
 */

const planform = vortexPlanform
const at = (z: number): Section => planform(Math.abs(z))
const BODY: Section[] = Array.from({ length: 25 }, (_, i) => { const z = -8.5 + (17 * i) / 24; return { ...planform(Math.abs(z)), z } })
export const topY = vortexTop
const span = (z0: number, z1: number, n = 3) => Array.from({ length: n }, (_, i) => at(z0 + ((z1 - z0) * i) / (n - 1)))
const FAN_Z = VORTEX_FAN_Z
const FAN_X = VORTEX_FAN_X

/** a thin patch that follows the upper surface (windscreen, panel lines) */
function skinPatch(key: string, x0: number, x1: number, z0: number, z1: number, off = 0.02, N = 8) {
  const g = new THREE.BufferGeometry(), pos: number[] = [], idx: number[] = []
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const x = x0 + ((x1 - x0) * i) / N, z = z0 + ((z1 - z0) * j) / N
    pos.push(x, topY(x, z) + off, z)
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, b = a + N + 1; idx.push(a, a + 1, b, b, a + 1, b + 1) }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
  g.name = key
  return g
}

function Fan({ z, m }: { z: number; m: Mats }) {
  const rot = useRef<THREE.Group>(null!)
  const g = useMemo(() => ({
    duct: revolve('vxDuct', [[1.15, 0.97], [1.22, 1.04], [1.0, 1.1], [-0.9, 1.06], [-1.15, 0.99], [-1.05, 0.9], [0.9, 0.93], [1.15, 0.97]], 48),
    hub: revolve('vxHub', [[0.95, 0.001], [0.95, 0.12], [0.6, 0.3], [-0.6, 0.32], [-1.3, 0.12], [-1.4, 0.001]], 32),
    blades: fanBlades('vortex', 18, 0.3, 0.9, { chord0: 0.22, chord1: 0.14, b0: 0.45, b1: 1.05, camber: 0.05, sweep: 0.2 }),
    vanes: vaneRing('vxOgv', 11, 0.32, 0.9, 0.16, 0.02, 0.1),
  }), [])
  useFrame((_, dt) => { rot.current.rotation.x -= ((FS.sim.n1[0] + FS.sim.n1[1]) / 200) * 14 * Math.min(dt, 0.05) })
  const y = topY(FAN_X, z) + 0.55
  return (
    <group position={[FAN_X, y, z]}>
      <mesh geometry={g.duct} material={m.white} castShadow />
      <group ref={rot} position={[0.45, 0, 0]}>
        <mesh geometry={g.blades} material={m.fan} />
      </group>
      <mesh geometry={g.hub} material={m.spinner} />
      <group position={[-0.35, 0, 0]}><mesh geometry={g.vanes} material={m.leMetal} /></group>
    </group>
  )
}

function MainGear({ m, side }: { m: Mats; side: 1 | -1 }) {
  const pivot = useRef<THREE.Group>(null!), lower = useRef<THREE.Group>(null!)
  const gi = side === 1 ? 2 : 1, leg = 1.15
  useFrame(() => {
    const g = FS.sim.srf.gear
    pivot.current.rotation.x = -(1 - g) * 88 * DEG // folds inboard into the body
    lower.current.position.y = -leg - strutExt(gi)
    pivot.current.visible = g > 0.01
  })
  return (
    <group ref={pivot} position={VORTEX_GEAR}>
      <mesh geometry={cyl(0.15, 0.14, 0.8, 18)} position={[0, -0.4, 0]} material={m.gearPaint} castShadow />
      <group ref={lower}>
        <mesh geometry={cyl(0.1, 0.1, 0.6, 18)} position={[0, 0.35, 0]} material={m.chrome} />
        <mesh geometry={cyl(0.07, 0.07, 1.6, 12)} rotation={[0, 0, Math.PI / 2]} material={m.gearPaint} />
        {[0.72, -0.72].map((dx) => [0.42, -0.42].map((dz) => (
          <group key={`${dx}${dz}`} position={[dx, 0, dz]}><Wheel r={0.6} w={0.4} m={m} idx={gi} /></group>
        )))}
      </group>
    </group>
  )
}

function Side({ side, m }: { side: 1 | -1; m: Mats }) {
  const tip = useRef<THREE.Group>(null!)
  const fold = useRef(0)
  useFrame((_, dt) => {
    // the outer panels fold up on the ground at low speed (folded span 36 m — fits an A320 stand)
    const s = FS.sim, want = !s.airborne && s.d.gs < 25 && s.ctl.lever < 0.3 && s.srf.confTarget === 0 && s.d.surface !== 'runway' ? 1 : 0
    fold.current += Math.max(-dt * 0.12, Math.min(dt * 0.12, want - fold.current))
    tip.current.rotation.x = -fold.current * 72 * DEG
  })
  const ailSign = side === 1 ? -1 : 1
  const pitch = () => -(FS.sim.srf.elev * 0.9 + FS.sim.srf.ths * 0.5)
  const hinge = at(18)
  return (
    <group scale={[1, 1, side]}>
      {/* trailing-edge elevons of the centre body */}
      {[[0, 3], [3, 6], [6, 8.5]].map(([a, b], i) => (
        <Hinged key={`be${i}`} id={`vxBE${i}`} sections={span(a, b, 4)} c0={0.92} c1={1} hingeC={0.92} material={m.wingDark} drive={() => [pitch(), 0, 0]} />
      ))}
      {/* inner outer-wing */}
      <mesh geometry={loft('vxWin', span(VX.w, 18, 12), { c0: 0.12, c1: 0.7 })} material={m.wing} castShadow receiveShadow />
      <mesh geometry={loft('vxWinLE', span(VX.w, 9.5, 6), { c0: 0, c1: 0.12 })} material={m.wing} castShadow />
      <Hinged id="vxK1" sections={span(9.5, 18, 2)} c0={0} c1={0.12} hingeC={0.12} material={m.leMetal} drive={() => { const s = slatDeg() / 20; return [-s * 35 * DEG, s * 0.2, -s * 0.15] }} />
      {/* elevons on the swept panels: pitch (both together) and roll (outboard of 14 m, opposite) — no flaps on a tailless wing */}
      <Hinged id="vxElv" sections={span(VX.w + VX.blend + 1, 14, 2)} c0={0.7} c1={1} hingeC={0.7} material={m.wingDark} drive={() => [pitch(), 0, 0]} />
      <Hinged id="vxElv2" sections={span(14, 18, 2)} c0={0.7} c1={1} hingeC={0.7} material={m.wingDark} drive={() => [ailSign * FS.sim.srf.ail + pitch(), 0, 0]} />
      {/* folding outer panel */}
      <group position={[0, hinge.y + 0.1, 18]}>
        <group ref={tip}>
          <group position={[0, -hinge.y - 0.1, -18]}>
            <mesh geometry={loft('vxTip', span(18, VX.span / 2, 4), { c0: 0.12, c1: 0.7 })} material={m.wing} castShadow />
            <mesh geometry={loft('vxTipLE', span(VX.span / 2 - 1, VX.span / 2, 2), { c0: 0, c1: 0.12 })} material={m.wing} />
            <Hinged id="vxK2" sections={span(18, VX.span / 2 - 1, 2)} c0={0} c1={0.12} hingeC={0.12} material={m.leMetal} drive={() => { const s = slatDeg() / 20; return [-s * 35 * DEG, s * 0.15, -s * 0.1] }} />
            <Hinged id="vxElv3" sections={span(18, 23, 2)} c0={0.7} c1={1} hingeC={0.7} material={m.wingDark} drive={() => [ailSign * FS.sim.srf.ail + pitch(), 0, 0]} />
            <Hinged id="vxAil" sections={span(23, VX.span / 2, 2)} c0={0.72} c1={1} hingeC={0.72} material={m.wingDark} drive={() => [ailSign * FS.sim.srf.ail, 0, 0]} />
            <Glow color={side === 1 ? '#2cff6a' : '#ff2a2a'} size={0.9} position={[at(VX.span / 2).le - 0.2, 4.4, VX.span / 2 + 0.05]} />
            <Glow color="#ffffff" size={2.2} position={[at(VX.span / 2).le - 0.9, 4.4, VX.span / 2 + 0.05]} blink={strobe} />
          </group>
        </group>
      </group>
      <mesh position={[hinge.le - hinge.chord * 0.45, hinge.y + 0.16, 18]} material={m.dark}><boxGeometry args={[hinge.chord * 0.6, 0.02, 0.05]} /></mesh>
      {/* fin with rudder, canted outward */}
      <group position={[0, topY(3, VORTEX_FIN_Z) - 0.05, VORTEX_FIN_Z]} rotation={[-10 * DEG, 0, 0]}>
        <mesh geometry={loft('vxFin', VORTEX_FIN, { vertical: true, c0: 0, c1: 0.7 })} material={m.tail} castShadow />
        <Hinged id="vxRud" sections={VORTEX_FIN} c0={0.7} c1={1} hingeC={0.7} material={m.tail} vertical drive={() => [FS.sim.srf.rud, 0, 0]} />
        <Glow color="#ff3020" size={1.0} position={[VORTEX_FIN[1].le - 2.4, 4.05, 0]} blink={beacon} />
      </group>
      {FAN_Z.map((z) => <Fan key={z} z={z} m={m} />)}
      {/* detonation-core exhaust in the trailing edge */}
      <group position={[at(2.1).le - at(2.1).chord + 0.2, 3.45, 2.1]}>
        <mesh geometry={cyl(0.42, 0.5, 0.9, 28)} rotation={[0, 0, Math.PI / 2]} material={m.core} />
        <mesh geometry={cyl(0.3, 0.3, 0.92, 20)} rotation={[0, 0, Math.PI / 2]} material={m.dark} />
      </group>
      <MainGear m={m} side={side} />
      {/* flight-deck windscreen */}
      <mesh geometry={useMemo(() => skinPatch('vxWs', 15.4, 17.3, 0.15, 1.55, 0.025, 6), [])} material={m.glass} />
      {/* passenger door outline on the leading edge */}
      <mesh geometry={useMemo(() => skinPatch('vxDoor', 12.6, 13.6, 5.3, 6.1, 0.02, 4), [])} material={m.dark} />
    </group>
  )
}

export function VortexModel() {
  const base = useMats()
  const m = useMemo(() => {
    const tail = base.tail.clone(); tail.color.set('#3b2a9e')
    const wing = base.wing.clone(); wing.color.set('#e4e6ea')
    return { ...base, tail, wing }
  }, [base])
  const plume = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7fb4ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  useFrame(() => { plume.opacity = Math.min(0.5, Math.max(0, (FS.sim.n1[0] + FS.sim.n1[1]) / 2 - 18) / 120) })
  const pts: Vec3[] = [[at(2.1).le - at(2.1).chord - 0.4, 3.45, 2.1], [at(2.1).le - at(2.1).chord - 0.4, 3.45, -2.1]]
  return (
    <group position={[-VORTEX.cgLayout.x, -VORTEX.cgLayout.y, 0]}>
      <CockpitIfInside />
      {/* centre body (the cabin) in one piece so it is smooth across the centreline */}
      <mesh geometry={loft('vxBody', BODY, { c0: 0, c1: 0.92 })} material={m.white} castShadow receiveShadow />
      <Side side={1} m={m} />
      <Side side={-1} m={m} />
      <NoseGear m={m} />
      {/* hydrogen-water exhaust is nearly invisible: a faint blue shimmer */}
      {pts.map((p, i) => <mesh key={i} position={[p[0] - 1.4, p[1], p[2]]} rotation={[0, 0, Math.PI / 2]} material={plume}><coneGeometry args={[0.38, 2.6, 20, 1, true]} /></mesh>)}
      <Glow color="#ff3020" size={1.3} position={[2, 1.25, 0]} blink={(t) => beacon(t + 0.6)} />
      <Glow color="#ffffff" size={0.8} position={[at(0).le - at(0).chord - 0.2, 3.5, 0]} />
      <Forces />
    </group>
  )
}
