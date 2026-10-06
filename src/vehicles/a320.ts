import type { ComponentDef, FlowDef, LearnStep, VehicleDef, WalkZone, Vec3 } from '../data/types'
import { AX } from '../models/aircraftLayout'

/*
 * Representative Airbus A320ceo with CFM56-5B engines. The A320 family also flies with IAE V2500 (ceo)
 * and LEAP-1A / PW1100G (neo); tank and system details differ between variants and operators.
 */
const E = AX.engineZ
const mir = (pts: Vec3[]): Vec3[] => pts.map(([x, y, z]) => [x, y, -z])
const both = (id: string, kind: FlowDef['kind'], label: string, pts: Vec3[], extra: Partial<FlowDef> = {}): FlowDef[] => [
  { id: `${id}-L`, kind, label: `${label} (левый)`, points: pts, ...extra },
  { id: `${id}-R`, kind, label: `${label} (правый)`, points: mir(pts), ...extra },
]

const flows: FlowDef[] = [
  // FUEL
  ...both('fuel-ctr', 'fuel', 'Центральный бак → двигатель', [[1.0, 2.0, 0.6], [1.4, 2.25, 1.8], [1.7, 2.35, 4.0], [2.0, 2.3, E - 0.2], [2.3, 2.15, E]], { speed: 1.2, density: 6 }),
  ...both('fuel-inner', 'fuel', 'Внутренний бак → двигатель', [[0.9, 2.2, 3.0], [1.4, 2.32, 4.6], [2.3, 2.15, E]], { speed: 1.2, density: 6 }),
  ...both('fuel-outer', 'fuel', 'Внешний бак → внутренний', [[-2.2, 3.05, 13.0], [-1.0, 2.8, 10.5], [-0.2, 2.6, 8.4]], { speed: 0.6, density: 4 }),
  ...both('fuel-eng', 'fuel', 'Пилон → камера сгорания', [[2.3, 2.15, E], [2.1, 1.9, E], [1.6, 1.5, E], [0.9, 1.45, E]], { speed: 1.6, density: 8 }),
  { id: 'fuel-apu', kind: 'fuel', label: 'Питание ВСУ', points: [[-0.8, 1.8, 0.4], [-6, 2.0, 0.5], [-12, 2.8, 0.4], [-16.9, 4.5, 0]], speed: 0.8, density: 3 },
  // AIR (bleed, packs, cabin, outflow)
  ...both('air-inlet', 'air', 'Воздух в двигатель', [[9.0, AX.engineY, E], [5.8, AX.engineY, E], [3.9, AX.engineY, E]], { speed: 2.2, density: 5 }),
  ...both('bleed', 'air', 'Отбор от компрессора → кондиционер', [[1.4, 1.55, E], [1.8, 2.3, E], [2.2, 2.4, 3.2], [1.8, 1.9, 1.4], [1.2, 1.5, 0.7]], { speed: 1.2, density: 6 }),
  { id: 'air-mixer', kind: 'air', label: 'Кондиционеры → смеситель', points: [[1.2, 1.5, 0.65], [2.6, 1.8, 0.3], [4.2, 2.15, 0]], speed: 1.0, density: 6 },
  { id: 'air-riser', kind: 'air', label: 'Подъём в салон', points: [[4.2, 2.3, 0], [4.2, 2.6, 1.4], [4.2, 4.0, 1.75], [4.2, 4.85, 0.6]], speed: 1.0, density: 6 },
  { id: 'air-dist-fwd', kind: 'air', label: 'Раздача вперёд', points: [[4.2, 4.85, 0.6], [9, 4.85, 0.6], [15.5, 4.2, 0.3]], speed: 0.9, density: 4 },
  { id: 'air-dist-aft', kind: 'air', label: 'Раздача назад', points: [[4.2, 4.85, -0.6], [-4, 4.85, -0.6], [-10.5, 4.8, -0.6]], speed: 0.9, density: 4 },
  { id: 'air-cabin', kind: 'air', label: 'Воздух в салоне → к полу', points: [[2, 4.7, 1.2], [1.0, 3.6, 1.7], [0.0, 2.85, 1.75], [-3, 2.4, 1.6], [-9, 2.4, 1.4], [-12.0, 2.35, -0.6], [-12.4, 2.25, -1.62], [-13.4, 2.2, -2.8]], speed: 0.8, density: 4 },
  { id: 'air-apu', kind: 'air', label: 'Отбор от ВСУ', points: [[-17.0, 4.6, 0], [-12, 3.0, 0.3], [-4, 1.9, 0.3], [0.6, 1.5, 0.3]], speed: 1.0, density: 4 },
  ...both('anti-ice', 'air', 'Обогрев предкрылков', [[1.8, 2.35, E + 0.3], [0.3, 2.65, 8.5], [-1.8, 2.95, 12.4], [-3.6, 3.2, 15.8]], { speed: 0.8, density: 4 }),
  // JET / EXHAUST
  ...both('jet', 'exhaust', 'Реактивная струя', [[-0.4, AX.engineY, E], [-4, AX.engineY - 0.05, E], [-10, AX.engineY - 0.1, E]], { speed: 3.0, density: 6 }),
  { id: 'apu-exh', kind: 'exhaust', label: 'Выхлоп ВСУ', points: [[-18.4, 4.75, 0], [-20.5, 4.8, 0], [-23, 4.85, 0]], speed: 1.6, density: 6 },
  // HYDRAULICS (Green = engine 1, Yellow = engine 2, Blue = electric pump / RAT)
  { id: 'hyd-green', kind: 'hydraulic', label: 'GREEN: насос двигателя 1 → резервуар', points: [[1.6, 0.65, E], [1.4, 2.0, E], [0.4, 2.3, 3.5], [-1.8, 1.9, 1.4], [-2.6, 1.85, 0.75]], speed: 1.2, density: 6 },
  { id: 'hyd-green-gear', kind: 'hydraulic', label: 'GREEN → шасси и тормоза', points: [[-2.6, 1.85, 0.75], [-1.8, 1.9, 2.8], [-1.64, 1.2, 3.6], [-1.64, 0.6, 3.8]], speed: 1.2, density: 6 },
  { id: 'hyd-green-nose', kind: 'hydraulic', label: 'GREEN → передняя стойка', points: [[-2.6, 1.85, 0.75], [3, 1.4, 0.4], [10.8, 1.5, 0.15]], speed: 1.2, density: 4 },
  { id: 'hyd-green-wing', kind: 'hydraulic', label: 'GREEN → рули', points: [[-2.6, 1.85, 0.75], [-1.9, 2.4, 4.0], [-2.6, 2.75, 9.5], [-3.6, 3.0, 14.0]], speed: 1.2, density: 4 },
  { id: 'hyd-yellow', kind: 'hydraulic', label: 'YELLOW: насос двигателя 2 → резервуар', points: mir([[1.6, 0.65, E], [1.4, 2.0, E], [0.4, 2.3, 3.5], [-1.8, 1.9, 1.4], [-2.6, 1.85, 0.75]]), speed: 1.2, density: 6 },
  { id: 'hyd-yellow-wing', kind: 'hydraulic', label: 'YELLOW → рули и закрылки', points: mir([[-2.6, 1.85, 0.75], [-1.9, 2.4, 4.0], [-2.6, 2.75, 9.5], [-3.6, 3.0, 14.0]]), speed: 1.2, density: 4 },
  { id: 'hyd-yellow-tail', kind: 'hydraulic', label: 'YELLOW → хвост', points: [[-2.6, 1.85, -0.75], [-9, 2.3, -0.5], [-14.5, 4.4, -0.4], [-15.6, 4.8, -2.5]], speed: 1.2, density: 4 },
  { id: 'hyd-blue', kind: 'hydraulic', label: 'BLUE: электронасос → рули', points: [[-3.3, 1.85, 0.75], [-1.0, 2.2, 2.0], [1.0, 2.55, 6.5], [-1.0, 2.9, 11.0]], speed: 1.2, density: 4 },
  { id: 'hyd-blue-tail', kind: 'hydraulic', label: 'BLUE → руль направления', points: [[-3.3, 1.85, 0.75], [-10, 2.6, 0.4], [-14.5, 6.5, 0], [-15.6, 8.5, 0]], speed: 1.2, density: 4 },
  { id: 'hyd-ptu', kind: 'hydraulic', label: 'PTU: Green ↔ Yellow', points: [[-2.6, 1.7, 0.6], [-2.6, 1.7, 0], [-2.6, 1.7, -0.6]], speed: 0.8, density: 10 },
  // ELECTRICAL
  ...both('elec-idg', 'electric', 'Генератор IDG → шины', [[2.9, 0.65, E], [2.4, 2.2, E], [1.8, 2.2, 1.8], [6, 2.2, 0.5], [12.4, 2.15, 0.3]], { speed: 2.4, density: 4 }),
  { id: 'elec-apu', kind: 'electric', label: 'Генератор ВСУ → шины', points: [[-17.2, 4.5, 0], [-10, 2.7, -0.5], [4, 2.2, -0.5], [12.4, 2.15, -0.3]], speed: 2.4, density: 3 },
  { id: 'elec-cabin', kind: 'electric', label: 'Шины → салон', points: [[13.0, 2.4, 0], [12.4, 4.85, -0.7], [0, 4.85, -0.7], [-10.5, 4.85, -0.7]], speed: 2.4, density: 3 },
  { id: 'elec-cockpit', kind: 'electric', label: 'Шины → кабина', points: [[14.0, 2.4, 0], [15.6, 3.0, 0], [16.9, 3.6, 0]], speed: 2.4, density: 8 },
  { id: 'elec-galley', kind: 'electric', label: 'Шины → кухня', points: [[13.0, 2.4, -0.4], [13.0, 3.3, -0.95]], speed: 2.4, density: 10 },
  // FLIGHT CONTROLS (signals)
  { id: 'sig-stick', kind: 'signal', label: 'Сайдстик → компьютеры', points: [[16.1, 3.45, 1.05], [15.0, 2.8, 0.8], [13.6, 2.4, 0.45]], speed: 2.4, density: 10 },
  ...both('sig-wing', 'signal', 'Компьютеры → элероны/интерцепторы', [[13.0, 2.3, 0.3], [2.0, 2.3, 1.4], [-1.6, 2.55, 6.5], [-3.4, 2.9, 13.5]], { speed: 2.6, density: 3 }),
  { id: 'sig-tail', kind: 'signal', label: 'Компьютеры → руль высоты/направления', points: [[13.0, 2.3, 0], [0, 2.4, 0], [-12, 3.6, 0], [-15.6, 4.8, 2.6]], speed: 2.6, density: 3 },
  { id: 'sig-rudder', kind: 'signal', label: 'Компьютеры → руль направления', points: [[-12, 3.6, 0], [-14.8, 6.0, 0], [-15.9, 8.4, 0]], speed: 2.6, density: 4 },
]

const C = (c: ComponentDef) => c
const at = (x: number, y: number, z: number, d = 9): ComponentDef['shot'] => ({ pos: [x + d * 0.8, y + d * 0.45, z + d * 1.1], target: [x, y, z] })

const components: ComponentDef[] = [
  // COCKPIT
  C({ id: 'cockpit', name: 'Cockpit', ru: 'Кабина экипажа', system: 'cockpit', pos: [16.6, 4.1, 0], hotspot: true, flows: ['electric', 'signal'],
    beginner: 'Двое пилотов, экраны и боковые ручки управления вместо штурвала.', engineer: 'Стеклянная кабина: шесть основных дисплеев (PFD, ND, ECAM). Управление по проводам (fly-by-wire), ручки — sidesticks.', keywords: ['cockpit', 'кабина', 'пилоты'], shot: { pos: [14.7, 4.05, 0.0], target: [18, 3.55, 0], via: [24, 6, 6] } }),
  C({ id: 'sidestick', name: 'Sidestick', ru: 'Боковая ручка', system: 'flightControls', pos: [16.1, 3.6, 1.05], flows: ['signal'], path: ['sig-stick', 'sig-wing-L', 'sig-wing-R', 'sig-tail'], action: 'pitchUp',
    beginner: 'Пилот двигает ручку, а компьютеры решают, как отклонить рули, чтобы самолёт сделал то, что просили.', engineer: 'Ручка задаёт перегрузку по тангажу и скорость крена; в нормальном законе есть защиты от выхода за безопасные углы атаки, крена и перегрузки.', keywords: ['sidestick', 'ручка', 'fly-by-wire', 'управление'], shot: { pos: [15.3, 3.85, 0.4], target: [16.2, 3.4, 1.05], via: [24, 6, 6] } }),
  C({ id: 'flightComputers', name: 'Flight control computers', ru: 'Компьютеры управления', system: 'flightControls', pos: [13.4, 2.5, 0.45], flows: ['signal', 'electric'], path: ['sig-stick', 'sig-wing-L', 'sig-wing-R', 'sig-tail', 'sig-rudder'],
    beginner: 'Здесь сигнал от ручки превращается в команды приводам рулей.', engineer: 'Семь компьютеров: 2 ELAC, 3 SEC, 2 FAC — с перекрёстным резервированием и разными поставщиками ПО.', keywords: ['elac', 'sec', 'fac', 'computer', 'fly by wire'], shot: { pos: [11.0, 2.6, 2.6], target: [13.4, 2.2, 0.3] } }),
  C({ id: 'displays', name: 'ECAM displays', ru: 'Экраны ECAM', system: 'cockpit', pos: [16.9, 3.85, 0], flows: ['electric'], path: ['elec-cockpit'],
    beginner: 'Экраны показывают скорость, высоту, курс и состояние всех систем.', engineer: 'ECAM выводит синоптику систем (топливо, гидравлика, электрика, отбор воздуха) и процедуры при отказах.', keywords: ['ecam', 'pfd', 'nd', 'screens', 'экраны'], shot: { pos: [15.0, 3.95, 0.1], target: [16.9, 3.6, 0], via: [24, 6, 6] } }),
  // CABIN
  C({ id: 'cabin', name: 'Passenger cabin', ru: 'Пассажирский салон', system: 'cabin', pos: [2, 4.3, 0], hotspot: true, flows: ['air'], path: ['air-riser', 'air-dist-fwd', 'air-dist-aft', 'air-cabin'],
    beginner: 'Обычно 150–180 кресел по схеме 3+3. Воздух подаётся сверху и уходит у пола.', engineer: 'Узкий фюзеляж ~3,95 м; компоновка зависит от авиакомпании. Воздухообмен — каждые несколько минут, часть воздуха рециркулирует через фильтры HEPA.', varies: 'Число кресел и кухонь зависит от авиакомпании.', keywords: ['cabin', 'салон', 'seats', 'кресла'], shot: { pos: [11.0, 4.25, 0.0], target: [0, 3.5, 0] } }),
  C({ id: 'galley', name: 'Galley', ru: 'Кухня', system: 'cabin', pos: [-11.8, 3.9, 0], flows: ['electric'], path: ['elec-galley'],
    beginner: 'Кухни в носу и хвосте: печи, кофеварки, тележки.', engineer: 'Кухни — одни из главных потребителей электроэнергии; при перегрузке сети их питание отключается первым (load shedding).', keywords: ['galley', 'кухня'], shot: { pos: [-9.4, 4.1, 0.6], target: [-11.9, 3.5, 0] } }),
  C({ id: 'lavatory', name: 'Lavatory', ru: 'Туалет', system: 'cabin', pos: [-10.9, 4.1, -1.15],
    beginner: 'Туалеты в носу и хвосте салона.', engineer: 'Вакуумная система: перепад давления между салоном и бортом перекачивает отходы в бак в хвосте.', keywords: ['toilet', 'lavatory', 'туалет'], shot: { pos: [-8.8, 4.1, -0.8], target: [-11, 3.6, -1.15] } }),
  C({ id: 'doors', name: 'Doors & exits', ru: 'Двери и выходы', system: 'cabin', pos: [13.6, 3.6, 1.99],
    beginner: 'Четыре основные двери и выходы над крылом. Двери открываются наружу, их удерживает давление в салоне.', engineer: 'Основные двери — с аварийными надувными трапами; выходы над крылом ведут на крыло.', keywords: ['door', 'дверь', 'exit', 'выход'], shot: at(13.6, 3.6, 2, 7) }),
  // CARGO
  C({ id: 'fwdHold', name: 'Forward cargo hold', ru: 'Передний багажный отсек', system: 'cargo', pos: [7.4, 1.9, 0], hotspot: true,
    beginner: 'Под полом салона — багажные отсеки. Чемоданы грузят навалом или в контейнерах.', engineer: 'Отсеки под давлением и с вентиляцией; поддерживают контейнеры LD3-45. Загрузка влияет на центровку самолёта.', keywords: ['cargo', 'hold', 'багаж', 'багажный отсек'], shot: { pos: [9.6, 2.05, 0.0], target: [4.0, 1.7, 0] } }),
  C({ id: 'aftHold', name: 'Aft cargo hold', ru: 'Задний багажный отсек', system: 'cargo', pos: [-6.4, 1.9, 0],
    beginner: 'Второй отсек за крылом и отдельная зона bulk для багажа навалом.', engineer: 'Между отсеками — центроплан с центральным топливным баком и ниши основных стоек.', keywords: ['aft hold'], shot: at(-6.4, 1.9, 0, 8) }),
  // WINGS
  C({ id: 'wing', name: 'Wing', ru: 'Крыло', system: 'wings', pos: [-0.5, 2.9, 9.0], hotspot: true, lab: 'turbofan',
    beginner: 'Крыло создаёт подъёмную силу: воздух над ним движется быстрее, давление сверху становится ниже, чем снизу.', engineer: 'Стреловидное крыло ~25° с изломом задней кромки; внутри — кессон с топливными баками. Шарклеты уменьшают концевой вихрь.', keywords: ['wing', 'крыло', 'lift', 'подъёмная сила'], shot: { pos: [-4, 9, 17], target: [-0.6, 2.6, 8.5] } }),
  C({ id: 'flaps', name: 'Flaps', ru: 'Закрылки', system: 'wings', pos: [-2.6, 2.55, 7.5], action: 'flaps', flows: ['hydraulic'], path: ['hyd-green-wing', 'hyd-yellow-wing'],
    beginner: 'Закрылки выезжают назад и вниз. Крыло становится больше и изогнутее: подъёмная сила на малой скорости растёт.', engineer: 'Закрылки Фаулера: увеличивают площадь и кривизну профиля. Позиции CONF 1–FULL; привод через вал от блока гидромоторов.', keywords: ['flaps', 'закрылки', 'high lift', 'low speed'], shot: { pos: [-9, 5.5, 13], target: [-2.4, 2.4, 7.5] } }),
  C({ id: 'slats', name: 'Slats', ru: 'Предкрылки', system: 'wings', pos: [0.8, 2.75, 9.0], action: 'slats', flows: ['hydraulic'], path: ['hyd-blue'],
    beginner: 'Предкрылки выдвигаются вперёд с передней кромки и позволяют крылу работать на больших углах без срыва потока.', engineer: 'Пять секций на крыло; щель между предкрылком и крылом подпитывает пограничный слой.', keywords: ['slats', 'предкрылки'], shot: { pos: [7, 4.5, 13], target: [0.6, 2.6, 9] } }),
  C({ id: 'ailerons', name: 'Ailerons', ru: 'Элероны', system: 'flightControls', pos: [-4.3, 3.05, 14.3], action: 'rollLeft', flows: ['signal', 'hydraulic'], path: ['sig-wing-L', 'sig-wing-R'],
    beginner: 'Элероны отклоняются в разные стороны на левом и правом крыле — самолёт кренится.', engineer: 'Для крена вместе с элеронами работают интерцепторы опускающегося крыла (roll spoilers).', keywords: ['aileron', 'элерон', 'roll', 'крен'], shot: { pos: [-11, 6.5, 19], target: [-4.2, 3.0, 14.3] } }),
  C({ id: 'spoilers', name: 'Spoilers', ru: 'Интерцепторы', system: 'flightControls', pos: [-1.3, 2.85, 7.5], action: 'spoilers', flows: ['hydraulic'],
    beginner: 'Пластины на верху крыла поднимаются и «портят» обтекание: подъёмная сила падает, самолёт тормозится.', engineer: 'Пять секций на крыло: помогают крену, работают как воздушные тормоза в полёте и как интерцепторы после касания.', keywords: ['spoiler', 'интерцептор', 'speedbrake'], shot: { pos: [-6, 7.5, 12], target: [-1.3, 2.8, 7.5] } }),
  // FLIGHT CONTROLS (tail)
  C({ id: 'elevator', name: 'Elevator', ru: 'Руль высоты', system: 'flightControls', pos: [-16.6, 4.9, 3.0], action: 'pitchUp', flows: ['signal', 'hydraulic'], path: ['sig-tail', 'hyd-yellow-tail'],
    beginner: 'Руль высоты поднимает или опускает нос самолёта.', engineer: 'Рули высоты для быстрых движений по тангажу; весь стабилизатор (THS) медленно перекладывается для балансировки.', keywords: ['elevator', 'руль высоты', 'pitch', 'тангаж'], shot: { pos: [-24, 9, 10], target: [-16, 4.9, 2.5] } }),
  C({ id: 'rudder', name: 'Rudder', ru: 'Руль направления', system: 'flightControls', pos: [-16.6, 8.0, 0.3], action: 'yawLeft', flows: ['signal', 'hydraulic'], path: ['sig-rudder', 'hyd-blue-tail'],
    beginner: 'Руль направления поворачивает нос влево-вправо, особенно нужен при боковом ветре и отказе двигателя.', engineer: 'Привод от трёх гидросистем; FAC демпфирует рыскание и координирует развороты.', keywords: ['rudder', 'руль направления', 'yaw', 'рыскание'], shot: { pos: [-26, 10, 9], target: [-16, 7.5, 0] } }),
  C({ id: 'ths', name: 'Horizontal stabilizer', ru: 'Стабилизатор', system: 'flightControls', pos: [-15.4, 4.8, 3.5],
    beginner: 'Хвостовое «крылышко» удерживает самолёт от раскачивания носом.', engineer: 'Переставной стабилизатор (THS) с винтовым приводом балансирует самолёт при изменении скорости и центровки.', keywords: ['stabilizer', 'стабилизатор', 'ths', 'trim'], shot: { pos: [-22, 8, 11], target: [-15.4, 4.7, 3] } }),
  // ENGINES
  C({ id: 'engine', name: 'Engine (CFM56)', ru: 'Двигатель', system: 'engines', pos: [AX.engineX, AX.engineY + 1.2, E], hotspot: true, lab: 'turbofan', flows: ['air', 'fuel', 'exhaust'], path: ['air-inlet-L', 'fuel-eng-L', 'jet-L'],
    beginner: 'Турбовентиляторный двигатель: огромный вентилятор впереди гонит воздух назад и создаёт большую часть тяги.', engineer: 'Двухвальный ТРДД со степенью двухконтурности около 6: большая часть тяги создаётся вентилятором (второй контур), ядро крутит вентилятор через турбину низкого давления.', varies: 'Варианты A320: CFM56 / IAE V2500 (ceo), LEAP-1A / PW1100G (neo).', keywords: ['engine', 'двигатель', 'cfm56', 'turbofan', 'jet', 'thrust', 'тяга'], shot: { pos: [9.5, 2.6, 10.5], target: [1.9, 1.5, E] } }),
  C({ id: 'fan', name: 'Fan', ru: 'Вентилятор', system: 'engines', pos: [AX.engineX + 1.6, AX.engineY, E + 0.9], lab: 'turbofan', flows: ['air'], path: ['air-inlet-L', 'air-inlet-R'],
    beginner: 'Самая большая часть двигателя. Большую часть воздуха вентилятор отправляет в обход горячего ядра — это и даёт основную тягу.', engineer: 'Широкохордные лопатки, диаметр около 1,7 м; вращается турбиной низкого давления.', keywords: ['fan', 'вентилятор', 'bypass'], shot: { pos: [8.5, 1.6, 6.5], target: [3.5, 1.45, E] } }),
  C({ id: 'idg', name: 'Generator (IDG)', ru: 'Генератор IDG', system: 'electrical', pos: [AX.engineX - 1.0, 0.6, E], flows: ['electric'], path: ['elec-idg-L', 'elec-idg-R', 'elec-cabin'],
    beginner: 'Каждый двигатель крутит генератор — так в полёте вырабатывается электричество.', engineer: 'Integrated Drive Generator: постоянная частота 400 Гц при меняющихся оборотах двигателя; переменный ток 115 В.', keywords: ['idg', 'generator', 'генератор', 'electric'], shot: at(AX.engineX - 1.0, 0.8, E, 6) }),
  // FUEL
  C({ id: 'wingTanks', name: 'Wing tanks', ru: 'Баки в крыльях', system: 'fuel', pos: [-0.2, 2.75, 6.5], hotspot: true, flows: ['fuel'], path: ['fuel-inner-L', 'fuel-inner-R', 'fuel-outer-L', 'fuel-outer-R', 'fuel-eng-L', 'fuel-eng-R'],
    beginner: 'Почти всё топливо — внутри крыльев. Само крыло и есть бак.', engineer: 'Внутренний и внешний баки в каждом крыле; из внешнего топливо перетекает во внутренний. В законцовке — дренажный бак.', varies: 'Ёмкость и опциональные доп. баки зависят от варианта.', keywords: ['fuel', 'tank', 'бак', 'топливо', 'wing tank'], shot: { pos: [6, 12, 16], target: [0, 2.5, 6.5] } }),
  C({ id: 'centerTank', name: 'Center tank', ru: 'Центральный бак', system: 'fuel', pos: [1.2, 2.5, 0.0], flows: ['fuel'], path: ['fuel-ctr-L', 'fuel-ctr-R', 'fuel-eng-L', 'fuel-eng-R'],
    beginner: 'Бак в центре самолёта, между крыльями. Его топливо обычно расходуется первым.', engineer: 'Насосы центрального бака имеют приоритет; так крылья дольше остаются тяжёлыми — это разгружает корень крыла в полёте.', keywords: ['center tank', 'центральный бак'], shot: { pos: [8, 6, 9], target: [1.2, 2.0, 0] } }),
  C({ id: 'fuelPumps', name: 'Fuel pumps', ru: 'Топливные насосы', system: 'fuel', pos: [1.4, 2.35, 2.6], flows: ['fuel'], path: ['fuel-ctr-L', 'fuel-ctr-R', 'fuel-inner-L', 'fuel-inner-R'],
    beginner: 'Насосы в баках подают топливо к двигателям. Каждый двигатель может питаться из любого бака.', engineer: 'Подкачивающие насосы в баках + кран кольцевания (crossfeed); на двигателе свой насос высокого давления и дозатор (HMU).', keywords: ['pump', 'насос', 'crossfeed'], shot: at(1.4, 2.3, 2.6, 6) }),
  // GEAR
  C({ id: 'mainGear', name: 'Main landing gear', ru: 'Основные стойки шасси', system: 'gear', pos: [AX.mainGearX, 1.3, AX.mainGearZ], hotspot: true, action: 'gearUp', flows: ['hydraulic'], path: ['hyd-green-gear'],
    beginner: 'Основные стойки держат почти весь вес самолёта. После взлёта они убираются внутрь, к фюзеляжу.', engineer: 'Стойки с масляно-воздушными амортизаторами убираются вбок от зелёной гидросистемы; аварийный выпуск — под собственным весом.', keywords: ['gear', 'шасси', 'landing gear', 'стойка'], shot: { pos: [4, 1.4, 10], target: [-1.6, 1.0, 3.6] } }),
  C({ id: 'noseGear', name: 'Nose gear', ru: 'Передняя стойка', system: 'gear', pos: [AX.noseGearX, 1.0, 0.4], action: 'gearUp', flows: ['hydraulic'], path: ['hyd-green-nose'],
    beginner: 'Передняя стойка поворачивается, чтобы самолёт мог рулить по земле.', engineer: 'Управление поворотом от штурвальчика (tiller) и педалей; убирается вперёд.', keywords: ['nose gear', 'передняя стойка', 'taxi', 'руление'], shot: { pos: [15, 1.6, 5], target: [11, 0.9, 0] } }),
  C({ id: 'wheelsBrakes', name: 'Wheel brakes', ru: 'Колёсные тормоза', system: 'gear', pos: [AX.mainGearX, 0.6, AX.mainGearZ + 0.9], flows: ['hydraulic'], path: ['hyd-green-gear'],
    beginner: 'Тормоза на основных колёсах. Антиюз не даёт колёсам заблокироваться, как ABS в машине.', engineer: 'Многодисковые углеродные тормоза; автоторможение LO/MED/MAX; основное питание — зелёная система, резерв — жёлтая с аккумулятором.', keywords: ['brakes', 'тормоза', 'anti-skid', 'autobrake'], shot: { pos: [2.5, 1.0, 7.5], target: [-1.6, 0.55, 3.8] } }),
  // HYDRAULICS
  C({ id: 'greenSystem', name: 'Green hydraulic system', ru: 'Гидросистема Green', system: 'hydraulics', pos: [-2.6, 2.1, 0.75], hotspot: true, flows: ['hydraulic'], path: ['hyd-green', 'hyd-green-gear', 'hyd-green-nose', 'hyd-green-wing'],
    beginner: 'Масло под большим давлением двигает рули, шасси и тормоза. Систем три — каждая подстраховывает другие.', engineer: 'Green: насос двигателя 1; шасси, основные тормоза, часть рулей. Давление около 3000 psi (~207 бар).', keywords: ['hydraulic', 'гидравлика', 'green'], shot: { pos: [6, 8, 12], target: [-2.4, 1.8, 0.75] } }),
  C({ id: 'yellowSystem', name: 'Yellow hydraulic system', ru: 'Гидросистема Yellow', system: 'hydraulics', pos: [-2.6, 2.1, -0.75], flows: ['hydraulic'], path: ['hyd-yellow', 'hyd-yellow-wing', 'hyd-yellow-tail'],
    beginner: 'Вторая система — от правого двигателя. Есть ещё электронасос.', engineer: 'Yellow: насос двигателя 2 + электронасос (и ручной насос для грузовых дверей); резервные тормоза.', keywords: ['yellow'], shot: { pos: [6, 8, -12], target: [-2.4, 1.8, -0.75] } }),
  C({ id: 'blueSystem', name: 'Blue hydraulic system', ru: 'Гидросистема Blue', system: 'hydraulics', pos: [-3.3, 2.1, 0.75], flows: ['hydraulic'], path: ['hyd-blue', 'hyd-blue-tail'],
    beginner: 'Третья система с электронасосом. В аварии её крутит маленький ветряк — RAT.', engineer: 'Blue: электронасос; при полной потере питания выпускается RAT и обеспечивает давление и аварийный генератор.', keywords: ['blue', 'rat'], shot: { pos: [2, 6, 10], target: [-3.3, 1.8, 0.75] } }),
  C({ id: 'ptu', name: 'PTU', ru: 'Блок передачи мощности', system: 'hydraulics', pos: [-2.6, 1.95, 0.0], flows: ['hydraulic'], path: ['hyd-ptu'],
    beginner: 'Если в одной системе пропало давление, PTU «одалживает» его у другой — без смешивания жидкостей.', engineer: 'Гидромотор-насос между Green и Yellow; срабатывает при разнице давлений. Отсюда характерный «лай» A320 на земле.', keywords: ['ptu', 'barking dog'], shot: at(-2.6, 1.7, 0, 5) }),
  // ELECTRICAL
  C({ id: 'avionics', name: 'Avionics bay', ru: 'Отсек авионики', system: 'electrical', pos: [13.4, 2.6, -0.3], flows: ['electric'], path: ['elec-idg-L', 'elec-idg-R', 'elec-apu', 'elec-cabin', 'elec-cockpit', 'elec-galley'],
    beginner: 'Под кабиной — «электрощитовая» самолёта: шины, аккумуляторы и компьютеры.', engineer: 'Шины переменного тока 115 В / 400 Гц и постоянного 28 В (через выпрямители TR); два аккумулятора; контакторы перестраивают сеть при отказах.', keywords: ['electrical', 'электрика', 'battery', 'аккумулятор', 'bus', 'шины'], shot: { pos: [10.4, 2.6, 2.8], target: [13.4, 2.1, 0] } }),
  C({ id: 'rat', name: 'RAT', ru: 'Ветряк аварийной энергии', system: 'electrical', pos: [-0.6, 1.0, -1.2],
    beginner: 'Маленький пропеллер, который выдвигается в поток при полной потере питания.', engineer: 'Ram Air Turbine приводит насос Blue-системы, а через неё — аварийный генератор.', keywords: ['rat', 'emergency'], shot: at(-0.6, 1.0, -1.2, 5) }),
  // PNEUMATICS
  C({ id: 'packs', name: 'Air conditioning packs', ru: 'Кондиционеры (packs)', system: 'pneumatics', pos: [1.0, 1.4, 1.2], hotspot: true, flows: ['air'], path: ['bleed-L', 'bleed-R', 'air-mixer', 'air-riser', 'air-dist-fwd', 'air-dist-aft'],
    beginner: 'Горячий воздух от двигателей охлаждается здесь и идёт в салон. Он же создаёт давление в салоне.', engineer: 'Два блока кондиционирования (packs) под центропланом: охлаждение расширением в турбохолодильнике; далее смеситель с рециркуляцией.', keywords: ['pack', 'air conditioning', 'кондиционер', 'bleed', 'отбор воздуха'], shot: { pos: [6, -1.2, 7], target: [1.0, 1.45, 0.4] } }),
  C({ id: 'bleed', name: 'Bleed air', ru: 'Отбор воздуха', system: 'pneumatics', pos: [1.8, 2.5, E - 0.5], flows: ['air'], path: ['bleed-L', 'bleed-R', 'air-apu', 'anti-ice-L', 'anti-ice-R'],
    beginner: 'Из компрессора двигателя забирают горячий сжатый воздух: для кондиционирования, обогрева крыла и запуска.', engineer: 'Отбор от ступеней компрессора высокого давления, охлаждение в предохладителе воздухом вентилятора; на земле — от ВСУ.', keywords: ['bleed', 'отбор', 'pneumatic'], shot: at(1.8, 2.4, E - 0.5, 7) }),
  C({ id: 'outflowValve', name: 'Outflow valve', ru: 'Клапан сброса давления', system: 'pneumatics', pos: [-12.4, 2.4, -1.65], flows: ['air'], path: ['air-cabin'],
    beginner: 'Давление в салоне задаётся не насосом, а тем, насколько приоткрыт этот клапан в хвосте.', engineer: 'Регулятор давления (CPC) управляет клапаном: высота в салоне не более ~8000 ft при максимальном перепаде.', keywords: ['outflow', 'pressurization', 'герметизация', 'давление'], shot: { pos: [-8.5, 1.4, -6.5], target: [-12.4, 2.3, -1.6] } }),
  // APU
  C({ id: 'apu', name: 'APU', ru: 'Вспомогательная силовая установка', system: 'apu', pos: [-17.6, 5.2, 0], hotspot: true, action: 'apuStart', flows: ['air', 'electric', 'exhaust'], path: ['air-apu', 'elec-apu', 'apu-exh', 'fuel-apu'],
    beginner: 'Маленький газотурбинный двигатель в хвосте. На земле даёт электричество и сжатый воздух — для кондиционера и запуска основных двигателей.', engineer: 'ВСУ не создаёт тяги; приводит генератор и компрессор отбора. Питается из топливной системы самолёта.', keywords: ['apu', 'всу', 'auxiliary'], shot: { pos: [-23.5, 7.5, 7], target: [-17.4, 4.7, 0] } }),
]

const walk: WalkZone[] = [
  { id: 'cockpit', label: 'COCKPIT', shot: { pos: [14.6, 4.05, 0.0], target: [18, 3.55, 0], via: [24, 6, 5] }, xray: true },
  { id: 'fwd', label: 'FORWARD CABIN', shot: { pos: [11.6, 4.25, 0.3], target: [4, 3.5, 0] }, xray: true },
  { id: 'mid', label: 'MID CABIN', shot: { pos: [3.0, 4.25, 0.0], target: [-6, 3.5, 0] }, xray: true },
  { id: 'aft', label: 'AFT CABIN', shot: { pos: [-5.5, 4.25, 0.3], target: [-11.5, 3.6, 0] }, xray: true },
  { id: 'galley', label: 'GALLEY', shot: { pos: [-9.4, 4.1, 0.6], target: [-11.9, 3.5, 0] }, xray: true },
  { id: 'lav', label: 'LAVATORY', shot: { pos: [-8.8, 4.1, -0.7], target: [-11, 3.6, -1.15] }, xray: true },
  { id: 'cargo', label: 'CARGO HOLD', shot: { pos: [9.8, 2.0, 0.0], target: [4.0, 1.7, 0], via: [14, 1.6, 6] }, xray: true },
  { id: 'wing', label: 'WING', shot: { pos: [-4, 9, 17], target: [-0.6, 2.6, 8.5] } },
  { id: 'engine', label: 'ENGINE', shot: { pos: [9.5, 2.4, 9.5], target: [2, 1.45, E] } },
]

const step = (title: string, text: string, focus: string, extra: Partial<LearnStep> = {}): LearnStep => ({ title, text, focus, ...extra })

export const a320: VehicleDef = {
  id: 'a320', kind: 'aircraft', name: 'AIRBUS A320', line: 'COMMERCIAL AIRCRAFT', type: '2 × high-bypass turbofan',
  tagline: 'Узкофюзеляжный лайнер на 150–180 пассажиров с управлением по проводам.',
  representative: 'Representative A320ceo with CFM56-5B engines',
  varies: 'A320 family variants and engine options (CFM56, V2500, LEAP-1A, PW1100G) differ in detail.',
  accent: '#8fd6ff',
  specs: [
    { label: 'Length', value: '37.57 m' },
    { label: 'Span', value: '35.8 m (sharklets)' },
    { label: 'Height', value: '11.76 m' },
    { label: 'Engines', value: '2 × turbofan' },
    { label: 'Controls', value: 'Fly-by-wire' },
    { label: 'Hydraulics', value: 'Green · Blue · Yellow' },
  ],
  systems: [
    { id: 'cockpit', label: 'COCKPIT', ru: 'Кабина' },
    { id: 'cabin', label: 'CABIN', ru: 'Салон' },
    { id: 'cargo', label: 'CARGO', ru: 'Багаж' },
    { id: 'wings', label: 'WINGS', ru: 'Крыло' },
    { id: 'engines', label: 'ENGINES', ru: 'Двигатели' },
    { id: 'gear', label: 'LANDING GEAR', ru: 'Шасси' },
    { id: 'fuel', label: 'FUEL', ru: 'Топливо' },
    { id: 'hydraulics', label: 'HYDRAULICS', ru: 'Гидравлика' },
    { id: 'electrical', label: 'ELECTRICAL', ru: 'Электрика' },
    { id: 'flightControls', label: 'FLIGHT CONTROLS', ru: 'Управление' },
    { id: 'pneumatics', label: 'AIR', ru: 'Воздух и давление' },
    { id: 'apu', label: 'APU', ru: 'ВСУ' },
  ],
  components,
  flows,
  walk,
  overview: { pos: [31, 13.5, 36], target: [0, 3.6, 0] },
  layers: [
    { id: 'fuselage', label: 'FUSELAGE', offset: [0, 7.5, 0] },
    { id: 'cockpit', label: 'COCKPIT', offset: [7, 4.5, 0] },
    { id: 'cabin', label: 'CABIN', offset: [0, 3.6, 0] },
    { id: 'wings', label: 'WINGS', offset: [0, 0.4, 0], outward: 4.5 },
    { id: 'engines', label: 'ENGINES', offset: [3, -1.2, 0], outward: 2.5 },
    { id: 'gear', label: 'LANDING GEAR', offset: [0, -2.5, 0] },
    { id: 'tail', label: 'TAIL', offset: [-5, 2.5, 0] },
    { id: 'systems', label: 'SYSTEMS', offset: [0, -1.0, 0] },
  ],
  scale: 9,
  checklist: [
    { label: 'Jet engine', ids: ['engine', 'fan'] },
    { label: 'Fuel', ids: ['wingTanks', 'centerTank', 'fuelPumps'] },
    { label: 'Flight controls', ids: ['sidestick', 'ailerons', 'elevator', 'rudder', 'flightComputers'] },
    { label: 'Hydraulics', ids: ['greenSystem', 'yellowSystem', 'blueSystem', 'ptu'] },
    { label: 'Electrical', ids: ['idg', 'avionics', 'apu'] },
    { label: 'Landing gear', ids: ['mainGear', 'noseGear', 'wheelsBrakes'] },
  ],
  start: {
    title: 'START ENGINES',
    steps: [
      step('APU', 'Сначала запускается ВСУ в хвосте: она даёт ток и сжатый воздух.', 'apu', { action: 'apuStart', paths: ['fuel-apu', 'elec-apu', 'apu-exh'], duration: 5 }),
      step('BLEED AIR', 'Воздух от ВСУ идёт по трубопроводам к двигателю.', 'bleed', { paths: ['air-apu', 'bleed-L'], duration: 5 }),
      step('STARTER', 'Воздушный стартер раскручивает вал высокого давления (N2).', 'engine', { action: 'enginesStart', duration: 5 }),
      step('FUEL', 'На ~20–25% N2 открывается подача топлива.', 'engine', { paths: ['fuel-ctr-L', 'fuel-eng-L', 'fuel-ctr-R', 'fuel-eng-R'], duration: 5 }),
      step('IGNITION', 'Свечи воспламенителя поджигают смесь в камере сгорания.', 'engine', { paths: ['fuel-eng-L'], duration: 4 }),
      step('N1', 'Турбина начинает крутить вентилятор, двигатель разгоняется сам.', 'fan', { paths: ['air-inlet-L', 'air-inlet-R', 'jet-L', 'jet-R'], duration: 5 }),
      step('IDLE', 'Малый газ: генератор IDG берёт на себя электросеть, отбор воздуха — кондиционеры.', 'idg', { paths: ['elec-idg-L', 'elec-idg-R', 'bleed-L', 'bleed-R'], duration: 6 }),
    ],
  },
  powerPath: {
    title: 'FROM FUEL TO THRUST',
    steps: [
      step('FUEL TANKS', 'Керосин хранится в крыльях и в центральном баке.', 'wingTanks', { flows: ['fuel'] }),
      step('FEED SYSTEM', 'Насосы в баках подают топливо к двигателям.', 'fuelPumps', { paths: ['fuel-ctr-L', 'fuel-ctr-R', 'fuel-inner-L', 'fuel-inner-R'] }),
      step('ENGINE', 'На двигателе насос высокого давления и дозатор выдают ровно столько, сколько нужно.', 'engine', { paths: ['fuel-eng-L', 'fuel-eng-R'], action: 'enginesStart' }),
      step('COMBUSTION', 'Топливо непрерывно горит в кольцевой камере сгорания.', 'engine', { flows: ['fuel', 'air'] }),
      step('TURBINE', 'Горячие газы крутят турбины, турбины крутят компрессор и вентилятор.', 'engine', { flows: ['exhaust'] }),
      step('FAN', 'Вентилятор отбрасывает огромную массу воздуха назад.', 'fan', { flows: ['air'] }),
      step('THRUST', 'Воздух ускорен назад — самолёт толкает вперёд. Тяга передаётся через пилоны на крыло.', 'engine', { paths: ['jet-L', 'jet-R', 'air-inlet-L', 'air-inlet-R'], shot: { pos: [26, 6, 26], target: [0, 2.5, 0] } }),
    ],
  },
  learn: [
    step('STEP 01', 'Топливо из баков в крыльях идёт к двигателям.', 'wingTanks', { flows: ['fuel'] }),
    step('STEP 02', 'Двигатель всасывает воздух, вентилятор и компрессор сжимают его.', 'fan', { flows: ['air'], action: 'enginesStart' }),
    step('STEP 03', 'В камере сгорания керосин горит, турбины крутят валы.', 'engine', { flows: ['fuel', 'exhaust'] }),
    step('STEP 04', 'Отбор воздуха идёт в кондиционеры и создаёт давление в салоне.', 'packs', { flows: ['air'] }),
    step('STEP 05', 'Пилот двигает ручку — компьютеры командуют рулями.', 'sidestick', { flows: ['signal'], action: 'pitchUp' }),
    step('STEP 06', 'Гидравлика двигает рули, закрылки и шасси.', 'greenSystem', { flows: ['hydraulic'], action: 'flaps' }),
    step('STEP 07', 'Генераторы двигателей питают все системы.', 'avionics', { flows: ['electric'] }),
    step('STEP 08', 'Шасси убирается — самолёт в полёте.', 'mainGear', { action: 'gearUp' }),
  ],
  demo: {
    id: 'demo-jet', vehicle: 'a320', title: 'How fuel becomes thrust', subtitle: 'От бака в крыле до реактивной струи',
    steps: [
      step('Топливо в крыле', 'Крыло A320 — это бак. Насосы готовят топливо к подаче.', 'wingTanks', { flows: ['fuel'], duration: 5 }),
      step('ВСУ', 'ВСУ в хвосте даёт сжатый воздух для запуска.', 'apu', { action: 'apuStart', paths: ['air-apu', 'apu-exh'], duration: 5 }),
      step('Запуск', 'Воздушный стартер раскручивает двигатель, затем подаётся топливо и поджигается смесь.', 'engine', { action: 'enginesStart', paths: ['fuel-ctr-L', 'fuel-eng-L', 'fuel-ctr-R', 'fuel-eng-R'], duration: 6 }),
      step('Воздух', 'Вентилятор всасывает воздух. Большая часть идёт в обход ядра.', 'fan', { paths: ['air-inlet-L', 'air-inlet-R'], duration: 6 }),
      step('Горение', 'В ядре воздух сжимается, керосин горит непрерывно, газы крутят турбины.', 'engine', { flows: ['fuel', 'exhaust'], duration: 6 }),
      step('Тяга', 'Масса воздуха, отброшенная назад, толкает самолёт вперёд.', 'engine', { paths: ['jet-L', 'jet-R', 'air-inlet-L', 'air-inlet-R'], shot: { pos: [28, 7, 24], target: [0, 2.5, 0] }, duration: 6 }),
      step('Управление', 'Тяга есть — дальше работают крыло, рули и гидравлика.', 'flaps', { action: 'flaps', flows: ['hydraulic'], duration: 6 }),
    ],
  },
  layout: null,
}
