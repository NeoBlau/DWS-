import { useApp, getApp } from '../store'
import type { VehicleDef } from '../data/types'
import { CylinderLab } from './CylinderLab'
import { TurboLab } from './TurboLab'
import { TransmissionLab } from './TransmissionLab'
import { BrakeLab } from './BrakeLab'
import { TurbofanLab } from './TurbofanLab'

/** full-screen deep-dive scenes ("SEE HOW IT WORKS"); the main scene is paused underneath */
export function LabHost({ def }: { def: VehicleDef }) {
  const lab = useApp((s) => s.lab)
  if (!lab) return null
  const close = () => {
    const s = getApp()
    const comp = def.components.find((c) => c.lab === lab.id)
    if (comp) s.markUnderstood(def.id, comp.id)
    s.set({ lab: null })
  }
  const petrol = def.id === 'bmw'
  return (
    <div className="lab" role="dialog" aria-label="Deep dive">
      {lab.id === 'cylinder' && <CylinderLab initial={petrol ? 'petrol' : 'diesel'} onClose={close} />}
      {lab.id === 'compare' && <CylinderLab initial="compare" onClose={close} />}
      {lab.id === 'turbo' && <TurboLab variant={petrol ? 'twin' : 'vnt'} onClose={close} />}
      {lab.id === 'transmission' && <TransmissionLab def={def} onClose={close} />}
      {lab.id === 'brakes' && <BrakeLab onClose={close} />}
      {lab.id === 'turbofan' && <TurbofanLab onClose={close} />}
    </div>
  )
}
