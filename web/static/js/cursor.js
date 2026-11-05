// Свой указатель для мыши: фирменная четырёхлучевая форма из знака 404.
// На сенсорных экранах не включается. До первого движения мыши работает обычный указатель.

export const SPARK_PATH = "M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z";

const SHAPE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SPARK_PATH}"/></svg>`;
const INTERACTIVE =
  'a[href], a[data-href], button, .ui-scroll, [role="button"], [role="option"], label, select, summary, input[type="checkbox"], input[type="radio"], input[type="file"], [tabindex]:not([tabindex="-1"]), .pf-room, .kcard, .qr-thumb, .print-qr';
const TEXT_FIELD =
  'input:not([type="checkbox"], [type="radio"], [type="file"], [type="button"], [type="submit"]), textarea, [contenteditable="true"]';
const DISABLED = 'button:disabled, input:disabled, select:disabled, [aria-disabled="true"]';

const RING_EASE = 0.2; // кольцо догоняет указатель с небольшой задержкой
const TRAIL_STEP = 64; // через сколько пикселей пути оставлять след
const MAX_BITS = 16; // больше частиц разом не нужно: это украшение, а не нагрузка
const BURST_BITS = 6;

function part(className, inner) {
  const el = document.createElement("div");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = inner;
  return el;
}

function start() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // над полями ввода знак превращается в текстовый курсор: черта с засечками
  const cursor = part("cursor", `<div class="cursor-pose">${SHAPE}</div><div class="cursor-beam"><i></i></div>`);
  const ring = part("cursor-ring", "<i></i>");
  let x = 0;
  let y = 0;
  let ringX = 0;
  let ringY = 0;
  let frame = 0;
  let shown = false;
  let lastTarget = null;
  let travelled = 0;
  let bits = 0;

  const place = (el, px, py) => {
    el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
  };
  const tick = () => {
    frame = 0;
    ringX += (x - ringX) * RING_EASE;
    ringY += (y - ringY) * RING_EASE;
    place(cursor, x, y);
    place(ring, ringX, ringY);
    if (Math.abs(x - ringX) + Math.abs(y - ringY) > 0.2) frame = requestAnimationFrame(tick);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const toggle = (name, on) => {
    cursor.classList.toggle(name, on);
    ring.classList.toggle(name, on);
  };

  const show = () => {
    if (shown) return;
    shown = true;
    if (!cursor.isConnected) {
      document.body.append(ring, cursor);
      document.documentElement.classList.add("has-cursor");
    }
    ringX = x;
    ringY = y;
    travelled = 0;
    toggle("is-on", true);
  };
  const hide = () => {
    shown = false;
    toggle("is-on", false);
  };

  const describe = (target) => {
    if (!(target instanceof Element)) return;
    const disabled = !!target.closest(DISABLED);
    toggle("is-disabled", disabled);
    toggle("is-text", !disabled && !!target.closest(TEXT_FIELD));
    toggle("is-hover", !disabled && !target.closest(TEXT_FIELD) && !!target.closest(INTERACTIVE));
  };

  const spawn = (px, py, dx, dy, size, duration) => {
    if (reduced || bits >= MAX_BITS) return;
    bits += 1;
    const bit = part("cursor-bit", SHAPE);
    document.body.append(bit);
    const anim = bit.animate(
      [
        { transform: `translate3d(${px}px, ${py}px, 0) scale(${size})`, opacity: 0.9 },
        { transform: `translate3d(${px + dx}px, ${py + dy}px, 0) scale(0) rotate(90deg)`, opacity: 0 },
      ],
      { duration, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" },
    );
    anim.onfinish = anim.oncancel = () => {
      bit.remove();
      bits -= 1;
    };
  };
  const burst = () => {
    const turn = Math.random() * 60;
    for (let i = 0; i < BURST_BITS; i += 1) {
      const angle = ((turn + i * 60) * Math.PI) / 180;
      const distance = 22 + Math.random() * 14;
      spawn(x, y, Math.cos(angle) * distance, Math.sin(angle) * distance, 0.55 + Math.random() * 0.4, 520);
    }
  };

  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse") {
        hide();
        return;
      }
      const distance = shown ? Math.hypot(e.clientX - x, e.clientY - y) : 0;
      x = e.clientX;
      y = e.clientY;
      show();
      if (e.target !== lastTarget) {
        lastTarget = e.target;
        describe(e.target);
      }
      travelled += distance;
      if (travelled >= TRAIL_STEP) {
        travelled = 0;
        if (!cursor.classList.contains("is-text")) {
          spawn(x, y, (Math.random() - 0.5) * 14, 6 + Math.random() * 10, 0.3 + Math.random() * 0.3, 650);
        }
      }
      schedule();
    },
    { passive: true },
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      x = e.clientX;
      y = e.clientY;
      show();
      lastTarget = e.target;
      describe(e.target);
      schedule();
      toggle("is-down", true);
      if (!cursor.classList.contains("is-text")) burst();
    },
    { passive: true },
  );
  const release = () => toggle("is-down", false);
  document.addEventListener("pointerup", release, { passive: true });
  document.addEventListener("pointercancel", release, { passive: true });
  window.addEventListener("blur", release);
  // пока тащат карточку на доске, браузер не присылает pointermove
  document.addEventListener(
    "dragover",
    (e) => {
      x = e.clientX;
      y = e.clientY;
      schedule();
    },
    { passive: true },
  );
  document.addEventListener("dragend", release, { passive: true });
  document.documentElement.addEventListener("mouseleave", hide);
}

if (matchMedia("(hover: hover) and (pointer: fine)").matches) start();
