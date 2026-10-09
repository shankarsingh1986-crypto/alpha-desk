/* Members-only gate: login → approval → paid-till expiry. Data streams only for active members. */
(function () {
  const { CFG, DB, fmtDate } = window.AD;
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const body = document.body;

  // shared bits
  $$("[data-wa]").forEach(e => e.hidden = !CFG.whatsappLink);
  $$("[data-wa-link]").forEach(a => { if (CFG.whatsappLink) a.href = CFG.whatsappLink; else a.hidden = true; });
  $$("[data-signout]").forEach(b => b.onclick = async () => { await DB.logout(); location.reload(); });
  $$("[data-copy]").forEach(b => b.onclick = async () => {
    const t = b.parentElement.querySelector("[data-email]").textContent;
    try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; } catch (e) { b.textContent = "Select & copy"; }
    setTimeout(() => b.textContent = "Copy", 2000);
  });

  function show(state, u, m) {
    body.classList.add("locked"); body.classList.remove("member");
    $$("#gate [data-state]").forEach(d => d.hidden = d.dataset.state !== state);
    if (u) { $$("[data-email]").forEach(e => e.textContent = u.email || ""); $$("[data-name]").forEach(e => e.textContent = (u.name || "").split(" ")[0] || "there"); }
    if (m && m.validTill) $$("[data-till]").forEach(e => e.textContent = fmtDate(new Date(m.validTill).toISOString().slice(0, 10)));
  }

  let started = false, expTimer = null;
  function unlock(u, m, admin) {
    body.classList.remove("locked"); body.classList.add("member");
    $("#me").hidden = false;
    $("#meTill").textContent = admin ? "Admin" : (m && m.validTill ? "Member till " + fmtDate(new Date(m.validTill).toISOString().slice(0, 10)) : "");
    watermark(u);
    if (!started) { started = true; DB.start(); }
  }
  function lock() { if (started) { location.reload(); } }

  /* demo mode: no gate */
  if (!DB.live) { body.classList.remove("locked"); return; }

  /* sign-in form */
  let signup = false;
  $("#gGoogle").onclick = async () => {
    $("#gErr").textContent = "";
    try { await DB.signInGoogle(); } catch (e) { if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") { $("#gForm").hidden = false; $("#gErr").textContent = msg(e); } }
  };
  $("#gEmailToggle").onclick = () => { $("#gForm").hidden = !$("#gForm").hidden; };
  $("#gMode").onclick = () => {
    signup = !signup;
    $("#gName").hidden = !signup;
    $("#gSubmit").textContent = signup ? "Create account" : "Sign in";
    $("#gMode").textContent = signup ? "Already have an account? Sign in" : "New here? Create an account";
    $("#gPass").autocomplete = signup ? "new-password" : "current-password";
  };
  $("#gReset").onclick = async () => {
    const e = $("#gEmail").value.trim();
    if (!e) { $("#gErr").textContent = "Enter your email above, then tap Forgot password."; return; }
    try { await DB.resetPassword(e); $("#gErr").textContent = "Password reset link sent to " + e; } catch (er) { $("#gErr").textContent = msg(er); }
  };
  $("#gForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const e = $("#gEmail").value.trim(), p = $("#gPass").value, n = $("#gName").value.trim();
    $("#gErr").textContent = "";
    if (!e || !p) { $("#gErr").textContent = "Enter your email and password."; return; }
    if (signup && !n) { $("#gErr").textContent = "Enter your full name."; return; }
    $("#gSubmit").disabled = true;
    try { signup ? await DB.signUpEmail(e, p, n) : await DB.login(e, p); }
    catch (er) { $("#gErr").textContent = msg(er); }
    $("#gSubmit").disabled = false;
  });
  function msg(e) {
    const c = e && e.code || "";
    if (/wrong-password|invalid-credential|user-not-found|invalid-login/.test(c)) return "Email or password is incorrect.";
    if (/email-already-in-use/.test(c)) return "An account with this email exists. Sign in instead.";
    if (/weak-password/.test(c)) return "Use a password of at least 6 characters.";
    if (/invalid-email/.test(c)) return "Enter a valid email address.";
    if (/unauthorized-domain/.test(c)) return "Sign-in is not enabled for this site yet. Contact the admin.";
    if (/operation-not-allowed/.test(c)) return "This sign-in method is not enabled yet. Contact the admin.";
    if (/network/.test(c)) return "No internet connection. Try again.";
    return "Could not sign in. Try again.";
  }

  /* auth → membership */
  let unsubMember = null;
  DB.onAuth(async u => {
    if (unsubMember) { unsubMember(); unsubMember = null; }
    clearTimeout(expTimer);
    if (!u) { if (started) return location.reload(); show("signin"); return; }
    if (DB.isAdmin(u)) { unlock(u, null, true); return; }
    show("loading", u);
    try { await DB.ensureMember(u); } catch (e) { /* rules may block if doc exists */ }
    unsubMember = DB.onMember(u.uid, m => evaluate(u, m));
  });

  function evaluate(u, m) {
    clearTimeout(expTimer);
    if (!m || m.status === "pending") { lock(); return show("pending", u, m); }
    if (m.status === "blocked") { lock(); return show("blocked", u, m); }
    if (m.status === "active" && m.validTill > Date.now()) {
      unlock(u, m);
      const left = m.validTill - Date.now();
      if (left < 2147483647) expTimer = setTimeout(() => evaluate(u, m), left + 1000);
      return;
    }
    lock(); show("expired", u, m);
  }
  DB.onDenied(() => { if (started) location.reload(); });

  /* ---------- leak deterrents ---------- */
  function watermark(u) {
    const id = (u && u.email) || "member";
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const c = document.createElement("canvas"), W = 360, H = 200, r = devicePixelRatio || 1;
    c.width = W * r; c.height = H * r;
    const g = c.getContext("2d"); g.scale(r, r);
    g.translate(W / 2, H / 2); g.rotate(-0.42);
    g.textAlign = "center"; g.fillStyle = dark ? "rgba(255,255,255,0.075)" : "rgba(11,20,38,0.085)";
    g.font = "600 14px system-ui, sans-serif"; g.fillText(id, 0, -6);
    g.font = "500 11px system-ui, sans-serif"; g.fillText((CFG.brand || "") + " · " + new Date().toLocaleDateString("en-IN"), 0, 12);
    const w = $("#watermark");
    w.style.backgroundImage = `url(${c.toDataURL()})`;
    w.style.backgroundSize = `${W}px ${H}px`;
  }
  // hide content when app goes to background (app-switcher previews) and on PrintScreen
  document.addEventListener("visibilitychange", () => body.classList.toggle("shield", document.hidden && body.classList.contains("member")));
  addEventListener("keyup", e => {
    if (e.key === "PrintScreen" && body.classList.contains("member")) {
      body.classList.add("shield");
      try { navigator.clipboard.writeText("Screenshots of SS Alpha Desk are not permitted."); } catch (er) {}
      setTimeout(() => body.classList.remove("shield"), 1500);
    }
  });
  document.addEventListener("contextmenu", e => { if (body.classList.contains("member")) e.preventDefault(); });
})();
