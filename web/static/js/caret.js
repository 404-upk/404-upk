// Свой курсор ввода в полях: черта цвета сайта со свечением, плавно переезжает при наборе и стрелках
// и мягко «дышит» вместо резкого мигания. Системный курсор прячется только у поля, где свой уже стоит,
// поэтому при любой ошибке остаётся обычный. Поля паролей и чисел не трогаются: в них положение
// курсора нельзя надёжно измерить.

const FIELD = 'textarea, input:not([data-secret]):is([type="text"], [type="search"], [type="email"], [type="url"], [type="tel"], :not([type]))';
const COPY = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "fontStretch", "lineHeight",
  "letterSpacing", "wordSpacing", "textTransform", "textIndent", "tabSize", "textAlign",
];

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let caret = null;
let mirror = null;
let field = null;
let raf = 0;
let dirty = true;
let lastRect = "";
let lastPos = null;
let idleTimer = 0;

function make() {
  caret = document.createElement("div");
  caret.className = "ui-caret";
  caret.setAttribute("aria-hidden", "true");
  mirror = document.createElement("div");
  mirror.className = "ui-caret-mirror";
  mirror.setAttribute("aria-hidden", "true");
  document.body.append(caret, mirror);
}

/** Положение курсора на экране: копия поля с текстом до курсора и меткой на его месте */
function measure(el, r) {
  const cs = getComputedStyle(el);
  for (const key of COPY) mirror.style[key] = cs[key];
  const area = el.tagName === "TEXTAREA";
  mirror.style.whiteSpace = area ? "pre-wrap" : "pre";
  mirror.style.overflowWrap = area ? "break-word" : "normal";
  const pos = el.selectionEnd ?? 0;
  mirror.textContent = el.value.slice(0, pos);
  const mark = document.createElement("span");
  // метка шириной в символ после курсора, чтобы перенос строки считался так же, как в поле
  mark.textContent = el.value.slice(pos, pos + 1) || "\u200b";
  mirror.append(mark);
  const h = mark.offsetHeight;
  const x = r.left + parseFloat(cs.borderLeftWidth) + mark.offsetLeft - el.scrollLeft;
  // в однострочном поле текст стоит по центру высоты, в многострочном — по строкам
  const y = area ? r.top + parseFloat(cs.borderTopWidth) + mark.offsetTop - el.scrollTop : r.top + (r.height - h) / 2;
  return { x, y, h };
}

function frame() {
  raf = 0;
  if (!field || !field.isConnected || document.activeElement !== field) return detach();
  const r = field.getBoundingClientRect();
  const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
  if (key !== lastRect) {
    lastRect = key;
    dirty = true;
  }
  if (dirty) {
    dirty = false;
    const collapsed = field.selectionStart === field.selectionEnd;
    if (!collapsed) {
      caret.classList.remove("is-on");
    } else {
      const m = measure(field, r);
      const { x, y } = m;
      m.height = m.h;
      // за краем поля (прокрутка) курсор не рисуется
      const inside = x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 2 && y + m.height <= r.bottom + 2;
      const moved = !lastPos || Math.abs(lastPos.x - x) > 0.5 || Math.abs(lastPos.y - y) > 0.5;
      // переход на другую строку без проезда через весь текст
      const jump = lastPos && Math.abs(lastPos.y - y) > m.height * 0.6;
      caret.classList.toggle("no-glide", !lastPos || !!jump || reduced);
      caret.style.height = `${m.height}px`;
      caret.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      caret.classList.toggle("is-on", inside);
      if (moved) {
        lastPos = { x, y };
        // пока печатают, курсор горит ровно; после паузы снова «дышит»
        caret.classList.add("is-typing");
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => caret?.classList.remove("is-typing"), 550);
      }
    }
  }
  raf = requestAnimationFrame(frame);
}

function attach(el) {
  if (!caret) make();
  field = el;
  lastPos = null;
  lastRect = "";
  dirty = true;
  el.classList.add("has-ui-caret");
  caret.classList.remove("is-on");
  caret.classList.add("is-appearing");
  setTimeout(() => caret?.classList.remove("is-appearing"), 400);
  if (!raf) raf = requestAnimationFrame(frame);
}

function detach() {
  if (field) field.classList.remove("has-ui-caret");
  field = null;
  lastPos = null;
  caret?.classList.remove("is-on");
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function start() {
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (el instanceof HTMLElement && el.matches(FIELD) && !el.readOnly && !el.disabled) attach(el);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === field) detach();
  });
  const touch = () => {
    dirty = true;
  };
  document.addEventListener("selectionchange", touch);
  document.addEventListener("input", touch, true);
  document.addEventListener("keydown", touch, true);
  document.addEventListener("scroll", touch, true);
  window.addEventListener("resize", touch);
}

if (document.body && "selectionStart" in HTMLInputElement.prototype) start();
