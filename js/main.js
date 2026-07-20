$(document).ready(function () {

    // 1. Tải Header từ components/header.html
    // Lưu ý: Dùng đường dẫn "/components/header.html" (Bắt đầu bằng dấu /)
    $("#header-placeholder").load("/components/header.html", function () {
        // Tự động Highlight link menu đang đứng
        highlightActiveMenu();
    });

    // 2. Tải Footer từ components/footer.html
    $("#footer-placeholder").load("/components/footer.html", function () {
        // Cập nhật lại AOS Animation sau khi load footer động
        if (typeof AOS !== 'undefined') {
            AOS.refresh();
        }
    });

    // 3. Khởi tạo AOS Animation ban đầu
    if (typeof AOS !== 'undefined') {
        AOS.init({
            duration: 800,
            once: false,
            mirror: true
        });
    }
});

// Hàm tự động kiểm tra URL để Highlight trang hiện tại trên Menu
function highlightActiveMenu() {
    const currentPath = window.location.pathname;

    $("#header-placeholder .nav-link").each(function () {
        const href = $(this).attr("href");
        // Kiểm tra nếu đường dẫn trùng với trang hiện tại
        if (href && currentPath.endsWith(href) && href !== "#") {
            $(this).addClass("active fw-bold border-bottom border-lime");
        }
    });
}