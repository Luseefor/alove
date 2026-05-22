"use client";

import { 
  HelpCircle, 
  FileText,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { PaletteSwitcher } from "@/components/theme/PaletteSwitcher";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

function IconButton({ icon: Icon, title, disabled }: { icon: LucideIcon, title?: string, disabled?: boolean }) {
  return (
    <button 
      className={cn(
        "p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed",
      )}
      title={title}
      disabled={disabled}
    >
      <Icon className="w-5 h-5" />
    </button>
  );
}

export function DashboardHeader() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-16 shrink-0 bg-white" />;

  return (
    <header className="h-16 border-b border-border bg-white/80 backdrop-blur-md sticky top-0 z-[100] flex items-center justify-between px-8 shrink-0">
      <div className="flex items-center gap-12">
        <Link href="/" className="flex items-center gap-2.5 pr-8 border-r border-zinc-100 group transition-all">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center text-white shadow-xl shadow-primary/25 group-hover:scale-105 transition-transform">
            <span className="font-black text-xl tracking-tighter">a</span>
          </div>
          <span className="text-2xl font-black tracking-tighter text-zinc-900">alove</span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link href="/editor" title="Projects">
            <IconButton icon={FileText} />
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3 pr-4">
           <div className="flex items-center gap-2">
              <PaletteSwitcher size="sm" />
              <ThemeToggle />
           </div>
        </div>
      </div>
    </header>
  );
}
