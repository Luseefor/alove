"use client";

import { 
  FileText, 
  Plus, 
  Play, 
  Layout, 
  Zap,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

import Link from "next/link";

function QuickStartCard({ title, icon: Icon, color, href }: { title: string, icon: LucideIcon, color: string, href: string }) {
  return (
    <Link href={href} className="group bg-white border border-border rounded-2xl p-5 hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5 transition-all cursor-pointer">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border mb-4 transition-transform group-hover:scale-110 shadow-sm", color)}>
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-[13px] font-bold text-zinc-900 group-hover:text-primary transition-colors">{title}</h3>
    </Link>
  );
}

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
    <div className="flex items-start gap-4 group cursor-default">
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
            title="Projects" 
            action={<button className="text-[11px] font-bold text-primary hover:underline">View all</button>} 
          />
          <div className="bg-white border border-border rounded-[20px] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            <div className="divide-y divide-zinc-100">
              {[
                { title: "Quantum Entanglement Review", file: "main.tex", time: "Sample Project", pages: "—", files: 12, color: "text-primary bg-primary/5 border-primary/10" },
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
                    <span className="w-24 text-right whitespace-nowrap">{project.time}</span>
                    <div className="flex items-center gap-4 w-32 justify-end">
                      <span className="flex items-center gap-1.5 shrink-0"><FileText className="w-3 h-3 text-zinc-300" /> {project.pages} pages</span>
                      <span className="flex items-center gap-1.5 shrink-0"><Layout className="w-3 h-3 text-zinc-300" /> {project.files} files</span>
                    </div>
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
              subtext="Standalone offline mode active" 
              icon={ShieldCheck} 
              color="bg-success-bg text-success border-success-border" 
            />
            <StatusRow 
              label="Compile Pipeline" 
              status="Ready" 
              subtext="BullMQ & Docker connected" 
              icon={Zap} 
              color="bg-primary/5 text-primary border-primary/10" 
            />
          </div>
        </div>
      </div>

      {/* Quick Start & Feature Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-12 space-y-4">
          <SectionHeader title="Quick Start" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <QuickStartCard 
              title="New Document" 
              icon={Plus} 
              href="/editor?new=true"
              color="text-primary bg-primary/5 border-primary/10" 
            />
            <QuickStartCard 
              title="Open Sample" 
              icon={Play} 
              href="/editor"
              color="text-success bg-success-bg border-success-border" 
            />
            <QuickStartCard 
              title="Editor" 
              icon={Layout} 
              href="/editor"
              color="text-violet-600 bg-violet-50 border-violet-100" 
            />
          </div>
        </div>
      </div>
    </div>
  );
}
