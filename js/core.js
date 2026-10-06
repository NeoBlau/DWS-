/* Router, camera, scroll-driven chapters and shared drawing helpers. */
(function () {
  const TOURS = window.TOURS;
  const app = document.getElementById('app');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- drawing helpers handed to each tour's svg() ---------- */
  const H = {
    flow: (d, c, sp = '') => `<path class="pipe ${c}" d="${d}"/><path class="dots ${c} ${sp}" d="${d}"/>`,
    thin: (d, c, sp = '') => `<path class="pipe ${c}" d="${d}" style="stroke-width:5"/><path class="dots thin ${c} ${sp}" d="${d}"/>`,
    wire: (d, c = 'c-elec') => `<path class="pipe wire ${c}" d="${d}"/><path class="dots wire ${c}" d="${d}"/>`,
    wheel(cx, cy, r, o = {}) {
      const spokes = Array.from({ length: o.spokes || 6 }, (_, i) => {
        const a = i * Math.PI * 2 / (o.spokes || 6);
        return `<line x1="${cx + Math.cos(a) * r * .2}" y1="${cy + Math.sin(a) * r * .2}" x2="${cx + Math.cos(a) * r * .6}" y2="${cy + Math.sin(a) * r * .6}" class="line" stroke-width="${r * .07}"/>`;
      }).join('');
      return `<g class="wheel">
        <circle cx="${cx}" cy="${cy}" r="${r * .86}" class="tire" stroke-width="${r * .28}" stroke-opacity=".9"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
        <circle cx="${cx}" cy="${cy}" r="${r * .68}" class="rim"/>
        <g data-sys="brakes"><circle cx="${cx}" cy="${cy}" r="${r * .5}" class="disc"/>
        <path d="M${cx + r * .32} ${cy - r * .42} A${r * .53} ${r * .53} 0 0 1 ${cx + r * .52} ${cy - r * .1}" stroke="var(--c-brake)" stroke-width="${r * .14}" fill="none" stroke-linecap="round"/></g>
        <g class="spin">${spokes}<circle cx="${cx}" cy="${cy}" r="${r * .12}" class="part m"/></g>
      </g>`;
    },
    spring(x, y1, y2, w = 14, n = 7) {
      let d = `M${x} ${y1}`;
      const step = (y2 - y1) / n;
      for (let i = 0; i < n; i++) d += ` L${x + (i % 2 ? -w : w)} ${y1 + step * (i + .5)}`;
      return `<path class="spring" d="${d} L${x} ${y2}"/>`;
    },
    /* inline engine seen from the side with animated pistons (firing order 1-3-4-2) */
    engine(x, y, w, n, o = {}) {
      const hH = o.head || 28, bH = o.block || 100, cw = (w - 20) / n;
      let cyl = '';
      const fire = [0, -0.42, -1.26, -0.84, -0.21, -0.63]; // firing order 1-3-4-2, phase delays in s
      for (let i = 0; i < n; i++) {
        const cx = x + 10 + i * cw;
        const b = (i === 1 || i === 2) ? ' b' : '';
        const dl = `animation-delay:${fire[i % 6]}s`;
        cyl += `<rect x="${cx + 3}" y="${y + hH}" width="${cw - 6}" height="${bH * .62}" fill="var(--panel)" stroke="var(--ink)" stroke-width="1"/>
          <rect class="flame" x="${cx + 4}" y="${y + hH + 1}" width="${cw - 8}" height="${bH * .16}" fill="var(--c-hot)" style="${dl}"/>
          ${o.spark ? `<circle class="spark" cx="${cx + cw / 2}" cy="${y + hH + 3}" r="${cw * .16}" fill="var(--c-fuel)" style="${dl}"/>` : ''}
          <g class="piston${b}" style="--stroke:${bH * .28}px"><rect x="${cx + 5}" y="${y + hH + 4}" width="${cw - 10}" height="${bH * .2}" rx="2" class="part m"/>
          <line x1="${cx + cw / 2}" y1="${y + hH + 4 + bH * .2}" x2="${cx + cw / 2}" y2="${y + hH + bH * .62}" stroke="var(--ink)" stroke-width="3"/></g>`;
      }
      return `<g data-sys="engine">
        <rect x="${x + 4}" y="${y - 8}" width="${w - 8}" height="10" rx="4" class="part d"/>
        <rect x="${x}" y="${y}" width="${w}" height="${hH}" rx="3" class="part"/>
        <rect x="${x}" y="${y + hH}" width="${w}" height="${bH}" rx="3" class="part"/>
        ${cyl}
        <path d="M${x + 6} ${y + hH + bH} h${w - 12} l-8 ${o.sump || 24} h${-(w - 28)} Z" class="part d" data-sys="oil"/>
        <circle cx="${x + w / 2}" cy="${y + hH + bH * .82}" r="${bH * .1}" class="part m spin"/>
      </g>`;
    }
  };
  window.H = H;

  /* ---------- camera ---------- */
  let cam = null, camTarget = null, camAnim = 0, svgEl = null;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function setCam(target, instant) {
    if (!svgEl) return;
    cancelAnimationFrame(camAnim);
    if (!cam || instant || reduce) { cam = target.slice(); apply(); return; }
    const from = cam.slice(), t0 = performance.now(), dur = 1300;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = ease(k);
      // slight zoom-out arc so long moves feel like a camera flying over the body
      const arc = Math.sin(k * Math.PI) * Math.min(.18, dist(from, target) / 4000);
      cam = from.map((v, i) => v + (target[i] - v) * e);
      const cx = cam[0] + cam[2] / 2, cy = cam[1] + cam[3] / 2;
      cam[2] *= 1 + arc; cam[3] *= 1 + arc; cam[0] = cx - cam[2] / 2; cam[1] = cy - cam[3] / 2;
      apply();
      if (k < 1) camAnim = requestAnimationFrame(step); else { cam = target.slice(); apply(); }
    };
    camAnim = requestAnimationFrame(step);
  }
  const dist = (a, b) => Math.hypot(a[0] + a[2] / 2 - b[0] - b[2] / 2, a[1] + a[3] / 2 - b[1] - b[3] / 2) + Math.abs(a[2] - b[2]);
  function apply() { svgEl.setAttribute('viewBox', cam.map(v => v.toFixed(1)).join(' ')); }

  /* ---------- labels ---------- */
  function drawLabels(g, labels, c) {
    const fs = c[2] / 58;
    g.innerHTML = (labels || []).map(([x, y, tx, ty, text], i) => {
      const w = text.length * fs * .62 + fs * 1.1, h = fs * 1.7;
      const right = tx >= x;
      let bx = right ? tx : tx - w;
      bx = Math.max(c[0] + fs * .4, Math.min(bx, c[0] + c[2] - w - fs * .4));
      ty = Math.max(c[1] + h, Math.min(ty, c[1] + c[3] - h));
      return `<g class="lbl" style="animation-delay:${.45 + i * .08}s">
        <circle class="ring" cx="${x}" cy="${y}" r="${fs * .45}" stroke-width="${fs * .12}"/>
        <circle cx="${x}" cy="${y}" r="${fs * .3}"/>
        <line x1="${x}" y1="${y}" x2="${Math.abs(bx - x) < Math.abs(bx + w - x) ? bx : bx + w}" y2="${ty}" stroke-width="${fs * .09}"/>
        <rect x="${bx}" y="${ty - h / 2}" width="${w}" height="${h}" rx="${fs * .35}" stroke-width="${fs * .09}"/>
        <text x="${bx + fs * .55}" y="${ty + fs * .36}" font-size="${fs}">${text}</text></g>`;
    }).join('');
  }

  /* ---------- home ---------- */
  function home() {
    const card = (id, kind, t) => `
      <a class="machine" href="#${id}">
        <span class="kind">${kind}</span>
        <h2>${t.name}</h2>
        <svg viewBox="${t.sil.vb}" aria-hidden="true">${t.sil.body}</svg>
        <dl>${t.keys.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <span class="go">Начать тур · ${t.chapters.length} остановок</span>
      </a>`;
    app.innerHTML = `
      <section class="home">
        <div class="hero">
          <div>
            <div class="eyebrow">Интерактивный разрез</div>
            <h1 style="margin-top:14px">Куда едет бензин, <em>когда вы жмёте газ</em></h1>
          </div>
          <div>
            <p>Три машины в разрезе: дизельный внедорожник, бензиновый седан и пассажирский лайнер. Прокручивайте страницу, и камера сама проведёт вас от багажника через салон к двигателю и колёсам. На каждой остановке видно, какая деталь что делает и куда течёт каждая жидкость.</p>
            <div class="legend-strip">
              <span class="chip c-diesel"><i></i>топливо</span><span class="chip c-air"><i></i>воздух</span>
              <span class="chip c-hot"><i></i>выхлоп</span><span class="chip c-cool"><i></i>охлаждение</span>
              <span class="chip c-oil"><i></i>масло</span><span class="chip c-elec"><i></i>электричество</span>
              <span class="chip c-drive"><i></i>трансмиссия</span><span class="chip c-brake"><i></i>тормоза</span>
            </div>
          </div>
        </div>
        <div class="machines">
          ${card('fortuner', 'Дизель · рамный внедорожник', TOURS.fortuner)}
          ${card('bmw', 'Бензин · заднеприводный седан', TOURS.bmw)}
          ${card('a320', 'Реактивный · узкофюзеляжный лайнер', TOURS.a320)}
        </div>
        <section class="compare">
          <div class="eyebrow">Принцип</div>
          <h2 style="margin-top:10px">Три способа превратить топливо в движение</h2>
          <div class="cmp-grid">
            <div class="cmp c-diesel"><span class="big">15,6 : 1</span><h3>Дизель: тепло от сжатия</h3><p>Поршень сжимает чистый воздух так сильно, что тот разогревается до 700–900 °C. Топливо впрыскивается в этот раскалённый воздух и вспыхивает само. Искра не нужна, поэтому на дизеле нет свечей зажигания.</p></div>
            <div class="cmp c-fuel"><span class="big">10,2 : 1</span><h3>Бензин: искра по команде</h3><p>Смесь воздуха и бензина сжимается слабее, иначе она взорвётся раньше времени (детонация). Момент воспламенения задаёт свеча, а блок управления сдвигает его тысячи раз в минуту.</p></div>
            <div class="cmp c-jet"><span class="big">≈ 6 : 1</span><h3>Турбовентилятор: горение без пауз</h3><p>Здесь нет тактов и поршней. Пламя в камере сгорания горит непрерывно. Большую часть тяги даёт вентилятор, который гонит холодный воздух мимо горячего ядра. Число показывает, сколько воздуха идёт в обход ядра.</p></div>
          </div>
        </section>
        <p class="note">Схемы упрощены. Детали показаны там, где их удобно понять, а не строго в масштабе. Характеристики даны для типовых версий: Toyota Fortuner 2.8 (1GD-FTV), BMW 530i G30 (B48) и Airbus A320ceo с CFM56-5B. В разных годах и на разных рынках они отличаются.</p>
      </section>`;
    window.scrollTo(0, 0);
  }

  /* ---------- tour ---------- */
  let io = null, active = -1, tour = null, flowsOff = new Set(), running = true;

  function render(id) {
    tour = TOURS[id];
    flowsOff = new Set();
    active = -1;
    app.innerHTML = `
      <section class="tour">
        <div class="stage-wrap"><div class="stage">
          <div class="stage-head">
            <div><div class="eyebrow">${tour.kind}</div><h1 style="margin-top:6px">${tour.name}</h1><div class="sub">${tour.sub}</div></div>
            <div class="where"><b id="where">Обзор</b><span id="count"></span></div>
          </div>
          <div class="viewport"><svg class="draw running" id="draw" viewBox="${tour.vb.join(' ')}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${tour.name} в разрезе">
            ${tour.svg(H)}<g id="labels"></g></svg></div>
          <div class="stage-foot">
            <div class="legend">${tour.legend.map(([k, t, c]) => `<button type="button" class="${c}" data-flow-btn="${k}"><i></i>${t}</button>`).join('')}</div>
            <div class="ctrl">
              <button type="button" id="prev" aria-label="Предыдущая остановка">↑</button>
              <button type="button" id="play" aria-label="Пауза анимации">❚❚</button>
              <button type="button" id="next" aria-label="Следующая остановка">↓</button>
            </div>
          </div>
          <div class="progress"><i id="bar"></i></div>
        </div></div>
        <div class="chapters">${tour.chapters.map((c, i) => `
          <article class="chapter" id="ch-${i}" data-i="${i}">
            <div class="card">
              <div class="eyebrow">${String(i + 1).padStart(2, '0')} <span>${c.kicker}</span></div>
              <h2>${c.title}</h2>
              ${c.html}
              ${c.inset ? `<div class="inset" data-inset="${i}"></div>` : ''}
              ${i === tour.chapters.length - 1 ? nextLinks(id) : ''}
            </div>
          </article>`).join('')}
        </div>
      </section>`;
    svgEl = document.getElementById('draw');
    cam = null;
    setCam(tour.chapters[0].cam, true);
    tour.chapters.forEach((c, i) => {
      if (!c.inset) return;
      const el = app.querySelector(`[data-inset="${i}"]`);
      INSETS[c.inset.type](el, c.inset);
    });
    watchInsets();
    io && io.disconnect();
    io = new IntersectionObserver(es => {
      es.forEach(e => { if (e.isIntersecting) activate(+e.target.dataset.i); });
    }, { rootMargin: matchMedia('(max-width: 900px)').matches ? '-60% 0px -30% 0px' : '-45% 0px -45% 0px' });
    app.querySelectorAll('.chapter').forEach(c => io.observe(c));
    activate(0);

    app.querySelectorAll('[data-flow-btn]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.flowBtn;
      flowsOff.has(k) ? flowsOff.delete(k) : flowsOff.add(k);
      paint(tour.chapters[active]);
    }));
    document.getElementById('prev').onclick = () => go(active - 1);
    document.getElementById('next').onclick = () => go(active + 1);
    const play = document.getElementById('play');
    running = !reduce;
    svgEl.classList.toggle('running', running);
    play.onclick = () => {
      running = !running;
      svgEl.classList.toggle('running', running);
      play.textContent = running ? '❚❚' : '▶';
      play.setAttribute('aria-label', running ? 'Пауза анимации' : 'Запустить анимацию');
    };
    svgEl.addEventListener('click', e => {
      const t = e.target.closest('[data-go]');
      if (t) { const i = tour.chapters.findIndex(c => c.id === t.dataset.go); if (i >= 0) go(i); }
    });
    window.scrollTo(0, 0);
  }

  function nextLinks(id) {
    const other = Object.keys(TOURS).filter(k => k !== id);
    return `<div class="jump">${other.map(k => `<a href="#${k}">Дальше: ${TOURS[k].name} →</a>`).join('')}<a href="#home">На главную</a></div>`;
  }

  function go(i) {
    if (!tour) return;
    i = Math.max(0, Math.min(tour.chapters.length - 1, i));
    document.getElementById('ch-' + i).scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }

  function activate(i) {
    if (i === active || !tour) return;
    active = i;
    const c = tour.chapters[i];
    app.querySelectorAll('.chapter').forEach(el => el.classList.toggle('on', +el.dataset.i === i));
    setCam(c.cam);
    drawLabels(document.getElementById('labels'), c.labels, c.cam);
    paint(c);
    document.getElementById('where').textContent = c.short || c.kicker;
    document.getElementById('count').textContent = `${i + 1} / ${tour.chapters.length}`;
    document.getElementById('bar').style.width = ((i + 1) / tour.chapters.length * 100) + '%';
  }

  function paint(c) {
    const flows = c.flows === 'all' ? tour.legend.map(l => l[0]) : (c.flows || []);
    svgEl.querySelectorAll('[data-flow]').forEach(el => {
      const keys = el.dataset.flow.split(' ');
      el.classList.toggle('show', keys.some(k => flows.includes(k) && !flowsOff.has(k)));
    });
    svgEl.classList.toggle('focus', !!c.focus);
    if (c.focus) svgEl.querySelectorAll('[data-sys]').forEach(el => {
      const keys = el.dataset.sys.split(' ');
      el.classList.toggle('dim', !keys.some(k => c.focus.includes(k)));
    });
    app.querySelectorAll('[data-flow-btn]').forEach(b => {
      const k = b.dataset.flowBtn;
      b.classList.toggle('off', flowsOff.has(k) || !flows.includes(k));
      b.classList.toggle('lit', flows.includes(k) && !flowsOff.has(k));
    });
  }

  /* ---------- inset animation loop: tick only what is on screen ---------- */
  let insetIO = null;
  function watchInsets() {
    insetIO && insetIO.disconnect();
    window.INSET_TICKS.splice(0, window.INSET_TICKS.length - app.querySelectorAll('.inset').length);
    insetIO = new IntersectionObserver(es => es.forEach(e => {
      const it = window.INSET_TICKS.find(t => t.el === e.target);
      if (it) it.on = e.isIntersecting;
    }));
    window.INSET_TICKS.forEach(t => { insetIO.observe(t.el); t.fn(0, 16); });
  }
  let last = performance.now(), clock = 0;
  function loop(now) {
    const dt = Math.min(50, now - last); last = now; clock += dt;
    if (!reduce) window.INSET_TICKS.forEach(t => { if (t.on && !t.paused && document.body.contains(t.el)) { t.t = (t.t || 0) + dt; t.fn(t.t, dt); } });
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------- keyboard + router ---------- */
  document.addEventListener('keydown', e => {
    if (!tour || e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); go(active + 1); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); go(active - 1); }
  });
  function route() {
    const id = location.hash.slice(1);
    document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === id));
    window.INSET_TICKS.length = 0;
    if (TOURS[id]) { render(id); } else { tour = null; io && io.disconnect(); home(); }
  }
  window.addEventListener('hashchange', route);
  route();
})();
