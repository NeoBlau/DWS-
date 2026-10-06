import { create } from 'zustand'
import type { FlowKind, LabId, LearnStep, SceneAction, Shot, SystemId, VehicleId } from './data/types'

export type Screen = 'loading' | 'landing' | 'machine' | 'final' | 'explorer'
export type ExplorerId = 'diesel' | 'petrol' | 'jet' | 'flight'
export type Level = 'beginner' | 'engineer'
export type Tray = null | 'flows' | 'walk' | 'exploded' | 'drive' | 'controls' | 'flight'
export type FlightPhase = 'gate' | 'pushback' | 'taxi' | 'takeoff' | 'climb' | 'cruise' | 'descent' | 'landing'

export interface Sequence {
  title: string
  steps: string[]
  index: number
}

/** Physical "intent" targets. Animations ease toward these inside useFrame. */
export interface Sim {
  engine: 'off' | 'starting' | 'running'
  throttle: number
  brake: number
  steer: number
  driving: boolean
  hood: boolean
  door: boolean
  trunk: boolean
  airbag: boolean
  // aircraft
  flaps: number // 0..1
  slats: number
  spoilers: number
  aileron: number // -1..1 (positive = roll right)
  elevator: number // -1..1 (positive = pitch up)
  rudder: number // -1..1 (positive = yaw right)
  gear: number // 1 = down
  apu: boolean
  jets: number // 0..1 engine N1 target
  phase: FlightPhase
}

const defaultSim: Sim = {
  engine: 'off', throttle: 0, brake: 0, steer: 0, driving: false,
  hood: false, door: false, trunk: false, airbag: false,
  flaps: 0, slats: 0, spoilers: 0, aileron: 0, elevator: 0, rudder: 0, gear: 1, apu: false, jets: 0, phase: 'gate',
}

function loadUnderstood(): Record<VehicleId, string[]> {
  try {
    const raw = localStorage.getItem('hiw-understood')
    if (raw) return { fortuner: [], bmw: [], a320: [], ...JSON.parse(raw) }
  } catch { /* storage unavailable */ }
  return { fortuner: [], bmw: [], a320: [] }
}
function saveUnderstood(u: Record<VehicleId, string[]>) {
  try { localStorage.setItem('hiw-understood', JSON.stringify(u)) } catch { /* ignore */ }
}

export interface AppState {
  screen: Screen
  explorer: ExplorerId | null
  vehicleId: VehicleId | null
  // display modes
  cutaway: boolean
  xray: boolean
  exploded: boolean
  flowIsolate: boolean
  activeFlows: FlowKind[]
  activePaths: string[]
  hiddenLayers: string[]
  hotspots: boolean
  tray: Tray
  walkZone: string | null
  focusSystem: SystemId | null
  selected: string | null
  // camera command
  shot: Shot | null
  shotKey: number
  // overlays
  lab: { id: LabId; opts?: Record<string, unknown> } | null
  learn: { steps: LearnStep[]; index: number; title: string; style: 'card' | 'chain'; auto: boolean; demo?: string } | null
  sequence: Sequence | null
  panels: { systems: boolean; search: boolean; settings: boolean; journey: boolean }
  // settings
  level: Level
  sound: boolean
  quality: 'high' | 'low'
  understood: Record<VehicleId, string[]>
  sim: Sim
  pulse: number // increments to re-trigger one-shot animations

  set: (p: Partial<AppState>) => void
  setSim: (p: Partial<Sim>) => void
  flyTo: (shot: Shot) => void
  openPanel: (k: keyof AppState['panels'] | null) => void
  markUnderstood: (v: VehicleId, id: string) => void
  resetView: () => void
  act: (a: SceneAction) => void
}

export const useApp = create<AppState>((set, get) => ({
  screen: 'loading',
  explorer: null,
  vehicleId: null,
  cutaway: false,
  xray: false,
  exploded: false,
  flowIsolate: false,
  activeFlows: [],
  activePaths: [],
  hiddenLayers: [],
  hotspots: true,
  tray: null,
  walkZone: null,
  focusSystem: null,
  selected: null,
  shot: null,
  shotKey: 0,
  lab: null,
  learn: null,
  sequence: null,
  panels: { systems: true, search: false, settings: false, journey: false },
  level: 'beginner',
  sound: false,
  quality: typeof window !== 'undefined' && window.innerWidth < 760 ? 'low' : 'high',
  understood: loadUnderstood(),
  sim: { ...defaultSim },
  pulse: 0,

  set: (p) => set(p),
  setSim: (p) => set({ sim: { ...get().sim, ...p } }),
  flyTo: (shot) => set({ shot, shotKey: get().shotKey + 1 }),
  openPanel: (k) => set({
    panels: {
      systems: k === 'systems' ? !get().panels.systems : get().panels.systems,
      search: k === 'search', settings: k === 'settings', journey: k === 'journey',
    },
  }),
  markUnderstood: (v, id) => {
    const u = get().understood
    if (u[v].includes(id)) return
    const next = { ...u, [v]: [...u[v], id] }
    saveUnderstood(next)
    set({ understood: next })
  },
  resetView: () => set({
    cutaway: false, xray: false, exploded: false, flowIsolate: false, activeFlows: [], activePaths: [],
    hiddenLayers: [], tray: null, walkZone: null, focusSystem: null, selected: null, learn: null, sequence: null,
    sim: { ...defaultSim },
  }),
  act: (a) => {
    const s = get().sim
    const P = (p: Partial<Sim>) => get().setSim(p)
    switch (a) {
      case 'engineStart': P({ engine: 'starting' }); setTimeout(() => { if (get().sim.engine === 'starting') P({ engine: 'running' }) }, 1600); break
      case 'engineStop': P({ engine: 'off', throttle: 0, driving: false }); break
      case 'throttle': P({ engine: 'running', throttle: s.throttle > 0.5 ? 0.15 : 0.9 }); break
      case 'brake': P({ brake: 1 }); setTimeout(() => P({ brake: 0 }), 2600); break
      case 'steer': P({ steer: s.steer === 0 ? 1 : s.steer > 0 ? -1 : 0 }); break
      case 'drive': P({ engine: 'running', driving: true, throttle: 0.35 }); break
      case 'airbag': P({ airbag: true }); setTimeout(() => P({ airbag: false }), 2600); break
      case 'openHood': P({ hood: true }); break
      case 'openDoor': P({ door: true }); break
      case 'openTrunk': P({ trunk: true }); break
      case 'closeAll': P({ hood: false, door: false, trunk: false }); break
      case 'flaps': P({ flaps: s.flaps > 0.5 ? 0 : 1, slats: s.flaps > 0.5 ? 0 : 1 }); break
      case 'slats': P({ slats: s.slats > 0.5 ? 0 : 1 }); break
      case 'spoilers': P({ spoilers: s.spoilers > 0.5 ? 0 : 1 }); break
      case 'rollLeft': P({ aileron: -1 }); setTimeout(() => P({ aileron: 0 }), 2200); break
      case 'pitchUp': P({ elevator: 1 }); setTimeout(() => P({ elevator: 0 }), 2200); break
      case 'yawLeft': P({ rudder: -1 }); setTimeout(() => P({ rudder: 0 }), 2200); break
      case 'gearDown': P({ gear: 1 }); break
      case 'gearUp': P({ gear: 0 }); break
      case 'apuStart': P({ apu: true }); break
      case 'enginesStart': P({ apu: true, jets: 0.25 }); break
      case 'neutral': P({ aileron: 0, elevator: 0, rudder: 0, brake: 0, throttle: s.engine === 'running' ? 0.1 : 0 }); break
    }
    set({ pulse: get().pulse + 1 })
  },
}))

export const getApp = () => useApp.getState()
