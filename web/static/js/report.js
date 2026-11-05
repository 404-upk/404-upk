import {
  $,
  ApiError,
  api,
  chooseFileNative,
  copyText,
  drafts,
  enableOffline,
  errorBlock,
  esc,
  fmtDate,
  h,
  icon,
  lightbox,
  myTickets,
  openModal,
  preparePhoto,
  priorityChip,
  relTime,
  setBusy,
  statusChip,
  themeToggle,
  toast,
  whenOnline,
} from "./core.js";
import { markSvg } from "./brand.js";
import { ambient, startAmbient } from "./ambient.js";
import { campusBadge, nodeGlyph, spark } from "./campus.js";
import { bindPlan, planHtml, planStates } from "./plan.js";
import { collapseOut, countUp, expandIn, initMotion, leave, rise, scramble, splitWords, textIn } from "./motion.js";

const EXAMPLES = [
  "В кабинете не работает проектор",
  "Сломался стул",
  "Нет интернета",
  "В кабинете грязно",
  "Как подключить ноутбук к проектору?",
  "Где посмотреть статус заявки?",
];

const PRIORITY_LABELS = { low: "Низкий", normal: "Обычный", high: "Высокий", critical: "Критический" };

const state = {
  meta: null,
  location: null,
  locationNote: "",
  fromQr: false,
  qrError: null,
  suggestedLocation: null,
  thread: [],
  context: [],
  lastText: "",
  photo: null,
  photoUrl: null,
  photoAi: null,
  draft: null,
  similar: [],
  dupDismissed: false,
  locations: null,
  sending: false,
  campus: null,
  campusEntered: false,
  roomStatus: null,
  draftFresh: false,
};

const app = $("#app");

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function categoryName(code) {
  return state.meta?.categories.find((c) => c.code === code)?.name || "Другое";
}

// ---------- каркас ----------

function renderShell() {
  app.innerHTML = `
    <div class="report-grid">
      <div class="report-main">
        <section class="hero">
          <div class="eyebrow">${spark()} Сообщить о проблеме</div>
          <h1>Что случилось?</h1>
          <p>Опишите проблему или задайте вопрос. Помощник подскажет, что делать, или поможет оформить заявку.</p>
          <div id="campus-badge" class="hero-badge"></div>
        </section>
        <div id="place"></div>
        <div id="room-note"></div>
        <div id="thread" class="thread" aria-live="polite"></div>
        <div id="composer"></div>
        <div id="draft"></div>
        <div id="extras"></div>
      </div>
      <aside class="report-aside" id="campus" aria-label="Состояние колледжа"></aside>
    </div>`;
  state.campusEntered = false;
  renderPlace();
  renderRoomNote();
  renderComposer();
  renderExtras();
  renderCampus();
  splitWords($(".hero h1"));
  rise(app, ".hero .eyebrow, .hero p, #place, #composer", { step: 95, delay: 90 });
}

// ---------- состояние колледжа и выбранного помещения ----------

/** Этаж помещения без названия корпуса: корпус в колледже один */
function floorText(loc) {
  return loc.floor != null ? `${loc.floor} этаж` : loc.building;
}

async function loadCampus() {
  try {
    state.campus = await api("/api/campus");
  } catch (err) {
    state.campus = null;
    const aside = $("#campus");
    if (aside) {
      aside.innerHTML = `<section class="card card-pad campus-panel"><div class="eyebrow">${spark()} Состояние колледжа</div></section>`;
      aside.querySelector(".campus-panel").append(errorBlock(new ApiError(`Не удалось загрузить состояние колледжа. ${err.message}`, err.status, { network: err.network }), loadCampus, { compact: true }));
    }
    return;
  }
  renderCampus();
}

function renderCampus() {
  const aside = $("#campus");
  const badge = $("#campus-badge");
  const campus = state.campus;
  if (!aside || !campus) return;
  const buildings = campus.buildings || [];
  if (!buildings.length) {
    aside.innerHTML = "";
    return;
  }
  const first = !state.campusEntered;
  state.campusEntered = true;
  if (badge) badge.innerHTML = campusBadge(campus);
  const states = planStates(campus);
  const here = state.location?.id ?? null;
  aside.innerHTML = `
    <section class="card campus-panel ${first ? "enter" : ""}">
      <div class="eyebrow">${spark()} Состояние колледжа</div>
      <div class="campus-head">
        <div>
          <div class="campus-state">${esc(campus.label)}</div>
          <div class="campus-index"><b data-count>${campus.rooms_clear}</b> из ${campus.rooms_total} помещений без заявок</div>
        </div>
        <div class="campus-index"><b data-count>${campus.index}&nbsp;%</b></div>
      </div>
      <div class="campus-meter" aria-hidden="true"><i></i></div>
      <div id="campus-map">${planHtml(states, { here, enter: first })}</div>
      <div class="campus-foot">
        <div class="campus-legend">
          <span><i class="dot"></i>без заявок</span>
          <span><i class="dot open"></i>есть заявка</span>
          <span><i class="dot urgent"></i>срочно</span>
        </div>
        <button type="button" class="pl-help" aria-label="Как пользоваться схемой" aria-expanded="false">?</button>
      </div>
      ${state.location ? `<p class="campus-note">Рамкой отмечено выбранное помещение.</p>` : ""}
    </section>`;
  aside.querySelector(".campus-meter i").style.width = `${campus.index}%`;
  bindPlan(aside, states, {
    // план этажа загружается при первом открытии: на старте страницы он не нужен
    onOpenFloor: (floor, room) =>
      import("./floor-view.js")
        .then(({ openFloor }) => openFloor(floor, { states, here, room, onPick: pickFromPlan }))
        .catch(() => toast("Не удалось открыть план этажа. Проверьте интернет и попробуйте ещё раз.", "error")),
  });
  if (first) {
    rise(aside, ".campus-panel", { delay: 340, dur: 1100 });
    aside.querySelectorAll("[data-count]").forEach((n) => countUp(n, { delay: 620 }));
  }
}

/** Заявитель нажал «Это здесь» на плане: помещение становится местом обращения */
async function pickFromPlan(id) {
  if (!state.locations) {
    try {
      state.locations = await api("/api/locations");
    } catch (err) {
      toast(err.message, "error");
      return;
    }
  }
  const loc = state.locations.find((l) => l.id === id);
  if (!loc) return;
  setLocation(loc, false);
  state.suggestedLocation = null;
  renderPlace();
  $("#message")?.focus();
}

async function loadRoomStatus() {
  const loc = state.location;
  state.roomStatus = null;
  if (!loc) {
    renderPlace();
    renderRoomNote();
    return;
  }
  try {
    const room = await api(`/api/locations/${loc.id}/status`);
    if (state.location?.id === loc.id) state.roomStatus = room;
  } catch {
    state.roomStatus = null;
  }
  renderPlace();
  renderRoomNote(true);
}

function renderRoomNote(animate = false) {
  const box = $("#room-note");
  if (!box) return;
  const room = state.roomStatus;
  if (!room || room.state === "clear" || !room.issues.length || $("#thread")?.children.length) {
    if (box.childElementCount) collapseOut(box, { then: () => (box.innerHTML = "") });
    return;
  }
  const n = room.open;
  box.innerHTML = `
    <div class="room-note is-${esc(room.state)}">
      <div class="row">${nodeGlyph(room.state)}<div class="grow"><b>По этому помещению уже есть ${n === 1 ? "заявка" : "заявки"}</b>
        <div class="small muted">Если ваша проблема в списке, присоединитесь: заявка станет заметнее, а вы будете следить за статусом.</div></div></div>
      ${room.issues
        .map(
          (s) => `
        <div class="node-row">
          <div class="grow"><b>${esc(s.title)}</b><span class="tiny muted">${esc(s.public_number)} · ${esc(s.category)} · сообщили ${s.reports_count}</span></div>
          ${statusChip(s.status, s.status_label)}
          <button type="button" class="btn btn-soft btn-sm" data-join="${s.number}">У меня то же самое</button>
        </div>`,
        )
        .join("")}
    </div>`;
  if (animate) expandIn(box);
  box.querySelectorAll("[data-join]").forEach((b) =>
    b.addEventListener("click", async () => {
      setBusy(b, true);
      try {
        const res = await api(`/api/tickets/${b.dataset.join}/join`, { method: "POST", body: { location_id: state.location.id } });
        const title = room.issues.find((s) => String(s.number) === b.dataset.join)?.title;
        showDone({ ...res, title }, true);
      } catch (err) {
        toast(err.message, "error");
        setBusy(b, false);
      }
    }),
  );
}

function renderPlace() {
  const box = $("#place");
  const loc = state.location;
  let html;
  if (loc) {
    const room = state.roomStatus;
    const statusLine = room ? ` · ${room.label.toLowerCase()}` : "";
    html = `
      <div class="place-pill">
        ${nodeGlyph(room?.state || "none")}
        <div class="place-text"><b>${esc(loc.title)}</b><span>${esc(floorText(loc))}${state.fromQr ? " · по QR-коду" : ""}${statusLine}</span></div>
        <button class="btn btn-ghost btn-sm" data-pick>Изменить</button>
      </div>`;
  } else if (state.locationNote) {
    html = `
      <div class="place-pill">
        <span class="place-icon">${icon("pin")}</span>
        <div class="place-text"><b>${esc(state.locationNote)}</b><span>указано вручную</span></div>
        <button class="btn btn-ghost btn-sm" data-pick>Изменить</button>
      </div>`;
  } else {
    html = `
      <div class="place-pill empty-place">
        <span class="place-icon">${icon("pin")}</span>
        <div class="place-text"><b>Где это?</b><span>Выберите помещение, если сканировали не QR-код</span></div>
        <button class="btn btn-soft btn-sm" data-pick>Выбрать</button>
      </div>`;
  }
  if (state.qrError) {
    html = `<div class="u-mb12 notice notice-warn">${icon("alert")}<div>${esc(state.qrError)}</div></div>` + html;
  }
  if (!loc && state.suggestedLocation) {
    const s = state.suggestedLocation;
    html += `
      <div class="u-mv-n4-14 notice notice-info">${icon("pin")}
        <div class="grow">Похоже, речь о помещении <b>${esc(s.full_title)}</b>. Выбрать его?</div>
        <button class="btn btn-primary btn-sm" data-accept-suggest>Да</button>
      </div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", pickLocation));
  box.querySelector("[data-accept-suggest]")?.addEventListener("click", () => {
    setLocation(state.suggestedLocation, false);
    state.suggestedLocation = null;
    renderPlace();
  });
}

function setLocation(loc, fromQr) {
  state.location = loc;
  state.fromQr = fromQr;
  state.locationNote = "";
  state.qrError = null;
  loadRoomStatus();
  renderCampus();
  if (state.draft) {
    renderDraft();
    checkSimilar();
  }
}

// ---------- ввод сообщения ----------

function renderComposer() {
  const box = $("#composer");
  if (state.draft) {
    box.innerHTML = "";
    return;
  }
  const waitingAnswer = state.context.length > 0;
  box.innerHTML = `
    <form class="composer" id="ask-form" novalidate>
      <label class="sr-only" for="message">Сообщение</label>
      <textarea id="message" rows="3" maxlength="2000" placeholder="${
        waitingAnswer ? "Ответьте на вопрос помощника…" : "Например: в кабинете 214 не работает проектор"
      }"></textarea>
      <div id="photo-slot"></div>
      <div class="composer-bar">
        <button type="button" class="btn btn-ghost btn-sm" id="photo-btn" title="Прикрепить фото: камера, файл или скриншот">
          ${icon("camera")}<span>Фото</span>
        </button>
        <button class="btn btn-primary" type="submit" id="ask-btn">${icon("send")}<span>Отправить</span></button>
      </div>
    </form>`;
  const form = $("#ask-form");
  const area = $("#message");
  // текст не пропадает при обрыве сети и перезагрузке страницы
  // сохранённое сообщение возвращается в поле один раз, при открытии страницы
  if (!area.value && !state.messageRestored) {
    state.messageRestored = true;
    const saved = drafts.get("message");
    if (saved) {
      area.value = saved;
      autoGrow(area);
    }
  }
  area.addEventListener("input", () => {
    autoGrow(area);
    if (area.value.trim()) drafts.set("message", area.value);
    else drafts.remove("message");
  });
  area.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(area.value);
  });
  $("#photo-btn").addEventListener("click", openPhotoPicker);
  // скриншот можно вставить прямо в поле сообщения, а фото перетащить на него
  area.addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    onPhoto(file);
  });
  bindPhotoDrop(form);
  renderPhotoSlot();
  warmPhotoPicker();
}

/** Своё окно для фото: камера на странице, перетаскивание, вставка из буфера */
function openPhotoPicker() {
  const maxMb = state.meta?.max_upload_mb || 8;
  photoPicker()
    .then(({ pickPhoto }) => pickPhoto({ onFile: onPhoto, maxMb }))
    // окно не загрузилось (слабая сеть, нет копии): остаётся обычный выбор фото браузера
    .catch(() => chooseFileNative(onPhoto));
}

// окно фото загружается заранее, пока человек пишет: на слабой сети нажатие на «Фото» не ждёт загрузки
let pickerLoad = null;
function photoPicker() {
  pickerLoad ||= import("./photo-picker.js").catch((err) => {
    pickerLoad = null;
    throw err;
  });
  return pickerLoad;
}
function warmPhotoPicker() {
  setTimeout(() => {
    photoPicker().then(({ warm }) => warm?.()).catch(() => {});
  }, 1500);
}

/** Фото можно бросить прямо на блок с сообщением: блок подсвечивается, пока файл над ним */
function bindPhotoDrop(el) {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  el.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    el.classList.add("is-drop");
  });
  el.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  el.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove("is-drop");
  });
  el.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    el.classList.remove("is-drop");
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (file) onPhoto(file);
    else toast("Можно прикрепить только фото", "error");
  });
}

function autoGrow(area) {
  area.style.height = "auto";
  area.style.height = `${Math.min(area.scrollHeight, 260)}px`;
}

function renderPhotoSlot() {
  const slot = $("#photo-slot");
  if (!slot) return;
  if (!state.photoUrl) {
    slot.innerHTML = "";
    return;
  }
  let status = "";
  if (state.photoAi === "loading") {
    status = `<span class="small muted row"><span class="spinner"></span> ИИ смотрит на фото…</span>`;
  } else if (state.photoAi?.available && state.photoAi.description) {
    status = `<span class="small">${icon("sparkles", "icon-sm")} На фото: ${esc(state.photoAi.description)}</span>`;
    if (state.photoAi.danger) status += ` <span class="small">${icon("alert", "icon-sm")} Похоже на опасную ситуацию: ничего не трогайте и отправьте заявку.</span>`;
  } else if (state.photoAi?.notice) {
    status = `<span class="small muted">${esc(state.photoAi.notice)}</span>`;
  } else {
    status = `<span class="small muted">Фото прикрепится к заявке</span>`;
  }
  slot.innerHTML = `
    <div class="photo-preview">
      ${photoThumb()}
      <div class="grow">${status}</div>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove aria-label="Убрать фото">${icon("x")}</button>
    </div>`;
  slot.querySelector("[data-remove]").addEventListener("click", removePhoto);
  bindThumb(slot);
}

/** Миниатюра фото: нажатие открывает его крупно */
function photoThumb() {
  return `<button type="button" class="photo-thumb" data-zoom aria-label="Посмотреть фото крупно">
    <img src="${state.photoUrl}" alt="">${icon("search", "icon-sm")}</button>`;
}
function bindThumb(root) {
  root.querySelector("[data-zoom]")?.addEventListener("click", () => state.photoUrl && lightbox(state.photoUrl));
}

let photoSeq = 0;
async function onPhoto(file) {
  if (!file) return;
  const limit = (state.meta?.max_upload_mb || 8) * 1024 * 1024;
  // снимок HEIC из «Файлов» на iPhone приходит без типа: узнаём его по расширению
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name || "")) {
    toast("Можно прикрепить только фото", "error");
    return;
  }
  // большой снимок с телефона уменьшается и переводится в JPEG: так он пройдёт по размеру и покажется в предпросмотре
  const mine = ++photoSeq;
  file = await preparePhoto(file);
  // пока готовилось это фото, выбрали другое
  if (mine !== photoSeq) return;
  if (file.size > limit) {
    toast(`Фото больше ${state.meta?.max_upload_mb || 8} МБ, выберите поменьше`, "error");
    return;
  }
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photo = file;
  state.photoUrl = URL.createObjectURL(file);
  state.photoAi = null;

  if (state.meta?.ai.photo) {
    state.photoAi = "loading";
    renderPhotoSlot();
    renderDraftPhoto();
    const form = new FormData();
    form.append("photo", file);
    try {
      state.photoAi = await api("/api/assistant/photo", { method: "POST", form });
      const area = $("#message");
      if (state.photoAi.available && state.photoAi.description && area && !area.value.trim()) {
        area.value = state.photoAi.description;
        autoGrow(area);
      }
      if (state.draft && state.photoAi.category && state.draft.category === "other") {
        state.draft.category = state.photoAi.category;
        renderDraft();
      }
    } catch (err) {
      state.photoAi = { available: false, notice: err.message };
    }
  }
  renderPhotoSlot();
  renderDraftPhoto();
}

function removePhoto() {
  photoSeq += 1;
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photo = null;
  state.photoUrl = null;
  state.photoAi = null;
  renderPhotoSlot();
  renderDraftPhoto();
}

// ---------- диалог с ИИ ----------

async function ask(rawText) {
  let text = rawText.trim();
  if (!text && state.photoAi?.available && state.photoAi.description) text = state.photoAi.description;
  if (!text) {
    const area = $("#message");
    area.focus();
    toast("Напишите пару слов о проблеме", "error");
    return;
  }
  const button = $("#ask-btn");
  setBusy(button, true);
  $("#message").value = "";

  // прошлые сообщения в заявку собирает сервер: он отбрасывает посторонние фразы
  state.lastText = text;
  addUserBubble(text);
  const typing = addTyping();
  try {
    const reply = await api("/api/assistant", {
      method: "POST",
      body: { message: text, location_id: state.location?.id ?? null, context: state.context },
    });
    typing.remove();
    drafts.remove("message");
    state.context = reply.kind === "unclear" ? [...state.context, text].slice(-3) : [];
    if (reply.suggested_location && !state.location) {
      state.suggestedLocation = reply.suggested_location;
      renderPlace();
    }
    addAiCard(reply);
    if (reply.suggest_ticket) openDraft(reply);
    else renderComposer();
  } catch (err) {
    typing.remove();
    addErrorBubble(err, text);
    renderComposer();
  } finally {
    setBusy(button, false);
    renderExtras();
    renderRoomNote();
  }
}

function addUserBubble(text) {
  const el = h(`<div class="bubble-user">${esc(text)}</div>`);
  if (state.photoUrl) el.append(h(`<img class="bubble-photo" src="${state.photoUrl}" alt="">`));
  $("#thread").append(el);
}

function addTyping() {
  const el = h(`
    <div class="ai-card is-typing"><div class="ai-card-head"><span class="ai-avatar">${markSvg()}</span>
      <span class="typing" aria-label="Помощник думает"><i></i><i></i><i></i></span></div></div>`);
  $("#thread").append(el);
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return el;
}

function addErrorBubble(err, text) {
  // сообщение сохраняется: после перезагрузки оно вернётся в поле ввода
  drafts.set("message", text);
  const note = err.network ? " Сообщение сохранено и уйдёт само, когда появится связь." : "";
  const el = h(`
    <div class="notice notice-danger">${icon("alert")}
      <div class="grow">${esc(err.message)}${esc(note)}</div>
      <button class="btn btn-sm">Повторить</button>
    </div>`);
  let cancel = null;
  const retry = () => {
    cancel?.();
    if (!el.isConnected) return;
    el.remove();
    $("#thread").lastElementChild?.remove();
    ask(text);
  };
  el.querySelector("button").addEventListener("click", retry);
  if (err.network) cancel = whenOnline(retry);
  $("#thread").append(el);
}

const KIND_ICONS = { question: "book", fault: "clipboard", danger: "alert", unclear: "help", unknown: "info", secret: "lock" };

function addAiCard(reply) {
  const confidence = Math.round((reply.confidence || 0) * 100);
  const tips = reply.tips?.length
    ? `<ul class="ai-tips">${reply.tips.map((t) => `<li>${icon("check")}<span>${esc(t)}</span></li>`).join("")}</ul>`
    : "";
  const sources = reply.sources?.length
    ? `<div class="ai-source">${icon("book", "icon-sm")}<div>Источник: ${reply.sources
        .map((s) => `${esc(s.source)} · «${esc(s.title)}»`)
        .join("; ")}</div></div>`
    : "";
  const clarify = reply.clarify_question ? `<div class="notice notice-info">${icon("help")}<div>${esc(reply.clarify_question)}</div></div>` : "";

  let actions = "";
  if (reply.kind === "question") {
    actions = `<div class="row-wrap"><button class="btn btn-soft btn-sm" data-act="ticket">Не помогло, оформить заявку</button>
      <button class="btn btn-ghost btn-sm" data-act="thanks">${icon("check", "icon-sm")} Спасибо, помогло</button></div>`;
  } else if (reply.kind === "unknown" || reply.kind === "secret") {
    actions = `<div class="row-wrap"><button class="btn btn-soft btn-sm" data-act="ticket">Оставить обращение сотруднику</button></div>`;
  }

  const card = h(`
    <article class="ai-card kind-${esc(reply.kind)}">
      <div class="ai-card-head">
        <span class="ai-avatar">${reply.kind === "danger" ? icon("alert") : markSvg()}</span>
        <div class="grow">
          <div class="u-gap8 row"><b>${esc(reply.kind_label)}</b>${
            reply.kind === "danger" ? `<span class="chip pr-critical">Важно</span>` : ""
          }</div>
        </div>
        <span class="tag" title="Тип сообщения">${icon(KIND_ICONS[reply.kind] || "info", "icon-sm")}</span>
      </div>
      <div class="ai-card-body">
        <div class="ai-answer">${esc(reply.answer)}</div>
        ${tips}${clarify}${sources}${actions}
        <div class="ai-meta">
          <span>${icon("sparkles", "icon-sm")} ${esc(reply.engine_label)}</span>
          ${reply.category ? `<span>Категория: ${esc(categoryName(reply.category))}</span>` : ""}
          <span class="confidence" title="Уверенность помощника">уверенность <span class="confidence-bar"><i data-css-pct="${confidence}"></i></span> ${confidence}%</span>
        </div>
        ${reply.notice ? `<div class="small faint">${icon("info", "icon-sm")} ${esc(reply.notice)}</div>` : ""}
      </div>
    </article>`);

  card.querySelector('[data-act="ticket"]')?.addEventListener("click", () => openDraft(reply, true));
  card.querySelector('[data-act="thanks"]')?.addEventListener("click", (e) => {
    e.target.closest(".row-wrap").replaceWith(h(`<div class="small muted">Рад помочь! Если появится другая проблема, просто напишите.</div>`));
  });
  $("#thread").append(card);
  textIn(card.querySelector(".ai-answer"));
  ambient.pulseAt(card.querySelector(".ai-avatar"), reply.kind === "danger" ? 1 : 0.4);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- черновик заявки ----------

function openDraft(reply, manual = false) {
  const text = state.lastText;
  let title = reply?.draft_title || "";
  if (!title && text) title = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  state.draft = {
    title,
    description: reply?.draft_description || text,
    category: reply?.category || (state.photoAi?.category ?? "other"),
    priority: reply?.priority || "normal",
    contact: "",
    requestId: uid(),
    analysisId: reply?.analysis_id ?? null,
    kind: reply?.kind,
    manual,
    error: null,
  };
  state.similar = [];
  state.dupDismissed = false;
  state.draftFresh = true;
  renderComposer();
  renderDraft();
  expandIn($("#draft"), { duration: 760 });
  checkSimilar();
  setTimeout(() => $("#draft").scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}

/** Черновик заявки на этом устройстве: переживает обрыв сети и перезагрузку страницы. Фото не сохраняется. */
function saveTicketDraft() {
  const d = state.draft;
  if (!d) return;
  drafts.set("ticket", {
    title: d.title,
    description: d.description,
    category: d.category,
    priority: d.priority,
    contact: d.contact,
    requestId: d.requestId,
    analysisId: d.analysisId,
    kind: d.kind,
    manual: d.manual,
    locationId: state.location?.id ?? null,
    locationNote: state.locationNote,
    hadPhoto: !!state.photo,
    // заявку уже пытались отправить без сети: после перезагрузки она уйдёт сама
    queued: !!d.queued,
  });
}

/** Незаконченная заявка с прошлого раза открывается снова, с тем же номером запроса: дубля не будет */
async function restoreTicketDraft() {
  const saved = drafts.get("ticket");
  if (!saved || state.draft || !saved.description) return;
  if (saved.locationId != null && !state.location) {
    try {
      state.locations = state.locations || (await api("/api/locations"));
      state.location = state.locations.find((l) => l.id === saved.locationId) || null;
    } catch {
      /* без сети помещение не узнать: заявитель выберет его заново */
    }
  }
  if (!state.location && saved.locationNote) state.locationNote = saved.locationNote;
  state.draft = { ...saved, error: null };
  state.similar = [];
  state.dupDismissed = false;
  renderPlace();
  renderComposer();
  renderDraft();
  if (saved.queued) {
    // заявка ждала связь: отправляем сразу или когда сеть появится
    state.draft.error = saved.hadPhoto
      ? "Заявка ждёт связь и отправится сама. Фото не сохранилось на устройстве: прикрепите его заново, если нужно."
      : "Заявка ждёт связь и отправится сама.";
    renderError();
    if (navigator.onLine) submit();
    else {
      state.retrySubmit = whenOnline(() => {
        state.retrySubmit = null;
        if (state.draft?.requestId === saved.requestId) submit();
      });
    }
  } else if (saved.hadPhoto) {
    state.draft.error = "Черновик восстановлен. Фото не сохранилось: прикрепите его заново, если нужно.";
    renderError();
  } else {
    toast("Восстановлен незаконченный черновик заявки");
  }
}

function closeDraft() {
  drafts.remove("ticket");
  state.draft = null;
  const box = $("#draft");
  collapseOut(box, { then: () => (box.innerHTML = "") });
  renderComposer();
}

function renderDraft() {
  const d = state.draft;
  const box = $("#draft");
  if (!d) {
    box.innerHTML = "";
    return;
  }
  const loc = state.location;
  const placeField = loc
    ? `<div class="u-m0 place-pill"><span class="place-icon">${icon("pin")}</span>
         <div class="place-text"><b>${esc(loc.title)}</b><span>${esc(floorText(loc))}</span></div>
         <button type="button" class="btn btn-ghost btn-sm" data-pick>Изменить</button></div>`
    : `<button type="button" class="btn btn-soft" data-pick>${icon("pin")} Выбрать помещение из списка</button>
       <input class="input" id="d-note" maxlength="160" placeholder="или напишите сами: этаж и кабинет" value="${esc(state.locationNote)}">`;

  const cats = state.meta.categories
    .map(
      (c) => `<button type="button" class="cat-option" role="radio" aria-checked="${c.code === d.category}" data-cat="${esc(c.code)}">
        ${icon(c.icon)}<span>${esc(c.name)}</span></button>`,
    )
    .join("");

  const fresh = state.draftFresh;
  state.draftFresh = false;
  box.innerHTML = `
    <form class="card draft ${fresh ? "" : "no-enter"}" id="draft-form" novalidate>
      <div class="card-pad">
        <div class="row between">
          <h2>${d.kind === "danger" ? "Срочная заявка" : "Заявка в УПК"}</h2>
          <span class="tag">приоритет ${priorityChip(d.priority, PRIORITY_LABELS[d.priority])}</span>
        </div>
        <div id="dup"></div>
        <div class="field"><span class="label">Где это</span>${placeField}</div>
        <div class="field"><span class="label">Категория</span><div class="cat-grid" role="radiogroup">${cats}</div></div>
        <div class="field">
          <label for="d-title">Коротко о проблеме</label>
          <input class="input" id="d-title" maxlength="120" value="${esc(d.title)}" placeholder="Например: Не работает проектор">
        </div>
        <div class="field">
          <label for="d-desc">Описание</label>
          <textarea class="textarea" id="d-desc" maxlength="2000" placeholder="Что случилось, как давно, что уже пробовали">${esc(d.description)}</textarea>
        </div>
        <div class="field"><span class="label">Фото</span><div id="d-photo"></div></div>
        <div class="field">
          <label for="d-contact">Как к вам обращаться <span class="faint">(необязательно)</span></label>
          <input class="input" id="d-contact" maxlength="120" value="${esc(d.contact)}" placeholder="Имя или группа, если сотруднику нужно будет уточнить детали">
        </div>
        <p class="small muted">Отправляя заявку, вы соглашаетесь с <a href="/privacy" target="_blank" rel="noopener">обработкой данных</a>. Имя указывать необязательно.</p>
        <div id="d-error"></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit" id="submit-btn">${icon("send")} Отправить заявку</button>
        <button class="btn btn-ghost btn-block" type="button" data-cancel>Отмена</button>
      </div>
    </form>`;

  const form = $("#draft-form");
  form.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", pickLocation));
  form.querySelectorAll("[data-cat]").forEach((b) =>
    b.addEventListener("click", () => {
      d.category = b.dataset.cat;
      form.querySelectorAll("[data-cat]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      checkSimilar();
    }),
  );
  $("#d-title").addEventListener("input", (e) => (d.title = e.target.value));
  $("#d-desc").addEventListener("input", (e) => (d.description = e.target.value));
  $("#d-contact").addEventListener("input", (e) => (d.contact = e.target.value));
  $("#d-note")?.addEventListener("input", (e) => (state.locationNote = e.target.value));
  form.addEventListener("input", saveTicketDraft);
  form.addEventListener("click", () => setTimeout(saveTicketDraft));
  saveTicketDraft();
  form.querySelector("[data-cancel]").addEventListener("click", closeDraft);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  renderDraftPhoto();
  renderDup();
  renderError();
}

function renderDraftPhoto() {
  const slot = $("#d-photo");
  if (!slot) return;
  if (state.photoUrl) {
    slot.innerHTML = `
      <div class="u-m0 photo-preview">
        ${photoThumb()}
        <div class="grow small muted">${state.photoAi === "loading" ? "ИИ смотрит на фото…" : "Фото будет прикреплено"}</div>
        <button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove aria-label="Убрать фото">${icon("x")}</button>
      </div>`;
    slot.querySelector("[data-remove]").addEventListener("click", removePhoto);
    bindThumb(slot);
  } else {
    slot.innerHTML = `<button type="button" class="u-self-start btn">${icon("camera")} Добавить фото</button>`;
    slot.querySelector("button").addEventListener("click", openPhotoPicker);
  }
}

function renderError() {
  const box = $("#d-error");
  if (!box) return;
  box.innerHTML = state.draft?.error ? `<div class="notice notice-danger">${icon("alert")}<div>${esc(state.draft.error)}</div></div>` : "";
}

async function checkSimilar() {
  const d = state.draft;
  if (!d || !state.location || state.dupDismissed) {
    state.similar = [];
    renderDup();
    return;
  }
  try {
    state.similar = await api("/api/tickets/similar", {
      method: "POST",
      body: { location_id: state.location.id, category: d.category, text: `${d.title} ${d.description}` },
    });
  } catch {
    state.similar = [];
  }
  renderDup();
}

function renderDup() {
  const box = $("#dup");
  if (!box) return;
  if (!state.similar.length || state.dupDismissed) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `
    <div class="dup-box">
      <div class="row">${icon("users")}<b>Похоже, об этом уже сообщили</b></div>
      ${state.similar
        .map(
          (s) => `
        <div class="dup-item">
          <div class="row between"><b>${esc(s.public_number)} · ${esc(s.title)}</b>${statusChip(s.status, s.status_label)}</div>
          <div class="small muted">${esc(s.category)} · ${relTime(s.created_at)} · сообщили ${s.reports_count} ${
            s.reports_count === 1 ? "человек" : "человека"
          }</div>
          <button type="button" class="u-self-start btn btn-primary btn-sm" data-join="${s.number}">Это та же проблема, присоединиться</button>
        </div>`,
        )
        .join("")}
      <button type="button" class="u-self-start btn btn-ghost btn-sm" data-dismiss>Нет, у меня другая проблема</button>
      <div class="tiny muted">Если присоединиться, вы будете следить за той же заявкой, а сотрудники увидят, что проблема касается многих.</div>
    </div>`;
  box.querySelector("[data-dismiss]").addEventListener("click", () => {
    state.dupDismissed = true;
    renderDup();
  });
  box.querySelectorAll("[data-join]").forEach((b) =>
    b.addEventListener("click", async () => {
      setBusy(b, true);
      try {
        const res = await api(`/api/tickets/${b.dataset.join}/join`, { method: "POST", body: { location_id: state.location.id } });
        const title = state.similar.find((s) => String(s.number) === b.dataset.join)?.title;
        showDone({ ...res, title }, true);
      } catch (err) {
        toast(err.message, "error");
        setBusy(b, false);
      }
    }),
  );
}

async function submit() {
  const d = state.draft;
  if (state.sending) return;
  d.error = null;
  if ((d.description || "").trim().length < 5) d.error = "Опишите проблему хотя бы парой слов.";
  else if (!state.location && !state.locationNote.trim()) d.error = "Укажите, где это: выберите помещение или напишите этаж и кабинет.";
  if (d.error) {
    renderError();
    $("#d-error").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  renderError();

  const form = new FormData();
  form.append("title", (d.title || "").trim());
  form.append("description", d.description.trim());
  form.append("category", d.category);
  if (state.location) form.append("location_id", state.location.id);
  else form.append("location_note", state.locationNote.trim());
  form.append("contact", (d.contact || "").trim());
  form.append("priority", d.priority);
  form.append("client_request_id", d.requestId);
  form.append("source", state.fromQr ? "qr" : "manual");
  if (d.analysisId) form.append("analysis_id", d.analysisId);
  if (state.photo) form.append("photo", state.photo, state.photo.name || "photo.jpg");

  const button = $("#submit-btn");
  state.sending = true;
  setBusy(button, true, "Отправляем…");
  try {
    const res = await api("/api/tickets", { method: "POST", form });
    showDone({ ...res, title: d.title || d.description.slice(0, 60) }, false);
  } catch (err) {
    // заявка не создана: показываем ошибку, а не «успех»
    if (err instanceof ApiError && err.network) {
      // номер запроса тот же, поэтому повторная отправка не создаст дубль
      d.queued = true;
      saveTicketDraft();
      d.error = `${err.message} Заявка сохранена на этом устройстве и отправится сама, когда появится связь.`;
      state.retrySubmit?.();
      state.retrySubmit = whenOnline(() => {
        state.retrySubmit = null;
        if (state.draft === d) submit();
      });
    } else {
      d.error = `Заявка не отправлена. ${err.message}`;
    }
    renderError();
    setBusy(button, false);
  } finally {
    state.sending = false;
  }
}

// ---------- готово ----------

async function showDone(res, joined) {
  drafts.remove("ticket");
  drafts.remove("message");
  if (res.code) {
    myTickets.add({
      code: res.code.replace(/-/g, ""),
      number: res.public_number,
      title: res.title || "",
      created_at: res.created_at,
      status_label: res.status_label,
    });
  }
  const trackUrl = res.tracking_url;
  await leave(app.firstElementChild);
  window.scrollTo({ top: 0 });
  app.innerHTML = `
    <section class="card done-card">
      <div class="ignite" aria-hidden="true"><i class="ray"></i><i class="ray"></i><i class="ray"></i><i class="ray"></i>${spark()}</div>
      <h2 role="heading" aria-level="1" tabindex="-1" id="done-title">${joined ? "Вы присоединились к заявке" : "Заявка зарегистрирована"}</h2>
      <p class="u-maxw440 muted">${
        joined
          ? "Теперь вы следите за той же заявкой. Чем больше людей сообщили, тем быстрее её замечают."
          : `Сотрудники УПК уже видят заявку${state.location ? ` по помещению «${esc(state.location.title)}»` : ""}. Статус можно отслеживать по коду ниже.`
      }</p>
      <div>
        <div class="small muted">Номер заявки</div>
        <div class="ticket-number">${esc(res.public_number)}</div>
      </div>
      ${statusChip("new", res.status_label)}
      ${
        res.code
          ? `<div class="u-w100 u-maxw420 stack-sm">
              <div class="small muted">Код отслеживания</div>
              <div class="code-box"><span class="grow">${esc(res.code)}</span>
                <button class="btn btn-ghost btn-icon btn-sm" data-copy aria-label="Скопировать код">${icon("copy")}</button></div>
              <div class="tiny muted">Сохраните код: по нему можно проверить статус. Заявка также сохранена на этом устройстве в разделе «Мои заявки».</div>
            </div>
            <div class="u-justify-center row-wrap">
              <a class="btn btn-primary btn-lg" href="${esc(trackUrl)}">${icon("clipboard")} Открыть статус</a>
              ${res.telegram_url ? `<a class="btn btn-lg" href="${esc(res.telegram_url)}" target="_blank" rel="noopener">${icon("telegram")} Уведомления в Telegram</a>` : ""}
            </div>
            <img class="qr-mini" src="/api/track/${esc(res.code.replace(/-/g, ""))}/qr.svg" alt="QR-код страницы заявки">
            <div class="tiny muted">Отсканируйте, чтобы открыть статус на другом телефоне</div>`
          : `<div class="notice notice-warn">${icon("info")}<div>Заявка уже была отправлена раньше. Если код отслеживания не сохранился, обратитесь к сотруднику УПК и назовите номер заявки.</div></div>`
      }
      ${res.warning ? `<div class="notice notice-warn">${icon("alert")}<div>${esc(res.warning)}</div></div>` : ""}
      <button class="btn btn-ghost" data-again>Сообщить о другой проблеме</button>
    </section>`;
  app.querySelector("[data-copy]")?.addEventListener("click", () => copyText(res.code));
  app.querySelector("[data-again]").addEventListener("click", async () => {
    const loc = state.location;
    const fromQr = state.fromQr;
    resetState();
    state.location = loc;
    state.fromQr = fromQr;
    await leave(app.firstElementChild);
    renderShell();
    loadCampus();
    loadRoomStatus();
  });
  ambient.pulseAt(app.querySelector(".ignite"), 1);
  ambient.spread(0.22);
  scramble(app.querySelector(".ticket-number"), { duration: 1100, delay: 340 });
  // кнопки отправки больше нет: фокус переходит на заголовок, и программа чтения с экрана сообщает, что заявка принята
  $("#done-title")?.focus({ preventScroll: true });
  const codeEl = app.querySelector(".code-box .grow");
  if (codeEl) scramble(codeEl, { duration: 1300, delay: 520 });
}

function resetState() {
  removePhoto();
  Object.assign(state, {
    thread: [],
    context: [],
    lastText: "",
    draft: null,
    similar: [],
    dupDismissed: false,
    suggestedLocation: null,
    qrError: null,
  });
}

// ---------- примеры и мои заявки ----------

function renderExtras() {
  const box = $("#extras");
  if (!box) return;
  if ($("#thread").children.length) {
    box.innerHTML = "";
    return;
  }
  const mine = myTickets.list().slice(0, 4);
  box.innerHTML = `
    <div class="examples">${EXAMPLES.map((e) => `<button class="example" type="button">${esc(e)}</button>`).join("")}</div>
    ${
      mine.length
        ? `<section class="my-tickets">
            <div class="u-mb8 row between"><h2 class="h3">Мои заявки</h2><a class="small" href="/track">Все</a></div>
            <div class="card">${mine
              .map(
                (t) => `<a class="my-ticket" href="/t/${esc(t.code)}">
                  <span class="my-ticket-icon place-icon">${icon("clipboard")}</span>
                  <span class="grow"><b>${esc(t.number)}</b> <span class="muted">${esc(t.title)}</span><br><span class="tiny faint">${fmtDate(t.created_at)}</span></span>
                  ${icon("chevronRight")}</a>`,
              )
              .join("")}</div>
          </section>`
        : ""
    }`;
  // «Мои заявки» появляются вместе с примерами, а не сразу
  rise(box, ".example, .my-tickets", { step: 42, delay: 460, dur: 800 });
  box.querySelectorAll(".example").forEach((b) =>
    b.addEventListener("click", () => {
      const area = $("#message");
      area.value = b.textContent;
      ask(area.value);
    }),
  );
}

// ---------- выбор помещения ----------

async function pickLocation() {
  if (!state.locations) {
    try {
      state.locations = await api("/api/locations");
    } catch (err) {
      toast(err.message, "error");
      return;
    }
  }
  const renderList = (query) => {
    const q = query.trim().toLowerCase();
    const items = state.locations.filter((l) => !q || l.full_title.toLowerCase().includes(q));
    if (!items.length) return `<div class="empty small">Ничего не нашлось. Напишите место вручную ниже.</div>`;
    let html = "";
    let group = "";
    for (const l of items) {
      const g = floorText(l);
      if (g !== group) {
        html += `<div class="loc-group">${esc(g)}</div>`;
        group = g;
      }
      html += `<button type="button" class="loc-item" data-id="${l.id}">${icon(l.kind === "lab" ? "layers" : l.kind === "common" ? "users2" : "pin")}<span class="grow">${esc(l.title)}</span>${
        state.location?.id === l.id ? icon("check") : ""
      }</button>`;
    }
    return html;
  };
  openModal({
    title: "Где это?",
    body: `
      <div class="input-icon">${icon("search")}<input class="input" id="loc-q" placeholder="Номер кабинета или название, например 214"></div>
      <div class="loc-list" id="loc-list">${renderList("")}</div>
      <hr class="sep">
      <div class="field"><label for="loc-note">Нет в списке? Напишите сами</label>
        <div class="row"><input class="input" id="loc-note" maxlength="160" placeholder="3 этаж, кабинет 318" value="${esc(state.locationNote)}">
        <button class="btn btn-primary" id="loc-note-ok">Готово</button></div></div>`,
    onMount(el, close) {
      const list = el.querySelector("#loc-list");
      const bind = () =>
        list.querySelectorAll("[data-id]").forEach((b) =>
          b.addEventListener("click", () => {
            const loc = state.locations.find((l) => String(l.id) === b.dataset.id);
            setLocation(loc, false);
            state.suggestedLocation = null;
            renderPlace();
            close();
          }),
        );
      bind();
      el.querySelector("#loc-q").addEventListener("input", (e) => {
        list.innerHTML = renderList(e.target.value);
        bind();
      });
      el.querySelector("#loc-note-ok").addEventListener("click", () => {
        const note = el.querySelector("#loc-note").value.trim();
        if (!note) return;
        state.location = null;
        state.fromQr = false;
        state.locationNote = note;
        state.qrError = null;
        renderPlace();
        if (state.draft) renderDraft();
        close();
      });
    },
  });
}

// ---------- старт ----------

async function init() {
  startAmbient();
  initMotion();
  themeToggle($("#theme"));
  enableOffline();
  await start();
}

async function start() {
  try {
    state.meta = await api("/api/meta");
  } catch (err) {
    app.innerHTML = "";
    app.append(errorBlock(err, start));
    return;
  }
  const match = location.pathname.match(/^\/r\/([^/]+)/);
  if (match) {
    try {
      const loc = await api(`/api/locations/qr/${encodeURIComponent(match[1])}`);
      state.location = loc;
      state.fromQr = true;
    } catch (err) {
      state.qrError = err.status === 404 ? err.message : `Не удалось определить помещение: ${err.message}`;
    }
  }
  renderShell();
  loadCampus();
  if (state.location) loadRoomStatus();
  restoreTicketDraft();
}

init();
