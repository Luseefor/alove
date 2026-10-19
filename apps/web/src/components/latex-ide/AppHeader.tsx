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
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-30",
        className
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
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
    setBuildRecoveryOpen,
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
    <header className="z-[60] w-full min-w-0 shrink-0 select-none border-b border-border bg-background text-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-2 sm:px-4 md:h-14 md:flex-nowrap md:py-0">
      <div className="order-1 flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
        {/* Logo */}
        <div className="flex items-center gap-2 border-r border-border pr-2 sm:pr-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="font-bold text-lg tracking-tight">a</span>
          </div>
          <span className="hidden whitespace-nowrap text-xl font-bold tracking-tight text-primary sm:inline">alove</span>
        </div>

        {/* Global Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton 
            icon={Save} 
            title="Save (Ctrl+S)" 
            onClick={saveActiveFile} 
            disabled={!hasDirty && !activeFileId} 
            className={hasDirty ? "text-primary hover:bg-primary/90 hover:text-primary-foreground" : ""}
          />
          <div className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
          <div className="hidden items-center gap-1 sm:flex">
            <IconButton icon={Undo2} title="Undo" onClick={() => requestEditorCommand("undo")} />
            <IconButton icon={Redo2} title="Redo" onClick={() => requestEditorCommand("redo")} />
          </div>
        </div>
      </div>

      {/* Project Title & State */}
      <div className="order-3 flex min-w-0 basis-full items-center justify-start md:order-2 md:flex-1 md:justify-center md:px-1">
        <div className="flex min-w-0 max-w-full flex-col items-start md:items-center">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <span title={projectTitle} className="min-w-0 max-w-full truncate text-[14px] font-bold tracking-tight text-foreground">{projectTitle}</span>
            <div aria-hidden="true" className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              hasUnsaved ? "bg-warning animate-pulse" : "bg-success"
            )} />
          </div>
          <div className="mt-0.5 flex min-w-0 max-w-full items-center gap-1.5">
            <span className={cn(
              "max-w-full truncate whitespace-nowrap text-[9px] font-black uppercase tracking-[0.1em]",
              hasUnsaved ? "text-warning" : "text-success"
            )}>
              {saveStatus === "error" ? "Save failed" : saveStatus === "conflict" ? "Save conflict" : saveStatus === "loading" ? "Opening…" : saveStatus === "saving" ? "Saving…" : hasDirty || saveStatus === "unsaved" ? "Unsaved Changes" : "Project Saved"}
            </span>
          </div>
        </div>
      </div>

      {/* Right Actions */}
      <div className="order-2 ml-auto flex shrink-0 items-center gap-1 sm:gap-2 md:order-3 md:ml-0">
        <div className="flex shrink-0 items-center gap-1">
           <IconButton icon={Settings} title="Settings" onClick={() => setSettingsModalOpen(true)} />
        </div>

        <div className="mr-1 flex items-center gap-1 border-r border-border pr-2 sm:mr-2 sm:gap-2 sm:pr-3">
          {!localMode && (
            <Button
              variant="outline"
              size="sm"
              aria-label="Share"
              title="Share"
              className="h-9 shrink-0 gap-2 whitespace-nowrap rounded-md px-2 font-bold sm:px-4"
            >
              <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">Share</span>
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label="Export"
                title="Export"
                className="h-9 shrink-0 gap-2 whitespace-nowrap rounded-md px-2 font-bold sm:px-4"
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden min-[525px]:inline">Export</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-md border-border bg-background p-2">
              <DropdownMenuItem 
                disabled={!pdfDataUrl}
                className="rounded-md font-semibold text-xs gap-3 p-2.5 cursor-pointer"
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
              <DropdownMenuItem onSelect={exportSource} className="rounded-md font-semibold text-xs gap-3 p-2.5 cursor-pointer">
                <FileText className="w-4 h-4 text-muted-foreground" />
                Download Source (.alove.json)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setBuildRecoveryOpen(true)} className="rounded-md font-semibold text-xs p-2.5 cursor-pointer">Build recovery</DropdownMenuItem>
              {localMode && <DropdownMenuItem onSelect={() => importInput.current?.click()} className="rounded-md font-semibold text-xs p-2.5 cursor-pointer">Import Source as New Project</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="primary"
            size="sm"
            data-testid="compile-button"
            onClick={() => void runCompile()}
            disabled={buildStatus === "running" || buildStatus === "queued"}
            className="h-9 shrink-0 gap-2 whitespace-nowrap rounded-md px-3 font-bold sm:px-5"
          >
            <Play className={cn("h-4 w-4 shrink-0 fill-current", buildStatus === "running" && "animate-pulse")} aria-hidden="true" />
            <span className="whitespace-nowrap">{buildStatus === "running" ? "Building..." : "Build"}</span>
          </Button>
        </div>
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
