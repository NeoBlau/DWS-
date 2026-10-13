import { useMemo, useState } from 'react'
import { getApp, type ExplorerId } from '../store'
import { openVehicle } from '../utils/actions'
import { PENDING, type ManualMode } from '../explorer/core'
import { PENDING_FLIGHT } from '../explorer/flight/state'
import type { Start, Sim } from '../explorer/flight/fdm'
import type { CamMode } from '../explorer/flight/state'
import { useT, useLang, T, type Txt } from '../explorer/i18n'
import type { LabId, VehicleId } from '../data/types'

/*
 * «Изучение» — a catalogue of deep dives. Each card opens one mechanism up close: an explorer at a given
 * scenario and moment, a flight-sim view prepared to show a system, or one of the focused 3D labs.
 */
type Go =
  | { kind: 'explorer'; id: Exclude<ExplorerId, 'flight'>; track: string; t?: number; mode?: ManualMode }
  | { kind: 'flight'; start: Start; cam?: CamMode; ac?: 'a320' | 'strizh'; design?: boolean; patch?: (s: Sim) => void }
  | { kind: 'lab'; vehicle: VehicleId; lab: LabId }
  | { kind: 'drive' }
interface Topic { id: string; group: string; title: Txt; text: Txt; tags: Txt; go: Go }

const G = {
  diesel: T('Дизель · Toyota Fortuner', 'Diesel · Toyota Fortuner'),
  petrol: T('Бензин · BMW 530i', 'Petrol · BMW 530i'),
  jet: T('Реактивный двигатель · A320', 'Jet engine · A320'),
  plane: T('Самолёт и его системы', 'The aircraft and its systems'),
  car: T('Шасси автомобиля', 'Car chassis'),
}
const TOPICS: Topic[] = [
  { id: 'cyl', group: 'diesel', title: T('Четыре такта крупно', 'The four strokes up close'), text: T('Впуск, сжатие, впрыск и сгорание, выпуск — по шагам и в замедлении. Видно, как клапаны открываются кулачками.', 'Intake, compression, injection and combustion, exhaust — step by step and in slow motion. Cams open the valves.'), tags: T('поршень · клапаны · форсунка', 'piston · valves · injector'), go: { kind: 'explorer', id: 'diesel', track: 'cyl' } },
  { id: 'rail', group: 'diesel', title: T('Common Rail: топливо под 2000 бар', 'Common Rail: fuel at 2000 bar'), text: T('Бак → фильтр → ТНВД → рампа → форсунки. Поток топлива подсвечен, остальное приглушено.', 'Tank → filter → pump → rail → injectors. The fuel flow is lit, everything else dimmed.'), tags: T('ТНВД · рампа · форсунки', 'pump · rail · injectors'), go: { kind: 'explorer', id: 'diesel', track: 'main', t: 8 } },
  { id: 'start', group: 'diesel', title: T('Запуск двигателя', 'Engine start'), text: T('Аккумулятор → стартер → коленвал → клапаны → воздух → топливо → вспышка → холостой ход.', 'Battery → starter → crankshaft → valves → air → fuel → firing → idle.'), tags: T('стартер · свечи накала', 'starter · glow plugs'), go: { kind: 'explorer', id: 'diesel', track: 'start' } },
  { id: 'turbo', group: 'diesel', title: T('Турбина в разрезе', 'Turbocharger cutaway'), text: T('Выхлоп крутит турбину, общий вал — компрессор. Лопатки VNT меняют угол потока.', 'Exhaust spins the turbine, the shared shaft spins the compressor. VNT vanes change the flow angle.'), tags: T('турбина · компрессор · вал', 'turbine · compressor · shaft'), go: { kind: 'explorer', id: 'diesel', track: 'main', t: 29 } },
  { id: 'gears', group: 'diesel', title: T('Коробка, раздатка, мосты', 'Gearbox, transfer case, axles'), text: T('Передачи переключаются: обороты на входе и выходе, передаточное число, момент.', 'Gears change: input and output speed, ratio and torque.'), tags: T('передачи · 4×4 · дифференциал', 'gears · 4×4 · differential'), go: { kind: 'explorer', id: 'diesel', track: 'gears' } },
  { id: 'dex', group: 'diesel', title: T('Двигатель в разобранном виде', 'Exploded engine'), text: T('Все узлы разведены — вращайте и приближайте любую деталь.', 'Every assembly pulled apart — orbit and zoom into any part.'), tags: T('разборка', 'exploded'), go: { kind: 'explorer', id: 'diesel', track: 'main', t: 44, mode: 'exploded' } },
  { id: 'spark', group: 'petrol', title: T('Искра и непосредственный впрыск', 'Spark and direct injection'), text: T('Бензин впрыскивается прямо в цилиндр, свеча поджигает смесь в нужный момент.', 'Petrol is injected straight into the cylinder; the plug ignites it at the right moment.'), tags: T('свеча · форсунка', 'spark plug · injector'), go: { kind: 'explorer', id: 'petrol', track: 'cyl' } },
  { id: 'cmp', group: 'petrol', title: T('Дизель против бензина', 'Diesel versus petrol'), text: T('Два цилиндра синхронно: самовоспламенение от сжатия и поджиг искрой.', 'Two cylinders in sync: compression ignition versus spark ignition.'), tags: T('сравнение', 'comparison'), go: { kind: 'lab', vehicle: 'bmw', lab: 'compare' } },
  { id: 'bmwfull', group: 'petrol', title: T('От бака до задних колёс', 'From the tank to the rear wheels'), text: T('Twin-scroll турбина, 8-ступенчатый автомат, задний привод.', 'Twin-scroll turbo, 8-speed automatic, rear-wheel drive.'), tags: T('полный путь', 'whole path'), go: { kind: 'explorer', id: 'petrol', track: 'main' } },
  { id: 'suck', group: 'jet', title: T('Вентилятор и наружный контур', 'Fan and bypass'), text: T('Откуда берётся ≈ 80 % тяги: огромный поток воздуха в обход ядра.', 'Where ≈ 80 % of the thrust comes from: a huge airflow around the core.'), tags: T('вентилятор · N1', 'fan · N1'), go: { kind: 'explorer', id: 'jet', track: 'main', t: 8 } },
  { id: 'comp', group: 'jet', title: T('Компрессор: сжатие в 30 раз', 'Compressor: 30× squeeze'), text: T('Подпорные ступени и 9 ступеней КВД — лопатки всё короче, давление растёт.', 'Booster and 9 HPC stages — blades get shorter as pressure rises.'), tags: T('КВД · N2', 'HPC · N2'), go: { kind: 'explorer', id: 'jet', track: 'main', t: 16 } },
  { id: 'comb', group: 'jet', title: T('Камера сгорания', 'Combustor'), text: T('20 форсунок, факел ≈ 2000 °C и как охлаждают лопатки турбины.', '20 nozzles, a ≈ 2000 °C flame, and how the turbine blades are cooled.'), tags: T('форсунки · EGT', 'nozzles · EGT'), go: { kind: 'explorer', id: 'jet', track: 'main', t: 24 } },
  { id: 'turb', group: 'jet', title: T('Турбины и два вала', 'Turbines and two shafts'), text: T('ТВД крутит компрессор, ТНД — вентилятор; валы вложены друг в друга.', 'The HPT drives the compressor, the LPT drives the fan; the shafts are nested.'), tags: T('ТВД · ТНД · валы', 'HPT · LPT · shafts'), go: { kind: 'explorer', id: 'jet', track: 'main', t: 31 } },
  { id: 'jstart', group: 'jet', title: T('Запуск по секундам', 'Start, second by second'), text: T('APU → стартер → N2 → топливо → зажигание → розжиг → малый газ.', 'APU → starter → N2 → fuel → ignition → light-off → idle.'), tags: T('FADEC', 'FADEC'), go: { kind: 'explorer', id: 'jet', track: 'start' } },
  { id: 'follow', group: 'jet', title: T('Следуй за воздухом', 'Follow the air'), text: T('Камера летит за одной частицей воздуха: давление и температура на каждом участке.', 'The camera rides one parcel of air: pressure and temperature at every station.'), tags: T('термодинамика', 'thermodynamics'), go: { kind: 'explorer', id: 'jet', track: 'follow' } },
  { id: 'jex', group: 'jet', title: T('Модули двигателя', 'Engine modules'), text: T('Двигатель разобран на модули, как в цехе.', 'The engine split into modules, as in the shop.'), tags: T('разборка', 'exploded'), go: { kind: 'explorer', id: 'jet', track: 'main', t: 40, mode: 'exploded' } },
  { id: 'flaps', group: 'plane', title: T('Механизация крыла', 'High-lift devices'), text: T('Вид из салона на крыло: предкрылки и закрылки Фаулера в посадочном положении.', 'The wing from the cabin: slats and Fowler flaps at landing setting.'), tags: T('закрылки · предкрылки', 'flaps · slats'), go: { kind: 'flight', start: 'approach', cam: 'wing', patch: (s) => { s.ctl.flapLever = 4 } } },
  { id: 'deck', group: 'plane', title: T('Кабина и приборы', 'Flight deck and displays'), text: T('Живые PFD, ND, ECAM; РУД и сайдстики двигаются. Тяните мышью — осматривайтесь.', 'Live PFD, ND, ECAM; levers and sidesticks move. Drag to look around.'), tags: T('кабина', 'cockpit'), go: { kind: 'flight', start: 'runway', cam: 'cockpit' } },
  { id: 'fbw', group: 'plane', title: T('Fly-by-wire и защиты', 'Fly-by-wire and protections'), text: T('В полёте попробуйте резко взять на себя или крен 70° — защиты не дадут. В прямом законе — дадут.', 'In flight, pull hard or bank 70° — protections stop you. In direct law they do not.'), tags: T('нормальный / прямой закон', 'normal / direct law'), go: { kind: 'flight', start: 'cruise', cam: 'chase' } },
  { id: 'gear', group: 'plane', title: T('Шасси и посадка', 'Landing gear and touchdown'), text: T('Заход на посадку: выпуск шасси, амортизаторы, интерцепторы и реверс при касании.', 'Approach: gear down, shock struts, spoilers and reverse at touchdown.'), tags: T('шасси · реверс', 'gear · reverse'), go: { kind: 'flight', start: 'approach', cam: 'side' } },
  { id: 'strizh', group: 'plane', title: T('Проект «Стриж-180»', 'The Strizh-180 design'), text: T('Собственный самолёт: подкосное крыло, открытые вентиляторы и расчёт против A320.', 'Our own aircraft: truss-braced wing, open fans and the numbers against the A320.'), tags: T('проект', 'design'), go: { kind: 'flight', start: 'runway', ac: 'strizh', cam: 'chase', design: true } },
  { id: 'drive', group: 'car', title: T('За рулём: шины, ABS, ESC', 'At the wheel: tyres, ABS, ESC'), text: T('Сами разгоняйтесь, тормозите и входите в повороты на сухом, мокром и льду — кольца под колёсами показывают сцепление каждой шины.', 'Accelerate, brake and corner yourself on dry, wet and ice — rings under the wheels show each tyre’s grip.'), tags: T('автосимулятор', 'driving sim'), go: { kind: 'drive' } },
  { id: 'abs', group: 'car', title: T('Тормоза и ABS', 'Brakes and ABS'), text: T('Колодки, диск, суппорт — и как ABS не даёт колесу заблокироваться.', 'Pads, disc, caliper — and how ABS keeps the wheel from locking.'), tags: T('тормоза', 'brakes'), go: { kind: 'lab', vehicle: 'bmw', lab: 'brakes' } },
  { id: 'trans', group: 'car', title: T('Трансмиссия 4×4', '4×4 driveline'), text: T('Раздаточная коробка, дифференциалы и блокировки.', 'Transfer case, differentials and locks.'), tags: T('4×4', '4×4'), go: { kind: 'lab', vehicle: 'fortuner', lab: 'transmission' } },
]

function open(go: Go) {
  if (go.kind === 'explorer') { PENDING.start = { track: go.track, t: go.t ?? 0, mode: go.mode, playing: true }; getApp().set({ screen: 'explorer', explorer: go.id }) }
  else if (go.kind === 'flight') { PENDING_FLIGHT.v = { start: go.start, cam: go.cam, ac: go.ac, design: go.design, patch: go.patch }; getApp().set({ screen: 'explorer', explorer: 'flight' }) }
  else if (go.kind === 'drive') getApp().set({ screen: 'explorer', explorer: 'drive' })
  else openVehicle(go.vehicle, () => getApp().set({ lab: { id: go.lab } }))
}

export function Study() {
  const t = useT()
  const { lang, setLang } = useLang()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    return k ? TOPICS.filter((x) => [x.title.ru, x.title.en, x.text.ru, x.text.en, x.tags.ru, x.tags.en].some((s) => s.toLowerCase().includes(k))) : TOPICS
  }, [q])
  const groups = Object.keys(G) as (keyof typeof G)[]
  return (
    <div className="study">
      <div className="study-top">
        <button className="btn sm" onClick={() => getApp().set({ screen: 'landing' })}>← {t(T('Назад', 'Back'))}</button>
        <div><span className="eyebrow">{t(T('Раздел', 'Section'))}</span><h1>{t(T('Изучение', 'Study'))}</h1></div>
        <input className="study-q" placeholder={t(T('Найти узел: турбина, закрылки, ABS…', 'Find a part: turbo, flaps, ABS…'))} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg xp-lang"><button className={lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>RU</button><button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button></div>
      </div>
      <p className="study-lead">{t(T('Каждый разбор открывается сразу на нужном узле. Приближайте колесом мыши до миллиметров, вращайте, включайте разрез, рентген, потоки и разборку. Кнопка HD — максимальная чёткость.', 'Every dive opens right at the part. Zoom in with the wheel down to millimetres, orbit, switch cutaway, x-ray, flows and exploded view. The HD button gives maximum detail.'))}</p>
      {groups.map((g) => {
        const items = list.filter((x) => x.group === g)
        if (!items.length) return null
        return (
          <section key={g} className="study-group">
            <h2>{t(G[g])}</h2>
            <div className="study-grid">
              {items.map((x) => (
                <button key={x.id} className="study-card glass" onClick={() => open(x.go)}>
                  <b>{t(x.title)}</b>
                  <p>{t(x.text)}</p>
                  <small>{t(x.tags)}</small>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
