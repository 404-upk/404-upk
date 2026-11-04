// Анимации интерфейса: каскад появления, числа, раскрытие блоков, отклик на курсор и нажатия.

import { ambient } from "./ambient.js";

export const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const IN = "cubic-bezier(0.4, 0, 1, 1)";

/** Каскад появления: элементы по очереди поднимаются и проявляются */
export function rise(root, selector, { step = 70, delay = 0, dur } = {}) {
  const items = typeof selector === "string" ? root.querySelectorAll(selector) : selector;
  [...items].forEach((el, i) => {
    el.style.setProperty("--i", i);
    el.style.setProperty("--step", `${step}ms`);
    el.style.setProperty("--d", `${delay}ms`);
    if (dur) el.style.setProperty("--dur", `${dur}ms`);
    el.classList.remove("rise");
    void el.offsetWidth;
    el.classList.add("rise");
  });
}

/** Заголовок по словам: каждое слово выезжает из-под маски */
export function splitWords(el, { step = 70, delay = 80 } = {}) {
  if (!el || REDUCED) return;
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute("aria-label", el.textContent.trim());
  el.textContent = "";
  words.forEach((w, i) => {
    const outer = document.createElement("span");
    outer.className = "word";
    outer.setAttribute("aria-hidden", "true");
    const inner = document.createElement("span");
    inner.style.cssText = `--i:${i};--step:${step}ms;--d:${delay}ms`;
    inner.textContent = w;
    outer.append(inner);
    el.append(outer, " ");
  });
  el.classList.add("words");
}

/** Текст ответа проявляется словами. Длинный текст укладывается в ту же секунду. */
export function textIn(el, { total = 900 } = {}) {
  if (!el || REDUCED) return;
  const text = el.textContent;
  const parts = text.split(/(\s+)/);
  const count = parts.filter((p) => p.trim()).length;
  const step = Math.min(38, total / Math.max(count, 1));
  let i = 0;
  el.textContent = "";
  for (const part of parts) {
    if (!part.trim()) {
      el.append(part);
      continue;
    }
    const span = document.createElement("span");
    span.className = "w-in";
    span.style.animationDelay = `${(i++ * step).toFixed(0)}ms`;
    span.textContent = part;
    el.append(span);
  }
}

/** Счётчик: находит первое число в тексте и докручивает до него */
export function countUp(el, { duration = 1200, delay = 0 } = {}) {
  if (!el || REDUCED) return;
  const text = el.textContent;
  const m = text.match(/\d+(?:[.,]\d+)?/);
  if (!m) return;
  const to = parseFloat(m[0].replace(",", "."));
  const decimals = (m[0].split(/[.,]/)[1] || "").length;
  const sep = m[0].includes(",") ? "," : ".";
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  const draw = (v) => {
    el.textContent = before + v.toFixed(decimals).replace(".", sep) + after;
  };
  draw(0);
  const start = performance.now() + delay;
  const tick = (now) => {
    const k = Math.min(Math.max((now - start) / duration, 0), 1);
    draw(to * (1 - (1 - k) ** 4));
    if (k < 1) requestAnimationFrame(tick);
    else el.textContent = text;
  };
  requestAnimationFrame(tick);
}

/** Символы перебираются и встают на место слева направо: номер заявки, код */
export function scramble(el, { duration = 900, delay = 0 } = {}) {
  if (!el || REDUCED) return;
  const text = el.textContent;
  const DIGITS = "0123456789";
  const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const start = performance.now() + delay;
  const tick = (now) => {
    const k = Math.min(Math.max((now - start) / duration, 0), 1);
    const locked = Math.floor(k * text.length);
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (i < locked || !/[0-9A-Z]/.test(c)) out += c;
      else {
        const pool = /\d/.test(c) ? DIGITS : LETTERS;
        out += pool[Math.floor(Math.random() * pool.length)];
      }
    }
    el.textContent = out;
    if (k < 1) requestAnimationFrame(tick);
    else el.textContent = text;
  };
  requestAnimationFrame(tick);
}

/** Плавное раскрытие блока по высоте */
export function expandIn(el, { duration = 620 } = {}) {
  if (!el || REDUCED) return;
  const height = el.scrollHeight;
  if (!height) return;
  const anim = el.animate(
    [
      { height: "0px", opacity: 0, overflow: "hidden" },
      { height: `${height}px`, opacity: 1, overflow: "hidden" },
    ],
    { duration, easing: OUT },
  );
  return anim.finished.catch(() => {});
}

/** Плавное сворачивание блока; промис завершается, когда он скрыт */
export function collapseOut(el, { duration = 340, then } = {}) {
  if (!el || REDUCED || !el.offsetHeight) {
    then?.();
    return Promise.resolve();
  }
  const anim = el.animate(
    [
      { height: `${el.offsetHeight}px`, opacity: 1, overflow: "hidden" },
      { height: "0px", opacity: 0, overflow: "hidden" },
    ],
    { duration, easing: "cubic-bezier(0.5, 0, 0.2, 1)", fill: "forwards" },
  );
  return anim.finished
    .catch(() => {})
    .then(() => {
      then?.();
      anim.cancel();
    });
}

/** Содержимое мягко уходит вверх перед сменой экрана */
export function leave(el, { duration = 260, y = -10 } = {}) {
  if (!el || REDUCED) return Promise.resolve();
  const anim = el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateY(${y}px)` }], {
    duration,
    easing: IN,
    fill: "forwards",
  });
  return anim.finished.then(() => anim).catch(() => null);
}

/** Появление блоков ниже первого экрана, когда до них докрутили */
export function onView(root, selector) {
  const items = [...root.querySelectorAll(selector)];
  if (REDUCED || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
  );
  items.forEach((el) => {
    el.classList.add("on-view");
    io.observe(el);
  });
}

const LIT = ".card, .place-pill, .composer, .room-note, .kcard, .node-row, .example";

function pointerFx() {
  if (REDUCED || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  let lit = null;
  let mag = null;
  let queued = null;
  const clearMag = () => {
    mag?.style.removeProperty("--mag-x");
    mag?.style.removeProperty("--mag-y");
    mag = null;
  };
  const apply = () => {
    const e = queued;
    queued = null;
    if (!e) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    const card = t.closest(LIT);
    if (card !== lit) {
      lit?.classList.remove("is-lit");
      lit = card;
      card?.classList.add("is-lit");
    }
    if (card) {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    }
    const btn = t.closest(".btn-primary:not(:disabled)");
    if (btn !== mag) clearMag();
    if (btn) {
      mag = btn;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty("--mag-x", `${((e.clientX - r.left) / r.width - 0.5) * 7}px`);
      btn.style.setProperty("--mag-y", `${((e.clientY - r.top) / r.height - 0.5) * 5}px`);
    }
  };
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!queued) requestAnimationFrame(apply);
      queued = e;
    },
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", () => {
    lit?.classList.remove("is-lit");
    lit = null;
    clearMag();
  });
}

function pressFx() {
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest(".btn");
      if (btn && !btn.disabled && !REDUCED) {
        const r = btn.getBoundingClientRect();
        const size = Math.max(r.width, r.height) * 2.2;
        const ink = document.createElement("span");
        ink.className = "ink";
        ink.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
        btn.append(ink);
        ink.addEventListener("animationend", () => ink.remove());
      }
      const strength = t.closest(".btn-primary") ? 0.75 : t.closest("input, textarea, select") ? 0 : 0.28;
      if (strength) ambient.pulse(e.clientX, e.clientY, strength);
    },
    { passive: true },
  );
}

function focusFx() {
  document.addEventListener("focusin", (e) => {
    const box = e.target instanceof Element ? e.target.closest(".composer") : null;
    if (box) ambient.attract(box);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target instanceof Element && e.target.closest(".composer")) ambient.release();
  });
}

function stickyFx() {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const sync = () => bar.classList.toggle("is-stuck", window.scrollY > 6);
  window.addEventListener("scroll", sync, { passive: true });
  sync();
}

let started = false;

export function initMotion() {
  if (started) return;
  started = true;
  pointerFx();
  pressFx();
  focusFx();
  stickyFx();
}
