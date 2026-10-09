/* Public site rendering — realtime */
(function () {
  const { CFG, DB, VIEW_SHORT, VIEWS, STATUS, enrich, stats, esc, inr, pctTxt, fmtDate, ago } = window.AD;
  const $ = s => document.querySelector(s);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ICON = {
    BUY: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    HOLD: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    TARGET: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    EXIT: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5M19 5l-8 8M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/></svg>',
    announce: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l6 4V6L7 10H4zM17 9a4 4 0 0 1 0 6"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>'
  };
  const FEED_ICON = { new: ICON.BUY, win: ICON.TARGET, loss: ICON.EXIT, status: ICON.HOLD, target: ICON.target, edit: ICON.edit, announce: ICON.announce };

  const statusCls = c => c.status === "EXIT" && c.pct != null && c.pct < 0 ? "loss" : STATUS[c.status]?.cls || "hold";
  const statusLbl = c => c.status === "EXIT" && c.pct != null ? (c.pct < 0 ? "EXIT · LOSS" : "EXIT · PROFIT") : STATUS[c.status]?.label || c.status;

  /* static text from config */
  document.querySelectorAll("[data-brand]").forEach(e => e.textContent = CFG.brand || "SS Alpha Desk");
  document.title = CFG.brand || document.title;
  $("#tagline").textContent = CFG.tagline || "";
  $("#analyst").textContent = CFG.analyst || "";
  $("#yr").textContent = new Date().getFullYear();
  $("#mode").textContent = DB.live ? "Live data" : "Demo mode — connect Firebase to go live";
  const reg = CFG.sebiRegNo ? `SEBI Registered Research Analyst · Reg. No. ${esc(CFG.sebiRegNo)}.` : "The analyst is not a SEBI-registered research analyst or investment adviser.";
  $("#disclaimer").innerHTML = `<b>Disclaimer.</b> ${reg} All views shared here are for educational and informational purposes only and are not a recommendation to buy or sell any security. Returns shown are calculated from published entry and exit prices and do not include brokerage, taxes or slippage. Past performance does not guarantee future results. Investments in securities are subject to market risks; consult a registered adviser and do your own research before investing.`;
  const joins = [];
  if (CFG.whatsappLink) joins.push(`<a class="btn btn-wa" href="${esc(CFG.whatsappLink)}" target="_blank" rel="noopener">Join on WhatsApp</a>`);
  if (CFG.telegramLink) joins.push(`<a class="btn btn-tg" href="${esc(CFG.telegramLink)}" target="_blank" rel="noopener">Join on Telegram</a>`);
  if (CFG.contactEmail) joins.push(`<span class="btn btn-ghost" style="user-select:all">${esc(CFG.contactEmail)}</span>`);
  if (!joins.length) joins.push(`<span class="btn btn-ghost">Join link coming soon</span>`);
  joins.push(`<a class="btn btn-ghost" href="#calls">View live calls</a>`);
  $("#joinCtas").innerHTML = joins.join("");

  /* state */
  let calls = [], activity = [], settings = {}, gotCalls = false, firstPaint = true, lastActId = null;
  let callFilter = "ALL", recFilter = "ALL";
  let lastSeen = Date.now();

  /* chips */
  const callChipDefs = [["ALL", "All", c => true], ["BUY", "BUY", c => c.status === "BUY"], ["HOLD", "HOLD", c => c.status === "HOLD"], ["ST", "Swing", c => c.view === "ST"], ["LT", "1–2 Months", c => c.view === "LT"], ["PF", "Portfolio", c => c.view === "PF"]];
  const recChipDefs = [["ALL", "All", c => true], ["ACTIVE", "Active", c => !c.closed], ["CLOSED", "Closed", c => c.closed], ["WIN", "Wins", c => c.closed && c.pct > 0], ["LOSS", "Losses", c => c.closed && c.pct <= 0]];
  function chips(el, defs, cur, list, set) {
    el.innerHTML = defs.map(([k, l, f]) => `<button class="chip" aria-pressed="${k === cur}" data-k="${k}">${l}<span class="c">${list.filter(f).length}</span></button>`).join("");
    el.onclick = e => { const b = e.target.closest(".chip"); if (b) set(b.dataset.k); };
  }

  /* count-up */
  function countTo(el, to) {
    const dec = +(el.dataset.dec || 0), pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
    const from = +(el.dataset.v || 0); el.dataset.v = to;
    const fmt = v => (to < 0 && pre === "+" ? "" : pre) + v.toFixed(dec) + suf;
    if (reduce || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), D = 900;
    const step = t => { const p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  /* render */
  function render() {
    const list = calls.map(enrich).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
    const S = stats(list);

    // KPIs + scorecard
    document.querySelectorAll("[data-count]").forEach(el => countTo(el, S[el.dataset.count] || 0));
    $("#ringVal").textContent = S.winRate.toFixed(0) + "%";
    const C = 2 * Math.PI * 50;
    $("#ringArc").setAttribute("stroke-dasharray", `${C * S.winRate / 100} ${C}`);
    $("#mWins").textContent = S.wins; $("#mLoss").textContent = S.losses; $("#mDays").textContent = S.avgDays.toFixed(0) + " days";
    $("#scoreAsOf").textContent = "As of " + fmtDate(AD.todayISO());
    const first = list.map(c => c.date).filter(Boolean).sort()[0];
    $("#since").textContent = first ? `Tracking since ${fmtDate(first)} · ${S.total} calls published` : "";

    // ticker
    const act = list.filter(c => !c.closed);
    const tk = act.map(c => `<span class="tk"><span class="badge ${statusCls(c)}">${STATUS[c.status].label}</span><b>${esc(c.share)}</b><span class="num">${inr(c.entry)} → ${esc(c.target || "—")}</span></span>`).join("");
    $("#ticker").innerHTML = tk + tk;

    // live call cards
    chips($("#callChips"), callChipDefs, callFilter, act, k => { callFilter = k; render(); });
    const f = callChipDefs.find(d => d[0] === callFilter)[2];
    const shown = act.filter(f);
    $("#cards").innerHTML = shown.length ? shown.map((c, i) => card(c, i)).join("") : `<div class="empty">No active calls in this filter.</div>`;

    // feed
    $("#feed").innerHTML = activity.length ? activity.slice(0, 20).map(a => `<li><span class="dot ${esc(a.type)}">${FEED_ICON[a.type] || ICON.edit}</span><div>${esc(a.text)}<time data-ts="${a.ts}">${ago(a.ts)}</time></div></li>`).join("") : `<li><span></span><div style="color:var(--muted)">Updates will appear here.</div></li>`;

    // best + split
    $("#best").innerHTML = S.best.slice(0, 3).map((c, i) => `<div class="best-row"><span class="rank">${i + 1}</span><div><b>${esc(c.label)}</b><small>${inr(c.entry)} → ${inr(c.exit)} · ${c.days} day${c.days === 1 ? "" : "s"}</small></div><span class="pl ${c.pct >= 0 ? "up" : "down"}">${pctTxt(c.pct)}</span></div>`).join("") || `<div class="empty">Closed calls will appear here.</div>`;
    const closed = list.filter(c => c.closed);
    $("#split").innerHTML = `<div><small>Wins</small><b class="up">${S.wins}</b></div><div><small>Losses</small><b class="${S.losses ? "down" : ""}">${S.losses}</b></div><div><small>Best</small><b class="up">${S.best[0] ? pctTxt(S.best[0].pct) : "—"}</b></div>`;

    // charts
    drawCharts(closed);

    // record table
    const q = ($("#q").value || "").trim().toLowerCase();
    chips($("#recChips"), recChipDefs, recFilter, list, k => { recFilter = k; render(); });
    const rf = recChipDefs.find(d => d[0] === recFilter)[2];
    const rows = list.filter(rf).filter(c => c.share.toLowerCase().includes(q));
    $("#rows").innerHTML = rows.length ? rows.map(row).join("") : `<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:30px">No calls match.</td></tr>`;

    firstPaint = false;
  }

  function card(c, i) {
    const cls = statusCls(c);
    const fresh = !firstPaint && c.updatedAt && c.updatedAt > lastSeen;
    const pos = c.progress != null ? (c.progress * 100).toFixed(1) : null;
    return `<article class="card${fresh ? " flash" : ""}" style="animation-delay:${Math.min(i, 8) * 50}ms">
      <div class="card-h ${cls}"><span class="signal">${ICON[c.status] || ""}${STATUS[c.status].label}</span><small>${c.status === "BUY" ? "Buy range open" : "Stay invested"}</small></div>
      <div class="card-b">
        <div class="card-t"><div><h3>${esc(c.share)}</h3><div class="sub">Called ${fmtDate(c.date)}${c.note ? " · " + esc(c.note) : ""}</div></div><span class="view ${esc(c.view)}">${esc(VIEW_SHORT[c.view] || c.view)}</span></div>
        <div class="trio"><div><small>Entry</small><b>${inr(c.entry)}</b></div><div><small>CMP${c.cmpAuto && c.cmpAt ? ` · ${ago(c.cmpAt).replace(" ago", "")}` : ""}</small><b>${inr(c.cmp)}</b></div><div><small>Target</small><b>${esc(c.target || "—")}</b></div></div>
        ${pos != null ? `<div class="journey"><div class="journey-top"><span>Entry</span><span>${c.upside != null ? (c.upside >= 0 ? "+" : "") + c.upside.toFixed(1) + "% to target" : ""}</span><span>Target</span></div><div class="bar"><i style="width:${pos}%"></i><em style="left:${pos}%"></em></div></div>` : ""}
        <div class="card-f"><span>${c.days} day${c.days === 1 ? "" : "s"} held</span><span>Unrealised <span class="pl ${c.pct == null ? "" : c.pct >= 0 ? "up" : "down"}">${pctTxt(c.pct)}</span></span></div>
      </div></article>`;
  }

  function row(c) {
    const cls = statusCls(c);
    const pl = c.pct == null ? "" : c.pct >= 0 ? "up" : "down";
    return `<tr>
      <td class="num">${fmtDate(c.date)}</td>
      <td class="share-cell"><b>${esc(c.share)}</b>${c.note ? `<small>${esc(c.note)}</small>` : ""}</td>
      <td class="r num">${inr(c.cmp)}</td>
      <td>${esc(c.target || "—")}</td>
      <td><span class="view ${esc(c.view)}">${esc(VIEWS[c.view] || c.view)}</span></td>
      <td class="r num">${inr(c.entry)}</td>
      <td class="r num">${c.closed ? inr(c.exit) : "—"}</td>
      <td class="r num ${pl}">${c.pnl == null ? "—" : (c.pnl >= 0 ? "+" : "−") + inr(Math.abs(c.pnl)).slice(0)}</td>
      <td class="r num ${pl}" style="font-weight:700">${pctTxt(c.pct)}${c.closed ? "" : '<small style="display:block;font-size:10px;color:var(--muted);font-weight:500">unrealised</small>'}</td>
      <td class="r num">${c.days} day${c.days === 1 ? "" : "s"}</td>
      <td><span class="badge ${cls}">${statusLbl(c)}</span></td></tr>`;
  }

  /* charts */
  let retChart, cumChart;
  function cssv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function drawCharts(closed) {
    if (!window.Chart) return;
    const ink = cssv("--muted"), grid = cssv("--line"), win = cssv("--win"), loss = cssv("--loss"), brand = cssv("--brand");
    Chart.defaults.font.family = cssv("--f-body"); Chart.defaults.color = ink;
    const byRet = [...closed].sort((a, b) => b.pct - a.pct);
    const tip = { backgroundColor: cssv("--ink"), titleColor: cssv("--bg"), bodyColor: cssv("--bg"), padding: 12, cornerRadius: 10, displayColors: false };
    const d1 = { labels: byRet.map(c => c.label), datasets: [{ data: byRet.map(c => +c.pct.toFixed(2)), backgroundColor: byRet.map(c => c.pct >= 0 ? win : loss), borderRadius: 8, maxBarThickness: 46 }] };
    if (retChart) { retChart.data = d1; retChart.update(); }
    else retChart = new Chart($("#retChart"), {
      type: "bar", data: d1,
      options: { maintainAspectRatio: false, animation: { duration: reduce ? 0 : 900 },
        plugins: { legend: { display: false }, tooltip: { ...tip, callbacks: { label: x => { const c = byRetRef()[x.dataIndex]; return [`Return ${pctTxt(c.pct)}`, `${inr(c.entry)} → ${inr(c.exit)}`, `${c.days} day(s) held`]; } } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: false, font: { size: 11 } } }, y: { grid: { color: grid }, border: { display: false }, ticks: { callback: v => v + "%" } } } }
    });
    retChart._src = byRet;
    function byRetRef() { return retChart._src; }

    const byExit = [...closed].sort((a, b) => (a.exitDate || "").localeCompare(b.exitDate || ""));
    let run = 0; const pts = byExit.map(c => (run += c.pct, +run.toFixed(2)));
    const d2 = { labels: byExit.map(c => fmtDate(c.exitDate).replace(/ \d{4}$/, "")), datasets: [{ data: pts, borderColor: brand, borderWidth: 3, tension: .35, fill: true, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: brand,
      backgroundColor: ctx => { const { chartArea: a, ctx: g } = ctx.chart; if (!a) return "transparent"; const gr = g.createLinearGradient(0, a.top, 0, a.bottom); gr.addColorStop(0, brand + "55"); gr.addColorStop(1, brand + "00"); return gr; } }] };
    if (cumChart) { cumChart.data = d2; cumChart._src = byExit; cumChart.update(); }
    else { cumChart = new Chart($("#cumChart"), {
      type: "line", data: d2,
      options: { maintainAspectRatio: false, animation: { duration: reduce ? 0 : 1100 }, interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false }, tooltip: { ...tip, callbacks: { title: x => cumChart._src[x[0].dataIndex].label, label: x => { const c = cumChart._src[x.dataIndex]; return [`This call ${pctTxt(c.pct)}`, `Cumulative ${pctTxt(x.parsed.y)}`]; } } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: grid }, border: { display: false }, ticks: { callback: v => v + "%" } } } }
    }); cumChart._src = byExit; }
  }

  /* toast + announcement */
  let toastT;
  function toast(t) { $("#toastText").textContent = t; $("#toast").classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => $("#toast").classList.remove("show"), 5000); }
  function renderAnnc() {
    const t = settings.announcement || "";
    let dismissed = ""; try { dismissed = localStorage.getItem("ssad_annc_dismissed") || ""; } catch (e) {}
    const key = t + "|" + (settings.announcedAt || "");
    $("#annc").hidden = !t || dismissed === key;
    $("#anncText").textContent = t;
    $("#anncClose").onclick = () => { try { localStorage.setItem("ssad_annc_dismissed", key); } catch (e) {} $("#annc").hidden = true; };
  }

  /* subscriptions */
  DB.onCalls(arr => { calls = arr; gotCalls = true; render(); lastSeen = Date.now(); });
  DB.onActivity(arr => {
    const top = arr[0];
    if (lastActId && top && top.id !== lastActId) toast(top.text);
    lastActId = top ? top.id : lastActId; activity = arr;
    if (gotCalls) $("#feed") && render();
  });
  DB.onSettings(s => { settings = s || {}; renderAnnc(); });

  /* ---------- market strip ---------- */
  let market = null;
  function renderMarket() {
    const m = market;
    if (!m || !m.items || !m.items.length) { $("#mkt").hidden = true; return; }
    $("#mkt").hidden = false;
    $("#mktItems").innerHTML = m.items.map(i => {
      const up = (i.change || 0) >= 0, cls = up ? "up" : "down";
      const pr = i.price == null ? "—" : (+i.price).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `<span class="mi"><b>${esc(i.name)}</b><span class="num">${pr}</span><span class="num ${cls}">${up ? "▲" : "▼"} ${Math.abs(i.change || 0).toFixed(2)} (${(i.changePct || 0) >= 0 ? "+" : ""}${(+i.changePct || 0).toFixed(2)}%)</span></span>`;
    }).join("");
    $("#mktTs").textContent = "Delayed · " + ago(m.ts);
  }
  DB.onMarket(m => { market = m; renderMarket(); });
  setInterval(renderMarket, 30000);
  $("#q").addEventListener("input", render);

  /* ---------- install app prompt ---------- */
  (function installPrompt() {
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (standalone) return;
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const bar = $("#installBar"), navBtn = $("#installBtn");
    let deferred = null;
    const snoozed = () => { try { return Date.now() < +(localStorage.getItem("ssad_install_snooze") || 0); } catch (e) { return false; } };
    const snooze = () => { try { localStorage.setItem("ssad_install_snooze", Date.now() + 3 * 864e5); } catch (e) {} };
    const show = () => { if (!snoozed()) setTimeout(() => { bar.hidden = false; }, 2500); };
    $("#ibClose").onclick = () => { bar.hidden = true; snooze(); };

    async function install() {
      if (deferred) { deferred.prompt(); const r = await deferred.userChoice; deferred = null; bar.hidden = true; navBtn.hidden = true; if (r.outcome !== "accepted") snooze(); }
      else if (isIOS) { $("#ibHint").innerHTML = 'Tap the <b>Share</b> button below, then <b>Add to Home Screen</b>.'; $("#ibInstall").hidden = true; }
      else { $("#ibHint").innerHTML = 'Open the browser menu <b>⋮</b> and tap <b>Install app</b> or <b>Add to Home screen</b>.'; $("#ibInstall").hidden = true; }
    }
    $("#ibInstall").onclick = install;
    navBtn.onclick = () => { bar.hidden = false; install(); };

    addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; navBtn.hidden = false; show(); });
    addEventListener("appinstalled", () => { bar.hidden = true; navBtn.hidden = true; toast("App installed. Open it from your home screen."); });
    if (isIOS) { $("#ibInstall").textContent = "How?"; show(); }
    else if (/android|mobile/i.test(ua)) setTimeout(() => { if (!deferred) show(); }, 4000);
  })();

  setInterval(() => document.querySelectorAll("time[data-ts]").forEach(t => t.textContent = ago(+t.dataset.ts)), 30000);
  addEventListener("online", () => $("#liveLabel").textContent = "Live desk · synced");
  addEventListener("offline", () => $("#liveLabel").textContent = "Offline · showing last data");
})();
