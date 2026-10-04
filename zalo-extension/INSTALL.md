# BaoVang Auto Zalo Web

## Cài đặt Chrome/Edge

1. Mở `chrome://extensions` hoặc `edge://extensions`.
2. Bật **Developer mode / Chế độ nhà phát triển**.
3. Chọn **Load unpacked / Tải tiện ích đã giải nén**.
4. Chọn thư mục `zalo-extension`.
5. Mở `https://baovang.vercel.app/` và đăng nhập.
6. Mở `https://chat.zalo.me/` và đăng nhập Zalo Web.
7. Trong BaoVang chọn Zalo cá nhân rồi bấm gửi hàng loạt.

Sau khi cập nhật mã extension, bấm **Reload / Tải lại** tại trang tiện ích rồi tải lại tab BaoVang. Khi gửi, extension sẽ tự mở hoặc tải lại tab Zalo Web để nạp đúng phiên bản mới.

Extension tự mở Zalo Web, tìm theo số điện thoại, điền tin và gửi tuần tự. Số không tìm thấy trong kết quả Zalo được bỏ qua; lỗi mở hoặc gửi tin sẽ dừng hàng đợi và báo lý do về BaoVang.

Khi extension đang chạy, trạng thái sẽ hiện ở góc trên bên phải tab Zalo Web. Nếu dừng ở màn hình chào mừng, xem dòng trạng thái này để biết bước nào chưa thực hiện được.

## Lưu ý

- Đây là prototype dựa trên DOM của Zalo Web; nếu Zalo đổi giao diện, cần cập nhật selector trong `content.js`.
- Không gửi mật khẩu, QR hoặc OTP cho extension hay cho người khác.
- Nên thử một học sinh trước khi chạy hàng loạt.
- Chỉ bật một phiên Auto trên một trình duyệt tại một thời điểm.
