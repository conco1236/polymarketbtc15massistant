# Polymarket BTC 15m Assistant — Windows Portable

Bản portable này chạy agent Node.js bằng runtime đi kèm trong thư mục, không cần cài Node.js toàn hệ thống. Agent vẫn ở chế độ **paper-only**; không có private key và không đặt lệnh thật.

## Chuẩn bị

Giải nén toàn bộ thư mục vào một đường dẫn không có ký tự đặc biệt, ví dụ `C:\PolymarketBTC15mAssistant`. Sao chép `.env.example` thành `.env` rồi điền các giá trị Telegram:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

File `.env` chỉ nằm trên máy Windows và không được commit lên GitHub. Có thể bật `SEND_BLOCKED_ALERTS=true` nếu muốn nhận cả cảnh báo bị chặn; mặc định nên để `false` để tránh spam.

## Chạy

Bấm đúp `start-agent.cmd`. Cửa sổ console sẽ hiển thị market, decision, health và paper action. Ledger/health được lưu trong thư mục `logs`.

Để dừng an toàn, nhấn `Ctrl+C` trong cửa sổ console. Không chạy đồng thời nhiều bản agent dùng chung cùng một ledger.

## Kiểm tra Telegram

Khi agent tạo paper fill, nó gửi alert đến chat ID đã cấu hình. Nếu không có fill, agent có thể chỉ hiển thị `BLOCKED` và không gửi message. Để kiểm tra cấu hình mà không đặt lệnh thật, có thể chạy `test-telegram.cmd`; script này chỉ gọi Telegram `getMe` để xác nhận bot token, không gửi message.

## Giới hạn

Bản Windows portable là agent realtime dùng WebSocket và REST trong thời gian cửa sổ console còn chạy. Nó không tự chạy khi Windows khởi động và không có Windows Service; nếu cần tự khởi động, dùng Task Scheduler sau khi đã kiểm tra paper mode.
