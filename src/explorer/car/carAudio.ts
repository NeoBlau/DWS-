import { audio, isOn, shot, silence } from '../../audio/bus'
import { Group, Hiss, Pulses, Piston } from '../../audio/voices'
import type { Car } from './carPhysics'

/*
 * The car as you would hear it, from its physics: firing pulses at rpm / 60 × 2 (four cylinders), the exhaust note
 * opening with throttle, the diesel's combustion knock (louder when cold), the turbo's whistle with boost and the
 * petrol's blow-off valve when the throttle snaps shut; tyres squeal with slip on tarmac and crunch on gravel;
 * road and wind noise with speed; ABS pump pulses; gear changes; warning chimes for what the damage model reports.
 */
interface Rig { car: Car; eng: Piston; road: Group; tyre: Hiss; crunch: Hiss; rumble: Hiss; wind: Hiss; abs: Pulses; gear: number; sel: string; lastEv: number; thr: number; clock: number }
let rig: Rig | null = null

function build(c: AudioContext, car: Car): Rig {
  const road = new Group(c)
  const r: Rig = {
    car, eng: new Piston(c), road,
    tyre: new Hiss(road, 'white', 'bandpass', 1900, 5), crunch: new Hiss(road, 'pink', 'bandpass', 1200, 0.8), rumble: new Hiss(road, 'brown', 'lowpass', 150, 0.8),
    wind: new Hiss(road, 'pink', 'bandpass', 500, 0.5), abs: new Pulses(road, 'brown', 'lowpass', 260, 1, 'square'),
    gear: car.gear, sel: car.ctl.select, lastEv: car.t, thr: car.ctl.throttle, clock: 0,
  }
  road.level(1)
  return r
}
export function stopCarAudio() { if (rig) { rig.eng.dispose(); rig.road.dispose(); rig = null } }

export function updateCarAudio(car: Car, cam: string, dt: number) {
  if (!isOn()) { if (rig) { stopCarAudio(); silence() } return }
  const c = audio()
  if (!c) return
  if (!rig || rig.car !== car) { stopCarAudio(); rig = build(c, car) }
  const R = rig
  R.clock += dt
  if (R.clock < 1 / 40) return
  R.clock = 0
  const sp = car.spec, inside = cam === 'driver' || cam === 'hood'
  const speed = Math.abs(car.u)
  // engine load: throttle while the drivetrain is engaged, a little at idle
  const load = car.engineOn ? Math.max(0.05, car.ctl.throttle * (car.gear !== 0 ? 1 : 0.6)) : 0
  R.eng.update({ rpm: car.rpm, load, on: car.engineOn, crank: car.starting > 0, boost: car.boost, diesel: sp.diesel, cyl: 4, inside, cold: Math.max(0, Math.min(1, (60 - car.hw.coolant) / 50)) })
  // tyres: the largest slip of the four (longitudinal or lateral beyond the grip peak)
  let slip = 0, loose = 0
  for (const w of car.wheels) {
    if (w.lift) continue
    const s = Math.max(Math.abs(w.kappa) - 0.07, Math.abs(w.alpha) - 0.09)
    if (w.surface === 'asphalt' || w.surface === 'wet') slip = Math.max(slip, s * (w.surface === 'wet' ? 0.4 : 1))
    else loose = Math.max(loose, 1)
  }
  R.tyre.set(1700 + 600 * Math.min(1, slip * 3), speed > 1.5 ? Math.min(0.35, slip * 1.8) : 0)
  R.crunch.set(900 + speed * 20, loose ? Math.min(0.3, speed / 50) : 0)
  R.rumble.set(90 + speed * 4, Math.min(0.3, speed / 45) * (inside ? 0.8 : 1))
  R.wind.set(300 + speed * 12, Math.min(0.35, (speed / 45) ** 2 * (inside ? 0.3 : 0.4)))
  const absOn = car.wheels.some((w) => w.abs) && car.ctl.brake > 0.2 && speed > 2
  R.abs.set(14, 260, absOn ? 0.22 : 0)
  // gear changes and selector
  if (car.gear !== R.gear) { if (R.gear !== 0 && car.gear !== 0) shot('shift', inside ? 0.6 : 0.4); else shot('clunk', 0.35); R.gear = car.gear }
  if (car.ctl.select !== R.sel) { shot('switch', 0.5); R.sel = car.ctl.select }
  // petrol turbo: the blow-off valve vents boost when the throttle snaps shut
  if (!sp.diesel && R.thr > 0.5 && car.ctl.throttle < 0.15 && car.boost > 0.45) shot('blowoff', 0.6)
  R.thr = car.ctl.throttle
  for (const ev of car.events) {
    if (ev.t <= R.lastEv) continue
    switch (ev.e) {
      case 'overheat': case 'atfHot': case 'atfProtect': case 'brakeFade': case 'coldRev': case 'limp': case 'headGasket': case 'vacuumLost': shot('warn', 0.7); break
      case 'pRefused': case 'revRefused': case 'engageDelay': shot('beep', 0.8); break
      case 'engineSeized': case 'transFail': case 'xferBroken': shot('bang', 0.8); break
      case 'engineDamaged': case 'turboCoked': shot('grind', 0.6); break
      case 'reverseShock': case 'neutralDrop': shot('clunk', 0.9); break
      case 'pawl': shot('ratchet', 0.8); break
      case 'xferGrind': case 'windup': shot('grind', 0.7); break
      case 'rollover': shot('crash', 1); break
      case 'stall': shot('clunk', 0.5); break
    }
  }
  R.lastEv = Math.max(R.lastEv, car.events.length ? car.events[car.events.length - 1].t : R.lastEv)
}
