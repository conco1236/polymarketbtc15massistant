const STATE_KEY = "agent:state";
const DEFAULTS = {
  gammaBase: "https://gamma-api.polymarket.com",
  clobBase: "https://clob.polymarket.com",
  binanceBase: "https://api.binance.com",
  seriesId: "10192",
  seriesSlug: "btc-up-or-down-15m",
  minEdge: 0.05,
  feeRate: 0.02,
  slippageRate: 0.02,
  maxSpread: 0.08,
  maxSignalAgeMs: 120_000,
  approxPriceToBeat: false
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeTime(value) {
  const n = num(value);
  if (n !== null) return n < 1e12 ? n * 1000 : n;
  const t = new Date(value || "").getTime();
  return Number.isFinite(t) ? t : null;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function fetchMarketData(config) {
  const provider = String(config.MARKET_DATA_PROVIDER ?? "binance").toLowerCase();
  if (provider === "coinbase") {
    const base = config.COINBASE_BASE_URL ?? "https://api.exchange.coinbase.com";
    const [rows, ticker] = await Promise.all([
      fetchJson(`${base}/products/BTC-USD/candles?granularity=60`),
      fetchJson(`${base}/products/BTC-USD/ticker`)
    ]);
    const klines = rows
      .slice(0, 120)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([time, low, high, open, close, volume]) => [time, open, high, low, close, volume]);
    return { klines, spot: { price: ticker?.price } };
  }

  const base = config.BINANCE_BASE ?? "https://api.binance.com";
  const [klines, spot] = await Promise.all([
    fetchJson(`${base}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=120`),
    fetchJson(`${base}/api/v3/ticker/price?symbol=BTCUSDT`)
  ]);
  return { klines, spot };
}

function parseTokenIds(market) {
  const direct = jsonArray(market?.clobTokenIds ?? market?.clob_token_ids);
  if (direct.length >= 2) return direct.slice(0, 2).map(String);
  const tokens = Array.isArray(market?.tokens) ? market.tokens : [];
  return tokens.map((token) => token?.token_id ?? token?.tokenId ?? token?.id).filter(Boolean).slice(0, 2).map(String);
}

function marketPriceToBeat(market) {
  for (const key of ["priceToBeat", "price_to_beat", "strikePrice", "strike_price", "threshold", "referencePrice"]) {
    const value = num(market?.[key]);
    if (value !== null && value > 1_000) return value;
  }
  const text = String(market?.question ?? market?.title ?? "");
  const match = text.match(/price\s*to\s*beat[^\d$]*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (!match) return null;
  const value = num(match[1].replaceAll(",", ""));
  return value !== null && value > 1_000 ? value : null;
}

function chooseMarket(events, nowMs) {
  const markets = [];
  for (const event of Array.isArray(events) ? events : []) {
    for (const market of Array.isArray(event?.markets) ? event.markets : []) markets.push(market);
  }
  return markets
    .filter((market) => {
      const slug = String(market?.slug ?? "").toLowerCase();
      const question = String(market?.question ?? market?.title ?? "").toLowerCase();
      const endMs = safeTime(market?.endDate);
      return (slug.includes("btc") || question.includes("bitcoin")) &&
        /(up|down)/i.test(`${slug} ${question}`) && endMs !== null && nowMs < endMs;
    })
    .sort((a, b) => (safeTime(a.endDate) ?? Infinity) - (safeTime(b.endDate) ?? Infinity))[0] ?? null;
}

function summarizeBook(book) {
  const bids = Array.isArray(book?.bids) ? book.bids : [];
  const asks = Array.isArray(book?.asks) ? book.asks : [];
  const bestBid = bids.map((x) => num(x?.price)).filter((x) => x !== null).sort((a, b) => b - a)[0] ?? null;
  const bestAsk = asks.map((x) => num(x?.price)).filter((x) => x !== null).sort((a, b) => a - b)[0] ?? null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const askLiquidity = asks.slice(0, 5).reduce((sum, x) => sum + (num(x?.size) ?? 0), 0);
  const bidLiquidity = bids.slice(0, 5).reduce((sum, x) => sum + (num(x?.size) ?? 0), 0);
  return { bestBid, bestAsk, spread, askLiquidity, bidLiquidity };
}

function sma(values, period) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function slope(values, points) {
  if (values.length < points) return null;
  const slice = values.slice(-points);
  return (slice.at(-1) - slice[0]) / Math.max(1, points - 1);
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  return clamp(100 - 100 / (1 + gains / period / (losses / period)), 0, 100);
}

function ema(values, period) {
  if (values.length < period) return [];
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = [current];
  for (const value of values.slice(period)) {
    current = (value - current) * multiplier + current;
    result.push(current);
  }
  return result;
}

function macd(values) {
  if (values.length < 35) return null;
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const series = slow.map((value, index) => fast[index + (fast.length - slow.length)] - value);
  const signal = ema(series, 9);
  if (!signal.length) return null;
  const macdValue = series.at(-1);
  const signalValue = signal.at(-1);
  const previous = series.length > 1 ? series.at(-2) : macdValue;
  return { macd: macdValue, signal: signalValue, hist: macdValue - signalValue, histDelta: macdValue - previous };
}

function vwap(candles) {
  let pv = 0;
  let volume = 0;
  for (const candle of candles) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    pv += typical * candle.volume;
    volume += candle.volume;
  }
  return volume > 0 ? pv / volume : null;
}

function score(raw) {
  let up = 1;
  let down = 1;
  if (raw.price !== null && raw.vwap !== null) raw.price > raw.vwap ? up += 2 : down += 2;
  if (raw.vwapSlope !== null) raw.vwapSlope > 0 ? up += 2 : down += 2;
  if (raw.rsi !== null && raw.rsiSlope !== null) {
    if (raw.rsi > 55 && raw.rsiSlope > 0) up += 2;
    if (raw.rsi < 45 && raw.rsiSlope < 0) down += 2;
  }
  if (raw.macd) {
    if (raw.macd.hist > 0 && raw.macd.histDelta > 0) up += 2;
    if (raw.macd.hist < 0 && raw.macd.histDelta < 0) down += 2;
    if (raw.macd.macd > 0) up += 1;
    if (raw.macd.macd < 0) down += 1;
  }
  return { upScore: up, downScore: down, rawUp: up / (up + down) };
}

function decide({ remainingMinutes, edgeUp, edgeDown, modelUp, modelDown }) {
  const phase = remainingMinutes > 10 ? "EARLY" : remainingMinutes > 5 ? "MID" : "LATE";
  const threshold = phase === "EARLY" ? 0.05 : phase === "MID" ? 0.1 : 0.2;
  const minProb = phase === "EARLY" ? 0.55 : phase === "MID" ? 0.6 : 0.65;
  if (edgeUp === null || edgeDown === null) return { action: "NO_TRADE", reason: "missing_market_data", phase };
  const side = edgeUp > edgeDown ? "UP" : "DOWN";
  const edge = side === "UP" ? edgeUp : edgeDown;
  const model = side === "UP" ? modelUp : modelDown;
  if (edge < threshold) return { action: "NO_TRADE", reason: `edge_below_${threshold}`, phase };
  if (model < minProb) return { action: "NO_TRADE", reason: `prob_below_${minProb}`, phase };
  return { action: "ENTER", side, edge, phase, strength: edge >= 0.2 ? "STRONG" : edge >= 0.1 ? "GOOD" : "OPTIONAL" };
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function telegram(env, message) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { status: "DISABLED" };
  try {
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML", disable_web_page_preview: true })
    });
    return { status: response.ok ? "SENT" : "FAILED", code: response.status };
  } catch {
    return { status: "FAILED" };
  }
}

async function loadState(env) {
  return (await env.AGENT_STATE?.get(STATE_KEY, "json")) ?? { lastHealth: null, lastAlertKey: null, lastRunAt: null };
}

async function saveState(env, state) {
  if (env.AGENT_STATE) await env.AGENT_STATE.put(STATE_KEY, JSON.stringify(state));
}

async function run(env) {
  const startedAt = Date.now();
  const state = await loadState(env);
  const config = { ...DEFAULTS, ...env };
  const now = Date.now();
  try {
    const eventsUrl = new URL("/events", config.GAMMA_BASE_URL ?? config.gammaBase);
    eventsUrl.searchParams.set("series_id", String(config.POLYMARKET_SERIES_ID ?? config.seriesId));
    eventsUrl.searchParams.set("active", "true");
    eventsUrl.searchParams.set("closed", "false");
    eventsUrl.searchParams.set("limit", "20");
    const market = chooseMarket(await fetchJson(eventsUrl), now);
    if (!market) throw new Error("NO_ACTIVE_BTC_MARKET");

    const tokens = parseTokenIds(market);
    if (tokens.length < 2) throw new Error("CLOB_TOKEN_IDS_MISSING");
    const clobBase = config.CLOB_BASE_URL ?? config.clobBase;
    const [upPrice, downPrice, upBook, downBook, marketData] = await Promise.all([
      fetchJson(`${clobBase}/price?token_id=${encodeURIComponent(tokens[0])}&side=BUY`),
      fetchJson(`${clobBase}/price?token_id=${encodeURIComponent(tokens[1])}&side=BUY`),
      fetchJson(`${clobBase}/book?token_id=${encodeURIComponent(tokens[0])}`),
      fetchJson(`${clobBase}/book?token_id=${encodeURIComponent(tokens[1])}`),
      fetchMarketData(config)
    ]);

    const candles = marketData.klines.map((row) => ({ open: num(row[1]), high: num(row[2]), low: num(row[3]), close: num(row[4]), volume: num(row[5]) })).filter((c) => Object.values(c).every((v) => v !== null));
    const closes = candles.map((c) => c.close);
    const lastClose = closes.at(-1);
    const vwapValue = vwap(candles);
    const scoreValue = score({ price: lastClose, vwap: vwapValue, vwapSlope: slope(closes.slice(-20), 10), rsi: rsi(closes), rsiSlope: slope(closes.slice(-6).map((_, i) => rsi(closes.slice(0, closes.length - 5 + i + 1)) ?? 50), 5), macd: macd(closes) });
    const timeLeftMin = Math.max(0, ((safeTime(market.endDate) ?? now) - now) / 60_000);
    const adjustedUp = clamp(0.5 + (scoreValue.rawUp - 0.5) * clamp(timeLeftMin / 15, 0, 1), 0, 1);
    const adjustedDown = 1 - adjustedUp;
    const marketUp = num(upPrice?.price);
    const marketDown = num(downPrice?.price);
    const sum = marketUp !== null && marketDown !== null ? marketUp + marketDown : null;
    const edgeUp = sum ? adjustedUp - marketUp / sum : null;
    const edgeDown = sum ? adjustedDown - marketDown / sum : null;
    const policy = decide({ remainingMinutes: timeLeftMin, edgeUp, edgeDown, modelUp: adjustedUp, modelDown: adjustedDown });
    const upBookValue = summarizeBook(upBook);
    const downBookValue = summarizeBook(downBook);
    const selectedBook = policy.side === "UP" ? upBookValue : downBookValue;
    const selectedPrice = policy.side === "UP" ? marketUp : marketDown;
    const netEdge = policy.edge === undefined ? null : policy.edge - Number(config.AGENT_FEE_RATE ?? config.feeRate) - Number(config.AGENT_SLIPPAGE_RATE ?? config.slippageRate);
    const priceToBeat = marketPriceToBeat(market);
    const approximatePriceToBeat = priceToBeat ?? (config.AGENT_APPROX_PRICE_TO_BEAT === "true" ? num(marketData.spot?.price) : null);
    const guardReasons = [];
    if (approximatePriceToBeat === null) guardReasons.push("PRICE_TO_BEAT_MISSING");
    if (policy.action !== "ENTER") guardReasons.push(policy.reason);
    if (selectedPrice === null || selectedPrice <= 0 || selectedPrice >= 1) guardReasons.push("MARKET_PRICE_INVALID");
    if (selectedBook?.spread === null || selectedBook.spread > Number(config.AGENT_MAX_SPREAD ?? config.maxSpread)) guardReasons.push("SPREAD_TOO_WIDE");
    if (netEdge === null || netEdge < Number(config.AGENT_MIN_NET_EDGE ?? config.minEdge)) guardReasons.push("NET_EDGE_TOO_LOW");

    const decisionId = `${String(market.slug)}:${Math.floor((safeTime(market.startDate) ?? now) / 60_000)}:${policy.side ?? "NONE"}`;
    const status = policy.action === "ENTER" && guardReasons.length === 0 ? "PAPER_FILLED" : "BLOCKED";
    const decision = { decisionId, marketSlug: market.slug, status, side: policy.side ?? null, price: selectedPrice, netEdge, reasonCodes: guardReasons, timeLeftMin, priceToBeat: approximatePriceToBeat, source: priceToBeat === null ? "worker_approx_or_missing" : "market_metadata" };

    const alertKey = `${status}:${decisionId}:${guardReasons.join(",")}`;
    const shouldAlert = status === "PAPER_FILLED" || (status === "BLOCKED" && String(env.SEND_BLOCKED_ALERTS ?? "true").toLowerCase() === "true");
    if (alertKey !== state.lastAlertKey && shouldAlert) {
      const message = status === "PAPER_FILLED"
        ? ["<b>POLY WORKER PAPER FILL</b>", `Side: <b>${escapeHtml(decision.side)}</b>`, `Market: <code>${escapeHtml(decision.marketSlug)}</code>`, `Price: ${escapeHtml(decision.price)}`, `Net edge: ${escapeHtml(decision.netEdge)}`, `Decision: <code>${escapeHtml(decision.decisionId)}</code>`].join("\n")
        : ["<b>POLY WORKER BLOCKED</b>", `Market: <code>${escapeHtml(decision.marketSlug)}</code>`, `Reasons: <code>${escapeHtml(guardReasons.join(", "))}</code>`].join("\n");
      const delivery = await telegram(env, message);
      if (delivery.status === "SENT") state.lastAlertKey = alertKey;
    }

    state.lastRunAt = new Date().toISOString();
    state.lastHealth = { status: status === "BLOCKED" ? "DEGRADED" : "HEALTHY", state: status, market: market.slug, checkedAt: state.lastRunAt, durationMs: Date.now() - startedAt, telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) };
    await saveState(env, state);
    return state.lastHealth;
  } catch (error) {
    state.lastRunAt = new Date().toISOString();
    state.lastHealth = { status: "DEGRADED", state: "ERROR", error: String(error?.message ?? error).slice(0, 300), checkedAt: state.lastRunAt, durationMs: Date.now() - startedAt };
    const alertKey = `ERROR:${state.lastHealth.error}`;
    if (alertKey !== state.lastAlertKey) {
      const delivery = await telegram(env, `<b>POLY WORKER ERROR</b>\n<code>${escapeHtml(state.lastHealth.error)}</code>`);
      if (delivery.status === "SENT") state.lastAlertKey = alertKey;
    }
    await saveState(env, state);
    return state.lastHealth;
  }
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(run(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      const state = await loadState(env);
      return Response.json({ ok: state.lastHealth?.status !== "DEGRADED", ...state.lastHealth });
    }
    if (url.pathname === "/run") {
      const expected = env.RUN_TOKEN;
      const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!expected || provided !== expected) return new Response("Unauthorized", { status: 401 });
      return Response.json(await run(env));
    }
    return new Response("polymarket paper worker", { status: 200 });
  }
};

export { run };
