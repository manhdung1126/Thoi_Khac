# Cloud of Strokes · THỜI KHẮC

Ứng dụng triển lãm: khách vẽ trên điện thoại, gửi nét lên LED và quản lý bằng Control.
Frontend HTML/CSS/JavaScript thuần; backend FastAPI. Một server phục vụ cả giao diện, API và WebSocket.

## Chạy ứng dụng

Cài lần đầu từ thư mục dự án:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

Khởi động:

```sh
.venv/bin/python run.py
```

- Draw: http://127.0.0.1:8000/draw/
- Display: http://127.0.0.1:8000/display/
- Control: http://127.0.0.1:8000/control/
- Mã Control mặc định cho thử nghiệm: `2468`.
- Dừng bằng Ctrl+C; thêm `--reload` khi phát triển, `--port 8001` để đổi cổng.

Điện thoại cùng Wi-Fi:

```sh
CLOUD_ADMIN_PIN=ma-rieng .venv/bin/python run.py --lan
```

Dùng địa chỉ LAN được in trong terminal trên điện thoại. `127.0.0.1` chỉ truy cập chính thiết bị đang mở trang.

## Tính năng hiện tại

- **Draw:** nét Mono line vàng đặc, đều, năm mức độ rộng, tẩy alpha, hoàn tác/làm lại, bản nháp cục bộ và gửi chống trùng. Server sinh SVG nền trong suốt và xóa bảng sau khi xác nhận thành công. Display thêm ánh kim riêng cho trình chiếu; tác phẩm graphite đã có vẫn đọc được. Chi tiết: [docs/DRAW_MATERIAL.md](docs/DRAW_MATERIAL.md).
- **Display LED:** 1536×768, 27 ô 110×110 chia hàng 9–10–8 trong nền cuộn sớ; hình mới vào ô ngẫu nhiên, mỗi ô luân phiên danh sách bằng crossfade. Nét metallic có phản quang chuyển động.
- **Control:** chọn/tạo trang, chọn ô và thêm/chuyển hình, hiện ngay hoặc bỏ khỏi ô, tạm dừng luân phiên, Yêu thích, thùng rác/khôi phục/xóa vĩnh viễn, lưu/tải/xóa khoảnh khắc.
- **Dấu Ấn:** tải ảnh đích và xem thử với 27–1.500 hình ngay trong Control. Nét mẫu chỉ dùng cục bộ; chuẩn bị và phát trên LED dùng snapshot nét thật. Hướng dẫn: [docs/ENDING_CONTROL.md](docs/ENDING_CONTROL.md).

## Cấu trúc

```text
run.py                  Điểm chạy duy nhất
backend/
  app/main.py           FastAPI, lưu trữ, xác thực, API và WebSocket
  app/led.py            Danh sách 27 ô và kiểm tra dữ liệu đường nét
  app/ending.py         Kiểm tra mask và chốt bộ nét Ending
  requirements.txt      Thư viện Python
  storage/              Dữ liệu triển lãm, không đưa vào Git
frontend/
  draw/                 Giao diện và xử lý bút
  display/              Màn LED, crossfade và tài nguyên nền
  control/              Quản trị và lưu khoảnh khắc
  ending/               Engine hội tụ và preview chung cho Control/Display
  shared/               API client, hình học nét, graphite, metallic và phần dùng chung
tests/                  Kiểm thử Python và JavaScript
docs/LED_INSTALLATION.md Thông số LED, vận hành và vị trí chỉnh cấu hình
```

Mỗi thư mục giao diện chỉ còn mã của bản chốt hiện tại. Không còn renderer tự do, chế độ bố cục cũ, video nền hay bộ tài nguyên thử nghiệm trước đây.

## Dữ liệu và sao lưu

`backend/storage/` chứa `state.json`, SVG tác phẩm (`drawings`), dữ liệu đường nét (`vectors`), bản sao SVG yêu thích (`favorites`) và ảnh xem trước khoảnh khắc (`snapshots`). Tick tim tạo bản sao SVG; bỏ tim xóa bản sao. Bản sao vẫn được giữ nếu xóa vĩnh viễn hình gốc.

Lưu khoảnh khắc tạo một trang gồm đúng hình đang hiện tại từng ô khi bấm lưu, không sao chép toàn bộ hàng đợi. Bấm “Chiếu khoảnh khắc” để chuyển sang trang đó. Xóa khoảnh khắc cũng xóa trang tương ứng; cần chuyển sang trang khác nếu đang chiếu trang này. Hình trong trang vẫn dùng chung kho tác phẩm: xóa hình khỏi kho cũng gỡ hình khỏi trang khoảnh khắc.

Dừng server rồi sao lưu toàn bộ `backend/storage/` trước khi chuyển máy. Không sửa state khi server đang chạy. `.venv/` là môi trường chạy trên máy hiện tại; tạo lại khi chuyển máy, không đưa vào Git.

## Kiểm thử

```sh
.venv/bin/python -m unittest discover -s tests -v
node --test tests/*.cjs
```

Kiểm thử API dùng thư mục tạm và chỉ bảo vệ luồng chức năng đang chốt.

## Chuẩn bị bản chính

Cấu trúc đã được dọn; đây chưa phải xác nhận sẵn sàng triển khai công khai. Hiện ứng dụng dùng một tiến trình API, state JSON trên ổ đĩa và phiên quản trị trong bộ nhớ (restart cần đăng nhập lại). Trước vận hành chính thức: chốt nền triển lãm, đặt mã quản trị riêng, kiểm tra mạng thực tế, sao lưu dữ liệu và thử trực tiếp trên LED P3.
