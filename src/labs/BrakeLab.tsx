import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LabCanvas, LabHeader, Stream, glass, mat, solid } from './common'
import { cyl, glowSprite, gridTexture, rbox, tyre } from '../utils/geom'

interface Sim { press: number; v: number; heat: number; wheel: number }

function Road({ speed, y = -0.72 }: { speed: () => number; y?: number }) {
  const tex = useMemo(() => { const t = gridTexture('#4b5d70'); t.repeat.set(8, 8); return t }, [])
  useFrame((_, dt) => { tex.offset.x += speed() * dt * 0.05 })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
      <planeGeometry args={[16, 16]} />
      <meshBasicMaterial map={tex} transparent opacity={0.55} color="#9fb8d0" depthWrite={false} />
    </mesh>
  )
}

function BrakeWheel({ x, z = 0, spin, heat, clamp, pulse, tag }: { x: number; z?: number; spin: () => number; heat: () => number; clamp: () => number; pulse?: () => number; tag?: string }) {
  const g = useRef<THREE.Group>(null!)
  const padA = useRef<THREE.Mesh>(null!), padB = useRef<THREE.Mesh>(null!)
  const sensor = useRef<THREE.MeshStandardMaterial>(null!)
  const disc = useMemo(() => mat('#7d8790', { metalness: 0.85, roughness: 0.35, emissive: new THREE.Color('#ff5a1e'), emissiveIntensity: 0 }), [])
  const caliper = useMemo(() => mat('#c63b3b', { metalness: 0.5, roughness: 0.35, emissive: new THREE.Color('#ff4d5e'), emissiveIntensity: 0 }), [])
  const rubber = useMemo(() => mat('#121518', { metalness: 0, roughness: 0.9 }), [])
  const alloy = useMemo(() => mat('#b9c3cc', { metalness: 0.9, roughness: 0.25 }), [])
  useFrame((_, dt) => {
    g.current.rotation.z -= spin() * dt
    const h = heat()
    disc.emissiveIntensity = h * 3
    disc.emissive.setRGB(1, 0.25 + (1 - h) * 0.3, 0.05)
    const c = clamp()
    padA.current.position.z = 0.09 - c * 0.04
    padB.current.position.z = -0.09 + c * 0.04
    caliper.emissiveIntensity = (pulse ? pulse() : c) * 0.8
    sensor.current.emissiveIntensity = 0.3 + (Math.sin(performance.now() * 0.001 * spin() * 6) > 0 ? 1.4 : 0) * Math.min(1, spin())
  })
  return (
    <group position={[x, 0, z]}>
      <group ref={g}>
        <mesh geometry={tyre(0.72, 0.42)} material={rubber} position={[0, 0, -0.24]} />
        <mesh geometry={cyl(0.48, 0.48, 0.05, 32)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.38]} material={glass('#b9c3cc', 0.25)} />
        {Array.from({ length: 5 }, (_, i) => <mesh key={i} geometry={rbox(0.44, 0.06, 0.04, 0.02)} rotation={[0, 0, (i / 5) * Math.PI * 2]} position={[Math.cos((i / 5) * Math.PI * 2) * 0.22, Math.sin((i / 5) * Math.PI * 2) * 0.22, -0.4]} material={alloy} />)}
        <mesh geometry={cyl(0.42, 0.42, 0.06, 48)} rotation={[Math.PI / 2, 0, 0]} material={disc} />
        {Array.from({ length: 36 }, (_, i) => <mesh key={i} geometry={rbox(0.03, 0.04, 0.03, 0.005)} position={[Math.cos((i / 36) * Math.PI * 2) * 0.16, Math.sin((i / 36) * Math.PI * 2) * 0.16, 0.06]} material={alloy} />)}
      </group>
      {/* caliper straddling the disc + pads */}
      <group position={[0.18, 0.33, 0]} rotation={[0, 0, -0.5]}>
        <mesh geometry={rbox(0.32, 0.2, 0.3, 0.04)} material={glass('#ff4d5e', 0.25)} />
        <mesh geometry={rbox(0.3, 0.06, 0.06, 0.02)} position={[0, 0.1, 0]} material={caliper} />
        <mesh ref={padA} geometry={rbox(0.26, 0.12, 0.03, 0.01)} position={[0, -0.02, 0.09]} material={mat('#e8d2b4', { metalness: 0.1, roughness: 0.8 })} />
        <mesh ref={padB} geometry={rbox(0.26, 0.12, 0.03, 0.01)} position={[0, -0.02, -0.09]} material={mat('#e8d2b4', { metalness: 0.1, roughness: 0.8 })} />
      </group>
      {/* wheel speed sensor */}
      <mesh position={[-0.22, -0.05, 0.12]} geometry={rbox(0.08, 0.08, 0.1, 0.02)}>
        <meshStandardMaterial ref={sensor} color="#a98bff" emissive="#a98bff" emissiveIntensity={0.3} />
      </mesh>
      {tag && null}
    </group>
  )
}

function Smoke({ x, on }: { x: number; on: () => boolean }) {
  const mats = useMemo(() => Array.from({ length: 14 }, () => new THREE.SpriteMaterial({ map: glowSprite(), color: '#d6d9dd', transparent: true, opacity: 0, depthWrite: false })), [])
  const refs = useRef<THREE.Sprite[]>([])
  const t = useRef(Array.from({ length: 14 }, (_, i) => i / 14))
  useFrame((_, dt) => {
    const active = on()
    refs.current.forEach((s, i) => {
      if (!s) return
      t.current[i] = (t.current[i] + dt * 0.8) % 1
      const u = t.current[i]
      s.position.set(x - 0.2 - u * 1.6, -0.7 + u * 0.6, (i % 3 - 1) * 0.15)
      s.scale.setScalar(0.3 + u * 0.9)
      mats[i].opacity = active ? (1 - u) * 0.35 : Math.max(0, mats[i].opacity - dt)
    })
  })
  return <>{mats.map((m, i) => <sprite key={i} ref={(o) => { if (o) refs.current[i] = o }} material={m} />)}</>
}

function Hydraulics({ s }: { s: React.MutableRefObject<Sim> }) {
  const pedal = useRef<THREE.Group>(null!)
  const piston = useRef<THREE.Mesh>(null!)
  useFrame(() => {
    pedal.current.rotation.z = -s.current.press * 0.42
    piston.current.position.x = -1.55 + s.current.press * 0.22
  })
  const line: [number, number, number][] = [[-0.9, 0.62, 0], [-0.3, 0.62, 0], [0.4, 0.9, 0], [1.0, 0.9, 0.0], [1.42, 0.62, 0.0]]
  return (
    <group>
      <group ref={pedal} position={[-3.2, 1.2, 0]}>
        <mesh geometry={rbox(0.06, 1.1, 0.06, 0.02)} position={[0, -0.55, 0]} material={mat('#aeb8c2')} />
        <mesh geometry={rbox(0.08, 0.2, 0.3, 0.03)} position={[0.05, -1.1, 0]} material={mat('#3b444e')} />
        <mesh geometry={rbox(0.9, 0.04, 0.04, 0.01)} position={[0.45, -0.3, 0]} material={mat('#aeb8c2')} />
      </group>
      <mesh geometry={cyl(0.42, 0.42, 0.42, 36)} rotation={[0, 0, Math.PI / 2]} position={[-2.3, 0.62, 0]} material={glass('#c8d3dd', 0.22)} />
      <mesh geometry={cyl(0.16, 0.16, 0.85, 28)} rotation={[0, 0, Math.PI / 2]} position={[-1.45, 0.62, 0]} material={glass('#ff4d5e', 0.2)} />
      <mesh ref={piston} geometry={cyl(0.14, 0.14, 0.14, 24)} rotation={[0, 0, Math.PI / 2]} position={[-1.55, 0.62, 0]} material={mat('#dfe6ec')} />
      <mesh geometry={rbox(0.3, 0.2, 0.22, 0.05)} position={[-1.4, 0.9, 0]} material={glass('#ff4d5e', 0.3)} />
      <mesh geometry={new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line.map((p) => new THREE.Vector3(...p))), 40, 0.03, 8)} material={glass('#ff4d5e', 0.3)} />
      <Stream points={line} rate={() => s.current.press * 2.4} visible={() => s.current.press > 0.05} color={solid('#ff4d5e')} count={40} size={0.07} />
    </group>
  )
}

const BrakeScene = memo(function BrakeScene({ tab, s, hold, abs }: { tab: 'brake' | 'abs'; s: React.MutableRefObject<Sim>; hold: React.MutableRefObject<boolean>; abs: React.MutableRefObject<AbsState> }) {
  return (
    <>
        <BrakePhysics s={s} hold={hold} active={tab === 'brake'} />
        {tab === 'brake' ? (
          <>
            <Hydraulics s={s} />
            <BrakeWheel x={1.6} spin={() => s.current.v / 0.72} heat={() => s.current.heat} clamp={() => s.current.press} />
            <Road speed={() => s.current.v} />
          </>
        ) : (
          <>
            <AbsSim st={abs} />
            <BrakeWheel x={-1.5} spin={() => abs.current.a.w / 0.72} heat={() => (abs.current.running ? 0.4 : 0)} clamp={() => (abs.current.running ? 1 : 0)} />
            <BrakeWheel x={1.5} spin={() => (abs.current.t === 0 ? 27.8 : abs.current.b.w) / 0.72} heat={() => (abs.current.running ? 0.3 : 0)} clamp={() => (abs.current.running ? abs.current.b.p : 0)} pulse={() => abs.current.b.p} />
            <Smoke x={-1.5} on={() => abs.current.running && abs.current.a.w < 0.5 && abs.current.a.v > 0.5} />
            <Road speed={() => (abs.current.t === 0 ? 27.8 : (abs.current.a.v + abs.current.b.v) / 2)} />
          </>
        )}
    </>
  )
})

const CHAIN = ['BRAKE PEDAL', 'MASTER CYLINDER', 'BRAKE FLUID', 'BRAKE CALIPER', 'BRAKE PADS', 'BRAKE DISC', 'WHEEL']

/* ------------------------------------------------------------ ABS comparison */
interface AbsState { t: number; running: boolean; a: { v: number; w: number; x: number }; b: { v: number; w: number; x: number; p: number }; hist: { t: number; av: number; aw: number; bv: number; bw: number }[] }

function AbsSim({ st }: { st: React.MutableRefObject<AbsState> }) {
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const s = st.current
    if (!s.running) return
    s.t += dt
    // without ABS: wheel locks almost immediately, car slides
    if (s.a.v > 0) { s.a.v = Math.max(0, s.a.v - 6.8 * dt); s.a.w = s.t < 0.15 ? s.a.v * (1 - s.t / 0.15) : 0; s.a.x += s.a.v * dt }
    // with ABS: pressure is modulated so wheel slip hovers around ~10–20 %
    if (s.b.v > 0) {
      s.b.v = Math.max(0, s.b.v - 8.2 * dt)
      const cyc = Math.sin(s.t * Math.PI * 2 * 9)
      s.b.p = 0.6 + 0.4 * cyc
      s.b.w = s.b.v * (0.86 - 0.08 * cyc)
      s.b.x += s.b.v * dt
    } else { s.b.w = 0; s.b.p = 0 }
    if (s.hist.length === 0 || s.t - s.hist[s.hist.length - 1].t > 0.04) s.hist.push({ t: s.t, av: s.a.v, aw: s.a.w, bv: s.b.v, bw: s.b.w })
    if (s.a.v <= 0 && s.b.v <= 0) s.running = false
  })
  return null
}

function Chart({ st }: { st: React.MutableRefObject<AbsState> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    const draw = () => {
      const c = ref.current
      if (c) {
        const dpr = window.devicePixelRatio || 1
        const W = c.clientWidth, H = c.clientHeight
        if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr }
        const x = c.getContext('2d')!
        x.setTransform(dpr, 0, 0, dpr, 0, 0)
        x.clearRect(0, 0, W, H)
        x.strokeStyle = 'rgba(220,235,255,0.08)'; x.lineWidth = 1
        for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, (H - 16) * (i / 4) + 2); x.lineTo(W, (H - 16) * (i / 4) + 2); x.stroke() }
        const h = st.current.hist
        const T = 4.5, V = 28
        const line = (k: 'av' | 'aw' | 'bv' | 'bw', color: string, dash: number[]) => {
          x.strokeStyle = color; x.setLineDash(dash); x.lineWidth = 2; x.beginPath()
          h.forEach((p, i) => { const px = (p.t / T) * W, py = (1 - p[k] / V) * (H - 18) + 2; if (i) x.lineTo(px, py); else x.moveTo(px, py) })
          x.stroke(); x.setLineDash([])
        }
        line('av', 'rgba(255,138,61,0.55)', [5, 4]); line('aw', '#ff8a3d', [])
        line('bv', 'rgba(108,198,255,0.55)', [5, 4]); line('bw', '#6cc6ff', [])
        x.fillStyle = '#5b6674'; x.font = '10px JetBrains Mono, monospace'
        x.fillText('— wheel speed   - - vehicle speed   (0–4.5 s)', 6, H - 4)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [st])
  return <canvas ref={ref} className="chart" />
}

export function BrakeLab({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'brake' | 'abs'>('brake')
  const s = useRef<Sim>({ press: 0, v: 14, heat: 0, wheel: 0 })
  const [holding, setHolding] = useState(false)
  const hold = useRef(false); hold.current = holding
  const [ui, setUi] = useState({ kmh: 50, heat: 0, stage: 0, a: { v: 0, x: 0 }, b: { v: 0, x: 0 }, ran: false })
  const abs = useRef<AbsState>({ t: 0, running: false, a: { v: 27.8, w: 27.8, x: 0 }, b: { v: 27.8, w: 27.8, x: 0, p: 0 }, hist: [] })
  useEffect(() => {
    const id = setInterval(() => {
      const st = s.current
      setUi({ kmh: Math.round(st.v * 3.6), heat: st.heat, stage: Math.min(6, Math.floor(st.press * 7)), a: { v: abs.current.a.v, x: abs.current.a.x }, b: { v: abs.current.b.v, x: abs.current.b.x }, ran: abs.current.t > 0 })
    }, 100)
    return () => clearInterval(id)
  }, [])
  const reset = () => { abs.current = { t: 0, running: false, a: { v: 27.8, w: 27.8, x: 0 }, b: { v: 27.8, w: 27.8, x: 0, p: 0 }, hist: [] } }
  return (
    <>
      <LabCanvas shot={tab === 'brake' ? { pos: [0.9, 1.9, 7.4], target: [0.6, 0.2, 0] } : { pos: [1.2, 2.0, 8.0], target: [1.0, 0.0, 0] }}>
        <BrakeScene tab={tab} s={s} hold={hold} abs={abs} />
      </LabCanvas>
      <LabHeader eyebrow={tab === 'brake' ? 'PRESS BRAKE' : 'HOW ABS WORKS'} title={tab === 'brake' ? 'How the car stops' : 'Without ABS vs with ABS'} onClose={onClose}
        text={tab === 'brake' ? 'Удерживайте кнопку: педаль толкает поршень главного цилиндра, тормозная жидкость под давлением идёт к суппорту, колодки сжимают диск. Энергия движения превращается в тепло — диск раскаляется.' : 'Слева колесо без ABS: при резком торможении оно блокируется и скользит — рулём уже не повернуть. Справа ABS: датчик видит, что колесо замедляется слишком быстро, и блок на мгновения сбрасывает давление. Колесо продолжает вращаться.'}>
        <div className="seg" style={{ minWidth: 220 }}>
          <button className={tab === 'brake' ? 'on' : ''} onClick={() => setTab('brake')}>Braking</button>
          <button className={tab === 'abs' ? 'on' : ''} onClick={() => { setTab('abs'); reset() }}>ABS</button>
        </div>
      </LabHeader>
      {tab === 'brake' ? (
        <div className="lab-side glass">
          <span className="eyebrow">LIVE</span>
          <div className="readout">
            <div><b>{ui.kmh}</b><span>KM/H</span></div>
            <div><b>{Math.round(80 + ui.heat * 520)}°</b><span>DISC °C · ≈</span></div>
          </div>
          <div className="gauge-track"><i style={{ width: `${ui.heat * 100}%`, transition: 'width .1s linear' }} /></div>
          <p>Усилие ноги умножается дважды: рычагом педали и вакуумным усилителем. Гидравлика передаёт давление одинаково во все суппорты — закон Паскаля.</p>
        </div>
      ) : (
        <div className="lab-side glass">
          <span className="eyebrow">EMERGENCY STOP · 100 KM/H</span>
          <div className="readout">
            <div><b style={{ color: '#ff8a3d' }}>{ui.a.x.toFixed(1)} m</b><span>WITHOUT ABS</span></div>
            <div><b style={{ color: '#6cc6ff' }}>{ui.b.x.toFixed(1)} m</b><span>WITH ABS</span></div>
          </div>
          <Chart st={abs} />
          <p style={{ fontSize: 13 }}>Без ABS скорость колеса падает до нуля сразу — колесо заблокировано. С ABS скорость колеса «пилой» держится чуть ниже скорости машины: шина работает на пике сцепления, а машина слушается руля. Цифры иллюстративные; на рыхлом снегу или гравии путь с ABS может быть длиннее.</p>
        </div>
      )}
      <div className="lab-dock">
        {tab === 'brake' ? (
          <>
            <div className="tray glass">{CHAIN.map((c, i) => <span key={c} className={`btn sm ${holding && ui.stage >= i ? 'on' : ''}`} style={{ pointerEvents: 'none' }}>{c}</span>)}</div>
            <div className="tray glass">
              <button className="btn primary" onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setHolding(true) }} onPointerUp={() => setHolding(false)} onPointerCancel={() => setHolding(false)}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setHolding(true) }} onKeyUp={() => setHolding(false)}>Hold to press brake</button>
              <button className="btn sm" onClick={() => { s.current.v = 14 }}>Speed up again</button>
            </div>
          </>
        ) : (
          <div className="tray glass">
            <button className="btn primary" onClick={() => { reset(); abs.current.running = true }}>Emergency stop</button>
            <button className="btn sm" onClick={reset}>Reset</button>
          </div>
        )}
      </div>
    </>
  )
}

function BrakePhysics({ s, hold, active }: { s: React.MutableRefObject<Sim>; hold: React.MutableRefObject<boolean>; active: boolean }) {
  useFrame((_, dtRaw) => {
    if (!active) return
    const dt = Math.min(dtRaw, 0.05)
    const st = s.current
    st.press += ((hold.current ? 1 : 0) - st.press) * (1 - Math.exp(-dt * 7))
    if (st.press > 0.2) st.v = Math.max(0, st.v - 7 * st.press * dt)
    st.heat = Math.max(0, Math.min(1, st.heat + st.press * (st.v > 0.2 ? 0.45 : 0.02) * dt - 0.07 * dt))
  })
  return null
}
