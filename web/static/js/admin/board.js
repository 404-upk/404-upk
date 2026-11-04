import { api, esc, icon, openModal, priorityChip, relTime, toast } from "../core.js";
import { STATUS_COLOR, assigneeCell } from "./tickets.js";

const COLUMNS = [
  ["new", "Новые"],
  ["review", "На рассмотрении"],
  ["assigned", "Назначен исполнитель"],
  ["in_progress", "В работе"],
  ["need_info", "Нужны уточнения"],
  ["resolved", "Решены за неделю"],
];

const NEED_NOTE = {
  resolved: "Что было сделано? Комментарий увидит заявитель",
  rejected: "Причина отклонения",
  need_info: "Что нужно уточнить у заявителя?",
};

function askNote(status) {
  return new Promise((resolve) => {
    let done = false;
    const { el, close } = openModal({
      title: status === "resolved" ? "Заявка решена" : "Нужны уточнения",
      body: `<textarea class="textarea" id="bn" rows="4" maxlength="2000" placeholder="${esc(NEED_NOTE[status])}"></textarea>`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="bn-ok">Сохранить</button>`,
    });
    el.querySelector("#bn-ok").addEventListener("click", () => {
      const note = el.querySelector("#bn").value.trim();
      if (!note) return toast("Нужен комментарий", "error");
      done = true;
      close();
      resolve(note);
    });
    const obs = new MutationObserver(() => {
      if (!el.isConnected) {
        obs.disconnect();
        if (!done) resolve(null);
      }
    });
    obs.observe(document.body, { childList: true });
  });
}

export async function render({ el, setHead }) {
  setHead(`<span class="small muted hide-mobile">${icon("info", "icon-sm")} Перетащите карточку в другую колонку, чтобы сменить статус</span>`);
  let tickets = [];
  let dragged = null;
  let shown = false;
  let movedId = null;

  async function load() {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const [open, done] = await Promise.all([
      api("/api/staff/tickets?status=new,review,assigned,in_progress,need_info&per_page=300&sort=priority"),
      api(`/api/staff/tickets?status=resolved&per_page=50&sort=updated&date_from=${weekAgo}`),
    ]);
    tickets = [...open.items, ...done.items];
    draw();
  }

  function card(t) {
    return `
      <article class="kcard ${t.priority === "critical" ? "crit" : ""} ${t.id === movedId ? "just-moved" : ""}" draggable="true" data-id="${t.id}">
        <div class="row between"><span class="t-num">${esc(t.public_number)}</span>${t.priority !== "normal" ? priorityChip(t.priority, t.priority_label) : ""}</div>
        <div class="kcard-title">${esc(t.title)}</div>
        <div class="kcard-meta">${icon("pin", "icon-sm")}${esc(t.place)}</div>
        <div class="row between">${assigneeCell(t.assignee)}<span class="tiny faint">${relTime(t.created_at)}</span></div>
      </article>`;
  }

  function draw() {
    // колонки появляются каскадом только при первом показе
    el.innerHTML = `<div class="board ${shown ? "quiet" : ""}">${COLUMNS.map(([status, label], i) => {
      const items = tickets.filter((t) => t.status === status);
      return `<section class="col" data-status="${status}" style="--i:${i}">
        <div class="col-head"><span style="width:9px;height:9px;border-radius:50%;background:${STATUS_COLOR[status]}"></span>${label}<span class="badge">${items.length}</span></div>
        ${items.map(card).join("") || `<div class="small faint center" style="padding:16px 0">Пусто</div>`}
      </section>`;
    }).join("")}</div>`;
    shown = true;
    movedId = null;

    el.querySelectorAll(".kcard").forEach((c) => {
      c.addEventListener("click", () => (location.hash = `#/tickets/${c.dataset.id}`));
      c.addEventListener("dragstart", (e) => {
        dragged = tickets.find((t) => String(t.id) === c.dataset.id);
        c.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      c.addEventListener("dragend", () => {
        c.classList.remove("dragging");
        dragged = null;
      });
    });
    el.querySelectorAll(".col").forEach((col) => {
      col.addEventListener("dragover", (e) => {
        e.preventDefault();
        col.classList.add("drop");
      });
      col.addEventListener("dragleave", () => col.classList.remove("drop"));
      col.addEventListener("drop", async (e) => {
        e.preventDefault();
        col.classList.remove("drop");
        const t = dragged;
        if (!t || t.status === col.dataset.status) return;
        await move(t, col.dataset.status);
      });
    });
  }

  async function move(t, status) {
    const body = { status };
    if (status === "assigned" && !t.assignee) {
      toast("Сначала назначьте исполнителя в карточке заявки", "error");
      return;
    }
    if (NEED_NOTE[status]) {
      const note = await askNote(status);
      if (!note) return;
      body.note = note;
    }
    try {
      await api(`/api/staff/tickets/${t.id}`, { method: "PATCH", body });
      movedId = t.id;
      toast(`${t.public_number}: статус изменён`);
    } catch (err) {
      toast(err.message, "error");
    }
    load();
  }

  await load();
  const timer = setInterval(() => document.visibilityState === "visible" && !dragged && load(), 30000);
  const onChanged = () => load();
  window.addEventListener("tickets:changed", onChanged);
  return {
    destroy() {
      clearInterval(timer);
      window.removeEventListener("tickets:changed", onChanged);
    },
  };
}

