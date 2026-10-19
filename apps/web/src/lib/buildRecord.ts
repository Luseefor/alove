import type { CompileJobPayload, CompileJobResult } from "@alove/protocol";

export type BuildEnvironment = {
  mode: "docker" | "host";
  runtimeId: string;
  platform: string;
};

export type BuildRecord = {
  schema: 1;
  id: string;
  projectId: string;
  revision: number;
  startedAt: number;
  completedAt: number;
  sourceHash: string;
  mainFile: string;
  engine: NonNullable<CompileJobPayload["engine"]>;
  cleanAux: boolean;
  files: Record<string, string>;
  result: {
    ok: boolean;
    log: string;
    diagnostics: CompileJobResult["diagnostics"];
    errorCode?: CompileJobResult["errorCode"];
    message?: string;
    environment?: BuildEnvironment;
  };
};

export async function hashBuildSource(input: Pick<BuildRecord, "files" | "mainFile" | "engine" | "cleanAux">): Promise<string> {
  const canonical = JSON.stringify([input.mainFile, input.engine, input.cleanAux,
    Object.keys(input.files).sort().map((path) => [path, input.files[path]])]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}

export async function createBuildRecord(
  request: CompileJobPayload,
  result: CompileJobResult,
  revision: number,
  startedAt: number,
): Promise<BuildRecord> {
  const input = { files: { ...request.files }, mainFile: request.mainFile,
    engine: request.engine ?? "pdflatex" as const, cleanAux: request.cleanAux ?? false };
  return {
    schema: 1, id: crypto.randomUUID(), projectId: request.projectId,
    revision, startedAt, completedAt: Date.now(), ...input,
    sourceHash: await hashBuildSource(input),
    result: {
      ok: result.phase === "ready" && Boolean(result.pdfBase64),
      log: result.log.slice(-262144), diagnostics: result.diagnostics.slice(0, 500),
      errorCode: result.errorCode, message: result.errorMessage,
      environment: result.environment,
    },
  };
}
