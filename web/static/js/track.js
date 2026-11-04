import {
  $,
  api,
  copyText,
  enableOffline,
  errorBlock,
  esc,
  fmtDate,
  icon,
  lightbox,
  myTickets,
  relTime,
  setBusy,
  statusChip,
  themeToggle,
  toast,
} from "./core.js";
import { ambient, startAmbient } from "./ambient.js";
import { spark } from "./campus.js";
import { initMotion, onView, rise, scramble, splitWords } from "./motion.js";

const app = $("#app");
const STEPS = [
  { key: "new", label: "Принята" },
  { key: "review", label: "Рассмотрение" },
  { key: "assigned", label: "Исполнитель" },
  { key: "in_progress", label: "В работе" },
  { key: "resolved", label: "Решена" },
];
const STEP_INDEX = { new: 0, review: 1, need_info: 1, assigned: 2, in_progress: 3, resolved: 4, rejected: 4 };

let code = null;
let data = null;
let timer = null;
let pickedRating = 0;

function codeFromPath() {
  const m = location.pathname.match(/^\/t\/([A-Za-z0-9-]+)/);
  return m ? m[1].replace(/-/g, "").toUpperCase() : null;
}

// ---------- ввод кода ----------

function renderLookup(error = "") {
  const mine = myTickets.list();
  app.innerHTML = `
    <section class="hero">
      <h1>Проверить статус</h1>
      <p>Введите код отслеживания, который вы получили после отправки заявки.</p>
    </section>
    <form class="card card-pad stack" id="lookup" novalidate>
      <div class="field">
        <label for="code">Код отслеживания</label>
        <input class="u-code-input input mono" id="code" autocomplete="off" autocapitalize="characters" spellcheck="false"
          placeholder="XXXX-XXXX-XXXX-XXXX" maxlength="19">
        ${error ? `<div class="error">${esc(error)}</div>` : `<div class="hint">16 символов: латинские буквы и цифры</div>`}
      </div>
      <button class="btn btn-primary btn-lg" type="submit">${icon("search")} Найти заявку</button>
    </form>
    ${
      mine.length
        ? `<section class="my-tickets">
            <h3 class="u-mb8">Мои заявки на этом устройстве</h3>
            <div class="card">${mine
              .map(
                (t) => `<a class="my-ticket" href="/t/${esc(t.code)}">
                  <span class="grow"><b>${esc(t.number)}</b> <span class="muted">${esc(t.title)}</span><br>
                  <span class="tiny faint">${fmtDate(t.created_at)}${t.status_label ? ` · ${esc(t.status_label)}` : ""}</span></span>
                  ${icon("chevronRight")}</a>`,
              )
              .join("")}</div>
          </section>`
        : ""
    }`;
  const input = $("#code");
  input.addEventListener("input", () => {
    const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    input.value = raw.match(/.{1,4}/g)?.join("-") ?? "";
  });
  $("#lookup").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.replace(/-/g, "");
    if (value.length !== 16) {
      renderLookup("В коде должно быть 16 символов");
      $("#code").value = input.value;
      return;
    }
    history.pushState(null, "", `/t/${value}`);
    start(value);
  });
  input.focus();
}

// ---------- заявка ----------

async function load(silent = false) {
  try {
    data = await api(`/api/track/${code}`);
    myTickets.update(code, { status_label: data.status_label });
    render();
  } catch (err) {
    if (!silent) {
      if (err.status === 404) renderLookup(err.message);
      else {
        app.innerHTML = "";
        app.append(errorBlock(err, () => load()));
      }
    }
  }
}

function stepper() {
  const current = STEP_INDEX[data.status] ?? 0;
  const resolved = data.status === "resolved";
  const fill = resolved ? 80 : (current / 4) * 80;
  const caption = resolved
    ? "Проблема решена"
    : data.status === "rejected"
      ? "Заявка отклонена: причина в истории ниже"
      : `Этап ${Math.min(current + 1, 5)} из 5`;
  return `<div class="track-path" aria-label="Ход выполнения">
    <i class="track-fill" data-css-pct="${fill}"></i>
    ${STEPS.map((s, i) => {
      let cls = "";
      if (resolved || i < current) cls = "done";
      else if (i === current) cls = "current";
      let label = s.label;
      if (i === 4 && data.status === "rejected") label = "Отклонена";
      return `<div class="tp-step ${cls} ${i === 4 ? "final" : ""}" data-css-i="${i}"><div class="tp-node">${spark()}</div><span>${label}</span></div>`;
    }).join("")}
  </div>
  <div class="track-caption">${caption}</div>`;
}

function statusBlock() {
  if (data.status === "need_info") {
    return `
      <section class="u-border-warn card card-pad stack">
        <div class="row">${icon("help")}<h3>Сотруднику нужно уточнение</h3></div>
        ${data.need_info_question ? `<div class="notice notice-warn">${icon("message")}<div class="pre">${esc(data.need_info_question)}</div></div>` : ""}
        ${replyForm("Ваш ответ")}
      </section>`;
  }
  if (data.status === "resolved") {
    return `
      <section class="card card-pad stack">
        <div class="notice notice-ok">${icon("checkCircle")}<div><b>Заявка решена.</b>${data.resolution ? `<div class="u-mt4 pre">${esc(data.resolution)}</div>` : ""}</div></div>
        ${
          data.rating
            ? `<div class="row"><span class="muted">Ваша оценка:</span><span class="stars">${[1, 2, 3, 4, 5]
                .map((n) => `<span class="star u-cursor-default ${n <= data.rating ? "on" : ""}">${icon("star")}</span>`)
                .join("")}</span></div>`
            : data.can_rate
              ? `<div class="stack-sm">
                  <b>Оцените, как решили проблему</b>
                  <div class="stars" id="stars">${[1, 2, 3, 4, 5]
                    .map((n) => `<button class="star" data-n="${n}" aria-label="${n} из 5">${icon("star")}</button>`)
                    .join("")}</div>
                  <textarea class="u-minh64 textarea" id="rate-comment" rows="2" maxlength="1000" placeholder="Комментарий (необязательно)"></textarea>
                  <button class="u-self-start btn btn-primary" id="rate-btn" disabled>Отправить оценку</button>
                </div>`
              : ""
        }
      </section>`;
  }
  if (data.status === "rejected") {
    return `<div class="notice">${icon("info")}<div><b>Заявка отклонена.</b>${data.resolution ? `<div class="u-mt4 pre">${esc(data.resolution)}</div>` : ""}
      <div class="u-mt6 small muted">Если проблема осталась, оставьте новое обращение или подойдите к сотруднику УПК.</div></div></div>`;
  }
  return "";
}

function replyForm(label) {
  return `
    <form class="stack-sm" id="reply-form">
      <label class="label" for="reply">${esc(label)}</label>
      <textarea class="textarea" id="reply" rows="3" maxlength="2000" placeholder="Напишите сообщение сотруднику"></textarea>
      <button class="u-self-start btn btn-primary" type="submit" id="reply-btn">${icon("send")} Отправить</button>
    </form>`;
}

let shownStatus = null;

function render() {
  const d = data;
  // при первом показе блоки появляются каскадом, при фоновом обновлении страница не дёргается
  const first = shownStatus === null;
  const changed = !first && shownStatus !== d.status;
  shownStatus = d.status;
  const comments = d.comments.length
    ? d.comments
        .map(
          (c) => `<div class="comment ${c.from_reporter ? "mine" : ""}">
            <div class="comment-head"><b>${esc(c.author)}</b><span>${fmtDate(c.created_at)}</span></div>
            <div class="pre">${esc(c.body)}</div></div>`,
        )
        .join("")
    : `<div class="small muted">Комментариев пока нет. Сотрудник напишет здесь, если появятся новости.</div>`;

  const history = [...d.history]
    .reverse()
    .map(
      (h, i) => `<li class="${i === 0 ? "hl" : ""}"><div>${esc(h.text)}</div>
        ${h.note ? `<div class="note pre">${esc(h.note)}</div>` : ""}
        <div class="when">${fmtDate(h.created_at)}</div></li>`,
    )
    .join("");

  app.innerHTML = `
    <div class="stack ${first ? "track-enter" : "track-quiet"}" id="track-root">
      <section class="card status-hero">
        <div class="row between">
          <span class="number">ЗАЯВКА ${esc(d.public_number)}</span>
          <button class="btn btn-ghost btn-sm" id="refresh" title="Обновить">${icon("refresh", "icon-sm")} <span class="tiny hide-mobile">обновить</span></button>
        </div>
        <h1>${esc(d.title)}</h1>
        <div>${statusChip(d.status, d.status_label, true)}</div>
        ${stepper()}
        <div class="small muted">Последнее изменение ${relTime(d.updated_at)}</div>
      </section>

      ${statusBlock()}

      <section class="card card-pad stack">
        <dl class="u-m0 info-grid">
          <div><dt>Место</dt><dd>${esc(d.place)}</dd></div>
          <div><dt>Категория</dt><dd>${esc(d.category)}</dd></div>
          <div><dt>Создана</dt><dd>${fmtDate(d.created_at)}</dd></div>
          <div><dt>Сообщили</dt><dd>${d.reports_count} ${d.reports_count === 1 ? "человек" : "человека"}</dd></div>
        </dl>
        ${d.description ? `<div><div class="u-mb4 label">Описание</div><div class="pre">${esc(d.description)}</div></div>` : ""}
        ${
          d.attachments.length
            ? `<div class="row-wrap">${d.attachments
                .map((a) => `<button class="photo-thumb" data-photo="${esc(a.url)}"><img src="${esc(a.url)}" alt="Фото к заявке" loading="lazy"></button>`)
                .join("")}</div>`
            : ""
        }
        ${!d.is_reporter ? `<div class="notice notice-info">${icon("users")}<div class="small">Вы присоединились к чужой заявке, поэтому её описание и фото скрыты. Статус и ответы сотрудников видны полностью.</div></div>` : ""}
      </section>

      <section class="card card-pad stack">
        <h3>Ответы сотрудников</h3>
        ${comments}
        ${d.can_reply && d.status !== "need_info" ? replyForm("Дополнить заявку") : ""}
      </section>

      <section class="card card-pad stack">
        <h3>История</h3>
        <ul class="timeline">${history}</ul>
      </section>

      <section class="card card-pad stack">
        <div class="row between"><div><div class="label">Код отслеживания</div><div class="u-fw700 u-fs16 mono">${esc(d.code)}</div></div>
          <button class="btn btn-sm" id="copy-code">${icon("copy", "icon-sm")} Копировать</button></div>
        ${
          d.telegram_url
            ? d.telegram_linked
              ? `<div class="notice notice-ok">${icon("telegram")}<div class="small">Уведомления в Telegram включены</div></div>`
              : `<a class="btn" href="${esc(d.telegram_url)}" target="_blank" rel="noopener">${icon("telegram")} Получать уведомления в Telegram</a>`
            : ""
        }
      </section>
    </div>`;

  $("#refresh").addEventListener("click", () => load());
  $("#copy-code").addEventListener("click", () => copyText(d.code));
  app.querySelectorAll("[data-photo]").forEach((b) => b.addEventListener("click", () => lightbox(b.dataset.photo)));
  bindReply();
  bindRating();
  if (first) {
    splitWords($(".status-hero h1"), { delay: 140 });
    rise(app, "#track-root > .status-hero", { dur: 1000 });
    rise(app, "#track-root > *:not(.status-hero):nth-child(-n + 2)", { delay: 320, step: 90 });
    onView(app, "#track-root > *:nth-child(n + 3)");
    scramble($(".status-hero .number"), { duration: 800, delay: 180 });
  } else if (changed) {
    const hero = $(".status-hero");
    hero.classList.add("status-flash");
    ambient.pulseAt(hero.querySelector(".tp-step.current, .tp-step.final") || hero, 1);
    toast(`Статус заявки: ${d.status_label}`);
  }
}

function bindReply() {
  const form = $("#reply-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("#reply").value.trim();
    if (!body) return;
    const btn = $("#reply-btn");
    setBusy(btn, true);
    try {
      data = await api(`/api/track/${code}/reply`, { method: "POST", body: { body } });
      toast("Сообщение отправлено сотруднику");
      render();
    } catch (err) {
      toast(err.message, "error");
      setBusy(btn, false);
    }
  });
}

function bindRating() {
  const stars = $("#stars");
  if (!stars) return;
  const paint = (n) => stars.querySelectorAll(".star").forEach((s) => s.classList.toggle("on", Number(s.dataset.n) <= n));
  stars.querySelectorAll(".star").forEach((s) => {
    s.addEventListener("mouseenter", () => paint(Number(s.dataset.n)));
    s.addEventListener("click", () => {
      pickedRating = Number(s.dataset.n);
      $("#rate-btn").disabled = false;
      paint(pickedRating);
    });
  });
  stars.addEventListener("mouseleave", () => paint(pickedRating));
  $("#rate-btn").addEventListener("click", async (e) => {
    setBusy(e.currentTarget, true);
    try {
      data = await api(`/api/track/${code}/rate`, {
        method: "POST",
        body: { rating: pickedRating, comment: $("#rate-comment").value },
      });
      toast("Спасибо за оценку");
      render();
    } catch (err) {
      toast(err.message, "error");
      setBusy(e.currentTarget, false);
    }
  });
}

function start(value) {
  code = value;
  clearInterval(timer);
  load();
  // статус обновляется сам, пока страница открыта
  timer = setInterval(() => {
    if (document.visibilityState === "visible" && !document.activeElement?.matches("textarea")) load(true);
  }, 30000);
}

startAmbient();
enableOffline();
initMotion();
themeToggle($("#theme"));
window.addEventListener("popstate", () => {
  const c = codeFromPath();
  if (c) start(c);
  else renderLookup();
});
const initial = codeFromPath();
if (initial) start(initial);
else renderLookup();
