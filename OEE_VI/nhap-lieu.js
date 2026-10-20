/* Trang nhập liệu: đăng nhập (Gmail hoặc khoá bí mật) → ghi sổ ca vào GD_OEE_CA và chi tiết lỗi vào NK_LOI */
(function () {
  const O = window.OEE, $ = id => document.getElementById(id), esc = O.esc, fmt = O.fmt, pct = O.pct;
  const SKEY = "oee-vi-session";
  let M = null, S = null;       // dữ liệu, phiên đăng nhập {token, user, exp}

  // ===================== PHIÊN =====================
  const getSession = () => { try { const s = JSON.parse(localStorage.getItem(SKEY) || "null"); return s && s.exp > Date.now() ? s : null; } catch (e) { return null; } };
  const setSession = s => { try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch (e) {} };

  async function login(body) {
    $("login-msg").hidden = true; $("btn-login").disabled = true;
    try {
      const r = await O.post(Object.assign({ action: "login" }, body));
      S = { token: r.token, user: r.user, exp: Date.now() + (r.expiresIn - 60) * 1000 };
      setSession(S); $("key").value = ""; afterLogin();
    } catch (e) { $("login-msg").textContent = e.message; $("login-msg").hidden = false; }
    finally { $("btn-login").disabled = false; }
  }
  function showLogin() {
    $("app").hidden = true; $("login").hidden = false; $("btn-logout").hidden = true; $("who").textContent = "Chưa đăng nhập";
    const cid = O.cfg.GOOGLE_CLIENT_ID;
    if (cid && !window.__gsi) {
      window.__gsi = true;
      const sc = document.createElement("script"); sc.src = "https://accounts.google.com/gsi/client"; sc.async = true;
      sc.onload = () => { google.accounts.id.initialize({ client_id: cid, callback: r => login({ idToken: r.credential }) });
        google.accounts.id.renderButton($("g-btn"), { theme: "outline", size: "large", text: "signin_with", locale: "vi", width: 300 }); $("g-wrap").hidden = false; };
      document.head.appendChild(sc);
    }
  }
  function afterLogin() {
    const u = S.user;
    $("who").textContent = `${u.name} · ${u.f === "TẤT CẢ" ? "NS1 + NS2" : u.f} · ${u.role} · đăng nhập bằng ${u.via}`;
    $("btn-logout").hidden = false; $("login").hidden = true;
    if (M) { $("app").hidden = false; initForm(); }
  }
  $("key-form").onsubmit = e => { e.preventDefault(); login({ key: $("key").value }); };
  $("btn-logout").onclick = async () => { try { await O.post({ action: "logout", token: S.token }); } catch (e) {} S = null; setSession(null); window.google?.accounts?.id?.disableAutoSelect?.(); showLogin(); };

  // ===================== FORM =====================
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`;
  const allowedFacs = () => S.user.f === "TẤT CẢ" ? M.facs : M.facs.filter(f => f === S.user.f);
  let inited = false;
  function initForm() {
    const fs = allowedFacs();
    $("i-f").innerHTML = fs.map(f => opt(f, f + " – " + (M.facName[f] || f))).join("");
    $("i-f").disabled = fs.length < 2;
    $("i-d").max = O.today(); $("i-d").min = S.user.role === "Quản trị" ? "" : O.addDays(O.today(), -31);
    if (!$("i-d").value) $("i-d").value = O.today();
    $("i-s").innerHTML = M.shifts.map(s => opt(s.s, s.s)).join("");
    if (!inited) { inited = true; applyShift(); }
    fillLines(); renderRecent(); if (!$("def-rows").children.length) addDef();
    recalc();
  }
  function fillLines() {
    const f = $("i-f").value, cur = $("i-c").value;
    const cs = M.lines.filter(l => Object.values(M.machines).some(m => m.f === f && m.c === l.c && m.track));
    $("i-c").innerHTML = cs.map(l => opt(l.c, l.name, cur)).join("");
    fillMachines();
  }
  function fillMachines() {
    const f = $("i-f").value, c = $("i-c").value, cur = $("i-m").value;
    const ms = Object.values(M.machines).filter(m => m.f === f && m.c === c && m.track).sort((a, b) => a.m.localeCompare(b.m));
    $("i-m").innerHTML = ms.map(m => opt(m.m, m.m + " · " + m.name + (m.std ? ` (${fmt(m.std)} ${m.unit}/giờ)` : " – chưa có NS chuẩn"), cur)).join("");
    const sps = M.products.filter(p => !p.c || p.c === c), spCur = $("i-sp").value;
    $("i-sp").innerHTML = opt("", "— Không ghi —", spCur) + sps.map(p => opt(p.sp, p.sp + " · " + p.name, spCur)).join("");
    const dcs = M.defectCodes.filter(d => !d.c || d.c === c);
    document.querySelectorAll("#def-rows select").forEach(s => { const v = s.value; s.innerHTML = defOpts(dcs, v); });
    missing(); recalc();
  }
  function applyShift() {
    const sh = M.shifts.find(s => s.s === $("i-s").value);
    if (sh) { $("i-t").value = sh.t || ""; $("i-b").value = sh.b || 0; }
  }
  // Máy chưa có số liệu cho ngày + ca đang chọn
  function missing() {
    const f = $("i-f").value, d = $("i-d").value, s = $("i-s").value;
    const ms = Object.values(M.machines).filter(m => m.f === f && m.track);
    const done = new Set(M.facts.filter(r => r.f === f && r.d === d && r.s === s).map(r => r.m));
    const miss = ms.filter(m => !done.has(m.m));
    $("missing").innerHTML = !d ? "" : miss.length
      ? `Chưa nhập ${O.dm(d)} · ${esc(s)}: ` + miss.map(m => `<button type="button" class="subtab" data-pick="${esc(m.m)}" data-c="${esc(m.c)}">${esc(m.m)}</button>`).join(" ")
      : `<span class="c-good">✓ Đã nhập đủ ${ms.length} máy cho ${O.dm(d)} · ${esc(s)}.</span>`;
  }

  // ---------- dòng lỗi ----------
  const defOpts = (dcs, v) => opt("", "— chọn mã lỗi —", v) + dcs.map(d => opt(d.code, `${d.code} · ${d.name} (${d.rework ? "làm lại" : "phế"})`, v)).join("");
  function addDef(x = {}) {
    const c = $("i-c").value, dcs = M.defectCodes.filter(d => !d.c || d.c === c);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><select class="d-code" style="width:100%">${defOpts(dcs, x.code || "")}</select></td>
      <td class="r"><input type="number" class="d-qty" min="1" step="1" inputmode="numeric" style="width:100%;text-align:right" value="${x.qty || ""}"></td>
      <td><input type="text" class="d-desc" maxlength="300" style="width:100%" value="${esc(x.desc || "")}"></td>
      <td><button type="button" class="btn d-del" title="Xoá dòng" aria-label="Xoá dòng">×</button></td>`;
    $("def-rows").appendChild(tr);
  }
  const defMode = () => document.querySelector('input[name="dm"]:checked').value;
  function defLines() {
    return [...$("def-rows").children].map(tr => ({ code: tr.querySelector(".d-code").value, qty: +tr.querySelector(".d-qty").value || 0, desc: tr.querySelector(".d-desc").value.trim() }))
      .filter(x => x.code || x.qty);
  }
  function syncDefMode() {
    const det = defMode() === "detail";
    $("def-box").hidden = !det; $("i-p").readOnly = $("i-r").readOnly = det;
    if (det) { let p = 0, r = 0; defLines().forEach(x => { const d = M.defectCodes.find(z => z.code === x.code); if (d && d.rework) r += x.qty; else if (d) p += x.qty; });
      $("i-p").value = p; $("i-r").value = r; }
  }

  // ---------- tính tạm ----------
  const n = id => { const v = $(id).value; return v === "" ? 0 : Number(v); };
  function current() {
    const m = M.machines[$("i-m").value] || {};
    return { f: $("i-f").value, d: $("i-d").value, s: $("i-s").value, c: $("i-c").value, m: $("i-m").value, sp: $("i-sp").value,
      t: n("i-t"), b: n("i-b"), h: n("i-h"), k: n("i-k"), w: n("i-w"), e: n("i-e"), o: n("i-o"), sl: n("i-sl"), p: n("i-p"), r: n("i-r"),
      note: $("i-note").value.trim(), std: m.std || 0 };
  }
  function recalc() {
    syncDefMode();
    const x = current(), c = O.calc(x), t = k => O.tone(k, c[k], M.MT);
    if ($("i-sl").value === "") c.P = c.Q = c.OEE = NaN;   // chưa nhập sản lượng
    $("calc").innerHTML = [["TG kế hoạch", fmt(c.plan) + " ph"], ["Tổng dừng", fmt(c.stop) + " ph"], ["TG chạy", fmt(c.run) + " ph"],
      ["A", `<span class="c-${t("A")}">${pct(c.A)}</span>`], ["P", `<span class="c-${t("P")}">${pct(c.P)}</span>`], ["Q", `<span class="c-${t("Q")}">${pct(c.Q)}</span>`],
      ["OEE", `<span class="c-${t("OEE")}">${pct(c.OEE)}</span>`]].map(([l, v]) => `<div class="calc"><span>${l}</span><b class="num">${v}</b></div>`).join("");
    $("note-req").hidden = !(c.OEE < 60);
    const w = warnings(x, c);
    $("form-msg").hidden = !w.length; $("form-msg").className = "msg " + (w.some(z => z.bad) ? "t-bad" : "t-warn");
    $("form-msg").innerHTML = w.map(z => "• " + esc(z.t)).join("<br>");
    // dòng đã tồn tại?
    const ex = M.facts.find(r => r.f === x.f && r.d === x.d && r.s === x.s && r.m === x.m && r.sp === x.sp);
    $("edit-flag").innerHTML = ex ? `<span class="pill t-warn">Đã có số liệu (dòng ${ex.row}) — lưu sẽ ghi đè</span>` : `<span class="pill t-good">Ca mới</span>`;
  }
  function warnings(x, c) {
    const w = [];
    if (!x.std && x.m) w.push({ t: "Máy chưa có năng suất chuẩn trong DM_MAY — chưa tính được P và OEE." });
    if (x.b > x.t) w.push({ bad: 1, t: "Nghỉ có kế hoạch lớn hơn thời gian ca." });
    if (c.stop > c.plan) w.push({ bad: 1, t: `Tổng dừng ${fmt(c.stop)} phút lớn hơn thời gian kế hoạch ${fmt(c.plan)} phút.` });
    if (x.p + x.r > x.sl) w.push({ bad: 1, t: "Phế phẩm + làm lại lớn hơn tổng sản lượng." });
    if (c.P > 105) w.push({ t: `P = ${pct(c.P)} > 105%: kiểm tra lại sản lượng hoặc thời gian dừng.` });
    if (defMode() === "detail" && defLines().some(d => !d.code || d.qty <= 0)) w.push({ bad: 1, t: "Dòng lỗi thiếu mã lỗi hoặc số lượng." });
    return w;
  }

  // ---------- lưu ----------
  async function submit(overwrite) {
    const x = current(), c = O.calc(x);
    if (!x.f || !x.d || !x.s || !x.m || !x.t || $("i-sl").value === "") return msg("Điền đủ các ô có dấu *.", true);
    if (warnings(x, c).some(z => z.bad)) return msg("Sửa các lỗi được đánh dấu đỏ trước khi lưu.", true);
    if (c.OEE < 60 && !x.note) { $("i-note").focus(); return msg("OEE < 60%: ghi nguyên nhân chính trước khi lưu.", true); }
    $("btn-save").disabled = true; $("btn-save").textContent = "Đang lưu…";
    try {
      const body = { action: "save", token: S.token, row: x, defectMode: defMode(), defects: defMode() === "detail" ? defLines() : [], overwrite: !!overwrite };
      const r = await O.post(body);
      if (r.exists) { if (confirm(r.message)) return submit(true); return; }
      toast(`Đã ${r.mode === "new" ? "thêm" : "ghi đè"} ${x.m} · ${O.dm(x.d)} · ${x.s} (dòng ${r.row}).`);
      await reload();
      clearProduction();
    } catch (e) {
      if (/het han|hết hạn/i.test(e.message)) { S = null; setSession(null); showLogin(); }
      msg(e.message, true);
    } finally { $("btn-save").disabled = false; $("btn-save").textContent = "Lưu vào CSDL_OEE_Vi"; }
  }
  function msg(t, bad) { $("form-msg").hidden = false; $("form-msg").className = "msg " + (bad ? "t-bad" : "t-good"); $("form-msg").textContent = t; $("form-msg").scrollIntoView({ block: "center", behavior: "smooth" }); }
  function clearProduction() {
    ["i-h", "i-k", "i-w", "i-e", "i-o", "i-sl", "i-p", "i-r", "i-note"].forEach(id => $(id).value = "");
    $("def-rows").innerHTML = ""; addDef();
    // chuyển sang máy kế tiếp chưa nhập
    const next = [...$("i-m").options].map(o => o.value).find(m => !M.facts.some(r => r.f === $("i-f").value && r.d === $("i-d").value && r.s === $("i-s").value && r.m === m));
    if (next) $("i-m").value = next;
    missing(); recalc();
  }
  function loadRow(r) {
    $("i-f").value = r.f; fillLines(); $("i-c").value = r.c; fillMachines();
    $("i-d").value = r.d; $("i-s").value = r.s; $("i-m").value = r.m; $("i-sp").value = r.sp;
    ["t", "b", "h", "k", "w", "e", "o", "sl", "p", "r"].forEach(k => $("i-" + k).value = r[k] || k === "t" || k === "sl" ? r[k] : "");
    $("i-note").value = r.note;
    const ds = M.defects.filter(d => d.f === r.f && d.d === r.d && d.s === r.s && d.m === r.m && d.sp === r.sp);
    $("def-rows").innerHTML = "";
    if (ds.length) { document.querySelector('input[name="dm"][value="detail"]').checked = true; ds.forEach(d => addDef(d)); }
    else { document.querySelector('input[name="dm"][value="' + (r.p + r.r ? "total" : "detail") + '"]').checked = true; addDef(); }
    missing(); recalc(); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- đã nhập gần đây ----------
  let recentRows = [];
  function renderRecent() {
    const fs = allowedFacs(), from = O.addDays(O.today(), -14);
    recentRows = M.facts.filter(r => fs.includes(r.f) && r.d >= from).sort((a, b) => b.d.localeCompare(a.d) || a.s.localeCompare(b.s) || a.m.localeCompare(b.m));
    $("recent-note").textContent = `${fs.join(" + ")} · 14 ngày gần nhất · ${recentRows.length} ca máy`;
    $("recent").innerHTML = `<thead><tr><th>Ngày</th><th>Ca</th><th>Máy</th><th class="r">SL</th><th class="r">OEE</th><th>Người nhập</th></tr></thead><tbody>
      ${recentRows.length ? recentRows.map((r, i) => `<tr data-i="${i}" style="cursor:pointer"><td class="nw">${O.dm(r.d)}</td><td class="nw">${esc(r.s)}</td><td class="nw">${esc(r.m)}</td>
        <td class="r num">${fmt(r.sl)}</td><td class="r num"><b class="c-${O.tone("OEE", r.OEE, M.MT)}">${pct(r.OEE)}</b></td><td>${esc(r.u)}</td></tr>`).join("")
        : `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Chưa có ca nào trong 14 ngày gần nhất.</td></tr>`}</tbody>`;
  }

  // ===================== SỰ KIỆN =====================
  $("i-f").onchange = () => { fillLines(); renderRecent(); };
  $("i-c").onchange = fillMachines;
  $("i-s").onchange = () => { applyShift(); missing(); recalc(); };
  $("i-d").onchange = () => { missing(); recalc(); };
  $("i-m").onchange = recalc; $("i-sp").onchange = recalc;
  $("form").addEventListener("input", e => { if (e.target.matches("input,textarea")) recalc(); });
  $("form").addEventListener("change", e => { if (e.target.matches('input[name="dm"], .d-code')) recalc(); });
  $("form").onsubmit = e => { e.preventDefault(); submit(false); };
  $("btn-clear").onclick = clearProduction;
  $("def-add").onclick = () => addDef();
  document.addEventListener("click", e => {
    const d = e.target.closest(".d-del"); if (d) { d.closest("tr").remove(); if (!$("def-rows").children.length) addDef(); recalc(); return; }
    const p = e.target.closest("[data-pick]"); if (p) { $("i-c").value = p.dataset.c; fillMachines(); $("i-m").value = p.dataset.pick; recalc(); return; }
    const tr = e.target.closest("#recent tr[data-i]"); if (tr) loadRow(recentRows[+tr.dataset.i]);
  });
  function toast(t, bad) { const el = document.createElement("div"); el.className = "toast" + (bad ? " bad" : ""); el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 4000); }

  // ===================== KHỞI ĐỘNG =====================
  async function reload() { M = O.build(await O.fetchData(true)); renderRecent(); missing(); recalc(); }
  (async () => {
    S = getSession();
    try { M = O.build(await O.fetchData(false)); $("state").hidden = true; }
    catch (e) { $("state").innerHTML = O.cfg.GAS_URL ? `<div style="font-size:28px">⚠</div><div>${esc(e.message)}</div>` : O.setupHtml(); return; }
    if (!S) return showLogin();
    try { const r = await O.post({ action: "me", token: S.token }); S.user = r.user; afterLogin(); }
    catch (e) { S = null; setSession(null); showLogin(); }
  })();
})();
