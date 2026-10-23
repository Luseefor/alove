"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ProjectToolsProvider } from "./latex-ide/ProjectToolsContext";
import { GitHubSyncDialog } from "./latex-ide/GitHubSyncDialog";
import { CloudProjectTools } from "./latex-ide/CloudProjectTools";
import { CloudDraftRecovery } from "./CloudDraftRecovery";
import { LatexEditorApp } from "./latex-ide";
import { isLocalStandalone } from "@/lib/localStandalone";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEMO_FILES } from "@/demo/demoProject";
import { useRouter, useSearchParams } from "next/navigation";
import { createLocalWorkspaceRepository } from "@/lib/localWorkspace";
import { TEMPLATES, type TemplateId } from "@/lib/templates";
import { serializeWorkspaceSource } from "@/lib/workspaceArchive";
import { prepareSourceReplacement } from "@/lib/prepareSourceReplacement";
import { createLocalWorkspaceSession } from "@/lib/localWorkspaceSession";

function EditorWorkbenchConvex() {
  const { user } = useUser();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryString = searchParams.toString();
  const requestedId = searchParams.get("project");
  const createProject = useMutation(api.projects.create);
  const creation = useRef<{
    key: string;
    promise: Promise<Id<"projects">>;
  } | null>(null);
  const [openError, setOpenError] = useState("");
  const ensureDefault = useMutation(api.projects.ensureDefault);
  const renameProject = useMutation(api.projects.rename);
  const persistMainFile = useMutation(api.projects.setMainFile);
  const saveFile = useMutation(api.files.save);
  const checkpointSource = useMutation(api.sourceHistory.checkpoint);
  const deleteFile = useMutation(api.files.deleteFile);
  const renameFileMutation = useMutation(api.files.renameFile);
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);

  const mergeRemoteProject = useWorkbenchStore((s) => s.mergeRemoteProject);
  const setPersistenceHandlers = useWorkbenchStore(
    (s) => s.setPersistenceHandlers,
  );

  useEffect(() => {
    let active = true;
    if (!isAuthenticated) return;
    setOpenError("");
    if (requestedId) {
      setProjectId(requestedId as Id<"projects">);
      creation.current = null;
      return;
    }
    const params = new URLSearchParams(queryString);
    const template = params.get("template");
    const kind =
      params.get("new") === "true"
        ? "blank"
        : params.get("sample") === "true"
          ? "sample"
          : template === "minimal" || template === "bib"
            ? template
            : null;
    const request = kind
      ? creation.current?.key === queryString
        ? creation.current.promise
        : (creation.current = {
            key: queryString,
            promise: createProject({ template: kind }),
          }).promise
      : ensureDefault();
    void request
      .then((id) => {
        if (!active) return;
        setProjectId(id);
        router.replace(
          `/editor?project=${id}${params.get("settings") === "true" ? "&settings=true" : ""}`,
        );
      })
      .catch((error) => {
        if (active)
          setOpenError(
            error instanceof Error ? error.message : "Could not open project",
          );
      });
    return () => {
      active = false;
    };
  }, [requestedId, queryString, createProject, ensureDefault, router, isAuthenticated]);

  const project = useQuery(
    api.projects.get,
    isAuthenticated && projectId ? { projectId } : "skip",
  );
  const rows = useQuery(
    api.files.list,
    isAuthenticated && project ? { projectId: project._id } : "skip",
  );

  useEffect(() => {
    if (project === null || !isAuthenticated) {
      useWorkbenchStore.getState().stopCompilePolling();
      setPersistenceHandlers({});
      useWorkbenchStore.setState({ projectRole: "viewer" });
    }
  }, [project, isAuthenticated, setPersistenceHandlers]);

  useEffect(() => {
    if (rows && projectId) {
      const files = rows.map((r) => ({
        path: r.path,
        content: r.content,
        version: r.version,
        incarnation: String(r._id),
      }));
      useWorkbenchStore.setState({ cloudUserId: user?.id ?? null, projectRole: project?.role ?? null });
      mergeRemoteProject({
        projectId,
        title: project?.name,
        files,
      });
      if (
        project?.mainFile &&
        Object.hasOwn(
          useWorkbenchStore.getState().filesByPath,
          project.mainFile,
        )
      )
        useWorkbenchStore.setState({ mainFile: project.mainFile });
    }
  }, [rows, projectId, project?.name, project?.mainFile, project?.role, mergeRemoteProject, user?.id]);

  useEffect(() => {
    if (!projectId || !project || !isAuthenticated) return;
    setPersistenceHandlers({
      prepareSourceReplacement,
      checkpointSource: async (expectedRevision) => {
        const state = useWorkbenchStore.getState();
        if (state.projectId !== projectId || state.documentRevision !== expectedRevision) throw new Error("Source changed before checkpointing.");
        await checkpointSource({ projectId, expected: Object.keys(state.filesByPath).map(path => ({ path, version: state.versionsByPath[path], incarnation: state.incarnationsByPath[path] })) });
      },
      setMainFile: async (path) => {
        await persistMainFile({ projectId, path });
      },
      save: async (path, content, expectedVersion, expectedIncarnation) => {
        const result = await saveFile({
          projectId,
          path,
          content,
          expectedVersion,
          expectedIncarnation,
        });
        return result;
      },
      delete: async (path, expectedVersion, expectedIncarnation) => {
        const result = await deleteFile({ projectId, path, expectedVersion, expectedIncarnation });
        return result;
      },
      renameProject: async (name) => {
        await renameProject({ projectId, name });
      },
      rename: async (oldPath, newPath, expectedVersion, expectedIncarnation) => {
        const result = await renameFileMutation({ projectId, oldPath, newPath, expectedVersion, expectedIncarnation });
        return result;
      },
    });
    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      if (
        Object.values(useWorkbenchStore.getState().dirtyByPath).some(Boolean)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warnIfUnsaved);
    return () => {
      window.removeEventListener("beforeunload", warnIfUnsaved);
      setPersistenceHandlers({});
    };
  }, [
    projectId,
    project,
    isAuthenticated,
    saveFile,
    deleteFile,
    renameFileMutation,
    renameProject,
    persistMainFile,
    checkpointSource,
    setPersistenceHandlers,
  ]);

  useEffect(() => () => {
    useWorkbenchStore.getState().setPersistenceHandlers({});
    useWorkbenchStore.getState().stopCompilePolling();
    useWorkbenchStore.setState({ cloudUserId: null });
    useWorkbenchStore.getState().initializeProject({ projectId: null, title: "", files: [] });
  }, [user?.id]);

  if (authLoading || !isAuthenticated || !user)
    return <div role="status" className="p-6">Connecting your cloud workspace… <a href="/projects" className="underline">Back to projects</a></div>;
  if (openError)
    return (
      <div role="alert" className="p-6">
        {openError}{" "}
        <a href="/projects" className="underline">
          Back to projects
        </a>
      </div>
    );
  if (projectId && project === null)
    return (
      <div role="alert" className="p-6">
        Project not found or access denied. Export any source still open on this device before leaving.{" "}
        <button type="button" className="underline" onClick={() => {
          const state = useWorkbenchStore.getState();
          if (state.projectId !== projectId) return;
          const url = URL.createObjectURL(new Blob([serializeWorkspaceSource({ title: state.projectTitle, files: state.filesByPath, mainFile: state.mainFile })], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = "recovered-source.weftly.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Export open source</button>{" "}
        <a href="/projects" className="underline">
          Back to projects
        </a>
      </div>
    );
  if (!rows)
    return (
      <div role="status" className="p-6">
        Opening cloud project…
      </div>
    );
  return <CloudDraftRecovery key={`${user.id}:${projectId}`} userId={user.id} projectId={projectId!}><ProjectToolsProvider value={<><CloudProjectTools key={projectId!} projectId={projectId!} /><GitHubSyncDialog key={`git:${projectId}`} /></>}><LatexEditorApp /></ProjectToolsProvider></CloudDraftRecovery>;
}

function EditorWorkbenchLocal() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryString = searchParams.toString();
  const requestedId = searchParams.get("project");
  const isNew = searchParams.get("new") === "true";
  const templateId = searchParams.get("template");
  const template =
    templateId && Object.hasOwn(TEMPLATES, templateId)
      ? TEMPLATES[templateId as TemplateId]
      : null;
  const isSample = searchParams.get("sample") === "true";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if ((isNew || template || isSample) && !requestedId) {
      // Give every new project its own durable URL before initializing it.
      const params = new URLSearchParams(queryString);
      params.set("project", `local-${crypto.randomUUID()}`);
      router.replace(`/editor?${params}`);
      return;
    }
    const id = requestedId || "local";
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) {
      useWorkbenchStore
        .getState()
        .initializeProject({
          projectId: null,
          title: "Invalid project URL",
          files: [],
        });
      useWorkbenchStore.setState({
        saveStatus: "error",
        saveMessage:
          "Invalid project URL. Open Projects to select a saved workspace.",
      });
      setReady(true);
      return;
    }
    const files = template
      ? { ...template.files }
      : isNew
        ? {
            "main.tex":
              "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n",
          }
        : Object.fromEntries(
            DEMO_FILES.filter((f) => f.type !== "folder").map((f) => [
              f.path,
              f.content ?? "",
            ]),
          );
    const session = createLocalWorkspaceSession({
      store: useWorkbenchStore,
      repository: createLocalWorkspaceRepository(),
      createIfMissing: !requestedId || isNew || isSample || Boolean(template),
      seed: {
        id,
        title:
          template?.label ??
          (isNew ? "Untitled Project" : "Quantum Entanglement Review"),
        files,
        mainFile: "main.tex",
        activeFile: "main.tex",
        openFiles: ["main.tex"],
      },
    });
    let active = true;
    void session.ready.then(() => {
      if (active) setReady(true);
    });
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
      useWorkbenchStore.getState().stopCompilePolling();
    };
  }, [requestedId, isNew, isSample, template, router, queryString]);

  return ready ? (
    <LatexEditorApp />
  ) : (
    <div role="status" className="flex h-[100dvh] items-center justify-center">
      Opening workspace…
    </div>
  );
}

export function EditorWorkbench() {
  useEffect(() => () => useWorkbenchStore.getState().stopCompilePolling(), []);
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
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center text-zinc-500 font-medium">
          Loading editor...
        </div>
      }
    >
      {isLocalStandalone() ? (
        <EditorWorkbenchLocal />
      ) : (
        <EditorWorkbenchConvex />
      )}
    </Suspense>
  );
}
