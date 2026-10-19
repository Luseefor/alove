import type { Diagnostic as ProtoDiagnostic } from "@alove/protocol";

function abortError(signal: AbortSignal): unknown {
  try {
    signal.throwIfAborted();
  } catch (err) {
    return err;
  }
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal) return;
  if (typeof signal.throwIfAborted === "function") {
    signal.throwIfAborted();
    return;
  }
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  if (signal.aborted) {
    return Promise.reject(abortError(signal));
  }
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    timer = setTimeout(() => {
      timer = undefined;
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollCompileJob(jobId: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  const maxTicks = 900;
  const encodedJobId = encodeURIComponent(jobId);
  for (let tick = 0; tick < maxTicks; tick += 1) {
    throwIfAborted(signal);
    let res: Response;
    try {
      res = await fetch(
        `/api/compile/${encodedJobId}`,
        signal ? { signal } : undefined,
      );
    } catch (err) {
      if (signal?.aborted) {
        throw abortError(signal);
      }
      throw err;
    }
    throwIfAborted(signal);
    if (!res.ok) {
      let detail = `status ${res.status}`;
      try {
        const parsed = (await res.json()) as { error?: string; detail?: string };
        if (parsed.error) {
          detail = parsed.detail ? `${parsed.error}: ${parsed.detail}` : parsed.error;
        }
      } catch {
        // keep generic status message when body is not JSON
      }
      throw new Error(detail);
    }
    const data = (await res.json()) as {
      state: string;
      result?: {
        phase: string;
        pdfBase64?: string;
        log?: string;
        diagnostics?: ProtoDiagnostic[];
        errorMessage?: string;
      };
      error?: string;
    };

    if (data.state === "completed" && data.result) {
      return data.result;
    }
    if (data.state === "failed") {
      throw new Error(data.error ?? "compile failed");
    }
    await abortableDelay(350, signal);
  }
  throw new Error("Timed out waiting for compile job");
}
