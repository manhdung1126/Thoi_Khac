# THỜI KHẮC

*Mỗi nét vẽ – một mảnh ký ức.*

THỜI KHẮC là trải nghiệm tương tác dành cho triển lãm: khách tham quan viết hoặc vẽ trên điện thoại, gửi tác phẩm lên màn LED và cùng nhau tạo nên một không gian lưu dấu ấn. Ban tổ chức quản lý nội dung trình chiếu và thực hiện phần kết bằng màn hội tụ các nét vẽ thành hình ảnh của triển lãm.

| Không gian | Dành cho | Chức năng chính |
| --- | --- | --- |
| **Draw — Khắc nét** | Khách tham quan | Vẽ, chọn màu và gửi tác phẩm |
| **Display — Trình chiếu** | Màn LED | Hiển thị tác phẩm, luân phiên nội dung và phát Dấu Ấn |
| **Control — Điều khiển** | Ban tổ chức | Quản lý trang, tác phẩm, khoảnh khắc và phần kết |

Tên thư mục bàn giao của ứng dụng là `cloud_of_strokes`.

## Trải nghiệm của khách tham quan

1. Mở đường dẫn Draw do ban tổ chức cung cấp.
2. Vẽ trên bảng bằng ngón tay, bút cảm ứng hoặc chuột.
3. Mở nút **Bút** để chọn một trong năm độ rộng, màu có sẵn hoặc màu tùy chọn. Có thể dùng tẩy, hoàn tác và làm lại khi cần.
4. Bấm **Khắc** để gửi tác phẩm lên không gian chung.

Sau khi gửi thành công, bảng vẽ được làm sạch để khách tiếp tục vẽ hình mới. Nếu gửi thất bại, hình vẫn được giữ để thử lại. Bản nháp được lưu trên trình duyệt của thiết bị đang vẽ; đây không phải bản sao lưu trên máy chủ.

Nét vẽ có độ rộng ổn định, màu được giữ khi trình chiếu và có hiệu ứng ánh kim. Tác phẩm được lưu dưới dạng SVG nền trong suốt để có thể sử dụng tiếp trong công việc thiết kế.

## Vận hành triển lãm

### Chuẩn bị trước khi đón khách

1. Khởi động ứng dụng trên máy điều khiển và kiểm tra các thiết bị cùng truy cập được mạng triển lãm.
2. Mở Display trên máy nối với LED. Đưa chuột đến góc dưới bên phải để hiện nút toàn màn hình, hoặc nhấn **F**. Nhấn **Esc** để thoát.
3. Mở Control, đăng nhập bằng mã quản trị và chọn trang cần trình chiếu.
4. Gửi thử một nét từ điện thoại; kiểm tra màu, độ dày và vị trí trên LED thực tế.
5. Cung cấp đường dẫn Draw cho khách tham quan. Không chia sẻ mã quản trị.

### Quản lý trang và ô trình chiếu

Mỗi trang có **27 ô cố định** trong phần cuộn sớ. Tác phẩm gửi mới được phân bổ ngẫu nhiên, ưu tiên các ô có ít hình nhất: 27 ô được lấp đầy lượt đầu trước khi một ô nhận hình thứ hai. Khi một ô chứa nhiều hình, các hình luân phiên bằng chuyển cảnh mờ dần. Mỗi ô có nhịp luân phiên riêng.

Trong Control, người vận hành có thể:

- Tạo, đặt tên và xóa trang.
- Chọn ô để thêm, chuyển hoặc bỏ tác phẩm khỏi ô; chọn hình cần hiện ngay.
- Điều chỉnh thời gian luân phiên và tạm dừng hoặc tiếp tục trình chiếu.
- Tìm tác phẩm theo mã để thao tác nhanh trong kho nét vẽ.

**Chọn trang chỉ mở trang đó để chỉnh sửa. Màn LED chỉ đổi trang khi bấm “Chiếu trang”.** Người vận hành có thể chuẩn bị nội dung khác mà không làm gián đoạn trang đang chiếu.

### Yêu thích và thùng rác

Tick trái tim để đưa tác phẩm vào mục **Yêu thích**. Ứng dụng tạo một bản sao SVG trong thư mục `backend/storage/favorites/`, thuận tiện cho việc lấy file để chỉnh sửa ngoài. Bỏ yêu thích sẽ xóa bản sao này; bản sao được giữ nếu hình gốc bị xóa vĩnh viễn.

Tác phẩm đưa vào thùng rác có thể được khôi phục. **Xóa vĩnh viễn không thể hoàn tác** và sẽ gỡ tác phẩm gốc khỏi các trang có sử dụng nó, bao gồm trang khoảnh khắc. Hãy sao lưu trước khi xóa số lượng lớn.

### Lưu và chiếu khoảnh khắc

**Lưu khoảnh khắc** ghi lại các hình đang hiện trong từng ô của trang đang chỉnh, tạo một trang riêng và một ảnh xem trước có thể tải về. Đây là bố cục tại thời điểm lưu, không phải video và không bao gồm toàn bộ danh sách hình luân phiên trong các ô.

Vào mục khoảnh khắc và bấm **Chiếu khoảnh khắc** để đưa bố cục đó lên LED. Trang khoảnh khắc dùng chung tác phẩm trong kho, không phải bản sao độc lập của từng hình. Xóa khoảnh khắc cũng xóa trang tương ứng; nếu trang đó đang chiếu, hãy chuyển sang trang khác trước.

### Dấu Ấn — phần kết triển lãm

1. Mở phần **Dấu Ấn** trong Control và tải ảnh đích của triển lãm lên.
2. **Xem thử** với nét thật hoặc số lượng hình mẫu để hình dung quá trình từ trình chiếu bình thường đến hội tụ thành hình. Hình mẫu chỉ phục vụ xem thử, không được thêm vào kho tác phẩm.
3. Bấm **Chuẩn bị LED**. Ứng dụng chốt bộ nét thật từ trang đang chiếu, gồm cả các hình trong danh sách luân phiên.
4. Chờ LED báo sẵn sàng rồi bắt đầu phần kết.
5. Kết thúc hoặc cần quay lại trình chiếu bình thường: dùng nút đặt lại trong phần Dấu Ấn.

Trong khi phần kết đã được chuẩn bị hoặc đang phát, một số thao tác thay đổi nội dung nguồn bị khóa để giữ buổi trình chiếu nhất quán. Tác phẩm khách gửi thêm vẫn được lưu, nhưng không tham gia bộ nét đã chốt cho lần phát đó.

## Thiết bị và điều kiện sử dụng

- Một máy tính chạy ứng dụng, lưu dữ liệu và phục vụ các thiết bị trong triển lãm.
- Một trình duyệt trên máy nối với màn LED; Control có thể mở trên máy này hoặc thiết bị khác cùng mạng.
- Điện thoại hoặc máy tính bảng có trình duyệt hỗ trợ cảm ứng.
- Mạng nội bộ ổn định, cho phép các thiết bị truy cập máy chạy ứng dụng.

Bố cục LED được thiết kế cho **1536 × 768 pixel, tỷ lệ 2:1**, tương ứng màn P3 kích thước khoảng **4,6 × 2,3 m**. Cần kiểm tra cách xuất tín hiệu để nội dung không bị kéo giãn hoặc cắt mất mép. Hiệu ứng và màu sắc phải được duyệt trên màn LED thực tế, không chỉ trên màn laptop.

Máy chạy ứng dụng cần luôn bật, không ngủ và còn đủ dung lượng lưu trữ. Tắt máy hoặc ngắt mạng sẽ làm gián đoạn gửi hình và cập nhật trình chiếu.

## Khởi động trên máy điều khiển

Các lệnh dưới đây dành cho đội kỹ thuật bàn giao, chạy từ thư mục dự án trên macOS hoặc Linux. Máy cần có Python 3.

### Cài đặt lần đầu

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

### Chạy thử trên một máy

```sh
.venv/bin/python run.py
```

Mở các địa chỉ:

- Trang chào: [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
- Draw: [http://127.0.0.1:8000/draw/](http://127.0.0.1:8000/draw/)
- Display: [http://127.0.0.1:8000/display/](http://127.0.0.1:8000/display/)
- Control: [http://127.0.0.1:8000/control/](http://127.0.0.1:8000/control/)

Mã quản trị mặc định **2468** chỉ dành cho thử nghiệm.

### Cho điện thoại cùng mạng truy cập

Đặt mã quản trị riêng trước khi sử dụng tại triển lãm. Thay giá trị minh họa trong lệnh sau bằng mã của ban tổ chức:

```sh
CLOUD_ADMIN_PIN='thay-bang-ma-quan-tri-rieng' .venv/bin/python run.py --lan
```

Dùng địa chỉ mạng nội bộ được in khi khởi động để mở Draw trên điện thoại. `127.0.0.1` chỉ trỏ đến chính thiết bị đang mở trang, không phải máy điều khiển ở thiết bị khác.

Dừng ứng dụng bằng **Ctrl+C**. Khi khởi động lại, tiếp tục dùng cùng mã quản trị riêng. Có thể thêm `--port 8001` nếu cổng mặc định đang được sử dụng; khi đó phải cập nhật đường dẫn trên các thiết bị.

Ứng dụng phục vụ trực tiếp qua mạng nội bộ. Mã quản trị không thay thế mã hóa đường truyền; chỉ sử dụng trên mạng tin cậy. Nếu cần truy cập qua Internet, đội kỹ thuật cần cấu hình HTTPS và bảo vệ truy cập trước khi công khai.

## Dữ liệu và sao lưu

Dữ liệu triển lãm nằm trên **máy chạy ứng dụng**, trong thư mục `backend/storage/`. Kho này chứa tác phẩm, dữ liệu nét vẽ, bản sao yêu thích, trang trình chiếu và khoảnh khắc đã lưu.

Để sao lưu hoặc chuyển sang máy khác:

1. Dừng ứng dụng.
2. Sao chép **toàn bộ** thư mục `backend/storage/` sang nơi lưu trữ an toàn.
3. Khi chuyển máy, cài ứng dụng rồi khôi phục nguyên thư mục dữ liệu trước khi khởi động.
4. Mở Control để kiểm tra trang, tác phẩm và khoảnh khắc; đăng nhập lại sau khi khởi động máy chủ.

Không xóa riêng file ảnh hoặc sửa dữ liệu bằng tay trong khi ứng dụng đang chạy. Hãy quản lý tác phẩm qua Control để thông tin và file luôn đồng bộ.

GitHub chỉ dùng để bàn giao mã ứng dụng và tài nguyên giao diện. Dữ liệu khách tham quan, mã quản trị và bản sao lưu cần được chuyển riêng, không đưa vào kho mã công khai. Tuân thủ chính sách của triển lãm về đồng ý sử dụng và thời hạn lưu tác phẩm.

## Khi gặp sự cố

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| Điện thoại không mở được Draw | Kiểm tra cùng mạng, đúng địa chỉ máy điều khiển, máy không ngủ và mạng không chặn kết nối giữa thiết bị. Nhờ đội kỹ thuật kiểm tra quyền truy cập mạng; không tắt toàn bộ tường lửa. |
| Gửi hình thất bại | Giữ trang và bản vẽ, kiểm tra kết nối rồi thử lại. Không xóa dữ liệu trình duyệt khi đang cần giữ bản nháp. |
| Trang chọn trong Control chưa hiện lên LED | Bấm “Chiếu trang”; chọn trang để chỉnh không tự thay nội dung đang chiếu. |
| Hình không luân phiên | Kiểm tra trạng thái tạm dừng, thời gian luân phiên và ô có nhiều hơn một hình hay chưa. |
| Không thao tác được trong Control | Kiểm tra phiên đăng nhập và trạng thái Dấu Ấn. Sau khi máy chủ khởi động lại cần đăng nhập lại. |
| LED chưa hiện thay đổi | Kiểm tra kết nối của máy trình chiếu và tải lại Display. Nếu vẫn lỗi, ghi lại thông báo để đội kỹ thuật kiểm tra. |

Khi cần hỗ trợ, cung cấp thiết bị, trình duyệt, thao tác vừa thực hiện và ảnh chụp thông báo lỗi. Không gửi mã quản trị hoặc toàn bộ dữ liệu khách qua kênh công khai.

## Tài liệu dành cho đội kỹ thuật

- [Hướng dẫn kiểm thử](docs/TESTING.md): các lệnh và phạm vi kiểm tra tự động.
