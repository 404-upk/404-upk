import { $, api, esc, h, icon, plural, relTime, toast } from "../core.js";
import { countUp, onView, rise } from "../motion.js";

function kpi(label, value, sub = "", ic = "") {
  return `<div class="card kpi">
    <div class="kpi-label">${ic ? icon(ic, "icon-sm") : ""}${esc(label)}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
  </div>`;
}

function hbars(items, { name, value, sub, href, colorClass, iconOf } = {}) {
  if (!items.length) return `<div class="small muted">Данных пока нет</div>`;
  const max = Math.max(...items.map(value), 1);
  return `<div class="hbars">${items
    .map((it, idx) => {
      const v = value(it);
      const label = `<span class="hbar-name" title="${esc(name(it))}">${iconOf ? icon(iconOf(it), "icon-sm") : ""}${esc(name(it))}</span>`;
      return `<div class="hbar">
        ${href ? `<a href="${href(it)}" class="u-inherit hbar-name">${iconOf ? icon(iconOf(it), "icon-sm") : ""}${esc(name(it))}</a>` : label}
        <span class="hbar-track" title="${esc(sub ? sub(it) : String(v))}"><i class="${colorClass ? esc(colorClass(it)) : ""}" data-css-i="${idx}" data-css-pct="${(v / max) * 100}"></i></span>
        <span class="hbar-val">${v}</span>
      </div>`;
    })
    .join("")}</div>`;
}

// столбики «поступило / закрыто» по дням
function dailyChart(days) {
  const W = 720;
  const H = 230;
  const pad = { l: 30, r: 8, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(4, ...days.map((d) => Math.max(d.created, d.closed)));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const slot = iw / days.length;
  const bw = Math.max(4, Math.min(16, slot / 2 - 4));
  const y = (v) => pad.t + ih - (v / top) * ih;
  const bar = (x, v, color, i) => {
    if (!v) return "";
    const y0 = y(v);
    const hgt = pad.t + ih - y0;
    const r = Math.min(4, hgt, bw / 2);
    return `<path class="bar" data-css-i="${i}" fill="${color}" d="M${x},${pad.t + ih} V${y0 + r} Q${x},${y0} ${x + r},${y0} H${x + bw - r} Q${x + bw},${y0} ${x + bw},${y0 + r} V${pad.t + ih} Z"/>`;
  };

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = step * i;
    grid += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  let bars = "";
  let labels = "";
  let hits = "";
  days.forEach((d, i) => {
    const cx = pad.l + slot * i + slot / 2;
    bars += bar(cx - bw - 1, d.created, "var(--chart-1)", i) + bar(cx + 1, d.closed, "var(--chart-2)", i);
    if (i % 2 === days.length % 2 || days.length <= 8) {
      const [, m, dd] = d.date.split("-");
      labels += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${dd}.${m}</text>`;
    }
    hits += `<rect x="${pad.l + slot * i}" y="${pad.t}" width="${slot}" height="${ih}" fill="transparent" data-i="${i}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Заявки по дням: поступило и закрыто">${grid}${bars}${labels}${hits}</svg>`;
}

function bindTooltip(svgWrap, days) {
  let tip = null;
  svgWrap.addEventListener("mousemove", (e) => {
    const i = e.target.dataset?.i;
    if (i === undefined) {
      tip?.remove();
      tip = null;
      return;
    }
    const d = days[Number(i)];
    const [yy, m, dd] = d.date.split("-");
    if (!tip) {
      tip = h(`<div class="chart-tip"></div>`);
      document.body.append(tip);
    }
    tip.innerHTML = `<b>${dd}.${m}.${yy}</b><br><span class="u-chart1">■</span> поступило: ${d.created}<br><span class="u-chart2">■</span> закрыто: ${d.closed}`;
    tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 170)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  svgWrap.addEventListener("mouseleave", () => {
    tip?.remove();
    tip = null;
  });
}

export async function render({ el, setHead }) {
  let days = 14;
  setHead(`<div class="segmented" id="range">
      <button aria-pressed="true" data-d="14">14 дней</button><button aria-pressed="false" data-d="30">30 дней</button><button aria-pressed="false" data-d="90">90 дней</button>
    </div>`);
  document.querySelectorAll("#range button").forEach((b) =>
    b.addEventListener("click", () => {
      days = Number(b.dataset.d);
      document.querySelectorAll("#range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      // при ошибке остаются прежние цифры и сообщение, раздел не пустеет
      load().catch((err) => toast(err.message, "error"));
    }),
  );

  async function load() {
    const s = await api(`/api/staff/stats?days=${days}`);
    const meta = await api("/api/meta").catch(() => null);
    const ai = s.ai;
    const aiShare = ai.total ? Math.round((ai.answered_only / ai.total) * 100) : 0;
    const avg = s.avg_resolution_hours;
    const avgText = avg == null ? "-" : avg < 24 ? `${String(avg).replace(".", ",")} ч` : `${(avg / 24).toFixed(1).replace(".", ",")} дн`;

    el.innerHTML = `
      ${meta?.demo_data ? `<div class="notice">${icon("info")}<div>На стенде демо-данные: заявки и журнал ИИ заполнены заранее, расчёты настоящие.</div></div>` : ""}
      <div class="kpis">
        ${kpi("Всего заявок", s.total, `${s.open} ${plural(s.open, "открыта", "открыты", "открыто")}`, "clipboard")}
        ${kpi("Решено", s.resolved, `отклонено: ${s.rejected}`, "checkCircle")}
        ${kpi("Среднее время решения", avgText, "от регистрации до статуса «Решена»", "clock")}
        ${kpi("Критичных открыто", s.critical_open, s.critical_open ? "требуют внимания сейчас" : "всё спокойно", "flame")}
        ${kpi("ИИ ответил сам", `${aiShare}%`, `${ai.answered_only} из ${ai.total} обращений без заявки`, "bot")}
        ${kpi("Дубли объединены", s.duplicates_merged, "человек присоединились к уже открытым заявкам", "users")}
        ${kpi("Оценка заявителей", s.rating_avg ? `${String(s.rating_avg).replace(".", ",")} / 5` : "-", `${s.rating_count} ${plural(s.rating_count, "оценка", "оценки", "оценок")}`, "star")}
      </div>

      <section class="card">
        <div class="card-head"><h2 class="h3">Поступило и закрыто по дням</h2>
          <div class="legend"><span><i class="u-bg-chart1"></i>поступило</span><span><i class="u-bg-chart2"></i>закрыто</span></div></div>
        <div class="card-body chart" id="daily">${dailyChart(s.daily)}</div>
      </section>

      <div class="grid-2">
        <section class="card"><div class="card-head"><h2 class="h3">По категориям</h2><span class="small muted">всего заявок</span></div>
          <div class="card-body">${hbars(s.by_category, {
            name: (c) => c.name,
            value: (c) => c.count,
            sub: (c) => `${c.count} всего, ${c.open} открыто`,
            iconOf: (c) => c.icon,
          })}</div></section>
        <section class="card"><div class="card-head"><h2 class="h3">По статусам</h2></div>
          <div class="card-body">${hbars(s.by_status, {
            name: (x) => x.label,
            value: (x) => x.count,
            colorClass: (x) => `st-c-${x.status}`,
            href: (x) => `#/tickets?status=${x.status}`,
          })}</div></section>
      </div>

      <div class="grid-2">
        <section class="card"><div class="card-head"><h2 class="h3">Помещения с наибольшим числом заявок</h2></div>
          <div class="card-body">${hbars(s.by_location, {
            name: (l) => l.title,
            value: (l) => l.count,
            sub: (l) => `${l.count} всего, ${l.open} открыто`,
            href: (l) => `#/tickets?status=&location=${l.id}`,
          })}</div></section>
        <section class="card"><div class="card-head"><h2 class="h3">Повторяющиеся проблемы</h2><span class="small muted">за 30 дней</span></div>
          <div class="card-body stack-sm">${
            s.repeated.length
              ? s.repeated
                  .map(
                    (r) => `<a class="u-plain-link notice notice-warn" href="#/tickets?status=&location=${r.location_id}">${icon("refresh")}
                      <div class="grow"><b>${esc(r.place)}</b><div class="small">${esc(r.category)}: ${r.count} ${plural(r.count, "заявка", "заявки", "заявок")}, последняя ${relTime(r.last)}</div></div></a>`,
                  )
                  .join("")
              : `<div class="small muted">Повторов нет. Если в одном помещении одна и та же проблема случится дважды за месяц, она появится здесь.</div>`
          }</div></section>
      </div>

      <section class="card"><div class="card-head"><h2 class="h3">Работа ИИ-помощника</h2>
          <span class="small muted">${ai.avg_latency_ms != null ? `среднее время ответа ${ai.avg_latency_ms} мс` : ""}</span></div>
        <div class="u-gap24 card-body grid-2">
          <div>${hbars(ai.by_kind, { name: (k) => k.label, value: (k) => k.count })}</div>
          <div class="stack-sm small">
            <div class="row between"><span class="muted">Обращений к помощнику</span><b>${ai.total}</b></div>
            <div class="row between"><span class="muted">Ответил без заявки</span><b>${ai.answered_only}</b></div>
            <div class="row between"><span class="muted">Передано сотрудникам (создана заявка)</span><b>${ai.to_ticket}</b></div>
            <hr class="sep">
            ${Object.entries(ai.engine)
              .map(([k, v]) => `<div class="row between"><span class="muted">${esc({ gigachat: "GigaChat", fallback: "Правила (демо)", rules: "База знаний и правила", safety: "Фильтр безопасности" }[k] || k)}</span><b>${v}</b></div>`)
              .join("")}
          </div>
        </div>
      </section>`;
    bindTooltip($("#daily"), s.daily);
    rise(el, ".kpi", { step: 55, delay: 60, dur: 850 });
    el.querySelectorAll(".kpi-value").forEach((n, i) => countUp(n, { delay: 160 + i * 55 }));
  }

  await load();
  return { destroy() { document.querySelectorAll(".chart-tip").forEach((t) => t.remove()); } };
}

