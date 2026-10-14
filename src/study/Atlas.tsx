import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type WheelEvent as RWE } from 'react'
import { useT, T, type Txt } from '../explorer/i18n'
import { TONE, type SystemDef, type St } from './atlasTypes'
import { FS, useFlight } from '../explorer/flight/state'
import { createSim, step, H, A320 } from '../explorer/flight/fdm'
import { OverheadPanel } from '../explorer/flight/Overhead'
import { Ecam, useSnap } from '../explorer/flight/Hud'

/*
 * One system of the atlas: a zoomable, pannable live schematic, its controls, and the explanations.
 */
export function AtlasView({ sys, onClose, onGo }: { sys: SystemDef; onClose: () => void; onGo?: () => void }) {
  const t = useT()
  const init = useMemo(() => Object.fromEntries((sys.ctls ?? []).map((c) => [c.id, c.init])) as St, [sys])
  const [st, setSt] = useState<St>(init)
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => { setSt(init); setSel(null) }, [init])
  const work = { ...st }
  const live = sys.live?.(work) ?? {}
  const part = sys.parts.find((p) => p.id === sel)
  return (
    <div className="atlas" role="dialog" aria-label={t(sys.title)}>
      <header className="atlas-top">
        <button className="btn sm" onClick={onClose}>← {t(T('К списку', 'Back to list'))}</button>
        <div><span className="eyebrow">{t(GROUP[sys.group])}</span><h2>{t(sys.title)}</h2></div>
        {onGo && <button className="btn primary sm" onClick={onGo}>{t(GO[sys.sim ?? 'drive'])}</button>}
      </header>
      <p className="atlas-lead">{t(sys.lead)}</p>
      <div className="atlas-body">
        <div className="atlas-main">
          {sys.widget === 'shift' ? <ShiftWidget /> : sys.widget === 'diff' ? <DiffWidget /> : sys.widget === 'trainer' ? <TrainerWidget /> : (
            <Schematic sys={sys} st={work} live={live} sel={sel} onSel={setSel} />
          )}
          {!!sys.ctls?.length && (
            <div className="atlas-ctls">
              {sys.ctls.map((c) => (
                <label key={c.id}>
                  <span>{t(c.label)}: <b>{c.options ? t(c.options.find((o) => o[0] === st[c.id])?.[1] ?? T('', '')) : `${st[c.id]}${c.unit ? ` ${c.unit}` : ''}`}</b></span>
                  {c.options ? (
                    <div className="fs-seg wrap">{c.options.map(([v, l]) => <button key={v} className={`btn sm ${st[c.id] === v ? 'on' : ''}`} onClick={() => setSt({ ...st, [c.id]: v })}>{t(l)}</button>)}</div>
                  ) : <input type="range" min={c.min} max={c.max} step={c.step} value={st[c.id]} onChange={(e) => setSt({ ...st, [c.id]: +e.target.value })} />}
                </label>
              ))}
            </div>
          )}
          {live.note && <p className={`atlas-note ${live.warn?.length ? 'warn' : ''}`}>{t(live.note)}</p>}
        </div>
        <aside className="atlas-side">
          {part && <div className="atlas-part glass"><span className="eyebrow">{t(T('Деталь', 'Part'))}</span><h3>{t(part.label)}</h3>{part.info.ru && <p>{t(part.info)}</p>}{live.values?.[part.id] && <b className="atlas-val">{live.values[part.id]}</b>}</div>}
          <section><h3>{t(T('Как это работает', 'How it works'))}</h3>{sys.how.map((h, i) => <p key={i}>{t(h)}</p>)}</section>
          {!!sys.donts.length && <section className="atlas-donts"><h3>{t(T('Чего нельзя делать — и что сломается', 'What not to do — and what breaks'))}</h3><ul>{sys.donts.map((d, i) => <li key={i}>{t(d)}</li>)}</ul></section>}
          {!!sys.numbers.length && <section><h3>{t(T('Цифры', 'Numbers'))}</h3><table className="atlas-num"><tbody>{sys.numbers.map(([k, v], i) => <tr key={i}><td>{t(k)}</td><td>{v}</td></tr>)}</tbody></table></section>}
        </aside>
      </div>
    </div>
  )
}
const GROUP: Record<SystemDef['group'], Txt> = { car: T('Системы автомобиля', 'Car systems'), plane: T('Системы самолёта F320', 'F320 aircraft systems'), vortex: T('«Вихрь-240» — новый принцип', 'Vortex-240 — new principle') }
const GO: Record<NonNullable<SystemDef['sim']>, Txt> = { drive: T('Попробовать в автосимуляторе', 'Try it in the driving sim'), flight: T('Попробовать в полёте', 'Try it in flight'), rde: T('Открыть 3D-разбор', 'Open the 3D dive'), vortex: T('Полететь на «Вихре»', 'Fly the Vortex') }

/* ------------------------------------------------------------------ schematic with zoom and pan */
function Schematic({ sys, st, live, sel, onSel }: { sys: SystemDef; st: St; live: ReturnType<NonNullable<SystemDef['live']>>; sel: string | null; onSel: (id: string) => void }) {
  const t = useT()
  const W = sys.w ?? 800, Hh = sys.h ?? 440
  const [vb, setVb] = useState({ x: -10, y: -10, w: W + 20, h: Hh + 20 })
  useEffect(() => setVb({ x: -10, y: -10, w: W + 20, h: Hh + 20 }), [sys, W, Hh])
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; vb: typeof vb } | null>(null)
  const zoom = (k: number, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => {
    const w = Math.max(80, Math.min(W * 2, vb.w * k)), h = (w / vb.w) * vb.h
    setVb({ x: cx - ((cx - vb.x) * w) / vb.w, y: cy - ((cy - vb.y) * h) / vb.h, w, h })
  }
  const onWheel = (e: RWE) => {
    const r = svg.current!.getBoundingClientRect()
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, vb.x + ((e.clientX - r.left) / r.width) * vb.w, vb.y + ((e.clientY - r.top) / r.height) * vb.h)
  }
  const down = (e: RPE) => { drag.current = { x: e.clientX, y: e.clientY, vb }; (e.target as Element).setPointerCapture?.(e.pointerId) }
  const move = (e: RPE) => {
    const d = drag.current; if (!d) return
    const r = svg.current!.getBoundingClientRect()
    setVb({ ...d.vb, x: d.vb.x - ((e.clientX - d.x) / r.width) * d.vb.w, y: d.vb.y - ((e.clientY - d.y) / r.height) * d.vb.h })
  }
  return (
    <div className="atlas-svgwrap">
      <svg ref={svg} className="atlas-svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} onWheel={onWheel} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null }} role="img" aria-label={t(sys.title)}>
        <defs><pattern id="atl-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,.04)" /></pattern></defs>
        <rect x={-2000} y={-2000} width={5000} height={5000} fill="url(#atl-grid)" />
        {sys.pipes.map((p, i) => {
          const f = p.flow ? p.flow(st) : 0.0001
          const on = Math.abs(f) > 0.01
          return <polyline key={i} points={p.pts.map((q) => q.join(',')).join(' ')} fill="none" stroke={TONE[p.tone]} strokeWidth={p.w ?? 3} strokeLinejoin="round" strokeLinecap="round"
            opacity={on || !p.flow ? 0.9 : 0.25} className={on && p.flow ? 'atl-flow' : ''} style={on && p.flow ? { animationDuration: `${Math.max(0.25, 1.4 / Math.abs(f))}s`, animationDirection: f < 0 ? 'reverse' : 'normal' } : undefined} />
        })}
        {sys.parts.map((p) => {
          const warn = live.warn?.includes(p.id), col = p.tone ? TONE[p.tone] : '#c9d2dd'
          const val = live.values?.[p.id]
          return (
            <g key={p.id} className={`atl-part ${sel === p.id ? 'sel' : ''} ${warn ? 'warn' : ''}`} onClick={(e) => { e.stopPropagation(); onSel(p.id) }} onPointerDown={(e) => e.stopPropagation()}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={8} fill="rgba(12,16,22,.92)" stroke={warn ? '#ff4a3d' : col} strokeWidth={sel === p.id ? 2.5 : 1.4} />
              <rect x={p.x} y={p.y} width={5} height={p.h} rx={2} fill={col} />
              <text x={p.x + p.w / 2 + 2} y={p.y + (val ? p.h / 2 - 4 : p.h / 2 + 4)} fill="#eef2f6" fontSize={Math.min(12, (p.w - 12) / (t(p.label).length * 0.56))} textAnchor="middle" fontWeight={600}>{t(p.label)}</text>
              {val && <text x={p.x + p.w / 2 + 2} y={p.y + p.h / 2 + 13} fill={warn ? '#ff8a80' : '#7ff0ab'} fontSize={11} textAnchor="middle" fontFamily="ui-monospace,monospace">{val}</text>}
            </g>
          )
        })}
      </svg>
      <div className="atlas-zoom">
        <button className="btn sm" onClick={() => zoom(1 / 1.4)} aria-label="Zoom in">＋</button>
        <button className="btn sm" onClick={() => zoom(1.4)} aria-label="Zoom out">−</button>
        <button className="btn sm" onClick={() => setVb({ x: -10, y: -10, w: W + 20, h: Hh + 20 })}>⤢</button>
        <small>{t(T('колесо — приближение, тяните — двигать, щёлкните деталь', 'wheel to zoom, drag to pan, click a part'))}</small>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ gearbox: shift matrices and the torque converter */
const BOX = {
  zf8: { name: T('BMW 530i · ZF 8HP', 'BMW 530i · ZF 8HP'), elems: [['A', T('тормоз', 'brake')], ['B', T('тормоз', 'brake')], ['C', T('муфта', 'clutch')], ['D', T('муфта', 'clutch')], ['E', T('муфта', 'clutch')]] as [string, Txt][],
    gears: [['1', 'ABC', 5.0], ['2', 'ABE', 3.2], ['3', 'BCE', 2.143], ['4', 'BDE', 1.72], ['5', 'BCD', 1.314], ['6', 'CDE', 1.0], ['7', 'ACD', 0.822], ['8', 'ADE', 0.64], ['R', 'ABD', -3.456]] as [string, string, number][],
    note: T('4 простых планетарных ряда и 5 элементов; на каждой передаче замкнуты три. При последовательном переключении меняется только один элемент — поэтому переключения быстрые и плавные.', '4 simple planetary sets and 5 shift elements; three are engaged in every gear. A sequential shift swaps only one element — that is why the shifts are fast and smooth.') },
  ac6: { name: T('Toyota Fortuner · Aisin 6AT (схема Лепелетье)', 'Toyota Fortuner · Aisin 6AT (Lepelletier layout)'), elems: [['A', T('муфта', 'clutch')], ['B', T('муфта', 'clutch')], ['E', T('муфта', 'clutch')], ['C', T('тормоз', 'brake')], ['D', T('тормоз', 'brake')]] as [string, Txt][],
    gears: [['1', 'AD', 3.6], ['2', 'AC', 2.09], ['3', 'AB', 1.49], ['4', 'AE', 1.0], ['5', 'BE', 0.69], ['6', 'CE', 0.58], ['R', 'BD', -3.73]] as [string, string, number][],
    note: T('Простой планетарный ряд + ряд Равиньо и 5 элементов, на каждой передаче замкнуты два. Обозначения элементов — условные, по общей схеме Лепелетье; реальные названия у Aisin другие.', 'A simple planetary set + a Ravigneaux set and 5 elements, two engaged per gear. Element letters follow the generic Lepelletier scheme; Aisin’s own names differ.') },
}
function ShiftWidget() {
  const t = useT()
  const [box, setBox] = useState<'zf8' | 'ac6'>('zf8')
  const [g, setG] = useState(0)
  const [sr, setSr] = useState(0.2)
  const b = BOX[box], cur = b.gears[Math.min(g, b.gears.length - 1)], prev = b.gears[Math.max(0, Math.min(g, b.gears.length - 1) - 1)]
  const changed = cur[0] !== 'R' && g > 0 ? { off: [...prev[1]].filter((e) => !cur[1].includes(e)), on: [...cur[1]].filter((e) => !prev[1].includes(e)) } : null
  const tr = Math.max(1, 2 - 1.15 * sr), eff = tr * sr
  return (
    <div className="atlas-widget">
      <div className="fs-seg wrap">{(Object.keys(BOX) as ('zf8' | 'ac6')[]).map((k) => <button key={k} className={`btn sm ${box === k ? 'on' : ''}`} onClick={() => { setBox(k); setG(0) }}>{t(BOX[k].name)}</button>)}</div>
      <table className="atlas-matrix">
        <thead><tr><th>{t(T('Передача', 'Gear'))}</th>{b.elems.map(([e, k]) => <th key={e}>{e}<small>{t(k)}</small></th>)}<th>{t(T('Число', 'Ratio'))}</th></tr></thead>
        <tbody>{b.gears.map(([name, el, r], i) => (
          <tr key={name} className={i === g ? 'on' : ''} onClick={() => setG(i)}>
            <td>{name}</td>{b.elems.map(([e]) => <td key={e}>{el.includes(e) ? <i className={changed && i === g && changed.on.includes(e) ? 'new' : ''}>●</i> : ''}</td>)}<td>{r.toFixed(3)}</td>
          </tr>))}</tbody>
      </table>
      <p className="atlas-note">{changed ? t(T(`Переключение ${prev[0]} → ${cur[0]}: отпускается ${changed.off.join(', ')}, включается ${changed.on.join(', ')}. Блок управления делает это одновременно с перекрытием ≈ 0,2 с, чтобы момент не пропал.`, `Shift ${prev[0]} → ${cur[0]}: ${changed.off.join(', ')} releases, ${changed.on.join(', ')} applies. The TCU overlaps them for ≈ 0.2 s so torque never drops out.`)) : t(b.note)}</p>
      <div className="atlas-tc">
        <b>{t(T('Гидротрансформатор', 'Torque converter'))}</b>
        <label><span>{t(T('Отношение скоростей турбина/насос', 'Turbine / pump speed ratio'))}: <b>{sr.toFixed(2)}</b></span><input type="range" min={0} max={1} step={0.01} value={sr} onChange={(e) => setSr(+e.target.value)} /></label>
        <div className="atlas-bars">
          <div><i style={{ width: `${(tr / 2) * 100}%`, background: '#36e07a' }} /><span>{t(T('Умножение момента', 'Torque ratio'))} ×{tr.toFixed(2)}</span></div>
          <div><i style={{ width: `${eff * 100}%`, background: '#5cd8ff' }} /><span>{t(T('КПД', 'Efficiency'))} {Math.round(eff * 100)} %</span></div>
          <div><i style={{ width: `${(1 - eff) * 100}%`, background: '#ff6a3d' }} /><span>{t(T('В тепло масла', 'Into fluid heat'))} {Math.round((1 - eff) * 100)} %</span></div>
        </div>
        <small>{sr < 0.05 ? t(T('Машина стоит на тормозе, мотор крутит насос: вся мощность — в нагрев ATF. Это стоп-тест — не больше 5 секунд.', 'The car is held on the brake while the engine turns the pump: all the power heats the ATF. That is a stall test — 5 seconds at most.')) : sr > 0.85 ? t(T('Почти равные скорости: момент не умножается, и муфта блокировки соединяет насос с турбиной жёстко — потерь нет.', 'Nearly equal speeds: no torque multiplication, and the lock-up clutch joins pump and turbine solidly — no losses.')) : t(T('Трогание и разгон: момент умножается, но часть мощности уходит в тепло.', 'Pulling away: torque is multiplied, but part of the power goes into heat.'))}</small>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ differential */
function DiffWidget() {
  const t = useT()
  const [R, setR] = useState(15)
  const [ice, setIce] = useState(0)
  const [lock, setLock] = useState(false)
  const track = 1.6, v = 30 / 3.6
  const straight = R >= 100
  const out = straight ? v : (v * (R + track / 2)) / R, inn = straight ? v : (v * (R - track / 2)) / R
  const muL = ice ? 0.12 : 1, muR = 1, load = 4500 // N per wheel
  const fL = muL * load, fR = muR * load
  const traction = lock ? fL + fR : 2 * Math.min(fL, fR)
  const rot = useRef({ a: 0, b: 0 })
  const [, tick] = useState(0)
  useEffect(() => { let id = 0; const loop = () => { rot.current.a += (lock ? v : inn) * 0.04; rot.current.b += (lock ? v : out) * 0.04; tick((n) => n + 1); id = requestAnimationFrame(loop) }; id = requestAnimationFrame(loop); return () => cancelAnimationFrame(id) }, [inn, out, lock, v])
  const wheel = (x: number, ang: number, col: string) => (
    <g transform={`translate(${x} 110)`}>
      <rect x={-22} y={-50} width={44} height={100} rx={10} fill="#15181c" stroke={col} strokeWidth={2} />
      {[0, 1, 2, 3, 4].map((i) => { const y = (((ang * 30 + i * 20) % 100) + 100) % 100 - 50; return <line key={i} x1={-18} x2={18} y1={y} y2={y} stroke="#5b6573" strokeWidth={3} /> })}
    </g>
  )
  return (
    <div className="atlas-widget">
      <svg viewBox="0 0 400 220" className="atlas-diff" role="img" aria-label="Differential">
        {wheel(60, rot.current.a, ice ? '#5cd8ff' : '#c9d2dd')}
        {wheel(340, rot.current.b, '#c9d2dd')}
        <line x1={82} y1={110} x2={318} y2={110} stroke="#c9d2dd" strokeWidth={6} />
        <circle cx={200} cy={110} r={34} fill="#20252c" stroke="#e8c547" strokeWidth={3} />
        <g transform={`rotate(${(rot.current.b - rot.current.a) * 40} 200 110)`}><circle cx={200} cy={88} r={8} fill="#e8c547" /><circle cx={200} cy={132} r={8} fill="#e8c547" /></g>
        <line x1={200} y1={144} x2={200} y2={210} stroke="#c9d2dd" strokeWidth={6} />
        <text x={60} y={190} fill="#9aa4b2" fontSize={11} textAnchor="middle">{t(T('внутр.', 'inner'))} {(lock ? v : inn).toFixed(2)} m/s</text>
        <text x={340} y={190} fill="#9aa4b2" fontSize={11} textAnchor="middle">{t(T('наружн.', 'outer'))} {(lock ? v : out).toFixed(2)} m/s</text>
      </svg>
      <div className="atlas-ctls">
        <label><span>{t(T('Радиус поворота', 'Turn radius'))}: <b>{straight ? '∞' : `${R} m`}</b></span><input type="range" min={5} max={100} step={1} value={R} onChange={(e) => setR(+e.target.value)} /></label>
        <div className="fs-seg wrap">
          <button className={`btn sm ${ice ? 'on' : ''}`} onClick={() => setIce(ice ? 0 : 1)}>{t(T('Левое колесо на льду', 'Left wheel on ice'))}</button>
          <button className={`btn sm ${lock ? 'on' : ''}`} onClick={() => setLock(!lock)}>{t(T('Блокировка', 'Diff lock'))}</button>
        </div>
      </div>
      <p className={`atlas-note ${lock && !straight ? 'warn' : ''}`}>{lock && !straight
        ? t(T(`Блокировка в повороте: колёса вынуждены крутиться одинаково, хотя путь у них разный на ${((out - inn) / v * 100).toFixed(0)} % — одна шина скребёт, полуоси скручиваются, машина не хочет поворачивать.`, `Locked in a turn: the wheels must turn together though their paths differ by ${((out - inn) / v * 100).toFixed(0)} % — one tyre scrubs, the half-shafts wind up, the car resists turning.`))
        : t(T(`Тяговое усилие моста: ${(traction / 1000).toFixed(1)} кН. ${ice && !lock ? 'Свободный дифференциал делит момент поровну, поэтому второе колесо получает столько же, сколько держит колесо на льду, — машина почти не едет.' : ice && lock ? 'С блокировкой колесо с хорошим сцеплением тянет за двоих.' : 'Скорости колёс разные, момент — одинаковый.'}`, `Axle tractive force: ${(traction / 1000).toFixed(1)} kN. ${ice && !lock ? 'An open differential splits torque equally, so the good wheel only gets what the icy wheel can hold — the car barely moves.' : ice && lock ? 'Locked, the wheel with grip pulls for both.' : 'Different wheel speeds, equal torque.'}`))}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ live F320 systems trainer */
function TrainerWidget() {
  const t = useT()
  const ready = useRef(false)
  if (!ready.current) {
    ready.current = true
    FS.sim = createSim('gate', A320)
    useFlight.getState().set({ ac: 'a320', overhead: true, guide: false })
  }
  useEffect(() => {
    const id = setInterval(() => { for (let i = 0; i < Math.round(0.05 / H); i++) step(FS.sim, H) }, 50)
    return () => clearInterval(id)
  }, [])
  const v = useSnap(10)
  const [, force] = useState(0)
  const c = FS.sim.ctl
  return (
    <div className="atlas-trainer">
      <OverheadPanel v={v} hl={null} />
      <div className="atlas-trainer-row">
        <Ecam v={v} />
        <div className="atlas-trainer-ctl">
          <span className="eyebrow">{t(T('Пьедестал', 'Pedestal'))}</span>
          <div className="fs-seg wrap">
            {[0, 1].map((i) => <button key={i} className={`btn sm ${c.master[i] ? 'on' : ''}`} onClick={() => { c.master[i] = !c.master[i]; force((n) => n + 1) }}>MASTER {i + 1} {v.eng[i] === 'run' ? '●' : v.eng[i] === 'starting' ? '◐' : '○'}</button>)}
          </div>
          <div className="fs-seg wrap">
            <button className={`btn sm ${c.lever < 0.05 ? 'on' : ''}`} onClick={() => { c.lever = 0; force((n) => n + 1) }}>{t(T('РУД IDLE', 'Levers IDLE'))}</button>
            <button className={`btn sm ${c.lever > 0.05 ? 'on' : ''}`} onClick={() => { c.lever = 0.3; force((n) => n + 1) }}>{t(T('РУД 30 % (ошибка)', 'Levers 30 % (mistake)'))}</button>
          </div>
          <button className="btn sm" onClick={() => { FS.sim = createSim('gate', A320); force((n) => n + 1) }}>{t(T('Сбросить — холодный самолёт', 'Reset — cold aircraft'))}</button>
          <p className="atlas-note">{t(T('N2', 'N2'))}: {v.n2.map((n) => `${n.toFixed(0)} %`).join(' / ')} · EGT {v.egt.map((e) => Math.round(e)).join(' / ')} °C · {t(T('гидравлика', 'hydraulics'))} G {Math.round(v.sys.hyd.G)} B {Math.round(v.sys.hyd.B)} Y {Math.round(v.sys.hyd.Y)}</p>
        </div>
      </div>
    </div>
  )
}
