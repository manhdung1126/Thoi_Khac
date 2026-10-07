# Control UI1–UI6

## Phase 0: incumbent surface and preservation boundary

Vanilla JS/CSS. Control has a selected-page picker/rename/delete/project/new toolbar, local LED preview, live pause and cycle setting, selected-cell queue, library, Ending upload/rehearsal/prepare/start/reset, and saved moments. The original live/preview distinction is only in the preview heading/footer and a dot in the page picker. Library cards mount every filtered drawing, with stacked actions and an extra download row on favorites. The library is sticky on desktop, moves after the selected cell on mobile, and uses 2/3 columns at 820/480px. Search matches trimmed, case-insensitive ID substrings; current filter means **active artwork on the selected preview page**, not all queued artwork and not the live page.

Keep existing IDs, accessible form labels, native controls, action routes, sorting, authentication and card reuse. `selectedPageId`/`selectedCell` are local; only explicit projection activates the server's live page. Mutations never apply partial responses; HTTP subscription owns authoritative state. Its `refresh()` returns null on failure, which currently produces misleading success copy. Ending's Control entry may be clarified, but timing/session/rendering are untouched.

Design read: an exhibition operations desk, cream paper and restrained teal/ochre, compact status and task hierarchy, no ornamental motion. Preserve the existing brand and sans font; variance 3, motion 1, density 6. Taste's landing-page templates/dependency defaults are not appropriate here; Operate-mode native controls and existing assets take priority.

## Verification ledger

Baseline: 50 JavaScript units + 106 Python integrations + 17 browser tests = 173. Measurements use the existing temporary-storage harness and ephemeral servers, never exhibition data. Before measurement: `/tmp/control-ui-before.log`.

UI1: **173/173 PASS**, no skips/failures. `/tmp/control-ui1-tests.log`. All frontend JS and Python syntax, `git diff --check`: PASS. Temporary test server health 200. Live strip always reads server `current_page_id`; selected-page status and cell label read local preview context. Existing projection and deletion fallback tests now explicitly assert the new labels.

Before-pagination operation baseline (UI1 labels already applied, otherwise incumbent rendering): `/tmp/control-ui-before-pagination.log`, 8 samples per operation.

| Drawings | Mounted / document elements | HTTP library median | Search median / max | Folder median / max | Active filter median / max | Cell median | Search long tasks / max | Search rAF p95 / max |
|---|---|---|---|---|---|---|---|---|
| 27 | 27 / 485 | 0.20 ms | 0.15 / 0.30 ms | 0.20 / 0.30 ms | 0.15 / 0.40 ms | 0.20 ms | 0 | 16.8 / 16.8 ms |
| 250 | 250 / 2,127 | 0.50 ms | 1.30 / 1.90 ms | 1.25 / 2.10 ms | 1.85 / 2.10 ms | 0.90 ms | 0 | 16.7 / 16.7 ms |
| 1,500 | 1,500 / 11,219 | 2.40 ms | 21.25 / 47.50 ms | 23.30 / 51.10 ms | 27.40 / 33.70 ms | 5.05 ms | 4 / 82 ms | 83.2 / 83.3 ms |

The untouched pre-UI1 run independently recorded 480 / 2,122 / 11,214 elements and stress search 24.30 / 53.30 ms, 4 long tasks (max 88 ms). Pager has no incumbent equivalent. All timing comparisons are opt-in measurements, not pass/fail timing tests.

UI2: **174/174 PASS** (50 JS, 106 Python, 18 browser), no skips/failures, `/tmp/control-ui2-tests.log`. Syntax/diff checks PASS. New browser coverage uses actual submissions and API mutations, global sorted results, a second artwork page, current-preview active filtering, upper-case/trimmed search outside page one, favorite/download/archive/restore, and clear/reset. Pagination mounts at most 72 cards. Filtering and sorting still precede slicing; count remains global. Cache remains at most one reusable card per authoritative drawing, pruned on metadata removal; it creates cards lazily as visited. No new cache, backend pagination, debounce or virtualizer.

UI2 comparable plain benchmark: `/tmp/control-ui2-plain.log` (same fixture IDs as baseline). 27/250/1,500 mounted cards = 27/72/72; document elements = 490/886/1,228. HTTP library medians = 0.10/0.30/0.60 ms; search = 0.20/0.40/0.70 ms; folder = 0.30/0.45/0.80 ms; active filter = 0.20/0.45/1.05 ms; selected cell = 0.20/0.30/0.50 ms. Pager is a no-op at 27, then 0.90/3.15 ms median (max 2.60/5.20 ms). No long tasks in any measured operation. Search rAF p95/max stays ~16.8 ms. Six-shape ID-search verification separately passed at all three sizes (`/tmp/control-ui2-benchmark.log`); this uses different fixture IDs and is not mixed into the plain before/after comparison. Thus 72 is retained: bounded mount cost, sub-millisecond typical reconciliation/search, no material small/normal latency regression.

UI3: **174/174 PASS**, no skips/failures, `/tmp/control-ui3-tests.log`. Syntax/diff checks PASS. Favorite remains a visible heart with accessible pressed state; primary Add/Move uses a short visible label with the existing descriptive accessible name. Secondary archive/purge/download actions use native auto popovers (top layer, Escape, outside dismissal, native Tab). Favorite download no longer adds a card row. Metadata reserves two readable state lines, not a blank 46px download row. Native menu opener is not a mutation and remains usable for existing public downloads when logged out; cached/admin mutation controls stay disabled, covered by the existing logout regression assertion scoped to those controls.

UI4: **175/175 PASS** (19 browser), no skips/failures, `/tmp/control-ui4-tests.log`. Syntax/diff checks PASS. Full folder counts exclude archived artwork from All/Favorites as before. Visible search label/helper, explicit active-on-selected-page filter, scoped receiving page/cell context, reset button with native input focus, useful empty/loading text. Added regression covers last-page → active filter clamp, global substring count/order, clear returning page one, focus and folder totals. Counts never mean merely mounted cards.

UI4 benchmark: `/tmp/control-ui4-benchmark.log`. 27/250/1,500 mounted cards = 27/72/72; document elements = 712/1,468/1,810 after the richer card/menu semantics. HTTP library medians = 0.10/0.30/0.60 ms; search = 0.30/0.60/0.80 ms; folder = 0.30/0.50/0.95 ms; active filter = 0.20/0.60/1.30 ms; cell = 0.20/0.35/0.60 ms. Pager is a no-op at 27, then 1.10/5.55 ms median (max 10.50/8.80 ms). Every measured operation has zero long tasks; search rAF p95/max remains 16.7–16.8 ms. Synchronous render times are not end-to-end paint latency; occasional automation/network wall-time tails are retained in the raw output, not hidden.

UI5: **176/176 PASS** (50 JS, 106 Python, 20 browser), no skips/failures, `/tmp/control-ui5-tests.log`. All frontend JS/Python syntax and diff checks PASS. Mutation response still is not authoritative UI state. A null refresh keeps the last view, displays “Đã lưu trên máy chủ nhưng giao diện chưa đồng bộ.” and a persistent refresh-only recovery banner. Rename dialog explains how to close and refresh without resaving. Snapshot uses the same messaging boundary. Browser proof covers both rename and snapshot success + failed refresh + successful recovery with exactly one mutation and no extra revision. Reconnect copy is calm; successful HTTP reconciliation clears stale feedback. Ending receives a Prepare → Ready → Start status guide and local-rehearsal clarification only; no session/motion/asset/backend change.

UI6: **177/177 PASS** (50 JS, 106 Python, 21 browser), no skips/failures, `/tmp/control-ui6-tests.log`, process exit 0. Native keyboard/popover/skip-link, equal-height favorite cards, long selected-page name, 320/375/768/1024/1440px and 667×375 landscape checks pass. Final full JS/Python syntax and diff checks PASS. Final benchmark `/tmp/control-ui6-final-benchmark.log`: all three isolated server health checks 200, no browser errors, library capped at 72 cards throughout all recorded operations. Desktop/phone review and one confirmation pass completed. Temporary confirmation captures: `/tmp/cos-control-final.vI6ROY/` (desktop, phone, library and Ending).

## Báo cáo cuối — 24 mục

### 1. Vấn đề UX ban đầu

Trang đang sửa và trang đang phát chỉ được phân biệt bằng dấu chấm trong danh sách và một dòng ở preview. Kho ảnh gắn toàn bộ kết quả vào DOM; 1.500 hình làm tìm kiếm/đổi thư mục tốn nhiều thời gian dựng trang. Thẻ yêu thích thêm hàng tải SVG khiến chiều cao lệch. Thông báo thành công vẫn xuất hiện khi máy chủ lưu xong nhưng tải lại dữ liệu thất bại.

### 2. Cấu trúc thông tin mới

Đang chiếu → Trang đang chỉnh + preview → Ô đang chọn → Kho nét vẽ → Dấu Ấn → Khoảnh khắc. Desktop đặt kho bên phải; mobile đưa kho sau phần chọn ô. Thứ tự DOM trên mobile khớp thứ tự đọc và bàn phím, không đảo bằng CSS `order`.

### 3. Đang chiếu khác đang chỉnh

Thanh live luôn lấy tên từ `current_page_id` của HTTP server. Trang chọn để sửa là trạng thái local, có nhãn “Ngoài màn chiếu” khi khác trang live. Chỉ nút Chiếu trang kích hoạt trang trên LED. Đổi tên, xóa trang ngoài màn chiếu, chọn ô và tải lại dữ liệu không tự chiếu trang đang chọn; các regression cũ vẫn bảo vệ hợp đồng này.

### 4. Kho nét vẽ

Kho nhận đầy đủ dữ liệu như trước, giữ tái sử dụng thẻ PERF-B1, chỉ gắn một trang kết quả vào DOM. Thẻ được tạo khi cần; metadata bị xóa thì cache tương ứng được loại. Không thêm cache mới, thư viện, API phân trang hoặc virtualization.

### 5. Hành vi phân trang

Lọc thư mục + mã hình + hình đang hiện → sắp xếp toàn bộ kết quả → cắt trang → render. Trước/Tiếp và chỉ báo trang giữ số nút cố định. Tìm kiếm, đổi thư mục hoặc checkbox về trang đầu; cập nhật dữ liệu kẹp trang vào phạm vi hợp lệ. Trang rỗng là 1/1, hai nút bị khóa. Thao tác trên trang sau vẫn dùng đúng hình và trang/ô đang chọn.

### 6. Vì sao 72 thẻ/trang

Nằm trong khoảng 60–100 yêu cầu, dùng được với lưới tự thích nghi và giữ chi phí render thấp trong cả ba mức dữ liệu. Đo UI2 rồi UI4 và UI6 đều xác nhận tối đa 72 thẻ, không có long task trong các thao tác kho được đo. Không chọn kích thước chỉ theo vẻ ngoài và không trì hoãn tìm kiếm bằng debounce.

### 7. Ngữ nghĩa tìm kiếm/lọc

Giữ nguyên substring của ID, trim khoảng trắng, không phân biệt hoa/thường; kết quả mới nhất trước theo `created_at`. Số kết quả là toàn bộ kết quả sau lọc, không phải số thẻ đang gắn. “Hình đang hiện trong trang đang chỉnh” là `active` của tất cả ô trên trang preview được chọn — không phải riêng ô đang chọn và không phải trang live. Bỏ lọc xóa query/checkbox nhưng giữ thư mục; focus về ô tìm kiếm. Counter thư mục là tổng thư mục trước query.

### 8. Thiết kế thẻ

Ảnh → ID/vị trí/trạng thái đang hiện → Thêm/Chuyển + ⋯. Heart luôn thấy. Tải SVG và cất/xóa vĩnh viễn trong popover native. Favorite không thêm một hàng trống 46px cho mọi thẻ; metadata chỉ dành hai dòng trạng thái. Nút chính vẫn thấy và accessible name vẫn mô tả đủ ô đích.

### 9. Yêu thích/thùng rác

Heart có nhãn và `aria-pressed`; yêu thích có link tải SVG như trước. Cất đi vẫn xác nhận phạm vi tất cả trang; thùng rác vẫn Khôi phục/Xóa vĩnh viễn. Không thay API, quyền hay callback. Logout vẫn khóa mutation của thẻ được tái sử dụng; mở menu và link tải public không bị coi nhầm là mutation.

### 10. Lưu thành công nhưng chưa đồng bộ

Hiện đúng “Đã lưu trên máy chủ nhưng giao diện chưa đồng bộ.”, banner tồn tại đến khi HTTP state cập nhật thành công. Đồng bộ lại chỉ tải state, không gửi lại mutation. Rename đang mở có hướng dẫn Hủy rồi đồng bộ thay vì lưu lần nữa. Test chứng minh rename và snapshot chỉ gửi một lần; revision không tăng thêm do retry.

### 11. Responsive

Hai cột desktop, một cột ở ≤820px; kho lưới auto-fit tối thiểu 130px thay vì số cột cố định. Thư viện không sticky khi desktop thấp ≤650px. Tên trang dài, trạng thái và hàng ô được wrap. Ô nhập/select mobile 16px; navigation/summary/nút thao tác có vùng bấm tối thiểu 44px. Test không có cuộn ngang tại các viewport nêu ở UI6; ảnh thực tế desktop 1536×900 và phone 375×812 đã được xem.

### 12. Accessibility và rà thiết kế

Giữ button/link/input/select/checkbox thật. Native Tab, Space mở popover, Tab đến Cất đi/Tải SVG, Escape trả focus về nút mở; skip-link tập trung section điều khiển. Giữ focus-visible 3px, labels cho icon, aria-pressed, trạng thái/count polite. Ô LED thu nhỏ có select thay thế dễ thao tác; không tuyên bố mỗi ô preview thu nhỏ đạt 44px.

Taste giúp giữ phân cấp và concept, tránh dashboard trang trí; UI/UX Pro hướng dẫn focus/target/reflow; Impeccable dùng một lượt detector, một lượt xem ảnh và một lượt xác nhận. Sửa chữ phụ 9→11px và tương phản đường viền input. Hai cảnh báo detector được giữ có chủ đích: nền kem là concept triển lãm do người dùng chốt; ảnh Ending thumbnail chưa có src được ẩn đến khi nhận ảnh thật, không phải ảnh hỏng hiển thị. Chữ thường đo ≥4.5:1 trên các nền dùng tương ứng; disabled control không được dùng để tuyên bố mức tương phản tương tác. Không tuyên bố chứng nhận WCAG hoặc đã kiểm tra screen reader/Safari/Firefox/thiết bị LED thật.

### 13. File thay đổi

- `frontend/control/index.html`: hierarchy, pager, banner, hướng dẫn, thứ tự DOM.
- `frontend/control/style.css`: layout, card/menu, trạng thái, responsive/focus/contrast.
- `frontend/control/app.js`: phân trang, folder/count, menu native, cảnh báo/retry read-only.
- `frontend/control/ending.js`: bảy dòng chỉ cập nhật trạng thái/hướng dẫn Control.
- `tests/browser/smoke.cjs`: regression UI mới và selectors thao tác menu.
- `benchmarks/browser.mjs`, `benchmarks/performance.py`: thêm phép đo folder/filter/pager, số thẻ/DOM và capture tùy chọn trong harness hiện có.
- `benchmarks/README.md`: cách đo/capture; `benchmarks/control-redesign.md`: báo cáo này.

Không sửa backend, Draw, Display renderer, shared API, Store/schema/auth, timing/carousel hoặc Ending renderer/session. Các thay đổi PERF-B1 và benchmark đã có trong dirty tree được bảo toàn; không stage/commit hoặc xóa chúng.

### 14. Test thêm

Bốn browser test mới: (a) global sorted pagination + actions trang sau + favorite/download/archive/restore; (b) filter/clamp/clear/focus; (c) snapshot lưu được nhưng refresh fail/retry không tạo bản thứ hai; (d) keyboard/menu/skip-link, equal-height favorite, viewport/touch targets và tên trang dài. Tăng assertions test live/selected có sẵn; cập nhật test rename-refresh-failure để kiểm tra cảnh báo và retry không mutation. Chỉ đổi locator archive để mở menu mới, giữ regression intent.

### 15. Kết quả toàn suite mỗi batch

| Batch | JS | Python | E2E | Tổng | Kết quả |
|---|---:|---:|---:|---:|---|
| Baseline/UI1 | 50 | 106 | 17 | 173 | PASS |
| UI2 | 50 | 106 | 18 | 174 | PASS |
| UI3 | 50 | 106 | 18 | 174 | PASS |
| UI4 | 50 | 106 | 19 | 175 | PASS |
| UI5 | 50 | 106 | 20 | 176 | PASS |
| UI6 | 50 | 106 | 21 | 177 | PASS |

Không bỏ test hay nới timing; offline 120 giây, reconnect nhiều lần, Ending 20 giây với hai Display và SIGKILL/restart vẫn được chạy thật. Syntax JS/Python PASS. Lint/type checking/production-build không được cấu hình trong repo vanilla này; không thêm toolchain ngoài phạm vi.

### 16. Benchmark 27 hình

| Render kho đồng bộ, ms | Trước median/max | UI6 median/max |
|---|---:|---:|
| HTTP refresh | 0.20 / 0.20 | 0.20 / 0.30 |
| Tìm kiếm | 0.15 / 0.30 | 0.25 / 0.30 |
| Thư mục | 0.20 / 0.30 | 0.30 / 0.50 |
| Filter đang hiện | 0.15 / 0.40 | 0.20 / 0.40 |
| Chọn ô | 0.20 / 0.30 | 0.10 / 0.20 |
| Pager | Không có | No-op, chỉ 1 trang |

HTTP wall median 96.60→96.11ms; search wall 30.49→29.60ms. Các chênh lệch render dưới 0.2ms, cùng zero long tasks; không thấy hồi quy vận hành đáng kể ở fixture nhỏ. DOM có thêm controls/semantics nên tăng, không che giấu bằng chỉ số card.

### 17. Benchmark 250 hình

| Render kho đồng bộ, ms | Trước median/max | UI6 median/max |
|---|---:|---:|
| HTTP refresh | 0.50 / 0.90 | 0.35 / 0.50 |
| Tìm kiếm | 1.30 / 1.90 | 0.55 / 0.70 |
| Thư mục | 1.25 / 2.10 | 0.60 / 0.70 |
| Filter đang hiện | 1.85 / 2.10 | 0.65 / 1.20 |
| Chọn ô | 0.90 / 1.10 | 0.40 / 0.40 |
| Pager | Không có | 1.10 / 9.30 |

HTTP wall median 96.25→95.54ms; search wall 30.18→30.81ms. Pager wall median/max 63.10/960.58ms: lần mở trang ảnh chưa tải có đuôi network/automation, không phải 960ms JS render hay long task. Giữ số đo này như giới hạn cần lưu ý, không tuyên bố mọi thao tác dưới 10ms end-to-end.

### 18. Benchmark 1.500 hình

| Render kho đồng bộ, ms | Trước median/max | UI6 median/max |
|---|---:|---:|
| HTTP refresh | 2.40 / 3.20 | 0.70 / 0.90 |
| Tìm kiếm | 21.25 / 47.50 | 0.85 / 1.00 |
| Thư mục | 23.30 / 51.10 | 1.00 / 1.20 |
| Filter đang hiện | 27.40 / 33.70 | 1.05 / 1.30 |
| Chọn ô | 5.05 / 5.60 | 0.60 / 0.70 |
| Pager | Không có | 5.40 / 6.70 |

Median render kho tìm kiếm giảm 25 lần; search wall median 69.06→30.43ms. HTTP wall 123.67→129.42ms dù render kho giảm: vẫn tải toàn bộ metadata, parse/network/preview/ảnh ngoài library chưa tối ưu. Không dùng số render để ngụ ý toàn HTTP đã nhanh 25 lần.

Môi trường UI6: macOS 15.5 arm64, Python 3.14.7, Node 26.8.2, Chrome headless 154.0.8037.98, 8 mẫu mỗi operation, primary viewport 1536×768. Before là `/tmp/control-ui-before-pagination.log`, UI6 là `/tmp/control-ui6-final-benchmark.log`, cùng fixture IDs, samples và thao tác. `--search-shapes` chỉ dùng để chứng minh sáu kiểu kết quả, không trộn timing fixture khác vào bảng. Capture chạy sau timing trong context không instrument riêng. Các số là khảo sát tại máy này, không phải SLA hoặc timing assertion.

### 19. Thẻ đang gắn / số phần tử toàn trang

| Hình | Thẻ trước→sau | Toàn document trước→sau |
|---|---|---|
| 27 | 27→27 | 485→724 |
| 250 | 250→72 | 2.127→1.480 |
| 1.500 | 1.500→72 | 11.219→1.822 |

Tối đa thẻ gắn trong mọi operation UI6: 27/72/72. Toàn document không bằng riêng library: queue, preview và khoảnh khắc vẫn có số phần tử tùy dữ liệu. Chi phí mount library bị chặn bởi page size; filter/sort và prune cache vẫn phụ thuộc toàn dữ liệu.

### 20. Long tasks và rAF

| Fixture / operation | Long tasks trước→sau | rAF p95/max trước→sau, ms |
|---|---|---|
| 27 search | 0→0 | 16.8/16.8→16.8/16.8 |
| 250 search | 0→0 | 16.7/16.7→16.7/16.7 |
| 1.500 search | 4 (max82ms)→0 | 83.2/83.3→16.8/16.8 |
| 1.500 folder | 4 (max90ms)→0 | 66.7/66.7→16.7/16.8 |
| 1.500 active filter | 4 (max75ms)→0 | 50.0/50.1→16.7/16.8 |

UI6 cả tám operation ở cả ba fixture đều zero long tasks (>50ms). Không phải mọi frame của toàn Control đều 16.8ms: stress chọn trang p95/max33.3/49.9ms, chọn ô33.4/50.1ms. Toàn preview/queue vẫn hoạt động và ngoài library còn chi phí. rAF là khoảng scheduling, không phải phép đo compositor/LED physical FPS. Với 8 mẫu, p95 của timing operation chính là max, không có ý nghĩa percentile ổn định thống kê.

### 21. Giới hạn Control còn lại

Metadata HTTP vẫn toàn bộ; tìm mã vẫn ID substring, chưa có tìm nội dung hình. Cache có thể giữ một thẻ detached mỗi drawing khi đã xem hết các trang, nhưng không vượt số authoritative drawings và được prune; chỉ DOM đang gắn bị chặn 72. Queue ô và khoảnh khắc chưa phân trang. Browser Find chỉ thấy trang thẻ đang gắn; ô tìm kiếm của app tìm toàn bộ. Cold images/network có thể làm thao tác đổi trang chậm hơn sync render. Kiểm thử browser hiện là Chrome, không thay cho Safari/Firefox, screen reader và vận hành LED thật.

### 22. Ending cố ý hoãn

Chỉ rõ Prepare → Ready → Start, rehearsal dừng/tiếp tục/chạy lại là local và Về trình chiếu là reset. Không đổi assets/composition/session/motion/timing, đồng bộ readiness hay kiến trúc. Chưa bắt đầu tối ưu hoặc redesign Ending chi tiết.

### 23. git diff --stat

```text
 frontend/control/app.js     | 176 +++++++++++++++++++++++++++++----
 frontend/control/ending.js  |   7 ++
 frontend/control/index.html |  43 ++++----
 frontend/control/style.css  |  85 +++++++++++-----
 tests/browser/smoke.cjs     | 232 +++++++++++++++++++++++++++++++++++++++++++-
 5 files changed, 485 insertions(+), 58 deletions(-)
```

Đây là diff tracked tổng của working tree, có cả phần PERF-B1/app/tests đã tồn tại trước task, không nhận là toàn bộ do task này tạo. Thư mục benchmarks đã untracked từ trước; harness/docs trong đó không hiện trong `git diff --stat`, nên được liệt kê riêng ở mục13. Không xóa các benchmark/report trước đó.

### 24. git diff --check / lệnh và health

`git diff --check`: PASS, exit0. Tất cả test/benchmark dùng kho tạm và cổng ephemeral; không gieo test data vào storage triển lãm. Các máy chủ test/benchmark đều trả health200. Sau hoàn tất đo, mở lại server thường để người dùng xem Control; chỉ kiểm tra route/asset/health bằng GET, không chạy mutations kiểm thử trên server này. Chạy ứng dụng thường có carousel/runtime chuẩn, không phải freeze dữ liệu live.

Server preview đang chạy ở `http://127.0.0.1:8000/control/?v=20261007-control`: health `{"status":"ok","service":"cloud-of-strokes-api"}`, Control/CSS/JS đều HTTP200; browser kết nối WebSocket. Yêu cầu curl mặc định bị chặn bởi môi trường sandbox; xác nhận lại với quyền truy cập localhost thành công — không phải lỗi ứng dụng.

Lệnh dùng (từ repository root):

```sh
# Full baseline sau từng UI1–UI6; log tương ứng /tmp/control-uiN-tests.log
caffeinate -di env PLAYWRIGHT_CHANNEL=chrome npm test

# Benchmark trước, sau UI2, UI4 và UI6, chạy tuần tự không trùng test
caffeinate -di env PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only
caffeinate -di env PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --search-shapes
caffeinate -di env PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --capture-control /tmp/cos-control-review.6OwV6Y
caffeinate -di env PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --capture-control /tmp/cos-control-final.vI6ROY

# Focused UI6 trước full suite
caffeinate -di env PLAYWRIGHT_CHANNEL=chrome node --test --test-name-pattern='Control native keyboard' tests/browser/smoke.cjs

# Syntax của TẤT CẢ JS frontend, không chỉ file đầu tiên
while IFS= read -r cos_syntax_file; do node --check "$cos_syntax_file" || exit; done < <(rg --files frontend -g '*.js')
node --check tests/browser/smoke.cjs
node --check benchmarks/browser.mjs
.venv/bin/python -m compileall -q backend run.py tests benchmarks/performance.py
git diff --check
git diff --stat

# Một lần detector Impeccable, trước chỉnh font cuối
/Users/a123/.agents/skills/impeccable/scripts/impeccable detect --json frontend/control/index.html frontend/control/style.css frontend/control/app.js frontend/control/ending.js

# Mở lại ứng dụng, kiểm tra read-only
.venv/bin/python run.py
curl --max-time 3 -sS http://127.0.0.1:8000/api/health
```

Dừng tại Control UI1–UI6. Không chuyển sang tối ưu Ending/backend/Draw.
