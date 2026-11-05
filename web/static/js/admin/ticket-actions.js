// Меню правой кнопки для заявки: одно и то же в списке заявок и на доске.

import { api, copyText, esc, openModal, toast } from "../core.js";
import { can, ctx } from "./ctx.js";

const CLOSED = ["resolved", "rejected"];

export const NEED_NOTE = {
  resolved: "Что было сделано? Комментарий увидит заявитель",
  rejected: "Причина отклонения. Её увидит заявитель",
  need_info: "Что нужно уточнить у заявителя?",
};
const NOTE_TITLE = { resolved: "Заявка решена", rejected: "Заявка отклонена", need_info: "Нужны уточнения" };

/** Комментарий к смене статуса. Отмена возвращает null */
export function askNote(status) {
  return new Promise((resolve) => {
    let done = false;
    const { el, close } = openModal({
      title: NOTE_TITLE[status],
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

/** Пункты меню для заявки. refresh перерисовывает список или доску после изменения */
export function ticketMenu(t, { refresh }) {
  const change = async (body, done) => {
    await api(`/api/staff/tickets/${t.id}`, { method: "PATCH", body });
    toast(done);
    await refresh();
  };
  const toStatus = async (status) => {
    const note = NEED_NOTE[status] ? await askNote(status) : "";
    if (note === null) return;
    await change(note ? { status, note } : { status }, "Статус изменён");
  };

  // назначить исполнителя можно только через подменю «Исполнитель»: без него этот статус не поставить
  const statuses = (t.transitions || []).filter((s) => s.value !== "assigned" || t.assignee);
  const items = [
    { label: "Открыть карточку", ic: "clipboard", action: () => (location.hash = `#/tickets/${t.id}`) },
    { label: "Открыть в новой вкладке", ic: "external", action: () => window.open(`/admin#/tickets/${t.id}`, "_blank", "noopener") },
    "sep",
  ];
  if (statuses.length) {
    items.push({ label: "Статус", ic: "checkCircle", items: statuses.map((s) => ({ label: s.label, action: () => toStatus(s.value) })) });
  }
  if (can.manage() && !CLOSED.includes(t.status)) {
    items.push({
      label: "Исполнитель",
      ic: "user",
      items: [
        ...ctx.assignees.map((a) => ({
          label: a.position ? `${a.name}, ${a.position}` : a.name,
          checked: t.assignee?.id === a.id,
          action: () => (t.assignee?.id === a.id ? undefined : change({ assignee_id: a.id }, `Назначен исполнитель: ${a.name}`)),
        })),
        ...(t.assignee ? ["sep", { label: "Снять исполнителя", ic: "x", action: () => change({ unassign: true }, "Исполнитель снят") }] : []),
      ],
    });
    items.push({
      label: "Приоритет",
      ic: "flame",
      items: ctx.meta.priorities.map((p) => ({
        label: p.label,
        checked: t.priority === p.value,
        action: () => (t.priority === p.value ? undefined : change({ priority: p.value }, `Приоритет: ${p.label}`)),
      })),
    });
  }
  if (items[items.length - 1] !== "sep") items.push("sep");
  items.push({ label: "Скопировать номер", ic: "copy", action: () => copyText(t.public_number) });
  items.push({ label: "Скопировать ссылку", ic: "copy", action: () => copyText(`${location.origin}/admin#/tickets/${t.id}`) });
  if (can.manage() && t.location_id) {
    items.push({ label: "Все заявки этого помещения", ic: "pin", action: () => (location.hash = `#/tickets?status=&location=${t.location_id}`) });
  }
  return { title: `${t.public_number} · ${t.title}`, items };
}
