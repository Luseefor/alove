"use client";

import { FileText } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { PaletteSwitcher } from "@/components/theme/PaletteSwitcher";
import { useEffect, useState } from "react";
import Link from "next/link";

export function DashboardHeader() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-16 shrink-0 bg-background" />;

  return (
    <header className="min-h-16 flex-wrap gap-3 py-3 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-[100] flex items-center justify-between px-4 sm:px-8 shrink-0">
      <div className="flex items-center gap-3 sm:gap-12">
        <Link
          href="/"
          className="flex items-center gap-2.5 pr-3 sm:pr-8 border-r border-border group transition-all"
        >
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center text-white shadow-xl shadow-primary/25 group-hover:scale-105 transition-transform">
            <span className="font-black text-xl tracking-tighter">a</span>
          </div>
          <span className="text-2xl font-black tracking-tighter text-foreground">
            alove
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link
            href="/projects"
            title="Projects"
            aria-label="Projects"
            className="rounded p-2 hover:bg-muted"
          >
            <FileText className="h-5 w-5" />
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
