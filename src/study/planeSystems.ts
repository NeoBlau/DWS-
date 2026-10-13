import { T } from '../explorer/i18n'
import type { Part, Pipe, SystemDef, St, Tone } from './atlasTypes'

/*
 * Aircraft systems atlas — Airbus A320 family (representative), and the «Вихрь-240» concept.
 * The first entry is a live trainer: the same systems model the flight simulator runs on.
 */
const P = (id: string, x: number, y: number, w: number, h: number, ru: string, en: string, iru: string, ien: string, tone?: Tone): Part => ({ id, x, y, w, h, label: T(ru, en), info: T(iru, ien), tone })
const L = (tone: Tone, pts: [number, number][], flow?: (s: St) => number, w?: number): Pipe => ({ tone, pts, flow, w })
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

const trainer: SystemDef = {
  id: 'trainer', group: 'plane', title: T('Тренажёр систем A320 — живой', 'A320 systems trainer — live'),
  lead: T('Холодный обесточенный самолёт у терминала. Это та же модель систем, на которой летает симулятор: включайте аккумуляторы, питание, ВСУ, отбор воздуха, насосы, выставку ИНС и запускайте двигатели — и смотрите, как оживают электросеть, гидросистемы и топливо.', 'A cold, dark aircraft at the gate. It is the same systems model the simulator flies on: switch on the batteries, power, APU, bleed, pumps, IR alignment and start the engines — and watch the electrics, hydraulics and fuel come alive.'),
  widget: 'trainer', parts: [], pipes: [],
  how: [
    T('Порядок подготовки: BAT 1+2 → EXT PWR → IR NAV (выставка 90 с, не двигаться) → APU MASTER, START → APU BLEED, PACK OFF → насосы топлива → BEACON → ENG MODE IGN/START → MASTER 2, затем 1 → ENG MODE NORM, APU BLEED OFF, PACKs ON.', 'Preparation order: BAT 1+2 → EXT PWR → IR NAV (90 s alignment, do not move) → APU MASTER, START → APU BLEED, PACKs OFF → fuel pumps → BEACON → ENG MODE IGN/START → MASTER 2, then 1 → ENG MODE NORM, APU BLEED OFF, PACKs ON.'),
    T('Попробуйте ошибки: MASTER без IGN/START, запуск с включёнными PACK (мало давления), РУД не на IDLE при запуске (горячий запуск), отказ генератора или утечку гидросистемы в разделе «Тренировка отказов».', 'Try the mistakes: MASTER without IGN/START, a start with PACKs on (not enough pressure), thrust lever off IDLE during a start (hot start), a generator fault or hydraulic leak in “Failure training”.'),
  ],
  donts: [T('Не двигать самолёт во время выставки ИНС.', 'Do not move the aircraft during IR alignment.'), T('Не уезжать с подключённым аэродромным питанием.', 'Do not taxi away with ground power connected.'), T('Не запускать двигатель с РУД не на малом газе.', 'Do not start an engine with the thrust lever off idle.')],
  numbers: [[T('Сеть переменного тока', 'AC network'), '115 V 400 Hz'], [T('Гидросистемы', 'Hydraulics'), '3 × 3000 psi'], [T('Отбор от ВСУ', 'APU bleed'), '≈ 36 psi']],
  sim: 'flight',
}

/* ------------------------------------------------------------------ flight controls */
const SURF: [string, string, string, string][] = [['elev', 'Руль высоты', 'Elevators', 'GBY'], ['ths', 'Стабилизатор', 'Stabiliser', 'GY'], ['ail', 'Элероны', 'Ailerons', 'GB'], ['spl', 'Интерцепторы', 'Spoilers', 'GBY'], ['rud', 'Руль направления', 'Rudder', 'GBY'], ['slat', 'Предкрылки', 'Slats', 'GB'], ['flap', 'Закрылки', 'Flaps', 'GY']]
const fbw: SystemDef = {
  id: 'fbw', group: 'plane', title: T('Управление и fly-by-wire', 'Flight controls and fly-by-wire'),
  lead: T('Между сайдстиком и рулями нет тросов: команды идут проводами в 7 компьютеров, а рули двигают гидроприводы от трёх независимых систем.', 'There are no cables between the sidestick and the surfaces: commands go by wire to 7 computers, and the surfaces are moved by actuators on three independent hydraulic systems.'),
  parts: [
    P('stick', 30, 60, 110, 60, 'Сайдстики', 'Sidesticks', 'Задают перегрузку (тангаж) и угловую скорость крена, а не угол руля.', 'Command load factor (pitch) and roll rate, not a surface angle.', 'ctrl'),
    P('elac', 190, 30, 130, 50, 'ELAC 1, 2', 'ELAC 1, 2', 'Руль высоты, стабилизатор, элероны; нормальный закон.', 'Elevators, stabiliser, ailerons; normal law.', 'ctrl'),
    P('sec', 190, 100, 130, 50, 'SEC 1, 2, 3', 'SEC 1, 2, 3', 'Интерцепторы и резерв для руля высоты/стабилизатора.', 'Spoilers and back-up for the elevators/stabiliser.', 'ctrl'),
    P('fac', 190, 170, 130, 50, 'FAC 1, 2', 'FAC 1, 2', 'Руль направления: демпфер рыскания, координация, ограничение хода по скорости.', 'Rudder: yaw damper, turn coordination, travel limit vs speed.', 'ctrl'),
    P('adiru', 30, 200, 110, 60, 'ADIRU × 3', 'ADIRU × 3', 'Углы, угловые скорости, скорость, высота, угол атаки — без них законы управления не работают.', 'Attitudes, rates, airspeed, altitude, angle of attack — the laws cannot work without them.', 'ctrl'),
    ...SURF.map(([id, ru, en], i) => P(id, 400 + (i % 2) * 200, 30 + Math.floor(i / 2) * 90, 170, 56, ru, en, '', '', 'mech')),
  ],
  pipes: [L('ctrl', [[140, 90], [190, 55]]), L('ctrl', [[140, 90], [190, 125]]), L('ctrl', [[140, 90], [165, 195], [190, 195]]), L('ctrl', [[140, 230], [165, 230], [165, 195]]),
    L('ctrl', [[320, 55], [400, 58]]), L('ctrl', [[320, 55], [360, 55], [360, 148], [400, 148]]), L('ctrl', [[320, 125], [380, 125], [380, 240], [400, 238]]), L('ctrl', [[320, 195], [560, 195], [560, 240], [600, 238]])],
  ctls: [
    { id: 'G', label: T('Зелёная ГС', 'Green hyd'), min: 0, max: 1, step: 1, init: 1, options: [[1, T('есть', 'on')], [0, T('отказ', 'lost')]] },
    { id: 'B', label: T('Синяя ГС', 'Blue hyd'), min: 0, max: 1, step: 1, init: 1, options: [[1, T('есть', 'on')], [0, T('отказ', 'lost')]] },
    { id: 'Y', label: T('Жёлтая ГС', 'Yellow hyd'), min: 0, max: 1, step: 1, init: 1, options: [[1, T('есть', 'on')], [0, T('отказ', 'lost')]] },
    { id: 'ir', label: T('ADIRS', 'ADIRS'), min: 0, max: 1, step: 1, init: 1, options: [[1, T('NAV', 'NAV')], [0, T('нет данных', 'no data')]] },
  ],
  live: (s) => {
    const values: Record<string, string> = {}, warn: string[] = []
    for (const [id, , , sys] of SURF) {
      const av = sys.split('').filter((k) => s[k]).length
      values[id] = `${sys.split('').join('·')} → ${av ? (av === sys.length ? 'OK' : `${av}/${sys.length}`) : 'LOST'}`
      if (!av) warn.push(id)
    }
    const pairsLost = ['GB', 'GY', 'BY'].some((p) => !s[p[0]] && !s[p[1]])
    const law = !s.ir ? 'DIRECT' : pairsLost ? 'ALTERNATE' : 'NORMAL'
    values.elac = law
    return { values, warn, note: law === 'NORMAL' ? T('Нормальный закон: ручка задаёт перегрузку, работают защиты по углу атаки, крену, тангажу, скорости и перегрузке.', 'Normal law: the stick commands load factor; protections guard angle of attack, bank, pitch, speed and load.') : law === 'ALTERNATE' ? T('Альтернативный закон: потеряны две гидросистемы — часть рулей недоступна, защиты по углу атаки и крену сняты, остаётся ограничение перегрузки.', 'Alternate law: two hydraulic systems lost — some surfaces are gone, the alpha and bank protections drop out, only the load limit remains.') : T('Прямой закон: нет данных ИНС — ручка напрямую отклоняет рули, триммировать вручную.', 'Direct law: no inertial data — the stick moves the surfaces directly, trim by hand.') }
  },
  how: [T('Каждая поверхность получает питание от 2–3 гидросистем и управляется 2–3 компьютерами разной разработки (разные процессоры и программы) — один дефект не может вывести из строя всё. При полной потере электричества остаётся механический резерв: колесо триммера стабилизатора и педали руля направления.', 'Each surface is powered by 2–3 hydraulic systems and commanded by 2–3 computers of different design (different processors and software) — no single defect can take everything out. With total electrical loss a mechanical back-up remains: the stabiliser trim wheel and the rudder pedals.')],
  donts: [T('Не «бороться» двумя сайдстиками — команды суммируются (кнопка приоритета).', 'Do not fight with both sidesticks — inputs add up (use the priority button).'), T('В прямом законе нет защит: перегрузка > 2,5 g деформирует конструкцию, > 3,75 g — разрушит.', 'Direct law has no protections: more than 2.5 g overstresses the structure, 3.75 g breaks it.')],
  numbers: [[T('Компьютеров управления', 'Flight-control computers'), '7'], [T('Макс. перегрузка (нормальный закон)', 'Max load (normal law)'), '+2.5 / −1 g'], [T('Предел крена', 'Bank limit'), '67°']],
  sim: 'flight',
}

/* ------------------------------------------------------------------ engines & FADEC */
const engines: SystemDef = {
  id: 'engines', group: 'plane', title: T('Двигатели и FADEC', 'Engines and FADEC'),
  lead: T('CFM56/LEAP: вентилятор даёт ≈ 80 % тяги, ядро — газогенератор. FADEC — двухканальный компьютер на двигателе, который делает всё: дозирует топливо, запускает, защищает.', 'CFM56/LEAP: the fan gives ≈ 80 % of the thrust, the core is the gas generator. FADEC — a dual-channel computer on the engine that does it all: meters fuel, starts, protects.'),
  parts: [
    P('fan', 30, 120, 90, 180, 'Вентилятор (N1)', 'Fan (N1)', 'Ø 1,7–2 м; обходной поток в 6–11 раз больше потока через ядро.', 'Ø 1.7–2 m; the bypass flow is 6–11 times the core flow.', 'air'),
    P('lpc', 140, 160, 70, 100, 'КНД', 'Booster', '', '', 'air'),
    P('hpc', 230, 160, 110, 100, 'КВД (N2)', 'HPC (N2)', '9 ступеней, сжатие ≈ ×30 всего.', '9 stages, ≈ 30× overall pressure ratio.', 'air'),
    P('cc', 360, 160, 90, 100, 'Камера сгорания', 'Combustor', '20 форсунок, ≈ 1500–1700 °C на выходе.', '20 nozzles, ≈ 1500–1700 °C at the exit.', 'hot'),
    P('hpt', 470, 160, 70, 100, 'ТВД', 'HPT', 'Крутит КВД.', 'Drives the HPC.', 'hot'),
    P('lpt', 560, 160, 100, 100, 'ТНД', 'LPT', 'Крутит вентилятор и КНД через внутренний вал.', 'Drives the fan and booster through the inner shaft.', 'hot'),
    P('fadec', 300, 330, 140, 60, 'FADEC', 'FADEC', 'Получает РУД, давление, температуры, обороты; управляет дозатором, клапанами перепуска, стартером, зажиганием.', 'Reads the lever, pressures, temperatures and speeds; drives the fuel metering, bleed valves, starter and igniters.', 'ctrl'),
    P('fmu', 460, 330, 120, 60, 'Дозатор топлива', 'Fuel metering unit', '', '', 'fuel'),
    P('start', 140, 330, 120, 60, 'Воздушный стартер', 'Air starter', 'Воздух ВСУ крутит N2 через коробку приводов.', 'APU air spins N2 through the accessory gearbox.', 'air'),
  ],
  pipes: [L('air', [[120, 210], [140, 210]], (s) => 0.3 + s.lever), L('air', [[210, 210], [230, 210]], (s) => 0.3 + s.lever), L('air', [[340, 210], [360, 210]], (s) => 0.3 + s.lever), L('hot', [[450, 210], [470, 210]], (s) => 0.3 + s.lever), L('hot', [[540, 210], [560, 210]], (s) => 0.3 + s.lever), L('hot', [[660, 210], [760, 210]], (s) => 0.3 + s.lever),
    L('air', [[120, 130], [760, 130]], (s) => 0.4 + s.lever), L('air', [[120, 290], [760, 290]], (s) => 0.4 + s.lever), L('ctrl', [[440, 360], [460, 360]]), L('fuel', [[520, 330], [420, 260]], (s) => 0.2 + s.lever), L('air', [[200, 330], [260, 260]], () => 0)],
  ctls: [{ id: 'lever', label: T('РУД', 'Thrust lever'), min: 0, max: 1, step: 0.05, init: 0.3 }],
  live: (s) => {
    const n1 = 20 + 76 * Math.pow(s.lever, 0.8), n2 = 58 + (n1 - 19.5) * 0.55, egt = 420 + 430 * s.lever, ff = 280 + 3400 * Math.pow(s.lever, 1.7), T = 120 * Math.pow(s.lever, 1.7)
    return { values: { fan: `${n1.toFixed(0)} %`, hpc: `${n2.toFixed(0)} %`, cc: `EGT ${Math.round(egt)} °C`, fmu: `${Math.round(ff)} kg/h`, lpt: `${T.toFixed(0)} kN` } }
  },
  how: [T('Пилот двигает РУД, FADEC выбирает режим: IDLE, CL, FLX/MCT, TOGA. Он сам не даст превысить обороты и EGT, сам прервёт неудачный запуск. Подробно — 3D-разбор двигателя в разделе «Реактивный двигатель».', 'The pilot moves the lever, FADEC sets the mode: IDLE, CL, FLX/MCT, TOGA. It will not let the speeds or EGT exceed limits and aborts a bad start itself. In depth — the 3D engine dive in “Jet engine”.')],
  donts: [T('Не держать TOGA дольше 5–10 мин.', 'Do not hold TOGA beyond 5–10 min.'), T('Не запускать с РУД не на IDLE.', 'Do not start with the lever off IDLE.'), T('Реверс — только на земле и до ≈ 70 уз полный.', 'Reverse — on the ground only, full reverse down to ≈ 70 kt.')],
  numbers: [[T('Тяга CFM56-5B', 'CFM56-5B thrust'), '≈ 120 kN'], [T('Степень двухконтурности', 'Bypass ratio'), '6 (LEAP 11)'], [T('Предел EGT при запуске', 'Start EGT limit'), '725 °C']],
  sim: 'flight',
}

/* ------------------------------------------------------------------ landing gear, brakes, steering */
const gear: SystemDef = {
  id: 'gear', group: 'plane', title: T('Шасси, тормоза, руление', 'Landing gear, brakes, steering'),
  lead: T('Шасси убирается и выпускается зелёной гидросистемой; тормоза — зелёная (нормальные) или жёлтая с аккумулятором (запасные); носовое колесо поворачивает жёлтая.', 'The gear is raised and lowered by the green system; the brakes use green (normal) or yellow with an accumulator (alternate); the nose wheel is steered by yellow.'),
  parts: [
    P('lever', 30, 40, 110, 50, 'Рычаг шасси', 'Gear lever', '', '', 'ctrl'),
    P('lgciu', 180, 40, 130, 50, 'LGCIU', 'LGCIU', 'Блок, который знает «самолёт на земле или в воздухе» по обжатию амортизаторов — это нужно десяткам систем.', 'The unit that knows “on ground or airborne” from strut compression — dozens of systems need it.', 'ctrl'),
    P('gact', 380, 40, 150, 50, 'Приводы уборки', 'Retraction actuators', '', '', 'G'),
    P('grav', 580, 40, 170, 50, 'Аварийный выпуск', 'Gravity extension', 'Ручкой открываются замки, шасси выпадает под весом за ≈ 25 с.', 'A handle releases the uplocks; the gear free-falls in ≈ 25 s.', 'mech'),
    P('bn', 180, 170, 150, 50, 'Тормоза NORM', 'Normal brakes', 'Зелёная ГС, антиюз, автомат торможения.', 'Green system, anti-skid, autobrake.', 'G'),
    P('ba', 380, 170, 150, 50, 'Тормоза ALTN', 'Alternate brakes', 'Жёлтая ГС; если нет — аккумулятор на ≈ 7 полных нажатий.', 'Yellow system; if lost — an accumulator good for ≈ 7 full applications.', 'Y'),
    P('pb', 580, 170, 170, 50, 'Стояночный тормоз', 'Parking brake', 'От жёлтой ГС/аккумулятора.', 'From yellow/accumulator.', 'Y'),
    P('nws', 180, 300, 150, 50, 'Поворот носового колеса', 'Nose-wheel steering', '±75° рукояткой, ±6° педалями на разбеге.', '±75° with the tiller, ±6° with the pedals on the take-off run.', 'Y'),
    P('carbon', 380, 300, 150, 50, 'Углеродные тормоза', 'Carbon brakes', 'Работают до 800–1000 °C; после посадки остывают 30–60 мин.', 'Work up to 800–1000 °C; cool for 30–60 min after landing.', 'hot'),
  ],
  pipes: [L('ctrl', [[140, 65], [180, 65]]), L('ctrl', [[310, 65], [380, 65]]), L('G', [[255, 220], [255, 260]], (s) => s.G), L('Y', [[455, 220], [455, 260]], (s) => s.Y), L('Y', [[255, 300], [255, 260], [455, 260]], (s) => s.Y)],
  ctls: [
    { id: 'G', label: T('Зелёная ГС', 'Green hyd'), min: 0, max: 1, step: 1, init: 1, options: [[1, T('есть', 'on')], [0, T('отказ', 'lost')]] },
    { id: 'Y', label: T('Жёлтая ГС', 'Yellow hyd'), min: 0, max: 1, step: 1, init: 1, options: [[1, T('есть', 'on')], [0, T('отказ', 'lost')]] },
  ],
  live: (s) => ({ values: { gact: s.G ? 'UP/DOWN 9 s' : 'NO — gravity only', bn: s.G ? 'OK + A/SKID' : 'LOST', ba: s.Y ? 'OK' : 'ACCU only', nws: s.Y ? 'OK' : 'LOST', pb: s.Y ? 'OK' : 'ACCU' }, warn: [...(s.G ? [] : ['gact', 'bn']), ...(s.Y ? [] : ['nws', 'ba'])],
    note: !s.G && !s.Y ? T('Без зелёной и жёлтой: шасси — только аварийно, тормоза — несколько нажатий от аккумулятора без антиюза, носовое колесо не поворачивается. Нужна длинная полоса и реверс.', 'Without green and yellow: gear by gravity only, a few brake applications from the accumulator without anti-skid, no nose-wheel steering. A long runway and reverse are needed.') : undefined }),
  how: [T('Автомат торможения LO/MED держит заданное замедление (1,7 / 3 м/с²) и включается вместе с интерцепторами при касании. Антиюз сравнивает скорость колёс со скоростью самолёта и не даёт им заблокироваться.', 'Autobrake LO/MED holds a set deceleration (1.7 / 3 m/s²) and starts together with the ground spoilers at touchdown. Anti-skid compares wheel speed with aircraft speed and stops the wheels locking.')],
  donts: [T('Не убирать/выпускать шасси выше VLO (250 уз) и не лететь выпущенным выше VLE (280 уз) — сорвёт створки.', 'Do not cycle the gear above VLO (250 kt) or fly it down above VLE (280 kt) — the doors tear off.'), T('Не взлетать сразу после посадки с горячими тормозами — при отказе взлёта они не остановят самолёт.', 'Do not take off right after landing with hot brakes — on a rejected take-off they will not stop the aircraft.')],
  numbers: [[T('Время уборки', 'Retraction time'), '≈ 9 s'], [T('Давление в шинах', 'Tyre pressure'), '≈ 14 bar'], [T('Посадочная скорость касания (норма)', 'Normal touchdown rate'), '−60…−360 ft/min']],
  sim: 'flight',
}

/* ------------------------------------------------------------------ navigation */
const nav: SystemDef = {
  id: 'nav', group: 'plane', title: T('Навигация: ИНС, приёмники давления, ILS, GPS', 'Navigation: IRS, air data, ILS, GPS'),
  lead: T('Самолёт знает, где он и как летит, из трёх независимых источников и сравнивает их между собой.', 'The aircraft knows where it is and how it flies from three independent sources and cross-checks them.'),
  parts: [
    P('pitot', 30, 50, 130, 50, 'Трубки Пито ×3', 'Pitot probes ×3', 'Полное давление → приборная скорость. Обогреваются: обледенение = ложная скорость.', 'Total pressure → airspeed. Heated: an iced probe gives false speed.', 'air'),
    P('static', 30, 130, 130, 50, 'Статика ×6', 'Static ports ×6', 'Давление → высота и вертикальная скорость.', 'Pressure → altitude and vertical speed.', 'air'),
    P('aoa', 30, 210, 130, 50, 'Датчики угла атаки ×3', 'AoA vanes ×3', 'Флюгеры на носу — для защиты от сваливания.', 'Vanes on the nose — for stall protection.', 'air'),
    P('ir', 220, 50, 150, 70, 'ИНС (IR) ×3', 'IRs ×3', 'Лазерные гироскопы и акселерометры: углы, курс, ускорения, место. Перед полётом — выставка 7–10 мин неподвижно.', 'Ring-laser gyros and accelerometers: attitude, heading, accelerations, position. Before flight — 7–10 min alignment, standing still.', 'ctrl'),
    P('adr', 220, 160, 150, 70, 'ADR ×3', 'ADR ×3', 'Вычислители воздушных данных: скорость, высота, число M, температура.', 'Air data: speed, altitude, Mach, temperature.', 'ctrl'),
    P('gps', 220, 270, 150, 50, 'GPS ×2', 'GPS ×2', '', '', 'ctrl'),
    P('ils', 430, 270, 150, 50, 'ILS-приёмник', 'ILS receiver', 'Курсовой и глиссадный радиомаяки ведут на полосу с точностью до метров; на нашем аэродроме — огни PAPI.', 'Localiser and glide-slope beams lead to the runway within metres; our airport has PAPI lights.', 'ctrl'),
    P('fmgc', 430, 100, 160, 80, 'FMGC', 'FMGC', 'Маршрут, позиция (смешение ИНС+GPS+радио), прогноз топлива, наведение.', 'Route, position (blended IRS+GPS+radio), fuel prediction, guidance.', 'ctrl'),
    P('disp', 640, 100, 140, 80, 'PFD / ND', 'PFD / ND', '', '', 'ctrl'),
  ],
  pipes: [L('air', [[160, 75], [220, 185]]), L('air', [[160, 155], [220, 195]]), L('air', [[160, 235], [220, 210]]), L('ctrl', [[370, 85], [430, 130]]), L('ctrl', [[370, 195], [430, 150]]), L('ctrl', [[370, 295], [400, 295], [400, 170], [430, 170]]), L('ctrl', [[505, 270], [505, 180]]), L('ctrl', [[590, 140], [640, 140]])],
  how: [T('Если одна из трёх трубок Пито замёрзнет, компьютеры увидят расхождение и проголосуют 2 против 1. Если откажут две — законы управления переходят в альтернативный.', 'If one of three pitot probes ices, the computers see the disagreement and vote 2 against 1. If two fail, the control laws revert to alternate.')],
  donts: [T('Не двигать самолёт во время выставки ИНС — начнётся заново.', 'Do not move during IR alignment — it restarts.'), T('Не взлетать без выставки: нет авиагоризонта, только прямой закон (в симуляторе — CONFIG IR NOT ALIGNED).', 'Do not take off unaligned: no attitude, direct law only (in the simulator — CONFIG IR NOT ALIGNED).')],
  numbers: [[T('Дрейф ИНС', 'IRS drift'), '< 2 NM/h'], [T('Выставка (реально / в тренажёре)', 'Alignment (real / trainer)'), '7–10 min / 90 s'], [T('Угол глиссады', 'Glide slope'), '3°']],
}

/* ------------------------------------------------------------------ autoflight (honest: not in the sim) */
const auto: SystemDef = {
  id: 'auto', group: 'plane', title: T('Автопилот и автомат тяги', 'Autopilot and autothrust'),
  lead: T('В тренажёре автопилота нет — летите сами. Но вот как это устроено в настоящем A320.', 'The simulator has no autopilot — you fly. But here is how it works on a real A320.'),
  parts: [
    P('fcu', 40, 60, 220, 60, 'FCU (панель на козырьке)', 'FCU (glareshield)', 'Скорость, курс, высота, вертикальная; кнопки AP1/AP2, A/THR, LOC, APPR.', 'Speed, heading, altitude, vertical speed; AP1/AP2, A/THR, LOC, APPR buttons.', 'ctrl'),
    P('fmgc', 320, 60, 180, 60, 'FMGC 1, 2', 'FMGC 1, 2', 'Вычисляют команды наведения.', 'Compute the guidance commands.', 'ctrl'),
    P('elac', 560, 30, 180, 50, 'ELAC/SEC/FAC', 'ELAC/SEC/FAC', 'Автопилот «держит ручку» через те же законы управления.', 'The autopilot “holds the stick” through the same control laws.', 'ctrl'),
    P('fadec', 560, 110, 180, 50, 'FADEC', 'FADEC', 'A/THR двигает тягу, а не рычаги — РУД стоят в детенте CL.', 'A/THR moves thrust, not the levers — they stay in the CL detent.', 'ctrl'),
    P('fma', 320, 200, 180, 60, 'FMA на PFD', 'FMA on the PFD', 'Строка режимов: что сейчас делает автоматика. Читать вслух каждое изменение.', 'The mode line: what the automation is doing now. Call out every change.', 'ctrl'),
  ],
  pipes: [L('ctrl', [[260, 90], [320, 90]]), L('ctrl', [[500, 80], [560, 55]]), L('ctrl', [[500, 100], [560, 135]]), L('ctrl', [[410, 120], [410, 200]])],
  how: [T('Автопилот может выполнить заход и посадку CAT III при видимости 75 м. Главная опасность — не понимать, в каком режиме автоматика (поэтому существует FMA).', 'The autopilot can fly a CAT III approach and landing at 75 m visibility. The main danger is not knowing which mode the automation is in (that is what the FMA is for).')],
  donts: [T('Не включать автопилот, не проверив режимы на FMA.', 'Do not engage the autopilot without checking the FMA modes.')], numbers: [[T('Минимум CAT IIIB', 'CAT IIIB minimum'), 'RVR 75 m']],
}

/* ------------------------------------------------------------------ air conditioning & pressurisation */
const press: SystemDef = {
  id: 'press', group: 'plane', title: T('Кондиционирование и наддув', 'Air conditioning and pressurisation'),
  lead: T('На 11 км снаружи −56 °C и давление в 4 раза меньше. Кабину держат на «высоте» ≤ 8000 футов, подавая воздух и стравливая его через клапан.', 'At 11 km it is −56 °C outside and the pressure is a quarter of sea level. The cabin is held at ≤ 8000 ft by pumping air in and letting it out through a valve.'),
  parts: [
    P('bleed', 30, 200, 120, 50, 'Отбор (двиг./ВСУ)', 'Bleed (eng/APU)', '≈ 200 °C, 40 psi.', '≈ 200 °C, 40 psi.', 'hot'),
    P('pack', 190, 180, 140, 90, 'PACK 1, 2', 'PACK 1, 2', 'Воздушная холодильная машина: теплообменники + турбохолодильник. На выходе −10…+70 °C по запросу.', 'An air-cycle machine: heat exchangers + a cooling turbine. Out comes −10…+70 °C as requested.', 'cool'),
    P('mix', 370, 190, 120, 70, 'Смеситель', 'Mixer', 'Половина воздуха — рециркуляция через HEPA-фильтры.', 'Half the air is recirculated through HEPA filters.', 'air'),
    P('cabin', 530, 160, 160, 130, 'Кабина', 'Cabin', '', '', 'air'),
    P('ofv', 720, 210, 70, 50, 'Выпускной клапан', 'Outflow valve', 'Прикрыт — давление растёт; открыт — падает. Скорость изменения ≈ 500 фт/мин — уши не болят.', 'Closing raises the pressure, opening lowers it. Changes at ≈ 500 ft/min — easy on the ears.', 'ctrl'),
  ],
  pipes: [L('hot', [[150, 225], [190, 225]], (s) => s.packs), L('cool', [[330, 225], [370, 225]], (s) => s.packs), L('air', [[490, 225], [530, 225]], (s) => s.packs), L('air', [[690, 235], [720, 235]], (s) => s.packs * 0.8)],
  ctls: [{ id: 'alt', label: T('Высота самолёта', 'Aircraft altitude'), min: 0, max: 39000, step: 1000, init: 35000, unit: 'ft' }, { id: 'packs', label: T('PACKs', 'PACKs'), min: 0, max: 1, step: 1, init: 1, options: [[1, T('ON', 'ON')], [0, T('OFF', 'OFF')]] }],
  live: (s) => {
    const pAlt = (h: number) => 14.7 * Math.pow(1 - 6.875e-6 * h, 5.256)
    const cab = s.packs ? Math.min(8000, s.alt * 0.22) : s.alt
    const dp = pAlt(cab) - pAlt(s.alt)
    return { values: { cabin: `${Math.round(cab)} ft · ΔP ${dp.toFixed(1)} psi`, ofv: s.packs ? `${Math.round(20 + s.alt / 1000)} %` : 'OPEN' }, warn: cab > 9550 ? ['cabin'] : [],
      note: cab > 14000 ? T('Без наддува на этой высоте сознание сохраняется 15–60 секунд. Маски выпадают автоматически, экипаж выполняет экстренное снижение до 10 000 футов.', 'Unpressurised at this altitude, useful consciousness lasts 15–60 seconds. The masks drop automatically and the crew makes an emergency descent to 10,000 ft.') : T(`Перепад ${dp.toFixed(1)} psi: на каждый квадратный метр обшивки давит ≈ ${(dp * 703).toFixed(0)} кг изнутри — фюзеляж работает как баллон.`, `Differential ${dp.toFixed(1)} psi: every square metre of skin is pushed out by ≈ ${(dp * 703).toFixed(0)} kg — the fuselage works like a pressure vessel.`) }
  },
  how: [T('Каждый полёт — цикл «надули-сдули» для фюзеляжа; усталостный ресурс A320 — ≈ 60 000 таких циклов.', 'Each flight is one inflate–deflate cycle for the fuselage; an A320’s fatigue life is ≈ 60,000 such cycles.')],
  donts: [T('Не запускать двигатели с включёнными PACK (в тренажёре — медленный запуск).', 'Do not start the engines with the packs on (in the trainer — a slow start).'), T('Не взлетать с выключенными PACK без нужды.', 'Do not take off with the packs off without reason.')],
  numbers: [[T('Макс. перепад', 'Max differential'), '8.06 psi'], [T('Высота в кабине на эшелоне', 'Cabin altitude at cruise'), '≤ 8000 ft']],
  sim: 'flight',
}

/* ------------------------------------------------------------------ ice & rain, fire, oxygen, structure, comms */
const ice: SystemDef = {
  id: 'ice', group: 'plane', title: T('Противообледенение', 'Ice and rain protection'),
  lead: T('Лёд на крыле разрушает поток: подъёмная сила падает на 30 %, а сваливание наступает на 5–8° раньше.', 'Ice on the wing ruins the flow: lift falls by 30 % and the stall comes 5–8° earlier.'),
  parts: [P('wai', 40, 60, 200, 60, 'Крыло (WING A/I)', 'Wing (WING A/I)', 'Горячий отбор в предкрылки 3–5.', 'Hot bleed into slats 3–5.', 'hot'), P('eai', 300, 60, 200, 60, 'Гондолы (ENG A/I)', 'Nacelles (ENG A/I)', 'Горячий воздух в губу воздухозаборника — куски льда разрушат лопатки.', 'Hot air into the inlet lip — shed ice would wreck the blades.', 'hot'), P('probe', 560, 60, 200, 60, 'Обогрев датчиков', 'Probe heat', 'Пито, статика, угол атаки, температура — электрически.', 'Pitot, static, AoA, temperature — electric.', 'elec'), P('ws', 300, 200, 200, 60, 'Стёкла', 'Windshields', 'Электрообогрев — от льда и для прочности (тёплое стекло крепче против птиц).', 'Electric heating — against ice and for strength (warm glass resists bird strikes better).', 'elec')],
  pipes: [], how: [T('Включается при температуре ≤ 10 °C и видимой влаге. На земле крыло обрабатывают антиобледенительной жидкостью.', 'Used at ≤ 10 °C in visible moisture. On the ground the wing is sprayed with de-icing fluid.')],
  donts: [T('Не взлетать со снегом/инеем на крыле — даже тонкий слой как наждачная бумага.', 'Never take off with snow or frost on the wing — even a thin layer acts like sandpaper.')], numbers: [[T('Порог включения', 'Activation'), '≤ 10 °C + moisture']],
}
const fire: SystemDef = {
  id: 'fire', group: 'plane', title: T('Пожарная защита', 'Fire protection'),
  lead: T('В каждом двигателе — две петли детекторов и два баллона огнетушителя; ВСУ, грузовые отсеки и туалеты тоже защищены.', 'Each engine has two detector loops and two extinguisher bottles; the APU, cargo holds and lavatories are protected too.'),
  parts: [P('loop', 40, 60, 200, 60, 'Петли детекторов A/B', 'Detection loops A/B', 'Газ в трубке расширяется от жара — срабатывает реле. Пожар фиксируется, когда сработали обе.', 'Gas in a tube expands with heat — a switch trips. Fire is declared when both loops trip.', 'hot'), P('handle', 300, 60, 200, 60, 'Пожарная рукоятка', 'Fire handle', 'Вытянуть — закрывает топливо, гидравлику, отбор, генератор этого двигателя.', 'Pull — shuts fuel, hydraulics, bleed and the generator of that engine.', 'ctrl'), P('bot', 560, 60, 200, 60, 'Баллоны ×2', 'Bottles ×2', 'Галон/заменитель заполняет гондолу; второй — через 30 с, если пожар продолжается.', 'Halon (or replacement) floods the nacelle; the second bottle after 30 s if the fire persists.', 'ctrl')],
  pipes: [L('ctrl', [[240, 90], [300, 90]]), L('ctrl', [[500, 90], [560, 90]])], how: [T('APU на земле тушится автоматически. Грузовые отсеки: дым → баллон заполняет отсек на 60+ минут, чтобы долететь до ближайшего аэродрома.', 'The APU is extinguished automatically on the ground. Cargo holds: smoke → a bottle floods the hold for 60+ minutes to reach the nearest airport.')], donts: [], numbers: [[T('Баллонов на двигатель', 'Bottles per engine'), '2']],
}
const oxy: SystemDef = {
  id: 'oxy', group: 'plane', title: T('Кислород и аварийное оборудование', 'Oxygen and emergency equipment'),
  lead: T('У экипажа — баллон и маски, надеваемые за 5 с; у пассажиров — химические генераторы кислорода на ≈ 15 мин, этого хватает для снижения до безопасной высоты.', 'The crew have a bottle and 5-second masks; passengers have chemical oxygen generators for ≈ 15 min — enough to descend to a safe altitude.'),
  parts: [P('crew', 40, 60, 200, 60, 'Кислород экипажа', 'Crew oxygen', 'Баллон 115 куб. футов.', 'A 115 cu ft bottle.', 'air'), P('pax', 300, 60, 200, 60, 'Генераторы пассажиров', 'Passenger generators', 'Хлорат натрия + железо: реакция идёт сама, остановить нельзя, коробка горячая.', 'Sodium chlorate + iron: the reaction runs by itself, cannot be stopped, the box gets hot.', 'hot'), P('slides', 560, 60, 200, 60, 'Надувные трапы', 'Escape slides', 'Эвакуация всех за 90 с через половину выходов — требование сертификации.', 'Everyone out in 90 s through half the exits — a certification requirement.', 'mech')],
  pipes: [], how: [T('Маски выпадают автоматически, если высота в кабине превысила ≈ 14 000 футов (в тренажёре — без PACK на высоте).', 'The masks drop automatically above ≈ 14,000 ft cabin altitude (in the trainer — no packs at altitude).')], donts: [T('Сначала маску на себя, потом на ребёнка.', 'Your mask first, then the child’s.')], numbers: [[T('Время пассажирского кислорода', 'Passenger oxygen duration'), '≈ 15 min']],
}
const structure: SystemDef = {
  id: 'structure', group: 'plane', title: T('Конструкция и прочность', 'Structure and strength'),
  lead: T('Крыло — балка, которая держит весь самолёт; на земле оно провисает, в полёте выгибается вверх на метр.', 'The wing is a beam holding the whole aircraft; on the ground it droops, in flight it bends up by a metre.'),
  parts: [P('wing', 40, 60, 240, 60, 'Кессон крыла', 'Wing box', 'Лонжероны + нервюры + обшивка; внутри — топливо (оно же разгружает крыло).', 'Spars + ribs + skins; inside is fuel (which also relieves the bending).', 'mech'), P('fus', 320, 60, 200, 60, 'Фюзеляж', 'Fuselage', 'Шпангоуты и стрингеры из алюминия; хвостовое оперение — углепластик.', 'Aluminium frames and stringers; the tail is carbon fibre.', 'mech'), P('limits', 560, 60, 200, 60, 'Пределы', 'Limits', '+2,5 g эксплуатационная, ×1,5 = 3,75 g расчётная — до неё конструкция не должна разрушиться.', '+2.5 g limit, ×1.5 = 3.75 g ultimate — the structure must not fail before it.', 'ctrl')],
  pipes: [], how: [T('Флаттер — самовозбуждающиеся колебания крыла и рулей; поэтому есть VMO/MMO с запасом. В тренажёре превышение на 45 уз разрушает самолёт.', 'Flutter — self-exciting vibration of the wing and surfaces; that is why VMO/MMO carry a margin. In the simulator, exceeding by 45 kt breaks the aircraft.')], donts: [T('Не превышать VMO 350 уз / MMO 0,82.', 'Do not exceed VMO 350 kt / MMO 0.82.')], numbers: [[T('Эксплуатационная перегрузка', 'Limit load'), '+2.5 / −1 g'], [T('Ресурс по циклам', 'Design life'), '≈ 60 000 cycles']],
}
const comms: SystemDef = {
  id: 'comms', group: 'plane', title: T('Связь и предупреждения о столкновении', 'Communications and collision warnings'),
  lead: T('Радио, ответчик, TCAS и EGPWS — системы, которые предупреждают о других самолётах и о земле.', 'Radio, transponder, TCAS and EGPWS — systems that warn of other aircraft and the ground.'),
  parts: [P('vhf', 40, 60, 160, 60, 'VHF / HF / SATCOM', 'VHF / HF / SATCOM', 'Голос и данные (CPDLC).', 'Voice and data (CPDLC).', 'elec'), P('xpdr', 240, 60, 160, 60, 'Ответчик Mode S', 'Mode S transponder', 'Отвечает радарам: код, высота, позиция (ADS-B).', 'Answers radars: code, altitude, position (ADS-B).', 'elec'), P('tcas', 440, 60, 160, 60, 'TCAS II', 'TCAS II', 'Опрашивает ответчики соседей и даёт команды «набирай / снижайся», согласованные между самолётами.', 'Interrogates nearby transponders and gives coordinated “climb / descend” commands.', 'ctrl'), P('egpws', 640, 60, 140, 60, 'EGPWS', 'EGPWS', 'База рельефа + радиовысотомер: «TERRAIN, PULL UP».', 'Terrain database + radio altimeter: “TERRAIN, PULL UP”.', 'ctrl')],
  pipes: [], how: [T('Команда TCAS выполняется немедленно, даже если диспетчер говорит обратное.', 'A TCAS resolution advisory is followed at once, even if ATC says otherwise.')], donts: [], numbers: [[T('Предупреждение TCAS RA', 'TCAS RA lead time'), '15–35 s']],
}

/* ------------------------------------------------------------------ Vortex-240 */
const rde: SystemDef = {
  id: 'rde', group: 'vortex', title: T('Ротационный детонационный турбогенератор', 'Rotating detonation turbo-generator'),
  lead: T('Главное новшество «Вихря»: топливо горит не пламенем, а в ударной волне, бегущей по кольцу. Откройте 3D-разбор.', 'The Vortex’s key novelty: fuel burns not in a flame but in a shock wave running round a ring. Open the 3D dive.'),
  parts: [P('comp', 40, 180, 130, 80, 'Компрессор', 'Compressor', 'Степень сжатия ≈ 25 (меньше, чем у ТРДД: часть сжатия делает сама детонация).', 'Pressure ratio ≈ 25 (less than a turbofan: detonation adds the rest).', 'air'), P('rdc', 210, 170, 170, 100, 'Детонационная камера', 'Detonation combustor', 'Волна ≈ 2 км/с, проход каждые ≈ 0,2 мс.', '≈ 2 km/s wave, a pass every ≈ 0.2 ms.', 'hot'), P('turb', 420, 180, 120, 80, 'Турбина', 'Turbine', '', '', 'hot'), P('gen', 580, 170, 160, 100, 'Сверхпроводящий генератор', 'Superconducting generator', '≈ 12 МВт, КПД ≈ 99,5 %.', '≈ 12 MW, ≈ 99.5 % efficient.', 'elec'), P('h2', 210, 340, 170, 50, 'LH₂ → криостат → форсунки', 'LH₂ → cryostat → injectors', '', '', 'h2')],
  pipes: [L('air', [[170, 220], [210, 220]], () => 0.8), L('hot', [[380, 220], [420, 220]], () => 1), L('mech', [[540, 220], [580, 220]], () => 0.6), L('h2', [[660, 270], [660, 365], [380, 365]], () => 0.5), L('h2', [[295, 340], [295, 270]], () => 0.5)],
  how: [T('Детонация — это режим, где фронт горения и ударная волна движутся вместе быстрее звука. Сгорание за волной идёт почти без расширения, поэтому давление растёт в 15 раз. В непрерывной кольцевой камере волна не гаснет: перед ней всегда новая порция смеси.', 'Detonation is a regime where the flame front and a shock move together faster than sound. Burning behind the wave hardly expands, so pressure rises 15-fold. In a continuous ring the wave never dies: there is always fresh mixture ahead of it.')],
  donts: [T('Риски: вибрации от пульсаций, нагрев стенок кольца, нестабильность числа волн, выбросы NOx — их решение и есть главная инженерная работа проекта.', 'Risks: pulsation vibration, ring-wall heating, unstable wave count, NOx emissions — solving them is the project’s main engineering work.')],
  numbers: [[T('Скорость волны', 'Wave speed'), '≈ 1970 m/s'], [T('Скачок давления', 'Pressure jump'), '≈ 15×'], [T('Экономия vs Брайтон (теория)', 'Saving vs Brayton (theory)'), '≈ 15 %']],
  sim: 'rde',
}
const cryo: SystemDef = {
  id: 'cryo', group: 'vortex', title: T('Сверхпроводящая распределённая тяга', 'Superconducting distributed propulsion'),
  lead: T('Два генератора и восемь вентиляторов связаны общей сверхпроводящей шиной: любой генератор питает любой вентилятор.', 'Two generators and eight fans share a superconducting bus: any generator feeds any fan.'),
  parts: [
    P('g1', 40, 120, 130, 60, 'Генератор 1', 'Generator 1', '', '', 'elec'), P('g2', 40, 260, 130, 60, 'Генератор 2', 'Generator 2', '', '', 'elec'),
    P('bus', 220, 100, 60, 240, 'Шина', 'Bus', 'Кабель из высокотемпературного сверхпроводника в трубке с водородом.', 'High-temperature superconducting cable in a hydrogen-cooled tube.', 'ref'),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => P(`f${i}`, 340 + (i % 4) * 110, 120 + Math.floor(i / 4) * 140, 90, 60, `Вент. ${i + 1}`, `Fan ${i + 1}`, 'Электромотор ≈ 1,5 МВт, вентилятор в канале, засасывает пограничный слой корпуса.', 'A ≈ 1.5 MW electric motor driving a ducted fan that ingests the body boundary layer.', 'air')),
  ],
  pipes: [L('elec', [[170, 150], [220, 150]], (s) => (s.core1 ? 1 : 0)), L('elec', [[170, 290], [220, 290]], (s) => (s.core2 ? 1 : 0)), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => L('elec', [[280, 220], [310, 220], [310, 150 + Math.floor(i / 4) * 140], [340 + (i % 4) * 110, 150 + Math.floor(i / 4) * 140]], (s) => (s.core1 + s.core2) / 2))],
  ctls: [{ id: 'core1', label: T('Ядро 1', 'Core 1'), min: 0, max: 1, step: 1, init: 1, options: [[1, T('работает', 'running')], [0, T('отказ', 'failed')]] }, { id: 'core2', label: T('Ядро 2', 'Core 2'), min: 0, max: 1, step: 1, init: 1, options: [[1, T('работает', 'running')], [0, T('отказ', 'failed')]] }],
  live: (s) => {
    const p = (s.core1 + s.core2) / 2, values: Record<string, string> = {}
    for (let i = 0; i < 8; i++) values[`f${i}`] = `${Math.round(p * 100)} %`
    return { values, warn: p === 0 ? ['bus'] : [], note: p === 0.5 ? T('Одно ядро отказало: все восемь вентиляторов работают на половине мощности — тяга симметрична, самолёт не разворачивает. У обычного двухдвигательного — сильный разворот, нужна педаль.', 'One core failed: all eight fans run at half power — thrust stays symmetric, no yaw. A conventional twin yaws hard and needs rudder.') : p === 0 ? T('Оба ядра: планирование, качество ≈ 24 — с 10 км ≈ 240 км; аварийная батарея и RAT держат управление.', 'Both cores out: a glide at L/D ≈ 24 — ≈ 240 km from 10 km up; an emergency battery and RAT keep control.') : undefined }
  },
  how: [T('Попробуйте в симуляторе: «Вихрь-240», в полёте «Отказ двиг. 1» — разворота не будет.', 'Try it in the simulator: Vortex-240, in flight press “Fail engine 1” — there will be no yaw.')],
  donts: [], numbers: [[T('Вентиляторов', 'Fans'), '8 × ≈ 1.5 MW'], [T('КПД передачи', 'Transmission efficiency'), '≈ 99.5 %']], sim: 'vortex',
}
const lh2: SystemDef = {
  id: 'lh2', group: 'vortex', title: T('Водородная топливная система', 'Liquid-hydrogen fuel system'),
  lead: T('Водород при −253 °C: в 2,8 раза больше энергии на килограмм, чем керосин, но в 4 раза больше объём. Поэтому — толстый несущий корпус с баками.', 'Hydrogen at −253 °C: 2.8× the energy per kilogram of kerosene but 4× the volume. Hence the thick lifting body with tanks inside.'),
  parts: [P('tank', 40, 160, 200, 120, 'Криобаки', 'Cryogenic tanks', 'Цилиндры с вакуумной изоляцией в задней части центроплана; испарение ≈ 0,1 %/ч отводится и используется.', 'Vacuum-insulated cylinders in the aft centre body; ≈ 0.1 %/h boil-off is vented and used.', 'h2'), P('pump', 290, 180, 120, 60, 'Криогенные насосы', 'Cryogenic pumps', '', '', 'h2'), P('cool', 460, 120, 150, 60, 'Охлаждение сверхпроводников', 'Superconductor cooling', '', '', 'ref'), P('hx', 460, 250, 150, 60, 'Теплообменник', 'Heat exchanger', 'Водород нагревается выхлопом до газа.', 'Hydrogen is warmed to gas by the exhaust.', 'hot'), P('inj', 660, 190, 120, 60, 'Форсунки камеры', 'Combustor injectors', '', '', 'fuel')],
  pipes: [L('h2', [[240, 210], [290, 210]], () => 0.6), L('h2', [[410, 210], [440, 210], [440, 150], [460, 150]], () => 0.6), L('h2', [[535, 180], [535, 250]], () => 0.6), L('h2', [[610, 280], [640, 280], [640, 220], [660, 220]], () => 0.6)],
  how: [T('Сгорая, водород даёт только воду и немного NOx — CO₂ в полёте ноль. Водяной пар на высоте образует инверсионные следы, поэтому маршрут выбирается так, чтобы их избегать.', 'Burning hydrogen yields only water and some NOx — zero CO₂ in flight. The water vapour makes contrails at altitude, so routes are planned to avoid contrail-forming air.')],
  donts: [T('Водород незаметно утекает и горит почти невидимым пламенем — нужны датчики утечек и вентиляция всех отсеков.', 'Hydrogen leaks easily and burns with an almost invisible flame — leak detectors and ventilation of every bay are essential.')],
  numbers: [[T('Теплота сгорания', 'Heating value'), '120 MJ/kg'], [T('Плотность жидкого H₂', 'Liquid H₂ density'), '71 kg/m³'], [T('Запас топлива', 'Fuel capacity'), '9 t ≈ 127 m³']],
}

export const PLANE_SYSTEMS: SystemDef[] = [trainer, fbw, engines, gear, nav, auto, press, ice, fire, oxy, structure, comms, rde, cryo, lh2]
void clamp
