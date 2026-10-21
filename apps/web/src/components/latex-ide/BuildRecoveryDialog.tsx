"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { buildRecordRepository } from "@/lib/buildRecordRepository";
import type { BuildRecord } from "@/lib/buildRecord";
import { findBuildRecovery, type RecoveryCandidate, type RecoveryReport } from "@/lib/buildRecovery";
import { compareBuildFiles, previewFileChange, restoreCandidateFile } from "@/lib/buildRecoveryCandidates";

const buttonClass = "rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed";
function sameFiles(a: Record<string, string>, b: Record<string, string>) {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([p, c]) => Object.hasOwn(b, p) && b[p] === c);
}
function downloadEvidence(good: BuildRecord, failed: BuildRecord, report: RecoveryReport | null) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "alove-build-recovery", version: 1, good, failed, report }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "build-recovery.alove.json";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BuildRecoveryDialog() {
  const { buildRecoveryOpen: open, setBuildRecoveryOpen, projectId, lastBuildRecord, buildHistoryError,
    filesByPath, mainFile, buildStatus, applyRecoveryFile } = useWorkbenchStore();
  const { defaultCompilerEngine: engine, compilerCleanAux: cleanAux } = useIdeSettingsStore();
  const [records, setRecords] = useState<BuildRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [failureId, setFailureId] = useState<string>("");
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [progress, setProgress] = useState("");
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<{ files: Record<string, string>; change: RecoveryCandidate; main: string; engine: BuildRecord["engine"]; cleanAux: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!open || !projectId) return;
    let disposed = false;
    setRecords([]); setReport(null); setNotice(""); setUndo(null); setHistoryError(null); setFailureId("");
    void buildRecordRepository.list(projectId).then((saved) => {
      if (disposed) return;
      const merged = new Map(saved.map((r) => [r.id, r]));
      if (lastBuildRecord?.projectId === projectId) merged.set(lastBuildRecord.id, lastBuildRecord);
      setRecords([...merged.values()].sort((a, b) => b.completedAt - a.completedAt));
    }).catch((error) => {
      if (disposed) return;
      setHistoryError(error instanceof Error ? error.message : "Build history unavailable.");
      if (lastBuildRecord?.projectId === projectId) setRecords([lastBuildRecord]);
    });
    return () => { disposed = true; };
  }, [open, projectId, lastBuildRecord]);

  useEffect(() => () => { generation.current++; controller.current?.abort(); setRunning(false); }, [open, projectId]);
  const failed = records.find((r) => r.id === failureId && !r.result.ok) ?? records.find((r) => !r.result.ok);
  const good = failed && records.find((r) => r.result.ok && r.startedAt <= failed.startedAt);
  const changes = good && failed ? compareBuildFiles(good.files, failed.files) : [];
  const current = Boolean(failed && failed.projectId === projectId && mainFile === failed.mainFile &&
    engine === failed.engine && cleanAux === failed.cleanAux && sameFiles(filesByPath, failed.files));
  const buildBusy = buildStatus === "queued" || buildStatus === "running";
  const local = Boolean(projectId?.startsWith("local"));
  const verified = report?.status === "verified" && report.failedId === failed?.id && report.goodId === good?.id ? report.candidate : null;
  const focused = verified?.scope === "hunk";

  const start = async () => {
    if (!good || !failed || running) return;
    const run = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    setRunning(true); setReport(null); setNotice(""); setUndo(null);
    try {
      const outcome = await findBuildRecovery(good, failed, { signal: abort.signal, onProgress: setProgress });
      if (run === generation.current) setReport(outcome);
    } catch (error) {
      if (run === generation.current) setNotice(error instanceof Error ? error.message : "Recovery unavailable.");
    } finally { if (run === generation.current) { setRunning(false); setProgress(""); } }
  };
  const apply = () => {
    if (!verified || !failed || !projectId || !current) return;
    const restored = restoreCandidateFile(failed.files, verified);
    if (!applyRecoveryFile({ projectId, mainFile: failed.mainFile, expectedFiles: failed.files, engine: failed.engine, cleanAux: failed.cleanAux, path: verified.path, content: verified.before })) {
      setNotice("The working source changed. No recovery was applied."); return;
    }
    setUndo({ files: restored, change: verified, main: failed.mainFile, engine: failed.engine, cleanAux: failed.cleanAux });
    setNotice(verified.scope === "hunk"
      ? "Recovery applied. Source outside the displayed change block was preserved, including other edits in this file. Rebuild to refresh the preview."
      : "Recovery applied. Changes in other files were preserved. Rebuild to refresh the preview.");
  };
  const undoRecovery = () => {
    if (!undo || !projectId) return;
    if (!applyRecoveryFile({ projectId, mainFile: undo.main, expectedFiles: undo.files, engine: undo.engine, cleanAux: undo.cleanAux, path: undo.change.path, content: undo.change.after })) {
      setNotice("Source or compiler settings changed after recovery. Undo was stopped to preserve your edits."); return;
    }
    setUndo(null); setNotice("Recovery undone.");
  };

  return <Dialog open={open} onOpenChange={setBuildRecoveryOpen}>
    <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden" data-testid="build-recovery-dialog">
      <DialogHeader>
        <DialogTitle>Find breaking change</DialogTitle>
        <DialogDescription>Compare a failed build with its last successful source, then test change restorations in separate builds before applying anything.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto p-4 sm:p-6">
        {(historyError || buildHistoryError) && <p role="alert" className="text-xs text-warning-foreground">Build history could not be saved or loaded: {historyError ?? buildHistoryError}. Your source is unchanged.</p>}
        {!failed ? <p className="text-sm text-muted-foreground">No failed build recorded yet. Build a working document, make a change, and build again.</p> : <>
          <label className="block text-xs font-medium">Failed build
            <select aria-label="Failed build" value={failed.id} disabled={running} onChange={(event) => { setFailureId(event.target.value); setReport(null); setUndo(null); setNotice(""); }} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-xs">
              {records.filter((r) => !r.result.ok).map((r) => <option key={r.id} value={r.id}>{new Date(r.completedAt).toLocaleString()} · {r.mainFile} · {r.engine}</option>)}
            </select>
          </label>
          {!good ? <p className="text-sm text-muted-foreground">No earlier successful build is available. Fix and build the document once to establish a baseline.</p> : <>
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-md border border-border p-3"><strong>Last successful build</strong><p className="mt-1">{new Date(good.completedAt).toLocaleString()}</p><p className="mt-1 break-all font-mono text-muted-foreground">Source {good.sourceHash.slice(0, 16)}</p></div>
              <div className="rounded-md border border-border p-3"><strong>Failed build</strong><p className="mt-1">{failed.result.message ?? failed.result.errorCode ?? "Compilation failed"}</p><p className="mt-1 break-all font-mono text-muted-foreground">Source {failed.sourceHash.slice(0, 16)}</p></div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Tests the baseline and up to five restorations, with a 60-second waiting budget. Separate change blocks are tested first, with whole-file fallbacks. Nothing is applied automatically. A successful compile does not prove document correctness or the smallest cause.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} disabled={running || buildBusy || changes.length === 0} onClick={() => void start()}>Test recovery</button>
              {running && <button type="button" className={buttonClass} onClick={() => controller.current?.abort()}>Stop waiting</button>}
              <button type="button" className={buttonClass} onClick={() => downloadEvidence(good, failed, report)}>Export debugging evidence</button>
            </div>
            <p className="text-xs text-muted-foreground">Evidence exports include full source snapshots and build logs.</p>
            {running && <p role="status" className="text-sm">{progress}</p>}
            {report && <div role="status" className="rounded-md border border-border p-3 text-sm" data-testid="recovery-result"><strong>{report.status === "verified" ? "Compile-verified recovery" : "No recovery verified"}</strong><p className="mt-1">{report.message}</p><p className="mt-1 text-xs text-muted-foreground">{report.trials.length} trial builds completed.</p>
              {report.trials.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Show trial evidence</summary>
                <ol className="mt-2 space-y-1">{report.trials.map((trial, i) => <li key={i} className="flex flex-wrap justify-between gap-2 rounded border border-border px-2 py-1"><span className="break-all font-mono">{trial.path ?? "Successful baseline"}{trial.scope === "hunk" ? ` · change near line ${trial.line}` : trial.path ? " · entire file" : ""}</span><span>{trial.ok ? "Compiled successfully" : trial.errorCode ?? "Failed"}</span></li>)}</ol>
              </details>}
              {report.focusedSearch?.limited && <p className="mt-2 text-xs text-muted-foreground">Focused search reached an analysis or candidate limit. A whole-file result can reverse other edits in that file.</p>}
            </div>}
            {notice && <p role="status" className="text-sm">{notice}</p>}
            {verified && <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium">{focused ? "Restore the tested change in:" : "Restore the entire file:"} <span className="break-all font-mono">{verified.path}</span></p>
              <p className="text-xs text-muted-foreground">{focused
                ? "Only the displayed change block will be restored. Other edits in this file and changes in other files are preserved."
                : "All edits in this file since the baseline will be reversed. Changes in other files are preserved. Review the comparison below."}</p>
              {focused && <pre className="max-h-56 overflow-auto rounded border border-border p-3 text-[11px] leading-5" aria-label={`Tested restoration in ${verified.path}`}>{previewFileChange(verified).map((line, index) => <div key={index} className={line.kind === "removed" ? "border-l-2 border-success pl-2 text-foreground" : "border-l-2 border-error pl-2 text-foreground"}>{line.kind === "removed" ? "+" : "−"}{line.line} {line.text.slice(0, 1000)}</div>)}</pre>}
              {focused && <p className="text-xs text-muted-foreground">Preview limited to 80 lines and 1,000 characters per line. Export debugging evidence to inspect the full source.</p>}
              {!current && !undo && <p className="text-xs text-warning-foreground">Working source or compiler settings differ from this failed build. Apply is disabled to preserve newer changes.</p>}
              {!local && <p className="text-xs text-muted-foreground">Apply is available in local projects. Export the evidence for this cloud project.</p>}
              <button type="button" className={buttonClass} disabled={!current || !local || buildBusy || Boolean(undo)} onClick={apply}>{focused ? "Apply tested change restoration" : "Apply tested file restoration"}</button>
            </div>}
            {undo && <button type="button" className={buttonClass} disabled={buildBusy} onClick={undoRecovery}>{undo.change.scope === "hunk" ? "Undo change restoration" : "Undo file restoration"}</button>}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Changed files ({changes.length})</h3>
              {changes.slice(0, 250).map((change) => <details key={change.path} open={verified?.path === change.path} className="rounded-md border border-border text-xs">
                <summary className="cursor-pointer break-all p-3 font-mono">{change.path} · {change.kind} · line {change.firstChangedLine}</summary>
                <pre className="max-h-64 overflow-auto border-t border-border p-3 text-[11px] leading-5" aria-label={`Changes in ${change.path}`}>{previewFileChange(change).map((line, index) => <div key={index} className={line.kind === "removed" ? "border-l-2 border-error pl-2 text-foreground" : "border-l-2 border-success pl-2 text-foreground"}>{line.kind === "removed" ? "−" : "+"}{line.line} {line.text.slice(0, 1000)}</div>)}</pre>
                <p className="px-3 pb-2 text-muted-foreground">Before (−) and failed source (+); preview limited to 80 changed lines.</p>
              </details>)}
            </div>
          </>}
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
