import { extractPriceToBeat } from "./contracts.js";

export class PriceToBeatTracker {
  constructor({ latchWindowMs = 5_000 } = {}) {
    this.latchWindowMs = latchWindowMs;
    this.slug = null;
    this.value = null;
    this.source = null;
    this.latchedAt = null;
  }

  observe({ market, currentPrice, nowMs = Date.now() }) {
    const slug = String(market?.slug || market?.id || "");
    if (slug && slug !== this.slug) {
      this.slug = slug;
      this.value = null;
      this.source = null;
      this.latchedAt = null;
    }

    const official = extractPriceToBeat(market);
    if (official !== null) {
      this.value = official;
      this.source = "market_metadata";
      return { value: official, source: this.source, latchedAt: this.latchedAt };
    }

    const startMs = market?.eventStartTime || market?.startTime || market?.startDate;
    const start = Number(startMs) || new Date(startMs || "").getTime();
    const price = Number(currentPrice);
    const withinWindow = Number.isFinite(start) && nowMs >= start && nowMs - start <= this.latchWindowMs;
    if (this.value === null && withinWindow && Number.isFinite(price) && price > 1_000) {
      this.value = price;
      this.source = "chainlink_start_tick";
      this.latchedAt = nowMs;
    }

    return { value: this.value, source: this.source, latchedAt: this.latchedAt };
  }
}
