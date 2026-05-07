"use client";

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { AppHeader } from "./AppHeader";
import { ActivityRail } from "./ActivityRail";
import { ActionToolbar } from "./ActionToolbar";
import { ProjectSidebar } from "./ProjectSidebar";
import { EditorPane } from "./EditorPane";
import { PdfPreviewPane } from "./PdfPreviewPane";
import { BottomUtilityPanel } from "./BottomUtilityPanel";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { cn } from "@/lib/utils";

export function LatexEditorApp() {
  const { sidebarOpen, bottomPanelOpen } = useWorkbenchStore();

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground overflow-hidden font-sans antialiased selection:bg-primary/20">
      <AppHeader />
      <ActionToolbar />
      <PanelGroup direction="vertical" className="flex-1">
        <Panel className="min-h-0">
          <main className="flex h-full min-h-0 relative">
            <ActivityRail />

            <PanelGroup direction="horizontal" className="flex-1">
              {sidebarOpen && (
                <>
                  <Panel defaultSize={18} minSize={12} maxSize={30} className="z-20">
                    <ProjectSidebar />
                  </Panel>
                  <PanelResizeHandle className="w-[1px] bg-border hover:bg-primary/40 transition-colors relative z-30 cursor-col-resize" />
                </>
              )}

              <Panel className="flex flex-col min-w-0">
                <PanelGroup direction="horizontal">
                  <Panel minSize={30} className="bg-background flex flex-col">
                    <EditorPane />
                  </Panel>

                  <PanelResizeHandle className="w-[1px] bg-border hover:bg-primary/40 transition-colors relative z-30 cursor-col-resize" />

                  <Panel defaultSize={45} minSize={20} className="z-10">
                    <PdfPreviewPane />
                  </Panel>
                </PanelGroup>
              </Panel>
            </PanelGroup>
          </main>
        </Panel>
        {bottomPanelOpen && (
          <>
            <PanelResizeHandle className="h-[1px] bg-border hover:bg-primary/40 transition-colors cursor-row-resize" />
            <Panel defaultSize={24} minSize={14} maxSize={45}>
              <BottomUtilityPanel />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
