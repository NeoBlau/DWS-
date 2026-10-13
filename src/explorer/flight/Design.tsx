import { useMemo } from 'react'
import { useT, T, type Txt } from '../i18n'
import { A320, STRIZH, G, KT, confAt, type Spec } from './fdm'
import { cruise, ldMax } from './perf'

/*
 * Design brief of the «Стриж-180» and a comparison with today's narrow-bodies.
 * Numbers for A320 and Strizh are computed from the same models the simulator flies with;
 * competitor figures are rounded public manufacturer data (typical 2-class seating).
 */
function computed(sp: Spec) {
  const midMass = sp.oew + sp.payload + 5000
  const c = cruise(sp, midMass, 10668, 0.78)
  const land = sp.oew + sp.payload + 2500
  const full = confAt(sp.confs.length - 1, sp.confs)
  const vs = Math.sqrt((2 * land * G) / (1.225 * sp.S * (full.cl0 + sp.CLA * full.as))) / KT
  const range = ((sp.fuelMax - 2000) / c.ff) * c.tas * 1.852
  return { ldMax: ldMax(sp), ld: c.LD, ff: c.ff, seat: c.perSeat100km, co2: c.co2PerSeat100km, vapp: vs * 1.23 + 5, range, ar: (sp.b * sp.b) / sp.S }
}
interface Col { name: Txt; seats: string; span: string; ar: string; engine: Txt; mtow: string; ldMax: string; seat: string; co2: string; vapp: string; range: string; model: boolean }
export function DesignPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const a = useMemo(() => computed(A320), []), s = useMemo(() => computed(STRIZH), [])
  const f1 = (n: number) => n.toFixed(1), f2 = (n: number) => n.toFixed(2), r0 = (n: number) => String(Math.round(n))
  const cols: Col[] = [
    { name: T('Стриж-180 (проект)', 'Strizh-180 (design)'), seats: '180', span: '47.3 / 36.0*', ar: f1(s.ar), engine: T('2 × открытый вентилятор, m ≈ 60', '2 × open fan, BPR ≈ 60'), mtow: '≈ 70', ldMax: f1(s.ldMax), seat: f2(s.seat), co2: f2(s.co2), vapp: r0(s.vapp), range: `≈ ${Math.round(s.range / 100) * 100}`, model: true },
    { name: T('A320 (модель тренажёра)', 'A320 (simulator model)'), seats: '180', span: '34.1', ar: f1(a.ar), engine: T('2 × ТРДД CFM56 / LEAP, m ≈ 6–11', '2 × turbofan CFM56 / LEAP, BPR ≈ 6–11'), mtow: '78–79', ldMax: f1(a.ldMax), seat: f2(a.seat), co2: f2(a.co2), vapp: r0(a.vapp), range: `≈ ${Math.round(a.range / 100) * 100}`, model: true },
    { name: T('Boeing 737 MAX 8', 'Boeing 737 MAX 8'), seats: '162–178', span: '35.9', ar: '≈ 10', engine: T('2 × LEAP-1B, m ≈ 9', '2 × LEAP-1B, BPR ≈ 9'), mtow: '82.2', ldMax: '—', seat: '—', co2: '—', vapp: '—', range: '≈ 6 500', model: false },
    { name: T('Airbus A220-300', 'Airbus A220-300'), seats: '130–160', span: '35.1', ar: '≈ 11', engine: T('2 × PW1500G, m ≈ 12', '2 × PW1500G, BPR ≈ 12'), mtow: '70.9', ldMax: '—', seat: '—', co2: '—', vapp: '—', range: '≈ 6 300', model: false },
  ]
  const rows: [Txt, keyof Col][] = [
    [T('Кресел (2 класса)', 'Seats (2-class)'), 'seats'], [T('Размах, м', 'Span, m'), 'span'], [T('Удлинение крыла', 'Wing aspect ratio'), 'ar'], [T('Двигатели', 'Engines'), 'engine'],
    [T('Макс. взлётная масса, т', 'MTOW, t'), 'mtow'], [T('Макс. аэродин. качество L/D', 'Max lift-to-drag L/D'), 'ldMax'], [T('Топливо, кг на кресло на 100 км', 'Fuel, kg per seat per 100 km'), 'seat'],
    [T('CO₂, кг на кресло на 100 км', 'CO₂, kg per seat per 100 km'), 'co2'], [T('Скорость захода, уз', 'Approach speed, kt'), 'vapp'], [T('Дальность, км', 'Range, km'), 'range'],
  ]
  const gain = Math.round((1 - s.seat / a.seat) * 100)
  const ideas: [Txt, Txt][] = [
    [T('Крыло большого удлинения с подкосом', 'High-aspect-ratio truss-braced wing'), T(`Индуктивное сопротивление ∝ CL² / (π·e·AR). Удлинение ${f1(s.ar)} против ${f1(a.ar)} у A320 — индуктивное сопротивление почти вдвое меньше. Подкос берёт на себя изгибающий момент, поэтому длинное крыло получается тонким и лёгким. Законцовки складываются у терминала: на стоянке размах 36 м, как у A320.`, `Induced drag ∝ CL² / (π·e·AR). An aspect ratio of ${f1(s.ar)} versus ${f1(a.ar)} on the A320 nearly halves induced drag. The strut carries the bending moment, so the long wing can be thin and light. The tips fold at the gate: 36 m span on the stand, like an A320.`)],
    [T('Ламинарный профиль и щитки Крюгера', 'Laminar airfoil and Krueger flaps'), T('Гладкая верхняя поверхность без зазоров предкрылков держит ламинарный поток на ~40 % хорды — меньше трения. Механизация передней кромки (Крюгер) выдвигается снизу и не нарушает эту поверхность.', 'A smooth, gap-free upper surface keeps the boundary layer laminar over ~40 % of the chord — less skin friction. The Krueger leading-edge devices deploy from below and leave that surface intact.')],
    [T('Открытый вентилятор', 'Open fan'), T('Тяга = расход воздуха × прирост скорости. Огромный вентилятор Ø 4 м разгоняет много воздуха чуть-чуть — пропульсивный КПД выше, удельный расход топлива на ~20 % ниже, чем у ТРДД. На высоком крыле лопасти далеко от земли.', 'Thrust = air mass flow × velocity increase. A 4 m fan accelerates a lot of air a little — higher propulsive efficiency, ~20 % lower specific fuel consumption than a turbofan. On a high wing the blades are far from the ground.')],
    [T('Композит и «электрический» самолёт', 'Composite, more-electric aircraft'), T('Фюзеляж и крыло из термопластичного углепластика, рули — электромеханические приводы вместо гидравлики. Пустой самолёт на ≈ 11 % легче — меньше подъёмная сила нужна, меньше сопротивление.', 'Thermoplastic carbon fuselage and wing, electro-mechanical actuators instead of hydraulics. An ≈ 11 % lighter empty aircraft needs less lift and so makes less drag.')],
  ]
  const tradeoffs: Txt[] = [
    T('Двигатели над центром тяжести: при даче газа нос опускается — это компенсирует fly-by-wire.', 'Engines above the CG: adding thrust pitches the nose down — fly-by-wire compensates.'),
    T('Большой размах — больше момент инерции: крен отрабатывается медленнее, чем у A320.', 'The big span means more roll inertia: roll response is slower than an A320.'),
    T('Высокое крыло дальше от земли — слабее экранный эффект, самолёт меньше «плывёт» при выравнивании.', 'A high wing sits farther from the ground — less ground effect, less float in the flare.'),
    T('Открытый вентилятор шумнее в салоне без защитного кожуха — нужна звукоизоляция и особая форма лопастей.', 'An unducted fan is louder in the cabin — it needs insulation and carefully shaped blades.'),
  ]
  return (
    <div className="fs-design-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="fs-design glass" role="dialog" aria-label="Strizh-180 design">
        <header><div><span className="eyebrow">{t(T('Собственный проект', 'Own design'))}</span><h2>{t(T('«Стриж-180»: на', 'Strizh-180:'))} {gain}% {t(T('меньше топлива на кресло, чем A320', 'less fuel per seat than the A320'))}</h2></div><button className="btn sm" onClick={onClose}>✕</button></header>
        <div className="fs-ideas">{ideas.map(([h, b], i) => <div key={i}><b>{t(h)}</b><p>{t(b)}</p></div>)}</div>
        <div className="fs-table-wrap">
          <table className="fs-table">
            <thead><tr><th />{cols.map((c, i) => <th key={i} className={c.model ? 'mod' : ''}>{t(c.name)}</th>)}</tr></thead>
            <tbody>{rows.map(([label, k]) => <tr key={k}><td>{t(label)}</td>{cols.map((c, i) => { const v = c[k]; return <td key={i}>{typeof v === 'object' ? t(v as Txt) : String(v)}</td> })}</tr>)}</tbody>
          </table>
        </div>
        <p className="fs-small">{t(T('* размах со сложенными законцовками. Значения A320 и «Стрижа» рассчитаны одной и той же моделью на крейсерском режиме M 0,78, высота ≈ 10,7 км, 5 т топлива в баках; дальность — при максимальной заправке без учёта изменения массы, с резервом 2 т. Для 737 MAX 8 и A220-300 — округлённые открытые данные производителей; расход по ним не приводим, чтобы не сравнивать разные методики.', '* span with the tips folded. A320 and Strizh values are computed by the same model in cruise at M 0.78, ≈ 10.7 km, 5 t of fuel on board; range is at full fuel ignoring the mass change, with a 2 t reserve. 737 MAX 8 and A220-300 are rounded public manufacturer figures; fuel burn is not listed for them to avoid mixing methods.'))}</p>
        <b className="fs-sub">{t(T('Честные компромиссы — их почувствуете в полёте', 'Honest trade-offs — you will feel them in flight'))}</b>
        <ul className="fs-trade">{tradeoffs.map((x, i) => <li key={i}>{t(x)}</li>)}</ul>
      </section>
    </div>
  )
}
