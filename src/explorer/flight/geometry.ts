import type { Section } from '../../utils/geom'
import { AX, WING as A320_WING, HSTAB as A320_HS, FIN as A320_FIN, fusR, fusY, FLAPS as A320_FLAPS, SLATS as A320_SLATS, AILERON as A320_AIL, SPOILERS as A320_SPL } from '../../models/aircraftLayout'

/*
 * Physical description of each aircraft — the SAME sections the 3D models are lofted from.
 * The flight model computes aerodynamics, mass, centre of gravity and inertia from this; nothing here is a
 * flight-dynamics coefficient. If a surface is too small or a mass is in the wrong place, the aircraft
 * flies wrongly — just like a real one.
 *
 * Drawing frame (metres): x to the nose, y up (ground at y = 0 with static struts), z out of the right wing.
 * Lifting surfaces are given for the right half (z ≥ 0) unless `vertical`; they are mirrored.
 */

export type CtrlKind = 'flap' | 'slat' | 'aileron' | 'spoiler' | 'elevator' | 'rudder' | 'elevon' | 'krueger'
export interface Ctrl { kind: CtrlKind; z0: number; z1: number; cf: number }
export interface Surface {
  id: 'wing' | 'winglet' | 'htail' | 'fin'
  sections: Section[]
  vertical?: boolean // span runs along y, single (not mirrored) unless `pair`
  pair?: number // a pair of vertical surfaces at ±z (canted by `cant`)
  cant?: number // rad, outward
  panels: number // spanwise panels per half
  chordwise?: number // chordwise panels (default: 2 on wings and tails)
  inc: [number, number] // incidence at root and tip (rad, + = leading edge up)
  camber: number // zero-lift angle of the airfoil (rad, negative = cambered)
  clmax: number // clean section maximum lift coefficient (supercritical ≈ 1.5)
  cm0: number // section pitching moment about the quarter chord
  ctrls: Ctrl[]
  /** fuel tank: fraction of the local wing box volume used, z range */
  tank?: [number, number]
}
export interface Body { kind: 'fuselage' | 'nacelle' | 'strut' | 'pod'; x0: number; x1: number; r: (x: number) => number; y: (x: number) => number; z: number; mirror?: boolean; wet?: number }
export interface MassItem { id: string; m: number; at: [number, number, number] | 'wing' | 'htail' | 'fin' | 'fuselage' | 'cabin'; size?: [number, number, number]; mirror?: boolean }
export type EngineKind = 'turbofan' | 'openfan' | 'turboelectric'
export interface EngineGeo {
  kind: EngineKind
  /** sea-level static take-off design point of one engine (or one core for turbo-electric) */
  W: number // total inlet air flow, kg/s
  bpr: number // bypass ratio (fan air / core air)
  fpr: number // fan pressure ratio
  lpc: number // booster pressure ratio
  hpc: number // HP compressor pressure ratio
  T4: number // turbine entry temperature at take-off, K
  pgain: number // combustor total-pressure ratio (0.96 conventional, > 1 detonation)
  lhv: number // fuel lower heating value, J/kg
  fanD: number // fan / rotor diameter, m
  n1: number; n2: number // 100 % speeds, rpm
  I1: number; I2: number // spool inertias, kg·m²
  fans?: number // electric fans (turbo-electric)
  bli?: number // boundary-layer ingestion: inlet velocity deficit fraction
}
export interface Geo {
  surfaces: Surface[]
  bodies: Body[]
  masses: MassItem[]
  engine: EngineGeo
  gearDrag: number // drag area of the extended gear, m² (from tyre and strut frontal areas)
  cabin: { x0: number; x1: number; y: number; w: number } // where the passengers sit
  centreTank?: [number, number, number] // centre fuel location if not in the wing box
}

/* ------------------------------------------------------------------ F320 */
const D = Math.PI / 180
const A320_ROOT: Section = { ...A320_WING[0], z: 0 }
export const A320_GEO: Geo = {
  surfaces: [
    { id: 'wing', sections: [A320_ROOT, ...A320_WING], panels: 14, inc: [2.5 * D, -1.5 * D], camber: -2.2 * D, clmax: 1.55, cm0: -0.09, tank: [1.6, 14],
      ctrls: [
        ...A320_FLAPS.map(([z0, z1]) => ({ kind: 'flap' as const, z0, z1, cf: 0.3 })),
        ...A320_SLATS.map(([z0, z1]) => ({ kind: 'slat' as const, z0, z1, cf: 0.12 })),
        { kind: 'aileron', z0: A320_AIL[0], z1: A320_AIL[1], cf: 0.25 },
        ...A320_SPL.map(([z0, z1]) => ({ kind: 'spoiler' as const, z0, z1, cf: 0.17 })),
      ] },
    { id: 'winglet', sections: [{ le: -4.42, y: 3.42, z: 16.88, chord: 1.42, t: 0.1 }, { le: -4.95, y: 4.2, z: 17.22, chord: 0.95, t: 0.1 }, { le: -5.55, y: 5.45, z: 17.36, chord: 0.55, t: 0.1 }],
      panels: 2, inc: [0, 0], camber: -1 * D, clmax: 1.2, cm0: 0, ctrls: [] },
    { id: 'htail', sections: [{ ...A320_HS[0], z: 0 }, ...A320_HS], panels: 6, inc: [0, 0], camber: 0, clmax: 1.2, cm0: 0, ctrls: [{ kind: 'elevator', z0: 0.6, z1: 6.2, cf: 0.3 }] },
    { id: 'fin', sections: A320_FIN, vertical: true, panels: 6, inc: [0, 0], camber: 0, clmax: 1.2, cm0: 0, ctrls: [{ kind: 'rudder', z0: 5.3, z1: 11.6, cf: 0.32 }] },
  ],
  bodies: [
    { kind: 'fuselage', x0: AX.tail, x1: AX.nose, r: fusR, y: fusY, z: 0 },
    { kind: 'nacelle', x0: AX.engineX - 1.9, x1: AX.engineX + 1.9, r: (x) => 1.05 * Math.sqrt(Math.max(0.05, 1 - ((x - AX.engineX) / 2.0) ** 4)), y: () => AX.engineY, z: AX.engineZ, mirror: true },
  ],
  masses: [
    { id: 'wing', m: 6400, at: 'wing' }, { id: 'htail', m: 700, at: 'htail' }, { id: 'fin', m: 450, at: 'fin' },
    { id: 'fuselage', m: 9200, at: 'fuselage' },
    { id: 'engines', m: 3400, at: [AX.engineX, AX.engineY, AX.engineZ], size: [3.8, 2.1, 2.1], mirror: true },
    { id: 'mainGear', m: 950, at: [AX.mainGearX, 1.6, AX.mainGearZ], size: [0.8, 2, 0.8], mirror: true }, { id: 'noseGear', m: 350, at: [AX.noseGearX, 1.2, 0] },
    { id: 'apu', m: 250, at: AX.apu },
    { id: 'avionics', m: 1100, at: [14.5, 2.6, 0], size: [3, 1.5, 2] },
    { id: 'furnishings', m: 6200, at: 'cabin' },
    { id: 'systems', m: 5000, at: [0.4, 2.1, 0], size: [8, 1.2, 3] },
    { id: 'aircon', m: 1100, at: [0.5, 1.6, 0], size: [3, 0.8, 2.5] },
    { id: 'misc', m: 3150, at: 'fuselage' },
  ],
  cabin: { x0: -12.5, x1: 13.5, y: 3.3, w: 3.4 },
  engine: { kind: 'turbofan', W: 407, bpr: 5.7, fpr: 1.6, lpc: 1.6, hpc: 12.7, T4: 1650, pgain: 0.96, lhv: 43.2e6, fanD: 1.73, n1: 5000, n2: 14460, I1: 95, I2: 12 },
  gearDrag: 2.3,
}

/* ------------------------------------------------------------------ Strizh-180 */
/*
 * Design iteration 2 (found with the physics above): in the first drawing the wing sat 3 m too far aft — the CG was
 * ahead of the wing's leading edge (−50 % MAC) and the aircraft was hopelessly nose-heavy, with a static margin of
 * 140 % MAC. The wing, struts and engines moved 3.2 m forward and the tailplane shrank to 60 % of its area:
 * CG now 22–31 % MAC and a static margin of ≈ 1 m, like an F320.
 */
export const STRIZH_DX = 3.2
export const STRIZH_WING: Section[] = [
  { le: 0.4 + STRIZH_DX, y: 5.15, z: 1.9, chord: 3.4, t: 0.125 },
  { le: -1.15 + STRIZH_DX, y: 5.0, z: 8, chord: 2.7, t: 0.115 },
  { le: -3.6 + STRIZH_DX, y: 4.75, z: 18, chord: 1.75, t: 0.1 },
  { le: -5.0 + STRIZH_DX, y: 4.6, z: 23.65, chord: 1.2, t: 0.09 },
]
export const STRIZH_FIN: Section[] = [{ le: -11.6, y: 5.05, z: 0, chord: 6.2, t: 0.12 }, { le: -15.4, y: 10.9, z: 0, chord: 3.1, t: 0.11 }]
const HSK = Math.sqrt(0.6)
export const STRIZH_HS: Section[] = [{ le: -14.9, y: 11.0, z: 0.2, chord: 3.0 * HSK, t: 0.1 }, { le: -14.9 - 1.7 * HSK, y: 11.1, z: 6.6 * HSK, chord: 1.4 * HSK, t: 0.09 }]
export const STRIZH_ENG: [number, number, number] = [2.4 + STRIZH_DX, 4.85, 6.8]
export const STRIZH_STRUT: [[number, number, number], [number, number, number]] = [[-1.0 + STRIZH_DX * 0.55, 1.75, 2.25], [-2.6 + STRIZH_DX, 4.92, 13]]
export const STRIZH_GEAR: [number, number, number] = [-1.45 + STRIZH_DX * 0.55, 1.42, 2.3]
export const STRIZH_GEO: Geo = {
  surfaces: [
    { id: 'wing', sections: [{ ...STRIZH_WING[0], z: 0 }, ...STRIZH_WING], panels: 16, inc: [2.5 * D, -1 * D], camber: -2.5 * D, clmax: 1.6, cm0: -0.08, tank: [1.9, 15],
      ctrls: [{ kind: 'flap', z0: 2.2, z1: 13.2, cf: 0.28 }, { kind: 'krueger', z0: 2.2, z1: 22.5, cf: 0.12 }, { kind: 'aileron', z0: 18.4, z1: 22.6, cf: 0.28 }, { kind: 'spoiler', z0: 3, z1: 18, cf: 0.17 }] },
    { id: 'htail', sections: [{ ...STRIZH_HS[0], z: 0 }, ...STRIZH_HS], panels: 6, inc: [0, 0], camber: 0, clmax: 1.2, cm0: 0, ctrls: [{ kind: 'elevator', z0: 0.2, z1: 6.6, cf: 0.3 }] },
    { id: 'fin', sections: STRIZH_FIN, vertical: true, panels: 6, inc: [0, 0], camber: 0, clmax: 1.2, cm0: 0, ctrls: [{ kind: 'rudder', z0: 5.05, z1: 10.9, cf: 0.3 }] },
  ],
  bodies: [
    { kind: 'fuselage', x0: AX.tail, x1: AX.nose, r: fusR, y: fusY, z: 0 },
    { kind: 'pod', x0: STRIZH_ENG[0] - 2.2, x1: STRIZH_ENG[0] + 2.6, r: (x) => 0.6 * Math.sqrt(Math.max(0.05, 1 - ((x - STRIZH_ENG[0] - 0.2) / 2.5) ** 2)), y: () => STRIZH_ENG[1], z: STRIZH_ENG[2], mirror: true },
    { kind: 'pod', x0: STRIZH_GEAR[0] - 4.2, x1: STRIZH_GEAR[0] + 4.2, r: (x) => 0.9 * Math.sqrt(Math.max(0.05, 1 - ((x - STRIZH_GEAR[0]) / 4.2) ** 2)), y: () => 1.45, z: 2.05, mirror: true }, // gear sponsons
    { kind: 'strut', x0: STRIZH_STRUT[1][0], x1: STRIZH_STRUT[1][0] + 0.62, r: () => 0.06, y: () => 3.3, z: 7.6, mirror: true, wet: 2 * 0.62 * 11.6 * 2.1 },
  ],
  masses: [
    { id: 'wing', m: 6100, at: 'wing' }, { id: 'struts', m: 450, at: [-1.8 + STRIZH_DX, 3.3, 7.6], mirror: true }, { id: 'htail', m: 600, at: 'htail' }, { id: 'fin', m: 500, at: 'fin' },
    { id: 'fuselage', m: 7600, at: 'fuselage' },
    { id: 'engines', m: 3300, at: STRIZH_ENG, size: [4.8, 4, 4], mirror: true },
    { id: 'mainGear', m: 900, at: [STRIZH_GEAR[0], 1.4, 2.3], mirror: true }, { id: 'noseGear', m: 320, at: [AX.noseGearX, 1.2, 0] },
    { id: 'apu', m: 230, at: AX.apu }, { id: 'avionics', m: 1000, at: [14.5, 2.6, 0], size: [3, 1.5, 2] },
    { id: 'furnishings', m: 5200, at: 'cabin' }, { id: 'systems', m: 4300, at: [0.0, 2.6, 0], size: [8, 1.2, 3] },
    { id: 'aircon', m: 900, at: [0.0, 1.6, 0], size: [3, 0.8, 2.5] }, { id: 'misc', m: 1950, at: 'fuselage' },
  ],
  cabin: { x0: -12.5, x1: 13.5, y: 3.3, w: 3.4 },
  engine: { kind: 'openfan', W: 32, bpr: 60, fpr: 1.05, lpc: 2.0, hpc: 22, T4: 1720, pgain: 0.96, lhv: 43.2e6, fanD: 4.0, n1: 1100, n2: 22000, I1: 260, I2: 7 },
  gearDrag: 2.0,
}

/* ------------------------------------------------------------------ Vortex-240 */
/*
 * Design iteration 2 (found with the physics above). The first drawing had a 982 m² centre body: far too much skin
 * for 240 seats (lift-to-drag only 11) and the centre of gravity behind the neutral point (unstable). Now: a compact
 * 22 m centre chord, 16 % thick to hold the cabin and the hydrogen tanks, 56 m span (36 m folded) with outer
 * panels swept further back to move the neutral point aft, best L/D ≈ 17.
 * Honest limit found on the way: only ≈ 4 t of liquid hydrogen fit in the remaining volume, so the range is medium.
 *
 * Iteration 3 (after the panel-area fix in vlm.ts the full simulator could not lift the nose): static margin was 31 %
 * and the elevons on the 22 m centre chord lift close to the CG, so they hardly pitch the aircraft; the main gear
 * stood 2.8 m behind the CG. Now the outer panels sit 3 m further forward (margin 8–10 % MAC, as on fly-by-wire
 * blended wings), the cabin and equipment 1 m further aft, pitch and roll come from big elevons on the swept outer
 * panels (no flaps: on a tailless aircraft their nose-down moment cannot be trimmed), the main gear 1.1 m behind
 * the CG (≈ 17° tip-back angle).
 */
export const VX = { c0: 22, w: 6, cw: 12, blend: 2.5, rootC: 5.5, tipC: 1.8, sweep: 17, span: 56, wx: 3 }
/** planform: a smooth centre body blending into a swept outer wing (right half, z ≥ 0) */
export function vortexPlanform(z: number): Section {
  const p = VX
  if (z <= p.w) { const k = z / p.w; return { le: 19 - 7 * k ** 2.2, y: 3.4 + 0.1 * k, z, chord: p.c0 - (p.c0 - p.cw) * k ** 2, t: 0.16 - 0.04 * k } }
  if (z <= p.w + p.blend) { const k = (z - p.w) / p.blend, e = k * k * (3 - 2 * k); return { le: 12 - (12 - 3.2 - p.wx) * k, y: 3.5 + 0.13 * k, z, chord: p.cw - (p.cw - p.rootC) * e, t: 0.12 - 0.022 * k } }
  const k = (z - p.w - p.blend) / (p.span / 2 - p.w - p.blend)
  return { le: 3.2 + p.wx - p.sweep * k, y: 3.63 + 0.72 * k, z, chord: p.rootC - (p.rootC - p.tipC) * k, t: 0.098 - 0.013 * k }
}
const naca = (u: number) => 5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)
/** height of the Vortex upper surface at (x, z) */
export function vortexTop(x: number, z: number) {
  const s = vortexPlanform(Math.abs(z)), u = Math.max(0, Math.min(1, (s.le - x) / s.chord))
  return s.y + naca(u) * s.t * s.chord
}
export const VORTEX_FAN_Z = [0.95, 2.8, 4.65, 6.4]
export const VORTEX_FAN_X = -1.0
export const VORTEX_FIN_Z = 7.2
export const VORTEX_FIN: Section[] = [{ le: 4.2, y: 0, z: 0, chord: 4.6, t: 0.11 }, { le: 1.2, y: 4.0, z: 0, chord: 2.4, t: 0.1 }]
export const VORTEX_GEAR: [number, number, number] = [3.6, 1.75, 4.0]
export const vxZ = [0, 1.5, 3, 4.5, 5.5, 6, 6.8, 7.6, 8.5, 12, 15, 18, 21, 24, 28]
export const VORTEX_GEO: Geo = {
  surfaces: [
    { id: 'wing', sections: vxZ.map(vortexPlanform), panels: 13, chordwise: 3, inc: [1.5 * D, -2.5 * D], camber: -1.2 * D, clmax: 1.45, cm0: 0.01, tank: [0, 6],
      ctrls: [{ kind: 'elevon', z0: 0, z1: 8.5, cf: 0.1 }, { kind: 'elevon', z0: 9.5, z1: 23, cf: 0.3 }, { kind: 'aileron', z0: 23, z1: 28, cf: 0.28 }, { kind: 'krueger', z0: 9.5, z1: 27, cf: 0.12 }, { kind: 'spoiler', z0: 10, z1: 18, cf: 0.15 }] },
    { id: 'fin', sections: VORTEX_FIN.map((s) => ({ ...s, y: s.y + vortexTop(3, VORTEX_FIN_Z) - 0.05 })), vertical: true, pair: VORTEX_FIN_Z, cant: 10 * D, panels: 5, inc: [0, 0], camber: 0, clmax: 1.2, cm0: 0, ctrls: [{ kind: 'rudder', z0: 0, z1: 99, cf: 0.3 }] },
  ],
  bodies: [
    ...VORTEX_FAN_Z.map((z) => ({ kind: 'nacelle' as const, x0: VORTEX_FAN_X - 1.15, x1: VORTEX_FAN_X + 1.2, r: () => 1.0, y: () => vortexTop(VORTEX_FAN_X, z) + 0.55, z, mirror: true, wet: 2 * Math.PI * 1.05 * 2.35 * 0.6 })),
  ],
  masses: [
    { id: 'centrebody', m: 16500, at: 'wing' },
    { id: 'fins', m: 900, at: 'fin' },
    { id: 'cores', m: 3200, at: [3.0, 3.3, 2.2], size: [4, 1.2, 1.2], mirror: true },
    { id: 'generators', m: 1400, at: [0.5, 3.3, 2.2], mirror: true },
    { id: 'fans', m: 4 * 820, at: [VORTEX_FAN_X, 4.4, 3.6], size: [2.4, 2, 6], mirror: true },
    { id: 'lh2tanks', m: 2 * 2900, at: [0.0, 3.5, 3.0], size: [3, 1.8, 6], mirror: true },
    { id: 'mainGear', m: 1500, at: [VORTEX_GEAR[0], 1.6, VORTEX_GEAR[2]], mirror: true }, { id: 'noseGear', m: 450, at: [11, 1.2, 0] },
    { id: 'avionics', m: 1100, at: [14.5, 3.4, 0], size: [3, 1.5, 2] },
    { id: 'furnishings', m: 7600, at: [8.5, 3.4, 0], size: [12, 2, 10] },
    { id: 'systems', m: 5600, at: [4.0, 3.0, 0], size: [8, 1.4, 8] },
    { id: 'misc', m: 3550, at: [5.0, 3.4, 0], size: [16, 2, 10] },
  ],
  gearDrag: 2.6,
  cabin: { x0: 3, x1: 15, y: 3.4, w: 10 }, centreTank: [0.0, 3.5, 3.0],
  engine: { kind: 'turboelectric', W: 60, bpr: 0, fpr: 1.0, lpc: 2.2, hpc: 13, T4: 1750, pgain: 1.12, lhv: 120e6, fanD: 1.8, n1: 6200, n2: 21000, I1: 20, I2: 7, fans: 8, bli: 0.12 },
}

export const GEOS = { a320: A320_GEO, strizh: STRIZH_GEO, vortex: VORTEX_GEO }
