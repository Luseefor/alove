"use client";

import { 
  FileText, 
  Plus, 
  Play, 
  Layout, 
  Zap,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { isLocalStandalone } from "@/lib/localStandalone";
import { useState, useEffect } from "react";

function SectionHeader({ title, action }: { title: string, action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4 px-2">
      <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400 opacity-80">{title}</h2>
      {action}
    </div>
  );
}

function QuickStartCard({ title, icon: Icon, color, href }: { title: string, icon: LucideIcon, color: string, href: string }) {
  return (
    <Link href={href} className="group bg-white border border-zinc-100 rounded-3xl p-6 hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5 transition-all cursor-pointer flex flex-col items-start gap-4">
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center border transition-all group-hover:scale-110 shadow-sm", color)}>
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-[15px] font-black text-zinc-900 group-hover:text-primary transition-colors">{title}</h3>
    </Link>
  );
}

function StatusRow({ label, status, subtext, icon: Icon, color, statusColor }: { label: string, status: string, subtext: string, icon: LucideIcon, color: string, statusColor: string }) {
  return (
    <div className="flex items-start gap-5 group cursor-default">
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-colors shadow-sm", color)}>
        <Icon className="w-6 h-6" />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-black text-zinc-900 tracking-tight">{label}</span>
          <span className={cn("text-[10px] font-black uppercase tracking-[0.15em] px-2.5 py-1 rounded-full border shadow-sm", statusColor)}>
            {status}
          </span>
        </div>
        <p className="text-[12px] text-zinc-500 font-bold opacity-70 leading-tight">{subtext}</p>
      </div>
    </div>
  );
}

export function DashboardContent() {
  const localMode = isLocalStandalone();
  const [health, setHealth] = useState<{ ok: boolean; redis: string } | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then(res => res.json())
      .then(data => setHealth(data))
      .catch(() => setHealth({ ok: false, redis: "unavailable" }));
  }, []);

  const compileStatus = health 
    ? (health.redis === "ok" ? "Ready" : "Unavailable") 
    : "Checking...";

  const compileStatusColor = compileStatus === "Ready" 
    ? "bg-success-bg text-success border-success-border" 
    : compileStatus === "Checking..."
      ? "bg-zinc-50 text-zinc-400 border-zinc-100"
      : "bg-error-bg text-error border-error-border";

  return (
    <div className="space-y-16">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Recent Projects */}
        <div className="lg:col-span-8 space-y-4">
          <SectionHeader 
            title="Active Documents" 
            action={<button className="text-[11px] font-black uppercase tracking-widest text-primary hover:opacity-80 transition-opacity">View all</button>} 
          />
          <div className="bg-white border border-border rounded-[32px] overflow-hidden shadow-sm border-zinc-100 min-h-[300px] flex flex-col">
            <div className="divide-y divide-zinc-50 flex-1">
              <div className="flex items-center gap-5 p-6 hover:bg-zinc-50/50 transition-colors group cursor-pointer">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center border text-primary bg-primary/5 border-primary/10 transition-all group-hover:scale-105 shadow-sm group-hover:bg-white">
                  <FileText className="w-7 h-7" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <h3 className="text-[16px] font-black text-zinc-900 truncate group-hover:text-primary transition-colors tracking-tight">Quantum Entanglement Review</h3>
                  <p className="text-[12px] text-zinc-400 font-bold uppercase tracking-wider opacity-60">main.tex</p>
                </div>
                <div className="flex items-center gap-10 text-[12px] font-black text-zinc-500">
                  <span className="w-28 text-right whitespace-nowrap opacity-40 uppercase tracking-tighter">Local Sandbox</span>
                  <div className="flex items-center gap-8 w-40 justify-end opacity-20 group-hover:opacity-40 transition-opacity">
                    <span className="flex items-center gap-2 shrink-0"><FileText className="w-4 h-4" /> —</span>
                    <span className="flex items-center gap-2 shrink-0"><Layout className="w-4 h-4" /> 12</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-5 bg-zinc-50/30 border-t border-zinc-50 flex justify-center">
               <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.25em] opacity-60">
                 End of local document history
               </p>
            </div>
          </div>
        </div>

        {/* Workspace Status */}
        <div className="lg:col-span-4 space-y-4">
          <SectionHeader title="Workspace Health" />
          <div className="bg-white border border-border rounded-[32px] p-10 shadow-sm space-y-12 border-zinc-100 min-h-[300px] flex flex-col justify-center">
            <StatusRow 
              label="Local Standalone" 
              status={localMode ? "Active" : "Cloud"} 
              subtext={localMode ? "Full offline capabilities active" : "Connected to Convex cloud"} 
              icon={ShieldCheck} 
              color="bg-success-bg text-success border-success-border" 
              statusColor="bg-success-bg text-success border-success-border"
            />
            <StatusRow 
              label="Compile Pipeline" 
              status={compileStatus} 
              subtext={health?.redis === "ok" ? "BullMQ & Docker connected" : "Awaiting system connection"} 
              icon={Zap} 
              color={compileStatus === "Ready" ? "bg-primary/5 text-primary border-primary/10" : "bg-zinc-50 text-zinc-300 border-zinc-100"} 
              statusColor={compileStatusColor}
            />
          </div>
        </div>
      </div>

      {/* Quick Start */}
      <div className="space-y-6 pt-4">
        <SectionHeader title="Launch Actions" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
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
            title="LaTeX Editor" 
            icon={Layout} 
            href="/editor"
            color="text-violet-600 bg-violet-50 border-violet-100" 
          />
        </div>
      </div>
    </div>
  );
}
