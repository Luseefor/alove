import { describe, test, expect } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { COMPILE_QUEUE_NAME, redisConnectionOptions } from "@alove/queue";
import { COMPILE_HEARTBEAT_KEY } from "@alove/queue/admission";

// Opt in only with a quiet dedicated Redis and no other host worker. This test
// owns the shared heartbeat key and /tmp file for its duration. No TeX jobs run.
// TEST_READINESS_BASE_URL optionally checks a web server using that same Redis.
const portRaw = process.env.TEST_REDIS_PORT;
const portText = (portRaw ?? "").trim();
const port = portText === "" ? NaN : Number(portText);
const enabled =
  process.env.RUN_WORKER_READINESS_TESTS === "1" &&
  portText !== "" &&
  Number.isInteger(port) &&
  port >= 1 &&
  port <= 65535;

const describeReadiness = enabled ? describe : describe.skip;

const HEARTBEAT_FILE = "/tmp/alove-worker-heartbeat";
const VALID_IMAGE_ID = `sha256:${"a".repeat(64)}|linux/amd64`;
const SLOW_IMAGE_ID = `sha256:${"b".repeat(64)}|linux/amd64`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redisEnv() {
  return {
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: String(port),
    REDIS_URL: "",
    REDIS_DB: "",
    REDIS_USERNAME: "",
    REDIS_PASSWORD: "",
    REDIS_TLS: "",
    REDIS_TLS_CA: "",
  };
}

async function queueIsQuiet(queue) {
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "prioritized",
    "waiting-children",
    "paused",
  );
  return Object.values(counts).every((n) => n === 0);
}

async function safeDeleteHeartbeatIfQuiet(redis, queue) {
  const quiet = await queueIsQuiet(queue);
  if (!quiet) throw new Error("Refusing to clear heartbeat: queue is not quiet (possible other worker)");
  const existing = await redis.get(COMPILE_HEARTBEAT_KEY);
  if (existing !== null) await redis.del(COMPILE_HEARTBEAT_KEY);
  return existing;
}

function healthStatus(workerDir) {
  const out = spawnSync(process.execPath, ["src/health.ts"], {
    cwd: workerDir,
    encoding: "utf8",
    timeout: 10000,
  });
  return out.status;
}

async function heartbeatFilePresent() {
  try {
    await readFile(HEARTBEAT_FILE, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function waitForFreshBeat(redis, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const raw = await redis.get(COMPILE_HEARTBEAT_KEY);
    if (raw !== null) {
      const beat = Number(raw);
      const age = Date.now() - beat;
      if (Number.isFinite(beat) && beat > 0 && age >= 0 && age < 15_000) {
        last = { raw, beat, age };
        return last;
      }
    }
    await sleep(500);
  }
  return null;
}

async function waitForBeatGone(redis, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = await redis.get(COMPILE_HEARTBEAT_KEY);
    if (raw === null) return true;
    await sleep(500);
  }
  return false;
}

async function waitForListening(childOutputRef, childExitedRef, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childExitedRef.exited) return false;
    if (childOutputRef.text.includes("compile.worker.listening")) return true;
    await sleep(200);
  }
  return childOutputRef.text.includes("compile.worker.listening");
}

async function fetchReadyWorkerFlag() {
  const baseRaw = (process.env.TEST_READINESS_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (baseRaw === "") return null;
  const res = await fetch(`${baseRaw}/api/ready`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  const body = await res.json();
  return body?.checks?.worker ?? null;
}

function maxProbeConcurrency(logText) {
  const events = [];
  for (const line of logText.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "start" && parts.length >= 3) {
      const ts = Number(parts[1]);
      if (Number.isFinite(ts)) events.push({ ts, delta: 1 });
    } else if (parts[0] === "end" && parts.length >= 3) {
      const ts = Number(parts[1]);
      if (Number.isFinite(ts)) events.push({ ts, delta: -1 });
    }
  }
  events.sort((a, b) => a.ts - b.ts || a.delta - b.delta);
  let cur = 0;
  let max = 0;
  for (const e of events) {
    cur += e.delta;
    if (cur > max) max = cur;
  }
  return { max, starts: events.filter((e) => e.delta === 1).length };
}

async function readLogSafe(logPath) {
  try {
    return await readFile(logPath, "utf8");
  } catch {
    return "";
  }
}

describeReadiness("worker runtime readiness cycle", () => {
  test(
    "missing -> valid -> missing -> restore on the same worker, slow probe aborts on SIGTERM",
    async () => {
      const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
      const fakeBin = await mkdtemp(join(tmpdir(), "alove-readiness-bin-"));
      const scratch = await mkdtemp(join(tmpdir(), "alove-readiness-scratch-"));
      const workRoot = await mkdtemp(join(tmpdir(), "alove-readiness-work-"));
      const markerPath = join(scratch, "readiness-marker");
      const probeLog = join(scratch, "docker-probe.log");
      const dockerPath = join(fakeBin, "docker");

      // Fake docker for image inspect only. Marker missing (default) -> exit 1;
      // "valid" -> strict sha256|linux/amd64; "slow" -> 10s sleep then valid.
      // Every invocation logs start/end for the in-flight <=1 check.
      await writeFile(
        dockerPath,
        `#!${process.execPath}\n` +
          `import { readFileSync, appendFileSync } from "node:fs";\n` +
          `const marker = process.env.ALOVE_READINESS_MARKER ?? "";\n` +
          `const log = process.env.ALOVE_READINESS_LOG ?? "";\n` +
          `const note = (l) => { try { if (log) appendFileSync(log, l + "\\n"); } catch {} };\n` +
          `note("start " + Date.now() + " " + process.pid);\n` +
          `const finish = (code, out, err) => { note("end " + Date.now() + " " + process.pid + " " + code); if (out) console.log(out); if (err) console.error(err); process.exit(code); };\n` +
          `process.on("SIGTERM", () => { note("end " + Date.now() + " " + process.pid + " sigterm"); process.exit(143); });\n` +
          `process.on("SIGINT", () => { note("end " + Date.now() + " " + process.pid + " sigint"); process.exit(130); });\n` +
          `let mode = "missing";\n` +
          `try { mode = String(readFileSync(marker, "utf8")).trim() || "missing"; } catch { mode = "missing"; }\n` +
          `if (mode === "slow") { await new Promise((r) => setTimeout(r, 10000)); finish(0, ${JSON.stringify(SLOW_IMAGE_ID)}, ""); }\n` +
          `else if (mode === "valid") { await new Promise((r) => setTimeout(r, 200)); finish(0, ${JSON.stringify(VALID_IMAGE_ID)}, ""); }\n` +
          `else { finish(1, "", "fake docker: no such image"); }\n`,
      );
      await chmod(dockerPath, 0o755);
      // Marker missing by default.
      await rm(markerPath, { force: true });
      await writeFile(probeLog, "", { flag: "w" }).catch(() => {});

      const queueConnection = redisConnectionOptions("producer", {
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: String(port),
      });
      const queue = new Queue(COMPILE_QUEUE_NAME, {
        connection: queueConnection,
        defaultJobOptions: {
          removeOnComplete: { age: 3600, count: 10 },
          removeOnFail: { age: 86400, count: 20 },
          attempts: 1,
        },
      });
      await queue.waitUntilReady();
      const redis = new Redis(redisConnectionOptions("producer", redisEnv()));
      if (redis.status !== "ready") {
        await new Promise((resolve, reject) => {
          const ready = () => { redis.off("error", failed); resolve(); };
          const failed = (error) => { redis.off("ready", ready); reject(error); };
          redis.once("ready", ready);
          redis.once("error", failed);
        });
      }

      const childEnv = {
        ...process.env,
        ...redisEnv(),
        COMPILE_DOCKER_IMAGE: "readiness-probe-image:1",
        COMPILE_USE_DOCKER: "true",
        NODE_ENV: "production",
        COMPILE_WORK_ROOT: workRoot,
        WORKER_CONCURRENCY: "1",
        ALOVE_READINESS_MARKER: markerPath,
        ALOVE_READINESS_LOG: probeLog,
        PATH: `${fakeBin}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      };
      delete childEnv.COMPILE_TRUSTED_LOCAL;

      const child = spawn(process.execPath, ["src/index.ts"], {
        cwd: workerDir,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const outRef = { text: "" };
      child.stdout?.on("data", (d) => {
        outRef.text += String(d);
      });
      child.stderr?.on("data", (d) => {
        outRef.text += String(d);
      });
      const state = { exited: false, code: null, signal: null };
      const exitedPromise = new Promise((resolve, reject) => {
        child.on("exit", (code, signal) => {
          state.exited = true;
          state.code = code;
          state.signal = signal;
          resolve({ code, signal });
        });
        child.on("error", reject);
      });

      try {
        // Clear any stale heartbeat ONLY after proving the queue is quiet
        // (no other worker). Never FLUSHDB.
        await safeDeleteHeartbeatIfQuiet(redis, queue);

        expect(await waitForListening(outRef, state, 20000)).toBe(true);
        expect(state.exited).toBe(false);
        const childPid = child.pid;
        expect(typeof childPid).toBe("number");

        // Phase 1: missing at startup -> no Redis key, health 1.
        // Allow initial heartbeat + one 5s interval to run.
        await sleep(7000);
        expect(state.exited).toBe(false);
        expect(await redis.get(COMPILE_HEARTBEAT_KEY)).toBeNull();
        expect(healthStatus(workerDir)).toBe(1);
        const readyMissing1 = await fetchReadyWorkerFlag();
        if (readyMissing1 !== null) expect(readyMissing1).toBe(false);
        expect(outRef.text).toContain("compile.worker.runtime_unavailable");
        const logMissing1 = await readLogSafe(probeLog);
        expect(logMissing1).toContain("start");

        // Phase 2: valid marker -> fresh key + health 0, same process.
        await writeFile(markerPath, "valid");
        const fresh1 = await waitForFreshBeat(redis, 15000);
        expect(fresh1).not.toBeNull();
        const ttl1 = await redis.ttl(COMPILE_HEARTBEAT_KEY);
        expect(ttl1).toBeGreaterThan(0);
        expect(ttl1).toBeLessThanOrEqual(15);
        expect(healthStatus(workerDir)).toBe(0);
        const readyValid1 = await fetchReadyWorkerFlag();
        if (readyValid1 !== null) expect(readyValid1).toBe(true);
        expect(outRef.text).toContain("compile.worker.runtime_ready");
        expect(state.exited).toBe(false);
        expect(child.pid).toBe(childPid);
        const { max: max1 } = maxProbeConcurrency(await readLogSafe(probeLog));
        expect(max1).toBeLessThanOrEqual(1);

        // Phase 3: missing again -> beat stops, key expires within 22s, health 1.
        await rm(markerPath, { force: true });
        const goneStart = Date.now();
        expect(await waitForBeatGone(redis, 22000)).toBe(true);
        expect(Date.now() - goneStart).toBeLessThan(22000);
        // Health file has no TTL; it goes stale ~15s after the last write.
        let healthGone = false;
        const healthDeadline = Date.now() + 22000;
        while (Date.now() < healthDeadline) {
          if (healthStatus(workerDir) === 1) {
            healthGone = true;
            break;
          }
          await sleep(500);
        }
        expect(healthGone).toBe(true);
        const readyMissing2 = await fetchReadyWorkerFlag();
        if (readyMissing2 !== null) expect(readyMissing2).toBe(false);
        // Beat stays stopped for at least one more interval.
        await sleep(6000);
        expect(await redis.get(COMPILE_HEARTBEAT_KEY)).toBeNull();
        expect(state.exited).toBe(false);
        expect(child.pid).toBe(childPid);

        // Phase 4: restore -> fresh again without restart.
        await writeFile(markerPath, "valid");
        const fresh2 = await waitForFreshBeat(redis, 15000);
        expect(fresh2).not.toBeNull();
        expect(healthStatus(workerDir)).toBe(0);
        const readyValid2 = await fetchReadyWorkerFlag();
        if (readyValid2 !== null) expect(readyValid2).toBe(true);
        expect(state.exited).toBe(false);
        expect(child.pid).toBe(childPid);

        // Phase 5: slow inspect in-flight, then SIGTERM -> exit 0 <5s.
        const logBefore = await readLogSafe(probeLog);
        const startsBefore = maxProbeConcurrency(logBefore).starts;
        await writeFile(markerPath, "slow");
        let slowSpawned = false;
        const spawnDeadline = Date.now() + 12000;
        while (Date.now() < spawnDeadline) {
          const cur = maxProbeConcurrency(await readLogSafe(probeLog)).starts;
          if (cur > startsBefore) {
            slowSpawned = true;
            break;
          }
          if (state.exited) break;
          await sleep(200);
        }
        expect(slowSpawned).toBe(true);
        expect(state.exited).toBe(false);
        const shutdownStarted = Date.now();
        child.kill("SIGTERM");
        const exited = await Promise.race([
          exitedPromise,
          sleep(10000).then(() => null),
        ]);
        expect(exited).not.toBeNull();
        const shutdownMs = Date.now() - shutdownStarted;
        expect(state.code).toBe(0);
        expect(state.signal).toBeNull();
        expect(shutdownMs).toBeLessThan(5000);
        expect(await heartbeatFilePresent()).toBe(false);
        // No orphan fake docker child referencing our temp bin.
        const ps = spawnSync("ps", ["-eo", "pid,command"], {
          encoding: "utf8",
          timeout: 10000,
        });
        if (ps.status === 0) {
          const orphans = ps.stdout
            .split("\n")
            .filter((line) => line.includes(fakeBin));
          expect(orphans).toEqual([]);
        }
        const { max: maxAll } = maxProbeConcurrency(await readLogSafe(probeLog));
        expect(maxAll).toBeLessThanOrEqual(1);

        // Final cleanup of our own key only when the queue is quiet.
        try {
          await safeDeleteHeartbeatIfQuiet(redis, queue);
        } catch {}
      } finally {
        if (!state.exited) {
          try {
            child.kill("SIGTERM");
          } catch {}
          const forced = await Promise.race([
            exitedPromise,
            sleep(5000).then(() => null),
          ]);
          if (forced === null && !state.exited) {
            try {
              child.kill("SIGKILL");
            } catch {}
          }
        }
        try {
          await queue.close();
        } catch {}
        try {
          await redis.quit();
        } catch {}
        try {
          await rm(fakeBin, { recursive: true, force: true });
        } catch {}
        try {
          await rm(scratch, { recursive: true, force: true });
        } catch {}
        try {
          await rm(workRoot, { recursive: true, force: true });
        } catch {}
      }
    },
    120000,
  );
});
