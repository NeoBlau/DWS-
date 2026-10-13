import { create } from 'zustand'
import { createSim, SPECS, type Sim, type Start } from './fdm'

/** the running simulation lives outside React: the render loop mutates it 240 times a second */
export const FS: { sim: Sim; keys: Set<string>; pad: { x: number; y: number; active: boolean }; wheelRot: number[] } = {
  sim: createSim('runway'),
  keys: new Set(),
  pad: { x: 0, y: 0, active: false },
  wheelRot: [0, 0, 0],
}

export type CamMode = 'chase' | 'side' | 'cockpit' | 'wing' | 'tower' | 'orbit'
interface UI {
  cam: CamMode
  paused: boolean
  forces: boolean
  guide: boolean
  path: boolean // glide-path gates in the sky
  sound: boolean
  start: Start
  ac: 'a320' | 'strizh'
  design: boolean
  epoch: number // bumps on reset so components re-read the sim
  set: (p: Partial<Omit<UI, 'set'>>) => void
}
export const useFlight = create<UI>((set) => ({
  cam: 'chase', paused: false, forces: true, guide: true, path: true, sound: false, start: 'gate', ac: 'a320', design: false, epoch: 0,
  set: (p) => set(p),
}))

/** a deep link from the Study section */
export const PENDING_FLIGHT: { v: { start: Start; cam?: CamMode; ac?: 'a320' | 'strizh'; design?: boolean; patch?: (s: Sim) => void } | null } = { v: null }

export function resetSim(start: Start) {
  FS.sim = createSim(start, SPECS[useFlight.getState().ac])
  FS.wheelRot = [0, 0, 0]
  useFlight.getState().set({ start, paused: false, epoch: useFlight.getState().epoch + 1 })
}
