/**
 * CSDL_OEE_Vi — API cho Dashboard OEE và trang nhập liệu (dangquocsu.id.vn/OEE_VI/)
 *
 * Gắn script này vào Google Sheet CSDL_OEE_Vi (Tiện ích mở rộng → Apps Script), rồi:
 *   1. Chạy hàm caiDat() một lần để tạo sheet NGUOI_DUNG và NHAT_KY_GHI.
 *   2. Triển khai → Bản triển khai mới → Ứng dụng web
 *        Thực thi với tư cách: Tôi · Người có quyền truy cập: Bất kỳ ai
 *   3. Dán link /exec vào OEE_VI/config.js (GAS_URL).
 *
 * GET  ?action=data[&fresh=1]  → JSON các sheet dữ liệu + danh mục (không gồm NGUOI_DUNG)
 * POST {action:'login', key}            → đăng nhập bằng khoá bí mật
 * POST {action:'login', idToken}        → đăng nhập bằng Gmail (Google Sign-In)
 * POST {action:'me'|'logout', token}
 * POST {action:'save', token, row, defects, defectMode, overwrite} → ghi GD_OEE_CA (+ NK_LOI)
 */

const CFG = {
  READ: ['GD_OEE_CA', 'NK_DUNG_MAY', 'NK_LOI', 'DM_MAY', 'DM_CHUYEN', 'DM_NHA_MAY', 'DM_CA',
         'DM_LY_DO_DUNG', 'DM_LOI', 'DM_SAN_PHAM', 'CAU_HINH'],
  USERS: 'NGUOI_DUNG',
  LOG: 'NHAT_KY_GHI',
  CACHE_SEC: 60,          // cache dữ liệu đọc
  SESSION_SEC: 21600,     // phiên đăng nhập 6 giờ (tối đa của CacheService)
  MAX_BACK_DAYS: 31,      // người nhập liệu chỉ được nhập/sửa trong 31 ngày gần nhất
  MAX_FAILS: 20,          // khoá đăng nhập bằng khoá bí mật 15 phút khi sai quá số lần này
  TZ_VN: 'Asia/Ho_Chi_Minh',
  ALL: 'TẤT CẢ',
  ADMIN: 'Quản trị'
};

// ============================== HTTP ==============================
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if ((p.action || 'data') === 'data') return json_(getData_(p.fresh === '1'));
    return json_({ error: 'Hành động không hợp lệ' });
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      case 'login':  return json_(login_(req));
      case 'me':     return json_({ ok: true, user: needSession_(req.token) });
      case 'logout': CacheService.getScriptCache().remove('tk_' + req.token); return json_({ ok: true });
      case 'save':   return json_(save_(req));
      default:       return json_({ error: 'Hành động không hợp lệ' });
    }
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ============================== ĐỌC DỮ LIỆU ==============================
function getData_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) { const s = getBig_(cache, 'data'); if (s) return JSON.parse(s); }
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
  const out = { generatedAt: new Date().toISOString(), tz: tz, sheets: {} };
  CFG.READ.forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (sh) out.sheets[name] = table_(sh, tz);
  });
  putBig_(cache, 'data', JSON.stringify(out), CFG.CACHE_SEC);
  return out;
}

// Sheet → {h: tiêu đề dòng 1, r: các dòng có dữ liệu ở 4 cột đầu, n: số dòng trong sheet}
function table_(sh, tz) {
  const v = sh.getDataRange().getValues();
  if (!v.length) return { h: [], r: [], n: [] };
  const h = v[0].map(function (x) { return String(x).trim(); });
  let last = h.length; while (last > 0 && !h[last - 1]) last--;
  const r = [], n = [];
  for (let i = 1; i < v.length; i++) {
    const row = v[i].slice(0, last);
    if (!row.slice(0, 4).some(function (x) { return x !== '' && x !== null; })) continue;
    r.push(row.map(function (x) { return cell_(x, tz); }));
    n.push(i + 1);
  }
  return { h: h.slice(0, last), r: r, n: n };
}

function cell_(x, tz) {
  if (x instanceof Date) return x.getFullYear() < 1900 ? Utilities.formatDate(x, tz, 'HH:mm') : Utilities.formatDate(x, tz, 'yyyy-MM-dd');
  if (typeof x === 'number') return Math.round(x * 1e6) / 1e6;
  return x;
}

// CacheService giới hạn 100KB/khoá → chia nhỏ
function putBig_(c, key, s, sec) {
  const size = 90000, parts = Math.ceil(s.length / size), o = {};
  for (let i = 0; i < parts; i++) o[key + '_' + i] = s.substr(i * size, size);
  o[key + '_n'] = String(parts);
  c.putAll(o, sec);
}
function getBig_(c, key) {
  const n = +c.get(key + '_n'); if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const got = c.getAll(keys); let s = '';
  for (let i = 0; i < n; i++) { if (got[keys[i]] == null) return null; s += got[keys[i]]; }
  return s;
}
function delBig_(c, key) { c.remove(key + '_n'); }

// ============================== ĐĂNG NHẬP ==============================
function login_(req) {
  const cache = CacheService.getScriptCache();
  const fails = +(cache.get('login_fail') || 0);
  let user = null, via = '';
  if (req.idToken) {
    via = 'Gmail';
    const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
    if (!clientId) throw new Error('Máy chủ chưa bật đăng nhập Gmail (thiếu GOOGLE_CLIENT_ID trong Script Properties).');
    const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.idToken), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Phiên Google không hợp lệ, hãy đăng nhập lại.');
    const t = JSON.parse(r.getContentText());
    if (t.aud !== clientId || String(t.email_verified) !== 'true') throw new Error('Phiên Google không hợp lệ, hãy đăng nhập lại.');
    const email = String(t.email).toLowerCase();
    user = findUser_(function (u) { return u.email === email; });
    if (!user) throw new Error('Gmail ' + email + ' chưa được cấp quyền nhập liệu. Liên hệ P.KTCL để thêm vào danh sách.');
  } else if (req.key) {
    via = 'Khoá bí mật';
    if (fails >= CFG.MAX_FAILS) throw new Error('Nhập sai khoá quá nhiều lần. Thử lại sau 15 phút.');
    const key = String(req.key).trim();
    user = key.length >= 6 ? findUser_(function (u) { return u.key && u.key === key; }) : null;
    if (!user) { cache.put('login_fail', String(fails + 1), 900); throw new Error('Khoá bí mật không đúng hoặc đã bị khoá.'); }
  } else {
    throw new Error('Thiếu thông tin đăng nhập.');
  }
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const pub = { name: user.name || user.email, email: user.email, f: user.f, role: user.role, via: via };
  cache.put('tk_' + token, JSON.stringify(pub), CFG.SESSION_SEC);
  log_(pub, 'Đăng nhập (' + via + ')', '', '');
  return { ok: true, token: token, user: pub, expiresIn: CFG.SESSION_SEC };
}

function needSession_(token) {
  const s = token && CacheService.getScriptCache().get('tk_' + token);
  if (!s) throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
  return JSON.parse(s);
}

function findUser_(match) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.USERS);
  if (!sh) throw new Error('Chưa có sheet ' + CFG.USERS + '. Chạy hàm caiDat() trong Apps Script.');
  const v = sh.getDataRange().getValues(), h = v[0];
  const ci = function (p) { return idx_(h, p); };
  const c = { email: ci('email'), key: ci('khoa bi mat'), name: ci('ho ten'), f: ci('nha may'), role: ci('quyen'), on: ci('kich hoat') };
  for (let i = 1; i < v.length; i++) {
    const r = v[i], g = function (k) { return c[k] >= 0 ? String(r[c[k]]).trim() : ''; };
    if (!g('email') && !g('key')) continue;
    if (/^kh[oô]ng$/i.test(g('on'))) continue;
    const u = { email: g('email').toLowerCase(), key: g('key'), name: g('name'), f: (g('f') || CFG.ALL).toUpperCase(), role: g('role') || 'Nhập liệu' };
    if (match(u)) return u;
  }
  return null;
}

// ============================== GHI SỐ LIỆU ==============================
function save_(req) {
  const user = needSession_(req.token);
  const ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone();
  const x = req.row || {};
  const num = function (k, max) {
    const v = x[k] === '' || x[k] == null ? 0 : Number(x[k]);
    if (!isFinite(v) || v < 0 || (max && v > max)) throw new Error('Giá trị "' + k + '" không hợp lệ.');
    return v;
  };

  // --- nhà máy, quyền ---
  const f = String(x.f || '').trim().toUpperCase();
  if (!/^NS\d+$/.test(f)) throw new Error('Thiếu nhà máy.');
  if (user.f !== CFG.ALL && user.f !== f) throw new Error('Tài khoản này chỉ được nhập cho ' + user.f + '.');

  // --- ngày ---
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x.d || ''));
  if (!m) throw new Error('Ngày không hợp lệ.');
  // Ngày tạo theo múi giờ của sheet để ô ngày hiện đúng; "hôm nay" tính theo giờ Việt Nam
  const dStr = m[0];
  const day = Utilities.parseDate(dStr + ' 00:00', tz, 'yyyy-MM-dd HH:mm');
  const today = Utilities.formatDate(new Date(), CFG.TZ_VN, 'yyyy-MM-dd');
  if (dStr > today) throw new Error('Không nhập số liệu cho ngày trong tương lai.');
  const back = (new Date(today) - new Date(dStr)) / 864e5;
  if (back > CFG.MAX_BACK_DAYS && user.role !== CFG.ADMIN) throw new Error('Chỉ được nhập/sửa số liệu trong ' + CFG.MAX_BACK_DAYS + ' ngày gần nhất. Liên hệ quản trị để sửa số liệu cũ hơn.');

  // --- danh mục ---
  const cas = list_(ss, 'DM_CA', 'ca');
  const s = String(x.s || '').trim();
  if (cas.indexOf(s) < 0) throw new Error('Ca "' + s + '" không có trong DM_CA.');
  const may = rows_(ss, 'DM_MAY');
  const mc = String(x.m || '').trim().toUpperCase();
  const mRow = may.find(function (r) { return String(r['ma may']).trim().toUpperCase() === mc; });
  if (!mRow) throw new Error('Mã máy "' + mc + '" không có trong DM_MAY.');
  if (String(mRow['nha may']).trim().toUpperCase() !== f) throw new Error('Máy ' + mc + ' không thuộc ' + f + '.');
  const sp = String(x.sp || '').trim();
  if (sp && list_(ss, 'DM_SAN_PHAM', 'ma sp').indexOf(sp) < 0) throw new Error('Mã SP "' + sp + '" không có trong DM_SAN_PHAM.');

  // --- thời gian & sản lượng ---
  const t = num('t', 1440), b = num('b', 1440), h = num('h', 1440), k = num('k', 1440), w = num('w', 1440), e = num('e', 1440), o = num('o', 1440);
  if (!t) throw new Error('Thiếu thời gian ca.');
  if (b > t) throw new Error('Nghỉ có kế hoạch lớn hơn thời gian ca.');
  if (h + k + w + e + o > t - b) throw new Error('Tổng thời gian dừng (' + (h + k + w + e + o) + ' ph) lớn hơn thời gian kế hoạch (' + (t - b) + ' ph).');
  const sl = num('sl');
  let p = num('p'), r = num('r');

  // --- chi tiết lỗi ---
  const detail = req.defectMode === 'detail';
  const defects = [];
  if (detail) {
    const dmLoi = rows_(ss, 'DM_LOI');
    p = 0; r = 0;
    (req.defects || []).forEach(function (d) {
      const code = String(d.code || '').trim(), q = Number(d.qty);
      if (!code && !q) return;
      const L = dmLoi.find(function (z) { return String(z['ma loi']).trim() === code; });
      if (!L) throw new Error('Mã lỗi "' + code + '" không có trong DM_LOI.');
      if (!isFinite(q) || q <= 0) throw new Error('Số lượng lỗi ' + code + ' không hợp lệ.');
      if (/l[aà]m l[aạ]i/i.test(String(L['loai']))) r += q; else p += q;
      defects.push({ code: code, qty: q, desc: String(d.desc || '').slice(0, 300) });
    });
  }
  if (p + r > sl) throw new Error('Phế phẩm + làm lại (' + (p + r) + ') lớn hơn tổng sản lượng (' + sl + ').');
  const note = String(x.note || '').trim().slice(0, 500);
  const key = [f, dStr, s, mc, sp].join('|');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Hệ thống đang bận ghi số liệu khác, thử lại sau vài giây.');
  try {
    const sh = ss.getSheetByName('GD_OEE_CA');
    const H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const C = {
      f: idx_(H, 'nha may'), d: idx_(H, 'ngay'), s: idx_(H, 'ca'), m: idx_(H, 'ma may'), sp: idx_(H, 'ma sp'),
      u: idx_(H, 'nguoi nhap'), t: idx_(H, 'tg ca'), b: idx_(H, 'nghi co kh'), h: idx_(H, 'hong may'),
      k: idx_(H, 'thay dao'), w: idx_(H, 'cho phoi'), e: idx_(H, 'mat dien'), o: idx_(H, 'dung khac'),
      sl: idx_(H, 'tong san luong'), p: idx_(H, 'phe pham'), r: idx_(H, 'hang lam lai'), note: idx_(H, 'nguyen nhan'),
      src: idx_(H, 'nguon so lieu'), file: idx_(H, 'file goc'), key: idx_(H, 'khoa dong')
    };
    ['f', 'd', 's', 'm', 'sl'].forEach(function (c) { if (C[c] < 0) throw new Error('GD_OEE_CA thiếu cột bắt buộc (' + c + ').'); });

    const found = findRows_(sh, C, tz, function (a) { return a === key; }, 'last');
    let target = found.match[0], mode = 'update';
    if (target && !req.overwrite) {
      return { ok: false, exists: true, row: target, message: 'Đã có số liệu ' + key.replace(/\|/g, ' · ') + ' (dòng ' + target + '). Xác nhận ghi đè?' };
    }
    if (!target) { mode = 'new'; target = found.last + 1; ensureRow_(sh, target); }

    const vals = {};
    vals[C.f] = f; vals[C.d] = day; vals[C.s] = s; vals[C.m] = mc; vals[C.u] = user.name;
    vals[C.t] = t; vals[C.b] = b; vals[C.h] = h || ''; vals[C.k] = k || ''; vals[C.w] = w || ''; vals[C.e] = e || ''; vals[C.o] = o || '';
    vals[C.sl] = sl; vals[C.p] = p; vals[C.r] = r; vals[C.note] = note;
    if (C.sp >= 0) vals[C.sp] = sp;
    if (C.src >= 0) vals[C.src] = 'Nhập web';
    if (C.file >= 0) vals[C.file] = 'Web · ' + (user.email || user.name) + ' · ' + Utilities.formatDate(new Date(), CFG.TZ_VN, 'dd/MM/yyyy HH:mm');
    writeRow_(sh, target, vals, H.length);
    fillFormulas_(sh, target, H.length, vals);
    if (C.key >= 0 && !sh.getRange(target, C.key + 1).getFormula()) sh.getRange(target, C.key + 1).setValue(key);

    if (detail) saveDefects_(ss, tz, { f: f, day: day, dStr: dStr, s: s, m: mc, sp: sp }, defects, user);

    log_(user, mode === 'new' ? 'Thêm ca' : 'Ghi đè ca', key, JSON.stringify({ row: x, defects: defects }));
    SpreadsheetApp.flush();
    delBig_(CacheService.getScriptCache(), 'data');
    return { ok: true, mode: mode, row: target, key: key, p: p, r: r };
  } finally {
    lock.releaseLock();
  }
}

// NK_LOI: xoá các dòng cùng khoá rồi ghi lại danh sách lỗi mới
function saveDefects_(ss, tz, k, defects, user) {
  const sh = ss.getSheetByName('NK_LOI');
  if (!sh) throw new Error('Không thấy sheet NK_LOI.');
  const H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const C = { f: idx_(H, 'nha may'), d: idx_(H, 'ngay'), s: idx_(H, 'ca'), m: idx_(H, 'ma may'), sp: idx_(H, 'ma sp'),
              code: idx_(H, 'ma loi'), qty: idx_(H, 'so luong'), desc: idx_(H, 'mo ta'), who: idx_(H, 'nguoi ghi') };
  const key = [k.f, k.dStr, k.s, k.m, k.sp].join('|');
  const found = findRows_(sh, C, tz, function (a) { return a === key; }, 'all');
  found.match.sort(function (a, b) { return b - a; }).forEach(function (rn) { sh.deleteRow(rn); });
  let last = found.last - found.match.length;
  defects.forEach(function (d) {
    const target = ++last; ensureRow_(sh, target);
    const v = {};
    v[C.f] = k.f; v[C.d] = k.day; v[C.s] = k.s; v[C.m] = k.m; v[C.code] = d.code; v[C.qty] = d.qty; v[C.desc] = d.desc; v[C.who] = user.name;
    if (C.sp >= 0) v[C.sp] = k.sp;
    writeRow_(sh, target, v, H.length);
    fillFormulas_(sh, target, H.length, v);
  });
}

// Tìm dòng theo khoá Nhà máy|Ngày|Ca|Mã máy|Mã SP; trả về số dòng khớp và dòng có dữ liệu cuối cùng
function findRows_(sh, C, tz, test, mode) {
  const n = Math.max(sh.getLastRow() - 1, 0), match = [];
  let last = 1;
  if (!n) return { match: match, last: last };
  const v = sh.getRange(2, 1, n, sh.getLastColumn()).getValues();
  for (let i = 0; i < v.length; i++) {
    const r = v[i];
    if (![C.f, C.d, C.s, C.m].some(function (c) { return r[c] !== '' && r[c] !== null; })) continue;
    last = i + 2;
    const d = r[C.d] instanceof Date ? Utilities.formatDate(r[C.d], tz, 'yyyy-MM-dd') : String(r[C.d]);
    const a = [String(r[C.f]).trim().toUpperCase(), d, String(r[C.s]).trim(), String(r[C.m]).trim().toUpperCase(),
               C.sp >= 0 ? String(r[C.sp]).trim() : ''].join('|');
    if (test(a)) { match.push(i + 2); if (mode === 'last') match.splice(0, match.length - 1); }
  }
  return { match: match, last: last };
}

function ensureRow_(sh, row) {
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(50, row - sh.getMaxRows()));
}

// Chỉ ghi các cột có trong vals, giữ nguyên các ô khác (kể cả ô công thức)
function writeRow_(sh, row, vals, width) {
  const cols = Object.keys(vals).map(Number).filter(function (c) { return c >= 0; });
  const lo = Math.min.apply(null, cols), hi = Math.max.apply(null, cols);
  const rng = sh.getRange(row, lo + 1, 1, hi - lo + 1);
  const cur = rng.getValues()[0], fx = rng.getFormulas()[0];
  // ô công thức giữ nguyên công thức (setValues với chuỗi "=..." ghi lại đúng công thức đó)
  rng.setValues([cur.map(function (v, i) { return fx[i] ? fx[i] : (lo + i) in vals ? vals[lo + i] : v; })]);
}

// Dòng mới: chép công thức (R1C1) từ dòng phía trên cho các ô còn trống công thức
function fillFormulas_(sh, row, width, skip) {
  if (row <= 2) return;
  const above = sh.getRange(row - 1, 1, 1, width).getFormulasR1C1()[0];
  const here = sh.getRange(row, 1, 1, width).getFormulasR1C1()[0];
  above.forEach(function (f, i) {
    if (f && !here[i] && !(skip && i in skip) && !/ARRAYFORMULA/i.test(f)) sh.getRange(row, i + 1).setFormulaR1C1(f);
  });
}

// ============================== TIỆN ÍCH ==============================
function norm_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
function idx_(H, prefix) {
  const p = norm_(prefix);
  for (let i = 0; i < H.length; i++) if (norm_(H[i]).indexOf(p) === 0) return i;
  return -1;
}
function rows_(ss, name) {
  const sh = ss.getSheetByName(name); if (!sh) return [];
  const v = sh.getDataRange().getValues(), H = v[0].map(norm_);
  return v.slice(1).filter(function (r) { return r[0] !== ''; }).map(function (r) {
    const o = {}; H.forEach(function (h, i) { o[h.replace(/\s*\(.*$/, '')] = r[i]; }); return o;
  });
}
function list_(ss, name, col) {
  return rows_(ss, name).map(function (r) { return String(r[col]).trim(); }).filter(String);
}
function log_(user, action, key, payload) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.LOG);
  if (!sh) return;
  sh.appendRow([new Date(), user.email || '', user.name || '', user.f || '', action, key, String(payload).slice(0, 5000)]);
}

// ============================== CÀI ĐẶT (chạy 1 lần) ==============================
function caiDat() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(CFG.USERS)) {
    const sh = ss.insertSheet(CFG.USERS);
    sh.getRange(1, 1, 1, 7).setValues([['Email', 'Khoá bí mật', 'Họ tên', 'Nhà máy', 'Quyền', 'Kích hoạt', 'Ghi chú']])
      .setFontWeight('bold').setBackground('#FFF2CC');
    sh.getRange(2, 1, 2, 7).setValues([
      ['', taoKhoa_(), 'Thống kê NS1', 'NS1', 'Nhập liệu', 'Có', 'VÍ DỤ – đổi tên, giữ hoặc đổi khoá'],
      ['', taoKhoa_(), 'Thống kê NS2', 'NS2', 'Nhập liệu', 'Có', 'VÍ DỤ – đổi tên, giữ hoặc đổi khoá']]);
    sh.getRange('D2:D200').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['NS1', 'NS2', CFG.ALL]).build());
    sh.getRange('E2:E200').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Nhập liệu', CFG.ADMIN]).build());
    sh.getRange('F2:F200').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Có', 'Không']).build());
    sh.setFrozenRows(1); sh.autoResizeColumns(1, 7);
    sh.protect().setDescription('Danh sách tài khoản nhập liệu OEE – chỉ quản trị sửa').setWarningOnly(true);
  }
  if (!ss.getSheetByName(CFG.LOG)) {
    const sh = ss.insertSheet(CFG.LOG);
    sh.getRange(1, 1, 1, 7).setValues([['Thời gian', 'Email', 'Người dùng', 'Nhà máy', 'Hành động', 'Khoá dòng', 'Nội dung']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  Logger.log('Đã tạo ' + CFG.USERS + ' và ' + CFG.LOG + '. Mở sheet ' + CFG.USERS + ' để xem khoá mẫu.');
}

// Sinh khoá bí mật ngẫu nhiên 12 ký tự (dùng trong sheet: chạy hàm này từ trình chỉnh sửa và xem Nhật ký)
function taoKhoa_() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = ''; const b = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  for (let i = 0; i < 12; i++) s += a[parseInt(b.substr(i * 2, 2), 16) % a.length];
  return s;
}
function inKhoaMoi() { Logger.log(taoKhoa_()); }
