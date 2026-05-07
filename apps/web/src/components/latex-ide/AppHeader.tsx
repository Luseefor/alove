"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import {
  ChevronDown,
  History,
  Moon,
  Play,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import type { SitePaletteId } from "@/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IdeSettingsDialog } from "./IdeSettingsDialog";

function menuMod(): string {
  if (typeof navigator === "undefined") return "Ctrl+";
  return /Mac|iPhone|iPad/i.test(navigator.userAgent) ? "⌘" : "Ctrl+";
}

type MenuEntry =
  | { type: "separator" }
  | { type: "label"; text: string }
  | {
      type: "item";
      label: string;
      action?: () => void;
      disabled?: boolean;
      shortcut?: string;
    };

export function AppHeader() {
  const m = menuMod();
  const {
    projectTitle,
    runCompile,
    buildStatus,
    setActiveRail,
    toggleSidebar,
    toggleBottomPanel,
    createFile,
    saveActiveFile,
    saveAllDirtyFiles,
    appendToActiveFile,
    transformActiveFile,
    requestEditorCommand,
    requestEditorFindBar,
    toggleEditorWordWrap,
    editorWordWrap,
    filesByPath,
    activeFileId,
    openFile,
    closeActiveEditorTab,
    replaceAcrossFiles,
    runProjectSearch,
    wrapSelectionOrInsert,
    pdfDataUrl,
    dirtyByPath,
    settingsModalOpen,
    setSettingsModalOpen,
    keyboardShortcutsModalOpen,
    setKeyboardShortcutsModalOpen,
  } = useWorkbenchStore();
  const { appearance, setAppearance, paletteId, setPaletteId, paletteOptions } = useTheme();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [projectReplaceOpen, setProjectReplaceOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [projectFindText, setProjectFindText] = useState("");
  const [projectReplaceText, setProjectReplaceText] = useState("");
  const [texOnly, setTexOnly] = useState(true);
  const [lastProjectReplaceCount, setLastProjectReplaceCount] = useState<number | null>(null);
  const [findProjectOpen, setFindProjectOpen] = useState(false);
  const [projectFindOnlyText, setProjectFindOnlyText] = useState("");

  const activeContent = activeFileId ? filesByPath[activeFileId] ?? "" : "";
  const hasDirty = useMemo(() => Object.values(dirtyByPath).some(Boolean), [dirtyByPath]);

  const fileItems: MenuEntry[] = [
    {
      type: "item",
      label: "New file",
      action: () => createFile(`untitled-${Date.now()}.tex`, ""),
    },
    {
      type: "item",
      label: "Open main.tex",
      disabled: !("main.tex" in filesByPath),
      action: () => openFile("main.tex"),
    },
    {
      type: "item",
      label: "Show project files",
      action: () => setActiveRail("explorer"),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Save",
      disabled: !activeFileId,
      action: () => saveActiveFile(),
      shortcut: `${m}S`,
    },
    {
      type: "item",
      label: "Save all",
      disabled: !hasDirty,
      action: () => saveAllDirtyFiles(),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Close tab",
      disabled: !activeFileId,
      action: () => closeActiveEditorTab(),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Compile",
      action: () => void runCompile(),
      shortcut: `${m}↵`,
    },
    {
      type: "item",
      label: "View PDF in new tab",
      disabled: !pdfDataUrl,
      action: () => {
        if (pdfDataUrl) window.open(pdfDataUrl, "_blank", "noopener,noreferrer");
      },
    },
  ];

  const editItems: MenuEntry[] = [
    {
      type: "item",
      label: "Undo",
      disabled: !activeFileId,
      action: () => requestEditorCommand("undo"),
      shortcut: `${m}Z`,
    },
    {
      type: "item",
      label: "Redo",
      disabled: !activeFileId,
      action: () => requestEditorCommand("redo"),
      shortcut: `${m}⇧Z`,
    },
    { type: "separator" },
    {
      type: "item",
      label: "Cut",
      disabled: !activeFileId,
      action: () => requestEditorCommand("cut"),
      shortcut: `${m}X`,
    },
    {
      type: "item",
      label: "Copy",
      disabled: !activeFileId,
      action: () => requestEditorCommand("copy"),
      shortcut: `${m}C`,
    },
    {
      type: "item",
      label: "Paste",
      disabled: !activeFileId,
      action: () => requestEditorCommand("paste"),
      shortcut: `${m}V`,
    },
    {
      type: "item",
      label: "Select all",
      disabled: !activeFileId,
      action: () => requestEditorCommand("selectAll"),
      shortcut: `${m}A`,
    },
    { type: "separator" },
    {
      type: "item",
      label: "Find in document…",
      disabled: !activeFileId,
      action: () => requestEditorFindBar(),
      shortcut: `${m}F`,
    },
    {
      type: "item",
      label: "Replace in document…",
      disabled: !activeFileId,
      action: () => setReplaceOpen(true),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Find in project…",
      action: () => setFindProjectOpen(true),
    },
    {
      type: "item",
      label: "Replace in project…",
      action: () => setProjectReplaceOpen(true),
    },
  ];

  const insertItems: MenuEntry[] = [
    { type: "label", text: "Structure" },
    {
      type: "item",
      label: "Section",
      disabled: !activeFileId,
      action: () => appendToActiveFile("\\section{Title}\n"),
    },
    {
      type: "item",
      label: "Subsection",
      disabled: !activeFileId,
      action: () => appendToActiveFile("\\subsection{Title}\n"),
    },
    {
      type: "item",
      label: "Subsubsection",
      disabled: !activeFileId,
      action: () => appendToActiveFile("\\subsubsection{Title}\n"),
    },
    { type: "separator" },
    { type: "label", text: "Math & lists" },
    {
      type: "item",
      label: "Inline math",
      disabled: !activeFileId,
      action: () => wrapSelectionOrInsert("$", "$", "$x$"),
    },
    {
      type: "item",
      label: "Display equation",
      disabled: !activeFileId,
      action: () =>
        appendToActiveFile("\\begin{equation}\n\\label{eq:example}\nE = mc^2\n\\end{equation}\n"),
    },
    {
      type: "item",
      label: "Itemize list",
      disabled: !activeFileId,
      action: () =>
        appendToActiveFile("\\begin{itemize}\n  \\item \n\\end{itemize}\n"),
    },
    {
      type: "item",
      label: "Enumerate list",
      disabled: !activeFileId,
      action: () =>
        appendToActiveFile("\\begin{enumerate}\n  \\item \n\\end{enumerate}\n"),
    },
    { type: "separator" },
    { type: "label", text: "Floats & references" },
    {
      type: "item",
      label: "Figure (with caption)",
      disabled: !activeFileId,
      action: () =>
        appendToActiveFile(
          "\\begin{figure}[htbp]\n  \\centering\n  % \\includegraphics[width=\\linewidth]{figure.png}\n  \\caption{Caption text.}\n  \\label{fig:example}\n\\end{figure}\n",
        ),
    },
    {
      type: "item",
      label: "Table (tabular)",
      disabled: !activeFileId,
      action: () =>
        appendToActiveFile(
          "\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{lcc}\n    A & B & C \\\\\n  \\end{tabular}\n  \\caption{Table caption.}\n  \\label{tab:example}\n\\end{table}\n",
        ),
    },
    {
      type: "item",
      label: "Citation",
      disabled: !activeFileId,
      action: () => wrapSelectionOrInsert("\\cite{", "}", "\\cite{key}"),
    },
    {
      type: "item",
      label: "Cross-reference",
      disabled: !activeFileId,
      action: () => wrapSelectionOrInsert("\\ref{", "}", "\\ref{fig:example}"),
    },
    {
      type: "item",
      label: "Hyperlink",
      disabled: !activeFileId,
      action: () =>
        wrapSelectionOrInsert("\\href{https://example.com}{", "}", "\\href{https://example.com}{link text}"),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Page break",
      disabled: !activeFileId,
      action: () => appendToActiveFile("\n\\newpage\n"),
    },
  ];

  const viewItems: MenuEntry[] = [
    {
      type: "item",
      label: "Toggle sidebar",
      action: () => toggleSidebar(),
    },
    {
      type: "item",
      label: "Toggle bottom panel",
      action: () => toggleBottomPanel(),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Project search (sidebar)",
      action: () => setActiveRail("search"),
    },
    {
      type: "item",
      label: "Find in current file…",
      disabled: !activeFileId,
      action: () => requestEditorFindBar(),
    },
    { type: "separator" },
    {
      type: "item",
      label: editorWordWrap ? "Turn off word wrap" : "Turn on word wrap",
      disabled: !activeFileId,
      action: () => toggleEditorWordWrap(),
    },
  ];

  const formatItems: MenuEntry[] = [
    { type: "label", text: "Character (selection)" },
    {
      type: "item",
      label: "Bold (\\textbf)",
      disabled: !activeFileId,
      action: () => wrapSelectionOrInsert("\\textbf{", "}"),
    },
    {
      type: "item",
      label: "Italic (\\emph)",
      disabled: !activeFileId,
      action: () => wrapSelectionOrInsert("\\emph{", "}"),
    },
    {
      type: "item",
      label: "Typewriter (\\texttt)",
      disabled: !activeFileId,
      action: () => wrapSelectionOrInsert("\\texttt{", "}"),
    },
    { type: "separator" },
    { type: "label", text: "Document" },
    {
      type: "item",
      label: "Trim trailing spaces",
      disabled: !activeFileId,
      action: () =>
        transformActiveFile((current) =>
          current
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n"),
        ),
    },
    {
      type: "item",
      label: "Wrap lines at 100 characters",
      disabled: !activeFileId,
      action: () =>
        transformActiveFile((current) =>
          current
            .split("\n")
            .map((line) =>
              line.length <= 100
                ? line
                : line.match(/.{1,100}(\s|$)/g)?.map((chunk) => chunk.trimEnd()).join("\n") ?? line,
            )
            .join("\n"),
        ),
    },
    {
      type: "item",
      label: "UPPERCASE entire file",
      disabled: !activeFileId,
      action: () => transformActiveFile((current) => current.toUpperCase()),
    },
    {
      type: "item",
      label: "lowercase entire file",
      disabled: !activeFileId,
      action: () => transformActiveFile((current) => current.toLowerCase()),
    },
    {
      type: "item",
      label: "Title-case \\section titles",
      disabled: !activeFileId,
      action: () =>
        transformActiveFile((current) =>
          current.replace(
            /(\\(?:section|subsection|subsubsection|chapter)\{)([^}]+)(\})/g,
            (_full, prefix, text, suffix) =>
              `${prefix}${String(text)
                .toLowerCase()
                .replace(/\b\w/g, (c) => c.toUpperCase())}${suffix}`,
          ),
        ),
    },
  ];

  const helpItems: MenuEntry[] = [
    {
      type: "item",
      label: "Settings…",
      action: () => setSettingsModalOpen(true),
    },
    { type: "separator" },
    {
      type: "item",
      label: "Keyboard shortcuts…",
      action: () => setKeyboardShortcutsModalOpen(true),
    },
    { type: "separator" },
    {
      type: "item",
      label: "LaTeX learn (Overleaf)",
      action: () => window.open("https://www.overleaf.com/learn", "_blank", "noopener,noreferrer"),
    },
    {
      type: "item",
      label: "LaTeX reference (CTAN)",
      action: () => window.open("https://ctan.org/pkg/latex2e-help-texinfo", "_blank", "noopener,noreferrer"),
    },
    {
      type: "item",
      label: "Detexify (find symbols)",
      action: () => window.open("https://detexify.kirelabs.org/classify.html", "_blank", "noopener,noreferrer"),
    },
  ];

  return (
    <header className="h-10 border-b bg-background flex items-center justify-between px-2 shrink-0 z-50 select-none">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 px-2">
          <div className="size-5 bg-primary rounded flex items-center justify-center shadow-sm">
            <span className="text-primary-foreground font-black text-[10px] tracking-tighter">AL</span>
          </div>
          <div className="hidden lg:flex items-center gap-2 ml-2">
            <TopMenu label="File" items={fileItems} />
            <TopMenu label="Edit" items={editItems} />
            <TopMenu label="Insert" items={insertItems} />
            <TopMenu label="View" items={viewItems} />
            <TopMenu label="Format" items={formatItems} />
            <TopMenu label="Help" items={helpItems} />
          </div>
        </div>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
        <button className="flex items-center gap-1.5 px-3 py-1 text-[13px] font-bold hover:bg-muted rounded transition-colors group">
          <span>{projectTitle}</span>
          <ChevronDown size={14} className="text-muted-foreground group-hover:text-foreground" />
        </button>
      </div>

      <div className="flex items-center gap-2 pr-2">
        <button
          type="button"
          onClick={() => setActiveRail("source-control")}
          className="size-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
        >
          <History size={16} />
        </button>
        <button
          type="button"
          onClick={toggleBottomPanel}
          className="size-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
        >
          <Users size={16} />
        </button>

        <div className="w-px h-4 bg-border mx-1" />
        <select
          value={paletteId}
          onChange={(e) => setPaletteId(e.target.value as SitePaletteId)}
          className="h-8 rounded border bg-background px-2 text-xs text-foreground outline-none"
        >
          {paletteOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setAppearance(appearance === "dark" ? "light" : "dark")}
          className="size-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
          title="Toggle light/dark"
        >
          {appearance === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          type="button"
          onClick={() => setSettingsModalOpen(true)}
          className="size-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all"
          title="Settings"
        >
          <Settings size={16} />
        </button>

        <button
          type="button"
          onClick={() => void runCompile()}
          className="flex items-center gap-1.5 px-3 py-1 bg-primary text-primary-foreground rounded text-[12px] font-bold hover:opacity-90 transition-all ml-1"
        >
          <Play size={14} strokeWidth={2.5} />
          {buildStatus === "running" ? "Compiling..." : "Compile"}
        </button>
        <button
          type="button"
          onClick={saveActiveFile}
          className="px-3 py-1 border border-border rounded text-[12px] font-bold hover:bg-muted transition-all"
        >
          Save
        </button>
      </div>

      <IdeSettingsDialog open={settingsModalOpen} onOpenChange={setSettingsModalOpen} />

      <ConfirmDialog
        open={replaceOpen}
        title="Find and replace (entire file)"
        description="Replaces all matches in the current file."
        confirmLabel="Replace all"
        cancelLabel="Cancel"
        onCancel={() => setReplaceOpen(false)}
        onConfirm={() => {
          if (!findText) {
            setReplaceOpen(false);
            return;
          }
          transformActiveFile((current) => current.split(findText).join(replaceText));
          setReplaceOpen(false);
        }}
      >
        <div className="space-y-2">
          <input
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            placeholder="Find text"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace with"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">Current file length: {activeContent.length} chars</p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={findProjectOpen}
        title="Find in project"
        description="Searches all files and opens results in Search rail."
        confirmLabel="Search"
        cancelLabel="Cancel"
        onCancel={() => setFindProjectOpen(false)}
        onConfirm={() => {
          runProjectSearch(projectFindOnlyText, { texOnly: false });
          setFindProjectOpen(false);
        }}
      >
        <input
          value={projectFindOnlyText}
          onChange={(e) => setProjectFindOnlyText(e.target.value)}
          placeholder="Search query"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={projectReplaceOpen}
        title="Find and replace (project)"
        description="Runs replace across files in this project."
        confirmLabel="Replace in files"
        cancelLabel="Cancel"
        onCancel={() => setProjectReplaceOpen(false)}
        onConfirm={() => {
          const changed = replaceAcrossFiles(projectFindText, projectReplaceText, { texOnly });
          setLastProjectReplaceCount(changed);
          setProjectReplaceOpen(false);
        }}
      >
        <div className="space-y-2">
          <input
            value={projectFindText}
            onChange={(e) => setProjectFindText(e.target.value)}
            placeholder="Find text in project"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            value={projectReplaceText}
            onChange={(e) => setProjectReplaceText(e.target.value)}
            placeholder="Replace with"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={texOnly} onChange={(e) => setTexOnly(e.target.checked)} />
            Only `.tex` files
          </label>
          <p className="text-xs text-muted-foreground">Files in project: {Object.keys(filesByPath).length}</p>
          {lastProjectReplaceCount != null && (
            <p className="text-xs text-foreground">Last run changed {lastProjectReplaceCount} file(s).</p>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={keyboardShortcutsModalOpen}
        title="Keyboard shortcuts"
        description="Global shortcuts below are handled by the editor workspace. Your browser may also provide standard text-editing keys in the source pane."
        confirmLabel="Done"
        cancelLabel="Close"
        onCancel={() => setKeyboardShortcutsModalOpen(false)}
        onConfirm={() => setKeyboardShortcutsModalOpen(false)}
      >
        <ul className="space-y-2 text-xs text-foreground max-h-[50vh] overflow-y-auto pr-1">
          <ShortcutRow keys={`${m}S`} desc="Save current file" />
          <ShortcutRow keys={`${m}F`} desc="Find in current file" />
          <ShortcutRow keys={`${m}↵`} desc="Compile project" />
          <p className="text-[11px] text-muted-foreground pt-2 border-t border-border">
            Use the menu bar for Save all, Replace, project search, and LaTeX-specific inserts. Cut, Copy,
            Paste, Undo, and Select all are available from the Edit menu (and usually from native text
            shortcuts in the editor).
          </p>
        </ul>
      </ConfirmDialog>
    </header>
  );
}

function ShortcutRow({ keys, desc }: { keys: string; desc: string }) {
  return (
    <li className="flex justify-between gap-4">
      <span className="text-muted-foreground">{desc}</span>
      <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{keys}</kbd>
    </li>
  );
}

function TopMenu({ label, items }: { label: string; items: MenuEntry[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="text-[12px] font-medium text-foreground/80 hover:text-foreground hover:bg-muted px-2 py-0.5 rounded transition-colors"
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 max-h-[min(70vh,520px)] overflow-y-auto z-[140]">
        {items.map((entry, i) => {
          if (entry.type === "separator") {
            return <DropdownMenuSeparator key={`sep-${i}`} />;
          }
          if (entry.type === "label") {
            return (
              <DropdownMenuLabel key={`lab-${entry.text}-${i}`} className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {entry.text}
              </DropdownMenuLabel>
            );
          }
          return (
            <DropdownMenuItem
              key={`${entry.label}-${i}`}
              disabled={entry.disabled}
              onSelect={(e) => {
                if (entry.disabled) e.preventDefault();
                else entry.action?.();
              }}
              className="text-xs gap-2 flex justify-between items-center cursor-pointer"
            >
              <span>{entry.label}</span>
              {entry.shortcut ? (
                <kbd className="ml-4 shrink-0 rounded border bg-muted/80 px-1 py-px font-mono text-[10px] text-muted-foreground">
                  {entry.shortcut}
                </kbd>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
