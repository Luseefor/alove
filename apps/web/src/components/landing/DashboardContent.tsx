"use client";

import { 
  FileText, 
  MoreVertical, 
  Plus, 
  Upload, 
  Play, 
  Layout, 
  Quote, 
  GitBranch, 
  Scissors, 
  FileCheck,
  ChevronRight,
  ShieldCheck,
  Zap,
  Terminal,
  ArrowRight
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function SectionHeader({ title, action }: { title: string, action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-bold text-zinc-900 tracking-tight">{title}</h2>
      {action}
    </div>
  );
}

function StatusRow({ label, status, subtext, icon: Icon, color }: { label: string, status: string, subtext: string, icon: LucideIcon, color: string }) {
  return (
    <div className="flex items-start gap-4 group cursor-help">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-colors", color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-zinc-900">{label}</span>
          <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border shadow-sm transition-transform group-hover:scale-105", color.replace('bg-', 'bg-opacity-10 text-'))}>
            {status}
          </span>
        </div>
        <p className="text-[11px] text-zinc-500 font-medium">{subtext}</p>
      </div>
    </div>
  );
}

export function DashboardContent() {
  return (
    <div className="space-y-12 pb-20">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Recent Projects */}
        <div className="lg:col-span-8 space-y-4">
          <SectionHeader 
            title="Recent Projects" 
            action={<button className="text-[11px] font-bold text-primary hover:underline">View all</button>} 
          />
          <div className="bg-white border border-border rounded-[20px] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            <div className="divide-y divide-zinc-100">
              {[
                { title: "Quantum Entanglement Review", file: "main.tex", time: "2m ago", pages: 24, files: 128, color: "text-primary bg-primary/5 border-primary/10" },
                { title: "Thesis Draft", file: "thesis.tex", time: "1h ago", pages: 186, files: 312, color: "text-success bg-success-bg border-success-border" },
                { title: "Deep Learning Survey", file: "survey.tex", time: "5h ago", pages: 32, files: 56, color: "text-warning bg-warning-bg border-warning-border" },
                { title: "Optimization Methods", file: "optimization.tex", time: "Yesterday", pages: 28, files: 44, color: "text-violet-600 bg-violet-50 border-violet-100" },
                { title: "Conference Paper", file: "paper.tex", time: "2d ago", pages: 12, files: 23, color: "text-info bg-info-bg border-info-border" }
              ].map((project, i) => (
                <div key={i} className="flex items-center gap-4 p-4 hover:bg-zinc-50/80 transition-colors group cursor-pointer">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border transition-transform group-hover:scale-110 shadow-sm", project.color)}>
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[13px] font-bold text-zinc-900 truncate group-hover:text-primary transition-colors">{project.title}</h3>
                    <p className="text-[11px] text-zinc-400 font-medium">{project.file}</p>
                  </div>
                  <div className="flex items-center gap-6 text-[11px] font-semibold text-zinc-500">
                    <span className="w-16 text-right whitespace-nowrap">{project.time}</span>
                    <div className="flex items-center gap-4 w-32 justify-end">
                      <span className="flex items-center gap-1.5 shrink-0"><FileText className="w-3 h-3 text-zinc-300" /> {project.pages} pages</span>
                      <span className="flex items-center gap-1.5 shrink-0"><Layout className="w-3 h-3 text-zinc-300" /> {project.files} files</span>
                    </div>
                    <button className="p-1.5 hover:bg-zinc-100 rounded-lg transition-colors ml-2">
                      <MoreVertical className="w-4 h-4 text-zinc-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Workspace Status */}
        <div className="lg:col-span-4 space-y-4">
          <SectionHeader title="Workspace Status" />
          <div className="bg-white border border-border rounded-[20px] p-6 shadow-sm space-y-8">
            <StatusRow 
              label="Local Mode" 
              status="Ready" 
              subtext="All files are saved locally" 
              icon={ShieldCheck} 
              color="bg-success-bg text-success border-success-border" 
            />
            <StatusRow 
              label="Compile Pipeline" 
              status="Ready" 
              subtext="LaTeX, BibTeX, Biber configured" 
              icon={Zap} 
              color="bg-primary/5 text-primary border-primary/10" 
            />
            <StatusRow 
              label="Editor Mode" 
              status="Advanced" 
              subtext="Synced, autosave on" 
              icon={Terminal} 
              color="bg-violet-50 text-violet-600 border-violet-100" 
            />
            
            <button className="w-full flex items-center justify-between p-3.5 bg-zinc-50 hover:bg-zinc-100 border border-border rounded-xl transition-all group">
               <span className="text-[11px] font-bold text-zinc-700 flex items-center gap-2">
                 <Terminal className="w-3.5 h-3.5 text-primary" /> View System Details
               </span>
               <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick Start & Feature Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-4">
          <SectionHeader title="Quick Start" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: "New Document", icon: Plus, color: "text-primary bg-primary/5 border-primary/10" },
              { title: "Import Project", icon: Upload, color: "text-zinc-600 bg-zinc-50 border-zinc-100" },
              { title: "Open Sample", icon: Play, color: "text-success bg-success-bg border-success-border" },
              { title: "Templates", icon: Layout, color: "text-violet-600 bg-violet-50 border-violet-100" },
              { title: "Bibliography Setup", icon: Quote, color: "text-warning bg-warning-bg border-warning-border" },
              { title: "Project from Git", icon: GitBranch, color: "text-indigo-600 bg-indigo-50 border-indigo-100" }
            ].map((action, i) => (
              <div key={i} className="group bg-white border border-border rounded-2xl p-5 hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5 transition-all cursor-pointer">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border mb-4 transition-transform group-hover:scale-110 shadow-sm", action.color)}>
                  <action.icon className="w-5 h-5" />
                </div>
                <h3 className="text-[13px] font-bold text-zinc-900 group-hover:text-primary transition-colors">{action.title}</h3>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4 space-y-4">
          <SectionHeader title="Templates" action={<button className="text-[11px] font-bold text-primary hover:underline">Browse all</button>} />
          <div className="grid grid-cols-2 gap-4">
            {[
              { title: "Thesis", desc: "Classic thesis format", icon: "T" },
              { title: "Research Article", desc: "Journal article (Elsevier)", icon: "R" },
              { title: "Report", desc: "Technical report", icon: "P" },
              { title: "Presentation", desc: "Beamer slides", icon: "S" }
            ].map((t, i) => (
              <div key={i} className="bg-white border border-border rounded-2xl p-4 hover:border-primary/20 hover:shadow-md transition-all cursor-pointer group text-center space-y-2">
                <div className="w-10 h-10 mx-auto bg-zinc-50 rounded-lg flex items-center justify-center border border-zinc-100 text-[10px] font-bold text-zinc-400 group-hover:bg-primary/5 group-hover:text-primary transition-colors">
                  {t.icon}
                </div>
                <h4 className="text-[11px] font-bold text-zinc-900 truncate">{t.title}</h4>
                <p className="text-[9px] text-zinc-400 font-medium truncate">{t.desc}</p>
              </div>
            ))}
            <div className="col-span-2 bg-zinc-50/50 border border-dashed border-border rounded-2xl p-4 hover:bg-zinc-50 transition-colors cursor-pointer flex items-center justify-center gap-2">
              <Plus className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-[11px] font-bold text-zinc-500">More templates</span>
            </div>
          </div>
        </div>
      </div>

      {/* Feature Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { title: "Snippets", desc: "Reusable LaTeX building blocks to write faster.", action: "Open Snippets", icon: Scissors },
          { title: "Citations", desc: "Manage bibliographies and cite with ease.", action: "Manage Citations", icon: Quote },
          { title: "PDF Workflow", desc: "Export, optimize, and share your PDFs.", action: "Open PDF Tools", icon: FileCheck }
        ].map((f, i) => (
          <div key={i} className="bg-white border border-border rounded-[24px] p-6 shadow-sm hover:shadow-md transition-all group cursor-pointer flex flex-col items-start gap-4">
            <div className="w-12 h-12 bg-zinc-50 rounded-2xl flex items-center justify-center border border-zinc-100 text-primary group-hover:bg-primary group-hover:text-white transition-colors shadow-sm">
              <f.icon className="w-6 h-6" />
            </div>
            <div className="space-y-1">
               <h3 className="text-[15px] font-bold text-zinc-900">{f.title}</h3>
               <p className="text-[12px] text-zinc-500 font-medium leading-relaxed">{f.desc}</p>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[12px] font-bold text-primary group-hover:gap-3 transition-all">
              {f.action} <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
