import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem, platform, arch, release } from "node:os";
import { resolve, dirname } from "node:path";
import type { CompileJobPayload, CompileJobResult } from "@alove/protocol";
import { createCompileQueue } from "../../packages/queue/src/index";
import { pollCompileJob } from "../../apps/web/src/lib/compilePoll";
import { createBuildRecord } from "../../apps/web/src/lib/buildRecord";
import {
  findBuildRecovery,
  type RecoveryCompiler,
} from "../../apps/web/src/lib/buildRecovery";
import { restoreCandidateFile } from "../../apps/web/src/lib/buildRecoveryCandidates";
import { recoveryCorpus } from "./recoveryCorpus";
import { summarize, summarizeOutcomes } from "./statistics";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
};
const base = new URL(flag("--base-url", "http://127.0.0.1:30127"));
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  throw new Error(
    "Use a local benchmark server; remote load requires a separate staging run.",
  );
if (process.env.REDIS_PORT !== "6381")
  throw new Error(
    "Set REDIS_PORT=6381 for the dedicated benchmark queue. Do not consume the normal Redis queue.",
  );
if (
  !["127.0.0.1", "localhost", "::1"].includes(
    process.env.REDIS_HOST ?? "127.0.0.1",
  )
)
  throw new Error("The benchmark Redis host must be loopback.");
const repeats = Number(flag("--repeats", "3"));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10)
  throw new Error("repeats must be 1..10");
const phase = flag("--phase", "all");
const selected = flag("--case", "");
const output = resolve(flag("--output", "benchmark-results/recovery.json"));
const nativeFetch = globalThis.fetch;
const pollCounters = new Map<string, number>();
globalThis.fetch = ((
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => {
  const url =
    typeof input === "string" && input.startsWith("/")
      ? new URL(input, base)
      : input;
  const text =
    url instanceof URL ? url.href : typeof url === "string" ? url : url.url;
  const jobId = text.match(/\/api\/compile\/([^/?]+)/)?.[1];
  if (jobId && pollCounters.has(jobId))
    pollCounters.set(jobId, (pollCounters.get(jobId) ?? 0) + 1);
  return nativeFetch(url, init);
}) as typeof fetch;
const command = (bin: string, input: string[]) =>
  execFileSync(bin, input, { encoding: "utf8", timeout: 15000 }).trim();
const queue = createCompileQueue();
const runId = `bench-${Date.now()}`;
type Sample = {
  label: string;
  jobId: string;
  totalMs: number;
  serializeMs: number;
  submitMs: number;
  pollMs: number;
  queueWaitMs: number | null;
  workerMs: number | null;
  polls: number;
  phase: string;
  errorCode?: string;
  pdfBytes: number;
  fileCount: number;
  sourceBytes: number;
  environment?: CompileJobResult["environment"];
};
const compileSamples: Sample[] = [];
const cases: Array<Record<string, unknown>> = [];
const raw: Record<string, unknown> = {
  schema: 1,
  runId,
  startedAt: new Date().toISOString(),
  completed: false,
  methodology: {
    phase,
    repeats,
    pollIntervalMs: 350,
    concurrency: 1,
    pollCountMeaning: "HTTP poll attempts",
    coldDefinition:
      "First observed request only; Docker/OS/image caches were NOT reset. Every job has a fresh container and working directory.",
    timingBoundary:
      "HTTP request serialization through production API + Redis + Docker worker + application polling; excludes UI rendering, typing and IndexedDB.",
    samples:
      "Completed jobs, cases and trials retained, including fixture failures; transport errors stop the run and are saved at top level. No Overleaf comparison.",
  },
  machine: {
    platform: platform(),
    arch: arch(),
    release: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    bun: Bun.version,
  },
  applicationRevision: command("git", ["rev-parse", "HEAD"]),
  dirtyPaths: command("git", ["status", "--porcelain"]),
  docker: command("docker", [
    "info",
    "--format",
    "{{json .ServerVersion}} {{.NCPU}} {{.MemTotal}}",
  ]),
  compileSamples,
  cases,
};
async function checkpoint() {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(raw, null, 2) + "\n");
}

async function compile(
  request: CompileJobPayload,
  label: string,
  signal = AbortSignal.timeout(130000),
): Promise<CompileJobResult> {
  const start = performance.now();
  const body = JSON.stringify(request);
  const serialized = performance.now();
  const response = await fetch(new URL("/api/compile", base), {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body,
  });
  if (!response.ok)
    throw new Error(`Queue HTTP ${response.status}: ${await response.text()}`);
  const { jobId } = (await response.json()) as { jobId: string };
  const submitted = performance.now();
  pollCounters.set(jobId, 0);
  let result: CompileJobResult;
  let polls = 0;
  try {
    result = await pollCompileJob(jobId, signal);
  } finally {
    polls = pollCounters.get(jobId) ?? 0;
    pollCounters.delete(jobId);
  }
  const end = performance.now();
  const job = await queue.getJob(jobId);
  const sample: Sample = {
    label,
    jobId,
    totalMs: end - start,
    serializeMs: serialized - start,
    submitMs: submitted - serialized,
    pollMs: end - submitted,
    queueWaitMs: job?.processedOn ? job.processedOn - job.timestamp : null,
    workerMs:
      job?.finishedOn && job.processedOn
        ? job.finishedOn - job.processedOn
        : null,
    polls,
    phase: result.phase,
    errorCode: result.errorCode,
    pdfBytes: result.pdfBase64
      ? Buffer.from(result.pdfBase64, "base64").length
      : 0,
    fileCount: Object.keys(request.files).length,
    sourceBytes: Object.values(request.files).reduce(
      (n, s) => n + Buffer.byteLength(s),
      0,
    ),
    environment: result.environment,
  };
  compileSamples.push(sample);
  return result;
}
const simple = (
  engine: CompileJobPayload["engine"] = "pdflatex",
  pages = 1,
): CompileJobPayload => ({
  projectId: runId,
  mainFile: "main.tex",
  engine,
  timeoutMs: 15000,
  files: {
    "main.tex": `\\documentclass{article}\n\\begin{document}\n${Array.from({ length: pages }, (_, i) => `Benchmark page ${i + 1}. ${"Synthetic prose. ".repeat(40)}\\newpage`).join("\n")}\n\\end{document}\n`,
  },
});

try {
  const health = await fetch(new URL("/api/health", base));
  if (!health.ok) throw new Error("Production web API is not ready.");
  const counts = await queue.getJobCounts("waiting", "active");
  raw.initialQueue = counts;
  if (counts.waiting || counts.active)
    throw new Error(
      "Dedicated queue is busy. Wait for current jobs before benchmarking.",
    );
  await checkpoint();
  if (phase === "all" || phase === "speed") {
    console.log("Benchmark: first observed compile and warmed engine repeats");
    await compile(simple(), "first-observed/pdflatex");
    for (const engine of ["pdflatex", "lualatex", "xelatex"] as const) {
      for (let i = 0; i < 5; i++)
        await compile(simple(engine), `engine/${engine}/${i + 1}`);
      console.log(`Completed engine: ${engine}`);
      await checkpoint();
    }
    for (const pages of [10, 100]) {
      for (let i = 0; i < 3; i++)
        await compile(
          simple("pdflatex", pages),
          `scale/${pages}-pages/${i + 1}`,
        );
      console.log(`Completed ${pages}-page scale`);
      await checkpoint();
    }
    for (let i = 0; i < 3; i++)
      await compile(
        {
          ...simple(),
          timeoutMs: 1000,
          files: {
            "main.tex":
              "\\documentclass{article}\\begin{document}\\loop\\iftrue\\repeat\\end{document}",
          },
        },
        `deadline/${i + 1}`,
      );
    await checkpoint();
    const batches = [];
    for (let batch = 0; batch < 3; batch++) {
      const started = performance.now();
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          compile(simple(), `burst-${batch + 1}/job-${i + 1}`),
        ),
      );
      const elapsedMs = performance.now() - started;
      batches.push({
        batch: batch + 1,
        jobs: 4,
        elapsedMs,
        jobsPerMinute: (4 * 60000) / elapsedMs,
        successful: results.filter((r) => r.phase === "ready").length,
      });
    }
    raw.boundedBursts = {
      clientConcurrency: 4,
      workerConcurrency: 1,
      batches,
      notes: "Three bounded four-job bursts, not a sustained-capacity test.",
    };
    await checkpoint();
  }
  if (phase === "all" || phase === "corpus" || phase === "calibrate") {
    for (const fixture of recoveryCorpus.filter(
      (f) => !selected || f.id === selected,
    )) {
      console.log(`Case ${fixture.id}: building good/failed evidence`);
      const started = Date.now();
      const goodRequest = {
        ...fixture.good,
        projectId: `${runId}-${fixture.id}`,
      };
      const failedRequest = {
        ...fixture.failed,
        projectId: goodRequest.projectId,
      };
      const goodResult = await compile(goodRequest, `${fixture.id}/setup-good`);
      const failedResult = await compile(
        failedRequest,
        `${fixture.id}/setup-failed`,
      );
      const good = await createBuildRecord(goodRequest, goodResult, 1, started);
      const failed = await createBuildRecord(
        failedRequest,
        failedResult,
        2,
        Date.now(),
      );
      const entry: Record<string, unknown> = {
        id: fixture.id,
        label: fixture.label,
        category: fixture.category,
        expected: fixture.expected,
        expectedPath: fixture.expectedPath,
        good,
        failed,
        runs: [],
      };
      cases.push(entry);
      if (!good.result.ok || failed.result.ok) {
        entry.fixtureError = !good.result.ok
          ? "Baseline did not compile"
          : "Faulty fixture unexpectedly compiled";
        console.log(`FIXTURE ERROR: ${fixture.id}: ${entry.fixtureError}`);
        await checkpoint();
        continue;
      }
      if (phase !== "calibrate") {
        const runs: Array<Record<string, unknown>> = [];
        entry.runs = runs;
        for (let repeat = 0; repeat < repeats; repeat++) {
          const jobStart = compileSamples.length;
          const timer = performance.now();
          const timedCompiler: RecoveryCompiler = (request, signal) =>
            compile(
              request,
              `${fixture.id}/recovery-${repeat + 1}/trial-${compileSamples.length - jobStart}`,
              signal,
            );
          const report = await findBuildRecovery(good, failed, {
            signal: AbortSignal.timeout(65000),
            compile: timedCompiler,
          });
          const elapsedMs = performance.now() - timer;
          let preserved: boolean | null = null;
          if (report.status === "verified" && report.candidate) {
            const recovered = restoreCandidateFile(
              failed.files,
              report.candidate,
            );
            preserved =
              fixture.preservePaths.every(
                (path) => recovered[path] === failed.files[path],
              ) &&
              Object.keys({ ...failed.files, ...recovered }).every(
                (path) =>
                  path === report.candidate!.path ||
                  recovered[path] === failed.files[path],
              );
          }
          const actual = report.status;
          const matched =
            actual === fixture.expected &&
            (fixture.expected !== "verified" ||
              report.candidate?.path === fixture.expectedPath) &&
            preserved !== false;
          runs.push({
            repeat: repeat + 1,
            elapsedMs,
            actual,
            matched,
            preserved,
            queuedTrials: compileSamples.length - jobStart,
            report,
          });
          console.log(
            `${fixture.id} repeat ${repeat + 1}: ${actual}, ${(elapsedMs / 1000).toFixed(2)}s, ${report.trials.length} trials, expected=${matched}`,
          );
          await checkpoint();
        }
      }
      await checkpoint();
    }
  }
  if (phase === "all" || phase === "profile") {
    const stats: string[] = [];
    const docker = spawn("docker", ["stats", "--format", "{{json .}}"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let pending = "";
    docker.stdout.on("data", (chunk) => {
      pending += String(chunk);
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending
          .slice(0, newline)
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        pending = pending.slice(newline + 1);
        if (line.trim().startsWith("{")) stats.push(line);
      }
    });
    const before = compileSamples.length;
    try {
      for (let i = 0; i < 3; i++)
        await compile(simple("pdflatex", 500), `profile/500-pages/${i + 1}`);
    } finally {
      docker.kill("SIGTERM");
    }
    raw.resourceProfile = {
      notes:
        "Separate profiling phase; streaming Docker stats sampled by Docker (~1s), not a true peak. Compiler subprocesses run in fresh containers.",
      samples: stats
        .map((s) => JSON.parse(s))
        .filter((s) => String(s.Name).startsWith("alove-compile-")),
      compileSampleStart: before,
    };
    await checkpoint();
  }
  const outcomeRows = cases.flatMap((c) =>
    (c.runs as Array<Record<string, unknown>>).map((r) => ({
      expected: c.expected as string,
      actual: r.actual as string,
      preserved: r.preserved as boolean | null,
    })),
  );
  const groups = new Map<string, Sample[]>();
  for (const sample of compileSamples) {
    const parts = sample.label.split("/");
    const group =
      parts[0] === "engine" || parts[0] === "scale" || parts[0] === "profile"
        ? parts.slice(0, 2).join("/")
        : parts[0].startsWith("burst-")
          ? "bounded-burst"
          : parts[0].startsWith("verified-") ||
              parts[0].startsWith("unresolved-") ||
              parts[0].startsWith("incompatible-")
            ? parts[1]?.startsWith("setup")
              ? "corpus-setup"
              : "recovery-trial"
            : parts[0];
    groups.set(group, [...(groups.get(group) ?? []), sample]);
  }
  raw.strata = Object.fromEntries(
    [...groups].map(([name, samples]) => [
      name,
      {
        latencyMs: summarize(samples.map((s) => s.totalMs)),
        workerMs: summarize(
          samples.flatMap((s) => (s.workerMs === null ? [] : [s.workerMs])),
        ),
        queueWaitMs: summarize(
          samples.flatMap((s) =>
            s.queueWaitMs === null ? [] : [s.queueWaitMs],
          ),
        ),
        missingJobMetadata: samples.filter(
          (s) => s.workerMs === null || s.queueWaitMs === null,
        ).length,
      },
    ]),
  );
  raw.summary = {
    missingJobMetadata: compileSamples.filter(
      (s) => s.workerMs === null || s.queueWaitMs === null,
    ).length,
    unexpectedVerifiedPaths: cases.flatMap((c) =>
      (c.runs as Array<Record<string, unknown>>).filter(
        (r) =>
          c.expected === "verified" &&
          r.actual === "verified" &&
          (r.report as { candidate?: { path: string } }).candidate?.path !==
            c.expectedPath,
      ),
    ).length,
    lostUnrelatedEdits: outcomeRows.filter((r) => r.preserved === false).length,
    outcomes: summarizeOutcomes(outcomeRows),
    matchedRuns: cases
      .flatMap((c) => c.runs as Array<Record<string, unknown>>)
      .filter((r) => r.matched).length,
    fixtureErrors: cases.filter((c) => c.fixtureError).length,
    aggregateIsAppendixOnly: true,
    compileLatencyMs: summarize(compileSamples.map((s) => s.totalMs)),
    workerMs: summarize(
      compileSamples.flatMap((s) => (s.workerMs === null ? [] : [s.workerMs])),
    ),
    queueWaitMs: summarize(
      compileSamples.flatMap((s) =>
        s.queueWaitMs === null ? [] : [s.queueWaitMs],
      ),
    ),
    verifiedRecoveryMs: summarize(
      cases
        .flatMap((c) => c.runs as Array<Record<string, unknown>>)
        .filter((r) => r.actual === "verified")
        .map((r) => r.elapsedMs as number),
    ),
  };
  raw.completed = true;
  raw.finishedAt = new Date().toISOString();
  await checkpoint();
  console.log(JSON.stringify(raw.summary, null, 2));
  console.log(`Raw evidence: ${output}`);
  if (
    (raw.summary as { fixtureErrors: number; missingJobMetadata: number })
      .fixtureErrors ||
    (raw.summary as { missingJobMetadata: number }).missingJobMetadata ||
    cases.some((c) =>
      (c.runs as Array<{ matched: boolean }>).some((r) => !r.matched),
    )
  )
    process.exitCode = 1;
} catch (error) {
  raw.error = error instanceof Error ? error.stack : String(error);
  await checkpoint();
  throw error;
} finally {
  await queue.close();
  globalThis.fetch = nativeFetch;
}
