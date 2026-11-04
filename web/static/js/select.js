// Выпадающие списки в стиле сайта вместо системных.
// Каждый <select class="select"> получает кнопку и своё меню, сам select остаётся в разметке скрытым:
// код страниц читает и ставит его value и слушает change как раньше, а кнопка и меню подстраиваются сами.

const CHEVRON = '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const CHECK = '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
let seq = 0;
let openMenu = null;

function text(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function labelFor(select) {
  if (select.getAttribute("aria-label")) return select.getAttribute("aria-label");
  if (select.id) {
    const label = document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
    if (label) return label.textContent.trim();
  }
  return "";
}

function enhance(select) {
  if (select.dataset.ui || select.multiple) return;
  select.dataset.ui = "1";
  const id = `ui-select-${++seq}`;
  const wrap = document.createElement("span");
  wrap.className = "ui-select";
  // ширина и ограничения, заданные самому select, переходят на обёртку
  wrap.style.cssText = select.style.cssText;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ui-select-btn ${select.className}`;
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", `${id}-menu`);
  const label = labelFor(select);
  button.innerHTML = `<span class="ui-select-value"></span>${CHEVRON}`;
  select.before(wrap);
  wrap.append(select, button);
  select.classList.add("ui-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const refresh = () => {
    const opt = select.options[select.selectedIndex];
    button.querySelector(".ui-select-value").textContent = opt ? opt.textContent : "";
    button.disabled = select.disabled;
    button.setAttribute("aria-label", label ? `${label}: ${opt ? opt.textContent : ""}` : opt?.textContent || "");
  };

  // value и selectedIndex, выставленные кодом, тоже обновляют кнопку
  for (const prop of ["value", "selectedIndex"]) {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    Object.defineProperty(select, prop, {
      configurable: true,
      get() {
        return desc.get.call(this);
      },
      set(v) {
        desc.set.call(this, v);
        refresh();
      },
    });
  }
  new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected"] });
  select.addEventListener("change", refresh);
  // клик по подписи поля фокусирует скрытый select, фокус уходит на кнопку
  select.addEventListener("focus", () => button.focus());

  const choose = (index) => {
    if (index < 0 || select.options[index]?.disabled) return;
    if (select.selectedIndex !== index) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const open = () => {
    if (button.disabled) return;
    closeOpen();
    const menu = document.createElement("div");
    menu.className = "ui-select-menu";
    menu.id = `${id}-menu`;
    menu.setAttribute("role", "listbox");
    if (label) menu.setAttribute("aria-label", label);
    menu.innerHTML = [...select.options]
      .map(
        (o, i) => `<div class="ui-option${o.disabled ? " is-disabled" : ""}" role="option" id="${id}-o${i}" data-i="${i}" aria-selected="${i === select.selectedIndex}"${o.disabled ? ' aria-disabled="true"' : ""}>
          <span>${text(o.textContent)}</span>${CHECK}</div>`,
      )
      .join("");
    document.body.append(menu);
    place(menu);
    let active = Math.max(0, select.selectedIndex);
    const setActive = (i) => {
      const items = menu.querySelectorAll(".ui-option");
      if (!items.length) return;
      active = Math.min(items.length - 1, Math.max(0, i));
      items.forEach((n) => n.classList.toggle("is-active", Number(n.dataset.i) === active));
      menu.setAttribute("aria-activedescendant", `${id}-o${active}`);
      items[active].scrollIntoView({ block: "nearest" });
    };
    setActive(active);
    button.setAttribute("aria-expanded", "true");
    wrap.classList.add("is-open");

    let typed = "";
    let typedAt = 0;
    const onKey = (e) => {
      if (e.key === "ArrowDown") setActive(active + 1);
      else if (e.key === "ArrowUp") setActive(active - 1);
      else if (e.key === "Home") setActive(0);
      else if (e.key === "End") setActive(select.options.length - 1);
      else if (e.key === "Enter" || e.key === " ") {
        choose(active);
        close();
      } else if (e.key === "Escape") {
        // окно, в котором стоит список, при этом не закрывается
        e.stopPropagation();
        close();
      } else if (e.key === "Tab") {
        close(false);
        return;
      } else if (e.key.length === 1) {
        const now = Date.now();
        typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
        typedAt = now;
        const found = [...select.options].findIndex((o) => o.textContent.trim().toLowerCase().startsWith(typed));
        if (found >= 0) setActive(found);
      } else return;
      e.preventDefault();
    };
    const onDown = (e) => {
      if (!menu.contains(e.target) && !wrap.contains(e.target)) close(false);
    };
    const onMove = () => place(menu);
    menu.addEventListener("click", (e) => {
      const item = e.target.closest(".ui-option");
      if (!item || item.classList.contains("is-disabled")) return;
      choose(Number(item.dataset.i));
      close();
    });
    menu.addEventListener("pointermove", (e) => {
      const item = e.target.closest(".ui-option");
      if (item) setActive(Number(item.dataset.i));
    });
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);

    function close(focus = true) {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      button.setAttribute("aria-expanded", "false");
      wrap.classList.remove("is-open");
      menu.classList.add("is-leaving");
      setTimeout(() => menu.remove(), 160);
      if (openMenu?.menu === menu) openMenu = null;
      if (focus) button.focus();
    }
    openMenu = { menu, close };

    function place(m) {
      const r = button.getBoundingClientRect();
      if (!button.isConnected || r.width === 0) return close(false);
      const below = innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 200 && above > below;
      m.style.minWidth = `${r.width}px`;
      m.style.left = `${Math.min(r.left, innerWidth - m.offsetWidth - 8)}px`;
      m.style.maxHeight = `${Math.min(320, up ? above : below)}px`;
      m.style.top = up ? "" : `${r.bottom + 6}px`;
      m.style.bottom = up ? `${innerHeight - r.top + 6}px` : "";
      m.classList.toggle("is-up", up);
    }
  };

  button.addEventListener("click", () => (wrap.classList.contains("is-open") ? openMenu?.close() : open()));
  button.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key) && !wrap.classList.contains("is-open")) {
      e.preventDefault();
      open();
    }
  });
  refresh();
}

function closeOpen() {
  openMenu?.close(false);
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches?.("select.select")) enhance(root);
  root.querySelectorAll?.("select.select").forEach(enhance);
}

if (document.body) {
  scan(document.body);
  new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
}
