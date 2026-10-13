import { lazy, Suspense } from 'react'
import { useApp } from '../store'
import { EngineExplorer } from './diesel/EngineExplorer'

const JetExplorer = lazy(() => import('./jet/JetExplorer').then((m) => ({ default: m.JetExplorer })))
const DriveSim = lazy(() => import('./car/DriveSim').then((m) => ({ default: m.DriveSim })))
const FlightSim = lazy(() => import('./flight/FlightSim').then((m) => ({ default: m.FlightSim })))

export function ExplorerHost() {
  const id = useApp((s) => s.explorer)
  return (
    <Suspense fallback={<div className="loader"><div className="loader-inner"><h1>…</h1></div></div>}>
      {id === 'diesel' && <EngineExplorer key="d" petrol={false} />}
      {id === 'petrol' && <EngineExplorer key="p" petrol />}
      {id === 'jet' && <JetExplorer />}
      {id === 'flight' && <FlightSim />}
      {id === 'drive' && <DriveSim />}
    </Suspense>
  )
}
