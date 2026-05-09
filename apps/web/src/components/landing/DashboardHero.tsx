"use client";

import { Button } from "@/components/ui/primitives";
import { Edit3, Plus, CheckCircle2, Zap, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardHero() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      <div className="lg:col-span-7 space-y-8 pt-6">
        <div className="space-y-4">
          <h1 className="text-[52px] font-bold leading-[1.1] tracking-tight text-zinc-900">
            Write, compile, and polish <br />
            <span className="text-primary italic relative">
              research beautifully
              <svg className="absolute -bottom-2 left-0 w-full h-2 text-primary/20" viewBox="0 0 100 10" preserveAspectRatio="none">
                <path d="M0 5 Q 25 0 50 5 T 100 5" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
          </h1>
          <p className="text-lg text-zinc-500 max-w-lg leading-relaxed font-medium">
            The LaTeX workspace that keeps your ideas, sources, and documents perfectly in sync.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary" size="lg" href="/editor" className="h-14 px-8 rounded-2xl gap-2 text-base font-bold shadow-xl shadow-primary/20 hover:scale-[1.02] transition-transform active:scale-95">
            <Edit3 className="w-5 h-5" />
            Open Editor
          </Button>
          <Button variant="outline" size="lg" className="h-14 px-8 rounded-2xl gap-2 text-base font-bold border-2 hover:bg-zinc-50 hover:scale-[1.02] transition-transform active:scale-95">
            <Plus className="w-5 h-5" />
            New Project
          </Button>
        </div>
      </div>

      <div className="lg:col-span-5 relative group">
        <div className="absolute -inset-4 bg-gradient-to-tr from-primary/5 via-primary/10 to-transparent rounded-[32px] blur-2xl group-hover:opacity-75 transition-opacity" />
        <div className="relative bg-white border border-border rounded-[24px] shadow-2xl overflow-hidden ring-8 ring-zinc-50/50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-zinc-50/50">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-error" />
              <div className="w-2.5 h-2.5 rounded-full bg-warning" />
              <div className="w-2.5 h-2.5 rounded-full bg-success" />
            </div>
            <div className="flex items-center gap-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
              <span className="flex items-center gap-1.5">
                <Monitor className="w-3 h-3" /> Workspace Preview
              </span>
            </div>
          </div>
          
          <div className="grid grid-cols-12 h-[320px]">
            {/* Mini Editor */}
            <div className="col-span-5 border-r border-border p-4 bg-zinc-50/30">
              <div className="space-y-2.5 font-mono text-[9px] text-zinc-400 select-none">
                <p className="text-primary/70">\documentclass{'{article}'}</p>
                <p className="text-zinc-500">\usepackage{'{amsmath}'}</p>
                <p className="text-zinc-500">\usepackage{'{graphicx}'}</p>
                <p className="mt-2 font-bold text-zinc-800">\title{'{Quantum Entanglement}'}</p>
                <p className="text-zinc-500">\author{'{A. Love}'}</p>
                <p className="text-zinc-400 mt-4">\begin{'{document}'}</p>
                <p className="text-zinc-400">\maketitle</p>
                <p className="text-primary font-bold pl-2">\section{'{Introduction}'}</p>
                <p className="text-zinc-400 pl-2 leading-relaxed">
                  Quantum entanglement is a fundamental resource in quantum information science...
                </p>
                <p className="text-zinc-300">\end{'{document}'}</p>
              </div>
              <div className="absolute bottom-4 left-4 flex items-center gap-2 px-2 py-1 bg-white border border-border rounded-md shadow-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span className="text-[9px] font-bold text-zinc-600 tracking-tighter">main.tex</span>
              </div>
            </div>

            {/* Mini PDF */}
            <div className="col-span-7 bg-zinc-100/20 p-6 flex flex-col items-center justify-center relative overflow-hidden">
              <div className="w-full max-w-[200px] aspect-[1/1.414] bg-white shadow-xl shadow-zinc-200/50 rounded-sm border border-zinc-200 p-4 space-y-3 relative z-10">
                <div className="flex justify-between items-center">
                   <div className="w-8 h-1 bg-zinc-100 rounded-full" />
                   <div className="w-4 h-4 bg-zinc-50 rounded-full" />
                </div>
                <div className="space-y-1.5 pt-2">
                  <div className="w-full h-1 bg-zinc-900 rounded-full" />
                  <div className="w-3/4 h-1 bg-zinc-900 rounded-full" />
                </div>
                <div className="w-full h-2 bg-primary/5 rounded-sm flex items-center justify-center border border-primary/10">
                   <div className="w-1/2 h-0.5 bg-primary/20 rounded-full" />
                </div>
                <div className="space-y-1 pt-2">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className={cn("h-[2px] bg-zinc-100 rounded-full", i % 3 === 0 ? "w-full" : i % 3 === 1 ? "w-[90%]" : "w-[95%]")} />
                  ))}
                </div>
              </div>
              
              {/* Floating success indicator */}
              <div className="absolute top-4 right-4 flex items-center gap-2 bg-success-bg border border-success-border px-2.5 py-1.5 rounded-xl shadow-lg shadow-success/10 animate-bounce transition-transform">
                <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                <span className="text-[10px] font-bold text-success">COMPILED</span>
              </div>

              {/* Status bar */}
              <div className="absolute bottom-0 inset-x-0 bg-white/80 backdrop-blur-sm border-t border-border px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-3 h-3 text-primary" />
                  <span className="text-[10px] font-bold text-zinc-500">2.4s Build</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-success" />
                  <span className="text-[9px] font-bold text-success">Sync Active</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
