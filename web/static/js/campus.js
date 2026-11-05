// Индикаторы состояния: без заявок, есть заявка, срочная заявка.

import { esc } from "./core.js";

const SPARK = "M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z";

export const CAMPUS_NODE = { calm: "clear", busy: "open", heavy: "open" };

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
