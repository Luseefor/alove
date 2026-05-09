"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import {
  CheckCircle2,
  FileText,
  Clock,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function BottomUtilityPanel() {
  const {
    activeBottomTab,
    setActiveBottomTab,
    diagnostics,
    buildLog,
    buildStatus,
    stats,
  } = useWorkbenchStore();
  
  const editorCodeCheck = useIdeSettingsStore((s) => s.editorCodeCheck);
  const visibleDiagnostics = editorCodeCheck ? diagnostics : [];

  const tabs = [
    { id: "log", label: "Log" },
    { id: "problems", label: "Problems" },
  ] as const;

  // Only show bottom panel content if there is something to show
  if (buildStatus === "idle" && visibleDiagnostics.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400 font-bold text-[11px] uppercase tracking-[0.2em] opacity-30">
        Workspace idle
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden border-t border-zinc-100 shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
      {/* Tab Bar */}
      <div className="h-10 flex items-center px-4 bg-white border-b border-zinc-100 shrink-0">
        <div className="flex h-full gap-8">
          {tabs.map(t => {
            const isActive = activeBottomTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveBottomTab(t.id)}
                className={cn(
                  "flex items-center gap-2 h-full text-[11px] font-black uppercase tracking-[0.15em] transition-all relative",
                  isActive ? "text-primary" : "text-zinc-400 hover:text-zinc-600"
                )}
              >
                {t.label}
                {isActive && <div className="absolute bottom-0 inset-x-[-4px] h-0.5 bg-primary rounded-t-full shadow-[0_0_8px_rgba(124,58,237,0.5)]" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden bg-white px-6 py-4 gap-8">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeBottomTab === "log" && (
            <div className="flex-1 overflow-y-auto pr-4 scrollbar-hide">
               {buildLog ? (
                  <pre className="text-[11px] font-mono text-zinc-600 whitespace-pre-wrap leading-relaxed select-text">
                    {buildLog}
                  </pre>
               ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-30 space-y-3">
                     <Clock size={32} className="text-zinc-400" />
                     <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">No build history</p>
                  </div>
               )}
            </div>
          )}

          {activeBottomTab === "problems" && (
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-4 scrollbar-hide">
               {visibleDiagnostics.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-30 space-y-3">
                     <CheckCircle2 size={32} className="text-success" />
                     <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Clean build</p>
                  </div>
               ) : (
                  visibleDiagnostics.map((d, i) => (
                    <div key={i} className={cn(
                      "flex items-start gap-3 p-2.5 rounded-xl border transition-all hover:bg-zinc-50 group",
                      d.severity === "error" ? "border-error/10 text-error-foreground bg-error-bg/30" : "border-warning/10 text-warning-foreground bg-warning-bg/30"
                    )}>
                       {d.severity === "error" ? <XCircle size={14} className="mt-0.5" /> : <AlertTriangle size={14} className="mt-0.5" />}
                       <div className="flex-1 space-y-0.5">
                          <p className="text-[12px] font-bold leading-tight">{d.message}</p>
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-tight opacity-50">
                             <span>{d.file}</span>
                             <span className="w-1 h-1 rounded-full bg-current opacity-40" />
                             <span>Line {d.line}</span>
                          </div>
                       </div>
                    </div>
                  ))
               )}
            </div>
          )}
        </div>

        {/* Status Cards Area */}
        <div className="w-[520px] flex gap-5 shrink-0 h-full">
           {/* Build Status Card */}
           <div className="flex-1 bg-white border border-border rounded-[24px] p-5 shadow-sm flex flex-col relative overflow-hidden group/card border shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                 <div className={cn(
                    "w-10 h-10 rounded-2xl border flex items-center justify-center shadow-sm transition-colors",
                    buildStatus === "ready" ? "bg-success-bg border-success-border text-success" : 
                    buildStatus === "failed" ? "bg-error-bg border-error-border text-error" : 
                    "bg-primary/5 border-primary/10 text-primary"
                 )}>
                    {buildStatus === "ready" ? <CheckCircle2 size={20} /> : buildStatus === "failed" ? <XCircle size={20} /> : <Clock size={20} className="animate-pulse" />}
                 </div>
                 <div className="space-y-0.5">
                    <h3 className="text-[14px] font-black text-zinc-900 leading-tight uppercase tracking-tight">
                       {buildStatus === "ready" ? "Build Successful" : buildStatus === "failed" ? "Build Failed" : buildStatus === "running" ? "Building..." : "Queued"}
                    </h3>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-[0.15em]">
                       {buildStatus === "ready" ? "Ready to preview" : buildStatus === "failed" ? "Check problems" : "Compiling document"}
                    </p>
                 </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                 <StatItem label="Warnings" value={diagnostics.filter(d => d.severity === 'warning').length} color="text-warning" />
                 <StatItem label="Errors" value={diagnostics.filter(d => d.severity === 'error').length} color="text-error" />
                 <StatItem label="Status" value={buildStatus === "ready" ? "OK" : "—"} color={buildStatus === "ready" ? "text-success" : "text-zinc-300"} />
              </div>

              <button 
                onClick={() => setActiveBottomTab("log")}
                className="mt-auto flex items-center gap-2 text-[11px] font-black text-primary hover:underline group/btn uppercase tracking-wider"
              >
                 View full build log <ChevronRight size={14} className="group-hover/btn:translate-x-0.5 transition-transform" />
              </button>
           </div>

           {/* Document Stats Card */}
           <div className="flex-1 bg-zinc-900 text-white rounded-[24px] p-5 shadow-xl flex flex-col relative overflow-hidden ring-1 ring-white/5 h-full">
              <div className="flex items-center gap-3 mb-5 opacity-80">
                 <FileText size={16} className="text-primary" />
                 <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Document Stats</h3>
              </div>

              <div className="space-y-2">
                 <DocStatRow label="Pages" value={stats.pages ?? "—"} />
                 <DocStatRow label="Words" value={stats.words.toLocaleString()} />
                 <DocStatRow label="Chars" value={stats.chars.toLocaleString()} />
                 <DocStatRow label="Equations" value={stats.equations} />
                 <DocStatRow label="Figures" value={stats.figures} />
              </div>
              
              <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-primary/20 rounded-full blur-3xl opacity-50" />
           </div>
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value, color }: { label: string, value: string | number, color: string }) {
  return (
    <div className="space-y-0.5">
       <div className={cn("text-lg font-black tracking-tighter leading-none", color)}>{value}</div>
       <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest leading-none">{label}</div>
    </div>
  );
}

function DocStatRow({ label, value }: { label: string, value: string | number }) {
  return (
    <div className="flex items-center justify-between text-[11px] font-bold py-1 border-b border-white/5 last:border-0 group cursor-default">
       <span className="text-zinc-500 group-hover:text-zinc-300 transition-colors uppercase tracking-widest text-[9px]">{label}</span>
       <span className="text-zinc-100 font-black tabular-nums">{value}</span>
    </div>
  );
}

function XCircle({ size, className }: { size: number, className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function AlertTriangle({ size, className }: { size: number, className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
