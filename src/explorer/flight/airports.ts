/*
 * Two airports joined by a straight route. World frame: x along the runways (both are runway 09),
 * z to the right. Each airport: runway, parallel taxiway, connectors, apron with stands, terminal.
 * Pure data, shared by the flight model (paved surfaces, stands) and by the 3D world.
 */
export const DEST_X = 80000 // the arrival airport is 80 km (≈ 43 NM) east

export interface Rect { x0: number; x1: number; z0: number; z1: number; kind: 'runway' | 'taxiway' | 'apron' }
export interface Stand { id: string; x: number; z: number; heading: number } // CG position when parked, heading rad (0 = +x)
export interface Airport { id: string; name: { ru: string; en: string }; icao: string; x0: number; rects: Rect[]; stands: Stand[]; taxiCentre: [number, number][][] }

export const RWY_LEN = 3000, RWY_W = 45
const TWY_Z = -180, LANE_Z = -300, STAND_STOP_Z = -452 // nose stop line in front of the terminal
const NOSE_FROM_CG = 19.63 // A320: nose is 19.6 m ahead of the CG

function build(id: string, icao: string, name: { ru: string; en: string }, x0: number): Airport {
  const R = (a: number, b: number, c: number, d: number, kind: Rect['kind']): Rect => ({ x0: x0 + Math.min(a, b), x1: x0 + Math.max(a, b), z0: Math.min(c, d), z1: Math.max(c, d), kind })
  const rects: Rect[] = [
    R(-60, RWY_LEN + 60, -RWY_W / 2 - 4, RWY_W / 2 + 4, 'runway'),
    R(-120, RWY_LEN + 120, TWY_Z - 12, TWY_Z + 12, 'taxiway'),
    ...[30, 1500, 2950].map((x) => R(x - 12, x + 12, TWY_Z, 0, 'taxiway')),
    ...[1000, 2000].map((x) => R(x - 12, x + 12, LANE_Z, TWY_Z, 'taxiway')),
    R(850, 2150, -470, LANE_Z + 14, 'apron'),
  ]
  const stands: Stand[] = [1150, 1350, 1550, 1750].map((x, i) => ({ id: `${i + 1}`, x: x0 + x, z: STAND_STOP_Z + NOSE_FROM_CG, heading: -Math.PI / 2 }))
  // taxi centrelines (yellow lines) as polylines in world coordinates
  const P = (x: number, z: number): [number, number] => [x0 + x, z]
  const taxiCentre: [number, number][][] = [
    [P(-120, TWY_Z), P(RWY_LEN + 120, TWY_Z)],
    ...[30, 1500, 2950].map((x) => [P(x, TWY_Z), P(x, 0)]),
    ...[1000, 2000].map((x) => [P(x, TWY_Z), P(x, LANE_Z)]),
    [P(900, LANE_Z), P(2100, LANE_Z)],
    ...[1150, 1350, 1550, 1750].map((x) => [P(x, LANE_Z), P(x, STAND_STOP_Z)]),
  ]
  return { id, icao, name, x0, rects, stands, taxiCentre }
}

export const AIRPORTS: Airport[] = [
  build('A', 'ULLA', { ru: 'Аэропорт вылета «Северный»', en: 'Departure — “North Field”' }, 0),
  build('B', 'ULLB', { ru: 'Аэропорт прилёта «Озёрный»', en: 'Arrival — “Lake Field”' }, DEST_X),
]
export const ALL_RECTS = AIRPORTS.flatMap((a) => a.rects)

/** surface under a point: runway / taxiway / apron, or grass */
export function surfaceAt(x: number, z: number): Rect['kind'] | 'grass' {
  for (const r of ALL_RECTS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.kind
  return 'grass'
}
export const TERMINAL_Z = -500
export const STAND_STOP = STAND_STOP_Z
export const TAXIWAY_Z = TWY_Z
export const LANE = LANE_Z
