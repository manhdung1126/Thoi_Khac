# Draw — thử trên iPad/iPhone thật

Hướng dẫn cho đội kỹ thuật thử Draw trên thiết bị triển lãm bằng dữ liệu tạm.
Ghi kết quả từ thao tác thật trên Safari; các kiểm tra Chrome tự động chỉ chứng minh
bộ đo không đổi đầu ra, không thay thế trải nghiệm trên iPad/iPhone.

## 1. Mở phiên thử an toàn

Trên Mac, tại thư mục dự án:

```sh
.venv/bin/python benchmarks/draw_device.py
```

Máy chủ in URL dạng `http://<IP-Mac>:<cổng-tạm>/draw/?perf=1`.
Mở **đúng URL vừa in bằng Safari** trên iPad/iPhone, cùng mạng Wi-Fi với Mac.
Không dùng `127.0.0.1` trên điện thoại. Không dùng tunnel công khai.
Nếu không mở được: kiểm tra cùng Wi-Fi, Mac không ngủ, firewall cho phép phiên này,
và mạng khách không chặn thiết bị truy cập nhau. Không tắt toàn bộ firewall.
Nếu máy có nhiều card mạng, chỉ rõ IP Wi-Fi:

```sh
.venv/bin/python benchmarks/draw_device.py --host 192.168.1.20
```

IP trên chỉ là ví dụ. Mặc định chỉ bind interface LAN được hệ điều hành chọn;
cổng do hệ điều hành cấp. Cổng 8000 bị chặn để tránh đụng máy chủ triển lãm.
Kho tạm được tạo trước khi import ứng dụng, dùng persistence thật và PIN quản lý
ngẫu nhiên riêng. Không đọc/ghi `backend/storage`, không sửa cấu hình máy chủ đang chạy.
LAN HTTP không mã hóa: chỉ sử dụng mạng tin cậy, hình test và PIN tạm.

**Kết thúc:** xuất tất cả JSON trước, rồi `Ctrl+C` trên Mac.
Máy chủ dừng và xóa hình, vector, metadata trong **kho tạm của phiên đó**.
SIGTERM cũng được kiểm thử tự dọn. Mất điện/SIGKILL không thể bảo đảm cleanup;
chỉ dọn đường dẫn `Storage:` đã ghi nhận của đúng phiên, không xóa kho triển lãm.
Không thêm endpoint debug vào máy chủ production. Không chạy phiên LAN vô thời hạn.

## 2. Cách đo ngay trên thiết bị

1. Chạm `TEST · Đo Draw`, nhập model chính xác và phiên bản iPadOS/iOS.
2. Tick xác nhận vẽ thật trên Safari **chỉ khi đang dùng thiết bị thật**.
3. Chọn ca A–I, bấm **Bắt đầu ca mới**, rồi **Thu gọn** để vẽ tự nhiên.
4. Mở panel, ghi quan sát; chọn ca tiếp theo. Mỗi ca giữ riêng số đo/ghi chú.
5. **Tải JSON**, giữ file trong Files hoặc gửi về Mac; kiểm tra file mở được.
6. Nếu Safari không tải được: **Copy JSON**. LAN HTTP có thể không hỗ trợ clipboard;
   khi đó vùng JSON hiện ra, nhấn giữ/chọn tất cả rồi Sao chép thủ công.

Xuất trước reload/đóng tab: số đo chỉ ở bộ nhớ trang; bản nháp vẫn theo cơ chế cũ.
Không mở cùng origin trên nhiều tab để tránh cùng sửa một bản nháp.
Một phiên tối đa 50 ca lưu trữ + ca hiện tại. Xuất rồi mở phiên mới nếu cần.
Đóng panel trong lúc đo; mở panel/copy/tải có thể tự tạo công việc main-thread.

### Ma trận tối thiểu

| Thiết bị | Hướng | Đầu vào | Ca |
|---|---|---|---|
| iPad của ban tổ chức, ưu tiên | Dọc | Ngón tay | A–I + mạng |
| Cùng iPad | Ngang | Ngón tay | A–I + mạng |
| iPad nếu thực tế có Pencil | Dọc/ngang | Apple Pencil | B, D, E, F, H |
| iPhone, thứ cấp | Dọc | Ngón tay | A–I + mạng |
| Cùng iPhone | Ngang | Ngón tay | A, B, E, F, H và kiểm tra bố cục |

Model/OS phải ghi tay; UA không đủ xác định model. Ghi orientation thành các ca riêng.
Không thay ngón tay bằng PointerEvents giả; Pencil chỉ thêm nếu khách thực sự dùng.

### A–I: động tác người thật

| Ca | Thực hiện | Quan sát chính |
|---|---|---|
| A | 1–3 nét ngắn; thêm chấm, góc rẽ | Theo ngón tay, đầu/cuối nét |
| B | 10–20 nét như khách bình thường | Độ mượt, nút dễ bấm |
| C | 50+ nét thực tế, không loop hàng nghìn nét | Kết thúc nét, lưu nháp, lặp lâu |
| D | Nét dài liên tục quanh phần lớn canvas | Lag khi vẽ nhanh/đổi hướng |
| E | Tẩy vài lần trên hình đã có | Nét tẩy, pause khi nhấc tay |
| F | Hoàn tác vài lần; thử làm lại | Đúng hình trước đó, thời gian phản hồi |
| G | Gửi hình có nét, quan sát canvas làm sạch | `clear_after_submit` + khả năng vẽ tiếp |
| H | Gửi hình đại diện | Chuẩn bị cục bộ, mạng, phản hồi thành công |
| I | Vẽ → gửi thành công → vẽ tiếp vài lượt | Không suy giảm, không lẫn nét/lần gửi |

**G — giới hạn hiện tại:** Draw không có nút Xóa thủ công. Report đánh dấu
`manualClear: NOT_AVAILABLE`; chỉ đo làm sạch sau gửi thành công.
Không thêm nút hoặc xóa localStorage để giả làm một phép đo Clear.
Kiểm tra chấm/nét cực ngắn, rẽ đột ngột, nhấc tay/vẽ tiếp trong A/B.

## 3. Mạng và khôi phục bản nháp

1. Mạng bình thường: gửi một hình, xác nhận thông báo thành công, canvas trống,
   nút Khắc không thể gửi lại hình trống. Nếu bấm nhanh hai lần, chỉ có một hình.
2. Vẽ hình khác. Tắt Wi-Fi hoặc ngắt mạng trong/quanh lúc gửi; không tắt server.
   Ghi thao tác và thời điểm, chờ phản hồi lỗi/timeout theo ứng dụng hiện tại.
   Hình phải còn, nút hết trạng thái đang gửi, thông báo lỗi hiểu được.
3. Xuất JSON **trước reload**, rồi reload khi mạng đã phục hồi để kiểm tra bản nháp.
   Số đo sau reload là phiên báo cáo mới. Không sửa nét trước khi thử lại,
   vì một chỉnh sửa hợp lệ sẽ tạo mã lần gửi mới theo thiết kế.
4. Bật lại Wi-Fi, thử gửi lại. `network` trong JSON phải giữ cùng `submissionId`
   giữa các lần gửi không thay hình; thành công ghi `drawingId`/`replayed` nếu API có.
   Không có vector/ảnh người dùng trong JSON đo.
5. Với trường hợp server đã nhận nhưng thiết bị mất phản hồi, kiểm tra trong
   Control **của cổng tạm**, dùng PIN in ra: cùng lần gửi chỉ lưu một hình.
   Không dùng Control cổng 8000. Mất mạng trước khi server nhận chưa chứng minh
   tình huống mất phản hồi sau commit; đánh dấu tình huống nào thực sự đã xảy ra.

`online` chỉ là tín hiệu trình duyệt, không bảo đảm server truy cập được.
`submit_request` gồm fetch + đọc/parse phản hồi, không phải thuần thời gian truyền dây.
`submit_local_preparation` không chờ mạng. Đừng kết luận canvas chậm từ request lâu.

## 4. Đọc số đo đúng cách

- Đơn vị ms; `count`, `total`, `median`, `p95`, `max`, `sampled`, `truncated` cho từng metric.
- `pointermove`: đúng handler đồng bộ khi pointer được canvas capture, không tính hover.
- `render_active`: xử lý vẽ nét đang hoạt động; `pointer_up_completion` gồm finish đồng bộ.
- `canvas_readback` và `alpha_check` tách riêng; `changed` bao gồm hai bước đó + draft/UI.
- `draft`, `ui`, `undo`, `redo`, `eraser_finish`, `clear_after_submit` đo nguyên tác vụ.
- `submit_payload_transform`, `submit_payload_json`, `submit_local_preparation`,
  `submit_request`, `submit_to_result_ui`, `submit_to_success_ui` phân biệt chuẩn bị/kết quả.
- Một số phép đo lồng nhau: **không cộng tất cả metric thành thời gian tổng**.
- rAF chỉ đo lúc vẽ và một frame sau finish; tab ẩn không trộn khoảng nghỉ vào rAF.
  `pointer_up_to_next_raf` là chờ lịch rAF, không đo thời điểm pixel xuất hiện trên LED/GPU.
- `frameGaps`: số mẫu >50ms và >1.5×median trong mẫu được giữ. Không gọi chúng là
  “dropped frames” thực tế. ~16.7ms ở 60Hz chỉ là tham chiếu; thiết bị có thể chạy tần số khác.
- Long Tasks feature-detect. Khi không hỗ trợ: `available:false`, `timing:null`;
  không suy ra “0 long tasks”. Khi hỗ trợ, có thể gồm cả công việc ngoài Draw.
- Mỗi metric giữ 4096 mẫu đầu; count/total/max vẫn tính toàn ca.
  Quantile/gap trên ca bị truncate không đại diện toàn bộ ca. Xuất/tách ca thay vì bỏ qua nhãn.
  Danh sách nét tối đa 500/ca, events tối đa 200/ca, network tối đa 200/phiên.
- Trường `trusted:false` là dấu hiệu input tự động; `trusted:true` cũng không tự chứng minh
  đúng model/Safari/người thật. Cần thông tin thiết bị và xác nhận thao tác thực tế.
- Bộ đo có overhead. Sau đo, cùng thiết bị thử `/draw/` **không có `perf=1`** để so trải nghiệm.
  Draw bình thường và bản đo dùng chung draft/preferences trong origin của kho thử.

Safari Web Inspector từ Mac là bổ sung nếu sẵn có, không bắt buộc và không đổi code lúc đo.

## 5. Mẫu báo cáo — điền từ JSON + quan sát người thật

Lặp bảng này riêng cho iPad và iPhone; tách dọc/ngang/Pencil nếu có.
Không điền số Chrome vào ô thiết bị thật.

| Mục | Kết quả ban đầu |
|---|---|
| Device: model / OS / Safari | CHƯA ĐO |
| Orientation / DPR / viewport / backing canvas | CHƯA ĐO |
| Phiên, URL kho tạm, file JSON, ca/đầu vào | CHƯA ĐO |
| Pointermove count/total/median/p95/max | CHƯA ĐO |
| rAF median/p95/max; gaps; truncated? | CHƯA ĐO |
| D: nét liên tục; lag quan sát | CHƯA ĐO |
| Pointer-up median/p95/max; pause nhìn thấy | CHƯA ĐO |
| Canvas readback; alpha; changed; draft/UI | CHƯA ĐO |
| Undo/redo; tẩy; làm sạch sau gửi | CHƯA ĐO — Clear thủ công chưa có |
| Submit: chuẩn bị / request / success UI | CHƯA ĐO |
| Mạng: lỗi / retry / ID / một bản duy nhất / khôi phục nháp | CHƯA ĐO |
| UX: theo ngón tay, cuộn/zoom, nút, bàn phím RGB | CHƯA QUAN SÁT |
| UX: xoay máy, safe area, chạm nhầm, phản hồi | CHƯA QUAN SÁT |
| So trải nghiệm khi tắt bộ đo | CHƯA QUAN SÁT |

### Kết luận tổng hợp

1. iPad: **NEEDS_MORE_DEVICE_EVIDENCE** cho đến khi có dữ liệu thật.
2. iPhone: **NEEDS_MORE_DEVICE_EVIDENCE** cho đến khi có dữ liệu thật.
3. Nút thắt riêng từng thiết bị: chưa xác nhận.
4. Nút thắt chung: chưa xác nhận.
5. Vấn đề riêng mạng: chưa xác nhận; ghi local vs request trước kết luận.
6. Thay đổi production khuyến nghị: chưa có cơ sở đề xuất.
7. Không nên làm: đổi smoothing/pressure/eraser, bỏ readback, hạ DPR,
   sửa ID/retry hoặc redesign chỉ từ số Chrome/DPR giả.
8. Đã đủ cơ sở tối ưu Draw? **Chưa**. Cần tái hiện vấn đề trên iPad ưu tiên,
   liên kết metric, tần suất và ảnh hưởng nhìn thấy được.
9. Ưu tiên redesign: chỉ xếp hạng sau quan sát thiết bị; thiếu Clear là giới hạn
   tính năng hiện tại, chưa phải kết luận UX thiết bị thật.

Phân loại từng finding bằng một trong:
`NO_SIGNIFICANT_ISSUE`, `MINOR_UX_ISSUE`, `OPTIMIZATION_CANDIDATE`,
`CONFIRMED_DEVICE_BOTTLENECK`, `NETWORK_ISSUE`, `NEEDS_MORE_DEVICE_EVIDENCE`.
Ghi ca tái hiện, metric, quan sát, độ tin cậy và bước kiểm tra lại.
Dừng ở báo cáo. Không tự động bắt đầu tối ưu hoặc thiết kế lại.

## Kiểm tra bộ đo (không phải đo thiết bị)

```sh
npm run test:core
PLAYWRIGHT_CHANNEL=chrome node --test tests/browser/device-audit.cjs
PLAYWRIGHT_CHANNEL=chrome npm test
node --check benchmarks/device-audit.js
.venv/bin/python -m py_compile benchmarks/draw_device.py tests/test_device_audit.py
git diff --check
```

Các test kiểm tra opt-in/response gốc, endpoint không xuất hiện ở production,
fail-fast khi source đổi, raster+draft+pressure+eraser+undo tương đương,
payload đúng, giữ draft/ID qua lỗi→retry, export, Long Tasks không hỗ trợ,
fallback copy LAN và cleanup kho tạm. Không thêm dependency.
