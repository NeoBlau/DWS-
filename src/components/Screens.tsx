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
import type { ExplorerId } from '../store'
import { useT, useLang, T, type Txt } from '../explorer/i18n'

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
  const t = useT()
  const { lang, setLang } = useLang()
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
          <span className="logo"><i />{t(T('КАК ЭТО РАБОТАЕТ', 'HOW IT WORKS'))}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="seg xp-lang"><button className={lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>RU</button><button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button></div>
            <button className="btn" onClick={() => getApp().openPanel('search')}>{t(T('Поиск', 'Search'))}</button>
            {all && <button className="btn" onClick={() => getApp().set({ screen: 'final' })}>{t(T('Итоги', 'Your summary'))}</button>}
          </div>
        </div>
        <section className="hero">
          <span className="eyebrow">{t(T('Интерактивные инженерные симуляции', 'Interactive engineering simulations'))}</span>
          <h1><span>{t(T('ПОЙМИ, КАК', 'UNDERSTAND'))}</span><span>{t(T('ЭТО ДВИЖЕТСЯ.', 'WHAT MOVES YOU.'))}</span></h1>
          <p>{t(T('Двигатель в разрезе, где поршни, клапаны, турбина и коробка работают по-настоящему, а топливо, воздух и выхлоп видно потоками. И самолёт, который взлетает только от ваших рук: газ, закрылки, ручка — и всё объясняется по ходу.', 'An engine in cutaway where pistons, valves, turbo and gearbox really move, with fuel, air and exhaust shown as flows. And an airliner that only flies because you fly it: thrust, flaps, sidestick — explained as you go.'))}</p>
          <div className="cta">
            <button className="btn primary" onClick={() => openExplorer('diesel')}>{t(T('Дизель в разрезе', 'Diesel cutaway'))}</button>
            <button className="btn" onClick={() => openExplorer('flight')}>{t(T('Мини-полёт на A320', 'A320 mini flight'))}</button>
          </div>
        </section>
        <div className="machines-row sims">
          {SIMS.map((x) => (
            <button key={x.id} className="mcard glass" onClick={() => openExplorer(x.id)}>
              <span className="k">{t(x.k)}</span>
              <h2>{t(x.title)}</h2>
              <p>{t(x.text)}</p>
              <span className="go">{t(T('Открыть →', 'Open →'))}</span>
            </button>
          ))}
        </div>
        <div className="section-title"><h3>{t(T('3D-туры по машинам', '3D machine tours'))}</h3><span className="eyebrow">{t(T('кузов, салон, системы', 'body, cabin, systems'))}</span></div>
        <div className="machines-row">
          {ORDER.map((id) => {
            const v = VEHICLES[id]
            const p = progress(v)
            return (
              <button key={id} className="mcard glass" onClick={() => openVehicle(id)}>
                <span className="k">{v.line}</span>
                <h2>{v.name}</h2>
                <p>{v.tagline}</p>
                <div className="meter"><span>{t(T('ИЗУЧЕНО', 'EXPLORED'))}<em style={{ fontStyle: 'normal', color: 'var(--text)' }}>{p}%</em></span><div className="bar"><i style={{ width: `${p}%` }} /></div></div>
              </button>
            )
          })}
        </div>
        <div className="section-title"><h3>{t(T('Демо-сценарии', 'Demo scenarios'))}</h3><span className="eyebrow">{t(T('30–60 с · камера ведёт сама', '30–60 s · camera drives itself'))}</span></div>
        <div className="demos">
          {ORDER.map((id, i) => (
            <button key={id} className="demo glass" onClick={() => startDemo(id)}>
              <span className="play" />
              <span><small>DEMO {String(i + 1).padStart(2, '0')} · {VEHICLES[id].name}</small><b>{VEHICLES[id].demo.title}</b><small style={{ letterSpacing: 0, fontFamily: 'var(--f-ui)', fontSize: 13 }}>{VEHICLES[id].demo.subtitle}</small></span>
            </button>
          ))}
        </div>
        <p className="land-foot">{t(T('Модели процедурные: агрегаты расположены как в типовой компоновке, цифры — представительные и приблизительные. Конкретная комплектация зависит от года, двигателя и рынка. Это учебник по принципам работы, а не руководство по ремонту или пилотированию.', 'Models are procedural: components sit as in a typical layout, numbers are representative and approximate. Exact configuration varies by model year, engine and market. This explains principles; it is not a repair or flight manual.'))}</p>
      </div>
    </div>
  )
}

const SIMS: { id: ExplorerId; k: Txt; title: Txt; text: Txt }[] = [
  { id: 'diesel', k: T('TOYOTA FORTUNER · ДИЗЕЛЬ', 'TOYOTA FORTUNER · DIESEL'), title: T('Дизель: от бака до колёс', 'Diesel: tank to wheels'), text: T('Разрез двигателя, Common Rail, 4 такта крупно, турбина, коробка и полный привод. Запуск двигателя по шагам.', 'Engine cutaway, Common Rail, the 4 strokes up close, turbo, gearbox and 4×4. Step-by-step engine start.') },
  { id: 'petrol', k: T('BMW 530i · БЕНЗИН', 'BMW 530i · PETROL'), title: T('Бензин: воздух + топливо + искра', 'Petrol: air + fuel + spark'), text: T('Непосредственный впрыск, свечи и искра, twin-scroll турбина, 8-ступенчатая коробка, задний привод.', 'Direct injection, spark plugs, twin-scroll turbo, 8-speed gearbox, rear-wheel drive.') },
  { id: 'jet', k: T('A320 · ТУРБОВЕНТИЛЯТОРНЫЙ', 'A320 · TURBOFAN'), title: T('Реактивный двигатель', 'Jet engine'), text: T('Всасывание, сжатие, сгорание, выхлоп. Вентилятор, компрессоры, камера сгорания, турбины, два вала, обходной поток.', 'Suck, squeeze, bang, blow. Fan, compressors, combustor, turbines, two spools, bypass flow.') },
  { id: 'flight', k: T('A320 · МИНИ-ПОЛЁТ', 'A320 · MINI FLIGHT'), title: T('Взлетите сами', 'Fly it yourself'), text: T('Полная физика: газ, закрылки, ручка, шасси, интерцепторы, реверс. Fly-by-wire с защитами и инструктор, который объясняет всё по ходу.', 'Full physics: thrust, flaps, sidestick, gear, spoilers, reverse. Fly-by-wire with protections and an instructor explaining everything as you go.') },
]
function openExplorer(id: ExplorerId) { getApp().set({ screen: 'explorer', explorer: id }) }

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
