import { execFile } from "node:child_process";
import { resolveDockerSandboxPolicy } from "./dockerSandbox.js";

const DEFAULT_DOCKER_IMAGE = "ghcr.io/xu-cheng/texlive-full:latest";
const PROBE_TIMEOUT_MS = 3000;
const PROBE_MAX_BUFFER_BYTES = 4096;

function useDockerMode(): boolean {
  return (
    process.env.COMPILE_USE_DOCKER !== "0" &&
    process.env.COMPILE_USE_DOCKER !== "false"
  );
}

function runBounded(
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: PROBE_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: PROBE_MAX_BUFFER_BYTES,
        signal,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

function isValidDockerInspectOutput(stdout: string): boolean {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("\n") || trimmed.includes("\r")) return false;
  const parts = trimmed.split("|");
  if (parts.length !== 2) return false;
  const imageId = parts[0];
  const platform = parts[1];
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId ?? "")) return false;
  if (!platform) return false;
  const platformParts = platform.split("/");
  if (platformParts.length !== 2) return false;
  const [os, arch] = platformParts;
  if (!os || !arch) return false;
  if (!/^[A-Za-z0-9_.-]+$/.test(os)) return false;
  if (!/^[A-Za-z0-9_.-]+$/.test(arch)) return false;
  return true;
}

export async function probeCompileRuntime(
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  if (useDockerMode()) {
    try {
      resolveDockerSandboxPolicy();
    } catch {
      return false;
    }
    if (signal?.aborted) return false;
    const image = process.env.COMPILE_DOCKER_IMAGE ?? DEFAULT_DOCKER_IMAGE;
    try {
      const stdout = await runBounded(
        "docker",
        [
          "image",
          "inspect",
          "--format",
          "{{.Id}}|{{.Os}}/{{.Architecture}}",
          image,
        ],
        signal,
      );
      return isValidDockerInspectOutput(stdout);
    } catch {
      return false;
    }
  }
  if (process.env.COMPILE_TRUSTED_LOCAL !== "true") return false;
  if (process.env.NODE_ENV === "production") return false;
  if (signal?.aborted) return false;
  try {
    await runBounded("latexmk", ["-v"], signal);
    return true;
  } catch {
    return false;
  }
}
