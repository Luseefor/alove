"use client";

import { Button } from "@/components/ui/primitives";
import { Edit3, Plus, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardHero() {
  return (
    <div className="bg-white border border-border rounded-shell p-10 lg:p-14 shadow-sm relative overflow-hidden group border-zinc-100">
      {/* Subtle decorative background gradient */}
      <div className="absolute top-0 right-0 w-2/3 h-full bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.08),transparent_70%)] pointer-events-none" />
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-center relative z-10">
        <div className="lg:col-span-7 space-y-12">
          <div className="space-y-8">
            <h1 className="text-[64px] font-black leading-[1] tracking-tight text-zinc-900">
              Write, compile, and polish <br />
              <span className="text-primary italic relative inline-block mt-2">
                research beautifully
                <svg className="absolute -bottom-3 left-0 w-full h-4 text-primary/10" viewBox="0 0 100 10" preserveAspectRatio="none">
                  <path d="M0 5 Q 25 0 50 5 T 100 5" fill="none" stroke="currentColor" strokeWidth="3" />
                </svg>
              </span>
            </h1>
            <p className="text-[20px] text-zinc-500 max-w-lg leading-relaxed font-bold opacity-80">
              The high-fidelity LaTeX IDE that keeps your ideas, sources, and documents perfectly synchronized.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-4">
            <Button variant="primary" size="lg" href="/editor" className="h-16 px-12 rounded-2xl gap-3 text-base font-black shadow-2xl shadow-primary/30 hover:scale-[1.02] transition-transform active:scale-95">
              <Edit3 className="w-5.5 h-5.5" />
              Open Editor
            </Button>
            <Button variant="outline" size="lg" href="/editor?new=true" className="h-16 px-10 rounded-2xl gap-3 text-base font-black border-2 border-zinc-200 hover:border-primary/20 hover:bg-zinc-50 hover:scale-[1.02] transition-transform active:scale-95">
              <Plus className="w-5.5 h-5.5" />
              New Project
            </Button>
          </div>
        </div>

        <div className="lg:col-span-5 hidden lg:block pr-4">
          <div className="relative group/preview">
            <div className="absolute -inset-8 bg-primary/5 rounded-[50px] blur-3xl opacity-50" />
            
            {/* Display-only Illustrative Preview */}
            <div className="relative bg-white border border-border rounded-shell shadow-float overflow-hidden ring-12 ring-zinc-50/50 cursor-default">
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-50 bg-zinc-50/30">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-error/60" />
                  <div className="w-3 h-3 rounded-full bg-warning/60" />
                  <div className="w-3 h-3 rounded-full bg-success/60" />
                </div>
                <div className="px-3 py-1 bg-white border border-zinc-100 rounded-full">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">IDE Preview</span>
                </div>
              </div>
              
              <div className="grid grid-cols-12 h-[360px]">
                {/* Mini Editor Gutter */}
                <div className="col-span-5 border-r border-zinc-50 p-6 bg-white space-y-4">
                  <div className="space-y-3 font-mono text-[10px] text-zinc-400 select-none opacity-50">
                    <p className="text-primary font-bold">\documentclass{'{...}'}</p>
                    <div className="h-1.5 bg-zinc-50 rounded-full w-full" />
                    <p className="mt-6 font-black text-zinc-900">\begin{'{document}'}</p>
                    <div className="h-1.5 bg-zinc-50 rounded-full w-5/6 pl-4" />
                    <div className="h-1.5 bg-zinc-50 rounded-full w-4/6 pl-4" />
                    <p className="mt-8 text-primary font-bold">\section{'{Results}'}</p>
                  </div>
                </div>

                {/* Mini PDF Render */}
                <div className="col-span-7 bg-[#f8fafc] p-8 flex flex-col items-center justify-center relative">
                   <div className="w-full aspect-[1/1.414] bg-white shadow-2xl rounded-sm border border-zinc-200/30 p-6 space-y-6 scale-110">
                      <div className="space-y-2">
                         <div className="h-2 bg-zinc-900 rounded-full w-2/3 mx-auto" />
                         <div className="h-1.5 bg-zinc-100 rounded-full w-1/3 mx-auto" />
                      </div>
                      <div className="pt-6 space-y-2">
                         {[...Array(8)].map((_, i) => (
                           <div key={i} className={cn("h-1 bg-zinc-50 rounded-full", i % 3 === 0 ? "w-full" : "w-11/12")} />
                         ))}
                      </div>
                      <div className="mt-auto h-12 bg-primary/5 rounded-2xl border border-primary/10 flex items-center justify-center">
                         <FileText className="w-6 h-6 text-primary/20" />
                      </div>
                   </div>
                   
                   <div className="absolute top-6 right-6 bg-success text-white text-[10px] font-black px-3 py-1 rounded-full shadow-xl shadow-success/30 border border-white/20">
                      SUCCESS
                   </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
