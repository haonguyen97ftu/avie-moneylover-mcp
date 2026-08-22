# Hướng dẫn sử dụng Avie Money Lover Bridge

## 1. Mục tiêu

Workflow chính là:

**Sao kê → ChatGPT phân tích → JSON chuẩn → máy local preview → bạn duyệt → import Money Lover → verify.**

Token/cookie Money Lover luôn nằm trên máy của bạn, không cần đưa cho ChatGPT.

## 2. Cài đặt lần đầu

Yêu cầu Node.js 22 trở lên. Sau khi giải nén project:

```cmd
cd C:\duong-dan\avie-moneylover-mcp
scripts\setup-windows.cmd
```

Script sẽ chạy `npm install` và toàn bộ test.

## 3. Chuẩn bị session Money Lover

Dùng session của **owner ví** mà bạn muốn ghi transaction.

Trong DevTools → Network của `web.moneylover.me`, chọn một request Money Lover đang hoạt động và lấy các giá trị local cần thiết:

- access token trong header `Authorization: AuthJWT ...`
- `cf_clearance` nếu request write hiện tại cần Cloudflare cookie
- User-Agent đúng của browser đã tạo cookie/session đó

Không lưu các giá trị thật vào GitHub.

Trong CMD hiện tại:

```cmd
set "MONEYLOVER_ACCESS_TOKEN=TOKEN_MOI"
set "MONEYLOVER_CF_CLEARANCE=CF_CLEARANCE_HIEN_TAI"
set "MONEYLOVER_USER_AGENT=USER_AGENT_BROWSER"
```

Các biến `set` chỉ tồn tại trong cửa sổ CMD hiện tại. Đây là cách nên dùng khi debug hoặc import thủ công.

Nếu muốn dùng file local, copy `scripts\session-env.example.cmd` thành `scripts\session-env.local.cmd`, điền secret rồi chạy file đó. File `.local.cmd` đã được `.gitignore`, nhưng đây vẫn là plaintext trên máy — tự bảo vệ máy và file này.

## 4. Kiểm tra kết nối

```cmd
scripts\doctor.cmd
```

Doctor sẽ:

- kiểm tra token có được set hay chưa
- gọi user info
- gọi wallet list
- liệt kê ví và cho biết bạn là `owner` hay `shared`
- không in token/cookie ra màn hình

Nếu read không chạy, chưa import.

## 5. Chuẩn bị file từ sao kê bằng ChatGPT

Upload PDF sao kê cho ChatGPT rồi yêu cầu:

> Chuẩn hoá sao kê này thành JSON theo `data/example-statement.json`. Phân loại merchant theo category Money Lover của tôi. Loại các dòng kỹ thuật gây tính trùng như giao dịch gốc đã chuyển trả góp, nhưng giữ khoản trả góp thực tế của kỳ. Tính expense, income/refund và expectedNet để reconcile.

ChatGPT nên trả một file JSON. Lưu nó vào thư mục `data\`, ví dụ:

```text
data\tpbank-2026-09.json
```

Không commit file sao kê thật vào GitHub.

## 6. Preview — bắt buộc trước khi import

```cmd
scripts\preview.cmd data\tpbank-2026-09.json
```

Preview không ghi transaction. Nó kiểm tra:

- wallet tồn tại
- owner/shared
- category tồn tại
- expense/income có đúng type category không
- runtime category ID cho `user_category_v2`
- duplicate chính xác
- giao dịch cùng ngày + cùng số tiền cần review
- tổng expense, income/refund, net
- chênh lệch với `expectedNet`

File chi tiết được tạo ở:

```text
out\tpbank-2026-09.preview.json
```

### Các trạng thái

- `ready`: có thể import
- `skip`: đã tồn tại chính xác, không import lại
- `review`: cần bạn xem trước
- `blocked`: chưa đủ điều kiện để import

Nếu có `blocked`, sửa trước. Nếu có `review`, có thể upload preview JSON lên ChatGPT để cùng kiểm tra.

## 7. Xử lý category chưa resolve

Với account `user_category_v2`, category source ID và runtime ID có thể khác nhau.

Bridge tự học runtime ID từ lịch sử. Nếu category chưa từng xuất hiện, bạn có thể tạo một giao dịch thủ công trong Money Lover Web, bắt request thật và lấy runtime category ID.

Copy:

```text
config\runtime-category-overrides.example.json
```

thành:

```text
config\runtime-category-overrides.json
```

Ví dụ:

```json
{
  "byName": {
    "Di chuyển": "RUNTIME_CATEGORY_ID"
  },
  "bySourceId": {}
}
```

File local này không được commit.

## 8. Import

Khi preview sạch:

```cmd
scripts\import.cmd data\tpbank-2026-09.json
```

Bridge sẽ preview lại lần cuối và hỏi:

```text
Type IMPORT to write N transaction(s):
```

Gõ đúng:

```text
IMPORT
```

Mỗi transaction được ghi tuần tự, có delay mặc định, sau đó bridge đọc lại transaction để verify.

Kết quả:

```text
out\tpbank-2026-09.import-result.json
```

Bạn có thể upload file này cho ChatGPT để đối soát cuối.

## 9. Nếu import dừng giữa chừng

Không xoá tay hoặc chạy mù.

Chạy lại preview:

```cmd
scripts\preview.cmd data\tpbank-2026-09.json
```

Các transaction đã tạo thành công sẽ chuyển thành `skip / exact_duplicate`, còn transaction chưa tạo vẫn là `ready`. Vì vậy workflow có thể resume an toàn.

## 10. Các flag nâng cao

Chỉ dùng khi hiểu rõ:

```cmd
node scripts\batch.mjs import data\file.json --allow-review
```

Cho phép import các row đang `review`.

```cmd
node scripts\batch.mjs import data\file.json --allow-mismatch
```

Bỏ qua bảo vệ reconciliation. Không nên dùng cho sao kê chuẩn.

```cmd
node scripts\batch.mjs import data\file.json --allow-shared-wallet
```

Bỏ qua owner guard. API Money Lover vẫn có thể từ chối write shared wallet.

## 11. Cập nhật merchant mapping

`config\merchant-rules.json` dùng để tự gán category khi JSON chưa có `categoryName`.

Ví dụ:

```json
{
  "name": "Fuel",
  "contains": ["PLX_", "PETROLIMEX"],
  "categoryName": "Xăng xe"
}
```

Category name phải khớp đúng tên category đang có trong ví Money Lover.

## 12. Bảo mật

- Không gửi token/cookie vào ChatGPT.
- Nếu từng paste token/cookie vào chat/log/shared file, coi như đã lộ và rotate session.
- Không commit `data/`, `out/`, `.env`, runtime override local hoặc session-env local.
- Không dùng token shared-wallet khi mục tiêu là write vào ví owner.
- API này là unofficial; kiểm tra preview trước mọi batch import.
