import { api, esc, icon, openModal, toast } from "../core.js";
import { ctx, initials, loadAssignees } from "./ctx.js";

const ROLES = { admin: "Администратор", staff: "Сотрудник УПК", executor: "Исполнитель" };

function userForm(u = {}) {
  return `
    <div class="field"><label for="u-name">Имя и фамилия</label><input class="input" id="u-name" maxlength="120" value="${esc(u.name || "")}"></div>
    <div class="field"><label for="u-pos">Должность</label><input class="input" id="u-pos" maxlength="120" value="${esc(u.position || "")}" placeholder="Например: электрик"></div>
    <div class="grid-2" style="gap:12px">
      <div class="field"><label for="u-login">Логин</label><input class="input" id="u-login" maxlength="60" value="${esc(u.login || "")}" ${u.id ? "disabled" : ""} autocapitalize="none"></div>
      <div class="field"><label for="u-role">Роль</label><select class="select" id="u-role">${Object.entries(ROLES)
        .map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`)
        .join("")}</select></div>
    </div>
    <div class="field"><label for="u-pass">${u.id ? "Новый пароль" : "Пароль"}</label>
      <input class="input" id="u-pass" type="password" autocomplete="new-password" placeholder="${u.id ? "Оставьте пустым, чтобы не менять" : "Не короче 8 символов"}">
      <span class="hint">Хранится только в виде хеша bcrypt. При смене пароля все сессии пользователя завершаются.</span></div>
    ${u.id ? `<label class="check"><input type="checkbox" id="u-active" ${u.is_active ? "checked" : ""}> Доступ включён</label>` : ""}`;
}

export async function render({ el, setHead }) {
  setHead(`<button class="btn btn-primary btn-sm" id="u-add">${icon("plus", "icon-sm")} Добавить сотрудника</button>`);
  let users = [];
  let categories = [];

  const edit = (u) =>
    openModal({
      title: u ? u.name : "Новый сотрудник",
      body: userForm(u || {}),
      footer: `<button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="u-save">Сохранить</button>`,
      onMount(m, close) {
        m.querySelector("#u-save").addEventListener("click", async () => {
          const password = m.querySelector("#u-pass").value;
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
                  login: m.querySelector("#u-login").value.trim(),
                  role: m.querySelector("#u-role").value,
                  password,
                },
              });
            }
            toast("Сохранено");
            close();
            await loadAssignees();
            load();
          } catch (err) {
            toast(err.message, "error");
          }
        });
      },
    });

  document.getElementById("u-add").addEventListener("click", () => edit(null));

  async function load() {
    [users, categories] = await Promise.all([api("/api/manage/users"), api("/api/manage/categories")]);
    const executors = users.filter((u) => u.is_active);
    el.innerHTML = `
      <section class="card table-card"><div class="table-wrap" style="display:block"><table class="table">
        <thead><tr><th>Сотрудник</th><th>Логин</th><th>Роль</th><th>Telegram</th><th>Статус</th><th></th></tr></thead>
        <tbody>${users
          .map(
            (u) => `<tr>
              <td><span class="row"><span class="avatar avatar-sm">${esc(initials(u.name))}</span><span><div class="t-title">${esc(u.name)}</div><div class="t-sub">${esc(u.position || "")}</div></span></span></td>
              <td class="mono small">${esc(u.login)}</td>
              <td>${esc(u.role_label)}</td>
              <td>${u.telegram_linked ? `<span class="tag" style="color:var(--green)">${icon("telegram", "icon-sm")} подключён</span>` : `<span class="faint small">нет</span>`}</td>
              <td>${u.is_active ? `<span class="chip st-resolved">активен</span>` : `<span class="chip st-rejected">отключён</span>`}</td>
              <td><button class="btn btn-ghost btn-icon btn-sm" data-edit="${u.id}" title="Изменить">${icon("edit", "icon-sm")}</button></td>
            </tr>`,
          )
          .join("")}</tbody></table></div></section>

      <section class="card">
        <div class="card-head"><div><h3>Маршрутизация по категориям</h3>
          <div class="small muted">Кого система предложит исполнителем для новой заявки и какой приоритет поставит по умолчанию</div></div></div>
        <div class="table-wrap" style="display:block"><table class="table">
          <thead><tr><th>Категория</th><th>Исполнитель по умолчанию</th><th>Приоритет по умолчанию</th></tr></thead>
          <tbody>${categories
            .map(
              (c) => `<tr>
                <td><span class="cat-cell">${icon(c.icon, "icon-sm")}${esc(c.name)}</span></td>
                <td><select class="select select-sm" data-cat-assignee="${c.id}" style="max-width:280px">
                  <option value="">Не назначать</option>
                  ${executors.map((u) => `<option value="${u.id}" ${c.default_assignee?.id === u.id ? "selected" : ""}>${esc(u.name)}${u.position ? `, ${esc(u.position)}` : ""}</option>`).join("")}
                </select></td>
                <td><select class="select select-sm" data-cat-priority="${c.id}" style="max-width:180px">
                  ${ctx.meta.priorities.map((p) => `<option value="${p.value}" ${c.default_priority === p.value ? "selected" : ""}>${esc(p.label)}</option>`).join("")}
                </select></td></tr>`,
            )
            .join("")}</tbody></table></div>
      </section>`;

    el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => edit(users.find((u) => String(u.id) === b.dataset.edit))));
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
