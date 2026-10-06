import { create } from 'zustand'

export type Lang = 'ru' | 'en'
export interface Txt { ru: string; en: string }
export const T = (ru: string, en: string): Txt => ({ ru, en })

function load(): Lang {
  try { const v = localStorage.getItem('hiw-lang'); if (v === 'en' || v === 'ru') return v } catch { /* storage unavailable */ }
  return 'ru'
}

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: load(),
  setLang: (lang) => { try { localStorage.setItem('hiw-lang', lang) } catch { /* ignore */ } document.documentElement.lang = lang; set({ lang }) },
}))

export const tr = (x: Txt | string | undefined, lang: Lang) => (x === undefined ? '' : typeof x === 'string' ? x : x[lang])
export function useT() {
  const lang = useLang((s) => s.lang)
  return (x: Txt | string | undefined) => tr(x, lang)
}

/** shared UI vocabulary */
export const UI = {
  pause: T('Пауза', 'Pause'),
  play: T('Пуск', 'Play'),
  step: T('Шаг', 'Step'),
  slow: T('Замедлить', 'Slow-mo'),
  follow: T('Камера следует', 'Follow camera'),
  reset: T('Сбросить вид', 'Reset view'),
  back: T('Назад', 'Back'),
  controls: T('Управление', 'Controls'),
  modes: T('Режимы', 'Modes'),
  flows: T('Потоки', 'Flows'),
  walk: T('Обзор', 'Walk'),
  cutaway: T('Разрез', 'Cutaway'),
  xray: T('Рентген', 'X-ray'),
  flow: T('Поток', 'Flow'),
  exploded: T('Разборка', 'Exploded'),
  learn: T('Обучение', 'Learn'),
  auto: T('Авто', 'Auto'),
  scenario: T('Сценарий', 'Scenario'),
  approx: T('прибл.', 'approx.'),
  illustrative: T('иллюстративно', 'illustrative'),
  representative: T('Типовая конфигурация. Точные данные зависят от года, двигателя и рынка.', 'Representative configuration. Exact configuration may vary by model year, engine and market.'),
}
