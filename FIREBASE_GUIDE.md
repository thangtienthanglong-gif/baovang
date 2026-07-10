# Hướng dẫn thiết lập Firebase

Ứng dụng hiện tại đã được chuyển đổi sang sử dụng **Firebase Realtime Database**. Để ứng dụng có thể kết nối và lưu dữ liệu lên Firebase, bạn cần thực hiện các bước sau để lấy file `serviceAccountKey.json`.

## Bước 1: Tạo Project Firebase
1. Truy cập [Firebase Console](https://console.firebase.google.com/).
2. Đăng nhập bằng tài khoản Google của bạn.
3. Bấm **Thêm dự án (Add project)** và làm theo hướng dẫn trên màn hình. Bạn không cần bật Google Analytics cho project này nếu không cần thiết.

## Bước 2: Tạo Realtime Database
1. Trong Firebase Console của project bạn vừa tạo, nhìn sang menu bên trái, chọn **Build > Realtime Database**.
2. Bấm **Tạo cơ sở dữ liệu (Create Database)**.
3. Chọn vị trí (Location) gần bạn nhất (ví dụ: Singapore) và bấm **Tiếp theo (Next)**.
4. Ở bước quy tắc bảo mật (Security Rules), chọn **Chế độ khóa (Locked mode)** (vì chúng ta sẽ truy cập qua Admin SDK nên không cần cấp quyền cho client) và bấm **Bật (Enable)**.

## Bước 3: Lấy file serviceAccountKey.json
1. Cũng trong Firebase Console, bấm vào biểu tượng **Bánh răng (Settings)** ở góc trên bên trái, bên cạnh chữ "Project Overview", và chọn **Cài đặt dự án (Project settings)**.
2. Chuyển sang tab **Tài khoản dịch vụ (Service accounts)**.
3. Dưới mục "Admin SDK configuration snippet", hãy chắc chắn rằng Node.js đang được chọn.
4. Bấm nút **Tạo khóa riêng tư mới (Generate new private key)**.
5. Một hộp thoại xác nhận sẽ hiện ra, bấm **Tạo khóa (Generate key)**.
6. Một file JSON sẽ được tải về máy của bạn. Hãy đổi tên file đó thành **`serviceAccountKey.json`** và copy/paste nó vào cùng thư mục với file `server.js` (thư mục gốc `baovang`).

## Bước 4 (Tùy chọn): URL Database
Thông thường `firebase-admin` sẽ tự động nhận diện URL Database dựa trên ID của project trong file `serviceAccountKey.json`. Tuy nhiên, nếu bạn tạo project ở server khác (ví dụ châu Âu - `europe-west1`), bạn có thể phải chỉ định biến môi trường trong file `.env`:
```env
FIREBASE_DATABASE_URL=https://<TEN-PROJECT-CUA-BAN>.firebaseio.com
```

Sau khi hoàn tất, hãy khởi động lại ứng dụng bằng lệnh `npm start`. Nếu bạn thấy dòng chữ `Connected to Firebase Realtime Database` hiện ra, nghĩa là bạn đã thiết lập thành công!
