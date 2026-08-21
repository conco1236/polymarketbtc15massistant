import fs from "node:fs";
import path from "node:path";

export class EventLedger {
  constructor(filePath = "./logs/agent_events.jsonl") {
    this.filePath = filePath;
  }

  replay() {
    if (!fs.existsSync(this.filePath)) return [];
    return fs.readFileSync(this.filePath, "utf8").split("\n").filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }

  append(type, payload) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const event = {
      eventId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      type,
      recordedAt: new Date().toISOString(),
      payload
    };
    fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }
}
