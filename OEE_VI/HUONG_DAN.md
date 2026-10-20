# Báo cáo OEE NS1 – NS2: hướng dẫn triển khai

Trang chạy tĩnh trên Cloudflare cùng website (`/OEE_VI/`). Dữ liệu đọc và ghi **trực tiếp vào Google Sheet `CSDL_OEE_Vi`** qua một Web App Apps Script gắn với sheet đó.

| File | Vai trò |
|---|---|
| `index.html` + `dashboard.js` | Báo cáo OEE: tổng quan, chi tiết từng nhà máy, chất lượng dữ liệu, trình chiếu, in PDF |
| `nhap-lieu.html` + `nhap-lieu.js` | Trang nhập sổ sản lượng & lỗi theo ca (cần đăng nhập) |
| `oee-core.js`, `oee.css` | Lõi tính OEE và giao diện dùng chung |
| `config.js` | **Nơi dán link Web App** (`GAS_URL`) và Google Client ID (nếu dùng Gmail) |
| `apps-script/Code.gs`, `appsscript.json` | Mã Apps Script dán vào sheet CSDL_OEE_Vi |

## Bước 1: Cài Apps Script vào CSDL_OEE_Vi
1. Mở Google Sheet **CSDL_OEE_Vi** → **Tiện ích mở rộng → Apps Script**.
2. Xoá code mẫu, dán toàn bộ `apps-script/Code.gs`. (Tuỳ chọn: bật *Cài đặt dự án → Hiện tệp kê khai "appsscript.json"* và dán nội dung `appsscript.json`.)
3. Chọn hàm **`caiDat`** → **Chạy** → cấp quyền. Sheet sẽ có thêm:
   - **NGUOI_DUNG**: danh sách tài khoản nhập liệu, có sẵn 2 dòng mẫu NS1, NS2 với khoá bí mật ngẫu nhiên.
   - **NHAT_KY_GHI**: nhật ký mọi lần đăng nhập và ghi số liệu (ai, lúc nào, ghi gì).
4. **Triển khai → Bản triển khai mới → Loại: Ứng dụng web**
   - Thực thi với tư cách: **Tôi**
   - Người có quyền truy cập: **Bất kỳ ai**
   → **Triển khai** → copy **URL ứng dụng web** (kết thúc bằng `/exec`).
5. Kiểm tra: mở `URL/exec?action=data` → phải thấy chữ JSON bắt đầu bằng `{"generatedAt":...`.

> Sửa `Code.gs` sau này: **Triển khai → Quản lý bản triển khai → bút chì → Phiên bản: Phiên bản mới → Triển khai**. Link `/exec` giữ nguyên.

## Bước 2: Khai báo link trong website
Mở `OEE_VI/config.js`, dán link vào `GAS_URL`, commit và push. Cloudflare tự triển khai lại.

## Bước 3: Cấp tài khoản nhập liệu (sheet NGUOI_DUNG)
| Cột | Ý nghĩa |
|---|---|
| Email | Gmail được phép đăng nhập bằng Google (để trống nếu chỉ dùng khoá) |
| Khoá bí mật | Chuỗi ≥ 6 ký tự, nên ≥ 12 ký tự ngẫu nhiên. Tạo khoá mới: chạy hàm `inKhoaMoi` và xem *Nhật ký thực thi* |
| Họ tên | Tên ghi vào cột "Người nhập" của GD_OEE_CA |
| Nhà máy | `NS1`, `NS2` hoặc `TẤT CẢ` — tài khoản chỉ ghi được cho nhà máy này |
| Quyền | `Nhập liệu` (sửa được 31 ngày gần nhất) hoặc `Quản trị` (sửa mọi ngày) |
| Kích hoạt | `Không` = khoá tài khoản ngay lập tức |

**Không chia sẻ sheet CSDL_OEE_Vi cho người nhập liệu**: họ chỉ cần khoá hoặc Gmail. Đổi khoá khi có người nghỉ việc.

## Bước 4 (tuỳ chọn): Bật đăng nhập bằng Gmail
1. Vào https://console.cloud.google.com → tạo dự án → **APIs & Services → OAuth consent screen** (External, điền tên ứng dụng).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized JavaScript origins: `https://dangquocsu.id.vn` (thêm các domain khác nếu có).
3. Copy **Client ID**:
   - dán vào `GOOGLE_CLIENT_ID` trong `OEE_VI/config.js`;
   - trong Apps Script: **Cài đặt dự án → Thuộc tính tập lệnh → Thêm**: `GOOGLE_CLIENT_ID` = Client ID đó.
4. Thêm Gmail của người nhập vào cột **Email** của NGUOI_DUNG.

Máy chủ kiểm tra token Google (đúng Client ID, email đã xác minh) rồi mới đối chiếu với NGUOI_DUNG.

## Cách ghi dữ liệu
- Mỗi lần lưu = 1 dòng **GD_OEE_CA** (khoá: Nhà máy | Ngày | Ca | Mã máy | Mã SP). Trùng khoá thì trang hỏi xác nhận rồi **ghi đè** dòng cũ.
- Cột *Nguồn số liệu* = `Nhập web`; *File gốc* = email/tên người nhập + thời điểm.
- Các cột công thức (Mã chuyền, A, P, Q, OEE…) được giữ nguyên; dòng mới tự chép công thức của dòng phía trên.
- Chế độ "Ghi chi tiết theo mã lỗi": phế phẩm / làm lại tự cộng theo loại lỗi trong **DM_LOI**, các dòng lỗi ghi vào **NK_LOI** (ghi đè thì thay toàn bộ dòng lỗi của ca đó).
- Máy chủ kiểm tra lại: quyền nhà máy, máy thuộc nhà máy, tổng dừng ≤ thời gian kế hoạch, phế + làm lại ≤ sản lượng, không nhập ngày tương lai.
- Nhật ký dừng máy: hiện xem được trên báo cáo, form nhập sẽ làm ở giai đoạn sau.

## Cách tính OEE trên báo cáo
- OEE từng ca = A × P × Q (A = TG chạy ÷ TG kế hoạch; P = SL ÷ (TG chạy × NS chuẩn); Q = SL tốt ÷ SL), khớp công thức trong GD_OEE_CA.
- **OEE máy, chuyền, nhà máy và OEE chung = bình quân gia quyền các ca, trọng số = giờ chạy máy thực tế** (TG ca − nghỉ có KH − tổng dừng). A, P, Q tổng hợp cũng tính cùng cách. Ca dừng máy cả ca (giờ chạy = 0) không có trọng số.
- Mục tiêu A, P, Q, OEE đọc từ sheet **CAU_HINH**. Danh mục máy, chuyền, ca, lỗi đọc từ các sheet **DM_\***, nên thêm máy hoặc chuyền mới chỉ cần sửa sheet.

## Ghi chú bảo mật
- Link `/exec` nằm trong `config.js` nên ai xem mã trang cũng thấy; đọc dữ liệu (`action=data`) là công khai giống báo cáo NS1 hiện có. Ghi dữ liệu luôn cần đăng nhập.
- Sheet NGUOI_DUNG **không bao giờ** được trả ra ngoài. Phiên đăng nhập hết hạn sau 6 giờ. Nhập sai khoá 20 lần thì khoá đăng nhập bằng khoá 15 phút.
- Dữ liệu đọc được lưu đệm 60 giây; bấm **Làm mới** để đọc ngay.
