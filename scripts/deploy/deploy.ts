import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { checkDeployConfig } from "./checkConfig";

export function rawEnv(values: Record<string, string | undefined>): string {
  return Object.entries(values).map(([name, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || value === undefined || /[\r\n\0]/.test(value))
      throw new Error("Invalid deployment environment entry");
    return `${name}=${value}\n`;
  }).join("");
}
export function deploymentDirectory(revision: string, nonce = crypto.randomUUID()): string {
  if (!/^[a-f0-9]{40}$/.test(revision) || !/^[a-zA-Z0-9-]{1,64}$/.test(nonce)) throw new Error("Invalid deployment release identifier");
  return `/opt/alove/releases/${revision}-${nonce}`;
}
export function immutableImage(value: string | undefined): string {
  if (!value || !/^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/.test(value))
    throw new Error("Deployment images must use registry digests");
  return value;
}

async function deploy() {
  const env = process.env;
  const config = checkDeployConfig("release", env);
  if (!config.ok) throw new Error(`Missing configuration: ${config.missing.join(", ")}; invalid configuration: ${config.invalid.join(", ")}`);
  const revision = env.DEPLOY_REVISION ?? "";
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("DEPLOY_REVISION must be a full commit hash");
  // A rerun of the same commit must retain its previous images and secrets for rollback.
  const target = deploymentDirectory(revision);
  const webImage = immutableImage(env.ALOVE_WEB_IMAGE);
  const runnerImage = immutableImage(env.ALOVE_RUNNER_IMAGE);
  immutableImage(env.COMPILE_DOCKER_IMAGE);
  if (!env.GHCR_TOKEN || !env.GHCR_USER || !/^[a-zA-Z0-9-]+$/.test(env.GHCR_USER)) throw new Error("Missing registry credentials");
  const root = resolve(import.meta.dir, "../..");
  const temp = await mkdtemp(join(tmpdir(), "alove-deploy-"));
  function run(command: string, args: string[], input?: Uint8Array | string) {
    const result = spawnSync(command, args, { input, timeout: 600_000, maxBuffer: 16 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
    // Remote output may contain provider errors or credentials: keep it out of logs.
    if (result.status !== 0 || result.error) throw new Error(`Deployment command failed: ${command}, exit ${result.status ?? "unavailable"}`);
    return result.stdout;
  }
  try {
    const identity = join(temp, "identity");
    const knownHosts = join(temp, "known_hosts");
    await writeFile(identity, env.DEPLOY_SSH_PRIVATE_KEY! + "\n", { mode: 0o600 });
    await writeFile(knownHosts, env.DEPLOY_SSH_KNOWN_HOSTS! + "\n", { mode: 0o600 });
    const ssh = ["-i", identity, "-o", `UserKnownHostsFile=${knownHosts}`, "-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
    for (const role of ["runner", "web"] as const) {
      const host = role === "web" ? env.DEPLOY_WEB_HOST! : env.DEPLOY_RUNNER_HOST!;
      const destination = `${env.DEPLOY_SSH_USER}@${host}`;
      const bundle = join(temp, role);
      await mkdir(join(bundle, ".deploy"), { recursive: true, mode: 0o700 });
      await mkdir(join(bundle, "deploy"));
      const compose = role === "web" ? "docker-compose.prod.yml" : "docker-compose.runner.yml";
      await copyFile(join(root, compose), join(bundle, compose));
      await copyFile(join(root, "deploy/Caddyfile"), join(bundle, "deploy/Caddyfile"));
      await copyFile(join(root, "scripts/deploy/activate.sh"), join(bundle, "deploy/activate.sh"));
      await writeFile(join(bundle, ".deploy/compose.env"), rawEnv({
        ALOVE_WEB_IMAGE: webImage, ALOVE_RUNNER_IMAGE: runnerImage,
        ALOVE_SITE_URL: env.ALOVE_SITE_URL, COMPILE_DOCKER_IMAGE: env.COMPILE_DOCKER_IMAGE,
        COMPILE_WORK_ROOT: env.COMPILE_WORK_ROOT,
      }), { mode: 0o600 });
      const runtime = role === "web" ? {
        REDIS_URL: env.REDIS_URL, NEXT_PUBLIC_LOCAL_STANDALONE: "false", ALOVE_SITE_URL: env.ALOVE_SITE_URL,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
        NEXT_PUBLIC_CONVEX_URL: env.NEXT_PUBLIC_CONVEX_URL,
        CLERK_SECRET_KEY: env.CLERK_SECRET_KEY, CLERK_JWT_ISSUER_DOMAIN: env.CLERK_JWT_ISSUER_DOMAIN,
      } : { REDIS_URL: env.REDIS_URL, WORKER_CONCURRENCY: env.WORKER_CONCURRENCY || "1" };
      await writeFile(join(bundle, `.deploy/${role}.env`), rawEnv(runtime), { mode: 0o600 });
      // Token reaches Docker through stdin and is removed from the host after pull.
      run("ssh", [...ssh, destination, `docker login ghcr.io -u ${env.GHCR_USER} --password-stdin >/dev/null 2>&1`], env.GHCR_TOKEN);
      try {
        const archive = run("tar", ["-czf", "-", "-C", bundle, "."]);
        run("ssh", [...ssh, destination, `umask 077; mkdir -p ${target} && tar -xzf - -C ${target}`], archive);
        run("ssh", [...ssh, destination, `cd ${target} && /bin/sh deploy/activate.sh ${role}`]);
        console.log(`Activated ${role} at ${revision}`);
      } catch (error) {
        throw new Error(`${role} activation failed: ${error instanceof Error ? error.message : "unknown failure"}`);
      } finally {
        try { run("ssh", [...ssh, destination, "docker logout ghcr.io >/dev/null 2>&1"]); }
        catch { console.error(`Registry logout failed on ${role}; revoke the temporary workflow token if needed.`); }
      }
    }
    const origin = new URL(env.ALOVE_SITE_URL!).origin;
    let ready = false;
    for (let attempt = 0; attempt < 24; attempt++) {
      try {
        const response = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
        const data = await response.json() as { ok?: boolean };
        if (response.ok && data.ok === true) { ready = true; break; }
      } catch { /* DNS, TLS and dependency readiness are checked, not assumed. */ }
      await Bun.sleep(5000);
    }
    if (!ready) throw new Error("Public readiness did not pass. Inspect services and follow the rollback runbook.");
    console.log("Public compile backend readiness passed. Complete the live two-account login checklist before opening registration.");
  } finally { await rm(temp, { recursive: true, force: true }); }
}
if (import.meta.main) void deploy().catch((error) => { console.error(error instanceof Error ? error.message : "Deployment failed"); process.exitCode = 1; });
