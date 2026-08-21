import fs from "node:fs/promises";
import { run } from "../cloudflare-worker/src/index.js";

const statePath = process.env.AGENT_STATE_FILE || ".github-agent-state.json";
let state = null;
try {
  state = JSON.parse(await fs.readFile(statePath, "utf8"));
} catch {
  state = null;
}

const store = {
  async get() {
    return state;
  },
  async put(_key, value) {
    state = JSON.parse(value);
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
};

const result = await run({
  ...process.env,
  AGENT_STATE: store,
  SEND_BLOCKED_ALERTS: process.env.SEND_BLOCKED_ALERTS || "false"
});

console.log(JSON.stringify(result, null, 2));
if (result.state === "ERROR") process.exitCode = 1;
