import { useEffect, useRef, useState } from 'react'
import { useApp, getApp } from './store'
import { VEHICLES, ORDER } from './vehicles'
import { MachineView } from './components/MachineView'
import { Final, Journey, Landing, Loader, Search, Settings } from './components/Screens'
import { useSound } from './audio/sound'
import { ExplorerHost } from './explorer/ExplorerHost'

function useCompletionToast() {
  const understood = useApp((s) => s.understood)
  const [msg, setMsg] = useState<string | null>(null)
  const prev = useRef(understood)
  useEffect(() => {
    const before = ORDER.every((v) => VEHICLES[v].checklist.every((c) => c.ids.some((id) => prev.current[v].includes(id))))
    const now = ORDER.every((v) => VEHICLES[v].checklist.every((c) => c.ids.some((id) => understood[v].includes(id))))
    prev.current = understood
    if (!before && now) { setMsg('All three machines explored — open YOUR JOURNEY'); setTimeout(() => setMsg(null), 5000) }
  }, [understood])
  return msg
}

export default function App() {
  const screen = useApp((s) => s.screen)
  const vehicleId = useApp((s) => s.vehicleId)
  const toast = useCompletionToast()
  useSound()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); getApp().openPanel('search') }
      if (e.key === 'Escape') {
        const s = getApp()
        if (s.lab) s.set({ lab: null })
        else if (s.panels.search || s.panels.settings || s.panels.journey) s.set({ panels: { ...s.panels, search: false, settings: false, journey: false } })
      }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); getApp().openPanel('search') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      {screen === 'loading' && <Loader />}
      {screen === 'landing' && <Landing />}
      {screen === 'machine' && vehicleId && <MachineView def={VEHICLES[vehicleId]} />}
      {screen === 'final' && <Final />}
      {screen === 'explorer' && <ExplorerHost />}
      <Search />
      {screen === 'machine' && <><Settings /><Journey /></>}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
