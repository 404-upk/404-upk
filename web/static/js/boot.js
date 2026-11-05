// Выполняется до первой отрисовки (обычный скрипт в <head>, CSP запрещает встроенные):
// применяет сохранённую тему и решает, показывать ли интро в этой сессии.
(function () {
  var root = document.documentElement;
  try {
    var theme = JSON.parse(localStorage.getItem("upk-theme"));
    if (theme) root.dataset.theme = theme;
  } catch (e) {
    /* нет хранилища — останется тёмная тема */
  }
  var intro = false;
  try {
    intro = !root.hasAttribute("data-no-intro") && location.pathname.indexOf("/r/") !== 0 && !sessionStorage.getItem("upk-intro") && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    /* без хранилища интро не показываем */
  }
  if (!intro) {
    root.classList.add("is-revealed");
    return;
  }
  root.classList.add("intro-on");
  // страховка: если модуль интро не загрузился, сайт всё равно должен открыться
  setTimeout(function () {
    if (!root.classList.contains("intro-on")) return;
    root.classList.remove("intro-on");
    root.classList.add("is-revealed");
    var el = document.getElementById("intro");
    if (el) el.remove();
  }, 9000);
})();
