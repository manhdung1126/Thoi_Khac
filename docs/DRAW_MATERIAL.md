# Nét Mono line và lớp hoàn thiện trình chiếu

## Bút hiện tại

Draw, mẫu bút, SVG và màn xem dùng chung bảng vàng của `shared/metallic.js` (màu cơ sở `#E7BD00`, gần `#FFD700`). Không tạo grain hoặc loang; hình học và độ rộng cố định cho mỗi nét. Đây là mô phỏng web dựa trên mẫu iPhone đã cung cấp, không phải PencilKit hoặc bản sao engine độc quyền của Apple. Viền giấy chỉ là CSS để đánh dấu vùng vẽ, không xuất vào SVG.

Tọa độ logic luôn là 720×720; backing canvas nhân devicePixelRatio. Năm mức độ rộng tương ứng 1 / 1,5 / 2 / 2,5 / 3 px trên ô LED 110 px. Mức 3 là `2 × 720 / 110 ≈ 13,09` đơn vị Draw. Pointer Events hỗ trợ chuột, cảm ứng và bút. Bút dùng lực thật (0–1); chuột/ngón tay dùng vận tốc tọa độ logic/ms: chậm đậm hơn, nhanh nhạt hơn. Fallback giới hạn 0,25–0,75; điểm đầu trung tính 0,55. Khi nhấc bút, pressure 0 không làm nhạt nét.

`monoOpacity()` lấy lực trung bình của các điểm và áp dụng alpha `0,9 + 0,1 × lực` cho **toàn nét**, làm tròn 3 chữ số: 90–100%, không biến thiên từng đoạn và không đổi độ rộng. Backend SVG dùng cùng công thức. Chuột/ngón tay thường nằm trong 92,5–97,5%. Các mẫu lực được lưu cùng đường nét nên reload/undo/redo/gửi không mất độ đậm.

Hình học Mono dùng lại lọc điểm/quadratic hiện có, giữ điểm đầu/cuối và góc có chủ ý. Không dự đoán đường đi vượt ngón tay. Nét ngắn/chấm dùng chung renderer. Bản nháp, hoàn tác và làm lại giữ dữ liệu đường nét; tẩy dùng destination-out, không tô màu giấy.

## Gửi và tương thích

Endpoint không đổi: POST `/api/drawings`, multipart `submission_id` và `strokes`. Nét Mono mới dùng vector v2, profile `led-2px`, material `mono-v1`, điểm `[x,y,p]`, không cần seed. Backend kiểm tra tọa độ/lực hữu hạn và giới hạn 0–1, sinh SVG gradient vàng trong suốt với alpha toàn nét. Draw chỉ xóa bảng khi nhận xác nhận lưu hợp lệ. Lỗi/mất kết nối giữ bản nháp và mã gửi để thử lại, chống tạo hình trùng.

Các bản nháp/tác phẩm v1 và graphite v2 của lần thử trước vẫn đọc được. Khi gửi lại bản nháp chưa lưu, nét vàng v1 chuyển sang Mono với lực 1 để giữ alpha 1 và bảng màu chung; graphite giữ material/seed/pressure. Không chuyển đổi hàng loạt, không ghi đè hoặc xóa SVG đã lưu. Các module graphite chỉ còn phục vụ tương thích.

## Display và Control

Nền gốc `frontend/display/assets/led-scroll.png` và 27 vị trí ô không đổi. Display không thêm tiêu đề, thẻ hình, bộ đếm hoặc nút thường trực lên ảnh bàn giao. Phần dư do viewport khác tỉ lệ 2:1 dùng xanh ngọc trầm; nền không bị kéo méo/cắt.

Nét vàng có bảng màu nền chung và lớp ánh kim chuyển động dùng chung cho Display, preview Control, khoảnh khắc và Dấu Ấn. Ánh sáng thay RGB bên trong mask, không thay alpha hoặc độ rộng; bỏ glow ngoài nét để nét sạch trên giấy sáng. SVG và Draw giữ bản ánh kim tĩnh; chênh lệch phản sáng theo thời điểm là có chủ ý. Graphite v2 đã lưu không bị tô lại; SVG v1 đã lưu không bị ghi đè.

Control dùng giấy sáng, xanh ngọc làm màu thao tác, vàng đất làm điểm nhấn. Trang được chọn chỉ là bản xem trước cho tới khi bấm Chiếu trang. Các nút, API và quyền quản trị hiện có được giữ; không thay backend, bộ đếm carousel hoặc điều phối realtime.

## Kiểm tra

- `node --test tests/*.cjs`
- `.venv/bin/python -m unittest discover -s tests -p 'test_*.py'`
- Trình duyệt: nét cố định/alpha/màu, bản nháp sau reload, gửi SVG và xóa bảng, realtime, ánh kim trước/sau fullscreen, preview trang không đổi trang đang chiếu, yêu thích, khoảnh khắc và preview Dấu Ấn.
- Kiểm tra Control ở 320/390/1024/1366/1440 px; Display ở tỉ lệ LED và 16:9, gồm 4K.

Cần thử trực tiếp trên iPhone/Safari và LED P3 trước triển lãm: cảm giác ngón tay, độ rõ ở khoảng cách xem và sắc độ vàng trên màn thật không được chứng minh chỉ bằng kiểm thử laptop.
