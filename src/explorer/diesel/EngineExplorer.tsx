import { useEffect, useMemo, useState } from 'react'
import { Explorer } from '../Explorer'
import { Powertrain } from './Powertrain'
import { makeEngineDef } from './engineDef'
import { DIESEL, PETROL } from './spec'
import { useExp, exp, live, seek } from '../core'
import { useT, T } from '../i18n'

function EnginePanel({ petrol }: { petrol: boolean }) {
  const t = useT()
  const throttle = useExp((s) => s.throttle)
  const gear = useExp((s) => s.gear)
  const spec = petrol ? PETROL : DIESEL
  const [v, setV] = useState({ rpm: 0, rail: 0, turbo: 0, gear: 1, ratio: 1 })
  useEffect(() => { const id = setInterval(() => setV({ rpm: live.rpm ?? 0, rail: live.rail ?? 0, turbo: live.turboRpm ?? 0, gear: live.gear ?? 1, ratio: live.ratio ?? 1 }), 150); return () => clearInterval(id) }, [])
  const torque = (petrol ? 350 : 500) * v.ratio
  return (
    <>
      <span className="eyebrow">{t(T('Управление двигателем', 'Engine controls'))}</span>
      <button className="btn sm primary" onClick={() => { seek(0); exp().set({ track: 'start', playing: true, follow: true, mode: 'auto' }) }}>▶ {t(T('Запустить двигатель', 'Start engine'))}</button>
      <label className="range xp-range" htmlFor="eng-throttle">{t(T('Газ', 'Throttle'))}
        <input id="eng-throttle" type="range" min={0} max={1} step={0.01} value={throttle} onChange={(e) => exp().set({ throttle: +e.target.value })} />
      </label>
      <div className="xp-gears">
        <button className={`btn sm ${gear === 0 ? 'on' : ''}`} onClick={() => exp().set({ gear: 0 })}>{t(T('Авто', 'Auto'))}</button>
        {spec.gears.map((_, i) => <button key={i} className={`btn sm ${gear === i + 1 ? 'on' : ''}`} onClick={() => exp().set({ gear: i + 1 })}>{i + 1}</button>)}
      </div>
      <div className="readout xp-readout">
        <div><b>{Math.round(v.rpm)}</b><span>{t(T('ОБ/МИН', 'RPM'))}</span></div>
        <div><b>{v.ratio.toFixed(2)}</b><span>{t(T('ПЕРЕДАТ. ЧИСЛО', 'GEAR RATIO'))}</span></div>
        <div><b>{Math.round(v.rpm / v.ratio)}</b><span>{t(T('ВЫХОД ОБ/МИН', 'OUTPUT RPM'))}</span></div>
        <div><b>{Math.round(torque)}</b><span>{t(T('Н·М НА ВЫХОДЕ ≈', 'N·M OUTPUT ≈'))}</span></div>
        {!petrol && <div><b>{v.rail}</b><span>{t(T('БАР В РАМПЕ ≈', 'RAIL BAR ≈'))}</span></div>}
        <div><b>{Math.round(v.turbo / 1000)}k</b><span>{t(T('ТУРБИНА ≈', 'TURBO ≈'))}</span></div>
      </div>
    </>
  )
}

export function EngineExplorer({ petrol }: { petrol: boolean }) {
  const def = useMemo(() => makeEngineDef(petrol ? PETROL : DIESEL), [petrol])
  return (
    <Explorer def={def} cutOpen={0} cam={{ fov: 38, near: 0.01, far: 900 }} controlsPanel={<EnginePanel petrol={petrol} />}>
      <Powertrain s={petrol ? PETROL : DIESEL} />
    </Explorer>
  )
}
