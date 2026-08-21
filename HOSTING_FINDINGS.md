# Hosting findings

- Oracle Cloud Free Tier official page states that Always Free services are available for unlimited time, including AMD-based Compute and Arm-based Ampere A1 Compute, but signup requires valid contact/billing information and card verification; one free account per person applies.
- Oracle also provides a US$300 trial credit for 30 days, separate from Always Free resources. The free VM path is suitable for a Node process that needs to stay online, but it requires account signup, region capacity, SSH configuration and basic server administration.
- Render official free-tier documentation says free instances are intended for testing/hobby/preview and should not be used for production. The free service types listed are web services, Postgres and Key Value; a free web service spins down after inactivity, which is unsuitable for a continuously polling WebSocket agent without a non-free plan or an external wake-up workaround.
- Working recommendation pending Telegram verification: Oracle Always Free VM is the strongest genuinely free 24/7 candidate for this CLI/WebSocket agent. Render Free is a lower-friction test option but not a reliable always-on production host.

- Cloudflare Workers official Cron Triggers documentation says a Worker can implement a `scheduled()` handler and configure five-field cron expressions; schedule changes may take several minutes to propagate. The docs show every-minute cron as supported.
- Cloudflare Workers official pricing states the Free plan includes 100,000 requests per day and 10 ms CPU time per invocation. This is enough for a lightweight one-shot signal/alert check, but not for keeping the current WebSocket process alive continuously.
- Revised no-card recommendation: adapt the agent to a stateless scheduled Worker that calls public REST APIs, computes one signal, sends Telegram via HTTPS, and stores a small dedupe/health state in Workers KV or Durable Objects. Keep the current Node/WebSocket agent as the full continuous version for a VM/local host.

- Cloudflare's official Workers product page states Workers Free has 100,000 requests/day and 10 ms CPU per request, and explicitly says free signup requires no credit card.
- Official Workers KV limits give Free plan allowances of 100,000 reads/day and 1,000 writes/day to different keys, with one write per second to the same key. A five-minute cron writes at most 288 state updates/day; a one-minute cron writes 1,440 and would exceed the 1,000 different-key write limit only if using a new key each run. Reusing one key is within the same-key rate limit, so KV is viable for dedupe state.

- GitHub Docs states scheduled workflows run on the latest commit of the default branch and the shortest schedule interval is once every five minutes. This means the workflow must be merged to the default branch to run on schedule; keeping it only on the feature branch is insufficient.
- The no-card fallback should therefore be a short-lived REST check, not the current long-running Node/WebSocket process. It can run at `*/5 * * * *`, use concurrency cancellation to avoid overlap, and expose `workflow_dispatch` for manual smoke tests. It may be delayed by GitHub scheduling and public-repository workflows can be disabled after prolonged repository inactivity, so it is not a strict 24/7 SLA.

- Fork main now contains the merged no-card workflow and is 6 commits ahead of the original upstream main. The GitHub Actions page recognizes `Polymarket paper agent` on main but reports 0 workflow runs, so a manual dispatch is needed for the first smoke test.

- First GitHub Actions smoke run was created on main. Run #3 failed after 14 seconds with exit code 1; the public summary hides detailed logs unless signed in. The only visible warning is that action versions target Node 20 but are forced onto Node 24. The failure likely comes from the one-shot runner/runtime and must be diagnosed before claiming deployment success.
