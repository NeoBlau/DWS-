/*
 * Gamepad support (standard mapping: Xbox / PlayStation / most USB pads).
 * Polled once per frame; buttons are edge-detected so a press fires once.
 */
export interface PadState {
  connected: boolean
  id: string
  lx: number; ly: number; rx: number; ry: number // sticks, dead-zoned, −1…1 (y down = +1)
  lt: number; rt: number // triggers 0…1
  held: boolean[] // button is down
  pressed: boolean[] // went down this frame
}
const DEAD = 0.1
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD))
let prev: boolean[] = []
export const PAD: PadState = { connected: false, id: '', lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, held: [], pressed: [] }

export function pollPad(): PadState {
  const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
  const gp = Array.from(list ?? []).find((g) => g && g.connected) ?? null
  if (!gp) { PAD.connected = false; PAD.pressed = []; prev = []; return PAD }
  PAD.connected = true; PAD.id = gp.id
  PAD.lx = dz(gp.axes[0] ?? 0); PAD.ly = dz(gp.axes[1] ?? 0); PAD.rx = dz(gp.axes[2] ?? 0); PAD.ry = dz(gp.axes[3] ?? 0)
  PAD.lt = gp.buttons[6]?.value ?? 0; PAD.rt = gp.buttons[7]?.value ?? 0
  PAD.held = gp.buttons.map((b) => b.pressed)
  PAD.pressed = PAD.held.map((h, i) => h && !prev[i])
  prev = PAD.held
  return PAD
}
/** standard-mapping button indices */
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 }
