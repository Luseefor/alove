"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Clock,
  ChevronRight,
  Info
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

export function BottomUtilityPanel() {
  const {
    activeBottomTab,
    setActiveBottomTab,
    diagnostics,
    buildLog,
    activeFileId,
    filesByPath
  } = useWorkbenchStore();
  
  const editorCodeCheck = useIdeSettingsStore((s) => s.editorCodeCheck);
  const visibleDiagnostics = editorCodeCheck ? diagnostics : [];

  const content = activeFileId ? filesByPath[activeFileId] ?? "" : "";
  
  const stats = useMemo(() => {
    const words = content.trim().split(/\s+/).filter(w => w.length > 0).length;
    const chars = content.length;
    const equations = (content.match(/\\begin\{equation\}/g) || []).length + (content.match(/\$/g) || []).length / 2;
    const figures = (content.match(/\\begin\{figure\}/g) || []).length;
    const tables = (content.match(/\\begin\{table\}/g) || []).length;
    return { words, chars, equations, figures, tables, pages: 24 };
  }, [content]);

  const tabs = [
    { id: "log", label: "Log", beta: false },
    { id: "problems", label: "Problems", beta: false },
    { id: "citations", label: "Citations", beta: true },
  ] as const;

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden border-t border-zinc-100 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
      {/* Tab Bar */}
      <div className="h-10 flex items-center px-4 bg-zinc-50/50 border-b border-zinc-100 shrink-0">
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
                {t.beta && <span className="text-[8px] bg-primary/10 text-primary px-1 rounded-sm ml-1 font-black">BETA</span>}
                {isActive && <div className="absolute bottom-0 inset-x-[-4px] h-0.5 bg-primary rounded-t-full shadow-[0_0_8px_rgba(124,58,237,0.5)]" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden bg-white p-6 gap-8">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeBottomTab === "log" && (
            <div className="flex-1 overflow-y-auto pr-4 scrollbar-hide">
               {buildLog ? (
                  <div className="space-y-4">
                     {[
                       { time: "10:42:11", msg: "Compiling main.tex", status: "info" },
                       { time: "10:42:12", msg: "pdfLaTeX (1/2)", status: "success" },
                       { time: "10:42:13", msg: "pdfLaTeX (2/2)", status: "success" },
                       { time: "10:42:14", msg: "BibTeX", status: "success" },
                       { time: "10:42:15", msg: "pdfLaTeX (3/3)", status: "success" },
                       { time: "10:42:16", msg: "Output written on main.pdf (24 pages, 1.3 MB)", status: "success" }
                     ].map((log, i) => (
                        <div key={i} className="flex items-center gap-4 text-[12px] group">
                           <div className={cn(
                              "w-5 h-5 rounded-full flex items-center justify-center shrink-0 border",
                              log.status === "success" ? "bg-success-bg text-success border-success-border" : "bg-primary/5 text-primary border-primary/10"
                           )}>
                              {log.status === "success" ? <CheckCircle2 size={12} /> : <Info size={12} />}
                           </div>
                           <span className="text-zinc-400 font-medium font-mono text-[11px] w-16">{log.time}</span>
                           <span className="text-zinc-600 font-semibold truncate group-hover:text-zinc-900 transition-colors">{log.msg}</span>
                        </div>
                     ))}
                  </div>
               ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-30 space-y-3">
                     <Clock size={32} className="text-zinc-400" />
                     <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">No build history yet</p>
                  </div>
               )}
            </div>
          )}

          {activeBottomTab === "problems" && (
            <div className="flex-1 overflow-y-auto space-y-2 pr-4">
               {visibleDiagnostics.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-30 space-y-3">
                     <CheckCircle2 size={32} className="text-success" />
                     <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Zero problems detected</p>
                  </div>
               ) : (
                  visibleDiagnostics.map((d, i) => (
                    <div key={i} className={cn(
                      "flex items-start gap-4 p-3 rounded-xl border transition-all hover:shadow-md cursor-pointer group",
                      d.severity === "error" ? "bg-error-bg border-error-border text-error" : "bg-warning-bg border-warning-border text-warning"
                    )}>
                       {d.severity === "error" ? <XCircle size={16} /> : <AlertTriangle size={16} />}
                       <div className="flex-1 space-y-1">
                          <p className="text-[12px] font-bold leading-relaxed">{d.message}</p>
                          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-tight opacity-60">
                             <span>{d.file}</span>
                             <span>Ln {d.line}</span>
                          </div>
                       </div>
                    </div>
                  ))
               )}
            </div>
          )}
          
          {activeBottomTab === "citations" && (
             <div className="flex-1 flex items-center justify-center text-zinc-400 font-bold text-[11px] uppercase tracking-widest opacity-20">
                Citation Manager Interface
             </div>
          )}
        </div>

        {/* Status Cards Area */}
        <div className="w-[600px] flex gap-6 shrink-0">
           {/* Build Success Card */}
           <div className="flex-1 bg-white border border-zinc-100 rounded-[24px] p-6 shadow-sm flex flex-col relative overflow-hidden group/card">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover/card:scale-110 transition-transform">
                 <CheckCircle2 size={80} />
              </div>
              <div className="flex items-center gap-3 mb-6">
                 <div className="w-10 h-10 rounded-2xl bg-success-bg border border-success-border flex items-center justify-center text-success shadow-sm">
                    <CheckCircle2 size={20} />
                 </div>
                 <div className="space-y-0.5">
                    <h3 className="text-[14px] font-black text-zinc-900 leading-tight">Build Successful</h3>
                    <p className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">Finished in 2.48s</p>
                 </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-auto">
                 <StatItem label="Warnings" value={0} color="text-warning" />
                 <StatItem label="Bad Boxes" value={0} color="text-primary" />
                 <StatItem label="Errors" value={0} color="text-error" />
              </div>

              <button className="flex items-center gap-2 text-[11px] font-bold text-primary hover:underline mt-4 group/btn">
                 View full log <ChevronRight size={14} className="group-hover/btn:translate-x-1 transition-transform" />
              </button>
           </div>

           {/* Document Stats Card */}
           <div className="flex-1 bg-zinc-900 text-white rounded-[24px] p-6 shadow-xl flex flex-col relative overflow-hidden ring-1 ring-white/5">
              <div className="flex items-center gap-3 mb-6 opacity-80">
                 <FileText size={16} className="text-primary" />
                 <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">Document Stats</h3>
              </div>

              <div className="space-y-2.5">
                 <DocStatRow label="Pages" value={stats.pages} />
                 <DocStatRow label="Words" value={stats.words.toLocaleString()} />
                 <DocStatRow label="Characters" value={stats.chars.toLocaleString()} />
                 <DocStatRow label="Equations" value={stats.equations} />
                 <DocStatRow label="Figures" value={stats.figures} />
                 <DocStatRow label="Tables" value={stats.tables} />
              </div>
              
              <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-primary/20 rounded-full blur-3xl" />
           </div>
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div className="space-y-1">
       <div className={cn("text-lg font-black tracking-tighter leading-none", color)}>{value}</div>
       <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">{label}</div>
    </div>
  );
}

function DocStatRow({ label, value }: { label: string, value: string | number }) {
  return (
    <div className="flex items-center justify-between text-[11px] font-bold py-1 border-b border-white/5 last:border-0 group cursor-default">
       <span className="text-zinc-500 group-hover:text-zinc-300 transition-colors uppercase tracking-widest">{label}</span>
       <span className="text-zinc-100 font-black tabular-nums">{value}</span>
    </div>
  );
}
