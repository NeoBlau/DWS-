import { T, type Txt } from '../i18n'
import { AC, CONFS, DEG, G, KT, confAt, DEST, type Sim, type SimEvent } from './fdm'

/*
 * The narrator: watches the simulation and explains, in plain words and with live numbers,
 * what is happening to the aircraft right now and how the system the pilot just used works.
 */

const W = AC.mass * G
const kN = (n: number) => Math.round(n / 1000)
const pct = (n: number) => Math.round(n * 100)
const r0 = Math.round

export interface Narration { phase: Txt; now: Txt; why: Txt | null; whyTitle: Txt | null }

/* ---------------------------------------------------------------- what the aircraft is doing */
export function phaseNarration(s: Sim): { phase: Txt; now: Txt } {
  const d = s.d, c = s.ctl
  const thrust = d.thrust[0] + d.thrust[1]
  const liftPct = pct(d.lift / W)
  const distToRwy = (DEST - s.pos.x) / 1852
  if (s.crashed) {
    const why: Record<string, Txt> = {
      hard: T('Слишком большая вертикальная скорость при касании — шасси не выдержало.', 'Sink rate at touchdown was far too high — the landing gear failed.'),
      belly: T('Самолёт коснулся земли фюзеляжем: шасси было убрано или сломано.', 'The fuselage hit the ground: the gear was up or had collapsed.'),
      engine: T('Двигатель задел землю — слишком большой крен у земли.', 'An engine struck the ground — too much bank close to the ground.'),
      wingtip: T('Законцовка крыла задела землю.', 'A wingtip struck the ground.'),
    }
    return { phase: T('Авария', 'Crash'), now: why[s.crashed] ?? T('Самолёт разрушен.', 'The aircraft is destroyed.') }
  }
  if (!s.airborne && !s.everAirborne) {
    if (d.gs < 2 && c.lever < 0.1) return {
      phase: T('На исполнительном старте', 'Lined up on the runway'),
      now: T(`Самолёт стоит на полосе: масса ≈ ${r0(AC.mass / 1000)} т, вес ≈ ${kN(W)} кН. Крыло создаёт подъёмную силу только в потоке воздуха — она растёт как квадрат скорости. Для взлёта нужны закрылки (рычаг FLAPS в 1 — на земле это 1+F) и полная тяга TOGA.`,
        `The aircraft is lined up: mass ≈ ${r0(AC.mass / 1000)} t, weight ≈ ${kN(W)} kN. A wing only lifts in moving air, and lift grows with the square of speed. Take-off needs flaps (FLAPS lever to 1 — on the ground that is 1+F) and full TOGA thrust.`),
    }
    if (d.ias < 135) return {
      phase: T('Разбег', 'Take-off roll'),
      now: T(`Тяга ${kN(thrust)} кН против сопротивления ${kN(d.drag)} кН и трения колёс — самолёт ускоряется на ${(d.decel * -1).toFixed(1)} м/с². Подъёмная сила уже ${liftPct}% веса. Держите ось полосы педалями (Q/E): на разбеге поворачивает носовое колесо и руль направления.`,
        `Thrust ${kN(thrust)} kN against ${kN(d.drag)} kN of drag plus tyre friction — accelerating at ${(d.decel * -1).toFixed(1)} m/s². Lift is already ${liftPct}% of weight. Keep the centreline with the pedals (Q/E): the nosewheel and rudder steer.`),
    }
    if (d.theta < 3 * DEG) return {
      phase: T('VR — подъём носа', 'VR — rotate'),
      now: T(`${r0(d.ias)} узлов. Плавно возьмите ручку на себя (S или ↓): руль высоты прижимает хвост вниз, нос поднимается, угол атаки растёт — и подъёмная сила (${liftPct}% веса) превысит вес. Целевой тангаж ≈ 15°, темп ≈ 3°/с.`,
        `${r0(d.ias)} kt. Ease the stick back (S or ↓): the elevator pushes the tail down, the nose rises, angle of attack grows — and lift (${liftPct}% of weight) overtakes weight. Aim for ≈ 15° pitch at ≈ 3°/s.`),
    }
    return {
      phase: T('Подъём носа', 'Rotation'),
      now: T(`Тангаж ${(d.theta / DEG).toFixed(1)}°. Пока основные колёса на земле, больше 11,5° нельзя — хвост ударится о полосу. Подъёмная сила ${liftPct}% веса.`,
        `Pitch ${(d.theta / DEG).toFixed(1)}°. While the main wheels are on the ground, more than 11.5° strikes the tail. Lift is ${liftPct}% of weight.`),
    }
  }
  if (!s.airborne && s.everAirborne) {
    if (d.gs > 3) return {
      phase: T('Пробег', 'Landing roll'),
      now: T(`Скорость ${r0(d.gs)} узлов, замедление ${d.decel.toFixed(1)} м/с². Интерцепторы погасили подъёмную силу, поэтому вес лёг на колёса и тормоза работают. ${c.rev ? 'Реверс направляет поток вентилятора вперёд.' : 'Можно включить реверс (R).'}`,
        `${r0(d.gs)} kt, decelerating at ${d.decel.toFixed(1)} m/s². The spoilers dumped lift, so the weight is on the wheels and the brakes bite. ${c.rev ? 'Reverse thrust turns the fan stream forward.' : 'You can select reverse (R).'}`),
    }
    return { phase: T('Остановились', 'Stopped'), now: T(`Самолёт остановился. Посадка с вертикальной ${r0(s.touchdownVs ?? 0)} фут/мин. Можно начать заново.`, `The aircraft has stopped. Touchdown sink rate was ${r0(s.touchdownVs ?? 0)} ft/min. Start again whenever you like.`) }
  }
  // airborne
  if (d.flare) return {
    phase: T('Выравнивание', 'Flare'),
    now: T(`Высота ${r0(d.ra)} фт. Ниже 50 фт закон управления перешёл в режим посадки: нос сам медленно опускается, поэтому на ~30 фт поставьте РУД в IDLE и плавно возьмите на себя — гасим вертикальную до 100–200 фт/мин (сейчас ${r0(d.vs)}).`,
      `${r0(d.ra)} ft. Below 50 ft the control law switched to flare mode: the nose slowly lowers by itself, so at ~30 ft pull the levers to IDLE and ease back — bring the sink rate to 100–200 ft/min (now ${r0(d.vs)}).`),
  }
  if (d.ra < 1500 && s.srf.gear > 0.5 && d.vs > 200 && s.pos.x < DEST - 20000) return {
    phase: T('Начальный набор', 'Initial climb'),
    now: T(`Подъёмная сила ${liftPct}% веса, вертикальная +${r0(d.vs)} фт/мин. Выпущенное шасси даёт ≈ ${pct((0.018 * d.qbar * AC.S) / Math.max(1, d.drag))}% всего сопротивления — после «положительной вертикальной» уберите его (G).`,
      `Lift ${liftPct}% of weight, climbing +${r0(d.vs)} ft/min. The extended gear makes ≈ ${pct((0.018 * d.qbar * AC.S) / Math.max(1, d.drag))}% of total drag — once you have positive climb, raise it (G).`),
  }
  if (Math.abs(d.phi) > 8 * DEG) {
    const n = 1 / Math.cos(d.phi)
    return {
      phase: T('Вираж', 'Turn'),
      now: T(`Крен ${r0(d.phi / DEG)}°. Подъёмная сила наклонилась: её горизонтальная часть поворачивает самолёт. Чтобы не терять высоту, нужна перегрузка n = 1/cos φ = ${n.toFixed(2)} — до 33° fly-by-wire добирает её сам. Больше 67° крен не даст защита.`,
        `Bank ${r0(d.phi / DEG)}°. Lift is tilted: its horizontal part turns the aircraft. To hold altitude it needs a load factor n = 1/cos φ = ${n.toFixed(2)} — fly-by-wire adds it by itself up to 33°. Protection stops the bank at 67°.`),
    }
  }
  if (d.vs > 400 && thrust < d.drag) return {
    phase: T('Набор за счёт скорости', 'Zoom climb'),
    now: T(`Тяга ${kN(thrust)} кН меньше сопротивления ${kN(d.drag)} кН, но самолёт идёт вверх (+${r0(d.vs)} фт/мин): он тратит скорость (${r0(d.ias)} узлов) на высоту. Долго так не получится — скорость упадёт.`,
      `Thrust ${kN(thrust)} kN is below drag ${kN(d.drag)} kN, yet the aircraft climbs (+${r0(d.vs)} ft/min): it is trading speed (${r0(d.ias)} kt) for height. That cannot last — speed will bleed off.`),
  }
  if (d.vs > 400) {
    const excess = thrust - d.drag
    return {
      phase: T('Набор высоты', 'Climb'),
      now: T(`Тяга ${kN(thrust)} кН больше сопротивления ${kN(d.drag)} кН на ${kN(excess)} кН. Этот избыток, умноженный на скорость, поднимает самолёт: Vy ≈ (T − D)·V / W ≈ ${r0(((excess * d.V) / W) / 0.3048 * 60)} фт/мин (сейчас ${r0(d.vs)}).`,
        `Thrust ${kN(thrust)} kN exceeds drag ${kN(d.drag)} kN by ${kN(excess)} kN. That excess times speed lifts the aircraft: Vy ≈ (T − D)·V / W ≈ ${r0(((excess * d.V) / W) / 0.3048 * 60)} ft/min (now ${r0(d.vs)}).`),
    }
  }
  if (d.vs < -400) {
    if (distToRwy < 12 && s.ctl.flapLever >= 2) return {
      phase: T('Заход на посадку', 'Final approach'),
      now: T(`До порога ${distToRwy.toFixed(1)} NM. Глиссада 3°: огни PAPI слева от полосы — 2 белых и 2 красных значит «на глиссаде». Скорость ${r0(d.ias)} узлов при VLS ${r0(d.vls)}: держите её газом, а траекторию — ручкой.`,
        `${distToRwy.toFixed(1)} NM to the threshold. The glide path is 3°: the PAPI lights left of the runway show 2 white / 2 red when on slope. Speed ${r0(d.ias)} kt with VLS ${r0(d.vls)}: hold speed with thrust and the path with the stick.`),
    }
    return {
      phase: T('Снижение', 'Descent'),
      now: T(`Тяги меньше, чем сопротивления, — недостающую энергию даёт высота: самолёт «скатывается» по траектории. Вертикальная ${r0(d.vs)} фт/мин. Интерцепторы (speedbrake) добавят сопротивления, если нужно снизиться круче, не разгоняясь.`,
        `Thrust is below drag, so altitude supplies the missing energy: the aircraft glides down its path at ${r0(d.vs)} ft/min. Speedbrakes add drag when you need a steeper descent without speeding up.`),
    }
  }
  return {
    phase: T('Горизонтальный полёт', 'Level flight'),
    now: T(`Подъёмная сила ≈ весу (${liftPct}%), тяга ${kN(thrust)} кН ≈ сопротивлению ${kN(d.drag)} кН. Угол атаки ${(d.alpha / DEG).toFixed(1)}°. Ручка в нейтрали — fly-by-wire держит траекторию, а стабилизатор (${(s.srf.ths / DEG).toFixed(1)}°) сам снимает нагрузку с руля высоты. До полосы ${Math.max(0, distToRwy).toFixed(0)} NM.`,
      `Lift ≈ weight (${liftPct}%), thrust ${kN(thrust)} kN ≈ drag ${kN(d.drag)} kN. Angle of attack ${(d.alpha / DEG).toFixed(1)}°. With the stick neutral fly-by-wire holds the flight path, and the stabiliser (${(s.srf.ths / DEG).toFixed(1)}°) trims the elevator load away. ${Math.max(0, distToRwy).toFixed(0)} NM to the runway.`),
  }
}

/* ---------------------------------------------------------------- how the system you just used works */
export type Topic = 'flaps' | 'gear' | 'thrust' | 'pitch' | 'roll' | 'rudder' | 'speedbrake' | 'reverse' | 'brakes' | 'law' | 'trim' | 'alphaProt' | 'stall' | 'groundSpoilers' | 'tailstrike'
export function explain(topic: Topic, s: Sim): { title: Txt; body: Txt } {
  const d = s.d
  switch (topic) {
    case 'flaps': {
      const c = confAt(s.srf.confTarget), cur = CONFS[Math.round(s.srf.confTarget)]
      const clmax = c.cl0 + 5.6 * c.as
      const vs = Math.sqrt((2 * W) / (1.225 * AC.S * clmax)) / KT
      return { title: T(`Закрылки: CONF ${cur.id}`, `Flaps: CONF ${cur.id}`), body: T(
        `Предкрылки (${r0(c.slat)}°) выдвигаются вперёд-вниз, закрылки Фаулера (${r0(c.flap)}°) — назад и вниз: площадь и кривизна крыла растут, максимальный коэффициент подъёмной силы ≈ ${clmax.toFixed(2)}, скорость сваливания ≈ ${r0(vs)} узлов. Цена — сопротивление. Привод — гидравлика (зелёная/жёлтая система, 3000 psi), ход ≈ 20–30 с. Ограничение VFE ${r0(c.vfe)} узлов.`,
        `Slats (${r0(c.slat)}°) move forward and down, Fowler flaps (${r0(c.flap)}°) slide aft and down: wing area and camber grow, max lift coefficient ≈ ${clmax.toFixed(2)}, stall speed ≈ ${r0(vs)} kt. The price is drag. Driven hydraulically (green/yellow systems, 3000 psi), ≈ 20–30 s full travel. VFE limit ${r0(c.vfe)} kt.`) }
    }
    case 'gear': return { title: T('Шасси', 'Landing gear'), body: T(
      `Основные стойки убираются внутрь, к фюзеляжу, носовая — вперёд, за ≈ 9 с, от зелёной гидросистемы. На земле уборку блокирует датчик обжатия амортизаторов. Выпущенное шасси — одно из главных источников сопротивления (ΔCD ≈ 0,018).`,
      `The main legs retract inward into the fuselage, the nose leg forward, in ≈ 9 s, powered by the green hydraulic system. On the ground a weight-on-wheels switch blocks retraction. Extended gear is one of the largest drag sources (ΔCD ≈ 0.018).`) }
    case 'thrust': return { title: T('Двигатели и РУД', 'Engines and thrust levers'), body: T(
      `РУД задаёт обороты вентилятора N1 (сейчас ${r0(s.n1[0])}%). Ротор массивный, поэтому тяга нарастает с задержкой: от малого газа до взлётного — ≈ 6–8 с. Около 80% тяги даёт вентилятор (обходной поток), остальное — горячее ядро. Положения: IDLE, CL (набор), FLX/MCT, TOGA (взлёт/уход). Максимум ≈ 2 × 120 кН у земли; с высотой и скоростью тяга падает.`,
      `The levers command fan speed N1 (now ${r0(s.n1[0])}%). The rotor is heavy, so thrust lags: idle to take-off takes ≈ 6–8 s. About 80% of thrust comes from the fan (bypass stream), the rest from the hot core. Detents: IDLE, CL (climb), FLX/MCT, TOGA (take-off/go-around). Maximum ≈ 2 × 120 kN at sea level; it falls with altitude and speed.`) }
    case 'pitch': return { title: T('Ручка по тангажу', 'Pitch input'), body: s.ctl.law === 'direct'
      ? T('Прямой закон: ручка напрямую отклоняет руль высоты. Самолёт не триммируется сам и не защищён от сваливания.', 'Direct law: the stick moves the elevator directly. The aircraft does not trim itself and has no stall protection.')
      : T(`В нормальном законе ручка задаёт не угол руля, а перегрузку (полностью на себя ≈ +2,5 g). Компьютеры ELAC сами двигают руль высоты (${(s.srf.elev / DEG).toFixed(1)}°) и переставляют стабилизатор (${(s.srf.ths / DEG).toFixed(1)}°), чтобы вы могли отпустить ручку. Перегрузка сейчас ${d.nz.toFixed(2)} g.`,
        `In Normal law the stick commands load factor, not a surface angle (full back ≈ +2.5 g). The ELAC computers move the elevator (${(s.srf.elev / DEG).toFixed(1)}°) and re-trim the stabiliser (${(s.srf.ths / DEG).toFixed(1)}°) so you can let go. Load factor now ${d.nz.toFixed(2)} g.`) }
    case 'roll': return { title: T('Крен: элероны и интерцепторы', 'Roll: ailerons and spoilers'), body: T(
      `Ручка вбок задаёт угловую скорость крена (до 15°/с). Элероны отклоняются противоположно, а на опускающемся крыле дополнительно поднимаются интерцепторы — гасят там подъёмную силу. Отпустили ручку — крен удерживается (до 33°); больше 33° самолёт сам возвращает к 33°, предел — 67°.`,
      `Sideways stick commands roll rate (up to 15°/s). The ailerons move in opposite directions and on the down-going wing the spoilers rise too, killing lift there. Let go and the bank holds (up to 33°); beyond 33° it rolls back to 33°, the limit is 67°.`) }
    case 'rudder': return { title: T('Руль направления', 'Rudder'), body: T(
      `Педали поворачивают руль направления (до 25° на малой скорости — чем быстрее, тем меньше разрешено) и на земле — носовое колесо. В полёте демпфер рыскания и координация разворота работают сами: педали нужны при боковом ветре и отказе двигателя.`,
      `The pedals move the rudder (up to 25° at low speed — less as speed rises) and, on the ground, the nosewheel. In flight the yaw damper and turn coordination work by themselves: pedals are for crosswinds and engine failures.`) }
    case 'speedbrake': return { title: T('Воздушные тормоза', 'Speedbrakes'), body: T(
      `Интерцепторы 2–5 поднимаются на верхней поверхности крыла: срывают поток, добавляют сопротивление и немного уменьшают подъёмную силу — так снижаются круче, не разгоняясь. Положение ARM готовит их к автоматическому выпуску при касании.`,
      `Spoilers 2–5 rise on top of the wing: they spoil the flow, add drag and remove a little lift — a steeper descent without gaining speed. The ARM position prepares them to deploy automatically at touchdown.`) }
    case 'groundSpoilers': return { title: T('Интерцепторы при касании', 'Ground spoilers'), body: T(
      `После касания все интерцепторы выдвинулись: крыло почти перестало держать, вес переходит на колёса, и тормоза становятся эффективными. Без этого самолёт мог бы «подпрыгнуть» и катиться на почти невесомых колёсах.`,
      `At touchdown all spoilers deployed: the wing almost stops lifting, the weight transfers to the wheels and the brakes become effective. Without them the aircraft could bounce and roll on nearly weightless wheels.`) }
    case 'reverse': return { title: T('Реверс тяги', 'Reverse thrust'), body: T(
      `Створки реверса открываются и разворачивают поток вентилятора вперёд и вбок. Это дополнительное торможение, особенно эффективное на большой скорости. Включается только на земле и на малом газе; ниже ≈ 70 узлов переходят на малый реверс.`,
      `Reverser doors open and turn the fan stream forward and outward — extra deceleration, most effective at high speed. Only available on the ground with levers at idle; below ≈ 70 kt use idle reverse.`) }
    case 'brakes': return { title: T('Колёсные тормоза', 'Wheel brakes'), body: T(
      `Углеродные тормоза на основных колёсах. Автомат торможения LO поддерживает замедление ≈ 1,7 м/с², MED — ≈ 3 м/с²; нажатие на педали тормоза его отключает.`,
      `Carbon brakes on the main wheels. Autobrake LO holds ≈ 1.7 m/s² of deceleration, MED ≈ 3 m/s²; pressing the brake pedals disconnects it.`) }
    case 'law': return { title: T(s.ctl.law === 'normal' ? 'Нормальный закон' : 'Прямой закон', s.ctl.law === 'normal' ? 'Normal law' : 'Direct law'), body: s.ctl.law === 'normal'
      ? T('Компьютеры между ручкой и рулями: ручка задаёт перегрузку и угловую скорость, работают защиты по углу атаки, крену, тангажу и скорости, стабилизатор триммируется сам.', 'Computers sit between stick and surfaces: the stick commands load factor and roll rate, protections guard angle of attack, bank, pitch and speed, and the stabiliser trims itself.')
      : T('Резервный режим: ручка напрямую двигает рули, защит нет. Стабилизатор триммируйте вручную кнопками TRIM. Почувствуйте, сколько работы fly-by-wire делает за пилота.', 'Back-up mode: the stick moves the surfaces directly, no protections. Trim the stabiliser yourself with the TRIM buttons. Feel how much work fly-by-wire normally does for you.') }
    case 'trim': return { title: T('Стабилизатор (THS)', 'Trimmable stabiliser'), body: T(
      `Весь горизонтальный стабилизатор поворачивается (сейчас ${(s.srf.ths / DEG).toFixed(1)}°), чтобы уравновесить самолёт без постоянного отклонения руля высоты. Он гораздо мощнее руля, поэтому двигается медленно.`,
      `The whole horizontal stabiliser pivots (now ${(s.srf.ths / DEG).toFixed(1)}°) to balance the aircraft without holding elevator. It is far more powerful than the elevator, so it moves slowly.`) }
    case 'alphaProt': return { title: T('Защита по углу атаки', 'Alpha protection'), body: T(
      `Угол атаки ${(d.alpha / DEG).toFixed(1)}° достиг зоны защиты (α-prot ${(d.alphaProt / DEG).toFixed(1)}°). Теперь ручка задаёт угол атаки, и даже полностью на себя самолёт не превысит α-max ${(d.alphaMax / DEG).toFixed(1)}° — сваливания не будет. При дальнейшем росте включится α-floor: автоматически TOGA.`,
      `Angle of attack ${(d.alpha / DEG).toFixed(1)}° reached the protection zone (α-prot ${(d.alphaProt / DEG).toFixed(1)}°). The stick now commands angle of attack; even full back it will not exceed α-max ${(d.alphaMax / DEG).toFixed(1)}° — no stall. If it keeps rising, α-floor commands TOGA automatically.`) }
    case 'stall': return { title: T('Сваливание', 'Stall'), body: T(
      `Угол атаки превысил критический: поток срывается с верхней поверхности, подъёмная сила падает, сопротивление резко растёт. Выход: ручку от себя (уменьшить угол атаки), затем тяга.`,
      `Angle of attack passed the critical value: the flow separates from the upper surface, lift collapses and drag jumps. Recovery: stick forward (reduce angle of attack), then thrust.`) }
    case 'tailstrike': return { title: T('Удар хвостом', 'Tail strike'), body: T(
      'Слишком большой тангаж при касании полосы основными колёсами — нижняя часть хвоста задела полосу. Причины: ранний или резкий подъём носа, недостаточная скорость.',
      'Too much pitch while the main wheels were on the runway — the lower tail touched the runway. Causes: rotating too early or too fast, or too little speed.') }
  }
}

/* ---------------------------------------------------------------- short toasts for events */
export function eventText(e: SimEvent, v: number | undefined): Txt | null {
  switch (e) {
    case 'liftoff': return T(`Отрыв на ${r0(v ?? 0)} узлах`, `Lift-off at ${r0(v ?? 0)} kt`)
    case 'touchdown': return T(`Касание: ${r0(v ?? 0)} фт/мин`, `Touchdown: ${r0(v ?? 0)} ft/min`)
    case 'hardLanding': return T('Жёсткая посадка', 'Hard landing')
    case 'tailstrike': return T('Удар хвостом о полосу!', 'Tail strike!')
    case 'crash': return T('Авария', 'Crash')
    case 'stall': return T('СВАЛИВАНИЕ', 'STALL')
    case 'alphaProt': return T('Защита по углу атаки', 'Alpha protection')
    case 'alphaFloor': return T('A.FLOOR — автоматически TOGA', 'A.FLOOR — automatic TOGA')
    case 'bankLimit': return T('Предел крена 67°', 'Bank limit 67°')
    case 'gearUp': return T('Шасси убирается', 'Gear up')
    case 'gearDown': return T('Шасси выпускается', 'Gear down')
    case 'groundSpoilers': return T('Интерцепторы выпущены', 'Ground spoilers')
    case 'reverse': return T('Реверс', 'Reverse')
    case 'vfe': return T('Превышение VFE — скорость велика для закрылков', 'VFE exceeded — too fast for this flap setting')
    case 'overspeed': return T('Превышение скорости', 'Overspeed')
    case 'offRunway': return T('Выкатились с полосы', 'Off the runway')
    case 'flare': return T('50 футов — выравнивание', '50 ft — flare')
    case 'positiveClimb': return T('Положительная вертикальная', 'Positive climb')
    default: return null
  }
}
void G
