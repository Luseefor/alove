/**
 * Isolated smoke pipeline for the Docker stack.
 *
 * Invoked by scripts/smoke-docker-stack.sh with the smoke's own base URL and
 * standalone origin (both http://127.0.0.1:<smoke-port>). Exercises the real
 * queue + worker path over HTTP only:
 *   1. /api/ready reports configuration + redis + worker healthy.
 *   2. Main compile: nested chapter + .bib + known PNG data URL -> %PDF,
 *      nonempty log with expected entries.
 *   3. Cancellation: infinite-TeX job, wait for active, DELETE, poll for
 *      CANCELLED with no PDF within 10s.
 *   4. Timeout: infinite-TeX job with timeoutMs 1000 -> TIMEOUT, no PDF.
 *
 * Every compile read/write sends the exact standalone Origin header; the
 * server only authorizes the exact 127.0.0.1:<port> origin.
 */

type JobStateBody =
  | { state: "completed"; result: CompileResult }
  | { state: "failed"; error: string }
  | { state: string; result?: CompileResult };

interface CompileResult {
  phase: string;
  log?: string;
  diagnostics?: Array<{ severity: string; message: string }>;
  pdfBase64?: string;
  mainPdfRelPath?: string;
  errorCode?: string;
  timedOut?: boolean;
  errorMessage?: string;
}

function argValue(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return fallback;
  const next = process.argv[idx + 1];
  return next ?? fallback;
}

const DEFAULT_PORT = process.env.ALOVE_SMOKE_PORT ?? "30132";
const BASE =
  process.env.SMOKE_BASE_URL ??
  argValue("--base", `http://127.0.0.1:${DEFAULT_PORT}`);
const ORIGIN =
  process.env.SMOKE_ORIGIN ?? argValue("--origin", BASE);

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) {
  console.error(`Smoke base must be an exact http://127.0.0.1:<port> origin, got: ${BASE}`);
  process.exit(1);
}
if (ORIGIN !== BASE) {
  console.error(`Smoke origin must exactly match the base URL (got origin=${ORIGIN} base=${BASE})`);
  process.exit(1);
}

const MAIN_POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1000;

const KNOWN_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const INFINITE_TEX = String.raw`\documentclass{article}
\begin{document}
\loop\iftrue\repeat
\end{document}
`;

function smokeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    ...extra,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postCompile(payload: Record<string, unknown>): Promise<string> {
  const res = await fetch(new URL("/api/compile", BASE), {
    method: "POST",
    headers: smokeHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /api/compile HTTP ${res.status}: ${text}`);
  let body: { jobId?: string };
  try {
    body = JSON.parse(text) as { jobId?: string };
  } catch {
    throw new Error(`POST /api/compile returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!body.jobId) throw new Error(`POST /api/compile missing jobId: ${text.slice(0, 200)}`);
  return body.jobId;
}

async function getJob(jobId: string): Promise<{ status: number; body: JobStateBody | Record<string, unknown>; raw: string }> {
  const res = await fetch(new URL(`/api/compile/${encodeURIComponent(jobId)}`, BASE), {
    headers: smokeHeaders(),
  });
  const raw = await res.text();
  let body: JobStateBody | Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as JobStateBody;
  } catch {
    // Keep raw for the error message.
  }
  return { status: res.status, body, raw };
}

async function deleteJob(jobId: string): Promise<{ status: number; body: Record<string, unknown>; raw: string }> {
  const res = await fetch(new URL(`/api/compile/${encodeURIComponent(jobId)}`, BASE), {
    method: "DELETE",
    headers: smokeHeaders(),
  });
  const raw = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Keep raw.
  }
  return { status: res.status, body, raw };
}

async function pollTerminal(
  jobId: string,
  timeoutMs: number,
  label: string,
): Promise<JobStateBody> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { status, body, raw } = await getJob(jobId);
    if (status === 200) {
      const state = (body as JobStateBody).state;
      if (state === "completed" || state === "failed") return body as JobStateBody;
      if (state !== "waiting" && state !== "active" && state !== "delayed") {
        throw new Error(`${label}: unexpected poll state ${state}: ${raw.slice(0, 300)}`);
      }
    } else if (status === 404) {
      throw new Error(`${label}: job missing while polling (404): ${raw.slice(0, 200)}`);
    } else {
      throw new Error(`${label}: poll HTTP ${status}: ${raw.slice(0, 300)}`);
    }
    if (Date.now() > deadline) throw new Error(`${label}: timed out polling job ${jobId}`);
    await sleep(POLL_INTERVAL_MS);
  }
}

function assertPdfBytes(pdfBase64: string | undefined, label: string): Buffer {
  if (!pdfBase64) throw new Error(`${label}: missing pdfBase64`);
  const bytes = Buffer.from(pdfBase64, "base64");
  if (bytes.length === 0) throw new Error(`${label}: empty PDF`);
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`${label}: PDF signature is not %PDF-`);
  }
  return bytes;
}

async function checkReady(): Promise<void> {
  const res = await fetch(new URL("/api/ready", BASE), { headers: smokeHeaders() });
  const raw = await res.text();
  let body: { ok?: boolean; checks?: Record<string, boolean> } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    throw new Error(`/api/ready returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 300)}`);
  }
  if (!res.ok || body.ok !== true) {
    throw new Error(`/api/ready not ready (HTTP ${res.status}): ${raw.slice(0, 500)}`);
  }
  const checks = body.checks ?? {};
  if (checks.configuration !== true || checks.redis !== true || checks.worker !== true) {
    throw new Error(`/api/ready checks not all true: ${raw.slice(0, 500)}`);
  }
  console.log(`ready: ${raw}`);
}

async function checkMainCompile(): Promise<void> {
  const projectId = `smoke-main-${Date.now()}`;
  const jobId = await postCompile({
    projectId,
    mainFile: "chapters/paper.tex",
    engine: "pdflatex",
    cleanAux: true,
    files: {
      "chapters/paper.tex": String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
\input{sections/chapter}
\includegraphics[width=1cm]{assets/pixel.png}
\cite{proof}
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`,
      "sections/chapter.tex": "Nested chapter reached the real TeX engine. Caf\u00e9.",
      "assets/pixel.png": KNOWN_PNG_DATA_URL,
      "refs.bib":
        "@article{proof,title={Real bibliography proof},author={Reader, A.},journal={Local verification},year={2026}}",
    },
  });
  console.log(`main: enqueued ${jobId}`);
  const terminal = await pollTerminal(jobId, MAIN_POLL_TIMEOUT_MS, "main compile");
  if (terminal.state !== "completed") {
    throw new Error(`main: expected completed, got ${terminal.state}`);
  }
  const result = terminal.result;
  if (!result || result.phase !== "ready") {
    throw new Error(`main: expected ready; ${result?.errorCode ?? "missing result"}; ${result?.errorMessage ?? ""}\n${result?.log?.slice(-2000) ?? ""}`);
  }
  const pdf = assertPdfBytes(result.pdfBase64, "main");
  if (pdf.length < 1000) throw new Error(`main: PDF suspiciously small (${pdf.length} bytes)`);
  const log = result.log ?? "";
  if (log.length === 0) throw new Error("main: empty compile log");
  for (const entry of ["sections/chapter.tex", "assets/pixel.png", "paper.bbl"]) {
    if (!log.includes(entry)) throw new Error(`main: log missing entry ${entry}`);
  }
  if (log.includes("undefined citations")) throw new Error("main: log reports undefined citations");
  if (!Array.isArray(result.diagnostics)) throw new Error("main: missing diagnostics array");
  console.log(`main: ready pdf=${pdf.length}B log=${log.length}B pdfPath=${result.mainPdfRelPath ?? "?"}`);
}

async function checkCancellation(): Promise<void> {
  const projectId = `smoke-cancel-${Date.now()}`;
  const jobId = await postCompile({
    projectId,
    mainFile: "main.tex",
    timeoutMs: 60_000,
    files: { "main.tex": INFINITE_TEX },
  });
  console.log(`cancel: enqueued ${jobId}, waiting for active...`);
  const activeDeadline = Date.now() + 60_000;
  for (;;) {
    const { status, body, raw } = await getJob(jobId);
    if (status !== 200) throw new Error(`cancel: poll HTTP ${status}: ${raw.slice(0, 300)}`);
    const state = (body as JobStateBody).state;
    if (state === "active") break;
    if (state === "completed" || state === "failed") {
      throw new Error(`cancel: job finished before cancellation (state=${state}): ${raw.slice(0, 300)}`);
    }
    if (Date.now() > activeDeadline) throw new Error("cancel: job never became active");
    await sleep(500);
  }
  console.log(`cancel: job active, sending DELETE...`);
  const deleted = await deleteJob(jobId);
  const deleteState = (deleted.body as { state?: string }).state;
  console.log(`cancel: DELETE HTTP ${deleted.status} state=${String(deleteState)}`);
  if (deleted.status !== 200 && deleted.status !== 202) {
    throw new Error(`cancel: DELETE HTTP ${deleted.status}: ${deleted.raw.slice(0, 300)}`);
  }
  if (deleteState !== "cancelling" && deleteState !== "cancelled") {
    throw new Error(`cancel: unexpected DELETE state: ${deleted.raw.slice(0, 300)}`);
  }
  // Waiting-path cancellation removes the job: a 404 with no PDF is success.
  if (deleteState === "cancelled") {
    const after = await getJob(jobId);
    if (after.status === 404) {
      console.log("cancel: waiting job removed, no PDF (cancelled).");
      return;
    }
  }
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { status, body, raw } = await getJob(jobId);
    if (status === 404) {
      console.log("cancel: job removed after cancel, no PDF.");
      return;
    }
    if (status !== 200) throw new Error(`cancel: poll HTTP ${status}: ${raw.slice(0, 300)}`);
    const state = (body as JobStateBody).state;
    if (state === "completed") {
      const result = (body as { result?: CompileResult }).result;
      if (result?.errorCode !== "CANCELLED") {
        throw new Error(`cancel: expected CANCELLED, got ${JSON.stringify(result).slice(0, 500)}`);
      }
      if (result.pdfBase64) throw new Error("cancel: cancelled job must not produce a PDF");
      console.log("cancel: CANCELLED with no PDF.");
      return;
    }
    if (state === "failed") throw new Error(`cancel: unexpected failed state: ${raw.slice(0, 300)}`);
    if (Date.now() > deadline) throw new Error("cancel: CANCELLED not observed within 10s");
    await sleep(500);
  }
}

async function checkTimeout(): Promise<void> {
  const projectId = `smoke-timeout-${Date.now()}`;
  const jobId = await postCompile({
    projectId,
    mainFile: "main.tex",
    timeoutMs: 1000,
    files: { "main.tex": INFINITE_TEX },
  });
  console.log(`timeout: enqueued ${jobId} (1s worker timeout)...`);
  const terminal = await pollTerminal(jobId, 60_000, "timeout compile");
  if (terminal.state !== "completed") throw new Error(`timeout: expected completed, got ${terminal.state}`);
  const result = terminal.result;
  if (result?.errorCode !== "TIMEOUT" || result?.timedOut !== true) {
    throw new Error(`timeout: expected TIMEOUT, got ${JSON.stringify(result).slice(0, 500)}`);
  }
  if (result.pdfBase64) throw new Error("timeout: timed-out job must not produce a PDF");
  console.log("timeout: TIMEOUT with no PDF.");
}

async function main(): Promise<void> {
  console.log(`smoke pipeline: base=${BASE} origin=${ORIGIN}`);
  await checkReady();
  await checkMainCompile();
  await checkCancellation();
  await checkTimeout();
  console.log("smoke pipeline: all checks passed.");
}

await main();
