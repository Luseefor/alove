import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { constants } from "node:fs";
import { dirname, join, relative, isAbsolute, sep } from "node:path";
import {
  normalizeCompilePath,
  validateCompileRequest,
  type CompileJobPayload,
  type CompileJobResult,
  type Diagnostic,
  type CompileEnvironment,
} from "@alove/protocol";
import { parseLatexLog } from "./logParse.js";
import { decodeCompileFileData } from "./compileFileData.js";
import { dockerSandboxArgs, resolveDockerSandboxPolicy, sandboxPolicyId } from "./dockerSandbox.js";
import { ArtifactTooLargeError, readDockerArtifact } from "./dockerArtifact.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_FILES = 250;
const DEFAULT_MAX_FILE_BYTES = 1_048_576;
const DEFAULT_MAX_TOTAL_BYTES = 10_485_760;
const DEFAULT_MAX_LOG_BYTES = 262_144;
const DEFAULT_MAX_PDF_BYTES = 52_428_800;

type RunCmdOptions = {
  signal?: AbortSignal;
  maxOutputBytes?: number;
};

type CompileLimits = {
  timeoutMs: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxLogBytes: number;
  maxPdfBytes: number;
};

export type RunCompileOptions = {
  signal?: AbortSignal;
};

type ValidatedPayload = {
  files: Array<{ path: string; content: string }>;
  mainFile: string;
};

async function resolveWorkRoot(): Promise<string> {
  const raw = process.env.COMPILE_WORK_ROOT;
  if (raw === undefined || raw === "") return tmpdir();
  if (raw.includes("\0")) throw new Error("COMPILE_WORK_ROOT must not contain NUL");
  if (!isAbsolute(raw)) throw new Error("COMPILE_WORK_ROOT must be an absolute path");
  await mkdir(raw, { recursive: true });
  const resolved = await realpath(raw);
  if (resolved.includes("\0")) throw new Error("COMPILE_WORK_ROOT must not contain NUL");
  if (!isAbsolute(resolved)) throw new Error("COMPILE_WORK_ROOT must resolve to an absolute path");
  return resolved;
}

function cancelledResult(args: {
  texliveImage: string;
  log?: string;
  environment?: CompileEnvironment;
}): CompileJobResult {
  const log = args.log ?? "";
  return executionFailure({
    message: "Compile cancelled",
    texliveImage: args.texliveImage,
    log,
    diagnostics: [{ severity: "error", message: "Compile cancelled" }],
    errorCode: "CANCELLED",
    environment: args.environment,
  });
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  minimum = 1,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
  return parsed;
}

function resolveLimits(payload: CompileJobPayload): CompileLimits {
  const timeoutCap = parsePositiveInt(
    process.env.COMPILE_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    1_000,
  );
  const requestedTimeout = payload.timeoutMs ?? timeoutCap;
  const timeoutMs = Math.min(Math.max(requestedTimeout, 1_000), timeoutCap);

  return {
    timeoutMs,
    maxFiles: parsePositiveInt(
      process.env.COMPILE_MAX_FILES,
      DEFAULT_MAX_FILES,
    ),
    maxFileBytes: parsePositiveInt(
      process.env.COMPILE_MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES,
    ),
    maxTotalBytes: parsePositiveInt(
      process.env.COMPILE_MAX_TOTAL_BYTES,
      DEFAULT_MAX_TOTAL_BYTES,
    ),
    maxLogBytes: parsePositiveInt(
      process.env.COMPILE_MAX_LOG_BYTES,
      DEFAULT_MAX_LOG_BYTES,
    ),
    maxPdfBytes: parsePositiveInt(
      process.env.COMPILE_MAX_PDF_BYTES,
      DEFAULT_MAX_PDF_BYTES,
    ),
  };
}

function keepTailBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buf = Buffer.from(text);
  if (buf.byteLength <= maxBytes) return text;
  return buf.subarray(buf.byteLength - maxBytes).toString("utf8");
}

function appendBounded(
  current: string,
  chunk: string,
  maxBytes: number,
): string {
  if (maxBytes <= 0) return "";
  return keepTailBytes(current + chunk, maxBytes);
}

function trimLog(
  log: string,
  maxLogBytes: number,
): { text: string; truncated: boolean } {
  const fullBytes = Buffer.byteLength(log, "utf8");
  if (fullBytes <= maxLogBytes) return { text: log, truncated: false };
  return { text: keepTailBytes(log, maxLogBytes), truncated: true };
}

function validationFailure(
  message: string,
  texliveImage: string,
  diagnostics: Diagnostic[] = [],
): CompileJobResult {
  return {
    phase: "failed",
    log: "",
    diagnostics:
      diagnostics.length > 0 ? diagnostics : [{ severity: "error", message }],
    errorMessage: message,
    errorCode: "VALIDATION_ERROR",
    texliveImage,
  };
}

function executionFailure(args: {
  message: string;
  texliveImage: string;
  log: string;
  diagnostics?: Diagnostic[];
  errorCode: CompileJobResult["errorCode"];
  timedOut?: boolean;
  environment?: CompileEnvironment;
}): CompileJobResult {
  return {
    phase: "failed",
    log: args.log,
    diagnostics:
      args.diagnostics && args.diagnostics.length > 0
        ? args.diagnostics
        : [{ severity: "error", message: args.message }],
    errorMessage: args.message,
    errorCode: args.errorCode,
    texliveImage: args.texliveImage,
    timedOut: args.timedOut,
    environment: args.environment,
  };
}

async function runCmd(
  command: string,
  args: string[],
  cwd: string,
  options: RunCmdOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_LOG_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      signal: options.signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, String(chunk), maxOutputBytes);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, String(chunk), maxOutputBytes);
    });
    child.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ABORT_ERR") {
        resolve({ code: 124, stdout, stderr });
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function latexmkEngineArgs(engine: CompileJobPayload["engine"]): string[] {
  switch (engine) {
    case "xelatex":
      return ["-xelatex"];
    case "lualatex":
      return ["-lualatex"];
    case "pdflatex":
    default:
      return ["-pdf"];
  }
}

function validatePayload(
  payload: CompileJobPayload,
  limits: CompileLimits,
  texliveImage: string,
):
  | { ok: true; value: ValidatedPayload }
  | { ok: false; result: CompileJobResult } {
  const request = validateCompileRequest(payload);
  if (!request.ok)
    return {
      ok: false,
      result: validationFailure(request.error, texliveImage),
    };
  payload = request.value;
  const entries = Object.entries(payload.files);
  if (entries.length === 0) {
    return {
      ok: false,
      result: validationFailure("No files provided", texliveImage),
    };
  }
  if (entries.length > limits.maxFiles) {
    return {
      ok: false,
      result: validationFailure(
        `Too many files (${entries.length}). Limit is ${limits.maxFiles}.`,
        texliveImage,
      ),
    };
  }

  let totalBytes = 0;
  const normalizedFiles = new Map<string, string>();
  for (const [rawPath, content] of entries) {
    const normalizedPath = normalizeCompilePath(rawPath);
    if (!normalizedPath) {
      return {
        ok: false,
        result: validationFailure(`Unsafe file path: ${rawPath}`, texliveImage),
      };
    }

    const fileBytes = Buffer.byteLength(content, "utf8");
    if (fileBytes > limits.maxFileBytes) {
      return {
        ok: false,
        result: validationFailure(
          `File too large (${normalizedPath}). Limit is ${limits.maxFileBytes} bytes.`,
          texliveImage,
        ),
      };
    }

    totalBytes += fileBytes;
    if (totalBytes > limits.maxTotalBytes) {
      return {
        ok: false,
        result: validationFailure(
          `Project payload too large. Limit is ${limits.maxTotalBytes} bytes.`,
          texliveImage,
        ),
      };
    }

    if (normalizedFiles.has(normalizedPath)) {
      return {
        ok: false,
        result: validationFailure(
          `Duplicate normalized file path: ${normalizedPath}`,
          texliveImage,
        ),
      };
    }
    normalizedFiles.set(normalizedPath, content);
  }

  const normalizedMain = normalizeCompilePath(payload.mainFile);
  if (!normalizedMain) {
    return {
      ok: false,
      result: validationFailure(
        `Unsafe main file path: ${payload.mainFile}`,
        texliveImage,
      ),
    };
  }
  if (!normalizedFiles.has(normalizedMain)) {
    return {
      ok: false,
      result: validationFailure(
        `Main file "${normalizedMain}" is missing from payload files.`,
        texliveImage,
      ),
    };
  }

  return {
    ok: true,
    value: {
      mainFile: normalizedMain,
      files: [...normalizedFiles.entries()].map(([path, content]) => ({
        path,
        content,
      })),
    },
  };
}

async function ensureDockerContainerRemoved(
  containerName: string,
  cwd: string,
): Promise<void> {
  // Concurrent cleanup/deadline removal can race. Wait for it to finish.
  for (let attempt = 0; attempt < 20; attempt++) {
    const removed = await runCmd("docker", ["rm", "-f", containerName], cwd, {
      maxOutputBytes: 16_384,
      signal: AbortSignal.timeout(5000),
    });
    const detail = `${removed.stdout}\n${removed.stderr}`.toLowerCase();
    if (removed.code === 0 || detail.includes("no such container")) return;
    if (
      detail.includes("removal of container") &&
      detail.includes("already in progress") &&
      attempt < 19
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    throw new Error(
      `docker cleanup failed for container ${containerName} (exit ${removed.code}): ${detail.trim()}`,
    );
  }
}

async function readArtifact(
  work: string,
  path: string,
  cap: number,
  tail = false,
): Promise<{ data: Buffer; truncated: boolean }> {
  const resolved = await realpath(path);
  const rel = relative(await realpath(work), resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("Artifact leaves compile directory");
  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Artifact is not a regular file");
    if (info.size > cap && !tail)
      throw new ArtifactTooLargeError(`Compiled PDF exceeds ${cap} bytes`);
    const size = Math.min(info.size, cap);
    const data = Buffer.alloc(size);
    const { bytesRead } = await file.read(
      data,
      0,
      size,
      tail ? Math.max(0, info.size - size) : 0,
    );
    return { data: data.subarray(0, bytesRead), truncated: info.size > cap };
  } finally {
    await file.close();
  }
}

export async function runCompileJob(
  payload: CompileJobPayload,
  options: RunCompileOptions = {},
): Promise<CompileJobResult> {
  const externalSignal = options?.signal;
  const image =
    process.env.COMPILE_DOCKER_IMAGE ?? "ghcr.io/xu-cheng/texlive-full:latest";
  if (externalSignal?.aborted) {
    return cancelledResult({ texliveImage: image, log: "" });
  }
  const request = validateCompileRequest(payload);
  if (!request.ok) return validationFailure(request.error, image);
  payload = request.value;
  const limits = resolveLimits(payload);
  const useDocker = process.env.COMPILE_USE_DOCKER !== "0" && process.env.COMPILE_USE_DOCKER !== "false";
  let workRoot: string;
  try {
    workRoot = await resolveWorkRoot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return validationFailure(`Invalid COMPILE_WORK_ROOT: ${message}`, image);
  }
  if (externalSignal?.aborted) {
    return cancelledResult({ texliveImage: image, log: "" });
  }
  const work = await mkdtemp(join(workRoot, "alove-tex-"));
  let dockerContainerName: string | null = null;
  let environment: CompileEnvironment | undefined;

  function wasCancelled(): boolean {
    return externalSignal?.aborted === true;
  }

  function linkController(timeoutMs: number): {
    controller: AbortController;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let onExternal: (() => void) | undefined;
    if (externalSignal) {
      if (externalSignal.aborted) {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      } else {
        onExternal = () => {
          try {
            controller.abort();
          } catch {
            // ignore
          }
        };
        externalSignal.addEventListener("abort", onExternal, { once: true });
      }
    }
    const cleanup = () => {
      clearTimeout(timer);
      if (externalSignal && onExternal) {
        externalSignal.removeEventListener("abort", onExternal);
      }
    };
    return { controller, cleanup };
  }

  try {
    if (wasCancelled()) {
      return cancelledResult({ texliveImage: image, log: "" });
    }
    const validated = validatePayload(payload, limits, image);
    if (!validated.ok) {
      return validated.result;
    }

    let decodedFiles: Array<{ path: string; content: string | Uint8Array }>;
    try {
      decodedFiles = validated.value.files.map((file) => ({
        path: file.path,
        content: decodeCompileFileData(file.path, file.content),
      }));
    } catch (error) {
      return validationFailure(
        error instanceof Error ? error.message : "Invalid binary asset",
        image,
      );
    }
    // Keep the host parent private. Only this readable child is mounted, read-only.
    const sourceRoot = useDocker ? join(work, "source") : work;
    if (useDocker) { await mkdir(sourceRoot, { mode: 0o755 }); await chmod(sourceRoot, 0o755); }
    const readableDirectories = new Set([sourceRoot]);
    for (const file of decodedFiles) {
      const target = join(sourceRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
      if (useDocker) {
        // Respect a restrictive worker umask without making the private host
        // parent accessible. The container has a different numeric uid.
        await chmod(target, 0o644);
        let directory = dirname(target);
        while (!readableDirectories.has(directory)) {
          await chmod(directory, 0o755);
          readableDirectories.add(directory);
          directory = dirname(directory);
        }
      }
    }

    const main = validated.value.mainFile;

    // Caller-provided previous outputs cannot stand in for this build's artifacts.
    for (const extension of [".log", ".pdf"]) {
      await rm(join(sourceRoot, main.replace(/\.tex$/u, extension)), { force: true });
    }
    if (
      !useDocker &&
      (process.env.COMPILE_TRUSTED_LOCAL !== "true" ||
        process.env.NODE_ENV === "production")
    ) {
      return validationFailure(
        "Host TeX requires COMPILE_TRUSTED_LOCAL=true outside production. Use Docker for deployed workers.",
        image,
      );
    }
    const commands = [
      ...(payload.cleanAux
        ? [[
            "-norc",
            "-c",
            `-outdir=./${dirname(main)}`,
            "-interaction=batchmode",
            `./${main}`,
          ]]
        : []),
      [
        "-norc",
        ...latexmkEngineArgs(payload.engine),
        "-no-shell-escape",
        `-outdir=./${dirname(main)}`,
        "-interaction=nonstopmode",
        "-halt-on-error",
        `./${main}`,
      ],
    ];

    let combined = "";
    let exit = 1;
    let timedOut = false;

    if (useDocker) {
      const isDarwinArm64 = platform() === "darwin" && arch() === "arm64";
      const envPlatform = process.env.COMPILE_DOCKER_PLATFORM?.trim();
      const dockerPlatform =
        envPlatform && envPlatform.length > 0
          ? envPlatform
          : isDarwinArm64
            ? "linux/amd64"
            : "";
      const inspectLink = linkController(10_000);
      let inspected: { code: number; stdout: string; stderr: string };
      try {
        inspected = await runCmd("docker", ["image", "inspect", "--format", "{{.Id}}|{{.Os}}/{{.Architecture}}", image], work, {
          signal: inspectLink.controller.signal, maxOutputBytes: 4096,
        });
      } finally {
        inspectLink.cleanup();
      }
      if (wasCancelled()) {
        return cancelledResult({ texliveImage: image, log: combined, environment });
      }
      const [imageId, imagePlatform] = inspected.stdout.trim().split("|");
      if (inspected.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId ?? "") || !imagePlatform) {
        return executionFailure({ message: "Cannot resolve the configured Docker image. Pull or build it before compiling.",
          log: inspected.stderr, texliveImage: image, errorCode: "DOCKER_ERROR" });
      }
      let sandbox;
      try { sandbox = resolveDockerSandboxPolicy(); }
      catch (error) {
        return executionFailure({ message: `Invalid Docker sandbox policy: ${String(error)}`, log: "", texliveImage: image, errorCode: "DOCKER_ERROR" });
      }
      environment = { mode: "docker", runtimeId: imageId!, platform: imagePlatform, policyId: sandboxPolicyId(sandbox) };
      if (wasCancelled()) {
        return cancelledResult({ texliveImage: image, log: combined, environment });
      }
      dockerContainerName = `alove-compile-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

      const args = dockerSandboxArgs({
        name: dockerContainerName, sourcePath: await realpath(sourceRoot),
        imageId: imageId!, platform: dockerPlatform, policy: sandbox,
        // --rm plus a finite PID1 lifetime bounds orphans if the worker dies.
        ttlSeconds: Math.ceil(limits.timeoutMs / 1000) + 60,
      });
      if (wasCancelled()) {
        return cancelledResult({ texliveImage: image, log: combined, environment });
      }
      const runLink = linkController(limits.timeoutMs);
      try {
        const started = await runCmd("docker", args, work, {
          signal: runLink.controller.signal, maxOutputBytes: limits.maxLogBytes,
        });
        if (wasCancelled()) {
          return cancelledResult({ texliveImage: image, log: combined, environment });
        }
        timedOut = started.code === 124 || runLink.controller.signal.aborted;
        if (!timedOut && started.code !== 0) {
          return executionFailure({ message: "Cannot start the constrained TeX container.",
            log: started.stderr, texliveImage: image, environment, errorCode: "DOCKER_ERROR" });
        }
        if (!timedOut) {
          const copied = await runCmd("docker", ["exec", dockerContainerName, "cp", "-R", "/source/.", "/work/"], work, {
            signal: runLink.controller.signal, maxOutputBytes: limits.maxLogBytes,
          });
          if (wasCancelled()) {
            return cancelledResult({ texliveImage: image, log: combined, environment });
          }
          timedOut = copied.code === 124 || runLink.controller.signal.aborted;
          if (!timedOut && copied.code !== 0) {
            return executionFailure({ message: "Cannot prepare the constrained TeX workspace.",
              log: copied.stderr, texliveImage: image, environment, errorCode: "DOCKER_ERROR" });
          }
        }
        for (const commandArgs of commands) {
          if (wasCancelled()) {
            return cancelledResult({ texliveImage: image, log: combined, environment });
          }
          if (timedOut || runLink.controller.signal.aborted) { timedOut = true; break; }
          const run = await runCmd("docker", ["exec", dockerContainerName, "latexmk", ...commandArgs], work, {
            signal: runLink.controller.signal, maxOutputBytes: limits.maxLogBytes,
          });
          combined = appendBounded(combined, `${run.stdout}\n${run.stderr}`, limits.maxLogBytes);
          exit = run.code;
          if (wasCancelled()) {
            return cancelledResult({ texliveImage: image, log: combined, environment });
          }
          timedOut = run.code === 124 || runLink.controller.signal.aborted;
        }
      } finally { runLink.cleanup(); }
      if (wasCancelled()) {
        return cancelledResult({ texliveImage: image, log: combined, environment });
      }
    } else {
      environment = { mode: "host", runtimeId: "unverified-host", platform: `${platform()}/${arch()}` };
      if (wasCancelled()) {
        return cancelledResult({ texliveImage: image, log: combined, environment });
      }
      const hostLink = linkController(limits.timeoutMs);
      try {
        for (const commandArgs of commands) {
          if (wasCancelled()) {
            return cancelledResult({ texliveImage: image, log: combined, environment });
          }
          if (hostLink.controller.signal.aborted) {
            timedOut = true;
            break;
          }
          const run = await runCmd("latexmk", commandArgs, work, {
            signal: hostLink.controller.signal,
            maxOutputBytes: limits.maxLogBytes,
          });
          combined = appendBounded(
            combined,
            `${run.stdout}\n${run.stderr}`,
            limits.maxLogBytes,
          );
          exit = run.code;
          if (wasCancelled()) {
            return cancelledResult({ texliveImage: image, log: combined, environment });
          }
          timedOut = run.code === 124 || hostLink.controller.signal.aborted;
        }
      } finally {
        hostLink.cleanup();
      }
      if (wasCancelled()) {
        return cancelledResult({ texliveImage: image, log: combined, environment });
      }
    }

    if (wasCancelled()) {
      return cancelledResult({ texliveImage: image, log: combined, environment });
    }

    const logPath = join(work, main.replace(/\.tex$/u, ".log"));
    if (timedOut && dockerContainerName)
      await ensureDockerContainerRemoved(dockerContainerName, work);
    const artifactLog = timedOut ? null : dockerContainerName
      ? await readDockerArtifact(dockerContainerName, `/work/${main.replace(/\.tex$/u, ".log")}`, limits.maxLogBytes, true)
      : (await pathExists(logPath)) ? await readArtifact(work, logPath, limits.maxLogBytes, true) : null;
    const logText = artifactLog ? artifactLog.data.toString("utf8") : combined;
    const parsedDiagnostics = parseLatexLog(logText);
    const trimmed = {
      text: trimLog(logText, limits.maxLogBytes).text,
      truncated: artifactLog?.truncated ?? false,
    };
    const diagnostics = [...parsedDiagnostics];
    if (trimmed.truncated) {
      diagnostics.push({
        severity: "warning",
        message: `Compile log truncated to ${limits.maxLogBytes} bytes.`,
      });
    }

    // A deadline failure takes precedence over partial or corrupt artifacts.
    if (timedOut) {
      return executionFailure({
        message: `Compile timed out after ${limits.timeoutMs} ms.`,
        texliveImage: image,
        environment,
        log: trimmed.text,
        diagnostics: [
          ...diagnostics,
          { severity: "error", message: `Compile timed out after ${limits.timeoutMs} ms.` },
        ],
        errorCode: "TIMEOUT",
        timedOut: true,
      });
    }

    const pdfPath = join(work, main.replace(/\.tex$/u, ".pdf"));
    let pdfBase64: string | undefined;
    const artifactPdf = dockerContainerName
      ? await readDockerArtifact(dockerContainerName, `/work/${main.replace(/\.tex$/u, ".pdf")}`, limits.maxPdfBytes)
      : (await pathExists(pdfPath)) ? await readArtifact(work, pdfPath, limits.maxPdfBytes) : null;
    if (artifactPdf) {
      const pdfBuffer = artifactPdf.data;
      if (pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        return executionFailure({
          message: "latexmk produced an invalid PDF signature",
          texliveImage: image,
        environment,
          log: trimmed.text,
          diagnostics,
          errorCode: "LATEX_ERROR",
        });
      }
      pdfBase64 = pdfBuffer.toString("base64");
    }

    if (exit !== 0 || !pdfBase64) {
      return executionFailure({
        message:
          exit !== 0
            ? `latexmk exited with code ${exit}`
            : "latexmk produced no PDF",
        texliveImage: image,
        environment,
        log: trimmed.text,
        diagnostics,
        errorCode:
          useDocker && [125, 126, 127].includes(exit) ? "DOCKER_ERROR" : "LATEX_ERROR",
      });
    }

    return {
      phase: "ready",
      log: trimmed.text,
      diagnostics,
      pdfBase64,
      mainPdfRelPath: main.replace(/\.tex$/u, ".pdf"),
      texliveImage: image,
        environment,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return executionFailure({
      message,
      texliveImage: image,
        environment,
      log: message,
      diagnostics: [{ severity: "error", message }],
      errorCode: error instanceof ArtifactTooLargeError ? "OUTPUT_TOO_LARGE" : "INTERNAL_ERROR",
    });
  } finally {
    if (dockerContainerName) {
      try {
        await ensureDockerContainerRemoved(dockerContainerName, work);
      } catch (cleanupError) {
        console.error("Cleanup warning:", cleanupError);
      }
    }
    try {
      await rm(work, { recursive: true, force: true });
    } catch (rmError) {
      console.error("Failed to remove temp dir:", rmError);
    }
  }
}

export const __testOnly = {
  resolveLimits,
  normalizeRelativePath: normalizeCompilePath,
  validatePayload,
  trimLog,
};
