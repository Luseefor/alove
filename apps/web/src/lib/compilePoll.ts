import type { Diagnostic as ProtoDiagnostic } from "@alove/protocol";

export async function pollCompileJob(jobId: string) {
  const maxTicks = 900;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const res = await fetch(`/api/compile/${jobId}`);
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
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
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error("Timed out waiting for compile job");
}
