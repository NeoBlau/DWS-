import { createContext, useContext } from 'react'

/** Mutable physical state of the machine, advanced every frame. Never stored in React state. */
export interface Runtime {
  rpm: number
  crank: number // visual crank angle (rad), slowed down so motion stays readable
  speed: number // m/s
  wheel: number // wheel rotation angle
  steer: number // -1..1
  brakeHeat: number // 0..1
  bounce: number
  turbo: number // turbo shaft angle
  fan: number
  airbag: number
  hood: number
  door: number
  trunk: number
  // aircraft
  n1: number // 0..1
  n1Angle: number
  apu: number
  flaps: number
  slats: number
  spoilers: number
  aileron: number
  elevator: number
  rudder: number
  gear: number
  pitch: number
  altitude: number
  ground: number // ground scroll distance
  groundSpeed: number
  noseSteer: number
}

export const newRuntime = (): Runtime => ({
  rpm: 0, crank: 0, speed: 0, wheel: 0, steer: 0, brakeHeat: 0, bounce: 0, turbo: 0, fan: 0, airbag: 0, hood: 0, door: 0, trunk: 0,
  n1: 0, n1Angle: 0, apu: 0, flaps: 0, slats: 0, spoilers: 0, aileron: 0, elevator: 0, rudder: 0, gear: 1, pitch: 0, altitude: 0, ground: 0, groundSpeed: 0, noseSteer: 0,
})

/** the active machine's runtime, shared with HUD readouts and sound */
export const liveRuntime: { current: Runtime } = { current: newRuntime() }

export const RuntimeCtx = createContext<Runtime>(newRuntime())
export const useRuntime = () => useContext(RuntimeCtx)

export const approach = (v: number, target: number, rate: number, dt: number) => v + (target - v) * (1 - Math.exp(-rate * dt))
