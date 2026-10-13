import { useState } from 'react'
import { useT, T, type Txt } from '../i18n'
import { FS, useFlight } from './state'
import { IR_ALIGN_S, quickPrep, type Sys, type Switches } from './systems'
import type { Snap } from './Hud'

/*
 * Overhead panel and system display (SD) pages. Every switch here changes the real state the flight model
 * runs on (systems.ts): what is not powered, pressurised or fed does not work.
 */

type PBProps = { id: string; label: string; on: boolean; onClick: () => void; top?: string; topCol?: 'amber' | 'green' | 'blue' | ''; off?: string; hl?: string | null; note?: string }
function PB({ id, label, on, onClick, top, topCol = '', off = 'OFF', hl, note }: PBProps) {
  return (
    <div className={`ov-pb ${hl === id ? 'fs-hl' : ''}`}>
      <small>{label}</small>
      <button onClick={onClick} aria-pressed={on} aria-label={label}>
        <i className={`ov-top ${top ? topCol : ''}`}>{top ?? ''}</i>
        <i className={`ov-bot ${!on ? 'lit' : ''}`}>{!on ? off : ''}</i>
      </button>
      {note && <em>{note}</em>}
    </div>
  )
}

export function OverheadPanel({ v, hl }: { v: Snap; hl: string | null }) {
  const t = useT()
  const ui = useFlight()
  const [tab, setTab] = useState<'ELEC' | 'HYD' | 'FUEL' | 'BLEED' | 'COND'>('ELEC')
  const [, force] = useState(0)
  if (!ui.overhead) return null
  const y = v.sys, sw = FS.sim.sys.sw, elec = v.arch === 'electric'
  const tog = (f: (s: Switches) => void) => { f(FS.sim.sys.sw); force((n) => n + 1) }
  const volts = (i: number) => (y.sw.bat[i] ? (y.dc ? 28.2 : 23 + 3.2 * y.bat[i]) : 0).toFixed(1)
  const apu = y.apu
  return (
    <section className="ov glass" aria-label="Overhead panel">
      <header>
        <span className="eyebrow">{t(T('Верхний пульт · системы', 'Overhead panel · systems'))}</span>
        <button className="btn sm" onClick={() => { quickPrep(FS.sim.sys); force((n) => n + 1) }} title={t(T('Щёлкает переключатели за второго пилота; ожидания (ВСУ, выставка ИНС) остаются', 'Sets the switches like a first officer would; the waits (APU, IR alignment) remain'))}>{t(T('Подготовка кабины', 'Cockpit prep'))}</button>
        <button className="btn sm" onClick={() => ui.set({ overhead: false })}>✕</button>
      </header>
      <div className="ov-body">
        <div className="ov-grid">
          <fieldset><legend>ELEC</legend>
            <PB id="bat1" hl={hl} label={`BAT 1 · ${volts(0)}V`} on={y.sw.bat[0]} onClick={() => tog((s) => { s.bat[0] = !s.bat[0] })} />
            <PB id="bat2" hl={hl} label={`BAT 2 · ${volts(1)}V`} on={y.sw.bat[1]} onClick={() => tog((s) => { s.bat[1] = !s.bat[1] })} />
            <PB id="ext" hl={hl} label="EXT PWR" on={y.sw.ext} off="" top={y.sw.ext && y.extAvail ? 'ON' : y.extAvail ? 'AVAIL' : y.extTorn ? 'TORN' : ''} topCol={y.sw.ext && y.extAvail ? 'blue' : y.extTorn ? 'amber' : 'green'} onClick={() => tog((s) => { s.ext = !s.ext })} />
            <PB id="gen1" hl={hl} label="GEN 1" on={y.sw.gen[0]} top={y.sw.gen[0] && v.eng[0] === 'run' && !y.acSrc.includes('GEN 1') ? 'FAULT' : ''} topCol="amber" onClick={() => tog((s) => { s.gen[0] = !s.gen[0] })} />
            <PB id="apugen" hl={hl} label="APU GEN" on={y.sw.apuGen} top={!y.sw.apuGen && apu.state === 'avail' ? 'OFF' : ''} topCol="amber" onClick={() => tog((s) => { s.apuGen = !s.apuGen })} />
            <PB id="gen2" hl={hl} label="GEN 2" on={y.sw.gen[1]} top={y.sw.gen[1] && v.eng[1] === 'run' && !y.acSrc.includes('GEN 2') ? 'FAULT' : ''} topCol="amber" onClick={() => tog((s) => { s.gen[1] = !s.gen[1] })} />
          </fieldset>
          <fieldset><legend>APU · N {Math.round(apu.n)}% · EGT {Math.round(apu.egt)}°</legend>
            <PB id="apuMaster" hl={hl} label="MASTER SW" on={y.sw.apuMaster} top={y.sw.apuMaster ? 'ON' : ''} topCol="blue" off="" onClick={() => tog((s) => { s.apuMaster = !s.apuMaster })} />
            <PB id="apuStart" hl={hl} label="START" on={apu.state !== 'off'} off="" top={apu.state === 'avail' ? 'AVAIL' : apu.state === 'starting' || y.sw.apuStart ? 'ON' : ''} topCol={apu.state === 'avail' ? 'green' : 'blue'} onClick={() => tog((s) => { s.apuStart = true })}
              note={apu.state === 'flap' ? t(T('открывается створка', 'inlet flap opening')) : apu.state === 'cooldown' ? t(T('охлаждение', 'cooling down')) : undefined} />
            {!elec && <PB id="apuBleed" hl={hl} label="APU BLEED" on={y.sw.apuBleed} top={y.sw.apuBleed ? 'ON' : ''} topCol="blue" off="" onClick={() => tog((s) => { s.apuBleed = !s.apuBleed })} />}
          </fieldset>
          <fieldset><legend>{elec ? t(T('КОНДИЦ. (электрокомпрессоры)', 'COND (electric compressors)')) : `AIR · ${Math.round(y.bleed)} PSI ${y.bleedSrc}`}</legend>
            <PB id="pack1" hl={hl} label="PACK 1" on={y.sw.packs[0]} onClick={() => tog((s) => { s.packs[0] = !s.packs[0] })} />
            <PB id="pack2" hl={hl} label="PACK 2" on={y.sw.packs[1]} onClick={() => tog((s) => { s.packs[1] = !s.packs[1] })} />
            <PB id="beacon" hl={hl} label="BEACON" on={y.sw.beacon} onClick={() => tog((s) => { s.beacon = !s.beacon })} />
          </fieldset>
          <fieldset><legend>FUEL · {Math.round(y.tank.L)} / {Math.round(y.tank.C)} / {Math.round(y.tank.R)} kg</legend>
            <PB id="pumpL" hl={hl} label="L TK PUMPS" on={y.sw.pumps.L} onClick={() => tog((s) => { s.pumps.L = !s.pumps.L })} />
            <PB id="pumpC" hl={hl} label="CTR TK PUMPS" on={y.sw.pumps.C} onClick={() => tog((s) => { s.pumps.C = !s.pumps.C })} />
            <PB id="pumpR" hl={hl} label="R TK PUMPS" on={y.sw.pumps.R} onClick={() => tog((s) => { s.pumps.R = !s.pumps.R })} />
            <PB id="xfeed" hl={hl} label="X FEED" on={y.sw.xfeed} off="" top={y.sw.xfeed ? 'OPEN' : ''} topCol="green" onClick={() => tog((s) => { s.xfeed = !s.xfeed })} />
          </fieldset>
          {!elec ? (
            <fieldset><legend>HYD · G {Math.round(y.hyd.G)} · B {Math.round(y.hyd.B)} · Y {Math.round(y.hyd.Y)}</legend>
              <PB id="engPump1" hl={hl} label="ENG 1 PUMP (G)" on={y.sw.engPump[0]} top={y.sw.engPump[0] && v.eng[0] === 'run' && y.hyd.G < 1450 ? 'FAULT' : ''} topCol="amber" onClick={() => tog((s) => { s.engPump[0] = !s.engPump[0] })} />
              <PB id="blue" hl={hl} label="BLUE ELEC (B)" on={y.sw.blueElec} top={y.sw.blueElec && v.eng.includes('run') && y.hyd.B < 1450 ? 'FAULT' : ''} topCol="amber" onClick={() => tog((s) => { s.blueElec = !s.blueElec })} />
              <PB id="ptu" hl={hl} label="PTU" on={y.sw.ptu} onClick={() => tog((s) => { s.ptu = !s.ptu })} />
              <PB id="engPump2" hl={hl} label="ENG 2 PUMP (Y)" on={y.sw.engPump[1]} top={y.sw.engPump[1] && v.eng[1] === 'run' && y.hyd.Y < 1450 ? 'FAULT' : ''} topCol="amber" onClick={() => tog((s) => { s.engPump[1] = !s.engPump[1] })} />
              <PB id="yElec" hl={hl} label="Y ELEC PUMP" on={y.sw.yElec} top={y.sw.yElec ? 'ON' : ''} topCol="blue" off="" onClick={() => tog((s) => { s.yElec = !s.yElec })} />
            </fieldset>
          ) : <fieldset><legend>EHA</legend><p className="ov-note">{t(T('Рули двигают электрогидравлические приводы (EHA): у каждого свой насос и мотор, нужна только электросеть.', 'Surfaces are moved by electro-hydrostatic actuators (EHA): each has its own pump and motor, it only needs electrical power.'))}</p></fieldset>}
          <fieldset><legend>ADIRS · ENG MODE</legend>
            <PB id="ir" hl={hl} label={`IR 1·2·3 ${y.ir.state === 'align' ? `ALIGN ${Math.ceil(IR_ALIGN_S - y.ir.t)}s` : y.ir.state === 'nav' ? 'NAV' : ''}`} on={y.sw.ir} top={y.sw.ir && y.ir.state === 'align' ? 'ALIGN' : y.sw.ir && y.ir.state === 'nav' ? '' : y.sw.ir ? 'FAULT' : ''} topCol={y.ir.state === 'align' ? 'blue' : 'amber'} onClick={() => tog((s) => { s.ir = !s.ir })} />
            <div className={`ov-mode ${hl === 'engMode' ? 'fs-hl' : ''}`}>
              <small>ENG MODE</small>
              <div className="fs-seg">{(['crank', 'norm', 'start'] as const).map((m) => <button key={m} className={`btn sm ${y.sw.engMode === m ? 'on' : ''}`} onClick={() => tog((s) => { s.engMode = m })}>{m === 'start' ? 'IGN/START' : m.toUpperCase()}</button>)}</div>
            </div>
          </fieldset>
          <details className="ov-fail">
            <summary>{t(T('Тренировка отказов систем', 'System failure training'))}</summary>
            <div className="fs-seg wrap">
              {!elec && (['G', 'B', 'Y'] as const).map((k) => <button key={k} className={`btn sm ${y.fault[k] ? 'on' : ''}`} onClick={() => { FS.sim.sys.fault[k] = !FS.sim.sys.fault[k]; force((n) => n + 1) }}>{t(T(`Утечка ${k}`, `${k} leak`))}</button>)}
              {[0, 1].map((i) => <button key={i} className={`btn sm ${y.fault.gen[i] ? 'on' : ''}`} onClick={() => { FS.sim.sys.fault.gen[i] = !FS.sim.sys.fault.gen[i]; force((n) => n + 1) }}>{t(T(`Отказ GEN ${i + 1}`, `GEN ${i + 1} fault`))}</button>)}
            </div>
          </details>
        </div>
        <div className="ov-sd">
          <div className="fs-seg">{(['ELEC', 'HYD', 'FUEL', 'BLEED', 'COND'] as const).map((k) => <button key={k} className={`btn sm ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{k}</button>)}</div>
          <Synoptic page={tab} y={y} v={v} />
          <p className="ov-note">{t(EXPLAIN[tab](elec))}</p>
        </div>
      </div>
      <span hidden>{String(sw.bat[0])}</span>
    </section>
  )
}

const EXPLAIN: Record<string, (elec: boolean) => Txt> = {
  ELEC: () => T('Аккумуляторы (2 × 23 А·ч) питают постоянным током только самое важное: запуск ВСУ, FADEC, выставку ИНС. Экраны, насосы и компьютеры живут от переменного тока 115 В 400 Гц: от наземного источника, генератора ВСУ или генераторов двигателей (IDG). В полёте при потере обоих генераторов выпадает турбина RAT и крутит аварийный генератор.',
    'The batteries (2 × 23 Ah) carry only the essentials on DC: APU start, FADEC, IR alignment. Displays, pumps and computers need 115 V 400 Hz AC: from ground power, the APU generator or the engine generators (IDG). In flight, with both generators lost, the ram-air turbine drops and drives an emergency generator.'),
  HYD: (e) => e ? T('На «электрическом» самолёте центральной гидравлики нет: каждый привод (EHA) — свой электромотор, насос и цилиндр. Меньше трубопроводов и утечек, но всё зависит от электросети.', 'The more-electric aircraft has no central hydraulics: each actuator (EHA) has its own motor, pump and ram. Fewer pipes and leaks, but everything depends on the electrical network.')
    : T('Три независимые системы по 3000 psi. Зелёная — насос двигателя 1: шасси, основные тормоза, закрылки, предкрылки. Жёлтая — насос двигателя 2 или электронасос: носовое колесо, запасные тормоза, закрылки. Синяя — электронасос или RAT: предкрылки, рули. Каждая поверхность получает 2–3 системы, поэтому одиночный отказ не опасен; PTU перекачивает мощность между зелёной и жёлтой.',
      'Three independent 3000 psi systems. Green — engine 1 pump: gear, normal brakes, flaps, slats. Yellow — engine 2 pump or electric pump: nose-wheel steering, alternate brakes, flaps. Blue — electric pump or RAT: slats, flight controls. Each surface gets 2–3 systems so a single failure is harmless; the PTU transfers power between green and yellow.'),
  FUEL: () => T('Двигатель 1 питается из левого крыла, двигатель 2 — из правого; центральный бак расходуется первым, если его насосы включены. Ниже FL150 двигатель «всасывает» топливо и без насосов, выше — нет. Кран X FEED соединяет стороны. Если баки расходуются неравномерно, центр тяжести уходит вбок и самолёт кренит.',
    'Engine 1 feeds from the left wing, engine 2 from the right; the centre tank is used first when its pumps are on. Below FL150 an engine can suck fuel without pumps, above it cannot. X FEED joins the sides. If the tanks empty unevenly the centre of gravity moves sideways and the aircraft rolls.'),
  BLEED: (e) => e ? T('Отбора воздуха нет: двигатели запускаются стартер-генераторами от электросети ВСУ или аэродромного источника, а кабину наддувают электрокомпрессоры. Двигатель на 1–2 % экономичнее — у него ничего не отбирают.', 'No bleed air: the engines are started by starter-generators from APU or ground power, and electric compressors pressurise the cabin. The engines are 1–2 % more efficient because nothing is bled off.')
    : T('Сжатый воздух от ВСУ (≈ 36 psi) крутит воздушный стартер двигателя. Кондиционеры (PACK) забирают часть давления — поэтому на запуске их выключают: при 25 psi и ниже стартер раскручивает ротор слишком медленно, и FADEC прерывает «зависший» запуск.',
      'Compressed air from the APU (≈ 36 psi) drives the engine air starter. The packs take part of that pressure — which is why they are switched off for the start: at 25 psi or less the starter spins the rotor too slowly and the FADEC aborts a hung start.'),
  COND: () => T('Кондиционеры подают в кабину воздух, а выпускной клапан стравливает его так, чтобы «высота в кабине» росла медленно и не превышала ≈ 8000 футов. Без PACK кабина «поднимается» вместе с самолётом: выше 9550 футов — красное предупреждение, выше 14 000 — выпадают кислородные маски.',
    'The packs feed air into the cabin and the outflow valve lets it out so the cabin altitude rises slowly and stays below ≈ 8000 ft. Without packs the cabin climbs with the aircraft: above 9550 ft a red warning, above 14 000 ft the oxygen masks drop.'),
}

const GRN = '#36e07a', AMB = '#ffb02e', DIM = '#3b4350', WHT = '#d8dde3', CYA = '#5cd8ff'
function Box({ x, y, w = 70, h = 26, label, on, sub }: { x: number; y: number; w?: number; h?: number; label: string; on: boolean; sub?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="#0f1319" stroke={on ? GRN : DIM} />
      <text x={x + w / 2} y={y + (sub ? 11 : 17)} fill={on ? WHT : '#6b7480'} fontSize={10} textAnchor="middle">{label}</text>
      {sub && <text x={x + w / 2} y={y + 22} fill={on ? GRN : AMB} fontSize={9} textAnchor="middle">{sub}</text>}
    </g>
  )
}
const Ln = ({ d, on }: { d: string; on: boolean }) => <path d={d} fill="none" stroke={on ? GRN : DIM} strokeWidth={2} className={on ? 'ov-flow' : ''} />

function Synoptic({ page, y, v }: { page: string; y: Sys; v: Snap }) {
  const run = v.eng.map((e) => e === 'run')
  return (
    <svg className="ov-svg" viewBox="0 0 360 230" fontFamily="ui-monospace,monospace" role="img" aria-label={`${page} page`}>
      <rect width={360} height={230} rx={8} fill="#070a0e" />
      {page === 'ELEC' && (() => {
        const gen = [y.acSrc.includes('GEN 1') && run[0], y.acSrc.includes('GEN 2') && run[1]]
        const ext = y.sw.ext && y.extAvail, apu = y.sw.apuGen && y.apu.state === 'avail'
        return <g>
          <Box x={10} y={10} label="BAT 1" on={y.sw.bat[0]} sub={`${y.sw.bat[0] ? (y.dc ? 28.2 : 23 + 3.2 * y.bat[0]).toFixed(1) : '—'} V`} />
          <Box x={280} y={10} label="BAT 2" on={y.sw.bat[1]} sub={`${y.sw.bat[1] ? (y.dc ? 28.2 : 23 + 3.2 * y.bat[1]).toFixed(1) : '—'} V`} />
          <Box x={130} y={10} w={100} label="DC BAT BUS" on={y.dcBat} />
          <Ln d="M80 23 H130" on={y.sw.bat[0] && y.dcBat} /><Ln d="M230 23 H280" on={y.sw.bat[1] && y.dcBat} />
          <Box x={20} y={62} w={90} label="DC 1" on={y.dc} /><Box x={135} y={62} w={90} label="DC ESS" on={y.dcEss} /><Box x={250} y={62} w={90} label="DC 2" on={y.dc} />
          <Ln d="M180 36 V62" on={y.dcEss} />
          <Box x={20} y={112} w={90} label="AC 1" on={y.ac[0]} sub={y.acSrc[0] || 'OFF'} /><Box x={135} y={112} w={90} label="AC ESS" on={y.acEss} sub={y.emer ? 'EMER GEN' : ''} /><Box x={250} y={112} w={90} label="AC 2" on={y.ac[1]} sub={y.acSrc[1] || 'OFF'} />
          <Ln d="M65 112 V88" on={y.ac[0]} /><Ln d="M295 112 V88" on={y.ac[1]} /><Ln d="M110 125 H135" on={y.ac[0]} />
          <Box x={10} y={180} label="GEN 1" on={gen[0]} sub={gen[0] ? '115V 400Hz' : 'OFF'} />
          <Box x={100} y={180} label="APU GEN" on={apu} sub={apu ? '115V' : y.apu.state.toUpperCase()} />
          <Box x={190} y={180} label="EXT PWR" on={ext} sub={y.extAvail ? (ext ? 'ON' : 'AVAIL') : y.extTorn ? 'TORN' : '—'} />
          <Box x={280} y={180} label="GEN 2" on={gen[1]} sub={gen[1] ? '115V 400Hz' : 'OFF'} />
          <Ln d="M45 180 V138" on={gen[0]} /><Ln d="M315 180 V138" on={gen[1]} />
          <Ln d="M135 180 V160 H65 V138" on={apu && !gen[0]} /><Ln d="M225 180 V160 H295 V138" on={ext && !gen[1]} />
          {y.rat && <text x={180} y={172} fill={AMB} fontSize={10} textAnchor="middle">RAT ▼</text>}
        </g>
      })()}
      {page === 'HYD' && (() => {
        const cols: [string, number, string, string[], string][] = [
          ['GREEN', y.hyd.G, 'ENG 1 PUMP', ['L/G', 'BRK NORM', 'FLAPS', 'SLATS', 'AIL', 'ELEV', 'RUD', 'THS', 'REV 1'], '#3be07a'],
          ['BLUE', y.hyd.B, y.rat ? 'RAT' : 'ELEC PUMP', ['SLATS', 'AIL', 'ELEV', 'RUD', 'SPLR'], '#5ca8ff'],
          ['YELLOW', y.hyd.Y, y.sw.yElec ? 'ENG 2 + ELEC' : 'ENG 2 PUMP', ['NWS', 'BRK ALTN', 'ACCU', 'FLAPS', 'ELEV', 'RUD', 'THS', 'REV 2'], '#ffe14d'],
        ]
        if (v.arch === 'electric') return <g><text x={180} y={40} fill={WHT} fontSize={12} textAnchor="middle">EHA — ELECTRIC ACTUATORS</text>
          {['AIL', 'ELEV', 'RUD', 'SPLR', 'FLAPS', 'SLATS', 'L/G', 'BRAKES', 'NWS'].map((k, i) => <Box key={k} x={20 + (i % 3) * 112} y={60 + Math.floor(i / 3) * 50} w={96} label={k} on={y.ac[0] || y.ac[1] || y.acEss} sub={y.ac[0] || y.ac[1] ? 'AC BUS' : y.acEss ? 'ESS ONLY' : 'NO PWR'} />)}</g>
        return <g>{cols.map(([n, p, src, use, col], i) => {
          const x = 20 + i * 115, ok = p > 1450
          return <g key={n}>
            <text x={x + 45} y={18} fill={col} fontSize={11} textAnchor="middle">{n}</text>
            <text x={x + 45} y={36} fill={ok ? GRN : AMB} fontSize={15} textAnchor="middle">{Math.round(p / 50) * 50}</text>
            <rect x={x + 30} y={44} width={30} height={60} fill="#0f1319" stroke={DIM} /><rect x={x + 31} y={44 + 60 - (p / 3000) * 58} width={28} height={(p / 3000) * 58} fill={ok ? col : AMB} opacity={0.75} />
            <text x={x + 45} y={118} fill={ok ? WHT : AMB} fontSize={9} textAnchor="middle">{src}</text>
            {use.map((u, k) => <text key={u} x={x + (k % 2) * 48} y={136 + Math.floor(k / 2) * 14} fill={ok ? GRN : '#6b7480'} fontSize={9}>{u}</text>)}
          </g>
        })}
          <text x={180} y={72} fill={y.sw.ptu ? (Math.abs(y.hyd.G - y.hyd.Y) > 400 ? AMB : GRN) : DIM} fontSize={9} textAnchor="middle">◀ PTU ▶</text>
          <text x={180} y={222} fill={y.accu > 1000 ? GRN : AMB} fontSize={9} textAnchor="middle">BRK ACCU {Math.round(y.accu)} PSI</text>
        </g>
      })()}
      {page === 'FUEL' && (() => {
        const cap = Math.max(1, v.sys.tank.L + v.sys.tank.R + v.sys.tank.C)
        const T2 = ({ x, k, w }: { x: number; k: 'L' | 'C' | 'R'; w: number }) => <g>
          <rect x={x} y={70} width={w} height={60} fill="#0f1319" stroke={DIM} /><rect x={x + 1} y={129 - 58 * Math.min(1, y.tank[k] / (k === 'C' ? 6500 : 6100))} width={w - 2} height={58 * Math.min(1, y.tank[k] / (k === 'C' ? 6500 : 6100))} fill={CYA} opacity={0.35} />
          <text x={x + w / 2} y={104} fill={GRN} fontSize={12} textAnchor="middle">{Math.round(y.tank[k])}</text>
          <text x={x + w / 2} y={62} fill={WHT} fontSize={9} textAnchor="middle">{k === 'L' ? 'LEFT' : k === 'C' ? 'CTR' : 'RIGHT'} {y.sw.pumps[k] ? 'PUMPS' : 'PUMPS OFF'}</text>
        </g>
        return <g>
          <path d="M10 120 L60 70 H300 L350 120 L300 140 H60 Z" fill="none" stroke="#2a313c" />
          <T2 x={40} k="L" w={90} /><T2 x={135} k="C" w={90} /><T2 x={230} k="R" w={90} />
          <Box x={30} y={170} label="ENG 1" on={!!y.feed[0]} sub={y.feed[0] ? `← ${y.feed[0]}` : 'NO FEED'} />
          <Box x={260} y={170} label="ENG 2" on={!!y.feed[1]} sub={y.feed[1] ? `← ${y.feed[1]}` : 'NO FEED'} />
          <Box x={145} y={170} label="X FEED" on={y.sw.xfeed} sub={y.sw.xfeed ? 'OPEN' : 'SHUT'} />
          <Ln d="M65 130 V170" on={y.feed[0] === 'L'} /><Ln d="M295 130 V170" on={y.feed[1] === 'R'} /><Ln d="M180 130 V150 H65 V170" on={y.feed[0] === 'C'} /><Ln d="M180 150 H295 V170" on={y.feed[1] === 'C'} />
          <text x={180} y={20} fill={WHT} fontSize={11} textAnchor="middle">FOB {Math.round(cap)} KG · FU {Math.round(v.fuelUsed)} KG</text>
          <text x={180} y={36} fill={Math.abs(v.imb) > 1500 ? AMB : '#6b7480'} fontSize={10} textAnchor="middle">L − R = {Math.round(v.imb)} KG {Math.abs(v.imb) > 1500 ? '· IMBALANCE' : ''}</text>
        </g>
      })()}
      {page === 'BLEED' && (v.arch === 'electric'
        ? <g><text x={180} y={60} fill={WHT} fontSize={12} textAnchor="middle">NO BLEED AIR</text><text x={180} y={90} fill={GRN} fontSize={10} textAnchor="middle">START: ELECTRIC STARTER-GENERATORS</text><text x={180} y={110} fill={y.ac[0] || y.ac[1] ? GRN : AMB} fontSize={10} textAnchor="middle">AC {y.ac[0] || y.ac[1] ? 'AVAILABLE — START POSSIBLE' : 'OFF — NO START'}</text></g>
        : <g>
          <Box x={145} y={180} label="APU" on={y.apu.state === 'avail' && y.sw.apuBleed} sub={y.sw.apuBleed ? 'BLEED' : 'BLEED OFF'} />
          <Box x={20} y={180} label="ENG 1" on={run[0]} sub={run[0] ? 'HP/IP' : 'OFF'} /><Box x={270} y={180} label="ENG 2" on={run[1]} sub={run[1] ? 'HP/IP' : 'OFF'} />
          <Ln d="M180 180 V110" on={y.bleed > 5} /><Ln d="M55 180 V110 H305 V180" on={y.bleed > 5} />
          <text x={180} y={100} fill={y.bleed > 25 ? GRN : y.bleed > 5 ? AMB : '#6b7480'} fontSize={15} textAnchor="middle">{Math.round(y.bleed)} PSI</text>
          <Box x={95} y={30} label="PACK 1" on={y.sw.packs[0] && y.bleed > 5} /><Box x={195} y={30} label="PACK 2" on={y.sw.packs[1] && y.bleed > 5} />
          <Ln d="M130 56 V110" on={y.sw.packs[0] && y.bleed > 5} /><Ln d="M230 56 V110" on={y.sw.packs[1] && y.bleed > 5} />
          {[0, 1].map((i) => <text key={i} x={i ? 305 : 55} y={140} fill={v.eng[i] === 'starting' ? GRN : '#6b7480'} fontSize={9} textAnchor="middle">START VLV {v.eng[i] === 'starting' && v.n2[i] < 50 ? 'OPEN' : 'SHUT'}</text>)}
          {[0, 1].map((i) => <text key={'n' + i} x={i ? 305 : 55} y={156} fill={WHT} fontSize={9} textAnchor="middle">N2 {v.n2[i].toFixed(0)}%</text>)}
        </g>)}
      {page === 'COND' && <g>
        <text x={180} y={30} fill={WHT} fontSize={11} textAnchor="middle">CAB ALT</text>
        <text x={180} y={60} fill={y.cab > 9550 ? '#ff4a3d' : GRN} fontSize={22} textAnchor="middle">{Math.round(y.cab / 50) * 50} FT</text>
        <text x={180} y={90} fill="#9aa4b2" fontSize={10} textAnchor="middle">AIRCRAFT {Math.round(v.alt)} FT · ΔP {Math.max(0, (14.7 * (1 - Math.pow(1 - 6.875e-6 * v.alt, 5.256))) - (14.7 * (1 - Math.pow(1 - 6.875e-6 * y.cab, 5.256)))).toFixed(1)} PSI</text>
        <Box x={95} y={120} label="PACK 1" on={y.sw.packs[0]} /><Box x={195} y={120} label="PACK 2" on={y.sw.packs[1]} />
        <text x={180} y={190} fill={y.cab > 14000 ? '#ff4a3d' : '#6b7480'} fontSize={10} textAnchor="middle">{y.cab > 14000 ? 'PAX OXY MASKS DEPLOYED' : 'OUTFLOW VALVE AUTO'}</text>
      </g>}
    </svg>
  )
}
