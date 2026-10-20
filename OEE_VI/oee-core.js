/* Lõi dùng chung: gọi API Apps Script, chuẩn hoá dữ liệu CSDL_OEE_Vi, tính OEE.
 * Quy ước tổng hợp: A, P, Q, OEE của mọi nhóm (máy, chuyền, nhà máy, toàn bộ) = bình quân gia quyền
 * các ca, trọng số = thời gian chạy máy thực tế (TG ca − nghỉ có KH − tổng dừng). */
(function () {
  const CFG = window.OEE_CONFIG || {};
  const O = window.OEE = { cfg: CFG };

  // ---------------- API ----------------
  O.fetchData = async function (fresh) {
    if (!CFG.GAS_URL) throw new Error("Chưa cấu hình GAS_URL trong OEE_VI/config.js.");
    const url = CFG.GAS_URL + (CFG.GAS_URL.includes("?") ? "&" : "?") + "action=data" + (fresh ? "&fresh=1&t=" + Date.now() : "");
    let r, txt;
    for (let i = 0; i < 2; i++) {   // Apps Script đôi khi trả lỗi thoáng qua → thử lại 1 lần
      try { r = await fetch(url, { cache: "no-store" }); txt = await r.text(); }
      catch (e) { if (i) throw new Error("Không kết nối được máy chủ dữ liệu. Kiểm tra mạng rồi bấm Làm mới."); continue; }
      if (r.ok && txt.trim().startsWith("{")) break;
      await new Promise(ok => setTimeout(ok, 1200));
    }
    let j; try { j = JSON.parse(txt); } catch (e) { throw new Error("Máy chủ dữ liệu không trả JSON (HTTP " + r.status + "). Kiểm tra bản triển khai Web App và quyền truy cập \"Bất kỳ ai\"."); }
    if (j.error) throw new Error(j.error);
    return j;
  };
  O.post = async function (body) {
    if (!CFG.GAS_URL) throw new Error("Chưa cấu hình GAS_URL trong OEE_VI/config.js.");
    let r;
    try { r = await fetch(CFG.GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại."); }
    const j = JSON.parse(await r.text());
    if (j.error) throw new Error(j.error);
    return j;
  };

  // Màn hình hướng dẫn khi chưa nối với Google Sheet
  O.setupHtml = () => `<div style="max-width:640px;margin:0 auto;text-align:left" class="card">
    <h2 style="margin-bottom:8px">Chưa kết nối Google Sheet CSDL_OEE_Vi</h2>
    <p class="muted">Trang cần link Web App Apps Script để đọc dữ liệu. Quản trị làm một lần:</p>
    <ol style="line-height:1.7;padding-left:20px">
      <li>Mở sheet <b>CSDL_OEE_Vi</b> → <b>Tiện ích mở rộng → Apps Script</b>, dán file <code>OEE_VI/apps-script/Code.gs</code>.</li>
      <li>Chạy hàm <b>caiDat</b> một lần (cấp quyền khi được hỏi).</li>
      <li><b>Triển khai → Bản triển khai mới → Ứng dụng web</b>: thực thi với tư cách <b>Tôi</b>, quyền truy cập <b>Bất kỳ ai</b> → copy link <code>…/exec</code>.</li>
      <li>Dán link vào <code>GAS_URL</code> trong <code>OEE_VI/config.js</code>, commit và push lên Cloudflare.</li>
    </ol>
    <p class="muted small">Chi tiết: OEE_VI/HUONG_DAN.md</p></div>`;

  // ---------------- tiện ích ----------------
  O.norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/\s+/g, " ").trim();
  O.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  O.fmt = (n, d = 0) => isFinite(n) ? Number(n).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
  O.pct = (n, d = 1) => isFinite(n) ? Number(n).toFixed(d).replace(".", ",") + "%" : "—";
  O.pts = n => isFinite(n) ? (Math.abs(n) < 0.05 ? "±" : n > 0 ? "+" : "−") + Math.abs(n).toFixed(1).replace(".", ",") : "—";
  O.dmy = d => d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "";
  O.dm = d => d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "";
  O.isoWeek = d => { const t = new Date(d + "T00:00:00Z"), day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
    const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7); };
  O.monLbl = k => "T" + k.slice(5, 7) + "/" + k.slice(0, 4);
  O.today = () => { const t = new Date(); return new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  O.addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  O.groupBy = (rows, key) => rows.reduce((m, r) => { const k = typeof key === "function" ? key(r) : r[key]; (m[k] ||= []).push(r); return m; }, {});
  const num = v => { if (v === "" || v == null) return 0; if (typeof v === "number") return v;
    let s = String(v).trim(); if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, ""); s = s.replace(",", ".");
    const n = Number(s); return isFinite(n) ? n : 0; };
  const pctIn = v => { const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")); return !isFinite(n) ? NaN : n <= 1.5 ? n * 100 : n; };
  const date = v => { if (!v) return ""; const s = String(v); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
  const hm = v => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v || "")); return m ? +m[1] * 60 + +m[2] : NaN; };

  // Bảng {h, r, n} → hàm đọc cột theo tiền tố tiêu đề (không phân biệt dấu)
  function table(t) {
    t = t || { h: [], r: [], n: [] };
    const H = t.h.map(O.norm);
    const col = (...keys) => { for (const k of keys) { const i = H.findIndex(h => h.startsWith(O.norm(k))); if (i >= 0) return i; } return -1; };
    return { rows: t.r, nums: t.n || [], col };
  }

  // Các nhóm tổn thất dừng máy (cột GD_OEE_CA) – thứ tự giữ như sheet
  O.LOSS = [["h", "Hỏng máy / sự cố"], ["k", "Thay dao, chỉnh máy"], ["w", "Chờ phôi, vật tư"], ["e", "Mất điện / khí nén"], ["o", "Dừng khác"]];

  // ---------------- chuẩn hoá toàn bộ dữ liệu ----------------
  O.build = function (raw) {
    const S = raw.sheets || {};
    const M = { generatedAt: raw.generatedAt };

    // Nhà máy
    const nm = table(S.DM_NHA_MAY), ci = nm.col("ma nha may"), cn = nm.col("ten nha may");
    M.facName = {}; nm.rows.forEach(r => { if (r[ci]) M.facName[String(r[ci]).trim().toUpperCase()] = String(r[cn] || r[ci]); });

    // Chuyền
    const ch = table(S.DM_CHUYEN), cc = ch.col("ma chuyen"), cnn = ch.col("ten chuyen"), cg = ch.col("ghi chu");
    // mã chuyền hợp lệ: chữ/số/gạch dưới, bỏ các dòng ghi chú
    M.lines = ch.rows.filter(r => /^[\w-]+$/.test(String(r[cc] || "").trim())).map(r => ({ c: String(r[cc]).trim(), name: String(r[cnn] || r[cc]).trim(), note: String(r[cg] || "") }));
    M.lineName = Object.fromEntries(M.lines.map(l => [l.c, l.name]));

    // Máy
    const my = table(S.DM_MAY), mc = {
      m: my.col("ma may"), f: my.col("nha may"), c: my.col("ma chuyen"), name: my.col("ten may"), area: my.col("khu vuc"),
      grp: my.col("nhom may"), on: my.col("theo doi oee"), std: my.col("ns chuan"), unit: my.col("dvt"), mt: my.col("muc tieu oee")
    };
    M.machines = {};
    my.rows.forEach(r => { const code = String(r[mc.m] || "").trim().toUpperCase(); if (!code) return;
      M.machines[code] = { m: code, f: String(r[mc.f] || code.slice(0, 3)).trim().toUpperCase(), c: String(r[mc.c] || "").trim(), name: String(r[mc.name] || ""),
        area: String(r[mc.area] || ""), track: !/kh[oô]ng/i.test(String(r[mc.on] || "")), std: num(r[mc.std]), unit: String(r[mc.unit] || "sp"), mt: pctIn(r[mc.mt]) }; });

    // Ca
    const ca = table(S.DM_CA), cs = ca.col("ca"), ct = ca.col("tg ca"), cb = ca.col("nghi co kh");
    M.shifts = ca.rows.filter(r => r[cs]).map(r => ({ s: String(r[cs]).trim(), t: num(r[ct]), b: num(r[cb]) }));

    // Lỗi, lý do dừng, sản phẩm
    const dl = table(S.DM_LOI), lc = dl.col("ma loi"), ln = dl.col("ten loi"), lt = dl.col("loai"), lch = dl.col("ma chuyen");
    M.defectCodes = dl.rows.filter(r => r[lc]).map(r => ({ code: String(r[lc]).trim(), name: String(r[ln] || ""), rework: /l[aà]m l[aạ]i/i.test(String(r[lt] || "")), c: String(r[lch] || "").trim() }));
    const dd = table(S.DM_LY_DO_DUNG), dc = dd.col("ma ly do"), dn = dd.col("ten ly do"), dg = dd.col("nhom dung"), dty = dd.col("loai dung");
    M.stopCodes = dd.rows.filter(r => r[dc]).map(r => ({ code: String(r[dc]).trim(), name: String(r[dn] || ""), group: String(r[dg] || ""), type: String(r[dty] || "") }));
    const ds = table(S.DM_SAN_PHAM), pc = ds.col("ma sp"), pn = ds.col("ten sp"), pch = ds.col("ma chuyen");
    M.products = ds.rows.filter(r => r[pc]).map(r => ({ sp: String(r[pc]).trim(), name: String(r[pn] || ""), c: String(r[pch] || "").trim() }));

    // Mục tiêu
    M.MT = { A: 85, P: 85, Q: 97, OEE: 75 };
    const ch2 = table(S.CAU_HINH), k0 = ch2.col("thong so"), v0 = ch2.col("gia tri");
    ch2.rows.forEach(r => { const k = O.norm(r[k0]), v = pctIn(r[v0]); if (!isFinite(v)) return;
      if (k.startsWith("muc tieu a")) M.MT.A = v; else if (k.startsWith("muc tieu p")) M.MT.P = v;
      else if (k.startsWith("muc tieu q")) M.MT.Q = v; else if (k.startsWith("muc tieu oee")) M.MT.OEE = v; });

    // Sổ ca GD_OEE_CA
    const g = table(S.GD_OEE_CA), G = {
      f: g.col("nha may"), d: g.col("ngay"), s: g.col("ca"), m: g.col("ma may"), sp: g.col("ma sp"), u: g.col("nguoi nhap"),
      t: g.col("tg ca"), b: g.col("nghi co kh"), h: g.col("hong may"), k: g.col("thay dao"), w: g.col("cho phoi"), e: g.col("mat dien"), o: g.col("dung khac"),
      sl: g.col("tong san luong"), p: g.col("phe pham"), r: g.col("hang lam lai"), note: g.col("nguyen nhan"), src: g.col("nguon so lieu"),
      c: g.col("ma chuyen"), std: g.col("ns chuan")
    };
    const v = (r, k) => G[k] >= 0 ? r[G[k]] : "";
    M.facts = g.rows.map((r, i) => {
      const m = String(v(r, "m") || "").trim().toUpperCase(), d = date(v(r, "d"));
      if (!m || !d) return null;
      const mm = M.machines[m] || {};
      const x = { row: g.nums[i], f: String(v(r, "f") || mm.f || m.slice(0, 3)).trim().toUpperCase(), d, s: String(v(r, "s") || "").trim(), m,
        sp: String(v(r, "sp") || "").trim(), u: String(v(r, "u") || "").trim(), c: String(v(r, "c") || mm.c || "").trim(),
        t: num(v(r, "t")), b: num(v(r, "b")), h: num(v(r, "h")), k: num(v(r, "k")), w: num(v(r, "w")), e: num(v(r, "e")), o: num(v(r, "o")),
        sl: num(v(r, "sl")), p: num(v(r, "p")), r: num(v(r, "r")), note: String(v(r, "note") || "").trim(), src: String(v(r, "src") || "").trim(),
        std: num(v(r, "std")) || mm.std || 0, mt: isFinite(mm.mt) ? mm.mt : M.MT.OEE };
      return Object.assign(x, O.calc(x));
    }).filter(Boolean);

    // Nhật ký dừng máy
    const nd = table(S.NK_DUNG_MAY), N = {
      f: nd.col("nha may"), d: nd.col("ngay"), s: nd.col("ca"), m: nd.col("ma may"), code: nd.col("ma ly do"), from: nd.col("gio bat dau"),
      to: nd.col("gio ket thuc"), desc: nd.col("mo ta"), fix: nd.col("bien phap"), who: nd.col("nguoi ghi"), name: nd.col("ten ly do"),
      group: nd.col("nhom dung"), type: nd.col("loai dung"), min: nd.col("so phut")
    };
    const nv = (r, k) => N[k] >= 0 ? r[N[k]] : "";
    M.stops = nd.rows.map((r, i) => {
      const desc = String(nv(r, "desc") || "");
      if (/^v[ií] d[uụ]/i.test(desc)) return null;   // dòng ví dụ mẫu
      const m = String(nv(r, "m") || "").trim().toUpperCase(), d = date(nv(r, "d")); if (!m || !d) return null;
      const from = String(nv(r, "from") || ""), to = String(nv(r, "to") || "");
      let min = hm(to) - hm(from); if (min < 0) min += 1440;
      if (!isFinite(min) || min === 0) { const x = nv(r, "min"); min = typeof x === "number" && x > 0 ? (x < 1 ? Math.round(x * 1440) : x) : hm(x) || 0; }
      const sc = M.stopCodes.find(z => z.code === String(nv(r, "code")).trim()) || {};
      return { row: nd.nums[i], f: String(nv(r, "f") || m.slice(0, 3)).trim().toUpperCase(), d, s: String(nv(r, "s") || "").trim(), m,
        code: String(nv(r, "code") || ""), from, to, min, desc, fix: String(nv(r, "fix") || ""), who: String(nv(r, "who") || ""),
        name: String(nv(r, "name") || sc.name || ""), group: String(nv(r, "group") || sc.group || ""), type: String(nv(r, "type") || sc.type || ""),
        c: (M.machines[m] || {}).c || "" };
    }).filter(Boolean);

    // Nhật ký lỗi
    const nl = table(S.NK_LOI), L = {
      f: nl.col("nha may"), d: nl.col("ngay"), s: nl.col("ca"), m: nl.col("ma may"), sp: nl.col("ma sp"), code: nl.col("ma loi"),
      qty: nl.col("so luong"), desc: nl.col("mo ta"), who: nl.col("nguoi ghi"), name: nl.col("ten loi"), type: nl.col("loai")
    };
    const lv = (r, k) => L[k] >= 0 ? r[L[k]] : "";
    M.defects = nl.rows.map((r, i) => {
      const desc = String(lv(r, "desc") || "");
      if (/^v[ií] d[uụ]/i.test(desc)) return null;
      const m = String(lv(r, "m") || "").trim().toUpperCase(), d = date(lv(r, "d")); if (!m || !d) return null;
      const dc = M.defectCodes.find(z => z.code === String(lv(r, "code")).trim()) || {};
      const type = String(lv(r, "type") || (dc.code ? (dc.rework ? "Làm lại" : "Phế phẩm") : ""));
      return { row: nl.nums[i], f: String(lv(r, "f") || m.slice(0, 3)).trim().toUpperCase(), d, s: String(lv(r, "s") || "").trim(), m,
        sp: String(lv(r, "sp") || "").trim(), code: String(lv(r, "code") || ""), qty: num(lv(r, "qty")), desc, who: String(lv(r, "who") || ""),
        name: String(lv(r, "name") || dc.name || ""), type, rework: /l[aà]m l[aạ]i/i.test(type), c: (M.machines[m] || {}).c || "" };
    }).filter(Boolean);

    // Đối chiếu: phút dừng theo nhật ký, số lỗi theo nhật ký cho từng ca × máy
    const kk = x => [x.f, x.d, x.s, x.m].join("|");
    const stopBy = {}, defBy = {};
    M.stops.forEach(x => { stopBy[kk(x)] = (stopBy[kk(x)] || 0) + x.min; });
    M.defects.forEach(x => { defBy[kk(x)] = (defBy[kk(x)] || 0) + x.qty; });
    M.facts.forEach(x => { x.nkStop = stopBy[kk(x)]; x.nkDef = defBy[kk(x)]; });

    M.dates = [...new Set(M.facts.map(r => r.d))].sort();
    M.facs = [...new Set(Object.keys(M.facName).concat(M.facts.map(r => r.f)))].sort();
    // Chuyền không có trong DM_CHUYEN nhưng có số liệu
    [...new Set(M.facts.map(r => r.c))].filter(c => c && !M.lineName[c]).forEach(c => { M.lines.push({ c, name: c }); M.lineName[c] = c; });
    return M;
  };

  // ---------------- tính OEE cho 1 ca ----------------
  O.calc = function (x) {
    const plan = Math.max(0, x.t - x.b), stop = x.h + x.k + x.w + x.e + x.o, run = Math.max(0, plan - stop);
    const ideal = x.std ? run * x.std / 60 : NaN, good = Math.max(0, x.sl - x.p - x.r);
    const A = plan ? run / plan * 100 : NaN, P = ideal ? x.sl / ideal * 100 : NaN, Q = x.sl ? good / x.sl * 100 : NaN;
    return { plan, stop, run, ideal, good, A, P, Q, OEE: A * P * Q / 1e4 };
  };

  // ---------------- tổng hợp nhiều ca: bình quân gia quyền theo giờ chạy máy thật ----------------
  O.agg = function (rows) {
    const a = { n: rows.length, t: 0, b: 0, h: 0, k: 0, w: 0, e: 0, o: 0, sl: 0, p: 0, r: 0, plan: 0, stop: 0, run: 0, good: 0, ideal: 0,
      speed: 0, defTime: 0, nP: 0 };
    const W = { A: [0, 0], P: [0, 0], Q: [0, 0], OEE: [0, 0] };
    rows.forEach(x => {
      ["t", "b", "h", "k", "w", "e", "o", "sl", "p", "r", "plan", "stop", "run", "good"].forEach(f => a[f] += x[f] || 0);
      if (x.std) { a.ideal += x.ideal || 0; a.speed += Math.max(0, x.run - x.sl * 60 / x.std); a.defTime += (x.p + x.r) * 60 / x.std; }
      else a.nP++;
      const wt = x.run;   // trọng số = thời gian chạy máy thực tế
      if (wt > 0) ["A", "P", "Q", "OEE"].forEach(k => { if (isFinite(x[k])) { W[k][0] += x[k] * wt; W[k][1] += wt; } });
    });
    ["A", "P", "Q", "OEE"].forEach(k => a[k] = W[k][1] ? W[k][0] / W[k][1] : NaN);
    a.hours = a.run / 60;   // giờ chạy máy = trọng số
    a.rate = a.run ? a.sl / a.run * 60 : NaN;
    a.losses = O.LOSS.map(([f, l]) => ({ f, l, v: a[f] }));
    a.top = a.losses.slice().sort((x, y) => y.v - x.v)[0];
    return a;
  };

  O.tone = (k, v, MT) => !isFinite(v) ? "na" : v >= MT[k] ? "good" : v >= (k === "OEE" ? 60 : MT[k] - (k === "Q" ? 3 : 10)) ? "warn" : "bad";
  O.TONE_LBL = { good: "Đạt", warn: "Cần cải thiện", bad: "Cảnh báo", na: "Chưa đủ số liệu" };
})();
