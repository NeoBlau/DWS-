import { create } from 'zustand'
import { createSim, type Sim, type Start } from './fdm'

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
  epoch: number // bumps on reset so components re-read the sim
  set: (p: Partial<Omit<UI, 'set'>>) => void
}
export const useFlight = create<UI>((set) => ({
  cam: 'chase', paused: false, forces: true, guide: true, path: true, sound: false, start: 'runway', epoch: 0,
  set: (p) => set(p),
}))

export function resetSim(start: Start) {
  FS.sim = createSim(start)
  FS.wheelRot = [0, 0, 0]
  useFlight.getState().set({ start, paused: false, epoch: useFlight.getState().epoch + 1 })
}
