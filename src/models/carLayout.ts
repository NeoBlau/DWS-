import type { Vec3 } from '../data/types'

/** Everything the procedural car builder needs. Coordinates in metres: X forward, Y up, Z to the left (driver side). */
export interface CarLayout {
  paint: string
  width: number
  wheelbase: number
  track: number
  wheelR: number
  tireW: number
  front: number // bumper x
  rear: number // bumper x
  belt: number
  roof: number
  profile: [number, number][] // side silhouette without wheel arches, front→top→rear
  sill: number // y of the body bottom line
  archR: number
  window: [number, number][]
  windshield: [Vec3, Vec3] // base point, top point (centre line)
  rearGlass?: [Vec3, Vec3]
  hood: { x0: number; x1: number; y0: number; y1: number } // x0 front, x1 hinge
  tailgate: { hinge: Vec3; to: Vec3 } // panel from hinge (top/front) to its free edge, in X/Y
  door: { x0: number; x1: number; y0: number; y1: number } // x0 rear edge, x1 hinge (front)
  frame: boolean
  engine: { x: number; y: number; len: number; bore: number; crankY: number; cyl: number }
  turbo: Vec3
  intercooler: { pos: Vec3; size: Vec3; label: string }
  airbox: Vec3
  radiator: { x: number; y: number; h: number; w: number }
  condenser: number
  battery: Vec3
  alternator: Vec3
  starter: Vec3
  waterPump: Vec3
  ecu: Vec3
  hpPump: Vec3
  fuelFilter: Vec3
  absUnit: Vec3
  booster: Vec3
  acCompressor: Vec3
  hvac: Vec3
  gearbox: { x0: number; x1: number; y: number; r: number }
  transfer?: Vec3
  frontDiff?: Vec3
  rearDiff: Vec3
  tank: { pos: Vec3; size: Vec3; saddle?: boolean }
  exhaust: Vec3[]
  cat: { x0: number; x1: number }
  dpf?: { x0: number; x1: number }
  muffler: { pos: Vec3; len: number; r: number; transverse?: boolean }
  tailpipe: Vec3
  seatsFront: number
  seatsRear: number
  seatsThird?: number
  seatY: number
  floorY: number
  steeringWheel: Vec3
  rack: Vec3
  pedals: Vec3
  dash: number
  spare?: Vec3
  rearAxle: 'live' | 'multilink'
  caliper: string
  lights: { head: Vec3; tail: Vec3 }
  trunkBattery?: boolean
  petrol?: boolean
}
