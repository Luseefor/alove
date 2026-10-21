"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { buildReplacePreview, matchToOffset } from "@/lib/projectSearch";

function highlightParts(lineText: string, column: number, length: number) {
  const start = Math.max(0, column - 1);
  const end = Math.max(start, Math.min(lineText.length, start + length));
  return {
    before: lineText.slice(0, start),
    hit: lineText.slice(start, end),
    after: lineText.slice(end),
  };
}

export function ProjectSearchPanel() {
  const projectSearchQuery = useWorkbenchStore((s) => s.projectSearchQuery);
  const projectSearchResults = useWorkbenchStore((s) => s.projectSearchResults);
  const documentRevision = useWorkbenchStore((s) => s.documentRevision);
  const projectRole = useWorkbenchStore((s) => s.projectRole);

  const [query, setQuery] = useState(projectSearchQuery);
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searchRevision, setSearchRevision] = useState<number | null>(null);
  const [navIndex, setNavIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [searchSignature, setSearchSignature] = useState<string | null>(null);
  const signature = JSON.stringify([query, caseSensitive, wholeWord, useRegex, include, exclude]);

  const isViewer = projectRole === "viewer";
  const isStale = searchRevision !== null && (searchRevision !== documentRevision || searchSignature !== signature);

  const groups = useMemo(() => {
    const byPath = new Map<string, typeof projectSearchResults>();
    for (const r of projectSearchResults) {
      const list = byPath.get(r.path);
      if (list) list.push(r);
      else byPath.set(r.path, [r]);
    }
    return [...byPath.entries()]
      .map(([path, matches]) => ({ path, matches }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }, [projectSearchResults]);

  const flat = projectSearchResults;
  const searchOptions = { caseSensitive, wholeWord, regex: useRegex, include: include || undefined, exclude: exclude || undefined };

  const runSearch = () => {
    setError(null);
    setConfirming(false);
    try {
      const count = useWorkbenchStore.getState().runProjectSearch(query, searchOptions);
      void count;
      setSearchRevision(useWorkbenchStore.getState().documentRevision);
      setNavIndex(0);
      setSearchSignature(signature);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid search pattern.");
    }
  };

  const clearAll = () => {
    setQuery("");
    setReplaceText("");
    setError(null);
    setConfirming(false);
    setSearchRevision(null);
    setSearchSignature(null);
    useWorkbenchStore.getState().clearProjectSearch();
  };

  const navigateTo = (index: number) => {
    const r = flat[index];
    if (!r) return;
    const content = useWorkbenchStore.getState().filesByPath[r.path] ?? "";
    const offset = matchToOffset(content, r.line, r.column);
    useWorkbenchStore.getState().openFile(r.path);
    useWorkbenchStore.setState({
      nextSelection: { start: offset, end: offset + r.length },
      focusedLine: r.line,
    });
    setNavIndex(index);
  };

  const currentQuery = useWorkbenchStore.getState().projectSearchQuery || query.trim();

  async function runPrepareHook(affectedPaths: string[], expectedRevision: number): Promise<{ blocked: boolean; message?: string }> {
    const hook = useWorkbenchStore.getState().persistence.prepareSourceReplacement;
    if (!hook) return { blocked: false };
    try {
      const res = await hook({
        query: currentQuery,
        replaceText,
        affectedPaths,
        expectedDocumentRevision: expectedRevision,
      });
      if (res === false) return { blocked: true, message: "Replacement was blocked before checkpointing." };
      if (typeof res === "object" && res !== null && "proceed" in res && (res as { proceed: boolean }).proceed === false) {
        return { blocked: true, message: (res as { message?: string }).message ?? "Replacement was blocked before checkpointing." };
      }
      return { blocked: false };
    } catch (e) {
      return { blocked: true, message: e instanceof Error ? e.message : "Checkpoint failed; replacement blocked." };
    }
  }

  const refreshAfterReplace = () => {
    try {
      useWorkbenchStore.getState().runProjectSearch(currentQuery, searchOptions);
      setSearchRevision(useWorkbenchStore.getState().documentRevision);
      setNavIndex(0);
    } catch {
      // Keep stale results visible if re-search fails (e.g. unsafe pattern).
    }
  };

  const replaceOne = async (path: string, line: number, column: number) => {
    if (isViewer || isStale || replacing) return;
    setReplacing(true);
    try {
    setError(null);
    const revision = useWorkbenchStore.getState().documentRevision;
    if (searchRevision !== null && searchRevision !== revision) {
      setError("Results are stale — source or search options changed. Re-run Find before replacing.");
      return;
    }
    const gate = await runPrepareHook([path], revision);
    if (gate.blocked) {
      setError(gate.message ?? "Replacement was blocked before checkpointing.");
      return;
    }
    const n = useWorkbenchStore.getState().replaceAcrossFiles(currentQuery, replaceText, {
      ...searchOptions,
      expectedDocumentRevision: revision,
      target: { path, line, column },
    });
    if (n === 0) {
      setError("No replacement made — the source changed since search. Re-run Find.");
      return;
    }
    refreshAfterReplace();
    } catch (e) { setError(e instanceof Error ? e.message : "Replacement failed. Source is unchanged."); } finally { setReplacing(false); }
  };

  const preview = useMemo(() => {
    if (!confirming) return null;
    try {
      const files = useWorkbenchStore.getState().filesByPath;
      return buildReplacePreview(files, currentQuery, replaceText, searchOptions, 8);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming, documentRevision, replaceText, signature]);

  const confirmReplaceAll = async () => {
    if (isViewer || isStale || replacing) return;
    setReplacing(true);
    try {
    setError(null);
    const revision = useWorkbenchStore.getState().documentRevision;
    if (searchRevision !== null && searchRevision !== revision) {
      setError("Results are stale — source or search options changed. Re-run Find before replacing.");
      setConfirming(false);
      return;
    }
    const affectedPaths = groups.map((g) => g.path);
    const gate = await runPrepareHook(affectedPaths, revision);
    if (gate.blocked) {
      setError(gate.message ?? "Replacement was blocked before checkpointing.");
      setConfirming(false);
      return;
    }
    const n = useWorkbenchStore.getState().replaceAcrossFiles(currentQuery, replaceText, {
      ...searchOptions,
      expectedDocumentRevision: revision,
    });
    setConfirming(false);
    if (n === 0) {
      setError("No replacements made — the source changed since search. Re-run Find.");
      return;
    }
    refreshAfterReplace();
    } catch (e) { setError(e instanceof Error ? e.message : "Replacement failed. Source is unchanged."); } finally { setReplacing(false); }
  };

  return (
    <aside className="w-full h-full flex flex-col bg-background select-none border-r shrink-0">
      <div className="h-10 border-b px-3 flex items-center justify-between bg-muted/50">
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Global Search
        </span>
        <button
          type="button"
          onClick={clearAll}
          data-testid="project-search-clear"
          className="text-[10px] font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          Clear
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1 group">
            <Search
              aria-hidden="true"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground group-focus-within:text-primary transition-colors"
            />
            <input
              aria-label="Search text in project"
              data-testid="project-search-input"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="Search text in project..."
              className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
            />
          </div>
          <button
            type="button"
            onClick={runSearch}
            data-testid="project-search-find"
            className="h-8 px-4 rounded-lg bg-primary text-white text-[11px] font-bold shadow-md shadow-primary/10 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Find
          </button>
        </div>

        <div className="flex gap-2">
          <input
            aria-label="Replace text in project"
            data-testid="project-search-replace-input"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace with..."
            disabled={isViewer}
            title={isViewer ? "Viewers cannot replace" : undefined}
            className="h-8 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary transition-all shadow-sm disabled:opacity-50"
          />
          <button
            type="button"
            disabled={isViewer || replacing || flat.length === 0 || isStale}
            title={isViewer ? "Viewers cannot replace" : isStale ? "Re-run Find before replacing" : undefined}
            onClick={() => setConfirming(true)}
            data-testid="project-search-replace-all"
            className="h-8 px-3 rounded-lg border border-border text-[11px] font-bold hover:bg-muted transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Replace all
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wide px-1">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              data-testid="project-search-case"
              className="w-3 h-3 rounded border-zinc-300 text-primary focus:ring-primary/20"
            />
            Case
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
              data-testid="project-search-whole-word"
              className="w-3 h-3 rounded border-zinc-300 text-primary focus:ring-primary/20"
            />
            Whole word
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useRegex}
              onChange={(e) => setUseRegex(e.target.checked)}
              data-testid="project-search-regex"
              className="w-3 h-3 rounded border-zinc-300 text-primary focus:ring-primary/20"
            />
            Regex
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            aria-label="Include glob patterns"
            data-testid="project-search-include"
            value={include}
            onChange={(e) => setInclude(e.target.value)}
            placeholder="Include: *.tex"
            className="h-7 rounded-lg border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
          />
          <input
            aria-label="Exclude glob patterns"
            data-testid="project-search-exclude"
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            placeholder="Exclude: figures/**"
            className="h-7 rounded-lg border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
          />
        </div>

        {error ? (
          <p role="alert" data-testid="project-search-error" className="text-[11px] text-error bg-error-bg border border-error-border rounded-lg px-3 py-2">
            {error}
          </p>
        ) : null}
        {isStale ? (
          <p role="status" data-testid="project-search-stale" className="text-[11px] text-warning-foreground bg-warning-bg border border-warning-border rounded-lg px-3 py-2">
            Results are stale — source or search options changed. Re-run Find before replacing.
          </p>
        ) : null}
      </div>

      <div
        className="px-3 py-2 text-[10px] font-bold text-muted-foreground bg-muted/50 border-y border-border flex justify-between"
        data-testid="project-search-count"
      >
        <span>
          {flat.length} {flat.length === 1 ? "match" : "matches"} in {groups.length} {groups.length === 1 ? "file" : "files"}
        </span>
        {flat.length > 1 ? (
          <span className="flex gap-2">
            <button
              type="button"
              data-testid="project-search-prev"
              onClick={() => navigateTo((navIndex - 1 + flat.length) % flat.length)}
              className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
            >
              ↑ Prev
            </button>
            <button
              type="button"
              data-testid="project-search-next"
              onClick={() => navigateTo((navIndex + 1) % flat.length)}
              className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
            >
              Next ↓
            </button>
          </span>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-3 bg-background" data-testid="project-search-results">
        {flat.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4 space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-zinc-300 border border-border">
              <Search aria-hidden="true" className="w-6 h-6" />
            </div>
            <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">
              No results yet. Enter a query and click Find to search across all files.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.path} data-testid={`project-search-group-${group.path}`} aria-label={`${group.path}, ${group.matches.length} matches`}>
              <div className="px-1 pb-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground flex justify-between">
                <span className="truncate">{group.path}</span>
                <span>
                  {group.matches.length} {group.matches.length === 1 ? "match" : "matches"}
                </span>
              </div>
              <div className="space-y-2">
                {group.matches.map((r) => {
                  const globalIndex = flat.indexOf(r);
                  const parts = highlightParts(r.lineText, r.column, r.length);
                  return (
                    <div
                      key={`${r.path}-${r.line}-${r.column}-${r.length}`}
                      className="w-full text-left rounded-xl border border-border p-3 hover:bg-muted hover:border-primary/20 transition-all group shadow-sm"
                    >
                      <button
                        type="button"
                        data-testid="project-search-match"
                        data-path={r.path}
                        data-line={r.line}
                        data-column={r.column}
                        aria-label={`Go to match in ${r.path} line ${r.line}`}
                        aria-current={globalIndex === navIndex ? "true" : undefined}
                        onClick={() => navigateTo(globalIndex)}
                        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <div className="text-[11px] font-bold text-foreground group-hover:text-primary transition-colors truncate pr-2">
                            {r.path}
                          </div>
                          <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight shrink-0">
                            Ln {r.line}
                            {r.endLine !== r.line ? `–${r.endLine}` : ""}
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground font-medium leading-relaxed bg-muted/50 p-2 rounded-lg border border-border/50 italic group-hover:bg-background transition-colors break-words">
                          {parts.before}
                          <mark className="not-italic bg-primary/20 text-foreground rounded px-0.5">{parts.hit}</mark>
                          {parts.after}
                        </div>
                      </button>
                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          data-testid="project-search-replace-one"
                          disabled={isViewer || isStale || replacing}
                          title={isViewer ? "Viewers cannot replace" : undefined}
                          onClick={() => void replaceOne(r.path, r.line, r.column)}
                          className="text-[10px] font-bold text-primary hover:underline disabled:opacity-40 disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                        >
                          Replace
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <Dialog open={confirming} onOpenChange={next => { if (!replacing) setConfirming(next); }}>
        <DialogContent data-testid="project-search-preview" className="max-h-[85dvh] overflow-y-auto" onEscapeKeyDown={e => { if (replacing) e.preventDefault(); }} onPointerDownOutside={e => { if (replacing) e.preventDefault(); }}>
          <DialogHeader><DialogTitle>Confirm replace all</DialogTitle><DialogDescription>Review the replacement samples. Current source is saved before replacement.</DialogDescription></DialogHeader>
          <p className="text-[11px] font-bold">
            Replace {flat.length} {flat.length === 1 ? "match" : "matches"} in {groups.length} {groups.length === 1 ? "file" : "files"}?
          </p>
          {preview && preview.samples.length > 0 ? (
            <ul className="space-y-1 max-h-40 overflow-auto text-[11px]">
              {preview.samples.map((s, i) => (
                <li key={`${s.path}-${s.line}-${i}`} className="rounded-lg border border-border p-2">
                  <div className="font-bold text-muted-foreground truncate">
                    {s.path}:{s.line}
                  </div>
                  <div className="text-muted-foreground line-through break-words">{s.before}</div>
                  <div className="text-foreground break-words">{s.after}</div>
                </li>
              ))}
            </ul>
          ) : null}
          {preview && preview.samples.length < preview.totalMatches ? <p className="text-xs text-muted-foreground">Showing the first {preview.samples.length} samples.</p> : null}
          {(!preview || preview.truncated) && <p role="alert" className="text-sm text-destructive">A complete replacement preview is unavailable. Refine the search before replacing all.</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              data-testid="project-search-cancel-replace-all"
              disabled={replacing}
              onClick={() => setConfirming(false)}
              className="h-8 px-3 rounded-lg border border-border text-[11px] font-bold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="project-search-confirm-replace-all"
              disabled={isViewer || isStale || replacing || !preview || preview.truncated}
              title={isViewer ? "Viewers cannot replace" : undefined}
              onClick={() => void confirmReplaceAll()}
              className="h-8 px-3 rounded-lg bg-primary text-white text-[11px] font-bold disabled:opacity-50"
            >
              Confirm replace
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
