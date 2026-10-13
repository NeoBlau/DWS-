import { useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Casing, CUTS, Explode, Flow, PLAY, S, solid, useMat } from '../materials'
import { live, exp, CLOCK, smooth, clamp01 } from '../core'
import { cyl, glowSprite, loft, rbox, torus, tube } from '../../utils/geom'
import { revolve, hollow, mergeGeos } from '../diesel/geometry'
import {
  ST, FAN_R, EX, BYPASS_XR, CORE_XR, CORE, ring, xAtU, corePoint, hpcStage, lptStage, boosterStage, spinnerR,
  fanBlades, vaneRing, statorRows, discDrum, profileSlab, around, spinnerSpiral,
} from './geometry'
import type { Vec3 } from '../../data/types'

const TAU = Math.PI * 2

/* ------------------------------------------------------------------ engine model */
/** spool angles + the illustrative engine model; read by every moving part, published to `live` */
export const MECH = { lp: 0, hp: 0, n1: 20, n2: 59, egt: 450, ff: 300, flame: 0.35, starter: 0, ign: 0, thrust: 2 }

/**
 * Deterministic start sequence as a function of time (s). Shape follows a typical airliner start:
 * starter spins N2 → N1 follows → fuel at ≈ 22–25 % N2 → light-off → starter cut-out ≈ 50 % N2 → idle.
 * Values are illustrative.
 */
export function startModel(t: number) {
  const n2 = t < 1.2 ? 0 : t < 7.5 ? 25 * smooth((t - 1.2) / 5.6) : 25 + 34 * smooth((t - 7.5) / 4.6)
  const n1 = t < 4.5 ? 0.6 * smooth((t - 3.0) / 1.5) : t < 7.5 ? 0.6 + 5.4 * smooth((t - 4.5) / 3) : 6 + 14 * smooth((t - 7.5) / 4.6)
  const lit = smooth((t - 7.5) / 0.6)
  const egt = 15 + lit * (610 * smooth((t - 7.5) / 2.4) - 170 * smooth((t - 10) / 2.4))
  const ff = t < 6 ? 0 : t < 7.5 ? 110 * smooth((t - 6) / 0.5) : 110 + 190 * smooth((t - 7.5) / 4.5)
  return { n1, n2, egt, ff, flame: lit * (0.25 + 0.15 * smooth((t - 7.5) / 4)), starter: t >= 1.2 && t < 9 ? 1 : 0, ign: t >= 6.5 && t < 9.6 ? 1 : 0 }
}
/** N1 the core settles at for a given N2 (illustrative, monotonic) */
const n1Of = (n2: number) => (n2 < 59 ? Math.max(0, (n2 / 59) * 20) : 20 + 78 * Math.pow(clamp01((n2 - 59) / 40), 1.25))

function Mechanism() {
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05) * PLAY.k
    if ((S.extra.seq ?? 0) > 0.5) {
      const m = startModel(exp().track === 'start' ? CLOCK.t : S.extra.st ?? 0)
      Object.assign(MECH, m)
    } else {
      const thr = exp().throttle
      const n2t = 59 + 40 * thr
      MECH.n2 += (n2t - MECH.n2) * (1 - Math.exp(-dt / 1.3))
      MECH.n1 += (n1Of(MECH.n2) - MECH.n1) * (1 - Math.exp(-dt / 1.9))
      const p = clamp01((MECH.n1 - 20) / 78)
      MECH.egt += (450 + 430 * p - MECH.egt) * (1 - Math.exp(-dt / 1.5))
      MECH.ff = 300 + 3900 * Math.pow(p, 1.5)
      MECH.flame = MECH.n2 > 45 ? 0.4 + 0.6 * p : 0
      MECH.starter = 0; MECH.ign = 0
    }
    MECH.thrust = 120 * Math.pow(clamp01(MECH.n1 / 100), 2.6)
    // shown rotation is slowed for visibility (a real fan turns up to ≈ 80 rev/s)
    const vis = S.extra.vis ?? 1
    MECH.lp += 0.75 * Math.sqrt(MECH.n1 / 100) * TAU * dt * vis
    MECH.hp += 0.9 * Math.sqrt(MECH.n2 / 100) * TAU * dt * vis
    live.n1 = Math.round(MECH.n1)
    live.n2 = Math.round(MECH.n2)
    live.n1rpm = Math.round((MECH.n1 * 50) / 10) * 10
    live.n2rpm = Math.round((MECH.n2 * 145) / 10) * 10
    live.egt = Math.round(MECH.egt)
    live.ff = Math.round(MECH.ff / 10) * 10
    live.thrust = Math.round(MECH.thrust * 10) / 10
    live.flame = MECH.flame
  })
  return null
}

/** group spinning with one of the two spools */
function Spin({ spool, children }: { spool: 'lp' | 'hp'; children: ReactNode }) {
  const g = useRef<THREE.Group>(null!)
  useFrame(() => { g.current.rotation.x = spool === 'lp' ? MECH.lp : MECH.hp })
  return <group ref={g}>{children}</group>
}

const xr = (pts: [number, number][]) => pts
const ORANGE = '#e2793a', HOTCAP = '#f08a3c', ROTCAP = '#cf6a33'

/* ------------------------------------------------------------------ nacelle, fan case, bypass duct */
function Nacelle() {
  const paint = useMat({ color: '#eceff2', metal: 0.15, rough: 0.32, clear: 0.7, casing: true, comp: 'nacelle' })
  const lip = useMat({ color: '#d5dbe1', metal: 0.9, rough: 0.22, casing: true, comp: 'inlet' })
  const inner = useMat({ color: '#7b848d', metal: 0.5, rough: 0.55, casing: true, comp: 'inlet' })
  const fanCase = useMat({ color: '#8d969f', metal: 0.75, rough: 0.38, casing: true, comp: 'fanCase' })
  const duct = useMat({ color: '#9aa2aa', metal: 0.55, rough: 0.45, casing: true, comp: 'bypassDuct' })
  const ogvM = useMat({ color: '#b7c0c8', metal: 0.85, rough: 0.3, casing: true, comp: 'ogv' })
  const g = useMemo(() => ({
    inletOuter: revolve('jetInletO', xr([[1.2, 1.1], [1.5, 1.093], [1.8, 1.075], [1.94, 1.045], [2.0, 1.062], [1.8, 1.1], [1.5, 1.118], [1.2, 1.125], [1.2, 1.1]]), 72),
    inletLip: revolve('jetInletL', xr([[1.94, 0.95], [1.98, 0.93], [2.04, 0.965], [2.06, 1.0], [2.045, 1.035], [2.0, 1.062], [1.94, 1.045], [1.94, 0.95]]), 72),
    inletInner: revolve('jetInletI', xr([[1.2, 0.876], [1.55, 0.878], [1.85, 0.9], [1.94, 0.925], [1.94, 0.95], [1.85, 0.925], [1.55, 0.903], [1.2, 0.9], [1.2, 0.876]]), 72),
    fanCase: revolve('jetFanCase', xr([[1.2, 0.876], [0.32, 0.876], [0.32, 0.9], [0.5, 0.94], [0.7, 0.975], [0.95, 0.985], [1.15, 0.97], [1.2, 0.9], [1.2, 0.876]]), 72),
    duct: revolve('jetDuct', xr([[0.32, 0.876], [0.0, 0.872], [-0.5, 0.835], [-0.96, 0.77], [-0.96, 0.79], [-0.5, 0.86], [0.0, 0.9], [0.32, 0.9], [0.32, 0.876]]), 72),
    aft: revolve('jetAftCowl', xr([[1.2, 1.125], [0.6, 1.12], [0.0, 1.06], [-0.6, 0.93], [-0.97, 0.795], [-0.97, 0.78], [-0.6, 0.905], [0.0, 1.035], [0.6, 1.095], [1.2, 1.1], [1.2, 1.125]]), 72),
    ogv: vaneRing('ogv', 44, 0.585, 0.878, 0.12, 0.012, 0.22),
    bifU: profileSlab('bifU', [[0.32, 0.57], [0.36, 0.88], [-0.96, 0.8], [-1.0, 0.57]], 0.07),
    bifL: profileSlab('bifL', [[0.32, -0.57], [0.36, -0.88], [-0.96, -0.8], [-1.0, -0.57]], 0.07),
  }), [])
  return (
    <group>
      <Explode off={EX.inlet}>
        <Casing geometry={g.inletOuter} material={paint} />
        <Casing geometry={g.inletLip} material={lip} />
        <Casing geometry={g.inletInner} material={inner} />
      </Explode>
      <Explode off={EX.fanCase} delay={0.1}>
        <Casing geometry={g.fanCase} material={fanCase} />
        <group position={[ST.ogv, 0, 0]}><Casing geometry={g.ogv} material={ogvM} /></group>
        <Accessories />
      </Explode>
      <Explode off={EX.nacelle} delay={0.05}>
        <Casing geometry={g.aft} material={paint} />
        <Casing geometry={g.duct} material={duct} />
        <Casing geometry={g.bifU} material={duct} />
        <Casing geometry={g.bifL} material={duct} />
      </Explode>
    </group>
  )
}

/** accessory gearbox + air starter on the fan case, radial drive shaft down to the HP spool */
const AGB_A = Math.PI + 0.3 // angle about X (bottom, tilted away from the section plane)
function Accessories() {
  const box = useMat({ color: '#6f7a84', metal: 0.7, rough: 0.4, casing: true, comp: 'agb' })
  const starter = useMat({ color: '#a7b4c2', metal: 0.8, rough: 0.3, casing: true, comp: 'starter', emissive: '#4a6fd1', emissiveIntensity: 0.15 })
  const shaftM = useMat({ color: '#e0b46a', metal: 0.9, rough: 0.25, comp: 'agb' })
  const rds = useRef<THREE.Group>(null!)
  useFrame(() => { rds.current.rotation.y = MECH.hp * 1.3 })
  const a = new THREE.Vector3(0.3 - EX.fanCase[0] * 0, 0.18, 0), b = new THREE.Vector3(0.62, 0.99, 0)
  const len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return (
    <group rotation={[AGB_A, 0, 0]}>
      <mesh geometry={rbox(0.46, 0.075, 0.32, 0.02)} position={[0.72, 1.03, 0]} material={box} />
      <mesh geometry={cyl(0.065, 0.065, 0.2, 18)} rotation={[0, 0, Math.PI / 2]} position={[0.42, 1.04, 0.09]} material={starter} />
      <mesh geometry={cyl(0.04, 0.04, 0.14, 14)} rotation={[0, 0, Math.PI / 2]} position={[0.9, 1.04, -0.08]} material={box} />
      <group position={mid.toArray()} quaternion={q}>
        <group ref={rds}><mesh geometry={cyl(0.016, 0.016, len, 10)} material={shaftM} /><mesh geometry={rbox(0.05, 0.02, 0.012, 0.004)} material={shaftM} /></group>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ LP spool: fan, booster, LP turbine, inner shaft */
function FanModule() {
  const ti = useMat({ color: '#c3ccd5', metal: 0.95, rough: 0.2, comp: 'fan', side: THREE.DoubleSide })
  const disc = useMat({ color: '#9aa4ae', metal: 0.9, rough: 0.3, comp: 'fan' })
  const spin = useMat({ color: '#dfe4e9', metal: 0.75, rough: 0.25, comp: 'spinner' })
  const mark = useMat({ color: '#1d2228', metal: 0.2, rough: 0.5, comp: 'spinner' })
  const g = useMemo(() => {
    const sp: [number, number][] = []
    for (let i = 0; i <= 14; i++) { const x = 1.15 + ((ST.spinnerTip - 1.15) * i) / 14; sp.push([x, spinnerR(x)]) }
    sp.unshift([1.15, 0.0005])
    return {
      blades: fanBlades('cfm', 36, 0.29, FAN_R, { chord0: 0.2, chord1: 0.25, b0: 0.38, b1: 1.05, camber: 0.07, sweep: 0.05 }),
      disc: revolve('jetFanDisc', xr([[0.86, 0.08], [0.86, 0.295], [1.15, 0.3], [1.2, 0.27], [1.2, 0.08], [0.86, 0.08]]), 48),
      spinner: revolve('jetSpinner', sp, 48),
      spiral: spinnerSpiral('cfm'),
      shroud: torus(0.6, 0.009, 96),
    }
  }, [])
  return (
    <Explode off={EX.fan} delay={0.05}>
      <Spin spool="lp">
        <group position={[ST.fan, 0, 0]}>
          <mesh geometry={g.blades} material={ti} />
          <mesh geometry={g.shroud} rotation={[0, Math.PI / 2, 0]} position={[-0.01, 0, 0]} material={ti} />
        </group>
        <mesh geometry={g.disc} material={disc} />
        <mesh geometry={g.spinner} material={spin} />
        <mesh geometry={g.spiral} material={mark} />
      </Spin>
    </Explode>
  )
}

function BoosterModule() {
  const rotor = useMat({ color: '#c9d3dc', metal: 0.92, rough: 0.24, comp: 'booster' })
  const drumM = useMat({ color: '#a9b3bd', metal: 0.85, rough: 0.3, casing: true, comp: 'booster' })
  const caseM = useMat({ color: '#a2acb6', metal: 0.7, rough: 0.38, casing: true, comp: 'booster' })
  const stat = useMat({ color: '#b8c1ca', metal: 0.8, rough: 0.32, casing: true, comp: 'booster' })
  const g = useMemo(() => ({
    rotors: mergeGeos([0, 1, 2].map((i) => { const s = boosterStage(i); const r = vaneRing(`bst${i}`, 58, s.hub, s.tip, 0.05, 0.006, 0.62).clone(); r.translate(s.x, 0, 0); return r })),
    drum: discDrum('bst', [0, 1, 2].map((i) => ({ x: boosterStage(i).x, hub: boosterStage(i).hub, w: 0.022 })), 0.25, 0.016),
    stators: statorRows('bst', [0, 1, 2].map((i) => { const s = boosterStage(i); return { x: s.x - 0.05, r0: s.hub + 0.004, r1: s.tip + 0.012, n: 64, chord: 0.04 } }), -0.45),
    case: revolve('jetBstCase', xr([[0.62, 0.487], [0.45, 0.462], [0.38, 0.43], [0.3, 0.37], [0.24, 0.352], [0.24, 0.378], [0.3, 0.397], [0.38, 0.456], [0.45, 0.488], [0.62, 0.512], [0.62, 0.487]]), 64),
    duct: revolve('jetTdInner', xr([[0.46, 0.335], [0.38, 0.305], [0.3, 0.24], [0.24, 0.206], [0.24, 0.188], [0.3, 0.222], [0.38, 0.286], [0.46, 0.315], [0.46, 0.335]]), 64),
  }), [])
  return (
    <Explode off={EX.booster} delay={0.1}>
      <Spin spool="lp">
        <mesh geometry={g.rotors} material={rotor} />
        <Casing geometry={g.drum} material={drumM} cap={ROTCAP} />
      </Spin>
      <Casing geometry={g.stators} material={stat} />
      <Casing geometry={g.case} material={caseM} />
      <Casing geometry={g.duct} material={caseM} />
    </Explode>
  )
}

function LPShaft() {
  const m = useMat({ color: '#6f9fd8', metal: 0.85, rough: 0.25, comp: 'lpShaft', emissive: '#2a5ea8', emissiveIntensity: 0.35 })
  const g = useRef<THREE.Group>(null!)
  useFrame(() => { g.current.rotation.x = MECH.lp })
  const L = 1.2 - -1.62
  return (
    <group ref={g}>
      <mesh geometry={cyl(0.05, 0.05, L, 20)} rotation={[0, 0, Math.PI / 2]} position={[(1.2 + -1.62) / 2, 0, 0]} material={m} />
      {/* splines/markings so the rotation reads on a plain shaft */}
      {[-1.3, 0.55, 0.9].map((x) => <mesh key={x} geometry={rbox(0.05, 0.11, 0.02, 0.006)} position={[x, 0, 0]} material={m} />)}
    </group>
  )
}

function LPTModule() {
  const blade = useMat({ color: '#c79c78', metal: 0.88, rough: 0.3, comp: 'lpt', emissive: '#7a2a0c', emissiveIntensity: 0.12 })
  const drumM = useMat({ color: '#a88b74', metal: 0.85, rough: 0.32, casing: true, comp: 'lpt' })
  const caseM = useMat({ color: '#8f7b6c', metal: 0.75, rough: 0.4, casing: true, comp: 'lpt' })
  const vaneM = useMat({ color: '#b48c6c', metal: 0.8, rough: 0.35, casing: true, comp: 'lpt' })
  const g = useMemo(() => ({
    rotors: mergeGeos([0, 1, 2, 3].map((i) => { const s = lptStage(i); const r = vaneRing(`lpt${i}`, 54, s.hub, s.tip, 0.045, 0.007, 0.62).clone(); r.translate(s.x, 0, 0); return r })),
    drum: discDrum('lpt', [0, 1, 2, 3].map((i) => ({ x: lptStage(i).x, hub: lptStage(i).hub, w: 0.024 })), 0.07, 0.018),
    vanes: statorRows('lpt', [0, 1, 2, 3].map((i) => { const s = lptStage(i); return { x: s.x + 0.058, r0: s.hub + 0.004, r1: s.tip + 0.006, n: 48, chord: 0.04 } }), -0.55),
    case: revolve('jetLptCase', xr([[-1.09, 0.374], [-1.2, 0.392], [-1.6, 0.47], [-1.6, 0.505], [-1.45, 0.48], [-1.45, 0.495], [-1.4, 0.495], [-1.4, 0.468], [-1.2, 0.425], [-1.09, 0.405], [-1.09, 0.374]]), 64),
  }), [])
  return (
    <Explode off={EX.lpt} delay={0.2}>
      <Spin spool="lp">
        <mesh geometry={g.rotors} material={blade} />
        <Casing geometry={g.drum} material={drumM} cap={ROTCAP} />
      </Spin>
      <Casing geometry={g.vanes} material={vaneM} />
      <Casing geometry={g.case} material={caseM} />
    </Explode>
  )
}

/* ------------------------------------------------------------------ HP spool: compressor, HP turbine, outer shaft */
function HPCModule() {
  const blade = useMat({ color: '#d6dde4', metal: 0.95, rough: 0.2, comp: 'hpc' })
  const drumM = useMat({ color: '#b3bcc5', metal: 0.88, rough: 0.28, casing: true, comp: 'hpc' })
  const caseM = useMat({ color: '#a7b0b9', metal: 0.72, rough: 0.36, casing: true, comp: 'hpc' })
  const stat = useMat({ color: '#c0c8d0', metal: 0.85, rough: 0.3, casing: true, comp: 'hpc' })
  const shaftM = useMat({ color: '#e0a958', metal: 0.85, rough: 0.28, casing: true, comp: 'hpShaft', emissive: '#7a4a10', emissiveIntensity: 0.25 })
  const idx = Array.from({ length: ST.hpcN }, (_, i) => i)
  const g = useMemo(() => ({
    rotors: mergeGeos(idx.map((i) => { const s = hpcStage(i); const r = vaneRing(`hpc${i}`, 38 + i * 3, s.hub, s.tip, 0.042 - i * 0.002, 0.005, 0.6).clone(); r.translate(s.x, 0, 0); return r })),
    drum: discDrum('hpc', idx.map((i) => ({ x: hpcStage(i).x, hub: hpcStage(i).hub, w: 0.02 })), 0.11, 0.014),
    stators: statorRows('hpc', idx.map((i) => { const s = hpcStage(i); return { x: s.x - 0.04, r0: s.hub + 0.006, r1: s.tip + 0.004, n: 52 + i * 2, chord: 0.03 } }), -0.5),
    case: revolve('jetHpcCase', xr([[0.24, 0.352], [-0.47, 0.305], [-0.47, 0.345], [-0.3, 0.352], [-0.3, 0.37], [-0.26, 0.37], [-0.26, 0.356], [0.0, 0.372], [0.0, 0.392], [0.04, 0.392], [0.04, 0.376], [0.24, 0.385], [0.24, 0.352]]), 64),
    shaft: hollow('jetHpShaft', 0.1, 0.082, 1.3, 40),
  }), []) // eslint-disable-line
  return (
    <Explode off={EX.hpc}>
      <Spin spool="hp">
        <mesh geometry={g.rotors} material={blade} />
        <Casing geometry={g.drum} material={drumM} cap={ROTCAP} />
        <Casing geometry={g.shaft} material={shaftM} position={[(0.22 + -1.08) / 2, 0, 0]} cap="#e8a64a" />
      </Spin>
      <Casing geometry={g.stators} material={stat} />
      <Casing geometry={g.case} material={caseM} />
    </Explode>
  )
}

function HPTModule() {
  const blade = useMat({ color: '#d0a37c', metal: 0.88, rough: 0.28, comp: 'hpt', emissive: '#ff5a1e', emissiveIntensity: 0.22 })
  const discM = useMat({ color: '#b0907a', metal: 0.85, rough: 0.3, casing: true, comp: 'hpt' })
  const ngvM = useMat({ color: '#c98a5e', metal: 0.8, rough: 0.35, casing: true, comp: 'hpt', emissive: '#ff4a10', emissiveIntensity: 0.18 })
  const caseM = useMat({ color: '#94806f', metal: 0.75, rough: 0.4, casing: true, comp: 'hpt' })
  const g = useMemo(() => ({
    rotor: vaneRing('hptb', 46, 0.264, 0.345, 0.042, 0.009, 0.72),
    disc: discDrum('hpt', [{ x: ST.hpt, hub: 0.262, w: 0.03 }], 0.104),
    ngv: vaneRing('ngv', 32, 0.262, 0.352, 0.05, 0.012, -0.62),
    case: revolve('jetHptCase', xr([[-0.95, 0.358], [-1.09, 0.356], [-1.09, 0.4], [-1.0, 0.41], [-0.95, 0.395], [-0.95, 0.358]]), 64),
  }), [])
  return (
    <Explode off={EX.hpt} delay={0.15}>
      <Spin spool="hp">
        <group position={[ST.hpt, 0, 0]}><mesh geometry={g.rotor} material={blade} /></group>
        <Casing geometry={g.disc} material={discM} cap={ROTCAP} />
      </Spin>
      <group position={[ST.ngv, 0, 0]}><Casing geometry={g.ngv} material={ngvM} cap={HOTCAP} /></group>
      <Casing geometry={g.case} material={caseM} cap={HOTCAP} />
    </Explode>
  )
}

/* ------------------------------------------------------------------ combustor */
function Combustor() {
  const caseM = useMat({ color: '#a0968c', metal: 0.72, rough: 0.38, casing: true, comp: 'combustor' })
  const liner = useMat({ color: '#c99f7a', metal: 0.8, rough: 0.34, casing: true, comp: 'combustor', emissive: '#6a2008', emissiveIntensity: 0.25 })
  const nozM = useMat({ color: '#d9c49c', metal: 0.9, rough: 0.25, casing: true, comp: 'nozzles' })
  const pipe = useMat({ color: '#d68a3c', metal: 0.8, rough: 0.3, casing: true, comp: 'nozzles', emissive: '#7a3a08', emissiveIntensity: 0.25 })
  const ignM = useMat({ color: '#e8e4dc', metal: 0.3, rough: 0.4, casing: true, comp: 'igniter' })
  const flameMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff7a2a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, clippingPlanes: CUTS }), [])
  const coreMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, clippingPlanes: CUTS }), [])
  const sparkMat = useMemo(() => new THREE.SpriteMaterial({ map: glowSprite(), color: '#cfe6ff', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true, opacity: 0 }), [])
  const light = useRef<THREE.PointLight>(null!)
  const light2 = useRef<THREE.PointLight>(null!)
  useFrame((st) => {
    const t = st.clock.elapsedTime
    const f = MECH.flame
    const flick = 0.85 + Math.sin(t * 37) * 0.08 + Math.sin(t * 13.3) * 0.07
    flameMat.opacity = Math.min(0.85, f * 0.9 * flick)
    coreMat.opacity = Math.min(0.7, f * 0.55 * flick)
    light.current.intensity = f * 5 * flick
    light2.current.intensity = f * 3 * flick
    sparkMat.opacity = MECH.ign > 0.5 ? (Math.sin(t * 40) > 0.2 ? 1 : 0.15) : 0
  })
  const g = useMemo(() => ({
    outer: revolve('jetCombO', xr([[-0.47, 0.305], [-0.5, 0.36], [-0.56, 0.43], [-0.92, 0.43], [-0.98, 0.365], [-0.98, 0.39], [-0.92, 0.455], [-0.56, 0.455], [-0.5, 0.385], [-0.47, 0.345], [-0.47, 0.305]]), 64),
    inner: revolve('jetCombI', xr([[-0.47, 0.255], [-0.55, 0.2], [-0.95, 0.2], [-0.98, 0.255], [-0.98, 0.236], [-0.95, 0.18], [-0.55, 0.18], [-0.47, 0.236], [-0.47, 0.255]]), 64),
    liner: revolve('jetLiner', xr([[-0.93, 0.352], [-0.57, 0.378], [-0.545, 0.36], [-0.545, 0.24], [-0.57, 0.222], [-0.93, 0.255], [-0.93, 0.265], [-0.575, 0.234], [-0.56, 0.245], [-0.56, 0.355], [-0.575, 0.366], [-0.93, 0.342], [-0.93, 0.352]]), 64),
    flame: revolve('jetFlame', xr([[-0.58, 0.248], [-0.58, 0.352], [-0.93, 0.338], [-0.93, 0.27], [-0.58, 0.248]]), 48),
    flameCore: revolve('jetFlameC', xr([[-0.6, 0.275], [-0.6, 0.325], [-0.78, 0.315], [-0.78, 0.285], [-0.6, 0.275]]), 48),
    nozzles: around('noz', 20, () => {
      const stem = new THREE.CylinderGeometry(0.011, 0.011, 0.17, 8); stem.translate(-0.52, 0.385, 0)
      const tip = new THREE.CylinderGeometry(0.018, 0.014, 0.04, 10); tip.rotateZ(Math.PI / 2); tip.translate(-0.54, 0.3, 0)
      return mergeGeos([stem, tip])
    }),
    manifold: torus(0.475, 0.012, 96),
    ign: around('ign', 2, () => { const c = new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8); c.translate(-0.64, 0.42, 0); return c }, 0.9),
  }), [])
  const ignPos = [0.9, 0.9 + Math.PI].map((a): Vec3 => [-0.64, Math.cos(a) * 0.36, Math.sin(a) * 0.36])
  return (
    <Explode off={EX.comb} delay={0.12}>
      <Casing geometry={g.outer} material={caseM} />
      <Casing geometry={g.inner} material={caseM} />
      <Casing geometry={g.liner} material={liner} cap={HOTCAP} />
      <mesh geometry={g.nozzles} material={nozM} />
      <mesh geometry={g.manifold} rotation={[0, Math.PI / 2, 0]} position={[-0.52, 0, 0]} material={pipe} />
      <mesh geometry={g.ign} material={ignM} />
      <mesh geometry={g.flame} material={flameMat} renderOrder={50} />
      <mesh geometry={g.flameCore} material={coreMat} renderOrder={51} />
      {ignPos.filter((p) => p[2] < 0).map((p, i) => <sprite key={i} material={sparkMat} position={p} scale={0.12} />)}
      <pointLight ref={light} position={[-0.75, 0.3, -0.05]} color="#ff8a3d" distance={2.2} decay={1.5} intensity={0} />
      <pointLight ref={light2} position={[-0.75, -0.3, -0.05]} color="#ff7a2a" distance={1.6} decay={1.5} intensity={0} />
    </Explode>
  )
}

/* ------------------------------------------------------------------ exhaust, core cowl */
function Exhaust() {
  const hot = useMat({ color: '#8d7869', metal: 0.8, rough: 0.38, casing: true, comp: 'exhaust' })
  const plug = useMat({ color: '#9b8676', metal: 0.82, rough: 0.34, casing: true, comp: 'exhaust' })
  const g = useMemo(() => ({
    nozzle: revolve('jetCoreNoz', xr([[-1.6, 0.47], [-1.75, 0.445], [-1.95, 0.402], [-1.95, 0.42], [-1.75, 0.468], [-1.6, 0.5], [-1.6, 0.47]]), 64),
    plug: revolve('jetPlug', xr([[-1.6, 0.255], [-1.6, 0.275], [-1.8, 0.262], [-1.95, 0.24], [-2.15, 0.17], [-2.3, 0.09], [ST.plugTip, 0.006], [-2.36, 0.006], [-2.27, 0.08], [-2.13, 0.153], [-1.95, 0.222], [-1.8, 0.245], [-1.62, 0.255], [-1.6, 0.255]]), 64),
    frame: vaneRing('trf', 14, 0.26, 0.475, 0.09, 0.022, 0),
  }), [])
  return (
    <Explode off={EX.exhaust} delay={0.25}>
      <Casing geometry={g.nozzle} material={hot} />
      <Casing geometry={g.plug} material={plug} />
      <group position={[-1.64, 0, 0]}><Casing geometry={g.frame} material={hot} /></group>
    </Explode>
  )
}

function CoreCowl() {
  const paint = useMat({ color: '#d4d8dc', metal: 0.3, rough: 0.38, clear: 0.4, casing: true, comp: 'cowl' })
  const geo = useMemo(() => revolve('jetCoreCowl', xr([[0.84, 0.505], [0.7, 0.552], [0.4, 0.588], [0.0, 0.6], [-0.6, 0.598], [-1.2, 0.56], [-1.96, 0.434], [-1.96, 0.418], [-1.2, 0.538], [-0.6, 0.576], [0.0, 0.578], [0.4, 0.566], [0.62, 0.53], [0.62, 0.49], [0.75, 0.488], [0.84, 0.505]]), 72), [])
  return <Explode off={EX.cowl} delay={0.05}><Casing geometry={geo} material={paint} /></Explode>
}

/* ------------------------------------------------------------------ pylon + wing chunk */
const wingLe = (z: number) => 0.15 + 0.45 * z
const wingY = (z: number) => 1.62 - 0.08 * z
function Airframe() {
  const wing = useMat({ color: '#dde2e7', metal: 0.25, rough: 0.4, clear: 0.5, comp: 'wing', side: THREE.DoubleSide })
  const pyl = useMat({ color: '#e3e7eb', metal: 0.2, rough: 0.38, clear: 0.5, comp: 'pylon' })
  const fuelM = useMat({ color: '#d27b33', metal: 0.8, rough: 0.3, casing: true, comp: 'fuelLine', emissive: '#6a2a00', emissiveIntensity: 0.3 })
  const bleedM = useMat({ color: '#9fb5cc', metal: 0.85, rough: 0.3, casing: true, comp: 'bleed' })
  const g = useMemo(() => ({
    wing: loft('jetWing', [-3.4, -1.6, 0, 1.6, 2.6].map((z) => ({ le: wingLe(z), y: wingY(z), z, chord: 3.9 + 0.32 * z, t: 0.115 }))),
    pylon: profileSlab('pylon', [[1.05, 1.06], [0.4, 1.3], [-0.4, 1.56], [-2.6, 1.6], [-2.5, 1.42], [-2.2, 0.62], [-1.75, 0.5], [-0.95, 0.88], [0.0, 1.03]], 0.24),
    fuel: tube('jetFuelLine', FUEL_LINE, 0.018, 64),
    bleed: tube('jetBleed', BLEED_LINE, 0.026, 96),
  }), [])
  return (
    <group>
      {/* the airframe is not sectioned: only the engine is cut open */}
      <Explode off={EX.wing} delay={0}><mesh geometry={g.wing} material={wing} castShadow receiveShadow /></Explode>
      <Explode off={EX.pylon} delay={0}><mesh geometry={g.pylon} material={pyl} castShadow /></Explode>
      <mesh geometry={g.fuel} material={fuelM} />
      <mesh geometry={g.bleed} material={bleedM} />
    </group>
  )
}

/* ------------------------------------------------------------------ flow paths */
export const FUEL_LINE: Vec3[] = [[-1.2, 1.62, -0.07], [-0.6, 1.35, -0.07], [-0.4, 1.0, -0.07], [-0.42, 0.7, -0.06], [-0.48, 0.52, -0.04], [-0.52, 0.476, -0.01]]
const fuelRing: Vec3[] = Array.from({ length: 9 }, (_, i): Vec3 => { const a = 0.06 + (i / 8) * (Math.PI - 0.12); return [-0.52, Math.cos(a) * 0.475, -Math.sin(a) * 0.475] })
const bleedArc = (a: number, r = 1.035): Vec3 => [0.66, Math.cos(a) * r, Math.sin(a) * r]
export const BLEED_LINE: Vec3[] = [[-1.0, 1.62, -0.06], [-0.3, 1.4, -0.07], [0.3, 1.2, -0.09], [0.6, 1.07, -0.14], bleedArc(-0.55), bleedArc(-1.2), bleedArc(-1.9), bleedArc(-2.5), bleedArc(AGB_A - TAU + 0.06), [0.42, Math.cos(AGB_A) * 1.0, Math.sin(AGB_A) * 1.0]]

const lerpTable = (tab: [number, number][]) => (x: number) => {
  if (x >= tab[0][0]) return tab[0][1]
  for (let i = 0; i < tab.length - 1; i++) if (x >= tab[i + 1][0]) { const [x0, a] = tab[i], [x1, b] = tab[i + 1]; return a + ((b - a) * (x - x0)) / (x1 - x0) }
  return tab[tab.length - 1][1]
}
/** core-stream speed factor by axial station: squeezed (dense) through the compressor, fast through turbine & nozzle */
export const coreSpeed = lerpTable([[1.2, 1], [0.85, 1.1], [0.3, 0.75], [0.2, 0.42], [-0.45, 0.42], [-0.6, 0.65], [-0.95, 0.8], [-1.1, 1.5], [-1.6, 1.8], [-1.95, 2.6], [-3, 2.8]])
const CORE_COLS: [number, string][] = [[1.1, '#5fb8ff'], [0.8, '#7cc8ff'], [0.25, '#a8dcff'], [-0.1, '#e8f0c4'], [-0.45, '#ffd36b'], [-0.58, '#ff9a3a'], [-0.8, '#ff4a1a'], [-1.05, '#ff6a2a'], [-1.6, '#d48468'], [-2.1, '#ab9a90'], [-3.2, '#8c8682']]
const coreCols = CORE_COLS.map(([x, c]) => [x, new THREE.Color(c)] as const)
const coolGrey = new THREE.Color('#9fb6c8')
export function coreColorAtX(x: number, out: THREE.Color, lit = 1) {
  if (x >= coreCols[0][0]) out.copy(coreCols[0][1])
  else {
    let done = false
    for (let i = 0; i < coreCols.length - 1 && !done; i++) if (x >= coreCols[i + 1][0]) { const k = (coreCols[i][0] - x) / (coreCols[i][0] - coreCols[i + 1][0]); out.copy(coreCols[i][1]).lerp(coreCols[i + 1][1], k); done = true }
    if (!done) out.copy(coreCols[coreCols.length - 1][1])
  }
  if (x < -0.5 && lit < 1) out.lerp(coolGrey, 1 - lit)
}

function Flows() {
  const lut = CORE()
  const coreColor = (u: number, out: THREE.Color) => coreColorAtX(xAtU(lut, u), out, clamp01(MECH.flame * 4))
  const coreProfile = (u: number) => coreSpeed(xAtU(lut, u))
  const bypassCol = useMemo(() => {
    const a = new THREE.Color('#5fb8ff'), b = new THREE.Color('#9ad8ff')
    return (u: number, out: THREE.Color) => { out.copy(a).lerp(b, Math.sin(u * Math.PI)) }
  }, [])
  const corePaths = useMemo(() => [0.07, 0.62, 1.2, 1.85, 2.5, 3.07].map((th) => ring(CORE_XR, th)), [])
  const bypassPaths = useMemo(() => [0.32, 0.75, 1.2, 1.65, 2.1, 2.55, 2.95].map((th) => ring(BYPASS_XR, th)), [])
  const nozzleFeeds = useMemo(() => [0.06, 0.95, 1.9, 2.8].map((a): Vec3[] => [[-0.52, Math.cos(a) * 0.475, -Math.sin(a) * 0.475], [-0.52, Math.cos(a) * 0.38, -Math.sin(a) * 0.38], [-0.54, Math.cos(a) * 0.3, -Math.sin(a) * 0.3], [-0.6, Math.cos(a) * 0.3, -Math.sin(a) * 0.3]]), [])
  const coreRate = () => 0.25 + 2.4 * (MECH.n1 / 100) + 0.4 * (MECH.n2 / 100)
  const bypassRate = () => 0.3 + 3.4 * (MECH.n1 / 100)
  const coreGate = () => clamp01(MECH.n2 / 10)
  const bypassGate = () => clamp01(MECH.n1 / 4)
  const fuelRate = () => 0.15 + MECH.ff / 2500
  const fuelGate = () => clamp01(MECH.ff / 60)
  const fuelC = solid('#ff8a3d')
  return (
    <group>
      {bypassPaths.map((p, i) => <Flow key={`b${i}`} id="bypass" points={p} color={bypassCol} count={56} size={0.075} rate={bypassRate} jitter={0.075} gate={bypassGate} />)}
      {corePaths.map((p, i) => <Flow key={`c${i}`} id="core" points={p} color={coreColor} count={64} size={0.058} rate={coreRate} profile={coreProfile} jitter={0.022} gate={coreGate} />)}
      <Flow id="fuel" points={FUEL_LINE} color={fuelC} count={40} size={0.045} rate={fuelRate} gate={fuelGate} />
      <Flow id="fuel" points={fuelRing} color={fuelC} count={40} size={0.04} rate={fuelRate} gate={fuelGate} tension={0.5} />
      {nozzleFeeds.map((p, i) => <Flow key={`n${i}`} id="fuel" points={p} color={solid('#ffb070')} count={8} size={0.035} rate={fuelRate} gate={fuelGate} />)}
      <Flow id="air" points={BLEED_LINE} color={solid('#c7e3ff')} count={70} size={0.05} rate={() => 1.2} gate={() => MECH.starter} />
    </group>
  )
}

/** "follow the air": one big highlighted parcel riding the core stream (position from the track) */
function Hero() {
  const g = useRef<THREE.Group>(null!)
  const ball = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, depthTest: false, transparent: true }), [])
  const glow = useMemo(() => new THREE.SpriteMaterial({ map: glowSprite(), color: '#9fdcff', blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false, transparent: true }), [])
  const c = useMemo(() => new THREE.Color(), [])
  useFrame((st) => {
    const on = (S.extra.hero ?? 0) > 0.5
    g.current.visible = on
    if (!on) return
    const x = S.extra.fx ?? 3
    const p = corePoint(x)
    g.current.position.set(p[0], p[1], 0.02)
    coreColorAtX(x, c, clamp01(MECH.flame * 4))
    glow.color.copy(c); ball.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.5)
    const s = 0.22 + Math.sin(st.clock.elapsedTime * 6) * 0.03
    g.current.children[1].scale.setScalar(s)
  })
  return (
    <group ref={g} renderOrder={100}>
      <mesh material={ball} renderOrder={101}><sphereGeometry args={[0.03, 16, 12]} /></mesh>
      <sprite material={glow} renderOrder={100} />
    </group>
  )
}

export function Turbofan() {
  return (
    <group>
      <Mechanism />
      <Nacelle />
      <FanModule />
      <BoosterModule />
      <LPShaft />
      <HPCModule />
      <Combustor />
      <HPTModule />
      <LPTModule />
      <Exhaust />
      <CoreCowl />
      <Airframe />
      <Flows />
      <Hero />
    </group>
  )
}
