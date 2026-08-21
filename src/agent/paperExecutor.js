import fs from "node:fs";
import path from "node:path";

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export class PaperExecutor {
  constructor({ ledgerPath = "./logs/agent_events.jsonl", maxNotional = 100 } = {}) {
    this.ledgerPath = ledgerPath;
    this.maxNotional = maxNotional;
    this.intents = new Map();
    this.positions = new Map();
    this.settlements = new Map();
    this.hydrate();
  }

  hydrate() {
    if (!fs.existsSync(this.ledgerPath)) return;
    const lines = fs.readFileSync(this.ledgerPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const payload = event.payload ?? event;
        if (event.type === "PAPER_FILLED" && payload.decisionId) {
          this.intents.set(payload.decisionId, payload);
          this.positions.set(payload.decisionId, payload);
        }
        if (event.type === "SETTLED" && payload.decisionId) {
          this.settlements.set(payload.decisionId, payload);
          this.positions.delete(payload.decisionId);
        }
      } catch {
        // Ignore one malformed historical line; new events remain appendable.
      }
    }
  }

  append(event) {
    ensureDir(this.ledgerPath);
    fs.appendFileSync(this.ledgerPath, `${JSON.stringify({ ...event, recordedAt: new Date().toISOString() })}\n`, "utf8");
  }

  execute(intent) {
    if (!intent || intent.mode !== "PAPER") {
      return { status: "BLOCKED", reason: "PAPER_ONLY" };
    }
    if (!intent.decisionId || this.intents.has(intent.decisionId)) {
      return { status: "DUPLICATE", decisionId: intent.decisionId ?? null, reason: "DECISION_ALREADY_EXECUTED" };
    }

    const price = finite(intent.price);
    const quantity = finite(intent.quantity ?? 1);
    if (price === null || price <= 0 || price >= 1) return { status: "BLOCKED", reason: "INVALID_PRICE" };
    if (quantity === null || quantity <= 0) return { status: "BLOCKED", reason: "INVALID_QUANTITY" };
    const notional = price * quantity;
    if (notional > this.maxNotional) return { status: "BLOCKED", reason: "PAPER_NOTIONAL_LIMIT" };

    const fill = {
      status: "PAPER_FILLED",
      decisionId: intent.decisionId,
      candleKey: intent.candleKey,
      marketSlug: intent.marketSlug,
      side: intent.side,
      price,
      quantity,
      notional,
      mode: "PAPER",
      filledAt: new Date().toISOString()
    };

    this.intents.set(intent.decisionId, fill);
    this.positions.set(intent.decisionId, fill);
    this.append({ type: "PAPER_FILLED", payload: fill });
    return fill;
  }

  settle({ decisionId, outcome }) {
    if (this.settlements.has(decisionId)) return { status: "DUPLICATE", ...this.settlements.get(decisionId) };
    const fill = this.positions.get(decisionId);
    if (!fill) return { status: "NOT_FOUND", decisionId };
    if (outcome !== "UP" && outcome !== "DOWN") return { status: "BLOCKED", reason: "INVALID_OUTCOME" };

    const won = fill.side === outcome;
    const payout = won ? fill.quantity * (1 - fill.price) : -fill.notional;
    const settled = {
      ...fill,
      status: "SETTLED",
      outcome,
      won,
      pnl: payout,
      settledAt: new Date().toISOString()
    };
    this.positions.delete(decisionId);
    this.settlements.set(decisionId, settled);
    this.append({ type: "SETTLED", payload: settled });
    return settled;
  }
}
