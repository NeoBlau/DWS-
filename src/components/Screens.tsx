import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { useThree } from '@react-three/fiber'
import { useApp, getApp } from '../store'
import { VEHICLES, ORDER } from '../vehicles'
import { CarModel } from '../models/CarModel'
import { AircraftModel } from '../models/AircraftModel'
import { goToHit, openVehicle, progress, search, startLearn, type Hit } from '../utils/actions'
import type { VehicleId } from '../data/types'

/* ---------------------------------------------------------------- loader */
export function Loader() {
  const [p, setP] = useState([0, 0, 0])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve()
    const t0 = performance.now()
    const tick = () => {
      if (!alive) return
      const t = (performance.now() - t0) / 1000
      setP([Math.min(100, t * 85), Math.min(100, Math.max(0, (t - 0.35) * 70)), Math.min(100, Math.max(0, (t - 0.7) * 75))])
      if (t < 2.2) requestAnimationFrame(tick)
      else fonts.then(() => alive && setReady(true))
    }
    requestAnimationFrame(tick)
    return () => { alive = false }
  }, [])
  const rows = ['ENGINE', 'SYSTEMS', 'INTERIOR']
  return (
    <div className="loader">
      <div className="loader-inner">
        <h1>BUILDING THE MACHINE…</h1>
        {rows.map((r, i) => (
          <div className="load-row" key={r}>
            <span>{r}</span>
            <div className="load-bar"><i style={{ width: `${p[i]}%` }} /></div>
            <span>{Math.round(p[i])}%</span>
          </div>
        ))}
        {ready && (
          <div className="ready">
            <span className="eyebrow" style={{ color: 'var(--ok)' }}>● READY</span>
            <b>HOW IT WORKS</b>
            <button className="btn primary" onClick={() => getApp().set({ screen: 'landing' })} autoFocus>Enter experience</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- landing showcase */
function Showcase() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.6
  }, [gl, scene])
  const g = useRef<THREE.Group[]>([])
  useFrame((st, dt) => {
    g.current.forEach((o, i) => { if (o) o.rotation.y += dt * (0.12 + i * 0.02) })
    st.camera.position.x = Math.sin(st.clock.elapsedTime * 0.05) * 0.8
    st.camera.lookAt(0, 3.1, 0)
  })
  const items: { id: VehicleId; x: number; s: number; y: number }[] = [
    { id: 'fortuner', x: -6.2, s: 1, y: 0 },
    { id: 'bmw', x: 0, s: 1, y: 0 },
    { id: 'a320', x: 6.8, s: 0.11, y: 0.15 },
  ]
  return (
    <>
      <hemisphereLight args={['#bcd7ff', '#05070a', 0.4]} />
      <directionalLight position={[5, 8, 6]} intensity={1.8} />
      <directionalLight position={[-6, 3, -5]} intensity={1.0} color="#7fb6ff" />
      {items.map((it, i) => (
        <group key={it.id} position={[it.x, it.y, 0]} scale={it.s} ref={(o) => { if (o) g.current[i] = o }}>
          {VEHICLES[it.id].kind === 'car' ? <CarModel def={VEHICLES[it.id]} showcase /> : <AircraftModel def={VEHICLES[it.id]} showcase />}
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[18, 64]} />
        <meshBasicMaterial color="#0b1118" transparent opacity={0.65} />
      </mesh>
    </>
  )
}

export function Landing() {
  const understood = useApp((s) => s.understood)
  void understood
  const startDemo = (v: VehicleId) => openVehicle(v, () => setTimeout(() => startLearn(VEHICLES[v], 'demo'), 1400))
  const all = ORDER.every((v) => VEHICLES[v].checklist.every((c) => c.ids.some((id) => getApp().understood[v].includes(id))))
  return (
    <div className="landing">
      <Canvas className="scene" camera={{ position: [0, 4.2, 15.5], fov: 40 }} dpr={[1, 1.5]} gl={{ antialias: true }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping }}>
        <color attach="background" args={['#05070a']} />
        <fog attach="fog" args={['#05070a', 12, 30]} />
        <Showcase />
      </Canvas>
      <div className="landing-content">
        <div className="land-top">
          <span className="logo"><i />HOW IT WORKS</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => getApp().openPanel('search')}>Search</button>
            {all && <button className="btn" onClick={() => getApp().set({ screen: 'final' })}>Your summary</button>}
          </div>
        </div>
        <section className="hero">
          <span className="eyebrow">Explore machines from the inside</span>
          <h1><span>UNDERSTAND</span><span>WHAT MOVES YOU.</span></h1>
          <p>Explore the machines around you — from fuel molecules to flight controls. Интерактивный 3D-учебник: заходите внутрь, включайте потоки топлива, воздуха, масла и тока и смотрите, как всё работает.</p>
          <div className="cta">
            <button className="btn primary" onClick={() => openVehicle('fortuner')}>Start exploring</button>
            <button className="btn" onClick={() => startDemo('fortuner')}>Watch a demo</button>
          </div>
        </section>
        <div className="machines-row">
          {ORDER.map((id) => {
            const v = VEHICLES[id]
            const p = progress(v)
            return (
              <button key={id} className="mcard glass" onClick={() => openVehicle(id)}>
                <span className="k">{v.line}</span>
                <h2>{v.name}</h2>
                <p>{v.tagline}</p>
                <div className="meter"><span>YOUR JOURNEY<em style={{ fontStyle: 'normal', color: 'var(--text)' }}>{p}% explored</em></span><div className="bar"><i style={{ width: `${p}%` }} /></div></div>
              </button>
            )
          })}
        </div>
        <div className="section-title"><h3>Demo scenarios</h3><span className="eyebrow">30–60 s · camera drives itself</span></div>
        <div className="demos">
          {ORDER.map((id, i) => (
            <button key={id} className="demo glass" onClick={() => startDemo(id)}>
              <span className="play" />
              <span><small>DEMO {String(i + 1).padStart(2, '0')} · {VEHICLES[id].name}</small><b>{VEHICLES[id].demo.title}</b><small style={{ letterSpacing: 0, fontFamily: 'var(--f-ui)', fontSize: 13 }}>{VEHICLES[id].demo.subtitle}</small></span>
            </button>
          ))}
        </div>
        <div className="section-title"><h3>Deep dives</h3><span className="eyebrow">see how it works up close</span></div>
        <div className="demos">
          {([
            ['fortuner', 'cylinder', 'Inside the cylinder', 'Четыре такта дизеля'],
            ['bmw', 'compare', 'Diesel vs petrol', 'Два цилиндра синхронно'],
            ['fortuner', 'turbo', 'How turbocharging works', 'Выхлоп → турбина → компрессор'],
            ['fortuner', 'transmission', 'How power reaches the wheels', 'Передачи, дифференциал, 4×4'],
            ['bmw', 'brakes', 'Brakes and ABS', 'С ABS и без'],
            ['a320', 'turbofan', 'Jet engine', 'Core flow и bypass flow'],
          ] as const).map(([v, lab, t, sub]) => (
            <button key={lab} className="demo glass" onClick={() => openVehicle(v, () => getApp().set({ lab: { id: lab } }))}>
              <span className="play" />
              <span><small>{VEHICLES[v].name}</small><b>{t}</b><small style={{ letterSpacing: 0, fontFamily: 'var(--f-ui)', fontSize: 13 }}>{sub}</small></span>
            </button>
          ))}
        </div>
        <p className="land-foot">Модели процедурные и схематичные: агрегаты расположены как в типовой компоновке, размеры кузова близки к реальным. Representative configurations — exact configuration may vary by model year, engine and market. Сайт показывает принцип работы, а не заменяет руководство по ремонту конкретного автомобиля или борта.</p>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- search */
export function Search() {
  const open = useApp((s) => s.panels.search)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const hits = useMemo(() => search(q), [q])
  useEffect(() => { setI(0) }, [q])
  if (!open) return null
  const close = () => getApp().set({ panels: { ...getApp().panels, search: false } })
  const go = (h: Hit) => { goToHit(h); setQ('') }
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="search glass" role="dialog" aria-label="Search systems">
        <input id="search-input" autoFocus placeholder="Search systems…  например «Where is the turbo?»" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(hits.length - 1, i + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)) }
            if (e.key === 'Enter' && hits[i]) go(hits[i])
          }} />
        {hits.length > 0 ? (
          <div className="results">
            {hits.map((h, k) => (
              <button key={h.vehicle.id + h.comp.id} className={`result ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => go(h)}>
                <b>{h.comp.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {h.comp.ru}</span></b>
                <small>{h.comp.beginner.slice(0, 96)}…</small>
                <em>{h.vehicle.name}</em>
              </button>
            ))}
          </div>
        ) : (
          <div className="hint">
            Try:{['Where is the turbo?', 'common rail', 'ABS', 'где бак', 'закрылки', 'APU', 'battery'].map((t) => <button key={t} onClick={() => setQ(t)}>{t}</button>)}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- settings + journey */
export function Settings() {
  const open = useApp((s) => s.panels.settings)
  const level = useApp((s) => s.level)
  const sound = useApp((s) => s.sound)
  const quality = useApp((s) => s.quality)
  const hotspots = useApp((s) => s.hotspots)
  if (!open) return null
  const set = getApp().set
  return (
    <div className="popover glass">
      <h4>EXPLANATIONS</h4>
      <div className="seg"><button className={level === 'beginner' ? 'on' : ''} onClick={() => set({ level: 'beginner' })}>Beginner</button><button className={level === 'engineer' ? 'on' : ''} onClick={() => set({ level: 'engineer' })}>Engineer</button></div>
      <h4>SOUND</h4>
      <div className="seg"><button className={!sound ? 'on' : ''} onClick={() => set({ sound: false })}>Off</button><button className={sound ? 'on' : ''} onClick={() => set({ sound: true })}>On</button></div>
      <h4>GRAPHICS</h4>
      <div className="seg"><button className={quality === 'high' ? 'on' : ''} onClick={() => set({ quality: 'high' })}>High</button><button className={quality === 'low' ? 'on' : ''} onClick={() => set({ quality: 'low' })}>Fast</button></div>
      <h4>HOTSPOTS</h4>
      <div className="seg"><button className={hotspots ? 'on' : ''} onClick={() => set({ hotspots: true })}>Show</button><button className={!hotspots ? 'on' : ''} onClick={() => set({ hotspots: false })}>Hide</button></div>
    </div>
  )
}

export function Journey() {
  const open = useApp((s) => s.panels.journey)
  useApp((s) => s.understood)
  if (!open) return null
  const all = ORDER.every((v) => VEHICLES[v].checklist.every((c) => c.ids.some((id) => getApp().understood[v].includes(id))))
  return (
    <div className="popover glass">
      <h4>YOUR JOURNEY</h4>
      {ORDER.map((id) => {
        const v = VEHICLES[id]; const p = progress(v)
        return (
          <div key={id} className="journey-row">
            <span>{v.name}<em>{p}%</em></span>
            <div className="bar"><i style={{ width: `${p}%` }} /></div>
          </div>
        )
      })}
      <button className="btn" onClick={() => getApp().set({ screen: 'final', panels: { ...getApp().panels, journey: false } })}>{all ? "You've seen how it works →" : 'Checklist'}</button>
    </div>
  )
}

/* ---------------------------------------------------------------- final */
export function Final() {
  const understood = useApp((s) => s.understood)
  const all = ORDER.every((v) => VEHICLES[v].checklist.every((c) => c.ids.some((id) => understood[v].includes(id))))
  return (
    <div className="final">
      <span className="eyebrow">{all ? 'Journey complete' : 'Your checklist'}</span>
      <h1 style={{ marginTop: 16 }}>{all ? "YOU'VE SEEN HOW IT WORKS." : 'ALMOST THERE.'}</h1>
      <div className="final-grid">
        {ORDER.map((id) => {
          const v = VEHICLES[id]
          return (
            <div key={id} className="final-card glass">
              <h3>{v.name}</h3>
              {v.checklist.map((c) => {
                const ok = c.ids.some((x) => understood[id].includes(x))
                return <div key={c.label} className={`check ${ok ? 'ok' : ''}`}><i>{ok ? '✓' : ''}</i>{c.label}</div>
              })}
              {!v.checklist.every((c) => c.ids.some((x) => understood[id].includes(x))) && <button className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => openVehicle(id)}>Continue →</button>}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 40, display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={() => getApp().set({ screen: 'landing' })}>Explore again</button>
      </div>
    </div>
  )
}
