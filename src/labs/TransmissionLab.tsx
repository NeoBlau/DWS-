import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LabCanvas, LabHeader, glass, mat } from './common'
import { between, cyl, gear, rbox, ringGear, sphere, torus, tyre } from '../utils/geom'
import type { VehicleDef, Vec3 } from '../data/types'

// Approximate published ratios for the representative gearboxes; used only to scale the animation.
const RATIOS: Record<number, number[]> = {
  6: [3.6, 2.09, 1.49, 1.0, 0.69, 0.58],
  8: [4.7, 3.13, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67],
}
const FINAL = 3.7
const S = 0.32, P = 0.26, RR = S + 2 * P
const VIS = (Math.PI * 2) / 60 * 0.045

interface Drive { engine: number; gear: number; corner: boolean; mode: '2H' | '4H' | '4L'; ratio: number; low: number }

function Spin({ children, speed, axis = 'x', position, rotation }: { children: React.ReactNode; speed: () => number; axis?: 'x' | 'y' | 'z'; position?: Vec3; rotation?: Vec3 }) {
  const g = useRef<THREE.Group>(null!)
  useFrame((_, dt) => { g.current.rotation[axis] += speed() * dt })
  return <group position={position} rotation={rotation}><group ref={g}>{children}</group></group>
}

function ShaftBetween({ a, b, r, speed, color = '#c9d6e2' }: { a: Vec3; b: Vec3; r: number; speed: () => number; color?: string }) {
  const { position, quaternion, length } = useMemo(() => between(a, b), [a, b])
  const g = useRef<THREE.Group>(null!)
  useFrame((_, dt) => { g.current.rotation.y += speed() * dt })
  const m = useMemo(() => mat(color, { metalness: 0.85, roughness: 0.25 }), [color])
  return (
    <group position={position} quaternion={quaternion}>
      <group ref={g}>
        <mesh geometry={cyl(r, r, length, 18)} material={m} />
        <mesh geometry={rbox(r * 3, 0.03, 0.03, 0.01)} position={[0, length * 0.3, 0]} material={m} />
        <mesh geometry={rbox(r * 3, 0.03, 0.03, 0.01)} position={[0, -length * 0.3, 0]} material={m} />
      </group>
    </group>
  )
}

function Wheel({ x, y, z, speed }: { x: number; y: number; z: number; speed: () => number }) {
  const rubber = useMemo(() => mat('#121518', { metalness: 0, roughness: 0.9 }), [])
  const alloy = useMemo(() => mat('#b9c3cc', { metalness: 0.9, roughness: 0.25 }), [])
  return (
    <Spin speed={speed} axis="z" position={[x, y, z]}>
      <mesh geometry={tyre(0.7, 0.45)} material={rubber} />
      <mesh geometry={cyl(0.45, 0.45, 0.2, 32)} rotation={[Math.PI / 2, 0, 0]} material={alloy} />
      {Array.from({ length: 5 }, (_, i) => <mesh key={i} geometry={rbox(0.42, 0.07, 0.05, 0.02)} rotation={[0, 0, (i / 5) * Math.PI * 2]} position={[Math.cos((i / 5) * Math.PI * 2) * 0.22, Math.sin((i / 5) * Math.PI * 2) * 0.22, Math.sign(z) * 0.12]} material={alloy} />)}
    </Spin>
  )
}

const Scene = memo(function Scene({ d, awd }: { d: React.MutableRefObject<Drive>; awd: boolean }) {
  const eng = () => d.current.engine * VIS
  const out = () => eng() / d.current.ratio
  const tc = () => out() / d.current.low
  const diff = () => tc() / FINAL
  const delta = () => (d.current.corner ? 0.2 : 0)
  const front = () => (d.current.mode === '2H' ? 0 : 1)
  const sun = eng
  const carrier = out
  const ring = () => (carrier() * (S + RR) - sun() * S) / RR
  const planet = () => -(sun() - carrier()) * (S / P)
  const metal = useMemo(() => mat('#aeb8c2', { metalness: 0.85, roughness: 0.3 }), [])
  const blue = useMemo(() => mat('#9db7ff', { metalness: 0.6, roughness: 0.3, emissive: new THREE.Color('#5b7ad8'), emissiveIntensity: 0.25 }), [])
  const orange = useMemo(() => mat('#ffb27a', { metalness: 0.6, roughness: 0.3, emissive: new THREE.Color('#ff8a3d'), emissiveIntensity: 0.25 }), [])
  const green = useMemo(() => mat('#7ee0b5', { metalness: 0.6, roughness: 0.3, emissive: new THREE.Color('#3ddc97'), emissiveIntensity: 0.2 }), [])
  return (
    <group>
      {/* engine */}
      <mesh position={[-4.4, 0, 0]} geometry={rbox(1.6, 1.4, 1.1, 0.12)} material={glass('#9fb6c8', 0.12)} />
      <Spin speed={eng} position={[-4.4, -0.3, 0]}>
        <mesh geometry={cyl(0.08, 0.08, 1.7, 16)} rotation={[0, 0, Math.PI / 2]} material={metal} />
        {[-0.55, -0.18, 0.18, 0.55].map((x, i) => <mesh key={x} geometry={rbox(0.08, 0.3, 0.14, 0.02)} position={[x, i % 3 === 0 ? 0.12 : -0.12, 0]} material={metal} />)}
      </Spin>
      {/* torque converter */}
      <mesh geometry={torus(0.55, 0.28, 40)} rotation={[0, Math.PI / 2, 0]} position={[-3.25, -0.3, 0]} material={glass('#ffb27a', 0.15)} />
      <Spin speed={eng} position={[-3.38, -0.3, 0]}>{Array.from({ length: 14 }, (_, i) => <mesh key={i} geometry={rbox(0.06, 0.4, 0.12, 0.01)} rotation={[(i / 14) * Math.PI * 2, 0, 0]} position={[0, Math.cos((i / 14) * Math.PI * 2) * 0.55, Math.sin((i / 14) * Math.PI * 2) * 0.55]} material={orange} />)}</Spin>
      <Spin speed={() => eng() * 0.97} position={[-3.12, -0.3, 0]}>{Array.from({ length: 14 }, (_, i) => <mesh key={i} geometry={rbox(0.06, 0.4, 0.12, 0.01)} rotation={[(i / 14) * Math.PI * 2 + 0.2, 0, 0]} position={[0, Math.cos((i / 14) * Math.PI * 2 + 0.2) * 0.55, Math.sin((i / 14) * Math.PI * 2 + 0.2) * 0.55]} material={blue} />)}</Spin>
      {/* gearbox housing + planetary set */}
      <mesh geometry={cyl(0.75, 0.62, 1.9, 40, )} rotation={[0, 0, Math.PI / 2]} position={[-1.85, -0.3, 0]} material={glass('#9fb6c8', 0.12)} />
      <ShaftBetween a={[-3.0, -0.3, 0]} b={[-1.9, -0.3, 0]} r={0.06} speed={eng} color="#ffcf9e" />
      <group position={[-1.75, -0.3, 0]} rotation={[0, Math.PI / 2, 0]}>
        <Spin speed={sun} axis="z"><mesh geometry={gear(14, S, 0.16)} material={orange} /></Spin>
        <Spin speed={carrier} axis="z">
          {[0, 1, 2].map((k) => {
            const a = (k / 3) * Math.PI * 2, rr = S + P
            return (
              <group key={k} position={[Math.cos(a) * rr, Math.sin(a) * rr, 0]}>
                <Spin speed={planet} axis="z"><mesh geometry={gear(11, P, 0.15)} material={blue} /></Spin>
              </group>
            )
          })}
          <mesh geometry={torus(S + P, 0.025, 40)} position={[0, 0, -0.12]} material={blue} />
        </Spin>
        <Spin speed={ring} axis="z"><mesh geometry={ringGear(36, RR + 0.02, RR + 0.12, 0.16)} material={green} /></Spin>
      </group>
      <ShaftBetween a={[-1.6, -0.3, 0]} b={[-0.6, -0.3, 0]} r={0.07} speed={out} />
      {/* transfer case + driveshafts */}
      {awd && <mesh position={[-0.3, -0.45, 0]} geometry={rbox(0.6, 0.7, 0.7, 0.08)} material={glass('#b6c6ff', 0.2)} />}
      <ShaftBetween a={[-0.1, -0.45, 0]} b={[2.7, -0.55, 0]} r={0.07} speed={tc} />
      {awd && <ShaftBetween a={[-0.4, -0.7, 0.2]} b={[-3.4, -0.95, 0.2]} r={0.06} speed={() => tc() * front()} />}
      {/* rear differential: pinion, ring gear, spider gears */}
      <mesh geometry={sphere(0.62, 32)} position={[3.2, -0.55, 0]} material={glass('#b6c6ff', 0.14)} />
      <Spin speed={tc} position={[2.85, -0.55, 0]} rotation={[0, Math.PI / 2, 0]}><mesh geometry={gear(10, 0.14, 0.16)} rotation={[0, 0, 0]} material={orange} /></Spin>
      <Spin speed={diff} axis="z" position={[3.2, -0.55, 0.2]}>
        <mesh geometry={gear(36, 0.42, 0.08)} material={blue} />
        <Spin speed={() => diff() * delta() * 4} axis="y" position={[0, 0, -0.2]}>
          {[1, -1].map((s) => <mesh key={s} geometry={gear(9, 0.12, 0.06)} rotation={[Math.PI / 2, 0, 0]} position={[0, s * 0.18, 0]} material={green} />)}
        </Spin>
      </Spin>
      {/* half-shafts + wheels */}
      <ShaftBetween a={[3.2, -0.55, 0.3]} b={[3.2, -0.55, 1.45]} r={0.05} speed={() => diff() * (1 + delta())} />
      <ShaftBetween a={[3.2, -0.55, -0.3]} b={[3.2, -0.55, -1.45]} r={0.05} speed={() => diff() * (1 - delta())} />
      <Wheel x={3.2} y={-0.55} z={1.75} speed={() => -diff() * (1 + delta())} />
      <Wheel x={3.2} y={-0.55} z={-1.75} speed={() => -diff() * (1 - delta())} />
      {awd && (
        <>
          <mesh geometry={sphere(0.45, 28)} position={[-3.6, -0.95, 0.2]} material={glass('#b6c6ff', 0.14)} />
          <ShaftBetween a={[-3.6, -0.95, 0.4]} b={[-3.6, -0.95, 1.45]} r={0.045} speed={() => diff() * front()} />
          <ShaftBetween a={[-3.6, -0.95, 0.0]} b={[-3.6, -0.95, -1.45]} r={0.045} speed={() => diff() * front()} />
          <Wheel x={-3.6} y={-0.95} z={1.75} speed={() => -diff() * front()} />
          <Wheel x={-3.6} y={-0.95} z={-1.75} speed={() => -diff() * front()} />
        </>
      )}
    </group>
  )
})

const CHAIN = ['ENGINE', 'TORQUE CONVERTER', 'TRANSMISSION', 'DRIVESHAFT', 'DIFFERENTIAL', 'AXLES', 'WHEELS']

export function TransmissionLab({ def, onClose }: { def: VehicleDef; onClose: () => void }) {
  const n = def.gears?.count ?? 6
  const ratios = RATIOS[n] ?? RATIOS[6]
  const awd = !!def.awd
  const [g, setG] = useState(0)
  const [corner, setCorner] = useState(false)
  const [mode, setMode] = useState<Drive['mode']>(awd ? '4H' : '2H')
  const [hl, setHl] = useState(0)
  const d = useRef<Drive>({ engine: 2000, gear: 0, corner: false, mode, ratio: ratios[0], low: 1 })
  d.current = { ...d.current, gear: g, corner, mode, ratio: ratios[g], low: mode === '4L' ? 2.5 : 1 }
  useEffect(() => { const id = setInterval(() => setHl((h) => (h + 1) % CHAIN.length), 1200); return () => clearInterval(id) }, [])
  const outRpm = 2000 / ratios[g] / (mode === '4L' ? 2.5 : 1)
  const wheelRpm = outRpm / FINAL
  const kmh = wheelRpm * 2 * Math.PI * (def.layout && (def.layout as { wheelR?: number }).wheelR ? (def.layout as { wheelR: number }).wheelR : 0.35) * 60 / 1000
  return (
    <>
      <LabCanvas shot={{ pos: [1.6, 5.2, 12.8], target: [1.0, -0.6, 0] }}>
        <Scene d={d} awd={awd} />
      </LabCanvas>
      <LabHeader eyebrow="HOW POWER REACHES THE WHEELS" title="Engine → gearbox → wheels" onClose={onClose}
        text="Оранжевое — вход от двигателя, синее — водило с сателлитами (выход), зелёное — коронная шестерня. В низших передачах выход вращается медленнее, но с большим моментом." />
      <div className="lab-side glass">
        <span className="eyebrow">{def.gears?.label ?? 'Automatic'} · GEAR {g + 1}</span>
        <div className="readout">
          <div><b>2000</b><span>ENGINE RPM</span></div>
          <div><b>{Math.round(outRpm)}</b><span>OUTPUT RPM</span></div>
          <div><b>{Math.round(kmh)}</b><span>KM/H ≈</span></div>
        </div>
        <p>Передаточное число ≈ {ratios[g].toFixed(2)} : 1 — момент на выходе коробки в {ratios[g].toFixed(1)} раза больше{ratios[g] < 1 ? ' (повышающая передача: выход быстрее двигателя)' : ''}. Дальше главная пара дифференциала умножает его ещё раз.</p>
        {corner && <p style={{ color: 'var(--accent-2)' }}>Поворот: внешнее колесо проходит больший путь и крутится быстрее. Сателлиты дифференциала вращаются и позволяют это.</p>}
        {awd && <p style={{ color: 'var(--muted)', fontSize: 13 }}>{mode === '2H' ? '2H: момент идёт только на задний мост.' : mode === '4H' ? '4H: раздаточная коробка подаёт момент на оба моста.' : '4L: понижающий ряд дополнительно умножает момент для бездорожья.'} Режимы зависят от версии.</p>}
        <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>Ratios are approximate, for illustration.</span>
      </div>
      <div className="lab-dock">
        <div className="tray glass">
          {CHAIN.map((c, i) => <span key={c} className={`btn sm ${hl === i ? 'on' : ''}`} style={{ pointerEvents: 'none' }}>{c}</span>)}
        </div>
        <div className="tray glass">
          <span className="lbl">GEAR</span>
          {ratios.map((_, i) => <button key={i} className={`btn sm ${g === i ? 'on' : ''}`} onClick={() => setG(i)}>Gear {i + 1}</button>)}
          <button className={`btn sm ${corner ? 'on' : ''}`} onClick={() => setCorner(!corner)}>Corner</button>
          {awd && (['2H', '4H', '4L'] as const).map((m) => <button key={m} className={`btn sm ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{m}</button>)}
        </div>
      </div>
    </>
  )
}
