import { useMemo, useState } from 'react'
import { useT, T, type Txt } from '../i18n'
import { A320, STRIZH, VORTEX, type Spec } from './fdm'
import { cruise, ldMax, vapp, aspectRatio } from './perf'
import { useFlight } from './state'

/*
 * Design briefs of the two own aircraft and a comparison with today's narrow-bodies.
 * Numbers for F320, Strizh and Vortex are computed from the same models the simulator flies with, each at its
 * own design cruise point; competitor figures are rounded public manufacturer data (typical 2-class seating).
 */
function computed(sp: Spec) {
  const lh2 = sp.fuelKind === 'lh2'
  // mid-cruise fuel load; trimmed on the vortex lattice, thrust = drag on the gas-path engine model
  const c = cruise(sp, lh2 ? 1800 : 5000, sp.cruiseAt.alt, sp.cruiseAt.mach)
  const reserve = lh2 ? 800 : 2000
  const range = ((sp.fuelMax - reserve) / c.ff) * c.tas * 1.852
  return { ldMax: ldMax(sp), ld: c.LD, ff: c.ff, seat: c.perSeat100km, mj: c.perSeat100km * sp.lhv, co2: c.co2PerSeat100km, vapp: vapp(sp, lh2 ? 900 : 2500), range, ar: aspectRatio(sp), tas: c.tas, ok: c.ok, tsfc: c.ff / c.D }
}
interface Col { name: Txt; seats: string; span: string; ar: string; engine: Txt; cruise: string; ldMax: string; seat: string; mj: string; co2: string; vapp: string; range: string; model: boolean }
type Which = 'strizh' | 'vortex'

export function DesignPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const ac = useFlight((s) => s.ac)
  const [tab, setTab] = useState<Which>(ac === 'vortex' ? 'vortex' : 'strizh')
  const a = useMemo(() => computed(A320), []), s = useMemo(() => computed(STRIZH), []), v = useMemo(() => computed(VORTEX), [])
  const f1 = (n: number) => n.toFixed(1), f2 = (n: number) => n.toFixed(2), r0 = (n: number) => String(Math.round(n))
  const rng = (n: number) => `≈ ${Math.round(n / 100) * 100}`
  const cols: Col[] = [
    { name: T('Вихрь-240 (проект)', 'Vortex-240 (design)'), seats: '240', span: '52.0 / 36.0*', ar: f1(v.ar), engine: T('2 × водородный детонационный турбогенератор → 8 эл. вентиляторов', '2 × hydrogen detonation turbo-generator → 8 electric fans'), cruise: `M ${VORTEX.cruiseAt.mach} · ${r0(v.tas)} kt`, ldMax: f1(v.ldMax), seat: `${f2(v.seat)} LH2`, mj: f1(v.mj), co2: '0', vapp: r0(v.vapp), range: rng(v.range), model: true },
    { name: T('Стриж-180 (проект)', 'Strizh-180 (design)'), seats: '180', span: '47.3 / 36.0*', ar: f1(s.ar), engine: T('2 × открытый вентилятор, m ≈ 60', '2 × open fan, BPR ≈ 60'), cruise: `M ${STRIZH.cruiseAt.mach} · ${r0(s.tas)} kt`, ldMax: f1(s.ldMax), seat: f2(s.seat), mj: f1(s.mj), co2: f2(s.co2), vapp: r0(s.vapp), range: rng(s.range), model: true },
    { name: T('Fiber F320 (модель тренажёра)', 'Fiber F320 (simulator model)'), seats: '180', span: '34.1', ar: f1(a.ar), engine: T('2 × ТРДД CFM56 / LEAP, m ≈ 6–11', '2 × turbofan CFM56 / LEAP, BPR ≈ 6–11'), cruise: `M ${A320.cruiseAt.mach} · ${r0(a.tas)} kt`, ldMax: f1(a.ldMax), seat: f2(a.seat), mj: f1(a.mj), co2: f2(a.co2), vapp: r0(a.vapp), range: rng(a.range), model: true },
    { name: T('Boeing 737 MAX 8', 'Boeing 737 MAX 8'), seats: '162–178', span: '35.9', ar: '≈ 10', engine: T('2 × LEAP-1B, m ≈ 9', '2 × LEAP-1B, BPR ≈ 9'), cruise: 'M 0.79', ldMax: '—', seat: '—', mj: '—', co2: '—', vapp: '—', range: '≈ 6 500', model: false },
    { name: T('Airbus A220-300', 'Airbus A220-300'), seats: '130–160', span: '35.1', ar: '≈ 11', engine: T('2 × PW1500G, m ≈ 12', '2 × PW1500G, BPR ≈ 12'), cruise: 'M 0.78', ldMax: '—', seat: '—', mj: '—', co2: '—', vapp: '—', range: '≈ 6 300', model: false },
  ]
  const rows: [Txt, keyof Col][] = [
    [T('Кресел (2 класса)', 'Seats (2-class)'), 'seats'], [T('Размах в полёте / на стоянке, м', 'Span in flight / at the gate, m'), 'span'], [T('Удлинение крыла', 'Aspect ratio'), 'ar'], [T('Силовая установка', 'Propulsion'), 'engine'],
    [T('Крейсерский режим', 'Cruise'), 'cruise'], [T('Макс. аэродин. качество L/D', 'Max lift-to-drag L/D'), 'ldMax'], [T('Топливо, кг на кресло на 100 км', 'Fuel, kg per seat per 100 km'), 'seat'],
    [T('Энергия, МДж на кресло на 100 км', 'Energy, MJ per seat per 100 km'), 'mj'], [T('CO₂ в полёте, кг на кресло на 100 км', 'CO₂ in flight, kg per seat per 100 km'), 'co2'], [T('Скорость захода, уз', 'Approach speed, kt'), 'vapp'], [T('Дальность, км', 'Range, km'), 'range'],
  ]
  const gainS = Math.round((1 - s.mj / a.mj) * 100), gainV = Math.round((1 - v.mj / a.mj) * 100)
  const IDEAS: Record<Which, [Txt, Txt][]> = {
    strizh: [
      [T('Крыло большого удлинения с подкосом', 'High-aspect-ratio truss-braced wing'), T(`Индуктивное сопротивление ∝ CL² / (π·e·AR). Удлинение ${f1(s.ar)} против ${f1(a.ar)} у F320 — индуктивное сопротивление почти вдвое меньше. Подкос берёт на себя изгибающий момент, поэтому длинное крыло получается тонким и лёгким. Законцовки складываются у терминала: на стоянке размах 36 м, как у F320.`, `Induced drag ∝ CL² / (π·e·AR). An aspect ratio of ${f1(s.ar)} versus ${f1(a.ar)} on the F320 nearly halves induced drag. The strut carries the bending moment, so the long wing can be thin and light. The tips fold at the gate: 36 m span on the stand, like an F320.`)],
      [T('Ламинарный профиль и щитки Крюгера', 'Laminar airfoil and Krueger flaps'), T('Гладкая верхняя поверхность без зазоров предкрылков держит ламинарный поток на ~40 % хорды — меньше трения. Механизация передней кромки (Крюгер) выдвигается снизу и не нарушает эту поверхность.', 'A smooth, gap-free upper surface keeps the boundary layer laminar over ~40 % of the chord — less skin friction. The Krueger leading-edge devices deploy from below and leave that surface intact.')],
      [T('Открытый вентилятор', 'Open fan'), T(`Тяга = расход воздуха × прирост скорости. Огромный вентилятор Ø 4 м разгоняет много воздуха чуть-чуть — пропульсивный КПД выше. По модели двигателя удельный расход на крейсерском режиме ${f1((1 - s.tsfc / a.tsfc) * 100)} % ниже, чем у ТРДД F320 (${s.tsfc.toFixed(3)} против ${a.tsfc.toFixed(3)} кг/(Н·ч)).`, `Thrust = air mass flow × velocity increase. A 4 m fan accelerates a lot of air a little — higher propulsive efficiency. The engine model gives a cruise specific fuel consumption ${f1((1 - s.tsfc / a.tsfc) * 100)} % below the F320 turbofan (${s.tsfc.toFixed(3)} versus ${a.tsfc.toFixed(3)} kg/(N·h)).`)],
      [T('Композит и «электрический» самолёт', 'Composite, more-electric aircraft'), T('Термопластичный углепластик, электрогидростатические приводы рулей вместо центральной гидравлики, электрический запуск и электрокомпрессоры кабины вместо отбора воздуха. Пустой самолёт на ≈ 11 % легче.', 'Thermoplastic carbon structure, electro-hydrostatic actuators instead of central hydraulics, electric engine start and electric cabin compressors instead of bleed air. An ≈ 11 % lighter empty aircraft.')],
    ],
    vortex: [
      [T('Детонационное горение вместо обычного', 'Detonation instead of ordinary burning'), T('В обычном двигателе топливо горит при почти постоянном давлении (цикл Брайтона) и даже теряет 3–5 % давления. В ротационной детонационной камере (RDE) смесь сгорает в ударной волне, которая со скоростью ≈ 2 км/с бежит по кольцу: сгорание идёт почти при постоянном объёме и само повышает давление (цикл Хамфри/Фиккетта–Джейкобса). При той же степени сжатия компрессора турбина получает больше работы. Теоретический предел — ≈ 15 % топлива; в модели заложен осторожный прирост полного давления +12 % (обычная камера теряет 4 %), и он даёт ≈ 5,5 %. Водород детонирует легче керосина: широкие пределы, быстрая кинетика.', 'An ordinary engine burns fuel at nearly constant pressure (Brayton cycle) and even loses 3–5 % of it. In a rotating detonation combustor (RDE) the mixture burns inside a shock wave racing round an annulus at ≈ 2 km/s: combustion happens at nearly constant volume and itself raises the pressure (Humphrey / Fickett–Jacobs cycle). At the same compressor pressure ratio the turbine gets more work. The theoretical limit is ≈ 15 % less fuel; the model assumes a cautious +12 % total-pressure gain (an ordinary combustor loses 4 %), which yields ≈ 5.5 %. Hydrogen detonates far more readily than kerosene: wide limits, fast chemistry.')],
      [T('Холодный водород = топливо и охладитель', 'Cold hydrogen is both fuel and coolant'), T('Жидкий водород (−253 °C) по пути к двигателям охлаждает сверхпроводящие генераторы, кабели и моторы. Сверхпроводник почти не греется: КПД передачи ≈ 99,5 %, а моторы в разы легче медных. Энергия водорода — 120 МДж/кг против 43 у керосина, поэтому топлива по массе в 2,8 раза меньше; цена — объём: баки занимают заднюю часть центроплана.', 'Liquid hydrogen (−253 °C) cools the superconducting generators, cables and motors on its way to the engines. A superconductor barely heats: ≈ 99.5 % transmission efficiency and motors several times lighter than copper ones. Hydrogen carries 120 MJ/kg against 43 for kerosene, so 2.8× less fuel mass; the price is volume — the tanks fill the aft centre body.')],
      [T('Вентиляторы глотают пограничный слой', 'Fans swallow the boundary layer'), T('Воздух у обшивки тормозится трением — за самолётом остаётся «след» медленного воздуха, это и есть сопротивление. Восемь вентиляторов на спине засасывают этот медленный слой и разгоняют его: след «заполняется», и та же тяга получается с ≈ 8 % меньшей мощностью. Корпус ещё и экранирует шум вентиляторов от земли.', 'Friction slows the air next to the skin — the aircraft leaves a wake of slow air, and that is drag. Eight fans on the back ingest this slow layer and re-energise it: the wake is filled and the same thrust needs ≈ 8 % less power. The body also shields the fan noise from the ground.')],
      [T('Несущий корпус и общая шина', 'Lifting body and a shared bus'), T(`Пассажирский салон — сам часть крыла: весь самолёт несёт, низкая нагрузка на крыло даёт заход на ${r0(v.vapp)} уз. Любое ядро питает любой вентилятор через общую шину: отказ двигателя — это минус половина мощности, но никакого разворота, педали не нужны. Консоли складываются: в полёте 52 м, на стоянке 36 м — встаёт на место F320.`, `The cabin is part of the wing: the whole aircraft lifts, and the low wing loading gives a ${r0(v.vapp)} kt approach. Any core feeds any fan through a shared bus: an engine failure halves the power but gives no yaw at all, no rudder needed. The outer panels fold: 52 m in flight, 36 m at the gate — it parks on an F320 stand.`)],
    ],
  }
  const TRADE: Record<Which, Txt[]> = {
    strizh: [
      T('Двигатели над центром тяжести: при даче газа нос опускается — это компенсирует fly-by-wire.', 'Engines above the CG: adding thrust pitches the nose down — fly-by-wire compensates.'),
      T('Большой размах — больше момент инерции: крен отрабатывается медленнее, чем у F320.', 'The big span means more roll inertia: roll response is slower than an F320.'),
      T('Высокое крыло дальше от земли — слабее экранный эффект, самолёт меньше «плывёт» при выравнивании.', 'A high wing sits farther from the ground — less ground effect, less float in the flare.'),
      T('Открытый вентилятор шумнее в салоне — нужна звукоизоляция и особая форма лопастей; крейсер медленнее (M 0,74).', 'An unducted fan is louder in the cabin — insulation and special blades needed; slower cruise (M 0.74).'),
    ],
    vortex: [
      T(`Максимальное качество ${f1(v.ldMax)} (у «Стрижа» ${f1(s.ldMax)}), но на крейсерском режиме — ${f1(v.ld)}: толстый центроплан рано набирает волновое сопротивление, поэтому крейсер M 0,80, а не 0,84. Заход идёт на угле атаки ≈ 12° (у бесхвостки мала производная подъёмной силы) — выравнивать нужно раньше, с 60 футов.`, `Best lift-to-drag ${f1(v.ldMax)} (Strizh ${f1(s.ldMax)}), but ${f1(v.ld)} at cruise: the thick centre body meets wave drag early, so it cruises at M 0.80, not 0.84. The approach is flown at ≈ 12° angle of attack (a tailless wing has a low lift slope) — start the flare earlier, from 60 ft.`),
      T('Нужна водородная инфраструктура в аэропортах и криогенные баки; водяной пар даёт инверсионные следы, детонация — оксиды азота.', 'It needs hydrogen at airports and cryogenic tanks; the water vapour makes contrails, detonation makes NOx.'),
      T('Готовность технологий: ротационные детонационные двигатели и сверхпроводящие моторы пока испытываются на стендах (уровень готовности ≈ 4–5 из 9).', 'Technology readiness: rotating detonation engines and superconducting motors are still on test stands (readiness ≈ 4–5 of 9).'),
      T('Без хвоста тангаж — только элевоны на стреловидных консолях: запас устойчивости всего 8–10 % САХ, ЭДСУ обязательна. Закрылков нет — их пикирующий момент нечем уравновесить. Элевон вверх сначала уменьшает подъёмную силу, поэтому при выравнивании самолёт на мгновение «проседает». В крене дальние кресла ходят вверх-вниз сильнее, иллюминаторов мало.', 'With no tail, pitch comes only from the elevons on the swept outer panels: the static margin is just 8–10 % MAC, fly-by-wire is mandatory. No flaps — nothing could trim their nose-down moment. Raising an elevon first reduces lift, so the aircraft sags for a moment in the flare. Outer seats move more in roll, and there are few windows.'),
    ],
  }
  const title = tab === 'vortex'
    ? `${t(T('«Вихрь-240»: на', 'Vortex-240:'))} ${gainV}% ${t(T('меньше энергии на кресло, чем F320, и без CO₂', 'less energy per seat than the F320, with no CO₂'))}`
    : `${t(T('«Стриж-180»: на', 'Strizh-180:'))} ${gainS}% ${t(T('меньше топлива на кресло, чем F320', 'less fuel per seat than the F320'))}`
  return (
    <div className="fs-design-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="fs-design glass" role="dialog" aria-label="Own designs">
        <header>
          <div><span className="eyebrow">{t(T('Собственные проекты', 'Own designs'))}</span><h2>{title}</h2></div>
          <div className="fs-seg">
            <button className={`btn sm ${tab === 'strizh' ? 'on' : ''}`} onClick={() => setTab('strizh')}>{t(T('Стриж-180', 'Strizh-180'))}</button>
            <button className={`btn sm ${tab === 'vortex' ? 'on' : ''}`} onClick={() => setTab('vortex')}>{t(T('Вихрь-240', 'Vortex-240'))}</button>
            <button className="btn sm" onClick={onClose}>✕</button>
          </div>
        </header>
        <div className="fs-ideas">{IDEAS[tab].map(([h, b], i) => <div key={i}><b>{t(h)}</b><p>{t(b)}</p></div>)}</div>
        <div className="fs-table-wrap">
          <table className="fs-table">
            <thead><tr><th />{cols.map((c, i) => <th key={i} className={c.model ? 'mod' : ''}>{t(c.name)}</th>)}</tr></thead>
            <tbody>{rows.map(([label, k]) => <tr key={k}><td>{t(label)}</td>{cols.map((c, i) => { const val = c[k]; return <td key={i}>{typeof val === 'object' ? t(val as Txt) : String(val)}</td> })}</tr>)}</tbody>
          </table>
        </div>
        <p className="fs-small">{t(T('* размах со сложенными консолями. Значения трёх моделей рассчитаны одной и той же моделью на собственном крейсерском режиме каждого (F320 — M 0,78 на 10,7 км; «Стриж» — M 0,74 на 10,7 км; «Вихрь» — M 0,80 на 12,5 км): балансировка по вихревой решётке, тяга = сопротивление на газодинамической модели двигателя, середина полёта. «Энергия» сравнивает разное топливо честно: керосин 43,2 МДж/кг, водород 120 МДж/кг. Для 737 MAX 8 и A220-300 — округлённые открытые данные; расход по ним не приводим, чтобы не смешивать методики. «Вихрь» — концепт: цифры физически согласованы, но не сертифицированы.', '* span with the outer panels folded. The three modelled aircraft are computed by the same model at each one’s own design cruise (F320 M 0.78 at 10.7 km; Strizh M 0.74 at 10.7 km; Vortex M 0.80 at 12.5 km): trimmed on the vortex lattice, thrust = drag on the gas-path engine model, mid-cruise. “Energy” compares different fuels fairly: kerosene 43.2 MJ/kg, hydrogen 120 MJ/kg. 737 MAX 8 and A220-300 are rounded public figures; their fuel burn is not listed to avoid mixing methods. Vortex is a concept: the numbers are physically consistent, not certified.'))}</p>
        <b className="fs-sub">{t(T('Честные компромиссы — их почувствуете в полёте', 'Honest trade-offs — you will feel them in flight'))}</b>
        <ul className="fs-trade">{TRADE[tab].map((x, i) => <li key={i}>{t(x)}</li>)}</ul>
      </section>
    </div>
  )
}
