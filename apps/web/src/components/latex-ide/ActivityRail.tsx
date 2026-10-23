"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { Settings, Menu, FileText, Search as SearchIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface RailItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function RailItem({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
  pressed,
}: RailItemProps & { pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={pressed ?? active ?? false}
      className={cn(
        "flex h-9 w-9 items-center justify-center transition-colors group relative rounded-lg disabled:opacity-20 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      <Icon
        aria-hidden="true"
        size={18}
        strokeWidth={2}
        className="transition-transform group-hover:scale-105"
      />
    </button>
  );
}

import { useEffect, useState } from "react";

export function ActivityRail({
  onOpenSidebar,
  onToggleSidebar,
  drawerOpen,
}: {
  onOpenSidebar?: () => void;
  onToggleSidebar?: () => void;
  drawerOpen?: boolean;
}) {
  const {
    activeRail,
    setActiveRail,
    sidebarOpen,
    toggleSidebar,
    setSettingsModalOpen,
  } = useWorkbenchStore();
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  // On narrow layouts the file browser is a drawer driven by the parent's
  // drawerOpen state; on desktop it follows the persisted sidebarOpen flag.
  const expanded = isNarrow ? Boolean(drawerOpen) : sidebarOpen;

  return (
    <nav
      aria-label="Workbench"
      className="relative z-[45] isolate w-12 shrink-0 select-none flex flex-col items-center border-r border-border bg-chrome py-1"
    >
      <div className="flex flex-col flex-1 w-full items-center gap-0.5">
        <RailItem
          icon={FileText}
          label="Project"
          active={activeRail === "explorer" && expanded}
          onClick={() => {
            setActiveRail("explorer");
            onOpenSidebar?.();
          }}
        />
        <RailItem
          icon={SearchIcon}
          label="Search"
          active={activeRail === "search" && expanded}
          onClick={() => {
            setActiveRail("search");
            onOpenSidebar?.();
          }}
        />
      </div>

      <div className="relative z-[1] flex flex-col w-full items-center gap-0.5 pb-2">
        <RailItem
          icon={Settings}
          label="Settings"
          active={false}
          pressed={false}
          onClick={() => setSettingsModalOpen(true)}
        />
        <div aria-hidden="true" className="w-6 h-px bg-border my-1" />
        <button
          type="button"
          aria-label="Toggle file browser"
          aria-expanded={expanded}
          onClick={onToggleSidebar ?? toggleSidebar}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu aria-hidden="true" size={18} />
        </button>
      </div>
    </nav>
  );
}
