import { NO_MANAGER, api, confirmDialog, contextActions, copyText, esc, icon, openModal, pageActions, plural, setBusy, toast } from "../core.js";
import { attachCombo } from "./combo.js";
import { ctx, initials, loadAssignees } from "./ctx.js";

const ROLES = { admin: "Администратор", staff: "Сотрудник УПК", executor: "Исполнитель" };

const LOGIN_RE = /^[a-z0-9_.-]{3,60}$/i;
const PASSWORD_MIN = 8;
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const latin = (text) => [...text.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("");

/** Логины из имени сотрудника: только свободные, занятый получает номер */
function loginVariants(name, typed, taken) {
  const [first, last] = latin(name).split(/[^a-z0-9]+/).filter(Boolean);
  const wanted = latin(typed).replace(/[^a-z0-9_.-]/g, "");
  const base = first && last ? [`${first[0]}.${last}`, `${first}.${last}`, `${last}.${first[0]}`, last] : first ? [first] : [];
  // написали кириллицей: первым идёт то же самое латиницей
  if (wanted && wanted !== typed.toLowerCase()) base.unshift(wanted);
  const free = (login) => {
    if (!taken.has(login)) return login;
    for (let n = 2; n < 100; n += 1) if (!taken.has(`${login}${n}`)) return `${login}${n}`;
    return null;
  };
  const found = base.filter((login) => login.length >= 3).map(free).filter(Boolean);
  return [...new Set(found)].filter((login) => login !== typed && login.startsWith(wanted)).slice(0, 5);
}

function newPassword(length = 14) {
  return Array.from(crypto.getRandomValues(new Uint32Array(length)), (v) => PASSWORD_ALPHABET[v % PASSWORD_ALPHABET.length]).join("");
}

function userForm(u = {}) {
  return `
    <div class="field"><label for="u-name">Имя и фамилия</label><input class="input" id="u-name" maxlength="120" value="${esc(u.name || "")}"></div>
    <div class="field"><label for="u-pos">Должность</label><input class="input" id="u-pos" maxlength="120" value="${esc(u.position || "")}" placeholder="Например: электрик"></div>
    <div class="u-gap12 grid-2">
      <div class="field"><label for="u-nick">Логин</label><input class="input" id="u-nick" maxlength="60" value="${esc(u.login || "")}" ${u.id ? "disabled" : ""} ${NO_MANAGER}>
        ${u.id ? "" : `<span class="hint" id="u-nick-hint">Латиница, цифры, точка, дефис</span>`}</div>
      <div class="field"><label for="u-role">Роль</label><select class="select" id="u-role">${Object.entries(ROLES)
        .map(([k, v]) => `<option value="${k}" ${(u.role || "staff") === k ? "selected" : ""}>${v}</option>`)
        .join("")}</select></div>
    </div>
    <div class="field"><label for="u-secret">${u.id ? "Новый временный пароль" : "Временный пароль"}</label>
      <div class="input-with-btn">
        <input class="input mono" id="u-secret" type="text" maxlength="200" ${NO_MANAGER} placeholder="${u.id ? "Оставьте пустым, чтобы не менять" : `Не короче ${PASSWORD_MIN} символов`}">
        <button type="button" class="btn btn-sm" id="u-gen">${icon("refresh", "icon-sm")} Придумать</button>
      </div>
      <span class="hint">Передайте его сотруднику: при первом входе система попросит заменить пароль на постоянный. На сервере хранится только хеш bcrypt, при смене пароля все сессии сотрудника завершаются.</span></div>
    ${u.id ? `<label class="check"><input type="checkbox" id="u-active" ${u.is_active ? "checked" : ""}> Доступ включён</label>` : ""}`;
}

export async function render({ el, setHead }) {
  setHead(`<button class="btn btn-primary btn-sm" id="u-add">${icon("plus", "icon-sm")} Добавить сотрудника</button>`);
  let users = [];
  let categories = [];

  const refresh = async () => {
    await loadAssignees();
    await load();
  };
  const changeUser = async (u, body, done) => {
    await api(`/api/manage/users/${u.id}`, { method: "PATCH", body });
    toast(done);
    await refresh();
  };
  const removeUser = async (u) => {
    const open = u.open_tickets || 0;
    const tickets = open
      ? ` ${open} ${plural(open, "открытая заявка вернётся", "открытые заявки вернутся", "открытых заявок вернётся")} на рассмотрение без исполнителя.`
      : "";
    const ok = await confirmDialog(
      `Удалить: ${u.name}?`,
      `Учётная запись удалится насовсем, войти с ней будет нельзя.${tickets} История заявок сохранится. Если сотрудник может вернуться, лучше отключить доступ.`,
      "Удалить",
      true,
    );
    if (!ok) return false;
    try {
      await api(`/api/manage/users/${u.id}`, { method: "DELETE" });
      toast("Сотрудник удалён");
      await refresh();
      return true;
    } catch (err) {
      toast(err.message, "error");
      return false;
    }
  };

  const edit = (u) =>
    openModal({
      title: u ? u.name : "Новый сотрудник",
      body: userForm(u || {}),
      footer: `${u && u.id !== ctx.user.id ? `<button class="u-mr-auto u-red btn btn-ghost" id="u-del">${icon("trash", "icon-sm")} Удалить</button>` : ""}
        <button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="u-save">Сохранить</button>`,
      onMount(m, close) {
        m.querySelector("#u-del")?.addEventListener("click", async () => {
          if (await removeUser(u)) close();
        });
        const saveBtn = m.querySelector("#u-save");
        const nameInput = m.querySelector("#u-name");
        const loginInput = m.querySelector("#u-nick");
        const secretInput = m.querySelector("#u-secret");
        const taken = new Set(users.map((x) => x.login.toLowerCase()));
        if (!u) {
          attachCombo(loginInput, {
            title: "Свободные логины",
            options: () => loginVariants(nameInput.value, loginInput.value.trim(), taken),
          });
          const hint = m.querySelector("#u-nick-hint");
          loginInput.addEventListener("input", () => {
            const busy = taken.has(loginInput.value.trim().toLowerCase());
            hint.classList.toggle("is-error", busy);
            hint.textContent = busy ? "Такой логин уже занят" : "Латиница, цифры, точка, дефис";
          });
        }
        m.querySelector("#u-gen").addEventListener("click", () => {
          secretInput.value = newPassword();
          secretInput.select();
          copyText(secretInput.value);
        });
        const problem = () => {
          if (nameInput.value.trim().length < 2) return [nameInput, "Впишите имя и фамилию"];
          if (!u) {
            const login = loginInput.value.trim();
            if (!LOGIN_RE.test(login)) return [loginInput, "Логин: от 3 символов, латиница, цифры, точка, дефис или подчёркивание"];
            if (taken.has(login.toLowerCase())) return [loginInput, "Такой логин уже занят"];
          }
          const size = secretInput.value.length;
          if (u ? size > 0 && size < PASSWORD_MIN : size < PASSWORD_MIN) return [secretInput, `Пароль не короче ${PASSWORD_MIN} символов`];
          return null;
        };
        saveBtn.addEventListener("click", async () => {
          const wrong = problem();
          if (wrong) {
            wrong[0].focus();
            toast(wrong[1], "error");
            return;
          }
          const password = secretInput.value;
          setBusy(saveBtn, true);
          try {
            if (u) {
              const body = {
                name: m.querySelector("#u-name").value.trim(),
                position: m.querySelector("#u-pos").value.trim(),
                role: m.querySelector("#u-role").value,
                is_active: m.querySelector("#u-active").checked,
              };
              if (password) body.password = password;
              await api(`/api/manage/users/${u.id}`, { method: "PATCH", body });
            } else {
              await api("/api/manage/users", {
                method: "POST",
                body: {
                  name: m.querySelector("#u-name").value.trim(),
                  position: m.querySelector("#u-pos").value.trim() || null,
                  login: loginInput.value.trim(),
                  role: m.querySelector("#u-role").value,
                  password,
                },
              });
            }
            toast("Сохранено");
            close();
            await loadAssignees();
            await load();
          } catch (err) {
            toast(err.message, "error");
          } finally {
            setBusy(saveBtn, false);
          }
        });
      },
    });

  document.getElementById("u-add").addEventListener("click", () => edit(null));

  contextActions("tr[data-user]", (row) => {
    const u = users.find((x) => String(x.id) === row.dataset.user);
    if (!u) return null;
    const me = u.id === ctx.user.id;
    return {
      title: u.name,
      items: [
        { label: "Изменить", ic: "edit", action: () => edit(u) },
        { label: "Скопировать логин", ic: "copy", action: () => copyText(u.login) },
        {
          label: "Заявки сотрудника",
          ic: "list",
          hint: u.open_tickets ? String(u.open_tickets) : "",
          action: () => (location.hash = `#/tickets?status=&assignee=${u.id}`),
        },
        "sep",
        {
          label: "Роль",
          ic: "users",
          disabled: me,
          items: Object.entries(ROLES).map(([value, label]) => ({
            label,
            checked: u.role === value,
            action: () => (u.role === value ? undefined : changeUser(u, { role: value }, `Роль: ${label}`)),
          })),
        },
        {
          label: u.is_active ? "Отключить доступ" : "Включить доступ",
          ic: "lock",
          disabled: me,
          action: () => changeUser(u, { is_active: !u.is_active }, u.is_active ? "Доступ отключён" : "Доступ включён"),
        },
        { label: "Удалить", ic: "trash", danger: true, disabled: me, hint: me ? "это вы" : "", action: () => removeUser(u) },
      ],
    };
  });
  pageActions(() => [{ label: "Добавить сотрудника", ic: "plus", action: () => edit(null) }]);

  async function load() {
    [users, categories] = await Promise.all([api("/api/manage/users"), api("/api/manage/categories")]);
    const executors = users.filter((u) => u.is_active);
    el.innerHTML = `
      <section class="card table-card"><div class="u-block table-wrap"><table class="table">
        <thead><tr><th>Сотрудник</th><th>Логин</th><th>Роль</th><th>Telegram</th><th>Статус</th><th><span class="sr-only">Действия</span></th></tr></thead>
        <tbody>${users
          .map(
            (u) => `<tr data-user="${u.id}">
              <td><span class="row"><span class="avatar avatar-sm">${esc(initials(u.name))}</span><span><div class="t-title">${esc(u.name)}</div><div class="t-sub">${esc(u.position || "")}</div></span></span></td>
              <td class="mono small">${esc(u.login)}</td>
              <td>${esc(u.role_label)}</td>
              <td>${u.telegram_linked ? `<span class="u-green tag">${icon("telegram", "icon-sm")} подключён</span>` : `<span class="faint small">нет</span>`}</td>
              <td>${u.is_active ? `<span class="chip st-resolved">активен</span>` : `<span class="chip st-rejected">отключён</span>`}</td>
              <td class="nowrap"><button class="btn btn-ghost btn-icon btn-sm" data-edit="${u.id}" title="Изменить" aria-label="Изменить">${icon("edit", "icon-sm")}</button>${
                u.id === ctx.user.id
                  ? ""
                  : `<button class="btn btn-ghost btn-icon btn-sm u-red" data-del="${u.id}" title="Удалить" aria-label="Удалить: ${esc(u.name)}">${icon("trash", "icon-sm")}</button>`
              }</td>
            </tr>`,
          )
          .join("")}</tbody></table></div></section>

      <section class="card">
        <div class="card-head"><div><h2 class="h3">Маршрутизация по категориям</h2>
          <div class="small muted">Кого система предложит исполнителем для новой заявки и какой приоритет поставит по умолчанию</div></div></div>
        <div class="u-block table-wrap"><table class="table">
          <thead><tr><th>Категория</th><th>Исполнитель по умолчанию</th><th>Приоритет по умолчанию</th></tr></thead>
          <tbody>${categories
            .map(
              (c) => `<tr>
                <td><span class="cat-cell">${icon(c.icon, "icon-sm")}${esc(c.name)}</span></td>
                <td><select class="u-maxw280 select select-sm" data-cat-assignee="${c.id}" aria-label="Исполнитель по умолчанию: ${esc(c.name)}">
                  <option value="">Не назначать</option>
                  ${executors.map((u) => `<option value="${u.id}" ${c.default_assignee?.id === u.id ? "selected" : ""}>${esc(u.name)}${u.position ? `, ${esc(u.position)}` : ""}</option>`).join("")}
                </select></td>
                <td><select class="u-maxw180 select select-sm" data-cat-priority="${c.id}" aria-label="Приоритет по умолчанию: ${esc(c.name)}">
                  ${ctx.meta.priorities.map((p) => `<option value="${p.value}" ${c.default_priority === p.value ? "selected" : ""}>${esc(p.label)}</option>`).join("")}
                </select></td></tr>`,
            )
            .join("")}</tbody></table></div>
      </section>`;

    el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => edit(users.find((u) => String(u.id) === b.dataset.edit))));
    el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => removeUser(users.find((u) => String(u.id) === b.dataset.del))));
    el.querySelectorAll("[data-cat-assignee]").forEach((s) =>
      s.addEventListener("change", async () => {
        const body = s.value ? { default_assignee_id: Number(s.value) } : { clear_assignee: true };
        try {
          await api(`/api/manage/categories/${s.dataset.catAssignee}`, { method: "PATCH", body });
          toast("Маршрут сохранён");
        } catch (err) {
          toast(err.message, "error");
        }
      }),
    );
    el.querySelectorAll("[data-cat-priority]").forEach((s) =>
      s.addEventListener("change", async () => {
        try {
          await api(`/api/manage/categories/${s.dataset.catPriority}`, { method: "PATCH", body: { default_priority: s.value } });
          toast("Приоритет сохранён");
        } catch (err) {
          toast(err.message, "error");
        }
      }),
    );
  }
  await load();
}
