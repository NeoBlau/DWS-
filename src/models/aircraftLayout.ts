import type { Section } from '../utils/geom'

/*
 * A320 geometry (metres). X forward, Y up, Z to the left (port). Ground at y = 0.
 * Overall: length 37.57 m, height 11.76 m, span 35.8 m with sharklets. Fuselage outer Ø ≈ 3.95 m.
 */
export const AX = {
  nose: 19.0,
  tail: -18.57,
  axisY: 3.3,
  R: 1.975,
  floorY: 2.75,
  holdY: 1.55,
  mainGearX: -1.64,
  noseGearX: 11.0,
  mainGearZ: 3.795,
  engineX: 1.9, // nacelle centre
  engineY: 1.45,
  engineZ: 5.75,
  apu: [-17.6, 4.7, 0] as [number, number, number],
}

export function fusR(x: number) {
  if (x > 13.2) { const t = (AX.nose - x) / (AX.nose - 13.2); return AX.R * Math.pow(Math.max(0, 1 - Math.pow(1 - t, 2.1)), 0.55) }
  if (x > -8.5) return AX.R
  const u = (-8.5 - x) / (-8.5 - AX.tail)
  const top = 5.275 - 0.45 * Math.pow(u, 1.6), bottom = 1.325 + (4.75 - 1.325) * Math.pow(u, 1.25)
  return Math.max(0.03, (top - bottom) / 2)
}
export function fusY(x: number) {
  if (x > 13.2) { const t = (AX.nose - x) / (AX.nose - 13.2); return AX.axisY - 0.38 * Math.pow(1 - t, 1.6) }
  if (x > -8.5) return AX.axisY
  const u = (-8.5 - x) / (-8.5 - AX.tail)
  const top = 5.275 - 0.45 * Math.pow(u, 1.6), bottom = 1.325 + (4.75 - 1.325) * Math.pow(u, 1.25)
  return (top + bottom) / 2
}

/** left-wing planform sections (mirror z for the right wing) */
export const WING: Section[] = [
  { le: 3.4, y: 2.05, z: 1.6, chord: 6.9, t: 0.15 },
  { le: 1.005, y: 2.468, z: 6.3, chord: 3.95, t: 0.12 },
  { le: -4.396, y: 3.41, z: 16.9, chord: 1.45, t: 0.105 },
]
export function wingAt(z: number): Section {
  const w = WING
  const i = z <= w[1].z ? 0 : 1
  const a = w[i], b = w[i + 1]
  const k = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)))
  return { le: a.le + (b.le - a.le) * k, y: a.y + (b.y - a.y) * k, z, chord: a.chord + (b.chord - a.chord) * k, t: a.t + (b.t - a.t) * k }
}
export const span = (z0: number, z1: number, n = 3) => Array.from({ length: n }, (_, i) => wingAt(z0 + ((z1 - z0) * i) / (n - 1)))

export const SLATS: [number, number][] = [[2.6, 5.0], [6.4, 9.0], [9.0, 11.6], [11.6, 14.2], [14.2, 16.6]]
export const FLAPS: [number, number][] = [[1.7, 6.2], [6.4, 12.3]]
export const AILERON: [number, number] = [12.5, 16.2]
export const SPOILERS: [number, number][] = [[2.8, 4.6], [6.7, 7.9], [7.9, 9.1], [9.1, 10.3], [10.3, 11.6]]

export const HSTAB: Section[] = [
  { le: -14.2, y: 4.62, z: 0.6, chord: 3.6, t: 0.1 },
  { le: -17.5, y: 4.95, z: 6.22, chord: 1.4, t: 0.09 },
]
export const FIN: Section[] = [
  { le: -12.3, y: 5.05, z: 0, chord: 5.9, t: 0.11 },
  { le: -16.95, y: 11.76, z: 0, chord: 2.1, t: 0.1 },
]
