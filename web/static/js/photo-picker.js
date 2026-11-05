// Своё окно для фото к заявке. Раньше кнопка «Фото» сразу открывала системное окно выбора файла.
// Теперь сначала открывается окно в стиле сайта: снять камерой прямо на странице, перетащить файл,
// вставить скриншот из буфера. Системное окно остаётся только за кнопкой «Выбрать файл»:
// заглянуть в папки компьютера сайт сам не может, это умеет только браузер своим окном.
// Любое выбранное фото сначала показывается здесь крупно, и только после «Прикрепить» уходит в заявку.
// Загружается заранее, пока человек пишет сообщение (warm), на старте страницы не нужно.

import { chooseFileNative, esc, icon, loadCss, openModal, preparePhoto } from "./core.js";
import { SPARK_PATH } from "./cursor.js";

const COARSE = matchMedia("(pointer: coarse)");
const SPARK = `<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="${SPARK_PATH}"/></svg>`;

/** Камера есть и браузер даст её странице: нужен https (или localhost) и хотя бы одна камера */
async function cameraCount() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 0;
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === "videoinput").length;
  } catch {
    return 1; // список не отдали: попробуем включить при нажатии
  }
}

/** Картинка из буфера обмена по кнопке «Вставить»: браузер один раз спросит разрешение */
async function clipboardImage() {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return new File([await item.getType(type)], `screenshot.${type.split("/")[1] || "png"}`, { type });
  }
  return null;
}

const isImage = (f) => !!f && (f.type?.startsWith("image/") || /\.(heic|heif)$/i.test(f.name || ""));
const firstImage = (files) => [...(files || [])].find(isImage) || null;

/** Стили окна заранее: при нажатии на «Фото» окно откроется сразу */
export function warm() {
  loadCss("/static/css/photo-picker.css");
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Открывает окно выбора фото. onFile(file) вызывается, когда человек выбрал, снял или вставил фото;
 * окно при этом закрывается. maxMb — предел размера, как на сервере.
 */
export async function pickPhoto({ onFile, maxMb = 8 } = {}) {
  await loadCss("/static/css/photo-picker.css");
  const cameras = await cameraCount();
  const phone = COARSE.matches;
  const canPaste = !phone && !!navigator.clipboard?.read;
  let stream = null;
  let shot = null;
  let shotUrl = "";
  let shotFrom = "camera";
  let facing = "environment";

  const body = `
    <div class="pp">
      <div class="pp-stage" data-mode="drop">
        <div class="pp-drop">
          <span class="pp-mark">${SPARK}</span>
          <b class="pp-title">${phone ? "Сфотографируйте, что случилось" : "Перетащите фото сюда"}</b>
          <span class="pp-sub">${
            phone ? "или выберите готовый снимок в галерее" : "или вставьте скриншот: <kbd>Ctrl</kbd> + <kbd>V</kbd>"
          }</span>
          <span class="pp-over-text" aria-hidden="true">Отпустите, чтобы прикрепить</span>
        </div>
        <video class="pp-video" autoplay playsinline muted disablepictureinpicture></video>
        <span class="pp-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <img class="pp-shot" alt="Выбранное фото">
        <span class="pp-flash" aria-hidden="true"></span>
        <div class="pp-note" role="status" aria-live="polite"></div>
      </div>
      <div class="pp-actions" data-for="drop">
        ${cameras ? `<button type="button" class="btn btn-primary pp-cam">${icon("camera")}<span>Снять камерой</span></button>` : ""}
        <label class="btn ${cameras ? "" : "btn-primary"} file-btn pp-file">${icon("image")}<span>${phone ? "Из галереи" : "Выбрать файл"}</span>
          <input type="file" accept="image/*" class="pp-input" aria-label="${phone ? "Выбрать фото из галереи" : "Выбрать файл с фото"}"></label>
        ${canPaste ? `<button type="button" class="btn btn-ghost pp-paste">${icon("clipboard")}<span>Вставить</span></button>` : ""}
      </div>
      <div class="pp-actions pp-cam-bar" data-for="camera" hidden>
        <button type="button" class="btn btn-ghost pp-back">${icon("arrowLeft")}<span>Назад</span></button>
        <button type="button" class="pp-shutter" aria-label="Сделать снимок"><i></i></button>
        <button type="button" class="btn btn-ghost btn-icon pp-flip${cameras > 1 ? "" : " is-off"}" aria-label="Другая камера"${cameras > 1 ? "" : ' tabindex="-1" aria-hidden="true"'}>${icon("refresh")}</button>
      </div>
      ${phone ? `<button type="button" class="pp-native" data-for="camera" hidden>${icon("camera", "icon-sm")}Не видно картинку? Открыть камеру телефона</button>` : ""}
      <div class="pp-actions" data-for="shot" hidden>
        <button type="button" class="btn pp-retake">${icon("refresh")}<span>Переснять</span></button>
        <button type="button" class="btn btn-primary pp-use">${icon("check")}<span>Прикрепить</span></button>
      </div>
      <p class="pp-hint">Фото до ${esc(String(maxMb))} МБ. По нему быстрее понять, что сломалось и что взять с собой.</p>
    </div>`;

  const { el } = openModal({
    title: "Фото к заявке",
    body,
    onMount(overlay, close) {
      overlay.querySelector(".modal").classList.add("pp-modal");
      const root = overlay.querySelector(".pp");
      const stage = root.querySelector(".pp-stage");
      const video = root.querySelector(".pp-video");
      const img = root.querySelector(".pp-shot");
      const note = root.querySelector(".pp-note");
      const input = root.querySelector(".pp-input");

      const say = (text, error = false) => {
        note.textContent = text;
        note.classList.toggle("is-error", error);
        note.classList.toggle("is-on", !!text);
      };
      const setMode = (mode) => {
        stage.dataset.mode = mode;
        // видео и снимок: без стекла и сдвига у листа, иначе Safari на iPhone может не рисовать видео с камеры
        overlay.classList.toggle("is-media", mode !== "drop");
        root.querySelectorAll("[data-for]").forEach((bar) => (bar.hidden = bar.dataset.for !== mode));
        root.querySelector(`[data-for="${mode}"] .btn-primary, [data-for="${mode}"] .pp-shutter`)?.focus({ preventScroll: true });
      };
      const stopCamera = () => {
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
        video.srcObject = null;
      };
      const forgetShot = () => {
        if (shotUrl) URL.revokeObjectURL(shotUrl);
        shot = null;
        shotUrl = "";
        img.removeAttribute("src");
      };

      /** Готово: фото уходит в заявку, окно закрывается */
      const done = (file) => {
        if (!file) return;
        close();
        onFile?.(file);
      };

      /**
       * Предпросмотр: любое фото (с камеры, из галереи, из буфера) сначала показывается крупно.
       * Большой снимок с телефона тут же уменьшается и переводится в JPEG.
       */
      let previewSeq = 0;
      async function preview(file, from) {
        if (!isImage(file)) return say("Это не фото. Подойдёт снимок или скриншот: JPG, PNG, HEIC.", true);
        const mine = ++previewSeq;
        say("Готовим фото…");
        const ready = await preparePhoto(file);
        if (mine !== previewSeq || !overlay.isConnected) return;
        if (ready.size > maxMb * 1024 * 1024) return say(`Фото больше ${maxMb} МБ. Выберите другое или снимите камерой.`, true);
        forgetShot();
        shot = ready;
        shotFrom = from;
        shotUrl = URL.createObjectURL(ready);
        img.onerror = () => say("Предпросмотр в этом браузере недоступен, но фото прикрепится к заявке.");
        img.src = shotUrl;
        root.querySelector(".pp-retake span").textContent = from === "camera" ? "Переснять" : "Другое фото";
        say("");
        setMode("shot");
      }

      async function startCamera() {
        forgetShot();
        setMode("camera");
        say("Включаем камеру…");
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
        } catch (err) {
          stopCamera();
          setMode("drop");
          const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
          say(
            denied
              ? "Браузер не дал доступ к камере. Разрешите его у адресной строки или выберите готовое фото."
              : "Камера не включилась: возможно, она занята другой программой. Выберите готовое фото.",
            true,
          );
          return;
        }
        // окно закрыли, пока браузер спрашивал разрешение
        if (!overlay.isConnected) return stopCamera();
        // Safari на iPhone показывает видео с камеры только так: без звука, внутри страницы, с автозапуском
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.srcObject = stream;
        const mode = stream.getVideoTracks()[0]?.getSettings().facingMode;
        // фронтальная камера и камера ноутбука показываются зеркально, как в зеркале
        video.classList.toggle("is-mirror", (mode || (phone ? facing : "user")) === "user");
        if (video.readyState < 1) await new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true }));
        await video.play().catch(() => {});
        say("");
        // после разрешения браузер показывает все камеры: появляется кнопка смены
        if (navigator.mediaDevices.enumerateDevices) {
          const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
          const flip = root.querySelector(".pp-flip");
          if (list.filter((d) => d.kind === "videoinput").length > 1 && flip.classList.contains("is-off")) {
            flip.classList.remove("is-off");
            flip.removeAttribute("tabindex");
            flip.removeAttribute("aria-hidden");
          }
        }
        // картинки так и нет: ещё раз запускаем видео, потом предлагаем камеру телефона
        setTimeout(async () => {
          if (stage.dataset.mode !== "camera" || !stream) return;
          if (video.paused || !video.videoWidth) await video.play().catch(() => {});
          if (video.paused || !video.videoWidth) {
            say("Камера включилась, но картинки нет. Нажмите «Открыть камеру телефона» ниже или выберите готовое фото.", true);
          }
        }, 2500);
      }

      function capture() {
        const w = video.videoWidth;
        const hgt = video.videoHeight;
        if (!w || !hgt) return say("Камера ещё не показывает картинку. Подождите секунду или откройте камеру телефона.", true);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = hgt;
        canvas.getContext("2d").drawImage(video, 0, 0, w, hgt);
        stage.classList.remove("is-flash");
        void stage.offsetWidth;
        stage.classList.add("is-flash");
        canvas.toBlob(
          (blob) => {
            if (!blob) return say("Снимок не получился, попробуйте ещё раз.", true);
            stopCamera();
            preview(new File([blob], `photo-${stamp()}.jpg`, { type: "image/jpeg" }), "camera");
          },
          "image/jpeg",
          0.9,
        );
      }

      root.querySelector(".pp-cam")?.addEventListener("click", startCamera);
      // на телефоне перетаскивать нечего: нажатие на большое поле сразу включает камеру
      if (phone) {
        const drop = root.querySelector(".pp-drop");
        drop.classList.add("is-tap");
        drop.addEventListener("click", () => (cameras ? startCamera() : input.click()));
      }
      root.querySelector(".pp-retake").addEventListener("click", () => {
        if (shotFrom === "camera") return startCamera();
        forgetShot();
        say("");
        setMode("drop");
      });
      root.querySelector(".pp-shutter").addEventListener("click", capture);
      root.querySelector(".pp-back").addEventListener("click", () => {
        stopCamera();
        say("");
        setMode("drop");
      });
      root.querySelector(".pp-flip").addEventListener("click", () => {
        facing = facing === "environment" ? "user" : "environment";
        stopCamera();
        startCamera();
      });
      root.querySelector(".pp-use").addEventListener("click", () => done(shot));
      // запасной путь на телефоне: системная камера, снимок всё равно показывается здесь крупно
      root.querySelector(".pp-native")?.addEventListener("click", () => {
        stopCamera();
        say("");
        setMode("drop");
        chooseFileNative((file) => preview(file, "file"), { capture: "environment" });
      });
      // системное окно выбора файла открывается только прямым нажатием на «Выбрать файл» / «Из галереи»:
      // поле лежит внутри кнопки, так iOS Safari надёжно открывает своё меню и сообщает о выбранном фото
      input.addEventListener("click", () => say(""));
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        input.value = "";
        if (file) preview(file, "file");
      });
      root.querySelector(".pp-paste")?.addEventListener("click", async () => {
        try {
          const file = await clipboardImage();
          if (file) preview(file, "file");
          else say("В буфере обмена нет картинки. Сделайте скриншот (Win + Shift + S) и нажмите ещё раз.", true);
        } catch {
          say("Браузер не дал прочитать буфер обмена. Нажмите Ctrl + V прямо в этом окне.", true);
        }
      });

      // перетаскивание файла в окно
      let depth = 0;
      const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
      overlay.addEventListener("dragenter", (e) => {
        if (!hasFiles(e) || stage.dataset.mode === "camera") return;
        e.preventDefault();
        depth += 1;
        stage.classList.add("is-over");
      });
      overlay.addEventListener("dragover", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = stage.dataset.mode === "camera" ? "none" : "copy";
      });
      overlay.addEventListener("dragleave", () => {
        depth = Math.max(0, depth - 1);
        if (!depth) stage.classList.remove("is-over");
      });
      overlay.addEventListener("drop", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        stage.classList.remove("is-over");
        if (stage.dataset.mode === "camera") return;
        const file = firstImage(e.dataTransfer.files);
        if (file) preview(file, "file");
        else say("Перетащите картинку: снимок или скриншот.", true);
      });

      // Ctrl + V в окне: скриншот из буфера обмена
      const onPaste = (e) => {
        const file = firstImage(e.clipboardData?.files);
        if (!file) return;
        e.preventDefault();
        preview(file, "file");
      };
      document.addEventListener("paste", onPaste);

      // окно закрыто любым способом: камера выключается, обработчики снимаются
      const watch = new MutationObserver(() => {
        if (overlay.isConnected) return;
        watch.disconnect();
        stopCamera();
        forgetShot();
        document.removeEventListener("paste", onPaste);
      });
      watch.observe(document.body, { childList: true });

      // камера не включается сама: браузер спросит разрешение, только когда человек нажмёт «Снять камерой»
      setMode("drop");
    },
  });
  // общее окно ставит фокус на первое поле, а здесь это скрытое поле файла: фокус на главную кнопку
  el.querySelector('[data-for="drop"] .btn-primary:not(label)')?.focus({ preventScroll: true });
}
