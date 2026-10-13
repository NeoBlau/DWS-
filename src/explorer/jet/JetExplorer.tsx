import { useEffect, useState } from 'react'
import { Explorer } from '../Explorer'
import { Turbofan } from './Turbofan'
import { JET_DEF } from './jetDef'
import { useExp, exp, live, seek } from '../core'
import { useT, T } from '../i18n'

function JetPanel() {
  const t = useT()
  const throttle = useExp((s) => s.throttle)
  const [v, setV] = useState({ n1: 0, n2: 0, egt: 0, ff: 0, thrust: 0 })
  useEffect(() => { const id = setInterval(() => setV({ n1: live.n1 ?? 0, n2: live.n2 ?? 0, egt: live.egt ?? 0, ff: live.ff ?? 0, thrust: live.thrust ?? 0 }), 150); return () => clearInterval(id) }, [])
  return (
    <>
      <span className="eyebrow">{t(T('Управление двигателем', 'Engine controls'))}</span>
      <button className="btn sm primary" onClick={() => { seek(0, true); exp().set({ track: 'start', playing: true, follow: true, mode: 'auto' }) }}>▶ {t(T('Запустить двигатель', 'Start engine'))}</button>
      <label className="range xp-range" htmlFor="jet-throttle">{t(T('РУД (N1)', 'Thrust lever (N1)'))}
        <input id="jet-throttle" type="range" min={0} max={1} step={0.01} value={throttle} onChange={(e) => exp().set({ throttle: +e.target.value })} />
      </label>
      <div className="readout xp-readout">
        <div><b>{v.n1}%</b><span>N1</span></div>
        <div><b>{v.n2}%</b><span>N2</span></div>
        <div><b>{v.egt}</b><span>EGT °C ≈</span></div>
        <div><b>{v.ff}</b><span>{t(T('КГ/Ч ≈', 'KG/H ≈'))}</span></div>
        <div><b>{v.thrust}</b><span>{t(T('ТЯГА КН ≈', 'THRUST KN ≈'))}</span></div>
      </div>
    </>
  )
}

export function JetExplorer() {
  return (
    <Explorer def={JET_DEF} cutOpen={0} cam={{ fov: 40, near: 0.02, far: 900 }} floorY={-1.75} controlsPanel={<JetPanel />}>
      <Turbofan />
    </Explorer>
  )
}
