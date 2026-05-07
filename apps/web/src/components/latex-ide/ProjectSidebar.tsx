"use client";

import { useWorkbenchStore, ProjectFile } from "@/stores/workbenchStore";
import {
  Folder,
  FileCode,
  FileType,
  FileImage,
  FileText,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Search,
  FilePlus,
  FolderPlus,
  Upload,
  Pencil,
  Trash2,
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

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

async function readFileForProjectPath(file: File, logicalPath: string): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`"${logicalPath}" is too large (max 4 MB).`);
  }
  const lower = logicalPath.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(lower)) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(`Could not read "${logicalPath}".`));
      r.readAsDataURL(file);
    });
  }
  if (/\.pdf$/i.test(lower)) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(`Could not read "${logicalPath}".`));
      r.readAsDataURL(file);
    });
  }
  return file.text();
}

export function ProjectSidebar() {
  const {
    filesByPath,
    activeRail,
    activeFileId,
    openFile,
    outline,
    createFile,
    projectSearchQuery,
    projectSearchResults,
    runProjectSearch,
    clearProjectSearch,
    jumpToDiagnostic,
  } = useWorkbenchStore();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectSearchInput, setProjectSearchInput] = useState(projectSearchQuery);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("notes.tex");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState("figures");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleProjectUploads = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploadError(null);
    try {
      for (const file of Array.from(list)) {
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        const path = (rel && rel.length > 0 ? rel : file.name).replace(/\\/g, "/");
        if (!path || path.endsWith("/")) continue;
        if (path in useWorkbenchStore.getState().filesByPath) {
          throw new Error(`A file already exists at "${path}". Remove it or pick another name.`);
        }
        const content = await readFileForProjectPath(file, path);
        createFile(path, content);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    }
  };

  const confirmNewFolder = () => {
    const base = newFolderPath.trim().replace(/^\/+/, "").replace(/\/+$/, "").replace(/\\/g, "/");
    if (!base) return;
    const keepPath = `${base}/.gitkeep`;
    const { filesByPath } = useWorkbenchStore.getState();
    if (keepPath in filesByPath) {
      setUploadError(`A file already exists at "${keepPath}".`);
      return;
    }
    if (base in filesByPath) {
      setUploadError(`A file already exists at "${base}".`);
      return;
    }
    createFile(keepPath, "# Folder placeholder (safe to delete once you add real files here)\n", {
      open: false,
    });
    setNewFolderOpen(false);
    setUploadError(null);
  };
  /** Tree is always derived from live workspace files (includes newly created local files). */
  const fileTree = useMemo(
    () =>
      ProjectService.buildTree(
        Object.entries(filesByPath).map(([path, content]) => ({ path, content })),
      ),
    [filesByPath],
  );
  const filteredTree = filterTree(fileTree, searchQuery);

  if (activeRail === "search") {
    return (
      <aside className="w-full h-full flex flex-col bg-background select-none border-r isolate">
        <div className="h-10 border-b px-3 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider">Search</span>
          <button
            onClick={clearProjectSearch}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
        <div className="p-2 border-b">
          <div className="flex gap-2">
            <input
              value={projectSearchInput}
              onChange={(e) => setProjectSearchInput(e.target.value)}
              placeholder="Search in project..."
              className="h-8 flex-1 rounded border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() =>
                runProjectSearch(projectSearchInput, {
                  texOnly: false,
                  regex: searchRegex,
                  caseSensitive: searchCaseSensitive,
                })
              }
              className="h-8 px-2 rounded bg-primary text-primary-foreground text-xs"
            >
              Find
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={searchRegex}
                onChange={(e) => setSearchRegex(e.target.checked)}
              />
              Regex
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={searchCaseSensitive}
                onChange={(e) => setSearchCaseSensitive(e.target.checked)}
              />
              Case sensitive
            </label>
          </div>
        </div>
        <div className="px-3 py-2 text-xs text-muted-foreground border-b">
          {projectSearchResults.length} matches
          {projectSearchQuery ? ` for "${projectSearchQuery}"` : ""}
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {projectSearchResults.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-4">
              No results yet. Enter a query and click Find.
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
                className="w-full text-left rounded border px-2 py-1.5 hover:bg-muted/60"
              >
                <div className="text-[11px] font-medium truncate">{r.path}</div>
                <div className="text-[10px] text-muted-foreground">Ln {r.line}, Col {r.column}</div>
                <div className="text-[11px] text-foreground/80 truncate mt-0.5">{r.preview}</div>
              </button>
            ))
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full h-full flex flex-col bg-background select-none border-r isolate">
      {/* File Tree Section */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="h-9 flex items-center justify-between px-3 shrink-0 border-b">
          <div className="flex items-center gap-2">
            <ChevronDown size={14} className="text-muted-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-wider">File tree</span>
          </div>
          <div className="flex items-center gap-1">
            <SidebarAction
              icon={FilePlus}
              title="New file"
              onClick={() => setNewFileOpen(true)}
            />
            <SidebarAction
              icon={FolderPlus}
              title="New folder"
              onClick={() => {
                setNewFolderPath("figures");
                setNewFolderOpen(true);
              }}
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
          <div className="px-3 py-1.5 text-[11px] text-destructive border-b bg-destructive/5">{uploadError}</div>
        ) : null}
        <div className="p-2 border-b">
          <div className="relative group">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full bg-muted/50 rounded h-7 pl-7 pr-3 text-[12px] outline-none border border-transparent focus:border-border transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pt-1 min-h-0">
          {filteredTree.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">No files match your search.</div>
          ) : (
            filteredTree.map((file) => <FileRow key={file.id} file={file} level={0} />)
          )}
        </div>
      </div>

      {/* Outline Section */}
      <div className="h-1/3 border-t flex flex-col min-h-0">
        <div className="h-9 flex items-center gap-2 px-3 shrink-0 border-b">
          <ChevronDown size={14} className="text-muted-foreground" />
          <span className="text-[11px] font-bold uppercase tracking-wider">File outline</span>
        </div>
        <div className="flex-1 overflow-y-auto py-1 px-2 min-h-0">
          {outline.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-2">
              No headings in active file.
            </div>
          ) : (
            outline.map((node) => <OutlineItem key={node.id} label={node.title} level={node.level} />)
          )}
        </div>
      </div>
      <ConfirmDialog
        open={newFileOpen}
        title="Create new file"
        description="Use a relative path such as `sections/methods.tex`."
        confirmLabel="Create"
        cancelLabel="Cancel"
        onCancel={() => setNewFileOpen(false)}
        onConfirm={() => {
          const trimmed = newFilePath.trim();
          if (trimmed) createFile(trimmed, "");
          setNewFileOpen(false);
        }}
      >
        <input
          value={newFilePath}
          onChange={(e) => setNewFilePath(e.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={newFolderOpen}
        title="Create new folder"
        description="Enter a folder path relative to the project root (e.g. `figures` or `sections/ch1`). A small placeholder file is added so the folder syncs to the server."
        confirmLabel="Create folder"
        cancelLabel="Cancel"
        onCancel={() => {
          setNewFolderOpen(false);
          setUploadError(null);
        }}
        onConfirm={confirmNewFolder}
      >
        <input
          value={newFolderPath}
          onChange={(e) => setNewFolderPath(e.target.value)}
          placeholder="figures"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
        />
      </ConfirmDialog>
    </aside>
  );
}

function SidebarAction({ icon: Icon, onClick, title }: { icon: LucideIcon; onClick?: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
    >
      <Icon size={14} />
    </button>
  );
}

function OutlineItem({ label, level, active }: { label: string; level: number; active?: boolean }) {
  const depth = Math.max(0, level - 1);
  const indent = depth * 12 + 10;
  return (
    <div
      className={cn(
        "relative h-7 flex items-center text-[12px] cursor-pointer truncate rounded px-2 transition-colors",
        active
          ? "bg-primary/10 text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
      style={{ paddingLeft: `${indent + 8}px` }}
    >
      {depth > 0 && (
        <span
          aria-hidden
          className="absolute top-0 bottom-0 w-px bg-border/60"
          style={{ left: `${indent}px` }}
        />
      )}
      {active && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r" />}
      {label}
    </div>
  );
}

function FileRow({ file, level }: { file: ProjectFile; level: number }) {
  const { activeFileId, openFile, deleteFile, renameFile } = useWorkbenchStore();
  const [isOpen, setIsOpen] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renamePathInput, setRenamePathInput] = useState(file.path);

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
  const indent = level * 12 + 10;

  const rowClass = cn(
    "relative w-full h-7 flex items-stretch text-left transition-colors rounded-sm",
    isActive
      ? "bg-primary/10 text-foreground"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
  );

  const confirmRename = () => {
    const next = renamePathInput.trim().replace(/\\/g, "/");
    const { filesByPath } = useWorkbenchStore.getState();
    if (!next || next === file.path) {
      setRenameOpen(false);
      return;
    }
    if (next in filesByPath) return;
    renameFile(file.path, next);
    setRenameOpen(false);
  };

  return (
    <div className="group relative w-full">
      {isActive && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 bottom-0 z-[1] w-0.5 bg-primary rounded-r"
        />
      )}
      <div className={rowClass} style={{ paddingLeft: `${indent + 8}px` }}>
        {level > 0 && (
          <span
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-border/60"
            style={{ left: `${indent}px` }}
          />
        )}
        <button
          type="button"
          onClick={() => (isFolder ? setIsOpen(!isOpen) : openFile(file.path))}
          className="flex-1 min-w-0 flex items-center gap-2 py-0 pr-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm"
        >
          <div className="relative shrink-0 flex items-center">
            {isFolder && (
              <ChevronRight
                size={12}
                className={cn("mr-0.5 transition-transform text-muted-foreground", isOpen && "rotate-90")}
              />
            )}
            <Icon size={13} className={cn(isActive ? "text-primary" : "text-muted-foreground")} />
          </div>
          <span className={cn("text-[12px] truncate ml-1", isActive && "font-semibold")}>{file.name}</span>
        </button>
        {!isFolder && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="File actions"
                className={cn(
                  "shrink-0 flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground outline-none transition-opacity",
                  "opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-primary data-[state=open]:opacity-100",
                )}
              >
                <MoreVertical size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[9rem]">
              <DropdownMenuItem
                className="text-xs gap-2"
                onSelect={() => {
                  setRenamePathInput(file.path);
                  setRenameOpen(true);
                }}
              >
                <Pencil size={12} className="opacity-70" />
                Rename…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 size={12} className="opacity-70" />
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {isFolder &&
        isOpen &&
        file.children?.map((child) => <FileRow key={child.id} file={child} level={level + 1} />)}
      {!isFolder && (
        <>
          <ConfirmDialog
            open={renameOpen}
            title="Rename file"
            description="Use a project-relative path (e.g. sections/methods.tex)."
            confirmLabel="Rename"
            cancelLabel="Cancel"
            onCancel={() => setRenameOpen(false)}
            onConfirm={confirmRename}
          >
            <input
              value={renamePathInput}
              onChange={(e) => setRenamePathInput(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
            />
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
