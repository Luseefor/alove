import { dirname } from "node:path/posix";
import { Sandbox } from "@vercel/sandbox";
import {
  validateCompileRequest,
  PERSONAL_CLOUD_REQUEST_BYTES,
  type CompileJobPayload,
  type CompileJobResult,
} from "@alove/protocol";
import { decodeCompileFileData } from "../../../compile-worker/src/compileFileData";
import { parseLatexLog } from "../../../compile-worker/src/logParse";
import { decodeSyncTexGz } from "../../../compile-worker/src/synctex";

// Leave room below Vercel's 4.5 MB Function limit for JSON/base64 overhead.
export const VERCEL_COMPILE_LIMITS = {
  requestBytes: PERSONAL_CLOUD_REQUEST_BYTES,
  responseBytes: 4_000_000,
  pdfBytes: 2_000_000,
  logBytes: 131_072,
  synctexBytes: 1_000_000,
  timeoutMs: 60_000,
} as const;

// The snapshot contains trusted tools only. No user documents or credentials.
export function vercelCompileSnapshot(): string {
  const id = process.env.COMPILE_VERCEL_SNAPSHOT_ID?.trim();
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id))
    throw new Error(
      "Configure COMPILE_VERCEL_SNAPSHOT_ID before enabling Vercel compilation.",
    );
  return id;
}

// Fixed code, passed as an argument rather than written into the writable TeX
// directory. No-follow/nonblocking opens reject symlinks, FIFOs and devices.
export const VERCEL_ARTIFACT_READER = `import os,sys,stat,json,base64
root,path,cap,tail=sys.argv[1],sys.argv[2],int(sys.argv[3]),sys.argv[4]=='1'
resolved=os.path.realpath(path)
if os.path.commonpath([root,resolved]) != root: raise ValueError('Artifact leaves workspace')
try: fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
except FileNotFoundError:
 print('null');sys.exit(0)
try:
 info=os.fstat(fd)
 if not stat.S_ISREG(info.st_mode): raise ValueError('Artifact is not a regular file')
 if info.st_size>cap and not tail:
  print(json.dumps({'error':'OUTPUT_TOO_LARGE'}));sys.exit(0)
 if tail and info.st_size>cap: os.lseek(fd,info.st_size-cap,os.SEEK_SET)
 data=os.read(fd,cap+1)
 if len(data)>cap: raise ValueError('Artifact exceeds output limit')
 print(json.dumps({'data':base64.b64encode(data).decode(),'truncated':info.st_size>cap}))
finally: os.close(fd)
`;

function failed(
  message: string,
  errorCode: CompileJobResult["errorCode"],
  environment?: CompileJobResult["environment"],
  log = "",
): CompileJobResult {
  return {
    phase: "failed",
    errorMessage: message,
    errorCode,
    log,
    diagnostics: [{ severity: "error", message }],
    environment,
  };
}

class OutputTooLargeError extends Error {}

/** One network-isolated VM per build. Application tokens never enter the VM. */
export async function runVercelCompile(
  payload: CompileJobPayload,
  signal?: AbortSignal,
): Promise<CompileJobResult> {
  const validated = validateCompileRequest(payload);
  if (!validated.ok) return failed(validated.error, "VALIDATION_ERROR");
  payload = validated.value;
  if (
    Buffer.byteLength(JSON.stringify(payload)) >
    VERCEL_COMPILE_LIMITS.requestBytes
  )
    return failed(
      "Personal cloud builds support up to 3 MB of serialized project data.",
      "VALIDATION_ERROR",
    );
  let sandbox: Sandbox | undefined;
  let environment: CompileJobResult["environment"];
  const timeoutMs = Math.min(
    payload.timeoutMs ?? VERCEL_COMPILE_LIMITS.timeoutMs,
    VERCEL_COMPILE_LIMITS.timeoutMs,
  );
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const stop = () => {
    if (sandbox) void sandbox.stop().catch(() => {});
  };
  combined.addEventListener("abort", stop, { once: true });
  try {
    combined.throwIfAborted();
    const snapshotId = vercelCompileSnapshot();
    environment = {
      mode: "sandbox",
      runtimeId: snapshotId,
      platform: "linux/amd64",
      policyId: "vercel-tex-v1:1cpu:2gb:60s:no-network:no-secrets:openin-r:ephemeral",
    };
    sandbox = await Sandbox.create({
      source: { type: "snapshot", snapshotId },
      persistent: false,
      networkPolicy: "deny-all",
      resources: { vcpus: 1 },
      timeout: timeoutMs + 15_000,
      signal: combined,
    });
    combined.throwIfAborted();
    const user = await sandbox.createUser("texjob", { signal: combined });
    const root = "/home/texjob/project";
    await user.mkDir(root, { signal: combined });
    const artifacts = new Set(
      [".pdf", ".log", ".synctex.gz"].map((ext) =>
        payload.mainFile.replace(/\.tex$/u, ext),
      ),
    );
    await user.writeFiles(
      Object.entries(payload.files)
        .filter(([path]) => !artifacts.has(path))
        .map(([path, text]) => ({
          path: `${root}/${path}`,
          content: Buffer.from(decodeCompileFileData(path, text)),
        })),
      { signal: combined },
    );
    const args = [
      "-norc",
      payload.engine === "xelatex"
        ? "-xelatex"
        : payload.engine === "lualatex"
          ? "-lualatex"
          : "-pdf",
      "-no-shell-escape",
      "-latexoption=-synctex=1",
      `-outdir=./${dirname(payload.mainFile)}`,
      "-interaction=nonstopmode",
      "-halt-on-error",
      `./${payload.mainFile}`,
    ];
    // Do not collect the command stream: malicious TeX can print without bound.
    // The bounded artifact reader below is the only output path.
    const command = await user.runCommand({
      cmd: "latexmk",
      args,
      cwd: root,
      env: { max_print_line: "1000", openin_any: "r", openout_any: "p" },
      signal: combined,
      timeoutMs,
    });
    combined.throwIfAborted();
    async function artifact(extension: string, cap: number, tail = false) {
      const path = `${root}/${payload.mainFile.replace(/\.tex$/u, extension)}`;
      const result = await sandbox!.runCommand(
        "python3",
        [
          "-c",
          VERCEL_ARTIFACT_READER,
          root,
          path,
          String(cap),
          tail ? "1" : "0",
        ],
        { signal: combined, timeoutMs: 5000 },
      );
      if (result.exitCode !== 0)
        throw new Error(
          "Cannot read build artifact safely or artifact exceeds the personal cloud output limit.",
        );
      const data = JSON.parse(await result.stdout()) as {
        data: string;
        truncated: boolean;
        error?: string;
      } | null;
      if (data?.error)
        throw new OutputTooLargeError(
          "PDF exceeds the personal cloud limit of 2 MB.",
        );
      return data
        ? { data: Buffer.from(data.data, "base64"), truncated: data.truncated }
        : null;
    }
    const outputLog = await artifact(
      ".log",
      VERCEL_COMPILE_LIMITS.logBytes,
      true,
    );
    const log = outputLog?.data.toString("utf8") ?? "";
    const diagnostics = parseLatexLog(log).slice(0, 500);
    if (outputLog?.truncated)
      diagnostics.push({
        severity: "warning",
        message: "Build log truncated.",
      });
    if (command.exitCode !== 0)
      return {
        ...failed(
          `latexmk exited with code ${command.exitCode}`,
          "LATEX_ERROR",
          environment,
          log,
        ),
        diagnostics,
      };
    const pdf = await artifact(".pdf", VERCEL_COMPILE_LIMITS.pdfBytes);
    if (pdf?.data.subarray(0, 5).toString("ascii") !== "%PDF-")
      return failed(
        "Compiler produced no valid PDF.",
        "LATEX_ERROR",
        environment,
        log,
      );
    const mapping = await artifact(
      ".synctex.gz",
      VERCEL_COMPILE_LIMITS.synctexBytes,
    );
    const synctex = mapping
      ? decodeSyncTexGz(mapping.data, {
          knownFiles: Object.keys(payload.files),
          maxEntries: 3000,
          maxDecompressedBytes: VERCEL_COMPILE_LIMITS.synctexBytes,
        })
      : undefined;
    const result: CompileJobResult = {
      phase: "ready",
      environment,
      log,
      diagnostics,
      pdfBase64: pdf.data.toString("base64"),
      mainPdfRelPath: payload.mainFile.replace(/\.tex$/u, ".pdf"),
      ...(synctex ? { synctex } : {}),
    };
    if (
      Buffer.byteLength(JSON.stringify(result)) >
      VERCEL_COMPILE_LIMITS.responseBytes
    )
      return failed(
        "Build output exceeds the personal cloud response limit. Reduce PDF size.",
        "OUTPUT_TOO_LARGE",
        environment,
        log,
      );
    return result;
  } catch (error) {
    if (signal?.aborted)
      return failed("Build cancelled.", "CANCELLED", environment);
    if (deadline.aborted)
      return {
        ...failed(`Build exceeded ${timeoutMs} ms.`, "TIMEOUT", environment),
        timedOut: true,
      };
    return failed(
      error instanceof Error ? error.message : "Sandbox compilation failed.",
      error instanceof OutputTooLargeError
        ? "OUTPUT_TOO_LARGE"
        : "INTERNAL_ERROR",
      environment,
    );
  } finally {
    combined.removeEventListener("abort", stop);
    await sandbox?.stop();
  }
}
