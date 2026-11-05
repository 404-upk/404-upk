// Общие утилиты для всех страниц: запросы к API, иконки, форматирование, тосты, модалки.

import { SPARK_PATH } from "./cursor.js";
import { liftable } from "./lift.js";
import "./selection.js";
import { playSection, setSound, soundOn } from "./sound.js";
import "./caret.js";
import "./select.js";

const ICONS = {
  logo: '<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.6A8.5 8.5 0 1 1 21 12Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.5"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7-7-1Z"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
  sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M2 13v2M22 13v2"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z"/><path d="M9 4v13.5M15 6.5V20"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
  // половина круга закрашена: значок темы «Кромешная тьма»
  dark: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.7-8.95A6 6 0 0 1 17.9 10a4.25 4.25 0 0 1-.65 8.5z"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>',
  volumeOff: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M14.5 9.5 20 4M8.1 15.9 11 13"/>',
  selectAll: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M9 12h6"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="6" rx="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  filter: '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5Z"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  telegram: '<path d="m21 4-18 7.5 6 2L11 20l3.5-4.5L19 19l2-15Z"/><path d="m9 13.5 7-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 3 1.1-6.2L3 9.7l6.2-.9L12 3Z"/>',
  message: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  play: '<path d="M7 5v14l11-7L7 5Z"/>',
  users2: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  flame: '<path d="M12 21c4 0 7-2.7 7-6.5 0-3.5-2.5-5.5-4-8-1 2-2 3-3.5 3.5C11 7 11 5 10 3c-3 3-5 6.5-5 11.5C5 18.3 8 21 12 21Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  // категории
  equipment: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  furniture: '<path d="M6 11V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6"/><path d="M4 11h16v4H4z"/><path d="M6 15v6M18 15v6"/>',
  electricity: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  network: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16a5 5 0 0 1 6 0"/><path d="M12 19.5h.01"/>',
  cleaning: '<path d="M14 3 9 12"/><path d="M5 12h8l2 9H3l2-9Z"/><path d="M7 16v5M10 16v5"/>',
  plumbing: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  climate: '<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z"/><path d="M12 11v6"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
};

export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.other}</svg>`;
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export class ApiError extends Error {
  constructor(message, status, { network = false } = {}) {
    super(message);
    this.status = status;
    // нет связи или сервер не ответил вовремя: запрос можно повторить, когда сеть вернётся
    this.network = network;
  }
}

const TEXT_OFFLINE = "Нет интернета.";
const TEXT_NO_SERVER = "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";
const TEXT_TIMEOUT = "Сервер долго не отвечает. Проверьте интернет и попробуйте ещё раз.";
const TEXT_DOWN = "Сервер временно недоступен. Попробуйте ещё раз через минуту.";

/**
 * Запрос к API. timeout — сколько ждать ответа, мс: на медленной сети запрос не висит бесконечно.
 * Ответы ИИ и отправка заявки с фото ждут дольше, чем обычные запросы.
 */
export async function api(path, { method = "GET", body, form, signal, timeout } = {}) {
  const limit = timeout ?? (method === "GET" ? 20000 : 60000);
  const timer = new AbortController();
  const stop = setTimeout(() => timer.abort(), limit);
  const signals = signal ? [signal, timer.signal] : [timer.signal];
  const opts = {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: AbortSignal.any ? AbortSignal.any(signals) : timer.signal,
  };
  if (form) {
    opts.body = form;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let resp;
  try {
    resp = await fetch(path, opts);
  } catch (err) {
    // отмена вызывающим кодом пробрасывается как есть, отмена по таймеру — понятная ошибка
    if (err.name === "AbortError" && signal?.aborted) throw err;
    const text = timer.signal.aborted ? TEXT_TIMEOUT : navigator.onLine === false ? TEXT_OFFLINE : TEXT_NO_SERVER;
    throw new ApiError(text, 0, { network: true });
  } finally {
    clearTimeout(stop);
  }
  let data = null;
  const type = resp.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
  }
  if (!resp.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : null;
    // прокси или сервер не поднялись: ответ не от приложения
    if (!detail && [502, 503, 504].includes(resp.status)) throw new ApiError(TEXT_DOWN, resp.status, { network: true });
    throw new ApiError(detail || "Сервер вернул ошибку, попробуйте ещё раз.", resp.status);
  }
  return data;
}

// ---------- нет сети и ошибки загрузки ----------

/** Выполнить fn один раз, когда появится связь. Возвращает функцию отмены. */
export function whenOnline(fn) {
  const run = () => fn();
  window.addEventListener("online", run, { once: true });
  return () => window.removeEventListener("online", run);
}

/**
 * Блок ошибки с кнопкой «Повторить». Если ошибка из-за сети, повтор выполнится сам, когда связь вернётся.
 * Возвращает элемент, который нужно вставить на страницу.
 */
export function errorBlock(err, retry, { compact = false } = {}) {
  const el = h(`
    <div class="notice notice-danger error-block${compact ? " is-compact" : ""}" role="alert">${icon("alert")}
      <div class="grow">${esc(err?.message || err || "Не удалось загрузить данные.")}</div>
      <button type="button" class="btn btn-sm">${icon("refresh", "icon-sm")}Повторить</button>
    </div>`);
  let cancel = null;
  const again = () => {
    cancel?.();
    const btn = el.querySelector("button");
    setBusy(btn, true);
    Promise.resolve(retry()).finally(() => btn.isConnected && setBusy(btn, false));
  };
  el.querySelector("button").addEventListener("click", again);
  if (err?.network) cancel = whenOnline(() => el.isConnected && again());
  return el;
}

let netBanner = null;

/** Плашка «Нет интернета» вверху экрана на всех страницах; когда связь вернулась — короткое сообщение */
function watchNetwork() {
  const show = () => {
    if (netBanner) return;
    netBanner = h(`<div class="net-banner" role="status">${icon("alert", "icon-sm")}Нет интернета. Введённое не пропадёт</div>`);
    document.body.append(netBanner);
  };
  window.addEventListener("offline", show);
  window.addEventListener("online", () => {
    if (!netBanner) return;
    leaveAndRemove(netBanner);
    netBanner = null;
    toast("Связь восстановлена");
  });
  if (navigator.onLine === false) show();
}

// ---------- черновики на этом устройстве ----------

export const drafts = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(`upk-draft-${key}`));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`upk-draft-${key}`, JSON.stringify(value));
    } catch {
      /* хранилище недоступно: черновик живёт только до перезагрузки */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(`upk-draft-${key}`);
    } catch {
      /* нечего удалять */
    }
  },
};

/** Страница открывается без сети: оболочка сайта сохраняется на устройстве (только публичные страницы) */
export function enableOffline() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  // копии для работы без сети качаются, когда страница открылась и браузер свободен, а не во время первой загрузки
  const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
  const whenFree = () => (window.requestIdleCallback ? requestIdleCallback(register, { timeout: 4000 }) : setTimeout(register, 1500));
  if (document.readyState === "complete") whenFree();
  else window.addEventListener("load", whenFree, { once: true });
}

// ---------- даты ----------

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function parseDate(iso) {
  return iso ? new Date(iso) : null;
}

export function fmtDate(iso, withTime = true) {
  const d = parseDate(iso);
  if (!d) return "";
  const now = new Date();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
  let day;
  if (sameDay) day = "сегодня";
  else if (yesterday) day = "вчера";
  else day = `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : ""}`;
  return withTime ? `${day}, ${time}` : day;
}

export function relTime(iso) {
  const d = parseDate(iso);
  if (!d) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн назад`;
  return fmtDate(iso, false);
}

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// ---------- чипы ----------

export function statusChip(status, label, big = false) {
  return `<span class="chip st-${esc(status)}${big ? " chip-lg" : ""}"><span class="dot"></span>${esc(label)}</span>`;
}

export function priorityChip(priority, label) {
  const mark = priority === "critical" ? icon("flame", "icon-sm") : "";
  return `<span class="chip pr-${esc(priority)}">${mark}${esc(label)}</span>`;
}

// ---------- тосты ----------

function toastHost() {
  let host = $(".toasts");
  if (!host) {
    host = h('<div class="toasts" role="status" aria-live="polite"></div>');
    document.body.append(host);
  }
  return host;
}

export function toast(message, type = "ok") {
  const el = h(`<div class="toast ${type}">${icon(type === "error" ? "alert" : "checkCircle")}<div>${esc(message)}</div></div>`);
  toastHost().append(el);
  setTimeout(() => leaveAndRemove(el), type === "error" ? 6000 : 3500);
}

/** Элемент доигрывает анимацию ухода (.is-leaving) и убирается со страницы */
export function leaveAndRemove(el, after) {
  if (!el || el.classList.contains("is-leaving")) return;
  el.classList.add("is-leaving");
  let gone = false;
  const finish = () => {
    if (gone) return;
    gone = true;
    el.remove();
    after?.();
  };
  setTimeout(finish, 340);
}

// ---------- модалки ----------

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalStack = [];
let modalSeq = 0;

function focusableIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
}

/** Одно общее нажатие клавиш для верхней модалки: Escape закрывает, Tab не выходит за её пределы */
function onModalKey(e) {
  const top = modalStack[modalStack.length - 1];
  if (!top) return;
  if (e.key === "Escape") {
    e.preventDefault();
    top.close();
    return;
  }
  if (e.key !== "Tab") return;
  const items = focusableIn(top.el);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!top.el.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// на телефоне окно — лист снизу (app.css): его можно смахнуть вниз за ручку и заголовок, как на iPhone
const SHEET = matchMedia("(max-width: 560px)");
function swipeToClose(sheet, close) {
  const head = sheet?.querySelector(".modal-head");
  if (!head) return;
  let y0 = null;
  let dy = 0;
  let t0 = 0;
  head.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || !SHEET.matches || e.target.closest("button, a, input, select, textarea")) return;
    y0 = e.clientY;
    dy = 0;
    t0 = performance.now();
    try {
      head.setPointerCapture(e.pointerId);
    } catch {
      /* без захвата лист всё равно тянется, пока палец над заголовком */
    }
    sheet.classList.add("is-dragging");
  });
  head.addEventListener("pointermove", (e) => {
    if (y0 == null) return;
    // вверх лист почти не тянется, вниз — за пальцем
    const raw = e.clientY - y0;
    dy = raw > 0 ? raw : raw / 6;
    sheet.style.setProperty("--sheet-y", `${dy}px`);
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    sheet.classList.remove("is-dragging");
    const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
    if (dy > 110 || (fast && dy > 30)) close();
    else sheet.style.setProperty("--sheet-y", "0px");
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}

export function openModal({ title, body, footer = "", wide = false, onMount }) {
  const titleId = `modal-title-${++modalSeq}`;
  const opener = document.activeElement;
  const overlay = h(`
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal">
        <div class="modal-head"><h2 id="${titleId}">${esc(title)}</h2>
          <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Закрыть">${icon("x")}</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
      </div>
    </div>`);
  if (wide) overlay.querySelector(".modal").style.width = "min(760px,100%)";
  let closed = false;
  const entry = { el: overlay, close: null };
  const close = () => {
    if (closed) return;
    closed = true;
    const at = modalStack.indexOf(entry);
    if (at >= 0) modalStack.splice(at, 1);
    if (!modalStack.length) document.removeEventListener("keydown", onModalKey);
    leaveAndRemove(overlay);
    // фокус возвращается туда, откуда окно открыли
    if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
  };
  entry.close = close;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest("[data-close]")) close();
  });
  if (!modalStack.length) document.addEventListener("keydown", onModalKey);
  modalStack.push(entry);
  document.body.append(overlay);
  swipeToClose(overlay.querySelector(".modal"), close);
  // в окнах с формами подсказки браузера не нужны; где они уместны, поле само задаёт autocomplete
  overlay.querySelectorAll("input:not([autocomplete]), textarea:not([autocomplete])").forEach((n) => n.setAttribute("autocomplete", "off"));
  onMount?.(overlay, close);
  const first = overlay.querySelector("input, textarea, select") || overlay.querySelector(".modal-foot .btn, [data-close]");
  first?.focus();
  return { el: overlay, close };
}

export function confirmDialog(title, text, okLabel = "Подтвердить", danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title,
      body: `<p class="muted">${esc(text)}</p>`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(okLabel)}</button>`,
      onMount(el, close) {
        el.querySelector("[data-ok]").addEventListener("click", () => {
          answered = true;
          close();
          resolve(true);
        });
        const observer = new MutationObserver(() => {
          if (!el.isConnected) {
            observer.disconnect();
            if (!answered) resolve(false);
          }
        });
        observer.observe(document.body, { childList: true });
      },
    });
  });
}

export function lightbox(src) {
  const opener = document.activeElement;
  const el = h(`<div class="lightbox" role="dialog" aria-modal="true" aria-label="Фото"><button class="btn btn-ghost btn-icon lightbox-close" aria-label="Закрыть">${icon("x")}</button><img src="${esc(src)}" alt="Фото"></div>`);
  const close = () => {
    document.removeEventListener("keydown", onKey);
    leaveAndRemove(el);
    if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "Tab") {
      e.preventDefault();
      el.querySelector("button").focus();
    }
  };
  el.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.append(el);
  el.querySelector("button").focus();
}

// ---------- фото к заявке ----------
// Снимок с iPhone бывает 6–15 МБ и в формате HEIC: такой не пройдёт по размеру, а предпросмотр
// и сотрудники в панели его могут не увидеть. Фото уменьшается до 2560 точек по длинной стороне
// и сохраняется в JPEG прямо на устройстве: загрузка быстрее, качества для заявки хватает.

const PHOTO_SIDE = 2560;
const PHOTO_KEEP = 2.5 * 1024 * 1024; // меньше этого JPEG, PNG и WebP остаются как есть
const preparedPhotos = new WeakSet();

async function decodePhoto(file) {
  // createImageBitmap сам поворачивает снимок по EXIF; если не умеет этот формат, пробуем через <img>
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* ниже второй способ */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Фото, готовое к заявке: уменьшенное и в JPEG, если нужно. Если браузер не смог его прочитать, возвращается как было */
export async function preparePhoto(file) {
  if (!file || preparedPhotos.has(file)) return file;
  let pic;
  try {
    // браузер не справился за 6 секунд (очень большой снимок, редкий формат): фото остаётся как было
    pic = await Promise.race([decodePhoto(file), new Promise((_, fail) => setTimeout(() => fail(new Error("timeout")), 6000))]);
  } catch {
    return file;
  }
  const w = pic.width || pic.naturalWidth;
  const hgt = pic.height || pic.naturalHeight;
  const common = /^image\/(jpeg|png|webp)$/.test(file.type);
  if (common && file.size <= PHOTO_KEEP && Math.max(w, hgt) <= PHOTO_SIDE) {
    pic.close?.();
    preparedPhotos.add(file);
    return file;
  }
  const k = Math.min(1, PHOTO_SIDE / Math.max(w, hgt));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(hgt * k);
  const g = canvas.getContext("2d");
  // прозрачный скриншот на белом фоне, а не на чёрном
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(pic, 0, 0, canvas.width, canvas.height);
  pic.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) return file;
  const name = `${(file.name || "photo").replace(/\.[^.]+$/, "") || "photo"}.jpg`;
  const out = new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
  preparedPhotos.add(out);
  return out;
}

/**
 * Обычный выбор фото браузера, когда своего окна нет. Поле обязательно лежит на странице:
 * iOS Safari не сообщает о выбранном файле, если поле не прикреплено к документу.
 */
export function chooseFileNative(onFile, { capture = "" } = {}) {
  // поле от прошлого раза, если выбор тогда отменили, а браузер не сообщил об отмене
  document.querySelectorAll(".native-photo").forEach((n) => n.remove());
  const input = h(`<input type="file" accept="image/*" class="sr-only native-photo" tabindex="-1" aria-hidden="true"${capture ? ` capture="${esc(capture)}"` : ""}>`);
  const cleanup = () => setTimeout(() => input.remove(), 0);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    cleanup();
    if (file) onFile(file);
  });
  input.addEventListener("cancel", cleanup);
  document.body.append(input);
  input.click();
}

export function setBusy(button, busy, text) {
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${text ? esc(text) : ""}`;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Скопировано");
  } catch {
    const area = h(`<textarea class="u-offscreen">${esc(text)}</textarea>`);
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast("Скопировано");
  }
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- локальное хранилище (может быть недоступно в приватном режиме) ----------

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ничего страшного */
    }
  },
};

// ---------- тема ----------

// бренд 404 тёмный: светлая тема — только по выбору человека
export function currentTheme() {
  return store.get("upk-theme") || "dark";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // строка состояния телефона в цвет фона темы
  const bg = { dark: "#0c1222", light: "#edf0f4", black: "#000000", sky: "#96b1e6" }[theme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#0c1222");
}

// четыре темы на выбор; id остаются техническими, человек видит названия
export const THEMES = [
  { id: "dark", name: "Полночь", note: "Тёмная, основная", icon: "moon" },
  { id: "light", name: "Горный снег", note: "Светлая", icon: "sun" },
  { id: "black", name: "Кромешная тьма", note: "Чёрная", icon: "dark" },
  { id: "sky", name: "Небо", note: "Голубая", icon: "cloud" },
];
const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

// Искра знака 404 в точке (x, y) с размахом лучей size
const logoSpark = (x, y, size, fill) => `<path transform="translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})" fill="${fill}" d="${SPARK_PATH}"/>`;
// Знак каждой темы. Цвета постоянные: значок показывает саму тему, а не текущую
const THEME_LOGOS = {
  dark: `<path fill="#edf0f4" transform="translate(2.2 3.6) scale(0.74)" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>${logoSpark(17.4, 7, 7, "#8ea6d8")}`,
  light: `<path fill="#4c68a6" d="M1.8 20 9.6 6.6l4.3 7.2 2.3-3.4L22.2 20z"/><path fill="#ffffff" d="M9.6 6.6 6.9 11.2l1.5-.7 1.2 1.1 1.2-1.1 1.5.8zM16.2 10.4l-1.7 2.5 1-.5.7.7.8-.6 1 .5z"/>${logoSpark(18.6, 5.6, 5.4, "#0c1222")}`,
  black: `<circle cx="12" cy="12" r="8.6" fill="none" stroke="#3d4f78" stroke-width="0.8"/>${logoSpark(12, 12, 13, "#e6e8ec")}`,
  sky: `${logoSpark(7, 7.2, 8, "#27407a")}<path fill="#ffffff" d="M7.4 19.2a3.7 3.7 0 0 1-.5-7.4 5.2 5.2 0 0 1 10-1.2 4.3 4.3 0 0 1 .3 8.6z"/>`,
};
const themeLogo = (id) => `<span class="theme-swatch ts-${esc(id)} is-mini" aria-hidden="true"><svg viewBox="0 0 24 24">${THEME_LOGOS[id] || ""}</svg></span>`;

/** Смена темы с анимацией из точки (x, y): новая тема раскрывается знаком 404, в «Кромешную тьму» прежняя сворачивается */
function switchTheme(next, x, y, onDone) {
  const flip = () => {
    store.set("upk-theme", next);
    applyTheme(next);
    onDone?.();
  };
  const wave = (strength) => window.dispatchEvent(new CustomEvent("upk:theme", { detail: { x, y, strength } }));
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    flip();
    return;
  }
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const root = document.documentElement;
  const collapse = next === "black";
  root.classList.toggle("vt-collapse", collapse);
  const transition = document.startViewTransition(flip);
  transition.ready.then(() => {
    const frames = sparkFrames(x, y, radius);
    root.animate(
      { clipPath: collapse ? frames.reverse() : frames },
      collapse
        ? { duration: 820, easing: "cubic-bezier(0.55, 0, 0.8, 0.2)", pseudoElement: "::view-transition-old(root)", fill: "forwards" }
        : { duration: 980, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
    );
    if (!collapse) wave(1.3);
  });
  transition.finished.finally(() => {
    root.classList.remove("vt-collapse");
    if (collapse) wave(0.7);
  });
}

function soundButton() {
  const b = h('<button type="button" class="btn btn-ghost btn-icon btn-sm sound-btn"></button>');
  const render = () => {
    const on = soundOn();
    b.innerHTML = icon(on ? "volume" : "volumeOff");
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", "Звук");
    b.dataset.tip = on ? "Звук включён" : "Звук выключен";
  };
  b.addEventListener("click", () => setSound(!soundOn()));
  window.addEventListener("upk:sound", render);
  render();
  return b;
}

/**
 * Кнопка темы открывает меню с тремя темами: название, подпись и образец цветов.
 * Стрелки ходят по пунктам, Enter или пробел выбирает, Escape закрывает, фокус возвращается на кнопку.
 */
export function themeToggle(button) {
  if (!button.previousElementSibling?.classList.contains("sound-btn")) button.before(soundButton());
  const render = () => {
    const now = themeById(currentTheme());
    button.innerHTML = icon(now.icon);
    button.setAttribute("aria-label", `Тема: ${now.name}. Выбрать тему`);
    button.dataset.tip = `Тема: ${now.name}`;
  };
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  let menu = null;

  const close = (focus = true) => {
    if (!menu) return;
    const old = menu;
    menu = null;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("resize", place);
    button.setAttribute("aria-expanded", "false");
    old.classList.add("is-leaving");
    setTimeout(() => old.remove(), 160);
    if (focus) button.focus();
  };
  const items = () => [...(menu?.querySelectorAll("[data-theme-pick]") || [])];
  const pick = (id) => {
    const r = button.getBoundingClientRect();
    close();
    if (id === currentTheme()) return;
    switchTheme(id, r.left + r.width / 2, r.top + r.height / 2, render);
  };
  function onKey(e) {
    if (!menu) return;
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      // карточки стоят в ряд: стрелки вправо и вниз — следующая, влево и вверх — предыдущая
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
      list[(i + step + list.length) % list.length].focus();
    } else if (e.key === "Home") list[0].focus();
    else if (e.key === "End") list[list.length - 1].focus();
    else if (e.key === "Tab") {
      close(false);
      return;
    } else return;
    e.preventDefault();
  }
  function onDown(e) {
    if (menu && !menu.contains(e.target) && !button.contains(e.target)) close(false);
  }
  function place() {
    if (!menu) return;
    const r = button.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const up = r.bottom + mh + 12 > innerHeight && r.top - mh - 12 > 0;
    menu.style.left = `${Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8))}px`;
    menu.style.top = `${up ? r.top - mh - 8 : r.bottom + 8}px`;
    menu.classList.toggle("is-up", up);
  }
  // мини-превью сайта в каждой теме: шапка со знаком, заголовок, поле ввода и блок колледжа
  const preview = (id) => `
    <span class="tp-shot tp-${id}" aria-hidden="true">
      <span class="tp-top"><svg viewBox="0 0 24 24"><path d="${SPARK_PATH}"/></svg><i></i></span>
      <span class="tp-hero"></span><span class="tp-sub"></span>
      <span class="tp-field"><i></i></span>
      <span class="tp-side"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      ${id === "black" ? '<span class="tp-glow"></span>' : ""}
    </span>`;
  let opening = false;
  const open = async () => {
    if (opening) return;
    opening = true;
    await loadCss("/static/css/theme-picker.css");
    opening = false;
    if (menu) return;
    const now = currentTheme();
    menu = h(`
      <div class="tpick" role="menu" aria-label="Тема оформления">
        <div class="tpick-head">
          <span class="tpick-title"><svg class="tpick-spark" viewBox="0 0 24 24" aria-hidden="true"><path d="${SPARK_PATH}"/></svg>Тема оформления</span>
          <span class="tpick-now">сейчас: ${esc(themeById(now).name)}</span>
        </div>
        <div class="tpick-grid">
          ${THEMES.map(
            (t) => `<button type="button" class="tpick-card" role="menuitemradio" aria-checked="${t.id === now}" data-theme-pick="${t.id}">
              ${preview(t.id)}
              <span class="tpick-name">${esc(t.name)}</span>
              <span class="tpick-note">${esc(t.note)}</span>
              <span class="tpick-mark">${icon("check", "icon-sm")}</span>
            </button>`,
          ).join("")}
        </div>
      </div>`);
    document.body.append(menu);
    place();
    button.setAttribute("aria-expanded", "true");
    menu.addEventListener("click", (e) => {
      const opt = e.target.closest("[data-theme-pick]");
      if (opt) pick(opt.dataset.themePick);
    });
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", place);
    (menu.querySelector('[aria-checked="true"]') || items()[0]).focus({ preventScroll: true });
  };

  button.addEventListener("click", () => (menu ? close() : open()));
  button.addEventListener("upk:theme-render", render);
  button.addEventListener("keydown", (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !menu) {
      e.preventDefault();
      open();
    }
  });
  render();
}

// ---------- стили по требованию ----------
// Стили редких окон (план этажа, выбор темы) грузятся при первом открытии, чтобы не утяжелять старт страницы.
const cssLoading = {};
export function loadCss(href) {
  if (!cssLoading[href]) {
    cssLoading[href] = new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = link.onerror = () => resolve();
      document.head.append(link);
    });
  }
  return cssLoading[href];
}

// ---------- подсказки при наведении ----------
// Системная подсказка из title заменяется своей, в стиле сайта и в цветах темы.
// title переносится в data-tip, чтобы браузер не показывал свою поверх.

let tipEl = null;
let tipFor = null;
let tipTimer = 0;

function adoptTitle(el) {
  if (!el.hasAttribute("title")) return;
  const text = el.getAttribute("title");
  el.removeAttribute("title");
  if (!text) return;
  el.dataset.tip = text;
  // подсказка не должна пропасть для экранных читалок
  if (!el.getAttribute("aria-label") && !el.textContent.trim()) el.setAttribute("aria-label", text);
  else if (el.getAttribute("aria-label") !== text && el.textContent.trim() !== text) el.setAttribute("aria-description", text);
}

function hideTip() {
  clearTimeout(tipTimer);
  tipFor = null;
  if (tipEl) tipEl.classList.remove("is-on");
}

function showTip(el) {
  const text = el.dataset.tip;
  if (!text || !el.isConnected) return;
  if (!tipEl) {
    tipEl = h('<div class="ui-tip" aria-hidden="true"></div>');
    document.body.append(tipEl);
  }
  tipEl.textContent = text;
  const r = el.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  const below = r.bottom + th + 10 < innerHeight;
  tipEl.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, innerWidth - tw - 8))}px`;
  tipEl.style.top = `${below ? r.bottom + 8 : r.top - th - 8}px`;
  tipEl.classList.toggle("is-above", !below);
  tipEl.classList.add("is-on");
}

function tipTarget(node) {
  const el = node?.closest?.("[title], [data-tip]");
  if (!el || el.closest(".pf, svg")) return null;
  adoptTitle(el);
  return el.dataset.tip ? el : null;
}

function watchTips() {
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = tipTarget(e.target);
    if (el === tipFor) return;
    hideTip();
    if (!el) return;
    tipFor = el;
    tipTimer = setTimeout(() => tipFor === el && showTip(el), 380);
  });
  document.addEventListener("pointerout", (e) => {
    if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip();
  });
  // с клавиатуры подсказка показывается при фокусе
  document.addEventListener("focusin", (e) => {
    const el = tipTarget(e.target);
    if (el && e.target.matches(":focus-visible")) {
      tipFor = el;
      showTip(el);
    }
  });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("pointerdown", hideTip, true);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hideTip());
  window.addEventListener("scroll", hideTip, { passive: true, capture: true });
}

// ---------- куда ведёт ссылка ----------
// Браузер при наведении на ссылку показывает внизу слева свою серую строку с полным адресом.
// Вместо неё своя подсказка в стиле сайта: что откроется и короткий адрес. Пока мышь над ссылкой,
// адрес лежит в data-href, поэтому системная строка не появляется. Левая кнопка возвращает его только
// при отпускании: пока она зажата, нет ни системной строки, ни системного перетаскивания (своё в lift.js).
// Другие кнопки и Enter возвращают адрес сразу, до того как браузер их обработает: новая вкладка,
// Ctrl + клик, средняя кнопка и «Копировать адрес ссылки» работают как обычно.

const LINK_NAMES = [
  [/^\/$/, "Страница заявителя"],
  [/^\/track\/?$/, "Отслеживание заявки"],
  [/^\/t\//, "Ход заявки"],
  [/^\/r\//, "Форма заявки"],
  [/^\/privacy\/?$/, "Обработка данных"],
  [/^\/admin\/qr-print\/?$/, "Печать QR-кодов"],
  [/\/qr\.png$/, "QR-код помещения"],
  [/\/export\.(xlsx|csv)$/, "Выгрузка заявок"],
  [/^\/admin\/?$/, "Панель УПК"],
];
const FILE_LINK = /\.(xlsx|csv|png|jpe?g|pdf|zip)$/i;

let hashNames = null;
let linkEl = null;
let linkBox = null;
let linkHide = 0;
let linkX = 0;
let linkY = 0;

/** Страница называет свои разделы для подсказки: панель передаёт названия из меню (#/tickets → «Заявки») */
export function nameHashLinks(fn) {
  hashNames = fn;
}

/** Адрес ссылки, даже если он сейчас спрятан в data-href */
export function linkHref(a) {
  const raw = a?.getAttribute("href") ?? a?.dataset.href;
  if (raw == null) return "";
  try {
    return new URL(raw, location.href).href;
  } catch {
    return "";
  }
}

function linkInfo(a) {
  let url;
  try {
    url = new URL(a.getAttribute("href") ?? a.dataset.href, location.href);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return { name: "Написать письмо", path: decodeURIComponent(url.pathname), kind: "mail" };
  if (url.protocol === "tel:") return { name: "Позвонить", path: url.pathname, kind: "tel" };
  // javascript:, data: и прочее остаётся браузеру
  if (!/^https?:$/.test(url.protocol)) return null;
  const same = url.origin === location.origin;
  let name = null;
  if (same) {
    if (url.hash.startsWith("#/") && hashNames) name = hashNames(url.hash);
    if (!name) name = LINK_NAMES.find(([re]) => re.test(url.pathname))?.[1] || null;
    if (!name && url.hash && url.pathname === location.pathname) name = "На этой странице";
  } else if (/(^|\.)t\.me$/.test(url.hostname)) {
    name = "Telegram";
  }
  let path = same ? url.pathname + url.search + url.hash : url.host + url.pathname.replace(/\/$/, "") + url.search;
  try {
    path = decodeURI(path);
  } catch {
    /* адрес с битой кодировкой показываем как есть */
  }
  const file = a.hasAttribute("download") || (same && FILE_LINK.test(url.pathname));
  const tab = a.target === "_blank";
  return { name, path, kind: file ? "file" : !same ? "away" : tab ? "tab" : "here", flag: file ? "файл" : tab ? "новая вкладка" : "" };
}

function stashHref(a) {
  if (!a.hasAttribute("href")) return;
  // без href ссылка перестала бы быть ссылкой для клавиатуры и экранных читалок, это временно возвращается;
  // сначала tabindex, чтобы ссылка под фокусом его не потеряла
  if (!a.hasAttribute("tabindex")) {
    a.setAttribute("tabindex", "0");
    a.dataset.hrefTab = "";
  }
  if (!a.hasAttribute("role")) {
    a.setAttribute("role", "link");
    a.dataset.hrefRole = "";
  }
  a.dataset.href = a.getAttribute("href");
  a.removeAttribute("href");
}

function restoreHref(a) {
  if (!a || a.dataset.href === undefined) return;
  // если адрес за это время поставили заново (выгрузка с фильтрами), остаётся новый
  if (!a.hasAttribute("href")) a.setAttribute("href", a.dataset.href);
  delete a.dataset.href;
  if (a.dataset.hrefTab !== undefined) {
    a.removeAttribute("tabindex");
    delete a.dataset.hrefTab;
  }
  if (a.dataset.hrefRole !== undefined) {
    a.removeAttribute("role");
    delete a.dataset.hrefRole;
  }
}

const LINK_ICON = { here: null, tab: "external", away: "external", file: "download", mail: "send", tel: "info" };

function showLink(info, x, y) {
  clearTimeout(linkHide);
  if (!linkBox) {
    linkBox = h('<div class="ui-link" aria-hidden="true"><span class="ui-link-ic"></span><span class="ui-link-text"></span><span class="ui-link-flag"></span></div>');
    document.body.append(linkBox);
  }
  const ic = LINK_ICON[info.kind];
  linkBox.querySelector(".ui-link-ic").innerHTML = ic ? icon(ic, "icon-sm") : `<svg class="spark" viewBox="0 0 24 24"><path d="${SPARK_PATH}"/></svg>`;
  linkBox.querySelector(".ui-link-text").innerHTML = `${info.name ? `<b>${esc(info.name)}</b>` : ""}<span class="ui-link-url">${esc(info.path)}</span>`;
  const flag = linkBox.querySelector(".ui-link-flag");
  flag.textContent = info.flag || "";
  flag.hidden = !info.flag;
  linkBox.classList.toggle("is-away", info.kind !== "here");
  // подсказка уходит направо, если мышь в её углу, как у браузера
  linkBox.classList.remove("is-right");
  const r = linkBox.getBoundingClientRect();
  linkBox.classList.toggle("is-right", x < r.width + 40 && y > innerHeight - r.height - 48);
  // новая ссылка — текст въезжает заново
  linkBox.classList.remove("is-swap");
  void linkBox.offsetWidth;
  linkBox.classList.add("is-on", "is-swap");
}

function hideLink() {
  clearTimeout(linkHide);
  // между соседними ссылками подсказка не мигает: прячется с небольшой задержкой
  linkHide = setTimeout(() => linkBox?.classList.remove("is-on"), 90);
}

function leaveLink() {
  if (!linkEl) return;
  restoreHref(linkEl);
  linkEl = null;
  hideLink();
}

function watchLinks() {
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const a = e.target.closest?.("a[href], a[data-href]");
    if (a === linkEl) return;
    leaveLink();
    const info = a && linkInfo(a);
    if (!info) return;
    linkEl = a;
    linkX = e.clientX;
    linkY = e.clientY;
    stashHref(a);
    // пока что-то несут, подсказка не отвлекает; системная строка не появится, адрес всё равно спрятан
    if (!document.documentElement.classList.contains("is-lifting")) showLink(info, linkX, linkY);
  });
  document.addEventListener("pointerout", (e) => {
    if (linkEl && e.pointerType === "mouse" && !linkEl.contains(e.relatedTarget)) leaveLink();
  });
  // Переход клавишей Tab: браузер тоже показал бы свою строку
  document.addEventListener("focusin", (e) => {
    const a = e.target.closest?.("a[href], a[data-href]");
    if (!a || a === linkEl || !a.matches(":focus-visible")) return;
    const info = linkInfo(a);
    if (!info) return;
    leaveLink();
    linkEl = a;
    const r = a.getBoundingClientRect();
    linkX = r.left;
    linkY = r.bottom;
    stashHref(a);
    showLink(info, linkX, linkY);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === linkEl && !linkEl.matches(":hover")) leaveLink();
  });
  // нажатие: другие кнопки возвращают адрес раньше, чем браузер решит, что делать со ссылкой
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!linkEl) return;
      hideLink();
      if (e.pointerType !== "mouse" || e.button !== 0) restoreHref(linkEl);
    },
    true,
  );
  // отпустили левую кнопку: адрес на месте раньше, чем браузер обработает клик
  document.addEventListener(
    "pointerup",
    (e) => {
      if (linkEl && e.button === 0) restoreHref(linkEl);
    },
    true,
  );
  liftable("a[href], a[data-href]", (a) => {
    const info = linkInfo(a);
    if (!info) return null;
    const title = info.name || a.textContent.trim().replace(/\s+/g, " ").slice(0, 60) || info.path;
    return h(`<div class="link-lift"><svg viewBox="0 0 24 24"><path d="${SPARK_PATH}"/></svg>
      <span class="link-lift-text"><b>${esc(title)}</b><span class="link-lift-url">${esc(info.path)}</span></span></div>`);
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && e.target?.dataset?.href !== undefined) restoreHref(e.target);
    },
    true,
  );
  // после нажатия мышь может остаться над ссылкой: адрес снова прячется, подсказка возвращается
  // (кроме правой кнопки: там уже открыто меню)
  const again = (e) =>
    setTimeout(() => {
      if (!linkEl) return;
      if (!linkEl.isConnected) {
        linkEl = null;
        return;
      }
      if (!linkEl.matches(":hover, :focus-visible")) return;
      stashHref(linkEl);
      const info = e.type === "contextmenu" ? null : linkInfo(linkEl);
      if (info) showLink(info, linkX, linkY);
    }, 0);
  for (const type of ["click", "auxclick", "contextmenu", "dragend", "keyup"]) document.addEventListener(type, again);
  window.addEventListener("blur", leaveLink);
  window.addEventListener("pagehide", leaveLink);
  document.addEventListener("visibilitychange", leaveLink);
}

// ---------- своё меню по правой кнопке ----------
// На телефоне и с зажатым Shift остаётся меню браузера: там проверка орфографии и инструменты разработчика.

// В таких полях своё меню правки текста
const TEXT_FIELD = 'textarea, input:not([type]), input:is([type="text"], [type="search"], [type="url"], [type="tel"], [type="email"], [type="password"], [type="number"])';

// Менеджер паролей браузера открывает свой список, когда видит логин рядом с полем type="password".
// Поэтому там, где это возможно, пароль лежит в обычном поле со скрытыми символами. Браузер без такого
// скрытия получает настоящее поле пароля: лучше его список, чем пароль открытым текстом.
export const NO_MANAGER = 'autocomplete="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"';
const CAN_MASK = Boolean(window.CSS?.supports?.("-webkit-text-security", "disc"));
export const SECRET_FIELD = `type="${CAN_MASK ? "text" : "password"}" data-secret ${NO_MANAGER}`;

let ctxMenu = null;
let ctxSubTimer = 0;
let lastPointer = "mouse";
const ctxActions = [];
let ctxPageActions = null;

/**
 * Свои действия правой кнопки для элементов страницы. build(el) возвращает { title, items } или null.
 * Пункт: { label, ic, hint, action, items (подменю), checked (выбор из нескольких), disabled, danger }, между группами "sep".
 * Панель сбрасывает действия при переходе в другой раздел (clearContextActions).
 */
export function contextActions(selector, build) {
  ctxActions.push({ selector, build });
}

/** Действия всего раздела, которые нужны и без конкретной строки: добавить, обновить список */
export function pageActions(build) {
  ctxPageActions = build;
}

export function clearContextActions() {
  ctxActions.length = 0;
  ctxPageActions = null;
}

let lastClick = { x: 0, y: 0, t: -Infinity };
document.addEventListener(
  "click",
  (e) => {
    lastClick = { x: e.clientX, y: e.clientY, t: performance.now() };
  },
  true,
);

/** Раздел панели раскрывается знаком от места клика и звучит своей нотой. Без недавнего клика (первая загрузка) ничего не делает */
export function revealSection(el, index) {
  if (performance.now() - lastClick.t > 1500) return;
  playSection(index);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = el.getBoundingClientRect();
  const x = lastClick.x - r.left;
  const y = lastClick.y - r.top;
  const radius = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
  el.animate({ clipPath: sparkFrames(x, y, radius) }, { duration: 620, easing: "cubic-bezier(0.65, 0, 0.35, 1)" });
}

/** Скачать файл по адресу, не уходя со страницы */
export function download(url) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.append(a);
  a.click();
  a.remove();
}

function closeCtxSub() {
  clearTimeout(ctxSubTimer);
  const sub = ctxMenu?.sub;
  if (!sub) return;
  ctxMenu.sub = null;
  sub.parent.setAttribute("aria-expanded", "false");
  sub.el.setAttribute("aria-hidden", "true");
  sub.el.classList.add("is-leaving");
  setTimeout(() => sub.el.remove(), 140);
}

function closeCtx(focusBack = true) {
  if (!ctxMenu) return;
  closeCtxSub();
  const { el, opener, target } = ctxMenu;
  ctxMenu = null;
  target?.classList.remove("ctx-target");
  // уходящее меню уже не считается открытым: и для читалок, и для следующего открытия
  el.setAttribute("aria-hidden", "true");
  el.classList.add("is-leaving");
  setTimeout(() => el.remove(), 140);
  if (focusBack && opener?.isConnected) opener.focus?.({ preventScroll: true });
}

function runCtx(item) {
  closeCtx();
  // ошибки запросов из пунктов меню показываются понятным текстом
  Promise.resolve()
    .then(() => item.action?.())
    .catch((err) => toast(err?.message || SOMETHING_WRONG, "error"));
}

function ctxMenuEl(items, label, className = "") {
  const handlers = [];
  const button = (it) => {
    handlers.push(it);
    const choice = it.checked !== undefined;
    const lead = it.swatch ? themeLogo(it.swatch) : it.ic ? icon(it.ic, "icon-sm") : "";
    const tail = it.items ? icon("chevronRight", "icon-sm ctx-chevron") : choice ? icon("check", "icon-sm theme-check") : it.hint ? `<kbd>${esc(it.hint)}</kbd>` : "";
    return `<button type="button" class="ctx-item${it.danger ? " is-danger" : ""}" role="${choice ? "menuitemradio" : "menuitem"}" data-h="${handlers.length - 1}"${choice ? ` aria-checked="${it.checked}"` : ""}${it.items ? ' aria-haspopup="menu" aria-expanded="false"' : ""}${it.disabled ? " disabled" : ""}>
      ${lead}<span class="grow">${esc(it.label)}</span>${tail}</button>`;
  };
  const tool = (it) => {
    handlers.push(it);
    const name = it.hint ? `${it.label} (${it.hint})` : it.label;
    return `<button type="button" class="ctx-item ctx-tool" role="menuitem" aria-label="${esc(it.label)}" title="${esc(name)}" data-h="${handlers.length - 1}"${it.disabled ? " disabled" : ""}>${icon(it.ic, "icon-sm")}</button>`;
  };
  const html = items
    .map((it) => {
      if (it === "sep") return '<div class="ctx-sep" role="separator"></div>';
      if (it.heading) return `<div class="ctx-title">${esc(it.heading)}</div>`;
      if (it.tools) return `<div class="ctx-tools" role="group" aria-label="Страница">${it.tools.map(tool).join("")}</div>`;
      if (it.foot) return `<div class="ctx-foot">${esc(it.foot)}</div>`;
      return button(it);
    })
    .join("");
  const el = h(`<div class="ctx-menu ${className}" role="menu" aria-label="${esc(label)}">${html}</div>`);
  el.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".ctx-item");
    if (!btn || btn.disabled) return;
    const it = handlers[Number(btn.dataset.h)];
    if (it.items) openCtxSub(btn, it, true);
    else runCtx(it);
  });
  el.addEventListener("pointerover", (ev) => {
    clearTimeout(ctxSubTimer);
    // мышь дошла до подменю: оно остаётся открытым
    if (className) return;
    const btn = ev.target.closest(".ctx-item");
    if (!btn) return;
    const it = handlers[Number(btn.dataset.h)];
    if (it.items && !btn.disabled) ctxSubTimer = setTimeout(() => ctxMenu && openCtxSub(btn, it), 120);
    else if (ctxMenu?.sub) ctxSubTimer = setTimeout(closeCtxSub, 260);
  });
  return el;
}

function openCtxSub(parent, it, focus = false) {
  clearTimeout(ctxSubTimer);
  if (ctxMenu.sub?.parent !== parent) {
    closeCtxSub();
    const el = ctxMenuEl(it.items, it.label, "ctx-sub");
    document.body.append(el);
    const r = parent.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    const flip = r.right + mw + 8 > innerWidth;
    el.style.left = `${flip ? Math.max(8, r.left - mw + 2) : r.right - 2}px`;
    el.style.top = `${Math.max(8, Math.min(r.top - 7, innerHeight - mh - 8))}px`;
    el.classList.toggle("from-right", flip);
    parent.setAttribute("aria-expanded", "true");
    ctxMenu.sub = { el, parent };
  }
  if (focus) ctxMenu.sub.el.querySelector(".ctx-item:not([disabled])")?.focus({ preventScroll: true });
}

function fieldItems(field) {
  const readOnly = field.readOnly || field.disabled;
  // пароль нельзя вырезать и скопировать, как и в обычном поле пароля
  const secret = field.type === "password" || field.hasAttribute("data-secret");
  const selected = field.selectionStart === null ? String(window.getSelection?.() || "") : field.value.slice(field.selectionStart, field.selectionEnd);
  const run = (command) => {
    field.focus({ preventScroll: true });
    document.execCommand(command);
  };
  return [
    { label: "Отменить", hint: "Ctrl+Z", ic: "undo", disabled: readOnly, action: () => run("undo") },
    "sep",
    { label: "Вырезать", hint: "Ctrl+X", ic: "scissors", disabled: readOnly || secret || !selected, action: () => run("cut") },
    { label: "Копировать", hint: "Ctrl+C", ic: "copy", disabled: secret || !selected, action: () => run("copy") },
    {
      label: "Вставить",
      hint: "Ctrl+V",
      ic: "clipboard",
      disabled: readOnly,
      async action() {
        let text = "";
        try {
          text = await navigator.clipboard.readText();
        } catch {
          field.focus({ preventScroll: true });
          toast("Браузер не дал доступ к буферу обмена. Нажмите Ctrl+V", "error");
          return;
        }
        field.focus({ preventScroll: true });
        if (text) document.execCommand("insertText", false, text);
      },
    },
    "sep",
    {
      label: "Выделить всё",
      hint: "Ctrl+A",
      ic: "selectAll",
      disabled: !field.value,
      action() {
        field.focus({ preventScroll: true });
        field.select();
      },
    },
    {
      label: "Очистить",
      ic: "x",
      disabled: readOnly || !field.value,
      action() {
        field.focus({ preventScroll: true });
        field.select();
        document.execCommand("delete");
      },
    },
    { foot: "Меню браузера: Shift + правая кнопка" },
  ];
}

function showCtx(items, label, { x0, y0, opener, target = null }) {
  const el = ctxMenuEl(items, label);
  document.body.append(el);
  target?.classList.add("ctx-target");
  ctxMenu = { el, opener, target, sub: null, openedAt: performance.now() };

  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  const left = x0 + mw + 8 > innerWidth ? Math.max(8, x0 - mw) : x0;
  const top = y0 + mh + 8 > innerHeight ? Math.max(8, Math.min(y0 - mh, innerHeight - mh - 8)) : y0;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.classList.toggle("from-right", left < x0);
  el.classList.toggle("from-bottom", top < y0);
  el.querySelector(".ctx-item:not([disabled])")?.focus({ preventScroll: true });
}

function openCtx(e) {
  closeCtx(false);
  hideTip();
  const field = e.target.closest?.(TEXT_FIELD);
  if (field) {
    // после выбора пункта фокус вернётся в поле, и выделение в нём сохранится
    showCtx(fieldItems(field), "Действия с полем", { x0: e.clientX, y0: e.clientY, opener: field });
    return;
  }
  // адрес берётся сразу: пока мышь над ссылкой, он может быть спрятан в data-href
  const linkEl = e.target.closest?.("a[href], a[data-href]");
  const link = linkHref(linkEl);
  const selected = String(window.getSelection?.() || "").trim();
  const nav = window.navigation;
  const opener = document.activeElement;

  // у края экрана меню разворачивается внутрь
  const fromKeys = e.clientX === 0 && e.clientY === 0;
  const anchor = fromKeys && opener?.getBoundingClientRect ? opener.getBoundingClientRect() : null;
  const x0 = anchor ? anchor.left + 12 : e.clientX;
  const y0 = anchor ? anchor.bottom : e.clientY;

  // то, что под мышью: строка таблицы, карточка. Берётся самый вложенный элемент
  let target = null;
  let group = null;
  for (const provider of ctxActions) {
    const el = e.target.closest?.(provider.selector);
    if (!el || (target && !target.contains(el))) continue;
    const built = provider.build(el);
    if (built?.items?.length) {
      target = el;
      group = built;
    }
  }

  const items = [];
  const section = (list) => {
    if (items.length) items.push("sep");
    items.push(...list);
  };
  if (selected) section([{ label: "Копировать", action: () => copyText(selected), hint: "Ctrl+C", ic: "copy" }]);
  if (group) section([...(group.title ? [{ heading: group.title }] : []), ...group.items]);
  // ссылка внутри строки: всё нужное уже есть среди действий самой строки
  if (link && !target?.contains(linkEl)) {
    section([
      { label: "Открыть в новой вкладке", action: () => window.open(link, "_blank", "noopener"), ic: "external" },
      { label: "Скопировать адрес ссылки", action: () => copyText(link), ic: "copy" },
    ]);
  }
  const page = ctxPageActions?.();
  if (page?.length) section(page);
  const now = currentTheme();
  section([
    {
      tools: [
        { label: "Назад", action: () => history.back(), hint: "Alt+←", disabled: nav ? !nav.canGoBack : false, ic: "arrowLeft" },
        { label: "Вперёд", action: () => history.forward(), hint: "Alt+→", disabled: nav ? !nav.canGoForward : false, ic: "arrowRight" },
        { label: "Обновить страницу", action: () => location.reload(), hint: "Ctrl+R", ic: "refresh" },
        { label: "Скопировать ссылку на страницу", action: () => copyText(location.href), ic: "copy" },
        { label: "Печать", action: () => window.print(), hint: "Ctrl+P", ic: "print" },
      ],
    },
    {
      label: "Тема оформления",
      ic: themeById(now).icon,
      items: THEMES.map((t) => ({
        label: t.name,
        swatch: t.id,
        checked: t.id === now,
        action() {
          if (t.id === currentTheme()) return;
          switchTheme(t.id, x0, y0, () => {
            document.querySelectorAll("#theme").forEach((b) => b.dispatchEvent(new CustomEvent("upk:theme-render")));
          });
        },
      })),
    },
    { label: soundOn() ? "Выключить звук" : "Включить звук", ic: soundOn() ? "volumeOff" : "volume", action: () => setSound(!soundOn()) },
    { foot: "Меню браузера: Shift + правая кнопка" },
  ]);

  showCtx(items, "Действия на странице", { x0, y0, opener, target });
}

function watchContextMenu() {
  const inMenus = (node) => ctxMenu && (ctxMenu.el.contains(node) || ctxMenu.sub?.el.contains(node));
  document.addEventListener("pointerdown", (e) => {
    lastPointer = e.pointerType || "mouse";
    if (ctxMenu && !inMenus(e.target)) closeCtx(false);
  }, true);
  document.addEventListener("contextmenu", (e) => {
    if (e.shiftKey || lastPointer === "touch" || lastPointer === "pen") return;
    if (e.target.closest?.("[contenteditable=''], [contenteditable='true']")) return;
    e.preventDefault();
    // правая кнопка по самому меню ничего нового не открывает
    if (e.target.closest?.(".ctx-menu")) return;
    openCtx(e);
  });
  document.addEventListener("keydown", (e) => {
    if (!ctxMenu) return;
    const inSub = Boolean(ctxMenu.sub?.el.contains(document.activeElement));
    const box = inSub ? ctxMenu.sub.el : ctxMenu.el;
    const list = [...box.querySelectorAll(".ctx-item:not([disabled])")];
    const active = document.activeElement;
    const i = list.indexOf(active);
    if (e.key === "Escape" || (e.key === "ArrowLeft" && inSub)) {
      if (inSub) {
        const { parent } = ctxMenu.sub;
        closeCtxSub();
        parent.focus({ preventScroll: true });
      } else if (e.key === "Escape") closeCtx();
    } else if (e.key === "ArrowRight" && !inSub && active?.getAttribute("aria-haspopup")) active.click();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
    else if (e.key === "Home") list[0]?.focus();
    else if (e.key === "End") list[list.length - 1]?.focus();
    else if (e.key === "Tab") {
      closeCtx(false);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  window.addEventListener("blur", () => closeCtx(false));
  window.addEventListener("resize", () => closeCtx(false));
  // прокрутка закрывает меню, но не ту, что ещё докатывается в момент его открытия
  window.addEventListener("scroll", () => ctxMenu && performance.now() - ctxMenu.openedAt > 200 && closeCtx(false), { passive: true });
  // пароль не копируется и не вырезается и с клавиатуры
  for (const type of ["copy", "cut"]) {
    document.addEventListener(type, (e) => {
      if (e.target instanceof Element && e.target.closest("[data-secret]")) e.preventDefault();
    });
  }
}

// ---------- звёздные полосы прокрутки ----------
// Системные полосы прокрутки спрятаны везде: у страницы, окон, списков, боковой панели, полей.
// Вместо них свои «звёздные»: дорожка — пунктир из звёздной пыли, ползунок светится, в середине
// фирменная искра 404, она поворачивается при прокрутке, за ней тянется след из мелких звёзд.
// Появляются при прокрутке и при наведении, гаснут сами, как на iPhone.
// Тянуть ползунок мышью можно, и курсор сайта при этом не замирает: системную полосу браузер
// тянет сам и перестаёт сообщать странице, где мышь, а свою тянем мы.

const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SPARK_PATH}"/></svg>`;
const BAR = 14; // ширина полосы под мышь, видимая часть тоньше
const MIN_THUMB = 40;
const MAX_DUST = 12;
const starBars = new Map(); // прокручиваемый элемент → { y, x }
let dust = 0;

const pageScroller = () => document.scrollingElement || document.documentElement;

// проверка «блок прокручивается» при движении мыши: стиль читается не чаще раза в секунду на блок
const scrollCache = new WeakMap();
function canScroll(el, axis) {
  if (el === pageScroller()) return axis === "y" ? el.scrollHeight > innerHeight + 2 : el.scrollWidth > innerWidth + 2;
  const over = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  if (over < 2) return false;
  const now = performance.now();
  let hit = scrollCache.get(el);
  if (!hit || now - hit.t > 1000) scrollCache.set(el, (hit = { t: now, style: getComputedStyle(el) }));
  const value = hit.style[axis === "y" ? "overflowY" : "overflowX"];
  return value === "auto" || value === "scroll";
}

class StarBar {
  constructor(el, axis) {
    this.el = el;
    this.axis = axis;
    this.page = el === pageScroller();
    this.node = h(`<div class="ui-scroll is-${axis}${this.page ? " is-page" : ""}" aria-hidden="true">
      <i class="ui-scroll-thumb"><span class="ui-scroll-star">${STAR}</span></i></div>`);
    this.thumb = this.node.firstElementChild;
    document.body.append(this.node);
    this.on = false;
    this.drag = null;
    this.frame = 0;
    this.fade = 0;
    this.last = this.pos();
    this.trail = 0;
    this.geo = null;
    this.bindDrag();
  }

  pos() {
    if (this.page) return this.axis === "y" ? scrollY : scrollX;
    return this.axis === "y" ? this.el.scrollTop : this.el.scrollLeft;
  }

  setPos(v) {
    if (this.page) scrollTo({ [this.axis === "y" ? "top" : "left"]: v, behavior: "instant" });
    else this.el[this.axis === "y" ? "scrollTop" : "scrollLeft"] = v;
  }

  /** Где полоса на экране и какой длины ползунок */
  measure() {
    const { el, axis } = this;
    let r;
    let view;
    let full;
    if (this.page) {
      r = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      view = axis === "y" ? innerHeight : innerWidth;
      full = axis === "y" ? el.scrollHeight : el.scrollWidth;
    } else {
      if (!el.isConnected) return null;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return null;
      const left = b.left + el.clientLeft;
      const top = b.top + el.clientTop;
      r = { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
      view = axis === "y" ? el.clientHeight : el.clientWidth;
      full = axis === "y" ? el.scrollHeight : el.scrollWidth;
    }
    const max = full - view;
    if (max < 2) return null;
    // видимая часть: элемент может выходить за край экрана
    const a = axis === "y" ? Math.max(r.top, 0) + 6 : Math.max(r.left, 0) + 6;
    const b2 = axis === "y" ? Math.min(r.bottom, innerHeight) - 6 : Math.min(r.right, innerWidth) - 6;
    const track = b2 - a;
    if (track < 30) return null;
    const size = Math.max(MIN_THUMB, Math.round((track * view) / full));
    const at = Math.round(((track - size) * Math.min(Math.max(this.pos(), 0), max)) / max);
    return { r, a, track, size, at, max };
  }

  place() {
    const g = this.measure();
    this.geo = g;
    this.node.classList.toggle("is-none", !g);
    if (!g) return;
    const s = this.node.style;
    if (this.axis === "y") {
      s.left = `${Math.min(g.r.right, innerWidth) - BAR}px`;
      s.top = `${g.a}px`;
      s.height = `${g.track}px`;
      this.thumb.style.height = `${g.size}px`;
      this.thumb.style.transform = `translateY(${g.at}px)`;
    } else {
      s.top = `${Math.min(g.r.bottom, innerHeight) - BAR}px`;
      s.left = `${g.a}px`;
      s.width = `${g.track}px`;
      this.thumb.style.width = `${g.size}px`;
      this.thumb.style.transform = `translateX(${g.at}px)`;
    }
    // искра поворачивается вместе с прокруткой
    this.thumb.style.setProperty("--spin", `${Math.round((this.pos() / Math.max(1, g.max)) * 540)}deg`);
  }

  loop() {
    this.frame = 0;
    this.place();
    if (this.on || this.drag) this.frame = requestAnimationFrame(() => this.loop());
  }

  show(hold = 1100) {
    if (!this.on) {
      this.on = true;
      this.node.classList.add("is-on");
      if (!this.frame) this.loop();
    }
    clearTimeout(this.fade);
    this.fade = setTimeout(() => this.hide(), hold);
  }

  hide() {
    if (this.drag || this.node.matches(":hover")) return this.show();
    this.on = false;
    this.node.classList.remove("is-on");
    // элемент убрали со страницы (закрыли окно): полоса тоже уходит
    if (!this.page && !this.el.isConnected) this.destroy();
  }

  scrolled() {
    const now = this.pos();
    const moved = Math.abs(now - this.last);
    this.last = now;
    this.show();
    this.trail += moved;
    if (this.trail > 70 && this.geo) {
      this.trail = 0;
      this.sparkle();
    }
  }

  /** Звёздная пыль, которая отлетает от искры при прокрутке */
  sparkle() {
    if (dust >= MAX_DUST || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = this.thumb.getBoundingClientRect();
    if (!r.width) return;
    dust += 1;
    const bit = h(`<i class="ui-scroll-dust" aria-hidden="true">${STAR}</i>`);
    document.body.append(bit);
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const side = this.axis === "y" ? [-(10 + Math.random() * 16), (Math.random() - 0.5) * 22] : [(Math.random() - 0.5) * 22, -(10 + Math.random() * 16)];
    const size = 0.35 + Math.random() * 0.45;
    const anim = bit.animate(
      [
        { transform: `translate3d(${x}px, ${y}px, 0) scale(${size})`, opacity: 0.95 },
        { transform: `translate3d(${x + side[0]}px, ${y + side[1]}px, 0) scale(0) rotate(120deg)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 300, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" },
    );
    anim.onfinish = anim.oncancel = () => {
      bit.remove();
      dust -= 1;
    };
  }

  bindDrag() {
    const { thumb, node } = this;
    const coord = (e) => (this.axis === "y" ? e.clientY : e.clientX);
    thumb.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.drag = { at: coord(e), from: this.pos() };
      try {
        thumb.setPointerCapture(e.pointerId);
      } catch {
        /* без захвата тянется, пока мышь над полосой */
      }
      node.classList.add("is-drag");
      document.documentElement.classList.add("is-scroll-drag");
      this.show();
    });
    thumb.addEventListener("pointermove", (e) => {
      const g = this.geo;
      if (!this.drag || !g || g.track <= g.size) return;
      this.setPos(this.drag.from + ((coord(e) - this.drag.at) * g.max) / (g.track - g.size));
    });
    const stop = () => {
      if (!this.drag) return;
      this.drag = null;
      node.classList.remove("is-drag");
      document.documentElement.classList.remove("is-scroll-drag");
      this.show();
    };
    thumb.addEventListener("pointerup", stop);
    thumb.addEventListener("pointercancel", stop);
    thumb.addEventListener("lostpointercapture", stop);
    // нажатие по дорожке выше или ниже ползунка: на экран назад или вперёд
    node.addEventListener("pointerdown", (e) => {
      if (e.target !== node || e.pointerType === "touch" || e.button !== 0) return;
      e.preventDefault();
      const r = thumb.getBoundingClientRect();
      const before = this.axis === "y" ? e.clientY < r.top : e.clientX < r.left;
      const view = this.page ? (this.axis === "y" ? innerHeight : innerWidth) : this.axis === "y" ? this.el.clientHeight : this.el.clientWidth;
      const target = this.page ? window : this.el;
      target.scrollBy({ [this.axis === "y" ? "top" : "left"]: (before ? -1 : 1) * view * 0.9, behavior: "smooth" });
    });
    node.addEventListener("pointerenter", () => this.show(1600));
    node.addEventListener("pointerleave", () => this.show(700));
  }

  destroy() {
    clearTimeout(this.fade);
    cancelAnimationFrame(this.frame);
    this.node.remove();
    const pair = starBars.get(this.el);
    if (pair) {
      delete pair[this.axis];
      if (!pair.x && !pair.y) starBars.delete(this.el);
    }
  }
}

function starBar(el, axis) {
  let pair = starBars.get(el);
  if (!pair) starBars.set(el, (pair = {}));
  return (pair[axis] ||= new StarBar(el, axis));
}

/** Ближайший прокручиваемый блок под мышью: его полоса показывается, чтобы её можно было взять */
function scrollableAt(node) {
  for (let el = node instanceof Element ? node : null, i = 0; el && el !== document.body && i < 12; el = el.parentElement, i += 1) {
    if (el.closest(".ui-scroll")) return null;
    if (canScroll(el, "y")) return el;
  }
  return null;
}

function watchStarScroll() {
  const root = document.documentElement;
  root.classList.add("has-ui-scroll");
  // прокрутка любого блока: событие не всплывает, ловим на погружении
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target === document ? pageScroller() : e.target;
      if (!(el instanceof Element)) return;
      for (const axis of ["y", "x"]) {
        const pair = starBars.get(el);
        const bar = pair?.[axis];
        if (bar) {
          if (bar.pos() !== bar.last) bar.scrolled();
        } else if (canScroll(el, axis)) {
          const fresh = starBar(el, axis);
          fresh.last = -1;
          fresh.scrolled();
        }
      }
    },
    { capture: true, passive: true },
  );
  // мышь над блоком с прокруткой или у правого края страницы: полоса показывается
  let hoverFrame = 0;
  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse" || hoverFrame) return;
      const { clientX, clientY, target } = e;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (clientX > innerWidth - 28 && canScroll(pageScroller(), "y")) starBar(pageScroller(), "y").show(900);
        const el = scrollableAt(target);
        if (!el) return;
        const r = el.getBoundingClientRect();
        // у края блока полоса держится дольше: её собираются взять
        if (clientX > r.right - 36) starBar(el, "y").show(1400);
      });
    },
    { passive: true },
  );
  // высота страницы меняется без прокрутки: подгрузились заявки, раскрылся блок
  new ResizeObserver(() => starBars.forEach((pair) => pair.y?.on && pair.y.place())).observe(document.body);
}

if (document.body) {
  watchTips();
  watchLinks();
  watchContextMenu();
  if (window.ResizeObserver) watchStarScroll();
}

/**
 * Кадры смены темы: четырёхлучевой знак 404 растёт из точки и поворачивается, пока не закроет экран.
 * Форма берётся из того же пути, что и знак: отрезки кривых переводятся в многоугольник для clip-path.
 */
const sparkFrames = (...args) => window.upkSparkFrames(...args);

applyTheme(currentTheme());

// мои заявки на этом устройстве, чтобы не потерять код
export const myTickets = {
  list() {
    return store.get("upk-my-tickets", []);
  },
  add(item) {
    const items = this.list().filter((t) => t.code !== item.code);
    items.unshift(item);
    store.set("upk-my-tickets", items.slice(0, 20));
  },
  update(code, patch) {
    store.set(
      "upk-my-tickets",
      this.list().map((t) => (t.code === code ? { ...t, ...patch } : t)),
    );
  },
};

// ---------- числа для стилей из разметки ----------
// CSP запрещает style="" в разметке. Порядок появления (--i) и ширина полосы в процентах передаются
// через data-css-i и data-css-pct и ставятся отсюда. Принимаются только числа.

function applyCssData(root) {
  if (root.nodeType !== 1) return;
  const nodes = root.matches("[data-css-i], [data-css-pct]") ? [root] : [];
  nodes.push(...root.querySelectorAll("[data-css-i], [data-css-pct]"));
  for (const el of nodes) {
    const i = Number(el.dataset.cssI);
    if (el.dataset.cssI !== undefined && Number.isFinite(i)) el.style.setProperty("--i", String(Math.trunc(i)));
    const pct = Number(el.dataset.cssPct);
    if (el.dataset.cssPct !== undefined && Number.isFinite(pct)) el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }
}

if (document.body) {
  watchNetwork();
  applyCssData(document.body);
  new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(applyCssData))).observe(document.body, { childList: true, subtree: true });
}

// Последний рубеж: ошибка, которую никто не обработал, не должна пройти молча
const SOMETHING_WRONG = "Что-то пошло не так. Обновите страницу и попробуйте ещё раз.";
let wrongShownUntil = 0;
function somethingWrong() {
  // одна и та же ошибка не складывается в стопку сообщений
  if (Date.now() < wrongShownUntil) return;
  wrongShownUntil = Date.now() + 6000;
  toast(SOMETHING_WRONG, "error");
}
window.addEventListener("unhandledrejection", somethingWrong);
window.addEventListener("error", somethingWrong);

// Ни картинки, ни ссылки, ни выделенный текст не тащатся системной копией с курсором-крестиком (своё в lift.js)
document.addEventListener("dragstart", (e) => {
  const el = e.target instanceof Element ? e.target : e.target?.parentElement;
  if (!el?.closest('[draggable="true"]')) e.preventDefault();
});
