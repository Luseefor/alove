import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CompileEnvironment, CompileJobPayload, CompileJobResult } from "@alove/protocol";
import { createBuildRecord, hashBuildSource, type BuildRecord } from "./buildRecord";
import { findBuildRecovery, type RecoveryCompiler } from "./buildRecovery";
import { restoreCandidateFile } from "./buildRecoveryCandidates";

// jsdom may not provide WebCrypto; buildRecord hashing needs crypto.subtle.
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g["crypto"] === "undefined" || !(g["crypto"] as Crypto)?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// jsdom's AbortSignal may lack the timeout/any statics findBuildRecovery uses.
const Signal = globalThis.AbortSignal as unknown as typeof AbortSignal & {
  timeout?: (ms: number) => AbortSignal;
  any?: (signals: AbortSignal[]) => AbortSignal;
};
if (typeof Signal.timeout !== "function") {
  Signal.timeout = (ms: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    return controller.signal;
  };
}
if (typeof Signal.any !== "function") {
  Signal.any = (signals: AbortSignal[]) => {
    const controller = new AbortController();
    for (const s of signals) {
      if (s.aborted) {
        controller.abort();
        break;
      }
      s.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return controller.signal;
  };
}

const ENV = { mode: "docker" as const, runtimeId: "sha256:aaa", platform: "linux/amd64" };
const OTHER_ENV = { mode: "docker" as const, runtimeId: "sha256:bbb", platform: "linux/amd64" };

const successResult = (environment: CompileEnvironment = ENV): CompileJobResult => ({
  phase: "ready",
  log: "ok",
  diagnostics: [],
  pdfBase64: "JVBERg==",
  environment,
});

const latexFailure = (environment: CompileEnvironment = ENV): CompileJobResult => ({
  phase: "failed",
  log: "!",
  diagnostics: [],
  errorCode: "LATEX_ERROR",
  errorMessage: "tex failed",
  environment,
});

async function makeBuild(opts: {
  files: Record<string, string>;
  ok: boolean;
  mainFile?: string;
  engine?: "pdflatex" | "lualatex" | "xelatex";
  cleanAux?: boolean;
  projectId?: string;
  diagnostics?: CompileJobResult["diagnostics"];
  errorCode?: CompileJobResult["errorCode"];
  environment?: CompileEnvironment;
}): Promise<BuildRecord> {
  const result: CompileJobResult = opts.ok
    ? successResult(opts.environment)
    : {
        phase: "failed",
        log: "!",
        diagnostics: opts.diagnostics ?? [],
        errorCode: opts.errorCode ?? "LATEX_ERROR",
        errorMessage: "tex failed",
        environment: opts.environment ?? ENV,
      };
  return createBuildRecord(
    {
      projectId: opts.projectId ?? "proj",
      mainFile: opts.mainFile ?? "main.tex",
      files: opts.files,
      engine: opts.engine ?? "pdflatex",
      cleanAux: opts.cleanAux ?? false,
    },
    result,
    1,
    Date.now(),
  );
}

type Call = { request: CompileJobPayload };

function mockCompiler(
  behavior: (files: Record<string, string>, calls: number) => CompileJobResult,
): { compile: RecoveryCompiler; calls: Call[] } {
  const calls: Call[] = [];
  const compile: RecoveryCompiler = async (request) => {
    calls.push({ request: { ...request, files: { ...request.files } } });
    return behavior(request.files, calls.length);
  };
  return { compile, calls };
}

const freshSignal = () => new AbortController().signal;

describe("findBuildRecovery", () => {
  it("tests a separated change before apply while preserving same-file and other-file edits", async () => {
    const goodFiles = { "main.tex": "macro good\nunchanged\nOriginal prose\nend", "notes.tex": "Old notes" };
    const failedFiles = { "main.tex": "macro bad\nunchanged\nRevised prose\nend", "notes.tex": "New notes" };
    const good = await makeBuild({ files: goodFiles, ok: true });
    const failed = await makeBuild({ files: failedFiles, ok: false,
      diagnostics: [{ severity: "error", message: "broken macro", file: "main.tex", line: 1 }] });
    const { compile, calls } = mockCompiler((files) => files["main.tex"].startsWith("macro good")
      ? successResult() : latexFailure());
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });
    expect(report.status).toBe("verified");
    expect(report.candidate?.scope).toBe("hunk");
    expect(report.candidate?.hunk?.before).toContain("macro good");
    const restored = restoreCandidateFile(failed.files, report.candidate!);
    expect(restored).toEqual({ "main.tex": "macro good\nunchanged\nRevised prose\nend", "notes.tex": "New notes" });
    expect(calls[1].request.files).toEqual(restored);
    expect(report.trials[1].sourceHash).toBe(await hashBuildSource({ ...failed, files: restored }));
    expect(report.trials.every((trial) => /^[a-f0-9]{64}$/.test(trial.sourceHash ?? ""))).toBe(true);
    expect(good.files).toEqual(goodFiles);
    expect(failed.files).toEqual(failedFiles);
    expect(report).not.toHaveProperty("pdfBase64");
  });

  it("labels a whole-file fallback when independent blocks cannot recover separately", async () => {
    const original = "good one\nseparator\ngood two\nseparator two\nOriginal prose";
    const broken = "bad one\nseparator\nbad two\nseparator two\nRevised prose";
    const good = await makeBuild({ files: { "main.tex": original }, ok: true });
    const failed = await makeBuild({ files: { "main.tex": broken }, ok: false });
    const { compile, calls } = mockCompiler((files) => files["main.tex"].includes("bad") ? latexFailure() : successResult());
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });
    expect(report.status).toBe("verified");
    expect(report.candidate?.scope).toBe("file");
    expect(report.candidate?.before).toBe(original);
    expect(calls.slice(1, -1).every((call) => call.request.files["main.tex"] !== original)).toBe(true);
    expect(report.trials).toHaveLength(5);
    expect(report.trials.slice(1, -1).every((trial) => trial.scope === "hunk")).toBe(true);
    expect(report.trials.at(-1)?.scope).toBe("file");
  });

  it("does not verify a focused result from a changed runtime", async () => {
    const good = await makeBuild({ files: { "main.tex": "good\nseparator\nOld prose" }, ok: true });
    const failed = await makeBuild({ files: { "main.tex": "bad\nseparator\nNew prose" }, ok: false });
    const { compile } = mockCompiler((_files, n) => successResult(n === 1 ? ENV : OTHER_ENV));
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });
    expect(report.status).toBe("unresolved");
    expect(report.candidate).toBeNull();
    expect(report.trials[1].scope).toBe("hunk");
    expect(report.message).toContain("runtime");
  });

  it("retains the five-candidate bound when focused and file candidates coexist", async () => {
    const good = await makeBuild({ files: { "main.tex": "a\ns1\nb\ns2\nc\ns3\nd", "other.tex": "old" }, ok: true });
    const failed = await makeBuild({ files: { "main.tex": "A\ns1\nB\ns2\nC\ns3\nD", "other.tex": "new" }, ok: false });
    const { compile, calls } = mockCompiler((_files, n) => n === 1 ? successResult() : latexFailure());
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });
    expect(report.status).toBe("unresolved");
    expect(calls).toHaveLength(6);
    expect(report.focusedSearch).toEqual({ candidates: 3, limited: true });
    expect(report.trials.slice(1).filter((trial) => trial.scope === "file")).toHaveLength(2);
  });

  it("verifies baseline plus one candidate while preserving unrelated files", async () => {
    const good = await makeBuild({ files: { "main.tex": "good", "other.tex": "same" }, ok: true });
    const failed = await makeBuild({
      files: { "main.tex": "broken", "other.tex": "same" },
      ok: false,
      diagnostics: [{ severity: "error", message: "x", file: "main.tex", line: 1 }],
    });
    const { compile, calls } = mockCompiler((files) =>
      files["main.tex"] === "good" ? successResult() : latexFailure(),
    );
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });

    expect(report.status).toBe("verified");
    expect(report.candidate?.path).toBe("main.tex");
    expect(report.trials).toHaveLength(2);
    expect(report.trials[0].path).toBeNull();
    expect(report.trials[1].path).toBe("main.tex");
    // Baseline ran against the good snapshot; the candidate trial kept other.tex.
    expect(calls[0].request.files).toEqual({ "main.tex": "good", "other.tex": "same" });
    expect(calls[1].request.files).toEqual({ "main.tex": "good", "other.tex": "same" });
    expect(report.message).toContain("main.tex");
  });

  it("queues no jobs when the recorded environments mismatch", async () => {
    const good = await makeBuild({ files: { "main.tex": "a" }, ok: true, environment: ENV });
    const failed = await makeBuild({
      files: { "main.tex": "b" },
      ok: false,
      environment: OTHER_ENV,
    });
    const { compile, calls } = mockCompiler(() => successResult());
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });

    expect(report.status).toBe("incompatible");
    expect(calls).toHaveLength(0);
    expect(report.trials).toHaveLength(0);
    expect(report.candidate).toBeNull();
  });

  it("verifies Sandbox trials only against the same snapshot and execution policy", async () => {
    const environment: CompileEnvironment = { mode: "sandbox", runtimeId: "snap_tex", platform: "linux/amd64", policyId: "offline-v1" };
    const good = await makeBuild({ files: { "main.tex": "good" }, ok: true, environment });
    const failed = await makeBuild({ files: { "main.tex": "bad" }, ok: false, environment });
    const { compile } = mockCompiler(files => files["main.tex"] === "good" ? successResult(environment) : latexFailure(environment));
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });
    expect(report.candidate).not.toBeNull();
    expect(report.status).not.toBe("incompatible");
  });

  it.each([undefined, "changed-policy"])("refuses Sandbox verification with a missing or changed policy: %s", async policyId => {
    const environment: CompileEnvironment = { mode: "sandbox", runtimeId: "snap_tex", platform: "linux/amd64", policyId: "offline-v1" };
    const good = await makeBuild({ files: { "main.tex": "good" }, ok: true, environment });
    const failed = await makeBuild({ files: { "main.tex": "bad" }, ok: false, environment: { ...environment, policyId } });
    const { compile, calls } = mockCompiler(() => successResult(environment));
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });
    expect(report.status).toBe("incompatible");
    expect(calls).toHaveLength(0);
  });

  it("never verifies when the runtime changes mid-trial", async () => {
    const good = await makeBuild({ files: { "main.tex": "good" }, ok: true });
    const failed = await makeBuild({ files: { "main.tex": "bad" }, ok: false });
    const { compile } = mockCompiler(() => successResult(OTHER_ENV));
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });

    expect(report.status).toBe("unresolved");
    expect(report.candidate).toBeNull();
    expect(report.message).toContain("runtime or sandbox policy changed");
  });

  it("stops as incompatible when the baseline no longer builds", async () => {
    const good = await makeBuild({ files: { "main.tex": "good" }, ok: true });
    const failed = await makeBuild({ files: { "main.tex": "bad" }, ok: false });
    const { compile, calls } = mockCompiler(() => latexFailure());
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });

    expect(report.status).toBe("incompatible");
    expect(report.message).toContain("no longer builds");
    expect(calls).toHaveLength(1);
    expect(report.trials).toHaveLength(1);
    expect(report.candidate).toBeNull();
  });

  it("caps trials at 5 candidates plus 1 baseline", async () => {
    const goodFiles: Record<string, string> = { "main.tex": "g" };
    const failedFiles: Record<string, string> = { "main.tex": "g" };
    for (let i = 1; i <= 7; i++) failedFiles[`f${i}.tex`] = `bad${i}`;
    const good = await makeBuild({ files: goodFiles, ok: true });
    const failed = await makeBuild({ files: failedFiles, ok: false });
    const { compile, calls } = mockCompiler((_files, n) =>
      n === 1 ? successResult() : latexFailure(),
    );
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });

    expect(report.changes).toHaveLength(7);
    expect(report.status).toBe("unresolved");
    expect(report.candidate).toBeNull();
    expect(calls).toHaveLength(6);
    expect(report.trials).toHaveLength(6);
  });

  it("stops unresolved on timeout/infrastructure trial failures", async () => {
    const good = await makeBuild({ files: { "main.tex": "g", "a.tex": "1", "b.tex": "2" }, ok: true });
    const failed = await makeBuild({
      files: { "main.tex": "g", "a.tex": "X", "b.tex": "Y" },
      ok: false,
    });
    const { compile, calls } = mockCompiler((files, n) => {
      if (n === 1) return successResult();
      return { ...latexFailure(), errorCode: "TIMEOUT" };
    });
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });

    expect(report.status).toBe("unresolved");
    expect(report.candidate).toBeNull();
    expect(report.message).toContain("timeout or infrastructure");
    expect(calls).toHaveLength(2);
  });

  it("queues no further jobs once aborted", async () => {
    const good = await makeBuild({ files: { "main.tex": "good" }, ok: true });
    const failed = await makeBuild({ files: { "main.tex": "bad" }, ok: false });
    const { compile, calls } = mockCompiler(() => successResult());
    const controller = new AbortController();
    controller.abort();
    const report = await findBuildRecovery(good, failed, { signal: controller.signal, compile });

    expect(calls).toHaveLength(0);
    expect(report.trials).toHaveLength(0);
    expect(report.status).toBe("unresolved");
    expect(report.candidate).toBeNull();
    expect(report.message).toContain("Recovery stopped");
  });

  it("rejects a stored build whose hash was tampered with", async () => {
    const good = await makeBuild({ files: { "main.tex": "good" }, ok: true });
    const failed = await makeBuild({ files: { "main.tex": "bad" }, ok: false });
    const tampered: BuildRecord = {
      ...good,
      files: { "main.tex": "tampered-after-the-fact" },
    };
    const { compile, calls } = mockCompiler(() => successResult());
    const report = await findBuildRecovery(tampered, failed, { signal: freshSignal(), compile });

    expect(report.status).toBe("incompatible");
    expect(report.message).toContain("fingerprint");
    expect(calls).toHaveLength(0);
  });

  it("reports incompatible when sources are identical", async () => {
    const files = { "main.tex": "same" };
    const good = await makeBuild({ files, ok: true });
    const failed = await makeBuild({ files: { ...files }, ok: false });
    const { compile, calls } = mockCompiler(() => successResult());
    const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });

    expect(report.changes).toEqual([]);
    expect(report.status).toBe("incompatible");
    expect(report.message).toContain("identical");
    expect(calls).toHaveLength(0);
  });

  it("reports incompatible when settings or root differ", async () => {
    const good = await makeBuild({ files: { "main.tex": "a" }, ok: true, engine: "pdflatex" });
    const otherEngine = await makeBuild({
      files: { "main.tex": "b" },
      ok: false,
      engine: "lualatex",
    });
    const otherRoot = await makeBuild({
      files: { "index.tex": "a", "main.tex": "a" },
      ok: false,
      mainFile: "index.tex",
    });
    const { compile, calls } = mockCompiler(() => successResult());

    for (const failed of [otherEngine, otherRoot]) {
      const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });
      expect(report.status).toBe("incompatible");
      expect(report.message).toContain("changed");
    }
    expect(calls).toHaveLength(0);
  });
  it("returns an incompatible report when source hashing is unavailable", async () => {
    const good = await makeBuild({ files: { "main.tex": "good" }, ok: true });
    const failed = await makeBuild({ files: { "main.tex": "bad" }, ok: false });
    const prior = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try {
      const { compile, calls } = mockCompiler(() => successResult());
      const report = await findBuildRecovery(good, failed, { signal: freshSignal(), compile });
      expect(report.status).toBe("incompatible");
      expect(report.message).toContain("HTTPS or localhost");
      expect(calls).toHaveLength(0);
    } finally { Object.defineProperty(globalThis, "crypto", { value: prior, configurable: true }); }
  });

});


describe("sandbox policy provenance",()=>{
  it("refuses builds from different policies before submitting trials",async()=>{
    const good=await makeBuild({ok:true,files:{"main.tex":"good"},environment:{...ENV,policyId:"v1"}});
    const failed=await makeBuild({ok:false,files:{"main.tex":"bad"},environment:{...ENV,policyId:"v2"}});
    const mock=mockCompiler(()=>successResult());
    const report=await findBuildRecovery(good,failed,{signal:new AbortController().signal,compile:mock.compile});
    expect(report.status).toBe("incompatible");expect(mock.calls).toHaveLength(0);
  });
  it("never verifies a legacy record under a newly restricted runtime",async()=>{
    const good=await makeBuild({ok:true,files:{"main.tex":"good"}});
    const failed=await makeBuild({ok:false,files:{"main.tex":"bad"}});
    const mock=mockCompiler(()=>successResult({...ENV,policyId:"v1"}));
    const report=await findBuildRecovery(good,failed,{signal:new AbortController().signal,compile:mock.compile});
    expect(report.status).toBe("unresolved");expect(report.candidate).toBeNull();expect(mock.calls).toHaveLength(1);
  });
  it("verifies trials only when the policy remains identical",async()=>{
    const environment={...ENV,policyId:"v1"};
    const good=await makeBuild({ok:true,files:{"main.tex":"good"},environment});
    const failed=await makeBuild({ok:false,files:{"main.tex":"bad"},environment});
    const mock=mockCompiler(()=>successResult(environment));
    const report=await findBuildRecovery(good,failed,{signal:new AbortController().signal,compile:mock.compile});
    expect(report.status).toBe("verified");expect(mock.calls).toHaveLength(2);
  });
});
