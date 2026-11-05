import { api, confirmDialog, contextActions, copyText, download, esc, icon, openModal, pageActions, setBusy, toast } from "../core.js";
import { loadLocations } from "./ctx.js";

const KINDS = { room: "Кабинет", lab: "Лаборатория", common: "Общая зона" };

function form(loc) {
  return `
    <div class="u-gap12 grid-2">
      <div class="field"><label for="lf-b">Корпус</label><input class="input" id="lf-b" value="${esc(loc.building || "Корпус 1")}" maxlength="60"></div>
      <div class="field"><label for="lf-f">Этаж</label><input class="input" id="lf-f" type="number" min="-3" max="50" value="${loc.floor ?? ""}"></div>
      <div class="field"><label for="lf-r">Номер кабинета</label><input class="input" id="lf-r" value="${esc(loc.room || "")}" maxlength="20" placeholder="214"></div>
      <div class="field"><label for="lf-k">Тип</label><select class="select" id="lf-k">${Object.entries(KINDS)
        .map(([k, v]) => `<option value="${k}" ${loc.kind === k ? "selected" : ""}>${v}</option>`)
        .join("")}</select></div>
    </div>
    <div class="field"><label for="lf-z">Название зоны</label><input class="input" id="lf-z" value="${esc(loc.zone_name || "")}" maxlength="80" placeholder="Например: Библиотека или Компьютерный класс">
      <span class="hint">Нужно указать номер кабинета или название зоны</span></div>
    <label class="check"><input type="checkbox" id="lf-a" ${loc.is_active === false ? "" : "checked"}> Помещение активно, QR-код работает</label>`;
}

function problem(body) {
  if (!body.building) return "Укажите корпус";
  if (!body.room && !body.zone_name) return "Укажите номер кабинета или название зоны";
  if (body.floor !== null && (!Number.isInteger(body.floor) || body.floor < -3 || body.floor > 50)) return "Этаж: целое число от -3 до 50";
  return null;
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
  let freshId = null; // только что добавленное помещение: строка подсвечивается один раз

  setHead(`
    <a class="btn btn-sm" href="/admin/qr-print" target="_blank" rel="noopener">${icon("qr", "icon-sm")} Печать QR-кодов</a>
    <button class="btn btn-primary btn-sm" id="add-loc">${icon("plus", "icon-sm")} Добавить</button>`);

  const edit = (loc) =>
    openModal({
      title: loc ? "Изменить помещение" : "Новое помещение",
      body: form(loc || {}),
      footer: `${loc && !loc.tickets ? `<button class="u-mr-auto u-red btn btn-ghost" id="lf-del">${icon("trash", "icon-sm")} Удалить</button>` : ""}
        <button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="lf-save">Сохранить</button>`,
      onMount(m, close) {
        m.querySelector("#lf-del")?.addEventListener("click", async () => {
          if (await removeRoom(loc)) close();
        });
        const saveBtn = m.querySelector("#lf-save");
        const save = async () => {
          if (saveBtn.disabled) return;
          const body = readForm(m);
          const wrong = problem(body);
          if (wrong) {
            toast(wrong, "error");
            return;
          }
          setBusy(saveBtn, true);
          try {
            if (loc) await api(`/api/manage/locations/${loc.id}`, { method: "PATCH", body });
            else freshId = (await api("/api/manage/locations", { method: "POST", body })).id;
            toast(loc ? "Сохранено" : "Помещение добавлено, QR-код готов");
            close();
            await loadLocations();
            await load();
          } catch (err) {
            toast(err.message, "error");
          } finally {
            setBusy(saveBtn, false);
          }
        };
        saveBtn.addEventListener("click", save);
        m.querySelector(".modal-body").addEventListener("keydown", (e) => {
          if (e.key === "Enter" && e.target.matches("input:not([type=checkbox])")) save();
        });
      },
    });

  document.getElementById("add-loc").addEventListener("click", () => edit(null));

  const changeRoom = async (l, changes, done) => {
    const { building, floor, room, zone_name, kind, is_active } = l;
    await api(`/api/manage/locations/${l.id}`, { method: "PATCH", body: { building, floor, room, zone_name, kind, is_active, ...changes } });
    toast(done);
    await loadLocations();
    await load();
  };
  const regenerate = async (l) => {
    const ok = await confirmDialog(
      "Выпустить новый QR-код?",
      "Старая наклейка перестанет работать, её нужно будет заменить. Это полезно, если код испортили или наклеили не туда.",
      "Выпустить",
      true,
    );
    if (!ok) return;
    try {
      await api(`/api/manage/locations/${l.id}/regenerate`, { method: "POST" });
      toast("Новый QR-код готов");
      await load();
    } catch (err) {
      toast(err.message, "error");
    }
  };
  async function removeRoom(l) {
    const ok = await confirmDialog(`Удалить: ${l.title}?`, "Помещение и его QR-код удалятся насовсем, наклейка перестанет работать.", "Удалить", true);
    if (!ok) return false;
    try {
      await api(`/api/manage/locations/${l.id}`, { method: "DELETE" });
      toast("Помещение удалено");
      await loadLocations();
      await load();
      return true;
    } catch (err) {
      toast(err.message, "error");
      return false;
    }
  }

  contextActions("tr[data-loc]", (row) => {
    const l = items.find((x) => String(x.id) === row.dataset.loc);
    if (!l) return null;
    return {
      title: l.full_title,
      items: [
        { label: "Изменить", ic: "edit", action: () => edit(l) },
        {
          label: "Заявки помещения",
          ic: "list",
          disabled: !l.tickets,
          hint: l.tickets ? String(l.tickets) : "",
          action: () => (location.hash = `#/tickets?status=&location=${l.id}`),
        },
        "sep",
        { label: "Напечатать QR-код", ic: "qr", action: () => window.open(`/admin/qr-print?ids=${l.id}`, "_blank", "noopener") },
        { label: "Скачать PNG", ic: "download", action: () => download(`/api/manage/locations/${l.id}/qr.png`) },
        { label: "Скопировать ссылку", ic: "copy", action: () => copyText(l.url) },
        { label: "Открыть форму заявки", ic: "external", action: () => window.open(`/r/${l.qr_key}`, "_blank", "noopener") },
        { label: "Выпустить новый QR-код", ic: "refresh", action: () => regenerate(l) },
        "sep",
        {
          label: l.is_active ? "Отключить помещение" : "Включить помещение",
          ic: "lock",
          action: () => changeRoom(l, { is_active: !l.is_active }, l.is_active ? "Помещение отключено" : "Помещение включено"),
        },
        { label: "Удалить", ic: "trash", danger: true, disabled: l.tickets > 0, hint: l.tickets ? "есть заявки" : "", action: () => removeRoom(l) },
      ],
    };
  });
  pageActions(() => [
    { label: "Добавить помещение", ic: "plus", action: () => edit(null) },
    { label: "Печать QR-кодов", ic: "qr", action: () => window.open("/admin/qr-print", "_blank", "noopener") },
  ]);

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
            (l) => `<tr data-loc="${l.id}" class="${l.is_active ? "" : "is-inactive"}${l.id === freshId ? " is-fresh" : ""}">
              <td><img class="qr-thumb" src="/api/manage/locations/${l.id}/qr.svg" alt="QR" loading="lazy" draggable="false"></td>
              <td><div class="t-title">${esc(l.title)}</div><div class="t-sub">${esc(l.building)}${l.floor != null ? `, ${l.floor} этаж` : ""}${l.is_active ? "" : " · отключено"}</div></td>
              <td><span class="small muted">${KINDS[l.kind] || l.kind}</span></td>
              <td>${l.tickets ? `<a href="#/tickets?status=&location=${l.id}">${l.tickets}</a>` : `<span class="faint">0</span>`}</td>
              <td><button class="btn btn-ghost btn-sm mono" data-copy="${esc(l.url)}" title="Скопировать ссылку">${icon("copy", "icon-sm")} /r/${esc(l.qr_key)}</button></td>
              <td class="nowrap">
                <a class="btn btn-ghost btn-icon btn-sm" href="/api/manage/locations/${l.id}/qr.png" title="Скачать PNG" aria-label="Скачать PNG">${icon("download", "icon-sm")}</a>
                <a class="btn btn-ghost btn-icon btn-sm" href="/admin/qr-print?ids=${l.id}" target="_blank" rel="noopener" title="Напечатать этот код" aria-label="Напечатать этот код">${icon("qr", "icon-sm")}</a>
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
    el.querySelectorAll("[data-regen]").forEach((b) => b.addEventListener("click", () => regenerate(items.find((l) => String(l.id) === b.dataset.regen))));
    if (freshId !== null) {
      freshId = null;
      el.querySelector("tr.is-fresh")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  async function load() {
    items = await api("/api/manage/locations");
    draw();
  }
  await load();
}
