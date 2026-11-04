import { api, esc, icon, setBusy } from "../core.js";
import { ctx } from "./ctx.js";

const GUARDS = {
  danger: "фильтр опасности",
  threat: "угроза жизни",
  diy: "запрет самостоятельного ремонта",
  secret: "защита закрытых данных",
  danger_model: "ИИ распознал опасность",
  no_source: "нет источника в базе знаний",
  low_confidence: "низкая уверенность",
  unsafe_output: "опасный совет заблокирован",
  contacts_removed: "убраны непроверенные контакты",
};
const guard = (g) => GUARDS[g] || g;

function ring(passed, total) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const share = total ? passed / total : 0;
  const color = share === 1 ? "var(--green)" : share >= 0.8 ? "var(--amber)" : "var(--red)";
  return `<svg class="score-ring" viewBox="0 0 74 74" role="img" aria-label="${passed} из ${total}">
    <circle cx="37" cy="37" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="8"/>
    <circle cx="37" cy="37" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${c * share} ${c}" transform="rotate(-90 37 37)"/>
    <text x="37" y="42" text-anchor="middle" font-size="16" font-weight="800" fill="var(--text)">${passed}/${total}</text></svg>`;
}

export async function render({ el, setHead }) {
  const llm = ctx.meta.ai.engine === "gigachat";
  setHead("");
  el.innerHTML = `
    <section class="card card-pad stack">
      <div class="u-wrap u-gap12 row between">
        <div class="u-maxw640 stack-sm">
          <h2>Экзамен для ИИ</h2>
          <p class="muted small">Прогоняем помощника по сценариям из приложения А технического задания: типовые вопросы, неисправности,
            опасные ситуации, просьбы о паролях и вопросы без ответа. Проверяем тип ответа, категорию, ссылку на базу знаний
            и отсутствие опасных советов.</p>
          <div class="small">Сейчас работает: <b>${llm ? "GigaChat + фильтр безопасности" : "правила + фильтр безопасности (GigaChat не подключён)"}</b></div>
        </div>
        <div class="row">
          ${llm ? `<div class="segmented" id="eng"><button aria-pressed="true" data-e="auto">GigaChat</button><button aria-pressed="false" data-e="rules">Только правила</button></div>` : ""}
          <button class="btn btn-primary" id="run">${icon("play", "icon-sm")} Запустить проверку</button>
        </div>
      </div>
      <div id="result"></div>
    </section>

    <section class="card card-pad stack">
      <h3>Песочница</h3>
      <p class="small muted">Напишите любое сообщение и посмотрите, как его поймёт помощник. Заявка при этом не создаётся.</p>
      <div class="row"><input class="input" id="pg-text" maxlength="500" placeholder="Например: в 305 искрит удлинитель"><button class="btn" id="pg-run">${icon("send", "icon-sm")} Проверить</button></div>
      <div id="pg-out" class="playground-out"></div>
    </section>`;

  let engine = "auto";
  el.querySelectorAll("#eng button").forEach((b) =>
    b.addEventListener("click", () => {
      engine = b.dataset.e;
      el.querySelectorAll("#eng button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }),
  );

  el.querySelector("#run").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, "Проверяем…");
    const box = el.querySelector("#result");
    try {
      const r = await api(`/api/manage/ai/selftest?engine=${engine}`, { method: "POST" });
      box.innerHTML = `
        <div class="u-mv-6-14 score">${ring(r.passed, r.total)}
          <div><b class="u-fs18">${r.passed === r.total ? "Все сценарии пройдены" : `Пройдено ${r.passed} из ${r.total}`}</b>
          <div class="small muted">Движок: ${esc(r.engine)}</div></div></div>
        <div class="u-block table-wrap"><table class="table ai-result">
          <thead><tr><th><span class="sr-only">Результат</span></th><th>Сообщение</th><th>Что ожидаем</th><th>Что ответил ИИ</th><th>мс</th></tr></thead>
          <tbody>${r.results
            .map(
              (x) => `<tr>
                <td class="${x.passed ? "pass" : "fail"}">${icon(x.passed ? "checkCircle" : "alert")}</td>
                <td class="u-minw180"><b>${esc(x.text)}</b></td>
                <td class="u-minw160 small">${esc(x.goal)}<div class="faint">${esc(x.expected.join(" или "))}</div></td>
                <td class="u-minw280 small"><span class="chip ${x.passed ? "st-resolved" : "pr-critical"}">${esc(x.kind_label)}</span>
                  ${x.guard ? `<span class="chip st-review">${icon("shield", "icon-sm")} ${esc(guard(x.guard))}</span>` : ""}
                  <div class="u-mt6">${esc(x.answer.length > 220 ? x.answer.slice(0, 220) + "…" : x.answer)}</div>
                  ${x.sources.length ? `<div class="u-mt4 faint">${icon("book", "icon-sm")} ${esc(x.sources.join("; "))}</div>` : ""}
                  ${x.problems.length ? `<div class="u-mt4 fail">${esc(x.problems.join("; "))}</div>` : ""}
                </td>
                <td class="small faint">${x.ms}</td></tr>`,
            )
            .join("")}</tbody></table></div>`;
    } catch (err) {
      box.innerHTML = `<div class="notice notice-danger">${icon("alert")}<div>${esc(err.message)}</div></div>`;
    } finally {
      setBusy(btn, false);
    }
  });

  const runPlayground = async () => {
    const text = el.querySelector("#pg-text").value.trim();
    if (!text) return;
    const out = el.querySelector("#pg-out");
    out.innerHTML = `<div class="sk-h90 skeleton"></div>`;
    try {
      const r = await api("/api/assistant", { method: "POST", body: { message: text } });
      out.innerHTML = `
        <div class="notice ${r.kind === "danger" ? "notice-danger" : "notice-info"}">${icon(r.kind === "danger" ? "alert" : "bot")}
          <div class="stack-sm grow">
            <div class="row-wrap"><b>${esc(r.kind_label)}</b>
              ${r.category ? `<span class="chip">${esc(ctx.meta.categories.find((c) => c.code === r.category)?.name || r.category)}</span>` : ""}
              <span class="chip">уверенность ${Math.round(r.confidence * 100)}%</span>
              <span class="chip">${esc(r.engine_label)}</span>
              ${r.guard ? `<span class="chip st-review">${icon("shield", "icon-sm")} ${esc(guard(r.guard))}</span>` : ""}
              <span class="chip">${r.latency_ms} мс</span></div>
            <div class="pre">${esc(r.answer)}</div>
            ${r.tips.length ? `<ul class="ai-tips">${r.tips.map((t) => `<li>${icon("check")}<span>${esc(t)}</span></li>`).join("")}</ul>` : ""}
            ${r.sources.length ? `<div class="small muted">${icon("book", "icon-sm")} ${r.sources.map((s) => esc(s.title)).join("; ")}</div>` : ""}
            ${r.suggest_ticket ? `<div class="small">Черновик заявки: <b>${esc(r.draft_title)}</b>, приоритет ${esc((ctx.meta.priorities.find((p) => p.value === r.priority)?.label || r.priority).toLowerCase())}</div>` : ""}
          </div></div>`;
    } catch (err) {
      out.innerHTML = `<div class="notice notice-danger">${icon("alert")}<div>${esc(err.message)}</div></div>`;
    }
  };
  el.querySelector("#pg-run").addEventListener("click", runPlayground);
  el.querySelector("#pg-text").addEventListener("keydown", (e) => e.key === "Enter" && runPlayground());
}
