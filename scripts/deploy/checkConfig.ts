export type DeployTarget = "web" | "runner" | "backend" | "release" | "transport" | "all";

export interface CheckResult {
  ok: boolean;
  missing: string[];
  invalid: string[];
}

export const VALID_TARGETS: DeployTarget[] = ["web", "runner", "backend", "release", "transport", "all"];

function hasNul(v: string): boolean {
  return v.includes("\0");
}

function isPlaceholderLike(v: string): boolean {
  const s = v.toLowerCase();
  return (
    s.includes("placeholder") ||
    s.includes("example") ||
    s.includes("changeme") ||
    s.includes("xxx") ||
    s.includes("your_") ||
    s.includes("your-") ||
    s.includes("todo") ||
    s.includes("sample")
  );
}

function isHttpsOrigin(v: string): boolean {
  if (!v || hasNul(v) || /\s/.test(v)) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (!u.hostname) return false;
  if (u.username || u.password) return false;
  if (u.search || u.hash) return false;
  return u.pathname === "" || u.pathname === "/";
}

function isLivePublishableKey(v: string): boolean {
  if (hasNul(v) || /\s/.test(v)) return false;
  if (!/^pk_live_[A-Za-z0-9_-]{10,}$/.test(v)) return false;
  return !isPlaceholderLike(v);
}

function isLiveSecretKey(v: string): boolean {
  if (hasNul(v) || /\s/.test(v)) return false;
  if (!/^sk_live_[A-Za-z0-9_-]{10,}$/.test(v)) return false;
  return !isPlaceholderLike(v);
}

function isRedissUrl(v: string): boolean {
  if (!v || hasNul(v) || /\s/.test(v)) return false;
  if (!v.startsWith("rediss://")) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "rediss:") return false;
  if (!u.hostname) return false;
  if (u.search || u.hash) return false;
  try { if (decodeURIComponent(u.password).length < 16) return false; } catch { return false; }
  if (u.port !== "") {
    const n = Number(u.port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return false;
  }
  const p = u.pathname;
  if (p === "" || p === "/") return true;
  const m = /^\/(\d+)$/.exec(p);
  if (!m) return false;
  const db = Number(m[1]);
  return Number.isInteger(db) && db >= 0 && db <= 15;
}

function isDockerImage(v: string): boolean {
  if (!v || hasNul(v) || /\s/.test(v)) return false;
  if (/^sha256:[0-9a-fA-F]{64}$/.test(v)) return true;
  const at = v.lastIndexOf("@");
  if (at <= 0) return false;
  const name = v.slice(0, at);
  const digest = v.slice(at + 1);
  if (!name) return false;
  return /^sha256:[0-9a-fA-F]{64}$/.test(digest);
}

function isAbsolutePath(v: string): boolean {
  return /^\/[A-Za-z0-9_/-]{1,199}$/.test(v) && !v.split("/").some((part) => part === "." || part === "..");
}

function isConcurrency(v: string): boolean {
  return /^[1-4]$/.test(v.trim());
}

function isConvexDeployKey(v: string): boolean {
  if (hasNul(v)) return false;
  const t = v.trim();
  if (t.length < 8) return false;
  if (/[\s]/.test(t)) return false;
  return !isPlaceholderLike(t);
}

function isDeployHost(v: string): boolean {
  if (!v || hasNul(v)) return false;
  if (/[\s]/.test(v)) return false;
  const t = v.trim();
  if (!t || t.length > 253) return false;
  if (t.includes("://") || t.includes("/") || t.includes("?") || t.includes("#") || t.includes("@")) return false;
  const lower = t.toLowerCase();
  if (lower === "localhost") return false;
  if (lower === "::1" || lower === "[::1]") return false;
  if (/^127\./.test(t)) return false;
  if (/^::ffff:127\./.test(lower)) return false;
  if (t.includes(":")) {
    const bracket = /^\[([^\]]+)\]$/.exec(t);
    if (bracket) {
      const inside = bracket[1].toLowerCase();
      if (!inside || inside === "::1") return false;
      return true;
    }
    const colons = (t.match(/:/g) || []).length;
    if (colons >= 2) {
      if (lower === "::1") return false;
      return true;
    }
    return false;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) {
    const parts = t.split(".").map(Number);
    return parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  }
  if (t.startsWith("-") || t.startsWith(".") || t.endsWith("-") || t.endsWith(".")) return false;
  if (t.includes("..")) return false;
  if (!/^[A-Za-z0-9.-]+$/.test(t)) return false;
  for (const label of t.split(".")) {
    if (!label || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    if (!/^[A-Za-z0-9-]+$/.test(label)) return false;
  }
  return true;
}

function isSshUser(v: string): boolean {
  if (!v || hasNul(v)) return false;
  const t = v.trim();
  if (!t) return false;
  return /^[A-Za-z0-9_.-]+$/.test(t);
}

function isPemPrivateKey(v: string): boolean {
  if (!v || hasNul(v)) return false;
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(v);
}

function isNonEmpty(v: string): boolean {
  if (!v || hasNul(v)) return false;
  return v.trim().length > 0;
}

type Validator = (v: string) => boolean;

const VALIDATORS: Record<string, Validator> = {
  ALOVE_SITE_URL: isHttpsOrigin,
  NEXT_PUBLIC_LOCAL_STANDALONE: (v) => v === "false",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: isLivePublishableKey,
  CLERK_SECRET_KEY: isLiveSecretKey,
  NEXT_PUBLIC_CONVEX_URL: isHttpsOrigin,
  CLERK_JWT_ISSUER_DOMAIN: isHttpsOrigin,
  REDIS_URL: isRedissUrl,
  COMPILE_USE_DOCKER: (v) => v === "true",
  COMPILE_DOCKER_IMAGE: isDockerImage,
  COMPILE_WORK_ROOT: isAbsolutePath,
  WORKER_CONCURRENCY: isConcurrency,
  CONVEX_DEPLOY_KEY: isConvexDeployKey,
  CLERK_WEBHOOK_SECRET: (v) => /^whsec_[A-Za-z0-9+/]{24,}={0,2}$/.test(v),
  DEPLOY_WEB_HOST: isDeployHost,
  DEPLOY_RUNNER_HOST: isDeployHost,
  DEPLOY_SSH_USER: isSshUser,
  DEPLOY_SSH_PRIVATE_KEY: isPemPrivateKey,
  DEPLOY_SSH_KNOWN_HOSTS: (value) => isNonEmpty(value) && value.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#")).every((line) => /^(?:\S+)\s+(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))\s+[A-Za-z0-9+/]+={0,2}(?:\s.*)?$/.test(line.trim())),
};

const WEB_REQUIRED = [
  "ALOVE_SITE_URL",
  "NEXT_PUBLIC_LOCAL_STANDALONE",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CONVEX_URL",
  "CLERK_JWT_ISSUER_DOMAIN",
  "REDIS_URL",
];

const RUNNER_REQUIRED = [
  "REDIS_URL",
  "COMPILE_USE_DOCKER",
  "COMPILE_DOCKER_IMAGE",
  "COMPILE_WORK_ROOT",
];

const BACKEND_REQUIRED = ["CONVEX_DEPLOY_KEY", "CLERK_JWT_ISSUER_DOMAIN", "CLERK_WEBHOOK_SECRET"];

const DEPLOY_REQUIRED = [
  "DEPLOY_WEB_HOST",
  "DEPLOY_RUNNER_HOST",
  "DEPLOY_SSH_USER",
  "DEPLOY_SSH_PRIVATE_KEY",
  "DEPLOY_SSH_KNOWN_HOSTS",
];


function isMissingValue(v: string | undefined): boolean {
  return v === undefined || v.trim() === "";
}

function collectRequired(
  env: Record<string, string | undefined>,
  names: string[],
  missing: string[],
  invalid: string[],
): void {
  for (const name of names) {
    const raw = env[name];
    if (isMissingValue(raw)) {
      if (!missing.includes(name)) missing.push(name);
      continue;
    }
    const check = VALIDATORS[name];
    if (check && !check(raw as string)) {
      if (!invalid.includes(name)) invalid.push(name);
    }
  }
}

function collectLocalFlags(
  env: Record<string, string | undefined>,
  invalid: string[],
): void {
  const origin = env["ALOVE_LOCAL_COMPILE_ORIGIN"];
  if (origin !== undefined && origin.trim() !== "") {
    if (!invalid.includes("ALOVE_LOCAL_COMPILE_ORIGIN")) invalid.push("ALOVE_LOCAL_COMPILE_ORIGIN");
  }
  const trusted = env["COMPILE_TRUSTED_LOCAL"];
  if (trusted !== undefined && trusted.trim() === "true") {
    if (!invalid.includes("COMPILE_TRUSTED_LOCAL")) invalid.push("COMPILE_TRUSTED_LOCAL");
  }
}

function collectOptionalConcurrency(
  env: Record<string, string | undefined>,
  invalid: string[],
): void {
  const raw = env["WORKER_CONCURRENCY"];
  if (raw === undefined || raw.trim() === "") return;
  if (!isConcurrency(raw)) {
    if (!invalid.includes("WORKER_CONCURRENCY")) invalid.push("WORKER_CONCURRENCY");
  }
}

function collectDeployDistinct(env: Record<string, string | undefined>, invalid: string[]): void {
  const a = env["DEPLOY_WEB_HOST"];
  const b = env["DEPLOY_RUNNER_HOST"];
  if (isMissingValue(a) || isMissingValue(b)) return;
  if (invalid.includes("DEPLOY_WEB_HOST") || invalid.includes("DEPLOY_RUNNER_HOST")) return;
  if ((a as string).trim().toLowerCase() === (b as string).trim().toLowerCase()) {
    if (!invalid.includes("DEPLOY_WEB_HOST")) invalid.push("DEPLOY_WEB_HOST");
    if (!invalid.includes("DEPLOY_RUNNER_HOST")) invalid.push("DEPLOY_RUNNER_HOST");
  }
}

export function checkDeployConfig(
  target: DeployTarget,
  env: Record<string, string | undefined>,
): CheckResult {
  if (!VALID_TARGETS.includes(target)) {
    throw new Error(`Unknown deploy target: ${target}. Valid targets: ${VALID_TARGETS.join(", ")}`);
  }
  const missing: string[] = [];
  const invalid: string[] = [];
  const needWeb = target === "web" || target === "all" || target === "release";
  const needRunner = target === "runner" || target === "all" || target === "release";
  const needBackend = target === "backend" || target === "all" || target === "release";
  const needDeploy = target === "release" || target === "transport";

  if (needWeb) collectRequired(env, WEB_REQUIRED, missing, invalid);
  if (needRunner) collectRequired(env, RUNNER_REQUIRED, missing, invalid);
  if (needBackend) collectRequired(env, BACKEND_REQUIRED, missing, invalid);
  if (needRunner || needWeb) collectLocalFlags(env, invalid);
  if (needRunner) collectOptionalConcurrency(env, invalid);
  if (target === "all") collectOptionalConcurrency(env, invalid);
  if (needDeploy) {
    collectRequired(env, DEPLOY_REQUIRED, missing, invalid);
    collectDeployDistinct(env, invalid);
  }


  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

function parseArgs(argv: string[]): { target: string; json: boolean; help: boolean } {
  let target = "all";
  let json = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a.startsWith("--target=")) target = a.slice("--target=".length);
    else if (a === "--target" && i + 1 < argv.length) target = argv[++i];
    else if (a.startsWith("-t=")) target = a.slice(3);
  }
  return { target, json, help };
}

function printUsage(): void {
  console.log(`Usage: checkConfig.ts [--target=web|runner|backend|release|transport|all] [--json]`);
}

function cli(): void {
  const { target, json, help } = parseArgs(process.argv.slice(2));
  if (help) {
    printUsage();
    process.exit(0);
  }
  if (!VALID_TARGETS.includes(target as DeployTarget)) {
    if (json) {
      console.log(JSON.stringify({ target, ok: false, missing: [], invalid: [], error: "invalid-target" }));
    } else {
      console.error(`Invalid target "${target}". Valid targets: ${VALID_TARGETS.join(", ")}`);
    }
    process.exit(1);
  }
  const result = checkDeployConfig(target as DeployTarget, process.env as Record<string, string | undefined>);
  if (json) {
    console.log(JSON.stringify({ target, ok: result.ok, missing: result.missing, invalid: result.invalid }));
  } else if (result.ok) {
    console.log(`checkConfig: target "${target}" ok`);
  } else {
    console.log(`checkConfig: target "${target}" failed`);
    if (result.missing.length > 0) console.log(`missing: ${result.missing.join(", ")}`);
    if (result.invalid.length > 0) console.log(`invalid: ${result.invalid.join(", ")}`);
  }
  process.exit(result.ok ? 0 : 1);
}

const isMain = (import.meta as unknown as { main?: boolean }).main;
if (isMain) cli();
