import type { VehicleDef, VehicleId } from '../data/types'
import { fortuner } from './toyotaFortuner'
import { bmw530i } from './bmw530i'
import { a320 } from './a320'

/** Registry of explorable machines. Add a new data file here (e.g. a Boeing 737) and it appears everywhere. */
export const VEHICLES: Record<VehicleId, VehicleDef> = {
  fortuner: fortuner as VehicleDef,
  bmw: bmw530i as VehicleDef,
  a320,
}
export const ORDER: VehicleId[] = ['fortuner', 'bmw', 'a320']
