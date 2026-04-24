"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Button, ToggleChip } from "@/components/ui/primitives";
import { PaletteSwitcher } from "@/components/theme/PaletteSwitcher";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export type EditorPeer = {
  userId: string;
  name: string;
  color: string;
  cursorLine?: number;
};

type Engine = "pdflatex" | "xelatex" | "lualatex";

type EditorHeaderProps = {
  activeFile: string;
  wordCount: number;
  peers: EditorPeer[] | undefined;
  currentUserId: string | undefined;
  engine: Engine;
  onEngineChange: (e: Engine) => void;
  cleanAux: boolean;
  onCleanAux: (v: boolean) => void;
  vim: boolean;
  onVim: (v: boolean) => void;
  autoCompile: boolean;
  onAutoCompile: (v: boolean) => void;
  designMode: boolean;
  designModeDisabled: boolean;
  onDesignMode: (v: boolean) => void;
  zen: boolean;
  onZen: () => void;
  onOpenPalette: () => void;
  onCompile: () => void;
  statusText: string;
  buildKind: string;
  /** No Clerk UI; design mode chip locked on (multi-file always). */
  localStandalone?: boolean;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/u);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
}

export function EditorHeader({
  activeFile,
  wordCount,
  peers,
  currentUserId,
  engine,
  onEngineChange,
  cleanAux,
  onCleanAux,
  vim,
  onVim,
  autoCompile,
  onAutoCompile,
  designMode,
  designModeDisabled,
  onDesignMode,
  zen,
  onZen,
  onOpenPalette,
  onCompile,
  statusText,
  buildKind,
  localStandalone = false,
}: EditorHeaderProps) {
  const showPeers = !localStandalone && (peers?.length ?? 0) > 0;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/90 bg-white/90 px-3 py-2 text-sm shadow-sm backdrop-blur-md dark:border-zinc-800/90 dark:bg-zinc-950/85">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Link
          href="/"
          className="shrink-0 font-semibold tracking-tight text-zinc-900 hover:text-alove-fg-muted dark:text-zinc-50 dark:hover:text-alove-fg-muted"
        >
          alove
        </Link>
        <span className="hidden h-4 w-px bg-zinc-200 dark:bg-zinc-700 sm:block" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">
            {activeFile}
          </span>
          <span className="text-xs text-zinc-400">{wordCount} words</span>
        </div>
        {showPeers ? (
          <div
            className="flex max-w-[220px] items-center gap-1.5 overflow-x-auto sm:max-w-md"
            title="People recently active on this project"
          >
            <span className="shrink-0 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:bg-violet-950 dark:text-violet-200">
              Live
            </span>
            <span className="sr-only">Active collaborators</span>
            {peers!.map((p) => {
              const isSelf = p.userId === currentUserId;
              return (
                <span
                  key={p.userId}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white shadow ${
                    isSelf
                      ? "ring-2 ring-alove-accent ring-offset-2 ring-offset-white dark:ring-offset-zinc-950"
                      : "ring-2 ring-white dark:ring-zinc-950"
                  }`}
                  style={{ backgroundColor: p.color }}
                  title={`${p.name}${isSelf ? " (you)" : ""}${p.cursorLine != null ? ` · Line ${p.cursorLine}` : ""}`}
                >
                  <span className="sr-only">{p.name}</span>
                  <span aria-hidden>{initials(p.name)}</span>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <div className="flex flex-wrap items-center gap-1.5 border-zinc-200 sm:border-l sm:pl-2 dark:border-zinc-700">
          <label className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="hidden lg:inline">Engine</span>
            <select
              aria-label="LaTeX engine"
              className="rounded-md border border-zinc-300 bg-white py-1 pl-2 pr-8 text-xs font-medium text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              value={engine}
              onChange={(e) => onEngineChange(e.target.value as Engine)}
            >
              <option value="pdflatex">pdfLaTeX</option>
              <option value="xelatex">XeLaTeX</option>
              <option value="lualatex">LuaLaTeX</option>
            </select>
          </label>
        </div>

        <div className="hidden h-6 w-px bg-zinc-200 md:block dark:bg-zinc-700" aria-hidden />

        <div className="flex flex-wrap items-center gap-1">
          <ToggleChip
            checked={cleanAux}
            onChange={onCleanAux}
            title="Delete auxiliary files before compile"
          >
            Clean aux
          </ToggleChip>
          <ToggleChip
            checked={vim}
            onChange={onVim}
            title="Vim keybindings in the editor"
          >
            Vim
          </ToggleChip>
          <ToggleChip
            checked={autoCompile}
            onChange={onAutoCompile}
            title="Compile shortly after you stop typing"
          >
            Auto
          </ToggleChip>
          <ToggleChip
            checked={designMode}
            onChange={onDesignMode}
            disabled={localStandalone || designModeDisabled}
            title={
              localStandalone
                ? "Multi-file editing is always on in local mode"
                : "Allow multi-file project editing"
            }
          >
            Design
          </ToggleChip>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:ml-0">
          <PaletteSwitcher size="sm" />
          <ThemeToggle size="sm" />
          <Button variant="ghost" size="sm" type="button" onClick={onZen}>
            {zen ? "Exit Zen" : "Zen"}
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onOpenPalette}>
            Commands
          </Button>
          {localStandalone ? (
            <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              Local
            </span>
          ) : (
            <UserButton />
          )}
          <span
            className={`max-w-[140px] truncate rounded-full px-2 py-0.5 text-center text-[11px] font-medium sm:max-w-[180px] ${
              buildKind === "ready"
                ? "bg-alove-surface-soft text-alove-fg-strong dark:bg-alove-surface-soft dark:text-alove-fg-strong"
                : buildKind === "failed"
                  ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                  : buildKind === "running" || buildKind === "queued"
                    ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                    : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            }`}
            title={statusText}
          >
            {statusText}
          </span>
          <Button variant="primary" size="sm" type="button" onClick={onCompile}>
            Compile
          </Button>
        </div>
      </div>
    </header>
  );
}
