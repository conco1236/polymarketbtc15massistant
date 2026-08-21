# Deploy thực tế trên Oracle Always Free

## Vì sao chọn Oracle

Agent này là tiến trình Node chạy liên tục, mở WebSocket và tự polling dữ liệu public. Oracle Always Free có compute VM dùng lâu dài, phù hợp hơn các free web-service thường sleep. Tài khoản Oracle yêu cầu xác minh danh tính/thẻ và có thể thiếu capacity ở một số region; không tạo nhiều tài khoản.

## Chuẩn bị

Tạo một VM Ubuntu 22.04/24.04 trong Oracle Always Free, mở SSH, đăng nhập bằng tài khoản `ubuntu`, cài Node.js 22+ và tải source:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Clone nhánh đã build:

```bash
git clone --depth=1 --branch agent/paper-trading-core \
  https://github.com/conco1236/PolymarketBTC15mAssistant.git \
  /tmp/PolymarketBTC15mAssistant
cd /tmp/PolymarketBTC15mAssistant
sudo bash deploy/install-oracle.sh
```

Script sẽ cài app tại `/opt/polymarketbtc15massistant`, tạo service `polymarket-agent`, bật tự khởi động và tạo `/etc/polymarket-agent.env` với quyền `600`.

## Cấu hình Telegram

Trong Telegram, tạo bot bằng `@BotFather`, gửi một tin nhắn cho bot, sau đó lấy `chat_id` bằng Bot API `getUpdates`. Điền hai giá trị thật vào file env trên VM:

```bash
sudo nano /etc/polymarket-agent.env
sudo chmod 600 /etc/polymarket-agent.env
sudo systemctl restart polymarket-agent
```

Không đưa bot token vào Git, URL clone, command line hoặc log. Agent gửi startup, paper fill, block/degraded transition và error alert. Alert chỉ là thông báo trạng thái; agent không đặt lệnh thật.

## Kiểm tra

```bash
sudo systemctl status polymarket-agent --no-pager
sudo journalctl -u polymarket-agent -f
sudo cat /opt/polymarketbtc15massistant/logs/agent_health.json
sudo tail -f /opt/polymarketbtc15massistant/logs/agent_events.jsonl
```

## Cập nhật code

```bash
sudo systemctl stop polymarket-agent
cd /opt/polymarketbtc15massistant
sudo git fetch --depth=1 origin agent/paper-trading-core
sudo git checkout -B agent/paper-trading-core FETCH_HEAD
sudo npm ci --omit=dev --ignore-scripts
sudo systemctl start polymarket-agent
```

## Giới hạn và rủi ro

Oracle Always Free không phải SLA production: account có thể cần xác minh, VM có thể gặp capacity/maintenance, và idle account có thể bị xử lý theo chính sách nhà cung cấp. Dùng firewall chỉ mở SSH từ IP tin cậy nếu có thể; không mở cổng inbound cho agent vì Telegram dùng outbound HTTPS. Giữ `LIVE_EXECUTION=false`/paper-only và không thêm private key vào VM.

Nếu không muốn đăng ký Oracle, có thể chạy cùng service trên máy cá nhân luôn bật. Render Free phù hợp smoke test nhưng không phù hợp agent 24/7 vì free web service có cơ chế spin-down sau inactivity.
