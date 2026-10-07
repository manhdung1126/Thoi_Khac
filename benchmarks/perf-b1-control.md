# PERF-B1 — tối ưu kho nét vẽ Control

Phạm vi: chỉ renderer thư viện artwork trong Control. Không sửa Store, API/schema, WebSocket, carousel, Draw, Ending, transaction logic hoặc UI/CSS. Baseline correctness ban đầu: 171 (50 JS + 106 Python + 15 E2E).

## P1 — nguyên nhân và profile trước khi sửa

Renderer cũ gọi replaceChildren rồi tạo lại mọi thẻ và listener trong mỗi renderLibrary, kể cả khi authoritative state chỉ đổi tên trang, chu kỳ, server_time hoặc Ending/runtime. Selected cell đổi nhãn nút, không đổi ảnh; selected page đổi membership/active labels, không yêu cầu tạo lại asset hoặc listener.

Dùng harness cũ, fixture 27/250/1.500, source instrumentation chỉ trong response benchmark, native DOM timers và Chrome timeline. Không sửa mã sản phẩm để profile. Lượt breakdown có overhead riêng, không dùng làm baseline so sánh timing với lượt không profile.

| Stage (HTTP refresh) | 27 median ms | 250 median ms | 1.500 median ms | p95 1.500 ms |
|---|---:|---:|---:|---:|
| Toàn library | 1.15 | 10.15 | 91.80 | 314.70 |
| Membership/visible sets | <0.1 | 0.05 | 0.20 | 0.30 |
| Folder/search/only-visible filter | <0.1 | 0.05 | 0.15 | 0.20 |
| Sort created_at | <0.1 | <0.1 | <0.1 | <0.1 |
| Clear existing DOM | 0.10 | 0.85 | 5.05 | 6.40 |
| Native createElement | <0.1 | 0.45 | 2.95 | 7.40 |
| Image src assignments | 0.30 | 1.80 | 12.75 | 15.20 |
| Text assignments (meta/actions/count) | <0.1 | 0.35 | 2.05 | 3.00 |
| setAttribute (favorite ARIA) | <0.1 | 0.15 | 0.85 | 1.60 |
| classList.add (favorite/on-stage) | <0.1 | 0.10 | 0.50 | 0.90 |
| addEventListener | <0.1 | 0.30 | 1.50 | 2.20 |
| append calls | 0.10 | 2.50 | 36.50 | 154.00 |

Mỗi refresh unchanged 1.500 hình vẫn gọi 10.500 createElement, 1.500 image.src assignments, 4.500 addEventListener, 4.500 append và 6.001 text assignments. Favorite/archive quyết định filter/actions và ARIA/classes, được bao gồm trong các stage trên, không tách thành CPU độc lập. Native call timings không gồm mọi dataset/className/disabled/getter, closure allocation, JS logic hoặc paint; không cộng median để suy ra total.

Style/layout và GC quan sát được trong **toàn chuỗi 40 thao tác Control**, không chỉ library:

| Chrome timeline, 1.500 | Count | Total ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|
| Layout | 734 | 994.35 | 19.32 | 34.88 |
| UpdateLayoutTree | 732 | 774.20 | 15.87 | 21.89 |
| MinorGC | 8 | 26.34 | 8.83 | 8.83 |
| MajorGC | 5 | 79.40 | 22.69 | 22.69 |

Đây là evidence DOM churn/style/GC bổ sung, không phải chứng minh mọi Layout/GC thuộc library. Chưa quy toàn bộ residual cost cho GC hay style. Không có thay đổi sorting/filter algorithm; chúng nhẹ hơn nhiều so với dựng DOM.

## P2 — phương án và quy tắc invalidation

Giữ một Map cục bộ renderer theo stable drawing ID, tối đa một thẻ cho mỗi drawing vẫn còn trong authoritative state. Thẻ ngoài kết quả lọc được detach nhưng có thể reuse khi quay lại. Vẫn refilter/sort từ authoritative state ở mỗi call; **không cache server state hoặc dùng revision làm key**.

| Input đổi | Hành vi mới |
|---|---|
| Cùng ID, image_path/favorite/folder không đổi | Tái sử dụng thẻ, img và listener |
| image_path, favorite hoặc loại actions của folder đổi | Tạo lại đúng thẻ thay đổi; giữ nguồn/chất lượng ảnh, lazy loading, download, ARIA như cũ |
| Membership/page/cell context đổi | Sửa meta Ô…, on-stage, nhãn thêm/chuyển, data-locked và disabled trên node cũ |
| Query/folder/only-visible hoặc archive state | Tính lại tập kết quả; chỉ attach các node khớp bộ lọc; thẻ bị lọc ra được detach. Key folder/actions vẫn được kiểm tra khi quay lại |
| Drawing bị purge/không còn trong authoritative collection | Remove node và xóa cache entry; không giữ các drawing không còn được quản lý |
| created_at/order đổi | Sort như cũ rồi di chuyển node đúng thứ tự |
| Page rename, cycle, revision, Ending/runtime/readiness không đổi nội dung thẻ | Không dựng lại card/img/listener; phần Control khác vẫn nhận state đầy đủ |
| Busy/login/logout | Giữ access() hiện có; mọi button trên cached card cập nhật disabled đúng locked/token/busy khi render hoặc reattach |

Callback thêm/chuyển đọc page/cell/membership **hiện tại lúc click**, không giữ page/membership cũ của thẻ được tái sử dụng. Favorite callback chỉ được reuse nếu favorite trong key vẫn giống nhau. Không viết vào state server-owned. Selected/live page, folder, query, checkbox, selected cell, dialog và dirty/focused inputs không bị reset.

So với full renderer cũ, tránh clear/recreate toàn thư viện khi unchanged. DOM hiện tại chỉ chứa kết quả lọc; Map có thể giữ thẻ detached của các drawing vẫn còn trong state. Không có hidden DOM container hoặc cache nhiều phiên bản cho cùng ID. Đổi folder/key có thể tạo lại đúng thẻ cần đổi actions; search quay lại cùng key reuse ảnh/listener. Khi host trống, dùng một DocumentFragment để attach tập kết quả; thứ tự vẫn theo sort cũ.

### Phương án không chọn

- Chỉ guard theo revision: sai semantic invalidation, runtime cùng revision vẫn phải đến những phần Control khác.
- Global content fingerprint rồi bỏ toàn renderLibrary: chưa cần; filter/sort nhẹ và per-card reuse vẫn cập nhật context đúng. Không thêm công cụ invalidation/framework riêng.
- Pagination/virtualization: thay keyboard/scroll/filter semantics và UI; chưa cần khi tránh DOM churn đã có cải thiện đo được.
- Cache của Display/Ending hoặc đổi asset sources/headers/quality: ngoài phạm vi.

### Refinement dựa trên phép đo

Bản thử đầu giữ membership/on-stage trong key tạo card. Refresh và cell selection tốt lên nhưng page selection thay hàng loạt node đang attached: normal full render ~15,75 ms so với ~10,15 ms trước; stress ~114,95 ms so với ~85,70 ms, kèm frame gaps tăng. **Không giữ bản này làm kết quả cuối.** Đã chuyển context updates sang node cũ, rồi chạy lại toàn suite và benchmark. Báo cáo before/after bên dưới chỉ dùng bản cuối, không trộn số liệu bản thử.

Hai lượt đo tiếp theo xác nhận page/cell/refresh cải thiện nhưng search ẩn hết rồi hiện lại 1.500 hình bị regression: library p95 336,9/343,9 ms so với 75,5 ms trước. Bản đó gỡ từng card khi kết quả rỗng và truy cập live HTMLCollection theo index trong vòng chèn. Thử dùng replaceChildren một lần + clear Map khi kết quả rỗng và duyệt sibling trực tiếp khi giữ thứ tự. Ở giai đoạn thử này chưa giữ detached cards; không dùng số liệu candidate làm kết quả cuối.

Kiểm tra tiếp vẫn thấy search repopulation có tail cao. Profile bổ sung (có overhead) tại 1.500: insert native median 36,75 ms / p95 152,80 ms, image-src median 31,05 ms / p95 51,40 ms trong bốn lần dựng lại toàn kết quả; filter/membership vẫn ≤0,2 ms. Thử gom tập kết quả mới vào DocumentFragment, rồi chèn một lần. Thẻ đang có vẫn cập nhật tại chỗ. Không đổi nguồn/lazy loading ảnh; profile không chứng minh một API đơn lẻ là toàn bộ nguyên nhân tail, nhưng đủ căn cứ thử giảm insertion churn trước khi cân nhắc virtualization.

Batch insertion riêng chưa loại bỏ cold-search tail: baseline cũ đã tải 1.573 API resources ở initial, còn bản reuse/evict chỉ 140; search lần đầu của bản thử tải thêm 1.058 resources. Chạy lại search sau networkidle: 250 library median/p95 4,4/8,0 ms, wall 41,6/50,4 ms; 1.500 library 40,6/81,3 ms, wall 191,7/359,1 ms, không thêm resource — gần baseline search vốn đã warm. Đây là evidence việc evict/recreate ảnh làm chi phí tải/chèn chuyển sang search đầu tiên, không phải bằng chứng filter trở nên chậm. Vì vậy bản cuối **không evict chỉ do query**: reuse thẻ detached, giới hạn theo authoritative collection và prune khi ID bị loại. Các lượt số liệu của bản evict chỉ là chẩn đoán, không dùng làm kết quả cuối. Chi phí memory của quyết định này được nêu riêng bên dưới.

## Correctness

Hai E2E mới không đặt timing threshold:

1. Unchanged img/focus qua reconcile/rename/cycle/page/cell; membership cập nhật không reset img; action vào đúng current off-air page/cell, live page không đổi.
2. Add/move membership, active-only filter, favorite toggle/download/favorites folder, archive/trash/restore và callback không stale; logout lúc card bị lọc ra rồi reattach vẫn disable mọi action.

Test giữ img/focus fail trên renderer cũ (img bị thay khi refresh không liên quan); test hành vi còn lại pass trên renderer cũ trước tối ưu. Các lỗi setup ban đầu của test mới (thiếu JSON body và giả định add sẽ tự activate) đã sửa theo API/queue contract, không sửa sản phẩm để ép PASS. Không thay hay làm yếu 171 test cũ.

Một full run sau refinement có 16/17 E2E pass; bài hai Display Ending/restart timeout khi chờ LOCKED và chạy bất thường 305 s. Nhật ký pmset ghi máy vào Maintenance Sleep lúc 01:29:49 và Wake lúc 01:32:14 (145 s), trùng khoảng chạy. Bài đó không tải Control; chạy riêng không sửa mã đã PASS trong 25,4 s. Phân loại failure: môi trường/sleep ảnh hưởng timing, không có bằng chứng lỗi do renderer Control. Full suite được chạy lại với `caffeinate -i` chỉ giữ máy thức cho command; không nới timeout hay sửa Ending/test contract. Không dùng lượt bị sleep để làm số đo performance.

## P3/P4 — before/after, hai lượt bản cuối (9–13)

Before là lượt `--control-only` không có stage profiler, đo trên renderer nguyên bản trước sửa trong turn này. A/B là hai lượt độc lập cùng fixture/cỡ mẫu và bản cuối. Không dùng các candidate bị loại trong bảng. macOS 15.5 arm64, Python 3.14.7, FastAPI 0.141.1, Pillow 12.3.0, Node 26.8.2, Chrome 154.0.8037.98, Playwright 1.62.1, headless viewport 1536×768, DPR 1. Giữ máy thức bằng caffeinate trong các lượt cuối; không đổi power preferences.

Fixture và chuỗi thao tác giữ nguyên: 27/250/1.500 artwork, tương ứng 1/3/10 trang và 0/5/20 snapshot; 192 điểm mỗi artwork, 80% Mono v2/20% solid v1, carousel paused qua setting hiện có. Mỗi operation 8 action; WS 8 burst × 5 notifications, vẫn 16 renderLibrary/renderControl do coalescing như trước. Before stress chọn trang có 9 render do một refresh định kỳ; A/B là 8. Không thay đổi tick/coalescing để làm đẹp phép đo.

Đơn vị ms. Library/Full/Wall = **median / p95**; rAF = **p95 / max**. Full là renderControl đồng bộ, không có giá trị cho callback chỉ gọi renderLibrary; Wall gồm automation, network và hai rAF waits. Passive không có function/source/DOM hooks, chỉ có native rAF/long-task/resource observation và cache của browser. Native long task ≥50 ms là định nghĩa của browser, không phải target mới. Với n=8, p95 là max; đây là exploratory tails, không phải percentile ổn định hay đo GPU/LED dropped frames.

### 27 artwork

| Operation | Library trước | Library A | Library B | Full trước | Full A | Full B |
|---|---:|---:|---:|---:|---:|---:|
| HTTP refresh | 1.05 / 1.60 | 0.20 / 0.20 | 0.10 / 0.20 | 1.75 / 2.50 | 0.95 / 1.10 | 0.80 / 1.20 |
| WS burst | 0.80 / 1.50 | 0.20 / 0.30 | 0.10 / 0.30 | 1.40 / 2.30 | 0.90 / 1.30 | 0.80 / 1.00 |
| Chọn trang | 0.85 / 1.10 | 0.10 / 0.20 | 0.10 / 0.10 | 1.35 / 1.70 | 0.80 / 1.00 | 0.75 / 0.90 |
| Chọn ô | 0.70 / 0.90 | 0.20 / 0.30 | 0.10 / 0.30 | — | — | — |
| Search (none/full) | 0.45 / 0.90 | 0.20 / 0.30 | 0.20 / 0.30 | — | — | — |

| Operation | Wall trước | Wall A | Wall B | Long tasks trước/A/B | rAF trước | rAF A | rAF B |
|---|---:|---:|---:|---:|---:|---:|---:|
| HTTP refresh | 99.14 / 99.56 | 99.16 / 99.37 | 98.69 / 99.84 | 0 / 0 / 0 | 16.70 / 16.80 | 16.80 / 16.80 | 16.80 / 16.80 |
| WS burst | 116.37 / 132.10 | 119.91 / 132.44 | 116.87 / 131.84 | 0 / 0 / 0 | 16.70 / 16.80 | 16.70 / 16.80 | 16.70 / 16.80 |
| Chọn trang | 32.77 / 40.25 | 32.56 / 33.72 | 32.74 / 34.05 | 0 / 0 / 0 | 16.80 / 16.80 | 16.80 / 16.80 | 16.70 / 16.70 |
| Chọn ô | 32.33 / 32.95 | 32.51 / 33.07 | 32.19 / 42.08 | 0 / 0 / 0 | 16.80 / 16.80 | 16.70 / 16.70 | 16.80 / 16.80 |
| Search (none/full) | 32.43 / 32.96 | 32.59 / 33.89 | 32.46 / 33.03 | 0 / 0 / 0 | 16.80 / 16.80 | 16.80 / 16.80 | 16.70 / 16.70 |
| Passive refresh | 83.27 / 83.48 | 83.42 / 84.14 | 83.23 / 83.80 | 0 / 0 / 0 | 16.70 / 16.80 | 16.80 / 16.80 | 16.70 / 16.70 |

### 250 artwork

| Operation | Library trước | Library A | Library B | Full trước | Full A | Full B |
|---|---:|---:|---:|---:|---:|---:|
| HTTP refresh | 8.20 / 11.20 | 0.60 / 0.90 | 0.60 / 0.90 | 9.70 / 13.00 | 2.40 / 3.10 | 2.35 / 3.20 |
| WS burst | 7.75 / 9.10 | 0.60 / 0.80 | 0.55 / 0.70 | 9.10 / 10.90 | 2.15 / 2.80 | 2.15 / 2.70 |
| Chọn trang | 7.80 / 8.00 | 0.90 / 1.30 | 0.85 / 1.30 | 10.15 / 10.60 | 3.55 / 5.50 | 3.50 / 5.40 |
| Chọn ô | 7.30 / 7.80 | 0.90 / 1.00 | 0.90 / 1.00 | — | — | — |
| Search (none/full) | 4.20 / 7.60 | 1.40 / 2.00 | 1.40 / 2.00 | — | — | — |

| Operation | Wall trước | Wall A | Wall B | Long tasks trước/A/B | rAF trước | rAF A | rAF B |
|---|---:|---:|---:|---:|---:|---:|---:|
| HTTP refresh | 99.50 / 119.61 | 98.77 / 100.78 | 99.03 / 100.03 | 0 / 0 / 0 | 16.70 / 16.80 | 16.70 / 16.80 | 16.80 / 16.80 |
| WS burst | 133.44 / 149.80 | 132.59 / 150.04 | 146.28 / 148.77 | 0 / 0 / 0 | 16.70 / 16.80 | 16.80 / 16.80 | 16.70 / 16.80 |
| Chọn trang | 49.21 / 50.00 | 31.58 / 37.39 | 32.17 / 37.78 | 0 / 0 / 0 | 16.70 / 16.80 | 16.70 / 16.70 | 16.70 / 16.70 |
| Chọn ô | 32.79 / 47.31 | 31.69 / 32.58 | 31.67 / 32.92 | 0 / 0 / 0 | 16.80 / 16.80 | 16.70 / 16.70 | 16.80 / 16.80 |
| Search (none/full) | 40.96 / 49.76 | 32.46 / 33.18 | 31.99 / 33.80 | 0 / 0 / 0 | 16.80 / 16.80 | 16.80 / 16.80 | 16.80 / 16.80 |
| Passive refresh | 99.97 / 146.96 | 83.17 / 83.46 | 83.30 / 83.57 | 0 / 0 / 0 | 16.70 / 16.70 | 16.80 / 16.80 | 16.70 / 16.70 |

### 1500 artwork

| Operation | Library trước | Library A | Library B | Full trước | Full A | Full B |
|---|---:|---:|---:|---:|---:|---:|
| HTTP refresh | 87.10 / 306.40 | 2.55 / 3.60 | 3.00 / 4.20 | 94.25 / 323.70 | 19.85 / 20.10 | 19.90 / 20.70 |
| WS burst | 77.65 / 84.10 | 2.50 / 3.30 | 2.45 / 3.10 | 84.50 / 92.10 | 18.95 / 20.00 | 18.60 / 19.10 |
| Chọn trang | 78.10 / 83.50 | 4.95 / 5.90 | 4.70 / 5.40 | 85.70 / 89.90 | 25.30 / 26.20 | 24.60 / 25.50 |
| Chọn ô | 77.50 / 79.50 | 5.40 / 6.20 | 5.00 / 5.50 | — | — | — |
| Search (none/full) | 39.15 / 75.50 | 23.75 / 51.50 | 22.65 / 57.70 | — | — | — |

| Operation | Wall trước | Wall A | Wall B | Long tasks trước/A/B | rAF trước | rAF A | rAF B |
|---|---:|---:|---:|---:|---:|---:|---:|
| HTTP refresh | 444.21 / 785.25 | 132.61 / 147.21 | 131.56 / 202.47 | 12 / 0 / 0 | 133.30 / 383.40 | 16.70 / 16.80 | 16.80 / 16.80 |
| WS burst | 616.01 / 631.22 | 182.77 / 199.49 | 182.73 / 183.12 | 18 / 0 / 0 | 116.80 / 133.40 | 16.80 / 16.80 | 16.80 / 16.80 |
| Chọn trang | 361.67 / 491.80 | 121.19 / 160.93 | 120.11 / 142.26 | 14 / 0 / 0 | 133.40 / 149.90 | 50.10 / 66.70 | 66.60 / 83.40 |
| Chọn ô | 322.22 / 340.00 | 64.20 / 65.67 | 64.41 / 65.39 | 8 / 0 / 0 | 116.70 / 116.80 | 33.40 / 33.40 | 33.40 / 33.40 |
| Search (none/full) | 180.17 / 363.08 | 71.77 / 115.72 | 72.34 / 131.84 | 4 / 4 / 4 | 116.70 / 150.00 | 83.30 / 83.30 | 83.30 / 100.10 |
| Passive refresh | 647.67 / 893.17 | 133.21 / 153.97 | 133.32 / 161.78 | 11 / 0 / 0 | 350.00 / 399.90 | 16.70 / 16.80 | 16.70 / 16.80 |

### Quyết định giữ thay đổi

- 1.500 HTTP library: 87,10 → 2,55/3,00 ms median (~96,6–97,1% giảm); full Control 94,25 → 19,85/19,90 ms. HTTP long tasks 12 → 0/0; passive 11 → 0/0, rAF p95 350 → 16,70/16,70 ms.
- WS, page, cell và search đều có library median giảm lặp lại. Search 1.500: 39,15 → 23,75/22,65 ms; wall 180,17 → 71,77/72,34 ms. **Vẫn có 4 long tasks search mỗi lượt**, không tuyên bố đã loại bỏ tất cả frame gaps.
- 27/250: không thêm long task trong chuỗi operation hoặc passive; normal search 4,20 → 1,40/1,40 ms, không còn tail regression của bản evict. Tails automation/network đôi lúc khác nhau, không dùng riêng Wall để kết luận CPU.
- Không bỏ HTTP reconciliation hoặc giảm render calls. Không dùng revision làm cache key. Kết quả đủ rõ và lặp lại để giữ PERF-B1; không đặt performance gate cố định vào test suite.

### DOM/assets và lần mở đầu

| Artwork | Attached DOM trước/A/B | Initial API resource requests trước/A/B | Search API requests trước/A/B | Initial navigation settled trước/A/B ms |
|---|---:|---:|---:|---:|
| 27 | 480 / 480 / 480 | 72 / 64 / 64 | 0 / 0 / 0 | 905.54 / 1028.08 / 901.03 |
| 250 | 2122 / 2122 / 2122 | 303 / 79 / 79 | 0 / 0 / 0 | 1143.07 / 913.21 / 854.85 |
| 1500 | 11214 / 11214 / 11214 | 1573 / 140 / 140 | 0 / 0 / 0 | 8068.78 / 1307.49 / 1268.60 |

Initial navigation là một observation mỗi context, gồm login/networkidle/startup, không phải median/p95 của 8 thao tác. Stress initial vẫn có 1 long task A/B (55/50 ms), so với 3 trước; rAF initial max vẫn 233,3/216,6 ms. Giữ image.src/alt/lazy/source/quality như cũ, không thêm prefetch, đổi header hay cache backend; traffic giảm là hệ quả không teardown/recreate img đang có.

### Profile DOM sau sửa (7)

Ở mỗi HTTP refresh unchanged 1.500 hình, native profile sau sửa ghi **0 createElement, 0 image.src assignments, 0 addEventListener và 0 insertion/clear calls của library**, so với 10.500/1.500/4.500/4.500 insert + 1 clear trước. 1.500 classList.toggle checks vẫn có, không khẳng định library không làm bất kỳ DOM work nào. Search none/full không dựng lại card/img/listener: chỉ tạo một empty paragraph ở lần none và reattach thẻ ở lần full. Sources/lazy/quality giữ nguyên.

Chrome trace sau sửa, cùng chuỗi 40 action, là quan sát toàn Control:

| Event | Count | Total ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|
| Layout | 1053 | 372.11 | 0.85 | 30.19 |
| UpdateLayoutTree | 1133 | 132.00 | 0.12 | 13.61 |
| MinorGC | 13 | 8.54 | 1.04 | 1.04 |
| MajorGC | 3 | 15.74 | 7.60 | 7.60 |

So với profile P1, cumulative layout/style/GC cost giảm trong lượt này, dù event counts không đồng loạt giảm. Hook sau sửa theo dõi thêm fragment/insertBefore/remove/replace/toggle; không dùng các synchronous profile durations để thay thế comparison plain A/B, không gán toàn bộ trace hoặc GC cho library.

## Memory, giới hạn và bottleneck còn lại (14–16)

Map thêm key/record/references và giữ detached cards khi lọc, tối đa một card cho mỗi ID còn trong authoritative collection; lần đổi asset/favorite/folder thay entry, không giữ nhiều phiên bản. Khi ID bị purge/removed, prune xảy ra cả khi kết quả query rỗng. Attached DOM chỉ chứa kết quả lọc; không có hidden container; đóng tab giải phóng cache, không persist cache vào storage. Đây là tradeoff memory lấy CPU/network/focus stability, **không phải giảm toàn bộ memory**. Chưa đo retained heap bytes hoặc long-duration Control heap plateau, không tuyên bố leak-proof chỉ từ DOM count. Không có cache của Display/Ending dùng chung.

Control còn full render ~19–25 ms ở stress; queue/cell controls, snapshots, access và stage vẫn làm việc như trước. Search none/full vẫn detach/reattach 1.500 thẻ, phát sinh layout/paint và 4 native long tasks trong mỗi lượt; rAF max search 83,3/100,1 ms, page 66,7/83,4 ms. Initial construction vẫn tạo toàn bộ library, stress initial có 1 long task. Không sửa các phần này trong PERF-B1.

**Không triển khai virtualization.** Invalidation/reuse đã giải quyết refresh/cell/page bottleneck và giảm search đáng kể, normal không có long task mới. Nếu tiếp theo cần loại bỏ hoàn toàn stress search/initial tail hoặc catalog lớn hơn, phải đo native scrolling/keyboard/heap riêng, trình bày complexity và ảnh hưởng search/selection/scroll/focus, rồi dừng xin review trước virtualization. Không tự chuyển sang PERF-B2 hoặc R3-D.

## Verification cuối và tệp thay đổi (5, 8, 17–18)

| Check | Kết quả |
|---|---|
| JavaScript | 50/50 PASS |
| Python/API integration | 106/106 PASS |
| E2E | 17/17 PASS (15 cũ + 2 mới) |
| Tổng | **173/173 PASS**, không thay 171 test cũ |
| Syntax | 34 JS/CJS/MJS với node --check; 17 Python với ast.parse: PASS |
| git diff --check | PASS |
| Health | HTTP 200 trên cả ba temporary app servers của A/B/profile |
| Runtime | pageerror arrays rỗng trên cả ba Control workloads A/B/profile |
| Lint/type/build | Không có configured commands trong package.json; không tạo gate mới |

Lượt full cuối dùng `caffeinate -di`: JS/Python/17 E2E PASS, E2E ~187,4 s. Hai lượt trước bị host sleep gây failure ở bài Display Ending, bao gồm một lượt kéo dài ~1.043 giây (17,4 phút) ở wait ready_displays khi máy nhiều lần Maintenance Sleep rồi wake/lid open 09:54:50. `-i` chỉ chặn idle sleep, không thể ngăn người dùng đóng nắp; rerun `-di` khi máy mở đã PASS cùng mã/test/timeout. Không đổi Ending để ép PASS; không dùng các lượt ngủ vào performance tables. Có Starlette/httpx deprecation warning sẵn có, không phải test failure. Cổng triển lãm 8000 không chạy lúc probe (curl exit 7); không tự khởi tạo storage thật để health-check. Health nêu trên là real application trên isolated storage/port, không phải xác nhận một server triển lãm đang chạy.

Tệp thay đổi trong PERF-B1:

- [frontend/control/app.js](/Users/a123/cloud_of_strokes/frontend/control/app.js): keyed local node reuse, semantic key, membership/access updates, order, batch reattach, bounded prune và callback đọc current page/cell lúc click. Không đổi HTML/CSS/public interface.
- [tests/browser/smoke.cjs](/Users/a123/cloud_of_strokes/tests/browser/smoke.cjs): append hai regression tests; không sửa assertions/test cũ, không thêm timing assertions.
- [benchmarks/performance.py](/Users/a123/cloud_of_strokes/benchmarks/performance.py): flags Control-only/profile và optional repeat-search diagnostic; fixtures/default cases giữ nguyên.
- [benchmarks/browser.mjs](/Users/a123/cloud_of_strokes/benchmarks/browser.mjs): benchmark-only source/native DOM/Chrome profile, Control-only skip, optional warm search báo riêng sau chuỗi chính/trace. Không instrument mã sản phẩm trên đĩa.
- [benchmarks/README.md](/Users/a123/cloud_of_strokes/benchmarks/README.md): cách chạy và giới hạn phép đo.
- [benchmarks/perf-b1-control.md](/Users/a123/cloud_of_strokes/benchmarks/perf-b1-control.md): báo cáo này.

`benchmarks/` đã là thư mục untracked từ baseline trước khi bắt đầu; baseline-2026-10-07.md không sửa. Vì vậy default git diff --stat chỉ hiển thị hai tệp tracked; danh sách trên bao gồm extensions của harness untracked và report mới. Không stage/commit, xoá file hay thay dữ liệu triển lãm.

```text
 frontend/control/app.js | 64 +++++++++++++++++++++++++++++++++++----
 tests/browser/smoke.cjs | 79 +++++++++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 138 insertions(+), 5 deletions(-)
```

Các commands thực chạy (root của repo):

```sh
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only --profile-library
PLAYWRIGHT_CHANNEL=chrome .venv/bin/python benchmarks/performance.py --control-only
PLAYWRIGHT_CHANNEL=chrome npm test
PLAYWRIGHT_CHANNEL=chrome node --test --test-name-pattern='two Displays finish the real 20-second Ending' tests/browser/smoke.cjs
PLAYWRIGHT_CHANNEL=chrome caffeinate -i npm test
PLAYWRIGHT_CHANNEL=chrome caffeinate -i .venv/bin/python benchmarks/performance.py --control-only
PLAYWRIGHT_CHANNEL=chrome caffeinate -i .venv/bin/python benchmarks/performance.py --control-only --profile-library
PLAYWRIGHT_CHANNEL=chrome caffeinate -i .venv/bin/python benchmarks/performance.py --control-only --repeat-search
PLAYWRIGHT_CHANNEL=chrome caffeinate -di npm test
PLAYWRIGHT_CHANNEL=chrome caffeinate -di .venv/bin/python benchmarks/performance.py --control-only
PLAYWRIGHT_CHANNEL=chrome caffeinate -di .venv/bin/python benchmarks/performance.py --control-only --profile-library
curl --fail --silent http://127.0.0.1:8000/api/health
pmset -g log
pmset -g assertions
git diff --check
git diff --stat
git diff --name-only -- backend frontend/display frontend/draw frontend/ending frontend/shared package.json package-lock.json
```

Syntax command:

```sh
.venv/bin/python - <<'PY'
import ast, subprocess
from pathlib import Path
paths = [Path(p) for p in subprocess.check_output(['rg','--files','-g','*.js','-g','*.cjs','-g','*.mjs','-g','*.py'],text=True).splitlines()]
js = [p for p in paths if p.suffix != '.py']
py = [p for p in paths if p.suffix == '.py']
for p in js:
    subprocess.run(['node','--check',str(p)],check=True)
for p in py:
    ast.parse(p.read_text(),filename=str(p))
subprocess.run(['git','diff','--check'],check=True)
print(f'Syntax PASS: {len(js)} JS, {len(py)} Python; diff check PASS')
PY
```

Đã kiểm tra whitespace cho từng file untracked bằng git diff --no-index --check đối với /dev/null; exit 1 do file mới có diff là bình thường, output phải không có whitespace error. Forbidden-path diff rỗng. Không thay backend/Draw/Display/Ending/shared APIs/dependencies hoặc UI styles.

Cách dùng investigate-first, surgical-patch và ponytail ảnh hưởng trực tiếp đến việc đo trước, loại candidate có regression, giữ cache cục bộ/native DOM và thêm test hành vi thay vì dựng framework hay performance gates. Kết thúc PERF-B1 ở đây; chưa bắt đầu PERF-B2.
