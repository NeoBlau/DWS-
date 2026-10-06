import { useEffect, useRef } from 'react'
import { useApp } from '../store'
import type { VehicleDef } from '../data/types'
import { hotspotScreen } from '../scenes/MachineScene'
import { selectComponent } from '../utils/actions'

/** DOM hotspots positioned from the 3D projector each animation frame (no React re-render per frame) */
export function HotspotLayer({ def }: { def: VehicleDef }) {
  const show = useApp((s) => s.hotspots && !s.flowIsolate && !s.learn && !s.lab && s.tray !== 'flight' && s.tray !== 'drive')
  const selected = useApp((s) => s.selected)
  const focus = useApp((s) => s.focusSystem)
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const list = def.components.filter((c) => c.hotspot || c.id === selected || (focus && c.system === focus))
  useEffect(() => {
    let raf = 0
    const tick = () => {
      refs.current.forEach((el, id) => {
        const p = hotspotScreen.get(id)
        if (!p) return
        el.style.transform = `translate(${p.x}px, ${p.y}px)`
        el.style.opacity = p.vis ? '1' : '0'
        el.style.pointerEvents = p.vis ? 'auto' : 'none'
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  if (!show) return null
  return (
    <div className="hs-layer">
      {list.map((c) => (
        <button key={c.id} type="button" ref={(el) => { if (el) refs.current.set(c.id, el); else refs.current.delete(c.id) }}
          className={`hs ${selected === c.id ? 'on' : ''}`} onClick={() => selectComponent(def, c.id)} aria-label={c.name} style={{ opacity: 0 }}>
          <i /><span>{c.name}</span>
        </button>
      ))}
    </div>
  )
}
