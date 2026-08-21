# GitHub Actions no-card runner

## Cách hoạt động

Workflow `.github/workflows/polymarket-paper.yml` chạy một paper check mỗi 5 phút và có `workflow_dispatch` để chạy thủ công. Mỗi run là một tiến trình ngắn: lấy REST snapshot, tính signal, áp dụng guard và gửi Telegram. Nó không giữ WebSocket hay đặt lệnh thật.

GitHub yêu cầu scheduled workflow nằm trên **default branch** mới chạy lịch; vì vậy hãy merge nhánh `agent/paper-trading-core` vào `main` của fork, hoặc chép các file workflow/runner vào default branch. GitHub có thể trì hoãn scheduled run và workflow public có thể tự tắt sau thời gian dài không có hoạt động repository.

## Thêm Telegram secrets

Trong repository fork, mở `Settings → Secrets and variables → Actions → New repository secret`, sau đó tạo hai secret sau:

| Secret | Giá trị |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token do `@BotFather` cấp |
| `TELEGRAM_CHAT_ID` | Chat ID nhận cảnh báo |

Không đưa token vào source code hoặc workflow YAML. Workflow chỉ tham chiếu `${{ secrets.TELEGRAM_BOT_TOKEN }}` và `${{ secrets.TELEGRAM_CHAT_ID }}`.

## Bật và kiểm tra

Mở tab `Actions`, chọn **Polymarket paper agent**, bấm **Run workflow** để chạy smoke test. Sau đó xem log job và Telegram. Nếu market thiếu giá mốc settlement, trạng thái sẽ là `BLOCKED` và mặc định không spam blocked alert; paper fill mới tạo cảnh báo.

State dedupe được lưu bằng GitHub Actions cache ở mức best effort. Cache có thể bị evict, vì vậy đôi lúc alert có thể lặp sau khi cache mất. Đây là giới hạn của phương án không thẻ; không dùng workflow này cho live execution.
