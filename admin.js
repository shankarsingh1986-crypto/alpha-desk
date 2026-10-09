/* Admin panel */
(function () {
  const { ago, symbolOf, CFG, DB, VIEW_SHORT, STATUS, enrich, esc, num, inr, pctTxt, fmtDate, todayISO } = window.AD;
  const $ = s => document.querySelector(s);
  document.querySelectorAll("[data-brand]").forEach(e => e.textContent = CFG.brand || "SS Alpha Desk");

  let calls = [], status = "BUY", tab = "ACTIVE", cmpAt = null;

  /* auth */
  let membersOn = false;
  DB.onAuth(u => {
    const ok = !!u && DB.isAdmin(u);
    $("#login").hidden = ok; $("#app").hidden = !ok; $("#logout").hidden = !u || !DB.live;
    $("#who").textContent = u ? (DB.live ? u.email : "Demo mode") : "Signed out";
    $("#demo").hidden = DB.live;
    $("#lerr").textContent = u && !ok ? "This account is not the admin. Log out and sign in with the admin email." : "";
    if (ok) { DB.start(); if (DB.live && !membersOn) { membersOn = true; DB.onMembers(renderMembers); } }
    $("#membersPanel").hidden = !DB.live;
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
      id: F("id").value || undefined, status, share: F("share").value.trim().toUpperCase(), symbol: F("symbol").value.trim().toUpperCase().replace(/\s+/g, ""), date: F("date").value, view: F("view").value,
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
  F("share").addEventListener("input", () => { if (!F("symbol").dataset.touched) F("symbol").value = F("share").value.trim() ? symbolOf({ share: F("share").value }) : ""; });
  F("symbol").addEventListener("input", () => { F("symbol").dataset.touched = "1"; });

  function resetForm() {
    $("#form").reset(); delete F("symbol").dataset.touched; F("id").value = ""; F("date").value = todayISO(); cmpAt = null;
    $("#ftitle").textContent = "New call"; $("#fsave").textContent = "Publish call"; $("#fnew").hidden = true; $("#ferr").textContent = "";
    setStatus("BUY");
  }
  function editCall(id, forceStatus) {
    const c = calls.find(x => x.id === id); if (!c) return;
    F("id").value = c.id; F("share").value = c.share || ""; F("symbol").value = c.symbol || ""; F("date").value = c.date || ""; F("view").value = c.view || "ST";
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
        <div class="meta">${c.closed ? "" : `<span class="sym ${c.cmpErr ? "bad" : c.cmpAuto ? "ok" : ""}" title="${c.cmpErr ? "Price not found for this symbol. Edit the call and fix the symbol." : "Symbol used for auto CMP"}">${esc(symbolOf(c))}${c.cmpErr ? " · not found" : c.cmpAuto ? " · auto " + ago(c.cmpAt) : ""}</span> · `}${fmtDate(c.date)} · Entry ${inr(c.entry)} · Target ${esc(c.target || "—")}${c.closed ? ` · Exit ${inr(c.exit)}` : ` · CMP ${inr(c.cmp)}`} · <b class="${pl}">${pctTxt(c.pct)}</b> · ${c.days} d${c.note ? " · " + esc(c.note) : ""}</div></div>
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
      await DB.saveCall({ ...c, cmp: v, cmpAt: Date.now(), cmpAuto: false }); toast(`${c.share} CMP updated to ${inr(v)}`);
    }
    if (a === "del") {
      if (b.dataset.armed) { await DB.deleteCall(id); toast(`${c.share} deleted`); }
      else { b.dataset.armed = "1"; b.textContent = "Tap again to delete"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Delete"; } }, 3000); }
    }
  });

  DB.onCalls(arr => { calls = arr; renderList(); });

  /* ---------- recent updates feed ---------- */
  let acts = [];
  const timeTxt = ts => ts ? new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  function renderActs() {
    $("#alist").innerHTML = acts.length ? acts.map(a => `<div class="item" data-aid="${esc(a.id)}">
      <div style="display:grid;gap:6px;min-width:0"><input class="in" value="${esc(a.text)}" aria-label="Update text" data-atext><div class="meta">${timeTxt(a.ts)}</div></div>
      <div class="acts"><button class="btn btn-line btn-sm" data-a2="save">Save</button><button class="btn btn-danger btn-sm" data-a2="del">Delete</button></div></div>`).join("")
      : `<div class="empty">No updates. New calls, exits and announcements appear here automatically.</div>`;
    $("#aclear").hidden = !acts.length;
  }
  DB.onActivity(arr => { if (document.activeElement && document.activeElement.matches("[data-atext]")) { acts = arr; return; } acts = arr; renderActs(); });
  $("#alist").addEventListener("click", async e => {
    const b = e.target.closest("[data-a2]"); if (!b) return;
    const row = b.closest(".item"), id = row.dataset.aid;
    try {
      if (b.dataset.a2 === "save") { const t = row.querySelector("[data-atext]").value.trim(); if (!t) return; await DB.updateActivity(id, t); toast("Update edited for all users"); }
      if (b.dataset.a2 === "del") { await DB.deleteActivity(id); toast("Update deleted"); }
    } catch (er) { toast("Could not save. Check your connection."); }
  });
  $("#aclear").onclick = async () => {
    const b = $("#aclear");
    if (b.dataset.armed) { await DB.clearActivity(); toast("All updates cleared"); delete b.dataset.armed; b.textContent = "Clear all updates"; }
    else { b.dataset.armed = "1"; b.textContent = "Tap again to clear all"; setTimeout(() => { delete b.dataset.armed; b.textContent = "Clear all updates"; }, 3000); }
  };

  /* ---------- members ---------- */
  let members = [], mtab = "pending";
  const DAY = 864e5;
  const mstate = m => m.status === "blocked" ? "blocked" : m.status === "pending" ? "pending" : (m.validTill > Date.now() ? "active" : "expired");
  const fmtTs = ts => ts ? fmtDate(new Date(ts).toISOString().slice(0, 10)) : "—";
  const mtabs = [["pending", "Pending"], ["active", "Active"], ["expired", "Expired"], ["blocked", "Blocked"]];
  function renderMembers(arr) {
    if (arr) members = arr;
    const q = ($("#mq").value || "").trim().toLowerCase();
    $("#mtabs").innerHTML = mtabs.map(([k, l]) => `<button class="chip" aria-pressed="${k === mtab}" data-k="${k}">${l}<span class="c">${members.filter(m => mstate(m) === k).length}</span></button>`).join("");
    const act = members.filter(m => mstate(m) === "active").length;
    $("#mcount").textContent = `${act} active · ${members.length} total`;
    const list = members.filter(m => mstate(m) === mtab).filter(m => (m.email + " " + (m.name || "")).toLowerCase().includes(q))
      .sort((a, b) => mtab === "active" ? a.validTill - b.validTill : (b.createdAt || 0) - (a.createdAt || 0));
    $("#mlist").innerHTML = list.map(m => {
      const st = mstate(m);
      const days = st === "active" ? Math.ceil((m.validTill - Date.now()) / DAY) : 0;
      const badge = { pending: "hold", active: "win", expired: "exit", blocked: "loss" }[st];
      const info = st === "active" ? `Valid till ${fmtTs(m.validTill)} · ${days} day${days === 1 ? "" : "s"} left` : st === "expired" ? `Expired ${fmtTs(m.validTill)}` : `Requested ${fmtTs(m.createdAt)}`;
      return `<div class="item" data-uid="${esc(m.uid)}">
        <div><h4><span class="badge ${badge}">${st.toUpperCase()}</span>${esc(m.name || "—")}</h4>
        <div class="meta">${esc(m.email)} · ${info}</div></div>
        <div class="acts">
          ${st === "blocked" ? `<button class="btn btn-line btn-sm" data-m="unblock">Unblock</button>` : `
          <button class="btn btn-sm" style="background:var(--win);color:#fff" data-m="30">${st === "active" ? "+30 days" : "Approve 30 days"}</button>
          <button class="btn btn-line btn-sm" data-m="90">+90 days</button>
          <button class="btn btn-line btn-sm" data-m="365">+1 year</button>
          <span class="cmpq"><input class="in" type="date" aria-label="Valid till date" data-mdate><button class="btn btn-line btn-sm" data-m="date">Set date</button></span>
          <button class="btn btn-danger btn-sm" data-m="block">Block</button>`}
          <button class="btn btn-danger btn-sm" data-m="del">Remove</button>
        </div></div>`;
    }).join("") || `<div class="empty">${mtab === "pending" ? "No pending requests. New sign-ups appear here." : "No members here."}</div>`;
  }
  $("#mtabs").onclick = e => { const b = e.target.closest(".chip"); if (b) { mtab = b.dataset.k; renderMembers(); } };
  $("#mq").addEventListener("input", () => renderMembers());
  $("#mlist").addEventListener("click", async e => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    const row = b.closest(".item"), uid = row.dataset.uid, m = members.find(x => x.uid === uid); if (!m) return;
    const a = b.dataset.m;
    try {
      if (["30", "90", "365"].includes(a)) {
        const base = mstate(m) === "active" ? m.validTill : Date.now();
        const till = base + (+a) * DAY;
        await DB.updateMember(uid, { status: "active", validTill: till });
        toast(`${m.name || m.email} active till ${fmtTs(till)}`);
      }
      if (a === "date") {
        const v = row.querySelector("[data-mdate]").value; if (!v) return;
        const till = Date.parse(v + "T23:59:59");
        await DB.updateMember(uid, { status: "active", validTill: till });
        toast(`${m.name || m.email} active till ${fmtTs(till)}`);
      }
      if (a === "block") { await DB.updateMember(uid, { status: "blocked" }); toast(`${m.name || m.email} blocked`); }
      if (a === "unblock") { await DB.updateMember(uid, { status: m.validTill > Date.now() ? "active" : "pending" }); toast("Unblocked"); }
      if (a === "del") {
        if (b.dataset.armed) { await DB.deleteMember(uid); toast("Member removed"); }
        else { b.dataset.armed = "1"; b.textContent = "Tap again to remove"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Remove"; } }, 3000); }
      }
    } catch (er) { toast("Could not update. Check that the new database rules are published."); }
  });
  setInterval(() => members.length && renderMembers(), 60000);
  resetForm();
})();
