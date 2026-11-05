// Своё выделение текста. Цвет и свечение задаёт ::selection в app.css, а края выделения держат две искры знака 404.
// Когда кнопку отпустили или текст скопировали, от конца выделения разлетается маленькая вспышка.
// Только мышь: на телефоне у браузера свои ручки выделения, там остаётся один цвет.

import { SPARK_PATH } from "./cursor.js";
import { sparks } from "./lift.js";

const FIELD = "input, textarea";
const BURST_BITS = 5;
const LINE_MAX = 120; // прямоугольник выше этого — целый блок, а не строка текста

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function makeSpark(kind) {
  const el = document.createElement("div");
  el.className = `sel-spark ${kind}`;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${SPARK_PATH}"/></svg>`;
  return el;
}

/** Точка не спрятана: она на экране и внутри всех прокручиваемых родителей (окно, таблица) */
function isVisible(node, x, y) {
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
  for (let el = node instanceof Element ? node : node.parentElement; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const box = el.getBoundingClientRect();
    if (x < box.left - 1 || x > box.right + 1 || y < box.top - 1 || y > box.bottom + 1) return false;
  }
  return true;
}

function start() {
  const first = makeSpark("is-start");
  const last = makeSpark("is-end");
  let frame = 0;
  let endPoint = null;

  const selectedRange = () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    // выделение внутри поля ввода браузер не отдаёт координатами
    if (document.activeElement?.matches?.(FIELD)) return null;
    return selection.getRangeAt(0);
  };
  const place = (el, x, y, on) => {
    if (on && !el.isConnected) document.body.append(el);
    el.classList.toggle("is-on", on);
    if (on) el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };
  const draw = () => {
    frame = 0;
    endPoint = null;
    const range = selectedRange();
    const lines = range ? [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0 && r.height < LINE_MAX) : [];
    if (!lines.length) {
      place(first, 0, 0, false);
      place(last, 0, 0, false);
      return;
    }
    const head = lines[0];
    const tail = lines[lines.length - 1];
    place(first, head.left, head.top, isVisible(range.startContainer, head.left, head.top));
    const tailOn = isVisible(range.endContainer, tail.right, tail.bottom);
    place(last, tail.right, tail.bottom, tailOn);
    if (tailOn) endPoint = { x: tail.right, y: tail.bottom };
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const burst = () => {
    if (!reduced() && endPoint) sparks(endPoint.x, endPoint.y, 3, BURST_BITS);
  };

  document.addEventListener("selectionchange", schedule);
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", schedule, { passive: true });
  // выделение успевает обновиться к следующему кадру
  document.addEventListener(
    "pointerup",
    (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      requestAnimationFrame(() => {
        draw();
        burst();
      });
    },
    { passive: true },
  );
  document.addEventListener("copy", burst);
}

if (matchMedia("(hover: hover) and (pointer: fine)").matches) start();
