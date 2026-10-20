"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Info } from "lucide-react";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { cn } from "@/lib/utils";

export function BottomUtilityPanel() {
  const {
    activeBottomTab, setActiveBottomTab, diagnostics, buildLog, buildStatus,
    diagnosticRevision, documentRevision, jumpToDiagnostic,
  } = useWorkbenchStore();
  const editorCodeCheck = useIdeSettingsStore((s) => s.editorCodeCheck);
  const visibleDiagnostics = editorCodeCheck ? diagnostics : [];
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const stale = diagnosticRevision !== null && diagnosticRevision !== documentRevision;
  const status = buildStatus === "ready" ? "Build successful"
    : buildStatus === "failed" ? "Build failed"
    : buildStatus === "running" ? "Compiling…"
    : buildStatus === "queued" ? "Build queued" : "No build yet";
  const StatusIcon = buildStatus === "ready" ? CheckCircle2
    : buildStatus === "failed" ? AlertCircle : Clock;

  return (
    <section aria-label="Build output" data-testid="build-output-panel" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-t border-border bg-background">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex shrink-0 items-center gap-4">
          {(["log", "problems"] as const).map((tab) => (
            <button key={tab} type="button" aria-pressed={activeBottomTab === tab}
              onClick={() => setActiveBottomTab(tab)}
              className={cn("min-h-9 border-b-2 text-xs font-medium transition-colors", activeBottomTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            >{tab === "log" ? "Log" : "Problems"}</button>
          ))}
        </div>
        <div role="status" data-testid="build-summary" title={`${status}${stale ? " · Source changed since build" : ""} · ${errors} errors · ${warnings} warnings`}
          className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <StatusIcon size={14} className={cn("shrink-0", buildStatus === "ready" ? "text-success" : buildStatus === "failed" ? "text-error" : "text-muted-foreground")} />
          <span className="truncate">{status}{stale ? " · Source changed" : ""}</span>
          <span className="hidden shrink-0 sm:inline">{errors} errors · {warnings} warnings</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="build-output-content">
        {activeBottomTab === "log" ? (
          buildLog ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">{buildLog}</pre>
            : <p className="text-xs text-muted-foreground">No build log yet.</p>
        ) : (
          <div className="space-y-2">
            {visibleDiagnostics.length > 0 && stale && <p role="status" className="text-xs text-warning-foreground">These problems refer to an earlier source version. Rebuild to update them.</p>}
            {!editorCodeCheck ? <p className="text-xs text-muted-foreground">Code checks are hidden. Open Log to inspect compiler output.</p>
              : visibleDiagnostics.length === 0 ? <p className="text-xs text-muted-foreground">{buildStatus === "ready" ? "No problems reported." : buildStatus === "queued" || buildStatus === "running" ? "Build in progress." : "No diagnostics available. Open Log for compiler output."}</p>
              : visibleDiagnostics.map((diagnostic, index) => {
                const Icon = diagnostic.severity === "error" ? AlertCircle : diagnostic.severity === "warning" ? AlertTriangle : Info;
                const location = [diagnostic.file, diagnostic.line != null ? `Line ${diagnostic.line}` : null].filter(Boolean).join(" · ");
                return <button key={index} type="button" onClick={() => jumpToDiagnostic(diagnostic)}
                  className={cn("flex w-full items-start gap-2 rounded-md border p-2 text-left text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", diagnostic.severity === "error" ? "border-error-border bg-error-bg/30 text-error-foreground" : diagnostic.severity === "warning" ? "border-warning-border bg-warning-bg/30 text-warning-foreground" : "border-border text-foreground")}>
                  <Icon size={14} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words"><span className="block leading-relaxed">{diagnostic.message}</span>{location && <span className="mt-0.5 block text-[11px] text-muted-foreground">{location}</span>}</span>
                </button>;
              })}
          </div>
        )}
      </div>
    </section>
  );
}
