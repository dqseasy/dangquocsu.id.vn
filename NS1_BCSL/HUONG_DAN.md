# Đưa "Báo cáo sản lượng tuần" lên Cloudflare (domain riêng)

Cách hoạt động: Cloudflare Worker hiển thị đúng giao diện trang Apps Script, dữ liệu lấy qua link `.../exec?format=json` mà project Apps Script đã có sẵn → **trang Apps Script gốc giữ nguyên, không sửa gì**.

Chỉ cần dùng file **worker.js** (file `index.html` để tham khảo/lưu trữ).

## Bước 1 — Lấy link Web App Apps Script
1. Trong trình chỉnh sửa Apps Script, bấm nút xanh **Triển khai** (góc phải trên) → **Quản lý bản triển khai**.
2. Chọn bản triển khai đang dùng → copy **URL ứng dụng web** (dạng `https://script.google.com/macros/s/AKfy.../exec`).
3. Kiểm tra: dán link đó vào tab mới, thêm `?format=json` ở cuối → Enter. Nếu thấy chữ JSON bắt đầu bằng `{"generatedAt":...` là OK.
   - Nếu vẫn hiện trang HTML: bản triển khai đang là bản cũ. Vào **Triển khai → Quản lý bản triển khai → biểu tượng bút chì (Chỉnh sửa) → Phiên bản: "Phiên bản mới" → Triển khai**. Link `/exec` không đổi.

## Bước 2 — Tạo Worker trên Cloudflare
1. Vào https://dash.cloudflare.com → menu trái **Compute (Workers)** → **Workers & Pages**.
2. Bấm **Create** → **Create Worker** (Start with Hello World) → đặt tên, ví dụ `baocao-sanluong` → **Deploy**.
3. Bấm **Edit code** → xoá hết code mẫu trong file `worker.js` → dán **toàn bộ** nội dung file `worker.js` này → bấm **Deploy** (góc phải trên).

## Bước 3 — Khai báo link Apps Script
1. Quay lại trang Worker → tab **Settings** → mục **Variables and Secrets** → **Add**.
2. Type: **Text** · Variable name: `GAS_URL` · Value: link `/exec` ở Bước 1 → **Deploy**.
3. Mở link `https://baocao-sanluong.<tên-tài-khoản>.workers.dev` để kiểm tra trang hiện đúng dữ liệu.

## Bước 4 — Gắn domain riêng
(Domain phải đã được thêm vào Cloudflare, DNS do Cloudflare quản lý.)
1. Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**.
2. Gõ ví dụ `baocao.tenmien-cua-ban.com` → **Add domain**. Đợi 1–5 phút để cấp SSL là truy cập được.

## Ghi chú
- Dữ liệu được Cloudflare **cache 60 giây** (Edge Cache — bộ nhớ đệm tại máy chủ biên) để trang nhanh và đỡ gọi Google. Nút **Tải lại** trên trang luôn lấy dữ liệu mới nhất. Muốn đổi thời gian: sửa `CACHE_SECONDS` ở đầu `worker.js`.
- Link Apps Script được giấu trong biến `GAS_URL`, người xem domain riêng không thấy.
- Khi sửa giao diện trang Apps Script sau này, gửi lại cho Kim để cập nhật `worker.js` cho khớp.
