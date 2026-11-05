import { api, esc, icon, plural, toast } from "../core.js";
import { nodeGlyph, spark } from "../campus.js";
import { countUp, rise } from "../motion.js";
import { bindPlan, planHtml, planStates, stateOf } from "../plan.js";

// Карта помещений: план здания с состоянием каждого помещения.

function toRoom(l) {
  return {
    id: l.id,
    title: l.title,
    floor: l.floor,
    state: l.critical ? "urgent" : l.open ? "open" : "clear",
    chronic: l.month >= 3,
    open: l.open,
    month: l.month,
  };
}

export async function render({ el, setHead }) {
  const data = await api("/api/staff/map");
  let current = data[0]?.building;
  let first = true;

  const draw = () => {
    setHead(
      data.length > 1
        ? `<div class="segmented">${data
            .map((b) => `<button aria-pressed="${b.building === current}" data-b="${esc(b.building)}">${esc(b.building)}</button>`)
            .join("")}</div>`
        : "",
    );
    document.querySelectorAll("[data-b]").forEach((b) =>
      b.addEventListener("click", () => {
        current = b.dataset.b;
        draw();
      }),
    );

    const building = data.find((b) => b.building === current);
    if (!building) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">${icon("map", "icon-lg")}</div>Помещения ещё не добавлены</div>`;
      return;
    }
    const rooms = building.floors.flatMap((f) => f.locations.map((l) => toRoom({ ...l, floor: f.floor })));
    const totalOpen = rooms.reduce((a, s) => a + s.open, 0);
    const clear = rooms.filter((s) => s.state === "clear").length;
    const index = rooms.length ? Math.round((clear / rooms.length) * 100) : 100;
    const label = index >= 90 ? "Всё работает" : index >= 70 ? "Идёт работа" : "Повышенная нагрузка";
    const attention = rooms
      .filter((s) => s.open || s.chronic)
      .sort((a, b) => (b.state === "urgent") - (a.state === "urgent") || b.open - a.open || b.month - a.month);

    const states = planStates({ buildings: [{ rooms }] });

    el.innerHTML = `
      <section class="card campus-card campus-panel enter stack">
        <div class="u-wrap u-gap14 row between">
          <div class="stack-sm">
            <div class="eyebrow">${spark()} Состояние · ${esc(current)}</div>
            <div class="campus-kpi"><span class="campus-state">${label}</span>
              <span class="campus-index"><b data-count>${clear}</b> из ${rooms.length} помещений без заявок · ${totalOpen} ${plural(totalOpen, "открытая заявка", "открытые заявки", "открытых заявок")}</span></div>
          </div>
          <div class="campus-legend">
            <span><i class="dot"></i>без заявок</span>
            <span><i class="dot open"></i>есть заявка</span>
            <span><i class="dot urgent"></i>критичная</span>
          </div>
        </div>
        <div class="campus-meter" aria-hidden="true"><i data-css-pct="${index}"></i></div>
        <div id="floors">${planHtml(states, { enter: first })}</div>
        <div class="small muted">Нажмите на помещение, чтобы открыть его заявки, или на этаж, чтобы посмотреть его план.</div>
      </section>
      ${
        attention.length
          ? `<section class="card card-pad stack" id="attention">
              <h2 class="h3">Требуют внимания</h2>
              <div class="stack-sm">${attention
                .map(
                  (s) => `<button type="button" class="node-row" data-id="${s.id}">
                    ${nodeGlyph(s.state)}
                    <span class="grow"><b>${esc(s.title)}</b><span class="tiny muted">${s.floor ?? "-"} этаж · ${s.open} ${plural(s.open, "открытая", "открытые", "открытых")} · ${s.month} за 30 дней${s.chronic ? " · проблемы повторяются" : ""}</span></span>
                    ${icon("chevronRight")}
                  </button>`,
                )
                .join("")}</div>
            </section>`
          : `<div class="notice notice-ok">${icon("check")}<div>В этом корпусе нет открытых заявок.</div></div>`
      }`;
    el.querySelectorAll("[data-count]").forEach((n) => countUp(n, { delay: 300 }));
    if (!first) {
      rise(el, ":scope > *", { step: 80, dur: 800 });
    } else {
      rise(el, "#attention .node-row", { step: 45, delay: 420, dur: 800 });
    }
    first = false;
    const open = (id) => (location.hash = `#/tickets?status=&location=${id}`);
    el.querySelectorAll(".node-row[data-id]").forEach((node) => node.addEventListener("click", () => open(node.dataset.id)));
    bindPlan(el, states, {
      onOpenFloor: (floor, n) => {
        const id = n ? stateOf(states, n).id : null;
        if (id != null) {
          open(id);
          return;
        }
        import("../floor-view.js")
          .then(({ openFloor }) => openFloor(floor, { states, room: n, onPick: open, pickLabel: "Открыть заявки" }))
          .catch(() => toast("Не удалось открыть план этажа. Проверьте интернет и попробуйте ещё раз.", "error"));
      },
    });
  };
  draw();
}
