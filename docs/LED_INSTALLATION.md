# LED P3 · cấu hình hiện tại

## Kích thước và nét vẽ

- Raster gốc: **1536×768**, tỷ lệ **2:1**, màn khoảng 4,6×2,3 m.
- 27 ô cố định: 9 cột × 3 hàng xen kẽ, mỗi ô **140×140 px**.
- Khoảng cách cạnh ô: `47 × 1536 / 4600 ≈ 15,69 px`.
- Draw: **720×720** đơn vị. Mức 3 rộng `2 × 720 / 140 ≈ 10,29` đơn vị, tương ứng **2 px LED**.
- Mức 1–5: `1 / 1,5 / 2 / 2,5 / 3 px` trên LED. Độ rộng lưu trên từng nét.
- Màu cơ sở `#FFD700`; metallic dùng nhiều sắc vàng và highlight nên pixel hiển thị không chỉ có một mã màu.

Điểm vẽ và hình học Mono được dùng chung giữa Draw, SVG và LED. Trình duyệt gửi dữ liệu vector đã chuẩn hóa; server kiểm tra rồi sinh SVG nền trong suốt. Đầu ra LED cần mapping 1:1 để giữ kích thước.

## Hoạt động các ô

Hình được phân theo từng vòng cân bằng. Hệ thống chọn ngẫu nhiên trong các ô đang có ít hình nhất: đủ 27 hình đầu tiên mới bắt đầu phân hình thứ hai cho từng ô; đủ lượt thứ hai mới bắt đầu lượt thứ ba. Hình cũ vẫn còn trong danh sách của ô. Server điều phối luân phiên (mặc định 8 giây), trình duyệt crossfade (mặc định 1,2 giây). Mỗi ô đếm riêng từ lúc hình được đưa lên; hình mới hoặc thao tác hiện ngay chỉ bắt đầu lại lượt đếm của ô đó. Tạm dừng hoặc chuyển sang trang khác giữ thời gian còn lại. Đổi chu kỳ áp dụng theo mốc riêng từng ô; ô đã hết thời gian sẽ đổi ở lượt kiểm tra kế tiếp (tối đa khoảng 0,5 giây). Các mốc được lưu cùng bố cục. Dữ liệu cũ được khởi tạo nhịp riêng theo thời điểm gửi hình.

Tạm dừng giữ hình đang hiện; hình mới vào ô có hình sẽ chờ. Control có thể chọn ô, thêm/chuyển hình từ kho, hiện ngay hoặc bỏ hình khỏi ô. Trái tim thêm hình vào thư mục Yêu thích. Thùng rác loại hình khỏi các trang, khôi phục đưa lại vào kho; xóa vĩnh viễn phải thực hiện từ thùng rác.

`pages[].cells[] = {id, drawing_ids, active}` là dữ liệu chính của carousel. `pages[].items` là danh sách active rút gọn để Control hiển thị nhanh.

## Các vị trí chỉnh giao diện

| Nội dung | File |
| --- | --- |
| Kích thước, tọa độ ô, độ rộng, đường dẫn nền | `frontend/shared/led.js` |
| Nền đen ánh vàng thử nghiệm | `frontend/display/assets/led-dark-gold-demo.svg` |
| Gradient vàng và phản quang | `frontend/shared/metallic.js` |
| Crossfade, chuyển động ánh sáng và snapshot | `frontend/display/led-scene.js` |
| Hình học nét Mono | `frontend/shared/monoline.js` |
| Phân ô, luân phiên, giới hạn dữ liệu vector | `backend/app/led.py` |

Nền hiện tại là asset cục bộ thay được. Nét phản quang có chu kỳ khoảng 6 giây; trình vẽ ánh sáng giới hạn khoảng 20 FPS. Thiết bị bật giảm chuyển động sẽ dùng nét tĩnh. Quầng sáng nhẹ là hiệu ứng ngoài nét nên phạm vi sáng nhìn thấy có thể lớn hơn lineWidth.

## Lưu khoảnh khắc và kiểm tra tại triển lãm

Khoảnh khắc là PNG **1536×768**, gồm nền và hình active của từng ô. PNG là ảnh tĩnh; không chứa chuyển động. Capture dựng lại bố cục đích nên không bảo đảm trùng từng frame crossfade hoặc quầng CSS của màn đang phát.

Display: `F` để toàn màn hình, `D` để hiện công cụ chẩn đoán. Hai màn nhận cùng active ID nhưng có thể lệch thời điểm chuyển do mạng.

Trước khi mở triển lãm, kiểm tra mapping 1:1, năm mức nét, độ sáng vàng trên nền đen, ngắt/kết nối lại Wi-Fi, gửi nhiều hình, luân phiên khi đủ 27 ô và lưu khoảnh khắc. Màu, highlight và độ mượt cần được đánh giá trực tiếp trên LED P3.
