import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LabCanvas, LabHeader, Stream, mat, ramp, solid, type LabShot } from './common'
import { cyl, rbox, torus } from '../utils/geom'
import type { Vec3 } from '../data/types'

const CUT = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)]
const clipGlass = (color: string, opacity: number) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.12, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: CUT })
const shell = (color: string) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.45, side: THREE.DoubleSide, clippingPlanes: CUT })

type Zone = 'inlet' | 'fan' | 'compressor' | 'combustion' | 'turbine' | 'exhaust'
const ZONES: { id: Zone; label: string; shot: LabShot; text: string }[] = [
  { id: 'inlet', label: 'INLET', shot: { pos: [-6.2, 1.2, 3.2], target: [-2.4, 0, 0] }, text: 'Воздухозаборник плавно подводит воздух к вентилятору и тормозит его до нужной скорости, даже когда самолёт летит почти со скоростью звука.' },
  { id: 'fan', label: 'FAN', shot: { pos: [-3.6, 0.9, 2.6], target: [-1.6, 0, 0] }, text: 'Вентилятор — самая большая часть двигателя. Большая часть воздуха после него идёт в обход ядра (bypass). Этот холодный поток создаёт основную тягу.' },
  { id: 'compressor', label: 'COMPRESSOR', shot: { pos: [-0.6, 0.8, 1.9], target: [0, 0, 0] }, text: 'Ступени компрессора — ряды маленьких крыльев — сжимают воздух ядра в десятки раз. Каждая ступень немного повышает давление.' },
  { id: 'combustion', label: 'COMBUSTION', shot: { pos: [0.9, 0.7, 1.6], target: [0.9, 0, 0] }, text: 'В кольцевой камере сгорания керосин горит непрерывно. Температура выше точки плавления металла лопаток, поэтому их охлаждают воздухом.' },
  { id: 'turbine', label: 'TURBINE', shot: { pos: [1.9, 0.8, 1.9], target: [1.6, 0, 0] }, text: 'Горячие газы крутят турбины. Турбина высокого давления крутит компрессор (вал N2), турбина низкого давления по валу внутри — вентилятор (вал N1).' },
  { id: 'exhaust', label: 'EXHAUST', shot: { pos: [5.6, 1.0, 3.2], target: [2.6, 0, 0] }, text: 'Газы ядра и холодный поток вентилятора выходят назад. Самолёт толкает вперёд реакция отброшенной массы воздуха.' },
]
const OVERVIEW: LabShot = { pos: [0.2, 2.9, 8.6], target: [1.1, 0, 0] }

const START = [
  ['ENGINE STARTER', 'Сжатый воздух от ВСУ подаётся на воздушный стартер. Он начинает вращать вал высокого давления (N2).'],
  ['COMPRESSOR ROTATION', 'Компрессор раскручивается и начинает прокачивать воздух через ядро.'],
  ['AIRFLOW', 'Поток воздуха через двигатель растёт. Вентилятор пока вращается медленно.'],
  ['FUEL INJECTION', 'При достаточных оборотах N2 открывается подача топлива — 20 форсунок в камере сгорания.'],
  ['IGNITION', 'Свечи воспламенителя поджигают топливо.'],
  ['COMBUSTION', 'Пламя устойчиво горит, температура газов растёт.'],
  ['TURBINE POWER', 'Турбины получают энергию газов и начинают сами крутить компрессор — стартер отключается.'],
  ['FAN SPEED', 'Турбина низкого давления разгоняет вентилятор (N1).'],
  ['THRUST', 'Двигатель на малом газе. Двигайте РУД — тяга растёт.'],
]

interface S { n1: number; n2: number; n1t: number; n2t: number; fuel: number; ign: boolean; a1: number; a2: number; zone: Zone | null }

function Stage({ x, r, n, w = 0.05, color, shaft }: { x: number; r: number; n: number; w?: number; color: string; shaft: 'n1' | 'n2' }) {
  void shaft
  const m = useMemo(() => mat(color, { metalness: 0.85, roughness: 0.25 }), [color])
  return (
    <group position={[x, 0, 0]}>
      <mesh geometry={cyl(r * 0.45, r * 0.45, w, 24)} rotation={[0, 0, Math.PI / 2]} material={m} />
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2
        return <mesh key={i} geometry={rbox(w * 0.7, r * 0.55, w * 1.6, 0.004)} position={[0, Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72]} rotation={[a, 0.5, 0]} material={m} />
      })}
    </group>
  )
}

const Engine = memo(function Engine({ s }: { s: React.MutableRefObject<S> }) {
  const n1 = useRef<THREE.Group>(null!), n2 = useRef<THREE.Group>(null!)
  const flame = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  const light = useRef<THREE.PointLight>(null!)
  const zoneMats = useRef<Record<string, THREE.MeshPhysicalMaterial[]>>({})
  const zm = (z: Zone, m: THREE.MeshPhysicalMaterial) => { (zoneMats.current[z] ||= []).push(m); return m }
  const nacelle = useMemo(() => {
    const pts = [[0.92, -2.55], [1.02, -2.68], [1.1, -2.5], [1.14, -1.6], [1.1, 0.2], [0.98, 1.55], [0.9, 1.6], [0.93, 0.2], [0.96, -1.6], [0.92, -2.55]].map(([r, x]) => new THREE.Vector2(r, x))
    const g = new THREE.LatheGeometry(pts, 64); g.rotateZ(-Math.PI / 2); return g
  }, [])
  const core = useMemo(() => {
    const pts = [[0.36, -1.15], [0.62, -0.55], [0.64, 1.2], [0.5, 2.4], [0.44, 2.6]].map(([r, x]) => new THREE.Vector2(r, x))
    const g = new THREE.LatheGeometry(pts, 56); g.rotateZ(-Math.PI / 2); return g
  }, [])
  const plug = useMemo(() => { const g = new THREE.ConeGeometry(0.3, 1.0, 32); g.rotateZ(-Math.PI / 2); g.translate(2.7, 0, 0); return g }, [])
  const spinner = useMemo(() => { const g = new THREE.ConeGeometry(0.28, 0.55, 32); g.rotateZ(Math.PI / 2); return g }, [])
  const fanMat = useMemo(() => zm('fan', mat('#d4dde6', { metalness: 0.9, roughness: 0.22 })), []) // eslint-disable-line
  useFrame((st, dt) => {
    const k = s.current
    n1.current.rotation.x += k.n1 * dt * 9
    n2.current.rotation.x += k.n2 * dt * 16
    const burn = k.fuel * (k.ign || k.n2 > 0.55 ? 1 : 0)
    flame.opacity = burn * (0.55 + Math.sin(st.clock.elapsedTime * 30) * 0.12)
    light.current.intensity = burn * 7
    Object.entries(zoneMats.current).forEach(([z, ms]) => ms.forEach((m) => { m.emissive.set('#8fd6ff'); m.emissiveIntensity = k.zone === z ? 0.35 + Math.sin(st.clock.elapsedTime * 3) * 0.15 : 0 }))
  })
  return (
    <group>
      <mesh geometry={nacelle} material={zm('inlet', shell('#7d8894'))} />
      <mesh geometry={core} material={zm('turbine', shell('#5d6773'))} />
      <mesh geometry={plug} material={zm('exhaust', mat('#a1785f', { metalness: 0.7 }))} />
      {/* N1 spool: fan, booster, LPT + inner shaft */}
      <group ref={n1}>
        <mesh geometry={spinner} position={[-1.95, 0, 0]} material={mat('#e3e8ee', { metalness: 0.6 })} />
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2
          return <mesh key={i} geometry={rbox(0.06, 0.66, 0.3, 0.01)} position={[-1.65, Math.cos(a) * 0.58, Math.sin(a) * 0.58]} rotation={[a, 0.7, 0]} material={fanMat} />
        })}
        {[-1.2, -1.05, -0.9].map((x) => <Stage key={x} x={x} r={0.52} n={28} color="#c8d6e4" shaft="n1" />)}
        {[1.45, 1.62, 1.79, 1.96].map((x, i) => <Stage key={x} x={x} r={0.42 + i * 0.03} n={30} color="#d6a07f" shaft="n1" />)}
        <mesh geometry={cyl(0.045, 0.045, 3.7, 12)} rotation={[0, 0, Math.PI / 2]} position={[0.2, 0, 0]} material={mat('#6cc6ff', { emissive: new THREE.Color('#6cc6ff'), emissiveIntensity: 0.4 })} />
      </group>
      {/* N2 spool: HPC (9 stages) + HPT + outer shaft */}
      <group ref={n2}>
        {Array.from({ length: 9 }, (_, i) => <Stage key={i} x={-0.55 + i * 0.13} r={0.44 - i * 0.017} n={34} w={0.035} color="#e6edf3" shaft="n2" />)}
        <Stage x={1.25} r={0.38} n={32} color="#ffb27a" shaft="n2" />
        <mesh geometry={cyl(0.1, 0.1, 1.8, 16, )} rotation={[0, 0, Math.PI / 2]} position={[0.35, 0, 0]} material={mat('#ffb27a', { emissive: new THREE.Color('#ff8a3d'), emissiveIntensity: 0.3, transparent: true, opacity: 0.7 })} />
      </group>
      {/* combustor annulus */}
      <mesh geometry={torus(0.36, 0.1, 40)} rotation={[0, Math.PI / 2, 0]} position={[0.9, 0, 0]} material={zm('combustion', clipGlass('#ffcf9e', 0.3))} />
      <mesh geometry={torus(0.36, 0.085, 40)} rotation={[0, Math.PI / 2, 0]} position={[0.92, 0, 0]} material={flame} />
      {Array.from({ length: 20 }, (_, i) => { const a = (i / 20) * Math.PI * 2; return <mesh key={i} geometry={cyl(0.012, 0.012, 0.12, 6)} position={[0.74, Math.cos(a) * 0.36, Math.sin(a) * 0.36]} rotation={[0, 0, Math.PI / 2]} material={mat('#ff8a3d')} /> })}
      <pointLight ref={light} position={[0.9, 0.4, 0.4]} color="#ff8a3d" distance={3} intensity={0} />
      {/* zone tint holders for compressor */}
      <mesh geometry={cyl(0.47, 0.32, 1.2, 40, )} rotation={[0, 0, Math.PI / 2]} position={[0.0, 0, 0]} material={zm('compressor', clipGlass('#9fd8ff', 0.1))} />
    </group>
  )
})

function useStreams() {
  return useMemo(() => {
    const bypass: Vec3[][] = []
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, r0 = 0.62 + (i % 3) * 0.1
      const p = (x: number, r: number): Vec3 => [x, Math.cos(a) * r, Math.sin(a) * r]
      bypass.push([p(-4.4, r0 + 0.1), p(-2.6, r0), p(-1.6, r0 + 0.02), p(-0.6, 0.8), p(0.8, 0.8), p(1.6, 0.78), p(3.0, 0.82), p(4.6, 0.86)])
    }
    const core: Vec3[][] = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3
      const p = (x: number, r: number): Vec3 => [x, Math.cos(a) * r, Math.sin(a) * r]
      core.push([p(-4.4, 0.32), p(-2.0, 0.34), p(-1.3, 0.42), p(-0.6, 0.38), p(0.5, 0.33), p(0.9, 0.36), p(1.3, 0.36), p(2.0, 0.44), p(2.8, 0.36), p(4.6, 0.25)])
    }
    return { bypass, core }
  }, [])
}

function Physics({ s }: { s: React.MutableRefObject<S> }) {
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05), k = s.current
    k.n2 += (k.n2t - k.n2) * (1 - Math.exp(-dt * 0.9))
    k.n1 += (k.n1t - k.n1) * (1 - Math.exp(-dt * 0.7))
  })
  return null
}

export function TurbofanLab({ onClose }: { onClose: () => void }) {
  const s = useRef<S>({ n1: 0.25, n2: 0.62, n1t: 0.25, n2t: 0.62, fuel: 1, ign: false, a1: 0, a2: 0, zone: null })
  const [shot, setShot] = useState<LabShot>(OVERVIEW)
  const [zone, setZone] = useState<Zone | null>(null)
  const [core, setCore] = useState(true)
  const [bypass, setBypass] = useState(true)
  const [seq, setSeq] = useState<number | null>(null)
  const [lever, setLever] = useState(0)
  const [ui, setUi] = useState({ n1: 0, n2: 0 })
  const { bypass: bp, core: cp } = useStreams()
  useEffect(() => { const id = setInterval(() => setUi({ n1: Math.round(s.current.n1 * 100), n2: Math.round(s.current.n2 * 100) }), 120); return () => clearInterval(id) }, [])
  useEffect(() => { s.current.zone = zone }, [zone])
  // START ENGINE sequence drives the spools step by step
  useEffect(() => {
    if (seq === null) return
    const k = s.current
    const plan: Partial<S>[] = [
      { n2t: 0.08, n1t: 0.0, fuel: 0, ign: false }, { n2t: 0.18, n1t: 0.02 }, { n2t: 0.22, n1t: 0.05 }, { fuel: 0.4 }, { ign: true, fuel: 0.6 },
      { fuel: 1, n2t: 0.4 }, { n2t: 0.58, ign: false }, { n1t: 0.22 }, { n1t: 0.25, n2t: 0.62 },
    ]
    if (seq === 0) Object.assign(k, { n1: 0, n2: 0, fuel: 0, ign: false })
    Object.assign(k, plan[seq])
    const zoneFor: (Zone | null)[] = [null, 'compressor', 'inlet', 'combustion', 'combustion', 'combustion', 'turbine', 'fan', 'exhaust']
    setZone(zoneFor[seq])
    if (seq < START.length - 1) { const t = setTimeout(() => setSeq(seq + 1), 2800); return () => clearTimeout(t) }
  }, [seq])
  useEffect(() => { if (seq === null || seq === START.length - 1) { s.current.n1t = 0.25 + lever * 0.75; s.current.n2t = 0.62 + lever * 0.36 } }, [lever, seq])
  const rate = (kind: 'core' | 'bypass') => () => (s.current.n1 * 4.5 + (kind === 'core' ? s.current.n2 * 1.5 : 0))
  const coreColor = useMemo(() => ramp([[0, '#9fdcff'], [0.35, '#d7f0ff'], [0.5, '#ffd8a8'], [0.56, '#ff8a3d'], [0.7, '#ff5a2a'], [1, '#b9a59c']]), [])
  const zinfo = ZONES.find((z) => z.id === zone)
  return (
    <>
      <LabCanvas shot={shot} clip>
        <Physics s={s} />
        <Engine s={s} />
        {bp.map((p, i) => <Stream key={`b${i}`} points={p} rate={rate('bypass')} visible={() => bypass && s.current.n1 > 0.03} color={solid('#6cc6ff')} count={60} size={0.07} jitter={0.04} />)}
        {cp.map((p, i) => <Stream key={`c${i}`} points={p} rate={rate('core')} visible={() => core && s.current.n2 > 0.05} color={(u, out) => { coreColor(u, out); if (u > 0.5 && s.current.fuel * (s.current.ign || s.current.n2 > 0.55 ? 1 : 0) < 0.1) out.set('#9fdcff') }} count={36} size={0.07} jitter={0.03} />)}
      </LabCanvas>
      <LabHeader eyebrow="JET ENGINE · REPRESENTATIVE CFM56-5B" title={seq !== null ? 'From fuel to thrust' : zinfo ? zinfo.label : 'How a turbofan works'} onClose={onClose}
        text="Половина корпуса срезана. Голубые частицы — холодный поток вентилятора (bypass), он создаёт основную тягу. Внутренний поток (core) сжимается, нагревается в камере сгорания и крутит турбины." />
      <div className="lab-side glass">
        {seq !== null ? (
          <>
            <span className="eyebrow">START ENGINE · STEP {seq + 1} / {START.length}</span>
            <h3>{START[seq][0]}</h3>
            <p>{START[seq][1]}</p>
          </>
        ) : zinfo ? (
          <>
            <span className="eyebrow">ZONE</span>
            <h3>{zinfo.label}</h3>
            <p>{zinfo.text}</p>
          </>
        ) : (
          <>
            <span className="eyebrow">CORE FLOW vs BYPASS FLOW</span>
            <h3>≈ 6 : 1</h3>
            <p>Примерно на каждый килограмм воздуха через горячее ядро приходится около шести килограммов холодного воздуха мимо него. Этот обходной поток даёт большую часть тяги — около 80% у таких двигателей.</p>
          </>
        )}
        <div className="readout">
          <div><b>{ui.n1}%</b><span>N1 · FAN</span></div>
          <div><b>{ui.n2}%</b><span>N2 · CORE</span></div>
          <div><b>{Math.round(Math.max(0, (ui.n1 - 20) / 80) * 100)}%</b><span>THRUST ≈</span></div>
        </div>
      </div>
      <div className="lab-dock">
        {seq !== null && (
          <div className="tray glass">{START.map(([t], i) => <span key={t} className={`btn sm ${i === seq ? 'on' : i < seq ? '' : 'off'}`} style={{ pointerEvents: 'none' }}>{i + 1}. {t}</span>)}</div>
        )}
        <div className="tray glass">
          {ZONES.map((z) => <button key={z.id} className={`btn sm ${zone === z.id ? 'on' : ''}`} onClick={() => { setSeq(null); setZone(z.id); setShot(z.shot) }}>{z.label}</button>)}
          <button className="btn sm ghost" onClick={() => { setZone(null); setShot(OVERVIEW) }}>Overview</button>
        </div>
        <div className="tray glass">
          <button className={`btn sm ${core ? 'on' : ''}`} onClick={() => setCore(!core)}>Core flow</button>
          <button className={`btn sm ${bypass ? 'on' : ''}`} onClick={() => setBypass(!bypass)}>Bypass flow</button>
          <button className="btn primary" onClick={() => { setShot(OVERVIEW); setSeq(0) }}>Start engine</button>
          <label className="range" htmlFor="thrust-lever">THRUST LEVER
            <input id="thrust-lever" type="range" min={0} max={1} step={0.01} value={lever} onChange={(e) => setLever(+e.target.value)} disabled={seq !== null && seq < START.length - 1} />
          </label>
        </div>
      </div>
    </>
  )
}
