// Схема колледжа в блоке «Состояние колледжа»: здание в разрезе, три этажа, кабинеты по обе стороны коридора.
// Лестницы: по бокам на всех этажах, посередине с 1 на 2 этаж, на 1 этаже посередине вход.
// Состояние кабинета берётся из /api/campus: без заявок, есть заявка, срочная заявка.
// Наведение открывает дверь кабинета, нажатие открывает план этажа во весь экран (floor-view.js).

import { esc } from "./core.js";
import { REDUCED } from "./motion.js";

export const TYPES = {
  lecture: "Лекционный кабинет",
  computer: "Компьютерный кабинет",
  seminar: "Семинарский кабинет",
  canteen: "Столовая",
  gym: "Спортзал",
  hall: "Актовый зал",
  lobby: "Главный холл",
};

// Значки типов линиями, как остальные иконки проекта
export const TYPE_ICON = {
  lecture: '<rect x="4" y="4" width="16" height="10" rx="1"/><path d="M8 18h8M12 14v4"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  seminar: '<path d="M3 10h18M5 10v9M19 10v9"/><path d="M8 6h8"/>',
  canteen: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5"/><path d="M16 3c-1.7 0-3 2-3 5s1.3 4 3 4v9"/>',
  gym: '<path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12"/>',
  hall: '<path d="M3 4h18M5 4c0 5 2 8 4 9M19 4c0 5-2 8-4 9"/><path d="M4 20h16M7 20v-4h10v4"/>',
  lobby: '<path d="M4 20V9l8-5 8 5v11"/><path d="M10 20v-6h4v6"/>',
};

const R = (n, type = "seminar", w = 1) => ({ n: String(n), type, w });

/**
 * Этажи сверху вниз. Каждая часть этажа — два ряда кабинетов друг напротив друга через коридор (a и b).
 * center: что посередине этажа — "entrance" (вход и лестница на 2 этаж), "arrive" (сюда приходит лестница с 1 этажа) или нет.
 */
export const FLOORS = [
  {
    floor: 3,
    center: null,
    parts: [
      {
        a: [R(301, "lecture"), R(302), R(303), R(304), R(305), R(306), R(307, "lecture"), R(308)],
        b: [R(309), R(310), R(311), R(312), R(314), R(315), R(316), R(317, "computer")],
      },
    ],
  },
  {
    floor: 2,
    center: "arrive",
    parts: [
      { a: [R(201, "lecture"), R(202, "computer"), R(203), R(204)], b: [R(205), R(206), R(207, "lecture"), R(208)] },
      { a: [R(209), R(210), R(212), R(213)], b: [R(214, "computer"), R(215, "computer"), R(216), R(217)] },
    ],
  },
  {
    floor: 1,
    center: "entrance",
    parts: [
      { a: [R(102, "gym", 3), R(103)], b: [R(101, "canteen", 2), R(104), R(105)] },
      { a: [R(107), R(109, "lecture"), R(110, "hall", 2)], b: [R(108, "seminar", 2), R(106, "lecture", 2)] },
    ],
  },
];

export const LOBBY = { n: "холл", type: "lobby", w: 1 };

const RANK = { clear: 0, open: 1, urgent: 2 };
const HOVER = matchMedia("(hover: hover)").matches;
export const STATE_TEXT = { clear: "Открытых заявок нет", open: "Есть открытая заявка", urgent: "Есть срочная заявка" };

export function roomTitle(cell) {
  if (cell.type === "lobby") return "Главный холл";
  if (["canteen", "gym", "hall"].includes(cell.type)) return `${TYPES[cell.type]}, ${cell.n}`;
  return `Кабинет ${cell.n}`;
}

export function floorRooms(f) {
  const list = f.parts.flatMap((p) => [...p.a, ...p.b]);
  return f.center === "entrance" ? [...list, LOBBY] : list;
}

/** Помещение из /api/campus → ячейка схемы: «Кабинет 214» → 214, «Столовая» → 101, «Главный холл» → холл */
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

/** Состояние ячеек: если на ячейку пришлось несколько помещений, берётся самое тревожное */
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
  // ?plan=demo: все три состояния на схеме, только для просмотра оформления
  if (new URLSearchParams(location.search).get("plan") === "demo") {
    const demo = { 102: "open", 107: "open", 206: "open", 214: "open", 303: "open", 311: "open", холл: "open", 202: "urgent", 305: "urgent" };
    for (const [key, state] of Object.entries(demo)) map.set(key, { ...map.get(key), state });
  }
  return map;
}

export function stateOf(states, n) {
  return states.get(n) || { state: "clear" };
}

// ---------- геометрия схемы (единицы viewBox) ----------

const W = 480;
const X0 = 30; // левая стена здания
const X1 = 476; // правая стена
const SW = 44; // ширина боковой лестничной клетки
const CW = 52; // ширина средней лестничной клетки
const CX = (X0 + X1) / 2;
const TOP = 54; // верх 3 этажа, выше аттик с эмблемой
const FH = 96; // высота этажа
const G = TOP + 3 * FH; // земля
const H = G + 24;
const ROW = 38;

const floorTop = (n) => TOP + (3 - n) * FH;
const f1 = (n) => n.toFixed(1);

/** Марш лестницы в разрезе: ступени от (xa, ya) до (xb, yb), снизу косоур */
function flight(xa, ya, xb, yb, steps = 6, withRail = false) {
  const dx = (xb - xa) / steps;
  const dy = (yb - ya) / steps;
  let d = `M${f1(xa)} ${f1(ya)}`;
  for (let i = 0; i < steps; i++) d += `v${f1(dy)}h${f1(dx)}`;
  const under = `L${f1(xb)} ${f1(yb + 5)}L${f1(xa + dx * 0.4)} ${f1(ya + 1.5)}Z`;
  // перила идут параллельно маршу над ступенями
  const hr = `M${f1(xa + dx * 0.5)} ${f1(ya - 9)}L${f1(xb - dx * 0.5)} ${f1(yb - 9 + dy * 0.5)}M${f1(xa + dx * 0.5)} ${f1(ya - 9)}v${f1(9 + dy * 0)}M${f1(xb - dx * 0.5)} ${f1(yb - 9 + dy * 0.5)}v${f1(9 - dy * 0.5)}`;
  return `<path class="pf-steps" d="${d}${under}"/>${withRail ? `<path class="pf-handrail" d="${hr}"/>` : ""}`;
}

/** Средняя лестница прямо от входа: вид спереди, ступени уходят вглубь и сужаются */
function straightStair(yb, yt) {
  const steps = 9;
  const wb = 40; // ширина внизу
  const wt = 22; // ширина наверху
  let treads = "";
  let y = yb;
  // ступени ближе к входу крупнее, дальше мельче
  const total = (yb - yt);
  const weights = Array.from({ length: steps }, (_, i) => 1 - i * 0.07);
  const sum = weights.reduce((a, b) => a + b, 0);
  const at = (yy) => wb + (wt - wb) * ((yb - yy) / total);
  for (let i = 0; i < steps; i++) {
    const half = at(y) / 2;
    treads += `M${f1(CX - half)} ${f1(y)}H${f1(CX + half)}`;
    y -= (total * weights[i]) / sum;
  }
  const body = `M${f1(CX - wb / 2)} ${f1(yb)}L${f1(CX - wt / 2)} ${f1(yt)}H${f1(CX + wt / 2)}L${f1(CX + wb / 2)} ${f1(yb)}Z`;
  const rails = `M${f1(CX - wb / 2 - 3)} ${f1(yb - 8)}L${f1(CX - wt / 2 - 2)} ${f1(yt - 6)}M${f1(CX + wb / 2 + 3)} ${f1(yb - 8)}L${f1(CX + wt / 2 + 2)} ${f1(yt - 6)}`;
  return `<path class="pf-stair-front" d="${body}"/><path class="pf-treads" d="${treads}"/><path class="pf-handrail" d="${rails}"/>`;
}

/** Лестничная клетка на высоту одного этажа: два марша с промежуточной площадкой */
function stairFloor(a, b, yb, yt, mirror = false) {
  const ym = (yb + yt) / 2;
  const L = mirror ? b : a;
  const Rr = mirror ? a : b;
  const s = mirror ? -1 : 1;
  return `${flight(L + 6 * s, yb, Rr - 6 * s, ym)}
    <path class="pf-landing" d="M${f1(Rr - 7 * s)} ${f1(ym)}H${f1(Rr)}"/>
    ${flight(Rr - 6 * s, ym, L + 6 * s, yt)}
    <path class="pf-landing" d="M${f1(L)} ${f1(yt)}H${f1(L + 7 * s)}"/>`;
}

/** Эмблема университета контуром: кольцо с надписью, внутри здание с фронтоном и колоннами */
function emblem(cx, cy, r) {
  const k = r / 13;
  const p = (x, y) => `${f1(cx + x * k)} ${f1(cy + y * k)}`;
  const cols = [-4.2, -1.4, 1.4, 4.2].map((x) => `M${p(x, -0.6)}V${f1(cy + 3.6 * k)}`).join("");
  return `<g class="pf-emblem" aria-hidden="true">
    <circle class="pf-emblem-disc" cx="${cx}" cy="${cy}" r="${r}"/>
    <circle class="pf-emblem-ring" cx="${cx}" cy="${cy}" r="${f1(r * 0.74)}"/>
    <circle class="pf-emblem-text" cx="${cx}" cy="${cy}" r="${f1(r * 0.87)}"/>
    <path class="pf-emblem-line" d="M${p(-6, -1.2)}L${p(0, -5.4)}L${p(6, -1.2)}ZM${p(-6.4, -0.6)}H${f1(cx + 6.4 * k)}${cols}M${p(-6, 3.9)}H${f1(cx + 6 * k)}M${p(-7, 5.4)}H${f1(cx + 7 * k)}"/>
  </g>`;
}

function rail(a, b, y) {
  const posts = [];
  for (let x = a + 4; x <= b - 3; x += 6) posts.push(`M${f1(x)} ${f1(y)}v8`);
  return `<path class="pf-rail" d="M${f1(a + 2)} ${f1(y)}H${f1(b - 2)}${posts.join("")}"/>`;
}

function roomSvg(cell, x, w, y, states, here) {
  const info = stateOf(states, cell.n);
  const dw = cell.w > 1 ? Math.min(28, w * 0.42) : Math.min(16, w * 0.46);
  const dh = 21;
  const cx = x + w / 2;
  const dx = cx - dw / 2;
  const dy = y + ROW - dh - 1;
  const isHere = here != null && info.id === here;
  return `<g class="pf-room is-${esc(info.state)}${isHere ? " is-here" : ""}" data-n="${esc(cell.n)}">
    <rect class="pf-hit" x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${ROW}" rx="4"/>
    <text class="pf-num" x="${f1(cx)}" y="${f1(y + 9)}">${esc(cell.n)}</text>
    <rect class="pf-inside" x="${f1(dx)}" y="${f1(dy)}" width="${f1(dw)}" height="${dh}" fill="url(#pfg-${esc(info.state)})"/>
    <svg class="pf-icon" x="${f1(cx - 5.5)}" y="${f1(dy + dh / 2 - 5.5)}" width="11" height="11" viewBox="0 0 24 24">${TYPE_ICON[cell.type]}</svg>
    <rect class="pf-door" x="${f1(dx)}" y="${f1(dy)}" width="${f1(dw)}" height="${dh}"/>
    <rect class="pf-lamp" x="${f1(cx - 2.5)}" y="${f1(dy - 4)}" width="5" height="1.8" rx="0.9"/>
    <path class="pf-sill" d="M${f1(dx - 1.5)} ${f1(y + ROW - 0.5)}H${f1(dx + dw + 1.5)}"/>
  </g>`;
}

function rowSvg(cells, x0, x1, y, states, here) {
  const units = cells.reduce((s, c) => s + c.w, 0);
  const gap = 3;
  const unit = (x1 - x0 - gap * (units - 1)) / units;
  let x = x0;
  return cells
    .map((c) => {
      const w = unit * c.w + gap * (c.w - 1);
      const svg = roomSvg(c, x, w, y, states, here);
      x += w + gap;
      return svg;
    })
    .join("");
}

function partRanges(f) {
  const a = X0 + SW + 4;
  const b = X1 - SW - 4;
  if (!f.center) return [[a, b]];
  return [
    [a, CX - CW / 2 - 4],
    [CX + CW / 2 + 4, b],
  ];
}

/** Разметка схемы. states — из planStates(), here — id помещения, выбранного заявителем. */
export function planHtml(states, { here = null, enter = false } = {}) {
  const floors = FLOORS.map((f) => {
    const y0 = floorTop(f.floor);
    const ranges = partRanges(f);
    const open = floorRooms(f).filter((c) => stateOf(states, c.n).state !== "clear").length;
    const rooms = f.parts
      .map((p, i) => {
        const [xa, xb] = ranges[i];
        return `${rowSvg(p.a, xa, xb, y0 + 6, states, here)}
          ${rowSvg(p.b, xa, xb, y0 + 52, states, here)}`;
      })
      .join("");
    let center = "";
    if (f.center === "entrance") {
      const lobby = stateOf(states, LOBBY.n);
      const isHere = here != null && lobby.id === here;
      center = `${straightStair(G - 31, y0 + 2)}
        <g class="pf-room pf-lobby is-${esc(lobby.state)}${isHere ? " is-here" : ""}" data-n="${LOBBY.n}">
          <rect class="pf-hit" x="${f1(CX - CW / 2 + 2)}" y="${f1(G - 32)}" width="${CW - 4}" height="32" rx="4"/>
          <rect class="pf-inside" x="${f1(CX - 11)}" y="${f1(G - 25)}" width="22" height="25" fill="url(#pfg-${esc(lobby.state)})"/>
          <rect class="pf-door pf-door-l" x="${f1(CX - 11)}" y="${f1(G - 25)}" width="11" height="25"/>
          <rect class="pf-door pf-door-r" x="${f1(CX)}" y="${f1(G - 25)}" width="11" height="25"/>
          <rect class="pf-lamp" x="${f1(CX - 3)}" y="${f1(G - 29.5)}" width="6" height="1.8" rx="0.9"/>
        </g>`;
    } else if (f.center === "arrive") {
      center = rail(CX - CW / 2, CX + CW / 2, y0 + FH - 14);
    }
    const label = `${f.floor} этаж: ${open ? `помещений с заявками ${open}` : "заявок нет"}. Открыть план этажа`;
    return `<g class="pf-floor" data-floor="${f.floor}" tabindex="0" role="button" aria-label="${esc(label)}">
      <rect class="pf-floor-bg" x="${X0 + 1}" y="${f1(y0 + 1)}" width="${X1 - X0 - 2}" height="${FH - 2}" rx="3"/>
      <text class="pf-label" x="0" y="${f1(y0 + FH / 2 + 3)}">${f.floor} эт</text>
      ${rooms}${center}
    </g>`;
  }).join("");

  // боковые лестничные клетки: марши с 1 на 2 и со 2 на 3 этаж
  const sideStairs = [1, 2]
    .map((n) => `${stairFloor(X0, X0 + SW, floorTop(n) + FH, floorTop(n))}${stairFloor(X1 - SW, X1, floorTop(n) + FH, floorTop(n), true)}`)
    .join("");
  const facade = `
    <path class="pf-attic" d="M${CX - 72} ${TOP - 4}L${CX - 50} ${TOP - 36}H${CX + 50}L${CX + 72} ${TOP - 4}Z"/>
    <path class="pf-cornice" d="M${CX - 55} ${TOP - 36}H${CX + 55}"/>
    ${emblem(CX, TOP - 19, 10.5)}
    <rect class="pf-body" x="${X0}" y="${TOP}" width="${X1 - X0}" height="${G - TOP}" rx="5"/>
    <rect class="pf-well" x="${X0 + 3}" y="${floorTop(2) + 3}" width="${SW - 5}" height="${2 * FH - 6}" rx="4"/>
    <rect class="pf-well" x="${X1 - SW + 2}" y="${floorTop(2) + 3}" width="${SW - 5}" height="${2 * FH - 6}" rx="4"/>
    <rect class="pf-well" x="${CX - CW / 2 + 3}" y="${floorTop(1) + 3}" width="${CW - 6}" height="${FH - 6}" rx="4"/>
    <path class="pf-cornice" d="M${X0 - 6} ${TOP - 2}H${X1 + 6}"/>
    <path class="pf-slab" d="M${X0 + 4} ${floorTop(2)}H${X1 - 4}M${X0 + 4} ${floorTop(1)}H${f1(CX - 15)}M${f1(CX + 15)} ${floorTop(1)}H${X1 - 4}"/>
    <path class="pf-ground" d="M2 ${G}H${W - 2}M${CX - 20} ${G + 4}H${CX + 20}"/>
    <text class="pf-entry" x="${CX}" y="${G + 18}">Вход</text>`;

  const grad = (s) => `<radialGradient id="pfg-${s}" class="pfg-${s}" cx="50%" cy="100%" r="110%"><stop offset="0"/><stop offset="1"/></radialGradient>`;
  return `<div class="plan${enter && !REDUCED ? " is-enter" : ""}">
    <svg class="pf" viewBox="0 0 ${W} ${H}" role="group" aria-label="Схема колледжа: 3 этажа">
      <defs>${grad("clear")}${grad("open")}${grad("urgent")}</defs>
      ${facade}
      <g class="pf-stairs" aria-hidden="true">${sideStairs}</g>
      ${floors}
    </svg>
  </div>
  <div class="pl-info" aria-live="polite"><span class="pl-hint">${HOVER ? "Наведите на кабинет, нажмите на этаж, чтобы открыть его план" : "Нажмите на этаж, чтобы открыть его план"}</span></div>`;
}

/**
 * Двери открываются при наведении, под схемой строка о кабинете.
 * onOpenFloor(floor, n): открыть план этажа, n — кабинет, на который нажали (может быть null).
 */
export function bindPlan(root, states, { onOpenFloor } = {}) {
  const svg = root.querySelector(".pf");
  const info = root.querySelector(".pl-info");
  if (!svg || !info) return;
  const cells = new Map(FLOORS.flatMap((f) => floorRooms(f).map((c) => [c.n, c])));

  const describe = (n) => {
    const cell = cells.get(n);
    const data = stateOf(states, n);
    info.innerHTML = `
      <div class="pl-info-text">
        <b>${esc(roomTitle(cell))}</b>
        <div class="pl-info-type">${esc(TYPES[cell.type])}</div>
        <div class="pl-info-state is-${esc(data.state)}"><i></i>${esc(STATE_TEXT[data.state])}${data.chronic ? ", проблемы повторяются" : ""}</div>
      </div>`;
  };
  const describeFloor = (n) => {
    const f = FLOORS.find((x) => x.floor === n);
    const rooms = floorRooms(f);
    const open = rooms.filter((c) => stateOf(states, c.n).state !== "clear").length;
    info.innerHTML = `
      <div class="pl-info-text">
        <b>${n} этаж</b>
        <div class="pl-info-type">${open ? `Помещений с заявками: ${open}` : "Заявок нет"}</div>
        <div class="pl-info-state is-open"><i></i>Нажмите, чтобы открыть план этажа</div>
      </div>`;
  };
  const light = (floorEl) => {
    svg.classList.toggle("has-hot", !!floorEl);
    svg.querySelectorAll(".pf-floor").forEach((f) => f.classList.toggle("is-hot", f === floorEl));
  };

  svg.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const room = e.target.closest(".pf-room");
    const floor = e.target.closest(".pf-floor");
    light(floor);
    if (room) describe(room.dataset.n);
    else if (floor) describeFloor(Number(floor.dataset.floor));
  });
  svg.addEventListener("pointerleave", () => light(null));
  svg.addEventListener("click", (e) => {
    const floor = e.target.closest(".pf-floor");
    if (!floor) return;
    onOpenFloor?.(Number(floor.dataset.floor), e.target.closest(".pf-room")?.dataset.n ?? null);
  });
  svg.addEventListener("keydown", (e) => {
    const floor = e.target.closest(".pf-floor");
    if (floor && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onOpenFloor?.(Number(floor.dataset.floor), null);
    }
  });
  svg.addEventListener("focusin", (e) => light(e.target.closest(".pf-floor")));
  svg.addEventListener("focusout", () => light(null));
}
