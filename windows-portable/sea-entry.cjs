const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { getAsset } = require("node:sea");

const executableDir = path.dirname(process.execPath);
const candidates = [executableDir, path.resolve(executableDir, "..")];
const appRoot = candidates.find((candidate) => fs.existsSync(path.join(candidate, ".env")) || fs.existsSync(path.join(candidate, "package.json"))) || candidates[1];
process.chdir(appRoot);
const envPath = path.join(appRoot, ".env");

if (!fs.existsSync(envPath)) {
  console.error(`Missing .env at ${envPath}. Copy windows-portable\\.env.example to .env first.`);
  process.exit(2);
}

for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator <= 0) continue;
  const name = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!process.env[name]) process.env[name] = value;
}

fs.mkdirSync(path.join(appRoot, "logs"), { recursive: true });
const bundlePath = path.join(appRoot, "windows-portable", "agent-bundle.cjs");
const bundleSource = getAsset("agent-bundle.cjs", "utf8");
const bundleModule = new Module(bundlePath, module);
bundleModule.filename = bundlePath;
bundleModule.paths = Module._nodeModulePaths(appRoot);
bundleModule._compile(bundleSource, bundlePath);
