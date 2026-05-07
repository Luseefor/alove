"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import {
  FilePlus,
  Upload,
  FileText,
  Quote,
  FunctionSquare,
  Download,
  ChevronDown,
  Search,
  Layout
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BibliographyService } from "@/services/BibliographyService";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ActionToolbar() {
  const {
    createFile,
    appendToActiveFile,
    transformActiveFile,
    runCompile,
    saveActiveFile,
    setActiveRail,
    runProjectSearch,
    toggleSidebar,
    toggleBottomPanel,
    activeFileId,
    filesByPath,
    wrapSelectionOrInsert,
  } = useWorkbenchStore();
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("scratch.tex");
  const [templateConfirmOpen, setTemplateConfirmOpen] = useState(false);
  const [quickSearch, setQuickSearch] = useState("");
  const [templateMode, setTemplateMode] = useState<"replace-file" | "replace-body" | "new-file">("replace-file");
  const [templateNewFilePath, setTemplateNewFilePath] = useState("template.tex");
  const [pendingTemplate, setPendingTemplate] = useState<null | {
    label: string;
    content: string;
  }>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const templates = [
    {
      label: "Article",
      content:
        "\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\title{New Article}\n\\author{Author}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\\begin{abstract}\nWrite your abstract.\n\\end{abstract}\n\n\\section{Introduction}\nStart here.\n\\end{document}\n",
    },
    {
      label: "Report",
      content:
        "\\documentclass{report}\n\\title{Project Report}\n\\author{Author}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\\tableofcontents\n\\chapter{Overview}\n\\section{Background}\n\\end{document}\n",
    },
    {
      label: "Beamer",
      content:
        "\\documentclass{beamer}\n\\title{Presentation Title}\n\\author{Author}\n\\date{\\today}\n\n\\begin{document}\n\\frame{\\titlepage}\n\\begin{frame}{Agenda}\n\\tableofcontents\n\\end{frame}\n\\end{document}\n",
    },
    {
      label: "IEEE",
      content:
        "\\documentclass[conference]{IEEEtran}\n\\usepackage{cite}\n\\title{Paper Title}\n\\author{\\IEEEauthorblockN{Author}}\n\n\\begin{document}\n\\maketitle\n\\begin{abstract}\nAbstract text.\n\\end{abstract}\n\\section{Introduction}\n\\end{document}\n",
    },
  ] as const;

  const handleUpload = async (file: File) => {
    const text = await file.text();
    createFile(file.name, text);
  };
  const bibEntries = Object.entries(filesByPath)
    .filter(([path]) => path.endsWith(".bib"))
    .flatMap(([, content]) => BibliographyService.parse(content));
  const snippets = [
    { label: "Figure", text: "\\begin{figure}[h]\n  \\centering\n  \\caption{Caption}\n\\end{figure}" },
    { label: "Table", text: "\\begin{table}[h]\n\\centering\n\\begin{tabular}{ll}\nA & B \\\\\n\\end{tabular}\n\\caption{Caption}\n\\end{table}" },
    { label: "Theorem", text: "\\begin{theorem}\nStatement.\n\\end{theorem}" },
    { label: "Algorithm", text: "\\begin{algorithm}\n\\caption{Algorithm name}\n\\end{algorithm}" },
    { label: "Align", text: "\\begin{align}\na &= b + c \\\\\n  &= d\n\\end{align}" },
  ] as const;

  const applyTemplate = () => {
    if (!pendingTemplate) return;
    if (templateMode === "new-file") {
      const nextPath = templateNewFilePath.trim() || "template.tex";
      createFile(nextPath, pendingTemplate.content);
      return;
    }
    if (templateMode === "replace-body") {
      transformActiveFile((current) => {
        const beginIdx = current.indexOf("\\begin{document}");
        const endIdx = current.indexOf("\\end{document}");
        const tplBegin = pendingTemplate.content.indexOf("\\begin{document}");
        const tplEnd = pendingTemplate.content.indexOf("\\end{document}");
        if (beginIdx < 0 || endIdx < 0 || tplBegin < 0 || tplEnd < 0 || tplEnd <= tplBegin) {
          return pendingTemplate.content;
        }
        const templateBody = pendingTemplate.content
          .slice(tplBegin + "\\begin{document}".length, tplEnd)
          .trim();
        const prefix = current.slice(0, beginIdx + "\\begin{document}".length);
        const suffix = current.slice(endIdx);
        return `${prefix}\n\n${templateBody}\n\n${suffix}`;
      });
      return;
    }
    transformActiveFile(() => pendingTemplate.content);
  };

  return (
    <>
    <div className="h-10 border-b bg-background/50 flex items-center px-4 justify-between shrink-0 z-40">
      <div className="flex items-center gap-1">
        <ToolButton
          icon={FilePlus}
          label="New File"
          shortcut="N"
          onClick={() => setNewFileOpen(true)}
        />
        <ToolButton icon={Upload} label="Upload" onClick={() => uploadInputRef.current?.click()} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div>
              <ToolButton icon={FileText} label="Templates" hasDropdown />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {templates.map((tpl) => (
              <DropdownMenuItem
                key={tpl.label}
                onClick={() => {
                  setPendingTemplate(tpl);
                  setTemplateConfirmOpen(true);
                }}
              >
                {tpl.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              data-testid="snippet-button-section"
              onClick={() => appendToActiveFile("\n\\section{New Section}\n")}
            >
              Insert section snippet
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-4 mx-2" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div>
              <ToolButton icon={Quote} label="Citation" hasDropdown />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
            {bibEntries.length === 0 ? (
              <DropdownMenuItem
                data-testid="snippet-button-cite"
                onClick={() => appendToActiveFile("\\cite{your_reference_key}")}
              >
                Insert cite placeholder
              </DropdownMenuItem>
            ) : (
              bibEntries.slice(0, 150).map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  onClick={() => appendToActiveFile(`\\cite{${entry.id}}`)}
                >
                  {entry.id}{entry.year ? ` (${entry.year})` : ""}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div>
              <ToolButton icon={FunctionSquare} label="Snippets" hasDropdown dataTestId="snippet-button" />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {snippets.map((snippet) => (
              <DropdownMenuItem key={snippet.label} onClick={() => appendToActiveFile(snippet.text)}>
                {snippet.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              data-testid="snippet-button-equation"
              onClick={() => wrapSelectionOrInsert("\\begin{equation}\n", "\n\\end{equation}", "\\begin{equation}\nE = mc^2\n\\end{equation}")}
            >
              Equation from selection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-4 mx-2" />
        <ToolButton icon={FileText} label="Save" onClick={saveActiveFile} />
      </div>

      <div className="flex items-center gap-2">
         <div className="relative group mr-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <input
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              placeholder="Search files..."
              className="h-7 w-48 bg-secondary/50 rounded-md pl-8 pr-3 text-[10px] font-medium outline-none border border-transparent focus:border-primary/20 focus:bg-background transition-all"
              onFocus={() => setActiveRail("search")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  runProjectSearch(quickSearch, { texOnly: false });
                }
              }}
            />
         </div>

         <Separator orientation="vertical" className="h-4 mx-1" />

        <ToolButton
          icon={Download}
          label="Export"
          variant="primary"
          hasDropdown
          onClick={() => {
            void runCompile().then(() => {
              const latestPdf = useWorkbenchStore.getState().pdfDataUrl;
              if (latestPdf) {
                const a = document.createElement("a");
                a.href = latestPdf;
                a.download = "output.pdf";
                a.click();
              }
            });
          }}
        />

         <button
           onClick={() => {
             toggleSidebar();
             toggleBottomPanel();
           }}
           className="size-7 flex items-center justify-center text-muted-foreground hover:bg-secondary rounded-md transition-all ml-1"
         >
            <Layout size={14} />
         </button>
      </div>
    </div>
    <input
      ref={uploadInputRef}
      type="file"
      accept=".tex,.bib,.sty,.md,.txt"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void handleUpload(file);
        e.currentTarget.value = "";
      }}
    />
    <ConfirmDialog
      open={newFileOpen}
      title="Create new file"
      description="Provide a path relative to your project root."
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
      open={templateConfirmOpen}
      title="Apply template"
      description={`Template: ${pendingTemplate?.label ?? "None"}. Choose how to apply it.`}
      confirmLabel="Apply template"
      cancelLabel="Cancel"
      onCancel={() => {
        setTemplateConfirmOpen(false);
        setPendingTemplate(null);
      }}
      onConfirm={() => {
        applyTemplate();
        setTemplateConfirmOpen(false);
        setPendingTemplate(null);
      }}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <button
            onClick={() => setTemplateMode("replace-file")}
            className={cn("h-8 rounded border", templateMode === "replace-file" ? "border-primary text-primary" : "border-border")}
          >
            Replace file
          </button>
          <button
            onClick={() => setTemplateMode("replace-body")}
            className={cn("h-8 rounded border", templateMode === "replace-body" ? "border-primary text-primary" : "border-border")}
          >
            Replace body
          </button>
          <button
            onClick={() => setTemplateMode("new-file")}
            className={cn("h-8 rounded border", templateMode === "new-file" ? "border-primary text-primary" : "border-border")}
          >
            New file
          </button>
        </div>
        {templateMode === "new-file" && (
          <input
            value={templateNewFilePath}
            onChange={(e) => setTemplateNewFilePath(e.target.value)}
            placeholder="new-file.tex"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        )}
        <div className="rounded-md border bg-muted/20 p-2">
          <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Preview</p>
          <pre className="max-h-44 overflow-auto text-[11px] leading-5 text-foreground/90 whitespace-pre-wrap">
            {pendingTemplate?.content ?? ""}
          </pre>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Active file: <span className="text-foreground">{activeFileId ?? "none"}</span> · {activeFileId ? (filesByPath[activeFileId]?.length ?? 0) : 0} chars
        </p>
      </div>
    </ConfirmDialog>
    </>
  );
}

type ToolButtonProps = {
  icon: LucideIcon;
  label: string;
  hasDropdown?: boolean;
  variant?: "ghost" | "primary";
  shortcut?: string;
  dataTestId?: string;
  onClick?: () => void;
};

function ToolButton({
  icon: Icon,
  label,
  hasDropdown,
  variant = "ghost",
  shortcut,
  dataTestId,
  onClick,
}: ToolButtonProps) {
  return (
    <button
      data-testid={dataTestId}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-all group relative",
        variant === "ghost" ? "hover:bg-secondary/80 text-muted-foreground hover:text-foreground" : "bg-primary text-primary-foreground shadow-md shadow-primary/10 px-4"
      )}
    >
      <Icon size={14} strokeWidth={variant === "primary" ? 2.5 : 2} className={cn("transition-transform group-active:scale-90", variant === "ghost" && "text-muted-foreground/70 group-hover:text-primary")} />
      <span className="text-[10px] font-black uppercase tracking-tight">{label}</span>
      {hasDropdown && <ChevronDown size={10} className="opacity-40" />}

      {shortcut && (
         <div className="absolute -top-1 -right-1 size-3 bg-secondary border rounded-[2px] flex items-center justify-center text-[7px] font-black opacity-0 group-hover:opacity-100 transition-opacity">
            {shortcut}
         </div>
      )}
    </button>
  );
}

function Separator({ orientation, className }: { orientation: "vertical" | "horizontal"; className?: string }) {
  return (
    <div className={cn(
      "bg-border/60",
      orientation === "vertical" ? "w-px h-full" : "h-px w-full",
      className
    )} />
  );
}
