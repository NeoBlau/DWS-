import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Casing, CUT2, Explode, Flow, PLAY, S, makeMat, ramp, solid, useMat } from '../materials'
import { live, exp } from '../core'
import { between as seg, capsule, cyl, gear, rbox, sphere, spring, torus, tyre } from '../../utils/geom'
import { slab, revolve, hollow, camLobe, crankWeb, bladeRing } from './geometry'
import { CYCLE_OFFSET, IN_PEAK, EX_PEAK, burn, crownY, injecting, phaseOf, pinY, sparking, strokeOf, valveLift, type EngineSpec } from './spec'
import type { Vec3 } from '../../data/types'

/** mechanism state integrated every frame; read by every moving part and published to `live` */
export const MECH = { crank: 0, turbo: 0, cam: 0, input: 0, out: 0, wheel: 0, fan: 0, starter: 0, gearIdx: 0, ratio: 1 }
const TAU = Math.PI * 2

function Mechanism({ s }: { s: EngineSpec }) {
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05) * PLAY.k
    if ((S.extra._lock ?? 0) > 0.5) MECH.crank = S.extra._crank ?? 0
    else MECH.crank += (S.rpm / 60) * TAU * dt
    const user = exp().gear
    MECH.gearIdx = user > 0 ? Math.min(s.gears.length, user) - 1 : Math.round(S.extra.gear ?? 0)
    MECH.ratio = s.gears[MECH.gearIdx] ?? 1
    MECH.input = MECH.crank
    MECH.out += ((S.rpm / 60) * TAU * dt) / MECH.ratio
    MECH.wheel += ((S.rpm / 60) * TAU * dt) / MECH.ratio / 3.7
    MECH.turbo += (S.extra.turboRpm ?? 0.3) * dt * 60
    MECH.fan += (0.4 + S.rpm / 40) * dt * 4
    MECH.starter += (S.extra.starter ?? 0) * dt * 30
    const realRpm = S.extra.realRpm ?? 750
    live.rpm = realRpm * (0.6 + exp().throttle * 1.2)
    live.crank1 = phaseOf(MECH.crank, 0)
    live.stroke1 = strokeOf(live.crank1)
    live.inLift1 = valveLift(live.crank1, false)
    live.inj1 = injecting(s, live.crank1) ? 1 : 0
    live.burn1 = burn(s, live.crank1)
    live.gear = MECH.gearIdx + 1
    live.ratio = MECH.ratio
    live.turboRpm = Math.round(((S.extra.turboRpm ?? 0.3) * 160000) / 1000) * 1000
    live.rail = Math.round(300 + exp().throttle * 1600 + (S.extra.realRpm ?? 750) * 0.05)
  })
  return null
}

/* ------------------------------------------------------------------ engine core */
function Block({ s }: { s: EngineSpec }) {
  const block = useMat({ color: s.paintBlock, metal: 0.55, rough: 0.42, casing: true, comp: 'block' })
  const head = useMat({ color: s.petrol ? '#cdd3d9' : '#c9c3b8', metal: 0.6, rough: 0.38, casing: true, comp: 'head' })
  const cover = useMat({ color: s.cover, metal: 0.3, rough: 0.5, casing: true, comp: 'cover', clear: 0.6 })
  const pan = useMat({ color: '#6f757b', metal: 0.7, rough: 0.35, casing: true, comp: 'oilpan' })
  const liner = useMat({ color: '#9aa3ab', metal: 0.85, rough: 0.25, casing: true, comp: 'block' })
  const oil = useMat({ color: '#c9971f', metal: 0.1, rough: 0.15, opacity: 0.85, emissive: '#5a3a00', emissiveIntensity: 0.4, comp: 'oilpan' })
  const d = s.deck, R = s.R
  const bores = s.cx.map((x) => ({ c: [x, 0] as [number, number], r: R + 0.013 }))
  const g = useMemo(() => ({
    upper: slab(`blk${s.petrol}`, 0.44, 0.27, d - 0.1, bores, 0.02),
    lower: slab(`crk${s.petrol}`, 0.46, 0.29, 0.17, [{ rect: [-0.2, -0.11, 0.2, 0.11], round: 0.03 }], 0.02),
    deckPlate: slab(`hdl${s.petrol}`, 0.44, 0.27, 0.028, s.cx.flatMap((x) => [{ c: [x + 0.018, 0.028] as [number, number], r: 0.016 }, { c: [x - 0.018, 0.028] as [number, number], r: 0.016 }, { c: [x + 0.018, -0.028] as [number, number], r: 0.016 }, { c: [x - 0.018, -0.028] as [number, number], r: 0.016 }, { c: [x, 0] as [number, number], r: 0.009 }]), 0.02),
    carrier: slab(`hdu${s.petrol}`, 0.44, 0.27, 0.075, [{ rect: [-0.205, -0.105, 0.205, 0.105], round: 0.02 }], 0.02),
    cover: slab(`cov${s.petrol}`, 0.42, 0.25, 0.04, [{ rect: [-0.19, -0.1, 0.19, 0.1], round: 0.02 }], 0.03),
    coverTop: slab(`covt${s.petrol}`, 0.42, 0.25, 0.012, s.cx.map((x) => ({ c: [x, 0] as [number, number], r: 0.016 })), 0.03),
    pan: slab(`pan${s.petrol}`, 0.42, 0.25, 0.1, [{ rect: [-0.19, -0.105, 0.19, 0.105], round: 0.02 }], 0.03),
    panBase: slab(`panb${s.petrol}`, 0.42, 0.25, 0.012, [], 0.03),
    liner: hollow(`lin${s.petrol}`, R + 0.006, R, d - 0.12, 40),
  }), [s]) // eslint-disable-line
  return (
    <group>
      <Explode off={[0, -0.03, 0]}>
        <Casing geometry={g.upper} material={block} position={[0, 0.1, 0]} />
        <Casing geometry={g.lower} material={block} position={[0, -0.07, 0]} />
        {s.cx.map((x) => <Casing key={x} geometry={g.liner} material={liner} position={[x, 0.1 + (d - 0.12) / 2 + 0.01, 0]} rotation={[0, 0, Math.PI / 2]} cap="#cf6b2e" />)}
      </Explode>
      <Explode off={[0, 0.26, 0]}>
        <Casing geometry={g.deckPlate} material={head} position={[0, d, 0]} />
        <Casing geometry={g.carrier} material={head} position={[0, d + 0.028, 0]} />
      </Explode>
      <Explode off={[0, 0.5, 0]}>
        <Casing geometry={g.cover} material={cover} position={[0, d + 0.103, 0]} cap="#b35a26" />
        <Casing geometry={g.coverTop} material={cover} position={[0, d + 0.143, 0]} cap="#b35a26" />
      </Explode>
      <Explode off={[0, -0.32, 0]}>
        <Casing geometry={g.pan} material={pan} position={[0, -0.17, 0]} />
        <Casing geometry={g.panBase} material={pan} position={[0, -0.182, 0]} />
        <mesh material={oil} position={[0, -0.145, 0]}><boxGeometry args={[0.37, 0.05, 0.2]} /></mesh>
      </Explode>
    </group>
  )
}

function Crank({ s }: { s: EngineSpec }) {
  const steel = useMat({ color: '#d4dbe2', metal: 0.95, rough: 0.2, comp: 'crank' })
  const rodM = useMat({ color: '#8d969e', metal: 0.85, rough: 0.3, comp: 'rod' })
  const pistonM = useMat({ color: '#d3d6d9', metal: 0.8, rough: 0.28, comp: 'piston' })
  const ringM = useMat({ color: '#5d646b', metal: 0.9, rough: 0.3, comp: 'piston' })
  const bowlM = useMat({ color: '#7e858b', metal: 0.6, rough: 0.5, comp: 'piston' })
  const fly = useMat({ color: '#9aa1a8', metal: 0.9, rough: 0.3, comp: 'flywheel' })
  const crank = useRef<THREE.Group>(null!)
  const pistons = useRef<THREE.Group[]>([])
  const rods = useRef<THREE.Group[]>([])
  const flyRef = useRef<THREE.Group>(null!)
  const phase = [0, Math.PI, Math.PI, 0]
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const a = MECH.crank
    crank.current.rotation.x = -a
    flyRef.current.rotation.x = -a
    s.cx.forEach((_, i) => {
      const al = a + phase[i]
      const py = pinY(s, al)
      pistons.current[i]?.position.set(0, py, 0)
      const pinYc = s.r * Math.cos(al), pinZ = -s.r * Math.sin(al)
      const rd = rods.current[i]
      if (rd) { v.set(0, py - pinYc, -pinZ).normalize(); rd.quaternion.setFromUnitVectors(up, v); rd.position.set(0, pinYc, pinZ) }
    })
  })
  const web = crankWeb(s.r, 0.016)
  return (
    <Explode off={[0, -0.2, 0.18]}>
      <group ref={crank}>
        <mesh geometry={cyl(0.026, 0.026, 0.56, 24)} rotation={[0, 0, Math.PI / 2]} material={steel} />
        {s.cx.map((x, i) => (
          <group key={x} position={[x, 0, 0]} rotation={[phase[i], 0, 0]}>
            <mesh geometry={web} position={[0.03, 0, 0]} material={steel} />
            <mesh geometry={web} position={[-0.03, 0, 0]} material={steel} />
            <mesh geometry={cyl(0.024, 0.024, 0.05, 20)} rotation={[0, 0, Math.PI / 2]} position={[0, s.r, 0]} material={steel} />
          </group>
        ))}
      </group>
      <group ref={flyRef} position={[-0.29, 0, 0]}>
        <mesh geometry={cyl(0.15, 0.15, 0.03, 48)} rotation={[0, 0, Math.PI / 2]} material={fly} />
        <mesh geometry={gear(96, 0.155, 0.02, 0.008, 0.12)} rotation={[0, Math.PI / 2, 0]} material={fly} />
      </group>
      {s.cx.map((x, i) => (
        <group key={x} position={[x, 0, 0]}>
          <Explode off={[0, 0.12, 0.12]} delay={0.1}>
            <group ref={(o) => { if (o) pistons.current[i] = o }}>
              <mesh geometry={cyl(s.R - 0.0015, s.R - 0.0015, 0.075, 40)} position={[0, 0.018, 0]} material={pistonM} />
              {[0.045, 0.036, 0.027].map((y) => <mesh key={y} geometry={torus(s.R - 0.001, 0.0022, 40)} rotation={[Math.PI / 2, 0, 0]} position={[0, y, 0]} material={ringM} />)}
              {!s.petrol && <mesh geometry={sphere(0.024, 20)} scale={[1, 0.28, 1]} position={[0, 0.056, 0]} material={bowlM} />}
              <mesh geometry={cyl(0.011, 0.011, 0.06, 12)} rotation={[Math.PI / 2, 0, 0]} material={steel} />
            </group>
            <group ref={(o) => { if (o) rods.current[i] = o }}>
              <mesh geometry={rbox(0.014, s.rod, 0.02, 0.004)} position={[0, s.rod / 2, 0]} material={rodM} />
              <mesh geometry={torus(0.03, 0.009, 20)} rotation={[0, Math.PI / 2, 0]} material={rodM} />
              <mesh geometry={torus(0.016, 0.006, 16)} rotation={[0, Math.PI / 2, 0]} position={[0, s.rod, 0]} material={rodM} />
            </group>
          </Explode>
        </group>
      ))}
    </Explode>
  )
}

/** valvetrain: two camshafts with real lobes driving 16 valves with springs */
function Valvetrain({ s }: { s: EngineSpec }) {
  const steel = useMat({ color: '#e1e6eb', metal: 0.95, rough: 0.18, comp: 'cam' })
  const inV = useMat({ color: '#9fd3ff', metal: 0.8, rough: 0.25, comp: 'valves', emissive: '#2a6ea8', emissiveIntensity: 0.25 })
  const exV = useMat({ color: '#ffb08a', metal: 0.8, rough: 0.25, comp: 'valves', emissive: '#a8452a', emissiveIntensity: 0.25 })
  const springM = useMat({ color: '#7fc8ff', metal: 0.6, rough: 0.35, comp: 'valves' })
  const sprocket = useMat({ color: '#adb4bb', metal: 0.9, rough: 0.3, comp: 'chain' })
  const d = s.deck, camY = d + 0.075, lobeH = 0.012
  const lobe = camLobe(0.012, 0.009, 0.012)
  const valves = useRef<{ g: THREE.Group; sp: THREE.Mesh; i: number; ex: boolean }[]>([])
  const lobes = useRef<{ g: THREE.Group; i: number; ex: boolean }[]>([])
  const shafts = useRef<THREE.Group[]>([])
  useFrame(() => {
    valves.current.forEach((v) => {
      const lift = valveLift(phaseOf(MECH.crank, v.i), v.ex) * 0.009
      v.g.position.y = -lift
      v.sp.scale.y = 1 - (lift / 0.009) * 0.3
    })
    lobes.current.forEach((l) => { l.g.rotation.x = (phaseOf(MECH.crank, l.i) - (l.ex ? EX_PEAK : IN_PEAK)) / 2 })
    shafts.current.forEach((g) => { g.rotation.x = MECH.crank / 2 })
  })
  const rows: { ex: boolean; z: number }[] = [{ ex: false, z: 0.032 }, { ex: true, z: -0.032 }]
  return (
    <Explode off={[0, 0.36, 0]}>
      {rows.map((row) => (
        <group key={String(row.ex)}>
          <group position={[0, camY, row.z]} ref={(o) => { if (o && !shafts.current.includes(o)) shafts.current.push(o) }}>
            <mesh geometry={cyl(0.009, 0.009, 0.46, 14)} rotation={[0, 0, Math.PI / 2]} material={steel} />
          </group>
          <group position={[0.235, camY, row.z]} ref={(o) => { if (o && !shafts.current.includes(o)) shafts.current.push(o) }}>
            <mesh geometry={gear(22, 0.032, 0.01, 0.005, 0.01)} rotation={[0, Math.PI / 2, 0]} material={sprocket} />
          </group>
          {s.cx.map((x, i) => [x + 0.018, x - 0.018].map((vx, k) => (
            <group key={`${i}${k}`}>
              <group position={[vx, camY, row.z]} ref={(o) => { if (o && !lobes.current.find((l) => l.g === o)) lobes.current.push({ g: o, i, ex: row.ex }) }}>
                <mesh geometry={lobe} material={steel} />
              </group>
              <group position={[vx, 0, row.z * 0.9]} ref={(o) => { if (o && !valves.current.find((q) => q.g === o)) { const sp = o.getObjectByName('spring') as THREE.Mesh; valves.current.push({ g: o, sp, i, ex: row.ex }) } }}>
                <mesh geometry={cyl(0.0145, 0.004, 0.006, 24)} position={[0, d + 0.003, 0]} material={row.ex ? exV : inV} />
                <mesh geometry={cyl(0.0032, 0.0032, 0.064, 8)} position={[0, d + 0.035, 0]} material={row.ex ? exV : inV} />
                <mesh name="spring" geometry={spring(0.0085, 0.032, 5, 0.0013)} position={[0, d + 0.05, 0]} material={springM} />
                <mesh geometry={cyl(0.01, 0.01, 0.004, 14)} position={[0, d + 0.067 - lobeH * 0, 0]} material={steel} />
              </group>
            </group>
          )))}
        </group>
      ))}
    </Explode>
  )
}

/** timing chain: links travel round crank + cam sprockets */
function TimingChain({ s }: { s: EngineSpec }) {
  const m = useMat({ color: '#6b7178', metal: 0.9, rough: 0.35, comp: 'chain' })
  const sprocket = useMat({ color: '#adb4bb', metal: 0.9, rough: 0.3, comp: 'chain' })
  const d = s.deck, camY = d + 0.075
  const path = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.235, -0.024, 0.0), new THREE.Vector3(0.235, 0.0, 0.03), new THREE.Vector3(0.235, camY - 0.02, 0.066),
    new THREE.Vector3(0.235, camY + 0.03, 0.035), new THREE.Vector3(0.235, camY + 0.026, -0.03), new THREE.Vector3(0.235, camY - 0.02, -0.066),
    new THREE.Vector3(0.235, 0.0, -0.03),
  ], true, 'catmullrom', 0.5), [camY])
  const N = 64
  const inst = useRef<THREE.InstancedMesh>(null!)
  const crankSp = useRef<THREE.Group>(null!)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(() => {
    const off = (MECH.crank * 0.024) / path.getLength()
    for (let i = 0; i < N; i++) {
      const u = (((i / N + off) % 1) + 1) % 1
      const p = path.getPointAt(u), tg = path.getTangentAt(u)
      dummy.position.copy(p); dummy.lookAt(p.clone().add(tg)); dummy.updateMatrix()
      inst.current.setMatrixAt(i, dummy.matrix)
    }
    inst.current.instanceMatrix.needsUpdate = true
    crankSp.current.rotation.x = -MECH.crank
  })
  return (
    <Explode off={[0.22, 0.05, 0]}>
      <instancedMesh ref={inst} args={[rbox(0.006, 0.004, 0.01, 0.001), m, N]} />
      <group ref={crankSp} position={[0.235, 0, 0]}><mesh geometry={gear(18, 0.024, 0.01, 0.005, 0.008)} rotation={[0, Math.PI / 2, 0]} material={sprocket} /></group>
    </Explode>
  )
}

/* ------------------------------------------------------------------ fuel injection + combustion */
function Injection({ s }: { s: EngineSpec }) {
  const inj = useMat({ color: s.petrol ? '#d9dee3' : '#e2c48c', metal: 0.85, rough: 0.25, comp: 'injector' })
  const sol = useMat({ color: '#30353b', metal: 0.4, rough: 0.5, comp: 'injector' })
  const railM = useMat({ color: '#cbd1d6', metal: 0.95, rough: 0.2, comp: 'rail' })
  const plug = useMat({ color: '#efe9dc', metal: 0.2, rough: 0.4, comp: 'plug' })
  const glowPlug = useMat({ color: '#d77a4e', metal: 0.6, rough: 0.4, comp: 'glow', emissive: '#ff5a1e', emissiveIntensity: 0 })
  const flames = useRef<THREE.Mesh[]>([])
  const sparks = useRef<THREE.Mesh[]>([])
  const tips = useRef<THREE.MeshBasicMaterial[]>([])
  const light = useRef<THREE.PointLight>(null!)
  const flameMat = useMemo(() => s.cx.map(() => new THREE.MeshBasicMaterial({ color: s.petrol ? '#ffc070' : '#ff8a3d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })), [s])
  const d = s.deck
  useFrame(() => {
    let best = 0, bx = 0
    s.cx.forEach((x, i) => {
      const phi = phaseOf(MECH.crank, i)
      const b = burn(s, phi)
      flameMat[i].opacity = b * 0.9
      const f = flames.current[i]
      if (f) { f.visible = b > 0.01; const top = crownY(s, phi); const h = Math.max(0.004, d - top); f.scale.set(1, h / 0.02, 1); f.position.y = top + h / 2 }
      if (b > best) { best = b; bx = x }
      const sp = sparks.current[i]
      if (sp) sp.visible = s.petrol && sparking(phi) && S.rpm > 0.5
      const tm = tips.current[i]
      if (tm) tm.opacity = injecting(s, phi) && S.rpm > 0.5 ? 1 : 0
    })
    light.current.intensity = best * 1.6
    light.current.position.x = bx
    glowPlug.emissiveIntensity = S.extra.glow ?? 0
  })
  return (
    <group>
      <Explode off={[0, 0.62, 0.05]}>
        {s.cx.map((x, i) => (
          <group key={x} position={[x, 0, 0]}>
            {s.petrol ? (
              <>
                <mesh geometry={cyl(0.006, 0.0045, 0.075, 12)} position={[-0.0, d + 0.02, 0.045]} rotation={[-0.75, 0, 0]} material={inj} />
                <mesh geometry={cyl(0.008, 0.008, 0.11, 14)} position={[0, d + 0.07, 0]} material={plug} />
                <mesh geometry={rbox(0.022, 0.05, 0.022, 0.004)} position={[0, d + 0.15, 0]} material={sol} />
              </>
            ) : (
              <>
                <mesh geometry={cyl(0.0075, 0.005, 0.15, 14)} position={[0, d + 0.075, 0]} material={inj} />
                <mesh geometry={cyl(0.011, 0.011, 0.035, 14)} position={[0, d + 0.165, 0]} material={sol} />
                <mesh geometry={cyl(0.0035, 0.0035, 0.07, 8)} position={[0.022, d + 0.03, 0.05]} rotation={[-0.6, 0, 0.2]} material={glowPlug} />
              </>
            )}
            <mesh ref={(o) => { if (o) sparks.current[i] = o }} position={[0, d - 0.002, 0]} visible={false}>
              <sphereGeometry args={[0.009, 12, 8]} />
              <meshBasicMaterial color="#e8f3ff" toneMapped={false} />
            </mesh>
            <mesh position={s.petrol ? [0, d - 0.006, 0.03] : [0, d - 0.003, 0]}>
              <sphereGeometry args={[0.004, 10, 8]} />
              <meshBasicMaterial ref={(o) => { if (o) tips.current[i] = o }} color="#ffb070" transparent opacity={0} toneMapped={false} />
            </mesh>
          </group>
        ))}
        {s.petrol
          ? <mesh geometry={cyl(0.011, 0.011, 0.4, 16)} rotation={[0, 0, Math.PI / 2]} position={[0, d + 0.06, 0.085]} material={railM} />
          : <mesh geometry={cyl(0.013, 0.013, 0.42, 18)} rotation={[0, 0, Math.PI / 2]} position={[0, d + 0.2, 0.07]} material={railM} />}
        {!s.petrol && s.cx.map((x) => { const b = seg([x, d + 0.2, 0.07], [x, d + 0.18, 0.01]); return <mesh key={x} geometry={cyl(0.003, 0.003, b.length, 8)} position={b.position} quaternion={b.quaternion} material={railM} /> })}
      </Explode>
      {s.cx.map((x, i) => (
        <mesh key={x} ref={(o) => { if (o) flames.current[i] = o }} position={[x, d, 0]} material={flameMat[i]} visible={false}>
          <cylinderGeometry args={[s.R - 0.002, s.R - 0.002, 0.02, 32]} />
        </mesh>
      ))}
      <pointLight ref={light} position={[0, d - 0.02, 0.05]} color="#ff9a4a" distance={0.6} intensity={0} />
    </group>
  )
}

/* ------------------------------------------------------------------ manifolds, turbo, intercooler, ancillaries */
function Turbo({ s }: { s: EngineSpec }) {
  const hot = useMat({ color: '#8b6d5c', metal: 0.75, rough: 0.45, casing: true, comp: 'turbo', plane: CUT2, noXray: true })
  const cold = useMat({ color: '#d7dbde', metal: 0.75, rough: 0.3, casing: true, comp: 'turbo', plane: CUT2, noXray: true })
  const center = useMat({ color: '#9aa1a8', metal: 0.8, rough: 0.35, casing: true, comp: 'turbo', plane: CUT2, noXray: true })
  const tWheel = useMat({ color: '#c7a07f', metal: 0.9, rough: 0.25, comp: 'turbine' })
  const cWheel = useMat({ color: '#edf1f4', metal: 0.95, rough: 0.18, comp: 'compressor' })
  const shaft = useMat({ color: '#f2f5f7', metal: 1, rough: 0.15, comp: 'shaftT' })
  const vane = useMat({ color: '#b48a6a', metal: 0.8, rough: 0.35, comp: 'vnt' })
  const tw = useRef<THREE.Group>(null!), cw = useRef<THREE.Group>(null!), vanes = useRef<THREE.Group[]>([])
  const [x, y, z] = s.turbo
  useFrame(() => {
    tw.current.rotation.x = MECH.turbo; cw.current.rotation.x = MECH.turbo
    const open = 0.2 + (S.extra.turboRpm ?? 0.3) * 0.9
    vanes.current.forEach((v) => { v.rotation.x = 0.9 - open * 0.8 })
    const k = S.extra.turboCut ?? 0
    // CUT2 faces +z: removes the back half of the turbo so it reads from behind the engine
    CUT2.constant = k < 0.01 ? 50 : -(z - (1 - Math.pow(k, 0.6)) * 0.4)
  })
  const volT = useMemo(() => revolve('volT', [[-0.03, 0.035], [-0.05, 0.07], [-0.02, 0.1], [0.02, 0.095], [0.035, 0.06], [0.03, 0.035], [-0.03, 0.035]], 48), [])
  const volC = useMemo(() => revolve('volC', [[-0.035, 0.04], [-0.04, 0.085], [-0.01, 0.112], [0.03, 0.1], [0.045, 0.06], [0.06, 0.042], [0.06, 0.032], [-0.035, 0.04]], 48), [])
  const core = useMemo(() => hollow('tcore', 0.045, 0.012, 0.07, 36), [])
  return (
    <Explode off={[0, 0.12, -0.38]}>
      <group position={[x, y, z]}>
        <Casing geometry={volT} material={hot} position={[-0.08, 0, 0]} plane={CUT2} />
        <Casing geometry={core} material={center} position={[0, 0, 0]} plane={CUT2} cap="#cf6b2e" />
        <Casing geometry={volC} material={cold} position={[0.085, 0, 0]} plane={CUT2} />
        <mesh geometry={cyl(0.006, 0.006, 0.2, 10)} rotation={[0, 0, Math.PI / 2]} material={shaft} />
        <group ref={tw} position={[-0.08, 0, 0]}>
          <mesh geometry={bladeRing('turbW', 11, 0.012, 0.042, 0.03, 0.0025, 0.55)} material={tWheel} />
          <mesh geometry={cyl(0.014, 0.008, 0.035, 18)} rotation={[0, 0, Math.PI / 2]} material={tWheel} />
        </group>
        <group ref={cw} position={[0.085, 0, 0]}>
          <mesh geometry={bladeRing('compW', 12, 0.012, 0.05, 0.034, 0.0022, -0.6)} material={cWheel} />
          <mesh geometry={cyl(0.008, 0.016, 0.04, 18)} rotation={[0, 0, Math.PI / 2]} material={cWheel} />
        </group>
        {!s.petrol && Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2
          return (
            <group key={i} position={[-0.08, Math.cos(a) * 0.056, Math.sin(a) * 0.056]} rotation={[a, 0, 0]}>
              <group ref={(o) => { if (o) vanes.current[i] = o }}><mesh geometry={rbox(0.022, 0.003, 0.012, 0.001)} material={vane} /></group>
            </group>
          )
        })}
      </group>
    </Explode>
  )
}

function Manifolds({ s }: { s: EngineSpec }) {
  const intake = useMat({ color: s.petrol ? '#2b3036' : '#3a3632', metal: 0.3, rough: 0.55, casing: true, comp: 'intake' })
  const exh = useMat({ color: '#7b5f52', metal: 0.75, rough: 0.5, casing: false, comp: 'exhaustManifold' })
  const d = s.deck
  const plenum = useMemo(() => slab(`plen${s.petrol}`, 0.4, 0.06, 0.07, [{ rect: [-0.185, -0.022, 0.185, 0.022], round: 0.015 }], 0.02), [s])
  return (
    <group>
      <Explode off={[0, 0.05, 0.3]}>
        <Casing geometry={plenum} material={intake} position={[0, d + 0.005, 0.175]} />
      </Explode>
      <Explode off={[0, 0.0, -0.22]}>
        <mesh geometry={rbox(0.36, 0.034, 0.034, 0.014)} position={[0, d + 0.025, -0.16]} material={exh} />
        {s.cx.map((x) => <mesh key={x} geometry={rbox(0.026, 0.026, 0.06, 0.01)} position={[x, d + 0.025, -0.125]} material={exh} />)}
        {(() => { const b = seg([-0.06, d + 0.025, -0.17], [s.turbo[0] - 0.06, s.turbo[1] + 0.05, s.turbo[2] + 0.02]); return <mesh geometry={cyl(0.017, 0.017, b.length, 12)} position={b.position} quaternion={b.quaternion} material={exh} /> })()}
      </Explode>
    </group>
  )
}

function Ancillaries({ s }: { s: EngineSpec }) {
  const alu = useMat({ color: '#c3c7cb', metal: 0.8, rough: 0.35, comp: 'aux' })
  const core = useMat({ color: '#d0d4d8', metal: 0.7, rough: 0.4, casing: true, comp: 'intercooler' })
  const rad = useMat({ color: '#9fb0a6', metal: 0.6, rough: 0.45, casing: true, comp: 'radiator' })
  const filterM = useMat({ color: '#3a4652', metal: 0.4, rough: 0.5, casing: true, comp: 'filter' })
  const elem = useMat({ color: '#e7dcc3', metal: 0, rough: 0.9, comp: 'filter' })
  const pump = useMat({ color: '#a9b0b7', metal: 0.85, rough: 0.3, casing: true, comp: 'hpPump' })
  const plunger = useMat({ color: '#f0f3f5', metal: 1, rough: 0.15, comp: 'hpPump' })
  const wp = useMat({ color: '#64c9a1', metal: 0.7, rough: 0.3, comp: 'waterPump' })
  const op = useMat({ color: '#e0b84a', metal: 0.8, rough: 0.3, comp: 'oilPump' })
  const batt = useMat({ color: '#25292e', metal: 0.2, rough: 0.6, comp: 'battery' })
  const battTop = useMat({ color: '#a98bff', metal: 0.3, rough: 0.4, comp: 'battery', emissive: '#6b4fd1', emissiveIntensity: 0.3 })
  const starterM = useMat({ color: '#8f8a9e', metal: 0.7, rough: 0.35, comp: 'starter' })
  const airbox = useMat({ color: '#2f3338', metal: 0.2, rough: 0.6, casing: true, comp: 'airFilter' })
  const fanM = useMat({ color: '#2a2e33', metal: 0.3, rough: 0.5, comp: 'radiator' })
  const plg = useRef<THREE.Mesh>(null!)
  const wpi = useRef<THREE.Group>(null!), opg = useRef<THREE.Group[]>([]), fan = useRef<THREE.Group>(null!), pin = useRef<THREE.Group>(null!)
  useFrame(() => {
    plg.current.position.y = 0.11 + Math.sin(MECH.crank * 1.5) * 0.008
    wpi.current.rotation.x = -MECH.crank * 1.2
    opg.current.forEach((g, i) => { g.rotation.x = (i ? 1 : -1) * MECH.crank })
    fan.current.rotation.x = MECH.fan
    pin.current.rotation.x = MECH.starter
    pin.current.position.x = -0.27 + (S.extra.starter ?? 0) * 0.012
  })
  const icCore = useMemo(() => slab('ic', 0.05, 0.62, 0.24, Array.from({ length: 9 }, (_, i) => ({ rect: [-0.018, -0.29 + i * 0.066, 0.018, -0.29 + i * 0.066 + 0.044] as [number, number, number, number], round: 0.004 })), 0.006), [])
  const radCore = useMemo(() => slab('rad', 0.045, 0.66, 0.32, Array.from({ length: 10 }, (_, i) => ({ rect: [-0.015, -0.31 + i * 0.063, 0.015, -0.31 + i * 0.063 + 0.04] as [number, number, number, number], round: 0.004 })), 0.006), [])
  const can = useMemo(() => hollow('fcan', 0.042, 0.036, 0.15, 36), [])
  const pumpBody = useMemo(() => hollow('hpp', 0.032, 0.014, 0.09, 30), [])
  const abox = useMemo(() => slab('abox', 0.28, 0.2, 0.14, [{ rect: [-0.12, -0.08, 0.12, 0.08], round: 0.02 }], 0.03), [])
  return (
    <group>
      <Explode off={[0.45, 0, 0]}>
        <Casing geometry={icCore} material={core} position={[0.86, -0.08, 0]} />
        <Casing geometry={radCore} material={rad} position={[0.79, -0.12, 0]} />
        <group ref={fan} position={[0.73, 0.04, 0]}>
          {Array.from({ length: 7 }, (_, i) => <mesh key={i} geometry={rbox(0.006, 0.14, 0.05, 0.004)} rotation={[(i / 7) * Math.PI * 2, 0.3, 0]} position={[0, Math.cos((i / 7) * Math.PI * 2) * 0.075, Math.sin((i / 7) * Math.PI * 2) * 0.075]} material={fanM} />)}
          <mesh geometry={cyl(0.03, 0.03, 0.03, 16)} rotation={[0, 0, Math.PI / 2]} material={fanM} />
        </group>
      </Explode>
      <Explode off={[0.3, 0.2, 0.25]}>
        <Casing geometry={abox} material={airbox} position={[0.56, 0.24, 0.3]} />
        <Casing geometry={can} material={filterM} position={[0.48, 0.03, 0.33]} rotation={[0, 0, Math.PI / 2]} />
        {Array.from({ length: 10 }, (_, i) => <mesh key={i} geometry={rbox(0.004, 0.11, 0.02, 0.001)} rotation={[0, (i / 10) * Math.PI, 0]} position={[0.48, 0.03, 0.33]} material={elem} />)}
      </Explode>
      <Explode off={[0.25, 0.0, 0.2]}>
        <Casing geometry={pumpBody} material={pump} position={[0.3, 0.11, 0.13]} rotation={[0, 0, Math.PI / 2]} />
        <mesh ref={plg} geometry={cyl(0.008, 0.008, 0.06, 12)} position={[0.3, 0.11, 0.13]} material={plunger} />
        <group ref={wpi} position={[0.26, 0.04, -0.02]}>{Array.from({ length: 8 }, (_, i) => <mesh key={i} geometry={rbox(0.004, 0.03, 0.012, 0.001)} rotation={[(i / 8) * Math.PI * 2, 0, 0]} position={[0, Math.cos((i / 8) * Math.PI * 2) * 0.016, Math.sin((i / 8) * Math.PI * 2) * 0.016]} material={wp} />)}</group>
        {[[-0.1, 0.012], [-0.1, -0.022]].map(([y, z], i) => (
          <group key={i} position={[0.26, y, z]} ref={(o) => { if (o) opg.current[i] = o }}><mesh geometry={gear(12, 0.016, 0.014, 0.004, 0.004)} rotation={[0, Math.PI / 2, 0]} material={op} /></group>
        ))}
        <mesh geometry={cyl(0.04, 0.04, 0.09, 20)} rotation={[0, 0, Math.PI / 2]} position={[0.3, 0.2, 0.2]} material={alu} />
      </Explode>
      <Explode off={[0.0, 0.25, -0.2]}>
        <mesh geometry={rbox(0.26, 0.18, 0.17, 0.012)} position={s.battery} material={batt} />
        <mesh geometry={rbox(0.24, 0.012, 0.15, 0.004)} position={[s.battery[0], s.battery[1] + 0.095, s.battery[2]]} material={battTop} />
      </Explode>
      <Explode off={[-0.1, -0.1, -0.2]}>
        <mesh geometry={cyl(0.035, 0.035, 0.15, 18)} rotation={[0, 0, Math.PI / 2]} position={[-0.2, -0.08, -0.13]} material={starterM} />
        <group ref={pin} position={[-0.27, -0.08, -0.13]}><mesh geometry={gear(10, 0.012, 0.016, 0.004, 0.003)} rotation={[0, Math.PI / 2, 0]} material={starterM} /></group>
      </Explode>
    </group>
  )
}

/* ------------------------------------------------------------------ drivetrain */
function Gearbox({ s }: { s: EngineSpec }) {
  const caseM = useMat({ color: '#b5ada2', metal: 0.6, rough: 0.4, casing: true, comp: 'gearbox' })
  const gm = useMat({ color: '#c3ccd5', metal: 0.9, rough: 0.25, comp: 'gearbox' })
  const sh = useMat({ color: '#e9edf1', metal: 1, rough: 0.15, comp: 'gearbox' })
  const tcM = useMat({ color: '#d7b48e', metal: 0.8, rough: 0.3, comp: 'gearbox' })
  const n = s.gears.length
  const D = 0.12, yIn = 0.05, yOut = -0.07
  const x0 = -0.47, step = n > 6 ? 0.06 : 0.08
  const pairs = useMemo(() => s.gears.map((r, k) => { const a = D / (1 + r); return { a, b: D - a, x: x0 - k * step, r } }), [s]) // eslint-disable-line
  const engaged = useMemo(() => s.gears.map(() => new THREE.MeshPhysicalMaterial({ color: '#ffcf8a', metalness: 0.85, roughness: 0.25, emissive: '#ff9a3d', emissiveIntensity: 0.6 })), [s])
  const inRef = useRef<THREE.Group>(null!), outRef = useRef<THREE.Group>(null!), driven = useRef<THREE.Group[]>([]), collar = useRef<THREE.Mesh>(null!), tc = useRef<THREE.Group>(null!)
  const meshes = useRef<THREE.Mesh[][]>([])
  useFrame(() => {
    inRef.current.rotation.x = -MECH.input
    tc.current.rotation.x = -MECH.input
    outRef.current.rotation.x = MECH.out
    pairs.forEach((p, k) => { const g = driven.current[k]; if (g) g.rotation.x = (MECH.input * p.a) / p.b })
    const p = pairs[MECH.gearIdx]
    if (p) collar.current.position.x += (p.x - 0.03 - collar.current.position.x) * 0.15
    meshes.current.forEach((ms, k) => ms.forEach((m) => { if (m) m.material = k === MECH.gearIdx ? engaged[k] : gm }))
  })
  const housing = useMemo(() => revolve(`gbx${n}`, [[-0.3, 0.17], [-0.3, 0.215], [-0.44, 0.215], [-0.5, 0.165], [x0 - n * step - 0.02, 0.15], [x0 - n * step - 0.08, 0.09], [x0 - n * step - 0.08, 0.075], [x0 - n * step - 0.02, 0.135], [-0.5, 0.15], [-0.44, 0.2], [-0.3, 0.17]].map(([x, r]) => [x, r] as [number, number]), 56), [n]) // eslint-disable-line
  const end = x0 - n * step - 0.1
  return (
    <Explode off={[-0.35, -0.05, 0.25]}>
      <Casing geometry={housing} material={caseM} />
      <group ref={tc} position={[-0.37, 0, 0]}>
        <mesh geometry={torus(0.12, 0.04, 40)} rotation={[0, Math.PI / 2, 0]} material={tcM} />
        {Array.from({ length: 16 }, (_, i) => <mesh key={i} geometry={rbox(0.008, 0.06, 0.03, 0.002)} rotation={[(i / 16) * Math.PI * 2, 0, 0]} position={[0, Math.cos((i / 16) * Math.PI * 2) * 0.12, Math.sin((i / 16) * Math.PI * 2) * 0.12]} material={tcM} />)}
      </group>
      <group ref={inRef} position={[0, yIn, 0]}>
        <mesh geometry={cyl(0.012, 0.012, Math.abs(end) - 0.3, 14)} rotation={[0, 0, Math.PI / 2]} position={[(end - 0.3) / 2 + 0.08, 0, 0]} material={sh} />
        {pairs.map((p, k) => <mesh key={k} ref={(o) => { if (o) { (meshes.current[k] ||= [])[0] = o } }} geometry={gear(Math.max(9, Math.round(p.a * 420)), p.a - 0.004, 0.022, 0.007, 0.01)} rotation={[0, Math.PI / 2, 0]} position={[p.x, 0, 0]} material={gm} />)}
      </group>
      {pairs.map((p, k) => (
        <group key={k} position={[p.x, yOut, 0]} ref={(o) => { if (o) driven.current[k] = o }}>
          <mesh ref={(o) => { if (o) { (meshes.current[k] ||= [])[1] = o } }} geometry={gear(Math.max(9, Math.round(p.b * 420)), p.b - 0.004, 0.022, 0.007, 0.012)} rotation={[0, Math.PI / 2, 0]} material={gm} />
        </group>
      ))}
      <group ref={outRef} position={[0, yOut, 0]}>
        <mesh geometry={cyl(0.013, 0.013, Math.abs(end) - 0.4, 14)} rotation={[0, 0, Math.PI / 2]} position={[(end - 0.42) / 2, 0, 0]} material={sh} />
      </group>
      <mesh ref={collar} geometry={cyl(0.024, 0.024, 0.02, 20)} rotation={[0, 0, Math.PI / 2]} position={[x0 - 0.03, yOut, 0]} material={engaged[0]} />
    </Explode>
  )
}

function Shaft({ a, b, r, rate, comp }: { a: Vec3; b: Vec3; r: number; rate: () => number; comp: string }) {
  const m = useMat({ color: '#d4dbe2', metal: 0.95, rough: 0.2, comp })
  const j = useMat({ color: '#6f777e', metal: 0.8, rough: 0.35, comp })
  const { position, quaternion, length } = useMemo(() => seg(a, b), [a, b])
  const g = useRef<THREE.Group>(null!)
  useFrame(() => { g.current.rotation.y = rate() })
  return (
    <group position={position} quaternion={quaternion}>
      <group ref={g}>
        <mesh geometry={cyl(r, r, length, 16)} material={m} />
        {[0.5, -0.5].map((k) => <mesh key={k} geometry={rbox(r * 3.4, 0.012, 0.012, 0.004)} position={[0, (k * length) / 1.02, 0]} material={j} />)}
      </group>
    </group>
  )
}

function Axle({ s, x, driven, front }: { s: EngineSpec; x: number; driven: boolean; front: boolean }) {
  const caseM = useMat({ color: '#8f8b85', metal: 0.7, rough: 0.4, casing: true, comp: 'diff' })
  const ringM = useMat({ color: '#e7c27d', metal: 0.9, rough: 0.25, comp: 'diff', emissive: '#7a4a10', emissiveIntensity: 0.2 })
  const rubber = useMat({ color: '#141618', metal: 0, rough: 0.9, comp: 'wheel' })
  const rim = useMat({ color: '#c6cdd4', metal: 0.95, rough: 0.2, comp: 'wheel' })
  const disc = useMat({ color: '#7d858c', metal: 0.85, rough: 0.35, comp: 'wheel' })
  const cal = useMat({ color: s.petrol ? '#2b63d6' : '#c63b3b', metal: 0.5, rough: 0.35, comp: 'wheel' })
  const tz = s.track / 2, y = s.axleY, R = s.wheelR
  const ring = useRef<THREE.Group>(null!), wheels = useRef<THREE.Group[]>([]), pinion = useRef<THREE.Group>(null!)
  useFrame(() => {
    const w = driven ? MECH.wheel : MECH.wheel * (front ? 1 : 1)
    if (ring.current) ring.current.rotation.z = -w
    if (pinion.current) pinion.current.rotation.x = MECH.out
    wheels.current.forEach((g) => { if (g) g.rotation.z = -w })
  })
  const housing = useMemo(() => revolve('diffH', [[-0.11, 0.0], [-0.11, 0.06], [-0.06, 0.13], [0.06, 0.13], [0.11, 0.06], [0.11, 0.0]], 48), [])
  return (
    <group position={[x, y, 0]}>
      {driven && (
        <Explode off={[0, -0.2, 0]}>
          <Casing geometry={housing} material={caseM} rotation={[0, Math.PI / 2, 0]} />
          <group ref={ring} position={[0, 0, 0.04]}><mesh geometry={gear(38, 0.085, 0.014, 0.008, 0.05)} material={ringM} /></group>
          <group ref={pinion} position={[front ? -0.1 : 0.1, -0.02, 0]}><mesh geometry={gear(11, 0.026, 0.026, 0.008, 0.008)} rotation={[0, Math.PI / 2, 0]} material={ringM} /></group>
          <Shaft a={[0, 0, 0.08]} b={[0, 0, tz - 0.12]} r={0.016} rate={() => MECH.wheel} comp="axle" />
          <Shaft a={[0, 0, -0.08]} b={[0, 0, -tz + 0.12]} r={0.016} rate={() => MECH.wheel} comp="axle" />
        </Explode>
      )}
      {[1, -1].map((side, i) => (
        <group key={side} position={[0, 0, side * tz]}>
          <Explode off={[0, 0, side * 0.35]}>
            <group ref={(o) => { if (o) wheels.current[i] = o }}>
              <mesh geometry={tyre(R, s.petrol ? 0.245 : 0.265)} material={rubber} />
              <mesh geometry={cyl(R * 0.66, R * 0.66, 0.12, 40)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, side * 0.04]} material={rim} />
              {Array.from({ length: 6 }, (_, k) => <mesh key={k} geometry={rbox(R * 0.6, 0.03, 0.02, 0.008)} rotation={[0, 0, (k / 6) * Math.PI * 2]} position={[Math.cos((k / 6) * Math.PI * 2) * R * 0.3, Math.sin((k / 6) * Math.PI * 2) * R * 0.3, side * 0.1]} material={rim} />)}
              <mesh geometry={cyl(R * 0.5, R * 0.5, 0.024, 40)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -side * 0.03]} material={disc} />
            </group>
            <mesh geometry={rbox(0.1, 0.06, 0.05, 0.012)} position={[R * 0.32, R * 0.3, -side * 0.03]} rotation={[0, 0, -0.7]} material={cal} />
          </Explode>
        </group>
      ))}
    </group>
  )
}

/** the tank sits beside the main section plane, so it gets its own plane through its middle */
const TANKCUT = new THREE.Plane(new THREE.Vector3(0, 0, -1), 50)

function Driveline({ s }: { s: EngineSpec }) {
  useFrame(() => { TANKCUT.constant = S.cut < 0.02 ? 50 : s.tank.pos[2] + (s.tank.saddle ? 0.3 : 0) + (1 - Math.pow(S.cut, 0.7)) * 0.8 })
  const tcase = useMat({ color: '#a7a093', metal: 0.6, rough: 0.4, casing: true, comp: 'transfer' })
  const tankM = useMat({ color: '#5b646d', metal: 0.5, rough: 0.45, casing: true, comp: 'tank', plane: TANKCUT })
  const fuel = useMat({ color: '#ff8a3d', metal: 0, rough: 0.2, opacity: 0.7, emissive: '#ff6a1a', emissiveIntensity: 0.5, keepLit: true, comp: 'tank' })
  const pipe = useMat({ color: '#8a7466', metal: 0.75, rough: 0.45, comp: 'exhaust' })
  const dpfM = useMat({ color: '#c9ccd0', metal: 0.85, rough: 0.3, casing: true, comp: 'dpf' })
  const frame = useMat({ color: '#2e3338', metal: 0.6, rough: 0.5, comp: 'frame' })
  const fuelLine = useMat({ color: '#b9c0c6', metal: 0.9, rough: 0.25, comp: 'fuelLine' })
  const end = -0.47 - s.gears.length * (s.gears.length > 6 ? 0.06 : 0.08) - 0.1
  const T = s.tank
  const tankGeo = useMemo(() => slab(`tank${s.petrol}`, T.size[0], T.saddle ? T.size[2] * 0.42 : T.size[2], T.size[1], [{ rect: [-T.size[0] / 2 + 0.012, -(T.saddle ? T.size[2] * 0.42 : T.size[2]) / 2 + 0.012, T.size[0] / 2 - 0.012, (T.saddle ? T.size[2] * 0.42 : T.size[2]) / 2 - 0.012], round: 0.03 }], 0.05), [s]) // eslint-disable-line
  const tankCap = useMemo(() => slab(`tankc${s.petrol}`, T.size[0], T.saddle ? T.size[2] * 0.42 : T.size[2], 0.012, [], 0.05), [s]) // eslint-disable-line
  const dpf = useMemo(() => hollow('dpf', 0.075, 0.065, 0.42, 36), [])
  const muff = useMemo(() => hollow('muff', 0.09, 0.08, 0.5, 36), [])
  const exPts = useMemo(() => exhaustPath(s), [s])
  const exTube = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(exPts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.2), 120, 0.022, 10), [exPts])
  const flTube = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fuelPath(s).map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.2), 160, 0.005, 6), [s])
  const tankParts = T.saddle ? [0.3, -0.3] : [0]
  const tcGeo = useMemo(() => slab('tcase', 0.2, 0.28, 0.28, [{ rect: [-0.085, -0.12, 0.085, 0.12], round: 0.02 }], 0.03), [])
  return (
    <group>
      <Explode off={[-0.25, -0.2, 0]}>
        {s.awd ? (
          <>
            <Casing geometry={tcGeo} material={tcase} position={[end - 0.12, -0.2, 0]} />
            <Shaft a={[end - 0.22, -0.1, 0]} b={[s.rearAxleX + 0.12, s.axleY - 0.02, 0]} r={0.03} rate={() => MECH.out} comp="driveshaft" />
            <Shaft a={[end - 0.05, -0.17, 0.08]} b={[s.frontAxleX - 0.12, s.axleY - 0.02, 0.0]} r={0.025} rate={() => MECH.out * (S.extra.awd ?? 1)} comp="driveshaft" />
          </>
        ) : (
          <Shaft a={[end, -0.07, 0]} b={[s.rearAxleX + 0.12, s.axleY - 0.02, 0]} r={0.032} rate={() => MECH.out} comp="driveshaft" />
        )}
      </Explode>
      <Axle s={s} x={s.frontAxleX} driven={s.awd} front />
      <Axle s={s} x={s.rearAxleX} driven front={false} />
      <Explode off={[0, -0.35, 0.2]}>
        {tankParts.map((dz) => (
          <group key={dz} position={[T.pos[0], T.pos[1] - T.size[1] / 2, T.pos[2] + dz]}>
            <Casing geometry={tankGeo} material={tankM} plane={TANKCUT} />
            <Casing geometry={tankCap} material={tankM} position={[0, -0.012, 0]} plane={TANKCUT} />
            <Casing geometry={tankCap} material={tankM} position={[0, T.size[1], 0]} plane={TANKCUT} />
            <mesh material={fuel} position={[0, T.size[1] * 0.32, 0]}><boxGeometry args={[T.size[0] - 0.03, T.size[1] * 0.6, (T.saddle ? T.size[2] * 0.42 : T.size[2]) - 0.03]} /></mesh>
          </group>
        ))}
        <mesh geometry={cyl(0.022, 0.022, T.size[1] * 0.9, 14)} position={[T.pos[0] + T.size[0] * 0.3, T.pos[1], T.pos[2] + (T.saddle ? 0.3 : 0)]} material={fuelLine} />
      </Explode>
      <mesh geometry={flTube} material={fuelLine} />
      <Explode off={[0, -0.25, -0.15]}>
        <mesh geometry={exTube} material={pipe} />
        <Casing geometry={dpf} material={dpfM} position={[-0.72, -0.24, -0.33]} />
        <Casing geometry={muff} material={dpfM} position={[s.rearAxleX + 0.55, -0.24, -0.42]} />
      </Explode>
      {[1, -1].map((side) => <mesh key={side} geometry={rbox(Math.abs(s.rearAxleX) + 1.5, 0.1, 0.05, 0.01)} position={[(s.rearAxleX + 1.0) / 2, -0.17, side * 0.43]} material={frame} />)}
    </group>
  )
}

/* ------------------------------------------------------------------ flow paths */
export function exhaustPath(s: EngineSpec): Vec3[] {
  const [x, y, z] = s.turbo
  return [[x - 0.12, y, z], [x - 0.2, y - 0.1, z - 0.02], [-0.3, -0.12, -0.33], [-0.5, -0.24, -0.33], [-0.95, -0.24, -0.33], [-1.5, -0.24, -0.38], [s.rearAxleX + 0.3, -0.24, -0.42], [s.rearAxleX - 0.35, -0.24, -0.5], [s.rearAxleX - 0.7, -0.24, -0.5]]
}
export function fuelPath(s: EngineSpec): Vec3[] {
  const T = s.tank
  const out: Vec3 = [T.pos[0] + T.size[0] * 0.3, T.pos[1] + T.size[1] / 2 + 0.02, T.pos[2] + (T.saddle ? 0.3 : 0)]
  return [out, [out[0] + 0.3, -0.12, 0.38], [-0.6, -0.14, 0.38], [0.2, -0.12, 0.36], [0.48, -0.05, 0.33], [0.48, 0.1, 0.33], [0.4, 0.14, 0.2], [0.33, 0.12, 0.13]]
}
export function railPath(s: EngineSpec): Vec3[] {
  const d = s.deck
  return s.petrol ? [[0.3, 0.12, 0.13], [0.3, d + 0.02, 0.12], [0.2, d + 0.06, 0.085], [-0.18, d + 0.06, 0.085]] : [[0.3, 0.12, 0.13], [0.3, d + 0.15, 0.1], [0.22, d + 0.2, 0.07], [-0.2, d + 0.2, 0.07]]
}
export function airPath(s: EngineSpec): Vec3[] {
  const [x, y, z] = s.turbo, d = s.deck
  return [[0.8, 0.3, 0.33], [0.62, 0.25, 0.3], [0.45, 0.24, 0.2], [0.3, y + 0.08, -0.1], [x + 0.18, y, z], [x + 0.12, y, z], [x + 0.085, y + 0.09, z], [0.3, y + 0.08, z + 0.02], [0.84, 0.08, -0.25], [0.86, 0.0, 0.0], [0.84, 0.08, 0.25], [0.5, d + 0.05, 0.2], [0.18, d + 0.04, 0.175], [-0.18, d + 0.04, 0.175]]
}
export function powerPath(s: EngineSpec): Vec3[] {
  const end = -0.47 - s.gears.length * (s.gears.length > 6 ? 0.06 : 0.08) - 0.1
  return [[0.2, 0.0, 0.0], [-0.29, 0.0, 0.0], [-0.4, 0.05, 0], [end + 0.05, 0.05, 0], [end + 0.05, -0.07, 0], [end - 0.2, -0.1, 0], [s.rearAxleX + 0.12, s.axleY - 0.02, 0], [s.rearAxleX, s.axleY, 0.1], [s.rearAxleX, s.axleY, s.track / 2]]
}

function Flows({ s }: { s: EngineSpec }) {
  const d = s.deck, c1 = s.cx[0]
  const rpmRate = (k: number) => () => (0.25 + S.rpm / 60) * k
  const fuelC = solid('#ff8a3d')
  const air = ramp([[0, '#9fdcff'], [0.3, '#6cc6ff'], [0.42, '#ffd2a1'], [0.6, '#ffb27a'], [0.7, '#6cc6ff'], [1, '#6cc6ff']])
  const ex = ramp([[0, '#ff6a3d'], [0.3, '#ff8a3d'], [0.6, '#c9a99c'], [1, '#9b8c84']])
  const ph = () => phaseOf(MECH.crank, 0)
  const injecting1 = () => (injecting(s, ph()) ? 1 : 0)
  const inLift = () => valveLift(ph(), false)
  const exLift = () => valveLift(ph(), true)
  const sprays = useMemo(() => (s.petrol ? [-0.3, 0, 0.3] : [-2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4]).map((a): Vec3[] => s.petrol
    ? [[c1, d - 0.006, 0.03], [c1 + Math.sin(a) * 0.02, d - 0.02, 0.0], [c1 + Math.sin(a) * 0.035, d - 0.04, -0.02]]
    : [[c1, d - 0.003, 0], [c1 + Math.sin(a) * 0.02, d - 0.006, Math.cos(a) * 0.02], [c1 + Math.sin(a) * 0.04, d - 0.01, Math.cos(a) * 0.04]]), [s]) // eslint-disable-line
  const coolant: Vec3[][] = useMemo(() => [
    [[0.26, 0.04, -0.02], [0.21, 0.12, 0.06], s.cx.map((x) => [x, 0.2, 0.06] as Vec3)[3], [-0.2, 0.18, -0.06], [0.2, d - 0.02, -0.06], [0.3, d + 0.02, 0.0], [0.7, 0.15, 0], [0.79, 0.15, 0.1], [0.79, -0.15, 0.1], [0.5, -0.05, -0.02], [0.27, 0.04, -0.02]],
  ], [s]) // eslint-disable-line
  const oil: Vec3[][] = useMemo(() => [
    [[0.0, -0.15, 0], [0.26, -0.1, 0], [0.26, -0.02, 0.1], [0.0, -0.02, 0.1], [-0.2, -0.02, 0.1], [-0.2, d + 0.06, 0.06], [0.2, d + 0.07, 0.04]],
    [[0.2, -0.02, -0.1], [s.turbo[0], s.turbo[1] + 0.06, s.turbo[2]], [s.turbo[0], s.turbo[1] - 0.06, s.turbo[2]], [0.0, -0.12, -0.05]],
  ], [s]) // eslint-disable-line
  return (
    <group>
      {/* fuel: tank → pump → filter → high-pressure pump → rail → injectors */}
      <Flow id="fuel" points={fuelPath(s)} color={fuelC} count={120} size={0.022} rate={rpmRate(0.35)} />
      <Flow id="fuel" points={railPath(s)} color={fuelC} count={70} size={0.02} rate={rpmRate(0.6)} profile={(u) => (u < 0.3 ? 0.6 : 1.6)} />
      {s.cx.map((x) => <Flow key={x} id="fuel" points={s.petrol ? [[x, d + 0.06, 0.085], [x, d + 0.03, 0.06], [x, d - 0.004, 0.032]] : [[x, d + 0.2, 0.07], [x, d + 0.17, 0.0], [x, d + 0.05, 0], [x, d, 0]]} color={fuelC} count={12} size={0.014} rate={rpmRate(0.4)} />)}
      {sprays.map((p, i) => <Flow key={i} id="fuel" points={p} color={solid('#ffb070')} count={10} size={0.012} rate={() => 0.25} gate={injecting1} jitter={0.004} />)}
      {/* air: filter → compressor → intercooler → manifold → cylinder 1 */}
      <Flow id="air" points={airPath(s)} color={air} count={260} size={0.02} rate={() => 0.4 + (S.extra.turboRpm ?? 0.3) * 1.4} profile={(u) => (u > 0.32 && u < 0.5 ? 2.4 : u > 0.75 ? 0.7 : 1)} jitter={0.02} />
      <Flow id="air" points={[[c1, d + 0.04, 0.175], [c1, d + 0.04, 0.09], [c1 + 0.01, d + 0.012, 0.036], [c1, d - 0.03, 0.0]]} color={solid('#7fd0ff')} count={40} size={0.014} rate={() => 0.18} gate={inLift} jitter={0.008} />
      {/* exhaust: cylinder 1 → manifold → turbine → aftertreatment → tailpipe */}
      <Flow id="exhaust" points={[[c1, d - 0.03, 0.0], [c1, d + 0.012, -0.036], [c1, d + 0.025, -0.11], [-0.06, d + 0.025, -0.17], [s.turbo[0] - 0.06, s.turbo[1] + 0.05, s.turbo[2] + 0.02]]} color={ex} count={60} size={0.016} rate={() => 0.18} gate={exLift} jitter={0.008} />
      <Flow id="exhaust" points={[[-0.15, d + 0.025, -0.16], [-0.06, d + 0.025, -0.17], [s.turbo[0] - 0.06, s.turbo[1] + 0.05, s.turbo[2] + 0.02], [s.turbo[0] - 0.08, s.turbo[1] + 0.09, s.turbo[2]], [s.turbo[0] - 0.08, s.turbo[1], s.turbo[2] - 0.09], [s.turbo[0] - 0.12, s.turbo[1], s.turbo[2]]]} color={ex} count={90} size={0.018} rate={() => 0.3 + (S.extra.turboRpm ?? 0.3)} profile={(u) => (u > 0.5 ? 1.8 : 1)} jitter={0.01} />
      <Flow id="exhaust" points={exhaustPath(s)} color={ramp([[0, '#ff7a4a'], [0.25, '#d8a08c'], [1, '#9b8c84']])} count={160} size={0.022} rate={() => 0.5 + (S.extra.turboRpm ?? 0.3) * 0.8} jitter={0.02} />
      {coolant.map((p, i) => <Flow key={i} id="coolant" points={p} color={ramp([[0, '#3ddc97'], [0.5, '#ff7b54'], [0.7, '#ff9b6b'], [0.85, '#3ddc97'], [1, '#3ddc97']])} count={150} size={0.018} rate={rpmRate(0.25)} jitter={0.01} />)}
      {oil.map((p, i) => <Flow key={i} id="oil" points={p} color={solid('#f2c94c')} count={90} size={0.016} rate={rpmRate(0.25)} jitter={0.008} />)}
      <Flow id="power" points={powerPath(s)} color={ramp([[0, '#ffe08a'], [0.5, '#ffb86b'], [1, '#ffd36b']])} count={150} size={0.03} rate={() => 0.6} jitter={0.01} />
      <Flow id="electric" points={[[s.battery[0], s.battery[1] + 0.1, s.battery[2]], [0.2, 0.0, -0.32], [-0.2, -0.05, -0.2], [-0.2, -0.08, -0.13]]} color={solid('#b49bff')} count={60} size={0.02} rate={() => 1.2} />
    </group>
  )
}

/* ------------------------------------------------------------------ molecules inside cylinder 1 (macro view) */
function Charge({ s }: { s: EngineSpec }) {
  const N = 160
  const mol = useMemo(() => Array.from({ length: N }, () => ({ r: Math.sqrt(Math.random()) * (s.R - 0.006), th: Math.random() * TAU, v: Math.random(), w: 0.6 + Math.random() })), [s])
  const geo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); return g }, [])
  const mat = useMemo(() => new THREE.PointsMaterial({ size: 0.006, color: '#9fdcff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }), [])
  const cold = useMemo(() => new THREE.Color('#9fdcff'), []), hot = useMemo(() => new THREE.Color('#ffb070'), []), fire = useMemo(() => new THREE.Color('#ff5a2a'), []), smoke = useMemo(() => new THREE.Color('#bba79c'), [])
  const c1 = s.cx[0]
  useFrame((_, dt) => {
    mat.opacity += ((S.extra.macro ?? 0) - mat.opacity) * 0.1
    if (mat.opacity < 0.01) return
    const phi = phaseOf(MECH.crank, 0)
    const top = crownY(s, phi), h = Math.max(0.004, s.deck - top)
    const st = strokeOf(phi), b = burn(s, phi)
    const P = geo.attributes.position as THREE.BufferAttribute
    mol.forEach((m, i) => { m.th += dt * PLAY.k * m.w * (0.8 + b * 5); P.setXYZ(i, c1 + Math.cos(m.th) * m.r, top + 0.002 + m.v * (h - 0.003), Math.sin(m.th) * m.r) })
    P.needsUpdate = true
    const comp = st === 1 ? (phi - Math.PI) / Math.PI : 0
    if (b > 0.05) mat.color.copy(fire); else if (st === 3) mat.color.copy(smoke); else if (st === 2) mat.color.copy(hot); else mat.color.copy(cold).lerp(hot, comp * (s.petrol ? 0.4 : 0.9))
    mat.size = 0.005 + comp * 0.003 + b * 0.004
  })
  return <points geometry={geo} material={mat} frustumCulled={false} />
}

export function Powertrain({ s }: { s: EngineSpec }) {
  return (
    <group>
      <Mechanism s={s} />
      <Block s={s} />
      <Crank s={s} />
      <Valvetrain s={s} />
      <TimingChain s={s} />
      <Injection s={s} />
      <Manifolds s={s} />
      <Turbo s={s} />
      <Ancillaries s={s} />
      <Gearbox s={s} />
      <Driveline s={s} />
      <Flows s={s} />
      <Charge s={s} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1, -s.axleY * 0 - s.wheelR + s.axleY, 0]} receiveShadow>
        <planeGeometry args={[14, 8]} />
        <shadowMaterial opacity={0.35} />
      </mesh>
    </group>
  )
}

export { CYCLE_OFFSET, makeMat, capsule }
