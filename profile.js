/* MeasureMe profiles, home menu, stats and profile screens.
   Profiles live on this device in one JSON document ("measureme.v1") shaped like a future
   account record: { v, active, profiles: { id: { id, name, color, created, days, practice } } }.
   days[YYYY-MM-DD] = { n, res: [{ q, g, p, dir, to }], pending, done, score }. */
const PKEY = "measureme.v1";
const COLORS = ["#2446F5", "#E5484D", "#12A594", "#F76B15", "#8E4EC6", "#D6409F", "#0090FF", "#FFC23A"];
const CATS = [
  { id: "height", label: "Heights", test: it => it.k === "height" },
  { id: "length", label: "Lengths & distances", test: it => it.k === "length" },
  { id: "temp", label: "Temperatures", test: it => it.k === "temp" },
  { id: "weight", label: "Weights", test: it => it.m === "Weight" },
  { id: "speed", label: "Speeds", test: it => it.m === "Speed" },
  { id: "time", label: "Time & age", test: it => it.m === "Time" || it.m === "Age" }
];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDay = ds => new Date(ds + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/* ---------- data ---------- */
function loadDB() { const db = store.getJSON(PKEY); return db && db.profiles ? db : { v: 1, active: null, profiles: {} }; }
function saveDB(db) { store.setJSON(PKEY, db); }
function me() { const db = loadDB(); return db.profiles[db.active] || null; }
function updateMe(fn) { const db = loadDB(), p = db.profiles[db.active]; if (!p) return; fn(p); saveDB(db); }
function createProfile(name, color) {
  const db = loadDB(), id = Math.random().toString(36).slice(2, 10);
  const p = { id, name, color, created: new Date().toISOString(), days: {}, practice: { played: 0, best: 0, total: 0 } };
  if (!Object.keys(db.profiles).length) migrateLegacy(p); // the first profile inherits pre-profile progress
  db.profiles[id] = p; db.active = id; saveDB(db);
  track("profile-created");
  return p;
}
function migrateLegacy(p) {
  const d = store.getJSON("measureme.day5");
  if (!d || !d.date || !Array.isArray(d.res)) return;
  const done = d.res.length >= TOTAL;
  p.days[d.date] = { n: d.n, res: d.res, done, score: done ? d.res.reduce((a, x, k) => a + Math.round(x.p * MULT[k]), 0) : 0 };
}
function statsFor(p) {
  const done = Object.entries(p.days).filter(([, d]) => d.done).sort(([a], [b]) => (a < b ? -1 : 1));
  const scores = done.map(([, d]) => d.score);
  const day = new Date();
  if (!(p.days[localDate(day)] || {}).done) day.setDate(day.getDate() - 1); // today not played yet: count from yesterday
  let streak = 0;
  while ((p.days[localDate(day)] || {}).done) { streak++; day.setDate(day.getDate() - 1); }
  let maxStreak = 0, run = 0, prev = 0;
  done.forEach(([ds]) => { const t = Date.parse(ds + "T12:00:00Z"); run = prev && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1; maxStreak = Math.max(maxStreak, run); prev = t; });
  return { done, scores, played: done.length, streak, maxStreak, best: scores.length ? Math.max(...scores) : 0,
           avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0 };
}
function recordPractice(total) {
  updateMe(p => { p.practice.played++; p.practice.total += total; p.practice.best = Math.max(p.practice.best, total); });
}

/* ---------- practice ---------- */
function pickCategory(cat) {
  const tiers = ROUNDS.map(R => shuffle(R.items.filter(cat.test))), out = ROUNDS.map(() => []);
  ROUNDS.forEach((R, r) => { while (out[r].length < R.count && tiers[r].length) out[r].push(tiers[r].pop()); });
  const rest = shuffle(tiers.flat()); // a tier short on this category borrows from the others
  ROUNDS.forEach((R, r) => { while (out[r].length < R.count && rest.length) out[r].push(rest.pop()); });
  return out;
}
function startPractice(cat) {
  PRACTICE = true; S.cat = cat || null;
  S.picks = cat ? pickCategory(cat) : ROUNDS.map(R => pickRound(R.items, R.count));
  S.results = []; S.score = 0; S.resumeAt = 0; S.pending = null;
  showStart(0);
}

/* ---------- screens ---------- */
function paintWho() {
  const p = me();
  $("whoName").textContent = p ? p.name : "Profile";
  $("whoDot").style.background = p ? p.color : "var(--line)";
}
function leaveGame(to) {
  if (S.phase === "guess" && !PRACTICE && !confirm("Leave this question? Its 30-second clock keeps running.")) return;
  stopTimer(); animId++; to();
}
function showHome() {
  const p = me();
  if (!p) return showProfileEditor("first");
  stopTimer(); PRACTICE = false; S.cat = null; S.phase = "home";
  S.date = localDate(); S.n = dayNum(S.date); S.picks = dailyPicks(S.n);
  const done = restore(), d = p.days[S.date] || {}, st = statsFor(p);
  const open = S.resumeAt > Date.now(); // a question was opened and its clock is still running
  const status = d.done ? `You scored <b>${d.score.toLocaleString("en-US")}</b>. Next puzzle in <b class="countdown" id="countdown">--:--:--</b>`
    : open ? `Question ${done + 1} of ${TOTAL} is open, and its clock is still running.`
    : done ? `In progress: question ${Math.min(done + 1, TOTAL)} of ${TOTAL}. The clock kept running on any question you left.`
    : "Five measurements, each worth more than the last. 30 seconds each.";
  const action = d.done || done >= TOTAL ? "See results" : done || open ? "Resume" : "Play today’s puzzle";
  el.home.innerHTML = `<div class="home">
    <p class="hello">Hi, ${esc(p.name)}.</p>
    <div class="tiles">
      <article class="tile daily">
        <p class="label">Daily puzzle · ${fmtDay(S.date)}</p>
        <h2>#${S.n}</h2>
        <p>${status}</p>
        <div class="actions"><button class="btn primary" type="button" id="hDaily">${action}</button></div>
      </article>
      <article class="tile">
        <h3>Random practice</h3>
        <p>Five random questions from the whole bank. Doesn’t touch your streak.</p>
        <div class="actions"><button class="btn" type="button" id="hPractice">Start practice</button></div>
      </article>
      <article class="tile">
        <h3>Category practice</h3>
        <p>Pick a kind of measurement and drill it.</p>
        <div class="chips">${CATS.map(c => `<button class="chip-btn" type="button" data-cat="${c.id}">${c.label}</button>`).join("")}</div>
      </article>
      <article class="tile wide">
        <h3>Your stats</h3>
        <div class="mini-stats">
          <div><span class="label">Streak</span><b>${st.streak}</b></div>
          <div><span class="label">Played</span><b>${st.played}</b></div>
          <div><span class="label">Average</span><b>${st.avg.toLocaleString("en-US")}</b></div>
          <div><span class="label">Best</span><b>${st.best.toLocaleString("en-US")}</b></div>
        </div>
        <div class="actions"><button class="btn" type="button" id="hStats">Stats &amp; history</button></div>
      </article>
    </div>
  </div>`;
  show("home"); updateHeader(); paintWho();
  window.scrollTo({ top: 0, behavior: "auto" });
  $("hDaily").addEventListener("click", () => (d.done || done >= TOTAL ? showEnd(!!d.done) : showStart(done)));
  $("hPractice").addEventListener("click", () => startPractice(null));
  document.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => startPractice(CATS.find(c => c.id === b.dataset.cat))));
  $("hStats").addEventListener("click", showStats);
  clearInterval(countdownId);
  if (d.done) { countdown(); countdownId = setInterval(countdown, 1000); }
}
function showStats() {
  stopTimer(); S.phase = "stats";
  const p = me(), st = statsFor(p), buckets = [0, 0, 0, 0, 0];
  st.scores.forEach(s => buckets[Math.min(4, Math.floor(s / 200))]++);
  const maxB = Math.max(1, ...buckets), labels = ["0–199", "200–399", "400–599", "600–799", "800–1,000"];
  const hist = st.done.slice().reverse().map(([ds, d]) => `<div class="hrow">
      <span class="label">#${d.n}</span><span>${fmtDay(ds)}</span>
      <span class="hcells">${(d.res || []).map(x => `<span style="background:${ptsColor(x.p)}" title="${x.p}/100"></span>`).join("")}</span>
      <b>${d.score.toLocaleString("en-US")}</b></div>`).join("");
  el.stats.innerHTML = `<div class="screen">
    <p class="label">${esc(p.name)} · stats on this device</p>
    <div class="stats">
      <div><span class="label">Played</span><b>${st.played}</b></div>
      <div><span class="label">Streak</span><b>${st.streak}</b></div>
      <div><span class="label">Best streak</span><b>${st.maxStreak}</b></div>
      <div><span class="label">Average</span><b>${st.avg.toLocaleString("en-US")}</b></div>
      <div><span class="label">Best</span><b>${st.best.toLocaleString("en-US")}</b></div>
    </div>
    <h3 class="recap-h">Daily scores</h3>
    <div class="dist">${buckets.map((b, i) => `<div class="dist-row"><span>${labels[i]}</span><span class="dist-track"><i class="dist-bar" style="width:${(b / maxB * 100).toFixed(1)}%"></i></span><span>${b}</span></div>`).join("")}</div>
    <h3 class="recap-h">History</h3>
    <div class="hist">${hist || '<p class="rating-sub">No daily puzzles finished yet. Today’s is waiting.</p>'}</div>
    <p class="best">Practice: ${p.practice.played} game${p.practice.played === 1 ? "" : "s"} · best ${p.practice.best.toLocaleString("en-US")}</p>
    <div class="actions"><button class="btn" type="button" id="back">Menu</button></div>
  </div>`;
  show("stats"); window.scrollTo({ top: 0, behavior: "auto" });
  $("back").addEventListener("click", showHome);
}
// mode: "first" (no profiles yet), "new" (add another), or undefined (edit the active profile)
function showProfileEditor(mode) {
  stopTimer(); S.phase = "profile";
  const db = loadDB(), cur = mode ? null : db.profiles[db.active];
  let color = cur ? cur.color : COLORS[Object.keys(db.profiles).length % COLORS.length];
  const others = Object.values(db.profiles).filter(p => !cur || p.id !== cur.id);
  el.profile.innerHTML = `<div class="screen">
    <p class="label">${mode === "first" ? "Welcome to MeasureMe" : mode === "new" ? "New profile" : "Profile"}</p>
    <h2 class="round-big profile-h">${cur ? "Your profile" : "Who’s playing?"}</h2>
    <div class="field"><label class="label" for="pName">Name</label>
      <input id="pName" maxlength="20" autocomplete="nickname" placeholder="Your name" value="${cur ? esc(cur.name) : ""}"></div>
    <div class="field"><span class="label">Color</span>
      <div class="swatches">${COLORS.map(c => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-label="Color ${c}" aria-pressed="${c === color}"></button>`).join("")}</div></div>
    <p class="best" id="pErr" hidden>Enter a name to continue.</p>
    <div class="actions">
      <button class="btn primary" type="button" id="pSave">${cur ? "Save" : "Create profile"}</button>
      ${mode === "first" ? "" : '<button class="btn" type="button" id="back">Menu</button>'}
    </div>
    ${cur ? `<h3 class="recap-h">Profiles on this device</h3>
    <div class="plist">
      ${others.map(p => `<div class="prow"><i style="background:${p.color}"></i><span class="grow">${esc(p.name)}</span><button class="btn" type="button" data-switch="${p.id}">Switch</button></div>`).join("")}
      <div class="prow"><span class="grow">Someone else playing on this device?</span><button class="btn" type="button" id="pAdd">Add profile</button></div>
    </div>
    <div class="actions"><button class="btn danger" type="button" id="pDel">Delete ${esc(cur.name)}’s profile</button></div>` : ""}
    <p class="rating-sub small">Profiles are saved in this browser for now. Accounts that sync across your devices are on the way.</p>
  </div>`;
  show("profile"); window.scrollTo({ top: 0, behavior: "auto" });
  const input = $("pName");
  document.querySelectorAll(".swatch").forEach(b => b.addEventListener("click", () => {
    color = b.dataset.c;
    document.querySelectorAll(".swatch").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  }));
  const submit = () => {
    const name = input.value.trim();
    if (!name) { $("pErr").hidden = false; input.focus(); return; }
    if (cur) updateMe(p => { p.name = name; p.color = color; }); else createProfile(name, color);
    paintWho(); showHome();
  };
  $("pSave").addEventListener("click", submit);
  input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  if ($("back")) $("back").addEventListener("click", showHome);
  if (cur) {
    document.querySelectorAll("[data-switch]").forEach(b => b.addEventListener("click", () => {
      const d = loadDB(); d.active = b.dataset.switch; saveDB(d); paintWho(); showHome();
    }));
    $("pAdd").addEventListener("click", () => showProfileEditor("new"));
    $("pDel").addEventListener("click", () => {
      if (!confirm(`Delete ${cur.name}’s profile and all of its stats? This can’t be undone.`)) return;
      const d = loadDB(); delete d.profiles[cur.id]; d.active = Object.keys(d.profiles)[0] || null; saveDB(d);
      paintWho(); d.active ? showHome() : showProfileEditor("first");
    });
  }
  if (!cur) input.focus({ preventScroll: true });
}

/* ---------- boot ---------- */
function boot() {
  $("homeLink").addEventListener("click", e => { e.preventDefault(); leaveGame(showHome); });
  $("whoBtn").addEventListener("click", () => leaveGame(() => showProfileEditor()));
  paintWho();
  if (!me()) return showProfileEditor("first");
  if (/[?&]practice\b/.test(location.search)) startPractice(null); else showHome();
}
