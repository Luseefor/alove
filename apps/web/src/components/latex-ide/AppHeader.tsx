"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import {
  ChevronDown,
  Play,
  Settings,
  Save,
  Undo2,
  Redo2,
  FileText,
  Share2,
  Download,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IdeSettingsDialog } from "./IdeSettingsDialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { isLocalStandalone } from "@/lib/localStandalone";

function IconButton({ icon: Icon, title, onClick, disabled, className }: { icon: LucideIcon, title?: string, onClick?: () => void, disabled?: boolean, className?: string }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed",
        className
      )}
    >
      <Icon className="w-[18px] h-[18px]" />
    </button>
  );
}

export function AppHeader() {
  const {
    projectTitle,
    runCompile,
    buildStatus,
    saveActiveFile,
    requestEditorCommand,
    dirtyByPath,
    settingsModalOpen,
    setSettingsModalOpen,
    activeFileId,
    pdfDataUrl,
  } = useWorkbenchStore();
  
  const hasDirty = useMemo(() => Object.values(dirtyByPath).some(Boolean), [dirtyByPath]);
  const localMode = isLocalStandalone();

  return (
    <header className="h-14 border-b bg-white flex items-center justify-between px-4 shrink-0 z-[60] select-none shadow-sm">
      <div className="flex items-center gap-6">
        {/* Logo */}
        <div className="flex items-center gap-2 pr-6 border-r border-zinc-100">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white shadow-lg shadow-primary/20">
            <span className="font-bold text-lg tracking-tight">a</span>
          </div>
          <span className="text-xl font-bold tracking-tight text-primary">alove</span>
        </div>

        {/* Global Actions */}
        <div className="flex items-center gap-1">
          <IconButton 
            icon={Save} 
            title="Save (Ctrl+S)" 
            onClick={saveActiveFile} 
            disabled={!hasDirty && !activeFileId} 
            className={hasDirty ? "text-primary hover:text-primary-foreground hover:bg-primary/90" : ""}
          />
          <div className="w-px h-4 bg-zinc-100 mx-2" />
          <IconButton icon={Undo2} title="Undo" onClick={() => requestEditorCommand("undo")} />
          <IconButton icon={Redo2} title="Redo" onClick={() => requestEditorCommand("redo")} />
        </div>
      </div>

      {/* Project Title & State */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold text-zinc-900 tracking-tight">{projectTitle}</span>
            <div className={cn(
              "w-2 h-2 rounded-full",
              hasDirty ? "bg-warning animate-pulse" : "bg-success shadow-[0_0_8px_rgba(16,185,129,0.4)]"
            )} />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn(
              "text-[9px] font-black uppercase tracking-[0.1em]",
              hasDirty ? "text-warning" : "text-success"
            )}>
              {hasDirty ? "Unsaved Changes" : "Project Saved"}
            </span>
          </div>
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 mr-2">
           <IconButton icon={Settings} title="Settings" onClick={() => setSettingsModalOpen(true)} />
        </div>

        <div className="flex items-center gap-2 pr-4 border-r border-zinc-100 mr-4">
          {!localMode && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-9 px-4 rounded-xl font-bold gap-2 text-zinc-600 border-zinc-200 hover:bg-zinc-50"
            >
              <Share2 className="w-4 h-4" />
              Share
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-9 px-4 rounded-xl font-bold gap-2 text-zinc-600 border-zinc-200 hover:bg-zinc-50"
              >
                <Download className="w-4 h-4" />
                Export
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl p-2 shadow-xl border-zinc-100">
              <DropdownMenuItem 
                disabled={!pdfDataUrl}
                className="rounded-lg font-semibold text-xs gap-3 p-2.5 cursor-pointer"
                onSelect={() => {
                   if (pdfDataUrl) {
                      const a = document.createElement("a");
                      a.href = pdfDataUrl;
                      a.download = `${projectTitle.toLowerCase().replace(/\s+/g, '-')}.pdf`;
                      a.click();
                   }
                }}
              >
                <FileText className="w-4 h-4 text-primary" />
                Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="rounded-lg font-semibold text-xs gap-3 p-2.5">
                <FileText className="w-4 h-4 text-zinc-400" />
                Download Source (.zip)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button 
            variant="primary" 
            size="sm" 
            onClick={() => void runCompile()}
            disabled={buildStatus === "running"}
            className="h-9 px-5 rounded-xl font-bold gap-2 shadow-lg shadow-primary/20 hover:scale-[1.02] transition-transform active:scale-95"
          >
            <Play className={cn("w-4 h-4 fill-current", buildStatus === "running" && "animate-pulse")} />
            {buildStatus === "running" ? "Building..." : "Build"}
          </Button>
        </div>

        <div className="flex items-center gap-2 bg-zinc-50 p-1 rounded-full pl-1.5 pr-3 hover:bg-zinc-100 transition-colors cursor-pointer group active:scale-95 border border-zinc-200/50">
          <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center text-white font-bold text-[11px] shadow-sm group-hover:scale-105 transition-transform">
            A
          </div>
          <span className="text-[12px] font-bold text-zinc-700">A. Love</span>
        </div>
      </div>

      <IdeSettingsDialog open={settingsModalOpen} onOpenChange={setSettingsModalOpen} />
    </header>
  );
}
