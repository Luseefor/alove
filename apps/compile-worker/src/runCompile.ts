import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  stat,
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

type ValidatedPayload = {
  files: Array<{ path: string; content: string }>;
  mainFile: string;
};

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
  // docker run --rm and the deadline's explicit removal can race. Wait for
  // that removal to finish rather than reporting a successful timeout as internal.
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
  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Artifact is not a regular file");
    if (info.size > cap && !tail)
      throw new Error(`Compiled PDF exceeds ${cap} bytes`);
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
): Promise<CompileJobResult> {
  const image =
    process.env.COMPILE_DOCKER_IMAGE ?? "ghcr.io/xu-cheng/texlive-full:latest";
  const request = validateCompileRequest(payload);
  if (!request.ok) return validationFailure(request.error, image);
  payload = request.value;
  const limits = resolveLimits(payload);
  const work = await mkdtemp(join(tmpdir(), "alove-tex-"));
  let dockerContainerName: string | null = null;
  let environment: CompileEnvironment | undefined;

  try {
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
    for (const file of decodedFiles) {
      const target = join(work, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }

    const main = validated.value.mainFile;
    const useDocker =
      process.env.COMPILE_USE_DOCKER !== "0" &&
      process.env.COMPILE_USE_DOCKER !== "false";

    // Caller-provided previous outputs cannot stand in for this build's artifacts.
    for (const extension of [".log", ".pdf"]) {
      await rm(join(work, main.replace(/\.tex$/u, extension)), { force: true });
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
      const inspected = await runCmd("docker", ["image", "inspect", "--format", "{{.Id}}|{{.Os}}/{{.Architecture}}", image], work, {
        signal: AbortSignal.timeout(10_000), maxOutputBytes: 4096,
      });
      const [imageId, imagePlatform] = inspected.stdout.trim().split("|");
      if (inspected.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId ?? "") || !imagePlatform) {
        return executionFailure({ message: "Cannot resolve the configured Docker image. Pull or build it before compiling.",
          log: inspected.stderr, texliveImage: image, errorCode: "DOCKER_ERROR" });
      }
      environment = { mode: "docker", runtimeId: imageId!, platform: imagePlatform };
      dockerContainerName = `alove-compile-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

      const args = ["run", "--rm", "--name", dockerContainerName];
      if (dockerPlatform) {
        args.push("--platform", dockerPlatform);
      }
      args.push("-v", `${work}:/work`, "-w", "/work", imageId!, "latexmk");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
      try {
        for (const commandArgs of commands) {
          if (controller.signal.aborted) {
            timedOut = true;
            break;
          }
          const run = await runCmd("docker", [...args, ...commandArgs], work, {
            signal: controller.signal,
            maxOutputBytes: limits.maxLogBytes,
          });
          combined = appendBounded(
            combined,
            `${run.stdout}\n${run.stderr}`,
            limits.maxLogBytes,
          );
          exit = run.code;
          timedOut = run.code === 124 || controller.signal.aborted;
        }
      } finally {
        clearTimeout(timer);
      }
    } else {
      environment = { mode: "host", runtimeId: "unverified-host", platform: `${platform()}/${arch()}` };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
      try {
        for (const commandArgs of commands) {
          if (controller.signal.aborted) {
            timedOut = true;
            break;
          }
          const run = await runCmd("latexmk", commandArgs, work, {
            signal: controller.signal,
            maxOutputBytes: limits.maxLogBytes,
          });
          combined = appendBounded(
            combined,
            `${run.stdout}\n${run.stderr}`,
            limits.maxLogBytes,
          );
          exit = run.code;
          timedOut = run.code === 124 || controller.signal.aborted;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    const logPath = join(work, main.replace(/\.tex$/u, ".log"));
    if (timedOut && dockerContainerName)
      await ensureDockerContainerRemoved(dockerContainerName, work);
    const artifactLog = (await pathExists(logPath))
      ? await readArtifact(work, logPath, limits.maxLogBytes, true)
      : null;
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
    if (await pathExists(pdfPath)) {
      const pdfStats = await stat(pdfPath);
      if (pdfStats.size > limits.maxPdfBytes) {
        return executionFailure({
          message: `Compiled PDF is too large (${pdfStats.size} bytes). Limit is ${limits.maxPdfBytes} bytes.`,
          texliveImage: image,
        environment,
          log: trimmed.text,
          diagnostics,
          errorCode: "OUTPUT_TOO_LARGE",
        });
      }
      const pdfBuffer = (await readArtifact(work, pdfPath, limits.maxPdfBytes))
        .data;
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
      errorCode: "INTERNAL_ERROR",
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
