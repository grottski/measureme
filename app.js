/* MeasureMe game logic. Questions live in questions.js (global ROUNDS). */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};
const RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const PHONE = window.matchMedia("(max-width:640px)");
const SKIN = { temp: "thermo", height: "rod", length: "tape", other: "cyl" };
const MAX = ROUNDS.reduce((s, R) => s + R.pts, 0);
const OFF = ROUNDS.map((R, r) => ROUNDS.slice(0, r).reduce((s, x) => s + x.count, 0));

const S = { r: 0, i: 0, picks: [], guess: 0, phase: "guess", results: [], score: 0 };
const el = {};
["gauge", "rail", "ticks", "ghost", "handleTxt", "guessOut", "actualOut", "guessPane", "revealPane", "game", "inter", "end"].forEach(id => el[id] = $(id));
const cur = () => S.picks[S.r][S.i];
const idx = () => OFF[S.r] + S.i;
const roundRes = r => S.results.slice(OFF[r], OFF[r] + ROUNDS[r].count);

/* ---------- per-question scale ---------- */
const L10 = Math.log10;
const toT = (v, it = cur()) => it.log
  ? (L10(Math.max(v, it.min)) - L10(it.min)) / (L10(it.max) - L10(it.min))
  : (v - it.min) / (it.max - it.min);
const fromT = (t, it = cur()) => it.log
  ? Math.pow(10, L10(it.min) + t * (L10(it.max) - L10(it.min)))
  : it.min + t * (it.max - it.min);
function nice(x) { const e = Math.pow(10, Math.floor(L10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }
// Snap step: 1/10 of a tick on linear gauges; 3 significant figures on log gauges.
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
const answerDec = a => { const s = String(a); return s.includes(".") ? s.split(".")[1].length : 0; };
const fmtV = (v, it = cur()) => num(v, decimalsFor(stepAt(v, it)));
const fmtA = (it = cur()) => num(it.a, answerDec(it.a));
const withUnit = (s, it = cur()) => `${s}<small>${it.u}</small>`;
const plain = (s, it = cur()) => `${s}${it.u.startsWith("°") ? "" : " "}${it.u}`;
function compact(v) {
  const a = Math.abs(v); let s;
  if (a >= 1e6) s = +(a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  else if (a >= 1e4) s = Math.round(a / 1000) + "k";
  else if (a >= 1000) s = +(a / 1000).toFixed(1) + "k";
  else if (a >= 10 || a === 0) s = String(Math.round(a));
  else if (a >= 1) s = String(+a.toFixed(1));
  else s = String(+a.toPrecision(1));
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
  const it = cur();
  if (it.log) { const f = big ? 1.25 : 1.02; setGuess(dir > 0 ? S.guess * f : S.guess / f); return; }
  const s = stepAt(S.guess) * (big ? 10 : 1);
  setGuess(Math.round(S.guess / s) * s + dir * s);
}

/* ---------- input ---------- */
let dragging = false;
function fromPointer(y) {
  const r = el.rail.getBoundingClientRect();
  setGuess(fromT(clamp(1 - (y - r.top) / r.height, 0, 1)));
}
el.gauge.addEventListener("pointerdown", e => {
  if (S.phase !== "guess") return;
  dragging = true; el.gauge.setPointerCapture(e.pointerId);
  fromPointer(e.clientY); el.gauge.focus({ preventScroll: true }); e.preventDefault();
});
el.gauge.addEventListener("pointermove", e => { if (dragging) fromPointer(e.clientY); });
["pointerup", "pointercancel"].forEach(ev => el.gauge.addEventListener(ev, () => { dragging = false; }));
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

/* ---------- flow ---------- */
function shuffle(a) { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; }
// Prefer a different kind of measurement for each question in a round.
function pickRound(items, count) {
  const pool = shuffle(items.slice()), out = [], seen = new Set();
  pool.forEach(it => { if (out.length < count && !seen.has(it.m)) { out.push(it); seen.add(it.m); } });
  pool.forEach(it => { if (out.length < count && !out.includes(it)) out.push(it); });
  return out;
}
const ptsColor = p => `color-mix(in srgb, var(--accent) ${Math.round(15 + p * 0.85)}%, #8A98A5)`;
function buildProgress() {
  $("prog").innerHTML = ROUNDS.map((R, r) => `<div class="grp">${Array.from({ length: R.count }, (_, i) => `<span class="cell" data-k="${OFF[r] + i}"></span>`).join("")}</div>`).join("");
}
function updateHeader() {
  document.querySelectorAll(".cell").forEach(c => {
    const k = +c.dataset.k, res = S.results[k];
    c.style.background = res ? ptsColor(res.p) : "";
    c.classList.toggle("now", S.phase === "guess" && k === idx());
  });
  $("score").textContent = Math.round(S.score).toLocaleString("en-US");
}
function show(section) { ["game", "inter", "end"].forEach(s => el[s].hidden = s !== section); }

function newGame(first) {
  S.picks = ROUNDS.map(R => pickRound(R.items, R.count));
  S.r = 0; S.i = 0; S.results = []; S.score = 0;
  showItem(first);
}
function showItem(first) {
  const it = cur(), R = ROUNDS[S.r];
  S.phase = "guess"; show("game");
  el.guessPane.hidden = false; el.revealPane.hidden = true; el.ghost.hidden = true;
  el.gauge.className = "gauge skin-" + SKIN[it.k];
  $("eyeRound").textContent = `Round ${S.r + 1} · ${R.name} · ${R.pts} pts`;
  $("eyeItem").textContent = `Item ${S.i + 1} of ${R.count}`;
  $("itemName").textContent = it.q;
  $("itemHint").textContent = it.h;
  $("plateUnit").textContent = it.u;
  $("plateKind").textContent = it.m;
  $("plateRange").textContent = `Gauge ${compact(it.min)}–${compact(it.max)} ${it.u}${it.log ? " · log scale" : ""}`;
  el.gauge.setAttribute("aria-valuemin", it.min);
  el.gauge.setAttribute("aria-valuemax", it.max);
  renderTicks(it);
  setGuess(it.min); // gauges start at rest, so an untouched guess scores near zero
  updateHeader();
  if (!first) { window.scrollTo({ top: 0, behavior: RM ? "auto" : "smooth" }); el.gauge.focus({ preventScroll: true }); }
}

// Scored by distance along the gauge, so every unit and scale is judged the same way.
function points(g, it) {
  const d = Math.abs(toT(g, it) - toT(it.a, it));
  return Math.round(100 / (1 + Math.pow(d / 0.1, 2.2)));
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
function lock() {
  if (S.phase !== "guess") return;
  const it = cur(), g = S.guess, p = points(g, it), dir = g > it.a ? "high" : "low";
  S.results[idx()] = { it, g, p, gained: p, dir, v: verdictFor(p, dir) };
  S.score += p;
  S.phase = "reveal";
  el.gauge.classList.add("locked");
  el.gauge.style.setProperty("--tg", clamp(toT(g), 0, 1).toFixed(5));
  el.ghost.hidden = false;
  el.guessPane.hidden = true; el.revealPane.hidden = false;
  renderReveal();
  const R = ROUNDS[S.r];
  $("next").textContent = S.i < R.count - 1 ? "Next item" : S.r < ROUNDS.length - 1 ? `On to Round ${S.r + 2}` : "See my final score";
  $("next").focus({ preventScroll: true });
  updateHeader();
  animate(g, it.a);
  if (PHONE.matches) document.querySelector(".item").scrollIntoView({ block: "start", behavior: RM ? "auto" : "smooth" });
}
function renderReveal() {
  const res = S.results[idx()], it = res.it, d = Math.abs(res.g - it.a);
  $("ptsOut").textContent = "+" + res.p;
  $("ptsMath").textContent = "out of 100";
  $("verdict").textContent = res.v;
  $("delta").textContent = d === 0 ? `You said ${plain(fmtV(res.g))}. Exactly right.` : `You said ${plain(fmtV(res.g))}: ${plain(num(d, Math.max(decimalsFor(stepAt(res.g)), answerDec(it.a))))} too ${res.dir}.`;
  $("fact").textContent = it.x;
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
  if (S.i < ROUNDS[S.r].count - 1) { S.i++; showItem(); }
  else if (S.r < ROUNDS.length - 1) showInter();
  else showEnd();
}
const roundScore = r => roundRes(r).reduce((s, x) => s + (x ? x.gained : 0), 0);

function showInter() {
  S.phase = "inter";
  const nr = S.r + 1, R = ROUNDS[nr];
  el.inter.innerHTML = `<div class="screen">
    <p class="label">Round ${S.r + 1} done · ${roundScore(S.r)} points banked</p>
    <h2 class="round-big">Round ${nr + 1}</h2>
    <p class="round-name">${R.name} <span class="chip">${R.count} items · ${R.pts} pts</span></p>
    <p class="blurb">${R.blurb}</p>
    <ol class="ladder">${ROUNDS.map((x, k) => `<li class="${k < nr ? "done" : k === nr ? "next" : "later"}"><b>${x.name}</b><span>${k < nr ? roundScore(k) + " of " + x.pts + " pts" : k === nr ? "Up next · " + x.pts + " pts" : x.pts + " pts"}</span></li>`).join("")}</ol>
    <div class="actions"><button class="btn primary" type="button" id="go">Start Round ${nr + 1}</button></div>
  </div>`;
  show("inter"); updateHeader();
  window.scrollTo({ top: 0, behavior: RM ? "auto" : "smooth" });
  $("go").addEventListener("click", () => { S.r = nr; S.i = 0; showItem(); });
  $("go").focus({ preventScroll: true });
}

function rating(s) {
  if (s >= 900) return ["Master Calibrator", "Your eyes are basically laser rangefinders."];
  if (s >= 750) return ["Precision Instrument", "A few readings off, most dead on."];
  if (s >= 600) return ["Steady Hand", "Solid instincts with the odd wild guess."];
  if (s >= 450) return ["Rough Estimate", "You know a hoop from a skyscraper. Mostly."];
  if (s >= 250) return ["Eyeballer", "Somewhere between a guess and a vibe."];
  return ["Uncalibrated", "The gauge needs a word with you. Run it back?"];
}
const square = p => p >= 85 ? "🟦" : p >= 60 ? "🟩" : p >= 30 ? "🟨" : "⬜";
let isNewBest = false;
function showEnd() {
  S.phase = "end";
  const total = Math.round(S.score), prev = parseInt(store.get("measureme.best") || "0", 10) || 0;
  isNewBest = total > prev;
  if (isNewBest) store.set("measureme.best", String(total));
  const [title, sub] = rating(total);
  const rows = ROUNDS.map((R, r) => `<div class="row sub label">Round ${r + 1} · ${R.name} · ${roundScore(r)} of ${R.pts} pts</div>` +
    roundRes(r).map(x => `<div class="row"><span class="n">${x.it.q}</span><span class="v">${plain(fmtV(x.g, x.it), x.it)}</span><span class="v">${plain(fmtA(x.it), x.it)}</span><span class="p" style="background:${ptsColor(x.p)}">+${x.p}</span></div>`).join("")).join("");
  el.end.innerHTML = `<div class="screen">
    <p class="label">Final reading</p>
    <div class="final"><span class="final-num" style="font-variation-settings:'wdth' ${Math.round(62 + total / MAX * 63)}">${total.toLocaleString("en-US")}</span><span class="final-of">/ ${MAX.toLocaleString("en-US")}</span></div>
    <p class="rating">${title}</p>
    <p class="rating-sub">${sub}</p>
    <p class="best">${isNewBest ? "<b>New personal best.</b>" : "Personal best: " + Math.max(total, prev).toLocaleString("en-US")}</p>
    <div class="actions">
      <button class="btn primary" type="button" id="again">Play again</button>
      <button class="btn" type="button" id="share">${navigator.share && PHONE.matches ? "Share my results" : "Copy my results"}</button>
    </div>
    <textarea class="share-box" id="shareBox" readonly hidden aria-label="Results to share"></textarea>
    <h3 class="recap-h">Your ten readings</h3>
    <div class="recap">
      <div class="row head label"><span class="n">Question</span><span class="v">You said</span><span class="v">Actual</span><span class="v">Points</span></div>
      ${rows}
    </div>
  </div>`;
  show("end"); updateHeader();
  window.scrollTo({ top: 0, behavior: RM ? "auto" : "smooth" });
  $("again").addEventListener("click", () => newGame());
  $("share").addEventListener("click", share);
  $("again").focus({ preventScroll: true });
}
async function share() {
  const total = Math.round(S.score);
  const lines = ROUNDS.map((R, r) => R.name.padEnd(12, " ") + roundRes(r).map(x => square(x.p)).join(""));
  const text = `MeasureMe: ${total.toLocaleString("en-US")} / ${MAX.toLocaleString("en-US")} (${rating(total)[0]})\n${lines.join("\n")}`;
  const url = /^https?:/.test(location.protocol) ? location.origin + location.pathname.replace(/index\.html$/, "") : "";
  const btn = $("share");
  if (navigator.share && PHONE.matches) {
    try { await navigator.share(url ? { text, url } : { text }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  const full = url ? `${text}\n${url}` : text;
  try { await navigator.clipboard.writeText(full); btn.textContent = "Copied to clipboard"; }
  catch (e) { const box = $("shareBox"); box.value = full; box.hidden = false; box.focus(); box.select(); btn.textContent = "Copy the text below"; }
}

$("lock").addEventListener("click", lock);
$("next").addEventListener("click", next);
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.target.closest("button, textarea")) return;
  if (S.phase === "guess") { lock(); e.preventDefault(); }
  else if (S.phase === "reveal") { next(); e.preventDefault(); }
});

buildProgress();
newGame(true);
