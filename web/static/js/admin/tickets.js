import { $, api, debounce, esc, fmtDate, h, icon, leaveAndRemove, lightbox, priorityChip, relTime, setBusy, statusChip, toast } from "../core.js";
import { can, ctx, initials, loadAssignees } from "./ctx.js";

const TABS = [
  ["open", "Открытые"],
  ["new", "Новые"],
  ["review", "На рассмотрении"],
  ["assigned", "Назначены"],
  ["in_progress", "В работе"],
  ["need_info", "Нужны уточнения"],
  ["resolved", "Решённые"],
  ["rejected", "Отклонённые"],
  ["", "Все"],
];
const OPEN = ["new", "review", "assigned", "in_progress", "need_info"];

export const STATUS_COLOR = {
  new: "var(--sky)",
  review: "var(--violet)",
  assigned: "var(--primary)",
  in_progress: "var(--amber)",
  need_info: "var(--orange)",
  resolved: "var(--green)",
  rejected: "var(--gray)",
};

const NOTE_HINT = {
  resolved: "Что было сделано? Комментарий увидит заявитель",
  rejected: "Причина отклонения. Её увидит заявитель",
  need_info: "Что нужно уточнить у заявителя? Он увидит вопрос на странице заявки",
};

const AI_KIND = {
  question: "Вопрос",
  fault: "Неисправность",
  danger: "Опасная ситуация",
  unclear: "Нужно уточнить",
  unknown: "Нет данных",
  secret: "Закрытые данные",
};
const AI_ENGINE = { gigachat: "GigaChat", fallback: "правила (демо)", rules: "база знаний и правила", safety: "фильтр безопасности" };

export function assigneeCell(a) {
  if (!a) return `<span class="faint small">не назначен</span>`;
  return `<span class="row" style="gap:7px"><span class="avatar avatar-sm">${esc(initials(a.name))}</span><span class="small">${esc(a.name)}</span></span>`;
}

function badges(t) {
  const out = [];
  if (t.ai_kind === "danger") out.push(`<span title="ИИ отметил опасность" style="color:var(--red)">${icon("flame", "icon-sm")}</span>`);
  if (t.has_photo) out.push(`<span title="Есть фото" class="faint">${icon("image", "icon-sm")}</span>`);
  if (t.reports_count > 1) out.push(`<span class="badge" title="Сообщили ${t.reports_count} человека">${icon("users", "icon-sm")}&nbsp;${t.reports_count}</span>`);
  return `<span class="row" style="gap:6px">${out.join("")}</span>`;
}

export async function render({ el, setHead, params, id }) {
  const state = {
    status: params.has("status") ? params.get("status") : "open",
    q: params.get("q") || "",
    category: params.get("category") || "",
    location: params.get("location") || "",
    assignee: params.get("assignee") || "",
    priority: params.get("priority") || "",
    date_from: "",
    date_to: "",
    sort: "new",
    page: 1,
    data: null,
    seen: null,
  };
  let drawer = null;

  const manage = can.manage();
  setHead(
    manage
      ? `<a class="btn btn-sm" id="export-xlsx">${icon("download", "icon-sm")} Excel</a>
         <a class="btn btn-sm btn-ghost" id="export-csv">CSV</a>`
      : "",
  );

  const locOptions = ctx.locations.map((l) => `<option value="${l.id}">${esc(l.full_title)}</option>`).join("");
  const catOptions = ctx.meta.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const asgOptions = ctx.assignees.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");

  el.innerHTML = `
    <div class="tabs" role="tablist" id="tabs"></div>
    <div class="filters">
      <div class="input-icon search">${icon("search")}<input class="input" id="f-q" placeholder="Номер, кабинет или текст заявки" value="${esc(state.q)}"></div>
      <select class="select" id="f-category" aria-label="Категория"><option value="">Все категории</option>${catOptions}</select>
      <select class="select" id="f-location" aria-label="Помещение"><option value="">Все помещения</option>${locOptions}</select>
      ${
        manage
          ? `<select class="select" id="f-assignee" aria-label="Исполнитель"><option value="">Любой исполнитель</option><option value="none">Без исполнителя</option>${asgOptions}</select>`
          : `<span></span>`
      }
      <select class="select" id="f-priority" aria-label="Приоритет"><option value="">Любой приоритет</option>
        <option value="critical">Критический</option><option value="high">Высокий</option>
        <option value="normal">Обычный</option><option value="low">Низкий</option></select>
      <button class="btn btn-ghost" id="f-more" title="Ещё фильтры" aria-label="Ещё фильтры" aria-controls="more" aria-expanded="false">${icon("filter")}</button>
    </div>
    <div class="filters-more" id="more" hidden>
      <span class="small muted">Создана с</span><input class="input input-sm" type="date" id="f-from" aria-label="Создана с">
      <span class="small muted">по</span><input class="input input-sm" type="date" id="f-to" aria-label="Создана по">
      <select class="select select-sm" id="f-sort" style="width:auto" aria-label="Сортировка">
        <option value="new">Сначала новые</option><option value="old">Сначала старые</option>
        <option value="priority">По приоритету</option><option value="updated">По последнему изменению</option>
      </select>
      <button class="btn btn-sm btn-ghost" id="f-reset">${icon("x", "icon-sm")} Сбросить фильтры</button>
    </div>
    <section class="card table-card" id="list"></section>`;

  $("#f-category").value = state.category;
  $("#f-location").value = state.location;
  if (manage) $("#f-assignee").value = state.assignee;
  $("#f-priority").value = state.priority;

  const query = (extra = {}) => {
    const p = new URLSearchParams();
    const add = (k, v) => v && p.set(k, v);
    add("status", state.status);
    add("q", state.q);
    add("category", state.category);
    add("location", state.location);
    add("assignee", state.assignee);
    add("priority", state.priority);
    add("date_from", state.date_from);
    add("date_to", state.date_to);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p.toString();
  };

  const updateExport = () => {
    if (!manage) return;
    $("#export-xlsx").href = `/api/staff/export.xlsx?${query()}`;
    $("#export-csv").href = `/api/staff/export.csv?${query()}`;
  };

  function renderTabs() {
    const counts = state.data?.status_counts || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const openCount = OPEN.reduce((a, s) => a + (counts[s] || 0), 0);
    $("#tabs").innerHTML = TABS.map(([value, label]) => {
      const n = value === "open" ? openCount : value === "" ? total : counts[value] || 0;
      return `<button class="tab" role="tab" aria-selected="${state.status === value}" data-status="${value}">${label}<span class="badge">${n}</span></button>`;
    }).join("");
    $("#tabs")
      .querySelectorAll(".tab")
      .forEach((b) =>
        b.addEventListener("click", () => {
          state.status = b.dataset.status;
          state.page = 1;
          load();
        }),
      );
  }

  function renderList(silent = false) {
    // первый показ — каскад строк, смена фильтра — быстрее, фоновое обновление — без анимации
    const enter = silent ? "" : state.listShown ? "enter-quick" : "enter";
    state.listShown = true;
    const box = $("#list");
    const data = state.data;
    if (!data.items.length) {
      const filtered = state.q || state.category || state.location || state.assignee || state.priority || state.date_from || state.date_to;
      box.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${icon(filtered ? "search" : "checkCircle", "icon-lg")}</div>
          <b>${filtered ? "По этим фильтрам заявок нет" : "Здесь пока пусто"}</b>
          <div class="small">${filtered ? "Попробуйте изменить условия поиска." : "Когда появятся заявки с таким статусом, они будут здесь."}</div>
          ${filtered ? `<button class="btn btn-sm" data-reset>Сбросить фильтры</button>` : ""}
        </div>`;
      box.querySelector("[data-reset]")?.addEventListener("click", resetFilters);
      return;
    }
    const fresh = (t) => state.seen && !state.seen.has(t.id);
    const rows = data.items
      .map(
        (t, i) => `
        <tr class="clickable ${t.priority === "critical" && OPEN.includes(t.status) ? "crit" : ""} ${fresh(t) ? "fresh" : ""}" data-id="${t.id}" style="--i:${Math.min(i, 18)}">
          <td class="t-num">${esc(t.public_number)}</td>
          <td style="min-width:220px"><a class="t-title t-link" href="#/tickets/${t.id}">${esc(t.title)}</a><div class="t-sub">${esc(t.place)}</div></td>
          <td><span class="cat-cell">${icon(t.category.icon, "icon-sm")}${esc(t.category.name)}</span></td>
          <td>${statusChip(t.status, t.status_label)}</td>
          <td>${priorityChip(t.priority, t.priority_label)}</td>
          <td>${assigneeCell(t.assignee)}</td>
          <td class="nowrap small muted" title="${esc(fmtDate(t.created_at))}">${relTime(t.created_at)}</td>
          <td>${badges(t)}</td>
        </tr>`,
      )
      .join("");
    const cards = data.items
      .map(
        (t) => `
        <div class="ticket-card" data-id="${t.id}">
          <div class="row between"><span class="t-num">${esc(t.public_number)}</span>${statusChip(t.status, t.status_label)}</div>
          <a class="t-title t-link" href="#/tickets/${t.id}">${esc(t.title)}</a>
          <div class="t-sub">${esc(t.place)}</div>
          <div class="row between"><span class="row-wrap">${priorityChip(t.priority, t.priority_label)}${badges(t)}</span><span class="tiny faint">${relTime(t.created_at)}</span></div>
        </div>`,
      )
      .join("");
    box.innerHTML = `
      <div class="table-wrap"><table class="table ${enter}">
        <thead><tr><th>№</th><th>Заявка</th><th>Категория</th><th>Статус</th><th>Приоритет</th><th>Исполнитель</th><th>Создана</th><th><span class="sr-only">Действия</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="ticket-cards">${cards}</div>
      <div class="pager">
        <span>Показано ${data.items.length} из ${data.total}</span>
        <span class="row">
          <button class="btn btn-sm" data-page="-1" aria-label="Предыдущая страница" ${data.page <= 1 ? "disabled" : ""}>${icon("arrowLeft", "icon-sm")}</button>
          <span>${data.page} / ${data.pages}</span>
          <button class="btn btn-sm" data-page="1" aria-label="Следующая страница" ${data.page >= data.pages ? "disabled" : ""}>${icon("arrowRight", "icon-sm")}</button>
        </span>
      </div>`;
    box.querySelectorAll("[data-id]").forEach((r) => r.addEventListener("click", () => (location.hash = `#/tickets/${r.dataset.id}`)));
    box.querySelectorAll("[data-page]").forEach((b) =>
      b.addEventListener("click", () => {
        state.page += Number(b.dataset.page);
        load();
      }),
    );
    state.seen = new Set([...(state.seen || []), ...data.items.map((t) => t.id)]);
  }

  async function load(silent = false) {
    if (!silent) $("#list").innerHTML = `<div class="card-body"><div class="skeleton" style="height:220px"></div></div>`;
    try {
      state.data = await api(`/api/staff/tickets?${query({ page: state.page, sort: state.sort, per_page: 25 })}`);
      if (state.seen === null) state.seen = new Set(state.data.items.map((t) => t.id));
      renderTabs();
      renderList(silent);
      updateExport();
    } catch (err) {
      if (!silent) $("#list").innerHTML = `<div class="card-body"><div class="notice notice-danger">${icon("alert")}<div>${esc(err.message)}</div></div></div>`;
    }
  }

  function resetFilters() {
    Object.assign(state, { q: "", category: "", location: "", assignee: "", priority: "", date_from: "", date_to: "", sort: "new", page: 1 });
    $("#f-q").value = "";
    ["#f-category", "#f-location", "#f-priority", "#f-from", "#f-to"].forEach((s) => ($(s).value = ""));
    if (manage) $("#f-assignee").value = "";
    $("#f-sort").value = "new";
    load();
  }

  const onFilter = (key, sel) =>
    $(sel)?.addEventListener("change", (e) => {
      state[key] = e.target.value;
      state.page = 1;
      load();
    });
  $("#f-q").addEventListener(
    "input",
    debounce((e) => {
      state.q = e.target.value.trim();
      state.page = 1;
      load(true);
    }, 300),
  );
  onFilter("category", "#f-category");
  onFilter("location", "#f-location");
  onFilter("assignee", "#f-assignee");
  onFilter("priority", "#f-priority");
  onFilter("date_from", "#f-from");
  onFilter("date_to", "#f-to");
  onFilter("sort", "#f-sort");
  $("#f-more").addEventListener("click", () => {
    $("#more").hidden = !$("#more").hidden;
    $("#f-more").setAttribute("aria-expanded", String(!$("#more").hidden));
  });
  $("#f-reset").addEventListener("click", resetFilters);

  // ---------- карточка заявки ----------

  let drawerOpener = null;

  function closeDrawer() {
    leaveAndRemove(drawer);
    drawer = null;
    document.removeEventListener("keydown", onKey);
    // фокус возвращается на заявку, из которой открыли карточку; список мог перерисоваться, поэтому ищем по адресу
    const back = drawerOpener && [...document.querySelectorAll(`a[href="${drawerOpener}"]`)].find((a) => a.offsetParent !== null);
    back?.focus();
    drawerOpener = null;
  }
  const onKey = (e) => {
    if (document.querySelector(".overlay")) return;
    if (e.key === "Escape") {
      location.hash = "#/tickets";
      return;
    }
    if (e.key !== "Tab" || !drawer) return;
    // Tab ходит только внутри карточки заявки, под неё фокус не уходит
    const aside = drawer.querySelector(".drawer");
    const items = [...aside.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!aside.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  async function openTicket(ticketId) {
    if (!drawer) {
      drawerOpener = `#/tickets/${ticketId}`;
      drawer = h(`<div class="drawer-wrap"><div class="drawer-overlay"></div><div class="drawer" role="dialog" aria-modal="true" aria-label="Заявка" tabindex="-1"><div class="drawer-body"><div class="skeleton" style="height:400px"></div></div></div></div>`);
      drawer.querySelector(".drawer-overlay").addEventListener("click", () => (location.hash = "#/tickets"));
      document.body.append(drawer);
      document.addEventListener("keydown", onKey);
      drawer.querySelector(".drawer").focus();
    }
    try {
      const t = await api(`/api/staff/tickets/${ticketId}`);
      if (drawer) renderDrawer(t);
    } catch (err) {
      toast(err.message, "error");
      location.hash = "#/tickets";
    }
  }

  function renderDrawer(t) {
    const aside = drawer.querySelector(".drawer");
    // содержимое появляется каскадом один раз, после действий карточка обновляется спокойно
    const firstShow = aside.dataset.shownId !== String(t.id);
    // после действия карточка перерисовывается: запоминаем, где был фокус, чтобы вернуть его на то же место
    const active = aside.contains(document.activeElement) && document.activeElement !== aside ? document.activeElement : null;
    const refocus = active && (active.id ? `#${active.id}` : active.dataset.status ? `[data-status="${active.dataset.status}"]` : null);
    aside.classList.toggle("quiet", !firstShow);
    aside.dataset.shownId = t.id;
    const manageMode = can.manage();
    const statusButtons = t.transitions.length
      ? t.transitions
          .map(
            (s) => `<button class="btn btn-sm" data-status="${s.value}"><span style="width:8px;height:8px;border-radius:50%;background:${STATUS_COLOR[s.value]}"></span>${esc(s.label)}</button>`,
          )
          .join("")
      : `<span class="small muted">Для этой заявки сейчас нет доступных переходов</span>`;

    const assigneeSelect = `<select class="select select-sm" id="d-assignee">
        <option value="">Не назначен</option>
        ${ctx.assignees
          .map((a) => `<option value="${a.id}" ${t.assignee?.id === a.id ? "selected" : ""}>${esc(a.name)}${a.position ? `, ${esc(a.position)}` : ""} · ${a.open_tickets} в работе</option>`)
          .join("")}
      </select>`;
    const prioritySelect = `<select class="select select-sm" id="d-priority">
        ${ctx.meta.priorities.map((p) => `<option value="${p.value}" ${t.priority === p.value ? "selected" : ""}>${esc(p.label)}</option>`).join("")}
      </select>`;
    const categorySelect = `<select class="select select-sm" id="d-category">
        ${ctx.meta.categories.map((c) => `<option value="${c.id}" ${t.category.id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>`;

    const comments = t.comments.length
      ? t.comments
          .map(
            (c) => `<div class="comment ${c.visibility === "internal" ? "internal" : ""} ${c.from_reporter ? "mine" : ""}">
              <div class="comment-head"><b>${esc(c.author)}</b><span>${fmtDate(c.created_at)}</span>
              ${c.visibility === "internal" ? `<span class="tag">${icon("lock", "icon-sm")} внутренний</span>` : ""}</div>
              <div class="pre">${esc(c.body)}</div></div>`,
          )
          .join("")
      : `<div class="small muted">Комментариев нет</div>`;

    const history = [...t.history]
      .reverse()
      .map(
        (hh, i) => `<li class="${i === 0 ? "hl" : ""}"><div>${esc(hh.text)} ${hh.is_public ? "" : `<span class="faint" title="Не видно заявителю">${icon("lock", "icon-sm")}</span>`}</div>
          ${hh.note ? `<div class="note pre">${esc(hh.note)}</div>` : ""}
          <div class="when">${esc(hh.actor)} · ${fmtDate(hh.created_at)}</div></li>`,
      )
      .join("");

    aside.innerHTML = `
      <div class="drawer-head">
        <span class="t-num">${esc(t.public_number)}</span>
        ${statusChip(t.status, t.status_label)}
        ${priorityChip(t.priority, t.priority_label)}
        <span class="grow"></span>
        <button class="btn btn-ghost btn-icon btn-sm" data-refresh title="Обновить" aria-label="Обновить">${icon("refresh")}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-close title="Закрыть" aria-label="Закрыть">${icon("x")}</button>
      </div>
      <div class="drawer-body">
        <div class="stack-sm">
          <h2>${esc(t.title)}</h2>
          <div class="row-wrap small muted"><span class="tag">${icon("pin", "icon-sm")}${esc(t.place)}</span><span class="tag">${icon(t.category.icon, "icon-sm")}${esc(t.category.name)}</span></div>
        </div>
        ${
          t.ai
            ? `<div class="ai-strip">${icon("sparkles", "icon-sm")}<b>ИИ: ${esc(AI_KIND[t.ai.kind] || t.ai.kind)}</b>
                <span>уверенность ${Math.round((t.ai.confidence || 0) * 100)}%</span><span class="muted">${esc(AI_ENGINE[t.ai.engine] || t.ai.engine || "")}</span></div>`
            : ""
        }
        <section class="card card-pad stack">
          <dl class="kv" style="margin:0">
            <div><dt>Создана</dt><dd>${fmtDate(t.created_at)}</dd></div>
            <div><dt>Источник</dt><dd>${t.source === "qr" ? "QR-код" : "Вручную"}</dd></div>
            <div><dt>Сообщили</dt><dd>${t.reports_count} ${t.reports_count === 1 ? "человек" : "человека"}</dd></div>
            <div><dt>Контакт</dt><dd>${t.contact ? esc(t.contact) : `<span class="faint">не указан</span>`}</dd></div>
            <div><dt>Изменена</dt><dd>${relTime(t.updated_at)}</dd></div>
            <div><dt>Закрыта</dt><dd>${t.closed_at ? fmtDate(t.closed_at) : `<span class="faint">нет</span>`}</dd></div>
          </dl>
          <div><div class="label" style="margin-bottom:4px">Описание</div><div class="pre">${esc(t.description)}</div></div>
          ${
            t.attachments.length
              ? `<div class="row-wrap">${t.attachments.map((a) => `<button class="photo-thumb" data-photo="${esc(a.url)}"><img src="${esc(a.url)}" alt="Фото" loading="lazy"></button>`).join("")}</div>`
              : ""
          }
          ${
            t.rating
              ? `<div class="notice notice-ok">${icon("star")}<div>Оценка заявителя: <b>${t.rating} из 5</b>${t.rating_comment ? `<div class="pre small">${esc(t.rating_comment)}</div>` : ""}</div></div>`
              : ""
          }
        </section>

        <section class="card card-pad stack">
          <h3>Действия</h3>
          ${
            manageMode && t.suggested_assignee && !t.assignee
              ? `<div class="suggest">${icon("sparkles", "icon-sm")}<span class="grow">По категории подходит <b>${esc(t.suggested_assignee.name)}</b></span>
                  <button class="btn btn-primary btn-sm" data-suggest="${t.suggested_assignee.id}">Назначить</button></div>`
              : ""
          }
          ${
            manageMode
              ? `<div class="actions-grid">
                  <div class="field"><label for="d-assignee">Исполнитель</label>${assigneeSelect}</div>
                  <div class="field"><label for="d-priority">Приоритет</label>${prioritySelect}</div>
                  <div class="field"><label for="d-category">Категория</label>${categorySelect}</div>
                </div>`
              : ""
          }
          <div class="stack-sm"><span class="label">Сменить статус</span><div class="status-buttons">${statusButtons}</div></div>
          <div class="stack-sm" id="note-box" hidden>
            <textarea class="textarea" id="note" rows="3" maxlength="2000"></textarea>
            <div class="row"><button class="btn btn-primary btn-sm" id="note-ok">Подтвердить</button><button class="btn btn-ghost btn-sm" id="note-cancel">Отмена</button></div>
          </div>
        </section>

        <section class="card card-pad stack">
          <h3>Комментарии</h3>
          ${comments}
          <div class="stack-sm">
            <textarea class="textarea" id="c-body" rows="2" maxlength="2000" placeholder="Написать комментарий" style="min-height:70px"></textarea>
            <div class="row between">
              <div class="segmented" id="c-vis">
                <button type="button" aria-pressed="true" data-v="public">Видно заявителю</button>
                <button type="button" aria-pressed="false" data-v="internal">${icon("lock", "icon-sm")} Внутренний</button>
              </div>
              <button class="btn btn-primary btn-sm" id="c-send">${icon("send", "icon-sm")} Отправить</button>
            </div>
          </div>
        </section>

        <section class="card card-pad stack">
          <h3>История изменений</h3>
          <ul class="timeline">${history}</ul>
        </section>
      </div>`;

    if (active) ((refocus && aside.querySelector(refocus)) || aside).focus();
    aside.querySelector("[data-close]").addEventListener("click", () => (location.hash = "#/tickets"));
    aside.querySelector("[data-refresh]").addEventListener("click", () => openTicket(t.id));
    aside.querySelectorAll("[data-photo]").forEach((b) => b.addEventListener("click", () => lightbox(b.dataset.photo)));

    const patch = async (body, okText) => {
      try {
        const updated = await api(`/api/staff/tickets/${t.id}`, { method: "PATCH", body });
        if (okText) toast(okText);
        renderDrawer(updated);
        load(true);
        if ("assignee_id" in body || "unassign" in body) loadAssignees();
      } catch (err) {
        toast(err.message, "error");
        renderDrawer(t);
      }
    };

    aside.querySelector("[data-suggest]")?.addEventListener("click", (e) => patch({ assignee_id: Number(e.currentTarget.dataset.suggest) }, "Исполнитель назначен"));
    $("#d-assignee", aside)?.addEventListener("change", (e) =>
      patch(e.target.value ? { assignee_id: Number(e.target.value) } : { unassign: true }, e.target.value ? "Исполнитель назначен" : "Исполнитель снят"),
    );
    $("#d-priority", aside)?.addEventListener("change", (e) => patch({ priority: e.target.value }, "Приоритет изменён"));
    $("#d-category", aside)?.addEventListener("change", (e) => patch({ category_id: Number(e.target.value) }, "Категория изменена"));

    let pendingStatus = null;
    const noteBox = $("#note-box", aside);
    aside.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => {
        const status = b.dataset.status;
        if (status === "assigned" && !t.assignee) {
          toast("Сначала выберите исполнителя", "error");
          $("#d-assignee", aside)?.focus();
          return;
        }
        if (NOTE_HINT[status]) {
          pendingStatus = status;
          noteBox.hidden = false;
          const area = $("#note", aside);
          area.placeholder = NOTE_HINT[status];
          area.focus();
          return;
        }
        setBusy(b, true);
        patch({ status }, "Статус изменён");
      }),
    );
    $("#note-cancel", aside).addEventListener("click", () => {
      pendingStatus = null;
      noteBox.hidden = true;
    });
    $("#note-ok", aside).addEventListener("click", (e) => {
      const note = $("#note", aside).value.trim();
      if (!note) {
        toast("Нужен комментарий", "error");
        return;
      }
      setBusy(e.currentTarget, true);
      patch({ status: pendingStatus, note }, "Статус изменён");
    });

    let visibility = "public";
    aside.querySelectorAll("#c-vis button").forEach((b) =>
      b.addEventListener("click", () => {
        visibility = b.dataset.v;
        aside.querySelectorAll("#c-vis button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      }),
    );
    $("#c-send", aside).addEventListener("click", async (e) => {
      const body = $("#c-body", aside).value.trim();
      if (!body) return;
      setBusy(e.currentTarget, true);
      try {
        const updated = await api(`/api/staff/tickets/${t.id}/comments`, { method: "POST", body: { body, visibility } });
        toast(visibility === "public" ? "Комментарий отправлен заявителю" : "Внутренний комментарий сохранён");
        renderDrawer(updated);
      } catch (err) {
        toast(err.message, "error");
        setBusy(e.currentTarget, false);
      }
    });
  }

  // ---------- жизненный цикл ----------

  await load();
  if (id) openTicket(id);
  const onChanged = () => load(true);
  window.addEventListener("tickets:changed", onChanged);
  const timer = setInterval(() => document.visibilityState === "visible" && load(true), 30000);

  return {
    openTicket,
    sync(_params, ticketId) {
      if (!ticketId) closeDrawer();
    },
    destroy() {
      clearInterval(timer);
      window.removeEventListener("tickets:changed", onChanged);
      closeDrawer();
    },
  };
}
