"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { 
  Settings, 
  Menu, 
  FileText, 
  Search as SearchIcon,
  GitBranch,
  History,
  LayoutGrid
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface RailItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function RailItem({ icon: Icon, label, active, onClick, disabled }: RailItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "w-12 h-12 flex items-center justify-center transition-all group relative disabled:opacity-20 disabled:cursor-not-allowed",
        active 
          ? "text-primary" 
          : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50"
      )}
    >
      <Icon size={20} strokeWidth={active ? 2.5 : 2} className="transition-transform group-hover:scale-110" />
      {active && (
        <div className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-primary rounded-r-full shadow-[0_0_8px_rgba(124,58,237,0.5)]" />
      )}
    </button>
  );
}

export function ActivityRail() {
  const {
    activeRail,
    setActiveRail,
    sidebarOpen,
    toggleSidebar,
    setSettingsModalOpen,
  } = useWorkbenchStore();

  return (
    <nav className="relative z-[45] isolate w-12 border-r bg-white flex flex-col items-center shrink-0 select-none shadow-[1px_0_0_rgba(0,0,0,0.02)]">
      <div className="flex flex-col flex-1 w-full items-center">
        <RailItem 
          icon={FileText} 
          label="Project" 
          active={activeRail === "explorer" && sidebarOpen}
          onClick={() => setActiveRail("explorer")}
        />
        <RailItem 
          icon={SearchIcon} 
          label="Search" 
          active={activeRail === "search" && sidebarOpen}
          onClick={() => setActiveRail("search")}
        />
        <RailItem 
          icon={GitBranch} 
          label="Source Control" 
          disabled
          onClick={() => {}}
        />
        <RailItem 
          icon={History} 
          label="History" 
          disabled
          onClick={() => {}}
        />
      </div>

      <div className="relative z-[1] flex flex-col w-full items-center pb-4">
        <RailItem 
          icon={LayoutGrid} 
          label="Tools" 
          disabled
          onClick={() => {}}
        />
        <RailItem 
          icon={Settings} 
          label="Settings" 
          active={false}
          onClick={() => setSettingsModalOpen(true)}
        />
        <div className="w-8 h-px bg-zinc-100 my-2" />
        <button
          type="button"
          onClick={toggleSidebar}
          className="size-10 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-900 hover:bg-zinc-50 transition-all active:scale-95"
        >
          <Menu size={20} />
        </button>
      </div>
    </nav>
  );
}
