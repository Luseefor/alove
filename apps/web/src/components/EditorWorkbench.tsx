"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { LatexEditorApp } from "./latex-ide";
import { isLocalStandalone } from "@/lib/localStandalone";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEMO_FILES } from "@/demo/demoProject";
import { useRouter, useSearchParams } from "next/navigation";
import { createLocalWorkspaceRepository } from "@/lib/localWorkspace";
import { createLocalWorkspaceSession } from "@/lib/localWorkspaceSession";

function EditorWorkbenchConvex() {
  useUser();
  const ensureDefault = useMutation(api.projects.ensureDefault);
  const saveFile = useMutation(api.files.save);
  const deleteFile = useMutation(api.files.deleteFile);
  const renameFileMutation = useMutation(api.files.renameFile);
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);

  const initializeProject = useWorkbenchStore((s) => s.initializeProject);
  const setPersistenceHandlers = useWorkbenchStore((s) => s.setPersistenceHandlers);
  
  useEffect(() => {
    void ensureDefault().then(setProjectId);
  }, [ensureDefault]);

  const rows = useQuery(
    api.files.list,
    projectId ? { projectId } : "skip",
  );
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId } : "skip",
  );

  useEffect(() => {
    if (rows) {
      initializeProject({
        projectId: projectId ?? null,
        title: project?.name,
        files: rows.map((r) => ({
          path: r.path,
          content: r.content,
          version: r.version,
        })),
      });
    }
  }, [rows, projectId, project?.name, initializeProject]);

  useEffect(() => {
    if (!projectId) return;
    setPersistenceHandlers({
      save: async (path, content, expectedVersion) => {
        const result = await saveFile({
          projectId,
          path,
          content,
          expectedVersion,
        });
        return result;
      },
      delete: async (path) => {
        await deleteFile({ projectId, path });
      },
      rename: async (oldPath, newPath) => {
        await renameFileMutation({ projectId, oldPath, newPath });
      },
    });
  }, [projectId, saveFile, deleteFile, renameFileMutation, setPersistenceHandlers]);

  return <LatexEditorApp />;
}

function EditorWorkbenchLocal() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedId = searchParams.get("project");
  const isNew = searchParams.get("new") === "true";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (isNew && !requestedId) {
      // Give every new project its own durable URL before initializing it.
      router.replace(`/editor?new=true&project=local-${crypto.randomUUID()}`);
      return;
    }
    const id = requestedId || "local";
    const files = isNew
      ? { "main.tex": "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n" }
      : Object.fromEntries(DEMO_FILES.filter((f) => f.type !== "folder").map((f) => [f.path, f.content ?? ""]));
    const session = createLocalWorkspaceSession({
      store: useWorkbenchStore,
      repository: createLocalWorkspaceRepository(),
      seed: { id, title: isNew ? "Untitled Project" : "Quantum Entanglement Review", files, mainFile: "main.tex", activeFile: "main.tex", openFiles: ["main.tex"] },
    });
    let active = true;
    void session.ready.then(() => { if (active) setReady(true); });
    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      if (useWorkbenchStore.getState().saveStatus !== "saved") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warnIfUnsaved);
    return () => {
      active = false;
      window.removeEventListener("beforeunload", warnIfUnsaved);
      session.dispose();
    };
  }, [requestedId, isNew, router]);

  return ready ? <LatexEditorApp /> : <div role="status" className="flex h-[100dvh] items-center justify-center">Opening workspace…</div>;
}

export function EditorWorkbench() {
  const searchParams = useSearchParams();
  const setSettingsModalOpen = useWorkbenchStore((s) => s.setSettingsModalOpen);
  const settingsHandledRef = useRef(false);
  const shouldOpenSettings = searchParams.get("settings") === "true";

  useEffect(() => {
    if (!shouldOpenSettings || settingsHandledRef.current) return;
    setSettingsModalOpen(true);
    settingsHandledRef.current = true;
  }, [shouldOpenSettings, setSettingsModalOpen]);

  return (
    <Suspense fallback={<div className="flex h-[100dvh] items-center justify-center text-zinc-500 font-medium">Loading editor...</div>}>
      {isLocalStandalone() ? <EditorWorkbenchLocal /> : <EditorWorkbenchConvex />}
    </Suspense>
  );
}
