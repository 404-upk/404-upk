import { $, $$, api, errorBlock, esc, h, icon, plural, setBusy } from "./core.js";

const LAYOUTS = [1, 2, 4, 6];
const LAYOUT_KEY = "upk-qr-per-sheet";

function savedLayout() {
  try {
    const value = Number(localStorage.getItem(LAYOUT_KEY));
    return LAYOUTS.includes(value) ? value : 4;
  } catch {
    return 4;
  }
}

/** Наклейка живёт долго, поэтому предупреждаем, если код ведёт на адрес, который не откроется или скоро пропадёт */
function addressWarning(url) {
  const target = new URL(url);
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(target.hostname)) {
    return `Коды ведут на ${target.host}: с телефона такой адрес не откроется. Для настоящих наклеек укажите адрес сервера в настройке PUBLIC_URL.`;
  }
  if (target.hostname.endsWith(".app.github.dev")) {
    return "Коды ведут на временный адрес Codespaces. С чужого телефона он откроется, только если порт 8000 сделан публичным, а когда Codespace остановят, наклейки перестанут работать. Для настоящих наклеек печатайте с боевого адреса.";
  }
  if (target.origin !== location.origin) {
    return `Коды ведут на ${target.host}, а эта страница открыта на ${location.host}. Проверьте настройку PUBLIC_URL.`;
  }
  return null;
}

const placeOf = (l) => (l.floor != null ? `${l.building}, ${l.floor} этаж` : l.building);

function groupsOf(items) {
  const groups = new Map();
  for (const l of items) {
    const title = placeOf(l);
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(l);
  }
  return [...groups].map(([title, rooms], index) => ({ index, title, rooms }));
}

function card(l) {
  return h(`
    <article class="print-card">
      <div class="print-brand"><img src="/static/img/icon.svg" alt="" draggable="false">УПК · Цифровой помощник</div>
      <h2>${esc(l.title)}</h2>
      <p class="print-place">${esc(placeOf(l))}</p>
      <img class="print-qr" src="/api/manage/locations/${l.id}/qr.svg" alt="QR-код: ${esc(l.title)}" draggable="false">
      <b>Что-то сломалось или есть вопрос?</b>
      <p>Наведите камеру телефона на код. Помещение подставится само, ничего устанавливать не нужно.</p>
      <p class="print-url">${esc(l.url.replace(/^https?:\/\//, ""))}</p>
    </article>`);
}

function page(items, warning) {
  const preset = new URLSearchParams(location.search).get("ids")?.split(",") ?? null;
  const selected = new Set(items.filter((l) => !preset || preset.includes(String(l.id))).map((l) => l.id));
  const groups = groupsOf(items);
  let perSheet = savedLayout();

  const root = $("#qp");
  root.innerHTML = `
    <aside class="qp-side no-print">
      <div class="qp-head">
        <a class="btn btn-ghost btn-sm qp-back" href="/admin#/locations">${icon("arrowLeft", "icon-sm")} Помещения и QR</a>
        <h1>QR-коды для печати</h1>
        <p class="small muted">Отметьте помещения и нажмите «Печать». Наклейте код на видное место у входа.</p>
      </div>
      ${warning ? `<div class="notice notice-warn small">${icon("alert", "icon-sm")}<div>${esc(warning)}</div></div>` : ""}
      <div class="input-icon">${icon("search")}<input class="input" id="qp-q" placeholder="Найти помещение" aria-label="Найти помещение" autocomplete="off"></div>
      <div class="row between">
        <span class="small muted" id="qp-count" aria-live="polite"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="qp-all"></button>
      </div>
      <div class="qp-rooms" id="qp-rooms">
        ${groups
          .map(
            (g) => `<section class="qp-group" data-group="${g.index}">
              <label class="check qp-group-head"><input type="checkbox" data-group-check="${g.index}"><span class="grow">${esc(g.title)}</span><span class="small faint" data-group-count></span></label>
              <div class="qp-group-rooms">${g.rooms
                .map(
                  (l) => `<label class="u-pill-check check" data-room="${esc(l.full_title.toLowerCase())}">
                    <input type="checkbox" value="${l.id}" ${selected.has(l.id) ? "checked" : ""}> ${esc(l.title)}</label>`,
                )
                .join("")}</div>
            </section>`,
          )
          .join("")}
        <div class="empty small" id="qp-none" hidden>Ничего не найдено</div>
      </div>
      <div class="qp-foot">
        <div class="row between">
          <span class="small muted" id="qp-layout-label">Кодов на листе A4</span>
          <div class="segmented" role="group" aria-labelledby="qp-layout-label">${LAYOUTS.map(
            (n) => `<button type="button" data-layout="${n}" aria-pressed="${n === perSheet}">${n}</button>`,
          ).join("")}</div>
        </div>
        <button type="button" class="btn btn-primary" id="qp-print"></button>
      </div>
    </aside>
    <main class="qp-stage" id="qp-stage"></main>`;

  const stage = $("#qp-stage");
  const roomInputs = $$('#qp-rooms input[value]');
  const printBtn = $("#qp-print");
  const allBtn = $("#qp-all");
  // карточки создаются один раз и переезжают между листами: коды не загружаются заново и не мигают
  const cards = new Map();
  let onStage = new Set();

  const visibleInputs = () => roomInputs.filter((i) => !i.closest("[data-room]").hidden);

  const drawControls = (sheets) => {
    $("#qp-count").textContent = `Выбрано ${selected.size} из ${items.length}`;
    printBtn.disabled = selected.size === 0;
    printBtn.innerHTML = selected.size
      ? `${icon("download", "icon-sm")} Печать: ${sheets} ${plural(sheets, "лист", "листа", "листов")}`
      : "Выберите помещения";
    const visible = visibleInputs();
    const allOn = visible.length > 0 && visible.every((i) => i.checked);
    allBtn.textContent = allOn ? "Снять все" : "Выбрать все";
    allBtn.disabled = visible.length === 0;
    for (const g of groups) {
      const inputs = roomInputs.filter((i) => g.rooms.some((l) => String(l.id) === i.value));
      const on = inputs.filter((i) => i.checked).length;
      const section = $(`[data-group="${g.index}"]`);
      const box = section.querySelector("[data-group-check]");
      box.checked = on === inputs.length;
      box.indeterminate = on > 0 && on < inputs.length;
      section.querySelector("[data-group-count]").textContent = `${on} из ${inputs.length}`;
    }
  };

  const draw = () => {
    const picked = items.filter((l) => selected.has(l.id));
    const sheets = Math.ceil(picked.length / perSheet);
    const seen = new Set(picked.map((l) => l.id));
    const parts = [];
    for (let s = 0; s < sheets; s += 1) {
      const wrap = h(`<div class="sheet-wrap">
        <div class="sheet-label small faint no-print">Лист ${s + 1} из ${sheets}</div>
        <section class="sheet per-${perSheet}"></section></div>`);
      const sheet = wrap.querySelector(".sheet");
      for (const l of picked.slice(s * perSheet, (s + 1) * perSheet)) {
        if (!cards.has(l.id)) cards.set(l.id, card(l));
        const el = cards.get(l.id);
        el.classList.toggle("is-new", !onStage.has(l.id));
        sheet.append(el);
      }
      parts.push(wrap);
    }
    onStage = seen;
    if (parts.length) stage.replaceChildren(...parts);
    else stage.replaceChildren(h(`<div class="empty qp-empty">${icon("qr")}<div>Отметьте помещения, и здесь появятся листы для печати</div></div>`));
    drawControls(sheets);
  };

  const filterRooms = (query) => {
    const q = query.trim().toLowerCase();
    for (const label of $$("[data-room]")) label.hidden = Boolean(q) && !label.dataset.room.includes(q);
    let any = false;
    for (const section of $$("[data-group]")) {
      const shown = section.querySelector("[data-room]:not([hidden])");
      section.hidden = !shown;
      any ||= Boolean(shown);
    }
    $("#qp-none").hidden = any;
  };

  const setRooms = (inputs, on) => {
    for (const i of inputs) {
      i.checked = on;
      if (on) selected.add(Number(i.value));
      else selected.delete(Number(i.value));
    }
    draw();
  };

  $("#qp-rooms").addEventListener("change", (e) => {
    const group = e.target.dataset.groupCheck;
    if (group !== undefined) {
      const ids = new Set(groups[Number(group)].rooms.map((l) => String(l.id)));
      setRooms(roomInputs.filter((i) => ids.has(i.value)), e.target.checked);
    } else {
      setRooms([e.target], e.target.checked);
    }
  });
  $("#qp-q").addEventListener("input", (e) => {
    filterRooms(e.target.value);
    drawControls(Math.ceil(selected.size / perSheet));
  });
  allBtn.addEventListener("click", () => {
    const visible = visibleInputs();
    setRooms(visible, !visible.every((i) => i.checked));
  });
  root.querySelector(".segmented").addEventListener("click", (e) => {
    const n = Number(e.target.dataset.layout);
    if (!n) return;
    perSheet = n;
    try {
      localStorage.setItem(LAYOUT_KEY, String(n));
    } catch {
      /* без хранилища выбор просто не запомнится */
    }
    $$("[data-layout]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.layout) === n)));
    draw();
  });
  printBtn.addEventListener("click", async () => {
    // коды должны успеть загрузиться, иначе на листе останутся пустые места
    setBusy(printBtn, true, "Готовлю листы");
    await Promise.allSettled($$("img", stage).map((img) => img.decode()));
    setBusy(printBtn, false);
    window.print();
  });

  draw();
}

async function init() {
  const root = $("#qp");
  let items;
  try {
    items = (await api("/api/manage/locations")).filter((l) => l.is_active);
  } catch (err) {
    if (err.status === 401) {
      root.innerHTML = `<div class="qp-message card card-pad">
        <h1 class="h3">Сначала войдите в панель УПК</h1>
        <p class="small muted">Печать QR-кодов доступна сотрудникам.</p>
        <a class="btn btn-primary" href="/admin">Войти в панель</a></div>`;
    } else {
      root.replaceChildren(errorBlock(err, init));
    }
    return;
  }
  if (!items.length) {
    root.innerHTML = `<div class="qp-message card card-pad">
      <h1 class="h3">Пока нет помещений</h1>
      <p class="small muted">Добавьте помещение, и для него появится QR-код.</p>
      <a class="btn btn-primary" href="/admin#/locations">Помещения и QR</a></div>`;
    return;
  }
  page(items, addressWarning(items[0].url));
}

init();
