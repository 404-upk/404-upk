// Звук интро и переходов: звёздный, всё синтезируется прямо в браузере, файлов нет.
// Голоса: мерцающие звёзды (высокие чистые тоны с дрожащей громкостью), россыпи звёздной пыли,
// свист кометы (высокий шум) и глубокая туманность внизу. Всё уходит в длинное космическое эхо.
// Браузеры не дают звуку играть до первого действия человека, поэтому при первом заходе интро может быть беззвучным:
// тогда звук появляется с первым нажатием. Выключатель: кнопка рядом с темой и пункт в меню правой кнопки.

const KEY = "upk-sound";
const MASTER = 0.6;

const N = {
  D2: 73.42, D3: 146.83, A3: 220, D4: 293.66, A4: 440, E5: 659.25,
  A5: 880, B5: 987.77, D6: 1174.66, E6: 1318.51, FS6: 1479.98, A6: 1760, B6: 1975.53, D7: 2349.32, E7: 2637.02,
};
// звёздный ряд: ре-мажорная пентатоника в верхних октавах
const STARS = [N.A5, N.B5, N.D6, N.E6, N.FS6, N.A6, N.B6, N.D7, N.E7];
// у каждого раздела панели своя звезда
const SECTION_NOTES = [N.D6, N.E6, N.FS6, N.A6, N.B6, N.D7, N.E7, N.A6, N.D6];

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

/** Случайность с зерном: у измерений всегда один результат, в работе россыпь каждый раз новая */
function randomFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- граф ----------

function makeImpulse(c) {
  // космос: длинный светлый хвост с небольшой задержкой в начале
  const seconds = 3.8;
  const predelay = Math.floor(c.sampleRate * 0.03);
  const length = Math.floor(c.sampleRate * seconds);
  const buffer = c.createBuffer(2, length, c.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = predelay; i < length; i += 1) {
      const p = (i - predelay) / (length - predelay);
      low += ((Math.random() * 2 - 1) * (1 - p) ** 2.6 - low) * (0.8 - 0.55 * p);
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

/** Эхо, которое перекидывается между левым и правым каналом и постепенно гаснет */
function makeEcho(c, into) {
  const input = c.createGain();
  input.gain.value = 0.5;
  const left = c.createDelay(1);
  left.delayTime.value = 0.27;
  const right = c.createDelay(1);
  right.delayTime.value = 0.41;
  const tone = c.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 6500;
  const feedback = c.createGain();
  feedback.gain.value = 0.36;
  const merge = c.createChannelMerger(2);
  const level = c.createGain();
  level.gain.value = 0.34;
  input.connect(left);
  left.connect(tone);
  tone.connect(right);
  right.connect(feedback);
  feedback.connect(left);
  left.connect(merge, 0, 0);
  right.connect(merge, 0, 1);
  merge.connect(level);
  level.connect(into);
  return input;
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
  wet.gain.value = 0.85;
  conv.connect(wet);
  wet.connect(master);
  return { c, master, conv, echo: makeEcho(c, master), noise: makeNoise(c) };
}

/** Отдельная шина для одного звучания: её можно быстро погасить, хвост космоса при этом дозвучит сам */
function makeBus(base, seed = Math.floor(Math.random() * 1e9)) {
  const dry = base.c.createGain();
  const send = base.c.createGain();
  dry.connect(base.master);
  send.connect(base.conv);
  send.connect(base.echo);
  return { ...base, dry, send, random: randomFrom(seed) };
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

/** Звезда: чистый высокий тон с негармоничными обертонами, громкость дрожит, как свет звезды */
function twinkle(g, t, freq, vel, { decay = 1.2, wet = 0.8, pan = 0, flicker = 9 } = {}) {
  const end = t + decay;
  const out = g.c.createGain();
  const shimmer = g.c.createGain();
  shimmer.connect(out);
  route(g, out, wet, pan);
  const lfo = g.c.createOscillator();
  lfo.frequency.value = flicker;
  const depth = g.c.createGain();
  depth.gain.value = 0.3;
  lfo.connect(depth);
  depth.connect(shimmer.gain);
  lfo.start(t);
  lfo.stop(end + 0.02);
  for (const [ratio, amp, part] of [[1, 1, 1], [2.76, 0.2, 0.45], [5.4, 0.06, 0.22]]) {
    const osc = g.c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    const env = g.c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vel * amp, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay * part);
    osc.connect(env);
    env.connect(shimmer);
    osc.start(t);
    osc.stop(t + decay * part + 0.02);
  }
}

/** Одна пылинка: короткий высокий тон без обертонов */
function grain(g, t, freq, vel, decay, pan) {
  const osc = g.c.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const env = g.c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vel, t + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(env);
  route(g, env, 0.9, pan);
  osc.start(t);
  osc.stop(t + decay + 0.02);
}

/**
 * Россыпь звёздной пыли за dur секунд. direction 1 — вверх по звёздному ряду, -1 — вниз.
 * rush больше 1: пылинки сыплются всё чаще к концу, меньше 1: всё реже.
 */
function dust(g, t, dur, count, { direction = 1, vel = 0.016, rush = 1, spread = 0.9, top = 2 } = {}) {
  for (let i = 0; i < count; i += 1) {
    const p = i / Math.max(1, count - 1);
    const at = t + dur * p ** (1 / rush) + g.random() * 0.012;
    const line = direction > 0 ? p : 1 - p;
    const index = Math.min(STARS.length - 1, Math.floor(line * STARS.length * 0.999));
    const octave = g.random() < 0.3 ? top : 1;
    const fade = direction > 0 ? 0.6 + 0.4 * p : 1 - 0.55 * p;
    grain(g, at, STARS[index] * octave, vel * fade * (0.6 + g.random() * 0.4), 0.22 + g.random() * 0.34, (g.random() * 2 - 1) * spread);
  }
}

/** Комета: высокий шум, частота и панорама плывут */
function comet(g, t, dur, peak, { from = 1400, mid = 8200, to = 3600, panFrom = -0.5, panTo = 0.5, wet = 0.5 } = {}) {
  const src = g.c.createBufferSource();
  src.buffer = g.noise;
  src.loop = true;
  const filter = g.c.createBiquadFilter();
  filter.type = "highpass";
  filter.Q.value = 0.8;
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

/** Туманность: глубокий фон из чистых тонов, которые медленно биются друг о друга */
function nebula(g, t, dur, peak) {
  const env = g.c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + dur * 0.5);
  env.gain.setValueAtTime(peak, t + dur * 0.66);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  route(g, env, 0.8);
  for (const [freq, level] of [[N.D3, 0.55], [N.A3, 0.8], [N.D4, 1], [N.A4, 0.7], [N.E5, 0.4]]) {
    for (const cents of [-6, 6]) {
      const osc = g.c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.detune.value = cents;
      const part = g.c.createGain();
      part.gain.value = level / 2;
      osc.connect(part);
      part.connect(env);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }
}

/** Мягкий низкий толчок, как далёкая вспышка */
function pulse(g, t, vel) {
  const osc = g.c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(N.D2 * 1.5, t);
  osc.frequency.exponentialRampToValueAtTime(N.D2, t + 0.2);
  const env = g.c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vel, t + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 1);
  osc.connect(env);
  route(g, env, 0.2);
  osc.start(t);
  osc.stop(t + 1.05);
}

// ---------- партитуры ----------

/** Вспышка: аккорд из звёзд и звёздный дождь, который осыпается вниз */
function supernova(g, t, k = 1) {
  pulse(g, t, 0.09 * k);
  twinkle(g, t, N.A5, 0.085 * k, { decay: 3, wet: 0.95, pan: -0.15, flicker: 5 });
  twinkle(g, t + 0.016, N.D6, 0.08 * k, { decay: 3, wet: 0.95, pan: 0.15, flicker: 6.5 });
  twinkle(g, t + 0.034, N.A6, 0.06 * k, { decay: 2.6, wet: 1, pan: -0.3, flicker: 8 });
  twinkle(g, t + 0.056, N.E7, 0.035 * k, { decay: 2.2, wet: 1, pan: 0.35, flicker: 10 });
  dust(g, t + 0.08, 1.7, Math.round(30 * k), { direction: -1, vel: 0.022 * k, rush: 0.7 });
}

/** Знак летит в шапку: хвост кометы и касание на посадке */
function flightScore(g, t, dur) {
  comet(g, t, dur * 0.9, 0.02, { from: 7000, mid: 2600, to: 1000, panFrom: 0, panTo: -0.5 });
  dust(g, t + 0.05, dur * 0.8, 12, { direction: -1, vel: 0.012, spread: 0.6 });
  twinkle(g, t + dur - 0.02, N.A6, 0.05, { decay: 1, wet: 0.9, pan: -0.35 });
  twinkle(g, t + dur + 0.05, N.D7, 0.034, { decay: 0.9, wet: 0.95, pan: -0.35 });
}

/** Интро по шагам его анимации: зажигаются точки, сеть собирается, знак вспыхивает и летит в шапку */
function introScore(g, t0, at) {
  nebula(g, t0 + 0.05, at.exit + 1.2, 0.03);
  // пятнадцать точек сети: каждая зажигается своей звездой
  for (let i = 0; i < 15; i += 1) {
    const star = STARS[Math.floor(g.random() * STARS.length)];
    const when = 0.12 + (i / 14) * 1.33 + g.random() * 0.04;
    twinkle(g, t0 + when, star, 0.018 + i * 0.0012, { decay: 0.95, wet: 0.95, pan: (g.random() * 2 - 1) * 0.8, flicker: 7 + g.random() * 6 });
  }
  // сеть закручивается к центру: пыль бежит вверх всё быстрее
  const rise = at.flare - at.gather;
  comet(g, t0 + at.gather, rise + 0.15, 0.026, { from: 1500, mid: 9000, to: 6000, panFrom: -0.3, panTo: 0.3 });
  dust(g, t0 + at.gather, rise, 30, { direction: 1, vel: 0.02, rush: 1.9 });
  supernova(g, t0 + at.flare);
  flightScore(g, t0 + at.exit, at.flight);
}

function arpeggio(g, t, notes, from, to) {
  notes.forEach((note, i) => {
    const p = i / (notes.length - 1);
    twinkle(g, t + i * 0.045 + p * 0.02, note, from + (to - from) * p, { decay: 0.7 + p * 0.5, wet: 0.9, pan: (p - 0.5) * 0.7 });
  });
}

function transitionScore(g, t, kind, note) {
  if (kind === "back") {
    comet(g, t, 0.42, 0.024, { from: 7600, mid: 3000, to: 1100, panFrom: 0.5, panTo: -0.5 });
    arpeggio(g, t + 0.05, [N.D7, N.A6, N.E6, N.D6, N.A5], 0.04, 0.062);
    dust(g, t + 0.1, 0.4, 7, { direction: -1, vel: 0.012 });
  } else if (kind === "section") {
    comet(g, t, 0.26, 0.012, { from: 3000, mid: 8000, to: 5000, panFrom: -0.25, panTo: 0.25 });
    twinkle(g, t + 0.02, note || N.A6, 0.07, { decay: 0.85, wet: 0.85 });
    dust(g, t + 0.05, 0.2, 3, { direction: 1, vel: 0.012, spread: 0.5 });
  } else if (kind === "tick") {
    twinkle(g, t, N.A6, 0.065, { decay: 0.7, wet: 0.8 });
  } else {
    comet(g, t, 0.46, 0.026);
    arpeggio(g, t + 0.06, [N.A5, N.D6, N.E6, N.A6, N.D7], 0.04, 0.064);
    dust(g, t + 0.14, 0.42, 8, { direction: 1, vel: 0.012 });
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
        supernova(bus, t, 0.7);
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

/** Отрисовывает звук без динамиков: для проверок и прослушивания вне сайта */
export function renderSound(kind, seed = 7) {
  const seconds = kind === "intro" ? 10 : 4;
  const rate = 44100;
  const c = new OfflineAudioContext(2, rate * seconds, rate);
  const bus = makeBus(buildGraph(c), seed);
  if (kind === "intro") introScore(bus, 0.02, { gather: 1.56, flare: 2.9, exit: 3.82, flight: 1.12 });
  else transitionScore(bus, 0.01, kind, N.A6);
  return c.startRendering();
}

/** Пик, средняя громкость, огибающая по четверти секунды и примерная высота звучания */
export async function measureSound(kind) {
  const rendered = await renderSound(kind);
  const rate = rendered.sampleRate;
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  let peak = 0;
  let sum = 0;
  let chunk = 0;
  let crossings = 0;
  let active = 0;
  const step = Math.floor(rate / 4);
  const envelope = [];
  for (let i = 0; i < left.length; i += 1) {
    const v = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    peak = Math.max(peak, v);
    sum += v * v;
    chunk += v * v;
    if (v > 0.002) {
      active += 1;
      if (i && left[i] > 0 !== left[i - 1] > 0) crossings += 1;
    }
    if ((i + 1) % step === 0) {
      envelope.push(Number(Math.sqrt(chunk / step).toFixed(4)));
      chunk = 0;
    }
  }
  return {
    peak: Number(peak.toFixed(4)),
    rms: Number(Math.sqrt(sum / left.length).toFixed(4)),
    pitchHz: active ? Math.round((crossings / 2) * (rate / active)) : 0,
    envelope,
  };
}

// первое действие человека разрешает звук на этой странице
const unlock = () => {
  if (soundOn()) context()?.resume().catch(() => {});
};
document.addEventListener("pointerdown", unlock, { capture: true, passive: true });
document.addEventListener("keydown", unlock, { capture: true, passive: true });

// пришли со страницы сайта: переход уже идёт, звук ему в такт
if (document.documentElement.dataset.nav) play(document.documentElement.dataset.nav === "back" ? "back" : "forward");
