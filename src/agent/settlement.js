export function resolveBinaryOutcome({ currentPrice, priceToBeat }) {
  const price = Number(currentPrice);
  const beat = Number(priceToBeat);
  if (!Number.isFinite(price) || !Number.isFinite(beat)) return { outcome: null, reason: "MISSING_SETTLEMENT_PRICE" };
  if (price === beat) return { outcome: null, reason: "SETTLEMENT_TIE" };
  return { outcome: price > beat ? "UP" : "DOWN", reason: "SETTLEMENT_RESOLVED" };
}

export function settlePaperPosition({ executor, decisionId, currentPrice, priceToBeat }) {
  const resolved = resolveBinaryOutcome({ currentPrice, priceToBeat });
  if (!resolved.outcome) return { status: "PENDING", ...resolved };
  return executor.settle({ decisionId, outcome: resolved.outcome });
}
