// План этажей колледжа: три этажа, кабинеты как двери, лестницы слева и справа.
// Состояние кабинета берётся из /api/campus: без заявок, есть заявка, срочная заявка.
// При наведении, фокусе или касании дверь открывается, внизу показывается, что это за кабинет.

import { esc } from "./core.js";
import { REDUCED } from "./motion.js";

const TYPES = {
  lecture: "Лекционный кабинет",
  computer: "Компьютерный кабинет",
  seminar: "Семинарский кабинет",
  canteen: "Столовая",
  gym: "Спортзал",
  hall: "Актовый зал",
  lobby: "Холл",
};

// Значки типов, видны за открытой дверью. Рисуются линиями, как остальные иконки проекта.
const TYPE_ICON = {
  lecture: '<rect x="4" y="4" width="16" height="10" rx="1"/><path d="M8 18h8M12 14v4"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  seminar: '<path d="M3 10h18M5 10v9M19 10v9"/><path d="M8 6h8"/>',
  canteen: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5"/><path d="M16 3c-1.7 0-3 2-3 5s1.3 4 3 4v9"/>',
  gym: '<path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12"/>',
  hall: '<path d="M3 4h18M5 4c0 5 2 8 4 9M19 4c0 5-2 8-4 9"/><path d="M4 20h16M7 20v-4h10v4"/>',
  lobby: '<path d="M4 20V9l8-5 8 5v11"/><path d="M10 20v-6h4v6"/>',
};

// Колледж: номер, тип, ширина в ячейках. Каждый этаж — два ряда по 8 ячеек вдоль коридора.
const L = (n, type = "seminar", w = 1) => ({ n: String(n), type, w });
export const FLOORS = [
  {
    floor: 3,
    rows: [
      [L(301, "lecture"), L(302), L(303), L(304), L(305), L(306), L(307, "lecture"), L(308)],
      [L(309), L(310), L(311), L(312), L(314), L(315), L(316), L(317, "computer")],
    ],
  },
  {
    floor: 2,
    rows: [
      [L(201, "lecture"), L(202, "computer"), L(203), L(204), L(205), L(206), L(207, "lecture"), L(208)],
      [L(209), L(210), L(212), L(213), L(214, "computer"), L(215, "computer"), L(216), L(217)],
    ],
  },
  {
    floor: 1,
    rows: [
      [L(101, "canteen", 2), L(102, "gym", 2), L(103), L(104), L(105), L(106, "lecture")],
      [L(107), L(108), L(109, "lecture"), { n: "холл", type: "lobby", w: 3 }, L(110, "hall", 2)],
    ],
  },
];

const RANK = { clear: 0, open: 1, urgent: 2 };
const STATE_TEXT = { clear: "Открытых заявок нет", open: "Есть открытая заявка", urgent: "Есть срочная заявка" };

/** Помещение из /api/campus → номер ячейки на плане: «Кабинет 214» → 214, «Столовая» → 101 */
function cellKey(title) {
  const t = String(title).toLowerCase();
  const m = t.match(/кабинет\s+(\d+)/);
  if (m) return m[1];
  if (t.includes("столов")) return "101";
  if (t.includes("спортзал") || t.includes("спортивный")) return "102";
  if (t.includes("актов")) return "110";
  if (t.includes("холл")) return "холл";
  return null;
}

/** Собирает состояние ячеек: если на ячейку пришлось несколько помещений, берётся самое тревожное */
export function planStates(campus) {
  const map = new Map();
  for (const b of campus?.buildings || []) {
    for (const r of b.rooms || []) {
      const key = cellKey(r.title);
      if (!key) continue;
      const prev = map.get(key);
      if (!prev || RANK[r.state] > RANK[prev.state]) map.set(key, { state: r.state, id: r.id, chronic: r.chronic || prev?.chronic });
      else if (r.chronic) prev.chronic = true;
    }
  }
  // ?plan=demo: показать все три состояния на плане, только для просмотра оформления
  if (new URLSearchParams(location.search).get("plan") === "demo") {
    const demo = { 102: "open", 107: "open", 206: "open", 214: "open", 303: "open", 311: "open", холл: "open", 202: "urgent", 305: "urgent" };
    for (const [key, state] of Object.entries(demo)) map.set(key, { ...map.get(key), state });
  }
  return map;
}

function title(cell) {
  if (cell.type === "lobby") return "Главный холл";
  if (["canteen", "gym", "hall"].includes(cell.type)) return `${TYPES[cell.type]}, ${cell.n}`;
  return `Кабинет ${cell.n}`;
}

function stairsSvg(side) {
  // три площадки на уровнях этажей и марши между ними; растягивается по высоте плана
  const flights = [];
  const levels = [1 / 6, 3 / 6, 5 / 6].map((y) => y * 300);
  for (let i = 0; i < 2; i++) {
    const y0 = levels[i];
    const y1 = levels[i + 1];
    const steps = 7;
    let d = `M${side === "left" ? 14 : 0} ${y0}`;
    for (let s = 1; s <= steps; s++) {
      const x = side === "left" ? 14 - (14 * s) / steps : (14 * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      d += `V${y.toFixed(1)}H${x.toFixed(1)}`;
    }
    flights.push(`<path class="pl-flight" vector-effect="non-scaling-stroke" d="${d}"/>`);
  }
  const landings = levels.map((y) => `<path class="pl-landing" vector-effect="non-scaling-stroke" d="M0 ${y}H14"/>`).join("");
  return `<svg class="pl-stairs pl-stairs-${side}" viewBox="0 0 14 300" preserveAspectRatio="none" aria-hidden="true">
    <path class="pl-rail" vector-effect="non-scaling-stroke" d="M${side === "left" ? 0.5 : 13.5} 18V282"/>${flights.join("")}${landings}</svg>`;
}

/**
 * Разметка плана. states: Map из planStates(); here: id помещения, выбранного заявителем.
 */
export function planHtml(states, { here = null, enter = false } = {}) {
  let i = 0;
  const floors = FLOORS.map((f) => {
    const rows = f.rows
      .map(
        (row) => `<div class="pl-row">${row
          .map((cell) => {
            const info = states.get(cell.n) || { state: "clear" };
            const isHere = here != null && info.id === here;
            const name = title(cell);
            const label = `${name}, ${TYPES[cell.type].toLowerCase()}: ${STATE_TEXT[info.state].toLowerCase()}`;
            return `<button type="button" class="pl-room is-${esc(info.state)} w${cell.w}${isHere ? " is-here" : ""}" data-n="${esc(cell.n)}" data-i="${i++}" aria-label="${esc(label)}">
              <span class="pl-num">${cell.type === "lobby" ? "холл" : esc(cell.n)}</span>
              <span class="pl-frame">
                <span class="pl-inside"><svg viewBox="0 0 24 24" aria-hidden="true">${TYPE_ICON[cell.type]}</svg></span>
                <span class="pl-door"><i class="pl-handle"></i></span>
                <i class="pl-lamp"></i>
              </span>
            </button>`;
          })
          .join("")}</div>`,
      )
      .join(`<div class="pl-corridor" aria-hidden="true"></div>`);
    return `<div class="pl-floor" data-floor="${f.floor}">
      <div class="pl-label" aria-hidden="true">${f.floor}&nbsp;эт</div>
      <div class="pl-slab" role="group" aria-label="${f.floor} этаж">${rows}</div>
    </div>`;
  }).join("");
  return `<div class="plan${enter && !REDUCED ? " is-enter" : ""}">
    ${stairsSvg("left")}${floors}${stairsSvg("right")}
  </div>
  <div class="pl-info" aria-live="polite"><span class="pl-hint">Наведите на кабинет или нажмите на него</span></div>`;
}

/**
 * Открывание дверей и строка с описанием кабинета.
 * onPick(id): заявитель выбрал помещение, id из /api/campus; кнопка появляется, только если помещение есть в системе.
 */
export function bindPlan(root, states, { onPick, here = null } = {}) {
  const plan = root.querySelector(".plan");
  const info = root.querySelector(".pl-info");
  if (!plan || !info) return;
  const cells = new Map(FLOORS.flatMap((f) => f.rows.flat()).map((c) => [c.n, c]));
  // задержка появления дверей при первом показе
  plan.querySelectorAll(".pl-room").forEach((b) => b.style.setProperty("--i", b.dataset.i));
  let pinned = null;

  const describe = (btn) => {
    const cell = cells.get(btn.dataset.n);
    const data = states.get(btn.dataset.n) || { state: "clear" };
    const canPick = onPick && data.id != null && data.id !== here;
    info.innerHTML = `
      <div class="pl-info-text">
        <b>${esc(title(cell))}</b>
        <div class="pl-info-type">${esc(TYPES[cell.type])}</div>
        <div class="pl-info-state is-${esc(data.state)}"><i></i>${esc(STATE_TEXT[data.state])}${data.chronic ? ", проблемы повторяются" : ""}</div>
      </div>
      ${canPick ? `<button type="button" class="btn btn-sm pl-pick">Это здесь</button>` : ""}`;
    info.querySelector(".pl-pick")?.addEventListener("click", () => onPick(data.id));
  };
  const open = (btn) => {
    plan.querySelectorAll(".pl-room.is-open-door").forEach((b) => b !== btn && b.classList.remove("is-open-door"));
    btn.classList.add("is-open-door");
    plan.classList.add("has-open");
    plan.querySelectorAll(".pl-floor").forEach((f) => f.classList.toggle("is-hot", f.contains(btn)));
    describe(btn);
  };
  const closeAll = () => {
    plan.querySelectorAll(".pl-room.is-open-door").forEach((b) => b.classList.remove("is-open-door"));
    plan.classList.remove("has-open");
    plan.querySelectorAll(".pl-floor.is-hot").forEach((f) => f.classList.remove("is-hot"));
  };

  plan.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || pinned) return;
    const btn = e.target.closest(".pl-room");
    if (btn) open(btn);
  });
  plan.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !pinned) closeAll();
  });
  // касание или клик закрепляет открытую дверь, повторное нажатие закрывает
  plan.addEventListener("click", (e) => {
    const btn = e.target.closest(".pl-room");
    if (!btn) {
      pinned = null;
      closeAll();
      return;
    }
    if (pinned === btn) {
      pinned = null;
      closeAll();
      return;
    }
    pinned = btn;
    open(btn);
  });
  plan.addEventListener("focusin", (e) => {
    const btn = e.target.closest(".pl-room");
    if (btn) open(btn);
  });
  plan.addEventListener("focusout", (e) => {
    if (!plan.contains(e.relatedTarget) && !pinned) closeAll();
  });
  plan.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      pinned = null;
      closeAll();
    }
  });
}
