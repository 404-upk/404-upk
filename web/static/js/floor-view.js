// План этажа во весь экран: вид сверху, кабинеты по обе стороны коридора, двери на стене коридора.
// На широком экране коридор идёт слева направо, на телефоне сверху вниз, чтобы кабинеты были крупными.
// Нажатие на кабинет открывает дверь и показывает сведения: тип, состояние, открытые заявки.

import { api, esc, h, icon, leaveAndRemove, loadCss } from "./core.js";
import { FLOORS, LOBBY, STATE_TEXT, TYPES, TYPE_ICON, floorRooms, roomNames, stateOf } from "./plan.js";

const SHORT = { clear: "без заявок", open: "заявка", urgent: "срочно" };
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const WAY_UP = '<path d="M12 19V5M6 11l6-6 6 6"/>';
const WAY_DOWN = '<path d="M12 5v14M6 13l6 6 6-6"/>';

function wayLine(dir, to) {
  return `<span class="fv-way is-${dir}"><svg viewBox="0 0 24 24" aria-hidden="true">${dir === "up" ? WAY_UP : WAY_DOWN}</svg>${esc(to)}</span>`;
}

/** Широкий экран и телефон: один рисунок, на телефоне повёрнут к коридору, который идёт сверху вниз */
function runSvg(w, h, inner) {
  return `<svg class="fs-svg fs-h" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>
    <svg class="fs-svg fs-v" viewBox="0 0 ${h} ${w}" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(0 ${w}) rotate(-90)">${inner}</g></svg>`;
}

/** Путь по маршу от коридора: куда он ведёт, показывает бейдж с этажом у дальнего конца */
function route(x, kind) {
  return `<path class="fs-way is-${kind}" d="M${x} 122V30"/><circle class="fs-way-start is-${kind}" cx="${x}" cy="122" r="2.4"/>`;
}

function toBadge(side, dir, floor) {
  return `<span class="fs-to col-${side} is-${dir}"><svg viewBox="0 0 24 24" aria-hidden="true">${dir === "up" ? WAY_UP : WAY_DOWN}</svg>${floor}</span>`;
}

/**
 * Двухмаршевая лестница сверху: этажной площадкой служит коридор снизу, вверху промежуточная площадка.
 * Подъём начинается с правого марша, спуск с левого. Марш, которым с этого этажа не воспользоваться, бледнее.
 * dirs: "up" — 1 этаж, "both" — 2 этаж, "down" — 3 этаж.
 */
function sideRun(dirs) {
  const treads = (a, b) => {
    let d = "";
    for (let y = 31; y <= 121; y += 10) d += `M${a} ${y}H${b}`;
    return d;
  };
  const leftOn = dirs !== "up";
  const rightOn = dirs !== "down";
  return runSvg(
    84,
    132,
    `<path class="fs-treads${leftOn ? "" : " is-dim"}" d="${treads(7, 40)}"/>
    <path class="fs-treads${rightOn ? "" : " is-dim"}" d="${treads(44, 77)}"/>
    <path class="fs-edge" d="M7 20H77"/>
    <path class="fs-rail" d="M42 20V132"/>
    ${leftOn ? route(23.5, "down") : ""}${rightOn ? route(60.5, "up") : ""}
    ${dirs === "down" ? '<path class="fs-guard" d="M44 126H77"/>' : ""}`,
  );
}

/** Прямая лестница посередине: на 1 этаже подъём от коридора, на 2 этаже проём с ограждением и спуск */
function centerRun(dir) {
  let treads = "";
  for (let y = 21; y <= 121; y += 10) treads += `M24 ${y}H92`;
  const guard = dir === "down" ? '<path class="fs-guard" d="M15 11V129H101V11"/>' : "";
  const way =
    dir === "up"
      ? '<path class="fs-way is-up" d="M58 122V30"/><circle class="fs-way-start is-up" cx="58" cy="122" r="2.4"/>'
      : '<path class="fs-way is-down" d="M58 22V108"/><path class="fs-way-head" d="M53 103l5 9 5-9"/><circle class="fs-way-start is-down" cx="58" cy="22" r="2.4"/>';
  return runSvg(116, 132, `<path class="fs-treads" d="${treads}"/><path class="fs-edge" d="M24 11H92M24 11V132M92 11V132"/>${guard}${way}`);
}

/** Лестничная клетка: сама лестница над коридором, коридор доходит до окна в торце, подпись под коридором */
function stairCell(dirs, ways, next) {
  const label = ways.map(([dir, to]) => `${dir === "up" ? "вверх" : "вниз"} ${to}`).join(", ");
  return `<div class="fv-stair" role="img" aria-label="${esc(`Лестница: ${label}`)}">
    <div class="fv-stair-run">${sideRun(dirs)}${next.down ? toBadge("l", "down", next.down) : ""}${next.up ? toBadge("r", "up", next.up) : ""}</div>
    <div class="fv-hall" aria-hidden="true"></div>
    <div class="fv-stair-label">Лестница${ways.map(([dir, to]) => wayLine(dir, to)).join("")}</div>
  </div>`;
}

const DOOR_PARTS = '<i class="fv-gap"></i><i class="fv-arc"></i><i class="fv-leaf"></i>';

/** side — ряд на широком экране (a сверху, b снизу), mside — колонка на телефоне (l или r) */
function roomButton(cell, side, col, states, here, mside = side === "a" ? "l" : "r", last = false) {
  const info = stateOf(states, cell.n);
  const isHere = here != null && info.id === here;
  const { title: name, sub } = roomNames(cell);
  return `<button type="button" class="fv-room side-${side} m-${mside} is-${esc(info.state)} w${cell.w}${cell.type === "lobby" ? " is-lobby" : ""}${isHere ? " is-here" : ""}${last ? " is-end" : ""}" data-n="${esc(cell.n)}" data-col="${col}" data-w="${cell.w}"
      aria-label="${esc(`${name}, ${sub.toLowerCase()}: ${STATE_TEXT[info.state].toLowerCase()}`)}">
    <span class="fv-num">${cell.type === "lobby" ? "Главный холл" : esc(cell.n)}</span>
    ${cell.type === "lobby" || cell.type === "seminar" ? "" : `<span class="fv-type"><svg viewBox="0 0 24 24" aria-hidden="true">${TYPE_ICON[cell.type]}</svg><span>${esc(TYPES[cell.type])}</span></span>`}
    ${info.state === "clear" ? "" : `<span class="fv-state"><i></i>${SHORT[info.state]}</span>`}
    ${
      cell.type === "lobby"
        ? `<span class="fv-door d-l" aria-hidden="true">${DOOR_PARTS}</span><span class="fv-door d-r" aria-hidden="true">${DOOR_PARTS}</span>`
        : `<span class="fv-door" aria-hidden="true">${DOOR_PARTS}</span>`
    }
  </button>`;
}

function partHtml(part, states, here) {
  const units = Math.max(...[part.a, part.b].map((row) => row.reduce((s, c) => s + c.w, 0)));
  const row = (cells, side) => {
    let col = 1;
    return cells
      .map((c) => {
        const mside = (side === "a") !== !!part.mobileSwap ? "l" : "r";
        // у последнего кабинета своей стены нет: это стена соседней клетки, линия не двоится
        const html = roomButton(c, side, col, states, here, mside, col + c.w - 1 === units);
        col += c.w;
        return html;
      })
      .join("");
  };
  return `<div class="fv-part" data-units="${units}">
    ${row(part.a, "a")}
    <div class="fv-corridor" aria-hidden="true"><span>коридор</span></div>
    ${row(part.b, "b")}
  </div>`;
}

function planHtml(f, states, here) {
  // куда ведут боковые лестницы с этого этажа
  const side = {
    3: ["down", [["down", "на 1 и 2 этаж"]], { down: 2 }],
    2: ["both", [["up", "на 3 этаж"], ["down", "на 1 этаж"]], { up: 3, down: 1 }],
    1: ["up", [["up", "на 2 и 3 этаж"]], { up: 2 }],
  }[f.floor];
  let center = "";
  if (f.center === "entrance") {
    center = `<div class="fv-center">
      <div class="fv-center-run" role="img" aria-label="Лестница: вверх на 2 этаж">${centerRun("up")}<span class="fv-run-tag">${wayLine("up", "на 2 этаж")}</span></div>
      <div class="fv-hall" aria-hidden="true"></div>
      ${roomButton(LOBBY, "b", 1, states, here)}
      <div class="fv-entry" aria-hidden="true">${icon("arrowRight", "icon-sm")}Вход</div>
    </div>`;
  } else if (f.center === "arrive") {
    center = `<div class="fv-center">
      <div class="fv-center-run" role="img" aria-label="Лестница: вниз на 1 этаж">${centerRun("down")}</div>
      <div class="fv-hall" aria-hidden="true"></div>
      <div class="fv-stair-label">Лестница${wayLine("down", "на 1 этаж")}</div>
    </div>`;
  }
  const [first, second] = f.parts;
  return `<div class="fv-plan${f.center === "entrance" ? " has-entry" : ""}">
    ${stairCell(...side)}
    ${partHtml(first, states, here)}
    ${center}
    ${second ? partHtml(second, states, here) : ""}
    ${stairCell(...side)}
  </div>`;
}

/**
 * Открывает план этажа. states — из planStates(), here — id выбранного помещения,
 * onPick(id) — заявитель выбрал помещение для обращения.
 */
export async function openFloor(floorNo, { states, here = null, room = null, onPick, pickLabel = "Это здесь" } = {}) {
  await loadCss("/static/css/floor-view.css");
  const opener = document.activeElement;
  const cells = new Map(FLOORS.flatMap((f) => floorRooms(f).map((c) => [c.n, c])));
  const overlay = h(`
    <div class="fv-overlay" role="dialog" aria-modal="true" aria-labelledby="fv-title">
      <div class="fv">
        <div class="fv-head">
          <div class="fv-titles">
            <div class="eyebrow">План этажа</div>
            <h2 id="fv-title"></h2>
            <div class="fv-sub"></div>
          </div>
          <div class="fv-tabs" role="group" aria-label="Этаж">
            ${[1, 2, 3].map((n) => `<button type="button" data-floor="${n}">${n} этаж</button>`).join("")}
          </div>
          <button type="button" class="btn btn-ghost btn-icon fv-close" aria-label="Закрыть">${icon("x")}</button>
        </div>
        <div class="fv-body"></div>
        <div class="fv-detail" aria-live="polite"></div>
      </div>
    </div>`);
  const body = overlay.querySelector(".fv-body");
  const detail = overlay.querySelector(".fv-detail");
  let current = floorNo;
  let selected = null;
  let request = 0;

  const hint = () => {
    detail.innerHTML = `<div class="fv-hint">${icon("info", "icon-sm")}Нажмите на кабинет, чтобы открыть дверь и посмотреть, что там</div>`;
  };

  async function select(btn) {
    body.querySelectorAll(".fv-room.is-on").forEach((b) => b !== btn && b.classList.remove("is-on"));
    if (!btn) {
      selected = null;
      hint();
      return;
    }
    btn.classList.add("is-on");
    selected = btn.dataset.n;
    const cell = cells.get(selected);
    const data = stateOf(states, selected);
    const canPick = onPick && data.id != null && data.id !== here;
    detail.innerHTML = `
      <div class="fv-detail-main">
        <div class="fv-detail-icon is-${esc(data.state)}"><svg viewBox="0 0 24 24" aria-hidden="true">${TYPE_ICON[cell.type]}</svg></div>
        <div class="fv-detail-text">
          <b>${esc(roomNames(cell).title)}</b>
          <div class="muted small">${esc(roomNames(cell).sub)} · ${current} этаж</div>
          <div class="pl-info-state is-${esc(data.state)}"><i></i>${esc(STATE_TEXT[data.state])}${data.chronic ? ", проблемы повторяются" : ""}</div>
        </div>
        ${canPick ? `<button type="button" class="btn btn-primary btn-sm fv-pick">${esc(pickLabel)}</button>` : ""}
      </div>
      <div class="fv-issues"></div>`;
    detail.querySelector(".fv-pick")?.addEventListener("click", () => {
      close();
      onPick(data.id);
    });
    const box = detail.querySelector(".fv-issues");
    if (data.id == null) {
      box.innerHTML = `<p class="small muted">Помещение пока не добавлено в систему, заявки по нему не видны.</p>`;
      return;
    }
    if (data.state === "clear") return;
    const mine = ++request;
    box.innerHTML = `<div class="skeleton fv-issues-skeleton"></div>`;
    try {
      const room = await api(`/api/locations/${data.id}/status`);
      if (mine !== request) return;
      box.innerHTML = room.issues.length
        ? `<ul class="fv-issue-list">${room.issues
            .slice(0, 4)
            .map((i) => `<li><span class="t-num">${esc(i.public_number)}</span><span class="fv-issue-title">${esc(i.title)}</span><span class="muted">${esc(i.status_label)}</span></li>`)
            .join("")}</ul>`
        : "";
    } catch {
      if (mine === request) box.innerHTML = `<p class="small muted">Не удалось загрузить заявки. Проверьте соединение.</p>`;
    }
  }

  function render(floor, room) {
    current = floor;
    const f = FLOORS.find((x) => x.floor === floor);
    const open = floorRooms(f).filter((c) => stateOf(states, c.n).state !== "clear").length;
    overlay.querySelector("#fv-title").textContent = `${floor} этаж`;
    overlay.querySelector(".fv-sub").textContent = `${floorRooms(f).length - (f.center === "entrance" ? 1 : 0)} кабинетов · ${open ? `с заявками: ${open}` : "заявок нет"}`;
    overlay.querySelectorAll(".fv-tabs [data-floor]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.floor) === floor)));
    body.innerHTML = planHtml(f, states, here);
    // положение кабинета вдоль коридора: столбец на широком экране, строка на телефоне
    body.querySelectorAll(".fv-part").forEach((p) => p.style.setProperty("--units", p.dataset.units));
    body.querySelectorAll(".fv-room").forEach((b) => {
      b.style.setProperty("--col", b.dataset.col);
      b.style.setProperty("--w", b.dataset.w);
    });
    const target = room && body.querySelector(`.fv-room[data-n="${CSS.escape(room)}"]`);
    select(target || null);
    target?.scrollIntoView({ block: "center", inline: "center" });
  }

  function close() {
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("fv-lock");
    leaveAndRemove(overlay);
    if (opener?.isConnected) opener.focus?.();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (selected) select(null);
      else close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...overlay.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".fv-close")) return close();
    const tab = e.target.closest(".fv-tabs [data-floor]");
    if (tab) return render(Number(tab.dataset.floor), null);
    const btn = e.target.closest(".fv-room");
    if (btn) select(btn.dataset.n === selected ? null : btn);
  });
  // мышью дверь приоткрывается при наведении, нажатие закрепляет
  overlay.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    body.querySelectorAll(".fv-room.is-peek").forEach((b) => b.classList.remove("is-peek"));
    e.target.closest(".fv-room")?.classList.add("is-peek");
  });
  body.addEventListener("pointerleave", () => body.querySelectorAll(".fv-room.is-peek").forEach((b) => b.classList.remove("is-peek")));

  document.addEventListener("keydown", onKey);
  document.documentElement.classList.add("fv-lock");
  document.body.append(overlay);
  render(floorNo, room);
  (body.querySelector(".fv-room.is-on") || overlay.querySelector(".fv-close")).focus({ preventScroll: true });
  return { close };
}
