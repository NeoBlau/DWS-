import { isa, G, KT, type Spec } from './fdm'

/**
 * Steady cruise from the same aerodynamic and engine model the simulator flies with:
 * lift = weight → CL; CD = CD0 + k·CL² + wave drag; thrust = drag; fuel = thrust × TSFC(Mach).
 */
export function cruise(sp: Spec, mass: number, altM: number, mach: number) {
  const atm = isa(altM)
  const V = mach * atm.a
  const q = 0.5 * atm.rho * V * V
  const W = mass * G
  const CL = W / (q * sp.S)
  const k = 1 / (Math.PI * sp.e * ((sp.b * sp.b) / sp.S))
  const CD = sp.CD0 + k * CL * CL + (mach > sp.mdd ? 0.25 * (mach - sp.mdd) ** 2 : 0)
  const D = CD * q * sp.S
  const ff = D * sp.tsfc0 * (1 + 0.85 * mach) // kg/h, both engines
  const km_h = V * 3.6
  return { CL, CD, LD: CL / CD, D, ff, tas: V / KT, perSeat100km: (ff / km_h) * 100 / sp.seats, co2PerSeat100km: (ff / km_h) * 100 / sp.seats * 3.16 }
}
/** best lift-to-drag ratio of the clean aircraft */
export const ldMax = (sp: Spec) => 0.5 * Math.sqrt((Math.PI * sp.e * ((sp.b * sp.b) / sp.S)) / sp.CD0)
