"use client";

import { useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Files, X } from "lucide-react";
import { getEditorMode } from "@/lib/editorMode";
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
  const {
    sidebarOpen,
    toggleSidebar,
    bottomPanelOpen,
    buildStatus,
    diagnostics,
    buildLog,
    activeFileId,
  } = useWorkbenchStore();
  const [mode, setMode] = useState<"source" | "visual" | "proof">("proof");
  const [presentation, setPresentation] = useState<"source" | "visual">(
    "source",
  );
  const visualSupported =
    getEditorMode() === "codemirror" &&
    !!activeFileId?.toLowerCase().endsWith(".tex");
  const requestSource = () => {
    setMode("source");
    setPresentation("source");
    setView("source");
  };
  const [view, setView] = useState<"source" | "pdf">("source");
  const [filesOpen, setFilesOpen] = useState(false);
  const filesButtonRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const showBottomPanel =
    bottomPanelOpen &&
    (buildStatus !== "idle" || diagnostics.length > 0 || Boolean(buildLog));

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const resetDrawer = () => setFilesOpen(false);
    query.addEventListener("change", resetDrawer);
    return () => query.removeEventListener("change", resetDrawer);
  }, []);
  useEffect(() => {
    setFilesOpen(false);
    setView("source");
    if (!visualSupported) {
      setMode((mode) => (mode === "visual" ? "source" : mode));
      setPresentation("source");
    }
  }, [activeFileId, visualSupported]);
  // Pending targets may be consumed by the child before a parent render.
  useEffect(
    () =>
      useWorkbenchStore.subscribe((state, previous) => {
        if (
          state.pdfHighlight &&
          state.pdfHighlight !== previous.pdfHighlight
        ) {
          setMode("proof");
          setView("pdf");
          setFilesOpen(false);
        } else if (
          (state.nextSelection &&
            state.nextSelection !== previous.nextSelection) ||
          (state.focusedLine !== null &&
            state.focusedLine !== previous.focusedLine)
        ) {
          setView("source");
          setFilesOpen(false);
        }
      }),
    [],
  );
  // While the narrow drawer is open, keep Tab cycling inside it and let
  // Escape close it. Radix dialogs/menus portal directly to the body (no
  // wrapper marker), so detect open overlays by role + open state and stand
  // down while one owns focus. A defaultPrevented guard covers keys Radix
  // already handled, since its document listeners run before this one.
  useEffect(() => {
    if (!filesOpen) return;
    const overlayOpen = () =>
      Boolean(
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
        ),
      );
    const focusInOutsideOverlay = () => {
      const root = document.getElementById("workbench-sidebar");
      const overlay = document.activeElement?.closest?.(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      );
      return Boolean(overlay && root && !root.contains(overlay));
    };
    const trap = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (overlayOpen() || focusInOutsideOverlay()) return;
        setFilesOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      if (overlayOpen() || focusInOutsideOverlay()) return;
      const root = document.getElementById("workbench-sidebar");
      if (!root) return;
      const focusables = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.getClientRects().length > 0);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !root.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => window.removeEventListener("keydown", trap);
  }, [filesOpen]);
  // Move keyboard focus into the drawer when it opens and return focus to
  // the Files toggle when it closes, so keyboard and screen-reader users do
  // not lose their place behind the scrim.
  const filesOpenRef = useRef(filesOpen);
  useEffect(() => {
    if (filesOpen && !filesOpenRef.current) {
      requestAnimationFrame(() => drawerCloseRef.current?.focus());
    } else if (!filesOpen && filesOpenRef.current) {
      filesButtonRef.current?.focus();
    }
    filesOpenRef.current = filesOpen;
  }, [filesOpen]);

  return (
    <div
      className="latex-workbench flex h-[100dvh] min-w-0 flex-col overflow-hidden bg-background text-foreground font-sans antialiased"
      data-mode={mode}
      data-view={view}
      data-sidebar-open={sidebarOpen}
      data-files-open={filesOpen}
    >
      <BuildRecoveryDialog />
      <AppHeader />
      {presentation !== "visual" && <ActionToolbar />}
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-3">
        <button
          ref={filesButtonRef}
          type="button"
          aria-expanded={filesOpen}
          aria-controls="workbench-sidebar"
          onClick={() => setFilesOpen(!filesOpen)}
          className="inline-flex h-8 items-center gap-2 rounded px-2 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <Files aria-hidden="true" size={15} /> Files
        </button>
        <div
          className="flex items-center gap-1 rounded-md bg-muted p-0.5"
          role="group"
          aria-label="Writing mode"
        >
          <button
            type="button"
            aria-pressed={mode === "source" && view === "source"}
            aria-controls="source-panel"
            onClick={requestSource}
            className="rounded px-3 py-1 text-xs font-medium aria-pressed:bg-primary/10 aria-pressed:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Source
          </button>
          <button
            type="button"
            aria-pressed={mode === "visual" && view === "source"}
            aria-controls="source-panel"
            disabled={!visualSupported}
            title={
              !visualSupported
                ? "Visual writing requires a .tex file and CodeMirror"
                : "Visual writing"
            }
            onClick={() => {
              setMode("visual");
              setPresentation("visual");
              setView("source");
              if (
                window.matchMedia("(min-width: 1024px)").matches &&
                sidebarOpen
              )
                toggleSidebar();
            }}
            className="rounded px-3 py-1 text-xs font-medium aria-pressed:bg-primary/10 aria-pressed:text-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Visual
          </button>
          <button
            type="button"
            aria-pressed={mode === "proof"}
            aria-controls="source-panel pdf-panel"
            onClick={() => {
              setMode("proof");
              setView("pdf");
            }}
            className="rounded px-3 py-1 text-xs font-medium aria-pressed:bg-primary/10 aria-pressed:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Proof
          </button>
          <button
            type="button"
            aria-pressed={view === "pdf"}
            aria-controls="pdf-panel"
            onClick={() => {
              setMode("proof");
              setView("pdf");
            }}
            className="lg:hidden rounded px-3 py-1 text-xs font-medium aria-pressed:bg-primary/10 aria-pressed:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            PDF
          </button>
        </div>
      </div>
      <PanelGroup direction="vertical" className="min-h-0 flex-1">
        <Panel minSize={50} className="min-h-0">
          <main className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
            <ActivityRail
              drawerOpen={filesOpen}
              onOpenSidebar={() => setFilesOpen(true)}
              onToggleSidebar={() => {
                if (window.matchMedia("(min-width: 1024px)").matches)
                  toggleSidebar();
                else setFilesOpen((open) => !open);
              }}
            />
            {filesOpen && (
              <button
                type="button"
                aria-label="Close file browser"
                onClick={() => setFilesOpen(false)}
                className="absolute inset-0 z-40 bg-black/25 lg:hidden"
              />
            )}
            <div
              className="workbench-sidebar min-h-0 overflow-hidden border-r border-border bg-background"
              id="workbench-sidebar"
              data-testid="workbench-sidebar"
              role={filesOpen ? "dialog" : undefined}
              aria-modal={filesOpen ? true : undefined}
              aria-label={filesOpen ? "Project files" : undefined}
            >
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 lg:hidden">
                <span
                  id="workbench-sidebar-label"
                  className="text-xs font-semibold"
                >
                  Project files
                </span>
                <button
                  ref={drawerCloseRef}
                  type="button"
                  aria-label="Close project files"
                  onClick={() => setFilesOpen(false)}
                  className="rounded p-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden="true" size={15} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ProjectSidebar />
              </div>
            </div>
            <PanelGroup direction="horizontal" className="min-w-0 flex-1">
              <Panel
                defaultSize={58}
                minSize={35}
                className="workbench-source-panel min-w-0"
                data-testid="source-panel"
                id="source-panel"
              >
                <EditorPane
                  presentation={presentation}
                  onRequestSource={requestSource}
                />
              </Panel>
              <PanelResizeHandle
                className="workbench-preview-divider w-1 shrink-0 bg-border transition-colors hover:bg-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
                aria-label="Resize source and PDF panes"
              />
              <Panel
                defaultSize={42}
                minSize={28}
                className="workbench-pdf-panel min-w-0"
                data-testid="pdf-panel"
                id="pdf-panel"
              >
                <PdfPreviewPane />
              </Panel>
            </PanelGroup>
          </main>
        </Panel>
        {showBottomPanel && (
          <>
            <PanelResizeHandle
              className="h-1 bg-border hover:bg-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
              aria-label="Resize build panel"
            />
            <Panel defaultSize={24} minSize={15} maxSize={45}>
              <BottomUtilityPanel />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
