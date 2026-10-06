import type { SystemGroup, VehicleDef } from '../data/types'

export const carSystems: SystemGroup[] = [
  { id: 'engine', label: 'ENGINE', ru: 'Двигатель' },
  { id: 'fuel', label: 'FUEL', ru: 'Топливо' },
  { id: 'transmission', label: 'TRANSMISSION', ru: 'Трансмиссия' },
  { id: 'cooling', label: 'COOLING', ru: 'Охлаждение' },
  { id: 'electrical', label: 'ELECTRICAL', ru: 'Электрика' },
  { id: 'brakes', label: 'BRAKES', ru: 'Тормоза' },
  { id: 'steering', label: 'STEERING', ru: 'Рулевое' },
  { id: 'suspension', label: 'SUSPENSION', ru: 'Подвеска' },
  { id: 'cabin', label: 'CABIN', ru: 'Салон' },
  { id: 'climate', label: 'CLIMATE', ru: 'Кондиционер' },
  { id: 'exhaust', label: 'EXHAUST', ru: 'Выхлоп' },
  { id: 'trunk', label: 'TRUNK', ru: 'Багажник' },
]

export const carLayers: VehicleDef['layers'] = [
  { id: 'body', label: 'BODY', offset: [0, 1.7, 0] },
  { id: 'interior', label: 'INTERIOR', offset: [0, 0.95, 0] },
  { id: 'engine', label: 'ENGINE', offset: [0.75, 0.55, 0] },
  { id: 'cooling', label: 'COOLING', offset: [1.35, 0.45, 0] },
  { id: 'transmission', label: 'TRANSMISSION', offset: [-0.15, -0.05, 0] },
  { id: 'fuel', label: 'FUEL', offset: [-0.35, -0.25, 0] },
  { id: 'exhaust', label: 'EXHAUST', offset: [0, -0.5, -0.35] },
  { id: 'electrical', label: 'ELECTRICAL', offset: [0.2, 0.95, 0] },
  { id: 'suspension', label: 'SUSPENSION', offset: [0, 0, 0], outward: 0.55 },
  { id: 'brakes', label: 'BRAKES', offset: [0, 0, 0], outward: 0.95 },
]

import type { LearnStep } from '../data/types'

/** WHAT HAPPENS WHEN YOU START THE ENGINE? — shared by both cars (component ids exist in each) */
export function carStart(diesel: boolean): { title: string; steps: LearnStep[] } {
  return {
    title: 'WHAT HAPPENS WHEN YOU START THE ENGINE?',
    steps: [
      { title: 'BATTERY', text: 'Вы нажимаете START. Аккумулятор отдаёт сотни ампер на стартер.', focus: 'battery', paths: ['elec-starter'], action: 'engineStop', duration: 4 },
      { title: 'STARTER', text: 'Стартер входит в зацепление с маховиком и раскручивает двигатель.', focus: 'starter', paths: ['elec-starter'], action: 'engineStart', duration: 4 },
      { title: 'CRANKSHAFT', text: 'Коленвал вращается, поршни начинают сжимать воздух.', focus: 'crankshaft', flows: ['air'], duration: 4 },
      { title: diesel ? 'FUEL INJECTION' : 'INJECTION + SPARK', text: diesel ? 'ЭБУ поднимает давление в рампе и открывает форсунки. Свечи накала помогают на холодную.' : 'ЭБУ впрыскивает бензин и подаёт искру на свечи точно в нужный момент.', focus: 'injectors', flows: ['fuel', 'electric'], duration: 4.5 },
      { title: 'COMBUSTION', text: 'Первые вспышки — и двигатель начинает крутиться сам. Стартер отключается.', focus: 'cylinders', flows: ['fuel', 'air', 'exhaust'], duration: 4.5 },
      { title: 'ALTERNATOR', text: 'Теперь ремень крутит генератор: он питает машину и заряжает аккумулятор.', focus: 'alternator', paths: ['elec-charge'], duration: 4 },
      { title: 'ELECTRICAL SYSTEM', text: 'Бортовая сеть ~14 В питает блоки управления, свет и мультимедиа. Двигатель на холостых.', focus: 'ecu', flows: ['electric'], duration: 5 },
    ],
  }
}
