"use client";

import { cn } from "@/lib/utils";
import { 
  Home, 
  Files, 
  Scissors, 
  Quote, 
  LayoutTemplate, 
  Trash2, 
  Zap, 
  FileText, 
  Library, 
  Settings,
  Circle,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarItemProps {
  icon: LucideIcon;
  label: string;
  href?: string;
  active?: boolean;
  disabled?: boolean;
}

function SidebarItem({ icon: Icon, label, href, active, disabled }: SidebarItemProps) {
  const content = (
    <div className={cn(
      "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 group",
      active 
        ? "bg-primary/10 text-primary shadow-sm shadow-primary/5" 
        : "text-zinc-500 hover:bg-zinc-100/80 hover:text-zinc-900",
      disabled && "opacity-50 cursor-not-allowed grayscale"
    )}>
      <Icon className={cn(
        "w-4 h-4 transition-transform group-hover:scale-110",
        active ? "text-primary" : "text-zinc-400 group-hover:text-zinc-600"
      )} />
      {label}
    </div>
  );

  if (disabled || !href) return content;
  return <Link href={href}>{content}</Link>;
}

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-border bg-background flex flex-col h-full overflow-y-auto shrink-0 scrollbar-hide">
      <div className="p-4 space-y-6">
        <div className="space-y-1">
          <SidebarItem icon={Home} label="Home" href="/" active={pathname === "/"} />
        </div>

        <div className="space-y-2">
          <div className="px-3 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Workspace
          </div>
          <div className="space-y-0.5">
            <SidebarItem icon={Files} label="Projects" href="/editor" />
            <SidebarItem icon={Scissors} label="Snippets" disabled />
            <SidebarItem icon={Quote} label="Citations" disabled />
            <SidebarItem icon={LayoutTemplate} label="Templates" disabled />
            <SidebarItem icon={Trash2} label="Trash" disabled />
          </div>
        </div>

        <div className="space-y-2">
          <div className="px-3 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Tools
          </div>
          <div className="space-y-0.5">
            <SidebarItem icon={Zap} label="Compile" disabled />
            <SidebarItem icon={FileText} label="PDF Workflow" disabled />
            <SidebarItem icon={Library} label="Bibliography" disabled />
            <SidebarItem icon={Settings} label="Settings" disabled />
          </div>
        </div>
      </div>

      <div className="mt-auto p-4 space-y-4">
        {/* Local Mode Status Card */}
        <div className="bg-zinc-50 border border-border rounded-xl p-3.5 space-y-2 group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-[12px] font-semibold text-zinc-900">Local Mode</span>
            </div>
            <span className="text-[10px] font-bold text-success bg-success-bg px-1.5 py-0.5 rounded border border-success-border">Ready</span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-tight font-medium">
            All systems operational. Files are saved to your local database.
          </p>
        </div>

        {/* Storage Card */}
        <div className="space-y-2.5 px-1">
          <div className="flex justify-between text-[11px]">
            <span className="font-medium text-zinc-500">Storage</span>
            <span className="text-zinc-900 font-semibold text-[10px]">2.4 GB / 10 GB</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary w-[24%] rounded-full shadow-[0_0_8px_rgba(124,58,237,0.3)]" />
          </div>
          <div className="flex justify-between items-center text-[11px]">
            <span className="font-medium text-zinc-500">Sync</span>
            <span className="text-success font-bold text-[10px] flex items-center gap-1 uppercase tracking-tighter">
              <Circle className="w-1 h-1 fill-current" /> Up to date
            </span>
          </div>
        </div>

        {/* Invite collaborators */}
        <button className="w-full flex items-center gap-3 px-3 py-2.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors rounded-xl text-[12px] font-medium disabled:opacity-50 disabled:cursor-not-allowed group" disabled title="Cloud only">
          <Users className="w-4 h-4 group-hover:scale-110 transition-transform" />
          Invite collaborators
        </button>
      </div>
    </aside>
  );
}
