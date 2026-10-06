import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LabCanvas, LabHeader, Stream, glass, mat, solid } from './common'
import { cyl, glowSprite, sphere, torus } from '../utils/geom'

type Mode = 'diesel' | 'petrol'
const B = 0.42, R = 0.26, ROD = 0.78
const SWEPT = 2 * R
const CR: Record<Mode, number> = { diesel: 15.6, petrol: 10.2 }
const pinY = (a: number) => R * Math.cos(a) + Math.sqrt(ROD * ROD - (R * Math.sin(a)) ** 2)
const TOP_TDC = pinY(0) + 0.2
const deckOf = (m: Mode) => TOP_TDC + SWEPT / (CR[m] - 1)

const D2R = Math.PI / 180
/** cycle angle in degrees 0..720 → events */
export function events(mode: Mode, A: number) {
  const stroke = Math.floor(A / 180) // 0 intake, 1 compression, 2 power, 3 exhaust
  const bump = (a0: number, a1: number) => (A >= a0 && A <= a1 ? Math.sin(((A - a0) / (a1 - a0)) * Math.PI) : 0)
  const inLift = bump(0, 190), exLift = bump(530, 720)
  const inject = mode === 'diesel' ? A > 345 && A < 378 : A > 60 && A < 140
  const spark = mode === 'petrol' && A > 343 && A < 352
  const burn = mode === 'diesel' ? (A > 356 && A < 440 ? 1 - (A - 356) / 84 : 0) : (A > 350 && A < 420 ? 1 - (A - 350) / 70 : 0)
  // illustrative cylinder pressure, bar: polytropic compression + combustion bump decaying with expansion
  const a = A * D2R
  const top = pinY(a) + 0.2, deck = deckOf(mode)
  const vol = deck - top, vMax = deck - (pinY(Math.PI) + 0.2)
  let p = stroke === 0 ? 0.95 : stroke === 3 ? 1.1 : Math.pow(vMax / vol, 1.35)
  if (stroke === 2 || (stroke === 1 && A > 352)) {
    const peak = mode === 'diesel' ? 150 : 75
    const vTdc = deck - TOP_TDC
    const start = mode === 'diesel' ? 358 : 350
    if (A > start) p = Math.max(p, peak * Math.min(1, (A - start) / 14) * Math.pow(vTdc / vol, 1.3))
  }
  return { stroke, inLift, exLift, inject, spark, burn, p, top, deck }
}

const STROKES = [
  { n: '1', k: 'INTAKE', c: '#6cc6ff' },
  { n: '2', k: 'COMPRESSION', c: '#9fd8ff' },
  { n: '3', k: 'POWER', c: '#ff8a3d' },
  { n: '4', k: 'EXHAUST', c: '#c49a8f' },
]

const Cylinder = memo(function Cylinder({ mode, x, clock }: { mode: Mode; x: number; clock: { a: number } }) {
  const deck = deckOf(mode)
  const piston = useRef<THREE.Group>(null!)
  const rod = useRef<THREE.Mesh>(null!)
  const crank = useRef<THREE.Group>(null!)
  const vIn = useRef<THREE.Group>(null!), vEx = useRef<THREE.Group>(null!)
  const camIn = useRef<THREE.Group>(null!), camEx = useRef<THREE.Group>(null!)
  const gas = useRef<THREE.Mesh>(null!)
  const flash = useRef<THREE.Mesh>(null!)
  const light = useRef<THREE.PointLight>(null!)
  const spark = useRef<THREE.Sprite>(null!)
  const gasMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#6cc6ff', transparent: true, opacity: 0.18, emissive: '#6cc6ff', emissiveIntensity: 0.2, depthWrite: false, side: THREE.DoubleSide }), [])
  const sparkMat = useMemo(() => new THREE.SpriteMaterial({ map: glowSprite(), color: '#fff3c4', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  const flashMat = useMemo(() => new THREE.MeshBasicMaterial({ color: mode === 'diesel' ? '#ff7a2e' : '#ffb347', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [mode])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  // air "molecules" living in the gas volume: they get squeezed together on compression
  const N = 140
  const mol = useMemo(() => Array.from({ length: N }, () => ({ r: Math.sqrt(Math.random()) * (B - 0.04), th: Math.random() * Math.PI * 2, v: Math.random(), w: 0.6 + Math.random() })), [])
  const molGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); return g }, [])
  const molMat = useMemo(() => new THREE.PointsMaterial({ size: 0.045, map: glowSprite(), color: '#9fdcff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [])
  const cold = useMemo(() => new THREE.Color('#9fdcff'), []), hot = useMemo(() => new THREE.Color('#ffb070'), []), fire = useMemo(() => new THREE.Color('#ff5a2a'), []), smoke = useMemo(() => new THREE.Color('#b9a59c'), []), fuelC = useMemo(() => new THREE.Color('#ffb27a'), [])

  useFrame((_, dt) => {
    const A = clock.a
    const e = events(mode, A)
    const a = A * D2R
    const py = pinY(a)
    piston.current.position.y = py
    const px = R * Math.sin(a), pyc = R * Math.cos(a)
    crank.current.rotation.z = -a
    tmp.set(0 - px, py - pyc, 0).normalize()
    rod.current.quaternion.setFromUnitVectors(up, tmp)
    rod.current.position.set(px / 2, (py + pyc) / 2, 0)
    vIn.current.position.y = -e.inLift * 0.1
    vEx.current.position.y = -e.exLift * 0.1
    camIn.current.rotation.z = -a / 2; camEx.current.rotation.z = -a / 2 + 1.2
    const h = Math.max(0.005, deck - e.top)
    gas.current.scale.y = h
    gas.current.position.y = e.top + h / 2
    // gas colour by state
    const comp = e.stroke === 1 ? (A - 180) / 180 : 0
    if (e.burn > 0) { gasMat.color.copy(fire); gasMat.emissive.copy(fire); gasMat.emissiveIntensity = 0.6 + e.burn * 2.5; gasMat.opacity = 0.3 + e.burn * 0.4 }
    else if (e.stroke === 3) { gasMat.color.copy(smoke); gasMat.emissive.copy(smoke); gasMat.emissiveIntensity = 0.15; gasMat.opacity = 0.22 }
    else if (e.stroke === 2) { gasMat.color.copy(hot); gasMat.emissive.copy(hot); gasMat.emissiveIntensity = 0.25; gasMat.opacity = 0.2 }
    else { gasMat.color.copy(cold).lerp(hot, comp * (mode === 'diesel' ? 0.8 : 0.35)); gasMat.emissive.copy(gasMat.color); gasMat.emissiveIntensity = 0.15 + comp * (mode === 'diesel' ? 0.6 : 0.25); gasMat.opacity = 0.16 + comp * 0.12 }
    if (mode === 'petrol' && e.stroke <= 1 && A > 70) gasMat.color.lerp(fuelC, 0.25)
    flashMat.opacity = e.burn * 0.9
    flash.current.scale.setScalar(0.15 + (1 - e.burn) * 0.5)
    flash.current.visible = e.burn > 0.01
    light.current.intensity = e.burn * 18 + (e.spark ? 6 : 0)
    spark.current.visible = e.spark
    spark.current.scale.setScalar(0.25 + Math.random() * 0.15)
    // molecules: keep relative height in the shrinking/growing volume, swirl
    const P = molGeo.attributes.position as THREE.BufferAttribute
    mol.forEach((m, i) => {
      m.th += dt * m.w * (0.6 + e.burn * 5)
      P.setXYZ(i, Math.cos(m.th) * m.r, e.top + 0.02 + m.v * (h - 0.03), Math.sin(m.th) * m.r)
    })
    P.needsUpdate = true
    const col = e.burn > 0.05 ? fire : e.stroke === 3 ? smoke : e.stroke === 2 ? hot : cold.clone().lerp(hot, comp * (mode === 'diesel' ? 0.9 : 0.4))
    molMat.color.copy(col)
    molMat.size = 0.04 + (e.stroke === 1 ? comp * 0.02 : 0) + e.burn * 0.03
  })

  const metal = useMemo(() => mat('#aeb8c2', { metalness: 0.85, roughness: 0.3 }), [])
  const dark = useMemo(() => mat('#3b444e', { metalness: 0.6, roughness: 0.45 }), [])
  const accentIn = useMemo(() => mat('#6cc6ff', { metalness: 0.5, roughness: 0.3, emissive: new THREE.Color('#6cc6ff'), emissiveIntensity: 0.15 }), [])
  const accentEx = useMemo(() => mat('#ff9b6b', { metalness: 0.5, roughness: 0.3, emissive: new THREE.Color('#ff7b54'), emissiveIntensity: 0.15 }), [])
  const portIn = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.18, deck + 0.03, 0), new THREE.Vector3(-0.3, deck + 0.22, 0), new THREE.Vector3(-0.8, deck + 0.34, 0)]), 24, 0.1, 14), [deck])
  const portEx = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.18, deck + 0.03, 0), new THREE.Vector3(0.3, deck + 0.22, 0), new THREE.Vector3(0.8, deck + 0.34, 0)]), 24, 0.1, 14), [deck])
  const inPath = useMemo(() => [[-1.1, deck + 0.36, 0], [-0.55, deck + 0.3, 0], [-0.22, deck + 0.1, 0], [-0.1, deck - 0.12, 0.05], [0.05, deck - 0.3, -0.05]] as [number, number, number][], [deck])
  const exPath = useMemo(() => [[-0.05, deck - 0.25, 0], [0.12, deck - 0.05, 0], [0.24, deck + 0.12, 0], [0.55, deck + 0.3, 0], [1.15, deck + 0.38, 0]] as [number, number, number][], [deck])
  const sprayPaths = useMemo(() => {
    if (mode === 'diesel') return [-40, -15, 15, 40].map((d) => [[0, deck - 0.01, 0], [Math.sin(d * D2R) * 0.2, deck - 0.05, Math.cos(d * D2R) * 0.05], [Math.sin(d * D2R) * 0.38, deck - 0.1, Math.cos(d * D2R) * 0.12]] as [number, number, number][])
    return [-10, 10, 30].map((d) => [[-0.34, deck - 0.03, 0.12], [-0.12, deck - 0.12, 0.08 + d / 400], [0.15, deck - 0.24, d / 300]] as [number, number, number][])
  }, [mode, deck])
  const ev = () => events(mode, clock.a)

  return (
    <group position={[x, 0, 0]}>
      {/* liner + head shell */}
      <mesh geometry={cyl(B + 0.02, B + 0.02, deck - 0.5, 48)} position={[0, (deck + 0.5) / 2, 0]} material={glass('#9fb6c8', 0.14)} />
      <mesh geometry={cyl(B + 0.06, B + 0.06, 0.03, 48)} position={[0, 0.5, 0]} material={dark} />
      <mesh position={[0, deck + 0.24, 0]} material={glass('#b8c7d4', 0.12)}><boxGeometry args={[1.25, 0.48, 1.0]} /></mesh>
      <mesh geometry={portIn} material={glass('#6cc6ff', 0.18)} />
      <mesh geometry={portEx} material={glass('#ff9b6b', 0.18)} />
      {/* gas volume */}
      <mesh ref={gas} material={gasMat}><cylinderGeometry args={[B - 0.012, B - 0.012, 1, 40, 1, true]} /></mesh>
      <points geometry={molGeo} material={molMat} frustumCulled={false} />
      {/* piston + rings */}
      <group ref={piston}>
        <mesh geometry={cyl(B - 0.006, B - 0.006, 0.34, 48)} position={[0, 0.03, 0]} material={metal} />
        {[0.16, 0.12, 0.08].map((y) => <mesh key={y} geometry={torus(B - 0.004, 0.006, 48)} rotation={[Math.PI / 2, 0, 0]} position={[0, y, 0]} material={dark} />)}
        {mode === 'diesel' && <mesh geometry={sphere(0.16, 24)} scale={[1, 0.25, 1]} position={[0, 0.2, 0]} material={dark} />}
        <mesh geometry={cyl(0.05, 0.05, 0.3, 16)} rotation={[Math.PI / 2, 0, 0]} material={dark} />
      </group>
      <mesh ref={rod} material={mat('#7f8c99', { metalness: 0.7 })}><boxGeometry args={[0.07, ROD, 0.09]} /></mesh>
      {/* crankshaft */}
      <group ref={crank}>
        <mesh geometry={cyl(0.09, 0.09, 0.7, 24)} rotation={[Math.PI / 2, 0, 0]} material={metal} />
        {[0.13, -0.13].map((z) => (
          <group key={z} position={[0, 0, z]}>
            <mesh material={dark} position={[0, 0.1, 0]}><boxGeometry args={[0.2, 0.42, 0.06]} /></mesh>
            <mesh material={dark} position={[0, -0.18, 0]}><cylinderGeometry args={[0.26, 0.26, 0.06, 24, 1, false, Math.PI * 0.6, Math.PI * 0.8]} /></mesh>
          </group>
        ))}
        <mesh geometry={cyl(0.06, 0.06, 0.24, 16)} rotation={[Math.PI / 2, 0, 0]} position={[0, R, 0]} material={metal} />
      </group>
      {/* valves + cams */}
      <group ref={vIn} position={[-0.18, 0, 0]}>
        <mesh geometry={cyl(0.13, 0.04, 0.04, 28)} position={[0, deck + 0.012, 0]} material={accentIn} />
        <mesh geometry={cyl(0.018, 0.018, 0.55, 10)} position={[0, deck + 0.3, 0]} material={accentIn} />
      </group>
      <group ref={vEx} position={[0.18, 0, 0]}>
        <mesh geometry={cyl(0.12, 0.04, 0.04, 28)} position={[0, deck + 0.012, 0]} material={accentEx} />
        <mesh geometry={cyl(0.018, 0.018, 0.55, 10)} position={[0, deck + 0.3, 0]} material={accentEx} />
      </group>
      {[[-0.18, camIn], [0.18, camEx]].map(([cx, ref], i) => (
        <group key={i} position={[cx as number, deck + 0.68, 0]} ref={ref as React.RefObject<THREE.Group>}>
          <mesh geometry={cyl(0.04, 0.04, 0.5, 14)} rotation={[Math.PI / 2, 0, 0]} material={metal} />
          <mesh material={metal} position={[0, -0.04, 0]}><boxGeometry args={[0.08, 0.16, 0.08]} /></mesh>
        </group>
      ))}
      {/* injector / spark plug / glow plug */}
      {mode === 'diesel' ? (
        <>
          <mesh geometry={cyl(0.04, 0.025, 0.6, 16)} position={[0, deck + 0.3, 0]} material={mat('#ffcfa1', { metalness: 0.7 })} />
          <mesh geometry={cyl(0.015, 0.012, 0.3, 10)} position={[0.12, deck + 0.12, 0.26]} rotation={[0.5, 0, -0.3]} material={mat('#ff5a2a', { emissive: new THREE.Color('#ff5a2a'), emissiveIntensity: 0.6 })} />
        </>
      ) : (
        <>
          <mesh geometry={cyl(0.035, 0.03, 0.55, 16)} position={[0, deck + 0.28, 0]} material={mat('#e9e2f7', { metalness: 0.5 })} />
          <mesh geometry={cyl(0.03, 0.02, 0.4, 14)} position={[-0.44, deck + 0.04, 0.15]} rotation={[0, 0, -1.0]} material={mat('#ffcfa1', { metalness: 0.7 })} />
        </>
      )}
      <sprite ref={spark} material={sparkMat} position={[0, deck - 0.01, 0]} visible={false} />
      <mesh ref={flash} geometry={sphere(0.5, 24)} position={[0, deck - 0.03, 0]} scale={[1, 0.3, 1]} material={flashMat} />
      <pointLight ref={light} position={[0, deck - 0.05, 0]} color="#ff9a4a" intensity={0} distance={2.4} />
      {/* streams */}
      <Stream points={inPath} rate={() => ev().inLift * 2.2} visible={() => ev().inLift > 0.05} color={solid('#6cc6ff')} count={50} size={0.05} jitter={0.05} />
      <Stream points={exPath} rate={() => ev().exLift * 2.2} visible={() => ev().exLift > 0.05} color={solid('#c9a99c')} count={50} size={0.05} jitter={0.05} />
      {sprayPaths.map((p, i) => <Stream key={i} points={p} rate={() => 3} visible={() => ev().inject} color={solid('#ff9a3d')} count={22} size={0.04} jitter={0.02} />)}
    </group>
  )
})

function Driver({ clock, speed }: { clock: { a: number }; speed: number }) {
  useFrame((_, dt) => { clock.a = (clock.a + Math.min(dt, 0.05) * 225 * speed) % 720 })
  return null
}

const COMPARE: [string, string, string][] = [
  ['Fuel', 'Дизельное топливо', 'Бензин'],
  ['Ignition', 'От сжатия (сам)', 'Искра свечи'],
  ['Compression', '≈ 15–18 : 1', '≈ 9–12 : 1'],
  ['Mixture', 'Сжимается чистый воздух', 'Воздух + бензин'],
  ['Injection', 'Прямой, ~2000 бар', 'Прямой, ~200–350 бар или во впуск'],
  ['Efficiency', 'Выше', 'Ниже'],
  ['Torque', 'Много на низких оборотах', 'Меньше внизу, «крутится» выше'],
  ['RPM', 'Ниже (≈4–5 тыс.)', 'Выше (≈6–7 тыс.)'],
]

export function CylinderLab({ initial, onClose }: { initial: Mode | 'compare'; onClose: () => void }) {
  const [view, setView] = useState<Mode | 'compare'>(initial)
  const [slow, setSlow] = useState(false)
  const [paused, setPaused] = useState(false)
  const clock = useMemo(() => ({ a: 0 }), [])
  const [ui, setUi] = useState({ A: 0, stroke: 0, p: 1, note: '' })
  useEffect(() => {
    const id = setInterval(() => {
      const m: Mode = view === 'petrol' ? 'petrol' : 'diesel'
      const e = events(m, clock.a)
      const note = e.inject ? (m === 'diesel' ? 'INJECTION → SELF-IGNITION' : 'FUEL INJECTION') : e.spark ? 'IGNITION · SPARK' : e.burn > 0.1 ? 'COMBUSTION' : ''
      setUi({ A: clock.a, stroke: e.stroke, p: e.p, note })
    }, 80)
    return () => clearInterval(id)
  }, [view, clock])
  const speed = paused ? 0 : slow ? 0.22 : 1
  const shot = view === 'compare' ? { pos: [1.5, 1.9, 8.2] as [number, number, number], target: [1.25, 0.75, 0] as [number, number, number] } : { pos: [3.3, 2.3, 5.0] as [number, number, number], target: [0.75, 0.8, 0] as [number, number, number] }
  const texts: Record<number, [string, string]> = view === 'petrol' ? {
    0: ['Впуск', 'Впускной клапан открыт, поршень идёт вниз и засасывает воздух. Форсунка впрыскивает бензин прямо в цилиндр.'],
    1: ['Сжатие', 'Клапаны закрыты, поршень сжимает смесь воздуха и бензина примерно в 10 раз.'],
    2: ['Рабочий ход', 'Свеча даёт искру, смесь сгорает, газы расширяются и толкают поршень вниз.'],
    3: ['Выпуск', 'Выпускной клапан открыт, поршень выталкивает отработавшие газы.'],
  } : {
    0: ['Впуск', 'Впускной клапан открыт, поршень идёт вниз. В цилиндр поступает только воздух.'],
    1: ['Сжатие', 'Клапаны закрыты. Воздух сжимается примерно в 15–16 раз и раскаляется до 700–900 °C — посмотрите, как «молекулы» сжимаются и краснеют.'],
    2: ['Рабочий ход', 'Форсунка впрыскивает дизель в раскалённый воздух — он вспыхивает сам, без искры. Давление толкает поршень вниз.'],
    3: ['Выпуск', 'Выпускной клапан открыт, газы уходят к турбине.'],
  }
  return (
    <>
      <LabCanvas shot={shot}>
        <Driver clock={clock} speed={speed} />
        {view === 'compare' ? (
          <>
            <Cylinder mode="diesel" x={-1.35} clock={clock} />
            <Cylinder mode="petrol" x={1.35} clock={clock} />
          </>
        ) : <Cylinder mode={view} x={0} clock={clock} />}
      </LabCanvas>
      <LabHeader eyebrow={view === 'compare' ? 'DIESEL VS PETROL' : 'INSIDE THE CYLINDER'} title={view === 'compare' ? 'Diesel vs petrol' : view === 'diesel' ? 'Diesel: fire without a spark' : 'Petrol: a spark creates power'}
        text={view === 'compare' ? 'Два цилиндра синхронно проходят четыре такта. Слева дизель (сжатие сильнее, воспламенение от тепла), справа бензин (искра).' : 'Стенки двигателя прозрачные. Поршень, шатун, коленвал, клапаны и распредвалы движутся по-настоящему, точки внутри — молекулы воздуха.'} onClose={onClose}>
        <div className="seg" style={{ minWidth: 330 }}>
          <button className={view === 'diesel' ? 'on' : ''} onClick={() => setView('diesel')}>Diesel</button>
          <button className={view === 'petrol' ? 'on' : ''} onClick={() => setView('petrol')}>Petrol</button>
          <button className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>Compare</button>
        </div>
      </LabHeader>
      {view === 'compare' && (
        <div className="lab-side glass" style={{ width: 400 }}>
          <span className="eyebrow">TYPICAL VALUES · REPRESENTATIVE</span>
          <div className="cmp-table">
            <div className="h" /><div className="h">DIESEL</div><div className="h">PETROL</div>
            {COMPARE.map(([k, d, p]) => [<div key={k} className="h">{k.toUpperCase()}</div>, <div key={k + 'd'} className="d">{d}</div>, <div key={k + 'p'} className="p">{p}</div>])}
          </div>
        </div>
      )}
      {view !== 'compare' && (
        <div className="lab-side glass">
          <span className="eyebrow">{Math.round(ui.A)}° crank · {ui.note || STROKES[ui.stroke].k}</span>
          <h3>{texts[ui.stroke][0]}</h3>
          <p>{texts[ui.stroke][1]}</p>
          <div className="readout">
            <div><b>{ui.p < 10 ? ui.p.toFixed(1) : Math.round(ui.p)}</b><span>BAR · ≈ ILLUSTRATIVE</span></div>
            <div><b>{CR[view]}:1</b><span>COMPRESSION</span></div>
          </div>
          <div className="gauge-track"><i style={{ width: `${Math.min(100, (ui.p / 160) * 100)}%`, transition: 'width .1s linear' }} /></div>
        </div>
      )}
      <div className="lab-dock">
        <div className="strokes">
          {STROKES.map((s, i) => (
            <div key={s.k} className={`stroke ${ui.stroke === i ? 'on' : ''}`} style={{ ['--c' as string]: s.c }}><b>{s.n}</b><span>{s.k}</span></div>
          ))}
        </div>
        <div className="tray glass">
          <button className={`btn sm ${slow ? 'on' : ''}`} onClick={() => setSlow(!slow)}>Slow motion</button>
          <button className="btn sm" onClick={() => setPaused(!paused)}>{paused ? 'Play' : 'Pause'}</button>
          <span className="lbl">{view === 'compare' ? 'typical values · representative' : 'pressures are illustrative'}</span>
        </div>
      </div>
    </>
  )
}
