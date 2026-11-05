// Переход между страницами: новая страница раскрывается знаком 404 из точки клика, старая отступает вглубь и темнеет.
// Назад по истории наоборот: прежняя страница сворачивается в знак. Работает там, где есть View Transitions между
// документами (Chrome, Edge, Яндекс Браузер, Safari 18.2+), в остальных браузерах страница просто открывается.
// Обычный скрипт в <head>, как boot.js: событие pagereveal приходит до первой отрисовки, модули к нему не успевают.
(function () {
  var html = document.documentElement;
  var SPARK = "M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z";
  var unit = null;

  /** Отрезки кривых знака переводятся в многоугольник для clip-path */
  function unitShape() {
    if (unit) return unit;
    var n = SPARK.match(/-?\d*\.?\d+/g).map(Number);
    var px = n[0];
    var py = n[1];
    unit = [];
    for (var i = 2; i + 5 < n.length; i += 6) {
      for (var k = 0; k < 8; k++) {
        var t = k / 8;
        var u = 1 - t;
        var bx = u * u * u * px + 3 * u * u * t * n[i] + 3 * u * t * t * n[i + 2] + t * t * t * n[i + 4];
        var by = u * u * u * py + 3 * u * u * t * n[i + 1] + 3 * u * t * t * n[i + 3] + t * t * t * n[i + 5];
        unit.push([(bx - 12) / 12, (by - 12) / 12]);
      }
      px = n[i + 4];
      py = n[i + 5];
    }
    return unit;
  }

  /** Кадры: знак растёт из точки и поворачивается, пока не закроет область радиусом radius */
  window.upkSparkFrames = function (cx, cy, radius, steps) {
    var shape = unitShape();
    var count = steps || 18;
    // насколько знак уже круга: во столько раз он должен вырасти, чтобы закрыть всю область
    var inner = Math.min.apply(
      null,
      shape.map(function (p) {
        return Math.hypot(p[0], p[1]);
      }),
    );
    var full = (radius / inner) * 1.15;
    var frames = [];
    for (var f = 0; f <= count; f++) {
      var progress = f / count;
      var size = full * progress;
      var turn = (-50 + 50 * progress) * (Math.PI / 180);
      var cos = Math.cos(turn);
      var sin = Math.sin(turn);
      var points = shape.map(function (p) {
        return (cx + (p[0] * cos - p[1] * sin) * size).toFixed(1) + "px " + (cy + (p[0] * sin + p[1] * cos) * size).toFixed(1) + "px";
      });
      frames.push("polygon(" + points.join(",") + ")");
    }
    return frames;
  };

  // откуда раскрывать следующую страницу: точка клика по ссылке
  document.addEventListener(
    "click",
    function (e) {
      if (!e.target.closest || !e.target.closest("a[href], a[data-href]")) return;
      try {
        sessionStorage.setItem("upk-nav", JSON.stringify({ x: e.clientX, y: e.clientY, t: Date.now() }));
      } catch (err) {
        /* без хранилища страница раскроется из центра */
      }
    },
    true,
  );

  function clickPoint() {
    var center = { x: innerWidth / 2, y: innerHeight / 2 };
    try {
      var saved = JSON.parse(sessionStorage.getItem("upk-nav"));
      sessionStorage.removeItem("upk-nav");
      // старая отметка от ссылки, которая открылась в другой вкладке, не считается
      if (saved && Date.now() - saved.t < 4000) return { x: Math.min(saved.x, innerWidth), y: Math.min(saved.y, innerHeight) };
    } catch (err) {
      /* откроем из центра */
    }
    return center;
  }

  window.addEventListener("pagereveal", function (e) {
    var transition = e.viewTransition;
    if (!transition) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || html.classList.contains("intro-on")) {
      transition.skipTransition();
      return;
    }
    var activation = window.navigation && navigation.activation;
    var back = Boolean(activation && activation.navigationType === "traverse" && activation.from && activation.entry && activation.from.index > activation.entry.index);
    var point = clickPoint();
    html.dataset.nav = back ? "back" : "forward";
    if (back) html.classList.add("vt-collapse");

    transition.ready
      .then(function () {
        var radius = Math.hypot(Math.max(point.x, innerWidth - point.x), Math.max(point.y, innerHeight - point.y));
        var frames = window.upkSparkFrames(point.x, point.y, radius);
        var sink = { transform: ["scale(1)", "scale(0.93)"], filter: ["brightness(1)", "brightness(0.5)"] };
        var flash = { filter: ["brightness(1.5)", "brightness(1)"] };
        if (back) {
          html.animate({ clipPath: frames.reverse() }, { duration: 620, easing: "cubic-bezier(0.55, 0, 0.8, 0.2)", pseudoElement: "::view-transition-old(root)", fill: "forwards" });
          html.animate({ transform: ["scale(0.95)", "scale(1)"], filter: ["brightness(0.6)", "brightness(1)"] }, { duration: 620, easing: "ease-out", pseudoElement: "::view-transition-new(root)", fill: "both" });
        } else {
          html.animate({ clipPath: frames }, { duration: 760, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" });
          html.animate(flash, { duration: 760, easing: "ease-out", pseudoElement: "::view-transition-new(root)" });
          html.animate(sink, { duration: 760, easing: "cubic-bezier(0.4, 0, 0.6, 1)", pseudoElement: "::view-transition-old(root)", fill: "forwards" });
        }
        // волна по живому фону
        setTimeout(function () {
          window.dispatchEvent(new CustomEvent("upk:theme", { detail: { x: point.x, y: point.y, strength: back ? 0.7 : 1.1 } }));
        }, 160);
      })
      .catch(function () {
        /* переход пропущен: страница уже на месте */
      });
    transition.finished
      .catch(function () {})
      .then(function () {
        html.classList.remove("vt-collapse");
      });
  });
})();
