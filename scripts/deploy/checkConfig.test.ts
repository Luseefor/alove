import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { checkDeployConfig } from "./checkConfig";

const FAKE_WEBHOOK = "whsec_" + Buffer.from("not-a-live-webhook-signing-secret-12345678").toString("base64");
const FAKE_PWD = "9f8e7d6c5b4a3e2f1a0b9c8d7e6f5a4b3c2d1e0fAaBbCcDdEeFf0011223344556677";
const FAKE_PK = "pk_live_9f8e7d6c5b4a3e2f1a0b9c8d7e6f5a4b3c2d1e0fG7H8J9K0L2M4N6P8Q0R2";
const FAKE_SK = ["sk", "live", "a".repeat(48)].join("_"); // Synthetic, never a provider credential.
const FAKE_REDIS = `rediss://default:${FAKE_PWD}@redis-valid-9f8e7d6c5b4a.internal-host.com:6380/0`;
const FAKE_SITE = "https://alove-valid-9f8e7d6c5b4a.com";
const FAKE_CONVEX_URL = "https://happy-otter-123.convex.cloud";
const FAKE_ISSUER = "https://clerk-valid-9f8e7d6c5b4a.accounts.dev";
const FAKE_IMAGE = "ghcr.io/alove/texlive@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const FAKE_WORK_ROOT = "/tmp/alove-work-valid-9f8e7d6c5b4a";
const FAKE_CONVEX_KEY = "convex-deploy-valid-9f8e7d6c5b4a3e2f1a0b9c8d7e6f5a4b3c2d1e0f998877665544";
const FAKE_WEB_HOST = "web-prod-9f8e7d6c5b4a.deploy-valid.com";
const FAKE_RUNNER_HOST = "runner-prod-1a2b3c4d5e6f.deploy-valid.com";
const FAKE_SSH_USER = "deployer";
const FAKE_SSH_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEINT9f8e7d6c5b4a3e2f1a0b9c8d7e6f5a4b3c2d1e0fAaBbCcDdEeFf001122\n-----END OPENSSH PRIVATE KEY-----";
const FAKE_KNOWN_HOSTS =
  "deploy-valid-host ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINT9f8e7d6c5b4a3e2f1a0b9c8d7e6f5A4B3C2D1E0F998877665544";

const ALL_SECRET_VALUES = [
  FAKE_WEBHOOK,
  FAKE_PWD,
  FAKE_PK,
  FAKE_SK,
  FAKE_REDIS,
  FAKE_CONVEX_KEY,
  FAKE_SSH_KEY,
  FAKE_KNOWN_HOSTS,
];

function validAllEnv(): Record<string, string> {
  return {
    ALOVE_SITE_URL: FAKE_SITE,
    NEXT_PUBLIC_LOCAL_STANDALONE: "false",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE_PK,
    CLERK_SECRET_KEY: FAKE_SK,
    NEXT_PUBLIC_CONVEX_URL: FAKE_CONVEX_URL,
    CLERK_JWT_ISSUER_DOMAIN: FAKE_ISSUER,
    REDIS_URL: FAKE_REDIS,
    COMPILE_USE_DOCKER: "true",
    COMPILE_DOCKER_IMAGE: FAKE_IMAGE,
    COMPILE_WORK_ROOT: FAKE_WORK_ROOT,
    WORKER_CONCURRENCY: "2",
    CONVEX_DEPLOY_KEY: FAKE_CONVEX_KEY,
    CLERK_WEBHOOK_SECRET: FAKE_WEBHOOK,
  };
}

function validReleaseEnv(): Record<string, string> {
  return {
    ...validAllEnv(),
    DEPLOY_WEB_HOST: FAKE_WEB_HOST,
    DEPLOY_RUNNER_HOST: FAKE_RUNNER_HOST,
    DEPLOY_SSH_USER: FAKE_SSH_USER,
    DEPLOY_SSH_PRIVATE_KEY: FAKE_SSH_KEY,
    DEPLOY_SSH_KNOWN_HOSTS: FAKE_KNOWN_HOSTS,
  };
}

function scriptFile(): string {
  return decodeURIComponent(new URL("./checkConfig.ts", import.meta.url).pathname);
}

const KNOWN_KEYS = [
  "ALOVE_SITE_URL",
  "NEXT_PUBLIC_LOCAL_STANDALONE",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CONVEX_URL",
  "CLERK_JWT_ISSUER_DOMAIN",
  "REDIS_URL",
  "COMPILE_USE_DOCKER",
  "COMPILE_DOCKER_IMAGE",
  "COMPILE_WORK_ROOT",
  "WORKER_CONCURRENCY",
  "CONVEX_DEPLOY_KEY",
  "CLERK_WEBHOOK_SECRET",
  "DEPLOY_WEB_HOST",
  "DEPLOY_RUNNER_HOST",
  "DEPLOY_SSH_USER",
  "DEPLOY_SSH_PRIVATE_KEY",
  "DEPLOY_SSH_KNOWN_HOSTS",
  "ALOVE_LOCAL_COMPILE_ORIGIN",
  "COMPILE_TRUSTED_LOCAL",
];

function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const k of KNOWN_KEYS) delete out[k];
  return out;
}

function runCli(args: string[], env: Record<string, string | undefined>): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("bun", [scriptFile(), ...args], {
    encoding: "utf8",
    env: env as NodeJS.ProcessEnv,
  });
  return { status: r.status, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
}

describe("valid configs", () => {
  test("all targets pass with huge unique fake credentials", () => {
    const env = validAllEnv();
    expect(checkDeployConfig("web", env).ok).toBe(true);
    expect(checkDeployConfig("runner", env).ok).toBe(true);
    expect(checkDeployConfig("backend", env).ok).toBe(true);
    const all = checkDeployConfig("all", env);
    expect(all).toEqual({ ok: true, missing: [], invalid: [] });
  });

  test("release passes with deploy hosts and keys", () => {
    const r = checkDeployConfig("release", validReleaseEnv());
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.invalid).toEqual([]);
  });

  test("optional concurrency may be absent", () => {
    const env = validAllEnv();
    delete env.WORKER_CONCURRENCY;
    expect(checkDeployConfig("runner", env).ok).toBe(true);
    expect(checkDeployConfig("all", env).ok).toBe(true);
  });
});

describe("missing names", () => {
  test("empty env reports missing names for web", () => {
    const r = checkDeployConfig("web", {});
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("ALOVE_SITE_URL");
    expect(r.missing).toContain("REDIS_URL");
    expect(r.missing).toContain("CLERK_SECRET_KEY");
    expect(r.invalid).toEqual([]);
  });

  test("runner reports its own missing set", () => {
    const r = checkDeployConfig("runner", {});
    expect(r.missing).toContain("REDIS_URL");
    expect(r.missing).toContain("COMPILE_USE_DOCKER");
    expect(r.missing).toContain("COMPILE_DOCKER_IMAGE");
    expect(r.missing).toContain("COMPILE_WORK_ROOT");
  });

  test("release reports deploy missing names", () => {
    const r = checkDeployConfig("release", validAllEnv());
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("DEPLOY_WEB_HOST");
    expect(r.missing).toContain("DEPLOY_RUNNER_HOST");
    expect(r.missing).toContain("DEPLOY_SSH_USER");
  });
});

describe("placeholder keys are invalid", () => {
  test("placeholder publishable and secret fail", () => {
    const env = { ...validAllEnv(), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_placeholder", CLERK_SECRET_KEY: "sk_live_example_xxx" };
    const r = checkDeployConfig("web", env);
    expect(r.ok).toBe(false);
    expect(r.invalid).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(r.invalid).toContain("CLERK_SECRET_KEY");
  });

  test("test-mode keys fail", () => {
    const env = { ...validAllEnv(), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abc1234567890", CLERK_SECRET_KEY: "sk_test_abc1234567890" };
    const r = checkDeployConfig("web", env);
    expect(r.invalid).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(r.invalid).toContain("CLERK_SECRET_KEY");
  });
});

describe("rediss password and schema bounds", () => {
  test.each([
    ["redis://default:" + FAKE_PWD + "@h.internal-host.com:6379/0", "plain redis rejected"],
    ["rediss://default:short@h.internal-host.com:6379/0", "short password rejected"],
    ["rediss://h.internal-host.com/0", "missing password rejected"],
    [`rediss://default:${FAKE_PWD}@h.internal-host.com/0?ssl=true`, "query rejected"],
    [`rediss://default:${FAKE_PWD}@h.internal-host.com/0#frag`, "hash rejected"],
    [`rediss://default:${FAKE_PWD}@h.internal-host.com/abc`, "non-numeric db rejected"],
    [`rediss://default:${FAKE_PWD}@h.internal-host.com/99`, "out of range db rejected"],
    ["https://h.internal-host.com/0", "wrong scheme rejected"],
  ])("%s", (url) => {
    const env = { ...validAllEnv(), REDIS_URL: url as string };
    const r = checkDeployConfig("web", env);
    expect(r.invalid).toContain("REDIS_URL");
  });

  test("rediss without port or db stays valid", () => {
    const env = { ...validAllEnv(), REDIS_URL: `rediss://default:${FAKE_PWD}@redis-valid-9f8e7d6c5b4a.internal-host.com` };
    expect(checkDeployConfig("web", env).invalid).not.toContain("REDIS_URL");
  });
});

describe("public cloud flags", () => {
  test("standalone must be false", () => {
    const env = { ...validAllEnv(), NEXT_PUBLIC_LOCAL_STANDALONE: "true" };
    expect(checkDeployConfig("web", env).invalid).toContain("NEXT_PUBLIC_LOCAL_STANDALONE");
  });

  test("local compile origin rejected for web and runner only", () => {
    const web = { ...validAllEnv(), ALOVE_LOCAL_COMPILE_ORIGIN: "http://127.0.0.1:30127" };
    expect(checkDeployConfig("web", web).invalid).toContain("ALOVE_LOCAL_COMPILE_ORIGIN");
    expect(checkDeployConfig("runner", web).invalid).toContain("ALOVE_LOCAL_COMPILE_ORIGIN");
    const backendOnly = { CLERK_WEBHOOK_SECRET: FAKE_WEBHOOK, CONVEX_DEPLOY_KEY: FAKE_CONVEX_KEY, CLERK_JWT_ISSUER_DOMAIN: FAKE_ISSUER, ALOVE_LOCAL_COMPILE_ORIGIN: "http://127.0.0.1:30127" };
    expect(checkDeployConfig("backend", backendOnly).ok).toBe(true);
  });

  test("trusted local true rejected for web and runner only", () => {
    const web = { ...validAllEnv(), COMPILE_TRUSTED_LOCAL: "true" };
    expect(checkDeployConfig("web", web).invalid).toContain("COMPILE_TRUSTED_LOCAL");
    expect(checkDeployConfig("runner", web).invalid).toContain("COMPILE_TRUSTED_LOCAL");
    const backendOnly = { CLERK_WEBHOOK_SECRET: FAKE_WEBHOOK, CONVEX_DEPLOY_KEY: FAKE_CONVEX_KEY, CLERK_JWT_ISSUER_DOMAIN: FAKE_ISSUER, COMPILE_TRUSTED_LOCAL: "true" };
    expect(checkDeployConfig("backend", backendOnly).ok).toBe(true);
  });

  test("http site url and convex url rejected", () => {
    const env = { ...validAllEnv(), ALOVE_SITE_URL: "http://alove-valid-9f8e7d6c5b4a.com", NEXT_PUBLIC_CONVEX_URL: "http://happy-otter-123.convex.cloud" };
    const r = checkDeployConfig("web", env);
    expect(r.invalid).toContain("ALOVE_SITE_URL");
    expect(r.invalid).toContain("NEXT_PUBLIC_CONVEX_URL");
  });
});

describe("runner digest and paths", () => {
  test("latest tag rejected, digest accepted", () => {
    const latest = { ...validAllEnv(), COMPILE_DOCKER_IMAGE: "ghcr.io/alove/texlive:latest" };
    expect(checkDeployConfig("runner", latest).invalid).toContain("COMPILE_DOCKER_IMAGE");
    const bare = { ...validAllEnv(), COMPILE_DOCKER_IMAGE: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };
    expect(checkDeployConfig("runner", bare).ok).toBe(true);
  });

  test("relative work root rejected", () => {
    const env = { ...validAllEnv(), COMPILE_WORK_ROOT: "relative/path" };
    expect(checkDeployConfig("runner", env).invalid).toContain("COMPILE_WORK_ROOT");
    const nul = { ...validAllEnv(), COMPILE_WORK_ROOT: "/tmp/bad\0path" };
    expect(checkDeployConfig("runner", nul).invalid).toContain("COMPILE_WORK_ROOT");
  });

  test("concurrency bounds 1..4", () => {
    for (const bad of ["0", "5", "abc", "2.5"]) {
      const env = { ...validAllEnv(), WORKER_CONCURRENCY: bad };
      expect(checkDeployConfig("runner", env).invalid).toContain("WORKER_CONCURRENCY");
    }
    for (const good of ["1", "4"]) {
      const env = { ...validAllEnv(), WORKER_CONCURRENCY: good };
      expect(checkDeployConfig("runner", env).invalid).not.toContain("WORKER_CONCURRENCY");
    }
  });

  test("docker flag must be true", () => {
    const env = { ...validAllEnv(), COMPILE_USE_DOCKER: "false" };
    expect(checkDeployConfig("runner", env).invalid).toContain("COMPILE_USE_DOCKER");
  });
});

describe("release hosts and ssh", () => {
  test("duplicate hosts rejected", () => {
    const env = { ...validReleaseEnv(), DEPLOY_RUNNER_HOST: FAKE_WEB_HOST };
    const r = checkDeployConfig("release", env);
    expect(r.invalid).toContain("DEPLOY_WEB_HOST");
    expect(r.invalid).toContain("DEPLOY_RUNNER_HOST");
  });

  test("loopback hosts rejected", () => {
    const env = { ...validReleaseEnv(), DEPLOY_WEB_HOST: "127.0.0.1", DEPLOY_RUNNER_HOST: "localhost" };
    const r = checkDeployConfig("release", env);
    expect(r.invalid).toContain("DEPLOY_WEB_HOST");
    expect(r.invalid).toContain("DEPLOY_RUNNER_HOST");
  });

  test("non-pem ssh key rejected", () => {
    const env = { ...validReleaseEnv(), DEPLOY_SSH_PRIVATE_KEY: "not-a-key" };
    expect(checkDeployConfig("release", env).invalid).toContain("DEPLOY_SSH_PRIVATE_KEY");
  });
});

describe("cli targets and names-only output", () => {
  test("invalid target exits nonzero without secrets", () => {
    const r = runCli(["--target=bogus", "--json"], { ...cleanEnv(), REDIS_URL: FAKE_REDIS });
    expect(r.status).not.toBe(0);
    const combined = r.stdout + r.stderr;
    for (const s of ALL_SECRET_VALUES) expect(combined).not.toContain(s);
  });

  test("valid all json passes and hides values", () => {
    const r = runCli(["--target=all", "--json"], { ...cleanEnv(), ...validAllEnv() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"ok":true');
    for (const s of ALL_SECRET_VALUES) expect(r.stdout).not.toContain(s);
    expect(r.stderr).not.toContain(FAKE_PWD);
  });

  test("missing config exits 1 with names only", () => {
    const r = runCli(["--target=web", "--json"], cleanEnv());
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ALOVE_SITE_URL");
    expect(r.stdout).toContain("REDIS_URL");
  });

  test("invalid rediss in cli hides decoded password", () => {
    const badRedis = `rediss://default:${FAKE_PWD}@redis-valid-9f8e7d6c5b4a.internal-host.com/99`;
    const r = runCli(["--target=web", "--json"], { ...cleanEnv(), ...validAllEnv(), REDIS_URL: badRedis });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("REDIS_URL");
    expect(r.stdout).not.toContain(FAKE_PWD);
    expect(r.stderr).not.toContain(FAKE_PWD);
  });
});

describe("no secret leakage from pure result", () => {
  test("result names never carry values", () => {
    const env = { ...validAllEnv(), REDIS_URL: `rediss://default:${FAKE_PWD}@redis-valid-9f8e7d6c5b4a.internal-host.com/99` };
    const r = checkDeployConfig("web", env);
    const text = JSON.stringify(r);
    expect(r.invalid).toContain("REDIS_URL");
    for (const s of ALL_SECRET_VALUES) expect(text).not.toContain(s);
  });
});
