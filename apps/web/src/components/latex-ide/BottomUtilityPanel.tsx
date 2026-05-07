"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { useEffect } from "react";
import {
  Terminal,
  AlertCircle,
  FileText,
  X,
  ArrowUpRight,
  Maximize2
} from "lucide-react";
import { cn } from "@/lib/utils";

export function BottomUtilityPanel() {
  const {
    activeBottomTab,
    setActiveBottomTab,
    diagnostics,
    buildLog,
    buildStatus,
    buildMessage,
    jumpToDiagnostic,
    appendToActiveFile,
    openFile,
  } = useWorkbenchStore();
  const editorCodeCheck = useIdeSettingsStore((s) => s.editorCodeCheck);
  const visibleDiagnostics = editorCodeCheck ? diagnostics : [];

  useEffect(() => {
    if (activeBottomTab === "ai") {
      setActiveBottomTab("log");
    }
  }, [activeBottomTab, setActiveBottomTab]);

  const tabs = [
    { id: "problems", label: "Problems", icon: AlertCircle, color: "text-destructive" },
    { id: "log", label: "Build Output", icon: FileText, color: "text-blue-500" },
    { id: "terminal", label: "Terminal", icon: Terminal, color: "text-foreground" },
  ] as const;

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden border-t">
      <div className="h-10 flex items-center justify-between px-2 bg-muted/20 shrink-0">
        <div className="flex h-full gap-1">
          {tabs.map(t => {
            const isActive = activeBottomTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveBottomTab(t.id)}
                className={cn(
                  "flex items-center gap-2 px-4 h-full text-[11px] font-black uppercase tracking-tight transition-all relative group",
                  isActive
                    ? "text-foreground after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:bg-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                <t.icon size={14} className={cn("transition-transform group-hover:scale-110", isActive && t.color)} />
                <span>{t.label}</span>
                {t.id === "problems" && visibleDiagnostics.length > 0 && (
                  <div className="size-4 bg-destructive/10 text-destructive rounded flex items-center justify-center text-[9px] font-black ml-1">
                    {visibleDiagnostics.length}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 pr-2">
           <button className="h-7 w-7 flex items-center justify-center hover:bg-secondary rounded-lg transition-all text-muted-foreground">
              <Maximize2 size={14} />
           </button>
           <button className="h-7 w-7 flex items-center justify-center hover:bg-secondary rounded-lg transition-all text-muted-foreground">
              <X size={14} />
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-background/30 p-4">
        {activeBottomTab === "problems" && (
          <div className="space-y-3">
            {visibleDiagnostics.length === 0 ? (
              <div className="text-xs text-muted-foreground px-1 py-2">
                {editorCodeCheck
                  ? "No diagnostics. Compile to refresh problems."
                  : "Code check is turned off in Settings → Editor."}
              </div>
            ) : (
              visibleDiagnostics.map((d, idx) => {
                const severityClass =
                  d.severity === "error"
                    ? "text-destructive border-destructive/10 bg-destructive/5"
                    : d.severity === "warning"
                      ? "text-amber-500 border-amber-500/10 bg-amber-500/5"
                      : "text-blue-500 border-blue-500/10 bg-blue-500/5";
                return (
                  <button
                    key={`${d.file ?? "unknown"}-${d.line ?? 0}-${idx}`}
                    onClick={() => jumpToDiagnostic(d)}
                    className={cn(
                      "w-full text-left flex items-start gap-4 p-3 rounded-xl border group hover:opacity-95 transition-colors",
                      severityClass,
                    )}
                  >
                    <AlertCircle size={16} className="mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-xs font-black tracking-tight uppercase">{d.severity}</h4>
                      <p className="text-[11px] font-medium text-foreground/80 mt-0.5">{d.message}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] font-bold bg-background/70 px-2 py-0.5 rounded">
                          {d.file ?? "unknown"}
                        </span>
                        {d.line && (
                          <span className="text-[10px] font-black text-muted-foreground">
                            Line {d.line}{d.column ? `:${d.column}` : ""}
                          </span>
                        )}
                      </div>
                      {d.message.includes("Citation key") && (
                        <div className="mt-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const keyMatch = d.message.match(/"([^"]+)"/);
                              const key = keyMatch?.[1];
                              if (key) {
                                if (d.file) openFile(d.file);
                                appendToActiveFile(`\\cite{${key}}`);
                              }
                            }}
                            className="text-[10px] px-2 py-1 rounded border border-primary/40 text-primary hover:bg-primary/10"
                          >
                            Quick fix: insert cite
                          </button>
                        </div>
                      )}
                    </div>
                    <ArrowUpRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })
            )}
          </div>
        )}

        {activeBottomTab === "log" && (
          <div className="h-full flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "px-2 py-1 rounded font-semibold",
                  buildStatus === "ready" && "bg-primary/10 text-primary",
                  buildStatus === "failed" && "bg-destructive/10 text-destructive",
                  (buildStatus === "running" || buildStatus === "queued") && "bg-blue-500/10 text-blue-500",
                  buildStatus === "idle" && "bg-muted text-muted-foreground",
                )}
              >
                {buildStatus.toUpperCase()}
              </span>
              {buildMessage && <span className="text-muted-foreground">{buildMessage}</span>}
            </div>
            <pre className="flex-1 overflow-auto rounded-lg border bg-background p-3 text-xs text-foreground/90 whitespace-pre-wrap">
              {buildLog || "No build log yet."}
            </pre>
          </div>
        )}

        {activeBottomTab === "terminal" && (
          <div className="h-full rounded-lg border bg-background p-3 text-xs text-muted-foreground">
            <p>Integrated terminal surface placeholder.</p>
            <p className="mt-2">Shortcuts: Save `Cmd/Ctrl+S`, Compile `Cmd/Ctrl+Enter`.</p>
            <p className="mt-2">Next step: connect to a shell/session stream.</p>
          </div>
        )}
      </div>
    </div>
  );
}
