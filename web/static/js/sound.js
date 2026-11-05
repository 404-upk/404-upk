// Звук интро и переходов: всё синтезируется прямо в браузере, файлов нет.
// Один «голос» на весь сайт: стеклянные колокольчики в ре-мажорной пентатонике и мягкий поток воздуха.
// Браузеры не дают звуку играть до первого действия человека, поэтому при первом заходе интро может быть беззвучным:
// тогда звук появляется с первым нажатием. Выключатель: кнопка рядом с темой и пункт в меню правой кнопки.

const KEY = "upk-sound";
const MASTER = 0.6;

const N = { D2: 73.42, D3: 146.83, A3: 220, D4: 293.66, D5: 587.33, E5: 659.25, FS5: 739.99, A5: 880, B5: 987.77, D6: 1174.66, E6: 1318.51 };
// у каждого раздела панели своя нота
const SECTION_NOTES = [N.D5, N.E5, N.FS5, N.A5, N.B5, N.D6, N.E6, N.A5, N.D5];

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

// ---------- граф ----------

function makeImpulse(c) {
  // хвост зала: затухающий шум, который со временем становится глуше
  const seconds = 2.4;
  const length = Math.floor(c.sampleRate * seconds);
  const buffer = c.createBuffer(2, length, c.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      const p = i / length;
      low += ((Math.random() * 2 - 1) * (1 - p) ** 3.2 - low) * (0.5 - 0.42 * p);
      data[i] = low;
    }
  }
  return buffer;
}

function makeNoise(c) {
  const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function buildGraph(c) {
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.25;
  const master = c.createGain();
  master.gain.value = MASTER;
  master.connect(limiter);
  limiter.connect(c.destination);
  const conv = c.createConvolver();
  conv.buffer = makeImpulse(c);
  const wet = c.createGain();
  wet.gain.value = 0.7;
  conv.connect(wet);
  wet.connect(master);
  return { c, master, conv, noise: makeNoise(c) };
}

/** Отдельная шина для одного звучания: её можно быстро погасить, хвост зала при этом дозвучит сам */
function makeBus(base) {
  const dry = base.c.createGain();
  const send = base.c.createGain();
  dry.connect(base.master);
  send.connect(base.conv);
  return { ...base, dry, send };
}

function fadeBus(bus) {
  const t = bus.c.currentTime;
  for (const node of [bus.dry, bus.send]) {
    node.gain.cancelScheduledValues(t);
    node.gain.setTargetAtTime(0, t, 0.03);
  }
}

function route(g, node, wetLevel, pan = 0) {
  let tail = node;
  if (pan && g.c.createStereoPanner) {
    const p = g.c.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    tail = p;
  }
  tail.connect(g.dry);
  if (wetLevel > 0) {
    const s = g.c.createGain();
    s.gain.value = wetLevel;
    tail.connect(s);
    s.connect(g.send);
  }
}

// ---------- голоса ----------

/** Стеклянный колокольчик: основной тон и негармоничные обертоны, высокие гаснут быстрее */
function bell(g, t, freq, vel, { decay = 1.4, wet = 0.5, pan = 0 } = {}) {
  const out = g.c.createGain();
  route(g, out, wet, pan);
  for (const [ratio, amp, part] of [[1, 1, 1], [2.001, 0.26, 0.55], [3.012, 0.09, 0.3], [5.21, 0.03, 0.16]]) {
    const osc = g.c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    const env = g.c.createGain();
    const end = t + decay * part;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vel * amp, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env);
    env.connect(out);
    osc.start(t);
    osc.stop(end + 0.02);
  }
}

/** Поток воздуха: шум через полосовой фильтр, частота и панорама плывут */
function whoosh(g, t, dur, peak, { from = 380, mid = 2600, to = 800, panFrom = -0.4, panTo = 0.4, wet = 0.25 } = {}) {
  const src = g.c.createBufferSource();
  src.buffer = g.noise;
  src.loop = true;
  const filter = g.c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(mid, t + dur * 0.55);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const env = g.c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + dur * 0.5);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter);
  filter.connect(env);
  let tail = env;
  if (g.c.createStereoPanner) {
    const p = g.c.createStereoPanner();
    p.pan.setValueAtTime(panFrom, t);
    p.pan.linearRampToValueAtTime(panTo, t + dur);
    env.connect(p);
    tail = p;
  }
  tail.connect(g.dry);
  const s = g.c.createGain();
  s.gain.value = wet;
  tail.connect(s);
  s.connect(g.send);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** Тёплая подложка: треугольные волны с лёгкой расстройкой, фильтр постепенно раскрывается */
function pad(g, t, dur, freqs, peak) {
  const filter = g.c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(420, t);
  filter.frequency.exponentialRampToValueAtTime(1900, t + dur * 0.62);
  filter.frequency.exponentialRampToValueAtTime(700, t + dur);
  const env = g.c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + dur * 0.5);
  env.gain.setValueAtTime(peak, t + dur * 0.68);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  filter.connect(env);
  route(g, env, 0.5);
  for (const f of freqs) {
    for (const cents of [-5, 5]) {
      const osc = g.c.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }
}

/** Мягкий низкий удар под раскрытием знака */
function sub(g, t, vel) {
  const osc = g.c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(N.D2 * 1.6, t);
  osc.frequency.exponentialRampToValueAtTime(N.D2, t + 0.16);
  const env = g.c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vel, t + 0.018);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
  osc.connect(env);
  route(g, env, 0.15);
  osc.start(t);
  osc.stop(t + 0.9);
}

// ---------- партитуры ----------

function bloom(g, t, k = 1) {
  sub(g, t, 0.16 * k);
  bell(g, t, N.D4, 0.07 * k, { decay: 2.8, wet: 0.7 });
  bell(g, t + 0.012, N.D5, 0.13 * k, { decay: 2.6, wet: 0.8, pan: -0.12 });
  bell(g, t + 0.028, N.A5, 0.1 * k, { decay: 2.3, wet: 0.8, pan: 0.14 });
  bell(g, t + 0.05, N.E6, 0.06 * k, { decay: 1.9, wet: 0.9 });
}

function flightScore(g, t, dur) {
  whoosh(g, t, dur * 0.85, 0.04, { from: 2400, mid: 1100, to: 300, panFrom: 0, panTo: -0.4 });
  bell(g, t + dur - 0.02, N.A5, 0.06, { decay: 0.9, wet: 0.6, pan: -0.3 });
  bell(g, t + dur + 0.05, N.D6, 0.04, { decay: 0.8, wet: 0.6, pan: -0.3 });
}

/** Интро по шагам его анимации: зажигаются точки, сеть собирается, знак раскрывается и летит в шапку */
function introScore(g, t0, at) {
  pad(g, t0 + 0.05, at.exit + 0.55, [N.D3, N.A3, N.D4], 0.05);
  const pings = [[0.18, N.A5], [0.34, N.D6], [0.52, N.FS5], [0.7, N.B5], [0.86, N.E6], [1.02, N.A5], [1.2, N.D6], [1.38, N.FS5]];
  pings.forEach(([d, f], i) => bell(g, t0 + d, f, 0.032 + i * 0.003, { decay: 0.7, wet: 0.75, pan: i % 2 ? -0.35 : 0.35 }));
  whoosh(g, t0 + at.gather, at.flare - at.gather + 0.1, 0.055, { from: 260, mid: 3200, to: 1800, panFrom: -0.25, panTo: 0.25 });
  bloom(g, t0 + at.flare);
  flightScore(g, t0 + at.exit, at.flight);
}

function transitionScore(g, t, kind, note) {
  if (kind === "back") {
    whoosh(g, t, 0.42, 0.075, { from: 2200, mid: 900, to: 280, panFrom: 0.4, panTo: -0.4 });
    bell(g, t + 0.1, N.E6, 0.08, { decay: 0.9, wet: 0.65, pan: 0.15 });
    bell(g, t + 0.2, N.A5, 0.098, { decay: 1, wet: 0.65, pan: -0.1 });
  } else if (kind === "section") {
    whoosh(g, t, 0.28, 0.03, { from: 900, mid: 2400, to: 1200, panFrom: -0.2, panTo: 0.2 });
    bell(g, t + 0.02, note || N.A5, 0.09, { decay: 0.7, wet: 0.55 });
  } else if (kind === "tick") {
    bell(g, t, N.A5, 0.09, { decay: 0.6, wet: 0.5 });
  } else {
    whoosh(g, t, 0.5, 0.085, { from: 380, mid: 2600, to: 800, panFrom: -0.4, panTo: 0.4 });
    bell(g, t + 0.14, N.A5, 0.105, { decay: 0.95, wet: 0.65, pan: -0.1 });
    bell(g, t + 0.24, N.E6, 0.08, { decay: 0.95, wet: 0.7, pan: 0.15 });
  }
}

// ---------- воспроизведение ----------

let base = null;

function context() {
  if (base) return base.c;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  base = buildGraph(new Ctx({ latencyHint: "interactive" }));
  return base.c;
}

/** Контекст, если браузер разрешает звук прямо сейчас. Без действия человека resume может не завершиться никогда */
async function running() {
  const c = context();
  if (!c) return null;
  if (c.state !== "running") {
    try {
      await Promise.race([c.resume(), new Promise((resolve) => setTimeout(resolve, 200))]);
    } catch {
      return null;
    }
  }
  return c.state === "running" ? c : null;
}

async function play(kind, note) {
  if (!soundOn()) return;
  const c = await running();
  if (c) transitionScore(makeBus(base), c.currentTime + 0.01, kind, note);
}

export const playSection = (index) => play("section", SECTION_NOTES[index % SECTION_NOTES.length]);

/**
 * Звук интро. at — моменты анимации в секундах: gather, flare, exit, flight.
 * Пропустили интро или браузер разрешил звук только по нажатию: звучит сразу финал.
 */
export function introSound(at) {
  if (!soundOn()) return { exit() {} };
  let ended = false;
  let started = null;
  running().then((c) => {
    if (!c || ended) return;
    const bus = makeBus(base);
    const t0 = c.currentTime + 0.02;
    introScore(bus, t0, at);
    started = { c, bus, t0 };
  });
  return {
    exit(flight) {
      ended = true;
      if (started && started.c.currentTime - started.t0 >= at.exit - 0.15) return;
      if (started) fadeBus(started.bus);
      running().then((c) => {
        if (!c) return;
        const bus = makeBus(base);
        const t = c.currentTime + 0.02;
        bloom(bus, t, 0.7);
        flightScore(bus, t + 0.05, flight);
      });
    },
  };
}

export function setSound(on) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* без хранилища настройка не запомнится */
  }
  window.dispatchEvent(new CustomEvent("upk:sound", { detail: { on } }));
  if (on) play("tick");
  else if (base) base.master.gain.setTargetAtTime(0, base.c.currentTime, 0.04);
  if (on && base) base.master.gain.setTargetAtTime(MASTER, base.c.currentTime, 0.01);
}

/** Для проверки: отрисовывает звук без динамиков и возвращает пик, среднюю громкость и огибающую по четверти секунды */
export async function measureSound(kind) {
  const seconds = kind === "intro" ? 8 : 3;
  const rate = 44100;
  const c = new OfflineAudioContext(2, rate * seconds, rate);
  const bus = makeBus(buildGraph(c));
  if (kind === "intro") introScore(bus, 0.02, { gather: 1.56, flare: 2.9, exit: 3.82, flight: 1.12 });
  else transitionScore(bus, 0.01, kind, N.D5);
  const rendered = await c.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  let peak = 0;
  let sum = 0;
  const step = Math.floor(rate / 4);
  const envelope = [];
  let chunk = 0;
  for (let i = 0; i < left.length; i += 1) {
    const v = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    peak = Math.max(peak, v);
    sum += v * v;
    chunk += v * v;
    if ((i + 1) % step === 0) {
      envelope.push(Number(Math.sqrt(chunk / step).toFixed(4)));
      chunk = 0;
    }
  }
  return { peak: Number(peak.toFixed(4)), rms: Number(Math.sqrt(sum / left.length).toFixed(4)), envelope };
}

if (matchMedia("(hover: hover)").matches || "ontouchstart" in window) {
  // первое действие человека разрешает звук на этой странице
  const unlock = () => {
    if (soundOn()) context()?.resume().catch(() => {});
  };
  document.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  document.addEventListener("keydown", unlock, { capture: true, passive: true });
}

// пришли со страницы сайта: переход уже идёт, звук ему в такт
if (document.documentElement.dataset.nav) play(document.documentElement.dataset.nav === "back" ? "back" : "forward");
