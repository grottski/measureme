/* MeasureMe: one daily set of five measurements. Questions live in questions.js (global ROUNDS). */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  getJSON(k) { try { return JSON.parse(this.get(k)); } catch (e) { return null; } },
  setJSON(k, v) { this.set(k, JSON.stringify(v)); }
};
const RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const PHONE = window.matchMedia("(max-width:640px)");
const SKIN = { temp: "thermo", height: "rod", length: "tape", other: "cyl" };
// Five questions a day, each harder than the last. Each is scored out of 100, then
// multiplied by its weight; the weights sum to 10, so a perfect day is 1,000.
const MULT = [1, 1.5, 2, 2.5, 3];
const MAX = 100 * MULT.reduce((s, m) => s + m, 0);
const OFF = ROUNDS.map((R, r) => ROUNDS.slice(0, r).reduce((s, x) => s + x.count, 0));
const TOTAL = ROUNDS.reduce((s, R) => s + R.count, 0);
const TIME = 30;                      // seconds per question
const LAUNCH = "2026-09-10";          // puzzle #1
let PRACTICE = false;                 // true while a practice game runs (set in profile.js)

/* ---------- units: questions are written in one unit; the toggle converts for display ---------- */
const SYS = { ft: "imp", yd: "imp", mi: "imp", in: "imp", lb: "imp", oz: "imp", mph: "imp", "°F": "imp",
              m: "met", cm: "met", km: "met", kg: "met", g: "met", "km/h": "met", "°C": "met" };
const CONV = { // unit -> [other system's unit, factor, offset]
  ft: ["m", 0.3048, 0], yd: ["m", 0.9144, 0], mi: ["km", 1.609344, 0], in: ["cm", 2.54, 0], lb: ["kg", 0.45359237, 0],
  mph: ["km/h", 1.609344, 0], "°F": ["°C", 5 / 9, -160 / 9], oz: ["g", 28.349523125, 0], m: ["ft", 1 / 0.3048, 0], cm: ["in", 1 / 2.54, 0],
  km: ["mi", 1 / 1.609344, 0], kg: ["lb", 1 / 0.45359237, 0], g: ["oz", 1 / 28.349523125, 0], "km/h": ["mph", 1 / 1.609344, 0], "°C": ["°F", 9 / 5, 32]
};
// Gauge ranges are generated from the answer, seeded by the question text so everyone gets the
// same gauge: 0 to ~1.6–4× the answer (a window around it for temperatures, ~2 decades either side
// for log gauges). `ext` counts how many times the player stretched the gauge up or down.
function hashStr(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const ABS0 = { "°F": -459.67, "°C": -273.15 };
const niceCeil = (x, s) => Math.ceil(x / s - 1e-9) * s;
const niceFloor = (x, s) => Math.floor(x / s + 1e-9) * s;
function view(it, ext = { up: 0, down: 0 }) {
  const conv = !!SYS[it.u] && SYS[it.u] !== S.sys;
  const [u, f, b] = conv ? CONV[it.u] : [it.u, 1, 0];
  const c = v => v * f + b, a = c(it.a), rand = rng(hashStr(it.q));
  let min, max;
  if (it.log) {
    min = Math.pow(10, Math.floor(L10(a) - 1.2 - rand()) - ext.down);
    max = Math.pow(10, Math.ceil(L10(a) + 1.2 + rand()) + ext.up);
  } else if (it.k === "temp") {
    const W = Math.max(Math.abs(a), c(100) - c(0)) * (1.6 + rand()), step = nice(W / 8), p = 0.3 + rand() * 0.35;
    min = Math.max(niceFloor(a - W * p, step) - step * 8 * ext.down, ABS0[u]);
    max = niceCeil(a + W * (1 - p), step) + step * 8 * ext.up;
  } else {
    const span = a * (1.6 + rand() * 2.4);
    min = 0;
    max = niceCeil(span, nice(span / 5)) * Math.pow(2, ext.up);
  }
  return Object.assign({}, it, { u, a, min, max, ext, conv, c, inv: v => (v - b) / f });
}
// Give the gauge more room: ×2 (×10 on log gauges) at the top; below only for temperatures and log gauges.
function stretch(dir) {
  if (S.phase !== "guess") return false;
  const it = cur();
  if (dir < 0 && (!(it.log || it.k === "temp") || it.min <= (ABS0[it.u] ?? -Infinity) + 1e-6)) return false;
  const ext = { up: it.ext.up + (dir > 0 ? 1 : 0), down: it.ext.down + (dir < 0 ? 1 : 0) };
  if (ext.up + ext.down > 8) return false;
  S.view = view(S.picks[S.r][S.i], ext);
  paintChrome(); setGuess(S.guess);
  return true;
}

const S = { sys: store.get("measureme.units") || (/^en-(US|LR|MM)/i.test(navigator.language) ? "imp" : "met"),
            r: 0, i: 0, picks: [], view: null, guess: 0, phase: "start", results: [], score: 0, n: 0, date: "" };
const el = {};
["gauge", "rail", "ticks", "ghost", "handleTxt", "guessOut", "actualOut", "guessPane", "revealPane", "game", "start", "inter", "end", "timer", "home", "stats", "profile"].forEach(id => el[id] = $(id));
const cur = () => S.view;
const idx = () => OFF[S.r] + S.i;
const gainedOf = (x, k) => Math.round(x.p * MULT[k]);
const tierOf = k => { let r = 0; while (r < ROUNDS.length - 1 && k >= OFF[r + 1]) r++; return ROUNDS[r]; };

/* ---------- per-question scale ---------- */
const L10 = Math.log10;
const toT = (v, it = cur()) => it.log
  ? (L10(Math.max(v, it.min)) - L10(it.min)) / (L10(it.max) - L10(it.min))
  : (v - it.min) / (it.max - it.min);
const fromT = (t, it = cur()) => it.log
  ? Math.pow(10, L10(it.min) + t * (L10(it.max) - L10(it.min)))
  : it.min + t * (it.max - it.min);
function nice(x) { const e = Math.pow(10, Math.floor(L10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }
function stepAt(v, it = cur()) {
  if (it.log) return Math.pow(10, Math.floor(L10(Math.max(Math.abs(v), it.min))) - 2);
  return nice((it.max - it.min) / 7) / 10;
}
const snap = (v, it = cur()) => { const s = stepAt(v, it); return clamp(Math.round(v / s) * s, it.min, it.max); };
const decimalsFor = s => Math.max(0, Math.min(4, -Math.floor(L10(s) + 1e-9)));

/* ---------- formatting ---------- */
function num(v, dec) {
  const s = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  return (v < 0 && !/^0(\.0+)?$/.test(s) ? "−" : "") + s;
}
// Exact answers keep their written precision; converted ones get 3 significant figures.
const aDec = it => it.conv ? (Math.abs(it.a) >= 100 ? 0 : Math.abs(it.a) >= 10 ? 1 : 2)
                           : (String(it.a).split(".")[1] || "").length;
const fmtV = (v, it = cur()) => num(v, decimalsFor(stepAt(v, it)));
const fmtA = (it = cur()) => num(it.a, aDec(it));
const withUnit = (s, it = cur()) => `${s}<small>${it.u}</small>`;
const plain = (s, it = cur()) => `${s}${it.u.startsWith("°") ? "" : " "}${it.u}`;
function compact(v) {
  const a = Math.abs(v); let s;
  if (a >= 1e6) s = +(a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  else if (a >= 1e4) s = Math.round(a / 1000) + "k";
  else if (a >= 1000) s = +(a / 1000).toFixed(1) + "k";
  else if (a >= 10 || a === 0) s = String(Math.round(a));
  else if (a >= 1) s = String(+a.toFixed(1));
  else s = String(+a.toPrecision(2));
  return (v < 0 && s !== "0" ? "−" : "") + s;
}

/* ---------- ticks ---------- */
function ticksFor(it) {
  const out = [];
  if (it.log) {
    const d0 = Math.ceil(L10(it.min) - 1e-9), d1 = Math.floor(L10(it.max) + 1e-9), decades = L10(it.max / it.min);
    for (let d = d0 - 1; d <= d1; d++) [1, 2, 5].forEach(m => {
      const v = m * Math.pow(10, d);
      if (v >= it.min * 0.999 && v <= it.max * 1.001 && (m === 1 || decades <= 4)) out.push({ v, minor: m !== 1 });
    });
  } else {
    const step = nice((it.max - it.min) / 7);
    for (let v = Math.ceil(it.min / step) * step; v <= it.max + 1e-9; v += step) out.push({ v: +v.toFixed(10), minor: false });
    for (let v = Math.ceil(it.min / step) * step - step / 2; v <= it.max; v += step) if (v > it.min) out.push({ v, minor: true });
  }
  return out;
}
function renderTicks(it) {
  el.ticks.innerHTML = ticksFor(it).map(({ v, minor }) =>
    `<div class="tick${minor ? " minor" : ""}" style="--p:${(toT(v, it) * 100).toFixed(2)}%">${minor ? "" : `<span>${compact(v)}</span>`}</div>`).join("");
}

/* ---------- painting ---------- */
function fitNum(n) {
  n.style.fontSize = "";
  if (!PHONE.matches || !n.clientWidth) return;
  if (n.scrollWidth > n.clientWidth) n.style.fontSize = Math.floor(parseFloat(getComputedStyle(n).fontSize) * n.clientWidth / n.scrollWidth) + "px";
}
function paint(v, exact) {
  const it = cur(), t = clamp(toT(v), 0, 1);
  el.gauge.style.setProperty("--t", t.toFixed(5));
  el.handleTxt.textContent = compact(v);
  const text = exact ? fmtA(it) : fmtV(v);
  if (S.phase === "guess") {
    el.guessOut.innerHTML = withUnit(text);
    el.gauge.setAttribute("aria-valuenow", +v.toFixed(4));
    el.gauge.setAttribute("aria-valuetext", plain(text));
    fitNum(el.guessOut);
  } else {
    el.actualOut.innerHTML = withUnit(text);
    fitNum(el.actualOut);
  }
}
window.addEventListener("resize", () => { fitNum(el.guessOut); fitNum(el.actualOut); });
function setGuess(v) { S.guess = snap(v); paint(S.guess); }
function nudge(dir, big) {
  if (S.phase !== "guess") return;
  // Nudging past either end stretches the gauge first.
  if (dir > 0 && S.guess >= cur().max - 1e-9) stretch(1);
  if (dir < 0 && S.guess <= cur().min + 1e-9) stretch(-1);
  const it = cur();
  if (it.log) { const f = big ? 1.25 : 1.02; setGuess(dir > 0 ? S.guess * f : S.guess / f); return; }
  const s = stepAt(S.guess) * (big ? 10 : 1);
  setGuess(Math.round(S.guess / s) * s + dir * s);
}

/* ---------- input ---------- */
// Dragging and holding past either end for a moment stretches the gauge.
let dragging = false, lastY = 0, edgeSince = 0, edgeTimer = 0;
const rawT = y => { const r = el.rail.getBoundingClientRect(); return 1 - (y - r.top) / r.height; };
function fromPointer(y) { lastY = y; setGuess(fromT(clamp(rawT(y), 0, 1))); }
function checkEdge() {
  if (!dragging || S.phase !== "guess") return;
  const t = rawT(lastY), dir = t > 1.01 ? 1 : t < -0.01 ? -1 : 0;
  if (!dir) { edgeSince = 0; return; }
  const now = Date.now();
  if (!edgeSince) edgeSince = now;
  else if (now - edgeSince > 450 && stretch(dir)) { edgeSince = now; fromPointer(lastY); }
}
function endDrag() { dragging = false; edgeSince = 0; clearInterval(edgeTimer); }
el.gauge.addEventListener("pointerdown", e => {
  if (S.phase !== "guess" || e.target.closest(".stretch")) return;
  dragging = true; el.gauge.setPointerCapture(e.pointerId);
  fromPointer(e.clientY); el.gauge.focus({ preventScroll: true }); e.preventDefault();
  clearInterval(edgeTimer); edgeTimer = setInterval(checkEdge, 150);
});
el.gauge.addEventListener("pointermove", e => { if (dragging) fromPointer(e.clientY); });
["pointerup", "pointercancel"].forEach(ev => el.gauge.addEventListener(ev, endDrag));
$("stretchUp").addEventListener("click", () => { stretch(1); el.gauge.focus({ preventScroll: true }); });
el.gauge.addEventListener("keydown", e => {
  const map = { ArrowUp: [1, e.shiftKey], ArrowRight: [1, e.shiftKey], ArrowDown: [-1, e.shiftKey], ArrowLeft: [-1, e.shiftKey], PageUp: [1, true], PageDown: [-1, true] };
  if (map[e.key]) { nudge(...map[e.key]); e.preventDefault(); }
  else if (e.key === "Home" && S.phase === "guess") { setGuess(cur().min); e.preventDefault(); }
  else if (e.key === "End" && S.phase === "guess") { setGuess(cur().max); e.preventDefault(); }
});
function holdable(btn, dir) {
  let timer = 0, held = false, start = 0;
  btn.addEventListener("pointerdown", () => {
    held = true; start = Date.now(); nudge(dir, false);
    timer = setTimeout(function rep() { nudge(dir, Date.now() - start > 1500); timer = setTimeout(rep, 70); }, 380);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => btn.addEventListener(ev, () => clearTimeout(timer)));
  btn.addEventListener("click", e => { if (held) { held = false; return; } nudge(dir, e.shiftKey); });
}
holdable($("minus"), -1);
holdable($("plus"), 1);

/* ---------- daily puzzle ---------- */
const pad = n => String(n).padStart(2, "0");
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayNum = ds => Math.round((Date.parse(ds + "T00:00:00Z") - Date.parse(LAUNCH + "T00:00:00Z")) / 864e5) + 1;
function rng(seed) {
  return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(a, rand = Math.random) { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; }
// Each round's pool is shuffled with a fixed seed and walked day by day, so questions
// don't repeat until the pool runs out; then it reshuffles for the next cycle.
function dailyPicks(n) {
  return ROUNDS.map((R, r) => Array.from({ length: R.count }, (_, i) => {
    const k = (n - 1) * R.count + i, cycle = Math.floor(k / R.items.length);
    return shuffle(R.items.slice(), rng(1009 * (r + 1) + 7919 * cycle))[k % R.items.length];
  }));
}
// Practice games: random, with a different kind of measurement per question where possible.
function pickRound(items, count) {
  const pool = shuffle(items.slice()), out = [], seen = new Set();
  pool.forEach(it => { if (out.length < count && !seen.has(it.m)) { out.push(it); seen.add(it.m); } });
  pool.forEach(it => { if (out.length < count && !out.includes(it)) out.push(it); });
  return out;
}
// Daily progress lives on the active profile (profile.js), one record per date.
function save() {
  if (PRACTICE) return;
  updateMe(p => {
    const d = p.days[S.date] || (p.days[S.date] = { n: S.n, res: [] });
    d.res = S.results.filter(Boolean).map(x => ({ q: x.it.q, g: x.gBase, p: x.p, dir: x.dir, to: x.timedOut }));
    d.pending = S.pending || null;
  });
}
function restore() {
  const p = me(), d = p && p.days[S.date];
  S.results = []; S.score = 0; S.resumeAt = 0; S.pending = null;
  if (!d || !Array.isArray(d.res)) return 0;
  const flat = S.picks.flat();
  d.res.forEach((x, k) => { if (flat[k] && flat[k].q === x.q) S.results[k] = { it: flat[k], gBase: x.g, p: x.p, dir: x.dir, timedOut: x.to }; });
  let done = S.results.filter(Boolean).length;
  // A question that was opened and then left keeps its clock; if it ran out meanwhile, it locks at rest.
  const pend = d.pending;
  if (pend && pend.k === done && flat[done]) {
    if (Date.now() >= pend.deadline) {
      const v = view(flat[done]);
      S.results[done] = { it: flat[done], gBase: v.inv(v.min), p: points(v.min, v), dir: "low", timedOut: true };
      done++; save();
    } else S.resumeAt = pend.deadline;
  }
  S.score = S.results.reduce((a, x, k) => a + (x ? gainedOf(x, k) : 0), 0);
  return done;
}
function recordStats(total) {
  updateMe(p => { const d = p.days[S.date]; if (d) { d.done = true; d.score = total; d.pending = null; } });
  return statsFor(me());
}

/* ---------- timer ---------- */
let timerId = 0, deadline = 0;
function stopTimer() { clearInterval(timerId); timerId = 0; }
function startTimer() {
  stopTimer();
  deadline = S.resumeAt > Date.now() ? S.resumeAt : Date.now() + TIME * 1000; // resuming keeps the old clock
  S.resumeAt = 0; tick(); timerId = setInterval(tick, 100);
}
function tick() {
  const rem = Math.max(0, deadline - Date.now());
  $("timerFill").style.width = (rem / (TIME * 1000) * 100).toFixed(2) + "%";
  $("timerTxt").textContent = "0:" + pad(Math.ceil(rem / 1000));
  el.timer.classList.toggle("low", rem <= 10000);
  if (rem <= 0 && S.phase === "guess") { stopTimer(); lock(true); }
}

/* ---------- flow ---------- */
const ptsColor = p => `color-mix(in srgb, var(--accent) ${Math.round(15 + p * 0.85)}%, #8A98A5)`;
function buildProgress() {
  $("prog").innerHTML = `<div class="grp">${MULT.map((m, k) => `<span class="cell" data-k="${k}" title="Question ${k + 1} · ×${m}"></span>`).join("")}</div>`;
}
function updateHeader() {
  document.querySelectorAll(".cell").forEach(c => {
    const k = +c.dataset.k, res = S.results[k];
    c.style.background = res ? ptsColor(res.p) : "";
    c.classList.toggle("now", S.phase === "guess" && k === idx());
  });
  $("score").textContent = Math.round(S.score).toLocaleString("en-US");
}
function show(section) { ["game", "start", "inter", "end", "home", "stats", "profile"].forEach(s => el[s].hidden = s !== section); }
function goTo(k) {
  let r = 0; while (r < ROUNDS.length - 1 && k >= OFF[r + 1]) r++;
  S.r = r; S.i = k - OFF[r];
  showItem();
}
function showStart(done) {
  S.phase = "start";
  const when = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  el.start.innerHTML = `<div class="screen">
    <p class="label">${PRACTICE ? (S.cat ? S.cat.label : "Random") + " practice · doesn’t affect your streak" : "Daily puzzle · " + when}</p>
    <h2 class="round-big">${PRACTICE ? "Practice" : "#" + S.n}</h2>
    <p class="blurb">Five measurements, each harder than the last. Slide the gauge to guess. Every answer is scored out of 100, then multiplied by its weight, for a total out of ${MAX.toLocaleString("en-US")}. You get <b>${TIME} seconds</b> per question${PRACTICE ? "." : ", and one try a day."}</p>
    <ol class="ladder steps">${MULT.map((m, k) => `<li class="${k < done ? "done" : ""}"><b>×${m}</b><span>Q${k + 1} · ${tierOf(k).name}</span></li>`).join("")}</ol>
    <div class="actions"><button class="btn primary" type="button" id="begin">${done ? `Resume at question ${done + 1}` : "Start"}</button><button class="btn" type="button" id="back">Menu</button></div>
  </div>`;
  show("start"); updateHeader();
  $("begin").addEventListener("click", () => {
    track(PRACTICE ? `practice-start/${S.cat ? S.cat.id : "random"}` : done ? "daily-resume" : "daily-start");
    goTo(done);
  });
  $("back").addEventListener("click", showHome);
}
function paintChrome() {
  const it = cur();
  $("plateUnit").textContent = it.u;
  $("plateKind").textContent = it.m;
  $("plateRange").textContent = `Gauge ${compact(it.min)}–${plain(compact(it.max))}${it.log ? " · log scale" : ""}`;
  el.gauge.setAttribute("aria-valuemin", +it.min.toFixed(4));
  el.gauge.setAttribute("aria-valuemax", +it.max.toFixed(4));
  renderTicks(it);
}
function showItem() {
  const it = S.picks[S.r][S.i], R = ROUNDS[S.r];
  S.view = view(it);
  S.phase = "guess"; show("game");
  el.guessPane.hidden = false; el.revealPane.hidden = true; el.ghost.hidden = true;
  el.gauge.className = "gauge skin-" + SKIN[it.k];
  $("eyeRound").textContent = `${PRACTICE && S.cat ? S.cat.label + " practice" : R.name} · worth ×${MULT[idx()]}`;
  $("eyeItem").textContent = `Question ${idx() + 1} of ${TOTAL}`;
  $("itemName").textContent = it.q;
  $("itemHint").textContent = it.h;
  paintChrome();
  setGuess(S.view.min); // gauges start at rest, so an untouched guess scores near zero
  updateHeader();
  window.scrollTo({ top: 0, behavior: RM ? "auto" : "smooth" });
  el.gauge.focus({ preventScroll: true });
  startTimer();
  if (!PRACTICE) { S.pending = { k: idx(), deadline }; save(); }
}

// Scored by how far off the guess is, never by the gauge (so stretching can't change points):
// "times off" for sizes; percent off for temperatures, which can be zero or negative.
// 10% off ≈ 94 · 25% ≈ 70 · 1.5× ≈ 38 · 2× ≈ 16 · 10× ≈ 1.
function points(g, it) {
  const gB = it.inv(g), aB = it.inv(it.a);
  const miss = it.k === "temp" ? Math.abs(gB - aB) / Math.max(Math.abs(aB), 100) / 1.2
                               : gB > 0 ? Math.abs(Math.log(gB / aB)) : Infinity;
  return Math.round(100 / (1 + Math.pow(miss / 0.33, 2.2)));
}
const pick = a => a[Math.floor(Math.random() * a.length)];
function verdictFor(p, dir) {
  if (p >= 97) return pick(["Dead on. Perfectly calibrated.", "Bullseye. Are you a measuring tape?"]);
  if (p >= 85) return pick(["Precise. Barely off.", "Sharp eye. So close."]);
  if (p >= 65) return pick(["Close. Respectable.", "In the right neighborhood."]);
  if (p >= 40) return `A bit ${dir}.`;
  if (p >= 15) return `Way ${dir}.`;
  return pick(["Off the charts. Not even close.", "The gauge is disappointed."]);
}
function lock(timedOut) {
  if (S.phase !== "guess") return;
  stopTimer();
  if (timedOut) track("timeout");
  const it = cur(), g = S.guess, p = points(g, it), dir = g > it.a ? "high" : "low";
  S.results[idx()] = { it: S.picks[S.r][S.i], gBase: it.inv(g), p, dir, timedOut: !!timedOut,
                       v: (timedOut ? "Time’s up. " : "") + verdictFor(p, dir) };
  S.score += gainedOf(S.results[idx()], idx());
  S.pending = null;
  save();
  S.phase = "reveal";
  el.gauge.classList.add("locked");
  el.gauge.style.setProperty("--tg", clamp(toT(g), 0, 1).toFixed(5));
  el.ghost.hidden = false;
  el.guessPane.hidden = true; el.revealPane.hidden = false;
  renderReveal();
  $("next").textContent = idx() < TOTAL - 1 ? `Next question (×${MULT[idx() + 1]})` : "See my final score";
  $("next").focus({ preventScroll: true });
  updateHeader();
  animate(g, it.a);
  if (PHONE.matches) document.querySelector(".item").scrollIntoView({ block: "start", behavior: RM ? "auto" : "smooth" });
}
function renderReveal() {
  const res = S.results[idx()], it = cur(), g = it.c(res.gBase), d = Math.abs(g - it.a);
  $("ptsOut").textContent = "+" + gainedOf(res, idx());
  $("ptsMath").textContent = `${res.p} / 100 × ${MULT[idx()]}`;
  $("verdict").textContent = res.v || verdictFor(res.p, res.dir);
  $("delta").textContent = d < 1e-9 ? `You said ${plain(fmtV(g))}. Exactly right.`
    : `You said ${plain(fmtV(g))}: ${plain(num(d, Math.max(decimalsFor(stepAt(g)), aDec(it))))} too ${res.dir}.`;
  $("fact").textContent = res.it.x;
  const mi = missInfo(res, it), mo = $("missOut");
  mo.textContent = mi.text;
  mo.className = "miss " + (mi.dir > 0 ? "hi" : mi.dir < 0 ? "lo" : mi.none ? "" : "ok");
}
let animId = 0;
function animate(from, to) {
  const id = ++animId;
  if (RM) { paint(to, true); return; }
  const t0 = toT(from), t1 = toT(to), dur = 1300, st = performance.now();
  const frame = now => {
    if (id !== animId) return;
    let u = clamp((now - st) / dur, 0, 1);
    u = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    if (u < 1) { paint(fromT(t0 + (t1 - t0) * u)); requestAnimationFrame(frame); } else paint(to, true);
  };
  requestAnimationFrame(frame);
}
function next() {
  if (S.phase !== "reveal") return;
  animId++;
  if (idx() < TOTAL - 1) goTo(idx() + 1); else showEnd();
}
function rating(s) {
  if (s >= 900) return ["Master Calibrator", "Your eyes are basically laser rangefinders."];
  if (s >= 750) return ["Precision Instrument", "A few readings off, most dead on."];
  if (s >= 600) return ["Steady Hand", "Solid instincts with the odd wild guess."];
  if (s >= 450) return ["Rough Estimate", "You know a hoop from a skyscraper. Mostly."];
  if (s >= 250) return ["Eyeballer", "Somewhere between a guess and a vibe."];
  return ["Uncalibrated", "The gauge needs a word with you."];
}
// How far off a guess was. Sizes: a symmetric ratio (1.15× high, 1.25× low), so doubling and halving
// read the same. Temperatures: the difference in degrees, since ratios mean nothing around zero.
// `pos` places the guess on the share card's mini gauge (−1 = far low, 0 = answer, 1 = far high).
function missInfo(x, v = view(x.it)) {
  if (x.it.k === "temp") {
    const d = v.c(x.gBase) - v.a, ad = Math.abs(d);
    if (ad < (v.u === "°C" ? 0.3 : 0.5)) return { text: "Exact", short: "Exact", dir: 0, pos: 0 };
    const s = `${d > 0 ? "+" : "−"}${num(ad, ad < 10 ? 1 : 0)}${v.u}`;
    const scale = Math.max(Math.abs(x.it.a), 100) * (v.u === "°C" ? 5 / 9 : 1);
    return { text: `${s} ${d > 0 ? "high" : "low"}`, short: s, dir: Math.sign(d), pos: clamp(d / scale / 0.8, -1, 1) };
  }
  if (!(x.gBase > 0)) return { text: "No guess", short: "—", dir: 0, none: true, pos: -1 };
  const ratio = x.gBase / x.it.a, r = Math.max(ratio, 1 / ratio), dir = ratio > 1 ? 1 : -1;
  if (r < 1.01) return { text: "Exact", short: "Exact", dir: 0, pos: 0 };
  const rs = r < 10 ? String(+r.toFixed(r < 2 ? 2 : 1)) : num(r, 0);
  return { text: `${rs}× ${dir > 0 ? "high" : "low"}`, short: `${rs}×`, dir, pos: clamp(dir * Math.log(r) / Math.log(4), -1, 1) };
}

/* ---------- share card: an image of the results, with no questions or answers (no spoilers) ---------- */
let cardBlob = null, cardReady = Promise.resolve();
function shareText() {
  const total = Math.round(S.score), head = PRACTICE ? "MeasureMe practice" : `MeasureMe #${S.n}`;
  const misses = S.results.map((x, k) => { if (!x) return ""; const m = missInfo(x);
    return `Q${k + 1} ${m.none ? "no guess" : m.dir > 0 ? m.short + "▲" : m.dir < 0 ? m.short + "▼" : "exact"}`; }).filter(Boolean).join(" · ");
  // The page's own address (works at measureme.lol/ and at a /measureme/ subpath), minus ?practice.
  const url = /^https?:/.test(location.protocol) ? location.href.split(/[?#]/)[0].replace(/index\.html$/, "") : "https://measureme.lol/";
  const text = `${head}: ${total.toLocaleString("en-US")} / ${MAX.toLocaleString("en-US")} (${rating(total)[0]})\n${misses}`;
  return { text, url, full: `${text}\n${url}` };
}
async function drawCard() {
  const W = 1080, H = 1350, M = 84, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  try { await Promise.all(['900 120px Archivo', '800 60px Archivo', '600 30px "IBM Plex Mono"', '600 34px "Instrument Sans"'].map(f => document.fonts.load(f))); } catch (e) {}
  const DISPLAY = 'Archivo, "Arial Black", Arial, sans-serif', MONO = '"IBM Plex Mono", Menlo, monospace', BODY = '"Instrument Sans", Arial, sans-serif';
  const WHITE = "#FFFFFF", DIM = "rgba(255,255,255,.72)", FAINT = "rgba(255,255,255,.16)", TAPE = "#FFC23A";
  ctx.fillStyle = "#2446F5"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,.06)";
  for (let x = 0; x <= W; x += 30) ctx.fillRect(x, 0, 1, H);
  for (let y = 0; y <= H; y += 30) ctx.fillRect(0, y, W, 1);
  // wordmark + ruler
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.font = `900 66px ${DISPLAY}`; ctx.fillStyle = WHITE; ctx.fillText("MEASURE", M, 150);
  const w1 = ctx.measureText("MEASURE").width; ctx.fillStyle = TAPE; ctx.fillText("ME", M + w1 + 8, 150);
  const rw = w1 + 8 + ctx.measureText("ME").width;
  ctx.fillStyle = WHITE; ctx.fillRect(M, 170, rw, 3);
  for (let x = 0; x <= rw; x += 12) ctx.fillRect(M + x, 170, 3, x % 60 === 0 ? 18 : 10);
  // puzzle number + date
  ctx.textAlign = "right"; ctx.font = `600 30px ${MONO}`; ctx.fillStyle = DIM;
  ctx.fillText(PRACTICE ? "PRACTICE" : `#${S.n}`, W - M, 118);
  ctx.fillText(new Date((S.date || localDate()) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase(), W - M, 160);
  // score + rating
  const total = Math.round(S.score), totalS = total.toLocaleString("en-US");
  ctx.textAlign = "left"; ctx.fillStyle = WHITE; ctx.font = `900 220px ${DISPLAY}`; ctx.fillText(totalS, M - 8, 430);
  const sw = ctx.measureText(totalS).width;
  ctx.font = `600 38px ${MONO}`; ctx.fillStyle = DIM; ctx.fillText(`/ ${MAX.toLocaleString("en-US")}`, M + sw + 8, 430);
  ctx.font = `800 54px ${DISPLAY}`; ctx.fillStyle = WHITE; ctx.fillText(rating(total)[0], M, 512);
  // one row per question: kind, mini gauge (answer at center, guess = yellow pointer), miss, points
  const top = 590, rowH = 118, gx = 390, gw = 300;
  S.results.forEach((x, k) => {
    if (!x) return;
    const y = top + k * rowH, mi = missInfo(x), gy = y + 70;
    ctx.fillStyle = FAINT; ctx.fillRect(M, y, W - 2 * M, 2);
    ctx.textAlign = "left"; ctx.fillStyle = DIM; ctx.font = `600 24px ${MONO}`; ctx.fillText(`Q${k + 1} · ×${MULT[k]}`, M, y + 44);
    ctx.fillStyle = WHITE; ctx.font = `600 34px ${BODY}`; ctx.fillText(x.it.m, M, y + 88);
    ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.fillRect(gx, gy - 1, gw, 3);
    [-1, -0.5, 0.5, 1].forEach(p => ctx.fillRect(gx + gw / 2 + p * gw / 2 - 1, gy - 9, 2, 18));
    ctx.fillStyle = WHITE; ctx.fillRect(gx + gw / 2 - 2, gy - 22, 4, 44);
    const mx = gx + gw / 2 + mi.pos * gw / 2;
    ctx.fillStyle = TAPE; ctx.beginPath(); ctx.moveTo(mx, gy - 4); ctx.lineTo(mx - 15, gy - 30); ctx.lineTo(mx + 15, gy - 30); ctx.closePath(); ctx.fill();
    ctx.textAlign = "right"; ctx.fillStyle = WHITE; ctx.font = `600 32px ${MONO}`; ctx.fillText(mi.none ? "—" : mi.short, W - M - 150, y + 62);
    ctx.fillStyle = DIM; ctx.font = `600 20px ${MONO}`; ctx.fillText(mi.none ? "NO GUESS" : mi.dir > 0 ? "HIGH" : mi.dir < 0 ? "LOW" : "DEAD ON", W - M - 150, y + 92);
    ctx.fillStyle = WHITE; ctx.font = `900 50px ${DISPLAY}`; ctx.fillText(`+${gainedOf(x, k)}`, W - M, y + 80);
  });
  // footer
  const fy = top + 5 * rowH;
  ctx.fillStyle = FAINT; ctx.fillRect(M, fy, W - 2 * M, 2);
  ctx.textAlign = "left"; ctx.fillStyle = WHITE; ctx.font = `900 46px ${DISPLAY}`; ctx.fillText("measureme.lol", M, fy + 86);
  ctx.textAlign = "right"; ctx.fillStyle = DIM; ctx.font = `600 24px ${MONO}`; ctx.fillText("ONE MEASUREMENT PUZZLE A DAY", W - M, fy + 80);
  return cv;
}
function renderCard() {
  cardReady = (async () => {
    try { const cv = await drawCard(); $("cardImg").src = cv.toDataURL("image/png"); cardBlob = await new Promise(r => cv.toBlob(r, "image/png")); }
    catch (e) { cardBlob = null; $("cardImg").hidden = true; }
  })();
}
const cardName = () => `measureme-${PRACTICE ? "practice" : S.n}.png`;
function shareHint(msg) { const h = $("shareHint"); if (h) { h.textContent = msg; h.hidden = false; } }
// Share score: the phone's share sheet with the score text and link. Where there's no share sheet
// (e.g. a page served without HTTPS), phones open Messages with the text filled in; desktops copy it.
async function shareScore(btn) {
  const { full } = shareText();
  if (navigator.share) {
    try { await navigator.share({ text: full }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  if (PHONE.matches) { location.href = "sms:?&body=" + encodeURIComponent(full); return; }
  try { await navigator.clipboard.writeText(full); btn.textContent = "Score copied"; shareHint("Paste it anywhere."); }
  catch (e) { const box = $("shareBox"); box.value = full; box.hidden = false; box.focus(); box.select(); }
}
// Copy image: puts the card on the clipboard so it can be pasted into a text. If the browser won't
// allow that, phones get a press-and-hold hint instead of a download; desktops save the file.
async function copyImage(btn) {
  if (window.isSecureContext && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": cardReady.then(() => cardBlob) })]);
      btn.textContent = "Image copied"; shareHint("Now paste it into a message.");
      return;
    } catch (e) {}
  }
  if (PHONE.matches) {
    shareHint("Press and hold the card above, then tap Copy.");
    $("cardImg").scrollIntoView({ block: "center", behavior: RM ? "auto" : "smooth" });
  } else saveImage(btn);
}
async function saveImage(btn) {
  await cardReady;
  if (!cardBlob) return;
  const a = document.createElement("a"); a.href = URL.createObjectURL(cardBlob); a.download = cardName();
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (btn.id === "saveImg") btn.textContent = "Saved";
}
let countdownId = 0;
function countdown() {
  const now = new Date(), mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ms = mid - now, box = $("countdown");
  if (!box) return clearInterval(countdownId);
  if (ms <= 0 || localDate() !== S.date) { location.reload(); return; }
  const s = Math.floor(ms / 1000);
  box.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
function showEnd(rerender) {
  S.phase = "end"; stopTimer();
  const total = Math.round(S.score), [title, sub] = rating(total);
  let statsHtml;
  if (PRACTICE) {
    if (!rerender) { recordPractice(total); track("practice-finish"); }
    statsHtml = `<p class="best">Practice games don’t affect your streak.</p>`;
  } else {
    const st = rerender ? statsFor(me()) : recordStats(total);
    if (!rerender) { // score band and streak length: a rough, anonymous view of how often people return
      track(`daily-finish/${Math.min(4, Math.floor(total / 200)) * 200}`);
      track(`streak/${Math.min(st.streak, 30)}`);
    }
    statsHtml = `<div class="stats">
      <div><span class="label">Next puzzle in</span><b class="countdown" id="countdown">--:--:--</b></div>
      <div><span class="label">Streak</span><b>${st.streak || 1} day${st.streak === 1 ? "" : "s"}</b></div>
      <div><span class="label">Played</span><b>${st.played || 1}</b></div>
      <div><span class="label">Best</span><b>${(st.best || total).toLocaleString("en-US")}</b></div>
    </div>`;
  }
  const rows = S.results.map((x, k) => { if (!x) return ""; const v = view(x.it), g = v.c(x.gBase);
    return `<div class="row"><span class="n"><span class="label">Q${k + 1} · ×${MULT[k]} · ${missInfo(x, v).text} · ${x.p}/100${x.timedOut ? " · time ran out" : ""}</span><br>${x.it.q}</span><span class="v said">${plain(fmtV(g, v), v)}</span><span class="v act">${plain(fmtA(v), v)}</span><span class="p" style="background:${ptsColor(x.p)}">+${gainedOf(x, k)}</span></div>`; }).join("");
  el.end.innerHTML = `<div class="screen">
    <p class="label">${PRACTICE ? "Practice · final reading" : `MeasureMe #${S.n} · final reading`}</p>
    <div class="share-wrap">
      <img class="card-img" id="cardImg" alt="MeasureMe results card: ${total.toLocaleString("en-US")} out of ${MAX.toLocaleString("en-US")}, ${title}.">
      <div class="share-side">
        <p class="rating">${title}</p>
        <p class="rating-sub">${sub}</p>
        <div class="actions">
          <button class="btn primary" type="button" id="shareScore">Share score</button>
          <button class="btn" type="button" id="copyImg">Copy image</button>
          ${PHONE.matches ? "" : '<button class="btn" type="button" id="saveImg">Save image</button>'}
          ${PRACTICE ? '<button class="btn" type="button" id="again">Play again</button>' : ""}
          <button class="btn" type="button" id="toMenu">Menu</button>
        </div>
        <p class="best share-hint" id="shareHint" role="status" hidden></p>
        <textarea class="share-box" id="shareBox" readonly hidden aria-label="Results to share"></textarea>
        ${statsHtml}
      </div>
    </div>
    <h3 class="recap-h">Your five readings</h3>
    <div class="recap">
      <div class="row head label"><span class="n">Question</span><span class="v">You said</span><span class="v">Actual</span><span class="v">Points</span></div>
      ${rows}
    </div>
  </div>`;
  show("end"); updateHeader();
  if (!rerender) window.scrollTo({ top: 0, behavior: RM ? "auto" : "smooth" });
  renderCard();
  [["shareScore", shareScore], ["copyImg", copyImage], ["saveImg", saveImage]]
    .forEach(([id, fn]) => { const b = $(id); if (b) b.addEventListener("click", () => { track(`share/${id}`); fn(b); }); });
  if (PRACTICE) $("again").addEventListener("click", newPractice);
  $("toMenu").addEventListener("click", showHome);
  if (!PRACTICE) { clearInterval(countdownId); countdown(); countdownId = setInterval(countdown, 1000); }
}

/* ---------- unit toggle ---------- */
function setSys(sys) {
  S.sys = sys; store.set("measureme.units", sys);
  document.querySelectorAll("[data-sys]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sys === sys)));
  if (S.phase === "guess") { const gB = S.view.inv(S.guess); S.view = view(S.picks[S.r][S.i], S.view.ext); paintChrome(); setGuess(S.view.c(gB)); }
  else if (S.phase === "reveal") { animId++; S.view = view(S.picks[S.r][S.i], S.view.ext); paintChrome(); paint(S.view.a, true); renderReveal(); }
  else if (S.phase === "end") showEnd(true);
}
document.querySelectorAll("[data-sys]").forEach(b => b.addEventListener("click", () => setSys(b.dataset.sys)));

/* ---------- start ---------- */
function newPractice() { startPractice(S.cat); }
$("lock").addEventListener("click", () => lock(false));
$("next").addEventListener("click", next);
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.target.closest("button, textarea, a")) return;
  if (S.phase === "guess") { lock(false); e.preventDefault(); }
  else if (S.phase === "reveal") { next(); e.preventDefault(); }
});

buildProgress();
document.querySelectorAll("[data-sys]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sys === S.sys)));
boot(); // profile.js: profile setup on first visit, otherwise the home menu
