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

Bản 1.2.0 cần quyền **clipboardRead** để dán tin nhiều dòng. Chấp nhận quyền Chrome yêu cầu khi tải lại extension.

Nếu Chrome ghi lỗi **Extension context invalidated** sau khi bấm Reload, tải lại cả tab BaoVang và Zalo. Đây là kết nối của mã cũ đã bị ngắt khi tiện ích cập nhật. Nút thùng rác trong màn hình lỗi của Chrome xóa bản ghi lỗi cũ; tin đã gửi không cần gửi lại.

Nếu một tin đã xuất hiện trong cuộc trò chuyện nhưng extension báo lỗi xuống dòng, **không bấm Gửi lại** cho tin đó. Kiểm tra nội dung trong Zalo rồi đánh dấu đã gửi trong BaoVang để tránh phụ huynh nhận tin trùng.

Extension tự mở Zalo Web, tìm theo số điện thoại, dán toàn bộ nội dung và bấm Gửi. Với tin nhiều dòng, extension dùng clipboard của Chrome rồi kiểm tra đủ nội dung trong ô chat trước khi bấm Gửi. Nếu nội dung không được dán đầy đủ hoặc không thấy tin mới trong cuộc trò chuyện, extension dừng và BaoVang báo lỗi.

Khi extension đang chạy, trạng thái sẽ hiện ở góc trên bên phải tab Zalo Web. Nếu dừng ở màn hình chào mừng, xem dòng trạng thái này để biết bước nào chưa thực hiện được.

## Lưu ý

- Đây là prototype dựa trên DOM của Zalo Web; nếu Zalo đổi giao diện, cần cập nhật selector trong `content.js`.
- Không gửi mật khẩu, QR hoặc OTP cho extension hay cho người khác.
- Nên thử một học sinh trước khi chạy hàng loạt.
- Chỉ bật một phiên Auto trên một trình duyệt tại một thời điểm.
