import { DETENT, type Sim } from './fdm'
import { FS } from './state'

/*
 * Keyboard → smooth analogue inputs. A key press ramps the stick like a hand would,
 * and releasing it lets the sidestick spring back to neutral.
 */
const ramp = (v: number, target: number, dt: number) => {
  const rate = target === 0 ? 4.5 : Math.sign(target) !== Math.sign(v) && v !== 0 ? 6 : 2.2
  return v + Math.max(-rate * dt, Math.min(rate * dt, target - v))
}
const has = (...k: string[]) => k.some((x) => FS.keys.has(x))
let dwell = 0

export function applyInputs(s: Sim, dt: number) {
  const c = s.ctl
  if (FS.pad.active) { c.stickX = FS.pad.x; c.stickY = FS.pad.y }
  else {
    const pitch = (has('KeyS', 'ArrowDown') ? 1 : 0) - (has('KeyW', 'ArrowUp') ? 1 : 0)
    const roll = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0)
    c.stickY = ramp(c.stickY, pitch, dt)
    c.stickX = ramp(c.stickX, roll, dt)
  }
  const yaw = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0)
  if (!FS.keys.has('pedalUI')) c.pedal = ramp(c.pedal, yaw, dt) // the on-screen pedal slider sets c.pedal itself
  // thrust levers: hold Shift / Ctrl (or PageUp / PageDown); they stop briefly at each detent
  const up = has('ShiftLeft', 'ShiftRight', 'PageUp', 'Equal', 'NumpadAdd'), dn = has('ControlLeft', 'ControlRight', 'PageDown', 'Minus', 'NumpadSubtract')
  if (up || dn) {
    const atDet = [DETENT.CL, DETENT.FLX].some((d) => Math.abs(c.lever - d) < 1e-6)
    if (atDet && dwell < 0.4) dwell += dt
    else {
      const next = Math.max(0, Math.min(1, c.lever + (up ? 0.45 : -0.45) * dt))
      const det = [DETENT.CL, DETENT.FLX].find((d) => (c.lever < d && next >= d) || (c.lever > d && next <= d))
      c.lever = det !== undefined ? det : next
      if (det !== undefined) dwell = 0
    }
  } else dwell = 0
  c.brake = has('KeyB') || FS.keys.has('brakeUI') ? 1 : 0
  c.trim = has('BracketRight') ? 1 : has('BracketLeft') ? -1 : FS.keys.has('trimUp') ? 1 : FS.keys.has('trimDn') ? -1 : 0
}
