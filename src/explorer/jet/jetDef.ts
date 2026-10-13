import { baseState, camPath, window4, smooth, between, type ExplorerDef, type LabelDef, type Live, type Track } from '../core'
import { exploded } from '../materials'
import { T, type Txt } from '../i18n'
import { EX, ST, corePoint, CORE, xAtU } from './geometry'
import { coreSpeed } from './Turbofan'
import type { Vec3 } from '../../data/types'

/*
 * CFM56-5B-class turbofan, as on the A320. Representative configuration; numbers marked ≈ are approximate.
 * Axis along X, intake at +x. The section plane keeps z ≤ 0, so the camera sits on the +z side.
 */
const r0 = Math.round
const L = (id: string, p: Vec3, off: Vec3, title: Txt, sub?: (lv: Live) => Txt, dx = 50, dy = -50, delay = 0): LabelDef => ({ id, anchor: () => exploded(p, off, delay), title, sub, dx, dy })

const labels: LabelDef[] = [
  L('inlet', [1.98, 0.98, 0.02], EX.inlet, T('Воздухозаборник', 'Inlet'), () => T('ровно подводит воздух к вентилятору', 'delivers smooth air to the fan'), 40, -60),
  L('spinner', [1.35, 0.18, 0.05], EX.fan, T('Кок', 'Spinner'), () => T('спираль — видно вращение', 'the spiral shows rotation'), 60, 40),
  L('fan', [1.0, 0.62, 0.02], EX.fan, T('Вентилятор', 'Fan'), (lv) => T(`N1 ≈ ${lv.n1 ?? 0}% · ${(lv.n1rpm ?? 0).toLocaleString('ru-RU')} об/мин`, `N1 ≈ ${lv.n1 ?? 0}% · ${(lv.n1rpm ?? 0).toLocaleString('en-US')} rpm`), 60, -70),
  L('ogv', [0.42, 0.74, 0.02], EX.fanCase, T('Спрямляющий аппарат', 'Outlet guide vanes'), () => T('убирает закрутку потока', 'removes the swirl'), 50, -40),
  L('bypassDuct', [-0.4, 0.82, 0.02], EX.nacelle, T('Наружный контур', 'Bypass duct'), () => T('≈ 80 % тяги, m ≈ 5,5–6', '≈ 80 % of thrust, BPR ≈ 5.5–6'), 40, -60),
  L('booster', [0.6, 0.42, 0.02], EX.booster, T('Подпорные ступени (КНД)', 'Booster (LPC)'), () => T('на валу вентилятора', 'on the fan shaft'), -60, 50),
  L('hpc', [-0.05, 0.3, 0.02], EX.hpc, T('Компрессор высокого давления', 'High-pressure compressor'), (lv) => T(`9 ступеней · N2 ≈ ${lv.n2 ?? 0}%`, `9 stages · N2 ≈ ${lv.n2 ?? 0}%`), -40, 70),
  L('combustor', [-0.75, 0.33, 0.02], EX.comb, T('Камера сгорания', 'Combustor'), (lv) => T(`кольцевая · EGT ≈ ${lv.egt ?? 0} °C`, `annular · EGT ≈ ${lv.egt ?? 0} °C`), 40, -80),
  L('nozzles', [-0.53, 0.47, 0.02], EX.comb, T('Топливные форсунки', 'Fuel nozzles'), (lv) => T(`20 шт · ${lv.ff ?? 0} кг/ч`, `20 off · ${lv.ff ?? 0} kg/h`), 70, -40),
  L('igniter', [-0.64, -0.36, 0.06], EX.comb, T('Свеча зажигания', 'Igniter'), () => T('работает при запуске', 'used during start'), 60, 50),
  L('hpt', [-1.04, 0.31, 0.02], EX.hpt, T('Турбина ВД', 'HP turbine'), () => T('1 ступень, крутит КВД', '1 stage, drives the HPC'), -40, -80),
  L('lpt', [-1.35, 0.42, 0.02], EX.lpt, T('Турбина НД', 'LP turbine'), () => T('4 ступени, крутит вентилятор', '4 stages, drive the fan'), 40, -70),
  L('lpShaft', [-1.3, 0.05, 0.02], EX.none, T('Вал НД (внутренний)', 'LP shaft (inner)'), () => T('вентилятор ↔ ТНД', 'fan ↔ LPT'), 50, 60),
  L('hpShaft', [-0.45, 0.1, 0.02], EX.hpc, T('Вал ВД (наружный)', 'HP shaft (outer)'), () => T('КВД ↔ ТВД', 'HPC ↔ HPT'), -40, 60),
  L('exhaust', [-2.1, 0.16, 0.02], EX.exhaust, T('Реактивное сопло', 'Exhaust nozzle'), (lv) => T(`тяга ≈ ${lv.thrust ?? 0} кН`, `thrust ≈ ${lv.thrust ?? 0} kN`), 40, 60),
  L('pylon', [-1.2, 1.35, 0.02], EX.pylon, T('Пилон', 'Pylon'), () => T('крепит двигатель к крылу', 'hangs the engine on the wing'), 40, -40),
  L('wing', [-1.0, 1.7, 0.8], EX.wing, T('Крыло A320', 'A320 wing'), undefined, 50, -40),
  L('agb', [0.72, -1.0, -0.33], EX.fanCase, T('Коробка приводов', 'Accessory gearbox'), () => T('генератор, насосы, стартер', 'generator, pumps, starter'), 50, 40),
  L('starter', [0.42, -1.04, -0.36], EX.fanCase, T('Воздушный стартер', 'Air starter'), () => T('воздух от APU', 'air from the APU'), -60, 40),
]
// stations for "follow the air": values are representative take-off figures, approximate
const STATIONS: { id: string; x: number; title: Txt; sub: Txt }[] = [
  { id: 'st0', x: 2.2, title: T('Вход', 'Intake'), sub: T('≈ 1 бар · 15 °C', '≈ 1 bar · 15 °C') },
  { id: 'st1', x: 0.95, title: T('За вентилятором', 'After the fan'), sub: T('≈ 1,6 бар · 60 °C', '≈ 1.6 bar · 60 °C') },
  { id: 'st2', x: 0.45, title: T('За подпорными ступенями', 'After the booster'), sub: T('≈ 2,5 бар · 110 °C', '≈ 2.5 bar · 110 °C') },
  { id: 'st3', x: -0.45, title: T('Выход КВД', 'HPC exit'), sub: T('≈ 30 бар · 550 °C', '≈ 30 bar · 550 °C') },
  { id: 'st4', x: -0.8, title: T('Камера сгорания', 'Combustor'), sub: T('факел ≈ 2000 °C, на выходе ≈ 1400 °C', 'flame ≈ 2000 °C, exit ≈ 1400 °C') },
  { id: 'st5', x: -1.1, title: T('За турбиной ВД', 'After the HPT'), sub: T('≈ 7 бар · 950 °C', '≈ 7 bar · 950 °C') },
  { id: 'st6', x: -1.6, title: T('За турбиной НД', 'After the LPT'), sub: T('≈ 1,5 бар · 600 °C', '≈ 1.5 bar · 600 °C') },
  { id: 'st7', x: -2.3, title: T('Сопло', 'Nozzle'), sub: T('струя ≈ 400 м/с', 'jet ≈ 400 m/s') },
]
STATIONS.forEach((st) => labels.push({ id: st.id, anchor: () => { const p = corePoint(st.x); return [p[0], p[1] + 0.02, 0.03] }, title: st.title, sub: () => st.sub, dx: st.x > 0 ? 60 : -60, dy: -70 }))

/* ------------------------------------------------------------------ main documentary track */
const main: Track = {
  id: 'main', title: T('Как работает', 'How it works'), duration: 46,
  chapters: [
    { id: 'wing', label: T('На крыле', 'On the wing'), t: 0 },
    { id: 'suck', label: T('Всасывание', 'Suck'), t: 8 },
    { id: 'squeeze', label: T('Сжатие', 'Squeeze'), t: 16 },
    { id: 'bang', label: T('Сгорание', 'Bang'), t: 24 },
    { id: 'blow', label: T('Выхлоп', 'Blow'), t: 31 },
    { id: 'exp', label: T('Разборка', 'Exploded'), t: 38 },
  ],
  markers: [{ label: T('Крыло', 'Wing'), t: 0 }, { label: T('Разрез', 'Cutaway'), t: 4 }, { label: T('Поток', 'Flow'), t: 8 }, { label: T('Разборка', 'Exploded'), t: 38 }],
  camera: camPath([
    { t: 0, pos: [5.4, 0.2, 5.2], target: [0, 0.5, 0] },
    { t: 4.5, pos: [0.6, 0.9, 5.4], target: [-0.1, 0.25, 0], fly: 3.2 },
    { t: 8.5, pos: [3.2, 0.5, 2.6], target: [1.0, 0.25, 0], fly: 2.4 },
    { t: 15, pos: [2.4, 0.3, 1.9], target: [0.8, 0.3, 0], fly: 5 },
    { t: 17, pos: [0.6, 0.45, 1.5], target: [0.1, 0.28, 0], fly: 1.8 },
    { t: 23, pos: [0.2, 0.3, 1.25], target: [-0.1, 0.27, 0], fly: 5 },
    { t: 25, pos: [-0.35, 0.6, 1.75], target: [-0.75, 0.3, 0], fly: 1.8 },
    { t: 30, pos: [-0.55, 0.5, 1.6], target: [-0.8, 0.28, 0], fly: 4.5 },
    { t: 32.2, pos: [-1.0, 0.5, 1.6], target: [-1.35, 0.25, 0], fly: 2 },
    { t: 37, pos: [-1.9, 0.4, 2.3], target: [-1.9, 0.2, 0], fly: 4 },
    { t: 41, pos: [0.6, 2.4, 8.6], target: [0, 0.4, 0], fly: 3.4 },
    { t: 46, pos: [1.6, 2.0, 8.0], target: [0, 0.4, 0], fly: 5 },
  ]),
  state: (t) => {
    const flowW = window4(t, 8, 9, 37.5, 38.5)
    const focus: string[] = []
    if (between(t, 8, 16)) focus.push('fan', 'spinner')
    if (between(t, 16, 24)) focus.push('booster', 'hpc')
    if (between(t, 24, 31)) focus.push('combustor', 'nozzles')
    if (between(t, 31, 38)) focus.push('hpt', 'lpt', 'lpShaft', 'exhaust')
    const labels =
      t < 4 ? ['wing', 'pylon', 'inlet'] :
      t < 8 ? ['fan', 'booster', 'hpc', 'combustor', 'hpt', 'lpt', 'exhaust'] :
      t < 16 ? ['fan', 'spinner', 'ogv', 'bypassDuct'] :
      t < 24 ? ['booster', 'hpc', 'hpShaft'] :
      t < 31 ? ['combustor', 'nozzles', 'igniter'] :
      t < 38 ? ['hpt', 'lpt', 'lpShaft', 'exhaust'] :
      ['fan', 'booster', 'hpc', 'combustor', 'hpt', 'lpt', 'exhaust', 'pylon', 'wing']
    return baseState({
      cut: smooth((t - 4) / 2.6), dim: flowW * 0.45, explode: smooth((t - 38.6) / 2.6),
      flows: { core: flowW, bypass: flowW * (t < 16 || t > 31 ? 1 : 0.4), fuel: window4(t, 23, 24, 31, 32) },
      focus, labels, extra: { seq: 0, vis: 1 },
    })
  },
  caption: (t, lv) => {
    if (t < 4) return T('Двигатель CFM56 класса под крылом A320. Снаружи — гондола: внутри два вала, пять модулей и два потока воздуха.', 'A CFM56-class engine under an A320 wing. Outside it is just a nacelle: inside are two spools, five modules and two air streams.')
    if (t < 8) return T('Разрез показывает весь путь воздуха: вентилятор → компрессоры → камера сгорания → турбины → сопло. Срезанные стенки подсвечены оранжевым.', 'The cut shows the whole air path: fan → compressors → combustor → turbines → nozzle. Cut walls glow orange.')
    if (t < 16) return T(`ВСАСЫВАНИЕ. Вентилятор Ø ≈ 1,7 м (N1 ≈ ${lv.n1 ?? 0}%) затягивает сотни килограммов воздуха в секунду. Большая часть идёт в обход ядра по наружному контуру — этот поток и даёт ≈ 80 % тяги.`, `SUCK. The ≈ 1.7 m fan (N1 ≈ ${lv.n1 ?? 0}%) draws in hundreds of kilograms of air per second. Most of it bypasses the core through the outer duct — that stream makes ≈ 80 % of the thrust.`)
    if (t < 24) return T('СЖАТИЕ. Внутренний поток проходит подпорные ступени и 9 ступеней КВД: лопатки всё короче, давление растёт ≈ в 30 раз, воздух нагревается до ≈ 550 °C только от сжатия.', 'SQUEEZE. The core stream passes the booster and 9 HPC stages: blades get shorter, pressure rises ≈ 30×, and the air heats to ≈ 550 °C from compression alone.')
    if (t < 31) return T(`СГОРАНИЕ. 20 форсунок впрыскивают керосин (${lv.ff ?? 0} кг/ч) в кольцевую камеру. Факел ≈ 2000 °C, на входе в турбину ≈ 1400 °C — выше температуры плавления лопаток, их охлаждает воздух из компрессора.`, `BANG. 20 nozzles spray kerosene (${lv.ff ?? 0} kg/h) into the annular combustor. The flame is ≈ 2000 °C and turbine entry ≈ 1400 °C — above the blades' melting point; compressor air cools them.`)
    if (t < 38) return T('ВЫХЛОП. Горячий газ крутит турбину ВД (она через наружный вал вращает компрессор) и 4 ступени турбины НД (через внутренний вал — вентилятор). Остаток энергии разгоняет струю в сопле.', 'BLOW. Hot gas spins the HP turbine (driving the compressor through the outer shaft) and 4 LP turbine stages (driving the fan through the inner shaft). What is left accelerates the jet in the nozzle.')
    return T('Разборка по модулям: вход, вентилятор, подпорные ступени, КВД, камера сгорания, ТВД, ТНД, сопло. Двигатель так и обслуживают — модулями.', 'Exploded into modules: inlet, fan, booster, HPC, combustor, HPT, LPT, nozzle. Engines are maintained exactly like this — module by module.')
  },
}

/* ------------------------------------------------------------------ engine start */
const ev = [0, 1.2, 2.8, 4.5, 6, 6.5, 7.5, 9, 12]
const startNames = [T('APU · отбор воздуха', 'APU bleed air'), T('Клапан стартера', 'Starter valve'), T('N2 растёт', 'N2 rising'), T('N1 вращается', 'N1 turning'), T('Топливо', 'Fuel on'), T('Зажигание', 'Ignition'), T('Розжиг', 'Light-off'), T('Стартер выкл.', 'Starter cut-out'), T('Малый газ', 'Idle')]
const start: Track = {
  id: 'start', title: T('Запуск двигателя', 'Engine start'), duration: 14,
  chapters: startNames.map((label, i) => ({ id: `s${i}`, label, t: ev[i] })), markers: [],
  ticks: startNames.map((label, i) => ({ t: ev[i], label })),
  camera: camPath([
    { t: 0, pos: [1.6, -1.6, 2.6], target: [0.6, -0.9, -0.2] },
    { t: 2.6, pos: [0.4, 0.5, 1.9], target: [-0.1, 0.25, 0], fly: 1.6 },
    { t: 4.4, pos: [3.4, 0.5, 2.4], target: [1.0, 0.2, 0], fly: 1.5 },
    { t: 6.2, pos: [-0.45, 0.45, 1.2], target: [-0.75, 0.3, 0], fly: 1.6 },
    { t: 9.5, pos: [-0.5, 0.4, 1.3], target: [-0.75, 0.28, 0], fly: 2 },
    { t: 12.5, pos: [0.6, 1.0, 5.0], target: [-0.2, 0.2, 0], fly: 2.4 },
  ]),
  state: (t) => {
    const step = ev.filter((e) => t >= e).length - 1
    const focus = [['starter', 'agb'], ['starter', 'agb'], ['hpc', 'hpShaft'], ['fan'], ['nozzles'], ['igniter'], ['combustor'], ['starter'], ['fan', 'hpc']][step] ?? []
    const lab = [['starter', 'agb'], ['starter', 'agb'], ['hpc', 'hpShaft'], ['fan', 'lpShaft'], ['nozzles'], ['igniter', 'nozzles'], ['combustor'], ['starter', 'combustor'], ['fan', 'hpc', 'combustor']][step] ?? []
    return baseState({ cut: 1, dim: 0.3, focus, labels: lab, flows: { air: t < 9 ? 1 : 0, core: 1, bypass: 1, fuel: t >= 6 ? 1 : 0 }, extra: { seq: 1, vis: 1 } })
  },
  caption: (t) => {
    const c: Txt[] = [
      T('Вспомогательная силовая установка (APU) в хвосте даёт сжатый воздух. Он идёт по трубам в двигатель.', 'The APU in the tail supplies compressed air, piped to the engine.'),
      T('Открывается клапан: воздух крутит турбинку воздушного стартера на коробке приводов.', 'A valve opens: the air spins the air starter turbine on the gearbox.'),
      T('Через коробку и вертикальный вал стартер раскручивает ротор высокого давления (N2).', 'Through the gearbox and a radial shaft the starter spins the high-pressure rotor (N2).'),
      T('Поток от КВД начинает крутить турбину НД — вентилятор (N1) трогается позже и медленнее.', 'Flow from the HPC starts turning the LP turbine — the fan (N1) moves later and slower.'),
      T('На ≈ 22–25 % N2 компьютер (FADEC) открывает подачу топлива к 20 форсункам.', 'At ≈ 22–25 % N2 the FADEC opens fuel to the 20 nozzles.'),
      T('Свечи зажигания дают искру в камере сгорания.', 'The igniters spark in the combustor.'),
      T('Розжиг: пламя охватывает кольцевую камеру, EGT резко растёт — экипаж следит, чтобы не было перегрева.', 'Light-off: flame fills the annular combustor and EGT climbs fast — the crew watches for over-temperature.'),
      T('На ≈ 50 % N2 турбина уже сама крутит компрессор — стартер отключается.', 'At ≈ 50 % N2 the turbine drives the compressor itself — the starter cuts out.'),
      T('Двигатель на малом газе: N2 ≈ 59 %, N1 ≈ 20 %, EGT стабилизировалась.', 'The engine is at idle: N2 ≈ 59 %, N1 ≈ 20 %, EGT has settled.'),
    ]
    return c[Math.max(0, ev.filter((e) => t >= e).length - 1)]
  },
}

/* ------------------------------------------------------------------ follow the air */
// position of one air parcel along the core path: the parcel slows in the compressor and races through the nozzle
const FOLLOW_T = 16
const fxTable = (() => {
  const xs: number[] = [], N = 400
  let x = 3.0, t = 0
  const dt = FOLLOW_T / N
  for (let i = 0; i <= N; i++) { xs.push(x); x -= dt * 0.33 * coreSpeed(x); t += dt }
  return xs
})()
const fxAt = (t: number) => fxTable[Math.max(0, Math.min(fxTable.length - 1, Math.round((t / FOLLOW_T) * (fxTable.length - 1))))]
const follow: Track = {
  id: 'follow', title: T('Следуй за воздухом', 'Follow the air'), duration: FOLLOW_T,
  chapters: STATIONS.map((st) => ({ id: st.id, label: st.title, t: Math.max(0, fxTable.findIndex((x) => x < st.x) / (fxTable.length - 1) * FOLLOW_T) })), markers: [],
  camera: (t) => {
    const x = fxAt(t), p = corePoint(x)
    return { pos: [x + 0.55, p[1] + 0.22, 0.95], target: [x - 0.15, p[1], 0] }
  },
  state: (t) => {
    const x = fxAt(t)
    const near = STATIONS.filter((st) => Math.abs(st.x - x) < 0.35).map((st) => st.id)
    return baseState({ cut: 1, dim: 0.5, labels: near, flows: { core: 0.6, bypass: 0.4 }, extra: { seq: 0, vis: 0.6, hero: 1, fx: x } })
  },
  caption: (t) => {
    const x = fxAt(t)
    const st = [...STATIONS].reverse().find((s) => x <= s.x + 0.05) ?? STATIONS[0]
    return T(`${st.title.ru}: ${st.sub.ru}. Скорость частицы меняется: в компрессоре её «зажимает», в турбине и сопле она разгоняется.`, `${st.title.en}: ${st.sub.en}. The parcel's speed changes: squeezed in the compressor, accelerating through the turbine and nozzle.`)
  },
}
void CORE; void xAtU; void ST

export const JET_DEF: ExplorerDef = {
  id: 'jet', kicker: T('A320 · CFM56-5B, типовая конфигурация', 'A320 · CFM56-5B class, representative'),
  title: T('Турбовентиляторный двигатель', 'Turbofan engine'), subtitle: T('Всасывание → сжатие → сгорание → выхлоп', 'Suck → squeeze → bang → blow'),
  note: T('Геометрия схематична, давления и температуры — представительные значения на взлётном режиме, приблизительно.', 'Schematic geometry; pressures and temperatures are representative take-off values, approximate.'),
  tracks: [main, start, follow], labels,
  flows: [
    { id: 'bypass', label: T('Наружный поток', 'Bypass air'), color: '#7cc8ff' },
    { id: 'core', label: T('Внутренний поток', 'Core flow'), color: '#ff9a3a' },
    { id: 'fuel', label: T('Топливо', 'Fuel'), color: '#ff8a3d' },
    { id: 'air', label: T('Воздух стартера', 'Starter air'), color: '#c7e3ff' },
  ],
  sky: ['#0f1115', '#2a2d33', '#16181c'], ao: 0.18,
}
