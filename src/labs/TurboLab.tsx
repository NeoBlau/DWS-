import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LabCanvas, LabHeader, Stream, glass, mat, ramp, solid } from './common'
import { cyl, rbox, torus } from '../utils/geom'
import type { Vec3 } from '../data/types'

/** volute: a spiral tube whose radius grows towards its outlet */
function volute(cx: number, r0: number, r1: number, turns: number, tube: number, dir: 1 | -1) {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, a = t * Math.PI * 2 * turns
    const r = r0 + (r1 - r0) * t
    pts.push(new THREE.Vector3(cx, Math.cos(a) * r, Math.sin(a) * r * dir))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, tube, 16, false)
}
function spiral(cx: number, r0: number, r1: number, turns: number, dir: 1 | -1, lead: Vec3[] = [], tail: Vec3[] = []): Vec3[] {
  const pts: Vec3[] = []
  for (let i = 0; i <= 24; i++) { const t = i / 24, a = t * Math.PI * 2 * turns, r = r0 + (r1 - r0) * t; pts.push([cx, Math.cos(a) * r, Math.sin(a) * r * dir]) }
  return [...lead, ...pts, ...tail]
}

function Physics({ state, thr }: { state: { rpm: number; boost: number }; thr: React.MutableRefObject<number> }) {
  useFrame((_, dt) => {
    const target = 25000 + thr.current * 155000
    state.rpm += (target - state.rpm) * (1 - Math.exp(-dt * (target > state.rpm ? 0.9 : 1.6)))
    state.boost = Math.max(0, ((state.rpm - 30000) / 150000) * 1.6)
  })
  return null
}

const CHAIN = ['EXHAUST GAS', 'TURBINE', 'SHAFT', 'COMPRESSOR', 'INTAKE AIR', 'ENGINE']

const Turbo = memo(function Turbo({ state }: { state: { rpm: number } }) {
  const tw = useRef<THREE.Group>(null!), cw = useRef<THREE.Group>(null!), sh = useRef<THREE.Mesh>(null!)
  useFrame((_, dt) => {
    const w = (state.rpm / 200000) * 40
    tw.current.rotation.x += w * dt; cw.current.rotation.x += w * dt; sh.current.rotation.x += w * dt
  })
  const blades = (r: number, n: number, color: string, flip: number) => (
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2
      return <mesh key={i} geometry={rbox(0.18, r, 0.025, 0.008)} position={[0, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55]} rotation={[a, 0.5 * flip, 0]} material={mat(color, { metalness: 0.8, roughness: 0.25 })} />
    })
  )
  return (
    <group>
      {/* turbine (hot side, left) */}
      <mesh geometry={volute(-0.9, 0.62, 0.95, 0.92, 0.26, 1)} material={glass('#ff9b6b', 0.14)} />
      <group ref={tw} position={[-0.9, 0, 0]}>
        {blades(0.5, 11, '#e9a77f', 1)}
        <mesh geometry={cyl(0.12, 0.2, 0.22, 24)} rotation={[0, 0, Math.PI / 2]} material={mat('#e9a77f', { metalness: 0.8 })} />
      </group>
      {/* bearing housing + shaft */}
      <mesh geometry={cyl(0.26, 0.26, 0.7, 32)} rotation={[0, 0, Math.PI / 2]} material={glass('#c8d3dd', 0.22)} />
      <mesh ref={sh} geometry={cyl(0.05, 0.05, 2.0, 16)} rotation={[0, 0, Math.PI / 2]} material={mat('#dfe6ec', { metalness: 0.9 })} />
      {[-0.2, 0.2].map((x) => <mesh key={x} geometry={torus(0.08, 0.025, 24)} rotation={[0, Math.PI / 2, 0]} position={[x, 0, 0]} material={mat('#f2c94c', { emissive: new THREE.Color('#f2c94c'), emissiveIntensity: 0.25 })} />)}
      {/* compressor (cold side, right) */}
      <mesh geometry={volute(0.9, 0.62, 0.98, 0.92, 0.26, -1)} material={glass('#6cc6ff', 0.14)} />
      <group ref={cw} position={[0.9, 0, 0]}>
        {blades(0.52, 12, '#cfe8ff', -1)}
        <mesh geometry={cyl(0.2, 0.08, 0.26, 24)} rotation={[0, 0, Math.PI / 2]} material={mat('#cfe8ff', { metalness: 0.8 })} />
      </group>
      {/* engine + intercooler blocks for context */}
      <mesh position={[0, -2.2, 0]} geometry={rbox(2.6, 1.2, 1.2, 0.12)} material={glass('#9fb6c8', 0.12)} />
      <mesh position={[2.9, -0.9, 0]} geometry={rbox(0.25, 1.4, 1.1, 0.05)} material={mat('#6cc6ff', { metalness: 0.4, emissive: new THREE.Color('#6cc6ff'), emissiveIntensity: 0.2 })} />
    </group>
  )
})

export function TurboLab({ onClose, variant }: { onClose: () => void; variant: 'vnt' | 'twin' }) {
  const [throttle, setThrottle] = useState(0.25)
  const state = useMemo(() => ({ rpm: 30000, boost: 0 }), [])
  const thr = useRef(throttle); thr.current = throttle
  const [ui, setUi] = useState({ rpm: 0, boost: 0 })
  const [hl, setHl] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setUi({ rpm: Math.round(state.rpm / 1000) * 1000, boost: state.boost }), 120)
    const id2 = setInterval(() => setHl((h) => (h + 1) % CHAIN.length), 1400)
    return () => { clearInterval(id); clearInterval(id2) }
  }, [state])
  const exhIn: Vec3[] = useMemo(() => spiral(-0.9, 0.95, 0.15, 0.85, 1, [[-0.9, -2.0, 0.0], [-0.9, -1.4, 0.55], [-0.9, -0.95, 0.85]], [[-1.2, 0, 0], [-1.8, 0, 0], [-2.8, 0, 0]]), [])
  const airIn: Vec3[] = useMemo(() => [[3.2, 0.4, 0], [2.0, 0.05, 0], [1.2, 0, 0], ...spiral(0.9, 0.15, 0.98, 0.85, -1), [0.9, 1.0, -0.6], [1.6, 1.3, -0.3], [2.9, 0.6, 0], [2.9, -0.6, 0], [1.6, -1.8, 0], [0.6, -2.1, 0]], [])
  const k = () => 0.5 + (state.rpm / 180000) * 4
  return (
    <>
      <LabCanvas shot={{ pos: [2.6, 2.0, 9.4], target: [1.3, -0.5, 0] }}>
        <Physics state={state} thr={thr} />
        <Turbo state={state} />
        <Stream points={exhIn} rate={k} color={ramp([[0, '#ff5a2a'], [0.5, '#ff8a3d'], [1, '#b9a59c']])} count={110} size={0.08} jitter={0.08} />
        <Stream points={airIn} rate={k} color={ramp([[0, '#9fdcff'], [0.45, '#ffcf9e'], [0.7, '#ffb27a'], [0.8, '#6cc6ff'], [1, '#6cc6ff']])} count={140} size={0.07} jitter={0.08} />
        <Stream points={[[-0.2, 1.2, 0], [-0.2, 0.3, 0], [0, 0.15, 0], [0.2, -0.3, 0], [0.2, -1.6, 0]]} rate={() => 0.8} color={solid('#f2c94c')} count={24} size={0.05} />
      </LabCanvas>
      <LabHeader eyebrow="HOW TURBOCHARGING WORKS" title={variant === 'twin' ? 'Twin-scroll turbocharger' : 'Variable-geometry turbo'} onClose={onClose}
        text="Слева горячая сторона: выхлоп крутит турбину. Справа холодная: компрессор на том же валу сжимает воздух и отправляет его через интеркулер в двигатель. Жёлтое — масло, на котором вращается вал." />
      <div className="lab-side glass">
        <span className="eyebrow">LIVE</span>
        <div className="readout">
          <div><b>{ui.rpm.toLocaleString('ru-RU')}</b><span>RPM · ILLUSTRATIVE</span></div>
          <div><b>{ui.boost.toFixed(2)}</b><span>BAR BOOST</span></div>
        </div>
        <div className="gauge-track"><i style={{ width: `${Math.min(100, ui.boost / 1.6 * 100)}%`, transition: 'width .12s linear' }} /></div>
        <p>{variant === 'twin'
          ? 'Улитка турбины разделена на два канала: импульсы цилиндров 1-4 и 2-3 не мешают друг другу, турбина раскручивается быстрее. Перепускной клапан (wastegate) ограничивает наддув.'
          : 'Подвижные лопатки на входе турбины сужают канал на малых оборотах — газ ускоряется и раскручивает колесо раньше. На больших оборотах лопатки открываются.'}</p>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Чем сильнее нажат газ, тем больше выхлопа — тем быстрее вращается вал и тем выше давление наддува.</p>
      </div>
      <div className="lab-dock">
        <div className="tray glass">
          {CHAIN.map((c, i) => <span key={c} className={`btn sm ${hl === i ? 'on' : ''}`} style={{ pointerEvents: 'none' }}>{c}</span>)}
        </div>
        <div className="tray glass">
          <label className="range" htmlFor="turbo-throttle">THROTTLE
            <input id="turbo-throttle" type="range" min={0} max={1} step={0.01} value={throttle} onChange={(e) => setThrottle(+e.target.value)} />
          </label>
          <button className="btn sm" onPointerDown={() => setThrottle(1)} onPointerUp={() => setThrottle(0.25)}>Hold to accelerate</button>
        </div>
      </div>
    </>
  )
}
