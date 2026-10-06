import { getApp } from '../store'
import type { ComponentDef, LearnStep, Shot, SystemId, VehicleDef, VehicleId } from '../data/types'
import { VEHICLES } from '../vehicles'

export const vehicle = (id: VehicleId | null) => (id ? VEHICLES[id] : null)
export const currentDef = () => vehicle(getApp().vehicleId)

export function autoShot(c: ComponentDef, scale: number): Shot {
  const [x, y, z] = c.pos
  const d = 1.5 * scale
  const side = z < 0 ? -1 : 1
  return { pos: [x + d * 0.85, y + d * 0.55, z + side * d * 1.15], target: [x, y, z] }
}

export function selectComponent(def: VehicleDef, id: string, opts: { fly?: boolean; action?: boolean } = {}) {
  const c = def.components.find((k) => k.id === id)
  if (!c) return
  const s = getApp()
  s.set({
    selected: id, focusSystem: c.system, activeFlows: c.flows ?? [], activePaths: c.path ?? [], flowIsolate: false,
    panels: { ...s.panels, search: false },
  })
  if (opts.fly !== false) s.flyTo(c.shot ?? autoShot(c, def.scale))
  if (c.action && opts.action) s.act(c.action)
}

export function focusSystem(def: VehicleDef, sys: SystemId | null) {
  const s = getApp()
  if (!sys || s.focusSystem === sys && !s.selected) { s.set({ focusSystem: null, selected: null, activeFlows: [], activePaths: [] }); s.flyTo(def.overview); return }
  const comps = def.components.filter((c) => c.system === sys)
  const flows = Array.from(new Set(comps.flatMap((c) => c.flows ?? [])))
  s.set({ focusSystem: sys, selected: null, activeFlows: flows, activePaths: [], flowIsolate: false })
  const lead = comps.find((c) => c.hotspot) ?? comps[0]
  if (lead) s.flyTo(lead.shot ?? autoShot(lead, def.scale))
}

export function clearSelection(def: VehicleDef | null) {
  const s = getApp()
  s.set({ selected: null, focusSystem: null, activeFlows: s.tray === 'flows' ? s.activeFlows : [], activePaths: [] })
  if (def) s.flyTo(def.overview)
}

export function goZone(def: VehicleDef, zoneId: string) {
  const z = def.walk.find((w) => w.id === zoneId)
  if (!z) return
  const s = getApp()
  s.set({ walkZone: zoneId, selected: null, focusSystem: z.focus?.[0] ?? null, activeFlows: [], activePaths: [] })
  s.flyTo(z.shot)
}

/** apply one learn / demo / power-path step to the scene */
export function applyStep(def: VehicleDef, st: LearnStep) {
  const s = getApp()
  const c = st.focus ? def.components.find((k) => k.id === st.focus) : undefined
  s.set({
    selected: c?.id ?? null,
    focusSystem: c?.system ?? null,
    activeFlows: st.flows ?? c?.flows ?? [],
    activePaths: st.paths ?? [],
    flowIsolate: false,
    xray: !!st.xray,
  })
  const shot = st.shot ?? c?.shot ?? (c ? autoShot(c, def.scale) : def.overview)
  s.flyTo(shot)
  if (st.action) s.act(st.action)
  if (c) s.markUnderstood(def.id, c.id)
}

export function startLearn(def: VehicleDef, kind: 'learn' | 'power' | 'demo' | 'start') {
  const s = getApp()
  s.resetView()
  const pick = {
    learn: { steps: def.learn, title: 'LEARN MODE', style: 'card' as const, auto: false },
    power: { steps: def.powerPath.steps, title: def.powerPath.title, style: 'chain' as const, auto: false },
    demo: { steps: def.demo.steps, title: def.demo.title, style: 'card' as const, auto: true },
    start: { steps: def.start.steps, title: def.start.title, style: 'chain' as const, auto: true },
  }[kind]
  s.set({ learn: { ...pick, index: 0, demo: kind === 'demo' ? def.demo.id : undefined } })
  applyStep(def, pick.steps[0])
}

export function stepLearn(def: VehicleDef, dir: 1 | -1) {
  const s = getApp()
  const l = s.learn
  if (!l) return
  const i = Math.max(0, Math.min(l.steps.length - 1, l.index + dir))
  s.set({ learn: { ...l, index: i } })
  applyStep(def, l.steps[i])
}

export function exitLearn(def: VehicleDef | null) {
  const s = getApp()
  s.set({ learn: null, selected: null, focusSystem: null, activeFlows: [], activePaths: [] })
  if (def) s.flyTo(def.overview)
}

export function openVehicle(id: VehicleId, then?: () => void) {
  const s = getApp()
  s.resetView()
  s.set({ screen: 'machine', vehicleId: id, lab: null, panels: { systems: window.innerWidth > 900, search: false, settings: false, journey: false } })
  const def = VEHICLES[id]
  s.flyTo(def.overview)
  if (then) setTimeout(then, 60)
}

/* ---------------- search ---------------- */
const STOP = new Set(['where', 'is', 'the', 'a', 'an', 'how', 'does', 'what', 'show', 'me', 'find', 'где', 'находится', 'как', 'работает', 'что', 'такое', 'покажи', 'показать', 'это', 'в', 'и', 'у'])
export interface Hit { vehicle: VehicleDef; comp: ComponentDef; score: number }
export function search(q: string): Hit[] {
  const toks = q.toLowerCase().replace(/[?!.,]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t))
  if (!toks.length) return []
  const hits: Hit[] = []
  Object.values(VEHICLES).forEach((v) => {
    v.components.forEach((c) => {
      const hay = [c.name, c.ru, c.id, c.system, ...(c.keywords ?? [])].join(' ').toLowerCase()
      let score = 0
      toks.forEach((t) => {
        if (hay.includes(t)) score += t.length > 3 ? 3 : 1
        else if (t.length > 4 && hay.includes(t.slice(0, -2))) score += 1.5
      })
      if (c.name.toLowerCase().startsWith(toks[0])) score += 2
      if (getApp().vehicleId === v.id) score += 0.5
      if (score > 0) hits.push({ vehicle: v, comp: c, score })
    })
  })
  return hits.sort((a, b) => b.score - a.score).slice(0, 12)
}

export function goToHit(h: Hit) {
  const s = getApp()
  const go = () => { selectComponent(h.vehicle, h.comp.id) }
  if (s.vehicleId !== h.vehicle.id || s.screen !== 'machine') openVehicle(h.vehicle.id, () => setTimeout(go, 900))
  else go()
  s.set({ panels: { ...getApp().panels, search: false } })
}

export const progress = (v: VehicleDef) => {
  const u = getApp().understood[v.id] ?? []
  return Math.round((u.filter((id) => v.components.some((c) => c.id === id)).length / v.components.length) * 100)
}
