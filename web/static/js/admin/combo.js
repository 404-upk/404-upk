// Свой список подсказок под полем ввода вместо списка браузера: тот же вид, что у выпадающих списков сайта.
// Открывается по нажатию на поле, при вводе и стрелкой вниз. Простой фокус его не открывает.

import { esc, icon } from "../core.js";

let seq = 0;

/**
 * options() возвращает строки (значения для поля) и пункты-действия { label, ic, action }.
 * title — подпись над значениями, onPick(value) — что делать после выбора значения.
 */
export function attachCombo(input, { title, options, onPick }) {
  const menuId = `combo-${++seq}`;
  let menu = null;
  let entries = [];
  let active = -1;

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", menuId);

  const place = () => {
    if (!menu) return;
    const r = input.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.minWidth = `${r.width}px`;
    menu.style.maxHeight = `${Math.max(120, innerHeight - r.bottom - 18)}px`;
  };
  const close = () => {
    if (!menu) return;
    const leaving = menu;
    menu = null;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    leaving.setAttribute("aria-hidden", "true");
    leaving.classList.add("is-leaving");
    setTimeout(() => leaving.remove(), 160);
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
  };
  const setActive = (i) => {
    active = i;
    menu.querySelectorAll(".ui-option").forEach((n) => n.classList.toggle("is-active", Number(n.dataset.i) === active));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${menuId}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };
  const choose = (i) => {
    const entry = entries[i];
    close();
    if (typeof entry === "string") {
      input.value = entry;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      close();
      onPick?.(entry);
    } else {
      entry?.action?.();
    }
  };
  const refresh = () => {
    entries = options();
    if (!entries.length) return close();
    if (!menu) {
      menu = document.createElement("div");
      menu.className = "ui-select-menu login-menu";
      menu.id = menuId;
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", title);
      // нажатие по списку не должно забирать фокус у поля, иначе список закроется раньше выбора
      menu.addEventListener("pointerdown", (e) => e.preventDefault());
      menu.addEventListener("click", (e) => {
        const item = e.target.closest(".ui-option");
        if (item) choose(Number(item.dataset.i));
      });
      menu.addEventListener("pointermove", (e) => {
        const item = e.target.closest(".ui-option");
        if (item && Number(item.dataset.i) !== active) setActive(Number(item.dataset.i));
      });
      document.body.append(menu);
      input.setAttribute("aria-expanded", "true");
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true);
    }
    active = -1;
    input.removeAttribute("aria-activedescendant");
    const firstAction = entries.findIndex((entry) => typeof entry !== "string");
    const hasValues = firstAction !== 0;
    menu.innerHTML = `${hasValues ? `<div class="login-menu-title">${esc(title)}</div>` : ""}${entries
      .map((entry, i) =>
        typeof entry === "string"
          ? `<div class="ui-option mono" role="option" id="${menuId}-${i}" data-i="${i}" aria-selected="false"><span>${esc(entry)}</span></div>`
          : `${i === firstAction && hasValues ? '<div class="login-menu-sep" role="separator"></div>' : ""}<div class="ui-option login-menu-action" role="option" id="${menuId}-${i}" data-i="${i}" aria-selected="false">${entry.ic ? icon(entry.ic, "icon-sm") : ""}<span class="grow">${esc(entry.label)}</span></div>`,
      )
      .join("")}`;
    place();
  };

  input.addEventListener("pointerdown", refresh);
  input.addEventListener("input", refresh);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    if (!menu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        refresh();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const count = entries.length;
      const from = active < 0 && e.key === "ArrowUp" ? 0 : active;
      setActive((from + (e.key === "ArrowDown" ? 1 : -1) + count) % count);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      // окно с формой при этом остаётся открытым
      e.stopPropagation();
      close();
    }
  });
}
