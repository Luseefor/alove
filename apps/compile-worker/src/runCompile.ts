import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompileJobPayload, CompileJobResult } from "@alove/protocol";
import { parseLatexLog } from "./logParse.js";

function runCmd(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, signal });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ABORT_ERR") {
        resolve({ code: 124, stdout, stderr });
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function pathExists(p: string) {
  try {
    await access(p);
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

export async function runCompileJob(
  payload: CompileJobPayload,
): Promise<CompileJobResult> {
  const work = await mkdtemp(join(tmpdir(), "alove-tex-"));
  const image =
    payload.texliveImage ??
    process.env.COMPILE_DOCKER_IMAGE ??
    "ghcr.io/xu-cheng/texlive-full:latest";
  const timeoutMs = payload.timeoutMs ?? 120_000;

  try {
    for (const [rel, content] of Object.entries(payload.files)) {
      const safe = rel.replace(/\.\./g, "").replace(/^\/+/, "");
      const target = join(work, safe);
      await writeFile(target, content, "utf8");
    }

    const main = payload.mainFile.replace(/\.\./g, "").replace(/^\/+/, "");
    const useDocker =
      process.env.COMPILE_USE_DOCKER !== "0" &&
      process.env.COMPILE_USE_DOCKER !== "false";

    const engineArgs = latexmkEngineArgs(payload.engine);
    const extras = payload.latexmkExtraArgs ?? [];
    const clean = payload.cleanAux
      ? `latexmk -c -interaction=batchmode ${main} >/dev/null 2>&1 || true; `
      : "";

    const inner = `${clean}latexmk ${engineArgs.join(" ")} -interaction=nonstopmode -halt-on-error ${extras.join(" ")} ${main}`;

    let combined = "";
    let exit = 1;
    let timedOut = false;

    if (useDocker) {
      const args = [
        "run",
        "--rm",
        "-v",
        `${work}:/work`,
        "-w",
        "/work",
        image,
        "sh",
        "-lc",
        inner,
      ];
      const r = await runCmd("docker", args, work);
      combined = `${r.stdout}\n${r.stderr}`;
      exit = r.code;
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const r = await runCmd("sh", ["-lc", inner], work, controller.signal);
        combined = `${r.stdout}\n${r.stderr}`;
        exit = r.code;
        timedOut = exit === 124 || controller.signal.aborted;
      } finally {
        clearTimeout(timer);
      }
    }

    const logPath = join(work, main.replace(/\.tex$/u, ".log"));
    let logText = combined;
    if (await pathExists(logPath)) {
      logText = await readFile(logPath, "utf8");
    }

    const diagnostics = parseLatexLog(logText);
    const pdfPath = join(work, main.replace(/\.tex$/u, ".pdf"));
    let pdfBase64: string | undefined;
    if (await pathExists(pdfPath)) {
      const buf = await readFile(pdfPath);
      pdfBase64 = buf.toString("base64");
    }

    if (timedOut) {
      return {
        phase: "failed",
        log: logText.slice(-120_000),
        diagnostics: [
          {
            severity: "error",
            message: `Compile timed out after ${timeoutMs} ms (host TeX only; Docker path has no hard kill yet).`,
          },
        ],
        errorMessage: "timeout",
        texliveImage: image,
        timedOut: true,
      };
    }

    if (exit !== 0 && !pdfBase64) {
      return {
        phase: "failed",
        log: logText.slice(-120_000),
        diagnostics:
          diagnostics.length > 0
            ? diagnostics
            : [
                {
                  severity: "error",
                  message: `Compile failed (exit ${exit}). See log for details.`,
                },
              ],
        errorMessage: `latexmk exited with code ${exit}`,
        texliveImage: image,
      };
    }

    return {
      phase: "ready",
      log: logText.slice(-120_000),
      diagnostics,
      pdfBase64,
      mainPdfRelPath: main.replace(/\.tex$/u, ".pdf"),
      texliveImage: image,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
