import { useEffect, useState } from 'react'
import { CONFS, DEG, DEST, DETENT, FT, KT, confAt, detentName } from './fdm'
import { FS, useFlight } from './state'
import { useT, T } from '../i18n'

/* ------------------------------------------------------------------ live snapshot, 15 Hz */
function snap() {
  const s = FS.sim, d = s.d
  return {
    ias: d.ias ?? 0, alt: (d.alt ?? 0) - AC_H, vs: d.vs ?? 0, phi: (d.phi ?? 0) / DEG, theta: (d.theta ?? 0) / DEG, gamma: (d.gamma ?? 0) / DEG,
    psi: (((d.psi ?? 0) / DEG) + 90 + 360) % 360, beta: (d.beta ?? 0) / DEG, alpha: (d.alpha ?? 0) / DEG, ra: d.ra ?? 0,
    n1: [...s.n1], egt: [...(d.egt ?? [0, 0])], ff: [...(d.ff ?? [0, 0])], vls: d.vls ?? 0, vfe: d.vfe ?? 350, vs1g: d.vs1g ?? 0, conf: d.confId ?? '0',
    confPos: s.srf.conf, confTarget: s.srf.confTarget, gear: s.srf.gear, gearLever: s.ctl.gearDown, spl: (s.srf.splL + s.srf.splR) / 2, gnd: s.srf.gndSpl,
    ths: s.srf.ths / DEG, lever: s.ctl.lever, rev: s.ctl.rev, floor: s.fbw.alphaFloor, law: s.ctl.law, prot: d.inProt, flare: d.flare, stall: d.stall && s.airborne,
    nz: d.nz ?? 1, dist: (DEST - s.pos.x) / 1852, ab: s.ctl.autobrake, armed: s.ctl.spoilersArmed, wow: d.wow, accel: 0, airborne: s.airborne, crashed: s.crashed,
    lift: d.lift ?? 0, drag: d.drag ?? 0, thrust: (d.thrust?.[0] ?? 0) + (d.thrust?.[1] ?? 0), slat: confAt(s.srf.conf).slat, flap: confAt(s.srf.conf).flap, ever: s.everAirborne,
  }
}
const AC_H = 10 // CG height at rest (ft) so the altimeter reads ~0 on the runway
export type Snap = ReturnType<typeof snap>
export function useSnap(hz = 15) {
  const [v, setV] = useState(snap)
  useEffect(() => {
    let prevIas = FS.sim.d.ias ?? 0, prevT = performance.now()
    const id = setInterval(() => {
      const n = snap(), now = performance.now()
      n.accel = ((n.ias - prevIas) / Math.max(0.01, (now - prevT) / 1000)) // kt/s
      prevIas = n.ias; prevT = now
      setV(n)
    }, 1000 / hz)
    return () => clearInterval(id)
  }, [hz])
  return v
}

/* ------------------------------------------------------------------ PFD */
const C = { sky: '#2a74c9', gnd: '#8a5730', w: '#f2f4f6', g: '#36e07a', a: '#ffb02e', r: '#ff4a3d', c: '#5cd8ff', m: '#ff5ce6', y: '#ffe14d' }
export function Pfd({ v }: { v: Snap }) {
  const t = useT()
  const PX = 5.2 // px per degree of pitch
  const cx = 210, cy = 150
  // speed tape
  const sp = 3.2 // px per knot
  const sTicks: number[] = []
  for (let k = Math.floor((v.ias - 45) / 10) * 10; k <= v.ias + 45; k += 10) if (k >= 0) sTicks.push(k)
  const sy = (kt: number) => cy - (kt - v.ias) * sp
  const vmax = v.conf === '0' ? 350 : v.vfe
  // altitude tape
  const ap = 0.22 // px per ft
  const aTicks: number[] = []
  for (let k = Math.floor((v.alt - 450) / 100) * 100; k <= v.alt + 450; k += 100) aTicks.push(k)
  const ay = (ft: number) => cy - (ft - v.alt) * ap
  // heading
  const hp = 3.4
  const hTicks: number[] = []
  for (let k = Math.floor((v.psi - 35) / 5) * 5; k <= v.psi + 35; k += 5) hTicks.push(k)
  const thr = v.floor ? 'A.FLOOR' : v.rev ? (v.rev === 2 ? 'MAX REV' : 'IDLE REV') : detentName(v.lever)
  const law = v.flare ? 'FLARE' : v.law === 'direct' ? 'DIRECT LAW' : v.airborne ? 'NORMAL LAW' : 'GROUND'
  const fpvY = cy - (v.gamma - v.theta) * PX
  const fpvX = cx + v.beta * PX
  return (
    <svg className="fs-pfd" viewBox="0 0 420 300" role="img" aria-label="Primary flight display">
      <defs>
        <clipPath id="fs-att"><rect x={110} y={52} width={200} height={196} rx={14} /></clipPath>
        <clipPath id="fs-spd"><rect x={22} y={52} width={66} height={196} /></clipPath>
        <clipPath id="fs-alt"><rect x={330} y={52} width={60} height={196} /></clipPath>
        <clipPath id="fs-hdg"><rect x={120} y={262} width={180} height={32} /></clipPath>
      </defs>
      <rect width={420} height={300} rx={10} fill="#0b0e13" />
      {/* FMA */}
      <g fontSize={11} fontFamily="ui-monospace,monospace" textAnchor="middle">
        <text x={70} y={18} fill={v.floor ? C.a : C.g}>{thr}</text>
        <text x={210} y={18} fill={v.law === 'direct' ? C.a : C.g}>{law}</text>
        <text x={350} y={18} fill={v.prot ? C.a : C.c}>{v.prot ? 'α PROT' : `CONF ${v.conf}`}</text>
        <line x1={140} x2={140} y1={6} y2={26} stroke="#39414d" /><line x1={280} x2={280} y1={6} y2={26} stroke="#39414d" />
      </g>
      {/* attitude */}
      <g clipPath="url(#fs-att)">
        <g transform={`rotate(${-v.phi} ${cx} ${cy}) translate(0 ${v.theta * PX})`}>
          <rect x={-200} y={cy - 800} width={820} height={800} fill={C.sky} />
          <rect x={-200} y={cy} width={820} height={800} fill={C.gnd} />
          <line x1={-200} x2={620} y1={cy} y2={cy} stroke={C.w} strokeWidth={1.5} />
          {[-30, -25, -20, -15, -10, -5, -2.5, 2.5, 5, 10, 15, 20, 25, 30].map((p) => {
            const y = cy - p * PX, w = p % 10 === 0 ? 60 : p % 5 === 0 ? 34 : 16
            return <g key={p}><line x1={cx - w / 2} x2={cx + w / 2} y1={y} y2={y} stroke={C.w} strokeWidth={1.2} />{p % 10 === 0 && <text x={cx - w / 2 - 4} y={y + 4} fill={C.w} fontSize={9} textAnchor="end">{Math.abs(p)}</text>}</g>
          })}
        </g>
        {/* bank scale */}
        <g transform={`translate(${cx} ${cy})`}>
          {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((b) => <line key={b} x1={0} x2={0} y1={-92} y2={b % 30 === 0 ? -100 : -96} stroke={C.w} strokeWidth={1.4} transform={`rotate(${b})`} />)}
          <path d="M0 -92 l-6 -8 h12z" fill={C.y} />
          <g transform={`rotate(${-v.phi})`}><path d="M0 -90 l-6 9 h12z" fill={Math.abs(v.phi) > 33 ? C.a : C.y} /></g>
        </g>
        {/* flight path vector */}
        {v.airborne && <g transform={`translate(${fpvX} ${fpvY})`} stroke={C.g} strokeWidth={2} fill="none"><circle r={5} /><line x1={-16} x2={-5} y1={0} y2={0} /><line x1={5} x2={16} y1={0} y2={0} /><line x1={0} x2={0} y1={-5} y2={-11} /></g>}
        {/* aircraft symbol */}
        <g stroke="#000" strokeWidth={1} fill={C.y}>
          <rect x={cx - 58} y={cy - 2.5} width={34} height={5} /><rect x={cx + 24} y={cy - 2.5} width={34} height={5} /><rect x={cx - 3} y={cy - 3} width={6} height={6} fill="#000" stroke={C.y} />
        </g>
        {v.stall && <text x={cx} y={cy + 60} textAnchor="middle" fill={C.r} fontSize={22} fontWeight={700}>STALL</text>}
        {v.ra < 2500 && v.airborne && <text x={cx} y={232} textAnchor="middle" fill={v.ra < 400 ? C.a : C.g} fontSize={15} fontFamily="ui-monospace,monospace">{Math.round(v.ra)}</text>}
      </g>
      {/* speed tape */}
      <rect x={22} y={52} width={66} height={196} fill="#1b2029" />
      <g clipPath="url(#fs-spd)" fontFamily="ui-monospace,monospace">
        {sTicks.map((k) => <g key={k}><line x1={74} x2={88} y1={sy(k)} y2={sy(k)} stroke={C.w} />{k % 20 === 0 && <text x={68} y={sy(k) + 4} fill={C.w} fontSize={11} textAnchor="end">{k}</text>}</g>)}
        {v.airborne && <rect x={84} y={sy(v.vls)} width={4} height={Math.max(0, sy(0) - sy(v.vls))} fill={C.a} />}
        {v.airborne && <rect x={84} y={sy(v.vs1g * 1.06)} width={4} height={Math.max(0, sy(0) - sy(v.vs1g * 1.06))} fill={C.r} />}
        <rect x={84} y={0} width={4} height={Math.max(0, sy(vmax))} fill={C.r} />
        {!v.ever && <g fill={C.c} fontSize={10}><text x={90} y={sy(140) + 3}>1</text><text x={90} y={sy(145) + 3}>R</text></g>}
        {Math.abs(v.accel) > 0.3 && <line x1={80} x2={80} y1={cy} y2={cy - v.accel * 10 * sp} stroke={C.y} strokeWidth={2} />}
      </g>
      <path d={`M20 ${cy - 11} h50 l8 11 l-8 11 h-50z`} fill="#000" stroke={C.y} />
      <text x={64} y={cy + 5} fill={C.g} fontSize={15} textAnchor="end" fontFamily="ui-monospace,monospace">{Math.round(v.ias)}</text>
      {/* altitude tape */}
      <rect x={330} y={52} width={60} height={196} fill="#1b2029" />
      <g clipPath="url(#fs-alt)" fontFamily="ui-monospace,monospace">
        {aTicks.map((k) => <g key={k}><line x1={330} x2={k % 500 === 0 ? 342 : 337} y1={ay(k)} y2={ay(k)} stroke={C.w} />{k % 500 === 0 && <text x={346} y={ay(k) + 4} fill={C.w} fontSize={10}>{k}</text>}</g>)}
        <rect x={330} y={ay(0)} width={60} height={300} fill="#8a5730" opacity={0.5} />
      </g>
      <path d={`M328 ${cy - 11} h64 v22 h-64z`} fill="#000" stroke={C.y} />
      <text x={388} y={cy + 5} fill={C.g} fontSize={14} textAnchor="end" fontFamily="ui-monospace,monospace">{Math.round(v.alt)}</text>
      {/* vertical speed */}
      <g fontFamily="ui-monospace,monospace">
        <rect x={394} y={70} width={20} height={160} fill="#13171e" />
        <line x1={394} x2={414} y1={150} y2={150} stroke="#5b6573" />
        <line x1={404} x2={414} y1={150} y2={150 - Math.max(-75, Math.min(75, Math.sign(v.vs) * Math.sqrt(Math.abs(v.vs)) * 1.6))} stroke={Math.abs(v.vs) > 2000 ? C.a : C.g} strokeWidth={3} />
        <text x={404} y={v.vs >= 0 ? 66 : 244} fill={C.g} fontSize={9} textAnchor="middle">{Math.abs(v.vs) > 50 ? Math.round(v.vs / 100) : ''}</text>
      </g>
      {/* heading */}
      <rect x={120} y={262} width={180} height={32} fill="#1b2029" />
      <g clipPath="url(#fs-hdg)" fontFamily="ui-monospace,monospace">
        {hTicks.map((k) => { const x = cx + (k - v.psi) * hp; const h = ((k % 360) + 360) % 360; return <g key={k}><line x1={x} x2={x} y1={262} y2={k % 10 === 0 ? 271 : 267} stroke={C.w} />{k % 10 === 0 && <text x={x} y={286} fill={C.w} fontSize={10} textAnchor="middle">{String(Math.round(h / 10)).padStart(2, '0')}</text>}</g> })}
      </g>
      <path d={`M${cx} 262 l-5 -7 h10z`} fill={C.y} />
      {/* bottom-left: distance and g */}
      <g fontSize={10} fontFamily="ui-monospace,monospace" fill={C.c}>
        <text x={22} y={272}>{t(T('ДО ВПП', 'TO RWY'))} {v.dist > 0 ? v.dist.toFixed(1) : '—'} NM</text>
        <text x={22} y={288}>G {v.nz.toFixed(2)}  α {v.alpha.toFixed(1)}°</text>
      </g>
    </svg>
  )
}

/* ------------------------------------------------------------------ ECAM-like engine & configuration */
function N1Arc({ x, n1, egt, ff, label }: { x: number; n1: number; egt: number; ff: number; label: string }) {
  const a = (Math.min(110, n1) / 110) * 210 - 210, R = 30
  const end = { x: x + Math.cos((a * Math.PI) / 180) * R, y: 46 + Math.sin((a * Math.PI) / 180) * R }
  return (
    <g fontFamily="ui-monospace,monospace">
      <path d={`M${x - R} 46 A${R} ${R} 0 1 1 ${x + Math.cos((-30 * Math.PI) / 180) * R} ${46 + Math.sin((-30 * Math.PI) / 180) * R}`} fill="none" stroke="#3b4350" strokeWidth={3} />
      <line x1={x} y1={46} x2={end.x} y2={end.y} stroke={C.g} strokeWidth={2.5} />
      <text x={x} y={66} fill={C.g} fontSize={13} textAnchor="middle">{n1.toFixed(1)}</text>
      <text x={x} y={82} fill="#9aa4b2" fontSize={9} textAnchor="middle">{label} EGT {Math.round(egt)}</text>
      <text x={x} y={94} fill="#9aa4b2" fontSize={9} textAnchor="middle">FF {Math.round(ff)}</text>
    </g>
  )
}
export function Ecam({ v }: { v: Snap }) {
  const t = useT()
  const gearCol = v.gear > 0.99 ? C.g : v.gear > 0.01 ? C.r : 'transparent'
  const conf = CONFS[Math.round(v.confPos)]
  return (
    <svg className="fs-ecam" viewBox="0 0 220 200" role="img" aria-label="Engine and configuration display">
      <rect width={220} height={200} rx={10} fill="#0b0e13" />
      <text x={110} y={13} fill="#9aa4b2" fontSize={9} textAnchor="middle" fontFamily="ui-monospace,monospace">N1 %</text>
      <N1Arc x={60} n1={v.n1[0]} egt={v.egt[0]} ff={v.ff[0]} label="1" />
      <N1Arc x={160} n1={v.n1[1]} egt={v.egt[1]} ff={v.ff[1]} label="2" />
      {v.rev > 0 && <g fontSize={10} fill={C.g} fontFamily="ui-monospace,monospace"><text x={60} y={30} textAnchor="middle">REV</text><text x={160} y={30} textAnchor="middle">REV</text></g>}
      {/* flaps & slats */}
      <g fontFamily="ui-monospace,monospace" fontSize={9}>
        <text x={14} y={118} fill="#9aa4b2">S</text><text x={202} y={118} fill="#9aa4b2">F</text>
        <line x1={90} x2={90 - v.slat * 2.2} y1={112} y2={112 + v.slat * 0.7} stroke={C.c} strokeWidth={4} />
        <line x1={120} x2={120 + v.flap * 1.9} y1={112} y2={112 + v.flap * 0.5} stroke={C.c} strokeWidth={4} />
        <path d="M90 108 h30 l-4 8 h-22z" fill="#d8dde3" />
        <text x={105} y={140} fill={C.c} fontSize={12} textAnchor="middle">{conf?.id === '0' ? '0' : conf?.id}</text>
      </g>
      {/* gear */}
      <g fontFamily="ui-monospace,monospace">
        <text x={14} y={164} fill="#9aa4b2" fontSize={9}>{t(T('ШАССИ', 'GEAR'))}</text>
        {[[70, 156], [100, 168], [130, 156]].map(([x, y], i) => <path key={i} d={`M${x - 10} ${y - 6} h20 l-10 12z`} fill={gearCol} stroke={v.gear > 0.01 ? 'none' : '#3b4350'} />)}
        <text x={14} y={190} fill={v.gnd > 0.5 || v.spl > 0.05 ? C.g : v.armed ? C.c : '#5b6573'} fontSize={9}>{v.gnd > 0.5 ? 'GND SPLR' : v.spl > 0.05 ? 'SPD BRK' : v.armed ? 'SPLR ARM' : 'SPLR'}</text>
        <text x={90} y={190} fill="#9aa4b2" fontSize={9}>THS {v.ths >= 0 ? 'UP' : 'DN'} {Math.abs(v.ths).toFixed(1)}</text>
        <text x={168} y={190} fill={v.ab ? C.c : '#5b6573'} fontSize={9}>{v.ab === 2 ? 'BRK MED' : v.ab === 1 ? 'BRK LO' : 'A/BRK'}</text>
      </g>
    </svg>
  )
}

export function ForceLegend({ v }: { v: Snap }) {
  const t = useT()
  const on = useFlight((s) => s.forces)
  if (!on) return null
  const kN = (n: number) => Math.round(n / 1000)
  return (
    <div className="fs-legend glass">
      <span><i style={{ background: '#4fb3ff' }} />{t(T('Подъёмная сила', 'Lift'))} {kN(v.lift)} kN</span>
      <span><i style={{ background: '#ffae3d' }} />{t(T('Вес', 'Weight'))} {kN(64000 * 9.81)} kN</span>
      <span><i style={{ background: '#58e08a' }} />{t(T('Тяга', 'Thrust'))} {kN(v.thrust)} kN</span>
      <span><i style={{ background: '#ff5b5b' }} />{t(T('Сопротивление', 'Drag'))} {kN(v.drag)} kN</span>
    </div>
  )
}
void FT; void KT; void DETENT
