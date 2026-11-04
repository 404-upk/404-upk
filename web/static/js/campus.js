// Карта помещений и индикаторы состояния: без заявок, есть заявка, срочная заявка.

import { esc, h } from "./core.js";

const SPARK = "M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z";
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

export const CAMPUS_NODE = { calm: "clear", busy: "open", heavy: "open" };
export const NODE_TEXT = { clear: "открытых заявок нет", open: "есть открытая заявка", urgent: "есть срочная заявка" };

/** Фирменная четырёхлучевая форма из знака 404 */
export function spark(cls = "") {
  return `<svg class="spark ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${SPARK}"/></svg>`;
}

export function nodeGlyph(state = "clear", cls = "") {
  return `<span class="node-glyph is-${esc(state)} ${cls}" aria-hidden="true">${spark()}</span>`;
}

export function campusBadge(c) {
  if (!c) return "";
  return `<span class="campus-badge">
    ${nodeGlyph(CAMPUS_NODE[c.state] || "clear")}
    <span>Состояние колледжа: <b>${esc(c.label)}</b> · ${c.rooms_clear} из ${c.rooms_total} без заявок</span>
  </span>`;
}

/** «Кабинет 214, Химия» → «214», «Главный холл» → «Холл» */
export function shortRoom(title) {
  const m = String(title).match(/^Кабинет\s+([^,\s]+)/i);
  if (m) return m[1];
  const words = String(title).split(/[\s,]+/);
  const word = words[words.length - 1].length > 3 ? words[words.length - 1] : words[0];
  return word.charAt(0).toUpperCase() + word.slice(1, 10);
}

function hash(n) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  return (x % 1000) / 1000;
}

/**
 * Карта одного корпуса: этажи — ряды точек сверху вниз, помещения этажа связаны линией.
 * rooms: [{ id, title, floor, state, chronic }]
 * enter: при первом показе линии прорисовываются, а точки появляются по очереди.
 */
export function campusMapSvg(rooms, { width = 320, rowHeight = 64, labels = false, interactive = false, here = null, enter = false } = {}) {
  const floors = [...new Set(rooms.map((r) => r.floor ?? -999))].sort((a, b) => b - a);
  const padL = labels ? 74 : 58; // слева подписи этажей
  const padR = labels ? 26 : 18;
  const padY = labels ? 34 : 22;
  const spreadY = labels ? 0.2 : 0.34; // с подписями точки ровнее, чтобы текст не наезжал
  const height = padY * 2 + Math.max(0, floors.length - 1) * rowHeight + (labels ? 14 : 0);
  const pos = new Map();
  const lines = [];
  const signals = [];

  floors.forEach((floor, row) => {
    const items = rooms.filter((r) => (r.floor ?? -999) === floor);
    const span = width - padL - padR;
    const step = items.length > 1 ? span / (items.length - 1) : 0;
    const pts = items.map((r, i) => {
      const jx = (hash(r.id) - 0.5) * Math.min(step * 0.35, 24);
      const jy = (hash(r.id + 7) - 0.5) * rowHeight * spreadY;
      const x = items.length > 1 ? padL + step * i + jx : padL + span / 2;
      const y = padY + row * rowHeight + jy;
      pos.set(r.id, [x, y]);
      return [x, y];
    });
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
      lines.push(`<path class="cm-line" data-floor="${floor}" pathLength="1" d="${d}" data-css-i="${row}"/>`);
      if (!REDUCED) {
        const dur = (7 + hash(floor + 11) * 6).toFixed(1);
        const begin = (hash(floor + 3) * -9).toFixed(1);
        signals.push(`<circle class="cm-signal" r="1.3"><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;.5;1" calcMode="linear" path="${d}"/></circle>`);
      }
    }
  });
  // этажи соединены через помещения ближе к середине
  for (let i = 1; i < floors.length; i++) {
    const mid = (floor) => {
      const items = rooms.filter((r) => (r.floor ?? -999) === floor);
      return items[Math.floor((items.length - 1) / 2)];
    };
    const a = pos.get(mid(floors[i - 1]).id);
    const b = pos.get(mid(floors[i]).id);
    lines.push(`<path class="cm-line cm-link" pathLength="1" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}" data-css-i="${floors.length + i}"/>`);
  }

  const floorLabels = floors
    .map((f, row) => (f === -999 ? "" : `<text class="cm-floor" x="0" y="${(padY + row * rowHeight + 3).toFixed(1)}">${f} эт</text>`))
    .join("");

  const R = { clear: 2.2, open: 2.7, urgent: 3.1 };
  const order = [...rooms].sort((a, b) => pos.get(a.id)[0] - pos.get(b.id)[0]);
  const nodes = rooms
    .map((r) => {
      const [x, y] = pos.get(r.id);
      const size = R[r.state] || 2.2;
      const name = `${r.title}: ${NODE_TEXT[r.state] || ""}${r.chronic ? ", проблемы повторяются" : ""}`;
      return `<g class="cm-node is-${esc(r.state)} ${here === r.id ? "is-here" : ""}" data-id="${r.id}" data-floor="${r.floor ?? -999}" data-title="${esc(r.title)}" data-state="${esc(r.state)}" data-chronic="${r.chronic ? 1 : ""}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"${interactive ? ' tabindex="0" role="button"' : ' role="img"'} aria-label="${esc(name)}">
        <circle class="hit" r="${Math.max(10, size * 4)}"/>
        <g class="cm-pop" data-css-i="${order.indexOf(r)}">
          <circle class="halo" r="${(size * 3.4).toFixed(1)}"/>
          ${r.chronic ? `<circle class="ring" r="${(size * 2.3).toFixed(1)}"/>` : ""}
          ${here === r.id ? `<circle class="ring-here" r="${(size * 2.6).toFixed(1)}"/>` : ""}
          <circle class="core" r="${size}"/>
        </g>
        ${labels ? `<text class="label" y="${(size * 3.4 + 10).toFixed(1)}">${esc(shortRoom(r.title))}</text>` : ""}
      </g>`;
    })
    .join("");

  return `<svg class="campus-map ${interactive ? "is-interactive" : ""} ${enter && !REDUCED ? "is-enter" : ""}" viewBox="-6 0 ${width + 12} ${height}" role="${interactive ? "group" : "img"}" aria-label="Карта помещений">
    ${lines.join("")}${signals.join("")}${floorLabels}${nodes}
  </svg>`;
}

let tip = null;

function hideTip() {
  tip?.classList.remove("is-on");
}

/** Подсказка над точкой и подсветка её этажа */
export function bindCampusMap(root) {
  const svg = root.querySelector(".campus-map");
  if (!svg) return;
  const show = (node) => {
    if (!tip) {
      tip = h(`<div class="cm-tip" role="presentation"></div>`);
      document.body.append(tip);
    }
    const state = node.dataset.state;
    tip.innerHTML = `<b>${esc(node.dataset.title)}</b><span class="cm-tip-state is-${esc(state)}">${esc(NODE_TEXT[state] || "")}</span>${
      node.dataset.chronic ? `<span class="tiny faint">Проблемы повторяются</span>` : ""
    }`;
    const r = node.querySelector(".core").getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`;
    tip.style.top = `${r.top - tip.offsetHeight - 12}px`;
    tip.classList.add("is-on");
    svg.classList.add("has-hot");
    svg.querySelectorAll(`[data-floor="${node.dataset.floor}"]`).forEach((n) => n.classList.add("is-hot"));
  };
  const clear = () => {
    hideTip();
    svg.classList.remove("has-hot");
    svg.querySelectorAll(".is-hot").forEach((n) => n.classList.remove("is-hot"));
  };
  svg.addEventListener("pointerover", (e) => {
    const node = e.target.closest?.(".cm-node");
    clear();
    if (node) show(node);
  });
  svg.addEventListener("pointerleave", clear);
  svg.addEventListener("focusin", (e) => {
    const node = e.target.closest?.(".cm-node");
    if (node) show(node);
  });
  svg.addEventListener("focusout", clear);
  window.addEventListener("scroll", clear, { passive: true, once: true });
}
