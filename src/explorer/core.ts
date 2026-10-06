import { create } from 'zustand'
import type { Txt } from './i18n'
import type { Vec3 } from '../data/types'

/* ------------------------------------------------------------------ scene state */
export type FlowId = 'fuel' | 'air' | 'exhaust' | 'oil' | 'coolant' | 'core' | 'bypass' | 'hydraulic' | 'electric' | 'power'

/** Everything the 3D scene needs at a moment of the timeline. Pure function of time → scrubbing works backwards too. */
export interface SceneState {
  cut: number // 0 closed casing … 1 fully cut open
  xray: number // 0 opaque … 1 glass casings
  explode: number // 0 assembled … 1 exploded
  dim: number // darken everything that is not a highlighted flow / focus
  flows: Partial<Record<FlowId, number>>
  rpm: number // shown crank / spool speed (already slowed for visibility)
  focus: string[] // highlighted component ids
  labels: string[] // visible label ids
  extra: Record<string, number>
}
export const baseState = (p: Partial<SceneState> = {}): SceneState => ({ cut: 0, xray: 0, explode: 0, dim: 0, flows: {}, rpm: 0, focus: [], labels: [], extra: {}, ...p })

export interface Pose { pos: Vec3; target: Vec3 }

export interface Chapter { id: string; label: Txt; t: number }
export interface Marker { label: Txt; t: number }

export interface Track {
  id: string
  title: Txt
  duration: number
  chapters: Chapter[]
  markers: Marker[]
  camera: (t: number) => Pose
  state: (t: number) => SceneState
  /** caption under the scene; live = values the model writes each frame (e.g. stroke of cylinder 1) */
  caption: (t: number, live: Live) => Txt | null
  /** timestamps shown on the bar (e.g. engine start events) */
  ticks?: { t: number; label: Txt }[]
}

/** values the running model publishes for the UI (crank angle, rpm, temperatures…) */
export interface Live { [k: string]: number }
export const live: Live = {}

export interface LabelDef {
  id: string
  anchor: () => Vec3
  title: Txt
  sub?: (lv: Live) => Txt
  dx?: number
  dy?: number
}

/* ------------------------------------------------------------------ playback store */
export type ManualMode = 'auto' | 'walk' | 'cutaway' | 'xray' | 'flow' | 'exploded'
/** timeline clock: mutated every frame, deliberately outside React state */
/** snap: frames during which the director jumps straight to the target state (used on big jumps and by tests) */
export const CLOCK = { t: 0, snap: 0, boost: 0 }
export const seek = (t: number, snap = false) => {
  if (Math.abs(t - CLOCK.t) > 2.5) CLOCK.boost = 1.2
  CLOCK.t = t
  if (snap) CLOCK.snap = 2
}

interface ExpStore {
  track: string
  playing: boolean
  speed: number
  slow: boolean
  follow: boolean
  mode: ManualMode
  flowOff: FlowId[]
  throttle: number // 0..1 user input
  gear: number
  extra: Record<string, number>
  set: (p: Partial<ExpStore>) => void
}
export const useExp = create<ExpStore>((set) => ({
  track: 'main', playing: true, speed: 1, slow: false, follow: true, mode: 'auto', flowOff: [], throttle: 0.15, gear: 0, extra: {},
  set: (p) => set(p),
}))
export const exp = () => useExp.getState()

/** apply the user's manual mode on top of the scripted state */
export function withMode(s: SceneState, mode: ManualMode, flowOff: FlowId[]): SceneState {
  const r = { ...s, flows: { ...s.flows } }
  if (mode === 'walk') Object.assign(r, { cut: 0, xray: 0, explode: 0, dim: 0 })
  if (mode === 'cutaway') Object.assign(r, { cut: 1, xray: 0, explode: 0, dim: 0 })
  if (mode === 'xray') Object.assign(r, { cut: 0, xray: 1, explode: 0, dim: 0 })
  if (mode === 'flow') Object.assign(r, { cut: 1, xray: 0, explode: 0, dim: 0.8 })
  if (mode === 'exploded') Object.assign(r, { cut: 1, xray: 0, explode: 1, dim: 0 })
  if (mode === 'flow') Object.keys(r.flows).forEach((k) => { r.flows[k as FlowId] = Math.max(0.9, r.flows[k as FlowId] ?? 0) })
  flowOff.forEach((f) => { r.flows[f] = 0 })
  return r
}

/* ------------------------------------------------------------------ timing helpers */
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
export const smooth = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k) }
/** 0 before a, ramps to 1 by b, back to 0 between c and d */
export const window4 = (t: number, a: number, b: number, c = Infinity, d = Infinity) => smooth((t - a) / Math.max(1e-3, b - a)) * (1 - smooth((t - c) / Math.max(1e-3, d - c)))
export const between = (t: number, a: number, b: number) => t >= a && t < b

/** keyframed camera: holds each key, flies to the next with ease-in-out */
export function camPath(keys: { t: number; pos: Vec3; target: Vec3; fly?: number }[]): (t: number) => Pose {
  return (t: number) => {
    let i = 0
    while (i < keys.length - 1 && t >= keys[i + 1].t) i++
    const a = keys[i], b = keys[i + 1]
    if (!b) return { pos: a.pos, target: a.target }
    const fly = b.fly ?? 2.2
    const start = b.t - fly
    if (t < start) return { pos: a.pos, target: a.target }
    const k = smooth((t - start) / fly)
    const mix = (p: Vec3, q: Vec3): Vec3 => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k]
    // arc slightly outward during long flights so the camera "flies" rather than slides
    const pos = mix(a.pos, b.pos)
    const d = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2])
    pos[1] += Math.sin(k * Math.PI) * d * 0.12
    return { pos, target: mix(a.target, b.target) }
  }
}

/** pick the active entry of a list keyed by start times */
export function activeAt<T extends { t: number }>(list: T[], t: number): T | undefined {
  let r: T | undefined
  for (const x of list) if (t >= x.t) r = x
  return r
}

export interface ExplorerDef {
  id: string
  title: Txt
  subtitle: Txt
  kicker: Txt
  note: Txt
  tracks: Track[]
  labels: LabelDef[]
  flows: { id: FlowId; label: Txt; color: string }[]
  sky: [string, string, string]
}
