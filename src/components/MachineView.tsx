import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp, getApp, type Tray } from '../store'
import type { ComponentDef, FlowKind, VehicleDef } from '../data/types'
import { FLOW_META, CAR_FLOWS, AIR_FLOWS } from '../data/flowMeta'
import { MachineScene } from '../scenes/MachineScene'
import { currentDef as currentDefSafe, applyStep, clearSelection, exitLearn, focusSystem, goZone, progress, selectComponent, startLearn, stepLearn } from '../utils/actions'
import { useHover } from './hover'
import { LabHost } from '../labs/LabHost'
import { HotspotLayer } from './HotspotLayer'
import { liveRuntime } from '../models/runtime'
import type { FlightPhase } from '../store'

/* ---------------------------------------------------------------- top-left */
function HudTopLeft({ def }: { def: VehicleDef }) {
  const [open, setOpen] = useState(false)
  const quiet = useApp((s) => !!s.learn || s.tray === 'flight')
  return (
    <div className={`hud-tl ${open ? 'open' : ''}`}>
      <button className="home" onClick={() => getApp().set({ screen: 'landing', vehicleId: null, lab: null })} aria-label="На главную"><i />HOW IT WORKS</button>
      <div>
        <h1 onClick={() => setOpen(!open)}>{def.name}</h1>
        <div className="line" style={{ marginTop: 8 }}>{def.line}</div>
      </div>
      {!quiet && <dl className="specs">
        {def.specs.flatMap((s) => [<dt key={s.label + 't'}>{s.label}</dt>, <dd key={s.label}>{s.value}</dd>])}
      </dl>}
      {!quiet && <div className="rep"><b>{def.representative}</b>{def.varies}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- top-right */
function HudTopRight() {
  const panels = useApp((s) => s.panels)
  const sound = useApp((s) => s.sound)
  const open = useApp((s) => s.openPanel)
  return (
    <div className="hud-tr">
      <button className={`btn ${panels.systems ? 'on' : ''}`} onClick={() => open('systems')} aria-label="Systems"><span className="t">Systems</span><span className="ic">☰</span></button>
      <button className="btn" onClick={() => open('search')} aria-label="Search"><span className="t">Search <span className="mono" style={{ opacity: 0.5 }}>⌘K</span></span><span className="ic">⌕</span></button>
      <button className={`btn ${panels.journey ? 'on' : ''}`} onClick={() => open(panels.journey ? null : 'journey')} aria-label="Journey"><span className="t">Journey</span><span className="ic">◔</span></button>
      <button className={`btn icon-btn ${panels.settings ? 'on' : ''}`} onClick={() => open(panels.settings ? null : 'settings')} aria-label="Settings">⚙</button>
      <button className={`btn icon-btn ${sound ? 'on' : ''}`} onClick={() => getApp().set({ sound: !sound })} aria-label={sound ? 'Sound off' : 'Sound on'}>{sound ? '♪' : '♪̸'}</button>
    </div>
  )
}

/* ---------------------------------------------------------------- systems list */
function SystemsPanel({ def }: { def: VehicleDef }) {
  const focus = useApp((s) => s.focusSystem)
  const selected = useApp((s) => s.selected)
  const understood = useApp((s) => s.understood[def.id])
  return (
    <div className="systems glass">
      <div className="eyebrow">Systems · {progress(def)}% explored</div>
      {def.systems.map((sys) => {
        const comps = def.components.filter((c) => c.system === sys.id)
        if (!comps.length) return null
        const on = focus === sys.id
        return (
          <div key={sys.id}>
            <button className={`sys ${on ? 'on' : ''}`} onClick={() => focusSystem(def, sys.id)}>
              <span><b>{sys.label}</b> <small>{sys.ru}</small></span>
              <span className="n">{comps.filter((c) => understood.includes(c.id)).length}/{comps.length}</span>
            </button>
            {on && (
              <div className="comp-list">
                {comps.map((c) => (
                  <button key={c.id} className={selected === c.id ? 'on' : ''} onClick={() => selectComponent(def, c.id)}>
                    {c.name}{understood.includes(c.id) && <span className="ok">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ---------------------------------------------------------------- info panel */
function Gauge({ g }: { g: NonNullable<ComponentDef['gauge']> }) {
  const [w, setW] = useState(0)
  const [v, setV] = useState(0)
  useEffect(() => {
    setW(0); setV(0)
    const t = setTimeout(() => setW((g.value / g.max) * 100), 60)
    let raf = 0; const t0 = performance.now()
    const tick = () => { const k = Math.min(1, (performance.now() - t0) / 1400); setV(Math.round(g.value * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => { clearTimeout(t); cancelAnimationFrame(raf) }
  }, [g])
  return (
    <div className="gauge">
      <span className="eyebrow">{g.label}</span>
      <div className="v">{v.toLocaleString('ru-RU')}<small>{g.unit}</small></div>
      <div className="gauge-track"><i style={{ width: `${w}%` }} /></div>
      <div className="gauge-scale"><span>0</span><span>{Math.round(g.max / 2).toLocaleString('ru-RU')}</span><span>{g.max.toLocaleString('ru-RU')} {g.unit}</span></div>
      {g.note && <small style={{ color: 'var(--muted)', fontSize: 12 }}>{g.note}</small>}
    </div>
  )
}

const LAB_NAMES: Record<string, string> = { cylinder: 'Inside the cylinder', compare: 'Diesel vs petrol', turbo: 'How turbocharging works', transmission: 'How power reaches the wheels', brakes: 'Press brake · ABS', turbofan: 'Jet engine' }

function InfoPanel({ def, c }: { def: VehicleDef; c: ComponentDef }) {
  const level = useApp((s) => s.level)
  const understood = useApp((s) => s.understood[def.id].includes(c.id))
  const mark = useApp((s) => s.markUnderstood)
  const act = useApp((s) => s.act)
  useEffect(() => { const t = setTimeout(() => mark(def.id, c.id), 3500); return () => clearTimeout(t) }, [c.id, def.id, mark])
  const sys = def.systems.find((s) => s.id === c.system)
  return (
    <div className="info glass" key={c.id}>
      <header>
        <div>
          <span className="eyebrow">{sys?.label} · {level === 'beginner' ? 'Beginner' : 'Engineer'}</span>
          <h2>{c.name}</h2>
          <div className="ru">{c.ru}</div>
        </div>
        <button className="btn sm icon-btn" onClick={() => clearSelection(def)} aria-label="Закрыть">✕</button>
      </header>
      <p>{level === 'beginner' ? c.beginner : c.engineer}</p>
      {level === 'beginner' && <p style={{ color: 'var(--muted)', fontSize: 13 }}>{c.engineer}</p>}
      {c.gauge && <Gauge g={c.gauge} />}
      {c.flows && c.flows.length > 0 && (
        <div className="chips">{c.flows.map((k) => <span key={k} className="chip" style={{ ['--c' as string]: FLOW_META[k].color }}><i />{FLOW_META[k].label}</span>)}</div>
      )}
      {c.varies && <div className="varies">{c.varies}</div>}
      <div className="actions">
        {c.lab && <button className="btn primary" onClick={() => getApp().set({ lab: { id: c.lab! } })}>See how it works</button>}
        {c.action && <button className="btn" onClick={() => act(c.action!)}>{actionLabel(c.action)}</button>}
        {c.path && c.path.length > 0 && <button className="btn" onClick={() => getApp().set({ flowIsolate: !getApp().flowIsolate })}>Isolate flow</button>}
      </div>
      {understood && <span className="understood">✓ UNDERSTOOD</span>}
    </div>
  )
}

function actionLabel(a: string) {
  return ({ engineStart: 'Start engine', brake: 'Press brake', steer: 'Turn wheel', drive: 'Drive', airbag: 'Deploy airbag', openTrunk: 'Open trunk', openHood: 'Open hood', openDoor: 'Open door', flaps: 'Move flaps', slats: 'Move slats', spoilers: 'Raise spoilers', rollLeft: 'Roll left', pitchUp: 'Pitch up', yawLeft: 'Yaw left', gearDown: 'Deploy gear', gearUp: 'Retract gear', apuStart: 'Start APU', enginesStart: 'Start engines' } as Record<string, string>)[a] ?? a
}

/* ---------------------------------------------------------------- dock + trays */
function useTray(t: Tray) {
  const tray = useApp((s) => s.tray)
  return [tray === t, () => {
    const s = getApp()
    const next = tray === t ? null : t
    const patch: Partial<ReturnType<typeof getApp>> = { tray: next }
    if (t === 'flows') { patch.flowIsolate = next === 'flows'; patch.activeFlows = next === 'flows' ? (s.activeFlows.length ? s.activeFlows : ['fuel']) : []; patch.selected = null; patch.focusSystem = null; patch.activePaths = [] }
    if (t === 'exploded') { patch.exploded = next === 'exploded'; const d = currentDefSafe(); if (d && next) s.flyTo({ pos: [d.overview.pos[0] * 1.45, d.overview.pos[1] * 1.6, d.overview.pos[2] * 1.45], target: [d.overview.target[0], d.overview.target[1] + 0.4 * d.scale, d.overview.target[2]] }) }
    if (t === 'walk' && next !== 'walk') patch.walkZone = null
    if (t === 'drive') { if (next) s.act('drive'); else s.setSim({ driving: false, throttle: 0 }) }
    s.set(patch)
  }] as const
}

function FlowsTray({ def }: { def: VehicleDef }) {
  const active = useApp((s) => s.activeFlows)
  const kinds = (def.kind === 'car' ? CAR_FLOWS : AIR_FLOWS).filter((k) => def.flows.some((f) => f.kind === k))
  const toggle = (k: FlowKind) => getApp().set({ activeFlows: active.includes(k) ? active.filter((x) => x !== k) : [...active, k], flowIsolate: true })
  return (
    <div className="tray glass">
      <span className="lbl">FLOWS</span>
      {kinds.map((k) => (
        <button key={k} className={`btn sm ${active.includes(k) ? '' : 'off'}`} style={{ ['--c' as string]: FLOW_META[k].color }} onClick={() => toggle(k)}><i className="dot" />{FLOW_META[k].label}</button>
      ))}
      <button className="btn sm ghost" onClick={() => getApp().set({ activeFlows: kinds })}>All</button>
    </div>
  )
}

function WalkTray({ def }: { def: VehicleDef }) {
  const zone = useApp((s) => s.walkZone)
  const i = def.walk.findIndex((w) => w.id === zone)
  return (
    <div className="tray glass">
      <span className="lbl">WALK THROUGH</span>
      <button className="btn sm ghost" onClick={() => goZone(def, def.walk[Math.max(0, i - 1)].id)} aria-label="Previous zone">←</button>
      {def.walk.map((w) => <button key={w.id} className={`btn sm ${zone === w.id ? 'on' : ''}`} onClick={() => goZone(def, w.id)}>{w.label}</button>)}
      <button className="btn sm ghost" onClick={() => goZone(def, def.walk[Math.min(def.walk.length - 1, i + 1)].id)} aria-label="Next zone">→</button>
    </div>
  )
}

function ExplodedTray({ def }: { def: VehicleDef }) {
  const hidden = useApp((s) => s.hiddenLayers)
  return (
    <div className="tray glass">
      <span className="lbl">LAYERS</span>
      {def.layers.map((l) => (
        <button key={l.id} className={`btn sm ${hidden.includes(l.id) ? 'off' : ''}`} onClick={() => getApp().set({ hiddenLayers: hidden.includes(l.id) ? hidden.filter((x) => x !== l.id) : [...hidden, l.id] })}>{l.label}</button>
      ))}
    </div>
  )
}

function Hold({ label, onDown, onUp, className = '' }: { label: string; onDown: () => void; onUp: () => void; className?: string }) {
  return (
    <button className={`btn sm ${className}`} onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); onDown() }} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') onDown() }} onKeyUp={onUp}>{label}</button>
  )
}

function Readout() {
  const [r, setR] = useState({ rpm: 0, kmh: 0, n1: 0 })
  useEffect(() => { const id = setInterval(() => { const rt = liveRuntime.current; setR({ rpm: Math.round(rt.rpm / 10) * 10, kmh: Math.round(rt.speed * 3.6 * 1.8), n1: Math.round(rt.n1 * 100) }) }, 120); return () => clearInterval(id) }, [])
  return <span className="lbl mono" style={{ color: 'var(--text)' }}>{r.rpm} RPM · {r.kmh} KM/H</span>
}

const DRIVE_TEXT: Record<string, string> = {
  idle: 'Двигатель работает, машина катится. Удерживайте THROTTLE или BRAKE, поворачивайте руль.',
  throttle: 'Газ: педаль → датчик → ЭБУ. ЭБУ впрыскивает больше топлива, турбина раскручивается и даёт больше воздуха, обороты растут, коробка передаёт больше момента на колёса.',
  brake: 'Тормоз: педаль → главный цилиндр → тормозная жидкость → суппорты сжимают диски. Диски нагреваются, колёса замедляются.',
}
function DriveTray({ def }: { def: VehicleDef }) {
  const setSim = useApp((s) => s.setSim)
  const mode = useApp((s) => (s.sim.brake > 0.5 ? 'brake' : s.sim.throttle > 0.6 ? 'throttle' : 'idle'))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', maxWidth: '100%' }}>
    <div className="tray glass" style={{ maxWidth: 720 }}><span style={{ fontSize: 13.5, color: '#d3dbe4', padding: '2px 10px', textAlign: 'center' }}>{DRIVE_TEXT[mode]}</span></div>
    <div className="tray glass">
      <span className="lbl">DRIVE</span>
      <Readout />
      <Hold label="Throttle" onDown={() => { setSim({ engine: 'running', driving: true, throttle: 1 }); getApp().set({ activeFlows: ['fuel', 'air', 'exhaust'], activePaths: [] }) }} onUp={() => setSim({ throttle: 0.3 })} />
      <Hold label="Brake" className="" onDown={() => { setSim({ brake: 1 }); getApp().set({ activeFlows: ['hydraulic'], activePaths: [] }) }} onUp={() => setSim({ brake: 0 })} />
      <button className="btn sm" onClick={() => setSim({ steer: 1 })}>Steer left</button>
      <button className="btn sm" onClick={() => setSim({ steer: 0 })}>Straight</button>
      <button className="btn sm" onClick={() => setSim({ steer: -1 })}>Steer right</button>
      <button className="btn sm" onClick={() => getApp().set({ lab: { id: 'brakes' } })}>ABS lab</button>
      <button className="btn sm" onClick={() => getApp().set({ lab: { id: 'transmission' } })}>Gears</button>
      {def.awd && <button className="btn sm" onClick={() => selectComponent(def, 'transferCase')}>4WD</button>}
    </div>
    </div>
  )
}

const FBW = ['PILOT INPUT', 'FLIGHT CONTROL COMPUTERS', 'HYDRAULIC ACTUATORS', 'CONTROL SURFACE']
function ControlsTray() {
  const sim = useApp((s) => s.sim)
  const act = useApp((s) => s.act)
  const setSim = useApp((s) => s.setSim)
  const [stage, setStage] = useState(-1)
  const [what, setWhat] = useState('')
  const command = (a: 'pitchUp' | 'rollLeft' | 'yawLeft', label: string, paths: string[]) => {
    setWhat(label)
    getApp().set({ activePaths: [...paths], activeFlows: [] })
    FBW.forEach((_, i) => setTimeout(() => { setStage(i); if (i === 3) act(a) }, i * 450))
    setTimeout(() => { setStage(-1); getApp().set({ activePaths: [] }) }, 3600)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', maxWidth: '100%' }}>
      {stage >= 0 && (
        <div className="tray glass">
          <span className="lbl">{what}</span>
          {FBW.map((f, i) => <span key={f} className={`btn sm ${stage >= i ? 'on' : 'off'}`} style={{ pointerEvents: 'none' }}>{f}</span>)}
        </div>
      )}
    <div className="tray glass">
      <span className="lbl">FLIGHT CONTROLS</span>
      <button className="btn sm" onClick={() => command('pitchUp', 'PITCH UP → ELEVATOR', ['sig-stick', 'sig-tail', 'hyd-yellow-tail'])}>Pitch up</button>
      <button className="btn sm" onClick={() => command('rollLeft', 'ROLL LEFT → AILERONS + SPOILERS', ['sig-stick', 'sig-wing-L', 'sig-wing-R', 'hyd-green-wing', 'hyd-yellow-wing'])}>Roll left</button>
      <button className="btn sm" onClick={() => command('yawLeft', 'YAW LEFT → RUDDER', ['sig-stick', 'sig-tail', 'sig-rudder', 'hyd-blue-tail'])}>Yaw left</button>
      <button className={`btn sm ${sim.flaps > 0.5 ? 'on' : ''}`} onClick={() => setSim({ flaps: sim.flaps > 0.5 ? 0 : 1 })}>Flaps</button>
      <button className={`btn sm ${sim.slats > 0.5 ? 'on' : ''}`} onClick={() => setSim({ slats: sim.slats > 0.5 ? 0 : 1 })}>Slats</button>
      <button className={`btn sm ${sim.spoilers > 0.5 ? 'on' : ''}`} onClick={() => setSim({ spoilers: sim.spoilers > 0.5 ? 0 : 1 })}>Spoilers</button>
      <button className={`btn sm ${sim.gear > 0.5 ? 'on' : ''}`} onClick={() => setSim({ gear: sim.gear > 0.5 ? 0 : 1 })}>{sim.gear > 0.5 ? 'Retract gear' : 'Deploy gear'}</button>
      <button className={`btn sm ${sim.apu ? 'on' : ''}`} onClick={() => { setSim({ apu: !sim.apu }); getApp().set({ activePaths: sim.apu ? [] : ['air-apu', 'elec-apu', 'apu-exh', 'fuel-apu'] }) }}>APU</button>
    </div>
    </div>
  )
}

const PHASES: { id: FlightPhase; label: string }[] = [
  { id: 'pushback', label: 'Pushback' }, { id: 'taxi', label: 'Taxi' }, { id: 'takeoff', label: 'Takeoff' }, { id: 'climb', label: 'Climb' },
  { id: 'cruise', label: 'Cruise' }, { id: 'descent', label: 'Descent' }, { id: 'landing', label: 'Landing' },
]
export const PHASE_TEXT: Record<FlightPhase, string> = {
  gate: 'Самолёт у гейта, двигатели выключены. Питание и воздух даёт ВСУ.',
  pushback: 'Тягач толкает самолёт назад. Во время буксировки запускаются двигатели — сжатым воздухом от ВСУ.',
  taxi: 'Руление на тяге двигателей малого газа. Поворачивает передняя стойка (штурвальчик в кабине). Закрылки выпущены во взлётное положение.',
  takeoff: 'Взлётный режим, разбег. На скорости подъёма пилот берёт ручку на себя — руль высоты поднимает нос, крыло создаёт подъёмную силу. После отрыва шасси убирается.',
  climb: 'Набор высоты: закрылки и предкрылки постепенно убираются, крыло становится «чистым».',
  cruise: 'Крейсерский полёт: механизация убрана, двигатели на стабильном режиме, салон под давлением.',
  descent: 'Снижение на малом газе. Интерцепторы могут работать как воздушные тормоза.',
  landing: 'Выпуск шасси и полной механизации, касание, интерцепторы гасят подъёмную силу, реверс и колёсные тормоза останавливают самолёт.',
}

function FlightTray() {
  const phase = useApp((s) => s.sim.phase)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', maxWidth: '100%' }}>
      <div className="tray glass" style={{ maxWidth: 720 }}>
        <span style={{ fontSize: 13.5, color: '#d3dbe4', padding: '2px 10px', textAlign: 'center' }}>{PHASE_TEXT[phase]}</span>
      </div>
      <div className="tray glass">
        <span className="lbl">FLIGHT</span>
        {PHASES.map((p) => <button key={p.id} className={`btn sm ${phase === p.id ? 'on' : ''}`} onClick={() => getApp().setSim({ phase: p.id })}>{p.label}</button>)}
        <button className="btn sm ghost" onClick={() => getApp().setSim({ phase: 'gate', gear: 1, flaps: 0, slats: 0, spoilers: 0, jets: 0 })}>Gate</button>
      </div>
    </div>
  )
}

function Dock({ def }: { def: VehicleDef }) {
  const tray = useApp((s) => s.tray)
  const cutaway = useApp((s) => s.cutaway)
  const xray = useApp((s) => s.xray)
  const engine = useApp((s) => s.sim.engine)
  const jets = useApp((s) => s.sim.jets)
  const [walkOn, walk] = useTray('walk')
  const [flowsOn, flows] = useTray('flows')
  const [exOn, exploded] = useTray('exploded')
  const [driveOn, drive] = useTray('drive')
  const [ctlOn, controls] = useTray('controls')
  const [flOn, flight] = useTray('flight')
  const car = def.kind === 'car'
  const running = car ? engine !== 'off' : jets > 0.1
  useEffect(() => { if (walkOn && !getApp().walkZone) goZone(def, def.walk[0].id) }, [walkOn, def])
  useEffect(() => { if (flOn) { const s = getApp(); s.flyTo({ pos: [-34, 12, 34], target: [0, 4, 0] }) } else if (getApp().sim.phase !== 'gate') getApp().setSim({ phase: 'gate' }) }, [flOn])
  return (
    <div className="dock-wrap">
      {tray === 'flows' && <FlowsTray def={def} />}
      {tray === 'walk' && <WalkTray def={def} />}
      {tray === 'exploded' && <ExplodedTray def={def} />}
      {tray === 'drive' && <DriveTray def={def} />}
      {tray === 'controls' && <ControlsTray />}
      {tray === 'flight' && <FlightTray />}
      <div className="dock glass">
        {car ? <button className={`btn ${driveOn ? 'on' : ''}`} onClick={drive}>Drive</button>
          : <button className={`btn ${flOn ? 'on' : ''}`} onClick={flight}>Flight</button>}
        <button className={`btn ${walkOn ? 'on' : ''}`} onClick={walk}>Walk</button>
        <button className={`btn ${cutaway ? 'on' : ''}`} onClick={() => getApp().set({ cutaway: !cutaway })}>Cutaway</button>
        <button className={`btn ${xray ? 'on' : ''}`} onClick={() => getApp().set({ xray: !xray })}>X-Ray</button>
        <button className={`btn ${exOn ? 'on' : ''}`} onClick={exploded}>Exploded</button>
        <button className={`btn ${flowsOn ? 'on' : ''}`} onClick={flows}>Flows</button>
        {!car && <button className={`btn ${ctlOn ? 'on' : ''}`} onClick={controls}>Controls</button>}
        <span className="sep" />
        <button className={`btn go ${running ? 'on' : ''}`} onClick={() => {
          if (running) { getApp().act(car ? 'engineStop' : 'neutral'); if (!car) getApp().setSim({ jets: 0, apu: false }); exitLearn(null) } else startLearn(def, 'start')
        }}>{running ? 'Stop engine' : car ? 'Start engine' : 'Start engines'}</button>
        <button className="btn" onClick={() => startLearn(def, 'power')}>{car ? 'Power path' : 'Fuel → thrust'}</button>
        <button className="btn" onClick={() => startLearn(def, 'learn')}>Learn</button>
        <button className="btn ghost" onClick={() => { getApp().resetView(); getApp().flyTo(def.overview) }}>Reset</button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- learn overlay */
function LearnOverlay({ def }: { def: VehicleDef }) {
  const learn = useApp((s) => s.learn)!
  const [paused, setPaused] = useState(false)
  const st = learn.steps[learn.index]
  const last = learn.index === learn.steps.length - 1
  useEffect(() => {
    if (!learn.auto || paused || last) return
    const t = setTimeout(() => stepLearn(def, 1), (st.duration ?? 4.5) * 1000)
    return () => clearTimeout(t)
  }, [learn.index, learn.auto, paused, last, def, st])
  if (learn.style === 'chain') {
    return (
      <div className="chain glass">
        <div className="chain-head">
          <b>{learn.title}</b>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm" onClick={() => stepLearn(def, -1)} disabled={learn.index === 0}>Prev</button>
            <button className="btn sm primary" onClick={() => (last ? exitLearn(def) : stepLearn(def, 1))}>{last ? 'Done' : 'Next'}</button>
            <button className="btn sm ghost" onClick={() => exitLearn(def)} aria-label="Закрыть">✕</button>
          </div>
        </div>
        <div className="chain-steps">
          {learn.steps.map((s, i) => (
            <button key={i} className={i === learn.index ? 'on' : i < learn.index ? 'done' : ''} onClick={() => { getApp().set({ learn: { ...learn, index: i } }); applyStep(def, s) }}>{s.title}</button>
          ))}
        </div>
        <p>{st.text}</p>
      </div>
    )
  }
  return (
    <div className="learn glass">
      <div className="row"><span className="step">{learn.demo ? 'DEMO' : learn.title} · {String(learn.index + 1).padStart(2, '0')} / {String(learn.steps.length).padStart(2, '0')}</span><button className="btn sm ghost" onClick={() => exitLearn(def)} aria-label="Закрыть">✕</button></div>
      {learn.demo && <span className="eyebrow">{def.demo.title}</span>}
      <h3>{st.title}</h3>
      <p>{st.text}</p>
      <div className="progress"><i style={{ width: `${((learn.index + 1) / learn.steps.length) * 100}%` }} /></div>
      <div className="row">
        <button className="btn sm" onClick={() => stepLearn(def, -1)} disabled={learn.index === 0}>Back</button>
        {learn.auto && !last && <button className="btn sm ghost" onClick={() => setPaused(!paused)}>{paused ? 'Play' : 'Pause'}</button>}
        <button className="btn sm primary" onClick={() => (last ? exitLearn(def) : stepLearn(def, 1))}>{last ? 'Finish' : 'Next'}</button>
      </div>
    </div>
  )
}

function HoverTip() {
  const h = useHover()
  if (!h.name) return null
  return <div className="hover-tip" style={{ left: h.x, top: h.y }}>{h.name}</div>
}

export function MachineView({ def }: { def: VehicleDef }) {
  const selected = useApp((s) => s.selected)
  const systemsOpen = useApp((s) => s.panels.systems)
  const learn = useApp((s) => s.learn)
  const lab = useApp((s) => s.lab)
  const comp = useMemo(() => def.components.find((c) => c.id === selected), [def, selected])
  const learnRef = useRef(learn)
  learnRef.current = learn
  return (
    <div className="machine-view">
      <MachineScene def={def} paused={!!lab} />
      <HotspotLayer def={def} />
      <HudTopLeft def={def} />
      <HudTopRight />
      <div className="side">
        {comp && (!learn || learn.style === 'chain') ? <InfoPanel def={def} c={comp} /> : systemsOpen && !learn ? <SystemsPanel def={def} /> : null}
      </div>
      {learn && <LearnOverlay def={def} />}
      <Dock def={def} />
      <HoverTip />
      {lab && <LabHost def={def} />}
    </div>
  )
}
