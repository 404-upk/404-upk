import { api, contextActions, esc, icon, pageActions, priorityChip, relTime, toast } from "../core.js";
import { NEED_NOTE, askNote, ticketMenu } from "./ticket-actions.js";
import { assigneeCell } from "./tickets.js";

const COLUMNS = [
  ["new", "Новые"],
  ["review", "На рассмотрении"],
  ["assigned", "Назначен исполнитель"],
  ["in_progress", "В работе"],
  ["need_info", "Нужны уточнения"],
  ["resolved", "Решены за неделю"],
];

// Мышью перетаскиваем сами: при встроенном перетаскивании браузер рисует системную стрелку поверх нашего указателя.
// На сенсорных экранах остаётся встроенное.
const MOUSE_DRAG = matchMedia("(hover: hover) and (pointer: fine)").matches;
const DRAG_THRESHOLD = 6; // столько пикселей ещё считается обычным нажатием
const EDGE_SCROLL = 48; // у края доски она прокручивается сама

export async function render({ el, setHead }) {
  setHead(`<span class="small muted hide-mobile">${icon("info", "icon-sm")} Перетащите карточку в другую колонку или нажмите Shift и стрелку влево или вправо</span>`);
  let tickets = [];
  let dragged = null;
  let shown = false;
  let movedId = null;
  let focusAfter = null;
  let justDragged = false;
  let cancelDrag = null;

  contextActions(".kcard", (c) => {
    const t = tickets.find((x) => String(x.id) === c.dataset.id);
    return t ? ticketMenu(t, { refresh: load }) : null;
  });
  pageActions(() => [{ label: "Обновить доску", ic: "refresh", action: load }]);

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
      <div class="kcard ${t.priority === "critical" ? "crit" : ""} ${t.id === movedId ? "just-moved" : ""}" draggable="${MOUSE_DRAG ? "false" : "true"}" data-id="${t.id}" tabindex="0" role="button" aria-label="${esc(t.public_number)}: ${esc(t.title)}. Enter открывает, Shift и стрелка влево или вправо меняет статус">
        <div class="row between"><span class="t-num">${esc(t.public_number)}</span>${t.priority !== "normal" ? priorityChip(t.priority, t.priority_label) : ""}</div>
        <div class="kcard-title">${esc(t.title)}</div>
        <div class="kcard-meta">${icon("pin", "icon-sm")}${esc(t.place)}</div>
        <div class="row between">${assigneeCell(t.assignee)}<span class="tiny faint">${relTime(t.created_at)}</span></div>
      </div>`;
  }

  function draw() {
    // колонки появляются каскадом только при первом показе
    el.innerHTML = `<div class="board ${shown ? "quiet" : ""}">${COLUMNS.map(([status, label], i) => {
      const items = tickets.filter((t) => t.status === status);
      return `<section class="col" data-status="${status}" data-css-i="${i}" role="region" aria-label="${esc(label)}: ${items.length}">
        <div class="col-head"><span class="col-dot st-c-${status}" aria-hidden="true"></span>${label}<span class="badge">${items.length}</span></div>
        ${items.map(card).join("") || `<div class="u-py16 small faint center">Пусто</div>`}
      </section>`;
    }).join("")}</div>`;
    shown = true;
    const focusId = movedId ?? focusAfter;
    focusAfter = null;
    movedId = null;
    if (focusId != null) el.querySelector(`.kcard[data-id="${focusId}"]`)?.focus();

    el.querySelectorAll(".kcard").forEach((c) => {
      c.addEventListener("click", () => {
        if (!justDragged) location.hash = `#/tickets/${c.dataset.id}`;
      });
      if (MOUSE_DRAG) c.addEventListener("pointerdown", (e) => startDrag(c, e));
      c.addEventListener("keydown", (e) => {
        if (e.target !== c) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          location.hash = `#/tickets/${c.dataset.id}`;
        } else if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          // то же, что перетаскивание, но с клавиатуры: на соседнюю колонку
          e.preventDefault();
          const t = tickets.find((x) => String(x.id) === c.dataset.id);
          const at = COLUMNS.findIndex(([status]) => status === t?.status);
          const next = COLUMNS[at + (e.key === "ArrowLeft" ? -1 : 1)];
          if (t && next) {
            focusAfter = t.id;
            move(t, next[0]).finally(() => (focusAfter = null));
          }
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const list = [...c.parentElement.querySelectorAll(".kcard")];
          list[list.indexOf(c) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
        }
      });
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

  function startDrag(c, down) {
    if (down.button !== 0 || down.pointerType !== "mouse") return;
    const t = tickets.find((x) => String(x.id) === c.dataset.id);
    if (!t) return;
    const root = document.documentElement;
    const box = c.getBoundingClientRect();
    const grabX = down.clientX - box.left;
    const grabY = down.clientY - box.top;
    let ghost = null;
    let over = null;

    const setOver = (col) => {
      if (col === over) return;
      over?.classList.remove("drop");
      over = col;
      // своя колонка не подсвечивается: класть туда незачем
      const target = !!col && col.dataset.status !== t.status;
      col?.classList.toggle("drop", target);
      root.classList.toggle("can-drop", target);
    };
    const lift = () => {
      dragged = t;
      c.classList.add("drag-source");
      root.classList.add("is-dragging");
      ghost = c.cloneNode(true);
      ghost.classList.remove("just-moved", "drag-source");
      ghost.classList.add("kcard-ghost");
      ["tabindex", "role", "aria-label"].forEach((name) => ghost.removeAttribute(name));
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.width = `${box.width}px`;
      document.body.append(ghost);
    };
    const follow = (e) => {
      // кнопку отпустили вне окна: событие об этом не пришло
      if (e.type === "pointermove" && e.buttons === 0) {
        cancel();
        return;
      }
      if (!ghost) {
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_THRESHOLD) return;
        lift();
      }
      ghost.style.translate = `${e.clientX - grabX}px ${e.clientY - grabY}px`;
      setOver(document.elementFromPoint(e.clientX, e.clientY)?.closest(".col") ?? null);
      const board = el.querySelector(".board");
      const edge = board?.getBoundingClientRect();
      if (edge && e.clientX < edge.left + EDGE_SCROLL) board.scrollLeft -= 20;
      else if (edge && e.clientX > edge.right - EDGE_SCROLL) board.scrollLeft += 20;
    };
    const stop = () => {
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey);
      cancelDrag = null;
      dragged = null;
      c.classList.remove("drag-source");
      root.classList.remove("is-dragging", "can-drop");
      over?.classList.remove("drop");
      if (ghost) {
        // клик после отпускания не должен открывать заявку
        justDragged = true;
        setTimeout(() => (justDragged = false), 0);
      }
    };
    const flyBack = (card) => {
      const anim = card.animate(
        [{ translate: card.style.translate }, { translate: `${box.left}px ${box.top}px`, rotate: "0deg", scale: "1", opacity: 0.6 }],
        { duration: 220, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
      );
      anim.onfinish = anim.oncancel = () => card.remove();
    };
    function cancel() {
      const card = ghost;
      stop();
      if (card) flyBack(card);
    }
    function drop(e) {
      follow(e);
      const card = ghost;
      const target = over;
      stop();
      if (!card) return;
      if (target && target.dataset.status !== t.status) {
        card.remove();
        move(t, target.dataset.status);
      } else {
        flyBack(card);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") cancel();
    }
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey);
    cancelDrag = cancel;
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
    load().catch(() => {});
  }

  await load();
  // автообновление без сети тихо пропускается: на доске остаются последние данные
  const quiet = () => load().catch(() => {});
  const timer = setInterval(() => document.visibilityState === "visible" && !dragged && quiet(), 30000);
  const onChanged = () => !dragged && quiet();
  window.addEventListener("tickets:changed", onChanged);
  return {
    destroy() {
      cancelDrag?.();
      clearInterval(timer);
      window.removeEventListener("tickets:changed", onChanged);
    },
  };
}

