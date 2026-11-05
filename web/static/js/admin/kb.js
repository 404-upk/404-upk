import { api, confirmDialog, contextActions, copyText, esc, fmtDate, icon, openModal, pageActions, toast } from "../core.js";
import { ctx } from "./ctx.js";

function form(a) {
  return `
    <div class="field"><label for="kb-q">Вопрос или название</label><input class="input" id="kb-q" maxlength="200" value="${esc(a.question || "")}"></div>
    <div class="field"><label for="kb-a">Ответ</label><textarea class="textarea" id="kb-a" rows="7" maxlength="4000">${esc(a.answer || "")}</textarea>
      <span class="hint">ИИ отвечает только тем, что написано здесь. Не пишите сюда пароли и закрытые данные.</span></div>
    <div class="u-gap12 grid-2">
      <div class="field"><label for="kb-c">Категория</label><select class="select" id="kb-c"><option value="">Общее</option>${ctx.meta.categories
        .map((c) => `<option value="${c.id}" ${a.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`)
        .join("")}</select></div>
      <div class="field"><label for="kb-s">Источник</label><input class="input" id="kb-s" maxlength="160" value="${esc(a.source || "База знаний УПК")}"></div>
    </div>
    <div class="field"><label for="kb-k">Ключевые фразы через запятую</label><textarea class="u-minh60 textarea" id="kb-k" rows="2" maxlength="2000">${esc(a.keywords || "")}</textarea>
      <span class="hint">Как люди обычно спрашивают об этом. Нужны для поиска, когда GigaChat недоступен.</span></div>
    <label class="check"><input type="checkbox" id="kb-act" ${a.is_active === false ? "" : "checked"}> Статья используется помощником</label>`;
}

export async function render({ el, setHead }) {
  setHead(`<button class="btn btn-primary btn-sm" id="kb-add">${icon("plus", "icon-sm")} Новая статья</button>`);
  let items = [];

  const edit = (a) =>
    openModal({
      title: a ? "Статья базы знаний" : "Новая статья",
      wide: true,
      body: form(a || {}),
      footer: `${a ? `<button class="u-mr-auto u-red btn btn-ghost" id="kb-del">${icon("trash", "icon-sm")} Удалить</button>` : ""}
        <button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="kb-save">Сохранить</button>`,
      onMount(m, close) {
        m.querySelector("#kb-save").addEventListener("click", async () => {
          const body = {
            question: m.querySelector("#kb-q").value.trim(),
            answer: m.querySelector("#kb-a").value.trim(),
            category_id: m.querySelector("#kb-c").value ? Number(m.querySelector("#kb-c").value) : null,
            source: m.querySelector("#kb-s").value.trim(),
            keywords: m.querySelector("#kb-k").value.trim(),
            is_active: m.querySelector("#kb-act").checked,
          };
          try {
            if (a) await api(`/api/manage/kb/${a.id}`, { method: "PUT", body });
            else await api("/api/manage/kb", { method: "POST", body });
            toast("Сохранено. Помощник уже использует новую версию");
            close();
            load();
          } catch (err) {
            toast(err.message, "error");
          }
        });
        m.querySelector("#kb-del")?.addEventListener("click", async () => {
          if (await removeArticle(a)) close();
        });
      },
    });

  document.getElementById("kb-add").addEventListener("click", () => edit(null));

  async function removeArticle(a) {
    if (!(await confirmDialog("Удалить статью?", "Помощник перестанет на неё ссылаться.", "Удалить", true))) return false;
    try {
      await api(`/api/manage/kb/${a.id}`, { method: "DELETE" });
      toast("Статья удалена");
      await load();
      return true;
    } catch (err) {
      toast(err.message, "error");
      return false;
    }
  }

  contextActions(".card[data-id]", (card) => {
    const a = items.find((x) => String(x.id) === card.dataset.id);
    if (!a) return null;
    const { question, answer, category_id, source, keywords, is_active } = a;
    return {
      title: a.question,
      items: [
        { label: "Изменить", ic: "edit", action: () => edit(a) },
        { label: "Скопировать ответ", ic: "copy", action: () => copyText(a.answer) },
        {
          label: is_active ? "Выключить статью" : "Включить статью",
          ic: "lock",
          async action() {
            await api(`/api/manage/kb/${a.id}`, { method: "PUT", body: { question, answer, category_id, source, keywords, is_active: !is_active } });
            toast(is_active ? "Статья выключена, помощник её не использует" : "Статья включена");
            await load();
          },
        },
        "sep",
        { label: "Удалить", ic: "trash", danger: true, action: () => removeArticle(a) },
      ],
    };
  });
  pageActions(() => [{ label: "Новая статья", ic: "plus", action: () => edit(null) }]);

  async function load() {
    items = await api("/api/manage/kb");
    el.innerHTML = `
      <div class="notice notice-info">${icon("info")}<div class="small">Это единственный источник ответов ИИ на вопросы. Если ответа здесь нет,
        помощник честно скажет, что проверенной информации нет, и предложит обратиться к сотруднику.</div></div>
      <div class="grid-2">${items
        .map(
          (a) => `
        <article class="card card-pad stack-sm is-clickable${a.is_active ? "" : " is-inactive"}" data-id="${a.id}">
          <div class="row between"><span class="tag">${icon("book", "icon-sm")} ${esc(a.category || "Общее")}</span><span class="tiny faint">#${a.id}</span></div>
          <h2 class="h3">${esc(a.question)}</h2>
          <p class="u-clamp3 small muted">${esc(a.answer)}</p>
          <div class="tiny faint">${esc(a.source)} · обновлено ${fmtDate(a.updated_at, false)}${a.is_active ? "" : " · выключена"}</div>
        </article>`,
        )
        .join("")}</div>`;
    el.querySelectorAll("[data-id]").forEach((c) => c.addEventListener("click", () => edit(items.find((a) => String(a.id) === c.dataset.id))));
  }
  await load();
}
