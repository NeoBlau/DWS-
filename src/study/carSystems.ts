import { T } from '../explorer/i18n'
import type { Part, Pipe, SystemDef, St, Tone } from './atlasTypes'

/*
 * Car systems atlas — Toyota Fortuner 2.8 D-4D (1GD-FTV, 6-speed automatic, part-time 4WD) and
 * BMW 530i (B46 2.0 turbo petrol, ZF 8HP, rear-wheel drive). Each system: schematic, a small live model,
 * how it works, what kills it, key numbers. Values are representative, not workshop data.
 */
const P = (id: string, x: number, y: number, w: number, h: number, ru: string, en: string, iru: string, ien: string, tone?: Tone): Part => ({ id, x, y, w, h, label: T(ru, en), info: T(iru, ien), tone })
const L = (tone: Tone, pts: [number, number][], flow?: (s: St) => number, w?: number): Pipe => ({ tone, pts, flow, w })
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/* ------------------------------------------------------------------ cooling */
function coolingSteady(load: number, kmh: number, amb: number) {
  const q = 3.5 + 0.7 * load // kW into the coolant
  let T = 80, open = 0, fan = 0
  for (let i = 0; i < 400; i++) {
    open = clamp((T - 82) / 13, 0, 1); fan = T > 98 ? 1 : 0
    const out = open * (T - amb) * (0.26 + 0.055 * (kmh / 3.6) + fan * 0.42) + (T - amb) * 0.006
    T += (q - out) * 0.05
  }
  return { T, open, fan, q }
}
const cooling: SystemDef = {
  id: 'cooling', group: 'car', title: T('Система охлаждения', 'Cooling system'),
  lead: T('Двигатель превращает в работу только ~40 % энергии топлива; ещё ~30 % надо отвести жидкостью, иначе головка и поршни перегреются за минуты.', 'An engine turns only ~40 % of the fuel energy into work; another ~30 % must be carried away by coolant or the head and pistons overheat within minutes.'),
  parts: [
    P('block', 280, 170, 170, 120, 'Блок и ГБЦ', 'Block & head', 'Рубашка охлаждения — каналы вокруг цилиндров и камер сгорания. Самое горячее место — между клапанами в головке.', 'The water jacket — passages round the cylinders and combustion chambers. The hottest spot is between the valves in the head.', 'hot'),
    P('pump', 200, 320, 90, 44, 'Помпа', 'Water pump', 'Центробежный насос с приводом от ремня/цепи: прокачивает ≈ 100–200 л/мин, пропорционально оборотам.', 'A belt/chain-driven centrifugal pump: ≈ 100–200 l/min, proportional to engine speed.', 'cool'),
    P('thermo', 490, 120, 100, 44, 'Термостат', 'Thermostat', 'Восковой клапан: до ≈ 82 °C закрыт — жидкость идёт по малому кругу мимо радиатора, двигатель быстро греется; к 95 °C открыт полностью.', 'A wax valve: closed below ≈ 82 °C so coolant bypasses the radiator and the engine warms fast; fully open by 95 °C.', 'ctrl'),
    P('rad', 640, 110, 90, 230, 'Радиатор', 'Radiator', 'Тонкие алюминиевые трубки и рёбра: встречный воздух забирает тепло. Отдаёт тем больше, чем быстрее едет машина.', 'Thin aluminium tubes and fins: the air flow takes the heat. It sheds more the faster the car goes.', 'cool'),
    P('fan', 745, 160, 44, 130, 'Вентилятор', 'Fan', 'Включается на стоянке и в пробке (> 98 °C), когда встречного потока нет.', 'Switches on when parked or in traffic (> 98 °C), when there is no ram air.', 'air'),
    P('tank', 640, 40, 90, 40, 'Расширительный бачок', 'Expansion tank', 'Жидкость расширяется при нагреве; крышка держит ≈ 1,1 бар — кипение начинается не при 100, а при ≈ 120 °C.', 'Coolant expands when hot; the cap holds ≈ 1.1 bar so it boils at ≈ 120 °C instead of 100.', 'cool'),
    P('heater', 300, 50, 130, 44, 'Радиатор печки', 'Heater core', 'Тепло двигателя греет салон. Печка на максимум — маленький дополнительный радиатор при перегреве.', 'Engine heat warms the cabin. Heater on full is a small extra radiator in an overheat.', 'hot'),
    P('egrc', 60, 190, 110, 44, 'Охладитель EGR / масла / ATF', 'EGR, oil & ATF coolers', 'Та же жидкость охлаждает рециркулируемые газы, моторное масло и масло АКПП.', 'The same coolant cools the recirculated exhaust gas, engine oil and gearbox fluid.', 'cool'),
  ],
  pipes: [
    L('cool', [[245, 320], [245, 290], [300, 290]], (s) => 0.3 + s.load / 140),
    L('hot', [[450, 200], [540, 200], [540, 164]], (s) => 0.3 + s.load / 140),
    L('hot', [[590, 142], [685, 142], [685, 110]], (s) => s.open),
    L('cool', [[685, 340], [685, 400], [290, 400], [290, 364]], (s) => s.open),
    L('cool', [[540, 164], [540, 300], [470, 340], [290, 342]], (s) => 1 - s.open),
    L('hot', [[360, 170], [360, 94]], () => 0.4),
    L('cool', [[300, 72], [190, 72], [190, 300], [200, 330]], () => 0.4),
    L('cool', [[170, 212], [280, 212]], () => 0.3),
  ],
  ctls: [
    { id: 'load', label: T('Нагрузка', 'Load'), min: 0, max: 100, step: 5, init: 30, unit: '%' },
    { id: 'kmh', label: T('Скорость', 'Speed'), min: 0, max: 150, step: 5, init: 60, unit: 'km/h' },
    { id: 'amb', label: T('Воздух снаружи', 'Ambient'), min: -25, max: 45, step: 5, init: 20, unit: '°C' },
  ],
  live: (s) => {
    const r = coolingSteady(s.load, s.kmh, s.amb)
    s.open = r.open
    return {
      values: { block: `${Math.round(r.T)} °C`, thermo: `${Math.round(r.open * 100)} %`, fan: r.fan ? 'ON' : 'OFF', rad: `${Math.round(r.q)} kW` },
      warn: r.T > 112 ? ['block'] : [],
      note: r.T > 112 ? T('Перегрев: радиатор не успевает отдать тепло — нагрузка велика, а встречного воздуха мало. Снизьте нагрузку, включите печку.', 'Overheating: the radiator cannot shed the heat — high load with little ram air. Ease off, turn the heater on.')
        : r.open < 0.05 ? T('Термостат закрыт: жидкость ходит по малому кругу, двигатель греется. Холодный двигатель — повышенный износ и расход.', 'Thermostat shut: coolant takes the small loop and the engine warms up. A cold engine wears faster and burns more.') : T('Рабочий режим: термостат регулирует температуру ≈ 85–95 °C, открываясь ровно настолько, насколько нужно.', 'Normal: the thermostat holds ≈ 85–95 °C by opening just as far as needed.'),
    }
  },
  how: [
    T('Помпа гонит жидкость (вода + этиленгликоль, замерзает при −35…−40 °C) через рубашку блока и головки. Нагретая жидкость идёт к термостату.', 'The pump drives coolant (water + ethylene glycol, freezes at −35…−40 °C) through the block and head jackets. Hot coolant goes to the thermostat.'),
    T('Пока двигатель холодный, термостат закрыт — малый круг. Это ускоряет прогрев: масло быстрее становится жидким, топливо лучше испаряется, меньше износ.', 'While the engine is cold the thermostat stays shut — the small loop. That speeds warm-up: oil thins sooner, fuel vaporises better, less wear.'),
    T('Тепло, которое надо отвести, растёт с нагрузкой, а отдача радиатора — с разницей температур и потоком воздуха. Поэтому опаснее всего тяжёлая работа на малой скорости: буксировка в гору, буксование, стоп-тест.', 'The heat to remove grows with load; the radiator’s output grows with the temperature difference and the air flow. That is why heavy work at low speed is the most dangerous: towing uphill, wheelspin, a stall test.'),
    T('Система под давлением ≈ 1,1 бар — это поднимает точку кипения до ≈ 120 °C. Никогда не открывайте горячий бачок: жидкость вскипит и выплеснется.', 'The system is pressurised to ≈ 1.1 bar, raising the boiling point to ≈ 120 °C. Never open a hot tank: the coolant flashes to steam and sprays out.'),
  ],
  donts: [
    T('Не нагружать холодный двигатель и не держать высокие обороты до прогрева масла (≈ 60 °C).', 'Do not load a cold engine or rev it hard before the oil is warm (≈ 60 °C).'),
    T('Стрелка ушла вверх — сразу сбросить нагрузку; ехать дальше при > 120 °C — деформация головки и пробой прокладки.', 'Gauge climbing — ease off at once; driving on above 120 °C warps the head and blows the gasket.'),
    T('Не доливать холодную воду в перегретый мотор — термоудар и трещины.', 'Do not pour cold water into an overheated engine — thermal shock cracks it.'),
    T('Не ездить на воде вместо антифриза: зимой разморозит блок, летом коррозия и накипь.', 'Do not run plain water: it freezes and splits the block in winter, corrodes and scales in summer.'),
  ],
  numbers: [[T('Рабочая температура', 'Operating temperature'), '85–95 °C'], [T('Давление в системе', 'System pressure'), '≈ 1.1 bar'], [T('Объём (Fortuner)', 'Capacity (Fortuner)'), '≈ 11 l'], [T('Термостат открыт', 'Thermostat open'), '82 → 95 °C']],
  sim: 'drive',
}

/* ------------------------------------------------------------------ lubrication */
const lube: SystemDef = {
  id: 'lube', group: 'car', title: T('Система смазки', 'Lubrication'),
  lead: T('Между вращающимися деталями и вкладышами — масляный клин толщиной в несколько микрон. Пока он есть, металл не касается металла.', 'Between the spinning shafts and their bearings is an oil wedge a few microns thick. As long as it exists, metal never touches metal.'),
  parts: [
    P('sump', 260, 380, 240, 50, 'Поддон', 'Sump', '≈ 6–7,5 л масла. Маслоприёмник с сеткой забирает его со дна.', '≈ 6–7.5 l of oil. A pickup with a strainer draws from the bottom.', 'oil'),
    P('pump', 120, 300, 100, 44, 'Масляный насос', 'Oil pump', 'Шестерённый или роторный насос с приводом от коленвала; давление растёт с оборотами.', 'A gear or rotor pump driven by the crankshaft; pressure rises with rpm.', 'oil'),
    P('relief', 120, 230, 100, 40, 'Редукционный клапан', 'Relief valve', 'Ограничивает давление (≈ 5–6 бар): на холодном густом масле открывается и сбрасывает лишнее обратно.', 'Caps the pressure (≈ 5–6 bar): with cold, thick oil it opens and spills the excess back.', 'ctrl'),
    P('filter', 250, 230, 100, 44, 'Фильтр', 'Filter', 'Задерживает частицы > 20 мкм. Перепускной клапан пропустит неочищенное масло, если фильтр забит или масло слишком густое.', 'Traps particles > 20 µm. A bypass valve lets unfiltered oil through if it is clogged or the oil is too thick.', 'oil'),
    P('cooler', 250, 160, 100, 40, 'Теплообменник', 'Oil cooler', 'Масло отдаёт тепло охлаждающей жидкости.', 'The oil gives its heat to the coolant.', 'cool'),
    P('gallery', 400, 230, 160, 40, 'Главная магистраль', 'Main gallery', 'Канал вдоль блока, от него — сверления к каждому коренному и шатунному вкладышу.', 'A passage along the block feeding drillings to every main and big-end bearing.', 'oil'),
    P('crank', 400, 300, 160, 50, 'Коленвал и вкладыши', 'Crank & bearings', 'Гидродинамическая смазка: вращение само затягивает масло в клин и «всплывает» на нём.', 'Hydrodynamic lubrication: rotation drags oil into a wedge and the shaft floats on it.', 'mech'),
    P('cam', 400, 70, 160, 50, 'Распредвалы, гидрокомпенсаторы', 'Camshafts, lifters', 'Наверх масло приходит последним — именно там износ при холодном пуске.', 'Oil reaches the top last — that is where cold-start wear happens.', 'mech'),
    P('turbo', 620, 150, 120, 44, 'Подшипник турбины', 'Turbo bearing', 'Вал турбины крутится до 200 000 об/мин на плёнке масла рядом с корпусом в 700 °C.', 'The turbo shaft spins up to 200,000 rpm on an oil film next to a 700 °C housing.', 'hot'),
    P('jets', 620, 300, 120, 44, 'Форсунки охлаждения поршней', 'Piston cooling jets', 'Брызгают маслом под днище поршня — снимают тепло.', 'Spray oil under the piston crowns to cool them.', 'oil'),
  ],
  pipes: [
    L('oil', [[300, 380], [170, 380], [170, 344]], (s) => s.flow),
    L('oil', [[170, 300], [170, 270]], (s) => s.relief),
    L('oil', [[220, 322], [300, 322], [300, 274]], (s) => s.flow),
    L('oil', [[300, 230], [300, 200]], (s) => s.flow),
    L('oil', [[350, 180], [380, 180], [380, 250], [400, 250]], (s) => s.flow),
    L('oil', [[480, 270], [480, 300]], (s) => s.flow),
    L('oil', [[480, 230], [480, 120]], (s) => s.flow * 0.7),
    L('oil', [[560, 250], [600, 250], [600, 172], [620, 172]], (s) => s.flow),
    L('oil', [[560, 260], [680, 260], [680, 300]], (s) => s.flow),
    L('oil', [[560, 325], [600, 360], [500, 400]], (s) => s.flow * 0.6),
  ],
  ctls: [
    { id: 'rpm', label: T('Обороты', 'Engine speed'), min: 700, max: 4500, step: 100, init: 1500, unit: 'rpm' },
    { id: 'temp', label: T('Температура масла', 'Oil temperature'), min: -20, max: 140, step: 5, init: 90, unit: '°C' },
  ],
  live: (s) => {
    const visc = Math.exp(-(s.temp - 90) / 32) // relative viscosity
    let p = 0.55 * Math.pow(s.rpm / 1000, 0.9) * Math.pow(visc, 0.55) + 0.3
    const relief = p > 5.5 ? 1 : 0
    p = Math.min(p, 5.5)
    const flow = clamp((s.rpm / 3000) / Math.pow(visc, 0.35), 0.15, 1.4)
    s.flow = flow; s.relief = relief
    const cold = s.temp < 50 && s.rpm > 2800
    return {
      values: { pump: `${p.toFixed(1)} bar`, relief: relief ? 'OPEN' : 'SHUT', crank: `${(visc * 14).toFixed(0)} cSt`, filter: visc > 6 ? 'BYPASS' : 'OK' },
      warn: [...(p < 0.8 ? ['pump'] : []), ...(cold ? ['cam', 'turbo'] : [])],
      note: p < 0.8 ? T('Давление мало: горячее масло на холостых жидкое. Ниже ≈ 0,5 бар загорается лампа — немедленно глушить, иначе провернёт вкладыши.', 'Low pressure: hot oil at idle is thin. Below ≈ 0.5 bar the lamp comes on — stop at once or the bearings spin.')
        : cold ? T('Холодное масло густое: насос давит в предел, клапан сбрасывает, а до распредвалов и турбины оно доходит с опозданием. Высокие обороты сейчас — износ.', 'Cold oil is thick: the pump hits its limit, the relief valve spills, and the oil reaches the cams and turbo late. High rpm now means wear.')
          : T('Давление в норме: на горячем двигателе ≈ 1 бар на холостых и ≈ 4 бар на высоких оборотах.', 'Pressure is normal: on a warm engine ≈ 1 bar at idle and ≈ 4 bar at high rpm.'),
    }
  },
  how: [
    T('Насос забирает масло из поддона и через фильтр подаёт в главную магистраль; оттуда оно идёт к коренным и шатунным вкладышам, наверх к распредвалам, к турбине и форсункам охлаждения поршней, затем стекает обратно.', 'The pump draws oil from the sump and sends it through the filter into the main gallery; from there it feeds the main and big-end bearings, the cams at the top, the turbo and the piston jets, then drains back.'),
    T('Вязкость масла меняется в сотни раз от −20 до +100 °C. Маркировка 0W-30: «0W» — текучесть на морозе, «30» — вязкость при 100 °C.', 'Oil viscosity changes a hundredfold between −20 and +100 °C. In 0W-30, “0W” is the cold flow and “30” the viscosity at 100 °C.'),
    T('Масло также охлаждает (поршни, турбину), очищает (уносит сажу — у дизеля масло темнеет сразу) и защищает от коррозии.', 'Oil also cools (pistons, turbo), cleans (carries soot away — diesel oil goes black at once) and protects against corrosion.'),
  ],
  donts: [
    T('Не давать высокие обороты сразу после холодного пуска.', 'Do not rev high straight after a cold start.'),
    T('Не глушить турбомотор сразу после нагрузки — масло в подшипнике турбины закоксуется (минута на холостых).', 'Do not switch off a turbo engine straight after hard driving — the oil in the turbo bearing cokes (idle for a minute).'),
    T('Не ездить с горящей лампой давления масла — несколько секунд без смазки и вкладыши проворачиваются.', 'Never drive with the oil-pressure lamp lit — a few seconds without oil and the bearings spin.'),
    T('Не затягивать замену: у дизеля масло насыщается сажей и превращается в абразив.', 'Do not stretch oil changes: diesel oil fills with soot and becomes an abrasive.'),
  ],
  numbers: [[T('Давление на холостых (горячий)', 'Pressure at idle (hot)'), '≈ 1 bar'], [T('Давление на высоких', 'Pressure at high rpm'), '3.5–5 bar'], [T('Объём (Fortuner / BMW)', 'Capacity (Fortuner / BMW)'), '7.5 / 5.25 l'], [T('Толщина масляного клина', 'Oil film thickness'), '2–20 µm']],
}

/* ------------------------------------------------------------------ fuel: common rail */
const fuel: SystemDef = {
  id: 'fuel', group: 'car', title: T('Топливная система Common Rail', 'Common-rail fuel system'),
  lead: T('Дизельное топливо надо впрыснуть в сжатый до 60–80 бар горячий воздух, раздробив на капли в несколько микрон. Для этого — давление до 2500 бар.', 'Diesel must be sprayed into air compressed to 60–80 bar and broken into droplets a few microns across. That takes up to 2500 bar.'),
  parts: [
    P('tank', 40, 330, 120, 70, 'Бак 80 л', '80 l tank', 'В баке — подкачивающий насос и датчик уровня.', 'The tank holds the lift pump and the level sender.', 'fuel'),
    P('filter', 200, 330, 110, 50, 'Фильтр-водоотделитель', 'Filter / water trap', 'Вода в дизтопливе губит насос и форсунки: отделяется и сливается.', 'Water in diesel kills the pump and injectors: it is separated and drained.', 'fuel'),
    P('hpp', 350, 320, 120, 60, 'ТНВД', 'High-pressure pump', 'Плунжерный насос от двигателя сжимает топливо до 300–2500 бар; клапан SCV на входе дозирует, сколько качать.', 'An engine-driven plunger pump compresses fuel to 300–2500 bar; the inlet SCV valve meters how much to pump.', 'fuel'),
    P('rail', 330, 150, 300, 40, 'Рампа (аккумулятор)', 'Rail (accumulator)', 'Толстостенная труба — «аккумулятор» давления для всех форсунок. Датчик давления — обратная связь для ЭБУ.', 'A thick-walled tube storing pressure for all injectors. Its sensor is the ECU’s feedback.', 'fuel'),
    P('inj', 330, 60, 300, 50, 'Форсунки × 4', 'Injectors × 4', 'Пьезо- или электромагнитные; за такт делают до 5–8 впрысков: пилотные (тише), основной, поздний (для регенерации сажевого фильтра).', 'Piezo or solenoid; up to 5–8 shots per cycle: pilot (quieter), main, post (to regenerate the particulate filter).', 'fuel'),
    P('ecu', 680, 220, 100, 60, 'ЭБУ', 'ECU', 'Считает момент, количество и давление впрыска по педали, оборотам, наддуву, температурам — тысячи раз в секунду.', 'Computes timing, quantity and pressure from pedal, rpm, boost and temperatures — thousands of times a second.', 'ctrl'),
    P('ret', 40, 160, 160, 40, 'Обратка', 'Return line', 'Утечки форсунок и излишки идут обратно в бак — топливо заодно охлаждает насос.', 'Injector leak-off and surplus go back to the tank — the fuel also cools the pump.', 'fuel'),
  ],
  pipes: [
    L('fuel', [[160, 360], [200, 360]], (s) => 0.3 + s.load / 200),
    L('fuel', [[310, 355], [350, 355]], (s) => 0.3 + s.load / 200),
    L('fuel', [[410, 320], [410, 190]], (s) => 0.5 + s.load / 100, 4),
    L('fuel', [[400, 150], [400, 110]], (s) => 0.5 + s.load / 100), L('fuel', [[480, 150], [480, 110]], (s) => 0.5 + s.load / 100),
    L('fuel', [[550, 150], [550, 110]], (s) => 0.5 + s.load / 100), L('fuel', [[620, 150], [620, 110]], (s) => 0.5 + s.load / 100),
    L('fuel', [[330, 85], [120, 85], [120, 160]], () => 0.3), L('fuel', [[120, 200], [100, 330]], () => 0.3),
    L('ctrl', [[680, 250], [630, 250], [630, 190]]), L('ctrl', [[730, 220], [730, 85], [630, 85]]), L('ctrl', [[730, 280], [730, 350], [470, 350]]),
  ],
  ctls: [
    { id: 'rpm', label: T('Обороты', 'Engine speed'), min: 750, max: 4200, step: 50, init: 1800, unit: 'rpm' },
    { id: 'load', label: T('Педаль', 'Pedal'), min: 0, max: 100, step: 5, init: 40, unit: '%' },
  ],
  live: (s) => {
    const p = Math.round(300 + 2200 * clamp(0.35 * (s.rpm / 4200) + 0.65 * (s.load / 100), 0, 1))
    const q = 4 + 60 * (s.load / 100)
    const shots = s.load < 30 ? 'pilot ×2 + main' : s.load < 80 ? 'pilot + main' : 'main + after'
    return { values: { rail: `${p} bar`, inj: `${q.toFixed(0)} mg · ${shots}`, hpp: `SCV ${Math.round(20 + 70 * s.load / 100)} %`, ecu: `${(s.rpm / 120).toFixed(0)} inj/s` },
      note: T(`При ${p} бар топливо вылетает из отверстий ≈ 0,1 мм со скоростью ≈ ${Math.round(Math.sqrt((2 * p * 1e5) / 830))} м/с и сразу распадается на туман.`, `At ${p} bar fuel leaves ≈ 0.1 mm holes at ≈ ${Math.round(Math.sqrt((2 * p * 1e5) / 830))} m/s and instantly breaks into mist.`) }
  },
  how: [
    T('Подкачивающий насос подаёт топливо из бака через фильтр к ТНВД; ТНВД сжимает его и подаёт в общую рампу; рампа всегда под высоким давлением, а форсунки открывает ЭБУ электрическим импульсом.', 'The lift pump sends fuel through the filter to the high-pressure pump; it pressurises the common rail; the rail is always at high pressure and the ECU opens the injectors with an electrical pulse.'),
    T('Пилотный впрыск поджигает маленькую порцию — основной сгорает мягче, мотор тише, меньше NOx.', 'A pilot shot lights a small portion first — the main burns more gently, the engine is quieter and makes less NOx.'),
    T('BMW 530i (бензин) — непосредственный впрыск ≈ 200–350 бар и свеча зажигания: бензин сам от сжатия не загорается, его поджигают искрой.', 'BMW 530i (petrol) — direct injection at ≈ 200–350 bar and a spark plug: petrol does not self-ignite under compression, a spark lights it.'),
  ],
  donts: [
    T('Не ездить «на остатках» — насос в баке охлаждается топливом, а со дна поднимается грязь и вода.', 'Do not run near empty — the in-tank pump is cooled by fuel and the bottom holds dirt and water.'),
    T('Не заправлять бензином дизель (и наоборот): бензин не смазывает плунжеры ТНВД — стружка разносится по всей системе.', 'Never put petrol in a diesel (or vice versa): petrol does not lubricate the pump plungers — metal swarf spreads through the whole system.'),
    T('Сливать воду из фильтра и менять его по регламенту; не откручивать ничего на работающем моторе — струя 2000 бар режет кожу.', 'Drain the filter and change it on time; never open anything on a running engine — a 2000 bar jet cuts skin.'),
  ],
  numbers: [[T('Давление в рампе', 'Rail pressure'), '300–2500 bar'], [T('Впрысков за такт', 'Shots per cycle'), 'до 8'], [T('Длительность впрыска', 'Injection duration'), '0.1–2 ms'], [T('Степень сжатия 1GD', 'Compression ratio 1GD'), '15.6 : 1']],
}

/* ------------------------------------------------------------------ air, turbo, EGR */
const air: SystemDef = {
  id: 'air', group: 'car', title: T('Впуск, турбина и EGR', 'Intake, turbo and EGR'),
  lead: T('Мощность ограничена количеством воздуха в цилиндре. Турбина использует энергию выхлопа, чтобы вдуть воздуха в 2–2,5 раза больше.', 'Power is limited by how much air fits in the cylinder. The turbo uses exhaust energy to blow in 2–2.5 times more.'),
  parts: [
    P('filt', 30, 80, 110, 44, 'Воздушный фильтр', 'Air filter', 'Задерживает пыль: песок в цилиндре — это задиры и износ колец.', 'Stops dust: sand in a cylinder means scoring and ring wear.', 'air'),
    P('maf', 170, 80, 80, 44, 'ДМРВ', 'MAF sensor', 'Измеряет массу входящего воздуха — по ней ЭБУ считает топливо.', 'Measures the mass of incoming air — the ECU meters fuel from it.', 'ctrl'),
    P('comp', 290, 70, 110, 64, 'Компрессор', 'Compressor', 'Колесо на общем валу с турбиной: до 200 000 об/мин, сжимает воздух до 1,5–2,5 бар абс.', 'A wheel on the turbine’s shaft: up to 200,000 rpm, compresses air to 1.5–2.5 bar abs.', 'air'),
    P('ic', 450, 70, 120, 64, 'Интеркулер', 'Intercooler', 'Сжатый воздух горячий (до 150 °C). Остужают — плотнее, больше кислорода, меньше детонация.', 'Compressed air is hot (up to 150 °C). Cooling makes it denser — more oxygen, less knock.', 'cool'),
    P('eng', 450, 200, 160, 90, 'Цилиндры', 'Cylinders', 'Воздух + топливо → сгорание → выхлоп ≈ 400–750 °C.', 'Air + fuel → combustion → exhaust at ≈ 400–750 °C.', 'hot'),
    P('turb', 290, 220, 110, 64, 'Турбина VNT', 'VNT turbine', 'Поворотные лопатки сужают проход на низких оборотах (газ быстрее — наддув раньше) и раскрывают на высоких.', 'Swivelling vanes narrow the passage at low rpm (faster gas — earlier boost) and open at high rpm.', 'hot'),
    P('egr', 650, 140, 120, 50, 'Клапан и охладитель EGR', 'EGR valve & cooler', 'Часть выхлопа возвращается во впуск: меньше кислорода — ниже температура пламени — меньше NOx. Работает на частичных нагрузках.', 'Some exhaust returns to the intake: less oxygen — cooler flame — less NOx. Works at part load.', 'ctrl'),
    P('dpf', 130, 330, 160, 50, 'В выпуск: DOC + DPF', 'To exhaust: DOC + DPF', 'Нейтрализатор и сажевый фильтр.', 'Catalyst and particulate filter.', 'hot'),
  ],
  pipes: [
    L('air', [[140, 102], [170, 102]], (s) => 0.4 + s.boost), L('air', [[250, 102], [290, 102]], (s) => 0.4 + s.boost),
    L('hot', [[400, 102], [450, 102]], (s) => 0.4 + s.boost), L('air', [[570, 102], [600, 102], [600, 160], [560, 200]], (s) => 0.4 + s.boost),
    L('hot', [[450, 260], [400, 255]], (s) => 0.4 + s.boost), L('hot', [[345, 284], [345, 355], [290, 355]], (s) => 0.4 + s.boost),
    L('hot', [[610, 250], [710, 250], [710, 190]], (s) => s.egr), L('cool', [[710, 140], [710, 100], [600, 100]], (s) => s.egr),
    L('mech', [[345, 134], [345, 220]], (s) => 0.3 + s.boost),
  ],
  ctls: [
    { id: 'rpm', label: T('Обороты', 'Engine speed'), min: 750, max: 4200, step: 50, init: 1600, unit: 'rpm' },
    { id: 'load', label: T('Педаль', 'Pedal'), min: 0, max: 100, step: 5, init: 50, unit: '%' },
  ],
  live: (s) => {
    const boost = clamp((s.load / 100) * 1.4 * clamp((s.rpm - 900) / 900, 0, 1), 0, 1.4)
    const vanes = Math.round(clamp(100 - (s.rpm - 1000) / 30 - (1 - s.load / 100) * 30, 10, 100))
    const egr = s.load < 70 ? clamp((1 - s.load / 70) * 0.8, 0, 0.8) : 0
    s.boost = boost; s.egr = egr
    const t2 = 25 + 85 * boost, t3 = 25 + 22 * boost
    return { values: { comp: `+${boost.toFixed(2)} bar · ${Math.round(t2)} °C`, ic: `${Math.round(t3)} °C`, turb: `VNT ${vanes}%`, egr: `${Math.round(egr * 100)} %` },
      note: s.rpm < 1300 && s.load > 60 ? T('Турбояма: на низких оборотах выхлопа мало, ротор ещё не раскрутился. Лопатки VNT закрыты, чтобы разогнать газ и сократить задержку.', 'Turbo lag: at low rpm there is little exhaust and the rotor is not up to speed. The VNT vanes are closed to speed the gas up and shorten the delay.') : T('Энергия, которую иначе выбросили бы в трубу, крутит компрессор — двигатель 2,8 л работает как атмосферный объёмом ≈ 5–6 л.', 'Energy that would go out of the pipe drives the compressor — the 2.8 l engine breathes like a 5–6 l non-turbo one.') }
  },
  how: [
    T('Выхлоп крутит колесо турбины, общий вал крутит компрессор. Чем больше газа — тем выше наддув. На дизеле нет дросселя: мощность регулируется количеством топлива, воздуха всегда избыток.', 'Exhaust spins the turbine wheel, the shared shaft spins the compressor. More gas — more boost. A diesel has no throttle: power is set by the fuel quantity and there is always excess air.'),
    T('BMW B46: twin-scroll турбина — выхлоп цилиндров 1–4 и 2–3 идёт разными каналами, импульсы не мешают друг другу, наддув раньше; давление ограничивает перепускной клапан (wastegate).', 'BMW B46: a twin-scroll turbo — cylinders 1–4 and 2–3 exhaust through separate scrolls so pulses do not interfere and boost comes earlier; a wastegate limits the pressure.'),
  ],
  donts: [
    T('Не глушить сразу после нагрузки — дать турбине остыть 30–60 с.', 'Do not switch off straight after hard driving — let the turbo cool for 30–60 s.'),
    T('Не ездить с порванным воздуховодом или без фильтра — песок «съест» лопатки компрессора и цилиндры.', 'Do not drive with a split intake hose or no filter — sand eats the compressor wheel and the bores.'),
    T('Короткие поездки на холостых закоксовывают EGR и впуск сажей — раз в неделю нужна поездка под нагрузкой.', 'Short idling trips coke the EGR and intake with soot — a loaded drive once a week helps.'),
  ],
  numbers: [[T('Наддув 1GD-FTV', 'Boost 1GD-FTV'), '≈ 1.4 bar'], [T('Обороты ротора', 'Rotor speed'), 'до 200 000 rpm'], [T('Выхлоп перед турбиной', 'Exhaust before turbine'), '400–750 °C'], [T('Момент Fortuner', 'Fortuner torque'), '500 N·m @ 1600–2800']],
}

/* ------------------------------------------------------------------ exhaust aftertreatment */
const exhaust: SystemDef = {
  id: 'exhaust', group: 'car', title: T('Нейтрализатор и сажевый фильтр', 'Catalyst and particulate filter'),
  lead: T('Дизельный выхлоп: сажа, NOx, CO и углеводороды. Каждая ступень убирает своё.', 'Diesel exhaust: soot, NOx, CO and hydrocarbons. Each stage removes its own.'),
  parts: [
    P('turbo', 30, 200, 100, 50, 'После турбины', 'After the turbo', '≈ 250–600 °C.', '≈ 250–600 °C.', 'hot'),
    P('doc', 170, 190, 130, 70, 'DOC', 'DOC', 'Окислительный нейтрализатор: CO → CO₂, углеводороды → CO₂ + H₂O; при регенерации дожигает топливо и разогревает газ.', 'Oxidation catalyst: CO → CO₂, HC → CO₂ + H₂O; during regeneration it burns extra fuel to heat the gas.', 'hot'),
    P('dpf', 340, 180, 160, 90, 'DPF', 'DPF', 'Керамические соты с глухими каналами: газ проходит сквозь пористые стенки, сажа остаётся. Её надо периодически выжигать при ≈ 600 °C.', 'Ceramic honeycomb with blind channels: gas passes through the porous walls, soot stays. It must be burnt off at ≈ 600 °C now and then.', 'hot'),
    P('dp', 360, 90, 120, 40, 'Датчик перепада', 'Δp sensor', 'По разнице давлений до и после фильтра ЭБУ знает, насколько он забит.', 'The pressure drop across the filter tells the ECU how full it is.', 'ctrl'),
    P('scr', 540, 190, 120, 70, 'SCR (где есть)', 'SCR (if fitted)', 'Мочевина AdBlue → аммиак, который на катализаторе превращает NOx в азот и воду.', 'AdBlue urea → ammonia, which turns NOx into nitrogen and water on the catalyst.', 'cool'),
    P('muff', 690, 200, 90, 50, 'Глушитель', 'Silencer', 'Гасит звуковые волны.', 'Damps the pressure waves.', 'mech'),
  ],
  pipes: [L('hot', [[130, 225], [170, 225]], () => 0.6), L('hot', [[300, 225], [340, 225]], () => 0.6), L('hot', [[500, 225], [540, 225]], () => 0.6), L('hot', [[660, 225], [690, 225]], () => 0.6), L('ctrl', [[420, 130], [420, 180]])],
  ctls: [
    { id: 'soot', label: T('Сажа в фильтре', 'Soot load'), min: 0, max: 120, step: 5, init: 40, unit: '%' },
    { id: 'kmh', label: T('Скорость', 'Speed'), min: 0, max: 130, step: 5, init: 40, unit: 'km/h' },
  ],
  live: (s) => {
    const regen = s.soot > 80 && s.kmh > 55
    return { values: { dpf: `${s.soot}% · ${regen ? '600 °C REGEN' : `${Math.round(200 + s.kmh * 2.5)} °C`}`, dp: `${(5 + s.soot * 0.25).toFixed(0)} mbar`, doc: regen ? 'POST-INJ' : 'OK' },
      warn: s.soot > 100 ? ['dpf'] : [],
      note: s.soot > 100 ? T('Фильтр переполнен: ЭБУ включает аварийный режим и ограничивает мощность. Нужна сервисная регенерация.', 'The filter is overloaded: the ECU enters limp mode and limits power. A service regeneration is needed.')
        : s.soot > 80 && !regen ? T('Пора выжигать сажу, но скорость мала — газ не нагреется до 600 °C. Нужно 15–20 минут ровной езды по трассе.', 'Time to burn the soot off, but the speed is too low — the gas cannot reach 600 °C. It needs 15–20 minutes of steady highway driving.')
          : regen ? T('Идёт регенерация: поздний впрыск топлива сгорает в DOC, газ нагревается до ≈ 600 °C и сажа выгорает. Не глушите двигатель!', 'Regeneration: a late fuel shot burns in the DOC, the gas heats to ≈ 600 °C and the soot burns off. Do not switch off!')
            : T('Фильтр собирает сажу; её количество видно по перепаду давления.', 'The filter collects soot; the pressure drop shows how much.') }
  },
  how: [T('BMW (бензин): трёхкомпонентный нейтрализатор работает только при точном составе смеси λ = 1 — два кислородных датчика держат его. Современные бензиновые моторы с непосредственным впрыском тоже получили сажевый фильтр (GPF).', 'BMW (petrol): a three-way catalyst only works at an exact mixture of λ = 1 — two oxygen sensors hold it there. Modern direct-injection petrol engines also got a particulate filter (GPF).')],
  donts: [T('Не прерывать регенерацию — глушить мотор посреди выжигания.', 'Do not interrupt a regeneration by switching off.'), T('Не удалять фильтр «программно» — незаконно и вредно.', 'Do not delete the filter — illegal and harmful.'), T('Масло только low-SAPS: зола от присадок не выгорает и навсегда забивает соты.', 'Use low-SAPS oil only: additive ash does not burn and blocks the honeycomb for good.')],
  numbers: [[T('Температура регенерации', 'Regeneration temperature'), '≈ 600 °C'], [T('Задерживает частиц', 'Particle capture'), '> 95 %'], [T('Регенерация каждые', 'Regenerates every'), '300–800 km']],
}

/* ------------------------------------------------------------------ electrical */
const elec: SystemDef = {
  id: 'elec', group: 'car', title: T('Электрика и электроника', 'Electrics and electronics'),
  lead: T('Аккумулятор только запускает мотор. Дальше всё питает генератор, а десятки блоков управления общаются по шине CAN.', 'The battery only starts the engine. After that the alternator powers everything and dozens of control units talk over the CAN bus.'),
  parts: [
    P('bat', 40, 250, 120, 60, 'АКБ 12 В', '12 V battery', 'Свинцово-кислотная (AGM у BMW): ≈ 70–90 А·ч, стартовый ток 700–800 А.', 'Lead-acid (AGM on the BMW): ≈ 70–90 Ah, 700–800 A cranking.', 'elec'),
    P('start', 40, 360, 120, 50, 'Стартер', 'Starter', 'Электромотор ≈ 2 кВт: крутит маховик 150–250 об/мин; на морозе дизель берёт до 600 А.', 'A ≈ 2 kW motor turning the flywheel at 150–250 rpm; a cold diesel draws up to 600 A.', 'elec'),
    P('alt', 220, 250, 130, 60, 'Генератор', 'Alternator', 'Трёхфазный генератор с выпрямителем, ≈ 150 А; регулятор держит 13,8–14,6 В.', 'A three-phase alternator with a rectifier, ≈ 150 A; the regulator holds 13.8–14.6 V.', 'elec'),
    P('fuse', 400, 250, 110, 60, 'Блок предохранителей', 'Fuse box', 'Каждая цепь защищена предохранителем или «умным» силовым ключом.', 'Every circuit is protected by a fuse or a smart power switch.', 'elec'),
    P('ecu', 560, 100, 110, 50, 'ЭБУ двигателя', 'Engine ECU', 'Впрыск, наддув, EGR, диагностика.', 'Injection, boost, EGR, diagnostics.', 'ctrl'),
    P('tcu', 560, 170, 110, 40, 'Блок АКПП', 'TCU', 'Переключения, давление в фрикционах.', 'Shifts, clutch pressures.', 'ctrl'),
    P('abs', 560, 230, 110, 40, 'ABS/ESC', 'ABS/ESC', 'Датчики колёс, гироскоп рыскания.', 'Wheel sensors, yaw gyro.', 'ctrl'),
    P('body', 560, 290, 110, 40, 'Кузов, свет', 'Body, lights', 'Свет, стеклоподъёмники, замки, климат.', 'Lights, windows, locks, climate.', 'ctrl'),
    P('can', 700, 90, 50, 260, 'CAN', 'CAN', 'Две скрученные жилы, 500 кбит/с: блоки рассылают сообщения всем, каждый берёт своё.', 'Two twisted wires at 500 kbit/s: units broadcast messages, each takes what it needs.', 'ctrl'),
    P('glow', 220, 360, 130, 50, 'Свечи накала', 'Glow plugs', 'Дизель на морозе: раскаляют камеру до 1000 °C за секунды.', 'A cold diesel: heat the chamber to 1000 °C in seconds.', 'hot'),
  ],
  pipes: [
    L('elec', [[160, 280], [220, 280]], (s) => (s.eng ? -0.6 : 0.6)), L('elec', [[350, 280], [400, 280]], (s) => (s.eng ? 0.8 : 0)),
    L('elec', [[100, 310], [100, 360]], (s) => (s.eng ? 0 : 0)), L('elec', [[160, 300], [220, 385]], () => 0),
    L('elec', [[510, 270], [535, 270], [535, 120], [560, 120]], () => 0.5), L('elec', [[535, 190], [560, 190]], () => 0.5), L('elec', [[535, 250], [560, 250]], () => 0.5), L('elec', [[535, 300], [560, 310]], (s) => 0.3 + s.load / 120),
    L('ctrl', [[670, 125], [700, 125]]), L('ctrl', [[670, 190], [700, 190]]), L('ctrl', [[670, 250], [700, 250]]), L('ctrl', [[670, 310], [700, 310]]),
  ],
  ctls: [
    { id: 'eng', label: T('Двигатель', 'Engine'), min: 0, max: 1, step: 1, init: 1, options: [[0, T('заглушен', 'off')], [1, T('работает', 'running')]] },
    { id: 'load', label: T('Потребители', 'Consumers'), min: 10, max: 140, step: 10, init: 40, unit: 'A' },
  ],
  live: (s) => {
    if (s.eng) {
      const charge = Math.max(0, Math.min(150 - s.load, 25))
      const v = s.load > 145 ? 13.2 : 14.2
      return { values: { alt: `${Math.min(150, s.load + charge)} A · ${v} V`, bat: `+${charge} A`, fuse: `${s.load} A` }, note: T('Генератор питает всё и подзаряжает аккумулятор.', 'The alternator powers everything and recharges the battery.') }
    }
    const v = (12.6 - s.load * 0.006).toFixed(1), hours = (70 * 0.5 / s.load).toFixed(1)
    return { values: { alt: '0 A', bat: `−${s.load} A · ${v} V`, fuse: `${s.load} A` }, warn: ['bat'], note: T(`Мотор заглушен: всё питается от аккумулятора. При ${s.load} А до разряда, при котором уже не завести, ≈ ${hours} ч.`, `Engine off: everything runs on the battery. At ${s.load} A it is too flat to start in ≈ ${hours} h.`) }
  },
  how: [T('Генератор крутится ремнём от коленвала. Регулятор меняет ток возбуждения, чтобы напряжение оставалось ≈ 14,2 В при любых оборотах и нагрузке. У BMW — «умная» зарядка: генератор нагружают при торможении (рекуперация) и разгружают при разгоне.', 'The alternator is belt-driven from the crank. The regulator varies the field current to hold ≈ 14.2 V at any speed and load. The BMW has smart charging: the alternator is loaded on braking (energy recovery) and relieved when accelerating.')],
  donts: [T('Не отключать АКБ на работающем моторе — выброс напряжения сожжёт электронику.', 'Do not disconnect the battery with the engine running — the voltage spike kills electronics.'), T('Прикуривать в правильном порядке: «+» к «+», «−» на массу двигателя донора.', 'Jump-start in order: + to +, − to the engine ground of the donor.'), T('Не оставлять потребители с заглушённым мотором — дизель на морозе с полуразряженной АКБ не заведётся.', 'Do not leave things on with the engine off — a cold diesel will not start on a half-flat battery.')],
  numbers: [[T('Напряжение зарядки', 'Charging voltage'), '13.8–14.6 V'], [T('Генератор', 'Alternator'), '≈ 150 A'], [T('Блоков управления', 'Control units'), '30–100'], [T('Скорость CAN', 'CAN speed'), '500 kbit/s']],
}

/* ------------------------------------------------------------------ automatic transmission */
const at: SystemDef = {
  id: 'at', group: 'car', title: T('Автоматическая коробка', 'Automatic transmission'),
  lead: T('Нет сцепления и рычагов: гидротрансформатор соединяет мотор и коробку через масло, а передачи включают фрикционы в планетарных рядах — каждый раз по три (8HP) или по два (6AT).', 'No clutch pedal or gear lever: a torque converter joins engine and gearbox through oil, and gears are selected by clutches in planetary sets — three at a time (8HP) or two (6AT).'),
  widget: 'shift',
  parts: [
    P('tc', 40, 160, 150, 130, 'Гидротрансформатор', 'Torque converter', 'Насос (от мотора) разгоняет масло, оно крутит турбину (к коробке), реактор между ними разворачивает поток и умножает момент до ≈ 2 раз при трогании. На ходу муфта блокировки соединяет их жёстко.', 'The pump (engine side) flings oil at the turbine (gearbox side); the stator between them turns the flow back and multiplies torque up to ≈ 2× when pulling away. At speed the lock-up clutch joins them solidly.', 'oil'),
    P('ps', 230, 160, 280, 130, 'Планетарные ряды', 'Planetary gear sets', 'Солнце, сателлиты, водило, коронная шестерня. Держишь одно звено — получаешь одно передаточное число, соединяешь два — прямую передачу.', 'Sun, planets, carrier, ring. Hold one member — one ratio; lock two together — direct drive.', 'mech'),
    P('vb', 230, 330, 280, 60, 'Гидроблок + TCU', 'Valve body + TCU', 'Соленоиды по команде блока управления направляют масло под давлением к нужным фрикционам — переключение за 0,2–0,4 с.', 'Solenoids commanded by the TCU route pressurised oil to the right clutches — a shift in 0.2–0.4 s.', 'ctrl'),
    P('out', 560, 190, 120, 70, 'Выходной вал', 'Output shaft', 'К раздатке (Fortuner) или к кардану (BMW).', 'To the transfer case (Fortuner) or prop shaft (BMW).', 'mech'),
    P('cool', 560, 330, 120, 50, 'Охладитель ATF', 'ATF cooler', 'Масло АКПП охлаждается в радиаторе: перегрев > 120 °C губит фрикционы.', 'Gearbox fluid is cooled in the radiator: above 120 °C the clutches suffer.', 'cool'),
  ],
  pipes: [L('mech', [[190, 225], [230, 225]], () => 0.6), L('mech', [[510, 225], [560, 225]], () => 0.6), L('oil', [[370, 330], [370, 290]], () => 0.4), L('oil', [[510, 360], [560, 360]], () => 0.3)],
  how: [
    T('Гидротрансформатор позволяет стоять на передаче с работающим мотором: насос крутится, турбина стоит, масло проскальзывает — и греется. Поэтому долго стоять на тормозе с газом нельзя.', 'The converter lets the car stand in gear with the engine running: the pump turns, the turbine is still, the oil slips — and heats up. That is why you must not hold it on the brake with throttle for long.'),
    T('Переключение — это одновременная работа двух фрикционов: один отпускается, другой включается, давление в обоих рассчитано так, чтобы момент не прервался.', 'A shift is two clutches working at once: one releases while the other applies, pressures timed so torque never drops out.'),
    T('Режим ручного переключения — это просьба к блоку управления. Он откажет, если понижение раскрутит мотор выше красной зоны (в симуляторе это можно отключить «Защитами ЭБУ» — и увидеть результат).', 'Manual mode is a request to the TCU. It refuses a downshift that would over-rev the engine (in the simulator you can switch the “ECU guards” off and see the result).'),
  ],
  donts: [
    T('Не включать D/R на повышенных оборотах («бросок»).', 'Do not select D/R at high revs (neutral drop).'),
    T('Не включать R или P на ходу.', 'Do not select R or P while moving.'),
    T('Не держать машину на подъёме газом на месте и не делать долгий «стоп-тест».', 'Do not hold the car on a hill with throttle or do long stall tests.'),
    T('Не буксировать заднеприводный автомат на ведущих колёсах на большие расстояния: насос не работает — смазки нет.', 'Do not tow an automatic on its driven wheels far: the pump is not turning — no lubrication.'),
  ],
  numbers: [[T('Fortuner: Aisin 6AT', 'Fortuner: Aisin 6AT'), '3.60 … 0.58'], [T('BMW: ZF 8HP', 'BMW: ZF 8HP'), '5.00 … 0.64'], [T('Время переключения 8HP', '8HP shift time'), '≈ 0.2 s'], [T('Рабочая температура ATF', 'ATF operating temperature'), '70–95 °C']],
  sim: 'drive',
}

/* ------------------------------------------------------------------ 4WD and transfer case */
const xfer: SystemDef = {
  id: 'xfer', group: 'car', title: T('Полный привод и раздатка (Fortuner)', '4WD and transfer case (Fortuner)'),
  lead: T('У Fortuner подключаемый полный привод part-time: передний мост подключается жёстко, без межосевого дифференциала. Поэтому 4H — только для скользких покрытий.', 'The Fortuner has part-time 4WD: the front axle is locked in solidly with no centre differential. That is why 4H is for slippery surfaces only.'),
  parts: [
    P('at', 40, 190, 120, 70, 'АКПП', 'Gearbox', '', '', 'mech'),
    P('tc', 200, 170, 150, 110, 'Раздаточная коробка', 'Transfer case', 'Цепью передаёт момент на передний кардан; в 4L включает понижающий ряд 2,566 — момент на колёсах в 2,5 раза больше, скорость во столько же меньше.', 'A chain drives the front prop shaft; in 4L a 2.566 reduction gear engages — 2.5× the wheel torque at 2.5× lower speed.', 'mech'),
    P('front', 420, 60, 160, 60, 'Передний мост', 'Front axle', 'Подключается муфтой ADD (автоматический привод) — при 2H передние полуоси отсоединены и не крутят кардан.', 'Connected by the ADD coupling — in 2H the front half-shafts are disconnected and do not turn the prop shaft.', 'mech'),
    P('rear', 420, 330, 160, 60, 'Задний мост', 'Rear axle', 'Неразрезной мост; в части комплектаций — блокировка заднего дифференциала.', 'A live axle; some versions have a rear differential lock.', 'mech'),
    P('ctl', 620, 190, 140, 60, 'Переключатель 2H/4H/4L', '2H/4H/4L selector', '2H↔4H — на ходу до 100 км/ч. 4L — только стоя и в N.', '2H↔4H on the move up to 100 km/h. 4L only stopped and in N.', 'ctrl'),
  ],
  pipes: [L('mech', [[160, 225], [200, 225]], () => 0.6), L('mech', [[275, 170], [275, 90], [420, 90]], (s) => (s.mode > 0 ? 0.6 : 0)), L('mech', [[275, 280], [275, 360], [420, 360]], () => 0.6), L('ctrl', [[620, 220], [350, 220]])],
  ctls: [
    { id: 'mode', label: T('Режим', 'Mode'), min: 0, max: 2, step: 1, init: 0, options: [[0, T('2H', '2H')], [1, T('4H', '4H')], [2, T('4L', '4L')]] },
    { id: 'surf', label: T('Покрытие', 'Surface'), min: 0, max: 2, step: 1, init: 0, options: [[0, T('сухой асфальт', 'dry asphalt')], [1, T('гравий / снег', 'gravel / snow')], [2, T('грязь / песок', 'mud / sand')]] },
  ],
  live: (s) => {
    const bad = s.mode > 0 && s.surf === 0
    return { values: { tc: ['2H', '4H', '4L ×2.566'][s.mode], front: s.mode ? 'ON' : 'OFF' }, warn: bad ? ['tc', 'front'] : [],
      note: bad ? T('Опасно: на сухом асфальте в повороте передние колёса проходят больший путь, чем задние, но жёсткая связь заставляет их крутиться одинаково. Шины не могут проскользнуть — валы закручиваются, руль тяжелеет, раздатка ломается.', 'Danger: in a turn on dry asphalt the front wheels travel further than the rear, but the solid link forces them to turn together. The tyres cannot slip — the shafts wind up, the steering goes heavy, the transfer case breaks.')
        : s.mode === 0 && s.surf === 2 ? T('В грязи задний привод зароется. Включите 4H, а на крутом подъёме или тяжёлом бездорожье — 4L (остановиться, N, переключить).', 'In mud rear drive will dig in. Select 4H, and for steep climbs or heavy going 4L (stop, N, shift).')
          : T('Правильно: 2H на дорогах, 4H/4L на скользком — там шины могут слегка проскальзывать и снимать напряжение.', 'Correct: 2H on roads, 4H/4L on slippery ground — there the tyres can slip a little and relieve the strain.') }
  },
  how: [T('BMW 530i — задний привод (или xDrive: многодисковая муфта в раздатке, полный привод можно держать всегда, потому что муфта проскальзывает в поворотах).', 'BMW 530i — rear-wheel drive (or xDrive: a multi-plate clutch in the transfer case, so 4WD can stay on all the time because the clutch slips in turns).')],
  donts: [T('Не ездить в 4H/4L по сухому асфальту.', 'Do not drive in 4H/4L on dry asphalt.'), T('Не переключать 4L на ходу.', 'Do not shift into 4L while moving.'), T('Не включать блокировку заднего дифференциала на твёрдом покрытии и в поворотах на скорости.', 'Do not lock the rear differential on hard ground or when cornering at speed.')],
  numbers: [[T('Понижающий ряд', 'Low range'), '2.566 : 1'], [T('2H↔4H на ходу', '2H↔4H on the fly'), '≤ 100 km/h'], [T('Главная пара', 'Final drive'), '3.909']],
  sim: 'drive',
}

/* ------------------------------------------------------------------ differential */
const diff: SystemDef = {
  id: 'diff', group: 'car', title: T('Дифференциал', 'Differential'),
  lead: T('В повороте наружное колесо проходит больший путь. Дифференциал позволяет колёсам одного моста крутиться с разной скоростью, деля момент поровну.', 'In a turn the outer wheel travels further. The differential lets the wheels of one axle turn at different speeds while splitting the torque equally.'),
  widget: 'diff', parts: [], pipes: [],
  how: [
    T('Корпус с сателлитами крутит главная пара. Если сопротивление колёс равное — сателлиты не вращаются на своих осях, всё крутится как одно целое. В повороте сателлиты проворачиваются: одно колесо обгоняет корпус ровно настолько, насколько другое отстаёт.', 'The final drive turns the case with its spider gears. With equal resistance the spiders do not spin on their pins and everything turns as one. In a turn they rotate: one wheel gains on the case exactly as much as the other loses.'),
    T('Обратная сторона: момент делится поровну, поэтому если одно колесо на льду (держит 100 Н·м), на втором тоже только 100 Н·м — машина стоит, а одно колесо бешено крутится. Лечится блокировкой или электронной имитацией (подтормаживание буксующего колеса — TCS/A-TRC).', 'The catch: torque splits equally, so if one wheel is on ice (holding 100 N·m), the other also gets only 100 N·m — the car stays put while one wheel spins wildly. Cured by a lock or by electronics (braking the spinning wheel — TCS/A-TRC).'),
  ],
  donts: [T('Не включать блокировку на асфальте и в поворотах.', 'Do not lock the diff on asphalt or in turns.'), T('Не давать одному колесу долго буксовать с большой скоростью — сателлиты перегреются.', 'Do not let one wheel spin fast for long — the spider gears overheat.')],
  numbers: [[T('Главная пара Fortuner / BMW', 'Final drive Fortuner / BMW'), '3.909 / 2.81'], [T('Разница скоростей в повороте R10 м', 'Speed difference in a 10 m turn'), '≈ 16 %']],
}

/* ------------------------------------------------------------------ brakes */
const brakes: SystemDef = {
  id: 'brakes', group: 'car', title: T('Тормоза, ABS и ESC', 'Brakes, ABS and ESC'),
  lead: T('Нога давит ≈ 300 Н, а на колодках — тонны: рычаг педали, вакуумный усилитель и разница площадей поршней. Тормоза превращают движение в тепло.', 'Your foot pushes ≈ 300 N, the pads see tonnes: the pedal lever, the vacuum booster and the piston area ratio. Brakes turn motion into heat.'),
  parts: [
    P('pedal', 30, 200, 90, 60, 'Педаль', 'Pedal', 'Рычаг ≈ 4:1.', 'A ≈ 4:1 lever.', 'mech'),
    P('boost', 150, 190, 120, 80, 'Усилитель', 'Booster', 'Вакуум (от вакуумного насоса у дизеля) усиливает усилие в ≈ 5–7 раз. С заглушённым мотором запаса хватит на 2–3 нажатия.', 'Vacuum (from a vacuum pump on the diesel) multiplies the force ≈ 5–7×. With the engine off the reserve lasts 2–3 presses.', 'air'),
    P('mc', 300, 200, 110, 60, 'Главный цилиндр', 'Master cylinder', 'Два контура по диагонали: отказ одного оставит половину тормозов.', 'Two diagonal circuits: a failure in one still leaves half the brakes.', 'oil'),
    P('abs', 450, 180, 130, 100, 'Модулятор ABS/ESC', 'ABS/ESC modulator', 'Клапаны и насос: удерживают, сбрасывают и снова поднимают давление в каждом колесе 10–15 раз в секунду; ESC может тормозить колесо сам.', 'Valves and a pump: hold, release and re-apply pressure at each wheel 10–15 times a second; ESC can brake a wheel by itself.', 'ctrl'),
    P('fl', 640, 60, 120, 60, 'Передний суппорт', 'Front caliper', 'Передние делают ≈ 65–70 % работы — вес переносится вперёд.', 'The fronts do ≈ 65–70 % of the work — weight moves forward.', 'hot'),
    P('rl', 640, 330, 120, 60, 'Задний суппорт', 'Rear caliper', 'Ручник действует на задние.', 'The handbrake works on the rears.', 'hot'),
    P('sens', 450, 330, 130, 50, 'Датчики', 'Sensors', 'Скорость каждого колеса, угол руля, гироскоп рыскания, поперечное ускорение.', 'Each wheel’s speed, steering angle, yaw gyro, lateral acceleration.', 'ctrl'),
  ],
  pipes: [L('mech', [[120, 230], [150, 230]], (s) => s.pedal / 100), L('mech', [[270, 230], [300, 230]], (s) => s.pedal / 100), L('oil', [[410, 230], [450, 230]], (s) => s.pedal / 100, 4), L('oil', [[580, 210], [610, 210], [610, 90], [640, 90]], (s) => s.pedal / 100), L('oil', [[580, 250], [610, 250], [610, 360], [640, 360]], (s) => s.pedal / 100), L('ctrl', [[515, 330], [515, 280]])],
  ctls: [
    { id: 'pedal', label: T('Педаль', 'Pedal'), min: 0, max: 100, step: 5, init: 50, unit: '%' },
    { id: 'mu', label: T('Покрытие', 'Surface'), min: 0, max: 2, step: 1, init: 0, options: [[0, T('сухо μ≈1', 'dry μ≈1')], [1, T('мокро μ≈0,6', 'wet μ≈0.6')], [2, T('лёд μ≈0,12', 'ice μ≈0.12')]] },
    { id: 'eng', label: T('Двигатель', 'Engine'), min: 0, max: 1, step: 1, init: 1, options: [[0, T('заглушен', 'off')], [1, T('работает', 'running')]] },
  ],
  live: (s) => {
    const mu = [1, 0.6, 0.12][s.mu]
    const assist = s.eng ? 6 : 1
    const bar = (s.pedal / 100) * 300 * 4 * assist / 1000 * 18 // rough line pressure
    const demand = clamp(bar / 120, 0, 1.2) // g the driver asks for
    const absOn = demand > mu * 0.95
    const dec = Math.min(demand, mu)
    return { values: { mc: `${Math.round(bar)} bar`, abs: absOn ? 'ABS ●●●' : 'OPEN', fl: `${(dec * 9.81).toFixed(1)} m/s²`, boost: s.eng ? '×6' : '×1' }, warn: absOn ? ['abs'] : !s.eng ? ['boost'] : [],
      note: absOn ? T(`Водитель просит ${demand.toFixed(2)} g, а шина может ${mu.toFixed(2)} g. Колесо начинает блокироваться — ABS сбрасывает давление и держит проскальзывание ≈ 10 %: максимум сцепления и машина рулится.`, `The driver asks for ${demand.toFixed(2)} g, the tyre can give ${mu.toFixed(2)} g. The wheel starts to lock — ABS dumps pressure and holds ≈ 10 % slip: maximum grip and the car still steers.`)
        : !s.eng ? T('Без работающего мотора нет вакуума: та же педаль даёт в 6 раз меньше давления. Тормоза работают, но давить надо очень сильно.', 'With the engine off there is no vacuum: the same pedal gives 6× less pressure. The brakes still work but need a very hard push.') : T('Давление пропорционально педали; замедление ограничено сцеплением шин.', 'Pressure follows the pedal; deceleration is limited by tyre grip.') }
  },
  how: [T('Кинетическая энергия 2-тонной машины на 100 км/ч ≈ 0,8 МДж — это нагрев дисков на 60–70 °C за одно торможение. На длинном спуске тормоза могут нагреться до 600 °C и «поплыть» (фейдинг) — поэтому на спусках тормозят двигателем.', 'A 2-tonne car at 100 km/h carries ≈ 0.8 MJ — that heats the discs by 60–70 °C per stop. On a long descent they can reach 600 °C and fade — which is why you use engine braking downhill.'), T('ESC сравнивает желаемую траекторию (угол руля + скорость) с реальной (гироскоп). При заносе тормозит наружное переднее колесо, при сносе — внутреннее заднее, и снижает тягу.', 'ESC compares the intended path (steering angle + speed) with the real one (yaw gyro). In oversteer it brakes the outer front wheel, in understeer the inner rear, and cuts power.')],
  donts: [T('Не держать ногу на тормозе на длинном спуске — использовать низкую передачу.', 'Do not ride the brakes downhill — use a low gear.'), T('Не глушить мотор на ходу: пропадут усилители тормозов и руля.', 'Never switch off while moving: brake and steering assist disappear.'), T('Менять тормозную жидкость раз в 2 года: она впитывает воду и закипает в суппортах.', 'Change brake fluid every 2 years: it absorbs water and boils in the calipers.')],
  numbers: [[T('Давление в контуре', 'Line pressure'), 'до 150–200 bar'], [T('Циклов ABS', 'ABS cycles'), '10–15 /s'], [T('Фейдинг колодок', 'Pad fade'), '> 550 °C']],
  sim: 'drive',
}

/* ------------------------------------------------------------------ steering & suspension */
const steer: SystemDef = {
  id: 'steer', group: 'car', title: T('Рулевое управление', 'Steering'),
  lead: T('Руль поворачивает шестерню, она двигает рейку, рейка через тяги — поворотные кулаки. Усилитель добавляет силы.', 'The wheel turns a pinion that moves a rack; tie rods turn the steering knuckles. Power assist adds force.'),
  parts: [
    P('wheel', 40, 60, 120, 60, 'Руль', 'Wheel', 'Fortuner ≈ 3,3 оборота от упора до упора.', 'Fortuner ≈ 3.3 turns lock to lock.', 'mech'),
    P('rack', 220, 230, 360, 50, 'Рейка с шестернёй', 'Rack and pinion', '', '', 'mech'),
    P('assist', 280, 100, 240, 60, 'Усилитель', 'Assist', 'Fortuner: гидроусилитель — насос от мотора давит масло в цилиндр на рейке. BMW: электроусилитель — мотор на рейке, сила зависит от скорости (на парковке легко, на трассе туго).', 'Fortuner: hydraulic — an engine-driven pump pushes oil into a cylinder on the rack. BMW: electric — a motor on the rack, assist falls with speed (light when parking, firm on the motorway).', 'oil'),
    P('kn', 620, 200, 140, 110, 'Кулаки и колёса', 'Knuckles and wheels', 'Схождение, развал и кастер держат машину прямо и возвращают руль.', 'Toe, camber and caster keep the car straight and return the wheel.', 'mech'),
  ],
  pipes: [L('mech', [[100, 120], [100, 255], [220, 255]], () => 0.3), L('oil', [[400, 160], [400, 230]], (s) => s.assist), L('mech', [[580, 255], [620, 255]], () => 0.3)],
  ctls: [{ id: 'kmh', label: T('Скорость', 'Speed'), min: 0, max: 160, step: 10, init: 20, unit: 'km/h' }],
  live: (s) => { const a = clamp(1 - s.kmh / 180, 0.25, 1); s.assist = a; return { values: { assist: `BMW ${Math.round(a * 100)} % · Fortuner 100 %` }, note: T('Электроусилитель BMW уменьшает помощь с ростом скорости: руль тяжелеет — так точнее на трассе. Гидроусилитель Fortuner помогает почти одинаково.', 'The BMW’s electric assist reduces with speed: the wheel firms up — more precise on the motorway. The Fortuner’s hydraulic assist is almost constant.') } },
  how: [T('Подвеска: Fortuner — двухрычажная спереди и неразрезной мост на пружинах сзади (выдерживает бездорожье и прицеп); BMW — двухрычажная спереди и многорычажная сзади (каждое колесо независимо — лучше держит дорогу). Амортизатор гасит колебания пружины, стабилизатор уменьшает крен.', 'Suspension: Fortuner — double wishbones in front and a live axle on coils at the rear (tough off-road and with a trailer); BMW — double wishbones in front and multi-link at the rear (each wheel independent — better road holding). Dampers kill spring oscillation, anti-roll bars cut roll.')],
  donts: [T('Не держать руль в крайнем положении дольше нескольких секунд — насос ГУР работает на предохранительном клапане и греет масло.', 'Do not hold the wheel on full lock for more than a few seconds — the power-steering pump runs against its relief valve and heats the oil.'), T('После удара о бордюр — проверить развал-схождение.', 'After hitting a kerb — check the alignment.')],
  numbers: [[T('Высота центра тяжести Fortuner / BMW', 'CG height Fortuner / BMW'), '0.78 / 0.52 m'], [T('Статический запас против опрокидывания t/2h', 'Static stability t/2h'), '0.99 / 1.54 g']],
}

/* ------------------------------------------------------------------ climate */
const hvac: SystemDef = {
  id: 'hvac', group: 'car', title: T('Климат-контроль', 'Climate control'),
  lead: T('Кондиционер — тепловой насос: забирает тепло из салона и выбрасывает наружу, испаряя и конденсируя хладагент.', 'The air conditioner is a heat pump: it takes heat out of the cabin and dumps it outside by evaporating and condensing a refrigerant.'),
  parts: [
    P('comp', 40, 200, 120, 60, 'Компрессор', 'Compressor', 'С приводом от ремня; сжимает газ R1234yf до ≈ 15 бар и 80 °C.', 'Belt-driven; compresses R1234yf gas to ≈ 15 bar and 80 °C.', 'hot'),
    P('cond', 220, 60, 140, 60, 'Конденсатор', 'Condenser', 'Перед радиатором: горячий газ отдаёт тепло воздуху и становится жидкостью.', 'In front of the radiator: the hot gas gives heat to the air and condenses.', 'hot'),
    P('txv', 420, 60, 120, 60, 'ТРВ', 'Expansion valve', 'Узкое отверстие: давление падает, жидкость резко охлаждается до ≈ 0 °C.', 'A narrow orifice: pressure drops and the liquid chills to ≈ 0 °C.', 'ctrl'),
    P('evap', 420, 220, 120, 70, 'Испаритель', 'Evaporator', 'В панели: холодный хладагент кипит, забирая тепло у воздуха салона; влага из воздуха конденсируется (поэтому под машиной капает вода).', 'In the dash: the cold refrigerant boils, taking heat from the cabin air; moisture condenses out (that is the water dripping under the car).', 'cool'),
    P('heat', 600, 220, 120, 70, 'Радиатор печки', 'Heater core', 'Подогрев от охлаждающей жидкости; заслонка смешивает холодный и тёплый потоки.', 'Heat from the coolant; a blend door mixes cold and warm streams.', 'hot'),
    P('cabin', 600, 360, 120, 40, 'Салон', 'Cabin', '', '', 'air'),
  ],
  pipes: [L('hot', [[100, 200], [100, 90], [220, 90]], () => 0.6), L('hot', [[360, 90], [420, 90]], () => 0.6), L('cool', [[480, 120], [480, 220]], () => 0.6), L('cool', [[420, 255], [160, 255], [160, 230]], () => 0.6), L('air', [[480, 290], [480, 380], [600, 380]], () => 0.5), L('air', [[660, 290], [660, 360]], () => 0.4)],
  how: [T('Зимой у дизеля мало лишнего тепла — Fortuner может иметь электрический или топливный догреватель. Кондиционер зимой включают для осушения воздуха — стёкла не потеют.', 'In winter a diesel has little spare heat — the Fortuner may have an electric or fuel-fired heater. The A/C runs in winter to dry the air so the windows do not mist.')],
  donts: [T('Не дуть ледяным воздухом в лицо при +40 снаружи — разница больше 7–8 °C вредна.', 'Do not blast ice-cold air in your face at +40 outside — more than 7–8 °C difference is unhealthy.'), T('Раз в месяц включать кондиционер даже зимой — масло в хладагенте смазывает уплотнения компрессора.', 'Run the A/C monthly even in winter — the oil in the refrigerant lubricates the compressor seals.')],
  numbers: [[T('Хладагент', 'Refrigerant'), 'R1234yf'], [T('Холодопроизводительность', 'Cooling capacity'), '≈ 5–6 kW']],
}

/* ------------------------------------------------------------------ safety */
const safety: SystemDef = {
  id: 'safety', group: 'car', title: T('Пассивная безопасность', 'Passive safety'),
  lead: T('При ударе на 50 км/ч машина останавливается за ≈ 0,1 с. Задача кузова и ремней — растянуть это время для людей и не дать салону смяться.', 'In a 50 km/h crash the car stops in ≈ 0.1 s. The body and belts must stretch that time for the people and keep the cabin intact.'),
  parts: [
    P('crumple', 40, 180, 160, 90, 'Зона деформации', 'Crumple zone', 'Передние лонжероны сминаются гармошкой, поглощая энергию на 50–60 см.', 'The front rails fold like an accordion, absorbing energy over 50–60 cm.', 'mech'),
    P('cell', 240, 160, 240, 130, 'Каркас салона', 'Safety cell', 'Из сверхпрочной горячештампованной стали: не должен деформироваться.', 'Hot-formed ultra-high-strength steel: must not deform.', 'mech'),
    P('belt', 520, 100, 120, 60, 'Ремни', 'Belts', 'Пиропатрон натяжителя выбирает слабину за 10 мс, ограничитель затем «отпускает» лямку, чтобы не сломать рёбра.', 'A pyrotechnic pretensioner takes up slack in 10 ms, then a load limiter pays out webbing so ribs do not break.', 'ctrl'),
    P('airbag', 520, 220, 120, 60, 'Подушки', 'Airbags', 'Надуваются за 30 мс газом из генератора; работают только вместе с пристёгнутым ремнём.', 'Inflate in 30 ms from a gas generator; work only together with a fastened belt.', 'ctrl'),
    P('sens', 680, 160, 100, 60, 'Датчики удара', 'Crash sensors', 'Акселерометры решают за 15–20 мс, срабатывать или нет.', 'Accelerometers decide within 15–20 ms whether to fire.', 'ctrl'),
  ],
  pipes: [L('ctrl', [[680, 190], [640, 130]]), L('ctrl', [[680, 200], [640, 250]])],
  how: [T('Внедорожник на раме (Fortuner) тяжелее и выше; седан с несущим кузовом (BMW) лучше распределяет энергию удара. Высокий центр тяжести — главный риск опрокидывания, его компенсирует ESC.', 'A body-on-frame SUV (Fortuner) is heavier and taller; a monocoque sedan (BMW) spreads crash energy better. The high CG is the main rollover risk, mitigated by ESC.')],
  donts: [T('Не ставить детское кресло против хода на сиденье с активной подушкой.', 'Never put a rear-facing child seat in front of an active airbag.'), T('Не ездить без ремня: подушка без ремня травмирует.', 'Do not ride unbelted: an airbag without a belt injures.')],
  numbers: [[T('Время срабатывания подушки', 'Airbag deploy time'), '≈ 30 ms'], [T('Перегрузка при ударе 50 км/ч', 'Deceleration at 50 km/h'), '30–40 g']],
}

export const CAR_SYSTEMS: SystemDef[] = [cooling, lube, fuel, air, exhaust, elec, at, xfer, diff, brakes, steer, hvac, safety]
