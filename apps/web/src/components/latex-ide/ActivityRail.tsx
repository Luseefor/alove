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
        "w-12 h-12 flex items-center justify-center transition-all group relative disabled:opacity-20 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon
        aria-hidden="true"
        size={20}
        strokeWidth={active ? 2.5 : 2}
        className="transition-transform group-hover:scale-110"
      />
      {active && (
        <div
          aria-hidden="true"
          className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-primary rounded-r-full shadow-[0_0_8px_rgba(124,58,237,0.5)]"
        />
      )}
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
      className="relative z-[45] isolate w-12 border-r bg-background flex flex-col items-center shrink-0 select-none shadow-[1px_0_0_rgba(0,0,0,0.02)]"
    >
      <div className="flex flex-col flex-1 w-full items-center">
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

      <div className="relative z-[1] flex flex-col w-full items-center pb-4">
        <RailItem
          icon={Settings}
          label="Settings"
          active={false}
          pressed={false}
          onClick={() => setSettingsModalOpen(true)}
        />
        <div aria-hidden="true" className="w-8 h-px bg-muted my-2" />
        <button
          type="button"
          aria-label="Toggle file browser"
          aria-expanded={expanded}
          onClick={onToggleSidebar ?? toggleSidebar}
          className="size-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu aria-hidden="true" size={20} />
        </button>
      </div>
    </nav>
  );
}
