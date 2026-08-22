# Prompt: Chuẩn hoá sao kê cho Money Lover

Dùng khi upload sao kê PDF/ảnh vào ChatGPT.

```text
Đọc toàn bộ sao kê tôi gửi và chuẩn hoá thành 1 file JSON theo schema của project Avie Money Lover Bridge (`data/example-statement.json`).

Yêu cầu:
- dùng ngày giao dịch làm `date`, ngày hạch toán làm `postDate` nếu có;
- `amount` luôn là số dương;
- phân biệt `direction`: expense hoặc income;
- refund/cashback là income;
- merchant giữ đủ để nhận diện, note viết ngắn gọn dễ đọc;
- map vào đúng tên category Money Lover tôi đang dùng; nếu không chắc category thì đánh `review: true` thay vì tự đoán mạnh;
- tránh tính trùng các giao dịch kỹ thuật, đặc biệt giao dịch gốc đã được chuyển sang trả góp; chỉ giữ phần thực sự phải trả trong kỳ nếu sao kê thể hiện như vậy;
- tính tổng expense, tổng income/refund và `expectedNet = expense - income`;
- đối chiếu `expectedNet` với số dư sao kê/phải thanh toán; nếu không khớp thì không tạo file final cho đến khi giải thích được chênh lệch;
- không đưa token, cookie, email đăng nhập hay secret Money Lover vào JSON.

Output: tạo file JSON hoàn chỉnh để tôi lưu vào thư mục `data/` và chạy preview local.
```
