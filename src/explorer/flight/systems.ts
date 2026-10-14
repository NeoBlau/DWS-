import type { Sim } from './fdm'

/*
 * Aircraft systems — the machinery the flight model depends on. Nothing is decorative:
 *
 *   electrical  batteries → DC buses; engine generators / APU generator / ground power → AC buses → TR units → DC;
 *               in flight with both AC buses lost the ram-air turbine drops and an emergency generator feeds AC ESS
 *   APU         needs battery power and fuel; supplies a generator and bleed air on the ground
 *   pneumatic   bleed air (APU or engines) drives the engines' air starters and the air-conditioning packs
 *   hydraulic   green (engine 1 pump), yellow (engine 2 pump or electric pump), blue (electric pump or RAT), 3000 psi;
 *               each control surface, the flaps, slats, gear, brakes, nose-wheel steering and reversers are moved
 *               by specific systems — with no pressure the surface does not move
 *   fuel        left / centre / right tanks, pumps, cross-feed; an engine whose tank is empty or unfed flames out;
 *               uneven tanks shift the centre of gravity sideways and roll the aircraft
 *   ADIRS       inertial reference must align (aircraft stationary) before the fly-by-wire has attitude data;
 *               without it only Direct law is available and the PFD shows red ATT / HDG flags
 *   pressurisation   packs keep the cabin low; without them the cabin climbs with the aircraft
 *
 * The «more-electric» designs (Strizh, Vortex) replace hydraulics and bleed air by electric actuators (EHA),
 * electric starter-generators and electric cabin compressors — they need AC power instead of pressure.
 *
 * Times are accelerated where the real thing is boring: IR alignment takes 90 s (real ≈ 7–10 min),
 * APU start ≈ 30 s (real ≈ 60 s).
 */

export const IR_ALIGN_S = 90
export type HydSys = 'G' | 'B' | 'Y'
export type EngMode = 'crank' | 'norm' | 'start'
export interface Switches {
  bat: [boolean, boolean]; ext: boolean; gen: [boolean, boolean]; apuGen: boolean
  apuMaster: boolean; apuStart: boolean; apuBleed: boolean; packs: [boolean, boolean]
  pumps: { L: boolean; C: boolean; R: boolean }; xfeed: boolean
  engPump: [boolean, boolean]; blueElec: boolean; yElec: boolean; ptu: boolean
  ir: boolean; engMode: EngMode; beacon: boolean
}
export type ApuState = 'off' | 'flap' | 'ready' | 'starting' | 'avail' | 'cooldown'
export interface Sys {
  sw: Switches
  bat: [number, number] // state of charge 0..1
  extAvail: boolean; extTorn: boolean; extAt: { x: number; z: number } | null
  apu: { n: number; egt: number; state: ApuState; t: number; usedBleed: boolean }
  ac: [boolean, boolean]; acEss: boolean; dcBat: boolean; dcEss: boolean; dc: boolean; emer: boolean
  acSrc: [string, string]
  rat: boolean
  bleed: number; bleedSrc: string
  hyd: Record<HydSys, number>
  accu: number // brake accumulator, psi
  tank: { L: number; C: number; R: number }
  feed: [string, string] // where each engine draws fuel from ('' = none)
  ir: { state: 'off' | 'align' | 'nav'; t: number }
  cab: number // cabin altitude, ft
  law: 'normal' | 'alternate' | 'direct' | 'mech'
  fault: { G: boolean; B: boolean; Y: boolean; gen: [boolean, boolean] }
  startFault: [string, string]
}

export function coldSwitches(): Switches {
  return {
    bat: [false, false], ext: false, gen: [true, true], apuGen: true, apuMaster: false, apuStart: false, apuBleed: false, packs: [true, true],
    pumps: { L: false, C: false, R: false }, xfeed: false, engPump: [true, true], blueElec: true, yElec: false, ptu: true, ir: false, engMode: 'norm', beacon: false,
  }
}
export function createSys(cold: boolean, fuel: number, wingCap: number): Sys {
  const sw = coldSwitches()
  if (!cold) Object.assign(sw, { bat: [true, true], pumps: { L: true, C: true, R: true }, ir: true, beacon: true })
  // wings fill first, the centre tank takes the rest
  const w = Math.min(fuel / 2, wingCap), c = Math.max(0, fuel - 2 * w)
  return {
    sw, bat: [1, 1], extAvail: cold, extTorn: false, extAt: null,
    apu: { n: 0, egt: 20, state: 'off', t: 0, usedBleed: false },
    ac: [!cold, !cold], acEss: !cold, dcBat: !cold, dcEss: !cold, dc: !cold, emer: false, acSrc: ['', ''],
    rat: false, bleed: 0, bleedSrc: '', hyd: { G: cold ? 0 : 3000, B: cold ? 0 : 3000, Y: cold ? 0 : 3000 }, accu: 3000,
    tank: { L: w, C: c, R: w }, feed: cold ? ['', ''] : w > 0 ? ['L', 'R'] : ['C', 'C'], ir: { state: cold ? 'off' : 'nav', t: cold ? 0 : IR_ALIGN_S }, cab: 0, law: 'normal',
    fault: { G: false, B: false, Y: false, gen: [false, false] }, startFault: ['', ''],
  }
}

/** quick cockpit preparation (what the first officer does before the captain arrives): switches only, the waits stay */
export function quickPrep(y: Sys) {
  const sw = y.sw
  sw.bat = [true, true]; if (y.extAvail) sw.ext = true; sw.ir = true; sw.apuMaster = true; sw.apuStart = true; sw.apuBleed = true
  sw.pumps = { L: true, C: true, R: true }; sw.beacon = true; sw.engMode = 'start'; sw.packs = [false, false]
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const toward = (v: number, t: number, up: number, down: number, dt: number) => (t > v ? Math.min(t, v + up * dt) : Math.max(t, v - down * dt))

/** fraction 0..1 of actuator power available to a surface driven by the listed hydraulic systems */
export function power(s: Sim, systems: string): number {
  const y = s.sys
  if (s.spec.arch === 'electric') return y.ac[0] || y.ac[1] ? 1 : y.acEss ? 0.6 : 0
  let best = 0
  for (const k of systems) best = Math.max(best, clamp((y.hyd[k as HydSys] - 1450) / 1000, 0, 1))
  return best
}
export const ACT = { ail: 'GB', elev: 'GBY', rud: 'GBY', ths: 'GY', spl: 'GBY', slat: 'GB', flap: 'GY', gear: 'G', nws: 'Y' }

export function engN2Running(s: Sim, i: number) { const e = s.eng[i]; return e.state === 'run' && e.n2 > 50 }

/** one systems step; runs before the flight-control laws */
export function stepSystems(s: Sim, dt: number) {
  const y = s.sys, sw = y.sw, d = s.d, elec = s.spec.arch === 'electric'
  /* ---------- electrical */
  const batOn = [sw.bat[0] && y.bat[0] > 0.02, sw.bat[1] && y.bat[1] > 0.02]
  const anyBat = batOn[0] || batOn[1]
  // ground power cart: only parked at a stand; driving away with the cable plugged in tears it out
  if (y.extAvail && !y.extTorn) {
    if (!y.extAt) y.extAt = { x: s.pos.x, z: s.pos.z }
    if (Math.hypot(s.pos.x - y.extAt.x, s.pos.z - y.extAt.z) > 3) {
      if (sw.ext) { y.extTorn = true; ev(s, 'extTorn') }
      y.extAvail = false
    }
  }
  const gen = [0, 1].map((i) => sw.gen[i] && !y.fault.gen[i] && engN2Running(s, i))
  const apuGen = sw.apuGen && y.apu.state === 'avail' || (sw.apuGen && y.apu.state === 'cooldown')
  const ext = sw.ext && y.extAvail && !y.extTorn
  const src = (i: number) => (gen[i] ? `GEN ${i + 1}` : ext ? 'EXT' : apuGen ? 'APU' : gen[1 - i] ? `GEN ${2 - i}` : '')
  y.acSrc = [src(0), src(1)]
  y.ac = [!!y.acSrc[0], !!y.acSrc[1]]
  // the RAT drops automatically when both AC buses are lost in flight (or both engines quit)
  if (s.airborne && !y.ac[0] && !y.ac[1] && d.ias > 100 && !y.rat) { y.rat = true; ev(s, 'rat') }
  if (!s.airborne && d.gs < 1) y.rat = false
  y.emer = y.rat && !y.ac[0] && !y.ac[1] && d.ias > 125
  y.acEss = y.ac[0] || y.ac[1] || y.emer || (anyBat && s.airborne) // static inverter in flight
  y.dc = y.ac[0] || y.ac[1]
  y.dcEss = y.dc || y.emer || anyBat
  y.dcBat = y.dc || anyBat
  for (let i = 0; i < 2; i++) {
    if (y.dc && sw.bat[i]) y.bat[i] = Math.min(1, y.bat[i] + dt / 900)
    else if (batOn[i]) y.bat[i] = Math.max(0, y.bat[i] - (dt / 1500) * (y.apu.state === 'starting' ? 6 : 1)) // ≈ 25 min alone; APU start draws a lot
  }

  /* ---------- APU */
  const a = y.apu, apuFuel = y.tank.L > 0 || y.tank.C > 0
  if (sw.apuMaster && y.dcBat) {
    if (a.state === 'off' || a.state === 'cooldown') { a.state = a.state === 'cooldown' ? 'avail' : 'flap'; a.t = 0 }
    a.t += dt
    if (a.state === 'flap' && a.t > 3) a.state = 'ready' // air-intake flap open
    if (a.state === 'ready' && sw.apuStart && apuFuel) { a.state = 'starting'; a.t = 0; ev(s, 'apuStart') }
    if (a.state === 'starting') {
      a.n = Math.min(100, a.n + dt * (a.n < 7 ? 2 : 4.2))
      if (a.n > 95) { a.state = 'avail'; ev(s, 'apuAvail') }
    }
    if (!apuFuel && (a.state === 'starting' || a.state === 'avail')) { a.state = 'off'; ev(s, 'apuFail') }
  } else if (a.state !== 'off') {
    // after supplying bleed air the APU runs a cool-down before it stops
    if (a.state === 'avail' && a.usedBleed) { a.state = 'cooldown'; a.t = 0 }
    if (a.state === 'cooldown') { a.t += dt; if (a.t > 20) { a.state = 'off'; a.usedBleed = false } }
    else a.state = 'off'
  }
  if (a.state === 'starting' || a.state === 'avail' || a.state === 'cooldown') {
    if (a.state !== 'starting') a.n = toward(a.n, 100, 10, 10, dt)
  } else a.n = Math.max(0, a.n - dt * 6)
  if (a.state !== 'ready' && a.state !== 'flap') sw.apuStart = a.state === 'starting'
  const apuLit = a.state === 'starting' && a.n > 7 || a.state === 'avail' || a.state === 'cooldown'
  const egtT = apuLit ? (a.state === 'starting' ? 380 + 520 * Math.exp(-(((a.n - 45) / 25) ** 2)) : 360 + (sw.apuBleed ? 160 : 0)) : 20
  a.egt += (egtT - a.egt) * Math.min(1, dt * 0.9)

  /* ---------- pneumatic */
  const apuBleed = sw.apuBleed && a.state === 'avail' ? 36 : 0
  if (apuBleed) a.usedBleed = true
  let engBleed = 0, eSrc = ''
  for (let i = 0; i < 2; i++) if (engN2Running(s, i)) { const p = 30 + (s.eng[i].n2 - 58) * 0.5; if (p > engBleed) { engBleed = p; eSrc = `ENG ${i + 1}` } }
  const raw = Math.max(apuBleed, engBleed)
  const packs = !elec && (sw.packs[0] || sw.packs[1]) && raw > 15 && y.dcEss
  y.bleed = elec ? 0 : Math.max(0, raw - (packs ? (sw.packs[0] && sw.packs[1] ? 10 : 5) : 0) * (engBleed > apuBleed ? 0.3 : 1))
  y.bleedSrc = elec ? '' : raw === 0 ? '' : apuBleed >= engBleed ? 'APU' : eSrc

  /* ---------- hydraulics */
  const anyEng = engN2Running(s, 0) || engN2Running(s, 1)
  const acAny = y.ac[0] || y.ac[1]
  const pumpP = (i: number) => (sw.engPump[i] && s.eng[i].n2 > 20 ? 3000 * clamp((s.eng[i].n2 - 20) / 30, 0, 1) : 0)
  let G = pumpP(0), Y = pumpP(1)
  if (sw.yElec && acAny) Y = Math.max(Y, 3000)
  let B = sw.blueElec && acAny && anyEng ? 3000 : 0
  if (y.rat && d.ias > 100) B = Math.max(B, 2500 * clamp((d.ias - 100) / 40, 0, 1))
  // power transfer unit: a hydraulic motor-pump linking green and yellow when they differ by > 500 psi
  if (sw.ptu && y.dc && Math.abs(G - Y) > 500 && Math.max(G, Y) > 2500) { if (G < Y) G = Y - 200; else Y = G - 200 }
  if (y.fault.G) G = 0
  if (y.fault.B) B = 0
  if (y.fault.Y) Y = 0
  if (elec) { const e = acAny ? 3000 : y.acEss ? 2000 : 0; G = e; B = e; Y = e }
  y.hyd.G = toward(y.hyd.G, G, 2000, 220, dt)
  y.hyd.B = toward(y.hyd.B, B, 2000, 220, dt)
  y.hyd.Y = toward(y.hyd.Y, Y, 2000, 220, dt)
  // brake accumulator: charged by yellow, emptied by braking without green
  if (y.hyd.Y > 2500) y.accu = toward(y.accu, 3000, 400, 0, dt)

  /* ---------- fuel */
  const t = y.tank, alt = d.alt ?? 0
  const pumpOK = acAny || (y.emer && false)
  for (let i = 0; i < 2; i++) {
    const own = i === 0 ? 'L' : 'R', other = i === 0 ? 'R' : 'L'
    let f = ''
    if (sw.pumps.C && pumpOK && t.C > 0) f = 'C'
    else if (t[own] > 0 && ((sw.pumps[own] && pumpOK) || alt < 15000)) f = own // below FL150 the engine can suck fuel without pumps
    else if (sw.xfeed && y.dcEss && t[other] > 0 && sw.pumps[other] && pumpOK) f = other
    y.feed[i] = f
  }

  /* ---------- inertial reference */
  if (sw.ir && y.dcBat) {
    if (y.ir.state === 'off') { y.ir.state = 'align'; y.ir.t = 0; ev(s, 'irAlign') }
    if (y.ir.state === 'align') {
      if ((d.gs ?? 0) > 1 || s.airborne) { y.ir.t = 0; if (!s.flags.irMoved) { s.flags.irMoved = true; ev(s, 'irMoved') } }
      else { s.flags.irMoved = false; y.ir.t += dt }
      if (y.ir.t >= IR_ALIGN_S) { y.ir.state = 'nav'; ev(s, 'irNav') }
    }
  } else if (y.ir.state !== 'off') { y.ir.state = 'off'; y.ir.t = 0 }

  /* ---------- pressurisation: the packs push conditioned air in, the outflow valve lets it out */
  const packFlow = elec ? (sw.packs[0] || sw.packs[1]) && acAny : packs
  if (!s.airborne) y.cab = alt
  else if (packFlow) y.cab = toward(y.cab, Math.max(0, alt * 0.22), 8, 8, dt) // ≈ 500 ft/min cabin rate
  else y.cab = toward(y.cab, alt, 35, 8, dt) // leaks up toward the outside altitude

  /* ---------- which flight-control law the computers can provide */
  const hydLost = ['GB', 'GY', 'BY'].some((p) => power(s, p[0]) === 0 && power(s, p[1]) === 0)
  y.law = !y.dcEss ? 'mech' : y.ir.state !== 'nav' || s.ctl.law === 'direct' ? 'direct' : y.emer || hydLost ? 'alternate' : 'normal'
}

/** fuel burnt this step is taken from the tanks that actually feed */
export function burnFuel(s: Sim, ff: [number, number], apuFF: number, dt: number) {
  const t = s.sys.tank
  const take = (k: 'L' | 'C' | 'R' | '', kg: number) => {
    if (!k || kg <= 0) return 0
    const got = Math.min(t[k], kg); t[k] -= got; return got
  }
  let used = 0
  for (let i = 0; i < 2; i++) used += take(s.sys.feed[i] as 'L' | 'C' | 'R' | '', (ff[i] / 3600) * dt)
  used += take(t.C > 0 && s.sys.sw.pumps.C ? 'C' : 'L', (apuFF / 3600) * dt)
  return used
}

function ev(s: Sim, e: string) {
  // local event helper (fdm.event would be a circular import at module load)
  for (let i = s.events.length - 1; i >= 0 && s.t - s.events[i].t < 4; i--) if (s.events[i].e === e) return
  s.events.push({ t: s.t, e: e as never })
  if (s.events.length > 80) s.events.shift()
}
