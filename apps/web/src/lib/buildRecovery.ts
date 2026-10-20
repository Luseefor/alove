import type { CompileJobPayload, CompileJobResult } from "@alove/protocol";
import { pollCompileJob } from "./compilePoll";
import { hashBuildSource, type BuildRecord } from "./buildRecord";
import { compareBuildFiles, recoveryCandidateOrder, restoreCandidateFile, type FileChange } from "./buildRecoveryCandidates";

export type RecoveryTrial = {
  path: string | null;
  ok: boolean;
  errorCode?: CompileJobResult["errorCode"];
  log: string;
  environment?: CompileJobResult["environment"];
};
export type RecoveryReport = {
  schema: 1;
  goodId: string;
  failedId: string;
  status: "verified" | "unresolved" | "incompatible";
  message: string;
  changes: FileChange[];
  trials: RecoveryTrial[];
  candidate: FileChange | null;
};
export type RecoveryCompiler = (request: CompileJobPayload, signal: AbortSignal) => Promise<CompileJobResult>;

export const compileRecoveryTrial: RecoveryCompiler = async (request, signal) => {
  const response = await fetch("/api/compile", {
    method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Recovery trial could not be queued (${response.status}).`);
  const { jobId } = await response.json() as { jobId: string };
  return pollCompileJob(jobId, signal);
};

function sameEnvironment(a: BuildRecord["result"]["environment"], b: BuildRecord["result"]["environment"]): boolean {
  return Boolean(a && b && a.mode === "docker" && b.mode === "docker" &&
    a.runtimeId === b.runtimeId && a.platform === b.platform && a.policyId === b.policyId);
}

/** Tests single-file reversions, never mutating the working project or claiming minimality. */
export async function findBuildRecovery(
  good: BuildRecord,
  failed: BuildRecord,
  options: { signal: AbortSignal; compile?: RecoveryCompiler; onProgress?: (text: string) => void },
): Promise<RecoveryReport> {
  const changes = compareBuildFiles(good.files, failed.files);
  const report: RecoveryReport = { schema: 1, goodId: good.id, failedId: failed.id,
    changes, trials: [], candidate: null, status: "unresolved", message: "No single-file recovery was verified within the trial budget." };
  const incompatible = (message: string): RecoveryReport => ({ ...report, status: "incompatible", message });
  if (good.projectId !== failed.projectId || !good.result.ok || failed.result.ok || failed.result.errorCode !== "LATEX_ERROR")
    return incompatible("Choose a successful build followed by a LaTeX compilation failure from the same project.");
  if (good.mainFile !== failed.mainFile || good.engine !== failed.engine || good.cleanAux !== failed.cleanAux ||
      !sameEnvironment(good.result.environment, failed.result.environment))
    return incompatible("The compiler, root, settings, or recorded Docker image/sandbox policy changed. Build a successful baseline in the current environment first.");
  try {
    if (await hashBuildSource(good) !== good.sourceHash || await hashBuildSource(failed) !== failed.sourceHash)
      return incompatible("A stored build does not match its source fingerprint. Recovery stopped.");
  } catch {
    return incompatible("Source fingerprinting is unavailable. Open this workspace on HTTPS or localhost before testing recovery.");
  }
  if (!changes.length) return incompatible("Source files are identical. This failure cannot be attributed to a recorded source edit.");

  const deadline = AbortSignal.timeout(60_000);
  const signal = AbortSignal.any([options.signal, deadline]);
  const compile = options.compile ?? compileRecoveryTrial;
  const run = async (files: Record<string, string>, path: string | null) => {
    signal.throwIfAborted();
    const result = await compile({ projectId: failed.projectId, mainFile: failed.mainFile,
      files, engine: failed.engine, cleanAux: failed.cleanAux, timeoutMs: 15_000 }, signal);
    signal.throwIfAborted();
    report.trials.push({ path, ok: result.phase === "ready" && Boolean(result.pdfBase64),
      errorCode: result.errorCode, log: result.log.slice(-16_384), environment: result.environment });
    if (!sameEnvironment(failed.result.environment, result.environment))
      throw new Error("The Docker runtime or sandbox policy changed during recovery. No patch is verified.");
    return result;
  };
  try {
    options.onProgress?.("Checking that the last successful source still builds…");
    const baseline = await run({ ...good.files }, null);
    if (baseline.phase !== "ready" || !baseline.pdfBase64)
      return incompatible("The last successful source no longer builds in the current environment. Recovery stopped.");
    const candidates = recoveryCandidateOrder(changes, failed.result.diagnostics.flatMap((d) => d.file ? [d.file] : [])).slice(0, 5);
    for (const change of candidates) {
      signal.throwIfAborted();
      options.onProgress?.(`Testing restoration of ${change.path} (${report.trials.length}/5)…`);
      const result = await run(restoreCandidateFile(failed.files, change), change.path);
      if (result.phase === "ready" && result.pdfBase64) {
        return { ...report, status: "verified", candidate: change,
          message: `Restoring ${change.path} made this source snapshot compile. Other files were kept unchanged.` };
      }
      if (result.errorCode !== "LATEX_ERROR") {
        report.message = "A trial hit a timeout or infrastructure failure. No recovery is verified.";
        return report;
      }
    }
    return report;
  } catch (error) {
    report.message = signal.aborted
      ? "Recovery stopped. No further trials will be queued; an already queued job may run until its 15-second compile deadline."
      : error instanceof Error ? error.message : "Recovery failed. Your working files are unchanged.";
    return report;
  }
}
