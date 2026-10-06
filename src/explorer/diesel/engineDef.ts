import { T, type Txt } from '../i18n'
import { baseState, camPath, window4, smooth, between, type ExplorerDef, type LabelDef, type Live, type SceneState, type Track } from '../core'
import { exploded } from '../materials'
import { airPath, exhaustPath, fuelPath } from './Powertrain'
import type { EngineSpec } from './spec'
import type { Vec3 } from '../../data/types'

const STROKE: Txt[] = [T('Впуск', 'Intake'), T('Сжатие', 'Compression'), T('Рабочий ход', 'Power'), T('Выпуск', 'Exhaust')]

/** cylinder-1 narration from the live crank position */
function strokeCaption(s: EngineSpec, lv: Live): Txt {
  const st = lv.stroke1 ?? 0
  const diesel = !s.petrol
  if (lv.burn1 > 0.05) return diesel
    ? T('СГОРАНИЕ: дизель воспламенился сам — от жара сжатого воздуха. Давление толкает поршень вниз.', 'COMBUSTION: the diesel ignites by itself in the hot compressed air. Pressure drives the piston down.')
    : T('СГОРАНИЕ: искра подожгла смесь, фронт пламени расширяется и толкает поршень вниз.', 'COMBUSTION: the spark lit the mixture; the flame front expands and drives the piston down.')
  if (lv.inj1 > 0.5) return diesel
    ? T('ВПРЫСК: форсунка распыляет дизель под давлением ~2000 бар прямо в раскалённый воздух.', 'INJECTION: the injector sprays diesel at ~2000 bar straight into the red-hot air.')
    : T('ВПРЫСК: форсунка впрыскивает бензин прямо в цилиндр во время впуска — он смешивается с воздухом.', 'INJECTION: petrol is injected straight into the cylinder during intake and mixes with the air.')
  const txt: [Txt, Txt][] = [
    [T('1 · ВПУСК: поршень идёт вниз, впускные клапаны открыты, цилиндр заполняется воздухом от турбины.', '1 · INTAKE: piston moves down, intake valves open, the cylinder fills with boosted air.'),
      T('1 · ВПУСК: поршень идёт вниз, впускные клапаны открыты — внутрь идёт воздух.', '1 · INTAKE: piston moves down, intake valves open, air rushes in.')],
    [T('2 · СЖАТИЕ: клапаны закрыты, поршень сжимает воздух в ~16 раз — он раскаляется до 700–900 °C.', '2 · COMPRESSION: valves closed, the piston squeezes the air ~16 times; it heats to 700–900 °C.'),
      T('2 · СЖАТИЕ: клапаны закрыты, смесь сжимается ~в 10 раз. Свеча ждёт своего момента.', '2 · COMPRESSION: valves closed, the mixture is squeezed ~10 times. The spark plug waits for its moment.')],
    [T('3 · РАБОЧИЙ ХОД: расширяющиеся газы толкают поршень, шатун крутит коленвал.', '3 · POWER: expanding gas pushes the piston, the rod turns the crankshaft.'),
      T('3 · РАБОЧИЙ ХОД: газы расширяются и толкают поршень — это единственный такт, который даёт энергию.', '3 · POWER: gas expands and pushes the piston — the only stroke that makes energy.')],
    [T('4 · ВЫПУСК: открыты выпускные клапаны, поршень выталкивает газы к турбине.', '4 · EXHAUST: exhaust valves open, the piston pushes gas out towards the turbo.'),
      T('4 · ВЫПУСК: выпускные клапаны открыты, газы уходят в турбину и катализатор.', '4 · EXHAUST: exhaust valves open, gas leaves to the turbo and catalyst.')],
  ]
  return txt[st][diesel ? 0 : 1]
}

export function makeEngineDef(s: EngineSpec): ExplorerDef {
  const d = s.deck, c1 = s.cx[0], P = s.petrol
  const [tx, ty, tz] = s.turbo
  const gbEnd = -0.47 - s.gears.length * (s.gears.length > 6 ? 0.06 : 0.08) - 0.1
  const W = { wide: { pos: [0.4, 1.35, 3.9] as Vec3, target: [-1.0, -0.05, 0] as Vec3 } }

  /* ------------------------------ labels */
  const L = (id: string, p: Vec3, off: Vec3, title: Txt, sub?: (lv: Live) => Txt, dx = 40, dy = -40, delay = 0): LabelDef => ({ id, anchor: () => exploded(p, off, delay), title, sub, dx, dy })
  const labels: LabelDef[] = [
    L('block', [-0.2, 0.18, 0], [0, -0.03, 0], T('Блок цилиндров', 'Cylinder block'), () => T('гильзы + рубашка охлаждения', 'liners + water jacket'), -60, 70),
    L('head', [0.1, d + 0.06, -0.12], [0, 0.26, 0], T('Головка блока', 'Cylinder head'), () => T('16 клапанов, 2 распредвала', '16 valves, twin cams'), 50, -70),
    L('cams', [-0.1, d + 0.075, 0.032], [0, 0.36, 0], T('Распредвалы', 'Camshafts'), () => T('½ оборотов коленвала', 'half crank speed'), 60, -90),
    L('valveIn', [c1 + 0.018, d + 0.02, 0.029], [0, 0.36, 0], T('Впускной клапан', 'Intake valve'), (lv) => T(`подъём ${Math.round(Math.max(0, lv.inLift1 ?? 0) * 9)} мм`, `lift ${Math.round(Math.max(0, lv.inLift1 ?? 0) * 9)} mm`), 60, -60),
    L('valveEx', [c1 - 0.018, d + 0.02, -0.029], [0, 0.36, 0], T('Выпускной клапан', 'Exhaust valve'), undefined, -60, -70),
    L('piston', [c1, d - 0.05, 0.03], [0, -0.08, 0.3], T('Поршень', 'Piston'), (lv) => STROKE[lv.stroke1 ?? 0], 70, 40),
    L('rod', [c1, 0.1, 0.02], [0, -0.08, 0.3], T('Шатун', 'Connecting rod'), undefined, 70, 30),
    L('crank', [0.0, 0.0, 0.05], [0, -0.2, 0.18], T('Коленвал', 'Crankshaft'), (lv) => T(`${Math.round(lv.rpm ?? 0)} об/мин`, `${Math.round(lv.rpm ?? 0)} rpm`), -40, 70),
    L('injector', [c1, d + 0.1, 0.01], [0, 0.62, 0.05], T('Форсунка', 'Injector'), (lv) => (lv.inj1 ? T('ВПРЫСК', 'INJECTING') : T('закрыта', 'closed')), 60, -50),
    L('rail', [-0.1, P ? d + 0.06 : d + 0.2, P ? 0.085 : 0.07], [0, 0.62, 0.05], T(P ? 'Топливная рампа' : 'Common Rail', P ? 'Fuel rail' : 'Common Rail'), (lv) => T(P ? '≈ 200–350 бар, прибл.' : `≈ ${lv.rail ?? 1600} бар, прибл.`, P ? '≈ 200–350 bar approx.' : `≈ ${lv.rail ?? 1600} bar approx.`), -60, -60),
    L('hpPump', [0.3, 0.13, 0.13], [0.25, 0, 0.2], T('ТНВД', 'High-pressure pump'), () => T('сжимает топливо', 'pressurises fuel'), 60, 40),
    L('filter', [0.48, 0.1, 0.33], [0.3, 0.2, 0.25], T(P ? 'Топливный фильтр' : 'Фильтр-водоотделитель', P ? 'Fuel filter' : 'Filter / water separator'), undefined, 60, -40),
    L('tank', [s.tank.pos[0], s.tank.pos[1] + 0.1, s.tank.pos[2] + 0.1], [0, -0.35, 0.2], T('Топливный бак', 'Fuel tank'), () => T(P ? 'бак-«седло» над карданом' : 'под полом, между лонжеронами', P ? 'saddle tank over the driveshaft' : 'under the floor between the rails'), 50, -60),
    L('turbine', [tx - 0.08, ty + 0.05, tz], [0, 0.12, -0.38], T('Турбина', 'Turbine'), () => T('крутится от выхлопа', 'spun by exhaust gas'), -60, -60),
    L('compressor', [tx + 0.085, ty + 0.06, tz], [0, 0.12, -0.38], T('Компрессор', 'Compressor'), (lv) => T(`≈ ${(lv.turboRpm ?? 0).toLocaleString('ru-RU')} об/мин`, `≈ ${(lv.turboRpm ?? 0).toLocaleString('en-US')} rpm`), 60, -60),
    L('shaftT', [tx, ty - 0.01, tz], [0, 0.12, -0.38], T('Вал', 'Shaft'), () => T('связывает турбину и компрессор', 'links turbine and compressor'), 40, 70),
    L('vnt', [tx - 0.08, ty - 0.056, tz], [0, 0.12, -0.38], T(P ? 'Twin-scroll' : 'Лопатки VNT', P ? 'Twin-scroll' : 'VNT vanes'), () => T(P ? 'два канала улитки' : 'меняют угол потока', P ? 'two volute channels' : 'change the gas angle'), -70, 60),
    L('intercooler', [0.86, 0.1, 0.12], [0.45, 0, 0], T('Интеркулер', 'Intercooler'), () => T('охлаждает сжатый воздух', 'cools the boosted air'), 50, -60),
    L('chain', [0.235, d - 0.05, 0.06], [0.22, 0.05, 0], T('Цепь ГРМ', 'Timing chain'), undefined, 60, -30),
    L('oilPump', [0.26, -0.1, 0.0], [0.25, 0, 0.2], T('Масляный насос', 'Oil pump'), undefined, 60, 50),
    L('waterPump', [0.26, 0.04, -0.02], [0.25, 0, 0.2], T('Помпа', 'Water pump'), undefined, 60, 10),
    L('flywheel', [-0.29, 0.1, 0.05], [0, -0.2, 0.18], T('Маховик', 'Flywheel'), undefined, -50, -60),
    L('starter', [-0.2, -0.08, -0.1], [-0.1, -0.1, -0.2], T('Стартер', 'Starter'), undefined, -50, 50),
    L('battery', [s.battery[0], s.battery[1] + 0.1, s.battery[2]], [0, 0.25, -0.2], T('Аккумулятор 12 В', '12 V battery'), undefined, 50, -50),
    L('gearbox', [-0.8, 0.12, 0.05], [-0.35, -0.05, 0.25], T('Коробка передач', 'Gearbox'), (lv) => T(`передача ${lv.gear ?? 1} · ${(lv.ratio ?? 1).toFixed(2)} : 1`, `gear ${lv.gear ?? 1} · ${(lv.ratio ?? 1).toFixed(2)} : 1`), 50, -70),
    L('driveshaft', [(gbEnd + s.rearAxleX) / 2, -0.09, 0], [-0.25, -0.2, 0], T('Карданный вал', 'Driveshaft'), undefined, 40, -50),
    L('diff', [s.rearAxleX, s.axleY + 0.1, 0.05], [0, -0.2, 0], T('Дифференциал', 'Differential'), () => T('поворачивает поток на 90°', 'turns drive 90°'), -50, -60),
    L('wheel', [s.rearAxleX, s.axleY + s.wheelR * 0.7, s.track / 2 + 0.1], [0, 0, 0.35], T('Колесо', 'Wheel'), (lv) => T(`≈ ${Math.round((lv.rpm ?? 0) / (lv.ratio ?? 1) / 3.7)} об/мин`, `≈ ${Math.round((lv.rpm ?? 0) / (lv.ratio ?? 1) / 3.7)} rpm`), 50, -50),
    L('dpf', [-0.72, -0.17, -0.33], [0, -0.25, -0.15], T(P ? 'Катализатор / OPF' : 'DOC + DPF', P ? 'Catalyst / OPF' : 'DOC + DPF'), () => T('очистка выхлопа', 'cleans exhaust'), 40, 50),
    L('glow', [c1 + 0.022, d + 0.04, 0.05], [0, 0.62, 0.05], T(P ? 'Свеча зажигания' : 'Свеча накала', P ? 'Spark plug' : 'Glow plug'), () => T(P ? 'искра ~20–40 кВ, прибл.' : 'греет камеру при холодном пуске', P ? 'spark ~20–40 kV approx.' : 'heats the chamber on cold start'), -70, -40),
    L('transfer', [gbEnd - 0.12, -0.05, 0.1], [-0.25, -0.2, 0], T('Раздаточная коробка', 'Transfer case'), () => T('делит момент на оба моста', 'splits torque to both axles'), 50, 60),
  ].filter((l) => (P ? l.id !== 'transfer' : true))

  /* ------------------------------ main documentary track */
  const ALL_PARTS = ['block', 'head', 'cams', 'piston', 'crank', 'injector', 'turbine', 'gearbox']
  const main: Track = {
    id: 'main', title: T('От топлива до колёс', 'From fuel to wheels'), duration: 48,
    chapters: [
      { id: 'intro', label: T('Обзор', 'Overview'), t: 0 },
      { id: 'cut', label: T('Разрез', 'Cutaway'), t: 4 },
      { id: 'fuel', label: T('Топливо', 'Fuel'), t: 8 },
      { id: 'cyl', label: T('Цилиндр', 'Cylinder'), t: 17 },
      { id: 'turbo', label: T('Турбина', 'Turbo'), t: 29 },
      { id: 'power', label: T('К колёсам', 'To the wheels'), t: 35 },
      { id: 'exp', label: T('Разборка', 'Exploded'), t: 43 },
    ],
    markers: [{ label: T('Обзор', 'Walk'), t: 0 }, { label: T('Разрез', 'Cutaway'), t: 4 }, { label: T('Поток', 'Flow'), t: 8 }, { label: T('Разборка', 'Exploded'), t: 43 }],
    camera: camPath([
      { t: 0, ...W.wide },
      { t: 3.2, pos: [0.85, 0.65, 1.5], target: [0.0, 0.12, 0], fly: 2.6 },
      { t: 7.8, pos: [0.65, 0.5, 1.1], target: [0.0, 0.14, 0], fly: 1.5 },
      { t: 9.6, pos: [-1.15, 0.35, 1.25], target: [s.tank.pos[0], s.tank.pos[1], s.tank.pos[2] * 0.5], fly: 2.0 },
      { t: 11.4, pos: [0.95, 0.3, 1.0], target: [0.45, 0.05, 0.3], fly: 1.8 },
      { t: 13.0, pos: [0.65, 0.42, 0.75], target: [0.3, 0.12, 0.13], fly: 1.4 },
      { t: 14.8, pos: [0.42, d + 0.25, 0.55], target: [0.05, d + 0.12, 0.05], fly: 1.6 },
      { t: 16.8, pos: [0.32, d + 0.08, 0.32], target: [c1, d - 0.01, 0], fly: 1.6 },
      { t: 19.0, pos: [c1 + 0.09, d - 0.03, 0.22], target: [c1, d - 0.055, 0], fly: 2.0 },
      { t: 26.5, pos: [c1 + 0.1, d - 0.0, 0.26], target: [c1, d - 0.05, 0], fly: 6 },
      { t: 30.5, pos: [0.3, ty + 0.25, 0.25], target: [tx, ty, tz], fly: 2.4 },
      { t: 34.5, pos: [0.1, ty + 0.2, 0.15], target: [tx, ty, tz], fly: 3 },
      { t: 36.3, pos: [-0.05, 0.3, 0.75], target: [-0.35, 0.0, 0], fly: 1.6 },
      { t: 38.3, pos: [-0.55, 0.25, 0.75], target: [-0.75, -0.02, 0], fly: 1.8 },
      { t: 40.3, pos: [-1.2, 0.3, 1.2], target: [(gbEnd + s.rearAxleX) / 2, -0.1, 0], fly: 1.8 },
      { t: 42.6, pos: [s.rearAxleX + 0.75, 0.25, 1.65], target: [s.rearAxleX, s.axleY, 0.5], fly: 1.9 },
      { t: 46.5, pos: [0.8, 1.7, 4.4], target: [-1.0, 0.1, 0], fly: 3.2 },
    ]),
    state: (t) => {
      const fuelW = window4(t, 8, 8.8, 16.6, 17.6)
      const cylW = window4(t, 17, 18, 28.5, 29.3)
      const turboW = window4(t, 29, 30, 34.4, 35.2)
      const powerW = window4(t, 35, 36, 42.8, 43.8)
      const focus: string[] = []
      if (between(t, 8, 9.9)) focus.push('tank'); if (between(t, 9.9, 11.8)) focus.push('filter', 'fuelLine'); if (between(t, 11.8, 13.6)) focus.push('hpPump')
      if (between(t, 13.6, 15.3)) focus.push('rail'); if (between(t, 15.3, 17.4)) focus.push('injector')
      if (between(t, 29.5, 35)) focus.push('turbine', 'compressor', 'shaftT')
      if (between(t, 35, 36.6)) focus.push('crank', 'flywheel'); if (between(t, 36.6, 38.8)) focus.push('gearbox'); if (between(t, 38.8, 41)) focus.push('driveshaft', 'transfer'); if (between(t, 41, 43.5)) focus.push('diff', 'axle', 'wheel')
      const labels =
        t < 4 ? [] :
        t < 8 ? ['block', 'head', 'cams', 'piston', 'crank', 'injector', 'chain', 'turbine'] :
        t < 17 ? (t < 9.9 ? ['tank'] : t < 11.8 ? ['filter'] : t < 13.6 ? ['hpPump', 'filter'] : t < 15.3 ? ['rail', 'hpPump'] : ['injector', 'rail', 'glow']) :
        t < 29 ? ['valveIn', 'valveEx', 'piston', 'injector', 'glow'] :
        t < 35 ? ['turbine', 'compressor', 'shaftT', 'vnt'] :
        t < 43 ? (t < 36.6 ? ['crank', 'flywheel'] : t < 38.8 ? ['gearbox'] : t < 41 ? ['driveshaft', 'transfer'] : ['diff', 'wheel']) :
        ['head', 'cams', 'piston', 'crank', 'block', 'turbine', 'gearbox', 'rail', 'flywheel']
      return baseState({
        cut: smooth((t - 4) / 2.5),
        xray: turboW * 0.85,
        explode: smooth((t - 43.6) / 2.4),
        dim: Math.max(fuelW * 0.82, cylW * 0.4, turboW * 0.35, powerW * 0.72),
        flows: {
          fuel: Math.max(fuelW, cylW * 0.9),
          air: Math.max(cylW * 0.9, turboW, window4(t, 4.5, 6, 7.6, 8.4) * 0.6),
          exhaust: Math.max(cylW * 0.9, turboW, window4(t, 4.5, 6, 7.6, 8.4) * 0.6),
          coolant: window4(t, 4.8, 6, 7.6, 8.4) * 0.8,
          oil: window4(t, 5.2, 6.4, 7.6, 8.4) * 0.8,
          power: powerW,
        },
        rpm: t < 17 ? 42 : t < 29 ? 7 : t < 35 ? 70 : t < 43 ? 46 : 18,
        focus, labels,
        extra: {
          realRpm: t < 29 && t >= 17 ? 800 : t >= 29 && t < 35 ? 3000 : 900,
          turboRpm: t >= 29 && t < 35 ? 1 : 0.35,
          turboCut: turboW,
          macro: cylW,
          gear: t < 37.6 ? 0 : t < 39.2 ? 1 : t < 40.8 ? 2 : 3,
          awd: 1, glow: 0, starter: 0,
        },
      })
    },
    caption: (t, lv) => {
      if (t < 4) return P ? T('BMW 530i: рядная «четвёрка» 2,0 л с турбонаддувом и непосредственным впрыском. Смотрим, как бензин превращается во вращение колёс.', 'BMW 530i: a 2.0 L turbo inline-4 with direct injection. Let us see how petrol becomes turning wheels.')
        : T('Toyota Fortuner: рядная «четвёрка» турбодизель с Common Rail. Смотрим, как дизель превращается во вращение колёс.', 'Toyota Fortuner: a Common Rail turbo-diesel inline-4. Let us see how diesel becomes turning wheels.')
      if (t < 8) return T('Корпус вскрывается: видны поршни, шатуны, коленвал, клапаны и распредвалы. Срезанные стенки подсвечены — это реальная толщина металла и каналы охлаждения.', 'The casing opens: pistons, rods, crankshaft, valves and camshafts appear. Cut walls are highlighted — real metal thickness and coolant passages.')
      if (t < 9.9) return T('Топливо начинает путь в баке. Насос подаёт его к двигателю по магистрали вдоль рамы.', 'Fuel starts in the tank. A pump sends it forward along the frame.')
      if (t < 11.8) return T(P ? 'Фильтр задерживает грязь, прежде чем топливо попадёт в насос высокого давления.' : 'Фильтр-водоотделитель убирает грязь и воду: вода разрушила бы прецизионные детали насоса.', P ? 'The filter catches dirt before the high-pressure pump.' : 'The filter / water separator removes dirt and water, which would destroy the precision pump parts.')
      if (t < 13.6) return T(P ? 'ТНВД на головке поднимает давление до ~200–350 бар (прибл.).' : 'ТНВД сжимает дизель до ~2000 бар (прибл.) — как вес легкового автомобиля на ногте.', P ? 'The cam-driven pump raises pressure to ~200–350 bar (approx.).' : 'The high-pressure pump squeezes diesel to ~2000 bar (approx.).')
      if (t < 15.3) return T('Рампа — общий аккумулятор давления для всех форсунок.', 'The rail stores pressure for all the injectors.')
      if (t < 17) return T('Форсунка открывается на доли миллисекунды — по команде блока управления, в момент, когда поршень у верхней точки.', 'The injector opens for a fraction of a millisecond, commanded by the ECU, just as the piston reaches the top.')
      if (t < 29) return strokeCaption(s, lv)
      if (t < 35) return T(P ? 'Twin-scroll турбина: выхлоп крутит турбину, по общему валу крутится компрессор и нагнетает воздух. Чем больше газ — тем выше обороты и наддув.' : 'Выхлоп крутит турбину, по общему валу крутится компрессор и нагнетает воздух. Лопатки VNT меняют угол потока, чтобы наддув был уже на низких оборотах.', P ? 'Twin-scroll turbo: exhaust spins the turbine, the shared shaft spins the compressor, which pushes air in. More throttle — more speed and boost.' : 'Exhaust spins the turbine; the shared shaft spins the compressor, which pushes air in. VNT vanes change the gas angle so boost arrives at low rpm.')
      if (t < 36.6) return T('Коленвал передаёт вращение на маховик — он сглаживает рывки между вспышками.', 'The crankshaft drives the flywheel, which smooths the pulses between firings.')
      if (t < 38.8) return T(`Коробка: на низкой передаче выход крутится медленнее, но момент больше (≈ ×${(lv.ratio ?? 1).toFixed(2)}). Схема упрощена — в автомате то же делают планетарные ряды.`, `Gearbox: a low gear turns the output slower but multiplies torque (≈ ×${(lv.ratio ?? 1).toFixed(2)}). Simplified — an automatic does this with planetary sets.`)
      if (t < 41) return T(P ? 'Карданный вал несёт вращение назад, к заднему мосту.' : 'Раздатка делит момент между мостами, карданы несут его вперёд и назад.', P ? 'The driveshaft carries rotation back to the rear axle.' : 'The transfer case splits torque; driveshafts carry it to both axles.')
      if (t < 43) return T('Дифференциал поворачивает вращение на 90° и делит его между колёсами. Колёса толкают машину.', 'The differential turns the drive 90° and splits it between the wheels. The wheels push the car.')
      return T('Разборка: каждая деталь на своём месте в цепочке «топливо → вращение колёс».', 'Exploded view: every part in its place along the chain from fuel to turning wheels.')
    },
  }

  /* ------------------------------ engine start track */
  const ev = P
    ? [0, 1.2, 2.4, 3.4, 4.4, 5.4, 6.4, 7.6, 8.8, 10.0, 11.2]
    : [0, 1.2, 2.4, 3.4, 4.4, 5.4, 6.4, 7.6, 8.8, 10.0, 11.2]
  const startNames: Txt[] = [T('АКБ', 'Battery'), T('Стартер', 'Starter'), T('Коленвал', 'Crankshaft'), T('Поршни', 'Pistons'), T('Распредвалы', 'Camshafts'), T('Клапаны', 'Valves'), T('Воздух', 'Air'), T('Топливо', 'Fuel'), T('Сгорание', 'Combustion'), T('Рабочий ход', 'Power stroke'), T('Разгон', 'Speeds up')]
  const start: Track = {
    id: 'start', title: T('Запуск двигателя', 'Engine start'), duration: 14,
    chapters: startNames.map((label, i) => ({ id: `s${i}`, label, t: ev[i] })),
    markers: [],
    ticks: startNames.map((label, i) => ({ t: ev[i], label })),
    camera: camPath([
      { t: 0, pos: [s.battery[0] + 0.5, s.battery[1] + 0.4, s.battery[2] + 0.9], target: s.battery },
      { t: 1.6, pos: [0.05, 0.05, 0.75], target: [-0.25, -0.06, -0.1], fly: 1.3 },
      { t: 2.9, pos: [0.25, 0.1, 0.7], target: [0.0, 0.02, 0], fly: 1.2 },
      { t: 3.9, pos: [0.35, d - 0.02, 0.55], target: [0.0, d - 0.07, 0], fly: 1.1 },
      { t: 4.9, pos: [0.25, d + 0.2, 0.42], target: [0.0, d + 0.07, 0.0], fly: 1.1 },
      { t: 6.0, pos: [c1 + 0.12, d + 0.07, 0.3], target: [c1, d + 0.03, 0.0], fly: 1.2 },
      { t: 7.0, pos: [c1 + 0.1, d + 0.06, 0.38], target: [c1, d + 0.02, 0.1], fly: 1.1 },
      { t: 8.2, pos: [c1 + 0.12, d + 0.1, 0.25], target: [c1, d, 0], fly: 1.1 },
      { t: 9.4, pos: [c1 + 0.09, d - 0.03, 0.22], target: [c1, d - 0.055, 0], fly: 1.1 },
      { t: 12.5, pos: [0.75, 0.6, 1.3], target: [0.0, 0.12, 0], fly: 2.2 },
    ]),
    state: (t) => {
      const crank = t >= 1.2
      const fired = t >= 8.8
      const rpm = !crank ? 0 : !fired ? 16 : Math.min(42, 16 + (t - 8.8) * 14)
      const step = ev.filter((e) => t >= e).length - 1
      const focus = [['battery'], ['starter', 'flywheel'], ['crank'], ['piston'], ['cams', 'chain'], ['valves'], ['intake'], ['injector', 'rail'], ['piston'], ['crank'], ['crank']][step] ?? []
      const lab = [['battery'], ['starter', 'flywheel'], ['crank'], ['piston', 'rod'], ['cams', 'chain'], ['valveIn', 'valveEx'], ['valveIn'], ['injector', 'rail'], ['piston', 'glow'], ['piston', 'crank'], ['crank']][step] ?? []
      return baseState({
        cut: 1, dim: 0.35, rpm, focus, labels: lab,
        flows: { electric: t < 9.4 ? 1 : 0, air: t >= 6.4 ? 1 : 0, fuel: t >= 7.6 ? 1 : 0, exhaust: t >= 8.8 ? 1 : 0, oil: t >= 2.4 ? 0.5 : 0 },
        extra: { starter: crank && t < 9.4 ? 1 : 0, glow: P ? 0 : (t > 0.2 && t < 9.6 ? 1 : 0), realRpm: !crank ? 0 : !fired ? 220 : Math.min(800, 220 + (t - 8.8) * 380), turboRpm: fired ? 0.3 : 0.05, macro: t > 8.2 && t < 12 ? 1 : 0, gear: 0, awd: 0 },
      })
    },
    caption: (t) => {
      const c: Txt[] = [
        T(P ? 'Нажали START. Аккумулятор в багажнике отдаёт сотни ампер на стартер.' : 'Нажали START. Свечи накала прогревают камеры, аккумулятор отдаёт сотни ампер на стартер.', P ? 'START pressed. The battery in the trunk feeds hundreds of amps to the starter.' : 'START pressed. Glow plugs heat the chambers; the battery feeds hundreds of amps to the starter.'),
        T('Шестерня стартера входит в зацепление с зубчатым венцом маховика.', 'The starter pinion engages the flywheel ring gear.'),
        T('Коленвал начинает вращаться — медленно, около 200 об/мин.', 'The crankshaft starts turning — slowly, about 200 rpm.'),
        T('Шатуны тянут и толкают поршни вверх-вниз.', 'Connecting rods pull and push the pistons up and down.'),
        T('Цепь ГРМ крутит распредвалы ровно вдвое медленнее коленвала.', 'The timing chain turns the camshafts at exactly half crank speed.'),
        T('Кулачки по очереди открывают впускные и выпускные клапаны.', 'Cam lobes open the intake and exhaust valves in turn.'),
        T('Поршни засасывают воздух через открытые впускные клапаны.', 'Pistons draw air in through the open intake valves.'),
        T(P ? 'Блок управления включает впрыск и зажигание.' : 'Давление в рампе выросло — блок управления открывает форсунки.', P ? 'The ECU starts injection and ignition.' : 'Rail pressure is up — the ECU opens the injectors.'),
        T(P ? 'Первая искра — первая вспышка в цилиндре.' : 'Первая вспышка: дизель воспламенился от тепла сжатия.', P ? 'First spark — first combustion.' : 'First combustion: diesel ignites from the heat of compression.'),
        T('Рабочий ход: двигатель начинает крутиться сам, стартер выходит из зацепления.', 'Power stroke: the engine runs on its own; the starter disengages.'),
        T('Обороты растут до холостого хода (~700–800 об/мин). Генератор подзаряжает аккумулятор.', 'Speed rises to idle (~700–800 rpm). The alternator recharges the battery.'),
      ]
      return c[Math.max(0, ev.filter((e) => t >= e).length - 1)]
    },
  }

  /* ------------------------------ cylinder close-up with locked crank (scrub = move the piston) */
  const D = 20
  const tOf = (phi: number) => (phi / (Math.PI * 4)) * D
  const cyl: Track = {
    id: 'cyl', title: T('Цилиндр крупно', 'Cylinder close-up'), duration: D,
    chapters: P
      ? [{ id: 'in', label: T('Впуск', 'Intake'), t: 0 }, { id: 'inj', label: T('Впрыск', 'Injection'), t: tOf(0.9) }, { id: 'comp', label: T('Сжатие', 'Compression'), t: 5 }, { id: 'spark', label: T('Искра', 'Spark'), t: tOf(2 * Math.PI - 0.32) }, { id: 'pow', label: T('Рабочий ход', 'Power'), t: 10 }, { id: 'ex', label: T('Выпуск', 'Exhaust'), t: 15 }]
      : [{ id: 'in', label: T('Впуск', 'Intake'), t: 0 }, { id: 'comp', label: T('Сжатие', 'Compression'), t: 5 }, { id: 'inj', label: T('Впрыск', 'Injection'), t: tOf(2 * Math.PI - 0.26) }, { id: 'pow', label: T('Сгорание · ход', 'Combustion · power'), t: 10 }, { id: 'ex', label: T('Выпуск', 'Exhaust'), t: 15 }],
    markers: [],
    camera: camPath([
      { t: 0, pos: [c1 + 0.1, d - 0.02, 0.24], target: [c1, d - 0.06, 0] },
      { t: 9, pos: [c1 + 0.06, d + 0.0, 0.2], target: [c1, d - 0.03, 0], fly: 4 },
      { t: 13, pos: [c1 + 0.11, d - 0.03, 0.26], target: [c1, d - 0.07, 0], fly: 3 },
      { t: 19, pos: [c1 + 0.12, d + 0.02, 0.24], target: [c1 - 0.02, d - 0.03, -0.04], fly: 4 },
    ]),
    state: (t) => baseState({
      cut: 1, dim: 0.45, rpm: 0, labels: ['valveIn', 'valveEx', 'piston', 'injector', 'glow'], focus: ['valves', 'piston', 'injector'],
      flows: { air: 1, exhaust: 1, fuel: 1 },
      extra: { _lock: 1, _crank: (t / D) * Math.PI * 4, macro: 1, realRpm: 0, turboRpm: 0.2, gear: 0 },
    }),
    caption: (_t, lv) => strokeCaption(s, lv),
  }

  /* ------------------------------ gearbox + wheels track */
  const gearTrack: Track = {
    id: 'gears', title: T('Коробка и колёса', 'Gearbox & wheels'), duration: 18,
    chapters: s.gears.map((_, i) => ({ id: `g${i}`, label: T(`${i + 1}-я`, `Gear ${i + 1}`), t: (i * 16) / s.gears.length })),
    markers: [],
    camera: camPath([
      { t: 0, pos: [-0.45, 0.22, 0.72], target: [-0.72, -0.02, 0] },
      { t: 9, pos: [-0.75, 0.3, 0.85], target: [-0.8, -0.02, 0], fly: 6 },
      { t: 15, pos: [s.rearAxleX + 0.9, 0.35, 1.8], target: [s.rearAxleX + 0.2, s.axleY, 0.4], fly: 4 },
    ]),
    state: (t) => baseState({
      cut: 1, dim: 0.55, rpm: 40, focus: ['gearbox', 'driveshaft', 'diff', 'wheel'], labels: t < 13 ? ['gearbox'] : ['gearbox', 'wheel', 'diff'],
      flows: { power: 1 },
      extra: { gear: Math.min(s.gears.length - 1, Math.floor((t / 16) * s.gears.length)), realRpm: 2000, turboRpm: 0.5, awd: 1 },
    }),
    caption: (_t, lv) => T(
      `Передача ${lv.gear}: вход 2000 об/мин → выход ≈ ${Math.round(2000 / (lv.ratio ?? 1))} об/мин. Передаточное число ≈ ${(lv.ratio ?? 1).toFixed(2)}: момент ≈ ×${(lv.ratio ?? 1).toFixed(2)} (иллюстративно).`,
      `Gear ${lv.gear}: input 2000 rpm → output ≈ ${Math.round(2000 / (lv.ratio ?? 1))} rpm. Ratio ≈ ${(lv.ratio ?? 1).toFixed(2)}: torque ≈ ×${(lv.ratio ?? 1).toFixed(2)} (illustrative).`),
  }

  void ALL_PARTS; void fuelPath; void airPath; void exhaustPath; void STROKE
  return {
    id: P ? 'petrol' : 'diesel',
    kicker: P ? T('BMW 530i · бензин', 'BMW 530i · petrol') : T('Toyota Fortuner · дизель', 'Toyota Fortuner · diesel'),
    title: P ? T('Бензиновый двигатель', 'Petrol engine explorer') : T('Дизельный двигатель', 'Diesel engine explorer'),
    subtitle: P ? T('Воздух + бензин + искра → вращение задних колёс', 'Air + fuel + spark → turning rear wheels') : T('Топливо → цилиндр → коленвал → коробка → колёса', 'Fuel → cylinder → crankshaft → gearbox → wheels'),
    note: T('Типовая конфигурация, геометрия схематична. Давления, обороты и передаточные числа — приблизительные или иллюстративные.', 'Representative configuration, schematic geometry. Pressures, speeds and ratios are approximate or illustrative.'),
    tracks: [main, start, cyl, gearTrack],
    labels,
    flows: [
      { id: 'fuel', label: T('Топливо', 'Fuel'), color: '#ff8a3d' },
      { id: 'air', label: T('Воздух', 'Air'), color: '#6cc6ff' },
      { id: 'exhaust', label: T('Выхлоп', 'Exhaust'), color: '#c49a8f' },
      { id: 'oil', label: T('Масло', 'Oil'), color: '#f2c94c' },
      { id: 'coolant', label: T('Антифриз', 'Coolant'), color: '#3ddc97' },
      { id: 'power', label: T('Мощность', 'Power'), color: '#ffd36b' },
      { id: 'electric', label: T('Ток', 'Electricity'), color: '#a98bff' },
    ],
    sky: ['#2a2f4a', '#6c6a8c', '#2b2738'],
  }
}

export type { SceneState }
