# Kiểm thử THỜI KHẮC

Bộ kiểm thử bảo vệ hành vi sản phẩm khi cập nhật hoặc dọn mã. Chạy trước và sau thay đổi; không dùng kết quả đạt để thay thế kiểm tra thiết bị và đánh giá bảo mật thực tế.

## Môi trường

| Thành phần | Sử dụng |
| --- | --- |
| Python | unittest, FastAPI TestClient và máy chủ Uvicorn tạm |
| JavaScript | Node.js Test Runner |
| Trình duyệt | Playwright với Chromium hoặc Google Chrome |
| Khai báo thư viện | `backend/requirements.txt`, `package.json`, `package-lock.json` |
| Lint / type checking | Chưa cấu hình |
| Build frontend | Không cần bundle; HTML/CSS/JS được phục vụ trực tiếp |
| CI | `.github/workflows/ci.yml`: Python 3.13, Node.js 22, Chromium |

Node.js cần phiên bản 20 trở lên. Cài thư viện Python theo [README](../README.md), sau đó:

```sh
npm ci
npx playwright install chromium
npm test
```

Nếu đã có Google Chrome, có thể bỏ bước cài Chromium và chạy:

```sh
PLAYWRIGHT_CHANNEL=chrome npm test
```

## Chạy từng lớp

```sh
npm run test:unit
npm run test:core
PLAYWRIGHT_CHANNEL=chrome npm run test:smoke
```

`npm test` chạy JavaScript → Python → trình duyệt. `test:core` chạy hai lớp đầu; `test:smoke` chạy các bài trình duyệt. Lỗi ở một lớp làm lệnh kết thúc với mã lỗi, không bỏ qua lớp lỗi hoặc tự đánh dấu đạt nếu thiếu dependency.

Runner đặt `CLOUD_STORAGE_DIR` vào kho tạm **trước khi import ứng dụng**. Không chạy toàn bộ Python discovery trực tiếp với môi trường mặc định: việc import app có thể mở kho triển lãm. Máy chủ trình duyệt dùng cổng riêng, không cần dừng máy chủ ở cổng 8000.

Test mới về lệnh khởi động có thể chạy độc lập vì không mở ứng dụng hoặc kho thật:

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_startup.py' -v
```

## Các hành vi được bảo vệ

| Phạm vi | Hành vi |
| --- | --- |
| Draw | Mono, năm độ rộng, màu tùy chọn, lực/vận tốc, Retina, tọa độ, tẩy, undo/redo, bản nháp; gửi thành công mới xóa, lỗi giữ hình và retry không trùng |
| API và quyền | Xác thực quản trị, giới hạn dữ liệu, kiểm tra SVG/mask, trạng thái lỗi và từ chối mutation không có quyền |
| Lưu trữ | Ghi nguyên tử, lỗi upload, staging/rollback khi purge hoặc xóa khoảnh khắc, dữ liệu sau restart, tài sản không liên quan không bị xóa |
| LED | 27 ô, phân bổ cân bằng, timer độc lập, tạm dừng/tiếp tục, crossfade, ánh kim giữ alpha, fullscreen và reconnect |
| Control | Editing khác Live, Chiếu trang rõ ràng, thêm/bỏ/chuyển hình, trang, yêu thích, thùng rác, khoảnh khắc, tìm kiếm/phân trang và phục hồi khi refresh lỗi |
| Dấu Ấn | Prepare → Display ready → start → playback/locked → reset, bộ nét chốt, timing/motion xác định, reload/restart giữa phiên |
| Khởi động | Localhost giữ chế độ thử; LAN từ chối PIN thiếu/trống/mặc định, không mở server hoặc kho dữ liệu khi từ chối |
| Bộ đo thiết bị | Chỉ thêm đo trong phiên thử, không đổi tác phẩm, retry hoặc đầu ra |

Các thử nghiệm lỗi filesystem, dữ liệu hỏng và crash chỉ dùng thư mục tạm. Không làm đầy ổ đĩa, đổi quyền hoặc thử xóa file trong kho triển lãm thật.

Các bài trình duyệt có kiểm tra offline dài và animation chạy theo thời gian thật, nên toàn bộ suite có thể mất vài phút. Không thay đổi đồng hồ, xóa assertion hoặc tăng timeout để che lỗi ứng dụng.

## Kiểm tra cú pháp và thư viện

Từ thư mục gốc:

```sh
.venv/bin/python -m compileall -q backend tests benchmarks run.py
find frontend benchmarks tests -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -print0 | xargs -0 -n1 node --check
npm ls --depth=0
.venv/bin/python -m pip check
git diff --check
```

Đây là kiểm tra cú pháp và môi trường, không phải lint, type checking hoặc build. Không có các script giả `lint`, `typecheck` hoặc `build`.

## CI

Workflow chạy khi push, mở/cập nhật pull request hoặc được gọi thủ công. CI tạo `.venv`, cài thư viện khóa phiên bản, cài Chromium cùng thư viện hệ thống, kiểm tra cú pháp rồi chạy `npm test`. Bước lỗi trả mã lỗi và làm job thất bại.

Không coi workflow đã được tạo là bằng chứng GitHub Actions đã chạy đạt. Xem kết quả job của commit/PR cụ thể trước khi bàn giao.

## Công cụ kiểm tra bổ sung

- [Thử Draw trên thiết bị thật](DRAW_DEVICE_TESTING.md): thao tác Safari trên iPad/iPhone trong kho tạm.
- `PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py`: đo tải với 27/250/1.500 tác phẩm mẫu; không đặt ngưỡng timing vào regression.
- `PLAYWRIGHT_CHANNEL=chrome node benchmarks/unified-ui.mjs all`: chụp giao diện trong môi trường tạm. Ảnh và số đo nằm trong `.impeccable/review/`, không đưa vào Git.
- Báo cáo đo riêng của máy lưu ở `benchmarks/results/`, không phải nguồn dữ liệu runtime.

## Giới hạn cần kiểm tra riêng

- Cảm giác ngón tay/Apple Pencil, Safari, bàn phím và bảng màu gốc trên iPhone/iPad.
- Độ rõ, màu và độ mượt vật lý trên LED P3.
- Vận hành nhiều giờ, hàng nghìn khách, bộ nhớ GPU và thiết bị mạng thực.
- Mất nguồn/hỏng đĩa thực, nhiều worker hoặc nhiều tiến trình cùng ghi kho JSON.
- Đánh giá bảo mật đầy đủ và triển khai qua Internet.

Các test giữ nguyên khóa bản nháp, biến môi trường và API hiện có để bảo vệ tương thích. Mã dịch vụ health `cloud-of-strokes-api` vẫn là định danh công khai cũ; tên sản phẩm và gói kiểm thử dùng THỜI KHẮC / `thoi-khac-tests`.

Xem [OPERATIONS.md](OPERATIONS.md) để vận hành, sao lưu và xử lý sự cố tại triển lãm.
