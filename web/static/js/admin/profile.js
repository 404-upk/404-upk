import { api, esc, icon, setBusy, toast } from "../core.js";
import { ctx, initials } from "./ctx.js";

export async function render({ el }) {
  const me = await api("/api/auth/me");
  ctx.user = { ...ctx.user, ...me };
  el.innerHTML = `
    <section class="u-maxw640 card card-pad stack">
      <div class="row"><span class="u-avatar-lg avatar">${esc(initials(me.name))}</span>
        <div><h2>${esc(me.name)}</h2><div class="muted">${esc(me.position || "")}${me.position ? " · " : ""}${esc(me.role_label)} · логин <span class="mono">${esc(me.login)}</span></div></div></div>
      <hr class="sep">
      <div class="stack-sm">
        <h3>Уведомления в Telegram</h3>
        ${
          !me.telegram_available
            ? `<div class="notice">${icon("info")}<div class="small">Бот не подключён на сервере. Чтобы включить, администратор задаёт <span class="mono">TELEGRAM_BOT_TOKEN</span> в настройках.</div></div>`
            : me.telegram_linked
              ? `<div class="notice notice-ok">${icon("telegram")}<div class="small">Telegram подключён. Сюда приходят новые заявки и назначения, а заявку можно взять кнопкой прямо из чата.</div></div>`
              : `<p class="small muted">Подключите Telegram, чтобы получать новые заявки и брать их в работу одной кнопкой.</p>
                 <button class="u-self-start btn btn-primary" id="tg">${icon("telegram")} Подключить Telegram</button>`
        }
      </div>
    </section>`;
  el.querySelector("#tg")?.addEventListener("click", async (e) => {
    setBusy(e.currentTarget, true);
    try {
      const { url } = await api("/api/auth/telegram-link", { method: "POST" });
      window.open(url, "_blank", "noopener");
      toast("Откройте бота и нажмите «Старт»");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(e.currentTarget, false);
    }
  });
}
