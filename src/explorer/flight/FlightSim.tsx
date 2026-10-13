import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom, SMAA, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import { useApp } from '../../store'
import { useT, useLang, T, type Txt } from '../i18n'
import { A320 } from './Aircraft'
import { EYE, LOOK } from './Cockpit'
import { World } from './World'
import { Pfd, Ecam, ForceLegend, useSnap, type Snap } from './Hud'
import { AC, DEG, DEST, DETENT, H, KT, LEVER, step, advance, failEngine, type Sim } from './fdm'
import { FS, useFlight, resetSim, type CamMode } from './state'
import { applyInputs } from './input'
import { phaseNarration, explain, eventText, type Topic } from './narration'
import { FULL_STEPS, TAKEOFF_STEPS, APPROACH_STEPS, CRUISE_STEPS, type Ctl } from './guide'
import { startAudio, stopAudio, updateAudio } from './audio'
import { PAD } from '../gamepad'

/* ------------------------------------------------------------------ simulation loop: fixed 240 Hz steps */
function SimLoop() {
  const acc = useRef(0)
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const ui = useFlight.getState()
    const s = FS.sim
    if (!ui.paused && !s.crashed) {
      applyInputs(s, dt)
      acc.current += dt
      let n = 0
      while (acc.current >= H && n < 60) { step(s, H); acc.current -= H; n++ }
      if (Math.abs(s.d.phi) > 20 * DEG) s.flags.didTurn = true
    } else acc.current = 0
    // wheel spin: rolling on the ground, spinning down in the air
    const roll = (s.d.gs ?? 0) * KT
    FS.wheelRot = FS.wheelRot.map((r, i) => {
      const radius = i === 0 ? 0.38 : 0.585
      const onGround = (s.d.struts?.[i] ?? 1) < 0.3
      return r + (onGround ? roll / radius : 0) * dt
    })
    updateAudio(s, !ui.sound)
  })
  return null
}

/* ------------------------------------------------------------------ aircraft placed at the floating origin */
function AircraftRoot() {
  const g = useRef<THREE.Group>(null!)
  useFrame(() => { const s = FS.sim; g.current.position.set(0, s.pos.y, 0); g.current.quaternion.copy(s.quat) })
  return <group ref={g}><A320 /></group>
}

/* ------------------------------------------------------------------ cameras */
const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler()
function bodyPoint(layout: [number, number, number], out: THREE.Vector3) {
  const s = FS.sim
  return out.set(layout[0] - AC.cgLayout.x, layout[1] - AC.cgLayout.y, layout[2]).applyQuaternion(s.quat).add(_t.set(0, s.pos.y, 0))
}
function CameraRig({ orbit }: { orbit: React.MutableRefObject<OrbitImpl | null> }) {
  const { camera } = useThree() as { camera: THREE.PerspectiveCamera }
  const rel = useRef(new THREE.Vector3(-45, 12, 0))
  const lastY = useRef(FS.sim.pos.y)
  const look = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const s = FS.sim, mode = useFlight.getState().cam, y = s.pos.y
    // dev-only fixed camera for screenshots: [[x,y,z],[tx,ty,tz]] relative to the aircraft
    const ov = import.meta.env.DEV ? (window as unknown as { __camOverride?: [number[], number[]] }).__camOverride : undefined
    if (ov) { camera.position.set(ov[0][0], y + ov[0][1], ov[0][2]); camera.lookAt(ov[1][0], y + ov[1][1], ov[1][2]); return }
    const psi = s.d.psi ?? 0
    const k = 1 - Math.exp(-dt * 3)
    let fov = 55
    if (orbit.current) orbit.current.enabled = mode === 'orbit'
    if (mode === 'chase' || mode === 'side') {
      const back = mode === 'chase' ? _v.set(-Math.cos(psi) * 44, 11 + Math.sin(s.d.theta ?? 0) * -8, -Math.sin(psi) * 44) : _v.set(-Math.sin(psi) * -50 + Math.cos(psi) * 6, 3.5, Math.cos(psi) * 50 + Math.sin(psi) * 6)
      rel.current.lerp(back, k)
      camera.position.set(rel.current.x, y + rel.current.y, rel.current.z)
      look.set(Math.cos(psi) * 8, y + 2.5, Math.sin(psi) * 8)
      camera.up.set(0, 1, 0)
      camera.lookAt(look)
    } else if (mode === 'cockpit') {
      bodyPoint(EYE, camera.position)
      _q.copy(s.quat).multiply(new THREE.Quaternion().setFromEuler(_e.set(0, -Math.PI / 2 + LOOK.yaw, 0))).multiply(new THREE.Quaternion().setFromEuler(_e.set(LOOK.pitch, 0, 0)))
      camera.quaternion.copy(_q)
      fov = 68
    } else if (mode === 'wing') {
      bodyPoint([-0.6, 4.25, -2.15], camera.position)
      bodyPoint([-4.2, 2.6, -10.5], look)
      camera.up.set(0, 1, 0).applyQuaternion(s.quat)
      camera.lookAt(look)
      fov = 60
    } else if (mode === 'tower') {
      const x0 = s.pos.x < DEST / 2 ? 0 : DEST
      camera.position.set(x0 + 1750 - s.pos.x, 52, -300 - s.pos.z)
      look.set(0, y, 0)
      camera.up.set(0, 1, 0)
      camera.lookAt(look)
      const dist = camera.position.distanceTo(look)
      fov = Math.max(2.5, Math.min(55, ((2 * Math.atan(45 / dist)) / Math.PI) * 180))
    } else if (mode === 'orbit' && orbit.current) {
      // follow the aircraft's altitude, let the user orbit freely
      camera.position.y += y - lastY.current
      orbit.current.target.set(0, y, 0)
      orbit.current.update()
    }
    lastY.current = y
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix() }
  })
  return null
}

/* ------------------------------------------------------------------ controls */
function useHighlight(): Ctl | null {
  const guide = useFlight((s) => s.guide)
  const step = useGuideStep()
  return guide && step ? step.ctl : null
}
function useGuideStep() {
  const start = useFlight((s) => s.start)
  const epoch = useFlight((s) => s.epoch)
  const [i, setI] = useState(0)
  const steps = start === 'gate' ? FULL_STEPS : start === 'approach' ? APPROACH_STEPS : start === 'cruise' ? CRUISE_STEPS : TAKEOFF_STEPS
  useEffect(() => { setI(0) }, [epoch, start])
  useEffect(() => {
    const id = setInterval(() => { setI((k) => { let j = k; while (j < steps.length && steps[j].done(FS.sim)) j++; return j }) }, 250)
    return () => clearInterval(id)
  }, [steps])
  return steps[i] ? { ...steps[i], index: i, total: steps.length } : null
}

function ThrustLever({ v, hl }: { v: Snap; hl: boolean }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const drag = (e: RPE) => {
    const r = ref.current!.getBoundingClientRect()
    let k = 1 - (e.clientY - r.top) / r.height
    k = Math.max(0, Math.min(1, k))
    for (const d of [0, DETENT.CL, DETENT.FLX, 1]) if (Math.abs(k - d) < 0.045) k = d
    FS.sim.ctl.lever = k
  }
  const marks: [number, string][] = [[1, 'TOGA'], [DETENT.FLX, 'FLX'], [DETENT.CL, 'CL'], [0, 'IDLE']]
  return (
    <div className={`fs-lever ${hl ? 'fs-hl' : ''}`}>
      <span className="eyebrow">{t(T('РУД', 'Thrust'))}</span>
      <div className="fs-lever-track" ref={ref} onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag(e) }} onPointerMove={(e) => { if (e.buttons) drag(e) }}
        role="slider" aria-label="Thrust levers" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v.lever * 100)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowUp') FS.sim.ctl.lever = Math.min(1, FS.sim.ctl.lever + 0.05); if (e.key === 'ArrowDown') FS.sim.ctl.lever = Math.max(0, FS.sim.ctl.lever - 0.05) }}>
        {marks.map(([k, l]) => <i key={l} style={{ bottom: `${k * 100}%` }}><b>{l}</b></i>)}
        <div className="fs-lever-knob" style={{ bottom: `${v.lever * 100}%` }} />
      </div>
      <div className="fs-rev">
        <button className={`btn sm ${v.rev === 1 ? 'on' : ''}`} disabled={!v.wow} onClick={() => { const c = FS.sim.ctl; c.lever = 0; c.rev = c.rev === 1 ? 0 : 1 }}>REV</button>
        <button className={`btn sm ${v.rev === 2 ? 'on' : ''}`} disabled={!v.wow} onClick={() => { const c = FS.sim.ctl; c.lever = 0; c.rev = c.rev === 2 ? 0 : 2 }}>MAX</button>
      </div>
    </div>
  )
}

function Sidestick() {
  const ref = useRef<HTMLDivElement>(null)
  const [p, setP] = useState({ x: 0, y: 0 })
  useEffect(() => { const id = setInterval(() => { const c = FS.sim.ctl; setP({ x: c.stickX, y: c.stickY }) }, 50); return () => clearInterval(id) }, [])
  const move = (e: RPE) => {
    const r = ref.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = ((e.clientY - r.top) / r.height) * 2 - 1
    const m = Math.max(1, Math.hypot(x, y))
    FS.pad = { x: x / m, y: y / m, active: true } // dragging down = pulling back
  }
  const end = () => { FS.pad = { x: 0, y: 0, active: false } }
  return (
    <div className="fs-stick" ref={ref} onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); move(e) }} onPointerMove={(e) => { if (FS.pad.active) move(e) }} onPointerUp={end} onPointerCancel={end}
      role="application" aria-label="Sidestick: drag down to pull up, sideways to roll">
      <span className="fs-stick-cross" />
      <span className="fs-stick-knob" style={{ transform: `translate(${p.x * 46}px, ${p.y * 46}px)` }} />
    </div>
  )
}

function ControlPanel({ v }: { v: Snap }) {
  const t = useT()
  const hl = useHighlight()
  const ui = useFlight()
  const c = FS.sim.ctl
  const [, force] = useState(0)
  const set = (f: () => void) => { f(); force((n) => n + 1) }
  const cams: [CamMode, Txt][] = [['chase', T('Сзади', 'Chase')], ['side', T('Сбоку', 'Side')], ['cockpit', T('Кабина', 'Cockpit')], ['wing', T('Крыло', 'Wing')], ['tower', T('С земли', 'Tower')], ['orbit', T('Свободно', 'Free')]]
  return (
    <aside className="fs-panel glass">
      <div className={`fs-ground ${hl === 'engines' || hl === 'park' || hl === 'push' ? 'fs-hl' : ''}`}>
        <span className="eyebrow">{t(T('Двигатели и земля', 'Engines & ground'))}</span>
        <div className="fs-seg wrap">
          {[0, 1].map((i) => <button key={i} className={`btn sm fs-master ${v.masters[i] ? 'on' : ''} ${v.eng[i] === 'failed' ? 'fail' : ''}`} onClick={() => set(() => { c.master[i] = !c.master[i] })}>MASTER {i + 1}<i>{v.eng[i] === 'run' ? '●' : v.eng[i] === 'starting' ? '◐' : v.eng[i] === 'failed' ? '✕' : '○'}</i></button>)}
          <button className={`btn sm ${v.park ? 'on' : ''}`} onClick={() => set(() => { c.parkBrake = !c.parkBrake })}>PARK BRK (P)</button>
          <button className={`btn sm ${v.push ? 'on' : ''}`} disabled={v.airborne || v.gs > 6} onClick={() => set(() => { c.push = !c.push })}>{t(T('Буксир (T)', 'Pushback (T)'))}</button>
        </div>
      </div>
      <div className="fs-row">
        <ThrustLever v={v} hl={hl === 'thrust'} />
        <div className={`fs-flaps ${hl === 'flaps' ? 'fs-hl' : ''}`}>
          <span className="eyebrow">FLAPS</span>
          {LEVER.map((l, i) => <button key={l} className={`btn sm ${c.flapLever === i ? 'on' : ''}`} onClick={() => set(() => { c.flapLever = i })}>{l}{i === 1 && v.confTarget === 2 ? '+F' : ''}</button>).reverse()}
        </div>
        <div className="fs-col">
          <div className={hl === 'gear' ? 'fs-hl' : ''}>
            <span className="eyebrow">{t(T('Шасси', 'Gear'))}</span>
            <button className={`btn sm fs-gear ${v.gearLever ? 'on' : ''}`} onClick={() => set(() => { c.gearDown = !c.gearDown })}>{v.gearLever ? t(T('ВЫПУЩЕНО ▼', 'DOWN ▼')) : t(T('УБРАНО ▲', 'UP ▲'))}</button>
          </div>
          <div className={hl === 'speedbrake' ? 'fs-hl' : ''}>
            <span className="eyebrow">SPEEDBRAKE</span>
            <input type="range" min={0} max={1} step={0.05} value={c.speedbrake} onChange={(e) => set(() => { c.speedbrake = +e.target.value })} aria-label="Speedbrake" />
            <button className={`btn sm ${c.spoilersArmed ? 'on' : ''}`} onClick={() => set(() => { c.spoilersArmed = !c.spoilersArmed })}>ARM</button>
          </div>
          <div>
            <span className="eyebrow">AUTO/BRK</span>
            <div className="fs-seg">{[['OFF', 0], ['LO', 1], ['MED', 2]].map(([l, k]) => <button key={l} className={`btn sm ${c.autobrake === k ? 'on' : ''}`} onClick={() => set(() => { c.autobrake = k as 0 | 1 | 2 })}>{l}</button>)}</div>
          </div>
          <button className={`btn sm ${hl === 'brakes' ? 'fs-hl' : ''}`} onPointerDown={() => FS.keys.add('brakeUI')} onPointerUp={() => FS.keys.delete('brakeUI')} onPointerLeave={() => FS.keys.delete('brakeUI')}>{t(T('Тормоза (B)', 'Brakes (B)'))}</button>
        </div>
      </div>
      <div className={`fs-pedals ${hl === 'pedals' ? 'fs-hl' : ''}`}>
        <span className="eyebrow">{t(T('Педали (Q/E)', 'Pedals (Q/E)'))}</span>
        <input type="range" min={-1} max={1} step={0.02} defaultValue={0} aria-label="Rudder pedals"
          onPointerDown={() => FS.keys.add('pedalUI')} onPointerUp={(e) => { FS.keys.delete('pedalUI'); (e.target as HTMLInputElement).value = '0' }}
          onChange={(e) => { FS.sim.ctl.pedal = +e.target.value }} />
      </div>
      <div className="fs-law">
        <span className="eyebrow">{t(T('Закон управления', 'Control law'))}</span>
        <div className="fs-seg">
          <button className={`btn sm ${c.law === 'normal' ? 'on' : ''}`} onClick={() => set(() => { c.law = 'normal' })}>NORMAL</button>
          <button className={`btn sm ${c.law === 'direct' ? 'on' : ''}`} onClick={() => set(() => { c.law = 'direct' })}>DIRECT</button>
        </div>
        {c.law === 'direct' && <div className="fs-seg">
          <button className="btn sm" onPointerDown={() => FS.keys.add('trimDn')} onPointerUp={() => FS.keys.delete('trimDn')} onPointerLeave={() => FS.keys.delete('trimDn')}>TRIM ▼ [</button>
          <button className="btn sm" onPointerDown={() => FS.keys.add('trimUp')} onPointerUp={() => FS.keys.delete('trimUp')} onPointerLeave={() => FS.keys.delete('trimUp')}>TRIM ▲ ]</button>
        </div>}
      </div>
      <PadInfo />
      <span className="eyebrow">{t(T('Тренировка отказов', 'Failure training'))}</span>
      <div className="fs-seg wrap">
        <button className="btn sm" disabled={!v.airborne} onClick={() => failEngine(FS.sim, 0)}>{t(T('Отказ двиг. 1', 'Fail engine 1'))}</button>
        <button className="btn sm" disabled={!v.airborne} onClick={() => failEngine(FS.sim, 1)}>{t(T('Отказ двиг. 2', 'Fail engine 2'))}</button>
      </div>
      <span className="eyebrow">{t(T('Камера (C)', 'Camera (C)'))}</span>
      <div className="fs-seg wrap">{cams.map(([m, l]) => <button key={m} className={`btn sm ${ui.cam === m ? 'on' : ''}`} onClick={() => ui.set({ cam: m })}>{t(l)}</button>)}</div>
      <div className="fs-seg wrap">
        <button className={`btn sm ${ui.forces ? 'on' : ''}`} onClick={() => ui.set({ forces: !ui.forces })}>{t(T('Силы', 'Forces'))}</button>
        <button className={`btn sm ${ui.path ? 'on' : ''}`} onClick={() => ui.set({ path: !ui.path })}>{t(T('Глиссада', 'Glide path'))}</button>
        <button className={`btn sm ${ui.guide ? 'on' : ''}`} onClick={() => ui.set({ guide: !ui.guide })}>{t(T('Инструктор', 'Instructor'))}</button>
        <button className={`btn sm ${ui.sound ? 'on' : ''}`} onClick={() => { if (!ui.sound) startAudio(); else stopAudio(); ui.set({ sound: !ui.sound }) }}>{t(T('Звук', 'Sound'))}</button>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ narration, guide, toasts */
function NarrationPanel() {
  const t = useT()
  const [n, setN] = useState(() => phaseNarration(FS.sim))
  const [why, setWhy] = useState<{ title: Txt; body: Txt } | null>(null)
  const topic = useRef<Topic | null>(null)
  const prev = useRef({ ...FS.sim.ctl, conf: FS.sim.srf.confTarget })
  const lastEv = useRef(0)
  const epoch = useFlight((s) => s.epoch)
  useEffect(() => { setWhy(null); topic.current = null; lastEv.current = FS.sim.events.length; prev.current = { ...FS.sim.ctl, conf: FS.sim.srf.confTarget } }, [epoch])
  useEffect(() => {
    const id = setInterval(() => {
      const s = FS.sim, c = s.ctl, p = prev.current
      let tp: Topic | null = null
      if (s.srf.confTarget !== p.conf) tp = 'flaps'
      else if (c.gearDown !== p.gearDown) tp = 'gear'
      else if (Math.abs(c.lever - p.lever) > 0.08) tp = 'thrust'
      else if (c.rev !== p.rev && c.rev) tp = 'reverse'
      else if (c.law !== p.law) tp = 'law'
      else if (Math.abs(c.speedbrake - p.speedbrake) > 0.1 || c.spoilersArmed !== p.spoilersArmed) tp = 'speedbrake'
      else if (c.autobrake !== p.autobrake || (c.brake && !p.brake)) tp = 'brakes'
      else if (c.parkBrake !== p.parkBrake) tp = 'park'
      else if (c.trim && !p.trim) tp = 'trim'
      else if (Math.abs(c.stickX) > 0.4 && Math.abs(p.stickX) <= 0.4 && s.airborne) tp = 'roll'
      else if (Math.abs(c.stickY) > 0.4 && Math.abs(p.stickY) <= 0.4 && s.airborne) tp = 'pitch'
      else if (Math.abs(c.pedal) > 0.4 && Math.abs(p.pedal) <= 0.4) tp = 'rudder'
      for (let i = lastEv.current; i < s.events.length; i++) {
        const e = s.events[i].e
        if (e === 'alphaProt' || e === 'alphaFloor') tp = 'alphaProt'
        else if (e === 'stall') tp = 'stall'
        else if (e === 'groundSpoilers') tp = 'groundSpoilers'
        else if (e === 'tailstrike') tp = 'tailstrike'
        else if (['engineStart', 'flapJam', 'flapTorn', 'gearDamage', 'gearCollapse', 'overstress', 'engineFail', 'flameout', 'bellyLanding', 'toConfig', 'engineStrike', 'pushback'].includes(e)) tp = e as Topic
      }
      lastEv.current = s.events.length
      prev.current = { ...c, conf: s.srf.confTarget }
      if (tp) topic.current = tp
      if (topic.current) setWhy(explain(topic.current, s))
      setN(phaseNarration(s))
    }, 400)
    return () => clearInterval(id)
  }, [])
  return (
    <section className="fs-narr glass" aria-live="polite">
      <span className="eyebrow">{t(T('Что происходит', 'What is happening'))}</span>
      <h2>{t(n.phase)}</h2>
      <p>{t(n.now)}</p>
      {why && <div className="fs-why"><span className="eyebrow">{t(T('Как это работает', 'How it works'))}</span><h3>{t(why.title)}</h3><p>{t(why.body)}</p></div>}
    </section>
  )
}
function GuidePanel() {
  const t = useT()
  const on = useFlight((s) => s.guide)
  const step = useGuideStep()
  if (!on) return null
  if (!step) return <div className="fs-guide glass"><span className="eyebrow">{t(T('Инструктор', 'Instructor'))}</span><b>{t(T('Полёт выполнен! Попробуйте другой старт или прямой закон.', 'Flight complete! Try another start or Direct law.'))}</b></div>
  return (
    <div className="fs-guide glass">
      <span className="eyebrow">{t(T('Инструктор', 'Instructor'))} · {step.index + 1}/{step.total}</span>
      <b>{t(step.text)}</b>
      <small>{t(step.hint)}</small>
    </div>
  )
}
function Toasts() {
  const t = useT()
  const [list, setList] = useState<{ id: number; txt: Txt; bad: boolean }[]>([])
  const seen = useRef(0)
  const epoch = useFlight((s) => s.epoch)
  useEffect(() => { seen.current = FS.sim.events.length; setList([]) }, [epoch])
  useEffect(() => {
    const id = setInterval(() => {
      const ev = FS.sim.events
      const add: { id: number; txt: Txt; bad: boolean }[] = []
      for (let i = seen.current; i < ev.length; i++) {
        const txt = eventText(ev[i].e, ev[i].v)
        if (txt) add.push({ id: ev[i].t * 1000 + i, txt, bad: ['crash', 'stall', 'tailstrike', 'hardLanding', 'vfe', 'overspeed', 'offRunway', 'flapJam', 'flapTorn', 'gearDamage', 'gearCollapse', 'overstress', 'engineFail', 'flameout', 'engineStrike', 'toConfig', 'bellyLanding', 'fuelLow'].includes(ev[i].e) })
      }
      seen.current = ev.length
      if (add.length) setList((l) => [...l, ...add].slice(-3))
    }, 200)
    const cl = setInterval(() => setList((l) => l.slice(1)), 3800)
    return () => { clearInterval(id); clearInterval(cl) }
  }, [])
  return <div className="fs-toasts">{list.map((x) => <div key={x.id} className={`fs-toast ${x.bad ? 'bad' : ''}`}>{t(x.txt)}</div>)}</div>
}

/* ------------------------------------------------------------------ keyboard */
/** drag on the 3D view in the cockpit to look around */
function useMouseLook() {
  useEffect(() => {
    let drag = false, lx = 0, ly = 0
    const down = (e: PointerEvent) => { if (useFlight.getState().cam !== 'cockpit') return; if (!(e.target as HTMLElement).closest('.fs-canvas')) return; drag = true; lx = e.clientX; ly = e.clientY }
    const move = (e: PointerEvent) => {
      if (!drag) return
      LOOK.yaw = Math.max(-2.4, Math.min(2.4, LOOK.yaw - (e.clientX - lx) * 0.004))
      LOOK.pitch = Math.max(-1.1, Math.min(0.9, LOOK.pitch - (e.clientY - ly) * 0.004))
      lx = e.clientX; ly = e.clientY
    }
    const up = () => { drag = false }
    const dbl = (e: MouseEvent) => { if ((e.target as HTMLElement).closest('.fs-canvas')) { LOOK.yaw = 0; LOOK.pitch = -12 * DEG } }
    window.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('dblclick', dbl)
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('dblclick', dbl) }
  }, [])
}

function useKeyboard() {
  useEffect(() => {
    const flapsKey = (d: number) => { const c = FS.sim.ctl; c.flapLever = Math.max(0, Math.min(4, c.flapLever + d)) }
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
      const ui = useFlight.getState(), c = FS.sim.ctl
      FS.keys.add(e.code)
      if (e.repeat) return
      switch (e.code) {
        case 'KeyF': flapsKey(1); break
        case 'KeyV': flapsKey(-1); break
        case 'KeyG': c.gearDown = !c.gearDown; break
        case 'KeyR': if (FS.sim.d.wow) { c.lever = 0; c.rev = c.rev === 2 ? 1 : c.rev === 1 ? 0 : 2 } break
        case 'Space': ui.set({ paused: !ui.paused }); e.preventDefault(); break
        case 'KeyC': { const m: CamMode[] = ['chase', 'side', 'cockpit', 'wing', 'tower', 'orbit']; ui.set({ cam: m[(m.indexOf(ui.cam) + 1) % m.length] }); break }
        case 'KeyH': ui.set({ forces: !ui.forces }); break
        case 'KeyP': c.parkBrake = !c.parkBrake; break
        case 'KeyT': if (!FS.sim.airborne) c.push = !c.push; break
        case 'KeyM': { const on = !(c.master[0] && c.master[1]); c.master = [on, on]; break }
        case 'Digit1': c.lever = 0; break
        case 'Digit2': c.lever = DETENT.CL; break
        case 'Digit3': c.lever = DETENT.FLX; break
        case 'Digit4': c.lever = 1; break
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(e.code)) e.preventDefault()
    }
    const up = (e: KeyboardEvent) => FS.keys.delete(e.code)
    const blur = () => FS.keys.clear()
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
}

/* ------------------------------------------------------------------ shell */
export function FlightSim() {
  const t = useT()
  const { lang, setLang } = useLang()
  const quality = useApp((s) => s.quality)
  const ui = useFlight()
  const v = useSnap(15)
  const orbit = useRef<OrbitImpl | null>(null)
  useKeyboard()
  useMouseLook()
  useEffect(() => { resetSim('gate'); return () => stopAudio() }, [])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    Object.assign(window, { __flight: { FS, resetSim, advance: (sec: number) => advance(FS.sim, sec), ui: useFlight } })
  }, [])
  const starts: [Parameters<typeof resetSim>[0], Txt][] = [['gate', T('Полный рейс', 'Full flight')], ['runway', T('С полосы', 'From runway')], ['approach', T('Заход', 'Approach')], ['cruise', T('В полёте', 'In flight')]]
  return (
    <div className="fs" onPointerDown={() => { if (ui.sound) startAudio() }}>
      <Canvas className="fs-canvas" shadows dpr={quality === 'high' ? [1, 1.6] : [1, 1.2]}
        gl={{ logarithmicDepthBuffer: true, antialias: quality !== 'high', powerPreference: 'high-performance' }}
        camera={{ fov: 55, near: 0.25, far: 260000, position: [-45, 15, 0] }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.82; gl.shadowMap.type = THREE.PCFSoftShadowMap }}>
        <SimLoop />
        <World />
        <AircraftRoot />
        <CameraRig orbit={orbit} />
        <OrbitControls ref={orbit as never} enableDamping dampingFactor={0.08} minDistance={14} maxDistance={400} enabled={false} />
        {quality === 'high' && (
          <EffectComposer multisampling={0}>
            <SMAA />
            <Bloom mipmapBlur intensity={0.45} luminanceThreshold={1.15} luminanceSmoothing={0.08} radius={0.55} />
            <Vignette eskil={false} offset={0.3} darkness={0.45} />
          </EffectComposer>
        )}
      </Canvas>
      <header className="fs-top">
        <button className="btn sm" onClick={() => useApp.getState().set({ screen: 'landing' })}>← {t(T('Назад', 'Back'))}</button>
        <div className="fs-title"><span className="eyebrow">Airbus A320 · {t(T('мини-полёт', 'mini flight'))}</span><h1>{t(T('Управляйте сами', 'You fly it'))}</h1></div>
        <div className="fs-seg">
          {starts.map(([k, l]) => <button key={k} className={`btn sm ${ui.start === k ? 'on' : ''}`} onClick={() => resetSim(k)}>{t(l)}</button>)}
          <button className={`btn sm ${ui.paused ? 'on' : ''}`} onClick={() => ui.set({ paused: !ui.paused })}>{ui.paused ? '▶' : '❚❚'} {t(T('Пауза', 'Pause'))}</button>
        </div>
        <div className="seg xp-lang"><button className={lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>RU</button><button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button></div>
      </header>
      <NarrationPanel />
      <GuidePanel />
      <Toasts />
      <div className="fs-instruments"><Pfd v={v} /><Ecam v={v} /></div>
      <ForceLegend v={v} />
      <ControlPanel v={v} />
      <Sidestick />
      <Vdgs v={v} />
      {v.crashed && <div className="fs-crash glass"><b>{t(T('Авария', 'Crash'))}</b><p>{t(CRASH[v.crashed] ?? CRASH.hard)}</p><button className="btn primary" onClick={() => resetSim(ui.start)}>{t(T('Заново', 'Try again'))}</button></div>}
      {v.arrived && <Arrival v={v} />}
      <p className="fs-note">{t(T('Упрощённая учебная модель. Цифры приблизительные. Клавиши: W/S или ↑/↓ — тангаж, A/D — крен, Q/E — педали, Shift/Ctrl или 1–4 — РУД, F/V — закрылки, G — шасси, B — тормоза, R — реверс, C — камера, Пробел — пауза.', 'Simplified training model. Numbers are approximate. Keys: W/S or ↑/↓ pitch, A/D roll, Q/E pedals, Shift/Ctrl or 1–4 thrust, F/V flaps, G gear, B brakes, R reverse, C camera, Space pause.'))}</p>
    </div>
  )
}
void step; void ({} as Sim)

const CRASH: Record<string, Txt> = {
  hard: T('Слишком большая вертикальная скорость при касании — шасси и конструкция не выдержали.', 'The sink rate at touchdown was far too high — the gear and structure failed.'),
  structure: T('Перегрузка превысила расчётную (1,5 × эксплуатационной): крыло разрушилось. В нормальном законе это не дала бы защита — в прямом законе всё на пилоте.', 'Load factor exceeded the ultimate load (1.5 × limit): the wing failed. Normal law would have prevented it — in direct law it is on the pilot.'),
  flutter: T('Скорость далеко за VMO/MMO: начался флаттер — самовозбуждающиеся колебания, которые разрушили оперение.', 'Far beyond VMO/MMO: flutter — self-exciting vibration — tore the tail apart.'),
  engine: T('Двигатель ударился о землю на большой скорости или с большим креном.', 'An engine hit the ground at speed or with too much bank.'),
  wingtip: T('Законцовка крыла зацепила землю — самолёт развернуло и разрушило.', 'A wingtip caught the ground — the aircraft cartwheeled.'),
  belly: T('Посадка на брюхо с большой вертикальной скоростью.', 'A belly landing with a high sink rate.'),
  tail: T('Сильный удар хвостом о полосу разрушил хвостовую часть.', 'A violent tail strike destroyed the aft fuselage.'),
  terrain: T('Столкновение с землёй.', 'Controlled flight into terrain.'),
}

function PadInfo() {
  const t = useT()
  const [id, setId] = useState('')
  useEffect(() => { const k = setInterval(() => setId(PAD.connected ? PAD.id : ''), 1000); return () => clearInterval(k) }, [])
  if (!id) return <p className="fs-pad">{t(T('🎮 Подключите геймпад и нажмите любую кнопку', '🎮 Connect a gamepad and press any button'))}</p>
  return (
    <details className="fs-pad on">
      <summary>{t(T('🎮 Геймпад подключён', '🎮 Gamepad connected'))}</summary>
      <p>{t(T('Левый стик — ручка · правый стик X — педали, Y — взгляд в кабине · RT/LT — газ · RB/LB — закрылки · A — тормоза · B — реверс · X — шасси · Y — камера · ↑/↓ — интерцепторы · L3 — ARM · ← — буксир · → — MASTER · Back — стояночный · Start — пауза',
        'Left stick — sidestick · right stick X — pedals, Y — cockpit look · RT/LT — thrust · RB/LB — flaps · A — brakes · B — reverse · X — gear · Y — camera · ↑/↓ — speedbrake · L3 — ARM · ← — pushback · → — MASTER · Back — parking brake · Start — pause'))}</p>
    </details>
  )
}

/** visual docking guidance on the stand: distance to the stop line and left / right */
function Vdgs({ v }: { v: Snap }) {
  const t = useT()
  const st = v.stand
  if (!st || v.airborne || v.gs > 12 || Math.abs(st.dist) > 70 || Math.abs(st.lat) > 12 || !v.ever) return null
  const stop = Math.abs(st.dist) < 1 || st.dist < 0
  return (
    <div className="fs-vdgs" aria-live="polite">
      <small>{t(T('Стоянка', 'Stand'))} {st.airport}{st.id}</small>
      <b className={stop ? 'stop' : ''}>{stop ? 'STOP' : `${st.dist.toFixed(1)} m`}</b>
      <span>{Math.abs(st.lat) < 0.6 ? '▲' : st.lat > 0 ? t(T('◀ левее', '◀ left')) : t(T('правее ▶', 'right ▶'))}</span>
    </div>
  )
}
function Arrival({ v }: { v: Snap }) {
  const t = useT()
  const ui = useFlight()
  const td = Math.round(v.tdVs ?? 0)
  const grade = td > -180 ? T('мягко', 'smooth') : td > -360 ? T('нормально', 'firm') : td > -600 ? T('жёстко', 'hard') : T('очень жёстко', 'very hard')
  return (
    <div className="fs-crash fs-arrived glass">
      <b>{t(T('Прибыли на стоянку', 'Parked at the gate'))}</b>
      <ul>
        <li>{t(T('Касание', 'Touchdown'))}: {td} {t(T('фт/мин', 'ft/min'))} — {t(grade)}</li>
        <li>{t(T('Сожжено топлива', 'Fuel burnt'))}: {Math.round(v.fuelUsed)} {t(T('кг', 'kg'))}</li>
        <li>{t(T('Время рейса', 'Block time'))}: {Math.floor(v.t / 60)} {t(T('мин', 'min'))}</li>
        <li>{t(T('Повреждения', 'Damage'))}: {v.warnings.filter((w) => w.lvl !== 'green').length ? v.warnings.filter((w) => w.lvl !== 'green').map((w) => w.txt).join(', ') : t(T('нет', 'none'))}</li>
      </ul>
      <button className="btn primary" onClick={() => resetSim(ui.start)}>{t(T('Ещё рейс', 'Fly again'))}</button>
    </div>
  )
}
