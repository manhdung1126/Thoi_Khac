# Regression baseline

Mục tiêu: bảo vệ hành vi đã chốt trước khi dọn code, không tối đa hóa coverage.
Không refactor hoặc xóa mã ứng dụng trong đợt thiết lập baseline này.

## Hệ thống hiện có

| Thành phần | Đã xác minh trong repo |
| --- | --- |
| Ngôn ngữ | Python backend; JavaScript ES modules, HTML/CSS frontend |
| Framework | FastAPI/Uvicorn, Pillow; frontend thuần, không React/Vue/bundler |
| Package manager | pip trong `.venv`, `backend/requirements.txt`; npm và `package-lock.json` cho test browser |
| Test framework | Python `unittest` + FastAPI TestClient; Node `node:test`; Playwright điều khiển Chromium/Chrome trong Node Test Runner |
| Cấu hình test | `package.json`, `tests/run_regression.py`; fixture/hooks nằm trong các file test; không có pytest/Playwright config riêng |
| Lint / type checker | Chưa có cấu hình hoặc task ESLint/Ruff/mypy/tsc |
| Production build | Chưa có task `build`; frontend được phục vụ trực tiếp, không cần bundle |
| CI/CD | Không tìm thấy workflow hoặc pipeline test trong repo |

Không có `pyproject.toml`, `pom.xml`, `build.gradle`, `Cargo.toml` hay `Makefile`.

## Chạy

Cần môi trường Python hiện có (`.venv`, `backend/requirements.txt`) và Node.js.
Playwright được khóa phiên bản trong `package-lock.json`, yêu cầu Node.js >= 20.
Playwright chỉ là dependency phát triển cho kiểm thử, không được tải vào web.

```sh
npm ci
npx playwright install chromium
npm test
```

Nếu máy đã có Google Chrome, không cần tải Chromium riêng:

```sh
PLAYWRIGHT_CHANNEL=chrome npm test
```

Chạy riêng các lớp:

```sh
npm run test:unit
npm run test:core
PLAYWRIGHT_CHANNEL=chrome npm run test:smoke
```

Để xác minh theo thứ tự unit/integration → lint → type check → build → E2E:

```sh
npm run test:core
npm run lint
npm run typecheck
npm run build
PLAYWRIGHT_CHANNEL=chrome npm run test:smoke
```

Ba lệnh giữa hiện báo `Missing script`, không phải kiểm tra thành công.
`test:core` cách ly storage giống `npm test`; không chạy discovery Python trực tiếp
với kho triển lãm vì module mặc định có thể mở storage ngay lúc import.

`npm test` chạy theo thứ tự: unit JavaScript → integration Python → smoke browser.
Runner đặt `CLOUD_STORAGE_DIR` vào thư mục tạm **trước khi import app**, kể cả
instance mặc định được tạo khi import. Các fixture API có kho tạm riêng.
Smoke tự mở server không-reload trên cổng động, PIN test riêng, rồi đóng server và
xóa đúng thư mục tạm của nó. Không cần dừng server triển lãm ở cổng 8000.
Không có skip ngầm nếu thiếu trình duyệt hoặc dependency: lệnh phải báo lỗi.

## Các luồng quan trọng và lớp bảo vệ

| Luồng | Kiểm thử hiện có được giữ | Bổ sung baseline |
| --- | --- | --- |
| Draw: Mono, 5 độ rộng, tọa độ, pressure/velocity, undo/draft | `test_monoline.cjs`, `test_graphite.cjs`, `test_draw_submission.cjs` | Tọa độ độc lập CSS/DPR, giới hạn giấy; browser vẽ thật, chọn nét, undo/redo, reload |
| Submit → SVG/vector → Display | `test_drawings.py`, `test_led.py`, `test_draw_submission.cjs` | Gửi lỗi giữ bản nháp, retry thành công mới xóa; WS thật; 6 retry đồng thời chỉ tạo 1 tác phẩm/queue entry |
| 27 ô, lấp đầy trước khi luân phiên, timer riêng | `test_led.py`, `test_led.cjs` | Giữ nguyên các test xác định được, không kiểm tra random bằng snapshot |
| Quyền quản trị/PIN | Một số API test đăng nhập hiện có | 18 mutation endpoint từ chối thiếu/sai token không đổi state; rate limit và hết hạn; token cũ vô hiệu sau restart |
| Control chọn trang khác mà không gián đoạn live | `test_drawings.py`, `test_frontend.cjs` | Browser tạo/đổi tên, thêm hình off-air, lưu/chiếu khoảnh khắc, xóa trang off-air không đổi live |
| Yêu thích/khoảnh khắc/trash | `test_drawings.py` | Browser tải SVG yêu thích giống bản gốc; khoảnh khắc lưu đúng hình đang hiện; layout không hợp lệ không để file mồ côi; restart giữ trang/settings/queue/asset, bản yêu thích của hình đã purge, phục hồi trash và chiếu lại khoảnh khắc |
| Display metallic/fullscreen | Geometry/material tests | Browser vào/thoát fullscreen bằng F; RGB thay đổi theo thời gian, alpha không đổi |
| Ending prepare/ready/start/reset, mask/motion | `test_ending.py`, `test_ending.cjs` | Browser tải SVG đích từ Control, prepare, đợi Display thật ready, start thấy nét trên canvas, reset giữ hình/queue/trang normal |
| Reconnect | WS broadcast API test | Restart tiến trình server test thật cùng storage/cổng; Display offline khi có nét mới, tự bắt kịp và nhận tiếp WS, không reload trang |
| Routing/cache/module tải được | API cache-header test | Trang chủ → Draw/Control, Display tải thực, thu thập `pageerror` |

### Bổ sung kiểm tra các khoảng trống

- Cảm ứng Chrome mô phỏng 390 × 844, DPR 3: hai ngón tay, pointer cancel, nét
  tiếp theo/dấu chấm, chặn cuộn, SVG export giữ tọa độ/độ rộng và xóa sau gửi.
- SVG Ending chứa script, event handler hoặc ảnh ngoài bị từ chối trước khi thực thi/tải.
- Hai Display với 60 lượt gửi qua 6 client đồng thời, 4 chu kỳ carousel thật;
  không quá 54 layer cho 27 ô. Đo JS heap sau GC với trần tăng ngắn hạn 8 MiB.
  Đây là phát hiện hồi quy lớn, không phải chứng minh không có memory leak;
  không đo GPU memory và không đại diện nhiều giờ vận hành.
- Offline thực 120 giây, rồi thêm hai vòng offline/reconnect; giữ nguyên trang và
  không reload, bắt kịp state và nhận hình mới.
- Hai Display chạy Ending đủ 20 giây; SIGKILL server test ở giữa phiên rồi mở lại
  cùng storage/cổng; giữ `start_time`, nhận completion event, so sánh pixel cuối
  giữa hai màn và độ ổn định sau khi LOCKED; reset không reload.
- 60 submission khác nhau qua 8 thread API không mất/trùng hình, queue cân bằng.
- Lỗi ENOSPC/EACCES được chèn vào ranh giới filesystem, không cần làm đầy ổ máy:
  state cũ được bảo toàn, kiểm tra rollback upload/khoảnh khắc.
- `state.json` hỏng phải từ chối startup, không được reset im lặng; phục hồi bằng
  bản backup đã biết. Artwork thiếu phải chặn Ending và hoạt động lại sau restore.

Các lỗi filesystem/corrupt fixture chỉ áp dụng lên thư mục tạm do test tạo.
Không thử phá hoặc chỉnh dữ liệu triển lãm, không đổi quyền thư mục thật.

Test mới ưu tiên API công khai, thao tác/nội dung truy cập được của UI và pixel
trong cùng một lần chạy. Digest canvas chỉ so sánh undo/reload trong cùng run,
không phải snapshot ảnh lưu cố định. Chỉ giả lập lỗi mạng cho một lần gửi và
đồng hồ cho rate limit; các server/API/WebSocket trong smoke là thật.

Một số test cũ kiểm tra chuỗi source hoặc nội bộ Store vẫn được giữ nguyên.
Chúng chưa được viết lại ở lượt này; smoke bổ sung bảo vệ hành vi quan sát được.

## Các gate ngoài test

Repo hiện không có cấu hình/task lint, type checking hoặc production bundling.
Không thêm task giả luôn-pass. Kiểm tra cú pháp JavaScript/Python và smoke server
không-reload là bằng chứng riêng, **không thay thế** lint/type checking/build.
Frontend vẫn được FastAPI phục vụ trực tiếp, không có artifact frontend cần build.
TestClient hiện phát cảnh báo deprecation từ dependency Starlette/httpx; baseline
vẫn chạy, chưa thay dependency backend trong phạm vi kiểm thử này.

## Chủ động chưa bao phủ

- Cảm giác bút/iOS Safari/Apple Pencil thật, LED P3 và màu vật lý.
- Nhiều giờ vận hành, hàng nghìn khách, GPU memory, nhiều màn hơn hai.
- Lỗi mạng/router/thời gian hệ thống trên môi trường triển lãm thực.
- Đĩa thật mất nguồn/hỏng, filesystem hoặc quyền hệ điều hành khác.
- Security audit đầy đủ, triển khai Internet và nhiều worker. Bản hiện tại dùng
  một process với state JSON; test không xác nhận an toàn khi chạy nhiều worker.

Checklist tại chỗ còn bắt buộc: thử ngón tay/bút trên iPhone/iPad, xoay màn hình,
ngắt Wi-Fi thật rồi nối lại; kiểm tra vàng/độ dày trên LED 1536 × 768 ở khoảng
cách xem thực; chạy hai màn xuyên buổi và theo dõi RAM/CPU, sao lưu trước thử lỗi.

Chạy baseline trước/sau từng thay đổi nhỏ; test pass không phải chứng nhận sẵn sàng
vận hành triển lãm. Suite mở rộng browser mất khoảng vài phút do offline/animation
chạy theo thời gian thật, không tăng tốc đồng hồ để lấy kết quả giả.

## Lỗi gặp khi bổ sung test

- Setup test: restore/activate cần body `{}`; request mới thiếu body trả 422. Đã sửa request test, không đổi API.
- Kỳ vọng test sai: reset Ending bù đồng hồ carousel, nên `shown_at` đổi có chủ ý.
  E2E kiểm tra hình/queue/bố cục thay vì đòi timestamp giống hệt.
- Configuration issue: lint/typecheck/build chưa có script. Không có dependency bị thiếu trong lần chạy này.
- Setup E2E: cờ offline của Chromium không bảo đảm đóng WebSocket đang mở. Test
  offline dài ngắt server tạm để bảo đảm transport thực sự mất rồi nối lại.
  Poll trạng thái API chạy ở Node và await HTTP đầy đủ; không dùng async predicate
  trong `waitForFunction`, vốn có thể trả về trước khi điều kiện là true.
- **Actual application bug, đã sửa:** upload trước đây giữ state cũ nhưng để lại
  SVG khi ghi vector lỗi, hoặc cả SVG/vector khi ghi state lỗi. Đã tái hiện test đỏ,
  sau đó thêm rollback ngay tại `Store.upload`, chỉ xóa hai đường dẫn UUID của lần
  gửi thất bại; không đổi API, submission ID hoặc luồng broadcast.
  `test_failed_upload_keeps_committed_state_and_leaves_no_partial_assets` kiểm tra
  lỗi quyền ghi SVG và đầy đĩa ở vector/state, giữ nguyên byte dữ liệu đã có,
  gửi lại thành công và replay không tăng revision hoặc tạo thêm file.
  Không xfail/skip hay bỏ assertion rollback. Nếu filesystem không cho phép xóa,
  cleanup chỉ có thể best-effort và vẫn giữ lỗi gốc; SIGKILL/mất nguồn giữa upload
  chưa được bảo đảm bởi rollback này. Không dọn các file mồ côi có sẵn trong kho thật.

## Báo cáo kiểm tra mở rộng (2026-10-06)

- Unit JavaScript: 41 PASS.
- Integration Python: 42 PASS sau bản sửa rollback upload.
- E2E mở rộng: 9/9 PASS sau bản sửa, trong một lượt khoảng 178 giây, gồm thời gian offline
  120 giây và Ending 20 giây thật, crash giữa phiên, hai màn có pixel cuối giống nhau.
- Heap ngắn hạn sau GC trong test hai Display: tăng khoảng 0,7 MiB mỗi renderer
  ở máy kiểm tra, dưới guard 8 MiB. Không suy rộng thành cam kết memory leak bằng 0.
- Production chỉ sửa rollback trong `Store.upload`; không sửa frontend, không refactor,
  cleanup hoặc cài dependency mới.
- Toàn bộ baseline: **92/92 PASS** với `PLAYWRIGHT_CHANNEL=chrome npm test`.
  Kiểm tra cú pháp Python và `git diff --check` PASS; server đang chạy trả health OK.
  Lint/type checking/build vẫn chưa được cấu hình, không tuyên bố các gate này PASS.

## Cleanup có kiểm chứng (2026-10-06)

Đã chạy `PLAYWRIGHT_CHANNEL=chrome npm test` sau từng pha; cả năm lượt đều
**92/92 PASS** (41 unit JS, 42 integration Python, 9 E2E). Không xóa, sửa kỳ vọng
hay bỏ qua test. Không đổi backend, route, auth, schema, submission hoặc giao diện.

| Pha | Thay đổi | Verification |
| --- | --- | --- |
| 1 — rủi ro thấp | Không thấy import thừa/debug/backup đủ bằng chứng; không xóa cưỡng ép | 92/92 PASS |
| 2 — dead code | Bỏ `simulateFlow`, alias `previewPhase`, `LEDScene.select`; bỏ import `motionPhase` chỉ phục vụ alias | 92/92 PASS |
| 3 — asset | Xóa `frontend/display/assets/led-dark-gold-demo.svg` | 92/92 PASS |
| 4 — dependency | FastAPI/Uvicorn, Pillow, Playwright đều cần; giữ manifest và lockfile | 92/92 PASS |
| 5 — duplication | Dùng chung `clamp`/`smooth` từ `flow.js`, giữ re-export qua `motion.js` | 92/92 PASS |

Trước khi xóa đã kiểm tra source, HTML/CSS, import động của test, tài liệu,
tooling, route tĩnh và callback. Không có consumer của các symbol đã bỏ hoặc
tham chiếu tới nền demo; nền thực lấy từ `LED.background`, chọn ô qua `Stage.selectCell`.

- **SAFE_TO_REMOVE:** ba symbol nội bộ nêu trên và nền demo cũ; đã xóa.
- **KEEP:** nền cuộn sớ/logo đang dùng, graphite cho dữ liệu cũ, sinh nét mẫu cho
  rehearsal, `__init__.py`, `run.py`, test runner, skills/config/lockfile và mọi storage.
- **LIKELY_UNUSED:** `ENDING_MOTION.textAt`; giữ vì là trường cấu hình xuất ra,
  không thay hợp đồng cấu hình trong lượt cleanup này.
- **UNKNOWN:** nhu cầu truy cập ngoài module đối với `LEDScene.grid` và
  `EndingPreview.artworks`; giữ các thuộc tính này.

Không gộp `Draw.request` với `api`: nội dung lỗi, auth và kiểm tra response khác nhau.
Không gộp thuật toán JS/Python: hai runtime cần giữ khả năng đọc dữ liệu và xuất SVG.
Giảm ròng **45 dòng mã/asset**, chưa tính phần tài liệu này; 1 asset xóa có thể khôi
phục từ Git. Không xóa tác phẩm, bản nháp, file backup dữ liệu hoặc cache môi trường.
`npm ls --depth=0`, `pip check`, cú pháp 30 file JS/11 file Python và diff check PASS.
Lint/type check/production build vẫn **NOT CONFIGURED**, không phải các gate PASS.
