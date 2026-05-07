"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { Settings, HelpCircle, Menu, FileText, Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ActivityRail() {
  const {
    activeRail,
    setActiveRail,
    sidebarOpen,
    toggleSidebar,
    setSettingsModalOpen,
    setKeyboardShortcutsModalOpen,
  } = useWorkbenchStore();

  const items = [
    { id: "explorer", icon: FileText, label: "Project" },
    { id: "search", icon: SearchIcon, label: "Search" },
  ] as const;

  return (
    <nav className="relative z-[45] isolate w-10 border-r bg-background flex flex-col items-center py-2 shrink-0 select-none">
      <div className="flex flex-col gap-1 flex-1 w-full items-center">
        {items.map((item) => {
          const isActive = activeRail === item.id && sidebarOpen;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => setActiveRail(item.id)}
              className={cn(
                "w-8 h-8 rounded flex items-center justify-center transition-all group relative",
                isActive 
                  ? "bg-muted text-foreground" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <item.icon size={18} strokeWidth={2} />
              {isActive && (
                <div className="absolute left-0 w-0.5 h-4 bg-primary rounded-r" />
              )}
            </button>
          );
        })}
      </div>

      <div className="relative z-[1] flex flex-col gap-1 w-full items-center pb-2">
        <button
          type="button"
          title="Keyboard shortcuts"
          onClick={() => setKeyboardShortcutsModalOpen(true)}
          className="size-8 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <HelpCircle size={18} />
        </button>
        <button
          type="button"
          title="Settings"
          onClick={() => setSettingsModalOpen(true)}
          className="size-8 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <Settings size={18} />
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          className="size-8 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <Menu size={18} />
        </button>
      </div>
    </nav>
  );
}
