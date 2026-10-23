"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cloudDraftRepository, type CloudDraft } from "@/lib/cloudDraft";
import { serializeWorkspaceSource } from "@/lib/workspaceArchive";
import { useWorkbenchStore } from "@/stores/workbenchStore";

let browserTab: string | null = null;
function tabId() {
  if (browserTab) return browserTab;
  const key = "alove-cloud-draft-tab";
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  try {
    browserTab = navigation?.type === "reload" || navigation?.type === "back_forward" ? sessionStorage.getItem(key) : null;
    browserTab ??= crypto.randomUUID();
    sessionStorage.setItem(key, browserTab);
  } catch { browserTab = crypto.randomUUID(); }
  return browserTab;
}

function download(draft: CloudDraft) {
  const url = URL.createObjectURL(new Blob([serializeWorkspaceSource({ title: draft.title, files: draft.files, mainFile: draft.mainFile })], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "recovered-draft.weftly.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CloudDraftRecovery({ userId, projectId, children }: { userId: string; projectId: string; children: ReactNode }) {
  const [pending, setPending] = useState<CloudDraft | null>(null);
  const [notice, setNotice] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const ready = useRef(false);
  const key = useRef("");
  const last = useRef<CloudDraft | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let writing = false;
    let scheduled = false;
    ready.current = false;
    key.current = tabId();
    let clock = 0;
    const snapshot = (): CloudDraft | null => {
      const state = useWorkbenchStore.getState();
      if (state.cloudUserId !== userId || state.projectId !== projectId || !Object.values(state.dirtyByPath).some(Boolean)) return null;
      const versions = Object.fromEntries(Object.keys(state.filesByPath).map((path) => [path, state.versionsByPath[path] ?? 0]));
      clock = Math.max(Date.now(), clock + 1);
      const incarnations = Object.fromEntries(Object.entries(state.incarnationsByPath).filter(([path]) => Object.hasOwn(state.filesByPath, path)));
      return { userId, projectId, tabId: key.current, files: { ...state.filesByPath }, versions, incarnations, dirtyPaths: Object.keys(state.dirtyByPath).filter((path) => state.dirtyByPath[path] && Object.hasOwn(state.filesByPath, path)), title: state.projectTitle, mainFile: state.mainFile, updatedAt: clock };
    };
    const save = async () => {
      if (!ready.current || !live) return;
      if (writing) { scheduled = true; return; }
      const draft = snapshot();
      if (!draft) return;
      last.current = draft;
      writing = true;
      try { await cloudDraftRepository.save(draft); }
      catch { if (live) setNotice("Browser draft backup is unavailable. Export source before leaving if cloud saving fails."); }
      if (live && useWorkbenchStore.getState().cloudUserId === userId && useWorkbenchStore.getState().projectId === projectId && navigator.onLine && useWorkbenchStore.getState().saveStatus !== "conflict") {
        try { await useWorkbenchStore.getState().saveAllDirtyFiles(); }
        catch { if (live) setNotice("Cloud saving failed. Your browser draft is retained; retry Save or export source."); }
        if (useWorkbenchStore.getState().projectId === projectId && !Object.values(useWorkbenchStore.getState().dirtyByPath).some(Boolean)) {
          try { await cloudDraftRepository.remove(userId, projectId, key.current); last.current = null; }
          catch { /* A retained draft is offered for review after a reload. */ }
        }
      }
      writing = false;
      if (scheduled) { scheduled = false; void save(); }
    };
    const schedule = () => {
      if (!ready.current || !snapshot()) return;
      last.current = snapshot();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void save(), 750);
    };
    const unsubscribe = useWorkbenchStore.subscribe((state, previous) => {
      if (state.filesByPath !== previous.filesByPath) schedule();
    });
    void cloudDraftRepository.load(userId, projectId, key.current).then((draft) => {
      if (!live) return;
      setHydrated(true);
      if (draft) {
        const files = useWorkbenchStore.getState().filesByPath;
        const same = Object.keys(files).length === Object.keys(draft.files).length && Object.keys(files).every((path) => files[path] === draft.files[path]);
        if (same) { void cloudDraftRepository.remove(userId, projectId, key.current).catch(() => {}); ready.current = true; }
        else { setPending(draft); }
      }
      else { ready.current = true; schedule(); }
    }).catch(() => {
      if (live) { setHydrated(true); setNotice("Browser draft recovery is unavailable. Cloud saves still work; export unsaved source as a backup."); ready.current = true; schedule(); }
    });
    const retry = () => void save();
    const flush = () => {
      const draft = last.current;
      if (ready.current && draft) void cloudDraftRepository.save(draft).catch(() => {});
    };
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", flush);
    return () => {
      flush(); live = false; ready.current = false;
      if (timer) clearTimeout(timer);
      unsubscribe(); window.removeEventListener("online", retry); window.removeEventListener("pagehide", flush);
    };
  }, [userId, projectId]);

  async function discard() {
    try {
      await cloudDraftRepository.remove(userId, projectId, key.current);
      setPending(null); ready.current = true;
    } catch { setNotice("Could not discard the browser draft. Download it before retrying."); }
  }
  function restore() {
    if (!pending || useWorkbenchStore.getState().cloudUserId !== userId || useWorkbenchStore.getState().projectId !== projectId) return;
    const state = useWorkbenchStore.getState();
    const restoredPaths = pending.dirtyPaths ?? Object.keys(pending.files);
    const files = { ...state.filesByPath };
    const versions = { ...state.versionsByPath };
    const incarnations = { ...state.incarnationsByPath };
    const dirty = { ...state.dirtyByPath };
    let stale = false;
    for (const path of restoredPaths) {
      if (!Object.hasOwn(pending.files, path)) continue;
      files[path] = pending.files[path]!;
      dirty[path] = files[path] !== state.filesByPath[path];
      if (dirty[path]) {
        versions[path] = pending.versions[path] ?? 0;
        const originalIdentity = pending.incarnations?.[path];
        if (originalIdentity) incarnations[path] = originalIdentity;
        else delete incarnations[path];
        // Older drafts lack identity evidence: never rebase them onto a recreated row.
        if ((state.versionsByPath[path] ?? 0) !== versions[path] ||
            (versions[path] > 0 && (!originalIdentity || originalIdentity !== state.incarnationsByPath[path]))) stale = true;
      }
    }
    useWorkbenchStore.setState({ filesByPath: files, dirtyByPath: dirty, versionsByPath: versions, incarnationsByPath: incarnations,
      saveStatus: stale ? "conflict" : Object.values(dirty).some(Boolean) ? "unsaved" : "saved", saveMessage: stale ? "Cloud files changed since this draft. Review and export your restored edits before resolving the conflict." : "Draft restored. Review your source, then save.",
    });
    setPending(null); ready.current = true;
  }
  if (!hydrated) return <div role="status" className="p-6">Checking browser draft recovery…</div>;
  if (!pending && !notice) return <>{children}</>;
  return <><aside className="shrink-0 border-b border-border bg-background p-3 text-sm" aria-label="Cloud draft recovery">
    {pending && <><p role="status">An unsaved draft from this browser is available. Restore it for review or download a backup.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="rounded border border-border px-3 py-1" onClick={restore}>Restore browser draft</button>
        <button className="rounded border border-border px-3 py-1" onClick={() => download(pending)}>Download draft</button>
        <button className="rounded border border-border px-3 py-1" onClick={() => void discard()}>Discard draft</button>
      </div></>}
    {notice && <p role="alert">{notice}</p>}
  </aside>{!pending && children}</>;
}
