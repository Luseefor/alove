"use client";

import { 
  Search, 
  Bell, 
  HelpCircle, 
  FileText,
  FolderOpen,
  Cloud,
  Star,
  History,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { PaletteSwitcher } from "@/components/theme/PaletteSwitcher";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function IconButton({ icon: Icon, title, disabled }: { icon: LucideIcon, title?: string, disabled?: boolean }) {
  return (
    <button 
      className={cn(
        "p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed",
      )}
      title={title}
      disabled={disabled}
    >
      <Icon className="w-[18px] h-[18px]" />
    </button>
  );
}

export function DashboardHeader() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-14 shrink-0" />;

  return (
    <header className="h-14 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between px-4 shrink-0">
...
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2 pr-6 border-r border-border">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white shadow-lg shadow-primary/20">
            <span className="font-bold text-lg tracking-tight">a</span>
          </div>
          <span className="text-xl font-bold tracking-tight text-primary drop-shadow-sm">alove</span>
        </div>

        <nav className="flex items-center gap-1.5">
          <IconButton icon={FileText} title="Recent Documents" />
          <IconButton icon={FolderOpen} title="Open Project" />
          <IconButton icon={Cloud} title="Cloud Sync" disabled />
          <IconButton icon={Star} title="Favorites" disabled />
          <IconButton icon={History} title="Version History" disabled />
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center bg-zinc-100/50 rounded-lg px-3 py-1.5 gap-2 border border-transparent focus-within:border-primary/20 focus-within:bg-white transition-all group w-64">
          <Search className="w-4 h-4 text-zinc-400 group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="Search projects..." 
            className="bg-transparent border-none text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:ring-0 w-full p-0"
          />
        </div>

        <div className="flex items-center gap-1 pl-3 border-l border-border ml-2">
          <IconButton icon={Bell} title="Notifications" disabled />
          <IconButton icon={HelpCircle} title="Help & Support" />
          
          <div className="flex items-center gap-2 ml-1">
            <PaletteSwitcher size="sm" />
            <ThemeToggle />
          </div>

          <div className="ml-2 flex items-center gap-2 bg-zinc-100/80 p-1 rounded-full pl-1.5 pr-3 hover:bg-zinc-200/80 transition-colors cursor-pointer group active:scale-95">
            <div className="w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center text-primary font-bold text-[10px] group-hover:bg-primary group-hover:text-white transition-colors">
              A
            </div>
            <span className="text-[11px] font-semibold text-zinc-700">Account</span>
          </div>
        </div>
      </div>
    </header>
  );
}
