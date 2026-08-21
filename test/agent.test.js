import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCandleKey, buildDecisionId, extractPriceToBeat, freshnessCheck, verifyBtc15mMarket } from "../src/agent/contracts.js";
import { evaluateRisk } from "../src/agent/riskGovernor.js";
import { SignalAgent } from "../src/agent/agent.js";
import { PaperExecutor } from "../src/agent/paperExecutor.js";
import { resolveBinaryOutcome } from "../src/agent/settlement.js";

function validObservation(overrides = {}) {
  return {
    candleKey: "btc-updown-15m-1m-1000",
    collectedAt: new Date().toISOString(),
    market: {
      slug: "btc-updown-15m-1000",
      verified: true,
      verificationReason: "MARKET_VERIFIED",
      priceToBeat: 74_000
    },
    prices: { up: 0.45, down: 0.55, chainlink: 74_010, binance: 74_012 },
    orderbook: {
      up: { spread: 0.01, askLiquidity: 1_000, bidLiquidity: 1_000 },
      down: { spread: 0.01, askLiquidity: 1_000, bidLiquidity: 1_000 }
    },
    freshness: {
      quote: { ageMs: 100, maxAgeMs: 5_000, fresh: true },
      chainlink: { ageMs: 100, maxAgeMs: 5_000, fresh: true },
      market: { ageMs: 100, maxAgeMs: 10_000, fresh: true },
      binance: { ageMs: 100, maxAgeMs: 10_000, fresh: true }
    },
    ...overrides
  };
}

test("contracts create stable keys and extract official price-to-beat", () => {
  const market = { slug: "btc-updown-15m-1000", priceToBeat: "74000" };
  assert.equal(extractPriceToBeat(market), 74000);
  const key = buildCandleKey({ marketSlug: market.slug, candleStartMs: 1000 });
  assert.equal(key, "btc-updown-15m-1000:1m:1000");
  assert.equal(buildDecisionId({ candleKey: key, policyVersion: "v1", side: "UP" }).length, 24);
});

test("market validation rejects non-BTC or closed market", () => {
  assert.equal(verifyBtc15mMarket({ slug: "eth-updown-15m", question: "Ethereum Up or Down", endDate: Date.now() + 60_000 }).ok, false);
  assert.equal(verifyBtc15mMarket({ slug: "btc-updown-15m", question: "Bitcoin Up or Down", endDate: Date.now() - 1 }).reason, "MARKET_CLOSED");
  assert.equal(verifyBtc15mMarket({ slug: "btc-updown-15m", question: "Bitcoin Up or Down", endDate: Date.now() + 60_000 }).ok, true);
});

test("freshness check rejects missing or old timestamps", () => {
  const now = Date.now();
  assert.equal(freshnessCheck(now - 100, 1_000, now).fresh, true);
  assert.equal(freshnessCheck(now - 2_000, 1_000, now).fresh, false);
  assert.equal(freshnessCheck(null, 1_000, now).fresh, false);
});

test("risk governor blocks stale and wide-spread candidates", () => {
  const blocked = evaluateRisk({
    observation: validObservation({ freshness: { quote: { ageMs: 8_000, fresh: false }, chainlink: { ageMs: 100, fresh: true } } }),
    model: { edgeUp: 0.2, edgeDown: -0.2 },
    decision: { status: "CANDIDATE", side: "UP" },
    config: { maxSignalAgeMs: 5_000 }
  });
  assert.equal(blocked.approved, false);
  assert.ok(blocked.failedReasons.includes("STALE_QUOTE"));
});

test("SignalAgent approves one paper action and deduplicates the candle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-agent-"));
  const executor = new PaperExecutor({ ledgerPath: path.join(dir, "events.jsonl"), maxNotional: 100 });
  const agent = new SignalAgent({ executor, ledgerPath: path.join(dir, "agent.jsonl"), riskConfig: { minNetEdge: 0.05 } });
  const input = {
    observation: validObservation(),
    scored: { rawUp: 0.8 },
    timeAware: { adjustedUp: 0.8, adjustedDown: 0.2 },
    edge: { edgeUp: 0.35, edgeDown: -0.35 },
    regime: { regime: "TREND_UP" },
    policyDecision: { action: "ENTER", side: "UP", phase: "EARLY", strength: "GOOD" }
  };
  const first = agent.process(input);
  const second = agent.process(input);
  assert.equal(first.status, "PAPER_FILLED");
  assert.equal(second.status, "NO_TRADE");
  assert.equal(second.reasonCodes[0], "CANDLE_ALREADY_PROCESSED");
  assert.equal(agent.health().liveExecution, false);
});

test("paper executor never executes non-paper mode and settlement resolves outcome", () => {
  const executor = new PaperExecutor({ ledgerPath: path.join(os.tmpdir(), `poly-${Date.now()}.jsonl`) });
  assert.equal(executor.execute({ mode: "LIVE", decisionId: "x" }).status, "BLOCKED");
  assert.deepEqual(resolveBinaryOutcome({ currentPrice: 74_010, priceToBeat: 74_000 }), { outcome: "UP", reason: "SETTLEMENT_RESOLVED" });
  assert.deepEqual(resolveBinaryOutcome({ currentPrice: 74_000, priceToBeat: 74_000 }).outcome, null);
});

test("paper executor hydrates filled state and rejects duplicate after restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-restart-"));
  const ledgerPath = path.join(dir, "events.jsonl");
  const first = new PaperExecutor({ ledgerPath, maxNotional: 100 });
  const fill = first.execute({ mode: "PAPER", decisionId: "restart-1", candleKey: "candle-1", marketSlug: "btc-updown-15m", side: "UP", price: 0.4, quantity: 1 });
  assert.equal(fill.status, "PAPER_FILLED");
  const second = new PaperExecutor({ ledgerPath, maxNotional: 100 });
  assert.equal(second.execute({ mode: "PAPER", decisionId: "restart-1", candleKey: "candle-1", marketSlug: "btc-updown-15m", side: "UP", price: 0.4, quantity: 1 }).status, "DUPLICATE");
});

test("price-to-beat tracker only latches a start tick inside the safe window", async () => {
  const { PriceToBeatTracker } = await import("../src/agent/priceToBeat.js");
  const start = Date.now();
  const market = { slug: "btc-updown-15m-safe", question: "Bitcoin Up or Down", startDate: new Date(start).toISOString(), endDate: new Date(start + 900_000).toISOString() };
  const tracker = new PriceToBeatTracker({ latchWindowMs: 5_000 });
  assert.equal(tracker.observe({ market, currentPrice: 74_000, nowMs: start + 2_000 }).source, "chainlink_start_tick");

  const lateTracker = new PriceToBeatTracker({ latchWindowMs: 5_000 });
  assert.equal(lateTracker.observe({ market, currentPrice: 74_000, nowMs: start + 10_000 }).value, null);
});

test("health reports degraded when agent is blocked by invalid observation", async () => {
  const { buildHealthSnapshot } = await import("../src/agent/health.js");
  const fakeAgent = { health: () => ({ state: "DEGRADED", liveExecution: false }) };
  assert.equal(buildHealthSnapshot({ agent: fakeAgent, observation: { freshness: {} } }).status, "DEGRADED");
});
