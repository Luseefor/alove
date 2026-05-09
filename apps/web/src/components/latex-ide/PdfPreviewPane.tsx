"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import {
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Search,
  MoreHorizontal,
  FileText,
  ChevronDown,
  Layout,
  Play,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function PdfPreviewPane() {
  const {
    pdfDataUrl,
    buildStatus,
    runCompile,
  } = useWorkbenchStore();
  
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = 24; // Sample total pages

  return (
    <div 
      className="h-full flex flex-col bg-zinc-100/50 border-l border-zinc-100 overflow-hidden shadow-[inset_-1px_1px_3px_rgba(0,0,0,0.02)]" 
      data-testid="pdf-preview-pane"
      data-status={buildStatus}
    >
      {/* Tabs Bar */}
      <div className="h-10 border-b flex items-center bg-zinc-50/30 shrink-0 px-1">
        <div className="h-10 px-4 flex items-center gap-2 bg-white text-zinc-900 font-bold border-r border-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.05)] relative z-10 min-w-[120px]">
           <FileText className="w-3.5 h-3.5 text-red-500" />
           <span className="text-[12px] truncate tracking-tight">main.pdf</span>
           <div className="absolute top-0 inset-x-0 h-[2px] bg-red-500 rounded-full shadow-[0_1px_5px_rgba(239,68,68,0.3)]" />
        </div>
      </div>

      {/* Toolbar */}
      <div className="h-10 border-b flex items-center justify-between px-3 bg-white/80 backdrop-blur-sm shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
           <div className="flex items-center bg-zinc-100 rounded-lg p-0.5 border border-zinc-200">
              <button className="p-1 hover:bg-white rounded-md transition-all text-zinc-500 hover:text-zinc-900 active:scale-95 disabled:opacity-30" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
                <ChevronLeft size={14} />
              </button>
              <div className="flex items-center px-2 gap-1.5 border-x border-zinc-200 mx-0.5">
                 <span className="text-[11px] font-bold text-zinc-900">{currentPage}</span>
                 <span className="text-[10px] font-bold text-zinc-400">/ {totalPages}</span>
              </div>
              <button className="p-1 hover:bg-white rounded-md transition-all text-zinc-500 hover:text-zinc-900 active:scale-95 disabled:opacity-30" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                <ChevronRight size={14} />
              </button>
           </div>
        </div>

        <div className="flex items-center gap-3">
           <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 hover:bg-zinc-100 transition-colors cursor-pointer group active:scale-95">
              <span className="text-[11px] font-bold text-zinc-600 group-hover:text-zinc-900">100%</span>
              <ChevronDown size={12} className="text-zinc-400" />
           </div>
           
           <div className="w-px h-4 bg-zinc-200" />
           
           <div className="flex items-center gap-0.5">
              <IconButton icon={Maximize2} title="Fit to width" />
              <IconButton icon={Layout} title="Fullscreen" />
              <IconButton icon={Search} title="Search in PDF" />
              <IconButton icon={MoreHorizontal} title="More" />
           </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden bg-zinc-100/50 relative">
        {/* Thumbnails Strip */}
        {buildStatus === "ready" && pdfDataUrl && (
          <div className="w-20 border-r border-zinc-200 bg-zinc-50/50 overflow-y-auto flex flex-col items-center py-4 gap-4 scrollbar-hide shrink-0 shadow-[inset_-1px_0_3px_rgba(0,0,0,0.01)]">
             {[1, 2, 3, 4, 5, 6].map(page => (
                <div 
                  key={page} 
                  onClick={() => setCurrentPage(page)}
                  className={cn(
                    "w-12 aspect-[1/1.414] bg-white rounded-sm border transition-all cursor-pointer hover:scale-105 active:scale-95 relative flex flex-col group",
                    currentPage === page 
                      ? "border-primary ring-2 ring-primary/10 shadow-lg" 
                      : "border-zinc-200 shadow-sm opacity-60 hover:opacity-100"
                  )}
                >
                   <div className="flex-1 p-1 space-y-0.5 overflow-hidden">
                      <div className="w-full h-1 bg-zinc-100 rounded-full" />
                      <div className="w-3/4 h-1 bg-zinc-100 rounded-full" />
                      <div className="w-full h-1 bg-zinc-50 rounded-full pt-1" />
                      <div className="w-[90%] h-0.5 bg-zinc-50 rounded-full" />
                      <div className="w-[95%] h-0.5 bg-zinc-50 rounded-full" />
                   </div>
                   <div className="absolute -bottom-4 inset-x-0 text-center text-[8px] font-black text-zinc-400 group-hover:text-zinc-600">{page}</div>
                </div>
             ))}
          </div>
        )}

        {/* Main PDF Content */}
        <div className="flex-1 overflow-auto p-8 flex flex-col items-center min-h-0 bg-[#f4f4f7] relative">
          {buildStatus === "ready" && pdfDataUrl ? (
            <div className="relative group/pdf">
              <div className="bg-white shadow-[0_20px_50px_rgba(0,0,0,0.1),0_0_1px_rgba(0,0,0,0.1)] border border-white rounded-sm min-w-[500px] aspect-[1/1.414] transition-transform duration-500 hover:scale-[1.005] overflow-hidden">
                <iframe 
                  src={pdfDataUrl} 
                  className="w-full h-full border-none"
                  title="Compiled PDF"
                />
              </div>
            </div>
          ) : buildStatus === "failed" ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 max-w-sm space-y-6">
              <div className="w-20 h-20 rounded-[32px] bg-red-50 flex items-center justify-center text-red-400 border border-red-100 shadow-sm relative group">
                 <XCircle size={40} className="transition-transform group-hover:scale-110" />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">Build Failed</h3>
                <p className="text-[12px] text-zinc-500 font-medium leading-relaxed">
                  There was an error compiling your document. Please check the logs for details.
                </p>
              </div>
              <button 
                onClick={() => void runCompile()}
                className="px-6 py-2 bg-white border border-zinc-200 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 hover:shadow-md transition-all active:scale-95"
              >
                 Retry Build
              </button>
            </div>
          ) : buildStatus === "running" || buildStatus === "queued" ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 max-w-sm space-y-6">
               <div className="relative">
                  <div className="w-20 h-20 rounded-[32px] bg-primary/5 flex items-center justify-center text-primary border border-primary/10 shadow-sm animate-pulse">
                     <FileText size={40} />
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                     <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                  </div>
               </div>
               <div className="space-y-2">
                 <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">{buildStatus === "queued" ? "Queued" : "Compiling..."}</h3>
                 <p className="text-[12px] text-zinc-500 font-medium leading-relaxed">
                   Generating your PDF preview. This usually takes a few seconds.
                 </p>
               </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 max-w-sm space-y-6">
              <div className="w-20 h-20 rounded-[32px] bg-zinc-50 flex items-center justify-center text-zinc-300 border border-zinc-100 shadow-sm relative group cursor-pointer" onClick={() => void runCompile()}>
                 <FileText size={40} className="transition-transform group-hover:scale-110" />
                 <div className="absolute -top-2 -right-2 bg-primary text-white p-1.5 rounded-full shadow-lg shadow-primary/30 animate-pulse">
                    <Play size={14} fill="currentColor" />
                 </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">Document not built</h3>
                <p className="text-[12px] text-zinc-500 font-medium leading-relaxed">
                  Build your project to generate the PDF preview and start polishing your research.
                </p>
              </div>
              <button 
                onClick={() => void runCompile()}
                className="px-6 py-2 bg-white border border-zinc-200 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 hover:shadow-md transition-all active:scale-95"
              >
                 Start Build
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IconButton({ icon: Icon, title, onClick, disabled }: { icon: LucideIcon, title?: string, onClick?: () => void, disabled?: boolean }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
