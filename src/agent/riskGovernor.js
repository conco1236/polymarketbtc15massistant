const DEFAULT_RISK_CONFIG = {
  maxSpread: 0.08,
  minLiquidity: 100,
  minNetEdge: 0.05,
  maxSignalAgeMs: 5_000,
  cooldownMs: 30_000,
  feeRate: 0.02,
  slippageRate: 0.02,
  maxPaperNotional: 100,
  liveExecution: false,
  killSwitch: false
};

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function check(code, pass, value, limit, reason) {
  return { code, pass, value, limit, reason: pass ? null : reason };
}

export function evaluateRisk({ observation, model, decision, priorDecision = null, config = {} }) {
  const cfg = { ...DEFAULT_RISK_CONFIG, ...config };
  const checks = [];
  const side = decision?.side;
  const marketPrice = side === "UP" ? observation?.prices?.up : observation?.prices?.down;
  const book = side === "UP" ? observation?.orderbook?.up : observation?.orderbook?.down;
  const spread = finite(book?.spread);
  const liquidity = finite(book?.askLiquidity ?? book?.bidLiquidity);
  const grossEdge = finite(side === "UP" ? model?.edgeUp : model?.edgeDown);
  const netEdge = grossEdge === null ? null : grossEdge - cfg.feeRate - cfg.slippageRate;
  const signalAge = observation?.freshness?.quote?.ageMs;

  checks.push(check("MARKET_VERIFIED", observation?.market?.verified === true, observation?.market?.verified, true, observation?.market?.verificationReason || "MARKET_INVALID"));
  checks.push(check("PRICE_TO_BEAT_PRESENT", finite(observation?.market?.priceToBeat) !== null, observation?.market?.priceToBeat, "finite", "PRICE_TO_BEAT_MISSING"));
  checks.push(check("QUOTE_FRESH", observation?.freshness?.quote?.fresh === true, signalAge, cfg.maxSignalAgeMs, "STALE_QUOTE"));
  checks.push(check("CHAINLINK_FRESH", observation?.freshness?.chainlink?.fresh === true, observation?.freshness?.chainlink?.ageMs, cfg.maxSignalAgeMs, "STALE_CHAINLINK"));
  checks.push(check("SIDE_SELECTED", side === "UP" || side === "DOWN", side, "UP|DOWN", "NO_SIDE"));
  checks.push(check("MARKET_PRICE_VALID", marketPrice !== null && marketPrice > 0 && marketPrice < 1, marketPrice, "0..1", "MARKET_PRICE_INVALID"));
  checks.push(check("MAX_SPREAD", spread !== null && spread <= cfg.maxSpread, spread, cfg.maxSpread, "SPREAD_TOO_WIDE"));
  checks.push(check("MIN_LIQUIDITY", liquidity === null || liquidity >= cfg.minLiquidity, liquidity, cfg.minLiquidity, "LIQUIDITY_TOO_LOW"));
  checks.push(check("NET_EDGE", netEdge !== null && netEdge >= cfg.minNetEdge, netEdge, cfg.minNetEdge, "NET_EDGE_TOO_LOW"));
  checks.push(check("KILL_SWITCH_OFF", cfg.killSwitch !== true, cfg.killSwitch, false, "KILL_SWITCH_ACTIVE"));
  checks.push(check("LIVE_EXECUTION_DISABLED", cfg.liveExecution !== true, cfg.liveExecution, false, "LIVE_EXECUTION_NOT_ALLOWED"));

  const lastDecisionAt = priorDecision?.createdAtMs ?? null;
  const cooldownPass = lastDecisionAt === null || Date.now() - lastDecisionAt >= cfg.cooldownMs || priorDecision?.candleKey !== observation?.candleKey;
  checks.push(check("COOLDOWN", cooldownPass, lastDecisionAt, cfg.cooldownMs, "COOLDOWN_ACTIVE"));

  const failed = checks.filter((item) => !item.pass);
  const approved = decision?.status === "CANDIDATE" && failed.length === 0;

  return {
    approved,
    status: approved ? "APPROVED" : "BLOCKED",
    checks,
    failedReasons: failed.map((item) => item.reason),
    economics: {
      marketPrice,
      grossEdge,
      netEdge,
      feeRate: cfg.feeRate,
      slippageRate: cfg.slippageRate,
      maxPaperNotional: cfg.maxPaperNotional
    }
  };
}

export { DEFAULT_RISK_CONFIG };
