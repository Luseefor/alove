"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import {
  Quote,
  ChevronDown,
  Search,
  Layout,
  Table as TableIcon,
  Play,
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
    <div className="flex flex-col gap-1 px-4 border-r border-zinc-100 last:border-r-0">
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">
        {label}
      </span>
      <div className="flex items-center gap-1">
        {children}
      </div>
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
  dataTestId 
}: ToolbarButtonProps) {
  return (
    <button
      data-testid={dataTestId}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all active:scale-95 group disabled:opacity-30 disabled:cursor-not-allowed",
        variant === "primary" 
          ? "bg-primary text-white shadow-sm shadow-primary/20 hover:bg-primary/90" 
          : active 
            ? "bg-primary/10 text-primary font-bold" 
            : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
      )}
    >
      <Icon className={cn(
        "w-4 h-4",
        variant === "primary" ? "text-white" : active ? "text-primary" : "text-zinc-400 group-hover:text-zinc-600"
      )} />
      <span className="text-[12px] font-bold tracking-tight">{label}</span>
      {hasDropdown && <ChevronDown className="w-3 h-3 opacity-40 group-hover:opacity-100 transition-opacity" />}
    </button>
  );
}

export function ActionToolbar() {
  const {
    appendToActiveFile,
    runCompile,
    requestEditorFindBar,
    filesByPath,
  } = useWorkbenchStore();

  const bibEntries = Object.entries(filesByPath)
    .filter(([path]) => path.endsWith(".bib"))
    .flatMap(([, content]) => BibliographyService.parse(content));

  return (
    <div className="h-14 border-b bg-white flex items-center px-2 shrink-0 z-40 shadow-sm overflow-x-auto scrollbar-hide">
      <ToolbarGroup label="Citations">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div>
              <ToolbarButton 
                icon={Quote} 
                label="Cite" 
                hasDropdown 
                dataTestId="snippet-button"
              />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-auto rounded-xl shadow-xl p-1.5 border-zinc-100 bg-white">
            {bibEntries.length === 0 ? (
              <DropdownMenuItem
                data-testid="snippet-button-cite"
                className="rounded-lg font-semibold text-xs p-2 cursor-pointer"
                onClick={() => appendToActiveFile("\\cite{your_reference_key}")}
              >
                Insert cite placeholder
              </DropdownMenuItem>
            ) : (
              bibEntries.slice(0, 150).map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  className="rounded-lg font-semibold text-xs p-2 cursor-pointer"
                  onClick={() => appendToActiveFile(`\\cite{${entry.id}}`)}
                >
                  {entry.id}{entry.year ? ` (${entry.year})` : ""}
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
          dataTestId="snippet-button-figure"
          onClick={() => appendToActiveFile(
            "\\begin{figure}[htbp]\n  \\centering\n  % \\includegraphics[width=\\linewidth]{figure.png}\n  \\caption{Caption text.}\n  \\label{fig:example}\n\\end{figure}\n"
          )}
        />
        <ToolbarButton 
          icon={TableIcon} 
          label="Table" 
          dataTestId="snippet-button-table"
          onClick={() => appendToActiveFile(
            "\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{lcc}\n    A & B & C \\\\\n  \\end{tabular}\n  \\caption{Table caption.}\n  \\label{tab:example}\n\\end{table}\n"
          )}
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

      <ToolbarGroup label="Compile">
        <ToolbarButton 
          icon={Play} 
          label="Build" 
          variant="primary"
          dataTestId="compile-button"
          onClick={() => void runCompile()}
        />
      </ToolbarGroup>
    </div>
  );
}
