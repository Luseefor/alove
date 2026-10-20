import { describe, test, expect } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Queue, QueueEvents } from "bullmq";
import { COMPILE_QUEUE_NAME, redisConnectionOptions } from "@alove/queue";
import { validateQueuedCompileJob } from "@alove/protocol";

// Explicit opt-in lifecycle test. Runs only when the parent provides a quiet
// dedicated Redis BEFORE any other worker starts:
//   RUN_WORKER_LIFECYCLE_TESTS=1 TEST_REDIS_PORT=6381 (local) or 6379 (CI)
// Otherwise the suite skips without opening any network connection.
const portRaw = process.env.TEST_REDIS_PORT;
const portText = (portRaw ?? "").trim();
const port = portText === "" ? NaN : Number(portText);
const enabled =
  process.env.RUN_WORKER_LIFECYCLE_TESTS === "1" &&
  portText !== "" &&
  Number.isInteger(port) &&
  port >= 1 &&
  port <= 65535;

const describeLifecycle = enabled ? describe : describe.skip;

function dockerPsAll() {
  const out = spawnSync("docker", ["ps", "-aq", "--filter", "name=alove-compile-"], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (out.status !== 0) throw new Error("Docker container enumeration failed");
  return out.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

function inspectContainers(ids) {
  if (ids.length === 0) return [];
  const out = spawnSync("docker", ["inspect", ...ids], { encoding: "utf8", timeout: 10000 });
  if (out.status !== 0 || !out.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(out.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Only containers whose readonly /source bind originates under our own root.
// Never treat other workers' containers as owned; never do global cleanup.
function ownedContainers(ownRoot) {
  const ids = dockerPsAll();
  const inspected = inspectContainers(ids);
  const owned = [];
  for (const c of inspected) {
    const mounts = Array.isArray(c?.Mounts) ? c.Mounts : [];
    for (const m of mounts) {
      if (
        m?.Destination === "/source" &&
        typeof m?.Source === "string" &&
        m.Source.startsWith(`${ownRoot}/`) &&
        m.RW === false
      ) {
        owned.push({ id: c?.Id ?? c?.Name ?? "", source: m.Source });
        break;
      }
    }
  }
  return owned;
}

function removeOwnedContainers(ownRoot) {
  for (const c of ownedContainers(ownRoot)) {
    if (!c.id) continue;
    // Targeted removal of our own container only.
    spawnSync("docker", ["rm", "-f", c.id], { encoding: "utf8", timeout: 10000 });
  }
}

async function ownedWorkEntries(ownRoot) {
  try {
    const entries = await readdir(ownRoot);
    return entries.filter((e) => e.startsWith("alove-tex-"));
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeLifecycle("worker graceful shutdown lifecycle", () => {
  test(
    "SIGTERM during active docker job exits 0 with CANCELLED and cleans own root",
    async () => {
      const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
      const tmpBase = await mkdtemp(join(tmpdir(), "alove-worker-lifecycle-"));
      const ownRoot = await realpath(tmpBase);

      // Producer clients only; queue is created before the child worker.
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
      const eventsConnection = redisConnectionOptions("worker", {
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: String(port),
      });
      const events = new QueueEvents(COMPILE_QUEUE_NAME, { connection: eventsConnection });
      await events.waitUntilReady();

      const image = process.env.COMPILE_DOCKER_IMAGE ?? "alove-tex:local";
      const childEnv = {
        ...process.env,
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: String(port),
        REDIS_URL: "",
        REDIS_DB: "",
        REDIS_USERNAME: "",
        REDIS_PASSWORD: "",
        REDIS_TLS: "",
        REDIS_TLS_CA: "",
        COMPILE_DOCKER_IMAGE: image,
        COMPILE_USE_DOCKER: "true",
        NODE_ENV: "production",
        COMPILE_WORK_ROOT: ownRoot,
        WORKER_CONCURRENCY: "1",
      };
      delete childEnv.COMPILE_TRUSTED_LOCAL;

      // Spawn the actual worker via the current bun binary.
      const child = spawn(process.execPath, ["src/index.ts"], {
        cwd: workerDir,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let childOutput = "";
      child.stdout?.on("data", (d) => {
        childOutput += String(d);
      });
      child.stderr?.on("data", (d) => {
        childOutput += String(d);
      });
      let childExited = false;
      let childCode = null;
      let childSignal = null;
      const exitedPromise = new Promise((resolve, reject) => {
        child.on("exit", (code, signal) => {
          childExited = true;
          childCode = code;
          childSignal = signal;
          resolve({ code, signal });
        });
        child.on("error", reject);
      });

      const owner = { kind: "local", origin: "http://127.0.0.1:30128" };
      const request = {
        projectId: `lifecycle-${randomUUID()}`,
        mainFile: "main.tex",
        engine: "pdflatex",
        timeoutMs: 60000,
        files: {
          "main.tex": String.raw`\documentclass{article}
\begin{document}
\loop\iftrue\repeat
\end{document}
`,
        },
      };
      const envelope = { version: 1, owner, request };
      const validated = validateQueuedCompileJob(envelope);
      expect(validated.ok).toBe(true);

      const jobId = `lifecycle-${Date.now()}-${randomUUID()}`;
      let addedJobId = null;

      try {
        // Wait for the worker to report listening (actual index.ts behavior).
        const listenDeadline = Date.now() + 20000;
        while (Date.now() < listenDeadline) {
          if (childExited) break;
          if (childOutput.includes("compile.worker.listening")) break;
          await sleep(200);
        }
        expect(childExited).toBe(false);
        expect(childOutput).toContain("compile.worker.listening");

        const job = await queue.add("compile", envelope, { jobId, attempts: 1 });
        addedJobId = job.id;

        // Wait for active state plus an owned docker container with a
        // readonly source mount under our own root.
        let activeSeen = false;
        let ownedAtSigterm = [];
        const activeDeadline = Date.now() + 60000;
        while (Date.now() < activeDeadline) {
          if (childExited) break;
          const fresh = await queue.getJob(jobId);
          const state = fresh ? await fresh.getState() : "unknown";
          if (state === "active") activeSeen = true;
          const owned = ownedContainers(ownRoot);
          if (state === "active" && owned.length > 0) {
            ownedAtSigterm = owned;
            break;
          }
          await sleep(500);
        }
        expect(childExited).toBe(false);
        expect(activeSeen).toBe(true);
        expect(ownedAtSigterm.length).toBeGreaterThan(0);

        // SIGTERM while the owned container exists. Worker gives active jobs
        // ~10s grace (deadline abort) then cleans up; hard deadline exits 1
        // at ~35s. A graceful path must exit 0 well under ~25s.
        const shutdownStarted = Date.now();
        child.kill("SIGTERM");
        const shutdownTimeoutMs = 30000;
        const exited = await Promise.race([
          exitedPromise,
          sleep(shutdownTimeoutMs).then(() => null),
        ]);
        expect(exited).not.toBeNull();
        const shutdownMs = Date.now() - shutdownStarted;
        expect(childCode).toBe(0);
        expect(childSignal).toBeNull();
        expect(shutdownMs).toBeLessThan(25000);

        // Terminal state for our own job only. The abort maps to a returned
        // CANCELLED result (completed with returnvalue), no PDF.
        let terminal = null;
        const terminalDeadline = Date.now() + 15000;
        while (Date.now() < terminalDeadline) {
          const fresh = await queue.getJob(jobId);
          if (!fresh) break;
          const state = await fresh.getState();
          if (state === "completed" || state === "failed") {
            terminal = fresh;
            break;
          }
          await sleep(500);
        }
        expect(terminal).not.toBeNull();
        const terminalState = await terminal.getState();
        expect(["completed", "failed"]).toContain(terminalState);
        const value = terminal.returnvalue;
        expect(value).toBeDefined();
        expect(value.errorCode).toBe("CANCELLED");
        expect(value.phase).toBe("failed");
        expect(value.timedOut ?? false).toBe(false);
        expect(value.pdfBase64).toBeUndefined();

        // Own root is empty and no owned container remains.
        expect(await ownedWorkEntries(ownRoot)).toEqual([]);
        expect(ownedContainers(ownRoot)).toEqual([]);
      } finally {
        // Cleanup only what we own. Never touch other jobs, roots, or
        // containers, never close other workers.
        if (!childExited) {
          try {
            child.kill("SIGTERM");
          } catch {}
          const forced = await Promise.race([
            exitedPromise,
            sleep(5000).then(() => null),
          ]);
          if (forced === null && !childExited) {
            try {
              child.kill("SIGKILL");
            } catch {}
          }
        }
        if (addedJobId) {
          try {
            const own = await queue.getJob(addedJobId);
            if (own) await own.remove();
          } catch {}
        }
        try {
          removeOwnedContainers(ownRoot);
        } catch {}
        try {
          await rm(ownRoot, { recursive: true, force: true });
        } catch {}
        try {
          await events.close();
        } catch {}
        try {
          await queue.close();
        } catch {}
      }
    },
    90000,
  );
});
