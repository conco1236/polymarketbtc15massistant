export function buildHealthSnapshot({ agent, observation = null, nowMs = Date.now() } = {}) {
  const base = agent?.health?.() ?? { state: "UNKNOWN", liveExecution: false };
  const feedEntries = Object.entries(observation?.freshness ?? {}).map(([name, value]) => ({
    name,
    fresh: value?.fresh === true,
    ageMs: value?.ageMs ?? null,
    maxAgeMs: value?.maxAgeMs ?? null
  }));
  const staleFeeds = feedEntries.filter((item) => !item.fresh).map((item) => item.name);
  const status = base.state === "HALTED" ? "HALTED" : base.state === "DEGRADED" || staleFeeds.length ? "DEGRADED" : "HEALTHY";

  return {
    ...base,
    status,
    checkedAt: new Date(nowMs).toISOString(),
    staleFeeds,
    feedEntries,
    liveExecution: false
  };
}
