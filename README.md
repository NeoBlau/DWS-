# HOW IT WORKS

Интерактивный 3D-учебник: путешествие внутри Toyota Fortuner (дизель), BMW 530i (бензин) и Airbus A320.
Потоки топлива, воздуха, масла, охлаждающей жидкости, электричества, гидравлики и выхлопа; разрез (clipping plane),
X-ray, exploded view, прогулка по зонам, обучение по шагам, демо-сценарии, поиск, лаборатории-«глубокие погружения».

## Запуск

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # dist/
npm run build:single   # dist-single/index.html — всё в одном файле
```

## Архитектура

```
src/
  data/        types.ts (VehicleDef, ComponentDef, FlowDef, …), flowMeta.ts (цвета потоков)
  vehicles/    toyotaFortuner.ts, bmw530i.ts, a320.ts, common.ts, index.ts (реестр)
  models/      CarModel.tsx, AircraftModel.tsx (процедурные модели), Part.tsx (прозрачность,
               подсветка, разрез, разлёт), carLayout.ts, aircraftLayout.ts, runtime.ts (физика анимаций)
  systems/     Flows.tsx — частицы по сплайнам
  scenes/      MachineScene.tsx — Canvas, камера (camera-controls), свет, bloom, проектор хотспотов
  labs/        CylinderLab (4 такта, дизель vs бензин), TurboLab, TransmissionLab, BrakeLab (+ABS), TurbofanLab
  components/  HUD, панели, поиск, загрузка, главная, финал
  audio/       процедурный звук на WebAudio (выключен по умолчанию)
  utils/       геометрия, действия (выбор компонента, обучение, поиск, прогресс)
```

Новая машина = новый файл в `src/vehicles/` с компонентами, потоками, зонами прогулки и шагами обучения.
Процедурную модель можно заменить GLB/GLTF: модель только должна оборачивать меши в `<Part comp system layer>`.

Технические данные — для типовых конфигураций (representative). Exact configuration may vary by model year, engine and market.

`classic/` — первая, статическая SVG-версия сайта.
