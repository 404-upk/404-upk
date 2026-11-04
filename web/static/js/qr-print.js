import { $, api, esc } from "./core.js";

document.documentElement.dataset.theme = "light";

async function init() {
  let items;
  try {
    items = (await api("/api/manage/locations")).filter((l) => l.is_active);
  } catch (err) {
    $("#sheet").innerHTML = `<p class="page">${esc(err.status === 401 ? "Сначала войдите в панель УПК." : err.message)}</p>`;
    return;
  }
  const params = new URLSearchParams(location.search);
  const preset = params.get("ids")?.split(",") ?? null;
  const selected = new Set(items.filter((l) => !preset || preset.includes(String(l.id))).map((l) => l.id));

  const picker = $("#picker");
  picker.innerHTML = items
    .map(
      (l) => `<label class="u-pill-check check">
        <input type="checkbox" value="${l.id}" ${selected.has(l.id) ? "checked" : ""}> ${esc(l.title)}</label>`,
    )
    .join("");

  const draw = () => {
    $("#sheet").innerHTML = items
      .filter((l) => selected.has(l.id))
      .map(
        (l) => `
        <div class="print-card">
          <div class="u-gap8 u-fw800 row"><img class="u-sq28" src="/static/img/icon.svg" alt="">УПК · Цифровой помощник</div>
          <h2>${esc(l.title)}</h2>
          <p>${esc(l.building)}${l.floor != null ? `, ${l.floor} этаж` : ""}</p>
          <img src="/api/manage/locations/${l.id}/qr.svg" alt="QR-код">
          <b>Что-то сломалось или есть вопрос?</b>
          <p>Наведите камеру телефона на код. Помещение подставится само, ничего устанавливать не нужно.</p>
          <p class="u-print-url">${esc(l.url)}</p>
        </div>`,
      )
      .join("");
  };

  picker.addEventListener("change", (e) => {
    const id = Number(e.target.value);
    if (e.target.checked) selected.add(id);
    else selected.delete(id);
    draw();
  });
  $("#all").addEventListener("click", () => {
    items.forEach((l) => selected.add(l.id));
    picker.querySelectorAll("input").forEach((i) => (i.checked = true));
    draw();
  });
  $("#print").addEventListener("click", () => window.print());
  draw();
}

init();
