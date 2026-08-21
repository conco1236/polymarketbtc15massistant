# Cloudflare Worker paper deployment

## Mô hình

Bản này là **scheduled stateless worker**, không giữ WebSocket sống liên tục. Cloudflare Cron Trigger chạy mỗi phút, Worker gọi REST API public, tính một decision paper, ghi health/dedupe state vào KV và gửi Telegram nếu trạng thái decision thay đổi. Live order execution không tồn tại trong Worker.

Cloudflare Workers Free hiện có 100.000 request/ngày và 10 ms CPU/invocation; Cron Trigger dùng `scheduled()` và có thể chạy theo cron năm trường. Free signup của Cloudflare được quảng bá là không cần thẻ. Thay đổi cron có thể mất vài phút để propagate.

## Chuẩn bị tài khoản

Tạo tài khoản Cloudflare Free, không cần thêm thẻ, sau đó đăng nhập Wrangler từ thư mục này:

```bash
cd cloudflare-worker
npm install
npx wrangler login
```

Lệnh login sẽ mở trang xác thực trong trình duyệt. Không gửi token Cloudflare trong chat.

## Tạo KV state

```bash
npx wrangler kv namespace create AGENT_STATE
```

Copy `id` trả về vào trường `id` trong `wrangler.toml`, thay cho `REPLACE_WITH_KV_NAMESPACE_ID`.

## Cấu hình Telegram secrets

Tạo bot bằng `@BotFather`, gửi một tin nhắn cho bot và lấy `chat_id` bằng Bot API. Nạp secrets qua prompt ẩn của Wrangler:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Nếu muốn gọi `/run` thủ công, thêm token riêng:

```bash
npx wrangler secret put RUN_TOKEN
```

Không đặt Telegram token trong `wrangler.toml`, GitHub, URL hoặc log.

## Deploy

```bash
npx wrangler deploy
```

Sau khi deploy, kiểm tra health bằng URL Worker:

```bash
curl https://<worker-subdomain>.workers.dev/healthz
```

Endpoint `/run` yêu cầu `Authorization: Bearer <RUN_TOKEN>` và chỉ dùng để smoke test; Cron Trigger tự gọi `scheduled()` không cần endpoint này.

## Kết quả và giới hạn

Worker sẽ gửi alert cho `PAPER_FILL`, `BLOCKED/DEGRADED` và lỗi. Nếu market thiếu `PRICE_TO_BEAT`, Worker vẫn BLOCKED mặc định. Không bật `AGENT_APPROX_PRICE_TO_BEAT=true` khi chưa chấp nhận rủi ro của việc dùng giá spot thay thế.

Worker không tương đương bản Node/WebSocket 24/7: nó chỉ đánh giá theo nhịp cron và sử dụng REST snapshot. Đây là phương án không thẻ phù hợp cho paper monitoring; nếu cần tick-level realtime hoặc WebSocket liên tục, cần máy luôn bật hoặc hosting persistent có yêu cầu thanh toán.

## Kiểm thử cục bộ

```bash
node --test
npx wrangler dev --test-scheduled
```
