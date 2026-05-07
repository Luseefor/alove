"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { LatexEditorApp } from "./latex-ide";
import { isLocalStandalone } from "@/lib/localStandalone";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEMO_FILES } from "@/demo/demoProject";

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
        if ("version" in result) return { version: result.version };
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
  const initializeProject = useWorkbenchStore((s) => s.initializeProject);
  const setPersistenceHandlers = useWorkbenchStore((s) => s.setPersistenceHandlers);

  useEffect(() => {
    initializeProject({
      projectId: null,
      title: "Deep Learning Survey",
      files: DEMO_FILES.filter((f) => f.type !== "folder").map((f) => ({
        path: f.path,
        content: f.content ?? "",
      })),
    });
    setPersistenceHandlers({});
  }, [initializeProject, setPersistenceHandlers]);

  return <LatexEditorApp />;
}

export function EditorWorkbench() {
  if (isLocalStandalone()) return <EditorWorkbenchLocal />;
  return <EditorWorkbenchConvex />;
}
