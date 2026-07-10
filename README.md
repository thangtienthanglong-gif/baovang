# App độc lập báo vắng học sinh + Zalo OA

Đây là web app độc lập, không dùng Google Apps Script và không phụ thuộc Google Sheet. App chạy bằng Node.js + Express, lưu dữ liệu vào `data/db.json`, có chức năng nạp danh bạ học sinh từ Excel và kích hoạt gửi thông báo vắng học qua Zalo OA.

## Luồng nghiệp vụ

1. Văn phòng nạp file danh bạ học sinh `.xlsx`.
2. Hệ thống tự đọc:
   - Lớp: `Name Prefix` hoặc cột `Lop/Lớp/Class`.
   - Họ tên: `Full Name` hoặc ghép `First Name + Middle Name + Last Name`.
   - Số điện thoại phụ huynh: `Phone 1 - Value`, `Phone 2 - Value`, `Phone 3 - Value`.
   - Phụ huynh/ghi chú: `Name Suffix`, `Notes`, `Labels`.
   - Zalo user_id: `Zalo UID`, `Zalo User ID`, `user_id` nếu file có sẵn.
3. Hệ thống tách học sinh theo cây lớp để người dùng chọn nhanh.
4. Người dùng chọn học sinh và trạng thái vắng học.
5. Hệ thống tự lấy lớp, phụ huynh, số điện thoại/Zalo UID.
6. Sau thời gian chờ đã cấu hình, hệ thống kích hoạt gửi thông báo qua Zalo OA và lưu lịch sử gửi.
7. Nếu chưa đủ điều kiện gửi thật, app ghi log ở chế độ chạy thử hoặc báo rõ thiếu Zalo UID/token.

## Chức năng chính

- Nạp danh bạ học sinh từ Excel.
- Tự nhận diện học sinh, lớp, phụ huynh và số điện thoại.
- Xem danh sách theo cây lớp sau khi nạp Excel.
- Quản lý danh sách học sinh.
- Ghi nhận vắng học theo ngày, buổi, trạng thái.
- Tự động xếp lịch gửi Zalo OA sau số phút cấu hình.
- Gửi lại Zalo thủ công cho từng học sinh.
- Gọi điện thủ công bằng nút `tel:`.
- Lưu lịch sử gọi điện.
- Lưu lịch sử gửi Zalo OA.
- Cấu hình nội dung tin nhắn bằng template.
- Chạy được trên máy cá nhân, mạng LAN, VPS hoặc Docker.

## Cài đặt nhanh

Yêu cầu: Node.js 18 trở lên.

```bash
npm install
npm start
```

Mở trình duyệt tại:

```text
http://localhost:3000
```

## Chạy trong mạng nội bộ trường

Chạy app trên một máy chủ nội bộ:

```bash
npm start
```

Từ máy khác trong cùng mạng LAN/Wi-Fi, mở bằng IP máy chủ, ví dụ:

```text
http://192.168.1.25:3000
```

## Chạy bằng Docker

```bash
docker compose up -d --build
```

Mở:

```text
http://localhost:3000
```

## Cấu hình Zalo OA

Có hai cách cấu hình:

### Cách 1: Cấu hình trong giao diện

Vào tab **Cấu hình Zalo OA**:

- Chế độ gửi: `dry-run` để chạy thử, `oa` để gửi thật.
- Chờ gửi Zalo: số phút đợi sau khi đánh dấu vắng học trước khi gửi tin.
- Bật gửi thật: chỉ bật khi đã có OA access token hợp lệ.
- Endpoint mặc định: `https://openapi.zalo.me/v3.0/oa/message/cs`.
- Nhập OA access token.
- Chỉnh mẫu nội dung tin nhắn.

### Cách 2: Cấu hình bằng biến môi trường

Copy file mẫu:

```bash
cp .env.example .env
```

Cấu hình:

```env
PORT=3000
ZALO_ENABLED=true
ZALO_MODE=oa
ZALO_ENDPOINT=https://openapi.zalo.me/v3.0/oa/message/cs
ZALO_OA_ACCESS_TOKEN=your_oa_access_token
```

> Khuyến nghị triển khai thật: dùng biến môi trường thay vì lưu access token trong `data/db.json`.

## Cấu hình Coze AI cho chatbox

Chatbox có thể dùng Coze AI nếu bật trong tab cấu hình và nhập:

- `Coze Bot ID`
- `Coze access token`
- `Coze API`: mặc định `https://api.coze.com`, có thể đổi theo vùng tài khoản Coze
- `User ID`: mã người dùng hội thoại, mặc định `bao-vang-teacher`

Có thể cấu hình bằng biến môi trường thay vì lưu token trong `data/db.json`:

```env
COZE_ENABLED=true
COZE_BASE_URL=https://api.coze.com
COZE_BOT_ID=your_coze_bot_id
COZE_ACCESS_TOKEN=your_coze_access_token
COZE_USER_ID=bao-vang-teacher
```

Chatbox gọi Coze qua backend `/api/ai-chat`, không gọi trực tiếp từ trình duyệt.

## Lưu ý quan trọng về Zalo OA

- API gửi tin OA dạng tư vấn cần `user_id` của người dùng đã tương tác/quan tâm OA, không phải chỉ có số điện thoại là gửi được.
- Nếu danh bạ chỉ có số điện thoại, app vẫn import được học sinh nhưng sẽ ghi trạng thái `Không gửi` khi thiếu `Zalo user_id`.
- Muốn gửi theo số điện thoại, thường cần đi theo hướng ZNS/template message và phải có mẫu tin được Zalo duyệt theo chính sách Zalo Business.
- Vì vậy bản này hỗ trợ chắc chắn luồng OA UID: `recipient.user_id + message.text`.

## Mẫu tin nhắn

Mặc định:

```text
Kính gửi Quý phụ huynh, {schoolName} thông báo học sinh {studentName}, lớp {className}, vắng học {session} ngày {date}. Trạng thái: {absenceStatus}. Lý do ban đầu: {reason}. Vui lòng phản hồi với nhà trường nếu cần bổ sung thông tin.
```

Biến có thể dùng:

- `{schoolName}`
- `{date}`
- `{studentCode}`
- `{studentName}`
- `{className}`
- `{session}`
- `{absenceStatus}`
- `{reason}`
- `{parentName}`
- `{phone}`

## Cấu trúc thư mục

```text
bao-vang-hoc-sinh-standalone/
├── server.js              # Backend API, import Excel, gửi Zalo OA
├── package.json           # Cấu hình Node.js
├── .env.example           # Mẫu biến môi trường
├── Dockerfile             # Chạy bằng Docker
├── docker-compose.yml     # Docker Compose
├── data/
│   └── db.json            # Tự tạo khi chạy lần đầu
└── public/
    ├── index.html         # Giao diện chính
    ├── style.css          # Giao diện responsive
    └── app.js             # Logic frontend
```

## API chính

- `GET /api/bootstrap`: tải dữ liệu khởi động.
- `GET /api/settings`: đọc cấu hình Zalo.
- `PUT /api/settings`: lưu cấu hình Zalo.
- `POST /api/import/students`: nạp danh bạ Excel.
- `GET /api/students`: danh sách học sinh.
- `POST /api/students`: thêm học sinh.
- `PUT /api/students/:id`: sửa học sinh.
- `DELETE /api/students/:id`: xóa học sinh nếu chưa có dữ liệu vắng.
- `GET /api/absences`: danh sách học sinh vắng.
- `POST /api/absences`: thêm vắng học và tự động gửi Zalo nếu bật.
- `PUT /api/absences/:id/status`: cập nhật trạng thái vắng học và gửi lại Zalo.
- `POST /api/absences/:id/zalo`: gửi lại Zalo thủ công.
- `PUT /api/absences/:id/call`: lưu kết quả cuộc gọi.
- `DELETE /api/absences/:id`: xóa bản ghi vắng.
- `GET /api/call-logs`: xem lịch sử gọi.
- `GET /api/notification-logs`: xem lịch sử gửi Zalo.

## Gợi ý triển khai chính thức

Bản này là MVP chạy nội bộ. Khi triển khai chính thức cho trường, nên nâng cấp:

- Đăng nhập và phân quyền: admin, văn phòng, GVCN, BGH.
- Chuyển `data/db.json` sang PostgreSQL hoặc MySQL.
- Sao lưu dữ liệu tự động hằng ngày.
- Mã hóa access token.
- Import thêm trường Zalo UID từ danh sách follower OA hoặc hệ thống CRM.
- Tách hàng đợi gửi tin để tránh gửi hàng loạt quá nhanh.
- Thêm phê duyệt mẫu tin và luồng ZNS nếu trường cần gửi theo số điện thoại.
