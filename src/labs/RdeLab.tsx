import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LabCanvas, LabHeader, Stream, mat, ramp, solid, type LabShot } from './common'
import { cyl, torus } from '../utils/geom'
import { useT, T, type Txt } from '../explorer/i18n'
import type { Vec3 } from '../data/types'

/*
 * Rotating detonation turbo-generator of the «Вихрь-240» (Vortex-240), cut open.
 *
 * Hydrogen and air are injected axially into an annular channel. A detonation wave — a shock with combustion
 * attached to it — runs round the annulus at ≈ 2 km/s, burning the fresh layer in front of it in microseconds.
 * Behind it the hot, high-pressure products expand axially out of the channel; injection refills the layer before
 * the wave comes round again (several hundred times a second per wave). The products drive a turbine; the turbine
 * spins a superconducting generator cooled by the liquid hydrogen on its way to the injectors; cables carry the
 * power to eight fans. Animated slowed down by the chosen factor.
 */

const CUT = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)]
const shell = (color: string, o = 1) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide, clippingPlanes: CUT, transparent: o < 1, opacity: o, depthWrite: o === 1 })
const R_IN = 0.46, R_OUT = 0.62, L = 0.9 // annulus: radii and length, m
const NA = 96, NX = 10 // cells round and along the channel
const V_CJ = 1970 // Chapman–Jouguet speed of a stoichiometric hydrogen–air detonation, m/s

type Step = 'inject' | 'wave' | 'expand' | 'turbine' | 'gen' | 'cool' | 'cycle'
const STEPS: { id: Step; shot: LabShot; title: Txt; text: Txt }[] = [
  { id: 'inject', shot: { pos: [-1.5, 0.6, 1.4], target: [0.15, 0, 0] }, title: T('1 · Впрыск', '1 · Injection'),
    text: T('Через сотни отверстий в днище кольцевого канала идут воздух от компрессора и водород. Они смешиваются тонким слоем у днища — синие ячейки. Клапанов нет: канал открыт всегда.', 'Air from the compressor and hydrogen enter through hundreds of holes in the floor of the annular channel. They mix into a thin layer near the floor — the blue cells. There are no valves: the channel is always open.') },
  { id: 'wave', shot: { pos: [-0.3, 1.25, 1.2], target: [0.2, 0, 0] }, title: T('2 · Детонационная волна', '2 · The detonation wave'),
    text: T(`Белая полоса — ударная волна со «встроенным» горением. Она бежит по кругу со скоростью ≈ ${V_CJ} м/с и сжигает свежий слой за микросекунды: давление за волной в ≈ 15 раз выше, температура ≈ 2900 K. Обычное пламя в турбовентиляторе — медленный «костёр» при постоянном давлении; детонация — сгорание почти при постоянном объёме, и она сама поднимает давление.`, `The white band is a shock wave with combustion attached to it. It runs round at ≈ ${V_CJ} m/s and burns the fresh layer within microseconds: pressure behind the wave is ≈ 15× higher, temperature ≈ 2900 K. An ordinary turbofan flame is a slow "bonfire" at constant pressure; a detonation burns at nearly constant volume and itself raises the pressure.`) },
  { id: 'expand', shot: { pos: [0.9, 0.7, 1.5], target: [0.7, 0, 0] }, title: T('3 · Расширение и подпитка', '3 · Expansion and refill'),
    text: T('За волной горячие продукты (оранжевые) расширяются и уходят по каналу назад, по спирали. Давление у днища падает, впрыск снова открывается сам — и к следующему приходу волны слой смеси уже восстановлен. Несколько волн могут бежать одновременно: их число устанавливается само в зависимости от расхода.', 'Behind the wave the hot products (orange) expand and leave down the channel in a spiral. Pressure at the floor drops, injection resumes by itself — and by the time the wave comes round again the mixture layer is back. Several waves can run at once: their number settles by itself with the flow rate.') },
  { id: 'turbine', shot: { pos: [1.7, 0.8, 1.6], target: [1.45, 0, 0] }, title: T('4 · Турбина', '4 · Turbine'),
    text: T('Поток после камеры пульсирует сотни раз в секунду. Направляющий аппарат сглаживает его, турбина забирает работу и крутит вал. Так как давление на входе в турбину выше, чем после обычной камеры, при той же степени сжатия компрессора получается больше работы на килограмм топлива.', 'The flow out of the combustor pulses hundreds of times a second. The nozzle guide vanes smooth it, the turbine extracts work and turns the shaft. Because the turbine inlet pressure is higher than after an ordinary combustor, the same compressor ratio yields more work per kilogram of fuel.') },
  { id: 'gen', shot: { pos: [2.6, 0.8, 1.7], target: [2.35, 0, 0] }, title: T('5 · Сверхпроводящий генератор', '5 · Superconducting generator'),
    text: T('Вал крутит генератор, обмотки которого — сверхпроводник при −253 °C: ток течёт без сопротивления, КПД ≈ 99,5 %, генератор в несколько раз легче медного. Голубые кабели несут ток к восьми вентиляторам на спине самолёта; любой генератор питает любой вентилятор.', 'The shaft drives a generator whose windings are a superconductor at −253 °C: current flows with no resistance, ≈ 99.5 % efficient, several times lighter than copper. The cyan cables carry the power to eight fans on the aircraft’s back; any generator can feed any fan.') },
  { id: 'cool', shot: { pos: [1.6, 1.5, 2.2], target: [1.2, 0, 0] }, title: T('6 · Водород охлаждает и горит', '6 · Hydrogen cools, then burns'),
    text: T('Жидкий водород из бака сначала идёт через криостат генератора и кабели (охлаждает их), нагревается и уже газом поступает в форсунки камеры. Один и тот же поток — и холодильник, и топливо: отдельная криогенная установка не нужна.', 'Liquid hydrogen from the tank first flows through the generator cryostat and the cables (cooling them), warms up and enters the combustor injectors as gas. The same stream is the refrigerant and the fuel: no separate cryocooler is needed.') },
  { id: 'cycle', shot: { pos: [0.4, 2.6, 4.2], target: [1.0, 0, 0] }, title: T('7 · Почему выгоднее', '7 · Why it pays'),
    text: T('Цикл Брайтона: сжатие → нагрев при постоянном давлении → расширение. Детонационный цикл: сжатие → нагрев почти при постоянном объёме (давление растёт) → расширение с большего давления. Площадь цикла на диаграмме p–v — это работа: она больше при том же топливе. Теория даёт ≈ 15 % экономии; в опытах пока удаётся меньше — потери на впрыске и неравномерность потока. Это главный риск проекта.', 'Brayton cycle: compress → heat at constant pressure → expand. Detonation cycle: compress → heat at nearly constant volume (pressure rises) → expand from a higher pressure. The cycle area on the p–v diagram is the work: it is bigger for the same fuel. Theory gives ≈ 15 % savings; experiments so far achieve less — injection losses and uneven flow. That is the project’s main risk.') },
]
const OVERVIEW: LabShot = { pos: [0.6, 2.2, 3.8], target: [1.1, 0, 0] }

interface S { waves: number; slow: number; theta: number; zone: Step | null; run: boolean }

function Combustor({ s }: { s: React.MutableRefObject<S> }) {
  const cells = useRef<THREE.InstancedMesh>(null!)
  const wave = useRef<THREE.Group>(null!)
  const turb = useRef<THREE.Group>(null!)
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), [])
  const cellMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.92, depthWrite: false }), [])
  const cool = useMemo(() => ramp([[0, '#ffffff'], [0.04, '#ffd27a'], [0.15, '#ff7a2a'], [0.45, '#8a2a14'], [1, '#2a1410']]), [])
  const col = useMemo(() => new THREE.Color(), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((_, dt) => {
    const k = s.current
    if (!k.run) return
    // wave angular speed: V_CJ on the mean circumference, slowed down for the eye
    const omega = V_CJ / ((R_IN + R_OUT) / 2) / k.slow
    k.theta = (k.theta + omega * Math.min(dt, 0.05)) % (Math.PI * 2)
    wave.current.rotation.x = k.theta
    turb.current.rotation.x += dt * 40 / Math.sqrt(k.slow)
    const period = (Math.PI * 2) / k.waves
    for (let i = 0; i < NA; i++) {
      const a = (i / NA) * Math.PI * 2
      // angle since the last wave passed this cell, as a fraction of the gap between waves
      const ph = (((k.theta - a) % period) + period) % period / period
      const fresh = ph * 0.85 // the fresh layer grows linearly with time since the wave
      for (let j = 0; j < NX; j++) {
        const x = (j + 0.5) / NX
        const idx = i * NX + j
        dummy.position.set(x * L * 0.55, Math.cos(a) * (R_IN + R_OUT) / 2, Math.sin(a) * (R_IN + R_OUT) / 2)
        dummy.rotation.set(a, 0, 0)
        dummy.updateMatrix()
        cells.current.setMatrixAt(idx, dummy.matrix)
        if (x < fresh * 0.6) col.set('#3fa8ff').multiplyScalar(0.55 + 0.45 * (1 - x / 0.6))
        else cool(Math.min(1, ph + x * 0.25), col)
        cells.current.setColorAt(idx, col)
      }
    }
    cells.current.instanceMatrix.needsUpdate = true
    if (cells.current.instanceColor) cells.current.instanceColor.needsUpdate = true
    // extra waves are drawn as copies of the first
    wave.current.children.forEach((c, i) => { c.visible = i < k.waves })
  })
  const outer = useMemo(() => shell('#8c96a2'), [])
  const inner = useMemo(() => shell('#6e7884'), [])
  const genMat = useMemo(() => mat('#b86b3a', { metalness: 0.9, roughness: 0.3, clippingPlanes: CUT, side: THREE.DoubleSide }), [])
  const cryo = useMemo(() => shell('#c7d6e6', 0.35), [])
  const blade = useMemo(() => mat('#c9b48a', { metalness: 0.9, roughness: 0.25 }), [])
  const cable = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2fd8ff', emissive: '#2fd8ff', emissiveIntensity: 1.2, toneMapped: false }), [])
  return (
    <group>
      {/* annular channel: outer and inner walls, cut open */}
      <mesh geometry={cyl(R_OUT + 0.03, R_OUT + 0.03, L, 64)} rotation={[0, 0, Math.PI / 2]} position={[L / 2, 0, 0]} material={outer} />
      <mesh geometry={cyl(R_IN, R_IN, L + 0.9, 64)} rotation={[0, 0, Math.PI / 2]} position={[L / 2 + 0.45, 0, 0]} material={inner} />
      <mesh geometry={torus((R_IN + R_OUT) / 2, (R_OUT - R_IN) / 2 + 0.02, 64)} rotation={[0, Math.PI / 2, 0]} position={[-0.02, 0, 0]} scale={[1, 1, 0.2]} material={inner} />
      <instancedMesh ref={cells} args={[undefined, undefined, NA * NX]} material={cellMat}>
        <boxGeometry args={[(L * 0.55) / NX * 0.92, (R_OUT - R_IN) * 0.8, ((R_IN + R_OUT) / 2) * ((Math.PI * 2) / NA) * 0.9]} />
      </instancedMesh>
      {/* the detonation fronts */}
      <group ref={wave}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation={[(i * Math.PI * 2) / 3, 0, 0]}>
            <mesh position={[0.16, (R_IN + R_OUT) / 2, 0]} rotation={[0, 0.5, 0]} material={glow}><planeGeometry args={[0.34, R_OUT - R_IN]} /></mesh>
            <pointLight position={[0.16, (R_IN + R_OUT) / 2, 0.02]} color="#ffb070" intensity={2.5} distance={1.2} />
          </group>
        ))}
      </group>
      {/* turbine, shaft, generator in a cryostat */}
      <group ref={turb} position={[1.45, 0, 0]}>
        <mesh geometry={cyl(0.3, 0.3, 0.08, 32)} rotation={[0, 0, Math.PI / 2]} material={blade} />
        {Array.from({ length: 28 }, (_, i) => { const a = (i / 28) * Math.PI * 2; return <mesh key={i} position={[0, Math.cos(a) * 0.48, Math.sin(a) * 0.48]} rotation={[a, 0.55, 0]} material={blade}><boxGeometry args={[0.07, 0.3, 0.02]} /></mesh> })}
        <mesh geometry={cyl(0.07, 0.07, 1.4, 16)} rotation={[0, 0, Math.PI / 2]} position={[0.7, 0, 0]} material={blade} />
      </group>
      <mesh geometry={cyl(R_OUT + 0.06, 0.5, 0.6, 48)} rotation={[0, 0, Math.PI / 2]} position={[1.25, 0, 0]} material={outer} />
      <mesh geometry={cyl(0.42, 0.42, 0.7, 48)} rotation={[0, 0, Math.PI / 2]} position={[2.35, 0, 0]} material={genMat} />
      <mesh geometry={cyl(0.55, 0.55, 0.9, 48)} rotation={[0, 0, Math.PI / 2]} position={[2.35, 0, 0]} material={cryo} />
      {/* power cables to the fans, and the hydrogen line through the cryostat to the injectors */}
      {[0.25, -0.25].map((z) => <mesh key={z} geometry={cyl(0.03, 0.03, 1.6, 10)} position={[3.0, 0.55, z]} rotation={[0, 0, 0.9]} material={cable} />)}
    </group>
  )
}

export function RdeLab({ onClose }: { onClose: () => void }) {
  const t = useT()
  const s = useRef<S>({ waves: 1, slow: 4000, theta: 0, zone: null, run: true })
  const [shot, setShot] = useState<LabShot>(OVERVIEW)
  const [step, setStep] = useState<Step | null>(null)
  const [waves, setWaves] = useState(1)
  const [slow, setSlow] = useState(4000)
  const [run, setRun] = useState(true)
  useEffect(() => { s.current.waves = waves }, [waves])
  useEffect(() => { s.current.slow = slow }, [slow])
  useEffect(() => { s.current.run = run }, [run])
  const info = STEPS.find((x) => x.id === step)
  const freq = Math.round((V_CJ / (Math.PI * (R_IN + R_OUT))) * waves)
  const air: Vec3[][] = useMemo(() => [-0.35, 0.35].map((z) => [[-1.1, 0.75, z], [-0.5, 0.62, z], [-0.05, 0.54, z * 0.6]] as Vec3[]), [])
  const h2: Vec3[] = useMemo(() => [[2.35, -0.6, 0.7], [1.6, -0.8, 0.8], [0.4, -0.75, 0.6], [-0.15, -0.55, 0.25]], [])
  const hot: Vec3[][] = useMemo(() => [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + 0.4; return [[0.1, Math.cos(a) * 0.54, Math.sin(a) * 0.54], [0.6, Math.cos(a + 0.8) * 0.55, Math.sin(a + 0.8) * 0.55], [1.15, Math.cos(a + 1.4) * 0.52, Math.sin(a + 1.4) * 0.52], [1.6, Math.cos(a + 1.7) * 0.45, Math.sin(a + 1.7) * 0.45], [2.0, Math.cos(a + 1.8) * 0.5, Math.sin(a + 1.8) * 0.5]] as Vec3[] }), [])
  const hotCol = useMemo(() => ramp([[0, '#ffe2a8'], [0.4, '#ff7a2a'], [1, '#7a4a3a']]), [])
  return (
    <>
      <LabCanvas shot={shot} clip>
        <Combustor s={s} />
        {air.map((p, i) => <Stream key={`a${i}`} points={p} rate={() => (run ? 1.2 : 0)} color={solid('#9fdcff')} count={30} size={0.05} />)}
        <Stream points={h2} rate={() => (run ? 0.8 : 0)} color={solid('#4fe0ff')} count={40} size={0.05} />
        {hot.map((p, i) => <Stream key={`h${i}`} points={p} rate={() => (run ? 1.6 : 0)} color={hotCol} count={36} size={0.06} jitter={0.03} />)}
      </LabCanvas>
      <LabHeader eyebrow={t(T('«ВИХРЬ-240» · ДЕТОНАЦИОННЫЙ ТУРБОГЕНЕРАТОР', 'VORTEX-240 · DETONATION TURBO-GENERATOR'))} title={info ? t(info.title) : t(T('Как работает новый двигатель', 'How the new engine works'))} onClose={onClose}
        text={t(T('Половина корпуса срезана. Синее — свежая водородно-воздушная смесь у днища канала, белая полоса — детонационная волна, оранжевое — продукты сгорания, голубые линии — водород из бака и ток к вентиляторам.', 'Half the casing is cut away. Blue — fresh hydrogen–air mixture at the channel floor, the white band — the detonation wave, orange — combustion products, cyan — hydrogen from the tank and power to the fans.'))} />
      <div className="lab-side glass">
        {info ? (<><span className="eyebrow">{t(T('Шаг', 'Step'))}</span><h3>{t(info.title)}</h3><p>{t(info.text)}</p>{info.id === 'cycle' && <CycleChart />}</>)
          : (<><span className="eyebrow">{t(T('Новый принцип', 'New principle'))}</span><h3>{t(T('Горение в ударной волне', 'Burning inside a shock wave'))}</h3><p>{t(T('Вместо непрерывного пламени — волна детонации, которая бесконечно бежит по кольцу. Выберите шаги внизу или запустите показ.', 'Instead of a steady flame — a detonation wave running endlessly round a ring. Pick the steps below or play the tour.'))}</p></>)}
        <div className="readout">
          <div><b>{V_CJ}</b><span>{t(T('м/с — скорость волны', 'm/s wave speed'))}</span></div>
          <div><b>{freq}</b><span>{t(T('Гц — проходов в секунду', 'Hz passes per second'))}</span></div>
          <div><b>≈ 15×</b><span>{t(T('скачок давления', 'pressure jump'))}</span></div>
        </div>
      </div>
      <div className="lab-dock">
        <div className="tray glass">
          {STEPS.map((x) => <button key={x.id} className={`btn sm ${step === x.id ? 'on' : ''}`} onClick={() => { setStep(x.id); setShot(x.shot) }}>{t(x.title)}</button>)}
          <button className="btn sm ghost" onClick={() => { setStep(null); setShot(OVERVIEW) }}>{t(T('Общий вид', 'Overview'))}</button>
        </div>
        <div className="tray glass">
          <span className="lbl">{t(T('ВОЛН', 'WAVES'))}</span>
          {[1, 2, 3].map((n) => <button key={n} className={`btn sm ${waves === n ? 'on' : ''}`} onClick={() => setWaves(n)}>{n}</button>)}
          <label className="range" htmlFor="rde-slow">{t(T('ЗАМЕДЛЕНИЕ', 'SLOW-MOTION'))} ×{slow}
            <input id="rde-slow" type="range" min={500} max={20000} step={500} value={slow} onChange={(e) => setSlow(+e.target.value)} />
          </label>
          <button className={`btn sm ${run ? 'on' : ''}`} onClick={() => setRun(!run)}>{run ? '❚❚' : '▶'}</button>
        </div>
      </div>
    </>
  )
}

/** p–v diagram: Brayton (constant-pressure heat addition) vs detonation (≈ constant-volume) for the same fuel */
function CycleChart() {
  const t = useT()
  const X = (v: number) => 20 + (v / 2.5) * 235, Y = (p: number) => 150 - p * 4.4
  const pts = (arr: [number, number][]) => arr.map(([v, p]) => `${X(v)},${Y(p)}`).join(' ')
  const g = 1.4, rc = 10 // compressor pressure ratio
  // 1→2 isentropic compression, then the same heat added: at constant p (T ×2.4) or constant v (p ×(1 + γ·1.4))
  const comp: [number, number][] = Array.from({ length: 12 }, (_, i) => { const v = 1 - (i / 11) * (1 - rc ** (-1 / g)); return [v, (1 / v) ** g] })
  const v2 = rc ** (-1 / g)
  const expand = (v3: number, p3: number) => { const v4 = v3 * p3 ** (1 / g); return Array.from({ length: 16 }, (_, i) => { const v = v3 + (i / 15) * (v4 - v3); return [v, p3 * (v3 / v) ** g] as [number, number] }) }
  const bray = [...comp, ...expand(v2 * 2.4, rc), [1, 1] as [number, number]]
  const pH = rc * (1 + g * 1.4)
  const hum = [...comp, ...expand(v2, pH), [1, 1] as [number, number]]
  return (
    <svg viewBox="0 0 270 170" className="rde-chart" role="img" aria-label="p-v diagram">
      <line x1={20} y1={150} x2={260} y2={150} stroke="#5b6573" /><line x1={20} y1={150} x2={20} y2={10} stroke="#5b6573" />
      <text x={255} y={164} fill="#9aa4b2" fontSize={9} textAnchor="end">v</text><text x={8} y={16} fill="#9aa4b2" fontSize={9}>p</text>
      <polygon points={pts(hum)} fill="rgba(255,138,61,.14)" stroke="#ff8a3d" strokeWidth={1.5} />
      <polygon points={pts(bray)} fill="rgba(108,198,255,.14)" stroke="#6cc6ff" strokeWidth={1.5} />
      <text x={70} y={22} fill="#ff8a3d" fontSize={9}>{t(T('детонация (v ≈ const)', 'detonation (v ≈ const)'))}</text>
      <text x={120} y={118} fill="#6cc6ff" fontSize={9}>{t(T('Брайтон (p = const)', 'Brayton (p = const)'))}</text>
    </svg>
  )
}
