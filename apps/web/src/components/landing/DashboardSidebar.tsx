"use client";

import { cn } from "@/lib/utils";
import { Home, Files, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isLocalStandalone } from "@/lib/localStandalone";

interface SidebarItemProps {
  icon: LucideIcon;
  label: string;
  href?: string;
  active?: boolean;
  disabled?: boolean;
}

function SidebarItem({
  icon: Icon,
  label,
  href,
  active,
  disabled,
}: SidebarItemProps) {
  const content = (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-[14px] font-bold transition-all duration-200 group",
        active
          ? "bg-primary text-white shadow-lg shadow-primary/25"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <Icon
        className={cn(
          "w-4 h-4 transition-transform group-hover:scale-110",
          active
            ? "text-white"
            : "text-muted-foreground group-hover:text-zinc-600",
        )}
      />
      {label}
    </div>
  );

  if (disabled || !href) return content;
  return <Link href={href}>{content}</Link>;
}

export function DashboardSidebar() {
  const pathname = usePathname();
  const localMode = isLocalStandalone();

  return (
    <aside className="w-full border-r border-border bg-background flex flex-col h-full overflow-y-auto shrink-0 scrollbar-hide">
      <div className="p-6 space-y-8">
        <div className="space-y-1.5">
          <SidebarItem
            icon={Home}
            label="Home"
            href="/"
            active={pathname === "/"}
          />
          <SidebarItem
            icon={Files}
            label="Projects"
            href="/projects"
            active={pathname === "/projects"}
          />
        </div>

        <div className="space-y-3">
          <div className="px-4 text-overline text-muted-foreground opacity-80 border-b border-border pb-2">
            Tools
          </div>
          <div className="space-y-1">
            <SidebarItem
              icon={Settings}
              label="Settings"
              href="/editor?settings=true"
            />
          </div>
        </div>
      </div>

      <div className="mt-auto p-6 space-y-6">
        {/* Local Mode Status Card */}
        <div className="bg-background border border-primary/10 rounded-panel p-5 space-y-3 shadow-sm relative overflow-hidden group border shadow-sm">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full -mr-8 -mt-8 blur-2xl group-hover:bg-primary/10 transition-colors" />
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "w-2 h-2 rounded-full shadow-success-glow",
                  localMode ? "bg-success animate-pulse" : "bg-info",
                )}
              />
              <span className="text-[13px] font-black text-foreground uppercase tracking-tight">
                Status
              </span>
            </div>

            <span className="text-[10px] font-black text-success bg-success-bg px-2 py-0.5 rounded-full border border-success-border">
              ONLINE
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed font-medium relative z-10">
            {localMode
              ? "Local mode. Projects are saved in this browser; export source for a portable backup."
              : "Cloud mode. Check the editor save status to confirm synchronization."}
          </p>
        </div>

        <div className="px-4">
          <p className="text-[11px] font-bold text-muted-foreground text-center tracking-tight italic opacity-60">
            alove workspace v0.1.0
          </p>
        </div>
      </div>
    </aside>
  );
}
