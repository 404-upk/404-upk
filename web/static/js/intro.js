// Интро: точки загораются и соединяются, сеть закручивается к центру и собирается в знак,
// знак загорается и улетает на своё место в шапке, а сайт проявляется под ним.
// Фон не исчезает и не меняется: интро с самого начала идёт на том же живом фоне, что и сайт.
// Показывается один раз за сессию; клик или любая клавиша ведут сразу к финалу.

import { MARK_PARTS, MARK_VIEWBOX } from "./brand.js";
import { ambient, startAmbient } from "./ambient.js";
import { introSound } from "./sound.js";

const root = document.getElementById("intro");
const html = document.documentElement;
const OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

const POINTS = [
  [50, 8], [72, 14], [88, 32], [92, 56], [78, 79], [55, 91], [30, 86], [13, 67], [9, 41], [24, 18],
  [38, 33], [63, 28], [71, 56], [45, 66], [29, 52],
];
const RIM = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const CORE = [9, 10, 14, 13, 12, 11, 1];
const SPOKES = [[10, 11], [14, 7], [12, 3], [13, 5]];

const LINK_MS = [420, 1500];
const GATHER_AT = 1560;
const GATHER_MS = 860;
const MARK_AT = 1860;
const MARK_MS = 1080;
const FILL_AT = 2640;
const FLARE_AT = 2900;
const CAPTION_AT = 2780;
const EXIT_AT = 3820;
const FLIGHT_MS = 1120;

function build() {
  const nodes = POINTS.map(
    ([x, y], i) => `<g class="n" data-i="${i}"><circle cx="${x}" cy="${y}" r="${i < 10 ? 2.5 : 1.9}" class="h"/><circle cx="${x}" cy="${y}" r="${i < 10 ? 0.72 : 0.54}" class="c"/></g>`,
  ).join("");
  const line = (ids) => ids.map((i) => POINTS[i].join(",")).join(" ");
  const spokes = SPOKES.map(([a, b]) => `<polyline class="l" pathLength="1" points="${line([a, b])}"/>`).join("");
  root.innerHTML = `
    <div class="in-glow"></div>
    <svg class="in-net" viewBox="0 0 100 100" aria-hidden="true"><g class="in-net-g">
      <polyline class="l" pathLength="1" points="${line(RIM)}"/>
      <polyline class="l" pathLength="1" points="${line(CORE)}"/>
      ${spokes}
      ${nodes}
    </g></svg>
    <div class="in-stage">
      <svg class="in-mark" viewBox="${MARK_VIEWBOX}" aria-hidden="true">${MARK_PARTS.map((d) => `<path pathLength="1" d="${d}"/>`).join("")}</svg>
      <i class="in-flare"></i>
    </div>
    <div class="in-caption">Цифровой помощник колледжа</div>
    <div class="in-skip">Нажмите, чтобы пропустить</div>`;
}

const running = [];
function play(el, frames, options) {
  const anim = el.animate(frames, { fill: "both", ...options });
  running.push(anim);
  return anim;
}

function timeline() {
  const net = root.querySelector(".in-net-g");
  const stage = root.querySelector(".in-stage");
  const glow = root.querySelector(".in-glow");
  const caption = root.querySelector(".in-caption");
  const flare = root.querySelector(".in-flare");

  // точки загораются от центра к краям
  root.querySelectorAll(".n").forEach((n) => {
    const [x, y] = POINTS[Number(n.dataset.i)];
    const delay = 120 + Math.hypot(x - 50, y - 50) * 13 + Math.random() * 80;
    play(n, [{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "scale(1.5)", offset: 0.55 }, { opacity: 0.92, transform: "scale(1)" }], {
      duration: 780,
      delay,
      easing: OUT,
    });
  });

  // линии прорисовываются одна за другой
  const lines = [...root.querySelectorAll(".l")];
  lines.forEach((l, i) => {
    const span = LINK_MS[1] - LINK_MS[0];
    play(l, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: i < 2 ? span * 0.72 : span * 0.42,
      delay: LINK_MS[0] + (i < 2 ? i * 180 : span * 0.5 + i * 40),
      easing: IN_OUT,
    });
  });

  // сеть слегка поворачивается, затем закручивается к центру и гаснет
  play(net, [{ transform: "rotate(-9deg) scale(1.05)" }, { transform: "rotate(0deg) scale(1)" }], { duration: GATHER_AT, easing: "linear" }).onfinish = () => {
    if (exited) return;
    play(
      net,
      [
        { transform: "rotate(0deg) scale(1)", opacity: 1 },
        { transform: "rotate(62deg) scale(0.06)", opacity: 0 },
      ],
      { duration: GATHER_MS, easing: "cubic-bezier(0.62, 0, 0.3, 1)" },
    );
  };

  // свечение собирается в центре
  play(
    glow,
    [
      { opacity: 0, transform: "translate(-50%, -50%) scale(0.45)" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1.05)", offset: 0.65 },
      { opacity: 0.72, transform: "translate(-50%, -50%) scale(1)" },
    ],
    { duration: 1700, delay: GATHER_AT, easing: "ease-out" },
  );

  // знак прорисовывается, затем заполняется
  root.querySelectorAll(".in-mark path").forEach((p, i) => {
    play(p, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: MARK_MS, delay: MARK_AT + i * 60, easing: IN_OUT });
    play(p, [{ fillOpacity: 0, strokeOpacity: 1 }, { fillOpacity: 1, strokeOpacity: 0 }], { duration: 620, delay: FILL_AT, easing: "ease-out" });
  });
  play(stage, [{ transform: "translate(-50%, -50%) scale(0.94)" }, { transform: "translate(-50%, -50%) scale(1)" }], { duration: 1500, delay: MARK_AT, easing: OUT });

  // блик на знаке и волна по фону
  play(flare, [{ opacity: 0, transform: "translate(-50%, -50%) scale(0.2)" }, { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.28 }, { opacity: 0, transform: "translate(-50%, -50%) scale(1.25)" }], {
    duration: 1050,
    delay: FLARE_AT,
    easing: "ease-out",
  });
  timers.push(
    setTimeout(() => {
      const r = flare.getBoundingClientRect();
      ambient.pulse(r.left + r.width / 2, r.top + r.height / 2, 0.9);
    }, FLARE_AT),
  );

  // подпись
  play(
    caption,
    [
      { opacity: 0, letterSpacing: "0.62em", filter: "blur(6px)" },
      { opacity: 1, letterSpacing: "0.3em", filter: "blur(0)" },
    ],
    { duration: 1000, delay: CAPTION_AT, easing: OUT },
  );
  play(root.querySelector(".in-skip"), [{ opacity: 0 }, { opacity: 1 }], { duration: 800, delay: 900, easing: "ease" });
}

// место знака внутри логотипа в шапке
function target() {
  const lockups = [...document.querySelectorAll(".brand .lockup")];
  for (const el of lockups) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    // шапка в этот момент ещё в начале своего появления, поэтому смещения родителей вычитаем:
    // знак должен прилететь туда, где логотип окажется в конце
    let x = r.left;
    let y = r.top;
    for (let n = el; n && n !== html; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      if (t && t !== "none") {
        const m = new DOMMatrixReadOnly(t);
        x -= m.m41;
        y -= m.m42;
      }
    }
    if (x + r.width > 0 && x < innerWidth && y + r.height > 0 && y < innerHeight) {
      return { el, x, y, w: r.width * (2097 / 11440), h: r.height };
    }
  }
  return null;
}

const timers = [];
let exited = false;
let sound = null;

function exit() {
  if (exited) return;
  exited = true;
  timers.forEach(clearTimeout);
  sound?.exit(FLIGHT_MS / 1000);
  // всё недорисованное доводим сразу, кроме сети: она просто гаснет
  root.querySelectorAll(".in-mark path").forEach((p) => p.getAnimations().forEach((a) => a.finish()));

  const stage = root.querySelector(".in-stage");
  const from = stage.getBoundingClientRect();
  // с появлением сайта появится полоса прокрутки: слой интро сохраняет ширину, чтобы знак не дёрнулся
  root.style.width = `${root.offsetWidth}px`;
  root.style.right = "auto";

  html.classList.add("intro-exit", "intro-flying");
  html.classList.remove("intro-on");
  html.classList.add("is-revealed");
  const dest = target(); // после снятия скрытия: раскладка страницы уже окончательная
  ambient.spread(1);

  const fade = { duration: 520, easing: "ease-out", fill: "forwards" };
  for (const sel of [".in-net", ".in-skip", ".in-flare"]) root.querySelector(sel).animate({ opacity: 0 }, { ...fade, duration: 300 });
  root.querySelector(".in-glow").animate({ opacity: 0, transform: "translate(-50%, -50%) scale(1.5)" }, { ...fade, duration: 1000 });
  const caption = root.querySelector(".in-caption");
  caption.animate([{ opacity: getComputedStyle(caption).opacity, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(10px)" }], fade);

  let flight;
  if (dest) {
    const dx = dest.x + dest.w / 2 - (from.left + from.width / 2);
    const dy = dest.y + dest.h / 2 - (from.top + from.height / 2);
    const s0 = from.height / stage.offsetHeight;
    const s1 = dest.h / stage.offsetHeight;
    // плавная дуга: сначала вверх, потом к логотипу; масштаб меняется равномерно для глаза
    const STEPS = 28;
    const frames = Array.from({ length: STEPS + 1 }, (_, i) => {
      const t = i / STEPS;
      const bend = 2 * (1 - t) * t;
      const x = bend * dx * 0.12 + t * t * dx;
      const y = bend * dy * 0.72 + t * t * dy;
      return { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${s0 * (s1 / s0) ** t})` };
    });
    flight = stage.animate(frames, { duration: FLIGHT_MS, easing: "cubic-bezier(0.7, 0, 0.12, 1)", fill: "forwards" });
  } else {
    flight = stage.animate(
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        { transform: "translate(-50%, -50%) scale(0.82)", opacity: 0 },
      ],
      { duration: 620, easing: "ease-in", fill: "forwards" },
    );
  }
  const done = () => {
    if (dest) dest.el.classList.add("lockup-land");
    html.classList.remove("intro-flying");
    root.remove();
    setTimeout(() => html.classList.remove("intro-exit"), 2600);
    setTimeout(() => dest?.el.classList.remove("lockup-land"), 1400);
  };
  flight.onfinish = done;
  flight.oncancel = done;
}

if (root && html.classList.contains("intro-on")) {
  try {
    sessionStorage.setItem("upk-intro", "1");
  } catch {
    /* без хранилища интро просто покажется ещё раз */
  }
  startAmbient({ bloom: true });
  build();
  timeline();
  sound = introSound({ gather: GATHER_AT / 1000, flare: FLARE_AT / 1000, exit: EXIT_AT / 1000, flight: FLIGHT_MS / 1000 });
  timers.push(setTimeout(exit, EXIT_AT));
  root.addEventListener("click", exit, { once: true });
  window.addEventListener("keydown", exit, { once: true });
} else {
  root?.remove();
}
