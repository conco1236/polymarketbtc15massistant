import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";

function response(value, ok = true) {
  return { ok, status: ok ? 200 : 500, async json() { return value; } };
}

test("worker run is stateless, persists health and blocks missing price-to-beat", async () => {
  const originalFetch = globalThis.fetch;
  const store = new Map();
  const now = Date.now();
  const market = {
    slug: "btc-updown-15m-test",
    question: "Bitcoin Up or Down",
    startDate: new Date(now - 60_000).toISOString(),
    endDate: new Date(now + 600_000).toISOString(),
    clobTokenIds: JSON.stringify(["up-token", "down-token"])
  };
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes("/events")) return response([{ markets: [market] }]);
    if (value.includes("/price")) return response({ price: value.includes("up-token") ? "0.40" : "0.60" });
    if (value.includes("/book")) return response({ bids: [{ price: "0.39", size: "1000" }], asks: [{ price: "0.41", size: "1000" }] });
    if (value.includes("/ticker/price")) return response({ price: "74000" });
    if (value.includes("/klines")) return response(Array.from({ length: 120 }, (_, index) => {
      const price = 74000 + index;
      return [index, String(price), String(price + 5), String(price - 5), String(price + 1), "10"];
    }));
    throw new Error(`unexpected url: ${value}`);
  };

  const env = {
    POLYMARKET_SERIES_ID: "10192",
    AGENT_STATE: {
      async get(key) { return store.has(key) ? JSON.parse(store.get(key)) : null; },
      async put(key, value) { store.set(key, value); }
    }
  };
  const health = await run(env);
  globalThis.fetch = originalFetch;
  assert.equal(health.status, "DEGRADED");
  assert.equal(health.state, "BLOCKED");
  assert.equal(store.has("agent:state"), true);
});
