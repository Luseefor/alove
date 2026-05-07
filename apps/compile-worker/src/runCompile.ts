import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CompileJobPayload, CompileJobResult, Diagnostic } from "@alove/protocol";
import { parseLatexLog } from "./logParse.js";

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
    maxFiles: parsePositiveInt(process.env.COMPILE_MAX_FILES, DEFAULT_MAX_FILES),
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

function appendBounded(current: string, chunk: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  return keepTailBytes(current + chunk, maxBytes);
}

function trimLog(log: string, maxLogBytes: number): { text: string; truncated: boolean } {
  const fullBytes = Buffer.byteLength(log, "utf8");
  if (fullBytes <= maxLogBytes) return { text: log, truncated: false };
  return { text: keepTailBytes(log, maxLogBytes), truncated: true };
}

function normalizeRelativePath(rawPath: string): string | null {
  const normalized = rawPath.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
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
      diagnostics.length > 0
        ? diagnostics
        : [{ severity: "error", message }],
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
): { ok: true; value: ValidatedPayload } | { ok: false; result: CompileJobResult } {
  const entries = Object.entries(payload.files ?? {});
  if (entries.length === 0) {
    return { ok: false, result: validationFailure("No files provided", texliveImage) };
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
    const normalizedPath = normalizeRelativePath(rawPath);
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

  const normalizedMain = normalizeRelativePath(payload.mainFile);
  if (!normalizedMain) {
    return {
      ok: false,
      result: validationFailure(`Unsafe main file path: ${payload.mainFile}`, texliveImage),
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
  const removed = await runCmd("docker", ["rm", "-f", containerName], cwd, {
    maxOutputBytes: 16_384,
  });
  const detail = `${removed.stdout}\n${removed.stderr}`.toLowerCase();
  if (removed.code !== 0 && !detail.includes("no such container")) {
    throw new Error(
      `docker cleanup failed for container ${containerName} (exit ${removed.code})`,
    );
  }
}

export async function runCompileJob(
  payload: CompileJobPayload,
): Promise<CompileJobResult> {
  const work = await mkdtemp(join(tmpdir(), "alove-tex-"));
  const image =
    payload.texliveImage ??
    process.env.COMPILE_DOCKER_IMAGE ??
    "ghcr.io/xu-cheng/texlive-full:latest";
  const limits = resolveLimits(payload);
  let dockerContainerName: string | null = null;

  try {
    const validated = validatePayload(payload, limits, image);
    if (!validated.ok) {
      return validated.result;
    }

    for (const file of validated.value.files) {
      const target = join(work, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }

    const main = validated.value.mainFile;
    const useDocker =
      process.env.COMPILE_USE_DOCKER !== "0" &&
      process.env.COMPILE_USE_DOCKER !== "false";

    const engineArgs = latexmkEngineArgs(payload.engine);
    const extras = payload.latexmkExtraArgs ?? [];
    const escapedMain = shellEscape(main);
    const escapedExtras = extras.map(shellEscape).join(" ");
    const escapedLatexmk = [
      "latexmk",
      ...engineArgs,
      "-interaction=nonstopmode",
      "-halt-on-error",
      escapedExtras,
      escapedMain,
    ]
      .filter((token) => token.length > 0)
      .join(" ");
    const escapedClean = payload.cleanAux
      ? `latexmk -c -interaction=batchmode ${escapedMain} >/dev/null 2>&1 || true; `
      : "";
    const inner = `${escapedClean}${escapedLatexmk}`;

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
      dockerContainerName = `alove-compile-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

      const args = ["run", "--rm", "--name", dockerContainerName];
      if (dockerPlatform) {
        args.push("--platform", dockerPlatform);
      }
      args.push(
        "-v",
        `${work}:/work`,
        "-w",
        "/work",
        image,
        "sh",
        "-lc",
        inner,
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
      try {
        const run = await runCmd("docker", args, work, {
          signal: controller.signal,
          maxOutputBytes: limits.maxLogBytes,
        });
        combined = `${run.stdout}\n${run.stderr}`;
        exit = run.code;
        timedOut = run.code === 124 || controller.signal.aborted;
      } finally {
        clearTimeout(timer);
      }
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
      try {
        const run = await runCmd("sh", ["-lc", inner], work, {
          signal: controller.signal,
          maxOutputBytes: limits.maxLogBytes,
        });
        combined = `${run.stdout}\n${run.stderr}`;
        exit = run.code;
        timedOut = run.code === 124 || controller.signal.aborted;
      } finally {
        clearTimeout(timer);
      }
    }

    const logPath = join(work, main.replace(/\.tex$/u, ".log"));
    const logText =
      (await pathExists(logPath)) ? await readFile(logPath, "utf8") : combined;
    const parsedDiagnostics = parseLatexLog(logText);
    const trimmed = trimLog(logText, limits.maxLogBytes);
    const diagnostics = [...parsedDiagnostics];
    if (trimmed.truncated) {
      diagnostics.push({
        severity: "warning",
        message: `Compile log truncated to ${limits.maxLogBytes} bytes.`,
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
          log: trimmed.text,
          diagnostics,
          errorCode: "OUTPUT_TOO_LARGE",
        });
      }
      const pdfBuffer = await readFile(pdfPath);
      pdfBase64 = pdfBuffer.toString("base64");
    }

    if (timedOut) {
      return executionFailure({
        message: `Compile timed out after ${limits.timeoutMs} ms.`,
        texliveImage: image,
        log: trimmed.text,
        diagnostics: [
          ...diagnostics,
          {
            severity: "error",
            message: `Compile timed out after ${limits.timeoutMs} ms.`,
          },
        ],
        errorCode: "TIMEOUT",
        timedOut: true,
      });
    }

    if (exit !== 0 && !pdfBase64) {
      return executionFailure({
        message: `latexmk exited with code ${exit}`,
        texliveImage: image,
        log: trimmed.text,
        diagnostics,
        errorCode: useDocker ? "DOCKER_ERROR" : "LATEX_ERROR",
      });
    }

    return {
      phase: "ready",
      log: trimmed.text,
      diagnostics,
      pdfBase64,
      mainPdfRelPath: main.replace(/\.tex$/u, ".pdf"),
      texliveImage: image,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return executionFailure({
      message,
      texliveImage: image,
      log: message,
      diagnostics: [{ severity: "error", message }],
      errorCode: "INTERNAL_ERROR",
    });
  } finally {
    if (dockerContainerName) {
      await ensureDockerContainerRemoved(dockerContainerName, work);
    }
    await rm(work, { recursive: true, force: true });
  }
}

export const __testOnly = {
  resolveLimits,
  normalizeRelativePath,
  validatePayload,
  trimLog,
};
