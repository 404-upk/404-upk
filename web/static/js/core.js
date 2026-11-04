// Общие утилиты для всех страниц: запросы к API, иконки, форматирование, тосты, модалки.

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
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
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
  navigator.serviceWorker.register("/sw.js").catch(() => {});
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
}

export function themeToggle(button) {
  const render = () => {
    button.innerHTML = icon(currentTheme() === "dark" ? "sun" : "moon");
    button.setAttribute("aria-label", currentTheme() === "dark" ? "Светлая тема" : "Тёмная тема");
  };
  button.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    const flip = () => {
      store.set("upk-theme", next);
      applyTheme(next);
      render();
    };
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      flip();
      return;
    }
    // новая тема расходится кругом от кнопки
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(flip).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 760, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  });
  render();
}

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
