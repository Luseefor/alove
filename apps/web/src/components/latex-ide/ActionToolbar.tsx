"use client";

import { useMemo, useState } from "react";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { matchesReference } from "@/lib/referenceSearch";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import {
  Quote,
  History,
  ChevronDown,
  Search,
  Layout,
  Table as TableIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BibliographyService } from "@/services/BibliographyService";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ToolbarGroupProps {
  label: string;
  children: React.ReactNode;
}

function ToolbarGroup({ label, children }: ToolbarGroupProps) {
  return (
    <div className="flex min-w-0 shrink-0 flex-row items-center gap-1 border-r border-border px-2 last:border-r-0">
      <span className="hidden whitespace-nowrap text-[10px] font-bold uppercase leading-none tracking-widest text-muted-foreground lg:inline">
        {label}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

interface ToolbarButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  hasDropdown?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "ghost";
  dataTestId?: string;
}

function ToolbarButton({
  icon: Icon,
  label,
  active,
  hasDropdown,
  onClick,
  disabled,
  variant = "default",
  dataTestId,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      data-testid={dataTestId}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "group inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 transition-colors active:scale-95 disabled:cursor-not-allowed disabled:opacity-30",
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : active
            ? "bg-primary/10 text-primary font-bold"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "h-4 w-4 shrink-0",
          variant === "primary"
            ? "text-primary-foreground"
            : active
              ? "text-primary"
              : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <span className="whitespace-nowrap text-[12px] font-bold tracking-tight">
        {label}
      </span>
      {hasDropdown && (
        <ChevronDown
          aria-hidden="true"
          className="h-3 w-3 shrink-0 opacity-40 transition-opacity group-hover:opacity-100"
        />
      )}
    </button>
  );
}

export function ActionToolbar() {
  const {
    setBuildRecoveryOpen,
    appendToActiveFile,
    requestEditorFindBar,
    filesByPath,
    activeFileId,
  } = useWorkbenchStore();

  const canInsert =
    Boolean(activeFileId) &&
    !/^data:(image\/|application\/pdf)/.test(
      activeFileId ? (filesByPath[activeFileId] ?? "") : "",
    );
  const [referenceQuery, setReferenceQuery] = useState("");
  const mode = useIdeSettingsStore((s) => s.referenceSearchMode);
  const bibEntries = Object.entries(filesByPath)
    .filter(([path]) => path.endsWith(".bib"))
    .flatMap(([, content]) => BibliographyService.parse(content));
  const uniqueEntries = useMemo(
    () =>
      [
        ...new Map(bibEntries.map((entry) => [entry.id, entry])).values(),
      ].filter((entry) => matchesReference(entry, referenceQuery, mode)),
    [bibEntries, referenceQuery, mode],
  );

  return (
    <div className="z-40 flex h-11 w-full min-w-0 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border bg-background px-2 text-foreground scrollbar-hide">
      <ToolbarGroup label="Citations">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!canInsert}>
            <div>
              <ToolbarButton
                icon={Quote}
                label="Cite"
                hasDropdown
                disabled={!canInsert}
                dataTestId="snippet-button"
              />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-72 w-72 overflow-auto rounded-md border-border bg-background p-1.5"
          >
            <input
              aria-label="Search references"
              placeholder={
                mode === "bibtex" ? "Exact citation key" : "Search references…"
              }
              value={referenceQuery}
              onChange={(event) => setReferenceQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              className="mb-1 w-full rounded border border-border bg-background p-2 text-xs"
            />
            {bibEntries.length > 0 && uniqueEntries.length === 0 && (
              <p role="status" className="p-2 text-xs text-muted-foreground">
                No matching references.
              </p>
            )}
            {bibEntries.length === 0 ? (
              <DropdownMenuItem
                data-testid="snippet-button-cite"
                className="rounded-md font-semibold text-xs p-2 cursor-pointer"
                onClick={() => appendToActiveFile("\\cite{your_reference_key}")}
              >
                Insert cite placeholder
              </DropdownMenuItem>
            ) : (
              uniqueEntries.slice(0, 150).map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  className="rounded-md font-semibold text-xs p-2 cursor-pointer"
                  onClick={() => appendToActiveFile(`\\cite{${entry.id}}`)}
                >
                  {entry.id}
                  {entry.year ? ` (${entry.year})` : ""}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </ToolbarGroup>

      <ToolbarGroup label="Figures & Tables">
        <ToolbarButton
          icon={Layout}
          label="Figure"
          disabled={!canInsert}
          dataTestId="snippet-button-figure"
          onClick={() =>
            appendToActiveFile(
              "\\begin{figure}[htbp]\n  \\centering\n  % \\includegraphics[width=\\linewidth]{figure.png}\n  \\caption{Caption text.}\n  \\label{fig:example}\n\\end{figure}\n",
            )
          }
        />
        <ToolbarButton
          icon={TableIcon}
          label="Table"
          disabled={!canInsert}
          dataTestId="snippet-button-table"
          onClick={() =>
            appendToActiveFile(
              "\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{lcc}\n    A & B & C \\\\\n  \\end{tabular}\n  \\caption{Table caption.}\n  \\label{tab:example}\n\\end{table}\n",
            )
          }
        />
      </ToolbarGroup>

      <ToolbarGroup label="Search">
        <ToolbarButton
          icon={Search}
          label="Find"
          dataTestId="find-button"
          onClick={requestEditorFindBar}
        />
      </ToolbarGroup>
      <ToolbarGroup label="Build tools">
        <ToolbarButton
          icon={History}
          label="Build recovery"
          onClick={() => setBuildRecoveryOpen(true)}
        />
      </ToolbarGroup>
    </div>
  );
}
