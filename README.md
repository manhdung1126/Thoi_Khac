# Cloud of Strokes

Ứng dụng triển lãm tương tác gồm ba màn hình:

- `Draw`: khách tham quan vẽ và gửi tác phẩm.
- `Display`: màn hình lớn nhận và trình chiếu tác phẩm theo thời gian thực.
- `Control`: người quản lý điều khiển nội dung đang trình chiếu.

## Cấu trúc ban đầu

```text
cloud_of_strokes/
├── frontend/
│   ├── draw/
│   ├── display/
│   ├── control/
│   └── shared/
│       ├── css/
│       └── js/
├── backend/
│   ├── app/
│   └── storage/
│       ├── drawings/
│       └── snapshots/
├── assets/
│   └── videos/
├── tests/
└── docs/
```

Ở bước đầu tiên, dự án chỉ có cấu trúc thư mục. Mã HTML, CSS, JavaScript và Python sẽ được thêm dần trong các bước học tiếp theo.

## Lộ trình học và xây dựng

1. Hiểu cấu trúc dự án và vai trò client/server.
2. Dựng trang Draw bằng HTML cơ bản.
3. Trang trí trang Draw bằng CSS.
4. Học DOM và JavaScript qua các nút điều khiển.
5. Vẽ bằng Canvas và xuất ảnh nền trong suốt.
6. Tạo server FastAPI và API HTTP đầu tiên.
7. Kết nối Draw, Display và Control bằng WebSocket.
8. Thêm lưu trữ, bố cục trình chiếu và công cụ quản trị.

