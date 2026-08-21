import crypto from "node:crypto";

const DEFAULT_FRESHNESS_MS = {
  market: 600_000,
  quote: 5_000,
  chainlink: 5_000,
  binance: 10_000
};

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeTimeMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = value instanceof Date ? value.getTime() : Number(value);
  if (Number.isFinite(n)) return n < 1_000_000_000_000 ? n * 1000 : n;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function buildCandleKey({ marketSlug, candleStartMs, interval = "1m" }) {
  return [String(marketSlug || "unknown"), interval, String(Number(candleStartMs) || 0)].join(":");
}

export function buildDecisionId({ candleKey, policyVersion = "v1", side = "NONE" }) {
  const input = `${candleKey}|${policyVersion}|${side}`;
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 24);
}

export function extractPriceToBeat(market) {
  if (!market || typeof market !== "object") return null;

  const directKeys = [
    "priceToBeat",
    "price_to_beat",
    "strikePrice",
    "strike_price",
    "strike",
    "threshold",
    "thresholdPrice",
    "threshold_price",
    "targetPrice",
    "target_price",
    "referencePrice",
    "reference_price"
  ];

  for (const key of directKeys) {
    const n = finiteNumber(market[key]);
    if (n !== null && n > 1_000 && n < 2_000_000) return n;
  }

  const text = String(market.question ?? market.title ?? "");
  const match = text.match(/price\s*to\s*beat[^\d$]*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (match) {
    const n = finiteNumber(match[1].replace(/,/g, ""));
    if (n !== null && n > 1_000 && n < 2_000_000) return n;
  }

  return null;
}

export function verifyBtc15mMarket(market, { expectedSeriesId = null } = {}) {
  if (!market || typeof market !== "object") return { ok: false, reason: "MARKET_MISSING" };

  const slug = String(market.slug || "").toLowerCase();
  const question = String(market.question || market.title || "").toLowerCase();
  const hasBtc = slug.includes("btc") || question.includes("bitcoin") || question.includes("btc");
  const hasDirection = /(up|down|up or down)/i.test(`${slug} ${question}`);
  const endMs = safeTimeMs(market.endDate);
  const startMs = safeTimeMs(market.eventStartTime ?? market.startTime ?? market.startDate);
  const now = Date.now();
  const activeByTime = endMs !== null && now < endMs;
  const startedOrUnknown = startMs === null || startMs <= now;
  const marketSeriesId = market.seriesId ?? market.series_id ?? null;
  const seriesMatch = expectedSeriesId === null || expectedSeriesId === undefined || marketSeriesId === null ||
    String(marketSeriesId) === String(expectedSeriesId);

  if (!hasBtc) return { ok: false, reason: "MARKET_NOT_BTC" };
  if (!hasDirection) return { ok: false, reason: "MARKET_NOT_DIRECTIONAL" };
  if (!seriesMatch) return { ok: false, reason: "MARKET_SERIES_MISMATCH" };
  if (endMs === null) return { ok: false, reason: "MARKET_END_MISSING" };
  if (!startedOrUnknown) return { ok: false, reason: "MARKET_NOT_STARTED" };
  if (!activeByTime) return { ok: false, reason: "MARKET_CLOSED" };

  return { ok: true, reason: "MARKET_VERIFIED", slug, startMs, endMs };
}

export function ageMs(updatedAt, nowMs = Date.now()) {
  const time = safeTimeMs(updatedAt);
  if (time === null) return null;
  return Math.max(0, nowMs - time);
}

export function freshnessCheck(updatedAt, maxAgeMs, nowMs = Date.now()) {
  const age = ageMs(updatedAt, nowMs);
  return {
    ageMs: age,
    maxAgeMs,
    known: age !== null,
    fresh: age !== null && age <= maxAgeMs
  };
}

export function normalizeObservation({ market, poly, candles, chainlink, binance, priceToBeatOverride = null, timeLeftMin, nowMs = Date.now(), expectedSeriesId = null, freshness = {} }) {
  const marketVerification = verifyBtc15mMarket(market, { expectedSeriesId });
  const marketStartMs = safeTimeMs(market?.eventStartTime ?? market?.startTime ?? market?.startDate);
  const candleStartMs = marketStartMs ?? (Array.isArray(candles) && candles.length ? safeTimeMs(candles.at(-1)?.openTime) : null) ?? nowMs;
  const marketSlug = String(market?.slug || "unknown");
  const quoteCapturedAt = poly?.capturedAt ?? null;
  const marketUpdatedAt = market?.updatedAt ?? market?.lastUpdatedAt ?? poly?.capturedAt ?? null;
  const latestCandle = Array.isArray(candles) && candles.length ? candles.at(-1) : null;
  const chainlinkUpdatedAt = chainlink?.receivedAt ?? chainlink?.updatedAt ?? null;
  const binanceUpdatedAt = binance?.receivedAt ?? binance?.updatedAt ?? binance?.ts ?? latestCandle?.closeTime ?? null;

  return {
    observationId: crypto.randomUUID(),
    candleKey: buildCandleKey({ marketSlug, candleStartMs, interval: "1m" }),
    collectedAt: new Date(nowMs).toISOString(),
    market: {
      slug: marketSlug,
      question: market?.question ?? market?.title ?? null,
      startMs: marketStartMs,
      endMs: safeTimeMs(market?.endDate),
      priceToBeat: extractPriceToBeat(market) ?? finiteNumber(priceToBeatOverride),
      verified: marketVerification.ok,
      verificationReason: marketVerification.reason
    },
    prices: {
      up: finiteNumber(poly?.prices?.up),
      down: finiteNumber(poly?.prices?.down),
      chainlink: finiteNumber(chainlink?.price),
      binance: finiteNumber(binance?.price)
    },
    orderbook: poly?.orderbook ?? null,
    candles: {
      interval: "1m",
      count: Array.isArray(candles) ? candles.length : 0,
      closedThroughMs: latestCandle?.closeTime ?? null
    },
    timeLeftMin: finiteNumber(timeLeftMin),
    freshness: {
      market: freshnessCheck(marketUpdatedAt, freshness.market ?? DEFAULT_FRESHNESS_MS.market, nowMs),
      quote: freshnessCheck(quoteCapturedAt, freshness.quote ?? DEFAULT_FRESHNESS_MS.quote, nowMs),
      chainlink: freshnessCheck(chainlinkUpdatedAt, freshness.chainlink ?? DEFAULT_FRESHNESS_MS.chainlink, nowMs),
      binance: freshnessCheck(binanceUpdatedAt, freshness.binance ?? DEFAULT_FRESHNESS_MS.binance, nowMs)
    },
    sourceState: {
      polymarket: poly?.ok ? "LIVE" : "ERROR",
      chainlink: chainlink?.price !== null && chainlink?.price !== undefined ? "LIVE" : "MISSING",
      binance: binance?.price !== null && binance?.price !== undefined ? "LIVE" : "MISSING"
    }
  };
}

export function finiteProbability(value) {
  const n = finiteNumber(value);
  return n !== null && n >= 0 && n <= 1;
}

export { DEFAULT_FRESHNESS_MS };
