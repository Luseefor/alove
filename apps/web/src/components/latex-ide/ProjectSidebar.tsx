"use client";

import { isLocalStandalone } from "@/lib/localStandalone";
import { MAX_FILE_BYTES as CLOUD_MAX_FILE_BYTES } from "@/lib/cloudProjectLimits";

import { useWorkbenchStore, ProjectFile } from "@/stores/workbenchStore";
import {
  Folder,
  FileCode,
  FileType,
  FileImage,
  FileText,
  ChevronRight,
  MoreVertical,
  Search,
  FilePlus,
  FolderPlus,
  Upload,
  Pencil,
  Trash2,
  Layout,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectService } from "@/services/ProjectService";
import {
  PROJECT_MAX_FILE_BYTES,
  shouldStoreUploadAsDataUrl,
  uploadLogicalPathFor,
  utf8ByteLength,
  validateNewProjectPath,
  validateProjectFileContentSize,
  validateProjectFolderPath,
  validateRenameProjectPath,
} from "@/lib/projectPath";

async function readFileForProjectPath(
  file: File,
  logicalPath: string,
): Promise<string> {
  if (file.size > PROJECT_MAX_FILE_BYTES)
    throw new Error(`"${logicalPath}" is too large (max 1 MB).`);
  const asDataUrl = shouldStoreUploadAsDataUrl(logicalPath, file.type);
  let content: string;
  if (asDataUrl) {
    content = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(`Could not read "${logicalPath}".`));
      r.readAsDataURL(file);
    });
  } else {
    try {
      content = await file.text();
    } catch {
      throw new Error(`Could not read "${logicalPath}".`);
    }
  }
  if (utf8ByteLength(content) > PROJECT_MAX_FILE_BYTES) {
    throw new Error(`"${logicalPath}" is too large (max 1 MB).`);
  }
  const sizeCheck = validateProjectFileContentSize(
    logicalPath,
    content,
    isLocalStandalone() ? undefined : CLOUD_MAX_FILE_BYTES,
  );
  if (!sizeCheck.ok) throw new Error(sizeCheck.error);
  return content;
}

export function ProjectSidebar() {
  const {
    projectTitle,
    filesByPath,
    activeRail,
    activeFileId,
    outline,
    setActiveRail,
    createFile,
    projectSearchQuery,
    projectSearchResults,
    runProjectSearch,
    clearProjectSearch,
    jumpToDiagnostic,
    appendToActiveFile,
    wrapSelectionOrInsert,
  } = useWorkbenchStore();

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [projectSearchInput, setProjectSearchInput] =
    useState(projectSearchQuery);

  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("notes.tex");
  const [newFileError, setNewFileError] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState("figures");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [projectSearchError, setProjectSearchError] = useState<string | null>(
    null,
  );
  const [sidebarTab, setSidebarTab] = useState<"snippets" | "outline">(
    "snippets",
  );
  const [snippetSearch, setSnippetSearch] = useState("");

  const handleProjectUploads = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploadError(null);
    try {
      for (const file of Array.from(list)) {
        const rel = (file as File & { webkitRelativePath?: string })
          .webkitRelativePath;
        const rawPath = uploadLogicalPathFor(file.name, rel);
        if (!rawPath || rawPath.endsWith("/")) continue;
        const checked = validateNewProjectPath(
          rawPath,
          useWorkbenchStore.getState().filesByPath,
        );
        if (!checked.ok) throw new Error(checked.error);
        const content = await readFileForProjectPath(file, checked.path);
        createFile(checked.path, content);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    }
  };

  const confirmNewFile = () => {
    // UI convenience: trim surrounding whitespace, then validate the exact
    // stored path strictly (validator rejects padded/unsafe actual paths).
    const trimmed = newFilePath.trim();
    const checked = validateNewProjectPath(
      trimmed,
      useWorkbenchStore.getState().filesByPath,
    );
    if (!checked.ok) {
      setNewFileError(checked.error);
      return;
    }
    createFile(checked.path, "");
    setNewFileOpen(false);
    setNewFileError(null);
  };

  const confirmNewFolder = () => {
    // UI convenience: trim whitespace and trailing slashes, then validate
    // the exact folder name strictly.
    const trimmed = newFolderPath.trim().replace(/\/+$/, "");
    const checked = validateProjectFolderPath(
      trimmed,
      useWorkbenchStore.getState().filesByPath,
    );
    if (!checked.ok) {
      setNewFolderError(checked.error);
      return;
    }
    createFile(
      checked.keepPath,
      "# Folder placeholder (safe to delete once you add real files here)\n",
      {
        open: false,
      },
    );
    setNewFolderOpen(false);
    setNewFolderError(null);
  };

  const runGlobalFind = () => {
    setProjectSearchError(null);
    try {
      runProjectSearch(projectSearchInput, {
        texOnly: false,
        regex: searchRegex,
        caseSensitive: searchCaseSensitive,
      });
    } catch (e) {
      setProjectSearchError(
        e instanceof Error ? e.message : "Invalid search pattern.",
      );
    }
  };

  const clearGlobalFind = () => {
    setProjectSearchInput("");
    setProjectSearchError(null);
    clearProjectSearch();
  };

  const fileTree = useMemo(
    () =>
      ProjectService.buildTree(
        Object.entries(filesByPath).map(([path, content]) => ({
          path,
          content,
        })),
      ),
    [filesByPath],
  );
  const filteredTree = filterTree(fileTree, "");

  const snippets = [
    {
      label: "Figure",
      code: "\\begin{figure}[htbp]\n  \\centering\n  % \\includegraphics[width=\\linewidth]{figure.png}\n  \\caption{Caption text.}\n  \\label{fig:example}\n\\end{figure}",
      icon: Layout,
    },
    {
      label: "Table",
      code: "\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{lcc}\n    A & B & C \\\\\n  \\end{tabular}\n  \\caption{Table caption.}\n  \\label{tab:example}\n\\end{table}",
      icon: FileText,
    },
    {
      label: "Theorem",
      code: "\\begin{theorem}\nStatement.\n\\end{theorem}",
      icon: FileCode,
    },
    {
      label: "Fraction",
      code: "\\frac{a}{b}",
      icon: FileCode,
      wrap: ["\\frac{", "}{b}"],
    },
    { label: "Summation", code: "\\sum_{i=1}^{n} i", icon: FileCode },
    { label: "Integral", code: "\\int_{a}^{b} f(x) dx", icon: FileCode },
    {
      label: "Equation",
      code: "\\begin{equation}\n  E = mc^2\n\\end{equation}",
      icon: FileCode,
      wrap: ["\\begin{equation}\n", "\n\\end{equation}"],
    },
    {
      label: "Align",
      code: "\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}",
      icon: FileCode,
    },
  ].filter((s) => s.label.toLowerCase().includes(snippetSearch.toLowerCase()));

  if (activeRail === "search") {
    return (
      <aside className="w-full h-full flex flex-col bg-background select-none border-r shrink-0">
        <div className="h-10 border-b px-3 flex items-center justify-between bg-muted/50">
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Global Search
          </span>
          <button
            type="button"
            onClick={clearGlobalFind}
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
                value={projectSearchInput}
                onChange={(e) => {
                  setProjectSearchInput(e.target.value);
                  if (projectSearchError) setProjectSearchError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runGlobalFind();
                  }
                }}
                placeholder="Search text in project..."
                className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
              />
            </div>
            <button
              type="button"
              onClick={runGlobalFind}
              className="h-8 px-4 rounded-lg bg-primary text-white text-[11px] font-bold shadow-md shadow-primary/10 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Find
            </button>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-bold text-muted-foreground uppercase tracking-wide px-1">
            <label className="inline-flex items-center gap-2 cursor-pointer hover:text-muted-foreground transition-colors">
              <input
                type="checkbox"
                checked={searchRegex}
                onChange={(e) => setSearchRegex(e.target.checked)}
                className="w-3 h-3 rounded border-zinc-300 text-primary focus:ring-primary/20"
              />
              Regex
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer hover:text-muted-foreground transition-colors">
              <input
                type="checkbox"
                checked={searchCaseSensitive}
                onChange={(e) => setSearchCaseSensitive(e.target.checked)}
                className="w-3 h-3 rounded border-zinc-300 text-primary focus:ring-primary/20"
              />
              Case Sensitive
            </label>
          </div>
          {projectSearchError ? (
            <p
              role="alert"
              className="text-[11px] text-error bg-error-bg border border-error-border rounded-lg px-3 py-2"
            >
              {projectSearchError}
            </p>
          ) : null}
        </div>
        <div className="px-3 py-2 text-[10px] font-bold text-muted-foreground bg-muted/50 border-y border-border flex justify-between">
          <span>{projectSearchResults.length} matches</span>
          {projectSearchQuery && (
            <span className="truncate max-w-[150px]">
              for &quot;{projectSearchQuery}&quot;
            </span>
          )}
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1 bg-background">
          {projectSearchResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4 space-y-3">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-zinc-300 border border-border">
                <Search aria-hidden="true" className="w-6 h-6" />
              </div>
              <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">
                No results yet. Enter a query and click Find to search across
                all files.
              </p>
            </div>
          ) : (
            projectSearchResults.slice(0, 500).map((r, idx) => (
              <button
                key={`${r.path}-${r.line}-${r.column}-${idx}`}
                onClick={() =>
                  jumpToDiagnostic({
                    severity: "info",
                    message: r.preview,
                    file: r.path,
                    line: r.line,
                    column: r.column,
                  })
                }
                className="w-full text-left rounded-xl border border-border p-3 hover:bg-muted hover:border-primary/20 transition-all group shadow-sm mb-2"
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="text-[11px] font-bold text-foreground group-hover:text-primary transition-colors truncate pr-2">
                    {r.path}
                  </div>
                  <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight shrink-0">
                    Ln {r.line}
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground font-medium line-clamp-2 leading-relaxed bg-muted/50 p-2 rounded-lg border border-border/50 italic group-hover:bg-background transition-colors">
                  {r.preview}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full h-full flex flex-col bg-background select-none border-r shrink-0">
      {/* Project Header */}
      <div className="h-12 border-b flex items-center justify-between px-4 shrink-0 bg-background">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-black uppercase tracking-widest text-muted-foreground">
            Project
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            icon={Search}
            title="Search Files"
            onClick={() => setActiveRail("search")}
          />
          <IconButton
            icon={Plus}
            title="New"
            onClick={() => setNewFileOpen(true)}
          />
        </div>
      </div>

      {/* File Tree Section */}
      <div className="flex-[3] flex flex-col min-h-0">
        {/* Tree Toolbar */}
        <div className="h-9 flex items-center justify-between px-3 shrink-0 bg-muted/30 border-b border-border">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
            <span
              className="truncate text-[11px] font-medium text-foreground"
              title={projectTitle}
            >
              {projectTitle}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <SidebarAction
              icon={FilePlus}
              title="New file"
              onClick={() => setNewFileOpen(true)}
            />
            <SidebarAction
              icon={FolderPlus}
              title="New folder"
              onClick={() => setNewFolderOpen(true)}
            />
            <SidebarAction
              icon={Upload}
              title="Upload files"
              onClick={() => uploadInputRef.current?.click()}
            />
          </div>
        </div>

        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".tex,.bib,.sty,.md,.txt,.csv,.json,.cls,.bst,.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf"
          onChange={(e) => {
            void handleProjectUploads(e.target.files);
            e.currentTarget.value = "";
          }}
        />

        {uploadError ? (
          <div className="px-3 py-1.5 text-[11px] text-error border-b bg-error-bg border-error-border">
            {uploadError}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto pt-1 min-h-0 bg-background">
          {filteredTree.length === 0 ? (
            <div className="px-6 py-12 text-center space-y-3">
              <div className="w-10 h-10 mx-auto rounded-full bg-muted flex items-center justify-center text-zinc-300 border border-border">
                <FileText aria-hidden="true" className="w-5 h-5" />
              </div>
              <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">
                No files match your search.
              </p>
            </div>
          ) : (
            filteredTree.map((file) => (
              <FileRow key={file.id} file={file} level={0} />
            ))
          )}
        </div>
      </div>

      {/* Combined Snippets + Outline Section */}
      <div className="flex-[2] min-h-0 border-t flex flex-col bg-background">
        <div className="h-10 px-1 border-b flex items-center bg-muted/50">
          <SidebarTab
            active={sidebarTab === "snippets"}
            onClick={() => setSidebarTab("snippets")}
            label="Snippets"
          />
          <SidebarTab
            active={sidebarTab === "outline"}
            onClick={() => setSidebarTab("outline")}
            label="Outline"
          />
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {sidebarTab === "snippets" ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-2 border-b border-border flex gap-2 bg-background">
                <div className="relative flex-1 group">
                  <Search
                    aria-hidden="true"
                    className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground group-focus-within:text-primary transition-colors"
                  />
                  <input
                    aria-label="Search snippets"
                    value={snippetSearch}
                    onChange={(e) => setSnippetSearch(e.target.value)}
                    placeholder="Search snippets..."
                    className="w-full bg-muted/50 hover:bg-muted focus:bg-background rounded-lg h-7 pl-7 pr-3 text-[11px] outline-none border border-transparent focus:border-border transition-all font-medium"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-background">
                {snippets.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-4 font-medium italic">
                    No snippets found.
                  </p>
                ) : (
                  snippets.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      data-testid={`sidebar-snippet-${s.label}`}
                      onClick={() =>
                        s.wrap
                          ? wrapSelectionOrInsert(s.wrap[0], s.wrap[1], s.code)
                          : appendToActiveFile(s.code)
                      }
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-muted border border-transparent hover:border-border group transition-all active:scale-[0.98]"
                    >
                      <div className="w-5 h-5 bg-muted rounded-md flex items-center justify-center text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                        <s.icon aria-hidden="true" size={11} />
                      </div>
                      <span className="text-[11px] font-bold text-muted-foreground group-hover:text-foreground transition-colors">
                        {s.label}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto py-2 px-2 bg-background">
              {outline.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4 space-y-2 opacity-40">
                  <Layout
                    aria-hidden="true"
                    className="w-6 h-6 text-muted-foreground"
                  />
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                    No outline data
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {outline.map((node) => (
                    <RecursiveOutlineItem
                      key={node.id}
                      node={node}
                      onJump={(line) =>
                        jumpToDiagnostic({
                          severity: "info",
                          message: `Jump to ${node.title}`,
                          file: activeFileId || "main.tex",
                          line,
                          column: 1,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        open={newFileOpen}
        title="Create new file"
        description="Provide a path relative to project root."
        confirmLabel="Create"
        cancelLabel="Cancel"
        onCancel={() => {
          setNewFileOpen(false);
          setNewFileError(null);
        }}
        onConfirm={confirmNewFile}
      >
        <input
          aria-label="New file path"
          value={newFilePath}
          onChange={(e) => {
            setNewFilePath(e.target.value);
            if (newFileError) setNewFileError(null);
          }}
          className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary shadow-sm"
          autoFocus
        />
        {newFileError ? (
          <p
            role="alert"
            className="mt-2 text-[12px] text-error bg-error-bg border border-error-border rounded-lg px-3 py-2"
          >
            {newFileError}
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={newFolderOpen}
        title="Create new folder"
        description="Enter a folder path relative to the project root."
        confirmLabel="Create Folder"
        cancelLabel="Cancel"
        onCancel={() => {
          setNewFolderOpen(false);
          setNewFolderError(null);
        }}
        onConfirm={confirmNewFolder}
      >
        <input
          aria-label="New folder path"
          value={newFolderPath}
          onChange={(e) => {
            setNewFolderPath(e.target.value);
            if (newFolderError) setNewFolderError(null);
          }}
          placeholder="figures"
          className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary shadow-sm"
          autoFocus
        />
        {newFolderError ? (
          <p
            role="alert"
            className="mt-2 text-[12px] text-error bg-error-bg border border-error-border rounded-lg px-3 py-2"
          >
            {newFolderError}
          </p>
        ) : null}
      </ConfirmDialog>
    </aside>
  );
}

function IconButton({
  icon: Icon,
  title,
  onClick,
}: {
  icon: LucideIcon;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden="true" className="w-4 h-4" />
    </button>
  );
}

function SidebarTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "px-4 py-3 text-[11px] font-black uppercase tracking-[0.15em] transition-all relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-muted-foreground",
      )}
    >
      {label}
      {active && (
        <div
          aria-hidden="true"
          className="absolute bottom-0 inset-x-4 h-0.5 bg-primary rounded-t-full shadow-[0_0_8px_rgba(124,58,237,0.5)]"
        />
      )}
    </button>
  );
}

function RecursiveOutlineItem({
  node,
  onJump,
}: {
  node: import("@/services/OutlineService").OutlineNode;
  onJump: (line: number) => void;
}) {
  return (
    <div className="space-y-0.5">
      <OutlineItem
        label={node.title}
        level={node.level}
        onClick={() => onJump(node.line)}
      />
      {node.children && node.children.length > 0 && (
        <div className="space-y-0.5 px-0.5">
          {node.children.map((child) => (
            <RecursiveOutlineItem key={child.id} node={child} onJump={onJump} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarAction({
  icon: Icon,
  onClick,
  title,
}: {
  icon: LucideIcon;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden="true" size={14} />
    </button>
  );
}

function OutlineItem({
  label,
  level,
  onClick,
}: {
  label: string;
  level: number;
  onClick: () => void;
}) {
  const depth = Math.max(0, level - 1);
  const indent = depth * 12;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Go to ${label}`}
      className={cn(
        "group relative w-full min-h-7 flex items-center text-[11px] text-left rounded-lg px-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        "text-muted-foreground hover:bg-muted hover:text-foreground hover:pl-3",
      )}
      style={{ paddingLeft: `${indent + 8}px` }}
    >
      {depth > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px bg-muted left-2"
          style={{ left: `${indent + 4}px` }}
        />
      )}
      <span className="truncate py-1 font-semibold">{label}</span>
      <ChevronRight
        aria-hidden="true"
        size={10}
        className="ml-auto opacity-0 group-hover:opacity-40 transition-opacity"
      />
    </button>
  );
}

function FileRow({ file, level }: { file: ProjectFile; level: number }) {
  const {
    activeFileId,
    openFile,
    deleteFile,
    renameFile,
    mainFile,
    setMainFile,
  } = useWorkbenchStore();
  const [isOpen, setIsOpen] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renamePathInput, setRenamePathInput] = useState(file.path);
  const [renameError, setRenameError] = useState<string | null>(null);

  const isFolder = file.type === "folder";
  const isActive = activeFileId === file.path;

  const Icon = isFolder
    ? Folder
    : file.path.endsWith(".tex")
      ? FileCode
      : file.path.endsWith(".bib")
        ? FileType
        : file.type === "image"
          ? FileImage
          : FileText;
  const indent = level * 12;

  const confirmRename = () => {
    // UI convenience: trim, then validate the exact stored path strictly.
    const trimmed = renamePathInput.trim();
    if (!trimmed) {
      setRenameError("Enter a project-relative path.");
      return;
    }
    if (trimmed === file.path) {
      setRenameOpen(false);
      setRenameError(null);
      return;
    }
    const checked = validateRenameProjectPath(
      file.path,
      trimmed,
      useWorkbenchStore.getState().filesByPath,
    );
    if (!checked.ok) {
      setRenameError(checked.error);
      return;
    }
    renameFile(file.path, checked.path);
    setRenameOpen(false);
    setRenameError(null);
  };

  return (
    <div className="group relative w-full px-1">
      <div
        role="button"
        tabIndex={0}
        aria-label={
          isFolder
            ? `${isOpen ? "Collapse" : "Expand"} folder ${file.path}`
            : `Open file ${file.path}`
        }
        aria-expanded={isFolder ? isOpen : undefined}
        aria-current={isActive ? "true" : undefined}
        className={cn(
          "relative w-full min-h-8 flex items-center transition-all rounded-lg group/row focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isActive
            ? "bg-primary/5 text-primary border border-primary/10 shadow-sm"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        style={{ paddingLeft: `${indent + 6}px` }}
        onClick={() => (isFolder ? setIsOpen(!isOpen) : openFile(file.path))}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          // Ignore keys from nested controls (e.g. the file actions menu
          // button): preventDefault here would block their native activation
          // and wrongly open the file instead.
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (isFolder) setIsOpen(!isOpen);
          else openFile(file.path);
        }}
      >
        <div
          aria-hidden="true"
          className="relative shrink-0 flex items-center mr-2"
        >
          {isFolder && (
            <ChevronRight
              size={12}
              className={cn(
                "mr-0.5 transition-transform text-muted-foreground",
                isOpen && "rotate-90",
              )}
            />
          )}
          <Icon
            size={14}
            strokeWidth={isActive ? 2.5 : 2}
            className={cn(
              isActive
                ? "text-primary"
                : "text-muted-foreground group-hover/row:text-muted-foreground",
            )}
          />
        </div>
        <span
          title={file.path}
          className={cn(
            "min-w-0 text-[12px] font-medium truncate flex-1",
            isActive && "text-primary",
          )}
        >
          {file.name}
        </span>

        {file.path.endsWith(".tex") && (
          <span className="text-[9px] font-black uppercase tracking-tighter text-primary/40 mr-1.5 bg-primary/5 px-1 rounded-sm border border-primary/5">
            {mainFile === file.path ? "MAIN" : "TEX"}
          </span>
        )}
        {file.path.endsWith(".bib") && (
          <span className="text-[9px] font-black uppercase tracking-tighter text-violet-400 mr-1.5 bg-violet-50 px-1 rounded-sm border border-violet-50">
            BIB
          </span>
        )}

        {!isFolder && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`File actions for ${file.path}`}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-all",
                  "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 hover:bg-background hover:text-foreground shadow-sm border border-transparent hover:border-border",
                )}
              >
                <MoreVertical aria-hidden="true" size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[9rem] rounded-xl shadow-xl p-1.5 border-border"
            >
              {file.path.endsWith(".tex") && (
                <DropdownMenuItem
                  disabled={mainFile === file.path}
                  onSelect={(event) => {
                    event.stopPropagation();
                    setMainFile(file.path);
                  }}
                >
                  Set as Main Document
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="rounded-lg font-semibold text-xs gap-3 p-2 cursor-pointer"
                onSelect={(e) => {
                  e.stopPropagation();
                  setRenamePathInput(file.path);
                  setRenameError(null);
                  setRenameOpen(true);
                }}
              >
                <Pencil
                  aria-hidden="true"
                  size={14}
                  className="text-muted-foreground"
                />
                Rename…
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-muted" />
              <DropdownMenuItem
                className="rounded-lg font-semibold text-xs gap-3 p-2 text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer"
                onSelect={(e) => {
                  e.stopPropagation();
                  setDeleteOpen(true);
                }}
              >
                <Trash2 aria-hidden="true" size={14} className="text-red-400" />
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {isFolder &&
        isOpen &&
        file.children?.map((child) => (
          <FileRow key={child.id} file={child} level={level + 1} />
        ))}

      {!isFolder && (
        <>
          <ConfirmDialog
            open={renameOpen}
            title="Rename file"
            description="Use a project-relative path."
            confirmLabel="Rename"
            cancelLabel="Cancel"
            onCancel={() => {
              setRenameOpen(false);
              setRenameError(null);
            }}
            onConfirm={confirmRename}
          >
            <input
              aria-label="Rename file to"
              value={renamePathInput}
              onChange={(e) => {
                setRenamePathInput(e.target.value);
                if (renameError) setRenameError(null);
              }}
              className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary shadow-sm"
              autoFocus
            />
            {renameError ? (
              <p
                role="alert"
                className="mt-2 text-[12px] text-error bg-error-bg border border-error-border rounded-lg px-3 py-2"
              >
                {renameError}
              </p>
            ) : null}
          </ConfirmDialog>
          <ConfirmDialog
            open={deleteOpen}
            title={`Delete ${file.name}?`}
            description="This will remove the file from the project."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            onCancel={() => setDeleteOpen(false)}
            onConfirm={() => {
              deleteFile(file.path);
              setDeleteOpen(false);
            }}
          />
        </>
      )}
    </div>
  );
}

function filterTree(nodes: ProjectFile[], query: string): ProjectFile[] {
  if (!query.trim()) return nodes;
  const lower = query.toLowerCase();
  return nodes
    .map((node) => {
      if (node.type === "folder") {
        const children = filterTree(node.children ?? [], query);
        if (children.length > 0 || node.name.toLowerCase().includes(lower)) {
          return { ...node, children };
        }
        return null;
      }
      return node.name.toLowerCase().includes(lower) ? node : null;
    })
    .filter((n): n is ProjectFile => Boolean(n));
}
