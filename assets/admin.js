/* Admin panel */
(function () {
  const { CFG, DB, VIEW_SHORT, STATUS, enrich, esc, num, inr, pctTxt, fmtDate, todayISO } = window.AD;
  const $ = s => document.querySelector(s);
  document.querySelectorAll("[data-brand]").forEach(e => e.textContent = CFG.brand || "SS Alpha Desk");

  let calls = [], status = "BUY", tab = "ACTIVE", cmpAt = null;

  /* auth */
  DB.onAuth(u => {
    $("#login").hidden = !!u; $("#app").hidden = !u; $("#logout").hidden = !u || !DB.live;
    $("#who").textContent = u ? (DB.live ? u.email : "Demo mode") : "Signed out";
    $("#demo").hidden = DB.live;
  });
  $("#lbtn").onclick = async () => {
    $("#lerr").textContent = "";
    try { await DB.login($("#le").value.trim(), $("#lp").value); }
    catch (e) { $("#lerr").textContent = "Login failed. Check the email and password."; }
  };
  $("#lp").addEventListener("keydown", e => { if (e.key === "Enter") $("#lbtn").click(); });
  $("#logout").onclick = () => DB.logout();
  if (DB.live) { $("#login").hidden = false; }

  let toastT;
  const toast = t => { $("#toastText").textContent = t; $("#toast").classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => $("#toast").classList.remove("show"), 3500); };

  /* announcement */
  DB.onSettings(s => { if (document.activeElement !== $("#annc")) $("#annc").value = (s && s.announcement) || ""; });
  $("#anncPub").onclick = async () => { const t = $("#annc").value.trim(); if (!t) return; await DB.setAnnouncement(t); toast("Announcement published to all users"); };
  $("#anncClr").onclick = async () => { $("#annc").value = ""; await DB.setAnnouncement(""); toast("Announcement removed"); };

  /* form */
  const F = id => $("#f" + id);
  function setStatus(s) {
    status = s;
    $("#seg").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.s === s));
    const closing = s === "EXIT" || s === "TARGET";
    $("#exitBox").hidden = !closing;
    if (closing && !F("exitDate").value) F("exitDate").value = todayISO();
    if (closing && !F("exit").value && F("cmp").value) F("exit").value = F("cmp").value;
    calc();
  }
  $("#seg").onclick = e => { const b = e.target.closest("button"); if (b) setStatus(b.dataset.s); };

  function readForm() {
    return {
      id: F("id").value || undefined, status, share: F("share").value.trim().toUpperCase(), date: F("date").value, view: F("view").value,
      entry: num(F("entry").value), cmp: num(F("cmp").value), target: F("target").value.trim(),
      exit: (status === "EXIT" || status === "TARGET") ? num(F("exit").value) : null,
      exitDate: (status === "EXIT" || status === "TARGET") ? F("exitDate").value : "", note: F("note").value.trim()
    };
  }
  function calc() {
    const c = enrich({ ...readForm() });
    if (!c.entry) { $("#calc").innerHTML = `<span style="color:var(--muted)">Profit, return and holding period calculate automatically.</span>`; return; }
    const cls = c.pct == null ? "" : c.pct >= 0 ? "up" : "down";
    $("#calc").innerHTML = `<span>${c.closed ? "Profit" : "Unrealised"} <b class="${cls}">${c.pnl == null ? "—" : inr(c.pnl)}</b></span><span>Return <b class="${cls}">${pctTxt(c.pct)}</b></span><span>Held <b>${c.days} d</b></span>${c.closed && c.pct != null ? `<span><b class="${cls}">${c.pct > 0 ? "WIN" : "LOSS"}</b></span>` : ""}`;
  }
  $("#form").addEventListener("input", calc);

  function resetForm() {
    $("#form").reset(); F("id").value = ""; F("date").value = todayISO(); cmpAt = null;
    $("#ftitle").textContent = "New call"; $("#fsave").textContent = "Publish call"; $("#fnew").hidden = true; $("#ferr").textContent = "";
    setStatus("BUY");
  }
  function editCall(id, forceStatus) {
    const c = calls.find(x => x.id === id); if (!c) return;
    F("id").value = c.id; F("share").value = c.share || ""; F("date").value = c.date || ""; F("view").value = c.view || "ST";
    F("entry").value = c.entry ?? ""; F("cmp").value = c.cmp ?? ""; F("target").value = c.target || "";
    F("exit").value = c.exit ?? ""; F("exitDate").value = c.exitDate || ""; F("note").value = c.note || ""; cmpAt = c.cmpAt || null;
    $("#ftitle").textContent = "Edit " + c.share; $("#fsave").textContent = "Save & publish update"; $("#fnew").hidden = false; $("#ferr").textContent = "";
    setStatus(forceStatus || c.status);
    $("#form").scrollIntoView({ behavior: "smooth", block: "start" });
    if (forceStatus === "EXIT") F("exit").focus();
  }
  $("#fnew").onclick = resetForm;

  $("#form").addEventListener("submit", async e => {
    e.preventDefault();
    const c = readForm();
    if (!c.share) return $("#ferr").textContent = "Enter the share name.";
    if (!c.date) return $("#ferr").textContent = "Pick the call date.";
    if (!c.entry) return $("#ferr").textContent = "Enter the entry price.";
    if ((status === "EXIT" || status === "TARGET") && (!c.exit || !c.exitDate)) return $("#ferr").textContent = "Enter exit price and exit date to close this call.";
    const old = c.id ? calls.find(x => x.id === c.id) : null;
    c.cmpAt = (!old || num(old.cmp) !== c.cmp) ? Date.now() : (old.cmpAt || null);
    if (!c.id) delete c.id;
    if (old && old.createdAt) c.createdAt = old.createdAt;
    $("#fsave").disabled = true;
    try { await DB.saveCall(c); toast(old ? `${c.share} updated for all users` : `${c.share} published to all users`); resetForm(); }
    catch (err) { $("#ferr").textContent = "Could not save. Check your internet connection and that you are logged in."; }
    $("#fsave").disabled = false;
  });

  /* list */
  const tabs = [["ACTIVE", "Active", c => !c.closed], ["CLOSED", "Closed", c => c.closed], ["ALL", "All", c => true]];
  function renderList() {
    const list = calls.map(enrich).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
    $("#count").textContent = `${list.length} calls`;
    $("#ltabs").innerHTML = tabs.map(([k, l, f]) => `<button class="chip" aria-pressed="${k === tab}" data-k="${k}">${l}<span class="c">${list.filter(f).length}</span></button>`).join("");
    const shown = list.filter(tabs.find(t => t[0] === tab)[2]);
    $("#list").innerHTML = shown.map(c => {
      const cls = c.status === "EXIT" && c.pct < 0 ? "loss" : STATUS[c.status].cls;
      const pl = c.pct == null ? "" : c.pct >= 0 ? "up" : "down";
      return `<div class="item" data-id="${esc(c.id)}">
        <div><h4><span class="badge ${cls}">${STATUS[c.status].label}</span>${esc(c.share)}<span class="view ${esc(c.view)}">${esc(VIEW_SHORT[c.view] || c.view)}</span></h4>
        <div class="meta">${fmtDate(c.date)} · Entry ${inr(c.entry)} · Target ${esc(c.target || "—")}${c.closed ? ` · Exit ${inr(c.exit)}` : ` · CMP ${inr(c.cmp)}`} · <b class="${pl}">${pctTxt(c.pct)}</b> · ${c.days} d${c.note ? " · " + esc(c.note) : ""}</div></div>
        <div class="acts">
          ${c.closed ? "" : `<span class="cmpq"><input class="in" type="number" step="0.01" placeholder="CMP" aria-label="Update CMP for ${esc(c.share)}" data-cmp><button class="btn btn-line btn-sm" data-a="cmp">Update CMP</button></span>`}
          ${c.status === "BUY" ? `<button class="btn btn-sm" style="background:var(--hold);color:#fff" data-a="hold">→ HOLD</button>` : ""}
          ${c.closed ? "" : `<button class="btn btn-sm" style="background:var(--win);color:#fff" data-a="target">Target hit</button><button class="btn btn-sm" style="background:var(--exit);color:#fff" data-a="exit">Exit</button>`}
          <button class="btn btn-line btn-sm" data-a="edit">Edit</button>
          <button class="btn btn-danger btn-sm" data-a="del">Delete</button>
        </div></div>`;
    }).join("") || `<div class="empty">No calls here.</div>`;
    $("#seedBox").innerHTML = DB.live
      ? (list.length ? "" : `<button class="btn btn-primary" data-a="seed">Import my 15 existing calls</button>`)
      : `<button class="btn btn-line btn-sm" data-a="seed">Reset demo data</button>`;
  }
  $("#ltabs").onclick = e => { const b = e.target.closest(".chip"); if (b) { tab = b.dataset.k; renderList(); } };

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a;
    if (a === "seed") { b.disabled = true; await DB.seed(); toast("Calls imported"); return; }
    const item = b.closest(".item"); if (!item) return;
    const id = item.dataset.id, c = calls.find(x => x.id === id); if (!c) return;
    if (a === "edit") editCall(id);
    if (a === "exit") editCall(id, "EXIT");
    if (a === "target") editCall(id, "TARGET");
    if (a === "hold") { await DB.saveCall({ ...c, status: "HOLD" }); toast(`${c.share} moved to HOLD`); }
    if (a === "cmp") {
      const v = num(item.querySelector("[data-cmp]").value); if (!v) return;
      await DB.saveCall({ ...c, cmp: v, cmpAt: Date.now() }); toast(`${c.share} CMP updated to ${inr(v)}`);
    }
    if (a === "del") {
      if (b.dataset.armed) { await DB.deleteCall(id); toast(`${c.share} deleted`); }
      else { b.dataset.armed = "1"; b.textContent = "Tap again to delete"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Delete"; } }, 3000); }
    }
  });

  DB.onCalls(arr => { calls = arr; renderList(); });
  resetForm();
})();
