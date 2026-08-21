function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export class TelegramNotifier {
  constructor({ token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID, minIntervalMs = 10_000, fetchImpl = fetch } = {}) {
    this.token = token;
    this.chatId = chatId;
    this.minIntervalMs = minIntervalMs;
    this.fetchImpl = fetchImpl;
    this.lastSentAt = 0;
    this.lastHealthStatus = null;
    this.lastBlockedKey = null;
    this.lastErrorKey = null;
  }

  get enabled() {
    return Boolean(this.token && this.chatId);
  }

  async send(text, { force = false } = {}) {
    if (!this.enabled) return { status: "DISABLED" };
    const now = Date.now();
    if (!force && now - this.lastSentAt < this.minIntervalMs) return { status: "RATE_LIMITED" };

    const endpoint = `https://api.telegram.org/bot${encodeURIComponent(this.token)}/sendMessage`;
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true
        }),
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) return { status: "FAILED", code: response.status };
      this.lastSentAt = now;
      return { status: "SENT" };
    } catch {
      return { status: "FAILED" };
    }
  }

  async notifyDecision(decision) {
    if (!decision) return { status: "IGNORED" };
    if (decision.status === "PAPER_FILLED") {
      const text = [
        "<b>POLY PAPER FILL</b>",
        `Side: <b>${escapeHtml(decision.side)}</b>`,
        `Market: <code>${escapeHtml(decision.marketSlug)}</code>`,
        `Price: ${escapeHtml(decision.action?.price)}`,
        `Net edge: ${escapeHtml(decision.economics?.netEdge)}`,
        `Decision: <code>${escapeHtml(decision.decisionId)}</code>`
      ].join("\n");
      return this.send(text, { force: true });
    }

    if (decision.status === "BLOCKED") {
      const key = `${decision.candleKey}:${(decision.reasonCodes || []).join(",")}`;
      if (key === this.lastBlockedKey) return { status: "DEDUPLICATED" };
      this.lastBlockedKey = key;
      return this.send([
        "<b>POLY AGENT BLOCKED</b>",
        `Reason: <code>${escapeHtml((decision.reasonCodes || []).join(", "))}</code>`,
        `Market: <code>${escapeHtml(decision.marketSlug)}</code>`
      ].join("\n"));
    }

    return { status: "IGNORED" };
  }

  async notifyHealth(health) {
    if (!health || health.status === this.lastHealthStatus) return { status: "DEDUPLICATED" };
    this.lastHealthStatus = health.status;
    if (health.status === "HEALTHY") return { status: "IGNORED" };
    return this.send([
      `<b>POLY AGENT ${escapeHtml(health.status)}</b>`,
      `State: <code>${escapeHtml(health.state)}</code>`,
      `Stale feeds: <code>${escapeHtml((health.staleFeeds || []).join(", ") || "none")}</code>`
    ].join("\n"));
  }

  async notifyError(error) {
    const message = String(error?.message ?? error ?? "unknown error").slice(0, 300);
    const key = message;
    if (key === this.lastErrorKey) return { status: "DEDUPLICATED" };
    this.lastErrorKey = key;
    return this.send(`<b>POLY AGENT ERROR</b>\n<code>${escapeHtml(message)}</code>`);
  }
}
