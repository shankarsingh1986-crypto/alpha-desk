/* Core: data layer (Firebase realtime or demo), calculations, helpers */
(function () {
  const CFG = window.APP_CONFIG || {};
  const fb = CFG.firebase || {};
  const LIVE = !!(fb.apiKey && !/^PASTE/.test(fb.apiKey) && fb.projectId && window.firebase);

  const VIEWS = { ST: "ST – Swing Trading", LT: "LT – 1/2 Months", PF: "Portfolio Share" };
  const VIEW_SHORT = { ST: "Swing", LT: "1–2 Months", PF: "Portfolio" };
  const STATUS = {
    BUY: { label: "BUY", cls: "buy" },
    HOLD: { label: "HOLD", cls: "hold" },
    TARGET: { label: "TARGET HIT", cls: "win" },
    EXIT: { label: "EXIT", cls: "exit" }
  };

  /* ---------- starter data: your calls as on 08 Oct 2026 ---------- */
  const SEED = [
    { date: "2026-09-21", share: "HTEL", view: "LT", status: "EXIT", cmp: 72.8, target: "Not given (new listing)", entry: 72.5, exit: 92, exitDate: "2026-10-07" },
    { date: "2026-09-21", share: "MVELECTRO", view: "ST", status: "TARGET", cmp: 861, target: "900+", entry: 861, exit: 975, exitDate: "2026-09-22" },
    { date: "2026-09-21", share: "BAJAJHFL", view: "PF", status: "HOLD", cmp: 82, target: "170+ (6M–1Y)", entry: 83.1 },
    { date: "2026-09-21", share: "AHCL", view: "ST", status: "EXIT", cmp: 23.5, target: "50+", entry: 23.5, exit: 29, exitDate: "2026-09-23" },
    { date: "2026-09-21", share: "AHCL", view: "ST", status: "EXIT", cmp: 26, target: "50+", entry: 26, exit: 29, exitDate: "2026-09-23", note: "2nd entry" },
    { date: "2026-09-21", share: "GROWW", view: "ST", status: "HOLD", cmp: 190, target: "205+", entry: 190 },
    { date: "2026-09-25", share: "GROWW", view: "ST", status: "HOLD", cmp: 185, target: "205+", entry: 184, note: "2nd entry" },
    { date: "2026-09-22", share: "LLOYDSENGG", view: "PF", status: "EXIT", cmp: 85, target: "150+ (6M–1Y)", entry: 86.5, exit: 102, exitDate: "2026-10-05" },
    { date: "2026-09-22", share: "FEDDERSHOL", view: "ST", status: "EXIT", cmp: 70, target: "80+", entry: 70.8, exit: 76, exitDate: "2026-10-05" },
    { date: "2026-09-22", share: "KILBURN ENGG", view: "ST", status: "HOLD", cmp: 512, target: "575+", entry: 515 },
    { date: "2026-09-23", share: "KROSS", view: "LT", status: "HOLD", cmp: 280, target: "375+", entry: 280, note: "Accumulate 260–267" },
    { date: "2026-09-25", share: "FCL", view: "ST", status: "HOLD", cmp: 58.5, target: "75 / 100+", entry: 58 },
    { date: "2026-10-07", share: "KMCSHIL", view: "LT", status: "BUY", cmp: 180, target: "230+", entry: 181 },
    { date: "2026-10-07", share: "IOLCP", view: "LT", status: "BUY", cmp: 210, target: "250+", entry: 213.29 },
    { date: "2026-10-07", share: "SUNFLAG", view: "ST", status: "BUY", cmp: 450, target: "550+", entry: 451.6 }
  ];

  /* ---------- helpers ---------- */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (v === "" || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const inr = v => v == null ? "—" : "₹" + (+v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctTxt = v => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = iso => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${+d} ${MON[+m - 1]} ${y}`; };
  const ago = ts => {
    if (!ts) return "";
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " hr ago";
    const d = Math.floor(s / 86400); return d + (d === 1 ? " day ago" : " days ago");
  };
  const daysBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));

  function enrich(c) {
    const closed = c.status === "EXIT" || c.status === "TARGET";
    const entry = num(c.entry), exit = num(c.exit), cmp = num(c.cmp);
    const m = String(c.target || "").replace(/,/g, "").match(/\d+(\.\d+)?/);
    const tNum = m ? +m[0] : null;
    const ref = closed ? exit : cmp;
    const pnl = (ref != null && entry) ? ref - entry : null;
    const pct = pnl != null ? pnl / entry * 100 : null;
    const days = daysBetween(c.date, closed ? (c.exitDate || c.date) : todayISO());
    let progress = null;
    if (tNum && entry && tNum > entry && ref != null) progress = Math.max(0, Math.min(1, (ref - entry) / (tNum - entry)));
    const upside = (!closed && tNum && (cmp || entry)) ? (tNum - (cmp || entry)) / (cmp || entry) * 100 : null;
    return { ...c, entry, exit, cmp, closed, tNum, pnl, pct, days, progress, upside, win: closed ? (pct > 0) : null, label: c.share + (c.note && /entry/i.test(c.note) ? " · " + c.note : "") };
  }

  function stats(list) {
    const closed = list.filter(c => c.closed && c.pct != null);
    const active = list.filter(c => !c.closed);
    const wins = closed.filter(c => c.pct > 0);
    const avg = closed.length ? closed.reduce((s, c) => s + c.pct, 0) / closed.length : 0;
    const avgDays = closed.length ? closed.reduce((s, c) => s + c.days, 0) / closed.length : 0;
    const best = [...closed].sort((a, b) => b.pct - a.pct);
    return { total: list.length, active: active.length, closed: closed.length, wins: wins.length, losses: closed.length - wins.length, winRate: closed.length ? wins.length / closed.length * 100 : 0, avg, avgDays, best };
  }

  /* ---------- activity text from a change ---------- */
  function describe(nc, oc) {
    const e = enrich(nc);
    if (!oc) return { type: "new", text: `New ${nc.status === "BUY" ? "BUY" : STATUS[nc.status]?.label || ""} call: ${nc.share} at ${inr(nc.entry)} · Target ${nc.target || "—"}` };
    const out = [];
    if (nc.status !== oc.status) {
      if (e.closed) out.push({ type: e.pct >= 0 ? "win" : "loss", text: `${nc.share} ${nc.status === "TARGET" ? "target achieved" : "exited"} at ${inr(nc.exit)} · ${pctTxt(e.pct)} in ${e.days} day${e.days === 1 ? "" : "s"}` });
      else out.push({ type: "status", text: `${nc.share} status changed to ${STATUS[nc.status].label}` });
    }
    if (String(nc.target || "") !== String(oc.target || "")) out.push({ type: "target", text: `${nc.share} target revised: ${oc.target || "—"} → ${nc.target || "—"}` });
    if (!out.length && (num(nc.entry) !== num(oc.entry) || num(nc.exit) !== num(oc.exit) || nc.note !== oc.note)) out.push({ type: "edit", text: `${nc.share} call details updated` });
    return out.length ? out[0] : null;
  }

  /* ---------- data layer ---------- */
  const subs = { calls: [], activity: [], settings: [], auth: [], denied: [] };
  const emit = (k, v) => subs[k].forEach(f => f(v));
  const DB = { live: LIVE };

  if (LIVE) {
    firebase.initializeApp(fb);
    const fs = firebase.firestore(), auth = firebase.auth();
    let cache = {}, unsubs = [];
    const denied = e => { console.warn(e); emit("denied", e); };
    const ADMIN = (CFG.adminEmail || "").toLowerCase();
    DB.isAdmin = u => !!u && !!u.email && u.email.toLowerCase() === ADMIN;
    DB.start = () => {
      if (unsubs.length) return;
      unsubs.push(fs.collection("calls").onSnapshot(s => { cache = {}; const arr = s.docs.map(d => (cache[d.id] = { id: d.id, ...d.data() })); emit("calls", arr); }, denied));
      unsubs.push(fs.collection("activity").orderBy("ts", "desc").limit(40).onSnapshot(s => emit("activity", s.docs.map(d => ({ id: d.id, ...d.data() }))), denied));
      unsubs.push(fs.doc("meta/settings").onSnapshot(d => emit("settings", d.exists ? d.data() : {}), denied));
    };
    DB.stop = () => { unsubs.forEach(f => f()); unsubs = []; };
    auth.onAuthStateChanged(u => emit("auth", u ? { uid: u.uid, email: u.email, name: u.displayName || (u.email || "").split("@")[0], photo: u.photoURL || "" } : null));

    /* members */
    DB.onMember = (uid, cb) => fs.collection("members").doc(uid).onSnapshot(d => cb(d.exists ? d.data() : null), () => cb(null));
    DB.ensureMember = async u => {
      const ref = fs.collection("members").doc(u.uid);
      const d = await ref.get();
      if (!d.exists) await ref.set({ email: u.email || "", name: u.name || "", status: "pending", validTill: 0, createdAt: Date.now() });
    };
    DB.onMembers = cb => fs.collection("members").onSnapshot(s => cb(s.docs.map(d => ({ uid: d.id, ...d.data() }))), denied);
    DB.updateMember = (uid, data) => fs.collection("members").doc(uid).set({ ...data, updatedAt: Date.now() }, { merge: true });
    DB.deleteMember = uid => fs.collection("members").doc(uid).delete();
    DB.signInGoogle = async () => {
      const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
      try { await auth.signInWithPopup(p); }
      catch (e) { if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") await auth.signInWithRedirect(p); else throw e; }
    };
    DB.signUpEmail = async (e, p, name) => { const r = await auth.createUserWithEmailAndPassword(e, p); if (name) await r.user.updateProfile({ displayName: name }); };
    DB.resetPassword = e => auth.sendPasswordResetEmail(e);
    DB.saveCall = async (c) => {
      const old = c.id ? cache[c.id] : null;
      const data = { ...c, updatedAt: Date.now() }; delete data.id;
      const act = describe(c, old);
      if (c.id) await fs.collection("calls").doc(c.id).set(data); else await fs.collection("calls").add({ ...data, createdAt: Date.now() });
      if (act) await fs.collection("activity").add({ ...act, ts: Date.now() });
    };
    DB.deleteCall = async id => { await fs.collection("calls").doc(id).delete(); };
    DB.updateActivity = (id, text) => fs.collection("activity").doc(id).update({ text });
    DB.deleteActivity = id => fs.collection("activity").doc(id).delete();
    DB.clearActivity = async () => { const s = await fs.collection("activity").get(); const b = fs.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit(); };
    DB.setAnnouncement = async text => { await fs.doc("meta/settings").set({ announcement: text, announcedAt: Date.now() }, { merge: true }); if (text) await fs.collection("activity").add({ type: "announce", text, ts: Date.now() }); };
    DB.seed = async () => { const b = fs.batch(); const t = Date.now(); SEED.forEach((c, i) => b.set(fs.collection("calls").doc(), { ...c, note: c.note || "", createdAt: t - i, updatedAt: t - i })); b.set(fs.collection("activity").doc(), { type: "announce", text: "Track record published. Every call is now live on the desk.", ts: t }); await b.commit(); };
    DB.login = (e, p) => auth.signInWithEmailAndPassword(e, p);
    DB.logout = () => auth.signOut();
  } else {
    const KEY = "ssad_demo_v1";
    const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.calls) return v; } catch (e) {} return null; };
    const seedState = () => {
      const t = Date.now();
      const calls = SEED.map((c, i) => ({ id: "c" + (i + 1), note: "", ...c, createdAt: t - i * 1000, updatedAt: Date.parse((c.exitDate || c.date) + "T10:00:00") }));
      const activity = [
        { id: "a1", type: "new", text: "New BUY call: SUNFLAG at ₹451.60 · Target 550+", ts: Date.parse("2026-10-07T10:15:00") },
        { id: "a2", type: "new", text: "New BUY call: IOLCP at ₹213.29 · Target 250+", ts: Date.parse("2026-10-07T10:05:00") },
        { id: "a3", type: "new", text: "New BUY call: KMCSHIL at ₹181.00 · Target 230+", ts: Date.parse("2026-10-07T09:55:00") },
        { id: "a4", type: "win", text: "HTEL exited at ₹92.00 · +26.90% in 16 days", ts: Date.parse("2026-10-07T09:40:00") },
        { id: "a5", type: "win", text: "LLOYDSENGG exited at ₹102.00 · +17.92% in 13 days", ts: Date.parse("2026-10-05T14:20:00") },
        { id: "a6", type: "win", text: "FEDDERSHOL exited at ₹76.00 · +7.34% in 13 days", ts: Date.parse("2026-10-05T13:10:00") },
        { id: "a7", type: "win", text: "AHCL exited at ₹29.00 · +23.40% in 2 days", ts: Date.parse("2026-09-23T11:30:00") },
        { id: "a8", type: "win", text: "MVELECTRO target achieved at ₹975.00 · +13.24% in 1 day", ts: Date.parse("2026-09-22T12:00:00") }
      ];
      return { calls, activity, settings: {} };
    };
    let st = load() || seedState();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
    const push = () => { emit("calls", st.calls.slice()); emit("activity", st.activity.slice().sort((a, b) => b.ts - a.ts).slice(0, 40)); emit("settings", { ...st.settings }); };
    save();
    window.addEventListener("storage", e => { if (e.key === KEY) { st = load() || st; push(); } });
    const addAct = a => st.activity.unshift({ id: "a" + Date.now() + Math.random().toString(36).slice(2, 5), ...a, ts: Date.now() });
    DB.saveCall = async c => {
      const i = c.id ? st.calls.findIndex(x => x.id === c.id) : -1;
      const old = i >= 0 ? st.calls[i] : null;
      const act = describe(c, old);
      const rec = { ...c, id: c.id || "c" + Date.now(), updatedAt: Date.now(), createdAt: old ? old.createdAt : Date.now() };
      if (i >= 0) st.calls[i] = rec; else st.calls.push(rec);
      if (act) addAct(act);
      save(); push();
    };
    DB.deleteCall = async id => { st.calls = st.calls.filter(x => x.id !== id); save(); push(); };
    DB.updateActivity = async (id, text) => { const a = st.activity.find(x => x.id === id); if (a) a.text = text; save(); push(); };
    DB.deleteActivity = async id => { st.activity = st.activity.filter(x => x.id !== id); save(); push(); };
    DB.clearActivity = async () => { st.activity = []; save(); push(); };
    DB.setAnnouncement = async text => { st.settings = { announcement: text, announcedAt: Date.now() }; if (text) addAct({ type: "announce", text }); save(); push(); };
    DB.seed = async () => { st = seedState(); save(); push(); };
    DB.login = async () => {};
    DB.logout = async () => {};
    DB.start = () => {}; DB.stop = () => {};
    DB.isAdmin = () => true;
    setTimeout(() => { push(); emit("auth", { email: "demo" }); }, 0);
  }

  DB.onCalls = f => subs.calls.push(f);
  DB.onActivity = f => subs.activity.push(f);
  DB.onSettings = f => subs.settings.push(f);
  DB.onAuth = f => subs.auth.push(f);
  DB.onDenied = f => subs.denied.push(f);

  window.AD = { CFG, DB, VIEWS, VIEW_SHORT, STATUS, enrich, stats, esc, num, inr, pctTxt, fmtDate, ago, todayISO };
})();
