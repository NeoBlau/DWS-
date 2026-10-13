import { DETENT, type Sim } from './fdm'
import { FS, useFlight, type CamMode } from './state'
import { pollPad, BTN } from '../gamepad'
import { LOOK } from './Cockpit'

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
  const gp = pollPad()
  if (FS.pad.active) { c.stickX = FS.pad.x; c.stickY = FS.pad.y }
  else if (gp.connected && (gp.lx || gp.ly)) { c.stickX = gp.lx; c.stickY = gp.ly } // left stick = sidestick (down = pull)
  else {
    const pitch = (has('KeyS', 'ArrowDown') ? 1 : 0) - (has('KeyW', 'ArrowUp') ? 1 : 0)
    const roll = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0)
    c.stickY = ramp(c.stickY, pitch, dt)
    c.stickX = ramp(c.stickX, roll, dt)
  }
  const yaw = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0)
  if (gp.connected && gp.rx) c.pedal = gp.rx // right stick X = rudder pedals / nose-wheel tiller
  else if (!FS.keys.has('pedalUI')) c.pedal = ramp(c.pedal, yaw, dt) // the on-screen pedal slider sets c.pedal itself
  // thrust levers: hold Shift / Ctrl (or PageUp / PageDown); they stop briefly at each detent
  const padThr = gp.connected ? gp.rt - gp.lt : 0 // right trigger = more thrust, left trigger = less
  const up = has('ShiftLeft', 'ShiftRight', 'PageUp', 'Equal', 'NumpadAdd') || padThr > 0.1, dn = has('ControlLeft', 'ControlRight', 'PageDown', 'Minus', 'NumpadSubtract') || padThr < -0.1
  if (up || dn) {
    const atDet = [DETENT.CL, DETENT.FLX].some((d) => Math.abs(c.lever - d) < 1e-6)
    if (atDet && dwell < 0.4) dwell += dt
    else {
      const rate = 0.45 * (Math.abs(padThr) > 0.1 ? Math.abs(padThr) * 1.4 : 1)
      const next = Math.max(0, Math.min(1, c.lever + (up ? rate : -rate) * dt))
      const det = [DETENT.CL, DETENT.FLX].find((d) => (c.lever < d && next >= d) || (c.lever > d && next <= d))
      c.lever = det !== undefined ? det : next
      if (det !== undefined) dwell = 0
    }
  } else dwell = 0
  c.brake = has('KeyB') || FS.keys.has('brakeUI') || (gp.connected && gp.held[BTN.A]) ? 1 : 0
  if (gp.connected) {
    const P = gp.pressed, ui = useFlight.getState()
    if (P[BTN.RB]) c.flapLever = Math.min(4, c.flapLever + 1)
    if (P[BTN.LB]) c.flapLever = Math.max(0, c.flapLever - 1)
    if (P[BTN.X]) c.gearDown = !c.gearDown
    if (P[BTN.B] && s.d.wow) { c.lever = 0; c.rev = c.rev === 2 ? 1 : c.rev === 1 ? 0 : 2 }
    if (P[BTN.Y]) { const m: CamMode[] = ['chase', 'side', 'cockpit', 'wing', 'tower', 'orbit']; ui.set({ cam: m[(m.indexOf(ui.cam) + 1) % m.length] }) }
    if (P[BTN.BACK]) c.parkBrake = !c.parkBrake
    if (P[BTN.START]) ui.set({ paused: !ui.paused })
    if (P[BTN.UP]) c.speedbrake = Math.min(1, c.speedbrake + 0.25)
    if (P[BTN.DOWN]) c.speedbrake = Math.max(0, c.speedbrake - 0.25)
    if (P[BTN.L3]) c.spoilersArmed = !c.spoilersArmed
    if (P[BTN.LEFT] && !s.airborne) c.push = !c.push
    if (P[BTN.RIGHT]) { const on = !(c.master[0] && c.master[1]); c.master = [on, on] }
    if (P[BTN.R3]) { LOOK.yaw = 0; LOOK.pitch = -0.21 }
    if (ui.cam === 'cockpit' && gp.ry) LOOK.pitch = Math.max(-1.1, Math.min(0.9, LOOK.pitch - gp.ry * dt * 1.2))
  }
  c.trim = has('BracketRight') ? 1 : has('BracketLeft') ? -1 : FS.keys.has('trimUp') ? 1 : FS.keys.has('trimDn') ? -1 : 0
}
