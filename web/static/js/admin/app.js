import { $, ApiError, NO_MANAGER, SECRET_FIELD, api, clearContextActions, errorBlock, esc, h, icon, leaveAndRemove, nameHashLinks, setBusy, store, themeToggle, toast } from "../core.js";
import { attachCombo } from "./combo.js";
import { can, ctx, initials, loadAssignees, loadLocations, parseHash } from "./ctx.js";
import { ambient, startAmbient } from "../ambient.js";
import { campusBadge, spark } from "../campus.js";
import { REDUCED, initMotion, leave, rise, splitWords } from "../motion.js";

const BRAND = (sub) => `
  <span class="lockup" role="img" aria-label="404"></span>
  <span class="brand-sep" aria-hidden="true"></span>
  <span>Панель УПК<small>${sub}</small></span>`;

const PAGES = {
  tickets: { title: "Заявки", icon: "list", load: () => import("./tickets.js") },
  board: { title: "Доска", icon: "board", load: () => import("./board.js") },
  stats: { title: "Статистика", icon: "chart", load: () => import("./stats.js"), manage: true },
  map: { title: "Карта помещений", icon: "map", load: () => import("./map.js"), manage: true },
  locations: { title: "Помещения и QR", icon: "qr", load: () => import("./locations.js"), manage: true },
  kb: { title: "База знаний", icon: "book", load: () => import("./kb.js"), manage: true },
  ai: { title: "Экзамен для ИИ", icon: "bot", load: () => import("./ai.js"), manage: true },
  users: { title: "Сотрудники", icon: "users", load: () => import("./users.js"), admin: true },
  profile: { title: "Профиль", icon: "user", load: () => import("./profile.js"), hidden: true },
};

// подсказка у ссылок внутри панели называет раздел, а не показывает адрес вида #/tickets/12
nameHashLinks((hash) => {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [key, id] = path.split("/");
  if (key === "tickets" && id) return "Карточка заявки";
  if (key === "tickets" && /(^|&)location=\d/.test(query)) return "Заявки по помещению";
  return PAGES[key]?.title || null;
});

const root = $("#root");
let cleanup = null;
let lastNewCount = null;
let pollTimer = null;

function allowed(page) {
  const p = PAGES[page];
  if (!p) return false;
  if (p.admin) return can.admin();
  if (p.manage) return can.manage();
  return true;
}

// ---------- вход ----------

// Логины, с которыми входили на этом устройстве. Только логины: пароли сайт нигде не хранит
const RECENT_LOGINS = "upk-logins";
const MAX_RECENT_LOGINS = 5;
const browserPasswords = () => Boolean(window.PasswordCredential && window.isSecureContext && navigator.credentials);

function rememberLogin(login) {
  store.set(RECENT_LOGINS, [login, ...store.get(RECENT_LOGINS, []).filter((x) => x !== login)].slice(0, MAX_RECENT_LOGINS));
}

/** Браузер предлагает сохранить пароль в своём менеджере: без поля type="password" сам он этого не заметит */
function offerToSavePassword(id, password) {
  if (!browserPasswords()) return;
  try {
    navigator.credentials.store(new PasswordCredential({ id, password })).catch(() => {});
  } catch {
    /* браузер не умеет, вход это не мешает */
  }
}

function renderLogin(message = "") {
  const demo = ctx.meta?.demo_logins;
  root.innerHTML = `
    <div class="login-wrap login-split">
      <section class="login-aside" aria-label="О панели">
        <a class="brand" href="/">${BRAND("Цифровой помощник колледжа")}</a>
        <div class="login-aside-body">
          <div class="eyebrow">${spark()} Панель УПК</div>
          <h1>Все обращения колледжа в одном месте</h1>
          <p class="muted">Заявки по QR-кодам, исполнители, статусы и аналитика по каждому помещению.</p>
          <div id="login-map"></div>
        </div>
      </section>
      <form class="card login-card" id="l-form" novalidate autocomplete="off">
        <div class="stack-sm"><div class="eyebrow">Для сотрудников</div><h2>Вход в панель</h2>
          <p class="small muted">Заявители входить не должны: им хватает QR-кода и кода отслеживания.</p></div>
        ${message ? `<div class="notice notice-danger">${icon("alert")}<div>${esc(message)}</div></div>` : ""}
        <div class="field"><label for="l-nick">Логин</label>
          <input class="input" id="l-nick" ${NO_MANAGER} required></div>
        <div class="field"><label for="l-secret">Пароль</label>
          <input class="input" id="l-secret" ${SECRET_FIELD} required></div>
        <button class="btn btn-primary btn-lg" type="submit" id="l-btn">Войти</button>
        ${
          demo
            ? `<div class="demo-accounts">Демо-доступ: ${demo
                .map((d) => `<button type="button" data-l="${esc(d.login)}" data-p="${esc(d.password)}">${esc(d.label)}</button>`)
                .join(" · ")}</div>`
            : ""
        }
      </form>
    </div>`;
  api("/api/campus")
    .then((campus) => {
      const box = $("#login-map");
      if (box && campus.buildings?.length) box.innerHTML = campusBadge(campus);
    })
    .catch(() => {});
  if (message) {
    $("#l-form").classList.add("shake");
  } else {
    splitWords($(".login-aside h1"), { delay: 120 });
    rise(root, ".login-aside .brand, .login-aside-body > *:not(h1)", { step: 90, delay: 60 });
    rise(root, ".login-card", { delay: 240, dur: 1150 });
  }
  const form = $("#l-form");
  const nick = $("#l-nick");
  const secret = $("#l-secret");
  form.querySelectorAll("[data-l]").forEach((b) =>
    b.addEventListener("click", () => {
      nick.value = b.dataset.l;
      secret.value = b.dataset.p;
      form.requestSubmit();
    }),
  );
  const fromBrowser = async () => {
    try {
      const saved = await navigator.credentials.get({ password: true, mediation: "required" });
      if (!saved?.password) return;
      nick.value = saved.id;
      secret.value = saved.password;
      form.requestSubmit();
    } catch {
      toast("Браузер не дал доступ к сохранённым паролям", "error");
    }
  };
  attachCombo(nick, {
    title: "Недавние логины",
    options() {
      const typed = nick.value.trim().toLowerCase();
      const recent = store.get(RECENT_LOGINS, []);
      return [
        ...recent.filter((login) => login !== typed && login.startsWith(typed)),
        ...(browserPasswords() ? [{ label: "Пароли браузера", ic: "lock", action: fromBrowser }] : []),
        ...(recent.length ? [{ label: "Забыть логины на этом устройстве", ic: "trash", action: () => store.set(RECENT_LOGINS, []) }] : []),
      ];
    },
    onPick: () => secret.focus(),
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#l-btn");
    const login = nick.value.trim();
    const password = secret.value;
    setBusy(btn, true);
    try {
      await api("/api/auth/login", { method: "POST", body: { login, password } });
      rememberLogin(login.toLowerCase());
      offerToSavePassword(login, password);
      await leave(root.firstElementChild, { duration: 300 });
      await boot();
    } catch (err) {
      renderLogin(err.message);
      $("#l-nick").value = login;
    }
  });
  nick.focus();
}

// ---------- смена временного пароля ----------

function renderPasswordChange(message = "") {
  root.innerHTML = `
    <div class="login-wrap">
      <form class="card login-card" id="pwd" novalidate autocomplete="off">
        <div class="stack-sm"><div class="eyebrow">Первый вход</div><h2>Задайте свой пароль</h2>
          <p class="small muted">${esc(ctx.user.name)}, у вас временный пароль. Пока вы его не замените, панель закрыта.
          Новый пароль: не короче 12 символов, без логина и не из простых.</p></div>
        ${message ? `<div class="notice notice-danger">${icon("alert")}<div>${esc(message)}</div></div>` : ""}
        <div class="field"><label for="p-old">Временный пароль</label>
          <input class="input" id="p-old" ${SECRET_FIELD} required></div>
        <div class="field"><label for="p-new">Новый пароль</label>
          <input class="input" id="p-new" ${SECRET_FIELD} minlength="12" required></div>
        <div class="field"><label for="p-again">Новый пароль ещё раз</label>
          <input class="input" id="p-again" ${SECRET_FIELD} required></div>
        <button class="btn btn-primary btn-lg" type="submit" id="p-btn">Сохранить и войти</button>
      </form>
    </div>`;
  const form = $("#pwd");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("#p-new").value !== $("#p-again").value) {
      renderPasswordChange("Новые пароли не совпадают");
      return;
    }
    const btn = $("#p-btn");
    const newPassword = $("#p-new").value;
    setBusy(btn, true);
    try {
      ctx.user = await api("/api/auth/password", {
        method: "POST",
        body: { current_password: $("#p-old").value, new_password: newPassword },
      });
      offerToSavePassword(ctx.user.login, newPassword);
      toast("Пароль сохранён");
      await boot();
    } catch (err) {
      renderPasswordChange(err.message);
    }
  });
  $("#p-old").focus();
}

// ---------- каркас ----------

function navLink(key, p) {
  const title = key === "tickets" && ctx.user.role === "executor" ? "Мои заявки" : p.title;
  return `<a href="#/${key}" data-page="${key}">${icon(p.icon)}<span>${title}</span>${
    key === "tickets" ? `<span class="badge badge-primary" id="new-badge" hidden></span>` : ""
  }</a>`;
}

function renderLayout() {
  const work = ["tickets", "board"].filter(allowed);
  const analytics = ["stats", "map"].filter(allowed);
  const settings = ["locations", "kb", "ai", "users"].filter(allowed);
  const group = (title, keys) =>
    keys.length ? `<div class="nav-title">${title}</div>${keys.map((k) => navLink(k, PAGES[k])).join("")}` : "";

  root.innerHTML = `
    <div class="admin" id="admin">
      <aside class="sidebar">
        <a class="brand" href="#/tickets">${BRAND("Цифровой помощник")}</a>
        <nav class="nav" aria-label="Разделы">
          <span class="nav-ind" id="nav-ind" aria-hidden="true"></span>
          ${group("Работа", work)}
          ${group("Аналитика", analytics)}
          ${group("Настройки", settings)}
        </nav>
        <div class="sidebar-foot">
          <a class="u-justify-start btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">${icon("external", "icon-sm")} Страница заявителя</a>
          <a class="me" href="#/profile">
            <span class="avatar">${esc(initials(ctx.user.name))}</span>
            <span class="grow"><b>${esc(ctx.user.name)}</b><span>${esc(ctx.user.position || ctx.user.role_label)}</span></span>
          </a>
          <div class="row">
            <button class="btn btn-ghost btn-sm grow" id="logout">${icon("logout", "icon-sm")} Выйти</button>
            <button class="btn btn-ghost btn-icon btn-sm" id="theme"></button>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="main-head">
          <button class="btn btn-ghost btn-icon menu-btn" id="menu" aria-label="Меню">${icon("menu")}</button>
          <h1 id="page-title"></h1>
          <span class="grow"></span>
          <div class="row-wrap" id="page-actions"></div>
        </header>
        <main class="content" id="content"></main>
      </div>
    </div>`;

  themeToggle($("#theme"));
  rise(root, ".sidebar .brand, .sidebar .nav-title, .sidebar .nav a, .sidebar-foot", { step: 26, delay: 40, dur: 800 });
  rise(root, ".main-head", { delay: 80, dur: 800 });
  $("#logout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearInterval(pollTimer);
    location.hash = "";
    renderLogin();
  });
  const admin = $("#admin");
  $("#menu").addEventListener("click", () => admin.classList.toggle("nav-open"));
  admin.addEventListener("click", (e) => {
    if (admin.classList.contains("nav-open") && (e.target === admin || e.target.closest(".nav a"))) admin.classList.remove("nav-open");
  });
}

function moveNavIndicator() {
  const ind = $("#nav-ind");
  if (!ind) return;
  const link = $(".nav a.active");
  if (!link) {
    ind.style.opacity = "0";
    return;
  }
  ind.style.opacity = "1";
  ind.style.height = `${link.offsetHeight}px`;
  ind.style.transform = `translateY(${link.offsetTop}px)`;
}

function setHead(title, actions = "") {
  const head = $("#page-title");
  if (head.textContent !== title) {
    head.textContent = title;
    rise(root, [head], { dur: 750 });
  }
  $("#page-actions").innerHTML = actions;
  document.title = `${title} · Панель УПК`;
}

let routeToken = 0;

async function route() {
  const token = ++routeToken;
  const { page, id, params } = parseHash();
  const key = allowed(page) ? page : "tickets";
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === key));
  moveNavIndicator();

  // открытие карточки поверх уже открытого списка не перерисовывает список
  if (key === "tickets" && cleanup?.page === "tickets" && cleanup.openTicket) {
    cleanup.sync(params, id);
    if (id) cleanup.openTicket(id);
    return;
  }
  if (typeof cleanup?.destroy === "function") cleanup.destroy();
  cleanup = null;
  clearContextActions();

  const content = $("#content");
  // старый раздел коротко уходит, новый приходит каскадом
  if (content.childElementCount && !REDUCED) {
    content.classList.add("is-leaving");
    await new Promise((resolve) => setTimeout(resolve, 150));
    content.classList.remove("is-leaving");
    if (token !== routeToken) return;
  }
  content.innerHTML = `<div class="stack"><div class="sk-h44 skeleton"></div><div class="sk-h320 skeleton"></div></div>`;
  window.scrollTo({ top: 0 });
  try {
    const mod = await PAGES[key].load();
    const title = key === "tickets" && ctx.user.role === "executor" ? "Мои заявки" : PAGES[key].title;
    setHead(title);
    const result = (await mod.render({ el: content, setHead: (actions) => setHead(title, actions), params, id })) || null;
    if (token !== routeToken) {
      result?.destroy?.();
      return;
    }
    cleanup = result;
    if (cleanup) cleanup.page = key;
    rise(content, ":scope > *", { step: 80, dur: 900 });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      renderLogin("Сессия закончилась, войдите снова");
      return;
    }
    content.innerHTML = "";
    content.append(errorBlock(err, route));
    if (!(err instanceof ApiError)) console.error(err);
  }
}

// ---------- новые заявки ----------

async function pollNew() {
  try {
    const data = await api("/api/staff/tickets?status=new&per_page=1");
    const count = data.total;
    const badge = $("#new-badge");
    if (badge) {
      if (lastNewCount !== null && count !== lastNewCount && count > 0) {
        badge.classList.remove("badge-pop");
        void badge.offsetWidth;
        badge.classList.add("badge-pop");
      }
      badge.hidden = count === 0;
      badge.textContent = count;
    }
    if (lastNewCount !== null && count > lastNewCount && data.items[0]) {
      const t = data.items[0];
      const el = h(`<div class="toast">${icon("message")}<div><b>Новая заявка ${esc(t.public_number)}</b><br>${esc(t.title)} · ${esc(t.place)}</div></div>`);
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        location.hash = `#/tickets/${t.id}`;
        leaveAndRemove(el);
      });
      ($(".toasts") || document.body.appendChild(h('<div class="toasts"></div>'))).append(el);
      setTimeout(() => leaveAndRemove(el), 8000);
      ambient.pulseAt(badge, 1);
      window.dispatchEvent(new CustomEvent("tickets:changed"));
    }
    lastNewCount = count;
  } catch (err) {
    if (err.status === 401) {
      clearInterval(pollTimer);
      renderLogin("Сессия закончилась, войдите снова");
    }
  }
}

// ---------- старт ----------

async function boot() {
  startAmbient();
  initMotion();
  try {
    ctx.user = await api("/api/auth/me");
  } catch (err) {
    if (err.status === 401) {
      renderLogin();
      return;
    }
    root.innerHTML = `<div class="login-wrap"><div class="notice notice-danger">${icon("alert")}<div>${esc(err.message)}</div></div></div>`;
    return;
  }
  if (ctx.user.must_change_password) {
    renderPasswordChange();
    return;
  }
  await Promise.all([loadAssignees(), loadLocations()]);
  renderLayout();
  window.onhashchange = route;
  await route();
  lastNewCount = null;
  pollNew();
  clearInterval(pollTimer);
  pollTimer = setInterval(pollNew, 20000);
}

(async () => {
  try {
    ctx.meta = await api("/api/meta");
  } catch (err) {
    toast(err.message, "error");
  }
  boot();
})();
