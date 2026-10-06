import type { FlowKind } from './types'

export const FLOW_META: Record<FlowKind, { label: string; ru: string; color: string }> = {
  fuel: { label: 'FUEL', ru: 'топливо', color: '#ff8a3d' },
  air: { label: 'AIR', ru: 'воздух', color: '#6cc6ff' },
  oil: { label: 'OIL', ru: 'масло', color: '#f2c94c' },
  coolant: { label: 'COOLANT', ru: 'охлаждающая жидкость', color: '#3ddc97' },
  electric: { label: 'ELECTRICITY', ru: 'электричество', color: '#a98bff' },
  hydraulic: { label: 'HYDRAULICS', ru: 'гидравлика / тормозная жидкость', color: '#ff4d5e' },
  exhaust: { label: 'EXHAUST', ru: 'выхлоп', color: '#c49a8f' },
  refrigerant: { label: 'A/C', ru: 'хладагент кондиционера', color: '#a6f0ff' },
  signal: { label: 'FLIGHT CONTROLS', ru: 'управляющие сигналы', color: '#f4f7ff' },
}

export const CAR_FLOWS: FlowKind[] = ['fuel', 'air', 'oil', 'coolant', 'electric', 'hydraulic', 'exhaust', 'refrigerant']
export const AIR_FLOWS: FlowKind[] = ['fuel', 'air', 'hydraulic', 'electric', 'signal', 'exhaust']
