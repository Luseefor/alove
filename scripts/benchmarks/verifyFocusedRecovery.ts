import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, resolve } from "node:path";
import type { CompileJobPayload, CompileJobResult } from "@alove/protocol";
import {
  createBuildRecord,
  hashBuildSource,
} from "../../apps/web/src/lib/buildRecord";
import { findBuildRecovery } from "../../apps/web/src/lib/buildRecovery";
import {
  compareBuildFiles,
  restoreCandidateFile,
} from "../../apps/web/src/lib/buildRecoveryCandidates";
import { pollCompileJob } from "../../apps/web/src/lib/compilePoll";
import { focusedRecoveryCorpus } from "./focusedRecoveryCorpus";

// This is a functional preservation check, not a latency or Overleaf benchmark.
const args = process.argv.slice(2);
function flag(name: string, fallback: string) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
}
const base = new URL(flag("--base-url", "http://127.0.0.1:30130"));
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
  base.username ||
  base.password
)
  throw new Error(
    "Use a loopback application server for this local functional check.",
  );
const repeats = Number(flag("--repeats", "3"));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5)
  throw new Error("repeats must be 1..5");
const output = resolve(
  flag("--output", "benchmark-results/focused-recovery.json"),
);
const selected = flag("--case", "");
const nativeFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  nativeFetch(
    typeof input === "string" && input.startsWith("/")
      ? new URL(input, base)
      : input,
    init,
  )) as typeof fetch;
const compilations: Array<Record<string, unknown>> = [];
const runs: Array<Record<string, unknown>> = [];
const report: Record<string, unknown> = {
  schema: 1,
  startedAt: new Date().toISOString(),
  completed: false,
  applicationRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  machine: { platform: platform(), architecture: arch(), bun: Bun.version },
  methodology:
    "Real local HTTP/Redis/Docker compilations, sequential functional checks. A whole-file reference performs the documented restore-file operation on the same source; it is not an executed Overleaf session, Error Assist evaluation, speed comparison or user study.",
  repeats,
  sourceFiles: {} as Record<string, string>,
  fixtures: focusedRecoveryCorpus,
  runs,
  compilations,
};
for (const file of [
  "apps/web/src/lib/buildRecovery.ts",
  "apps/web/src/lib/buildRecoveryHunks.ts",
  "scripts/benchmarks/focusedRecoveryCorpus.ts",
])
  (report.sourceFiles as Record<string, string>)[file] = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
async function checkpoint() {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
async function compile(
  request: CompileJobPayload,
  label: string,
  signal = AbortSignal.timeout(90_000),
): Promise<CompileJobResult> {
  const response = await fetch(new URL("/api/compile", base), {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", origin: base.origin },
    body: JSON.stringify(request),
  });
  if (!response.ok)
    throw new Error(`Compile request refused (${response.status}).`);
  const { jobId } = (await response.json()) as { jobId: string };
  const result = await pollCompileJob(jobId, signal);
  compilations.push({
    label,
    jobId,
    sourceHash: await hashBuildSource({
      ...request,
      engine: request.engine ?? "pdflatex",
      cleanAux: request.cleanAux ?? false,
    }),
    phase: result.phase,
    errorCode: result.errorCode,
    environment: result.environment,
    pdfBytes: result.pdfBase64
      ? Buffer.from(result.pdfBase64, "base64").length
      : 0,
    diagnostics: result.diagnostics,
    log: result.log.slice(-16_384),
  });
  return result;
}
function equalFiles(a: Record<string, string>, b: Record<string, string>) {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(
      ([path, content]) => Object.hasOwn(b, path) && b[path] === content,
    )
  );
}

try {
  for (const fixture of focusedRecoveryCorpus.filter(
    (item) => !selected || item.id === selected,
  )) {
    const projectId = `local-focused-proof-${crypto.randomUUID()}`;
    const goodRequest = { ...fixture.good, projectId };
    const failedRequest = { ...fixture.failed, projectId };
    const goodStarted = Date.now();
    const goodResult = await compile(
      goodRequest,
      `${fixture.id}/baseline-setup`,
    );
    if (goodResult.phase !== "ready" || !goodResult.pdfBase64)
      throw new Error(`${fixture.id}: fixture baseline did not compile.`);
    const good = await createBuildRecord(
      goodRequest,
      goodResult,
      1,
      goodStarted,
    );
    const failedStarted = Date.now();
    const failedResult = await compile(
      failedRequest,
      `${fixture.id}/failure-setup`,
    );
    if (failedResult.errorCode !== "LATEX_ERROR" || failedResult.pdfBase64)
      throw new Error(
        `${fixture.id}: fixture did not produce a clean LATEX_ERROR.`,
      );
    const failed = await createBuildRecord(
      failedRequest,
      failedResult,
      2,
      failedStarted,
    );
    // Execute the old whole-file operation, so the preservation difference is observable.
    let reference: Record<string, unknown> | null = null;
    if (fixture.expected.path) {
      const change = compareBuildFiles(good.files, failed.files).find(
        (item) => item.path === fixture.expected.path,
      );
      if (!change)
        throw new Error(`${fixture.id}: reference path is unchanged.`);
      const files = restoreCandidateFile(failed.files, change);
      const result = await compile(
        { ...failedRequest, files },
        `${fixture.id}/whole-file-reference`,
      );
      reference = {
        phase: result.phase,
        files,
        retainedTextPreserved: fixture.retainedText
          ? (files[fixture.expected.path]?.includes(fixture.retainedText) ??
            false)
          : null,
      };
    }
    for (let repeat = 0; repeat < repeats; repeat++) {
      const outcome = await findBuildRecovery(good, failed, {
        signal: AbortSignal.timeout(90_000),
        compile: (request, signal) =>
          compile(request, `${fixture.id}/repeat-${repeat + 1}/trial`, signal),
      });
      const files = outcome.candidate
        ? restoreCandidateFile(failed.files, outcome.candidate)
        : null;
      const inputUnchanged =
        equalFiles(failed.files, fixture.failed.files) &&
        equalFiles(good.files, fixture.good.files);
      const verifiedFingerprint =
        files && outcome.status === "verified"
          ? outcome.trials.at(-1)?.sourceHash ===
            (await hashBuildSource({ ...failed, files }))
          : null;
      const matched =
        outcome.status === fixture.expected.status &&
        inputUnchanged &&
        (fixture.expected.status !== "verified" ||
          Boolean(
            files &&
            outcome.candidate?.scope === fixture.expected.scope &&
            outcome.candidate?.path === fixture.expected.path &&
            fixture.expected.files &&
            equalFiles(files, fixture.expected.files) &&
            verifiedFingerprint,
          ));
      runs.push({
        id: fixture.id,
        repeat: repeat + 1,
        matched,
        inputUnchanged,
        verifiedFingerprint,
        retainedTextPreserved:
          files && fixture.retainedText && fixture.expected.path
            ? (files[fixture.expected.path]?.includes(fixture.retainedText) ??
              false)
            : null,
        wholeFileReference: reference,
        good,
        failed,
        report: outcome,
        restoredFiles: files,
      });
      console.log(
        `${fixture.id} ${repeat + 1}/${repeats}: ${outcome.status}, ${outcome.candidate?.scope ?? "no patch"}, expected=${matched}`,
      );
      await checkpoint();
    }
  }
  if (!runs.length) throw new Error("No fixtures selected.");
  report.completed = true;
  report.finishedAt = new Date().toISOString();
  report.summary = {
    total: runs.length,
    matched: runs.filter((run) => run.matched).length,
    compilationJobs: compilations.length,
    unexpectedOutcomes: runs.filter((run) => !run.matched).length,
  };
  await checkpoint();
  if (runs.some((run) => !run.matched)) process.exitCode = 1;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await checkpoint();
  throw error;
} finally {
  globalThis.fetch = nativeFetch;
}
