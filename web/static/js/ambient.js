// Живой фон: переливающееся свечение (WebGL) и поле точек (canvas).
// Точки дрейфуют по потоку без стоков и держат дистанцию, поэтому не сбиваются в кучи.
// Они расступаются у курсора и соединяются линиями, изредка фон прорезает росчерк.
// Клики и важные события расходятся по фону волной. На слабых устройствах эффекты упрощаются сами.

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COARSE = matchMedia("(hover: none), (pointer: coarse)").matches;
const TAU = Math.PI * 2;

const PAD = 60; // запас за краем экрана: точка переходит на другую сторону незаметно
const LINK_NEAR = 56; // цепочка соединяет точки на таком расстоянии
const LINK_FAR = 165;
const LINK_SOFT = 180; // с этой длины линия цепочки начинает гаснуть
const LINK_MAX = 230; // длиннее линия не рисуется, цепочка распадается
const LINE_REACH = 96; // длина линий вокруг света

const VERTEX = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FRAGMENT = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uPtr;uniform float uPower;
uniform vec3 uA;uniform vec3 uB;uniform float uGain;uniform vec4 uPulse;uniform float uField;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<3;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 asp=vec2(uRes.x/uRes.y,1.);
  vec2 ptr=vec2(uPtr.x,1.-uPtr.y);
  float d=distance(uv*asp,ptr*asp);
  vec2 p=uv*asp*1.7;
  p+=(ptr-uv)*asp*.5*exp(-d*d*5.)*uPower;
  float t=uT*.085;
  vec2 q=vec2(fbm(p+vec2(0.,t)),fbm(p+vec2(5.2,1.3)-t*.8));
  vec2 r=vec2(fbm(p+2.6*q+vec2(1.7,9.2)+t*1.1),fbm(p+2.6*q+vec2(8.3,2.8)-t*.7));
  float f=fbm(p+3.2*r);
  float light=smoothstep(.34,.82,f);
  light*=mix(.42,1.,smoothstep(.12,.82,distance(uv,vec2(.5,.56))*1.35));
  float glow=exp(-d*d*11.)*.36*uPower;
  float ring=0.;
  if(uPulse.w>0.){
    float pd=distance(uv*asp,vec2(uPulse.x,1.-uPulse.y)*asp);
    float w=(pd-uPulse.z*.72)*8.5;
    ring=exp(-w*w)*exp(-uPulse.z*1.5)*uPulse.w;
  }
  vec3 col=mix(uB,uA,clamp(r.x*1.25+glow*1.5+ring,0.,1.));
  float alpha=clamp(light*.5*uField+glow+ring*.55,0.,.9)*uGain;
  alpha+=(hash(gl_FragCoord.xy+fract(uT))-.5)/120.*step(.002,alpha);
  gl_FragColor=vec4(col*max(alpha,0.),max(alpha,0.));
}`;

const hexRgb = (value) => {
  const v = value.trim().replace("#", "");
  const n = parseInt(v.length === 3 ? [...v].map((c) => c + c).join("") : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// доля пути к цели за кадр: скорость движения одинакова и на 60, и на 160 Гц
const follow = (rate, dt) => 1 - Math.exp(-rate * dt);

// гладкий шум для потоков
const PERM = (() => {
  const a = Array.from({ length: 256 }, (_, i) => (i * 167 + 13) % 256);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return [...a, ...a];
})();
function flow(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const at = (i, j) => PERM[(PERM[(xi + i) & 255] + yi + j) & 255] / 255;
  const a = at(0, 0) + (at(1, 0) - at(0, 0)) * u;
  const b = at(0, 1) + (at(1, 1) - at(0, 1)) * u;
  return a + (b - a) * v;
}
// поток считается как ротор шума: у такого поля нет точек, в которые всё стекается
function curl(x, y) {
  const e = 0.4;
  return [(flow(x, y + e) - flow(x, y - e)) / (2 * e), (flow(x - e, y) - flow(x + e, y)) / (2 * e)];
}

/** Свечение на WebGL. Возвращает null, если видеокарта недоступна или это программный рендер. */
function createGlow(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return null;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(["uRes", "uT", "uPtr", "uPower", "uA", "uB", "uGain", "uPulse", "uField"].map((n) => [n, gl.getUniformLocation(prog, n)]));
  let scale = 0.5;
  return {
    resize(w, h) {
      canvas.width = Math.max(2, Math.round(Math.min(w, 2200) * scale));
      canvas.height = Math.max(2, Math.round((h * canvas.width) / Math.max(w, 1)));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    lower(w, h) {
      scale = 0.3;
      this.resize(w, h);
    },
    draw(t, ptr, power, a, b, gain, pulse, field = 1) {
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uT, t);
      gl.uniform2f(u.uPtr, ptr[0], ptr[1]);
      gl.uniform1f(u.uPower, power);
      gl.uniform3f(u.uA, a[0] / 255, a[1] / 255, a[2] / 255);
      gl.uniform3f(u.uB, b[0] / 255, b[1] / 255, b[2] / 255);
      gl.uniform1f(u.uGain, gain);
      gl.uniform1f(u.uField, field);
      gl.uniform4f(u.uPulse, pulse[0], pulse[1], pulse[2], pulse[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

function createAmbient({ bloom }) {
  const wrap = document.createElement("div");
  wrap.className = "ambient";
  wrap.setAttribute("aria-hidden", "true");
  const glowCanvas = document.createElement("canvas");
  glowCanvas.className = "ambient-glow";
  const fieldCanvas = document.createElement("canvas");
  fieldCanvas.className = "ambient-field";
  wrap.append(glowCanvas, fieldCanvas);
  document.body.prepend(wrap);

  const ctx = fieldCanvas.getContext("2d");
  let glow = null;
  try {
    glow = REDUCED ? null : createGlow(glowCanvas);
  } catch {
    glow = null;
  }
  if (glow) wrap.classList.add("has-glow");
  else glowCanvas.remove();

  let w = 0;
  let h = 0;
  let cx = 0;
  let cy = 0;
  let dpr = 1;
  let points = [];
  let spacing = 48;
  let head = new Int32Array(0);
  let nextInCell = new Int32Array(0);
  let lastRelax = 0;
  let pointColor = "#edf0f4";
  let accentColor = "#6a86be";
  let accentRgb = [106, 134, 190];
  let deepRgb = [38, 54, 104];
  let gain = 1;
  let light = false;
  let black = false;

  // свет: сам ходит по экрану, при движении мыши идёт за курсором
  const ptr = { x: 0, y: 0, tx: 0, ty: 0, power: 0.55, moved: -1e9, attract: null };
  const pulses = [];
  const links = [];
  let nextLink = 0;
  let trail = null;
  let nextTrail = 0;
  let spread = 0;
  let spreadTarget = 0;
  let scrollY = window.scrollY;
  let appear = bloom ? 0 : 1;
  let appearStart = 0;
  let quality = 2;
  let raf = 0;
  let last = 0;
  let frame = 0;
  let slowFrames = 0;
  let sampled = 0;

  function readTheme() {
    light = document.documentElement.dataset.theme === "light";
    black = document.documentElement.dataset.theme === "black";
    pointColor = cssVar("--node", "#edf0f4");
    accentColor = cssVar("--primary", "#6a86be");
    accentRgb = hexRgb(accentColor);
    deepRgb = light ? [150, 170, 214] : black ? [14, 20, 40] : [38, 54, 104];
    gain = light ? 0.62 : 1;
  }

  function makePoint(x, y) {
    const z = Math.random() ** 1.6;
    return {
      x,
      y,
      z,
      r: 0.35 + z * 1.15,
      a: 0.16 + z * 0.56,
      tw: rand(0.4, 1.9),
      ph: rand(0, TAU),
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
      sepx: 0,
      sepy: 0,
      bx: x,
      by: y,
      sx: x,
      sy: y,
      ox: 0,
      oy: 0,
      b: 0,
      lit: 0,
      chained: false,
      accent: Math.random() < 0.16,
      sparkle: z > 0.72 && Math.random() < 0.34,
    };
  }

  function updateSpacing() {
    spacing = Math.sqrt(((w + PAD * 2) * (h + PAD * 2)) / Math.max(points.length, 1)) * 0.74;
  }

  function seed() {
    const oldW = w;
    const oldH = h;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = Math.max(window.innerHeight, wrap.clientHeight);
    cx = w / 2;
    cy = h * 0.46;
    fieldCanvas.width = Math.round(w * dpr);
    fieldCanvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    glow?.resize(w, h);
    const cap = COARSE ? 170 : 380;
    const n = Math.round(clamp((w * h) / 4700, 70, cap) * (quality === 2 ? 1 : 0.6));
    const fullW = w + PAD * 2;
    const fullH = h + PAD * 2;
    if (!points.length) {
      // сетка с разбросом: распределение ровное уже на первом кадре, но рисунок не читается как сетка
      const cols = Math.max(1, Math.round(Math.sqrt((n * fullW) / fullH)));
      const rows = Math.ceil(n / cols);
      const cells = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) cells.push([col, row]);
      }
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      points = cells.slice(0, n).map(([col, row]) =>
        makePoint(-PAD + ((col + rand(0.08, 0.92)) / cols) * fullW, -PAD + ((row + rand(0.08, 0.92)) / rows) * fullH),
      );
    } else {
      // окно изменилось: точки остаются на своих местах, меняется только их число
      for (const s of points) {
        s.x = ((s.x + PAD) / (oldW + PAD * 2)) * fullW - PAD;
        s.y = ((s.y + PAD) / (oldH + PAD * 2)) * fullH - PAD;
      }
      while (points.length > n) points.splice(Math.floor(Math.random() * points.length), 1);
      while (points.length < n) points.push(makePoint(rand(-PAD, w + PAD), rand(-PAD, h + PAD)));
    }
    points.sort((p, q) => Number(p.accent) - Number(q.accent));
    updateSpacing();
    clearLinks();
    if (!ptr.x) {
      ptr.x = w * 0.68;
      ptr.y = h * 0.34;
    }
  }

  function clearLinks() {
    for (const l of links) for (const s of l.chain) s.chained = false;
    links.length = 0;
  }

  // точки мягко расходятся, если оказались слишком близко; считается по экранным координатам
  function relax() {
    const size = spacing;
    const cols = Math.ceil((w + PAD * 2) / size) + 1;
    const rows = Math.ceil((h + PAD * 2) / size) + 1;
    if (head.length < cols * rows) head = new Int32Array(cols * rows);
    if (nextInCell.length < points.length) nextInCell = new Int32Array(points.length);
    head.fill(-1);
    for (let i = 0; i < points.length; i++) {
      const s = points[i];
      s.sepx = 0;
      s.sepy = 0;
      const c = clamp(Math.floor((s.by + PAD) / size), 0, rows - 1) * cols + clamp(Math.floor((s.bx + PAD) / size), 0, cols - 1);
      nextInCell[i] = head[c];
      head[c] = i;
    }
    const size2 = size * size;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const gx = clamp(Math.floor((a.bx + PAD) / size), 0, cols - 1);
      const gy = clamp(Math.floor((a.by + PAD) / size), 0, rows - 1);
      for (let oy = Math.max(gy - 1, 0); oy <= Math.min(gy + 1, rows - 1); oy++) {
        for (let ox = Math.max(gx - 1, 0); ox <= Math.min(gx + 1, cols - 1); ox++) {
          for (let j = head[oy * cols + ox]; j !== -1; j = nextInCell[j]) {
            if (j <= i) continue;
            const b = points[j];
            const dx = a.bx - b.bx;
            const dy = a.by - b.by;
            const dd = dx * dx + dy * dy;
            if (dd >= size2) continue;
            const d = Math.sqrt(dd) || 1;
            const push = (1 - d / size) * 34;
            const nx = dd ? dx / d : Math.cos(i);
            const ny = dd ? dy / d : Math.sin(i);
            a.sepx += nx * push;
            a.sepy += ny * push;
            b.sepx -= nx * push;
            b.sepy -= ny * push;
          }
        }
      }
    }
  }

  function spawnLink(now) {
    if (points.length < 12) return;
    const inside = (s) => !s.chained && s.z >= 0.18 && s.sx > 36 && s.sx < w - 36 && s.sy > 36 && s.sy < h - 36;
    let a = null;
    for (let tries = 0; tries < 12 && !a; tries++) {
      const pick = points[Math.floor(Math.random() * points.length)];
      if (inside(pick) && (Math.abs(pick.sx - w / 2) > w * 0.2 || w < 900)) a = pick;
    }
    if (!a) return;
    const chain = [a];
    const count = Math.round(rand(3, 6));
    while (chain.length < count) {
      const from = chain[chain.length - 1];
      const prev = chain[chain.length - 2];
      let best = null;
      let bestD = LINK_FAR * LINK_FAR;
      for (const s of points) {
        if (!inside(s) || chain.includes(s) || Math.abs(s.z - from.z) > 0.5) continue;
        const dx = s.sx - from.sx;
        const dy = s.sy - from.sy;
        const dd = dx * dx + dy * dy;
        if (dd >= bestD || dd < LINK_NEAR * LINK_NEAR) continue;
        // линия идёт вперёд и не возвращается назад острым углом
        if (prev && dx * (from.sx - prev.sx) + dy * (from.sy - prev.sy) < 0) continue;
        best = s;
        bestD = dd;
      }
      if (!best) break;
      chain.push(best);
    }
    if (chain.length < 3) return;
    for (const s of chain) s.chained = true;
    const draw = rand(1200, 1900);
    const hold = rand(1800, 3200);
    links.push({ chain, born: now, draw, hold, fadeAt: now + draw + hold, fade: 1300, broken: false });
  }

  function spawnTrail(now) {
    const fromLeft = Math.random() < 0.5;
    const angle = rand(0.16, 0.42) * (fromLeft ? 1 : -1);
    const speed = rand(620, 1000);
    const vx = Math.cos(angle) * speed * (fromLeft ? 1 : -1);
    const vy = Math.abs(Math.sin(angle)) * speed;
    trail = { x: fromLeft ? rand(-60, w * 0.5) : rand(w * 0.5, w + 60), y: rand(-30, h * 0.4), vx, vy, len: rand(150, 280), t0: now, life: rand(750, 1250) };
  }

  function step(now) {
    raf = requestAnimationFrame(step);
    if (document.hidden) {
      last = now;
      return;
    }
    const dtMs = Math.min(now - (last || now), 60);
    const dt = dtMs / 1000;
    last = now;
    frame++;
    measure(dtMs);

    const t = now / 1000;
    // свет
    const moving = now - ptr.moved < 2600;
    let tx;
    let ty;
    if (moving) {
      tx = ptr.tx;
      ty = ptr.ty;
    } else if (ptr.attract) {
      tx = ptr.attract[0];
      ty = ptr.attract[1];
    } else {
      tx = w * (0.5 + 0.36 * Math.sin(t * 0.17) + 0.09 * Math.sin(t * 0.41 + 1.3));
      ty = h * (0.46 + 0.32 * Math.cos(t * 0.13 + 0.7) + 0.08 * Math.sin(t * 0.37));
    }
    const lightK = follow(moving ? 6 : 1.1, dt);
    ptr.x += (tx - ptr.x) * lightK;
    ptr.y += (ty - ptr.y) * lightK;
    ptr.power += ((moving || ptr.attract ? 1 : 0.62) - ptr.power) * follow(2.4, dt);

    // фон догоняет прокрутку плавно, даже если страница прыгнула сразу на другое место
    scrollY += (window.scrollY - scrollY) * follow(9, dt);

    // общее расширение поля: нарастает и возвращается назад, точки остаются на своих местах
    spreadTarget *= Math.pow(0.12, dt);
    spread += (spreadTarget - spread) * follow(7, dt);
    if (spreadTarget < 0.002 && spread < 0.002) spread = spreadTarget = 0;

    // появление
    if (appear < 1) {
      if (!appearStart) appearStart = now;
      const k = clamp((now - appearStart) / 1900, 0, 1);
      appear = 1 - (1 - k) ** 3;
    }

    if (now - lastRelax > 100) {
      lastRelax = now;
      relax();
    }
    drawField(now, dt, t);

    // свечение: тридцати кадров хватает, движение медленное
    if (glow && frame % 2 === 0) {
      let pulse = [0, 0, 0, 0];
      const p = pulses[pulses.length - 1];
      if (p) pulse = [p.x / w, p.y / h, (now - p.t0) / 1000, p.s];
      glow.draw(t, [ptr.x / w, ptr.y / h], ptr.power, accentRgb, deepRgb, gain * Math.min(1, appear * 1.2), pulse, black ? 0.12 : 1);
    }
  }

  function measure(dtMs) {
    if (sampled >= 120 || frame < 20) return; // первые кадры идут во время загрузки страницы и ни о чём не говорят
    sampled++;
    if (dtMs > 26) slowFrames++;
    if (sampled === 120 && slowFrames > 48) {
      // устройство не успевает: упрощаем картинку
      if (quality === 2) {
        quality = 1;
        glow?.lower(w, h);
        clearLinks();
        points = points.filter(() => Math.random() < 0.6);
        updateSpacing();
        sampled = 0;
        slowFrames = 0;
      } else if (glow) {
        glowCanvas.remove();
        wrap.classList.remove("has-glow");
        glow = null;
      }
    }
  }

  function drawField(now, dt, t) {
    ctx.clearRect(0, 0, w, h);
    // в чёрной теме круг света шире: точки видны в основном рядом с ним
    const R = (COARSE ? 150 : 200) * (black ? 1.35 : 1);
    const R2 = R * R;
    const near = [];
    const px = (ptr.x / w - 0.5) * 2;
    const py = (ptr.y / h - 0.5) * 2;
    const reach = appear < 1 ? appear * Math.hypot(w, h) * 0.75 : Infinity;
    const alphaScale = light ? 0.62 : 1;
    const baseScale = black ? 0.14 : 1;
    const fullW = w + PAD * 2;
    const fullH = h + PAD * 2;
    const velK = follow(1.6, dt);
    const offK = follow(5, dt);
    const fadeB = Math.pow(0.1, dt);
    const driftX = Math.cos(t * 0.031);
    const driftY = Math.sin(t * 0.031);

    for (let i = 0; i < pulses.length; i++) {
      if (now - pulses[i].t0 > 2400) {
        pulses.splice(i--, 1);
      }
    }

    let fill = "";
    for (let i = 0; i < points.length; i++) {
      const s = points[i];
      // поток: направление обновляем не каждый кадр
      if ((i + frame) % 5 === 0) {
        const [cvx, cvy] = curl(s.x * 0.0021, s.y * 0.0021 + t * 0.045);
        const speed = 14 + 60 * s.z * s.z;
        const drift = 1.5 + 5 * s.z;
        s.tx = cvx * speed + driftX * drift + s.sepx;
        s.ty = cvy * speed + driftY * drift + s.sepy;
      }
      s.vx += (s.tx - s.vx) * velK;
      s.vy += (s.ty - s.vy) * velK;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < -PAD) s.x += fullW;
      else if (s.x > w + PAD) s.x -= fullW;
      if (s.y < -PAD) s.y += fullH;
      else if (s.y > h + PAD) s.y -= fullH;

      const sx = s.x + px * s.z * -26;
      const sy = ((s.y + py * s.z * -18 - scrollY * (0.03 + s.z * 0.1) + PAD) % fullH + fullH) % fullH - PAD;
      s.bx = sx;
      s.by = sy;

      // отклик на свет
      const dx = sx - ptr.x;
      const dy = sy - ptr.y;
      const dd = dx * dx + dy * dy;
      let tx = 0;
      let ty = 0;
      let lit = 0;
      if (dd < R2) {
        const dist = Math.sqrt(dd) || 1;
        const f = 1 - dist / R;
        lit = f * f * ptr.power;
        tx = (dx / dist) * f * f * 26 * s.z;
        ty = (dy / dist) * f * f * 26 * s.z;
      }
      s.lit = lit;
      // волны
      for (const p of pulses) {
        const age = (now - p.t0) / 1000;
        const ppx = sx - p.x;
        const ppy = sy - p.y;
        const pd = Math.hypot(ppx, ppy) || 1;
        const band = 1 - Math.abs(pd - age * 640) / 80;
        if (band > 0) {
          const force = band * p.s * Math.max(0, 1 - age / 2.2);
          s.ox += (ppx / pd) * force * 90 * dt * (0.4 + s.z);
          s.oy += (ppy / pd) * force * 90 * dt * (0.4 + s.z);
          s.b = Math.max(s.b, force * 0.9);
        }
      }
      s.ox += (tx - s.ox) * offK;
      s.oy += (ty - s.oy) * offK;
      s.b *= fadeB;

      const k = spread * s.z * 0.2;
      const fx = sx + s.ox + (sx - cx) * k;
      const fy = sy + s.oy + (sy - cy) * k;
      s.sx = fx;
      s.sy = fy;

      let visible = 1;
      if (reach !== Infinity) {
        const rd = Math.hypot(fx - cx, fy - cy);
        visible = clamp((reach - rd) / 180, 0, 1);
        if (!visible) continue;
      }
      const flicker = 0.62 + 0.38 * Math.sin(t * s.tw + s.ph);
      const alpha = Math.min(1, (s.a * flicker * baseScale + lit * (black ? 1 : 0.7) + s.b) * visible * alphaScale);
      const color = s.accent ? accentColor : pointColor;
      if (color !== fill) {
        ctx.fillStyle = color;
        fill = color;
      }
      ctx.globalAlpha = alpha;
      const radius = s.r * (1 + lit * 0.9 + s.b * 0.8);

      if (radius < 0.9) {
        ctx.fillRect(fx - radius, fy - radius, radius * 2, radius * 2);
      } else {
        ctx.beginPath();
        ctx.arc(fx, fy, radius, 0, TAU);
        ctx.fill();
      }
      if (s.sparkle) {
        const g = radius * (4 + lit * 5 + s.b * 6);
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillRect(fx - g, fy - 0.3, g * 2, 0.6);
        ctx.fillRect(fx - 0.3, fy - g, 0.6, g * 2);
      }
      if (dd < R2 && s.z > 0.1) near.push(s);
    }

    // линии вокруг света
    if (quality === 2 || near.length < 30) {
      ctx.strokeStyle = pointColor;
      ctx.lineWidth = 0.6;
      const limit = Math.min(near.length, 46);
      for (let i = 0; i < limit; i++) {
        const a = near[i];
        for (let j = i + 1; j < limit; j++) {
          const b = near[j];
          const ddx = a.sx - b.sx;
          const ddy = a.sy - b.sy;
          const q = ddx * ddx + ddy * ddy;
          if (q < LINE_REACH * LINE_REACH) {
            const k = 1 - Math.sqrt(q) / LINE_REACH;
            ctx.globalAlpha = k * Math.min(a.lit, b.lit) * 1.5 * alphaScale;
            ctx.beginPath();
            ctx.moveTo(a.sx, a.sy);
            ctx.lineTo(b.sx, b.sy);
            ctx.stroke();
          }
        }
      }
    }

    drawLinks(now);
    drawTrail(now);
    ctx.globalAlpha = 1;

    if (!REDUCED && appear >= 1) {
      if (now > nextLink && links.length < (COARSE ? 1 : 3)) {
        spawnLink(now);
        nextLink = now + rand(900, 2600);
      }
      if (!trail && now > nextTrail) {
        spawnTrail(now);
        nextTrail = now + rand(7000, 14000);
      }
    }
  }

  // у края экрана узел гаснет: когда точка перейдёт на другую сторону, её линии уже не видно
  function edgeFade(s) {
    return clamp((Math.min(s.sx, w - s.sx, s.sy, h - s.sy) + 46) / 36, 0, 1);
  }

  function drawLinks(now) {
    for (let li = links.length - 1; li >= 0; li--) {
      const l = links[li];
      const end = l.chain.length - 1;
      let intact = end;
      const lengths = [];
      for (let i = 0; i < end; i++) {
        const len = Math.hypot(l.chain[i + 1].sx - l.chain[i].sx, l.chain[i + 1].sy - l.chain[i].sy);
        lengths.push(len);
        if (len > LINK_MAX && intact === end) intact = i;
      }
      // линия растянулась: цепочка не тянется дальше, а быстро гаснет
      if (intact < end && !l.broken) {
        l.broken = true;
        if (now < l.fadeAt) {
          l.fadeAt = now;
          l.fade = 420;
        }
      }
      if (now > l.fadeAt + l.fade) {
        for (const s of l.chain) s.chained = false;
        links.splice(li, 1);
        continue;
      }
      const age = now - l.born;
      const drawn = clamp(age / l.draw, 0, 1);
      const eased = 1 - (1 - drawn) ** 2;
      const opacity = now > l.fadeAt ? 1 - (now - l.fadeAt) / l.fade : 1;
      const theme = light ? 0.7 : black ? 0.35 : 1;
      const segs = Math.min(end * eased, intact);
      const edges = l.chain.map(edgeFade);

      ctx.lineWidth = 0.75;
      ctx.strokeStyle = accentColor;
      let endX = l.chain[0].sx;
      let endY = l.chain[0].sy;
      let endEdge = edges[0];
      for (let i = 0; i < end && i < segs; i++) {
        const a = l.chain[i];
        const b = l.chain[i + 1];
        const k = clamp(segs - i, 0, 1);
        endX = a.sx + (b.sx - a.sx) * k;
        endY = a.sy + (b.sy - a.sy) * k;
        endEdge = Math.min(edges[i], edges[i + 1]);
        const stretch = clamp((LINK_MAX - lengths[i]) / (LINK_MAX - LINK_SOFT), 0, 1);
        ctx.globalAlpha = 0.62 * opacity * theme * stretch * endEdge;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
      // узлы цепочки светятся
      ctx.fillStyle = pointColor;
      for (let i = 0; i <= Math.min(Math.floor(segs) + 1, intact); i++) {
        const s = l.chain[i];
        ctx.globalAlpha = opacity * (light ? 0.7 : black ? 0.35 : 0.95) * edges[i];
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, 1.4 + s.z, 0, TAU);
        ctx.fill();
      }
      // огонёк на конце линии, пока она рисуется
      if (drawn < 1) {
        ctx.globalAlpha = 0.9 * opacity * endEdge;
        ctx.beginPath();
        ctx.arc(endX, endY, 2.2, 0, TAU);
        ctx.fill();
      } else if (now < l.fadeAt && intact === end) {
        // сигнал бежит по готовой цепочке
        const run = ((age - l.draw) / l.hold) * end;
        const i = Math.min(Math.floor(run), end - 1);
        const a = l.chain[i];
        const b = l.chain[i + 1];
        const k = run - i;
        ctx.globalAlpha = 0.85 * opacity * Math.min(edges[i], edges[i + 1]);
        ctx.beginPath();
        ctx.arc(a.sx + (b.sx - a.sx) * k, a.sy + (b.sy - a.sy) * k, 1.8, 0, TAU);
        ctx.fill();
      }
    }
  }

  function drawTrail(now) {
    if (!trail) return;
    const age = now - trail.t0;
    if (age > trail.life) {
      trail = null;
      return;
    }
    const k = age / trail.life;
    const x = trail.x + (trail.vx * age) / 1000;
    const y = trail.y + (trail.vy * age) / 1000;
    const n = Math.hypot(trail.vx, trail.vy);
    const tail = trail.len * Math.sin(k * Math.PI);
    const tx = x - (trail.vx / n) * tail;
    const ty = y - (trail.vy / n) * tail;
    const grad = ctx.createLinearGradient(x, y, tx, ty);
    const rgb = light ? accentRgb : [237, 240, 244];
    const a = Math.sin(k * Math.PI) * (light ? 0.5 : black ? 0.3 : 0.85);
    grad.addColorStop(0, `rgba(${rgb.join(",")},${a})`);
    grad.addColorStop(1, `rgba(${rgb.join(",")},0)`);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.fillStyle = `rgba(${rgb.join(",")},${a})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, TAU);
    ctx.fill();
  }

  // ---------- старт и события ----------
  readTheme();
  seed();
  new MutationObserver(() => {
    readTheme();
    if (REDUCED) drawStatic();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function drawStatic() {
    appear = 1;
    drawField(0, 0, 0);
  }

  // смена темы: волна по фону от кнопки темы
  window.addEventListener("upk:theme", (e) => {
    if (REDUCED) return;
    pulses.push({ x: e.detail.x, y: e.detail.y, t0: performance.now(), s: e.detail.strength || 1 });
    if (pulses.length > 4) pulses.shift();
  });

  if (REDUCED) {
    drawStatic();
  } else {
    raf = requestAnimationFrame(step);
    window.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType === "touch") return;
        ptr.tx = e.clientX;
        ptr.ty = e.clientY;
        ptr.moved = performance.now();
      },
      { passive: true },
    );
  }
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // на телефоне высота меняется, когда прячется адресная строка: поле из-за этого не пересоздаём
      if (window.innerWidth === w && Math.abs(window.innerHeight - h) < 160) return;
      seed();
      if (REDUCED) drawStatic();
    }, 160);
  });

  return {
    pulse(x, y, strength) {
      if (REDUCED) return;
      pulses.push({ x, y, s: strength, t0: performance.now() });
      if (pulses.length > 4) pulses.shift();
    },
    spread(amount) {
      if (!REDUCED) spreadTarget = Math.max(spreadTarget, amount);
    },
    attract(x, y) {
      ptr.attract = [x, y];
    },
    release() {
      ptr.attract = null;
    },
    stop() {
      cancelAnimationFrame(raf);
    },
  };
}

let instance = null;

export function startAmbient(options = {}) {
  if (!instance) instance = createAmbient({ bloom: Boolean(options.bloom) });
  return instance;
}

// безопасные вызовы: фон может быть ещё не запущен
export const ambient = {
  pulse: (x, y, strength = 1) => instance?.pulse(x, y, strength),
  pulseAt(el, strength = 1) {
    const r = el?.getBoundingClientRect?.();
    if (r) instance?.pulse(r.left + r.width / 2, r.top + r.height / 2, strength);
  },
  spread: (amount = 1) => instance?.spread(amount),
  attract(el) {
    const r = el?.getBoundingClientRect?.();
    if (r) instance?.attract(r.left + r.width / 2, r.top + r.height / 2);
  },
  release: () => instance?.release(),
};
