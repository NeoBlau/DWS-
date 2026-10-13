import type { Txt } from '../explorer/i18n'

/* Data model of the systems atlas: a schematic (parts + pipes), live parameters and the explanations. */
export type Tone = 'fuel' | 'air' | 'hot' | 'cool' | 'oil' | 'elec' | 'ctrl' | 'G' | 'B' | 'Y' | 'mech' | 'ref' | 'h2'
export const TONE: Record<Tone, string> = {
  fuel: '#ffb02e', air: '#8fd6ff', hot: '#ff6a3d', cool: '#36b0ff', oil: '#e8c547', elec: '#ffe14d', ctrl: '#c08aff',
  G: '#3be07a', B: '#5ca8ff', Y: '#ffe14d', mech: '#c9d2dd', ref: '#7ff0d0', h2: '#4fe0ff',
}
export interface Part { id: string; x: number; y: number; w: number; h: number; label: Txt; info: Txt; tone?: Tone }
export interface Pipe { pts: [number, number][]; tone: Tone; /** 0 = still, 1 = normal flow speed; reads the live state */ flow?: (st: St) => number; w?: number }
export interface Ctl { id: string; label: Txt; min: number; max: number; step: number; init: number; unit?: string; options?: [number, Txt][] }
export type St = Record<string, number>
export interface Live { values?: Record<string, string>; warn?: string[]; note?: Txt }
export interface SystemDef {
  id: string
  group: 'car' | 'plane' | 'vortex'
  title: Txt
  lead: Txt
  w?: number; h?: number
  parts: Part[]
  pipes: Pipe[]
  ctls?: Ctl[]
  live?: (st: St) => Live
  how: Txt[]
  donts: Txt[]
  numbers: [Txt, string][]
  widget?: 'shift' | 'diff' | 'trainer'
  sim?: 'drive' | 'flight' | 'rde' | 'vortex'
}
