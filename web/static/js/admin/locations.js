import { api, confirmDialog, copyText, esc, icon, openModal, toast } from "../core.js";
import { loadLocations } from "./ctx.js";

const KINDS = { room: "Кабинет", lab: "Лаборатория", common: "Общая зона" };

function form(loc = {}) {
  return `
    <div class="u-gap12 grid-2">
      <div class="field"><label for="lf-b">Корпус</label><input class="input" id="lf-b" value="${esc(loc.building || "Корпус 1")}" maxlength="60"></div>
      <div class="field"><label for="lf-f">Этаж</label><input class="input" id="lf-f" type="number" value="${loc.floor ?? ""}"></div>
      <div class="field"><label for="lf-r">Номер кабинета</label><input class="input" id="lf-r" value="${esc(loc.room || "")}" maxlength="20" placeholder="214"></div>
      <div class="field"><label for="lf-k">Тип</label><select class="select" id="lf-k">${Object.entries(KINDS)
        .map(([k, v]) => `<option value="${k}" ${loc.kind === k ? "selected" : ""}>${v}</option>`)
        .join("")}</select></div>
    </div>
    <div class="field"><label for="lf-z">Название зоны</label><input class="input" id="lf-z" value="${esc(loc.zone_name || "")}" maxlength="80" placeholder="Например: Библиотека или Компьютерный класс">
      <span class="hint">Нужно указать номер кабинета или название зоны</span></div>
    <label class="check"><input type="checkbox" id="lf-a" ${loc.is_active === false ? "" : "checked"}> Помещение активно, QR-код работает</label>`;
}

function readForm(el) {
  const floor = el.querySelector("#lf-f").value;
  return {
    building: el.querySelector("#lf-b").value.trim(),
    floor: floor === "" ? null : Number(floor),
    room: el.querySelector("#lf-r").value.trim() || null,
    zone_name: el.querySelector("#lf-z").value.trim() || null,
    kind: el.querySelector("#lf-k").value,
    is_active: el.querySelector("#lf-a").checked,
  };
}

export async function render({ el, setHead }) {
  let items = [];
  let filter = "";

  setHead(`
    <a class="btn btn-sm" href="/admin/qr-print" target="_blank" rel="noopener">${icon("qr", "icon-sm")} Печать QR-кодов</a>
    <button class="btn btn-primary btn-sm" id="add-loc">${icon("plus", "icon-sm")} Добавить</button>`);

  const edit = (loc) =>
    openModal({
      title: loc ? "Изменить помещение" : "Новое помещение",
      body: form(loc),
      footer: `<button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="lf-save">Сохранить</button>`,
      onMount(m, close) {
        m.querySelector("#lf-save").addEventListener("click", async () => {
          try {
            const body = readForm(m);
            if (loc) await api(`/api/manage/locations/${loc.id}`, { method: "PATCH", body });
            else await api("/api/manage/locations", { method: "POST", body });
            toast(loc ? "Сохранено" : "Помещение добавлено, QR-код готов");
            close();
            await loadLocations();
            load();
          } catch (err) {
            toast(err.message, "error");
          }
        });
      },
    });

  document.getElementById("add-loc").addEventListener("click", () => edit(null));

  function draw() {
    const q = filter.toLowerCase();
    const rows = items.filter((l) => !q || l.full_title.toLowerCase().includes(q));
    el.innerHTML = `
      <div class="u-wrap row between">
        <div class="u-w360 input-icon">${icon("search")}<input class="input" id="loc-q" placeholder="Найти помещение" value="${esc(filter)}"></div>
        <span class="small muted">QR-код ведёт на форму обращения с уже подставленным помещением. В коде только идентификатор места, без личных данных.</span>
      </div>
      <section class="card table-card"><div class="u-block table-wrap"><table class="table">
        <thead><tr><th>QR</th><th>Помещение</th><th>Тип</th><th>Заявок</th><th>Ссылка</th><th><span class="sr-only">Действия</span></th></tr></thead>
        <tbody>${rows
          .map(
            (l) => `<tr class="${l.is_active ? "" : "is-inactive"}">
              <td><img class="qr-thumb" src="/api/manage/locations/${l.id}/qr.svg" alt="QR" loading="lazy"></td>
              <td><div class="t-title">${esc(l.title)}</div><div class="t-sub">${esc(l.building)}${l.floor != null ? `, ${l.floor} этаж` : ""}${l.is_active ? "" : " · отключено"}</div></td>
              <td><span class="small muted">${KINDS[l.kind] || l.kind}</span></td>
              <td>${l.tickets ? `<a href="#/tickets?status=&location=${l.id}">${l.tickets}</a>` : `<span class="faint">0</span>`}</td>
              <td><button class="btn btn-ghost btn-sm mono" data-copy="${esc(l.url)}" title="Скопировать ссылку">${icon("copy", "icon-sm")} /r/${esc(l.qr_key)}</button></td>
              <td class="nowrap">
                <a class="btn btn-ghost btn-icon btn-sm" href="/api/manage/locations/${l.id}/qr.png" title="Скачать PNG" aria-label="Скачать PNG">${icon("download", "icon-sm")}</a>
                <a class="btn btn-ghost btn-icon btn-sm" href="/r/${esc(l.qr_key)}" target="_blank" rel="noopener" title="Открыть форму" aria-label="Открыть форму">${icon("external", "icon-sm")}</a>
                <button class="btn btn-ghost btn-icon btn-sm" data-edit="${l.id}" title="Изменить" aria-label="Изменить">${icon("edit", "icon-sm")}</button>
                <button class="btn btn-ghost btn-icon btn-sm" data-regen="${l.id}" title="Выпустить новый QR-код" aria-label="Выпустить новый QR-код">${icon("refresh", "icon-sm")}</button>
              </td></tr>`,
          )
          .join("")}</tbody></table></div>
        ${rows.length ? "" : `<div class="empty">Ничего не найдено</div>`}
      </section>`;
    const input = el.querySelector("#loc-q");
    input.addEventListener("input", (e) => {
      filter = e.target.value;
      draw();
      const again = el.querySelector("#loc-q");
      again.focus();
      again.setSelectionRange(filter.length, filter.length);
    });
    el.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText(b.dataset.copy)));
    el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => edit(items.find((l) => String(l.id) === b.dataset.edit))));
    el.querySelectorAll("[data-regen]").forEach((b) =>
      b.addEventListener("click", async () => {
        const ok = await confirmDialog(
          "Выпустить новый QR-код?",
          "Старая наклейка перестанет работать, её нужно будет заменить. Это полезно, если код испортили или наклеили не туда.",
          "Выпустить",
          true,
        );
        if (!ok) return;
        await api(`/api/manage/locations/${b.dataset.regen}/regenerate`, { method: "POST" });
        toast("Новый QR-код готов");
        load();
      }),
    );
  }

  async function load() {
    items = await api("/api/manage/locations");
    draw();
  }
  await load();
}
