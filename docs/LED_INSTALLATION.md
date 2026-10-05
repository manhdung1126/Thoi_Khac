# LED P3 · cấu hình hiện tại

## Kích thước và nét vẽ

- Raster gốc: **1536×768**, tỷ lệ **2:1**, màn khoảng 4,6×2,3 m.
- Nền cuộn sớ bàn giao: **1536×768**, dùng nguyên ảnh, không crop.
- 27 ô cố định: ba hàng **9 / 10 / 8 ô**, mỗi ô **110×110 px**. Thu từ 140 px để lọt vùng giấy mới mà không chạm viền và mây trang trí.
- Hàng 1–3 bắt đầu tại y = **240 / 365,69 / 491,39** px. Hai hàng đầu căn giữa; hàng cuối căn phải, bắt đầu x ≈ **402,14** để tránh mây góc dưới trái.
- Khoảng cách cạnh ô: `47 × 1536 / 4600 ≈ 15,69 px`.
- Draw: **720×720** đơn vị. Mức 3 rộng `2 × 720 / 110 ≈ 13,09` đơn vị, tương ứng **2 px LED**. Các nét đã lưu giữ dữ liệu đường nét và mức bút; không ghi đè tác phẩm cũ.
- Mức 1–5: `1 / 1,5 / 2 / 2,5 / 3 px` trên LED. Độ rộng lưu trên từng nét.
- Nét mới (vector v1): **Mono line vàng đặc `#FFD700`**, độ rộng cố định theo mức bút, không hạt/texture, không thay alpha hay độ rộng theo lực. Xem [DRAW_MATERIAL.md](DRAW_MATERIAL.md).
- Trình chiếu nét vàng: **vàng `#E7BD00`**, sắc độ vàng đất và phản sáng vàng kem chuyển động bên trong nét. Không dùng glow ngoài nét. SVG giữ màu đặc `#FFD700`; không ghi đè tác phẩm cũ.
- Tương thích graphite v2 đã lưu: tiếp tục đọc đúng vật liệu cũ, không xóa dữ liệu hoặc tự đổi màu.

Điểm vẽ và hình học Mono được dùng chung giữa Draw, SVG và LED. Trình duyệt gửi dữ liệu vector đã chuẩn hóa; server kiểm tra rồi sinh SVG nền trong suốt. Đầu ra LED cần mapping 1:1 để giữ kích thước.

## Hoạt động các ô

Hình được phân theo từng vòng cân bằng. Hệ thống chọn ngẫu nhiên trong các ô đang có ít hình nhất: đủ 27 hình đầu tiên mới bắt đầu phân hình thứ hai cho từng ô; đủ lượt thứ hai mới bắt đầu lượt thứ ba. Hình cũ vẫn còn trong danh sách của ô. Server điều phối luân phiên (mặc định 8 giây), trình duyệt crossfade (mặc định 1,2 giây). Mỗi ô đếm riêng từ lúc hình được đưa lên; hình mới hoặc thao tác hiện ngay chỉ bắt đầu lại lượt đếm của ô đó. Tạm dừng hoặc chuyển sang trang khác giữ thời gian còn lại. Đổi chu kỳ áp dụng theo mốc riêng từng ô; ô đã hết thời gian sẽ đổi ở lượt kiểm tra kế tiếp (tối đa khoảng 0,5 giây). Các mốc được lưu cùng bố cục. Dữ liệu cũ được khởi tạo nhịp riêng theo thời điểm gửi hình.

Tạm dừng giữ hình đang hiện; hình mới vào ô có hình sẽ chờ. Control có thể chọn ô, thêm/chuyển hình từ kho, hiện ngay hoặc bỏ hình khỏi ô. Trái tim thêm hình vào thư mục Yêu thích. Thùng rác loại hình khỏi các trang, khôi phục đưa lại vào kho; xóa vĩnh viễn phải thực hiện từ thùng rác.

`pages[].cells[] = {id, drawing_ids, active}` là dữ liệu chính của carousel. `pages[].items` là danh sách active rút gọn để Control hiển thị nhanh.

## Các vị trí chỉnh giao diện

| Nội dung | File |
| --- | --- |
| Kích thước, tọa độ ô, độ rộng, đường dẫn nền | `frontend/shared/led.js` |
| Nền cuộn sớ được bàn giao | `frontend/display/assets/led-scroll.png` |
| Gradient vàng và phản quang | `frontend/shared/metallic.js` |
| Crossfade, chuyển động ánh sáng và snapshot | `frontend/display/led-scene.js` |
| Hình học nét Mono | `frontend/shared/monoline.js` |
| Vật liệu graphite và hạt cố định | `frontend/shared/graphite.js` |
| Phân ô, luân phiên, giới hạn dữ liệu vector | `backend/app/led.py` |

Nền hiện tại là asset cục bộ thay được. Nét phản quang có chu kỳ khoảng 6 giây; trình vẽ ánh sáng giới hạn khoảng 20 FPS. Thiết bị bật giảm chuyển động sẽ dùng nét tĩnh. Quầng sáng nhẹ là hiệu ứng ngoài nét nên phạm vi sáng nhìn thấy có thể lớn hơn lineWidth.

Display, Control, ảnh khoảnh khắc và preview Dấu Ấn dùng cùng nền và hình học ô. Hình hội tụ cuối Dấu Ấn được giới hạn trong vùng giấy ở giữa (x:408, y:238, 720×344), chừa dòng kết bên dưới; không phủ lên tiêu đề hoặc mây góc trái.

## Lưu khoảnh khắc và kiểm tra tại triển lãm

Khoảnh khắc là PNG **1536×768**, gồm nền và hình active của từng ô. PNG là ảnh tĩnh; không chứa chuyển động. Capture dựng lại bố cục đích nên không bảo đảm trùng từng frame crossfade hoặc quầng CSS của màn đang phát.

Display: `F` để toàn màn hình, `D` để hiện công cụ chẩn đoán. Hai màn nhận cùng active ID nhưng có thể lệch thời điểm chuyển do mạng.

Trước khi mở triển lãm, kiểm tra mapping 1:1, năm mức nét, độ rõ của nét vàng trên giấy sáng, ngắt/kết nối lại Wi-Fi, gửi nhiều hình, luân phiên khi đủ 27 ô và lưu khoảnh khắc. Màu, highlight và độ mượt cần được đánh giá trực tiếp trên LED P3.
