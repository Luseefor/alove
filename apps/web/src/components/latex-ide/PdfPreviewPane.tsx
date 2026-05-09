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
  Play
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

        {/* Main PDF Content */}
        <div className="flex-1 overflow-auto p-8 flex flex-col items-center min-h-0 bg-[#f4f4f7] relative">
          {pdfDataUrl ? (
            <div className="relative group/pdf">
              <div className="bg-white shadow-[0_20px_50px_rgba(0,0,0,0.1),0_0_1px_rgba(0,0,0,0.1)] border border-white rounded-sm min-w-[500px] aspect-[1/1.414] p-12 transition-transform duration-500 hover:scale-[1.005]">
                {/* Academic Header Mockup */}
                <div className="space-y-8 max-w-2xl mx-auto">
                   <div className="space-y-3 text-center mb-12">
                      <h1 className="text-2xl font-serif text-zinc-900 tracking-tight leading-tight">Quantum Entanglement and its Applications <br/> in Secure Communication</h1>
                      <div className="text-xs font-serif text-zinc-600 italic">A. Love, S. Research, and J. Document</div>
                      <div className="text-[10px] font-serif text-zinc-400">May 8, 2026</div>
                   </div>
                   
                   <div className="space-y-4">
                      <h2 className="text-sm font-serif font-bold text-zinc-800 border-b border-zinc-100 pb-1 uppercase tracking-wider">1. Introduction</h2>
                      <div className="text-xs font-serif text-zinc-700 leading-relaxed space-y-4 text-justify">
                        <p>Quantum entanglement is a physical phenomenon that occurs when a pair or group of particles is generated, interact, or share spatial proximity in a way such that the quantum state of each particle of the pair or group cannot be described independently of the state of the others, including when the particles are separated by a large distance.</p>
                        <p>The concept of entanglement was introduced in the seminal paper by Einstein, Podolsky, and Rosen in 1935 (EPR), where they highlighted the counter-intuitive predictions of quantum mechanics regarding non-local correlations.</p>
                      </div>
                      
                      {/* Diagram Mockup */}
                      <div className="py-6 flex flex-col items-center space-y-4">
                         <div className="w-64 h-32 bg-zinc-50 border border-zinc-100 rounded-xl relative flex items-center justify-center shadow-inner group-hover/pdf:shadow-md transition-shadow">
                            <div className="absolute inset-0 flex items-center justify-center opacity-10">
                               <div className="w-full h-[1px] bg-primary" />
                               <div className="h-full w-[1px] bg-primary" />
                            </div>
                            <div className="flex items-center gap-12 relative z-10">
                               <div className="w-12 h-12 rounded-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)] border-2 border-white flex items-center justify-center text-white font-bold text-[10px]">A</div>
                               <div className="w-24 h-[1px] border-t-2 border-dashed border-zinc-400 relative">
                                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-serif italic text-zinc-500">λ</span>
                               </div>
                               <div className="w-12 h-12 rounded-full bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)] border-2 border-white flex items-center justify-center text-white font-bold text-[10px]">B</div>
                            </div>
                         </div>
                         <div className="text-[10px] font-serif italic text-zinc-500 text-center">Figure 1: Schematic of the EPR paradox setup with entangled particles A and B.</div>
                      </div>
                      
                      <h2 className="text-sm font-serif font-bold text-zinc-800 border-b border-zinc-100 pb-1 uppercase tracking-wider pt-4">2. Scope and Contributions</h2>
                      <div className="text-xs font-serif text-zinc-700 leading-relaxed text-justify">
                        This review provides a modern perspective on entanglement, bridging theory, experiments, and real-world applications in quantum cryptography and computing.
                      </div>
                   </div>
                </div>
              </div>
              
              {/* Build status overlay if compiling */}
              {buildStatus === "running" && (
                <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] flex items-center justify-center z-20">
                   <div className="bg-white p-4 rounded-2xl shadow-2xl border border-zinc-100 flex items-center gap-3 ring-8 ring-white/20">
                      <div className="w-6 h-6 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
                      <span className="text-sm font-bold text-zinc-900 tracking-tight">Updating Preview...</span>
                   </div>
                </div>
              )}
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
