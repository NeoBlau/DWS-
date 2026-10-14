import { GEOS, type Geo } from './geometry'
import { buildAero, aeroForces, type Aero, type Ctl } from './vlm'
import { buildLayout, massProps, emptyMass, type Layout, type MassState } from './mass'
import { design, type Design } from './propulsion'

/*
 * The physical model of one aircraft type, built once from its geometry: the vortex lattice, the mass layout and
 * the matched engine design point. Also the stall angle and maximum lift of every flap setting, found by sweeping
 * the lattice — the fly-by-wire protections and the speed tape use these.
 */
export interface StallRow { alpha: number; clmax: number }
export interface Model { geo: Geo; aero: Aero; layout: Layout; des: Design; oew: number; stall: StallRow[] }
const MODELS = new Map<string, Model>()

const CTL0: Ctl = { elev: 0, ths: 0, ail: 0, rud: 0, splL: 0, splR: 0, gnd: 0, flap: 0, slat: 0, gear: 0, flapL: 1, flapR: 1 }
export function model(id: keyof typeof GEOS, confs: { slat: number; flap: number }[]): Model {
  let m = MODELS.get(id)
  if (m) return m
  const geo = GEOS[id]
  const aero = buildAero(geo)
  const layout = buildLayout(geo, aero, geo.cabin)
  const des = design(geo.engine)
  const ms = massProps(layout, 0, { L: 0, C: 0, R: 0 }, geo.centreTank)
  // stall angle and CLmax of each configuration: sweep the angle of attack at low speed
  const stall: StallRow[] = confs.map((c) => {
    let best = 0, ab = 0
    for (let a = 4; a <= 28; a += 0.5) {
      const al = (a * Math.PI) / 180, V = 70
      const r = aeroForces(aero, { rho: 1.225, a: 340, mu: 1.79e-5, v: [V * Math.cos(al), -V * Math.sin(al), 0], w: [0, 0, 0], cg: ms.cg, ctl: { ...CTL0, flap: c.flap, slat: c.slat }, ground: { on: false, n: [0, 1, 0], d: 0 }, t: 0, fixWake: 0.21 })
      if (r.CL > best) { best = r.CL; ab = al } else if (r.CL < best * 0.97) break
    }
    return { alpha: ab, clmax: best }
  })
  m = { geo, aero, layout, des, oew: emptyMass(geo), stall }
  MODELS.set(id, m)
  return m
}
export function massNow(m: Model, payload: number, tank: { L: number; C: number; R: number }): MassState {
  return massProps(m.layout, payload, tank, m.geo.centreTank)
}
