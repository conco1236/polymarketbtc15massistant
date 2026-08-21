import { buildDecisionId } from "./contracts.js";
import { evaluateRisk, DEFAULT_RISK_CONFIG } from "./riskGovernor.js";
import { PaperExecutor } from "./paperExecutor.js";
import { EventLedger } from "./eventLedger.js";

const STATES = Object.freeze({
  BOOT: "BOOT",
  WARMING_UP: "WARMING_UP",
  OBSERVING: "OBSERVING",
  VALIDATING: "VALIDATING",
  SCORING: "SCORING",
  DECIDING: "DECIDING",
  NO_TRADE: "NO_TRADE",
  PAPER_EXECUTED: "PAPER_EXECUTED",
  DEGRADED: "DEGRADED",
  HALTED: "HALTED"
});

function nowMs() {
  return Date.now();
}

export class SignalAgent {
  constructor({ policyVersion = "v1", riskConfig = {}, executor = null, ledgerPath = "./logs/agent_events.jsonl" } = {}) {
    this.policyVersion = policyVersion;
    this.riskConfig = { ...DEFAULT_RISK_CONFIG, ...riskConfig };
    this.ledger = new EventLedger(ledgerPath);
    this.executor = executor ?? new PaperExecutor({ ledgerPath, maxNotional: this.riskConfig.maxPaperNotional });
    this.state = STATES.BOOT;
    this.startedAtMs = nowMs();
    this.lastObservation = null;
    this.lastDecision = null;
    this.lastAction = null;
    this.processedCandleKeys = new Set(
      this.ledger.replay()
        .map((event) => event?.payload?.candleKey)
        .filter(Boolean)
    );
    this.blockedCount = 0;
    this.noTradeCount = 0;
    this.errorCount = 0;
  }

  transition(state) {
    this.state = state;
    return state;
  }

  process({ observation, scored, timeAware, edge, regime, policyDecision = null }) {
    const createdAtMs = nowMs();
    this.lastObservation = observation;
    this.transition(STATES.OBSERVING);

    if (!observation?.candleKey || !observation?.market?.verified || Number(observation?.market?.priceToBeat) <= 0) {
      this.transition(STATES.DEGRADED);
      this.blockedCount += 1;
      const reason = !observation?.market?.verified
        ? (observation?.market?.verificationReason || "INVALID_OBSERVATION")
        : "PRICE_TO_BEAT_MISSING";
      const blocked = this.buildBlockedDecision({ observation, createdAtMs, reasonCodes: [reason] });
      this.ledger.append("DECISION_BLOCKED", blocked);
      return blocked;
    }

    this.transition(STATES.VALIDATING);
    this.transition(STATES.SCORING);
    const modelUp = Number(timeAware?.adjustedUp);
    const modelDown = Number(timeAware?.adjustedDown);
    const edgeUp = Number(edge?.edgeUp);
    const edgeDown = Number(edge?.edgeDown);
    const candidateSide = edgeUp > edgeDown ? "UP" : edgeDown > edgeUp ? "DOWN" : null;
    const policyAllowsEntry = policyDecision?.action === "ENTER" && policyDecision?.side === candidateSide;
    const candidate = policyAllowsEntry && Number.isFinite(edgeUp) && Number.isFinite(edgeDown)
      ? { status: "CANDIDATE", side: candidateSide }
      : { status: "NO_TRADE", side: null };

    this.transition(STATES.DECIDING);
    const decisionId = buildDecisionId({ candleKey: observation.candleKey, policyVersion: this.policyVersion, side: candidate.side || "NONE" });
    const duplicate = this.processedCandleKeys.has(observation.candleKey);

    const base = {
      decisionId,
      candleKey: observation.candleKey,
      marketSlug: observation.market.slug,
      createdAt: new Date(createdAtMs).toISOString(),
      createdAtMs,
      policyVersion: this.policyVersion,
      status: candidate.status,
      side: candidate.side,
      model: { up: modelUp, down: modelDown, regime: regime?.regime ?? null, rawUp: scored?.rawUp ?? null },
      edge: { up: edgeUp, down: edgeDown },
      policy: {
        action: policyDecision?.action ?? "NO_TRADE",
        phase: policyDecision?.phase ?? null,
        reason: policyDecision?.reason ?? null,
        strength: policyDecision?.strength ?? null
      },
      sourceTimestamps: {
        collectedAt: observation.collectedAt,
        chainlinkAgeMs: observation.freshness?.chainlink?.ageMs ?? null,
        quoteAgeMs: observation.freshness?.quote?.ageMs ?? null
      },
      duplicate
    };

    if (duplicate) {
      this.noTradeCount += 1;
      this.transition(STATES.NO_TRADE);
      const duplicateDecision = { ...base, status: "NO_TRADE", reasonCodes: ["CANDLE_ALREADY_PROCESSED"], guards: [] };
      return duplicateDecision;
    }

    if (candidate.status !== "CANDIDATE") {
      this.noTradeCount += 1;
      this.transition(STATES.NO_TRADE);
      this.processedCandleKeys.add(observation.candleKey);
      const noTrade = { ...base, status: "NO_TRADE", reasonCodes: ["MODEL_NEUTRAL"], guards: [] };
      this.lastDecision = noTrade;
      this.ledger.append("DECISION_NO_TRADE", noTrade);
      return noTrade;
    }

    const risk = evaluateRisk({
      observation,
      model: { edgeUp, edgeDown },
      decision: candidate,
      priorDecision: this.lastDecision,
      config: this.riskConfig
    });

    const decision = {
      ...base,
      status: risk.approved ? "APPROVED" : "BLOCKED",
      guards: risk.checks,
      economics: risk.economics,
      reasonCodes: risk.failedReasons
    };

    this.processedCandleKeys.add(observation.candleKey);
    this.lastDecision = decision;

    if (!risk.approved) {
      this.blockedCount += 1;
      this.transition(STATES.NO_TRADE);
      this.ledger.append("DECISION_BLOCKED", decision);
      return decision;
    }

    const action = this.executor.execute({
      mode: "PAPER",
      decisionId,
      candleKey: observation.candleKey,
      marketSlug: observation.market.slug,
      side: candidate.side,
      price: candidate.side === "UP" ? observation.prices.up : observation.prices.down,
      quantity: 1
    });

    this.lastAction = action;
    this.transition(action.status === "PAPER_FILLED" ? STATES.PAPER_EXECUTED : STATES.NO_TRADE);
    const result = { ...decision, status: action.status, action };
    this.ledger.append(action.status === "PAPER_FILLED" ? "PAPER_FILLED" : "ACTION_BLOCKED", result);
    return result;
  }

  buildBlockedDecision({ observation, createdAtMs, reasonCodes }) {
    const decisionId = buildDecisionId({ candleKey: observation?.candleKey || "unknown", policyVersion: this.policyVersion, side: "NONE" });
    const decision = {
      decisionId,
      candleKey: observation?.candleKey ?? null,
      marketSlug: observation?.market?.slug ?? null,
      createdAt: new Date(createdAtMs).toISOString(),
      createdAtMs,
      policyVersion: this.policyVersion,
      status: "BLOCKED",
      side: null,
      guards: [],
      reasonCodes
    };
    this.lastDecision = decision;
    return decision;
  }

  health() {
    return {
      state: this.state,
      policyVersion: this.policyVersion,
      startedAt: new Date(this.startedAtMs).toISOString(),
      lastObservationAt: this.lastObservation?.collectedAt ?? null,
      lastDecisionAt: this.lastDecision?.createdAt ?? null,
      lastActionStatus: this.lastAction?.status ?? null,
      processedCandles: this.processedCandleKeys.size,
      blockedCount: this.blockedCount,
      noTradeCount: this.noTradeCount,
      errorCount: this.errorCount,
      liveExecution: false
    };
  }

  halt(reason = "MANUAL_HALT") {
    this.riskConfig.killSwitch = true;
    this.state = STATES.HALTED;
    return { state: this.state, reason };
  }
}

export { STATES };
