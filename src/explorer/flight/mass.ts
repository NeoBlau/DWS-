import type { Geo } from './geometry'
import type { Aero } from './vlm'

/*
 * Mass, centre of gravity and moments of inertia from the components: structure spread over the wing,
 * tail and fuselage the way it is built, engines and gear where they hang, passengers along the cabin,
 * fuel in the tanks it is actually in. The CG moves as fuel burns from a given tank.
 */
export interface Pt { m: number; x: number; y: number; z: number; ix: number; iy: number; iz: number } // ix… = own inertia about its centre
export interface MassState { m: number; cg: number[]; I: number[] } // I: roll (x), yaw (y), pitch (z)

export interface Layout { fixed: Pt[]; tankL: Pt[]; tankR: Pt[]; tankC: Pt[]; cabin: Pt[] }

function spreadSurface(ae: Aero, surf: string, m: number, weight: (a: number, c: number) => number): Pt[] {
  const ps = ae.panels.filter((p) => p.surf === surf)
  const wsum = ps.reduce((s, p) => s + weight(p.area, p.chord), 0)
  // structure sits around 40 % chord (between the spars)
  return ps.map((p) => ({ m: (m * weight(p.area, p.chord)) / wsum, x: p.mid[0] + 0.25 * p.chord - 0.4 * p.chord, y: p.mid[1], z: p.mid[2], ix: 0, iy: 0, iz: 0 }))
}
function spreadFuselage(geo: Geo, m: number): Pt[] {
  const f = geo.bodies.find((b) => b.kind === 'fuselage')
  if (!f) return [{ m, x: 0, y: 3, z: 0, ix: 0, iy: 0, iz: 0 }]
  const n = 30, out: Pt[] = []
  let w = 0
  const ws: number[] = []
  for (let i = 0; i < n; i++) { const x = f.x0 + ((i + 0.5) / n) * (f.x1 - f.x0), r = f.r(x); ws.push(r); w += r }
  for (let i = 0; i < n; i++) {
    const x = f.x0 + ((i + 0.5) / n) * (f.x1 - f.x0), r = f.r(x), mi = (m * ws[i]) / w
    out.push({ m: mi, x, y: f.y(x), z: 0, ix: mi * r * r, iy: (mi * r * r) / 2, iz: (mi * r * r) / 2 }) // thin shell ring
  }
  return out
}
const box = (m: number, at: number[], size?: number[]): Pt => {
  const [a, b, c] = size ?? [0, 0, 0]
  return { m, x: at[0], y: at[1], z: at[2], ix: (m * (b * b + c * c)) / 12, iy: (m * (a * a + c * c)) / 12, iz: (m * (a * a + b * b)) / 12 }
}

export function buildLayout(geo: Geo, ae: Aero, cabin: { x0: number; x1: number; y: number; w: number }): Layout {
  const fixed: Pt[] = []
  for (const it of geo.masses) {
    if (it.at === 'wing') fixed.push(...spreadSurface(ae, 'wing', it.m, (a, c) => a * c)) // heavier where the wing is deep
    else if (it.at === 'htail') fixed.push(...spreadSurface(ae, 'htail', it.m, (a) => a))
    else if (it.at === 'fin') fixed.push(...spreadSurface(ae, 'fin', it.m, (a) => a))
    else if (it.at === 'fuselage') fixed.push(...spreadFuselage(geo, it.m))
    else if (it.at === 'cabin') for (let i = 0; i < 12; i++) fixed.push(box(it.m / 12, [cabin.x0 + ((i + 0.5) / 12) * (cabin.x1 - cabin.x0), cabin.y, 0], [ (cabin.x1 - cabin.x0) / 12, 1.4, cabin.w ]))
    else {
      fixed.push(box(it.m, it.at, it.size))
      if (it.mirror) fixed.push(box(it.m, [it.at[0], it.at[1], -it.at[2]], it.size))
    }
  }
  // fuel tanks: the wing box between the spars, volume ∝ chord² × thickness
  const tankPanels = ae.panels.filter((p) => p.tank)
  const vol = (p: typeof tankPanels[0]) => p.chord * p.chord * p.tc * (p.area / p.chord)
  const mk = (side: 1 | -1) => {
    const ps = tankPanels.filter((p) => p.side === side && Math.abs(p.mid[2]) > 1.7)
    const v = ps.reduce((s, p) => s + vol(p), 0)
    return ps.map((p) => ({ m: vol(p) / v, x: p.mid[0] + 0.25 * p.chord - 0.4 * p.chord, y: p.mid[1], z: p.mid[2], ix: 0, iy: 0, iz: 0 }))
  }
  const centre = tankPanels.filter((p) => Math.abs(p.mid[2]) <= 1.7)
  const tankC: Pt[] = centre.length
    ? centre.map((p) => ({ m: 1 / centre.length, x: p.mid[0] + 0.25 * p.chord - 0.4 * p.chord, y: p.mid[1] - 0.3, z: p.mid[2], ix: 0, iy: 0, iz: 0 }))
    : [{ m: 1, x: 0, y: 2, z: 0, ix: 0, iy: 0, iz: 0 }]
  const pax: Pt[] = []
  for (let i = 0; i < 16; i++) pax.push(box(1 / 16, [cabin.x0 + ((i + 0.5) / 16) * (cabin.x1 - cabin.x0), cabin.y + 0.3, 0], [(cabin.x1 - cabin.x0) / 16, 1.2, cabin.w]))
  return { fixed, tankL: mk(-1), tankR: mk(1), tankC, cabin: pax }
}

/** mass, CG and inertia for a given payload and fuel in each tank */
export function massProps(L: Layout, payload: number, fuel: { L: number; C: number; R: number }, centreFuelAt?: number[]): MassState {
  const pts: Pt[] = [...L.fixed]
  const scale = (list: Pt[], k: number) => list.map((p) => ({ ...p, m: p.m * k, ix: p.ix * k, iy: p.iy * k, iz: p.iz * k }))
  pts.push(...scale(L.cabin, payload), ...scale(L.tankL, fuel.L), ...scale(L.tankR, fuel.R))
  if (centreFuelAt) pts.push({ m: fuel.C / 2, x: centreFuelAt[0], y: centreFuelAt[1], z: centreFuelAt[2], ix: 0, iy: 0, iz: 0 }, { m: fuel.C / 2, x: centreFuelAt[0], y: centreFuelAt[1], z: -centreFuelAt[2], ix: 0, iy: 0, iz: 0 })
  else pts.push(...scale(L.tankC, fuel.C))
  let m = 0, x = 0, y = 0, z = 0
  for (const p of pts) { m += p.m; x += p.m * p.x; y += p.m * p.y; z += p.m * p.z }
  x /= m; y /= m; z /= m
  let Ix = 0, Iy = 0, Iz = 0
  for (const p of pts) {
    const dx = p.x - x, dy = p.y - y, dz = p.z - z
    Ix += p.m * (dy * dy + dz * dz) + p.ix
    Iy += p.m * (dx * dx + dz * dz) + p.iy
    Iz += p.m * (dx * dx + dy * dy) + p.iz
  }
  return { m, cg: [x, y, z], I: [Ix, Iy, Iz] }
}
export const emptyMass = (geo: Geo) => geo.masses.reduce((s, it) => s + it.m * (typeof it.at !== 'string' && it.mirror ? 2 : 1), 0)
