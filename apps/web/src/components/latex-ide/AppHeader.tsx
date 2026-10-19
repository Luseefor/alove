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
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { serializeWorkspaceSource, parseWorkspaceSource } from "@/lib/workspaceArchive";
import { createLocalWorkspaceRepository } from "@/lib/localWorkspace";
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
    saveStatus,
    saveMessage,
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
  const hasUnsaved = hasDirty || saveStatus !== "saved";
  const localMode = isLocalStandalone();
  const router = useRouter();
  const importInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const exportSource = () => {
    const state = useWorkbenchStore.getState();
    const source = serializeWorkspaceSource({ title: state.projectTitle, files: state.filesByPath, mainFile: state.mainFile });
    const url = URL.createObjectURL(new Blob([source], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.projectTitle.replace(/[^a-z0-9_-]+/gi, "-") || "project"}.alove.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importSource = async (file?: File) => {
    if (!file) return;
    setImportError(null);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("Archive too large (maximum 20 MB).");
      const source = parseWorkspaceSource(await file.text());
      const id = `local-${crypto.randomUUID()}`;
      const mainFile = source.mainFile ?? Object.keys(source.files).find((path) => path.endsWith(".tex")) ?? null;
      const activeFile = mainFile ?? Object.keys(source.files)[0] ?? null;
      await createLocalWorkspaceRepository().save({ ...source, id, mainFile, activeFile, openFiles: activeFile ? [activeFile] : [] }, 0);
      router.push(`/editor?project=${encodeURIComponent(id)}`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import project. Your current project is unchanged.");
    }
  };

  return (
    <>
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
              hasUnsaved ? "bg-warning animate-pulse" : "bg-success shadow-[0_0_8px_rgba(16,185,129,0.4)]"
            )} />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn(
              "text-[9px] font-black uppercase tracking-[0.1em]",
              hasUnsaved ? "text-warning" : "text-success"
            )}>
              {saveStatus === "error" ? "Save failed" : saveStatus === "conflict" ? "Save conflict" : saveStatus === "loading" ? "Opening…" : saveStatus === "saving" ? "Saving…" : hasDirty || saveStatus === "unsaved" ? "Unsaved Changes" : "Project Saved"}
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
              <DropdownMenuItem onSelect={exportSource} className="rounded-lg font-semibold text-xs gap-3 p-2.5 cursor-pointer">
                <FileText className="w-4 h-4 text-zinc-400" />
                Download Source (.alove.json)
              </DropdownMenuItem>
              {localMode && <DropdownMenuItem onSelect={() => importInput.current?.click()} className="rounded-lg font-semibold text-xs p-2.5 cursor-pointer">Import Source as New Project</DropdownMenuItem>}
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
      </div>

      <IdeSettingsDialog open={settingsModalOpen} onOpenChange={setSettingsModalOpen} />
    </header>
    <input ref={importInput} className="hidden" type="file" accept=".json,.alove.json,application/json" aria-label="Import project source" onChange={(event) => { void importSource(event.target.files?.[0]); event.target.value = ""; }} />
    {importError && <div role="alert" className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-950">{importError}</div>}
    {saveMessage && (
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
        <span className="flex-1">{saveMessage}</span>
        {saveStatus === "error" && <button className="underline" onClick={() => void saveActiveFile()}>Retry save</button>}
        <button className="underline" onClick={exportSource}>Export source</button>
        <button className="underline" onClick={() => window.location.reload()}>Reload workspace</button>
      </div>
    )}
    </>
  );
}
