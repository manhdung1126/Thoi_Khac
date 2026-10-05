# Dấu Ấn trong Control

Tính năng tại /control/#ending-panel, dùng chung engine với /display/. Không còn trang prototype hay ảnh Hà Nội mặc định. Chọn ảnh đích của triển lãm trước khi xem thử hoặc chuẩn bị LED.

## Xem thử độc lập

1. Chọn **Ảnh đích** (PNG/JPG/WebP/SVG, tối đa 8 MB).
2. Chọn **Xem thử với**: nét thật, hoặc 27 / 50 / 100 / 250 / 500 / 1.000 / 1.500 hình.
3. Bấm **Xem thử**. Preview chạy đủ 20 giây từ các ô trình chiếu đến hội tụ, khắc và giữ hình. Có chạy lại, tạm dừng/tiếp tục.

Số hình là tổng số trong preview. Nếu nét thật chưa đủ, hệ thống sinh nét mẫu để bù; nếu ít hơn số nét thật, preview chỉ lấy một phần. Dialog ghi rõ số nét thật và nét mẫu. Trang trống vẫn xem thử được với dữ liệu mô phỏng.

Nét mẫu chỉ ở bộ nhớ trình duyệt: không gửi API, không vào kho, không đổi trang và không chiếu lên LED. Bản xem thử được chốt khi mở; cập nhật realtime không thay bộ nét giữa chừng. Đóng dialog sẽ hủy tác vụ tải và animation.

**Tùy chỉnh ảnh & bố cục** thu gọn vùng sáng/tối/alpha và mã bố cục. Cùng ảnh, bộ nét và mã bố cục cho cùng vị trí và đường chuyển động. Ảnh quá mảnh sẽ được yêu cầu giảm số hình; nhiều hình có thể nhỏ khó đọc trên màn 1536×768.

## Phát lên LED

1. Mở Display, đăng nhập Control và chọn ảnh đích.
2. **Chuẩn bị LED** chốt toàn bộ nét thật trong hàng đợi của trang đang chiếu, không phải trang đang chọn để chỉnh sửa. Không dùng số hình mô phỏng đã chọn. Carousel dừng để tải sẵn Ending.
3. Đợi **Sẵn sàng**, bấm **Bắt đầu trên LED**. Có 2 giây chuẩn bị, sau đó animation 20 giây. Khung chính của Control theo dõi cùng Ending.
4. **Về trình chiếu** tiếp tục trang trước. Nét gửi thêm trong Ending vẫn được lưu nhưng không chen vào bộ nét đã chốt.

Chuyển trang phát, xóa trang nguồn và xóa vĩnh viễn nét thuộc Ending bị chặn đến khi quay lại trình chiếu. Có thể chỉnh trang khác. Phiên đã chuẩn bị vẫn được giữ khi reload; không cần ảnh mặc định.

## Kiến trúc

- backend/app/ending.py: kiểm tra mask và chốt bộ nét thật.
- backend/app/main.py: prepare/start/reset có xác thực; phiên lưu trong state.json và thông báo qua WebSocket hiện có.
- frontend/control/ending.js: điều khiển tối giản, tải ảnh và dialog.
- frontend/ending/rehearsal.js + samples.js: tạo dữ liệu xem thử cục bộ, bổ sung mẫu và phân vào 27 ô.
- session.js + session.css: tải nét, scale và đồng bộ session cho Control/Display.
- composition.js, motion.js, preview.js: bố cục, chuyển động, canvas; không gửi vị trí từng frame.
- flow.js: trường curl liên tục dùng chung, vận tốc có quán tính, steering và arrival. Tính cả bộ nét theo bước cố định 30 Hz: trừ lực trôi chung để không dồn sang một phía, giữ vùng xuất phát bằng lực mềm để các cụm còn khoảng thoáng. Hai lực này giảm liên tục khi hội tụ; không ép các nét bay đối xứng máy móc. Nội suy lúc phát giúp pause/seek/reload và nhiều Display có cùng kết quả. Không còn 5 đường bay cố định hay bật/tắt lực theo phase; nhãn phase chỉ phục vụ kiểm tra.
- mask.js, assets.js, config.js: đọc hình đích, đọc nét và thông số chung.
- shine.js: ánh kim chuyển động theo thời gian animation, dải sáng đi cùng vùng đồng tối để dễ thấy trên nền giấy sáng. Chỉ phủ lên alpha nét, không thêm nền hay tăng độ dày nét. Khi kết thúc giữ nguyên hình.

POST /api/ending/prepare: request_id, mask, seed, name. ID trùng giữ snapshot; chuẩn bị khác cần reset.
POST /api/ending/{id}/ready: Display báo tải đủ, lặp 15 giây; có hiệu lực 45 giây.
POST /api/ending/{id}/start: cần ít nhất một Display sẵn sàng; lưu start_time server và không đổi khi gọi lại.
POST /api/ending/{id}/reset: kiểm tra ID phiên, tiếp tục carousel; không xóa nét vẽ.

Display tính elapsed theo server_time/start_time; reload giữa chừng tiếp tục đúng thời điểm. Animation chạy cục bộ khi mất mạng. Reset/rời trang hủy tải, timer và animation. Mask lưu là tập điểm nên không phụ thuộc tệp ảnh mặc định.

## Kiểm tra và giới hạn

Kiểm thử dùng kho tạm, không sinh dữ liệu mẫu vào kho triển lãm. Tests bao phủ bộ nét cố định, readiness, auth, start chống lặp, khôi phục phiên, bảo vệ tệp, bố cục/chuyển động và dữ liệu preview không đổi state thật.

Cần rehearsal trực tiếp trên LED P3 trước triển lãm. Lưu ảnh kết quả cuối và quản lý nhiều phiên Ending đã lưu chưa được triển khai.

Thông số chuyển động trong config.js: flowSpeed (0.065), spreadStrength (0.65: giữ độ thoáng), driftBalance (1: cân lực trôi chung; giảm tự động với dưới 5 nét), arrivalSpeed, steering, damping, personalShare (22%), targetRadius, arrivalRate, settleWindow và simulationHz. 3–7 nét cuối ổn định lệch nhau nhẹ thay vì dừng tất cả để một nét biểu diễn riêng. Vị trí đích và dữ liệu server giữ nguyên; tải lại Control/Display sau khi nâng cấp để dùng cùng engine.

Độ nổi bật nằm trong ENDING_VISUAL: depthFade (0.08: độ giảm rõ của nét xa), shinePeriod (4.2 giây), shineWidth (0.085 bề ngang màn), shineStrength (0.90), shadowStrength (0.48), engravingStrength (1). Ánh sáng dùng thời gian tuyệt đối nên tạm dừng không tiếp tục chạy và tua lại cho cùng phản chiếu. Không sửa SVG gốc, màu xuất hay độ rộng bút.
