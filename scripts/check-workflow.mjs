import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/polymarket-paper.yml", "utf8");
for (const required of ["*/5 * * * *", "workflow_dispatch:", "actions/cache@v4", "TELEGRAM_BOT_TOKEN"]) {
  if (!workflow.includes(required)) throw new Error(`missing workflow marker: ${required}`);
}
console.log("workflow_static_check=pass");
