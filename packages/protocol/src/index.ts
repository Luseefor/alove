export type BuildPhase = "queued" | "compiling" | "ready" | "failed";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface CompileJobPayload {
  projectId: string;
  mainFile: string;
  files: Record<string, string>;
  engine?: "pdflatex" | "lualatex" | "xelatex";
  /** Run `latexmk -c` before the main build to drop aux files in the work dir. */
  cleanAux?: boolean;
  /** Wall-clock cap for the TeX process (ms). Default 120_000. */
  timeoutMs?: number;
}

export interface CompileEnvironment {
  mode: "docker" | "host";
  /** Resolved immutable Docker image ID; host runtimes are unverified. */
  runtimeId: string;
  /** Server execution policy; absent on legacy builds. */
  policyId?: string;
  platform: string;
}

export interface CompileJobResult {
  environment?: CompileEnvironment;
  phase: BuildPhase;
  log: string;
  diagnostics: Diagnostic[];
  pdfBase64?: string;
  mainPdfRelPath?: string;
  errorMessage?: string;
  errorCode?:
    | "CANCELLED"
    | "VALIDATION_ERROR"
    | "TIMEOUT"
    | "DOCKER_ERROR"
    | "LATEX_ERROR"
    | "OUTPUT_TOO_LARGE"
    | "INTERNAL_ERROR";
  texliveImage?: string;
  timedOut?: boolean;
}

export const COMPILE_REQUEST_LIMITS = {
  maxFiles: 250,
  maxFileBytes: 1048576,
  maxTotalBytes: 10485760,
  maxRequestBytes: 22020096,
  minTimeoutMs: 1000,
  maxTimeoutMs: 120000,
} as const;

export type ValidateCompileRequestOk = {
  ok: true;
  value: CompileJobPayload;
};

export type ValidateCompileRequestErr = {
  ok: false;
  error: string;
  status: 400 | 413;
};

export type ValidateCompileRequestResult =
  | ValidateCompileRequestOk
  | ValidateCompileRequestErr;

const ALLOWED_FIELDS = new Set([
  "projectId",
  "mainFile",
  "files",
  "engine",
  "cleanAux",
  "timeoutMs",
]);

const ALLOWED_ENGINES = new Set(["pdflatex", "lualatex", "xelatex"]);

const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const MAX_PATH_BYTES = 1024;

const utf8 = new TextEncoder();

function utf8Bytes(s: string): number {
  return utf8.encode(s).length;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function normalizeCompilePath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  if (path.length === 0) return null;
  if (utf8Bytes(path) > MAX_PATH_BYTES) return null;
  if (path.includes("\\")) return null;
  if (path.includes(":")) return null;
  if (path.startsWith("/")) return null;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return null;
  }
  const segs = path.split("/");
  for (const seg of segs) {
    if (seg === "") return null;
    if (seg === "." || seg === "..") return null;
    if (PROTOTYPE_KEYS.has(seg)) return null;
    if (seg.startsWith("-")) return null;
    if (seg !== seg.trim()) return null;
  }
  return path;
}

function err(error: string, status: 400 | 413): ValidateCompileRequestErr {
  return { ok: false, error, status };
}

export function validateCompileRequest(
  input: unknown,
): ValidateCompileRequestResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err("request must be an object", 400);
  }
  const record = input as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return err(`unknown field: ${key}`, 400);
    }
  }

  const rawProjectId = Object.hasOwn(record, "projectId")
    ? record["projectId"]
    : undefined;
  if (typeof rawProjectId !== "string") {
    return err("projectId must be a string", 400);
  }
  const projectId = rawProjectId.trim();
  if (projectId.length === 0) {
    return err("projectId must be nonempty", 400);
  }
  if (projectId.length > 200) {
    return err("projectId must be <= 200 chars", 400);
  }

  const rawFiles = Object.hasOwn(record, "files") ? record["files"] : undefined;
  if (!isPlainObject(rawFiles)) {
    return err("files must be an object map", 400);
  }
  const keys = Object.keys(rawFiles);
  if (keys.length < 1 || keys.length > COMPILE_REQUEST_LIMITS.maxFiles) {
    return err(
      `files must contain 1..${COMPILE_REQUEST_LIMITS.maxFiles} entries`,
      413,
    );
  }

  const freshFiles: Record<string, string> = {};
  let totalBytes = 0;
  for (const k of keys) {
    if (normalizeCompilePath(k) !== k) {
      return err(`invalid file path: ${k}`, 400);
    }
    const v: unknown = (rawFiles as Record<string, unknown>)[k];
    if (typeof v !== "string") {
      return err(`file content must be a string: ${k}`, 400);
    }
    const n = utf8Bytes(v);
    if (n > COMPILE_REQUEST_LIMITS.maxFileBytes) {
      return err(`file too large: ${k}`, 413);
    }
    totalBytes += n;
    if (totalBytes > COMPILE_REQUEST_LIMITS.maxTotalBytes) {
      return err("total files too large", 413);
    }
  }

  const seen = new Set(keys);
  for (const p of keys) {
    const parts = p.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = i === 0 ? parts[0] : `${prefix}/${parts[i]}`;
      if (seen.has(prefix)) {
        return err(`file conflicts with parent: ${p}`, 400);
      }
    }
  }

  for (const k of keys) {
    freshFiles[k] = (rawFiles as Record<string, string>)[k];
  }

  const rawMain = Object.hasOwn(record, "mainFile")
    ? record["mainFile"]
    : undefined;
  if (typeof rawMain !== "string") {
    return err("mainFile must be a string", 400);
  }
  if (normalizeCompilePath(rawMain) !== rawMain) {
    return err("mainFile must be a valid path", 400);
  }
  if (!rawMain.endsWith(".tex")) {
    return err("mainFile must end with .tex", 400);
  }
  if (!Object.hasOwn(rawFiles, rawMain)) {
    return err("mainFile must be a key in files", 400);
  }

  const rawEngine = Object.hasOwn(record, "engine")
    ? record["engine"]
    : undefined;
  let engine: CompileJobPayload["engine"];
  if (rawEngine === undefined) {
    engine = "pdflatex";
  } else if (typeof rawEngine === "string" && ALLOWED_ENGINES.has(rawEngine)) {
    engine = rawEngine as NonNullable<CompileJobPayload["engine"]>;
  } else {
    return err("engine must be pdflatex, lualatex, or xelatex", 400);
  }

  const rawClean = Object.hasOwn(record, "cleanAux")
    ? record["cleanAux"]
    : undefined;
  let cleanAux: boolean | undefined;
  if (rawClean === undefined) {
    cleanAux = undefined;
  } else if (typeof rawClean === "boolean") {
    cleanAux = rawClean;
  } else {
    return err("cleanAux must be a boolean", 400);
  }

  const rawTimeout = Object.hasOwn(record, "timeoutMs")
    ? record["timeoutMs"]
    : undefined;
  let timeoutMs: number | undefined;
  if (rawTimeout === undefined) {
    timeoutMs = undefined;
  } else if (
    typeof rawTimeout === "number" &&
    Number.isSafeInteger(rawTimeout) &&
    rawTimeout >= COMPILE_REQUEST_LIMITS.minTimeoutMs &&
    rawTimeout <= COMPILE_REQUEST_LIMITS.maxTimeoutMs
  ) {
    timeoutMs = rawTimeout;
  } else {
    return err(
      `timeoutMs must be an integer ${COMPILE_REQUEST_LIMITS.minTimeoutMs}..${COMPILE_REQUEST_LIMITS.maxTimeoutMs}`,
      400,
    );
  }

  const value: CompileJobPayload = {
    projectId,
    mainFile: rawMain,
    files: freshFiles,
    engine,
  };
  if (cleanAux !== undefined) value.cleanAux = cleanAux;
  if (timeoutMs !== undefined) value.timeoutMs = timeoutMs;
  return { ok: true, value };
}


export type CompileJobOwner =
  | { kind: "user"; userId: string }
  | { kind: "local"; origin: string };

export type QueuedCompileJob = {
  version: 1;
  owner: CompileJobOwner;
  request: CompileJobPayload;
};

export type ValidateQueuedCompileJobOk = {
  ok: true;
  value: QueuedCompileJob;
};

export type ValidateQueuedCompileJobErr = {
  ok: false;
  error: string;
};

export type ValidateQueuedCompileJobResult =
  | ValidateQueuedCompileJobOk
  | ValidateQueuedCompileJobErr;

const ENVELOPE_FIELDS = new Set(["version", "owner", "request"]);
const OWNER_BASE_FIELDS = new Set(["kind", "userId", "origin"]);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function fail(error: string): ValidateQueuedCompileJobErr {
  return { ok: false, error };
}

export function isLocalCompileOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!LOCAL_HOSTS.has(url.hostname)) return false;
  if (url.port === "") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.search !== "" || url.hash !== "") return false;
  if (url.pathname !== "/") return false;
  if (url.origin !== origin) return false;
  return true;
}

function validateOwner(
  input: unknown,
): { ok: true; value: CompileJobOwner } | { ok: false; error: string } {
  if (!isPlainObject(input)) return fail("owner must be an object");
  for (const key of Object.keys(input)) {
    if (PROTOTYPE_KEYS.has(key)) return fail(`invalid owner key: ${key}`);
    if (!OWNER_BASE_FIELDS.has(key)) {
      return fail(`unknown owner field: ${key}`);
    }
  }
  const kind = input["kind"];
  if (kind !== "user" && kind !== "local") {
    return fail("owner.kind must be user or local");
  }
  if (kind === "user") {
    for (const key of Object.keys(input)) {
      if (key !== "kind" && key !== "userId") {
        return fail(`unknown owner field: ${key}`);
      }
    }
    if (!Object.hasOwn(input, "userId"))
      return fail("owner.userId must be a string");
    const userId = input["userId"];
    if (typeof userId !== "string")
      return fail("owner.userId must be a string");
    if (userId.trim().length === 0)
      return fail("owner.userId must be nonempty");
    if (userId.length > 256) return fail("owner.userId must be <= 256 chars");
    return { ok: true, value: { kind: "user", userId: userId.trim() } };
  }
  for (const key of Object.keys(input)) {
    if (key !== "kind" && key !== "origin") {
      return fail(`unknown owner field: ${key}`);
    }
  }
  if (!Object.hasOwn(input, "origin"))
    return fail("owner.origin must be a string");
  const origin = input["origin"];
  if (typeof origin !== "string") return fail("owner.origin must be a string");
  if (!isLocalCompileOrigin(origin))
    return fail("owner.origin must be a canonical local origin");
  return { ok: true, value: { kind: "local", origin } };
}

export function validateQueuedCompileJob(
  input: unknown,
): ValidateQueuedCompileJobResult {
  if (!isPlainObject(input)) return fail("job must be an object");
  for (const key of Object.keys(input)) {
    if (PROTOTYPE_KEYS.has(key)) return fail(`invalid field: ${key}`);
    if (!ENVELOPE_FIELDS.has(key)) return fail(`unknown field: ${key}`);
  }
  const record = input;
  if (!Object.hasOwn(record, "version")) return fail("version must be 1");
  if (!Object.hasOwn(record, "owner")) return fail("owner must be an object");
  if (!Object.hasOwn(record, "request"))
    return fail("request must be an object");
  if (record["version"] !== 1) return fail("version must be 1");
  const ownerResult = validateOwner(record["owner"]);
  if (!ownerResult.ok) return ownerResult;
  const requestResult = validateCompileRequest(record["request"]);
  if (!requestResult.ok) return fail(requestResult.error);
  return {
    ok: true,
    value: {
      version: 1,
      owner: ownerResult.value,
      request: requestResult.value,
    },
  };
}
