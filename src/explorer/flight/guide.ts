import { T, type Txt } from '../i18n'
import { DEG, DEST, DETENT, type Sim } from './fdm'

/*
 * Guided flight: an instructor that only suggests. Each step names the control to use (it gets highlighted
 * in the UI) and a condition read from the simulation; it never moves a control or the aircraft.
 */
export type Ctl = 'flaps' | 'thrust' | 'stick' | 'pedals' | 'gear' | 'speedbrake' | 'reverse' | 'brakes' | 'engines' | 'park' | 'push' | 'none'
export interface Step { id: string; ctl: Ctl; text: Txt; hint: Txt; done: (s: Sim) => boolean }

const ft = (s: Sim) => s.d.alt - 10
export const TAKEOFF_STEPS: Step[] = [
  { id: 'flaps', ctl: 'flaps', text: T('Закрылки в положение 1 (на земле это 1+F)', 'Set flaps 1 (on the ground this is 1+F)'), hint: T('Кнопка «1» на рычаге FLAPS или клавиша F', 'Button “1” on the FLAPS lever or key F'), done: (s) => s.srf.confTarget === 2 },
  { id: 'arm', ctl: 'speedbrake', text: T('Взведите интерцепторы (ARM) — на случай прерванного взлёта', 'Arm the ground spoilers (ARM) — for a rejected take-off'), hint: T('Кнопка ARM у рычага SPEEDBRAKE', 'ARM button by the SPEEDBRAKE lever'), done: (s) => s.ctl.spoilersArmed },
  { id: 'toga', ctl: 'thrust', text: T('РУД в положение TOGA', 'Thrust levers to TOGA'), hint: T('Перетащите РУД до упора вверх или удерживайте Shift', 'Drag the levers fully up or hold Shift'), done: (s) => s.ctl.lever > 0.97 },
  { id: 'roll', ctl: 'pedals', text: T('Держите ось полосы педалями, ждите VR ≈ 145 узлов', 'Keep the centreline with the pedals, wait for VR ≈ 145 kt'), hint: T('Q / E — педали', 'Q / E — pedals'), done: (s) => s.d.ias > 142 },
  { id: 'rotate', ctl: 'stick', text: T('VR! Плавно на себя — тангаж 15°', 'VR! Ease back — 15° pitch'), hint: T('S или ↓ (или потяните ручку вниз)', 'S or ↓ (or drag the sidestick down)'), done: (s) => s.airborne && s.d.theta > 10 * DEG },
  { id: 'gearUp', ctl: 'gear', text: T('Положительная вертикальная — шасси убрать', 'Positive climb — gear up'), hint: T('Клавиша G или рычаг GEAR', 'Key G or the GEAR lever'), done: (s) => !s.ctl.gearDown },
  { id: 'climbThrust', ctl: 'thrust', text: T('На 1500 футов РУД в CL (набор)', 'At 1500 ft thrust levers to CL (climb)'), hint: T('Детент CL на рычаге', 'The CL detent on the lever'), done: (s) => ft(s) > 1300 && Math.abs(s.ctl.lever - DETENT.CL) < 0.05 },
  { id: 'flaps0', ctl: 'flaps', text: T('Разгоняясь, уберите закрылки: 1 → 0', 'While accelerating, retract flaps: 1 → 0'), hint: T('Кнопка «0» или клавиша V', 'Button “0” or key V'), done: (s) => s.ctl.flapLever === 0 && s.srf.conf < 0.1 },
  { id: 'level', ctl: 'stick', text: T('Займите 4000–6000 футов, скорость ≈ 250 узлов', 'Level off at 4000–6000 ft, about 250 kt'), hint: T('Ручкой уменьшите тангаж; газ — для скорости', 'Lower the nose with the stick; thrust sets speed'), done: (s) => ft(s) > 3800 && Math.abs(s.d.vs) < 400 && s.d.ias > 220 },
  { id: 'turn', ctl: 'stick', text: T('Попробуйте вираж 25° и отпустите ручку — крен удержится. Потом вернитесь на курс', 'Try a 25° bank and let go — the bank holds. Then roll back to the course'), hint: T('A / D или ← / →', 'A / D or ← / →'), done: (s) => s.flags.didTurn === true && Math.abs(s.d.phi) < 4 * DEG },
  { id: 'descent', ctl: 'thrust', text: T('За ≈ 20 NM до полосы: РУД в IDLE, нос вниз — вертикальная ≈ −1500 фт/мин', 'About 20 NM out: levers to IDLE, nose down — about −1500 ft/min'), hint: T('Расстояние до полосы — на PFD', 'Distance to the runway is on the PFD'), done: (s) => (DEST - s.pos.x) / 1852 < 22 && s.d.vs < -800 },
  { id: 'slow', ctl: 'speedbrake', text: T('Сбросьте скорость до 210 узлов (можно интерцепторами)', 'Slow down to 210 kt (speedbrakes help)'), hint: T('SPEEDBRAKE или малый газ', 'SPEEDBRAKE or idle thrust'), done: (s) => s.d.ias < 215 },
  { id: 'config', ctl: 'flaps', text: T('Выпускайте закрылки по шагам: 1 → 2 → 3, не превышая VFE', 'Extend flaps step by step: 1 → 2 → 3, below VFE'), hint: T('VFE показан на ленте скорости красным', 'VFE is the red band on the speed tape'), done: (s) => s.ctl.flapLever >= 3 },
  { id: 'gearDown', ctl: 'gear', text: T('Шасси выпустить', 'Gear down'), hint: T('Клавиша G', 'Key G'), done: (s) => s.ctl.gearDown && s.srf.gear > 0.99 },
  { id: 'full', ctl: 'flaps', text: T('Закрылки FULL, взведите интерцепторы (ARM), скорость ≈ 135 узлов', 'Flaps FULL, arm spoilers, about 135 kt'), hint: T('Пролетайте через розовые рамки глиссады', 'Fly through the magenta glide-path gates'), done: (s) => s.ctl.flapLever === 4 && s.ctl.spoilersArmed },
  { id: 'flare', ctl: 'stick', text: T('30 футов: РУД в IDLE и плавно на себя — мягкое касание', '30 ft: levers to IDLE and ease back — a soft touchdown'), hint: T('Цель: −100…−250 фт/мин при касании', 'Aim for −100…−250 ft/min at touchdown'), done: (s) => s.everAirborne && !s.airborne },
  { id: 'rev', ctl: 'reverse', text: T('Реверс и торможение до остановки', 'Reverse and brake to a stop'), hint: T('R — реверс, B — тормоза', 'R — reverse, B — brakes'), done: (s) => s.everAirborne && !s.airborne && s.d.gs < 3 },
]
export const APPROACH_STEPS: Step[] = TAKEOFF_STEPS.slice(TAKEOFF_STEPS.findIndex((x) => x.id === 'full'))
export const CRUISE_STEPS: Step[] = TAKEOFF_STEPS.slice(TAKEOFF_STEPS.findIndex((x) => x.id === 'turn'))

/* full flight: cold aircraft at the gate → departure → cruise → landing → taxi → parked at the other airport */
export const FULL_STEPS: Step[] = [
  { id: 'start', ctl: 'engines', text: T('Запустите двигатели: MASTER 1 и 2. Ждите AVAIL (~20 с)', 'Start the engines: MASTER 1 and 2. Wait for AVAIL (~20 s)'), hint: T('Клавиша M или кнопки MASTER. Смотрите на EGT — пик при розжиге', 'Key M or the MASTER buttons. Watch EGT peak at light-off'), done: (s) => s.eng.every((e) => e.state === 'run') },
  { id: 'push', ctl: 'push', text: T('Буксировка: снимите стояночный тормоз (P), включите буксир (T), педалями разверните нос', 'Pushback: release the parking brake (P), connect the tug (T), steer the nose with the pedals'), hint: T('Тягач толкает назад со скоростью пешехода', 'The tug pushes back at walking pace'), done: (s) => !s.ctl.parkBrake && s.pos.z > -345 },
  { id: 'taxi', ctl: 'thrust', text: T('Отцепите буксир (T). Рулите по жёлтой линии к началу полосы и встаньте на ось', 'Release the tug (T). Taxi along the yellow line to the start of the runway and line up'), hint: T('Немного газа (~30 % N1) чтобы тронуться, потом малый газ; поворот — педали. Не больше 20 узлов', 'A little thrust (~30 % N1) to break away, then idle; steer with the pedals. Max 20 kt'), done: (s) => s.pos.x < 500 && Math.abs(s.pos.z) < 12 && Math.abs(Math.atan2(s.vel.z, s.vel.x + 1e-6)) < 0.3 },
  ...TAKEOFF_STEPS,
  { id: 'vacate', ctl: 'pedals', text: T('Освободите полосу по рулёжке и рулите к перрону', 'Vacate the runway via a taxiway and taxi to the apron'), hint: T('Рулёжки — жёлтые линии; перрон у терминала', 'Taxiways have yellow lines; the apron is by the terminal'), done: (s) => s.pos.x > DEST - 200 && s.d.surface === 'apron' },
  { id: 'dock', ctl: 'brakes', text: T('Встаньте на стоянку по табло — до надписи STOP', 'Park on the stand by the docking board — until it reads STOP'), hint: T('Табло показывает метры до стоп-линии и куда довернуть', 'The board shows metres to the stop line and which way to steer'), done: (s) => !!s.d.stand && s.d.stand.airport === 'B' && Math.abs(s.d.stand.dist) < 4 && s.d.gs < 0.5 },
  { id: 'shutdown', ctl: 'engines', text: T('Стояночный тормоз (P) и выключите двигатели (MASTER OFF)', 'Set the parking brake (P) and shut the engines down (MASTER OFF)'), hint: T('Рейс завершён после выключения двигателей', 'The flight ends when the engines are off'), done: (s) => s.arrived },
]
