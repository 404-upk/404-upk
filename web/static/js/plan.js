// Схема колледжа в блоке «Состояние колледжа»: здание в разрезе, три этажа, кабинеты по обе стороны коридора.
// Лестницы: по бокам двухмаршевые на всех этажах, посередине прямая с 1 на 2 этаж, на 1 этаже посередине вход.
// Боковая лестница в разрезе: этажная площадка у двери в коридор, промежуточная у наружной стены.
// Состояние кабинета берётся из /api/campus: без заявок, есть заявка, срочная заявка.
// Наведение открывает дверь кабинета, нажатие открывает план этажа во весь экран (floor-view.js).
// Оформление в цветах знака 404: васильковые линии, узор из звёзд над крышей, свет ламп над дверями,
// при первом показе контур здания прорисовывается, а в кабинетах по очереди «включается свет».

import { esc } from "./core.js";
import { SPARK_PATH } from "./cursor.js";
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
      // на телефоне ряды этой части меняются местами: столовая слева, спортзал справа
      { a: [R(102, "gym", 3), R(103)], b: [R(101, "canteen", 2), R(104), R(105)], mobileSwap: true },
      { a: [R(107), R(109, "lecture"), R(110, "hall", 2)], b: [R(108, "seminar", 2), R(106, "lecture", 2)] },
    ],
  },
];

export const LOBBY = { n: "холл", type: "lobby", w: 1 };

const RANK = { clear: 0, open: 1, urgent: 2 };
// мышь или касание проверяется каждый раз: режим может смениться без перезагрузки (DevTools, планшет с мышью)
const HOVER_MQ = matchMedia("(hover: hover)");
const canHover = () => HOVER_MQ.matches;
const hintText = () => (canHover() ? "Наведите на кабинет, нажмите на этаж, чтобы открыть его план" : "Нажмите на этаж, чтобы открыть его план");
export const STATE_TEXT = { clear: "Открытых заявок нет", open: "Есть открытая заявка", urgent: "Есть срочная заявка" };

/**
 * Название и подпись кабинета без повтора: у обычного кабинета номер и тип,
 * у столовой, спортзала и актового зала название и номер, у холла — что это вход.
 */
export function roomNames(cell) {
  if (cell.type === "lobby") return { title: "Главный холл", sub: "Вход в колледж" };
  if (["canteen", "gym", "hall"].includes(cell.type)) return { title: TYPES[cell.type], sub: `Кабинет ${cell.n}` };
  return { title: `Кабинет ${cell.n}`, sub: TYPES[cell.type] };
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
const IN_L = X0 + SW; // внутренние стены боковых лестничных клеток
const IN_R = X1 - SW;

const STEPS = 7; // ступеней в одном марше
const LAND_FLOOR = 10; // этажная площадка, у двери в коридор
const LAND_MID = 9; // промежуточная площадка, у наружной стены
const SLAB = 3; // толщина площадки
const THICK = 5; // толщина марша по вертикали
const RAIL_H = 9; // высота перил над ступенями
const DOOR_H = 22; // высота двери из лестничной клетки в коридор
const OPENING = 13; // половина проёма средней лестницы в перекрытии

const floorTop = (n) => TOP + (3 - n) * FH;
const f1 = (n) => n.toFixed(1);
const ROW_A = 7; // отступ дальнего ряда кабинетов от потолка этажа

/**
 * Марш в разрезе от (xa, ya) вверх до (xb, yb) вместе с верхней площадкой, которая идёт до стены wall.
 * Низ марша параллелен ступеням и упирается в перекрытие, поэтому ничего не торчит под пол.
 */
function flight(xa, ya, xb, yb, wall, far = false) {
  const dx = (xb - xa) / STEPS;
  const dy = (yb - ya) / STEPS;
  const rise = ya - yb;
  const at = (s) => xa + (xb - xa) * s;
  let d = `M${f1(xa)} ${f1(ya)}`;
  for (let i = 0; i < STEPS; i++) d += `v${f1(dy)}h${f1(dx)}`;
  d += `H${f1(wall)}V${f1(yb + SLAB)}H${f1(at(1 + (THICK - SLAB) / rise))}L${f1(at(THICK / rise))} ${f1(ya)}Z`;
  const rail = `M${f1(xa)} ${f1(ya)}V${f1(ya - RAIL_H)}L${f1(xb)} ${f1(yb - RAIL_H)}V${f1(yb)}`;
  return `<g class="pf-flight${far ? " is-far" : ""}"><path class="pf-steps" d="${d}"/><path class="pf-handrail" d="${rail}"/></g>`;
}

/** Боковая лестничная клетка: марши с этажа на этаж. mirror — правая сторона здания */
function sideStair(mirror) {
  const sx = (x) => (mirror ? X0 + X1 - x : x);
  const outer = X0;
  const inner = IN_L;
  const xFloor = inner - LAND_FLOOR;
  const xMid = outer + LAND_MID;
  let out = "";
  // сверху вниз: дальний марш рисуется раньше ближнего, на верхнем этаже только ограждение
  for (const n of [2, 1]) {
    const y = floorTop(n) + FH;
    const ym = y - FH / 2;
    const yt = y - FH;
    out += flight(sx(xMid), ym, sx(xFloor), yt, sx(inner), true);
    out += flight(sx(xFloor), y, sx(xMid), ym, sx(outer));
  }
  // на верхнем этаже лестница заканчивается: над проёмом ограждение
  const top = floorTop(3) + FH;
  out += rail(Math.min(sx(outer + 1), sx(xFloor)), Math.max(sx(outer + 1), sx(xFloor)), top - RAIL_H, RAIL_H, 3.6);
  // внутренняя стена с дверью в коридор на каждом этаже
  const wall = sx(inner);
  let d = `M${f1(wall)} ${TOP}`;
  for (const n of [3, 2, 1]) {
    const y = floorTop(n) + FH;
    d += `V${f1(y - DOOR_H)}M${f1(wall)} ${f1(y)}`;
  }
  const lintels = [3, 2, 1]
    .map((n) => {
      const y = floorTop(n) + FH - DOOR_H;
      return `M${f1(wall - 2.5)} ${f1(y)}H${f1(wall + 2.5)}`;
    })
    .join("");
  return `${out}<path class="pf-stairwall" d="${d}"/><path class="pf-stairwall" d="${lintels}"/>`;
}

/** Средняя лестница прямо от входа: вид спереди, ступени уходят вглубь и сужаются, вверху проём в перекрытии */
function straightStair(yb, yt) {
  const steps = 10;
  const wb = 44; // ширина внизу
  const wt = 2 * (OPENING - 1); // ширина наверху
  const total = yb - yt;
  // ступени ближе к входу крупнее, дальше мельче
  const weights = Array.from({ length: steps }, (_, i) => 1 - i * 0.06);
  const sum = weights.reduce((a, b) => a + b, 0);
  const at = (yy) => wb + (wt - wb) * ((yb - yy) / total);
  let treads = "";
  let y = yb;
  for (let i = 0; i < steps; i++) {
    y -= (total * weights[i]) / sum;
    const half = at(y) / 2;
    if (i < steps - 1) treads += `M${f1(CX - half)} ${f1(y)}H${f1(CX + half)}`;
  }
  const body = `M${f1(CX - wb / 2)} ${f1(yb)}L${f1(CX - wt / 2)} ${f1(yt)}H${f1(CX + wt / 2)}L${f1(CX + wb / 2)} ${f1(yb)}Z`;
  // перила: столбик внизу, поручень вдоль марша, столбик у перекрытия
  const side = (s) =>
    `M${f1(CX + s * (wb / 2 + 1))} ${f1(yb)}V${f1(yb - RAIL_H)}L${f1(CX + s * OPENING)} ${f1(yt - RAIL_H + 1)}V${f1(yt)}`;
  return `<path class="pf-stair-front" d="${body}"/><path class="pf-treads" d="${treads}"/>
    <path class="pf-stair-base" d="M${f1(CX - wb / 2 - 3)} ${f1(yb)}H${f1(CX + wb / 2 + 3)}"/>
    <path class="pf-handrail" d="${side(-1)}${side(1)}"/>`;
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

/** Ограждение: поручень на высоте y, стойки до пола через равные промежутки, крайние всегда есть */
function rail(a, b, y, h = 8, step = 3.4) {
  const count = Math.max(1, Math.round((b - a) / step));
  const posts = [];
  for (let i = 0; i <= count; i++) posts.push(`M${f1(a + ((b - a) * i) / count)} ${f1(y)}v${h}`);
  return `<path class="pf-rail" d="M${f1(a)} ${f1(y)}H${f1(b)}${posts.join("")}"/>`;
}

/**
 * Лампа над дверью и её свет: ореол, у срочной заявки ещё и расходящееся кольцо.
 * У кабинета без заявок лампа погашена и света нет. (cx, cy) — центр лампы, lw — её ширина.
 */
function lampLight(state, cx, cy, rx, lw = 5) {
  const lit = state === "clear" ? "" : `<ellipse class="pf-glow" cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="7" fill="url(#pfg-lamp-${esc(state)})"/>`;
  const ring = state === "urgent" ? `<circle class="pf-ripple" cx="${f1(cx)}" cy="${f1(cy)}" r="2.6"/>` : "";
  return `<g class="pf-light">${lit}${ring}<rect class="pf-lamp" x="${f1(cx - lw / 2)}" y="${f1(cy - 0.9)}" width="${lw}" height="1.8" rx="0.9"/></g>`;
}

/** Порядок появления кабинета при первом показе: слева направо по этажу */
const order = (x) => Math.max(0, Math.round((x - X0) / 19));

function roomSvg(cell, x, w, y, states, here) {
  const info = stateOf(states, cell.n);
  const dw = cell.w > 1 ? Math.min(28, w * 0.42) : Math.min(16, w * 0.46);
  const dh = 21;
  const cx = x + w / 2;
  const dx = cx - dw / 2;
  const dy = y + ROW - dh - 1;
  const isHere = here != null && info.id === here;
  return `<g class="pf-room is-${esc(info.state)}${isHere ? " is-here" : ""}" data-n="${esc(cell.n)}" data-css-i="${order(x)}">
    <rect class="pf-hit" x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${ROW}" rx="4"/>
    ${lampLight(info.state, cx, dy - 3.1, dw / 2 + 7)}
    <text class="pf-num" x="${f1(cx)}" y="${f1(y + 9)}">${esc(cell.n)}</text>
    <rect class="pf-inside" x="${f1(dx)}" y="${f1(dy)}" width="${f1(dw)}" height="${dh}" fill="url(#pfg-${esc(info.state)})"/>
    <svg class="pf-icon" x="${f1(cx - 5.5)}" y="${f1(dy + dh / 2 - 5.5)}" width="11" height="11" viewBox="0 0 24 24">${TYPE_ICON[cell.type]}</svg>
    <rect class="pf-door" x="${f1(dx)}" y="${f1(dy)}" width="${f1(dw)}" height="${dh}" rx="0.8"/>
    <circle class="pf-knob" cx="${f1(dx + dw - 2.3)}" cy="${f1(dy + dh * 0.56)}" r="0.65"/>
    <path class="pf-sill" d="M${f1(dx - 1.5)} ${f1(y + ROW - 0.5)}H${f1(dx + dw + 1.5)}"/>
  </g>`;
}

/** Фирменная четырёхлучевая звезда в точке (x, y), size — размах лучей */
function star(x, y, size, i) {
  const k = size / 24;
  return `<g transform="translate(${f1(x - size / 2)} ${f1(y - size / 2)}) scale(${k.toFixed(3)})"><path class="pf-star" data-css-i="${i}" d="${SPARK_PATH}"/></g>`;
}

/** Узор над крышей, как на фоне сайта: тонкие линии и мерцающие звёзды */
function skyLines(points, from) {
  const line = points.map(([x, y]) => `${x} ${y}`).join("L");
  return `<path class="pf-sky-line" pathLength="1" d="M${line}"/>${points.map(([x, y, s], i) => star(x, y, s, from + i)).join("")}`;
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

/** Подпись этажа слева: крупная цифра, под ней «этаж», рядом огонёк, если на этаже есть заявки */
function floorTag(n, y0, worst) {
  const mid = y0 + FH / 2;
  return `<g class="pf-label">
    <rect class="pf-tag-hit" x="0" y="${f1(y0 + 1)}" width="${X0 - 1}" height="${FH - 2}"/>
    <path class="pf-tag-bar" d="M27 ${f1(y0 + 16)}V${f1(y0 + FH - 16)}"/>
    <text class="pf-tag-n" x="13" y="${f1(mid + 3)}">${n}</text>
    <text class="pf-tag-t" x="13" y="${f1(mid + 12)}">этаж</text>
    ${worst === "clear" ? "" : `<circle class="pf-tag-dot is-${worst}" cx="21" cy="${f1(mid - 9)}" r="2"/>`}
  </g>`;
}

/**
 * Разметка схемы. states — из planStates(), here — id помещения, выбранного заявителем,
 * hint — строка под схемой, пока ни на что не навели.
 */
export function planHtml(states, { here = null, enter = false, hint = null } = {}) {
  const floors = FLOORS.map((f) => {
    const y0 = floorTop(f.floor);
    const ranges = partRanges(f);
    const marks = floorRooms(f).map((c) => stateOf(states, c.n).state);
    const open = marks.filter((s) => s !== "clear").length;
    const worst = marks.includes("urgent") ? "urgent" : open ? "open" : "clear";
    const rooms = f.parts
      .map((p, i) => {
        const [xa, xb] = ranges[i];
        // дальний ряд стоит на своём полу, ближний на перекрытии этажа
        return `${rowSvg(p.a, xa, xb, y0 + ROW_A, states, here)}
          <path class="pf-gallery" d="M${f1(xa - 1)} ${f1(y0 + ROW_A + ROW)}H${f1(xb + 1)}"/>
          ${rowSvg(p.b, xa, xb, y0 + FH - ROW, states, here)}`;
      })
      .join("");
    let center = "";
    if (f.center === "entrance") {
      const lobby = stateOf(states, LOBBY.n);
      const isHere = here != null && lobby.id === here;
      center = `${straightStair(G - 33, y0)}
        <g class="pf-room pf-lobby is-${esc(lobby.state)}${isHere ? " is-here" : ""}" data-n="${LOBBY.n}" data-css-i="${order(CX)}">
          <rect class="pf-hit" x="${f1(CX - CW / 2 + 2)}" y="${f1(G - 32)}" width="${CW - 4}" height="32" rx="4"/>
          ${lampLight(lobby.state, CX, G - 28.6, 16, 6)}
          <rect class="pf-inside" x="${f1(CX - 11)}" y="${f1(G - 25)}" width="22" height="25" fill="url(#pfg-${esc(lobby.state)})"/>
          <rect class="pf-door pf-door-l" x="${f1(CX - 11)}" y="${f1(G - 25)}" width="11" height="25"/>
          <rect class="pf-door pf-door-r" x="${f1(CX)}" y="${f1(G - 25)}" width="11" height="25"/>
          <circle class="pf-knob" cx="${f1(CX - 2)}" cy="${f1(G - 11)}" r="0.65"/>
          <circle class="pf-knob" cx="${f1(CX + 2)}" cy="${f1(G - 11)}" r="0.65"/>
          <path class="pf-canopy" d="M${f1(CX - 15)} ${f1(G - 26.6)}H${f1(CX + 15)}"/>
          <path class="pf-sill" d="M${f1(CX - 14)} ${f1(G - 0.5)}H${f1(CX + 14)}"/>
        </g>`;
    } else if (f.center === "arrive") {
      // ограждение по сторонам проёма, посередине приходит лестница
      const y = y0 + FH - RAIL_H;
      center = `${rail(CX - CW / 2, CX - OPENING, y, RAIL_H)}${rail(CX + OPENING, CX + CW / 2, y, RAIL_H)}`;
    }
    const label = `${f.floor} этаж: ${open ? `помещений с заявками ${open}` : "заявок нет"}. Открыть план этажа`;
    return `<g class="pf-floor" data-floor="${f.floor}" tabindex="0" role="button" aria-label="${esc(label)}">
      <rect class="pf-floor-bg" x="${X0 + 1}" y="${f1(y0 + 1)}" width="${X1 - X0 - 2}" height="${FH - 2}" rx="3"/>
      <rect class="pf-glint" x="${X0 + 1}" y="${f1(y0 + 1)}" width="110" height="${FH - 2}" fill="url(#pfg-glint)"/>
      ${floorTag(f.floor, y0, worst)}
      ${rooms}${center}
    </g>`;
  }).join("");

  // боковые лестничные клетки на всю высоту здания и зал входа посередине
  const sideStairs = `${sideStair(false)}${sideStair(true)}
    <path class="pf-stairwall" d="M${CX - CW / 2} ${floorTop(1)}V${G}M${CX + CW / 2} ${floorTop(1)}V${G}"/>`;
  const body = `M${X0} ${G}V${TOP}H${X1}V${G}Z`;
  const attic = `M${CX - 72} ${TOP - 2}L${CX - 50} ${TOP - 36}H${CX + 50}L${CX + 72} ${TOP - 2}Z`;
  // крыша и контур здания прорисовываются линией при первом показе (pathLength=1 для анимации штриха)
  const facade = `
    <g class="pf-sky" aria-hidden="true">
      ${skyLines([[44, 30, 6], [86, 14, 8], [132, 34, 5], [160, 16, 6]], 0)}
      ${skyLines([[346, 16, 6], [374, 34, 5], [420, 14, 8], [462, 30, 6]], 4)}
    </g>
    <ellipse class="pf-halo" cx="${CX}" cy="${G}" rx="${(X1 - X0) / 2 + 20}" ry="14" fill="url(#pfg-halo)"/>
    <path class="pf-attic" d="${attic}"/>
    <path class="pf-attic-line pf-draw" pathLength="1" d="${attic}"/>
    <path class="pf-cornice pf-draw" pathLength="1" d="M${CX - 55} ${TOP - 36}H${CX + 55}"/>
    <circle class="pf-emblem-glow" cx="${CX}" cy="${TOP - 19}" r="20" fill="url(#pfg-emblem)"/>
    ${emblem(CX, TOP - 19, 10.5)}
    <path class="pf-body" d="${body}" fill="url(#pfg-body)"/>
    <g class="pf-scan-g" clip-path="url(#pf-clip)" aria-hidden="true">
      <rect class="pf-scan" x="${X0 - 80}" y="${TOP}" width="80" height="${G - TOP}" fill="url(#pfg-scan)"/>
    </g>
    <rect class="pf-well" x="${X0}" y="${TOP}" width="${SW}" height="${G - TOP}"/>
    <rect class="pf-well" x="${IN_R}" y="${TOP}" width="${SW}" height="${G - TOP}"/>
    <rect class="pf-well" x="${CX - CW / 2}" y="${floorTop(1)}" width="${CW}" height="${FH}"/>
    <path class="pf-slab" d="M${IN_L} ${floorTop(2)}H${IN_R}M${IN_L} ${floorTop(1)}H${f1(CX - OPENING)}M${f1(CX + OPENING)} ${floorTop(1)}H${IN_R}"/>
    <path class="pf-body-line pf-draw" pathLength="1" d="${body}"/>
    <path class="pf-cornice pf-draw" pathLength="1" d="M${X0 - 6} ${TOP - 2}H${X1 + 6}"/>
    <path class="pf-ground" d="M2 ${G}H${W - 2}" stroke="url(#pfg-ground)"/>
    <ellipse class="pf-spill" cx="${CX}" cy="${G + 1}" rx="34" ry="6" fill="url(#pfg-spill)"/>
    <path class="pf-entry-arrow" d="M${CX - 4} ${G + 11}l4 -3.5l4 3.5"/>
    <text class="pf-entry" x="${CX}" y="${G + 21}">Вход</text>`;

  const grad = (s) => `<radialGradient id="pfg-${s}" class="pfg-${s}" cx="50%" cy="100%" r="110%"><stop offset="0"/><stop offset="1"/></radialGradient>`;
  const glow = (id) => `<radialGradient id="${id}" class="${id}"><stop offset="0"/><stop offset="1"/></radialGradient>`;
  const band = (id, x1, x2) =>
    `<linearGradient id="${id}" class="${id}" x1="${x1}" x2="${x2}" y1="0" y2="0"><stop offset="0"/><stop offset="0.5"/><stop offset="1"/></linearGradient>`;
  return `<div class="plan${enter && !REDUCED ? " is-enter" : ""}">
    <svg class="pf" viewBox="0 0 ${W} ${H}" role="group" aria-label="Схема колледжа: 3 этажа" focusable="false">
      <defs>
        ${grad("clear")}${grad("open")}${grad("urgent")}
        ${glow("pfg-lamp-open")}${glow("pfg-lamp-urgent")}${glow("pfg-emblem")}${glow("pfg-spill")}${glow("pfg-halo")}
        ${band("pfg-scan", 0, 1)}${band("pfg-glint", 0, 1)}
        <linearGradient id="pfg-ground" class="pfg-ground" gradientUnits="userSpaceOnUse" x1="0" x2="${W}" y1="0" y2="0"><stop offset="0"/><stop offset="0.5"/><stop offset="1"/></linearGradient>
        <linearGradient id="pfg-body" class="pfg-body" x1="0" x2="0" y1="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient>
        <clipPath id="pf-clip"><path d="${body}"/></clipPath>
      </defs>
      ${facade}
      <g class="pf-stairs" aria-hidden="true">${sideStairs}</g>
      ${floors}
    </svg>
  </div>
  <div class="pl-info" aria-live="polite"><span class="pl-hint"${hint ? " data-fixed" : ""}>${esc(hint || hintText())}</span></div>`;
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
  // вне экрана схема не тратит кадры на свои анимации
  new IntersectionObserver(([entry]) => svg.classList.toggle("is-away", !entry.isIntersecting)).observe(svg);

  const describe = (n) => {
    const cell = cells.get(n);
    const data = stateOf(states, n);
    info.innerHTML = `
      <div class="pl-info-text">
        <b>${esc(roomNames(cell).title)}</b>
        <div class="pl-info-type">${esc(roomNames(cell).sub)}</div>
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
  bindTutorial(root, svg, { onOpenFloor, light });
}

// ---------- обучение: как пользоваться схемой ----------

// На телефоне навести на кабинет нельзя: шаг про двери пропускается, вместо курсора показывается палец.
const TUTORIAL = [
  {
    title: "Это колледж",
    text: "Три этажа, кабинеты показаны дверями. Лестницы по бокам и посередине, вход внизу.",
    show: "floors",
  },
  {
    title: "Свет над дверью — заявки",
    text: "Синий свет: в кабинете есть заявка. Красный: срочная. Без света: всё в порядке.",
    show: "lamps",
  },
  {
    title: "Загляните в кабинет",
    text: "Наведите на кабинет, дверь откроется. Под схемой появится, что это за кабинет и есть ли заявки.",
    show: "door",
    mouseOnly: true,
  },
  {
    title: "Откройте этаж",
    text: (hover) =>
      hover
        ? "Нажмите на этаж: откроется план с крупными кабинетами. Там видны заявки и кнопка «Это здесь», чтобы выбрать кабинет для обращения."
        : "Коснитесь этажа: откроется план с крупными кабинетами. Там видны заявки и кнопка «Это здесь», чтобы выбрать кабинет для обращения.",
    show: "floor",
  },
];

const EASE = "cubic-bezier(.22,.8,.24,1)";
const FINGER =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 9.5V4a2 2 0 0 0-4 0v10M14 10V9a2 2 0 0 0-4 0v1M18 11v-1a2 2 0 0 0-4 0M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/></svg>';

function bindTutorial(root, svg, { onOpenFloor, light }) {
  const help = root.querySelector(".pl-help");
  const panel = root.querySelector(".campus-panel");
  const plan = root.querySelector(".plan");
  const aside = panel?.closest(".report-aside") || panel?.parentElement;
  if (!help || !panel || !plan) return;
  let steps = [];
  const pickSteps = () => TUTORIAL.filter((s) => canHover() || !s.mouseOnly);
  let box = null;
  let backdrop = null;
  let step = 0;
  let cursor = null;
  let timers = [];

  const clearShow = () => {
    timers.forEach(clearTimeout);
    timers = [];
    svg.classList.remove("tut-floors", "tut-lamps", "tut-door", "tut-floor");
    svg.querySelectorAll(".is-demo").forEach((n) => n.classList.remove("is-demo"));
    light(null);
    cursor?.remove();
    cursor = null;
  };

  /** Высота блока меняется плавно: замеряем до и после изменения и анимируем разницу */
  const resize = (change, duration = 520) => {
    const from = panel.offsetHeight;
    panel.getAnimations().forEach((an) => an.cancel());
    change();
    const to = panel.offsetHeight;
    if (REDUCED || from === to) return;
    panel.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: EASE });
  };

  // указатель мыши или палец движется к кабинету или этажу
  const pointTo = (el, { press = false } = {}) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const base = plan.getBoundingClientRect();
    cursor = document.createElement("span");
    cursor.className = canHover() ? "tut-cursor" : "tut-cursor is-finger";
    cursor.setAttribute("aria-hidden", "true");
    if (!canHover()) cursor.innerHTML = `${FINGER}<i class="tut-ring"></i>`;
    plan.append(cursor);
    const x = r.left - base.left + Math.min(r.width / 2, 120);
    const y = r.top - base.top + r.height * 0.55;
    const to = `translate(${x}px, ${y}px)`;
    if (REDUCED) {
      cursor.style.transform = to;
      cursor.classList.add("is-here");
    } else {
      cursor.animate(
        [
          { transform: `translate(${base.width * 0.85}px, ${base.height + 30}px)`, opacity: 0 },
          { opacity: 1, offset: 0.35 },
          { transform: to, opacity: 1 },
        ],
        { duration: 1150, easing: EASE, fill: "forwards" },
      );
      if (press) timers.push(setTimeout(() => cursor?.classList.add("is-press"), 1200));
    }
  };

  const showStep = (dir = 0) => {
    clearShow();
    const s = steps[step];
    svg.classList.add(`tut-${s.show}`);
    if (s.show === "door") {
      const room = svg.querySelector('.pf-room.is-open[data-n="214"]') || svg.querySelector(".pf-room.is-open") || svg.querySelector('.pf-room[data-n="214"]');
      pointTo(room?.querySelector(".pf-hit"));
      timers.push(setTimeout(() => room?.classList.add("is-demo"), REDUCED ? 0 : 1050));
    }
    if (s.show === "floor") {
      const floor = svg.querySelector('.pf-floor[data-floor="2"]');
      pointTo(floor?.querySelector(".pf-floor-bg"), { press: true });
      timers.push(setTimeout(() => light(floor), REDUCED ? 0 : 1150));
    }
    const last = step === steps.length - 1;
    const content = `
      <div class="tut-head">
        <span class="tut-count">${step + 1} из ${steps.length}</span>
        <button type="button" class="btn btn-ghost btn-icon btn-sm tut-close" aria-label="Закрыть подсказку">
          <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="tut-body${dir ? (dir > 0 ? " from-right" : " from-left") : ""}">
        <b class="tut-title">${esc(s.title)}</b>
        <p class="tut-text">${esc(typeof s.text === "function" ? s.text(canHover()) : s.text)}</p>
      </div>
      <div class="tut-foot">
        <span class="tut-dots" aria-hidden="true">${steps.map((_, i) => `<i class="${i === step ? "is-on" : ""}"></i>`).join("")}</span>
        ${step ? `<button type="button" class="btn btn-ghost btn-sm tut-back">Назад</button>` : ""}
        ${last ? `<button type="button" class="btn btn-primary btn-sm tut-try">Открыть 2 этаж</button>` : `<button type="button" class="btn btn-primary btn-sm tut-next">Дальше</button>`}
      </div>`;
    // текст другой длины: карточка меняет высоту плавно
    resize(() => (box.innerHTML = content), 380);
    box.querySelector(".tut-next, .tut-try")?.focus({ preventScroll: true });
    timers.push(setTimeout(keepVisible, REDUCED ? 0 : 420));
  };

  const go = (d) => {
    const next = step + d;
    if (next < 0 || next >= steps.length) return;
    step = next;
    showStep(d);
  };

  const open = () => {
    step = 0;
    steps = pickSteps();
    // фон страницы затемняется и размывается, блок остаётся над ним
    backdrop = document.createElement("div");
    backdrop.className = "tut-backdrop";
    backdrop.addEventListener("click", () => close());
    // фон кладётся в main рядом с колонкой блока: у main свой слой, иначе блок оказался бы под фоном
    const page = panel.closest("main") || document.body;
    page.classList.add("is-tut-page");
    page.append(backdrop);
    aside?.classList.add("is-tut-host");
    box = document.createElement("div");
    box.className = "tut";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Как пользоваться схемой");
    resize(() => {
      root.querySelector("#campus-map").after(box);
      panel.classList.add("is-tut");
    });
    help.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onKey);
    box.addEventListener("click", (e) => {
      if (e.target.closest(".tut-close")) close();
      else if (e.target.closest(".tut-next")) go(1);
      else if (e.target.closest(".tut-back")) go(-1);
      else if (e.target.closest(".tut-try")) {
        close(false);
        onOpenFloor?.(2, null);
      }
    });
    showStep();
  };

  // блок выше экрана (телефон): прокручиваем так, чтобы карточка была видна целиком, схема над ней
  const keepVisible = () => {
    if (!box) return;
    const tall = panel.offsetHeight + 40 > innerHeight;
    panel.scrollIntoView({ block: tall ? "end" : "center", behavior: REDUCED ? "auto" : "smooth" });
  };

  function close(focusHelp = true) {
    if (!box) return;
    clearShow();
    document.removeEventListener("keydown", onKey);
    const old = box;
    box = null;
    old.classList.add("is-leaving");
    backdrop?.classList.add("is-leaving");
    const oldBackdrop = backdrop;
    backdrop = null;
    setTimeout(() => {
      oldBackdrop?.remove();
      if (!box) panel.closest("main")?.classList.remove("is-tut-page");
    }, 320);
    const finish = () => {
      resize(() => {
        old.remove();
        panel.classList.remove("is-tut");
      }, 420);
      aside?.classList.remove("is-tut-host");
    };
    if (REDUCED) finish();
    else setTimeout(finish, 160);
    help.setAttribute("aria-expanded", "false");
    if (focusHelp) help.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key === "Escape") return close();
    if (e.key === "ArrowRight") return go(1);
    if (e.key === "ArrowLeft") return go(-1);
    if (e.key !== "Tab" || !box) return;
    // фокус остаётся в подсказке
    const items = [...box.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
  }

  help.addEventListener("click", () => (box ? close() : open()));
  // режим сменился, пока подсказка открыта: шаги и указатель перестраиваются на месте
  const onMode = () => {
    // блок перерисовали: старый обработчик больше не нужен
    if (!help.isConnected) return HOVER_MQ.removeEventListener("change", onMode);
    const hint = root.querySelector(".pl-hint");
    if (hint && !hint.hasAttribute("data-fixed")) hint.textContent = hintText();
    if (!box) return;
    const current = steps[step]?.show;
    steps = pickSteps();
    const same = steps.findIndex((s) => s.show === current);
    step = same >= 0 ? same : Math.min(step, steps.length - 1);
    showStep();
  };
  HOVER_MQ.addEventListener("change", onMode);
  // нажатие на этаж во время подсказки сначала закрывает её
  svg.addEventListener("click", () => box && close(false), true);
}
