import type { Diagnostic as ProtoDiagnostic } from "@alove/protocol";
import { setDiagnostics as cmSetDiagnostics } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import { toCmDiagnostics } from "@/lib/editorDiagnostics";
import { pollCompileJob } from "@/lib/compilePoll";
import {
  listCompileSnapshots,
  saveCompileSnapshot,
} from "@/lib/compileHistory";
import type { BuildUiState, Engine } from "@/types/editor-workbench";

type Params = {
  /** Convex project id, or `null` for local IndexedDB namespace `"local"`. */
  projectId: string | null;
  activeFile: string;
  engine: Engine;
  cleanAux: boolean;
  viewRef: RefObject<EditorView | null>;
  flushActiveToFiles: () => void;
  filesRef: RefObject<Record<string, string>>;
  setBuild: Dispatch<SetStateAction<BuildUiState>>;
  setLogTail: (s: string) => void;
  setDiagnosticRows: Dispatch<SetStateAction<ProtoDiagnostic[]>>;
  setHistory: Dispatch<
    SetStateAction<Awaited<ReturnType<typeof listCompileSnapshots>>>
  >;
};

export function useCompileRun({
  projectId,
  activeFile,
  engine,
  cleanAux,
  viewRef,
  flushActiveToFiles,
  filesRef,
  setBuild,
  setLogTail,
  setDiagnosticRows,
  setHistory,
}: Params) {
  const runCompile = useCallback(async () => {
    const view = viewRef.current;
    flushActiveToFiles();
    const merged = { ...filesRef.current };
    if (view) {
      merged[activeFile] = view.state.doc.toString();
    }
    const mainFile = "main.tex";
    setBuild({ kind: "queued", jobId: "…" });
    setLogTail("");
    setDiagnosticRows([]);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: projectId ?? "local",
          mainFile,
          files: merged,
          engine,
          cleanAux,
          timeoutMs: 120_000,
        }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const parsed = (await res.json()) as { error?: string; detail?: string };
          if (parsed.error) {
            detail = parsed.detail ? `${parsed.error}: ${parsed.detail}` : parsed.error;
          }
        } catch {
          const t = await res.text();
          if (t) detail = t;
        }
        throw new Error(detail);
      }
      const { jobId } = (await res.json()) as { jobId: string };
      setBuild({ kind: "running", jobId });
      const result = await pollCompileJob(jobId);
      setLogTail((result.log ?? "").slice(-8000));
      setDiagnosticRows(result.diagnostics ?? []);
      if (viewRef.current) {
        viewRef.current.dispatch(
          cmSetDiagnostics(
            viewRef.current.state,
            toCmDiagnostics(
              viewRef.current.state.doc,
              result.diagnostics ?? [],
            ),
          ),
        );
      }
      const ok = result.phase === "ready" && Boolean(result.pdfBase64);
      await saveCompileSnapshot({
        ts: Date.now(),
        projectId: projectId ?? "local",
        mainFile,
        ok,
        files: merged,
      });
      setHistory(await listCompileSnapshots(String(projectId ?? "local")));
      if (ok && result.pdfBase64) {
        const url = `data:application/pdf;base64,${result.pdfBase64}`;
        setBuild({ kind: "ready", jobId, pdfDataUrl: url });
      } else {
        setBuild({
          kind: "failed",
          jobId,
          message:
            result.errorMessage ??
            (result.phase === "failed"
              ? "LaTeX reported failure"
              : "Build finished without PDF"),
        });
      }
    } catch (e) {
      setBuild({
        kind: "failed",
        jobId: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [
    activeFile,
    cleanAux,
    engine,
    flushActiveToFiles,
    projectId,
    setBuild,
    setDiagnosticRows,
    setHistory,
    setLogTail,
    viewRef,
    filesRef,
  ]);

  const runCompileRef = useRef<() => void>(() => {});

  useEffect(() => {
    runCompileRef.current = () => void runCompile();
  }, [runCompile]);

  return { runCompile, runCompileRef };
}
