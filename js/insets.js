/* Detail diagrams shown inside chapter cards. Each builder fills an element and
   registers a tick(t) function; core.js runs ticks only for visible insets. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const INSETS = {};
  const ticks = [];
  window.INSETS = INSETS;
  window.INSET_TICKS = ticks;

  const svg = (vb, body, cls = '') => `<svg class="ins ${cls}" viewBox="${vb}" role="img">${body}</svg>`;
  const reg = (el, fn) => { const item = { el, fn, on: false, paused: false }; ticks.push(item); return item; };

  function caption(el, title, hint, item) {
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.innerHTML = `<span><b>${title}</b>${hint ? ' · ' + hint : ''}</span>`;
    if (item) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'пауза';
      b.addEventListener('click', () => { item.paused = !item.paused; b.textContent = item.paused ? 'пуск' : 'пауза'; });
      cap.appendChild(b);
    }
    el.appendChild(cap);
  }

  /* ---------- four-stroke cycle: diesel or petrol (direct injection) ---------- */
  INSETS.cycle = function (el, o) {
    const diesel = o.mode === 'diesel';
    el.innerHTML = svg('0 0 400 350', `
      <defs><clipPath id="cyl-${o.mode}"><rect x="130" y="104" width="120" height="200"/></clipPath></defs>
      <rect x="118" y="100" width="12" height="190" class="part d"/>
      <rect x="250" y="100" width="12" height="190" class="part d"/>
      <g clip-path="url(#cyl-${o.mode})"><rect class="gas" x="130" y="104" width="120" height="200"/></g>
      <path class="part" d="M104 60 H276 V104 H104 Z"/>
      <path d="M104 74 H150 L158 104 H142 Z" fill="var(--c-air)" fill-opacity=".35"/>
      <path d="M276 74 H230 L222 104 H238 Z" fill="var(--c-exh)" fill-opacity=".45"/>
      <g class="vin"><line x1="152" y1="30" x2="152" y2="100" class="line" stroke-width="3"/><path d="M138 100 H166 L160 106 H144 Z" class="part m"/></g>
      <g class="vex"><line x1="228" y1="30" x2="228" y2="100" class="line" stroke-width="3"/><path d="M214 100 H242 L236 106 H220 Z" class="part m"/></g>
      ${diesel
        ? `<rect x="184" y="34" width="12" height="70" rx="3" class="part m"/><text x="190" y="26" text-anchor="middle" class="t-m">форсунка</text>
           <rect x="204" y="70" width="6" height="34" class="part" fill="var(--c-hot)"/><text x="232" y="56" class="t-m">свеча накала</text>`
        : `<rect x="184" y="40" width="12" height="64" rx="3" class="part"/><text x="190" y="32" text-anchor="middle" class="t-m">свеча</text>
           <rect x="132" y="64" width="9" height="40" rx="2" class="part m" transform="rotate(-25 136 104)"/><text x="60" y="122" class="t-m">форсунка</text>`}
      <g class="spray" opacity="0">${diesel
        ? [-50, -25, 0, 25, 50].map(a => `<line x1="190" y1="106" x2="${190 + Math.sin(a * Math.PI / 180) * 46}" y2="${106 + Math.cos(a * Math.PI / 180) * 30}" stroke="var(--c-diesel)" stroke-width="3" stroke-dasharray="3 3"/>`).join('')
        : [10, 25, 40].map(a => `<line x1="141" y1="108" x2="${141 + Math.sin(a * Math.PI / 180) * 70}" y2="${108 + Math.cos(a * Math.PI / 180) * 40}" stroke="var(--c-fuel)" stroke-width="3" stroke-dasharray="3 3"/>`).join('')}</g>
      <g class="sparkfx" opacity="0"><path d="M190 106 l-8 10 l8 -2 l-6 12 l14 -16 l-8 2 l6 -8 z" fill="var(--c-fuel)"/></g>
      <g class="pist"><rect x="132" y="0" width="116" height="44" rx="3" class="part m"/><line x1="132" y1="10" x2="248" y2="10" class="line"/><line x1="132" y1="18" x2="248" y2="18" class="line"/><circle cx="190" cy="28" r="7" class="part"/></g>
      <line class="rod" x1="190" y1="0" x2="190" y2="0" stroke="var(--ink)" stroke-width="9" stroke-linecap="round"/>
      <circle cx="190" cy="292" r="48" class="part d"/>
      <circle class="pin" r="6" cx="190" cy="270" fill="var(--accent)"/>
      <text x="300" y="150" class="t-b phase" font-size="15">Впуск</text>
      <text x="300" y="172" class="t-m deg">0°</text>
      <foreignObject x="290" y="182" width="110" height="120"><div xmlns="http://www.w3.org/1999/xhtml" class="ph-note" style="font:11px/1.35 var(--f-mono);color:var(--muted)"></div></foreignObject>
      <text x="16" y="20" class="t-m">впуск</text><text x="340" y="20" class="t-m" text-anchor="end">выпуск</text>
    `);
    const q = s => el.querySelector(s);
    const gas = q('.gas'), pist = q('.pist'), rod = q('.rod'), pin = q('.pin'), vin = q('.vin'), vex = q('.vex'),
      spray = q('.spray'), sparkfx = q('.sparkfx'), phase = q('.phase'), deg = q('.deg'), note = q('.ph-note');
    const R = 39, L = 113, CY = 292;
    const notes = diesel ? [
      'Поршень идёт вниз, впускной клапан открыт: цилиндр заполняется чистым воздухом от турбины.',
      'Воздух сжимается примерно в 15,6 раза и нагревается до 700–900 °C.',
      'Форсунка впрыскивает дизель под давлением до 2200 бар. Он вспыхивает сам, без искры.',
      'Газы выталкиваются через выпускной клапан в турбину.'
    ] : [
      'Впускной клапан открыт, цилиндр заполняется воздухом. Форсунка впрыскивает бензин прямо в цилиндр.',
      'Смесь сжимается примерно в 10 раз. Сама по себе она не загорается.',
      'Свеча даёт искру чуть раньше верхней точки. Фронт пламени толкает поршень вниз.',
      'Выпускной клапан открыт, газы уходят в турбину и катализатор.'
    ];
    const names = ['Впуск', 'Сжатие', 'Рабочий ход', 'Выпуск'];
    let lastPh = -1;
    const item = reg(el, (t) => {
      const a = (t * 0.18) % 720; // degrees of crank, ~4 s per cycle
      const th = a * Math.PI / 180;
      const pinY = CY - (R * Math.cos(th) + Math.sqrt(L * L - Math.pow(R * Math.sin(th), 2)));
      const pinX = 190;
      const top = pinY - 28;
      pist.setAttribute('transform', `translate(0 ${top})`);
      const cx = 190 + R * Math.sin(th), cy = CY - R * Math.cos(th);
      rod.setAttribute('x1', pinX); rod.setAttribute('y1', pinY); rod.setAttribute('x2', cx); rod.setAttribute('y2', cy);
      pin.setAttribute('cx', cx); pin.setAttribute('cy', cy);
      gas.setAttribute('height', Math.max(0, top - 104));
      const ph = Math.floor(a / 180);
      const k = (a % 180) / 180;
      const lift = s => Math.sin(Math.min(1, Math.max(0, s)) * Math.PI) * 12;
      vin.setAttribute('transform', `translate(0 ${ph === 0 ? lift(k) : 0})`);
      vex.setAttribute('transform', `translate(0 ${ph === 3 ? lift(k) : 0})`);
      let col, op;
      if (ph === 0) { col = 'var(--c-air)'; op = .15 + .25 * k; }
      else if (ph === 1) { col = diesel ? 'var(--c-air)' : 'var(--c-fuel)'; op = .4 + .25 * k; }
      else if (ph === 2) { col = 'var(--c-hot)'; op = .85 - .5 * k; }
      else { col = 'var(--c-exh)'; op = .5 - .35 * k; }
      gas.setAttribute('fill', col); gas.setAttribute('fill-opacity', op);
      const sprayOn = diesel ? (a > 350 && a < 385) : (a > 60 && a < 130);
      spray.setAttribute('opacity', sprayOn ? 1 : 0);
      sparkfx.setAttribute('opacity', !diesel && a > 345 && a < 362 ? 1 : 0);
      deg.textContent = `${Math.round(a)}° коленвала`;
      if (ph !== lastPh) { lastPh = ph; phase.textContent = `${ph + 1}. ${names[ph]}`; note.textContent = notes[ph]; }
    });
    caption(el, diesel ? 'Дизельный цикл' : 'Цикл Отто с непосредственным впрыском', '720° = 2 оборота', item);
  };

  /* ---------- turbocharger ---------- */
  INSETS.turbo = function (el, o) {
    const blades = (cx, cls) => `<g class="${cls}">${Array.from({ length: 10 }, (_, i) =>
      `<path d="M${cx} 150 q 8 -22 0 -46" transform="rotate(${i * 36} ${cx} 150)" fill="none" stroke="var(--ink)" stroke-width="2.4"/>`).join('')}</g>`;
    el.innerHTML = svg('0 0 420 270', `
      <circle cx="100" cy="150" r="66" fill="var(--c-hot)" fill-opacity=".14" stroke="var(--c-hot)" stroke-width="2"/>
      <circle cx="320" cy="150" r="66" fill="var(--c-air)" fill-opacity=".14" stroke="var(--c-air)" stroke-width="2"/>
      <rect x="150" y="140" width="120" height="20" rx="4" class="part m"/>
      <rect x="185" y="122" width="50" height="56" rx="6" class="part"/>
      <path class="pipe c-oil" d="M210 60 V122"/><path class="dots thin c-oil" d="M210 60 V122"/>
      <text x="216" y="70" class="t-m">масло</text>
      ${blades(100, 'tw')}${blades(320, 'cw')}
      <circle cx="100" cy="150" r="10" class="part m"/><circle cx="320" cy="150" r="10" class="part m"/>
      <path class="pipe c-hot" d="M10 250 Q30 210 70 205"/><path class="dots c-hot" d="M10 250 Q30 210 70 205"/>
      <path class="pipe c-exh" d="M100 150 L10 150"/><path class="dots c-exh fast" d="M100 150 L10 150"/>
      <path class="pipe c-air" d="M410 150 L320 150"/><path class="dots c-air" d="M410 150 L320 150"/>
      <path class="pipe c-air" d="M350 90 Q380 50 410 40"/><path class="dots c-air fast" d="M350 90 Q380 50 410 40"/>
      <text x="100" y="40" text-anchor="middle" class="t-b">турбина</text>
      <text x="100" y="56" text-anchor="middle" class="t-m">горячий выхлоп</text>
      <text x="320" y="40" text-anchor="middle" class="t-b">компрессор</text>
      <text x="320" y="56" text-anchor="middle" class="t-m">холодный воздух</text>
      <text x="14" y="242" class="t-m">из коллектора</text>
      <text x="408" y="30" text-anchor="end" class="t-m">в интеркулер →</text>
      <text x="210" y="210" text-anchor="middle" class="t-m">общий вал</text>
      <text x="210" y="226" text-anchor="middle" class="t-b rpm">0 об/мин</text>
    `);
    const tw = el.querySelector('.tw'), cw = el.querySelector('.cw'), rpm = el.querySelector('.rpm');
    const item = reg(el, (t) => {
      const ang = (t * 0.9) % 360;
      tw.setAttribute('transform', `rotate(${ang} 100 150)`);
      cw.setAttribute('transform', `rotate(${-ang} 320 150)`);
      const v = 150000 + Math.sin(t / 1200) * 40000;
      rpm.textContent = `≈${Math.round(v / 1000) * 1000} об/мин`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    });
    caption(el, o.title || 'Турбокомпрессор', o.hint || 'энергия выхлопа сжимает воздух', item);
  };

  /* ---------- planetary gearset ---------- */
  INSETS.planetary = function (el, o) {
    const teeth = (r, n, cls) => `<circle r="${r}" stroke-dasharray="${(2 * Math.PI * r / n / 2).toFixed(2)}" style="fill:none;stroke:var(--ink);stroke-width:7;stroke-opacity:.8"/>`;
    el.innerHTML = svg('0 0 420 300', `
      <g transform="translate(150 150)">
        <circle r="128" class="part d"/><circle r="110" fill="var(--panel)" stroke="var(--ink)" stroke-width="1.2"/>
        <g class="ring">${teeth(112, 54, 'line')}</g>
        <g class="carrier"><path d="M0 -68 L59 34 L-59 34 Z" fill="none" stroke="var(--c-drive)" stroke-width="10" stroke-linejoin="round" opacity=".55"/>
          ${[0, 120, 240].map(a => `<g transform="rotate(${a}) translate(0 -68)"><g class="pl"><circle r="38" class="part"/>${teeth(38, 18, 'line')}<line x1="-30" x2="30" class="line"/><circle r="6" fill="var(--c-drive)"/></g></g>`).join('')}
        </g>
        <g class="sun"><circle r="30" class="part m"/>${teeth(30, 14, 'line')}<line y1="-24" y2="24" class="line"/></g>
      </g>
      <text x="300" y="70" class="t-b" style="fill:var(--c-drive)">солнце</text><text x="300" y="86" class="t-m">ведущее</text>
      <text x="300" y="130" class="t-b" style="fill:var(--c-drive)">сателлиты</text><text x="300" y="146" class="t-m">на водиле — выход</text>
      <text x="300" y="190" class="t-b" style="fill:var(--c-drive)">коронная</text><text x="300" y="206" class="t-m">заторможена муфтой</text>
      <text x="300" y="250" class="t-b gear">передача: 1</text>
    `);
    const sun = el.querySelector('.sun'), car = el.querySelector('.carrier'), pls = el.querySelectorAll('.pl'), gear = el.querySelector('.gear');
    // ring fixed: carrier speed = sun * Zs/(Zs+Zr); planet spin relative
    const item = reg(el, (t) => {
      const s = t * 0.12;
      const c = s * 30 / (30 + 112);
      const p = -(s - c) * 30 / 38 + c;
      sun.setAttribute('transform', `rotate(${s % 360})`);
      car.setAttribute('transform', `rotate(${c % 360})`);
      pls.forEach(g => g.setAttribute('transform', `rotate(${(p - c) % 360})`));
      gear.textContent = `понижение ${(1 + 112 / 30).toFixed(2)} : 1`;
    });
    caption(el, o.title || 'Планетарный ряд', o.hint || 'основа автоматической коробки', item);
  };

  /* ---------- turbofan (CFM56-5B) ---------- */
  INSETS.turbofan = function (el) {
    const P = [];
    el.innerHTML = svg('0 0 680 300', `
      <path class="part" d="M70 40 Q110 22 200 26 L520 40 L560 70 L520 72 L200 66 Q120 66 92 72 Z"/>
      <path class="part" d="M70 260 Q110 278 200 274 L520 260 L560 230 L520 228 L200 234 Q120 234 92 228 Z"/>
      <path class="part d" d="M160 112 Q200 98 250 104 L380 118 L470 116 L560 132 L600 150 L560 168 L470 184 L380 182 L250 196 Q200 202 160 188 Z"/>
      <g class="stg">
        ${Array.from({ length: 4 }, (_, i) => `<rect x="${172 + i * 14}" y="${112 + i}" width="5" height="${76 - 2 * i}" fill="var(--c-air)" opacity=".7"/>`).join('')}
        ${Array.from({ length: 9 }, (_, i) => `<rect x="${236 + i * 12}" y="${116 + i * 2.2}" width="4" height="${68 - i * 4.4}" fill="var(--c-air)"/>`).join('')}
        <rect x="350" y="128" width="40" height="44" rx="10" fill="var(--c-jet)" fill-opacity=".35" stroke="var(--c-jet)" stroke-width="2"/>
        <path class="flick" d="M356 150 q10 -16 20 0 q-10 16 -20 0" fill="var(--c-jet)"/>
        <rect x="396" y="124" width="7" height="52" fill="var(--c-hot)"/>
        ${Array.from({ length: 4 }, (_, i) => `<rect x="${416 + i * 16}" y="${122 - i * 2}" width="7" height="${56 + i * 4}" fill="var(--c-hot)" opacity=".75"/>`).join('')}
      </g>
      <rect x="120" y="148" width="420" height="4" class="part m"/>
      <g class="fan"><line x1="128" y1="70" x2="128" y2="230" stroke="var(--ink)" stroke-width="12" stroke-dasharray="14 6"/></g>
      <path d="M100 150 Q100 120 128 112 L128 188 Q100 180 100 150 Z" class="part m"/>
      <g class="parts"></g>
      <text x="128" y="292" text-anchor="middle" class="t-b">вентилятор</text>
      <text x="196" y="96" text-anchor="middle" class="t-m">бустер</text>
      <text x="290" y="124" text-anchor="middle" class="t-m" style="font-size:12px">КВД 9 ст.</text>
      <text x="370" y="22" text-anchor="middle" class="t-b" style="fill:var(--c-jet)">камера сгорания</text>
      <line x1="370" y1="28" x2="370" y2="126" stroke="var(--c-jet)" stroke-dasharray="3 3"/>
      <text x="440" y="214" text-anchor="middle" class="t-m">турбины</text>
      <text x="676" y="22" text-anchor="end" class="t-m">2-й контур ≈80% тяги</text>
      <text x="676" y="196" text-anchor="end" class="t-m">струя</text>
      <text x="10" y="140" class="t-m">воздух</text>
    `, 'big');
    const g = el.querySelector('.parts'), fan = el.querySelector('.fan line'), fl = el.querySelector('.flick');
    for (let i = 0; i < 46; i++) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', 2.6);
      g.appendChild(c);
      P.push({ c, x: Math.random() * 640, core: i % 3 === 0, y0: Math.random() });
    }
    const coreY = (x, y0) => {
      // narrowing core stream: half-height shrinks through compressor, grows after turbine
      let h = x < 170 ? 34 : x < 340 ? 34 - (x - 170) / 170 * 20 : x < 400 ? 14 : 14 + (x - 400) / 200 * 6;
      return 150 + (y0 - .5) * 2 * h;
    };
    const item = reg(el, (t, dt) => {
      fan.setAttribute('stroke-dashoffset', (t * 0.4) % 20);
      fl.setAttribute('opacity', .6 + Math.sin(t / 60) * .4);
      P.forEach(p => {
        const v = p.core ? (p.x < 340 ? 1.3 : 3.2) : 2.4;
        p.x += v * dt / 16;
        if (p.x > 650) { p.x = 20; p.y0 = Math.random(); }
        let y, col;
        if (p.core) {
          y = p.x < 150 ? 150 + (p.y0 - .5) * 70 : coreY(p.x, p.y0);
          col = p.x < 340 ? 'var(--c-air)' : p.x < 400 ? 'var(--c-jet)' : p.x < 480 ? 'var(--c-hot)' : 'var(--c-exh)';
        } else {
          const side = p.y0 < .5 ? -1 : 1;
          const lane = 48 + (p.y0 % .5) * 2 * 28; // bypass duct band
          y = p.x < 110 ? 150 + side * (10 + (p.y0 % .5) * 2 * 64) : 150 + side * lane;
          col = 'var(--c-air)';
        }
        p.c.setAttribute('cx', p.x); p.c.setAttribute('cy', y); p.c.setAttribute('fill', col);
        p.c.setAttribute('opacity', p.x > 590 && p.core ? .5 : .9);
      });
    });
    caption(el, 'CFM56-5B в разрезе', 'два вала, двухконтурность ≈ 6', item);
  };

  /* ---------- generic animated flow diagram ---------- */
  // spec: { vb:'0 0 w h', nodes:[[x,y,w,h,'label','sub', colorClass]], edges:[['path', colorClass, speed]], title, hint, extra }
  INSETS.flow = function (el, s) {
    const edges = s.edges.map(([d, c, sp]) =>
      `<path class="pipe ${c}" d="${d}"/><path class="dots thin ${c} ${sp || ''}" d="${d}"/>`).join('');
    const nodes = s.nodes.map(([x, y, w, h, label, sub, c]) =>
      `<g class="node ${c ? 'acc ' + c : ''}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>
        <text x="${x + w / 2}" y="${y + h / 2 - (sub ? 7 : 0)}" class="t-b">${label}</text>
        ${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 9}" class="t-m" font-size="10">${sub}</text>` : ''}</g>`).join('');
    el.innerHTML = svg(s.vb, edges + nodes + (s.extra || ''));
    caption(el, s.title, s.hint);
  };
})();
