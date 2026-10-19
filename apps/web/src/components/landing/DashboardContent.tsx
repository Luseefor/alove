"use client";

import { Plus, Play, Layout, Zap, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { isLocalStandalone } from "@/lib/localStandalone";
import { LocalProjectList } from "./LocalProjectList";
import { ProjectLauncher } from "./ProjectLauncher";
import { useState, useEffect } from "react";

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4 px-2">
      <h2 className="text-overline text-muted-foreground opacity-80">{title}</h2>
      {action}
    </div>
  );
}

function QuickStartCard({
  title,
  icon: Icon,
  color,
  href,
}: {
  title: string;
  icon: LucideIcon;
  color: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group bg-card-bg border border-border rounded-3xl p-6 hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5 transition-all cursor-pointer flex flex-col items-start gap-4"
    >
      <div
        className={cn(
          "w-12 h-12 rounded-2xl flex items-center justify-center border transition-all group-hover:scale-110 shadow-sm",
          color,
        )}
      >
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-[15px] font-black text-foreground group-hover:text-primary transition-colors">
        {title}
      </h3>
    </Link>
  );
}

function StatusRow({
  label,
  status,
  subtext,
  icon: Icon,
  color,
  statusColor,
}: {
  label: string;
  status: string;
  subtext: string;
  icon: LucideIcon;
  color: string;
  statusColor: string;
}) {
  return (
    <div className="flex items-start gap-5 group cursor-default">
      <div
        className={cn(
          "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-colors shadow-sm",
          color,
        )}
      >
        <Icon className="w-6 h-6" />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-black text-foreground tracking-tight">
            {label}
          </span>
          <span
            className={cn(
              "text-[10px] font-black uppercase tracking-[0.15em] px-2.5 py-1 rounded-full border shadow-sm",
              statusColor,
            )}
          >
            {status}
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground font-bold opacity-70 leading-tight">
          {subtext}
        </p>
      </div>
    </div>
  );
}

export function DashboardContent() {
  const localMode = isLocalStandalone();
  const [health, setHealth] = useState<{ ok: boolean; redis: string } | null>(
    null,
  );

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch(() => setHealth({ ok: false, redis: "unavailable" }));
  }, []);

  const compileStatus = health
    ? health.redis === "ok"
      ? "Configured"
      : "Unavailable"
    : "Checking...";

  const compileStatusColor =
    compileStatus === "Configured"
      ? "bg-success-bg text-success border-success-border"
      : compileStatus === "Checking..."
        ? "bg-muted text-muted-foreground border-border"
        : "bg-error-bg text-error border-error-border";

  return (
    <div className="space-y-16">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Recent Projects */}
        <div className="lg:col-span-8 space-y-4">
          <SectionHeader
            title="Active Documents"
            action={
              <Link
                href="/projects"
                className="text-[11px] font-black uppercase tracking-widest text-primary hover:opacity-80 transition-opacity"
              >
                View all
              </Link>
            }
          />
          {localMode ? (
            <LocalProjectList />
          ) : (
            <Link href="/editor" className="text-primary underline">
              Open cloud workspace
            </Link>
          )}
        </div>

        {/* Workspace Status */}
        <div className="lg:col-span-4 space-y-4">
          <SectionHeader title="Workspace Health" />
          <div className="bg-background border border-border rounded-shell p-10 shadow-sm space-y-12 border-border min-h-[300px] flex flex-col justify-center">
            <StatusRow
              label="Local Standalone"
              status={localMode ? "Active" : "Cloud"}
              subtext={
                localMode
                  ? "Source is saved in this browser"
                  : "Connected to Convex cloud"
              }
              icon={ShieldCheck}
              color="bg-success-bg text-success border-success-border"
              statusColor="bg-success-bg text-success border-success-border"
            />
            <StatusRow
              label="Compile Pipeline"
              status={compileStatus}
              subtext={
                health?.redis === "ok"
                  ? "Queue host configured; build to check the worker"
                  : "Awaiting system connection"
              }
              icon={Zap}
              color={
                compileStatus === "Configured"
                  ? "bg-primary/5 text-primary border-primary/10"
                  : "bg-muted text-zinc-300 border-border"
              }
              statusColor={compileStatusColor}
            />
          </div>
        </div>
      </div>

      {/* Quick Start */}
      <div className="space-y-6 pt-4">
        <SectionHeader title="Launch Actions" />
        {localMode && <ProjectLauncher />}
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
            href="/editor?sample=true"
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
