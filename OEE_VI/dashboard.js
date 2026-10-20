/* Dashboard OEE — đọc CSDL_OEE_Vi qua Apps Script, vẽ tổng quan, chi tiết nhà máy, chất lượng dữ liệu, chế độ trình chiếu */
(function () {
  const O = window.OEE, $ = id => document.getElementById(id), esc = O.esc, fmt = O.fmt, pct = O.pct;
  let M = null;               // mô hình dữ liệu
  const charts = {};
  const PAGE = 25;
  const KEY = "oee-vi-dash-v1";

  // ===================== TRẠNG THÁI =====================
  const DEF = () => ({ tab: "overview", period: "", from: "", to: "", f: "", c: "", m: "", s: "", grain: "day",
    raw: "gd", q: "", only: false, page: 0, sort: "d", dir: -1 });
  let st = DEF();
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}"), { q: "", page: 0 }); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  if (location.hash.length > 1) st.tab = decodeURIComponent(location.hash.slice(1));   // link chia sẻ: .../OEE_VI/#NS1

  // ===================== KỲ BÁO CÁO =====================
  const monthEnd = k => { const [y, m] = k.split("-").map(Number); return k + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0"); };
  function periods() {
    const last = M.dates.at(-1), first = M.dates[0];
    const months = [...new Set(M.dates.map(d => d.slice(0, 7)))].sort().reverse();
    const out = months.map(k => { const end = monthEnd(k);
      return { v: "m:" + k, l: "Tháng " + k.slice(5, 7) + "/" + k.slice(0, 4), from: k + "-01", to: end < last ? end : last }; });
    out.push({ v: "d7", l: "7 ngày gần nhất (đến " + O.dm(last) + ")", from: O.addDays(last, -6), to: last });
    out.push({ v: "d30", l: "30 ngày gần nhất (đến " + O.dm(last) + ")", from: O.addDays(last, -29), to: last });
    out.push({ v: "all", l: "Toàn bộ (" + O.dm(first) + " – " + O.dm(last) + ")", from: first, to: last });
    out.push({ v: "custom", l: "Tuỳ chọn khoảng ngày…" });
    return out;
  }
  function applyPeriod() {
    const ps = periods();
    if (!ps.some(p => p.v === st.period)) st.period = ps[0].v;
    const p = ps.find(p => p.v === st.period);
    if (p.v !== "custom") { st.from = p.from; st.to = p.to; }
    if (!st.from) st.from = M.dates[0]; if (!st.to) st.to = M.dates.at(-1);
  }

  // ===================== LỌC =====================
  // except: bỏ qua một chiều lọc (vd. so sánh nhà máy thì không lọc nhà máy)
  function rows(opt = {}) {
    const f = opt.f !== undefined ? opt.f : (st.tab !== "overview" && st.tab !== "dq" ? st.tab : st.f);
    const from = opt.from || st.from, to = opt.to || st.to;
    return M.facts.filter(r => r.d >= from && r.d <= to && (!f || r.f === f) && (opt.noC || !st.c || r.c === st.c)
      && (opt.noM || !st.m || r.m === st.m) && (!st.s || r.s === st.s));
  }
  // Kỳ trước: kỳ tháng → cả tháng liền trước; kỳ khác → khoảng cùng độ dài ngay trước đó
  const prevRange = () => {
    if (st.period.startsWith("m:")) { const k = O.addDays(st.from, -1).slice(0, 7); return { from: k + "-01", to: monthEnd(k) }; }
    const n = Math.round((new Date(st.to) - new Date(st.from)) / 864e5) + 1;
    return { from: O.addDays(st.from, -n), to: O.addDays(st.from, -1) }; };
  const prevLbl = () => { const p = prevRange(); return st.period.startsWith("m:") ? O.monLbl(p.from.slice(0, 7)) : O.dm(p.from) + " – " + O.dm(p.to); };
  const curFac = () => (st.tab !== "overview" && st.tab !== "dq") ? st.tab : st.f;
  function ctxText() {
    const parts = [O.dmy(st.from) + " – " + O.dmy(st.to)];
    const f = curFac(); parts.push(f ? (M.facName[f] || f) : "NS1 + NS2");
    if (st.c) parts.push(M.lineName[st.c] || st.c);
    if (st.m) parts.push(st.m);
    if (st.s) parts.push(st.s);
    return parts.join(" · ");
  }

  // ===================== BỘ LỌC (combobox) =====================
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`;
  function renderFilters() {
    const ps = periods();
    $("f-period").innerHTML = ps.map(p => opt(p.v, p.l, st.period)).join("");
    $("fld-from").hidden = $("fld-to").hidden = st.period !== "custom";
    $("f-from").value = st.from; $("f-to").value = st.to;
    $("f-from").min = $("f-to").min = M.dates[0]; $("f-from").max = $("f-to").max = M.dates.at(-1);
    $("fld-fac").hidden = st.tab !== "overview" && st.tab !== "dq";
    $("f-fac").innerHTML = opt("", "Tất cả nhà máy", st.f) + M.facs.map(f => opt(f, f + " – " + (M.facName[f] || f), st.f)).join("");
    const f = curFac();
    const lines = M.lines.filter(l => M.facts.some(r => r.c === l.c && (!f || r.f === f)));
    if (st.c && !lines.some(l => l.c === st.c)) st.c = "";
    $("f-line").innerHTML = opt("", "Tất cả chuyền", st.c) + lines.map(l => opt(l.c, l.name, st.c)).join("");
    const ms = [...new Set(M.facts.filter(r => (!f || r.f === f) && (!st.c || r.c === st.c)).map(r => r.m))].sort();
    if (st.m && !ms.includes(st.m)) st.m = "";
    $("f-mach").innerHTML = opt("", "Tất cả máy", st.m) + ms.map(m => opt(m, m + (M.machines[m]?.name ? " · " + M.machines[m].name : ""), st.m)).join("");
    const ss = [...new Set(M.shifts.map(s => s.s).concat(M.facts.map(r => r.s)))].filter(Boolean);
    $("f-shift").innerHTML = opt("", "Tất cả ca", st.s) + ss.map(s => opt(s, s, st.s)).join("");
    $("f-grain").value = st.grain;
  }

  function renderTabs() {
    const tabs = [["overview", "Tổng quan"]].concat(M.facs.map(f => [f, "Chi tiết " + f])).concat([["dq", "Chất lượng dữ liệu"]]);
    if (!tabs.some(t => t[0] === st.tab)) st.tab = "overview";
    $("tabs").innerHTML = tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${st.tab === k}">${esc(l)}</button>`).join("");
    $("tab-overview").hidden = st.tab !== "overview";
    $("tab-fac").hidden = !M.facs.includes(st.tab);
    $("tab-dq").hidden = st.tab !== "dq";
    const h = st.tab === "overview" ? "" : "#" + st.tab;
    if (location.hash !== h) history.replaceState(null, "", location.pathname + location.search + h);
  }

  // ===================== MÀU & BIỂU ĐỒ =====================
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const toneC = t => css(t === "good" ? "--good" : t === "warn" ? "--warn" : t === "bad" ? "--bad" : "--na");
  const SER = () => [css("--s1"), css("--s2"), css("--s3"), css("--s4"), "#3E7CB1", "#8E5A9B", "#C0504D", "#4BA3A3"];
  // Nhãn giá trị trên cột (dễ đọc khi trình chiếu)
  const valueLabels = { id: "valueLabels", afterDatasetsDraw(c, _a, o) {
    if (!o || !o.on) return; const ctx = c.ctx; ctx.save(); ctx.font = "600 11px Inter, Arial"; ctx.fillStyle = css("--ink");
    c.data.datasets.forEach((ds, i) => { if (ds.type === "line" || ds.noLabel) return; const meta = c.getDatasetMeta(i); if (meta.hidden) return;
      meta.data.forEach((el, j) => { const v = ds.data[j]; if (v == null || !isFinite(Array.isArray(v) ? v[1] - v[0] : v)) return;
        const val = Array.isArray(v) ? v[1] - v[0] : v, txt = o.fmt ? o.fmt(val) : val;
        const horiz = c.options.indexAxis === "y";
        ctx.textAlign = horiz ? "left" : "center"; ctx.textBaseline = horiz ? "middle" : "bottom";
        horiz ? ctx.fillText(txt, el.x + 4, el.y) : ctx.fillText(txt, el.x, el.y - 3); }); });
    ctx.restore(); } };
  function chart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const el = $(id); if (!el) return;
    Chart.defaults.color = css("--muted"); Chart.defaults.font.family = "Inter, 'Segoe UI', Arial, sans-serif"; Chart.defaults.borderColor = css("--line");
    cfg.options = Object.assign({ maintainAspectRatio: false, animation: false, responsive: true }, cfg.options || {});
    cfg.plugins = (cfg.plugins || []).concat([valueLabels]);
    charts[id] = new Chart(el, cfg);
  }
  const pctAxis = (min) => ({ beginAtZero: min == null, suggestedMin: min, suggestedMax: 100, ticks: { callback: v => v + "%" }, grid: { color: css("--line") } });
  const p1 = v => isFinite(v) ? +v.toFixed(1) : null;
  const bucket = d => st.grain === "day" ? O.dm(d) : st.grain === "month" ? O.monLbl(d.slice(0, 7)) : "Tuần " + O.isoWeek(d);

  // ===================== THÀNH PHẦN DÙNG CHUNG =====================
  const pill = t => `<span class="pill t-${t}">${O.TONE_LBL[t]}</span>`;
  const bar = (v, k) => { const t = O.tone(k, v, M.MT); return `<div class="bar" title="Mục tiêu ${M.MT[k]}%"><i class="bg-${t}" style="width:${isFinite(v) ? Math.min(100, Math.max(0, v)) : 0}%"></i><b style="left:${M.MT[k]}%"></b></div>`; };
  function gauge(v) {
    const r = 64, cx = 75, cy = 76, ang = x => Math.PI * (1 - Math.min(100, Math.max(0, x)) / 100);
    const pt = x => [cx + r * Math.cos(ang(x)), cy - r * Math.sin(ang(x))];
    const [x1, y1] = pt(isFinite(v) ? v : 0), [tx, ty] = pt(M.MT.OEE), [tx2, ty2] = [cx + (r + 10) * Math.cos(ang(M.MT.OEE)), cy - (r + 10) * Math.sin(ang(M.MT.OEE))];
    return `<svg class="gauge" viewBox="0 0 150 84" aria-hidden="true">
      <path d="M11 76 A64 64 0 0 1 139 76" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="12" stroke-linecap="round"/>
      <path d="M11 76 A64 64 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="#A8D49E" stroke-width="12" stroke-linecap="round"/>
      <line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${tx2.toFixed(1)}" y2="${ty2.toFixed(1)}" stroke="#FFB4A8" stroke-width="3"/></svg>`;
  }
  function kpiCard(label, value, foot, tone, extra = "") {
    return `<div class="card kpi"><div class="lbl">${label}${tone ? pill(tone) : ""}</div><div class="val num">${value}</div>${extra}<div class="foot">${foot}</div></div>`;
  }
  const delta = (d, unit = " điểm") => !isFinite(d) ? `<span class="muted">—</span>` : `<span class="${d >= 0 ? "c-good" : "c-bad"}">${d >= 0 ? "▲" : "▼"} ${O.pts(d).replace(/^[+−±]/, "")}${unit}</span>`;

  // ===================== TỔNG QUAN =====================
  function renderOverview() {
    const R = rows(), a = O.agg(R), pr = O.agg(rows(prevRange())), t = O.tone("OEE", a.OEE, M.MT);
    const bad = R.filter(r => r.OEE < 60).length;
    $("ov-hero").innerHTML = `
      <div class="hero-main">${gauge(a.OEE)}
        <div class="lbl">OEE chung ${curFac() || "NS1 + NS2"}</div>
        <div class="big num">${pct(a.OEE)}</div>
        <div><span class="pill">${O.TONE_LBL[t]}</span> <span class="sub">Mục tiêu ${M.MT.OEE}%</span></div>
        <div class="sub">So với kỳ trước (${prevLbl()}): <b class="delta">${pr.n ? O.pts(a.OEE - pr.OEE) + " điểm" : "chưa có số liệu"}</b></div>
        <div class="sub">Bình quân gia quyền theo ${fmt(a.hours, 1)} giờ chạy máy thực tế · ${fmt(a.n)} ca máy</div>
      </div>
      <div class="grid g3">
        ${["A", "P", "Q"].map(k => kpiCard(
          { A: "A – Khả dụng", P: "P – Hiệu suất", Q: "Q – Chất lượng" }[k], pct(a[k]),
          `MT ${M.MT[k]}% · kỳ trước ${pr.n ? pct(pr[k]) : "—"} ${pr.n ? delta(a[k] - pr[k]) : ""}`, O.tone(k, a[k], M.MT), bar(a[k], k))).join("")}
        ${kpiCard("Sản lượng tốt", fmt(a.good), `Tổng ${fmt(a.sl)} · phế ${fmt(a.p)} · làm lại ${fmt(a.r)}`)}
        ${kpiCard("Thời gian chạy máy", fmt(a.run / 60, 1) + " giờ", `Kế hoạch ${fmt(a.plan / 60, 1)} giờ · dừng ${fmt(a.stop)} phút`)}
        ${kpiCard("Ca OEE &lt; 60%", fmt(bad) + `<span class="muted" style="font-size:16px"> / ${fmt(R.length)}</span>`,
          R.length ? pct(bad / R.length * 100) + " số ca máy" : "", bad / Math.max(1, R.length) <= .05 ? "good" : bad / Math.max(1, R.length) <= .15 ? "warn" : "bad")}
      </div>`;

    // --- thẻ chuyền ---
    const base = rows({ noC: true, noM: true }), tot = O.agg(base);
    const lines = M.lines.filter(l => base.some(r => r.c === l.c));
    const facs = M.facs.filter(f => base.some(r => r.f === f));
    $("ov-lines").innerHTML = lines.map(l => {
      const rs = base.filter(r => r.c === l.c), x = O.agg(rs), tt = O.tone("OEE", x.OEE, M.MT), share = tot.run ? x.run / tot.run * 100 : 0;
      return `<button class="line-card ${st.c === l.c ? "on" : ""}" data-line="${esc(l.c)}">
        <div class="head"><div><div class="name">${esc(l.name)}</div><div class="w">${fmt(x.hours, 1)} giờ · ${fmt(share)}% tỷ trọng · ${x.n} ca máy</div></div>${pill(tt)}</div>
        <div class="oee num c-${tt}">${pct(x.OEE)}</div>
        <div class="share" title="Tỷ trọng giờ chạy máy"><i style="width:${share}%"></i></div>
        <div class="apq">${["A", "P", "Q"].map(k => `<span class="k">${k}</span>${bar(x[k], k)}<span class="v num">${pct(x[k])}</span>`).join("")}</div>
        <div class="split">${facs.map(f => { const y = O.agg(rs.filter(r => r.f === f));
          return `<div>${f}<b class="num ${y.n ? "c-" + O.tone("OEE", y.OEE, M.MT) : "c-na"}">${y.n ? pct(y.OEE) : "—"}</b>${y.n ? fmt(y.hours, 1) + " giờ" : "chưa có số liệu"}</div>`; }).join("")}</div>
      </button>`; }).join("") + `
      <div class="line-card line-total">
        <div class="head"><div><div class="name">Tổng hợp tất cả chuyền</div><div class="w">${fmt(tot.hours, 1)} giờ · ${tot.n} ca máy</div></div>${pill(O.tone("OEE", tot.OEE, M.MT))}</div>
        <div class="oee num c-${O.tone("OEE", tot.OEE, M.MT)}">${pct(tot.OEE)}</div>
        <div class="apq">${["A", "P", "Q"].map(k => `<span class="k">${k}</span>${bar(tot[k], k)}<span class="v num">${pct(tot[k])}</span>`).join("")}</div>
        <div class="w">= Σ(OEE chuyền × giờ chạy máy) ÷ Σ giờ chạy máy. Chuyền chạy nhiều giờ ảnh hưởng nhiều hơn tới OEE chung.</div>
      </div>`;

    // --- bảng ma trận ---
    const cell = rs => { if (!rs.length) return `<td class="r muted">—</td>`; const x = O.agg(rs);
      return `<td class="r num"><b class="c-${O.tone("OEE", x.OEE, M.MT)}">${pct(x.OEE)}</b> <span class="muted small">(${fmt(x.hours, 0)})</span></td>`; };
    const rowHtml = (name, rs, strong) => { const x = O.agg(rs);
      return `<tr${strong ? ' style="font-weight:800"' : ""}><td class="nw">${name}</td>${facs.map(f => cell(rs.filter(r => r.f === f))).join("")}
        <td class="r num"><b class="c-${O.tone("OEE", x.OEE, M.MT)}">${pct(x.OEE)}</b></td><td class="r num">${pct(x.A)}</td><td class="r num">${pct(x.P)}</td><td class="r num">${pct(x.Q)}</td>
        <td class="r num">${fmt(x.hours, 1)}</td><td class="r num">${tot.run ? pct(x.run / tot.run * 100, 0) : "—"}</td><td class="r num">${fmt(x.good)}</td></tr>`; };
    $("ov-matrix").innerHTML = `<thead><tr><th>Chuyền</th>${facs.map(f => `<th class="r">OEE ${f}</th>`).join("")}<th class="r">OEE chung</th><th class="r">A</th><th class="r">P</th><th class="r">Q</th><th class="r">Giờ chạy máy</th><th class="r">Tỷ trọng</th><th class="r">SL tốt</th></tr></thead>
      <tbody>${lines.map(l => rowHtml(esc(l.name), base.filter(r => r.c === l.c))).join("")}</tbody>
      <tfoot>${rowHtml("Tổng hợp (BQ gia quyền)", base, true).replace(/<tr[^>]*>/, "<tr>")}</tfoot>`;

    // --- so sánh nhà máy ---
    const bf = rows({ f: "", noM: true }), fs = M.facs.filter(f => bf.some(r => r.f === f)), lns = M.lines.filter(l => bf.some(r => r.c === l.c));
    const S = SER();
    chart("c-fac", { type: "bar", data: { labels: lns.map(l => l.name).concat(["Tổng hợp"]), datasets: fs.map((f, i) => ({
        label: f, data: lns.map(l => { const rs = bf.filter(r => r.f === f && r.c === l.c); return rs.length ? p1(O.agg(rs).OEE) : null; }).concat([p1(O.agg(bf.filter(r => r.f === f)).OEE)]),
        backgroundColor: S[i % S.length], borderRadius: 4 }))
        .concat([{ type: "line", label: "Mục tiêu " + M.MT.OEE + "%", data: lns.map(() => M.MT.OEE).concat([M.MT.OEE]), borderColor: css("--target"), borderDash: [6, 4], pointRadius: 0, borderWidth: 2 }]) },
      options: { plugins: { legend: { position: "bottom" }, valueLabels: { on: true, fmt: v => v.toFixed(1).replace(".", ",") }, tooltip: { callbacks: { label: c => c.dataset.label + ": " + pct(c.parsed.y) } } },
        scales: { y: pctAxis(), x: { grid: { display: false } } } } });
    $("ov-fac").innerHTML = `<div class="tbl-wrap" style="max-height:none"><table><thead><tr><th>Chỉ số</th>${fs.map(f => `<th class="r">${f}</th>`).join("")}<th class="r">Chênh</th></tr></thead><tbody>
      ${[["OEE", "OEE"], ["A", "A – Khả dụng"], ["P", "P – Hiệu suất"], ["Q", "Q – Chất lượng"], ["hours", "Giờ chạy máy"], ["good", "SL tốt"]].map(([k, l]) => {
        const v = fs.map(f => O.agg(bf.filter(r => r.f === f))[k]); const isP = !["hours", "good"].includes(k);
        return `<tr><td>${l}</td>${v.map(x => `<td class="r num">${isP ? `<b class="c-${O.tone(k, x, M.MT)}">${pct(x)}</b>` : fmt(x)}</td>`).join("")}
          <td class="r num">${v.length === 2 && isP ? O.pts(v[0] - v[1]) : ""}</td></tr>`; }).join("")}</tbody></table></div>
      <p class="note">${facVerdict(bf, fs)}</p>`;

    // --- xu hướng ---
    renderTrend("c-trend", R, fs.length > 1 && !curFac() ? fs.map(f => ({ label: f, test: r => r.f === f })) : []);
    $("trend-note").textContent = "Theo " + { day: "ngày", week: "tuần ISO", month: "tháng" }[st.grain] + " · đường đứt đỏ: mục tiêu " + M.MT.OEE + "%";

    // --- tổn thất ---
    renderLoss(a);

    // --- máy, ca ---
    const byM = Object.entries(O.groupBy(R, "m")).map(([m, rs]) => ({ m, ...O.agg(rs) })).filter(x => isFinite(x.OEE)).sort((x, y) => x.OEE - y.OEE);
    chart("c-mach", { type: "bar", data: { labels: byM.map(x => x.m), datasets: [
        { label: "OEE", data: byM.map(x => p1(x.OEE)), backgroundColor: byM.map(x => st.m && st.m !== x.m ? css("--line") : toneC(O.tone("OEE", x.OEE, M.MT))), borderRadius: 4 },
        { type: "line", label: "Mục tiêu", data: byM.map(() => M.MT.OEE), borderColor: css("--target"), borderDash: [6, 4], pointRadius: 0, borderWidth: 2 }] },
      options: { plugins: { legend: { display: false }, valueLabels: { on: true, fmt: v => v.toFixed(1).replace(".", ",") },
          tooltip: { callbacks: { label: c => c.dataset.label + ": " + pct(c.parsed.y), afterLabel: c => c.datasetIndex ? "" : `${fmt(byM[c.dataIndex].hours, 1)} giờ · A ${pct(byM[c.dataIndex].A)} · P ${pct(byM[c.dataIndex].P)} · Q ${pct(byM[c.dataIndex].Q)}` } } },
        scales: { y: pctAxis(), x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 60 } } },
        onClick: (e, el) => { if (el.length && el[0].datasetIndex === 0) { const m = byM[el[0].index].m; st.m = st.m === m ? "" : m; render(); } } } });
    const ss = [...new Set(M.shifts.map(s => s.s).concat(R.map(r => r.s)))].filter(s => R.some(r => r.s === s));
    const bS = ss.map(s => O.agg(R.filter(r => r.s === s)));
    chart("c-shift", { type: "bar", data: { labels: ss, datasets: [
        { label: "OEE", data: bS.map(x => p1(x.OEE)), backgroundColor: bS.map(x => toneC(O.tone("OEE", x.OEE, M.MT))), borderRadius: 4 },
        { type: "line", label: "Mục tiêu", data: ss.map(() => M.MT.OEE), borderColor: css("--target"), borderDash: [6, 4], pointRadius: 0, borderWidth: 2 }] },
      options: { plugins: { legend: { display: false }, valueLabels: { on: true, fmt: v => v.toFixed(1).replace(".", ",") }, tooltip: { callbacks: { label: c => c.dataset.label + ": " + pct(c.parsed.y), afterLabel: c => c.datasetIndex ? "" : fmt(bS[c.dataIndex].hours, 1) + " giờ" } } },
        scales: { y: pctAxis(), x: { grid: { display: false } } } } });

    $("ov-actions").innerHTML = actions(R).map(x => `<li>${x}</li>`).join("");
  }

  function facVerdict(bf, fs) {
    if (fs.length < 2) return fs.length ? `Kỳ này mới có số liệu ${fs[0]}.` : "Không có số liệu trong kỳ.";
    const A = fs.map(f => O.agg(bf.filter(r => r.f === f)));
    const hi = A[0].OEE >= A[1].OEE ? 0 : 1, lo = 1 - hi;
    const w = ["A", "P", "Q"].map(k => ({ k, d: A[hi][k] - A[lo][k] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
    const thin = fs.filter((f, i) => A[i].n < 10);
    return `${fs[hi]} cao hơn ${fs[lo]} ${Math.abs(A[hi].OEE - A[lo].OEE).toFixed(1).replace(".", ",")} điểm OEE; chênh lớn nhất ở ${w.k} (${O.pts(w.d)} điểm).`
      + (thin.length ? ` ${thin.join(", ")} có dưới 10 ca máy — chưa đủ để kết luận.` : "");
  }

  function renderTrend(id, R, series) {
    const ds = M.dates.filter(d => d >= st.from && d <= st.to), labels = [...new Set(ds.map(bucket))];
    const by = O.groupBy(R, r => bucket(r.d)), val = rs => rs && rs.length ? p1(O.agg(rs).OEE) : null;
    const S = [css("--s1"), css("--s3"), css("--s4"), css("--bad")];   // khác màu đường OEE chung (xanh lá)
    chart(id, { type: "line", data: { labels, datasets: [
        { label: series.length ? "OEE chung" : "OEE", data: labels.map(l => val(by[l])), borderColor: css("--green"), backgroundColor: css("--green") + "22", fill: true, tension: .3, borderWidth: 3, pointRadius: 3 }]
        .concat(series.map((s, i) => ({ label: s.label, data: labels.map(l => val((by[l] || []).filter(s.test))), borderColor: S[i % S.length], backgroundColor: S[i % S.length], borderWidth: 2, pointRadius: 2, tension: .3, fill: false })))
        .concat([{ label: "Mục tiêu " + M.MT.OEE + "%", data: labels.map(() => M.MT.OEE), borderColor: css("--target"), borderDash: [6, 4], pointRadius: 0, borderWidth: 2, fill: false }]) },
      options: { spanGaps: true, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.dataset.label + ": " + pct(c.parsed.y) } } },
        scales: { y: pctAxis(30), x: { grid: { display: false } } } } });
  }

  function renderLoss(a) {
    // Thác nước: kế hoạch → − dừng → − chạy chậm → − lỗi → thời gian tạo SP tốt
    const plan = a.plan, stop = a.stop, speed = Math.max(0, a.speed), def = a.defTime, good = Math.max(0, plan - stop - speed - def);
    const steps = [["Thời gian kế hoạch", 0, plan, "--s1"], ["Dừng máy (A)", plan - stop, plan, "--bad"], ["Chạy chậm (P)", plan - stop - speed, plan - stop, "--warn"],
      ["Lỗi, làm lại (Q)", good, plan - stop - speed, "--s3"], ["Thời gian tạo SP tốt", 0, good, "--good"]];
    chart("c-waterfall", { type: "bar", data: { labels: steps.map(s => s[0]), datasets: [{ label: "Phút", data: steps.map(s => [Math.round(s[1]), Math.round(s[2])]), backgroundColor: steps.map(s => css(s[3])), borderRadius: 4 }] },
      options: { plugins: { legend: { display: false }, valueLabels: { on: true, fmt: v => fmt(v) },
          tooltip: { callbacks: { label: c => { const v = c.raw[1] - c.raw[0]; return fmt(v) + " phút" + (plan ? " (" + pct(v / plan * 100) + " kế hoạch)" : ""); } } } },
        scales: { y: { beginAtZero: true, grid: { color: css("--line") } }, x: { grid: { display: false } } } } });
    const items = a.losses.map(x => ({ l: x.l, v: x.v })).concat([{ l: "Chạy chậm / dừng vặt", v: speed }, { l: "Phế + làm lại (quy đổi)", v: def }])
      .filter(x => x.v > 0).sort((x, y) => y.v - x.v);
    const total = items.reduce((s, x) => s + x.v, 0); let cum = 0;
    chart("c-pareto", { type: "bar", data: { labels: items.map(x => x.l), datasets: [
        { label: "Phút", data: items.map(x => Math.round(x.v)), backgroundColor: items.map((x, i) => i === 0 ? css("--bad") : css("--s4")), borderRadius: 4, yAxisID: "y" },
        { type: "line", label: "% cộng dồn", data: items.map(x => (cum += x.v, p1(cum / total * 100))), borderColor: css("--s1"), pointRadius: 3, yAxisID: "y2" }] },
      options: { plugins: { legend: { display: false }, valueLabels: { on: true, fmt: v => fmt(v) }, tooltip: { callbacks: { label: c => c.datasetIndex ? pct(c.parsed.y) + " cộng dồn" : fmt(c.parsed.y) + " phút" } } },
        scales: { y: { beginAtZero: true, grid: { color: css("--line") } }, y2: { position: "right", min: 0, max: 100, ticks: { callback: v => v + "%" }, grid: { display: false } },
          x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 40 } } } } });
  }

  // ===================== ĐỀ XUẤT HÀNH ĐỘNG =====================
  function actions(R) {
    if (!R.length) return ["Không có số liệu trong phạm vi lọc."];
    const a = O.agg(R), out = [], FL = [...new Set(R.map(r => r.f))].sort().join(" + ");
    const due = n => O.dmy(O.addDays(O.today(), n));
    const byM = Object.entries(O.groupBy(R, "m")).map(([m, rs]) => ({ m, ...O.agg(rs) }));
    const w = ["A", "P", "Q"].map(k => ({ k, gap: a[k] - M.MT[k] })).filter(x => isFinite(x.gap)).sort((x, y) => x.gap - y.gap)[0];
    if (w && w.gap < 0 && w.k === "P") { const m = byM.filter(x => isFinite(x.P)).sort((x, y) => x.P - y.P)[0];
      out.push(`<b>Nâng hiệu suất (P ${pct(a.P)} &lt; ${M.MT.P}%)</b>: bấm giờ thực tế, chốt lại năng suất chuẩn và tìm nguyên nhân chạy chậm/dừng vặt ở máy <b>${esc(m.m)}</b> (P ${pct(m.P)}). Ước tính mất ${fmt(a.speed)} phút do chạy chậm.<span class="who">Phụ trách: Quản đốc ${FL} + Kỹ thuật SX · hạn ${due(7)}</span>`); }
    else if (w && w.gap < 0 && w.k === "A") out.push(`<b>Giảm dừng máy không kế hoạch (A ${pct(a.A)} &lt; ${M.MT.A}%)</b>: tổng ${fmt(a.stop)} phút dừng; dừng lớn nhất là ${esc(a.top.l)} (${fmt(a.top.v)} phút).<span class="who">Phụ trách: Quản đốc ${FL} + Bảo trì · hạn ${due(7)}</span>`);
    else if (w && w.gap < 0) out.push(`<b>Mở CAPA chất lượng (Q ${pct(a.Q)} &lt; ${M.MT.Q}%)</b>: ${fmt(a.p)} sp phế + ${fmt(a.r)} sp làm lại.<span class="who">Phụ trách: QC ${FL} + QA · hạn ${due(7)}</span>`);
    else out.push(`<b>Giữ chuẩn</b>: A, P, Q đều đạt mục tiêu (OEE ${pct(a.OEE)}). Chuẩn hoá cách vận hành hiện tại thành hướng dẫn công việc.<span class="who">Phụ trách: Kỹ thuật SX · hạn ${due(14)}</span>`);
    const MAP = { "Chờ phôi, vật tư": ["Cân bằng cấp phôi/vật tư: giữ tồn đệm đầu chuyền, Kế hoạch giao phôi theo giờ", "Tổ trưởng chuyền + Phòng Kế hoạch"],
      "Thay dao, chỉnh máy": ["Lập lịch thay dao/chỉnh máy theo sản lượng, chuẩn bị sẵn dao và gá dự phòng để rút ngắn thời gian chuyển đổi (SMED)", "Kỹ thuật SX + Bảo trì"],
      "Hỏng máy / sự cố": ["Lập kế hoạch bảo trì phòng ngừa cho máy dừng nhiều nhất, ghi nhật ký dừng máy theo bộ phận hỏng", "Bảo trì"],
      "Mất điện / khí nén": ["Kiểm tra nguồn điện, khí nén cấp cho chuyền và phương án dự phòng", "Bảo trì"],
      "Dừng khác": ["Tách nhóm \"Dừng khác\" thành nguyên nhân cụ thể trong nhật ký dừng máy", "Quản đốc " + FL] };
    if (a.top && a.top.v > 0 && !(w && w.k === "A")) out.push(`<b>${esc(a.top.l)}</b> là nhóm dừng lớn nhất: ${fmt(a.top.v)} phút (${pct(a.stop ? a.top.v / a.stop * 100 : NaN)} tổng dừng). ${MAP[a.top.l][0]}.<span class="who">Phụ trách: ${MAP[a.top.l][1]} · hạn ${due(5)}</span>`);
    const dq = checks(R), b = dq.find(x => x.t === "bad") || dq.find(x => x.t === "warn" && x.act);
    if (b) out.push(`<b>Chấn chỉnh số liệu</b>: ${esc(b.h)}. ${esc(b.act || "")}<span class="who">Phụ trách: QA + Thống kê ${FL} · hạn ${due(3)}</span>`);
    else { const m = byM.filter(x => isFinite(x.OEE)).sort((x, y) => x.OEE - y.OEE)[0]; if (m) out.push(`<b>Rà soát máy OEE thấp nhất ${esc(m.m)}</b> (${pct(m.OEE)}, ${fmt(m.hours, 1)} giờ).<span class="who">Phụ trách: Quản đốc ${FL} · hạn ${due(7)}</span>`); }
    return out.slice(0, 3);
  }

  // ===================== CHI TIẾT NHÀ MÁY =====================
  function renderFac() {
    const f = st.tab, R = rows(), a = O.agg(R), pr = O.agg(rows(prevRange()));
    $("fac-title").textContent = "Chi tiết " + f + " – " + (M.facName[f] || f);
    $("fac-kpis").innerHTML = [
      kpiCard("OEE " + f, `<span class="c-${O.tone("OEE", a.OEE, M.MT)}">${pct(a.OEE)}</span>`, `MT ${M.MT.OEE}% · kỳ trước ${pr.n ? pct(pr.OEE) : "—"} ${pr.n ? delta(a.OEE - pr.OEE) : ""}`, O.tone("OEE", a.OEE, M.MT), bar(a.OEE, "OEE")),
      ...["A", "P", "Q"].map(k => kpiCard({ A: "A – Khả dụng", P: "P – Hiệu suất", Q: "Q – Chất lượng" }[k], pct(a[k]), `MT ${M.MT[k]}% · kỳ trước ${pr.n ? pct(pr[k]) : "—"}`, O.tone(k, a[k], M.MT), bar(a[k], k))),
      kpiCard("Sản lượng tốt", fmt(a.good), `Tổng ${fmt(a.sl)} · phế ${fmt(a.p)} · làm lại ${fmt(a.r)}`),
      kpiCard("Giờ chạy máy", fmt(a.hours, 1), `Kế hoạch ${fmt(a.plan / 60, 1)} giờ · dừng ${fmt(a.stop)} phút`),
      kpiCard("Ca máy", fmt(a.n), `${R.filter(r => r.OEE < 60).length} ca OEE &lt; 60% · ${a.nP} ca thiếu NS chuẩn`),
      kpiCard("Dừng lớn nhất", a.top && a.top.v ? esc(a.top.l) : "—", a.top && a.top.v ? fmt(a.top.v) + " phút" : "Không có dừng máy ghi nhận")
    ].join("");

    const base = rows({ noC: true, noM: true }), tot = O.agg(base);
    const lines = M.lines.filter(l => base.some(r => r.c === l.c));
    const tr = (name, rs, strong) => { const x = O.agg(rs);
      return `<tr${strong ? ' style="font-weight:800"' : ""}><td>${name}</td><td class="r num"><b class="c-${O.tone("OEE", x.OEE, M.MT)}">${pct(x.OEE)}</b></td><td class="r num">${pct(x.A)}</td><td class="r num">${pct(x.P)}</td><td class="r num">${pct(x.Q)}</td><td class="r num">${fmt(x.hours, 1)}</td><td class="r num">${x.n}</td></tr>`; };
    $("fac-lines").innerHTML = `<thead><tr><th>Chuyền</th><th class="r">OEE</th><th class="r">A</th><th class="r">P</th><th class="r">Q</th><th class="r">Giờ</th><th class="r">Ca máy</th></tr></thead>
      <tbody>${lines.map(l => tr(esc(l.name), base.filter(r => r.c === l.c))).join("")}</tbody><tfoot>${tr("Tổng hợp " + f, base, false)}</tfoot>`;

    const byM = Object.entries(O.groupBy(R, "m")).sort().map(([m, rs]) => ({ m, ...O.agg(rs) })), S = SER();
    chart("c-fac-mach", { type: "bar", data: { labels: ["A", "P", "Q", "OEE"], datasets: byM.map((x, i) => ({ label: x.m, data: [x.A, x.P, x.Q, x.OEE].map(p1), backgroundColor: S[i % S.length], borderRadius: 3 }))
        .concat([{ type: "line", label: "Mục tiêu", data: [M.MT.A, M.MT.P, M.MT.Q, M.MT.OEE], showLine: false, pointStyle: "line", pointRadius: 16, pointBorderWidth: 3, borderColor: css("--target") }]) },
      options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.dataset.label + ": " + pct(c.parsed.y) } } }, scales: { y: pctAxis(), x: { grid: { display: false } } } } });

    renderTrend("c-fac-trend", R, lines.length > 1 && !st.c ? lines.map(l => ({ label: l.name, test: r => r.c === l.c })) : []);

    // Dừng máy: ưu tiên nhật ký dừng; thiếu nhật ký thì dùng cột dừng trong sổ ca
    const inR = x => x.f === f && x.d >= st.from && x.d <= st.to && (!st.c || x.c === st.c) && (!st.m || x.m === st.m) && (!st.s || x.s === st.s);
    const SK = M.stops.filter(inR), DK = M.defects.filter(inR);
    const stopItems = SK.length ? Object.entries(O.groupBy(SK, x => x.name || x.group || x.code)).map(([l, xs]) => ({ l, v: xs.reduce((s, x) => s + x.min, 0) }))
      : a.losses.map(x => ({ l: x.l, v: x.v }));
    stopItems.sort((x, y) => y.v - x.v);
    $("fac-stop-note").textContent = SK.length ? `Theo nhật ký dừng máy · ${SK.length} lần dừng · ${fmt(stopItems.reduce((s, x) => s + x.v, 0))} phút` : "Chưa có nhật ký dừng máy — dùng số phút dừng trong sổ ca";
    chart("c-fac-stop", { type: "bar", data: { labels: stopItems.map(x => x.l), datasets: [{ label: "Phút", data: stopItems.map(x => Math.round(x.v)), backgroundColor: stopItems.map((x, i) => i ? css("--s4") : css("--bad")), borderRadius: 4 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false }, valueLabels: { on: true, fmt: v => fmt(v) } }, scales: { x: { beginAtZero: true, grid: { color: css("--line") } }, y: { grid: { display: false } } } } });
    const defItems = DK.length ? Object.entries(O.groupBy(DK, x => (x.code ? x.code + " " : "") + (x.name || ""))).map(([l, xs]) => ({ l, v: xs.reduce((s, x) => s + x.qty, 0), rw: xs[0].rework }))
      : [{ l: "Phế phẩm", v: a.p, rw: false }, { l: "Làm lại", v: a.r, rw: true }].filter(x => x.v);
    defItems.sort((x, y) => y.v - x.v);
    $("fac-def-note").textContent = DK.length ? `Theo nhật ký lỗi · ${fmt(defItems.reduce((s, x) => s + x.v, 0))} sp · đậm: phế phẩm, nhạt: làm lại` : "Chưa có nhật ký lỗi theo mã — dùng tổng phế/làm lại trong sổ ca";
    chart("c-fac-def", { type: "bar", data: { labels: defItems.map(x => x.l), datasets: [{ label: "Sản phẩm", data: defItems.map(x => x.v), backgroundColor: defItems.map(x => x.rw ? css("--s3") : css("--bad")), borderRadius: 4 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false }, valueLabels: { on: true, fmt: v => fmt(v) } }, scales: { x: { beginAtZero: true, grid: { color: css("--line") } }, y: { grid: { display: false } } } } });

    renderRaw();
  }

  // ===================== BẢNG DỮ LIỆU GỐC =====================
  const RAW = {
    gd: { note: "Mỗi dòng = 1 ca × 1 máy trong sheet GD_OEE_CA. Cột đối chiếu so sánh phút dừng và số lỗi với nhật ký; lệch được tô màu.",
      cols: [["d", "Ngày"], ["s", "Ca"], ["cn", "Chuyền"], ["m", "Máy"], ["sp", "Mã SP"], ["u", "Người nhập"], ["t", "TG ca", 1], ["b", "Nghỉ KH", 1],
        ["h", "Hỏng", 1], ["k", "Thay dao", 1], ["w", "Chờ phôi", 1], ["e", "Điện/khí", 1], ["o", "Khác", 1], ["stop", "Tổng dừng", 1], ["nkStop", "Dừng theo NK", 1],
        ["sl", "Tổng SL", 1], ["p", "Phế", 1], ["r", "Làm lại", 1], ["nkDef", "Lỗi theo NK", 1], ["A", "A", 2], ["P", "P", 2], ["Q", "Q", 2], ["OEE", "OEE", 2],
        ["src", "Nguồn"], ["note", "Ghi chú"], ["row", "Dòng", 1]] },
    loi: { note: "Nhật ký lỗi (sheet NK_LOI): từng mã lỗi theo ca × máy.",
      cols: [["d", "Ngày"], ["s", "Ca"], ["cn", "Chuyền"], ["m", "Máy"], ["sp", "Mã SP"], ["code", "Mã lỗi"], ["name", "Tên lỗi"], ["type", "Loại"], ["qty", "Số lượng", 1], ["desc", "Mô tả"], ["who", "Người ghi"], ["row", "Dòng", 1]] },
    dung: { note: "Nhật ký dừng máy (sheet NK_DUNG_MAY). Số phút tính từ giờ bắt đầu – kết thúc.",
      cols: [["d", "Ngày"], ["s", "Ca"], ["cn", "Chuyền"], ["m", "Máy"], ["code", "Mã lý do"], ["name", "Lý do"], ["group", "Nhóm dừng"], ["type", "Loại dừng"], ["from", "Bắt đầu"], ["to", "Kết thúc"], ["min", "Số phút", 1], ["desc", "Hiện tượng"], ["fix", "Biện pháp"], ["who", "Người ghi"], ["row", "Dòng", 1]] }
  };
  const flagStop = x => x.nkStop != null && Math.abs(x.stop - x.nkStop) > 5;
  const flagDef = x => x.nkDef != null && x.nkDef !== x.p + x.r;
  const needsReview = x => x.OEE < 60 || x.P > 105 || !x.std || flagStop(x) || flagDef(x) || /chia|u[oớ]c t[ií]nh/i.test(x.src);
  function rawList() {
    const f = st.tab, inR = x => x.f === f && x.d >= st.from && x.d <= st.to && (!st.c || x.c === st.c) && (!st.m || x.m === st.m) && (!st.s || x.s === st.s);
    const src = st.raw === "gd" ? rows() : st.raw === "loi" ? M.defects.filter(inR) : M.stops.filter(inR);
    let L = src.map(x => Object.assign({ cn: M.lineName[x.c] || x.c }, x));
    if (st.raw === "gd" && st.only) L = L.filter(needsReview);
    if (st.q) { const q = O.norm(st.q); L = L.filter(x => O.norm(RAW[st.raw].cols.map(([k]) => k === "d" ? O.dmy(x.d) : x[k]).join(" ")).includes(q)); }
    const k = RAW[st.raw].cols.some(c => c[0] === st.sort) ? st.sort : "d";
    L.sort((a, b) => { const x = a[k], y = b[k]; return ((x > y) - (x < y)) * st.dir || (a.d < b.d ? 1 : a.d > b.d ? -1 : 0); });
    return L;
  }
  function cellHtml(x, k, kind) {
    const v = x[k];
    if (k === "d") return O.dmy(v);
    if (kind === 2) return `<span class="${k === "OEE" ? "c-" + O.tone("OEE", v, M.MT) : ""}">${pct(v)}</span>` + (k === "P" && v > 105 ? `<span class="flag t-warn" title="P > 105%: kiểm tra năng suất chuẩn">KT NS</span>` : "");
    if (k === "nkStop") return v == null ? `<span class="muted">—</span>` : `<span class="${flagStop(x) ? "flag t-bad" : ""}" title="${flagStop(x) ? "Lệch " + fmt(x.stop - v) + " phút so với tổng dừng" : ""}">${fmt(v)}</span>`;
    if (k === "nkDef") return v == null ? `<span class="muted">—</span>` : `<span class="${flagDef(x) ? "flag t-bad" : ""}" title="${flagDef(x) ? "Phế + làm lại = " + fmt(x.p + x.r) : ""}">${fmt(v)}</span>`;
    if (k === "src") return /chia|u[oớ]c t[ií]nh/i.test(v) ?`<span class="flag t-warn">${esc(v)}</span>` : esc(v);
    if (kind === 1) return v === 0 && ["h", "k", "w", "e", "o"].includes(k) ? `<span class="muted">0</span>` : fmt(v, k === "min" ? 0 : 0);
    return esc(v);
  }
  function renderRaw() {
    document.querySelectorAll("#raw-tabs .subtab").forEach(b => b.setAttribute("aria-selected", b.dataset.raw === st.raw));
    $("raw-only-wrap").hidden = st.raw !== "gd"; $("raw-only").checked = st.only;
    const cfg = RAW[st.raw], L = rawList(), pages = Math.max(1, Math.ceil(L.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const view = L.slice(st.page * PAGE, (st.page + 1) * PAGE);
    $("raw-note").textContent = cfg.note;
    let foot = "";
    if (st.raw === "gd" && L.length) { const a = O.agg(L);
      foot = `<tfoot><tr>${cfg.cols.map(([k, , n]) => `<td class="${n ? "r num" : ""}">${k === "d" ? "Tổng / BQGQ" : { t: fmt(a.t), b: fmt(a.b), h: fmt(a.h), k: fmt(a.k), w: fmt(a.w), e: fmt(a.e), o: fmt(a.o), stop: fmt(a.stop), sl: fmt(a.sl), p: fmt(a.p), r: fmt(a.r), A: pct(a.A), P: pct(a.P), Q: pct(a.Q), OEE: pct(a.OEE) }[k] || ""}</td>`).join("")}</tr></tfoot>`; }
    if (st.raw !== "gd" && L.length) { const s = L.reduce((t, x) => t + (st.raw === "loi" ? x.qty : x.min), 0);
      foot = `<tfoot><tr>${cfg.cols.map(([k, , n]) => `<td class="${n ? "r num" : ""}">${k === "d" ? "Tổng" : (k === "qty" || k === "min") ? fmt(s) : ""}</td>`).join("")}</tr></tfoot>`; }
    $("raw-table").innerHTML = `<thead><tr>${cfg.cols.map(([k, l, n]) => `<th class="${n ? "r" : ""}" data-sort="${k}">${l}${st.sort === k ? (st.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
      <tbody>${view.length ? view.map(x => `<tr>${cfg.cols.map(([k, , n]) => `<td class="${n ? "r num" : ""} ${["d", "s", "m", "cn"].includes(k) ? "nw" : ""}">${cellHtml(x, k, n)}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${cfg.cols.length}" class="muted" style="text-align:center;padding:24px">Không có dòng nào trong phạm vi lọc.</td></tr>`}</tbody>${foot}`;
    $("raw-info").textContent = `${fmt(L.length)} dòng · trang ${st.page + 1}/${pages}`;
    $("raw-prev").disabled = st.page === 0; $("raw-next").disabled = st.page >= pages - 1;
  }
  function exportCsv() {
    const cfg = RAW[st.raw], L = rawList();
    const val = (x, k) => k === "d" ? O.dmy(x.d) : ["A", "P", "Q", "OEE"].includes(k) ? (isFinite(x[k]) ? x[k].toFixed(1) : "") : x[k] ?? "";
    const csv = [cfg.cols.map(c => c[1])].concat(L.map(x => cfg.cols.map(([k]) => val(x, k))))
      .map(r => r.map(v => /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `OEE_${st.tab}_${st.raw}_${st.from}_${st.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ===================== CHẤT LƯỢNG DỮ LIỆU =====================
  function checks(R) {
    const out = [];
    if (!R.length) return [{ t: "good", h: "Không có ca nào trong phạm vi lọc" }];
    const noStd = R.filter(r => !r.std);
    if (noStd.length) out.push({ t: "bad", h: `${noStd.length} ca thiếu năng suất chuẩn — chưa tính được P và OEE`, act: "Khai năng suất chuẩn trong DM_MAY.",
      d: "Máy: " + [...new Set(noStd.map(r => r.m))].slice(0, 8).join(", ") });
    const split = R.filter(r => /chia/i.test(r.src));
    if (split.length) out.push({ t: "bad", h: `${split.length}/${R.length} ca có sản lượng "chia tỷ lệ", không đếm riêng từng máy`, act: "Đếm sản lượng riêng từng máy (bộ đếm hoặc theo pallet).",
      d: "OEE so sánh giữa các máy của những ca này chưa dùng để kết luận được; OEE chuyền vẫn dùng được." });
    const est = R.filter(r => /u[oớ]c t[ií]nh/i.test(r.src));
    if (est.length) out.push({ t: "warn", h: `${est.length}/${R.length} ca có số liệu "Ước tính"`, act: "Thay bằng số đo thực tế khi có.",
      d: "Máy: " + [...new Set(est.map(r => r.m))].slice(0, 8).join(", ") });
    const hiP = R.filter(r => r.P > 105);
    if (hiP.length) out.push({ t: "warn", h: `${hiP.length} ca có P > 105%`, act: "Kiểm tra lại năng suất chuẩn hoặc sản lượng nhập.",
      d: "Máy không thể chạy nhanh hơn chuẩn quá 5%. Ví dụ: " + hiP.slice(0, 5).map(r => `${r.f} ${O.dm(r.d)} ${r.s} ${r.m}`).join("; ") });
    const sDiff = R.filter(flagStop);
    if (sDiff.length) out.push({ t: "warn", h: `${sDiff.length} ca lệch phút dừng giữa sổ ca và nhật ký dừng máy (> 5 phút)`, act: "Đối chiếu lại nhật ký dừng máy với sổ ca.",
      d: sDiff.slice(0, 5).map(r => `${r.f} ${O.dm(r.d)} ${r.m}: ${fmt(r.stop)} vs ${fmt(r.nkStop)} ph`).join("; ") });
    const dDiff = R.filter(flagDef);
    if (dDiff.length) out.push({ t: "warn", h: `${dDiff.length} ca lệch số lỗi giữa sổ ca và nhật ký lỗi`, act: "Đối chiếu nhật ký lỗi với phế + làm lại trong sổ ca.",
      d: dDiff.slice(0, 5).map(r => `${r.f} ${O.dm(r.d)} ${r.m}: ${fmt(r.p + r.r)} vs ${fmt(r.nkDef)}`).join("; ") });
    const noStop = R.filter(r => r.stop === 0 && r.sl > 0).length;
    if (noStop) out.push({ t: "warn", h: `${noStop} ca không ghi phút dừng nào`, act: "Bắt buộc ghi dừng máy, kể cả dừng ngắn.", d: "A = 100% ở các ca này có thể chưa phản ánh đúng thực tế." });
    const noDef = R.filter(r => r.p + r.r === 0 && r.sl > 0).length;
    if (noDef) out.push({ t: "warn", h: `${noDef} ca không ghi phế phẩm/làm lại`, d: "Q = 100% ở các ca này — kiểm tra QC có ghi nhận lỗi không." });
    const noNote = R.filter(r => r.OEE < 60 && !r.note).length;
    if (noNote) out.push({ t: "warn", h: `${noNote} ca OEE < 60% không ghi nguyên nhân`, act: "Ca cảnh báo phải có nguyên nhân chính để làm CAPA." });
    const blank = R.filter(r => !r.u).length;
    if (blank) out.push({ t: "warn", h: `${blank} ca để trống người nhập`, d: "Không truy được người chịu trách nhiệm số liệu." });
    return out.length ? out : [{ t: "good", h: "Không phát hiện bất thường trong số liệu nhập" }];
  }
  function renderDQ() {
    const R = rows(), ic = { bad: "!", warn: "?", good: "✓" };
    $("dq-list").innerHTML = checks(R).map(x => `<li><span class="ic t-${x.t}">${ic[x.t]}</span><div><b class="${x.t === "bad" ? "c-bad" : ""}">${esc(x.h)}</b>
      ${x.d ? `<div class="muted small">${esc(x.d)}</div>` : ""}${x.act ? `<div class="small">→ ${esc(x.act)}</div>` : ""}</div></li>`).join("");
    const fs = M.facs.filter(f => !st.f || f === st.f);
    $("dq-cover").innerHTML = `<div class="tbl-wrap" style="max-height:none"><table><thead><tr><th>Tiêu chí</th>${fs.map(f => `<th class="r">${f}</th>`).join("")}</tr></thead><tbody>
      ${[["Ca máy có số liệu", rs => fmt(rs.length)],
        ["Có NS chuẩn", rs => pct(rs.filter(r => r.std).length / rs.length * 100, 0)],
        ["Đếm riêng từng máy", rs => pct(rs.filter(r => !/chia/i.test(r.src)).length / rs.length * 100, 0)],
        ["Số liệu đo thực tế (không ước tính)", rs => pct(rs.filter(r => !/u[oớ]c t[ií]nh/i.test(r.src)).length / rs.length * 100, 0)],
        ["Có nhật ký dừng máy", rs => pct(rs.filter(r => r.nkStop != null).length / rs.length * 100, 0)],
        ["Có nhật ký lỗi", rs => pct(rs.filter(r => r.nkDef != null).length / rs.length * 100, 0)],
        ["Có người nhập", rs => pct(rs.filter(r => r.u).length / rs.length * 100, 0)]]
        .map(([l, fn]) => `<tr><td>${l}</td>${fs.map(f => { const rs = R.filter(r => r.f === f); return `<td class="r num">${rs.length ? fn(rs) : "—"}</td>`; }).join("")}</tr>`).join("")}
      </tbody></table></div>`;
  }

  // ===================== RENDER CHUNG =====================
  function render() {
    applyPeriod(); renderTabs(); renderFilters();
    document.querySelectorAll(".slide-title .ctx").forEach(e => e.textContent = ctxText());
    if (st.tab === "overview") renderOverview(); else if (st.tab === "dq") renderDQ(); else renderFac();
    save();
  }
  function renderMeta() {
    const gen = M.generatedAt ? new Date(M.generatedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "";
    $("meta").textContent = M.dates.length ? `Số liệu ${O.dmy(M.dates[0])} – ${O.dmy(M.dates.at(-1))} · ${fmt(M.facts.length)} ca máy · cập nhật ${gen}` : "Chưa có số liệu";
    $("foot").innerHTML = `Nguồn: Google Sheet <b>CSDL_OEE_Vi</b> (GD_OEE_CA, NK_LOI, NK_DUNG_MAY, danh mục DM_*). OEE ca = A × P × Q với A = TG chạy ÷ TG kế hoạch,
      P = SL thực tế ÷ (TG chạy × NS chuẩn), Q = SL tốt ÷ SL thực tế. OEE máy, chuyền, nhà máy và OEE chung = bình quân gia quyền các ca theo giờ chạy máy thực tế
      (TG ca − nghỉ có kế hoạch − tổng dừng). Mục tiêu: A ${M.MT.A}% · P ${M.MT.P}% · Q ${M.MT.Q}% · OEE ${M.MT.OEE}% (sheet CAU_HINH).`;
  }

  // ===================== TẢI DỮ LIỆU =====================
  let busy = false;
  async function load(fresh) {
    if (busy) return; busy = true; $("btn-refresh").disabled = true;
    try {
      const raw = await O.fetchData(fresh);
      M = O.build(raw);
      if (!M.facts.length) throw new Error("Sheet GD_OEE_CA chưa có ca nào có số liệu.");
      $("state").hidden = true; renderMeta(); render();
      if (fresh) toast("Đã cập nhật số liệu mới nhất.");
    } catch (e) {
      if (!O.cfg.GAS_URL) { $("state").innerHTML = O.setupHtml(); $("meta").textContent = "Chưa kết nối dữ liệu"; }
      else if (!M) { $("state").innerHTML =`<div style="font-size:28px">⚠</div><div>${esc(e.message)}</div><p><button class="btn" onclick="location.reload()">Thử lại</button></p>`; }
      else toast(e.message, true);
    } finally { busy = false; $("btn-refresh").disabled = false; }
  }
  function toast(msg, bad) { const t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); }

  // ===================== TRÌNH CHIẾU =====================
  let cur = 0;
  const slides = () => [...document.querySelectorAll(st.tab === "overview" ? "#tab-overview .slide" : "#tab-fac .slide")];
  function show(i) {
    const S = slides(); cur = Math.max(0, Math.min(S.length - 1, i));
    S.forEach((s, j) => s.classList.toggle("cur", j === cur));
    $("pv-no").textContent = (cur + 1) + " / " + S.length; $("present-ctx").textContent = ctxText();
    window.scrollTo(0, 0); requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize()));
  }
  function present(on) {
    if (on && st.tab === "dq") { st.tab = "overview"; render(); }
    document.body.classList.toggle("presenting", on);
    if (on) { show(0); document.documentElement.requestFullscreen?.().catch(() => {}); }
    else { document.querySelectorAll(".slide.cur").forEach(s => s.classList.remove("cur")); if (document.fullscreenElement) document.exitFullscreen?.(); requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize())); }
  }

  // ===================== SỰ KIỆN =====================
  const set = (patch) => { Object.assign(st, patch, { page: 0 }); render(); };
  $("f-period").onchange = e => set({ period: e.target.value });
  $("f-from").onchange = e => { const v = e.target.value; if (v) set({ from: v, to: st.to < v ? v : st.to }); };
  $("f-to").onchange = e => { const v = e.target.value; if (v) set({ to: v, from: st.from > v ? v : st.from }); };
  $("f-fac").onchange = e => set({ f: e.target.value });
  $("f-line").onchange = e => set({ c: e.target.value, m: "" });
  $("f-mach").onchange = e => set({ m: e.target.value });
  $("f-shift").onchange = e => set({ s: e.target.value });
  $("f-grain").onchange = e => set({ grain: e.target.value });
  $("btn-reset").onclick = () => { const tab = st.tab; st = DEF(); st.tab = tab; render(); };
  $("btn-refresh").onclick = () => load(true);
  $("btn-print").onclick = () => window.print();
  $("btn-present").onclick = () => present(true);
  $("pv-prev").onclick = () => show(cur - 1); $("pv-next").onclick = () => show(cur + 1); $("pv-exit").onclick = () => present(false);
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && document.body.classList.contains("presenting")) present(false); });
  document.addEventListener("keydown", e => {
    if (!document.body.classList.contains("presenting")) return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); show(cur + 1); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); show(cur - 1); }
    else if (e.key === "Escape") present(false);
  });
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tab]"); if (t) { set({ tab: t.dataset.tab, sort: "d", dir: -1 }); window.scrollTo({ top: 0 }); return; }
    const l = e.target.closest(".line-card[data-line]"); if (l && !document.body.classList.contains("presenting")) { set({ c: st.c === l.dataset.line ? "" : l.dataset.line, m: "" }); return; }
    const r = e.target.closest("[data-raw]"); if (r) { st.raw = r.dataset.raw; st.page = 0; st.sort = "d"; st.dir = -1; renderRaw(); return; }
    const th = e.target.closest("#raw-table th[data-sort]"); if (th) { st.dir = st.sort === th.dataset.sort ? -st.dir : -1; st.sort = th.dataset.sort; renderRaw(); }
  });
  let tq; $("raw-q").oninput = e => { clearTimeout(tq); tq = setTimeout(() => { st.q = e.target.value.trim(); st.page = 0; renderRaw(); }, 200); };
  $("raw-only").onchange = e => { st.only = e.target.checked; st.page = 0; renderRaw(); };
  $("raw-prev").onclick = () => { st.page--; renderRaw(); };
  $("raw-next").onclick = () => { st.page++; renderRaw(); };
  $("raw-csv").onclick = exportCsv;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => M && render());

  load(false);
})();
