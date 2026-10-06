import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Part, VehicleCtx } from './Part'
import { RuntimeCtx, newRuntime, approach, useRuntime, liveRuntime, type Runtime } from './runtime'
import type { VehicleDef, Vec3 } from '../data/types'
import { getApp } from '../store'
import { AX, AILERON, FIN, FLAPS, HSTAB, SLATS, SPOILERS, WING, fusR, fusY, span, wingAt } from './aircraftLayout'
import { cyl, fuselage, glowSprite, loft, memo, rbox, sphere, torus, type Section } from '../utils/geom'

const mirror = (s: Section[]): Section[] => s.map((k) => ({ ...k, z: -k.z }))

/* ------------------------------------------------------------ hinged control surface */
function Surface({ id, sections, c0, c1, hingeC, kind = 'white', color, comp, system, layer = 'wings', side, drive, vertical }: {
  id: string; sections: Section[]; c0: number; c1: number; hingeC: number; kind?: 'white' | 'accent' | 'steel'; color?: string
  comp: string[]; system: 'wings' | 'flightControls'; layer?: string; side: 1 | -1
  /** returns [angle (rad, + = trailing edge down / left), translate x, translate y] */
  drive: (rt: Runtime) => [number, number, number]; vertical?: boolean
}) {
  const rt = useRuntime()
  const geo = loft(id, sections, { c0, c1, vertical })
  const a = sections[0], b = sections[sections.length - 1]
  const A = useMemo(() => new THREE.Vector3(a.le - hingeC * a.chord, a.y, a.z), [a, hingeC])
  const B = useMemo(() => new THREE.Vector3(b.le - hingeC * b.chord, b.y, b.z), [b, hingeC])
  const axis = useMemo(() => B.clone().sub(A).normalize(), [A, B])
  const g = useRef<THREE.Group>(null!)
  useFrame(() => {
    const [ang, tx, ty] = drive(rt)
    g.current.quaternion.setFromAxisAngle(axis, ang * (vertical ? 1 : side))
    g.current.position.set(A.x + tx, A.y + ty, A.z)
  })
  return (
    <group ref={g} position={A}>
      <Part kind={kind} color={color} layer={layer} system={system} comp={comp} side={side}>
        <mesh geometry={geo} position={[-A.x, -A.y, -A.z]} />
      </Part>
    </group>
  )
}

function Wing({ side }: { side: 1 | -1 }) {
  const S = (s: Section[]) => (side === 1 ? s : mirror(s))
  const key = side === 1 ? 'L' : 'R'
  const z = (v: number) => v * side
  return (
    <group>
      {/* fixed wing box: leading-edge root, main box, trailing-edge root/tip */}
      <Part kind="white" shell layer="wings" system="wings" comp={['wing', 'wingTanks']} side={side}>
        <mesh geometry={loft(`wbox${key}`, S(WING), { c0: 0.1, c1: 0.76 })} />
        <mesh geometry={loft(`wle0${key}`, S(span(1.6, 2.6, 2)), { c0: 0, c1: 0.11 })} />
        <mesh geometry={loft(`wle1${key}`, S(span(5.0, 6.4, 2)), { c0: 0, c1: 0.11 })} />
        <mesh geometry={loft(`wle2${key}`, S(span(16.6, 16.9, 2)), { c0: 0, c1: 0.11 })} />
        <mesh geometry={loft(`wte${key}`, S(span(16.2, 16.9, 2)), { c0: 0.75, c1: 1 })} />
        <mesh geometry={loft(`wte1${key}`, S(span(6.2, 6.4, 2)), { c0: 0.75, c1: 1 })} />
        <mesh geometry={loft(`wte2${key}`, S(span(12.3, 12.5, 2)), { c0: 0.75, c1: 1 })} />
        <mesh geometry={loft(`shark${key}`, [
          { le: -4.42, y: 3.42, z: z(16.88), chord: 1.42, t: 0.1 }, { le: -4.95, y: 4.2, z: z(17.22), chord: 0.95, t: 0.1 }, { le: -5.55, y: 5.45, z: z(17.36), chord: 0.55, t: 0.1 },
        ], { vertical: true })} />
      </Part>
      {SLATS.map(([a, b], i) => (
        <Surface key={`s${i}`} id={`slat${key}${i}`} sections={S(span(a, b, 2))} c0={0} c1={0.11} hingeC={0.11} side={side} kind="white" color="#dfe7ee"
          comp={['slats']} system="wings" drive={(rt) => [-rt.slats * 0.32, rt.slats * 0.45, -rt.slats * 0.12]} />
      ))}
      {FLAPS.map(([a, b], i) => (
        <Surface key={`f${i}`} id={`flap${key}${i}`} sections={S(span(a, b, 2))} c0={0.76} c1={1} hingeC={0.76} side={side} kind="accent" color="#b9c9d8"
          comp={['flaps']} system="wings" drive={(rt) => [rt.flaps * 0.52, -rt.flaps * 0.75, -rt.flaps * 0.12]} />
      ))}
      <Surface id={`ail${key}`} sections={S(span(AILERON[0], AILERON[1], 2))} c0={0.76} c1={1} hingeC={0.76} side={side} kind="accent" color="#9fd8ff"
        comp={['ailerons']} system="flightControls" drive={(rt) => [rt.aileron * side * 0.36, 0, 0]} />
      {SPOILERS.map(([a, b], i) => (
        <Surface key={`sp${i}`} id={`spl${key}${i}`} sections={S(span(a, b, 2)).map((s) => ({ ...s, t: s.t * 0.35, y: s.y + s.t * s.chord * 0.45 }))} c0={0.6} c1={0.75} hingeC={0.6} side={side} kind="steel" color="#8b98a6"
          comp={['spoilers']} system="flightControls" drive={(rt) => [-(Math.max(rt.spoilers, i > 0 ? Math.max(0, -rt.aileron * side) * 0.6 : 0)) * 0.85, 0, 0]} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------ engine */
function Engine({ side }: { side: 1 | -1 }) {
  const rt = useRuntime()
  const fan = useRef<THREE.Group>(null!)
  const flame = useRef<THREE.Mesh>(null!)
  const nacelle = useMemo(() => memo('nacelle', () => {
    const pts = [[0.8, 4.0], [0.9, 4.14], [1.01, 3.98], [1.07, 3.2], [1.04, 1.6], [0.93, 0.4], [0.76, -0.25]].map(([r, x]) => new THREE.Vector2(r, x))
    const g = new THREE.LatheGeometry(pts, 48); g.rotateZ(-Math.PI / 2); return g
  }), [])
  const core = useMemo(() => memo('core', () => {
    const pts = [[0.72, 0.6], [0.66, -0.4], [0.52, -1.1]].map(([r, x]) => new THREE.Vector2(r, x))
    const g = new THREE.LatheGeometry(pts, 40); g.rotateZ(-Math.PI / 2); return g
  }), [])
  const plug = useMemo(() => memo('plug', () => { const g = new THREE.ConeGeometry(0.4, 0.9, 32); g.rotateZ(Math.PI / 2); return g }), [])
  useFrame(() => {
    fan.current.rotation.x = rt.n1Angle
    const on = rt.n1 > 0.15
    flame.current.visible = on
    ;(flame.current.material as THREE.MeshBasicMaterial).opacity = Math.min(0.6, (rt.n1 - 0.15) * 1.2) * (0.85 + Math.random() * 0.15)
  })
  const z = AX.engineZ * side
  return (
    <group position={[AX.engineX - 2.0, AX.engineY, z]}>
      <Part kind="white" shell layer="engines" system="engines" comp={['engine', 'nacelle']} side={side}>
        <mesh geometry={nacelle} />
      </Part>
      <Part kind="steel" color="#7f8a96" layer="engines" system="engines" comp={['engine', 'core']} side={side}>
        <mesh geometry={core} />
        <mesh geometry={plug} position={[-1.45, 0, 0]} />
      </Part>
      <Part kind="metal" color="#c8d2db" layer="engines" system="engines" comp={['fan', 'engine']} side={side}>
        <group ref={fan} position={[3.6, 0, 0]}>
          {Array.from({ length: 24 }, (_, i) => (
            <mesh key={i} geometry={rbox(0.05, 0.62, 0.2, 0.01)} rotation={[(i / 24) * Math.PI * 2, 0.4, 0]} position={[0, Math.cos((i / 24) * Math.PI * 2) * 0.5, Math.sin((i / 24) * Math.PI * 2) * 0.5]} />
          ))}
          <mesh geometry={sphere(0.26, 20)} scale={[1.4, 1, 1]} position={[0.12, 0, 0]} />
        </group>
      </Part>
      {/* pylon */}
      <Part kind="white" layer="engines" system="engines" comp={['pylon', 'engine']} side={side}>
        <mesh geometry={rbox(3.2, 0.9, 0.34, 0.12)} position={[0.8, 1.15, 0]} rotation={[0, 0, -0.06]} />
      </Part>
      <Part kind="accent" color="#a98bff" layer="engines" system="electrical" comp="idg" side={side}>
        <mesh geometry={rbox(0.5, 0.3, 0.32, 0.06)} position={[1.0, -0.82, 0]} />
      </Part>
      <Part kind="accent" color="#ff4d5e" layer="engines" system="hydraulics" comp={side === 1 ? ['greenSystem', 'hydPumps'] : ['yellowSystem', 'hydPumps']} side={side}>
        <mesh geometry={rbox(0.36, 0.24, 0.26, 0.05)} position={[1.6, -0.8, 0]} />
      </Part>
      <mesh ref={flame} geometry={cyl(0.05, 0.55, 2.4, 20)} rotation={[0, 0, Math.PI / 2]} position={[-2.4, 0, 0]}>
        <meshBasicMaterial color="#ffb070" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------ landing gear */
function MainGear({ side }: { side: 1 | -1 }) {
  const rt = useRuntime()
  const leg = useRef<THREE.Group>(null!)
  const wheels = useRef<THREE.Group>(null!)
  const pivot: Vec3 = [AX.mainGearX, 2.2, 3.35 * side]
  useFrame(() => {
    leg.current.rotation.x = (1 - rt.gear) * (Math.PI / 2) * side
    wheels.current.rotation.z = -rt.ground * 1.6
  })
  const heat = (m: THREE.MeshPhysicalMaterial) => { const h = rt.brakeHeat; m.emissive.setRGB(1, 0.35, 0.1); m.emissiveIntensity = h * 2.6 }
  return (
    <group position={pivot}>
      <group ref={leg}>
        <Part kind="metal" layer="gear" system="gear" comp={['mainGear']} side={side}>
          <mesh geometry={cyl(0.11, 0.11, 1.75, 16)} position={[0, -0.85, 0.22 * side]} rotation={[0.25 * side, 0, 0]} />
          <mesh geometry={cyl(0.05, 0.05, 1.3, 10)} position={[-0.35, -0.6, 0.0]} rotation={[0.3 * side, 0, 0.4]} />
        </Part>
        <group position={[0, -1.63, 0.44 * side]}>
          <group ref={wheels}>
            {[0.42, -0.42].map((dz) => (
              <group key={dz} position={[0, 0, dz]}>
                <Part kind="rubber" layer="gear" system="gear" comp={['mainGear', 'wheelsBrakes']} side={side}>
                  <mesh geometry={torus(0.42, 0.17, 28)} />
                </Part>
                <Part kind="steel" layer="gear" system="gear" comp={['wheelsBrakes', 'mainGear']} side={side} onMat={heat}>
                  <mesh geometry={cyl(0.36, 0.36, 0.3, 24)} rotation={[Math.PI / 2, 0, 0]} />
                </Part>
              </group>
            ))}
          </group>
        </group>
      </group>
    </group>
  )
}

function NoseGear() {
  const rt = useRuntime()
  const leg = useRef<THREE.Group>(null!)
  const steer = useRef<THREE.Group>(null!)
  const doors = useRef<THREE.Group[]>([])
  useFrame(() => {
    leg.current.rotation.z = (1 - rt.gear) * (Math.PI / 2)
    steer.current.rotation.y = rt.noseSteer
    const open = rt.gear > 0.02 && rt.gear < 0.98 ? 1 : rt.gear > 0.5 ? 0.8 : 0
    doors.current.forEach((d, i) => { if (d) d.rotation.x = (i ? -1 : 1) * open * 1.3 })
  })
  return (
    <group position={[AX.noseGearX, 1.55, 0]}>
      <group ref={leg}>
        <Part kind="metal" layer="gear" system="gear" comp="noseGear">
          <mesh geometry={cyl(0.08, 0.08, 1.2, 14)} position={[0, -0.6, 0]} />
        </Part>
        <group ref={steer} position={[0, -1.17, 0]}>
          <Part kind="rubber" layer="gear" system="gear" comp="noseGear">
            {[0.24, -0.24].map((dz) => <mesh key={dz} geometry={torus(0.28, 0.11, 24)} position={[0, 0, dz]} />)}
          </Part>
        </group>
      </group>
      {[1, -1].map((s, i) => (
        <group key={s} position={[-0.6, -0.05, 0.42 * s]} ref={(o) => { if (o) doors.current[i] = o }}>
          <Part kind="white" layer="gear" system="gear" comp="noseGear">
            <mesh geometry={rbox(1.6, 0.04, 0.4, 0.02)} position={[0, 0, -0.2 * s]} />
          </Part>
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------ interior */
function Interior() {
  const seatRows = useMemo(() => Array.from({ length: 29 }, (_, i) => 12.0 - i * 0.79), [])
  const seatZ = [1.46, 0.98, 0.5, -0.5, -0.98, -1.46]
  const cushions = useMemo(() => {
    const g = memo('seatC', () => new THREE.BoxGeometry(0.46, 0.14, 0.44))
    return g
  }, [])
  const backs = useMemo(() => memo('seatB', () => new THREE.BoxGeometry(0.1, 0.7, 0.44)), [])
  const cRef = useRef<THREE.InstancedMesh>(null!)
  const bRef = useRef<THREE.InstancedMesh>(null!)
  const wRef = useRef<THREE.InstancedMesh>(null!)
  const winX = useMemo(() => Array.from({ length: 44 }, (_, i) => 12.4 - i * 0.53), [])
  useEffect(() => {
    const m = new THREE.Matrix4()
    let k = 0
    seatRows.forEach((x) => seatZ.forEach((z) => {
      m.makeTranslation(x, AX.floorY + 0.42, z); cRef.current.setMatrixAt(k, m)
      m.makeTranslation(x - 0.24, AX.floorY + 0.8, z); bRef.current.setMatrixAt(k, m)
      k++
    }))
    cRef.current.instanceMatrix.needsUpdate = true; bRef.current.instanceMatrix.needsUpdate = true
    let w = 0
    const q = new THREE.Quaternion()
    winX.forEach((x) => [1, -1].forEach((s) => {
      const zz = Math.sqrt(AX.R * AX.R - 0.35 * 0.35) * s
      q.setFromEuler(new THREE.Euler(0, 0, 0))
      m.compose(new THREE.Vector3(x, AX.axisY + 0.35, zz), q, new THREE.Vector3(1, 1, 1)); wRef.current.setMatrixAt(w++, m)
    }))
    wRef.current.instanceMatrix.needsUpdate = true
  }, [seatRows, winX]) // eslint-disable-line
  const n = 29 * 6
  return (
    <group>
      <Part kind="interior" color="#2f4a6b" layer="cabin" system="cabin" comp={['cabin', 'seats']}>
        <instancedMesh ref={cRef} args={[cushions, undefined, n]} />
        <instancedMesh ref={bRef} args={[backs, undefined, n]} />
      </Part>
      <Part kind="glass" shell layer="fuselage" system="structure" comp="cabin">
        <instancedMesh ref={wRef} args={[rbox(0.26, 0.36, 0.06, 0.08), undefined, winX.length * 2]} />
      </Part>
      <Part kind="interior" color="#3a414a" layer="cabin" system="cabin" comp="cabin" opacity={0.9}>
        <mesh geometry={rbox(25.5, 0.06, 3.6, 0.02)} position={[0.6, AX.floorY, 0]} />
      </Part>
      <Part kind="interior" color="#c9d1d9" layer="cabin" system="cabin" comp="overheadBins" opacity={0.85}>
        {[1, -1].map((s) => <mesh key={s} geometry={rbox(23.0, 0.42, 0.55, 0.08)} position={[0.8, 4.5, 1.22 * s]} />)}
      </Part>
      <Part kind="interior" color="#9aa6b2" layer="cabin" system="cabin" comp="galley">
        <mesh geometry={rbox(0.7, 1.9, 1.5, 0.04)} position={[13.0, AX.floorY + 0.95, -0.95]} />
        <mesh geometry={rbox(0.9, 1.9, 3.0, 0.04)} position={[-11.8, AX.floorY + 0.95, 0]} />
      </Part>
      <Part kind="interior" color="#5f6d7c" layer="cabin" system="cabin" comp="lavatory">
        <mesh geometry={rbox(0.95, 2.0, 0.95, 0.06)} position={[13.0, AX.floorY + 1.0, 1.1]} />
        {[1, -1].map((s) => <mesh key={s} geometry={rbox(0.9, 2.0, 0.9, 0.06)} position={[-10.9, AX.floorY + 1.0, 1.15 * s]} />)}
      </Part>
      {/* doors */}
      <Part kind="accent" color="#e7edf3" layer="fuselage" system="cabin" comp="doors">
        {[[13.6, 1], [13.6, -1], [-11.0, 1], [-11.0, -1], [0.7, 1], [0.7, -1], [-0.1, 1], [-0.1, -1]].map(([x, s], i) => (
          <mesh key={i} geometry={rbox(i < 4 ? 0.85 : 0.5, i < 4 ? 1.85 : 1.0, 0.04, 0.12)} position={[x, i < 4 ? 3.55 : 3.6, (AX.R + 0.01) * s]} />
        ))}
      </Part>
      {/* cockpit */}
      <Part kind="interior" color="#20262d" layer="cockpit" system="cockpit" comp={['cockpit', 'displays']}>
        <mesh geometry={rbox(0.5, 0.55, 2.4, 0.06)} position={[17.1, 3.45, 0]} />
        <mesh geometry={rbox(1.0, 0.35, 0.5, 0.06)} position={[16.3, 3.2, 0]} />
        {[0.55, -0.55].map((z) => <group key={z}><mesh geometry={rbox(0.55, 0.14, 0.5, 0.05)} position={[15.6, 3.25, z]} /><mesh geometry={rbox(0.12, 0.7, 0.5, 0.05)} position={[15.3, 3.6, z]} /></group>)}
      </Part>
      <Part kind="screen" layer="cockpit" system="cockpit" comp="displays" emissive="#4aa3ff" emissiveIntensity={1.1}>
        {[0.95, 0.5, -0.5, -0.95, 0].map((z, i) => <mesh key={i} geometry={rbox(0.03, 0.2, 0.22, 0.01)} position={[16.88, 3.62, z]} rotation={[0, 0, 0.3]} />)}
      </Part>
      <Part kind="accent" color="#f4f7ff" layer="cockpit" system="flightControls" comp="sidestick">
        {[1.05, -1.05].map((z) => <mesh key={z} geometry={cyl(0.025, 0.035, 0.18, 10)} position={[16.1, 3.42, z]} />)}
      </Part>
      <Part kind="glass" shell layer="fuselage" system="cockpit" comp="cockpit">
        {[[17.55, 0.42], [17.55, -0.42], [17.25, 0.95], [17.25, -0.95]].map(([x, z], i) => (
          <mesh key={i} geometry={rbox(0.35, 0.34, 0.62, 0.05)} position={[x, 4.0 - (i > 1 ? 0.05 : 0), z]} rotation={[0, 0, 0.75]} />
        ))}
      </Part>
    </group>
  )
}

/* ------------------------------------------------------------ systems below the floor */
function Systems() {
  const S = (s: Section[]) => s
  const tankSec = (z0: number, z1: number) => span(z0, z1, 3).map((s) => ({ ...s, t: s.t * 0.72 }))
  return (
    <group>
      <Part kind="interior" color="#2b3138" layer="systems" system="cargo" comp={['fwdHold', 'aftHold']} opacity={0.9}>
        <mesh geometry={rbox(5.4, 0.05, 2.6, 0.02)} position={[7.0, AX.holdY - 0.55, 0]} />
        <mesh geometry={rbox(7.6, 0.05, 2.6, 0.02)} position={[-6.4, AX.holdY - 0.55, 0]} />
      </Part>
      <Part kind="accent" color="#c49a6c" layer="systems" system="cargo" comp="fwdHold" opacity={0.92}>
        {[9.0, 7.4, 5.8].map((x) => <mesh key={x} geometry={rbox(1.5, 1.1, 1.5, 0.05)} position={[x, AX.holdY, 0]} />)}
      </Part>
      <Part kind="accent" color="#c49a6c" layer="systems" system="cargo" comp="aftHold" opacity={0.92}>
        {[-4.2, -5.8, -7.4, -9.0].map((x) => <mesh key={x} geometry={rbox(1.5, 1.1, 1.5, 0.05)} position={[x, AX.holdY + 0.05, 0]} />)}
        <mesh geometry={rbox(1.2, 0.7, 1.4, 0.2)} position={[-10.4, 1.9, 0]} />
      </Part>
      {/* fuel: centre tank in the wing box + inner/outer wing tanks */}
      <Part kind="tank" layer="systems" system="fuel" comp={['centerTank', 'fuelTanks']}>
        <mesh geometry={rbox(4.2, 0.75, 3.2, 0.12)} position={[1.2, 2.05, 0]} />
      </Part>
      {[1, -1].map((side) => (
        <group key={side}>
          <Part kind="tank" layer="wings" system="fuel" comp={['wingTanks', 'fuelTanks']} side={side as 1 | -1}>
            <mesh geometry={loft(`tin${side}`, side === 1 ? tankSec(1.8, 8.8) : mirror(tankSec(1.8, 8.8)), { c0: 0.15, c1: 0.62 })} />
          </Part>
          <Part kind="tank" color="#ffb26b" layer="wings" system="fuel" comp={['outerTank', 'fuelTanks']} side={side as 1 | -1}>
            <mesh geometry={loft(`tout${side}`, side === 1 ? tankSec(8.9, 14.4) : mirror(tankSec(8.9, 14.4)), { c0: 0.15, c1: 0.62 })} />
          </Part>
          <Part kind="accent" color="#ff8a3d" layer="systems" system="fuel" comp="fuelPumps" side={side as 1 | -1}>
            {[2.2, 3.0].map((zz) => { const w = wingAt(zz); return <mesh key={zz} geometry={cyl(0.12, 0.12, 0.3, 12)} position={[w.le - w.chord * 0.3, w.y, zz * side]} /> })}
          </Part>
          {/* packs */}
          <Part kind="accent" color="#6cc6ff" layer="systems" system="pneumatics" comp="packs" side={side as 1 | -1} opacity={0.85}>
            <mesh geometry={rbox(2.0, 0.6, 0.8, 0.1)} position={[1.0, 1.45, 0.65 * side]} />
          </Part>
          {/* hydraulic reservoirs */}
          <Part kind="accent" color="#ff4d5e" layer="systems" system="hydraulics" comp={side === 1 ? 'greenSystem' : 'yellowSystem'} side={side as 1 | -1}>
            <mesh geometry={cyl(0.18, 0.18, 0.55, 16)} position={[-2.6, 1.85, 0.75 * side]} rotation={[0, 0, Math.PI / 2]} />
          </Part>
        </group>
      ))}
      <Part kind="accent" color="#ff7b8a" layer="systems" system="hydraulics" comp={['blueSystem', 'ptu']}>
        <mesh geometry={cyl(0.15, 0.15, 0.45, 14)} position={[-3.3, 1.85, 0.75]} rotation={[0, 0, Math.PI / 2]} />
        <mesh geometry={rbox(0.3, 0.3, 0.6, 0.06)} position={[-2.6, 1.7, 0]} />
      </Part>
      <Part kind="accent" color="#6cc6ff" layer="systems" system="pneumatics" comp="mixer">
        <mesh geometry={cyl(0.35, 0.35, 0.9, 18)} position={[4.2, 2.15, 0]} />
      </Part>
      <Part kind="accent" color="#a98bff" layer="systems" system="electrical" comp={['avionics', 'flightComputers', 'batteries']} opacity={0.9}>
        <mesh geometry={rbox(2.2, 0.7, 1.4, 0.08)} position={[13.4, 2.15, 0]} />
      </Part>
      <Part kind="accent" color="#f4f7ff" layer="systems" system="flightControls" comp="flightComputers">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <mesh key={i} geometry={rbox(0.24, 0.42, 0.14, 0.02)} position={[12.6 + i * 0.27, 2.2, 0.45]} />)}
      </Part>
      <Part kind="steel" layer="fuselage" system="pneumatics" comp="outflowValve">
        <mesh geometry={rbox(0.5, 0.4, 0.08, 0.04)} position={[-12.4, 2.25, -1.62]} rotation={[0.6, 0, 0]} />
      </Part>
      <Part kind="accent" color="#a98bff" layer="systems" system="electrical" comp="rat">
        <mesh geometry={cyl(0.06, 0.06, 0.6, 8)} position={[-0.6, 1.25, -1.2]} />
      </Part>
      <Apu />
      {void S}
    </group>
  )
}

function Apu() {
  const rt = useRuntime()
  const g = useRef<THREE.Group>(null!)
  useFrame(() => { g.current.rotation.x += rt.apu * 0.6 })
  const [x, y, z] = AX.apu
  return (
    <group position={[x, y, z]}>
      <Part kind="casing" color="#ffb27a" clip layer="systems" system="apu" comp="apu" opacity={0.45}>
        <mesh geometry={cyl(0.42, 0.36, 1.6, 24)} rotation={[0, 0, Math.PI / 2]} />
      </Part>
      <Part kind="metal" color="#ffcf9e" layer="systems" system="apu" comp="apu">
        <group ref={g}>{Array.from({ length: 8 }, (_, i) => <mesh key={i} geometry={rbox(0.04, 0.55, 0.08, 0.01)} rotation={[(i / 8) * Math.PI, 0, 0]} />)}</group>
      </Part>
    </group>
  )
}

/* ------------------------------------------------------------ clouds (flight scenario) */
function Clouds() {
  const rt = useRuntime()
  const g = useRef<THREE.Group>(null!)
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: glowSprite(), color: '#dfe9f5', transparent: true, opacity: 0, depthWrite: false }), [])
  const puffs = useMemo(() => Array.from({ length: 34 }, () => ({ x: (Math.random() - 0.5) * 240, y: (Math.random() - 0.5) * 50 + 2, z: (Math.random() - 0.5) * 160, s: 18 + Math.random() * 30 })), [])
  const refs = useRef<THREE.Sprite[]>([])
  useFrame((_, dt) => {
    const target = rt.altitude > 25 ? Math.min(0.32, (rt.altitude - 25) / 120) : 0
    mat.opacity = approach(mat.opacity, target, 2, dt)
    g.current.visible = mat.opacity > 0.01
    refs.current.forEach((s, i) => { if (!s) return; s.position.x -= rt.groundSpeed * dt * 0.6; if (s.position.x < -120) s.position.x += 240; void i })
  })
  return (
    <group ref={g}>
      {puffs.map((p, i) => <sprite key={i} ref={(o) => { if (o) refs.current[i] = o }} material={mat} position={[p.x, p.y, p.z]} scale={[p.s, p.s * 0.45, 1]} />)}
    </group>
  )
}

/* ------------------------------------------------------------ root */
export function AircraftModel({ def, showcase = false }: { def: VehicleDef; showcase?: boolean }) {
  const rt = useMemo<Runtime>(() => newRuntime(), [])
  if (!showcase) liveRuntime.current = rt
  const body = useRef<THREE.Group>(null!)
  const phaseT = useRef(0)
  const lastPhase = useRef('gate')
  const fusGeo = useMemo(() => {
    const xs: number[] = []
    for (let x = AX.nose; x > 13.2; x -= 0.22) xs.push(x)
    for (let x = 13.2; x > -8.5; x -= 1.5) xs.push(x)
    for (let x = -8.5; x >= AX.tail; x -= 0.35) xs.push(x)
    xs.push(AX.tail)
    return fuselage('a320', xs, fusR, fusY, 48)
  }, [])
  const fairing = useMemo(() => memo('fairing', () => { const g = new THREE.SphereGeometry(1, 32, 16); g.scale(6.2, 0.9, 2.15); return g }), [])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const sim = getApp().sim
    if (showcase) { rt.n1 = 0.3; rt.n1Angle += dt * 6; rt.gear = 1; return }
    if (sim.phase !== lastPhase.current) { lastPhase.current = sim.phase; phaseT.current = 0 }
    phaseT.current += dt
    const t = phaseT.current
    // targets: user controls at the gate, scripted configuration in flight phases
    let jets = sim.jets, flaps = sim.flaps, slats = sim.slats, spoilers = sim.spoilers, gear = sim.gear
    let gs = 0, pitch = 0, alt = 0, steer = 0, brake = 0, apu = sim.apu ? 1 : 0
    switch (sim.phase) {
      case 'pushback': jets = Math.min(0.24, t * 0.03); gs = -1.6; steer = 0.25; apu = 1; flaps = 0; slats = 0; break
      case 'taxi': jets = 0.28; gs = 7; steer = Math.sin(t * 0.4) * 0.25; flaps = 0.5; slats = 0.6; break
      case 'takeoff': jets = 1; gs = Math.min(78, t * 7); flaps = 0.5; slats = 0.6; pitch = t > 8 ? Math.min(0.2, (t - 8) * 0.08) : 0; alt = t > 9.5 ? (t - 9.5) * (t - 9.5) * 0.9 : 0; gear = t > 12 ? 0 : 1; break
      case 'climb': jets = 0.95; gs = 80; pitch = 0.2; alt = 40 + t * 22; flaps = t > 3 ? 0 : 0.3; slats = t > 6 ? 0 : 0.4; gear = 0; break
      case 'cruise': jets = 0.8; gs = 120; pitch = 0.04; alt = 380; flaps = 0; slats = 0; gear = 0; break
      case 'descent': jets = 0.3; gs = 100; pitch = -0.03; alt = Math.max(60, 300 - t * 20); spoilers = 0.45; flaps = 0; slats = 0; gear = 0; break
      case 'landing': {
        const td = 7
        jets = t < td ? 0.38 : 0.12; gs = t < td ? 70 : Math.max(0, 70 - (t - td) * 9); gear = 1; flaps = 1; slats = 1
        alt = t < td ? Math.max(0, 30 * (1 - t / td)) : 0; pitch = t < td ? 0.05 + (t > td - 2 ? 0.05 : 0) : Math.max(0, 0.1 - (t - td) * 0.1)
        spoilers = t > td ? 1 : 0; brake = t > td + 1 && gs > 0 ? 1 : 0; break
      }
    }
    if (sim.phase !== 'gate') { if (jets > 0.1) apu = Math.max(0, apu - 0) }
    rt.n1 = approach(rt.n1, jets, jets > rt.n1 ? 0.45 : 0.7, dt)
    rt.n1Angle += (rt.n1 * 4 + (rt.n1 > 0.02 ? 0.3 : 0)) * dt * 6
    rt.apu = approach(rt.apu, apu, 0.8, dt)
    rt.flaps = approach(rt.flaps, flaps, 0.9, dt)
    rt.slats = approach(rt.slats, slats, 1.1, dt)
    rt.spoilers = approach(rt.spoilers, spoilers, 3, dt)
    rt.aileron = approach(rt.aileron, sim.aileron, 3, dt)
    rt.elevator = approach(rt.elevator, sim.elevator, 3, dt)
    rt.rudder = approach(rt.rudder, sim.rudder, 3, dt)
    rt.gear = approach(rt.gear, gear, 0.55, dt)
    rt.groundSpeed = approach(rt.groundSpeed, gs, 0.8, dt)
    rt.ground += rt.groundSpeed * dt / 0.57
    rt.pitch = approach(rt.pitch, pitch, 1.4, dt)
    rt.altitude = approach(rt.altitude, alt, 0.9, dt)
    rt.noseSteer = approach(rt.noseSteer, steer, 1.5, dt)
    rt.brakeHeat = Math.max(0, Math.min(1, rt.brakeHeat + (brake || sim.brake) * dt * 0.5 - dt * 0.05))
    body.current.rotation.z = rt.pitch
  })

  return (
    <VehicleCtx.Provider value={{ def, showcase }}>
      <RuntimeCtx.Provider value={rt}>
        {/* rotate about the main-gear contact point, like a real takeoff rotation */}
        <group position={[AX.mainGearX, 0, 0]}>
          <group ref={body}>
            <group position={[-AX.mainGearX, 0, 0]}>
              <Part kind="white" shell clip layer="fuselage" system="structure" comp={['fuselage', 'structure']}>
                <mesh geometry={fusGeo} />
                <mesh geometry={fairing} position={[0.2, 1.55, 0]} />
              </Part>
              <Part kind="accent" color="#2b4f86" layer="fuselage" system="structure" comp="fuselage" opacity={1}>
                <mesh geometry={cyl(0.03, 0.03, 30, 6)} rotation={[0, 0, Math.PI / 2]} position={[0.5, AX.axisY - 0.35, AX.R - 0.02]} />
              </Part>
              <Wing side={1} />
              <Wing side={-1} />
              <Part kind="white" shell layer="tail" system="flightControls" comp={['ths', 'tail']}>
                <mesh geometry={loft('hstabL', HSTAB, { c0: 0, c1: 0.72 })} />
                <mesh geometry={loft('hstabR', mirror(HSTAB), { c0: 0, c1: 0.72 })} />
                <mesh geometry={loft('fin', FIN, { vertical: true, c0: 0, c1: 0.7 })} />
              </Part>
              <Surface id="elevL" sections={HSTAB} c0={0.72} c1={1} hingeC={0.72} side={1} kind="accent" color="#9fd8ff" comp={['elevator']} system="flightControls" layer="tail" drive={(r) => [-r.elevator * 0.42, 0, 0]} />
              <Surface id="elevR" sections={mirror(HSTAB)} c0={0.72} c1={1} hingeC={0.72} side={-1} kind="accent" color="#9fd8ff" comp={['elevator']} system="flightControls" layer="tail" drive={(r) => [-r.elevator * 0.42, 0, 0]} />
              <Surface id="rudder" sections={FIN} c0={0.7} c1={1} hingeC={0.7} side={1} vertical kind="accent" color="#9fd8ff" comp={['rudder']} system="flightControls" layer="tail" drive={(r) => [-r.rudder * 0.45, 0, 0]} />
              <Engine side={1} />
              <Engine side={-1} />
              <MainGear side={1} />
              <MainGear side={-1} />
              <NoseGear />
              <Interior />
              <Systems />
            </group>
          </group>
        </group>
        {!showcase && <Clouds />}
      </RuntimeCtx.Provider>
    </VehicleCtx.Provider>
  )
}
