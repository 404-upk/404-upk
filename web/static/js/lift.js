// Своё перетаскивание вместо системного: браузер рисует полупрозрачную копию и курсор с крестиком, а здесь
// взятое приподнимается и идёт за указателем с наклоном от скорости. Отпустили: пружиной возвращается на место
// и рассыпает искры. QR-код при этом растёт до читаемого размера, вокруг него рамка сканера с бегущей линией;
// ссылка превращается в карточку с названием и адресом.
// Только мышь: на телефоне жест остаётся прокруткой страницы. Ссылка от перетаскивания не открывается.

import { SPARK_PATH } from "./cursor.js";

const DEAD_ZONE = 6; // сдвиг в пикселях, после которого нажатие считается перетаскиванием, а не кликом
const LIFTED_SIZE = 190; // маленькая картинка вырастает до такой стороны
const LARGE_SIZE = 260; // большая уменьшается до такой, чтобы не закрывать страницу
const MAX_TILT = 16;
const SPARKS = 8;
const CHIP_GAP = 16; // карточка ссылки висит над указателем, чтобы он её не закрывал
// у этих элементов своё перетаскивание
const OWN_DRAG = '.kcard, .pf-room, [draggable="true"]';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
// плавное приближение, которое не зависит от частоты кадров
const toward = (rate, dt) => 1 - Math.exp(-rate * dt);

function sparks(cx, cy, radius) {
  const turn = Math.random() * 45;
  for (let i = 0; i < SPARKS; i += 1) {
    const angle = ((turn + (i * 360) / SPARKS) * Math.PI) / 180;
    const far = radius + 16 + Math.random() * 22;
    const bit = document.createElement("div");
    bit.className = "cursor-bit";
    bit.setAttribute("aria-hidden", "true");
    bit.innerHTML = `<svg viewBox="0 0 24 24"><path d="${SPARK_PATH}"/></svg>`;
    document.body.append(bit);
    const anim = bit.animate(
      [
        { transform: `translate3d(${cx + Math.cos(angle) * radius}px, ${cy + Math.sin(angle) * radius}px, 0) scale(0.9)`, opacity: 1 },
        { transform: `translate3d(${cx + Math.cos(angle) * far}px, ${cy + Math.sin(angle) * far}px, 0) scale(0) rotate(120deg)`, opacity: 0 },
      ],
      { duration: 560, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" },
    );
    anim.onfinish = anim.oncancel = () => bit.remove();
  }
}

/** Копия картинки: сразу в полном размере и уменьшена масштабом, поэтому векторный код остаётся чётким */
function imageVisual(img, pointerX, pointerY, className) {
  const box = img.getBoundingClientRect();
  const largest = Math.max(box.width, box.height) || 1;
  const grown = Math.max(LIFTED_SIZE / largest, largest > LARGE_SIZE ? LARGE_SIZE / largest : 1.1);
  const originX = (pointerX - box.left) * grown;
  const originY = (pointerY - box.top) * grown;
  const ghost = document.createElement("div");
  ghost.className = className;
  const copy = new Image();
  copy.src = img.currentSrc || img.src;
  copy.alt = "";
  copy.draggable = false;
  ghost.append(copy);
  ghost.style.width = `${box.width * grown}px`;
  ghost.style.height = `${box.height * grown}px`;
  document.body.append(ghost);
  return {
    ghost,
    originX,
    originY,
    startScale: 1 / grown,
    landing: (home) => ({ x: home.left + originX / grown - originX, y: home.top + originY / grown - originY, scale: 1 / grown, opacity: 1 }),
  };
}

/** Карточка: висит над указателем, при возвращении сжимается в то место, откуда её взяли */
function chipVisual(ghost) {
  document.body.append(ghost);
  const width = ghost.offsetWidth;
  const height = ghost.offsetHeight;
  const originX = width / 2;
  const originY = height + CHIP_GAP;
  const endScale = 0.3;
  return {
    ghost,
    originX,
    originY,
    startScale: 0.55,
    landing: (home) => ({
      x: home.left + home.width / 2 - originX - endScale * (width / 2 - originX),
      y: home.top + home.height / 2 - originY - endScale * (height / 2 - originY),
      scale: endScale,
      opacity: 0,
    }),
  };
}

const kinds = [
  { selector: ".qr-thumb, .print-qr", visual: (el, x, y) => imageVisual(el, x, y, "qr-lift") },
  { selector: "img", visual: (el, x, y) => imageVisual(el, x, y, "img-lift") },
];

/** Что ещё можно брать мышью: make возвращает элемент-карточку или null, если поднимать нечего */
export function liftable(selector, make) {
  kinds.push({
    selector,
    visual(el) {
      const chip = make(el);
      return chip ? chipVisual(chip) : null;
    },
  });
}

function pickUp(el, kind, pointerX, pointerY) {
  const visual = kind.visual(el, pointerX, pointerY);
  if (!visual) return null;
  const { ghost, originX, originY, startScale, landing } = visual;
  const root = document.documentElement;
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.transformOrigin = `${originX}px ${originY}px`;
  el.classList.add("is-lifted");
  root.classList.add("is-lifting", "is-dragging");

  let x = pointerX - originX;
  let y = pointerY - originY;
  let targetX = x;
  let targetY = y;
  let tilt = 0;
  let scale = startScale;
  let last = performance.now();
  const pose = () => `translate3d(${x}px, ${y}px, 0) rotate(${tilt}deg) scale(${scale})`;
  const step = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    x += (targetX - x) * toward(30, dt);
    y += (targetY - y) * toward(30, dt);
    tilt += (clamp((targetX - x) * 0.55, -MAX_TILT, MAX_TILT) - tilt) * toward(14, dt);
    scale += (1 - scale) * toward(13, dt);
    ghost.style.transform = pose();
    frame = requestAnimationFrame(step);
  };
  ghost.style.transform = pose();
  let frame = requestAnimationFrame(step);

  return {
    follow(px, py) {
      targetX = px - originX;
      targetY = py - originY;
    },
    drop() {
      cancelAnimationFrame(frame);
      root.classList.remove("is-lifting", "is-dragging");
      ghost.classList.add("is-dropping");
      if (!el.isConnected) {
        // пока несли, список успел обновиться: возвращаться некуда
        ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).onfinish = () => ghost.remove();
        return;
      }
      const home = el.getBoundingClientRect();
      const end = landing(home);
      const flight = ghost.animate(
        [
          { transform: pose(), opacity: 1 },
          { transform: `translate3d(${end.x}px, ${end.y}px, 0) rotate(0deg) scale(${end.scale})`, opacity: end.opacity },
        ],
        { duration: 430, easing: "cubic-bezier(0.22, 1.3, 0.36, 1)", fill: "forwards" },
      );
      let landed = false;
      const land = () => {
        if (landed) return;
        landed = true;
        ghost.remove();
        el.classList.remove("is-lifted");
        el.animate([{ transform: "scale(1.07)" }, { transform: "scale(1)" }], { duration: 240, easing: "ease-out" });
        sparks(home.left + home.width / 2, home.top + home.height / 2, Math.min(home.width, home.height) / 2);
      };
      flight.onfinish = flight.oncancel = land;
      // в спящей вкладке событие конца анимации может не прийти, а копия на экране не должна остаться
      setTimeout(land, 700);
    },
  };
}

function kindAt(target) {
  if (!(target instanceof Element) || target.closest(OWN_DRAG)) return null;
  // ссылка важнее картинки внутри неё, QR-код важнее обычной картинки
  const link = kinds.slice(2).find((k) => target.closest(k.selector));
  if (link) return { el: target.closest(link.selector), kind: link };
  const image = kinds.slice(0, 2).find((k) => target.closest(k.selector));
  return image ? { el: target.closest(image.selector), kind: image } : null;
}

document.addEventListener(
  "pointerdown",
  (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const found = kindAt(e.target);
    if (!found) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let lift = null;
    let refused = false;
    const move = (ev) => {
      if (refused || (!lift && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DEAD_ZONE)) return;
      if (!lift) {
        lift = pickUp(found.el, found.kind, startX, startY);
        if (!lift) {
          refused = true;
          return;
        }
      }
      lift.follow(ev.clientX, ev.clientY);
    };
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      if (!lift) return;
      lift.drop();
      // отпустили над той же ссылкой: это было перетаскивание, переход не нужен
      const stop = (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      };
      window.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => {
        window.removeEventListener("click", stop, { capture: true });
        // подсказка ссылки и указатель узнают, что перетаскивание закончилось
        document.dispatchEvent(new Event("dragend"));
      }, 50);
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerup", end, { passive: true });
    document.addEventListener("pointercancel", end, { passive: true });
    window.addEventListener("blur", end);
  },
  { passive: true },
);
