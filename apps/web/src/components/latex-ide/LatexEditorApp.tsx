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
                  <Panel defaultSize={20} minSize={15} maxSize={35} className="z-20">
                    <ProjectSidebar />
                  </Panel>
                  <PanelResizeHandle className="w-[2px] bg-zinc-100 hover:bg-primary/20 transition-all relative z-30 cursor-col-resize active:bg-primary/40" />
                </>
              )}

              <Panel className="flex flex-col min-w-0 bg-white">
                <PanelGroup direction="horizontal">
                  <Panel minSize={30} className="bg-white flex flex-col">
                    <EditorPane />
                  </Panel>

                  <PanelResizeHandle className="w-[2px] bg-zinc-100 hover:bg-primary/20 transition-all relative z-30 cursor-col-resize active:bg-primary/40" />

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
            <PanelResizeHandle className="h-[2px] bg-zinc-100 hover:bg-primary/20 transition-all cursor-row-resize active:bg-primary/40" />
            <Panel defaultSize={32} minSize={15} maxSize={50}>
              <BottomUtilityPanel />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
