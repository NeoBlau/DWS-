import type { Vec3 } from '../../data/types'

/** Geometry shared by the 3D model, the camera script and the label anchors (metres, engine at origin). */
export interface EngineSpec {
  petrol: boolean
  R: number // bore radius
  r: number // crank throw (stroke / 2)
  rod: number
  cr: number // compression ratio
  cx: number[] // cylinder x positions, cylinder 1 first (front = +x)
  deck: number
  gears: number[] // illustrative ratios
  awd: boolean
  frontAxleX: number
  rearAxleX: number
  axleY: number
  wheelR: number
  track: number
  turbo: Vec3
  tank: { pos: Vec3; size: Vec3; saddle?: boolean }
  battery: Vec3
  paintBlock: string
  cover: string
}

const PIN_TO_CROWN = 0.048
export const pinY = (s: EngineSpec, a: number) => s.r * Math.cos(a) + Math.sqrt(s.rod * s.rod - (s.r * Math.sin(a)) ** 2)
export const crownY = (s: EngineSpec, a: number) => pinY(s, a) + PIN_TO_CROWN

function make(petrol: boolean): EngineSpec {
  const R = petrol ? 0.041 : 0.046, r = petrol ? 0.045 : 0.052, rod = petrol ? 0.14 : 0.16, cr = petrol ? 10.2 : 15.6
  const tdcCrown = r + rod + PIN_TO_CROWN
  const deck = tdcCrown + (2 * r) / (cr - 1)
  const wb = petrol ? 2.975 : 2.745
  return {
    petrol, R, r, rod, cr, deck,
    cx: petrol ? [0.135, 0.045, -0.045, -0.135] : [0.15, 0.05, -0.05, -0.15],
    gears: petrol ? [4.7, 3.13, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67] : [3.6, 2.09, 1.49, 1.0, 0.69, 0.58],
    awd: !petrol,
    frontAxleX: 0.32,
    rearAxleX: 0.32 - wb,
    axleY: -0.05,
    wheelR: petrol ? 0.335 : 0.385,
    track: petrol ? 1.6 : 1.545,
    turbo: [-0.02, deck - 0.07, -0.3],
    tank: petrol ? { pos: [-1.95, -0.2, 0], size: [0.6, 0.22, 1.1], saddle: true } : { pos: [-1.75, -0.18, 0.38], size: [0.8, 0.22, 0.55] },
    battery: petrol ? [-3.05, 0.02, -0.42] : [0.55, 0.14, -0.36],
    paintBlock: petrol ? '#b9c0c8' : '#a99f93',
    cover: petrol ? '#1f2a36' : '#2d2a27',
  }
}
export const DIESEL = make(false)
export const PETROL = make(true)

/** cycle position of each cylinder: 0 = TDC start of intake, 2π = TDC end of compression (firing). Order 1-3-4-2. */
export const CYCLE_OFFSET = [0, Math.PI, 3 * Math.PI, 2 * Math.PI]
const TAU2 = Math.PI * 4
export const phaseOf = (crank: number, i: number) => (((crank + CYCLE_OFFSET[i]) % TAU2) + TAU2) % TAU2

export const bump = (x: number, a: number, b: number) => (x <= a || x >= b ? 0 : Math.sin(((x - a) / (b - a)) * Math.PI))
export function valveLift(phi: number, exhaust: boolean) {
  if (!exhaust) return Math.max(bump(phi, -0.18, Math.PI + 0.35), bump(phi - TAU2, -0.18, Math.PI + 0.35))
  return Math.max(bump(phi, 3 * Math.PI - 0.35, TAU2 + 0.18), bump(phi + TAU2, 3 * Math.PI - 0.35, TAU2 + 0.18))
}
export const IN_PEAK = (Math.PI + 0.17) / 2
export const EX_PEAK = (7 * Math.PI + 0.17) / 2
export function injecting(s: EngineSpec, phi: number) {
  return s.petrol ? phi > 0.9 && phi < 2.3 : phi > 2 * Math.PI - 0.26 && phi < 2 * Math.PI + 0.14
}
export const sparking = (phi: number) => phi > 2 * Math.PI - 0.32 && phi < 2 * Math.PI - 0.12
export function burn(s: EngineSpec, phi: number) {
  const start = s.petrol ? 2 * Math.PI - 0.12 : 2 * Math.PI - 0.05
  if (phi < start || phi > start + 1.1) return 0
  const k = (phi - start) / 1.1
  return Math.min(1, k * 9) * (1 - k)
}
/** 0 intake, 1 compression, 2 power, 3 exhaust */
export const strokeOf = (phi: number) => Math.min(3, Math.floor(phi / Math.PI))
