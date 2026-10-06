export type Vec3 = [number, number, number]
export type VehicleId = 'fortuner' | 'bmw' | 'a320'

export type FlowKind = 'fuel' | 'air' | 'oil' | 'coolant' | 'electric' | 'hydraulic' | 'exhaust' | 'refrigerant' | 'signal'

export type SystemId =
  | 'engine' | 'fuel' | 'transmission' | 'cooling' | 'electrical' | 'brakes' | 'steering'
  | 'suspension' | 'cabin' | 'exhaust' | 'body' | 'trunk' | 'climate'
  // aircraft
  | 'cockpit' | 'cargo' | 'wings' | 'engines' | 'gear' | 'hydraulics' | 'flightControls'
  | 'pneumatics' | 'apu' | 'structure'

export type LabId = 'cylinder' | 'compare' | 'turbo' | 'transmission' | 'brakes' | 'turbofan'

/** Camera shot: where the eye is, what it looks at. */
export interface Shot {
  pos: Vec3
  target: Vec3
  /** optional waypoint to pass through (e.g. through the door into the cabin) */
  via?: Vec3
}

export interface Gauge {
  label: string
  value: number
  max: number
  unit: string
  note?: string
}

/** Scene actions a step or a component can trigger. */
export type SceneAction =
  | 'engineStart' | 'engineStop' | 'throttle' | 'brake' | 'steer' | 'drive' | 'airbag'
  | 'openHood' | 'openDoor' | 'openTrunk' | 'closeAll'
  | 'flaps' | 'slats' | 'spoilers' | 'rollLeft' | 'pitchUp' | 'yawLeft' | 'gearDown' | 'gearUp'
  | 'apuStart' | 'enginesStart' | 'neutral'

export interface ComponentDef {
  id: string
  name: string // English label (UI)
  ru: string // Russian name
  system: SystemId
  pos: Vec3 // hotspot anchor in vehicle space
  beginner: string
  engineer: string
  shot?: Shot
  gauge?: Gauge
  flows?: FlowKind[]
  /** flow ids to highlight (full path) when selected */
  path?: string[]
  lab?: LabId
  action?: SceneAction
  keywords?: string[]
  /** show a floating hotspot marker in the overview */
  hotspot?: boolean
  /** representative / market-dependent note */
  varies?: string
}

export interface FlowDef {
  id: string
  kind: FlowKind
  label: string
  points: Vec3[]
  speed?: number // relative particle speed
  density?: number // particles per metre
  /** gradient from hot to cool along the path (coolant) */
  gradient?: [string, string]
  /** only active while engine/system runs */
  needsRun?: boolean
}

export interface WalkZone {
  id: string
  label: string
  shot: Shot
  xray?: boolean
  open?: ('hood' | 'door' | 'trunk')[]
  lift?: boolean
  focus?: SystemId[]
}

export interface LearnStep {
  title: string
  text: string
  focus?: string // component id
  shot?: Shot
  flows?: FlowKind[]
  paths?: string[]
  action?: SceneAction
  xray?: boolean
  duration?: number // seconds, used by demos
}

export interface Demo {
  id: string
  title: string
  subtitle: string
  vehicle: VehicleId
  steps: LearnStep[]
}

export interface SystemGroup {
  id: SystemId
  label: string
  ru: string
}

export interface ChecklistItem {
  label: string
  ids: string[] // component ids; item counts as understood if any is understood
}

export interface Spec {
  label: string
  value: string
}

export interface VehicleDef<L = unknown> {
  id: VehicleId
  kind: 'car' | 'aircraft'
  name: string
  line: string // e.g. DIESEL · SUV
  type: string // engine type line
  tagline: string
  representative: string
  varies: string
  specs: Spec[]
  systems: SystemGroup[]
  components: ComponentDef[]
  flows: FlowDef[]
  walk: WalkZone[]
  powerPath: { title: string; steps: LearnStep[] }
  start: { title: string; steps: LearnStep[] }
  demo: Demo
  learn: LearnStep[]
  overview: Shot
  layers: { id: string; label: string; offset: Vec3; outward?: number }[]
  /** world scale factor for flows, markers and camera limits (car = 1) */
  scale: number
  checklist: ChecklistItem[]
  gears?: { count: number; label: string }
  awd?: boolean
  layout: L
  accent: string
}
