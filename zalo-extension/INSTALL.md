# BaoVang Auto Zalo Web

## Cài đặt Chrome/Edge

1. Mở `chrome://extensions` hoặc `edge://extensions`.
2. Bật **Developer mode / Chế độ nhà phát triển**.
3. Chọn **Load unpacked / Tải tiện ích đã giải nén**.
4. Chọn thư mục `zalo-extension`.
5. Mở `https://baovang.vercel.app/` và đăng nhập.
6. Mở `https://chat.zalo.me/` và đăng nhập Zalo Web.
7. Trong BaoVang chọn Zalo cá nhân rồi bấm gửi hàng loạt.

Extension tự mở Zalo Web, tìm theo số điện thoại, điền tin và gửi tuần tự. Khi gặp lỗi, nó dừng và trả trạng thái về BaoVang.

## Lưu ý

- Đây là prototype dựa trên DOM của Zalo Web; nếu Zalo đổi giao diện, cần cập nhật selector trong `content.js`.
- Không gửi mật khẩu, QR hoặc OTP cho extension hay cho người khác.
- Nên thử một học sinh trước khi chạy hàng loạt.
- Chỉ bật một phiên Auto trên một trình duyệt tại một thời điểm.
