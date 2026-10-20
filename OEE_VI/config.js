/* Cấu hình chung cho Dashboard OEE và trang nhập liệu.
 * GAS_URL: link Web App Apps Script gắn với Google Sheet CSDL_OEE_Vi (kết thúc bằng /exec).
 * GOOGLE_CLIENT_ID: OAuth Client ID (Web) để bật đăng nhập bằng Gmail. Để trống = chỉ dùng khoá bí mật.
 * Xem hướng dẫn: OEE_VI/HUONG_DAN.md */
window.OEE_CONFIG = {
  GAS_URL: "https://script.google.com/macros/s/AKfycbwzL59o8RNj9coSrRVCt8fl0IEsM4_sBQNhnQGqE1fSs-OpoLXxKc3ISSU0TCw_hQ/exec",
  GOOGLE_CLIENT_ID: ""
};
