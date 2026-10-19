"use client";

import { useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Files, X } from "lucide-react";
import { BuildRecoveryDialog } from "./BuildRecoveryDialog";
import { AppHeader } from "./AppHeader";
import { ActivityRail } from "./ActivityRail";
import { ActionToolbar } from "./ActionToolbar";
import { ProjectSidebar } from "./ProjectSidebar";
import { EditorPane } from "./EditorPane";
import { PdfPreviewPane } from "./PdfPreviewPane";
import { BottomUtilityPanel } from "./BottomUtilityPanel";
import { useWorkbenchStore } from "@/stores/workbenchStore";

export function LatexEditorApp() {
  const { sidebarOpen, toggleSidebar, bottomPanelOpen, buildStatus, diagnostics, buildLog, activeFileId } = useWorkbenchStore();
  const [view, setView] = useState<"source" | "pdf">("source");
  const [filesOpen, setFilesOpen] = useState(false);
  const showBottomPanel = bottomPanelOpen && (buildStatus !== "idle" || diagnostics.length > 0 || Boolean(buildLog));

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const resetDrawer = () => setFilesOpen(false);
    query.addEventListener("change", resetDrawer);
    return () => query.removeEventListener("change", resetDrawer);
  }, []);
  useEffect(() => { setFilesOpen(false); setView("source"); }, [activeFileId]);
  useEffect(() => {
    if (!filesOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setFilesOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [filesOpen]);

  return (
    <div className="latex-workbench flex h-[100dvh] min-w-0 flex-col overflow-hidden bg-background text-foreground font-sans antialiased" data-view={view} data-sidebar-open={sidebarOpen} data-files-open={filesOpen}>
      <BuildRecoveryDialog />
      <AppHeader />
      <ActionToolbar />
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-3 lg:hidden">
        <button type="button" aria-expanded={filesOpen} onClick={() => setFilesOpen(!filesOpen)} className="inline-flex h-8 items-center gap-2 rounded px-2 text-xs font-medium hover:bg-muted"><Files size={15} /> Files</button>
        <div className="flex items-center gap-1 rounded-md bg-muted p-0.5" role="group" aria-label="Editor view">
          <button type="button" aria-pressed={view === "source"} onClick={() => setView("source")} className="rounded px-3 py-1 text-xs font-medium aria-pressed:bg-primary/10 aria-pressed:text-primary">Source</button>
          <button type="button" aria-pressed={view === "pdf"} onClick={() => setView("pdf")} className="rounded px-3 py-1 text-xs font-medium aria-pressed:bg-primary/10 aria-pressed:text-primary">PDF</button>
        </div>
      </div>
      <PanelGroup direction="vertical" className="min-h-0 flex-1">
        <Panel minSize={50} className="min-h-0">
          <main className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
            <ActivityRail onOpenSidebar={() => setFilesOpen(true)} onToggleSidebar={() => {
              if (window.matchMedia("(min-width: 1024px)").matches) toggleSidebar();
              else setFilesOpen((open) => !open);
            }} />
            {filesOpen && <button type="button" aria-label="Close file browser" onClick={() => setFilesOpen(false)} className="absolute inset-0 z-40 bg-black/25 lg:hidden" />}
            <div className="workbench-sidebar min-h-0 overflow-hidden border-r border-border bg-background" data-testid="workbench-sidebar">
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 lg:hidden">
                <span className="text-xs font-semibold">Project files</span>
                <button type="button" aria-label="Close project files" onClick={() => setFilesOpen(false)} className="rounded p-1.5 hover:bg-muted"><X size={15} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden"><ProjectSidebar /></div>
            </div>
            <PanelGroup direction="horizontal" className="min-w-0 flex-1">
              <Panel defaultSize={58} minSize={35} className="workbench-source-panel min-w-0" data-testid="source-panel"><EditorPane /></Panel>
              <PanelResizeHandle className="workbench-preview-divider w-1 shrink-0 bg-border transition-colors hover:bg-primary/30" aria-label="Resize source and PDF panes" />
              <Panel defaultSize={42} minSize={28} className="workbench-pdf-panel min-w-0" data-testid="pdf-panel"><PdfPreviewPane /></Panel>
            </PanelGroup>
          </main>
        </Panel>
        {showBottomPanel && <>
          <PanelResizeHandle className="h-1 bg-border hover:bg-primary/30" aria-label="Resize build panel" />
          <Panel defaultSize={24} minSize={15} maxSize={45}><BottomUtilityPanel /></Panel>
        </>}
      </PanelGroup>
    </div>
  );
}
