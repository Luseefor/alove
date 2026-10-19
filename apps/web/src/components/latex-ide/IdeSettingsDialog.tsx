"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Code2, Cpu, Landmark, Paintbrush, Settings2 } from "lucide-react";
import { isLocalStandalone } from "@/lib/localStandalone";
import { useTheme } from "@/components/theme/ThemeProvider";
import type { AppearancePreference, SitePaletteId } from "@/theme";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  useIdeSettingsStore,
  type CompilerEngine,
  type EditorKeybindings,
  type PdfViewerStyle,
} from "@/stores/ideSettingsStore";
import { ClerkAccountPanels } from "./ClerkAccountPanels";

type Category =
  | "editor"
  | "compiler"
  | "appearance"
  | "account"
  | "subscription";

const nav: Array<{
  id: Category;
  label: string;
  icon: typeof Code2;
}> = [
  { id: "editor", label: "Editor", icon: Code2 },
  { id: "compiler", label: "Compiler", icon: Cpu },
  { id: "appearance", label: "Appearance", icon: Paintbrush },
  { id: "account", label: "Account settings", icon: Settings2 },
  { id: "subscription", label: "Subscription", icon: Landmark },
];

type IdeSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-4 last:border-0">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 pt-0.5">
        {isValidElement<Record<string, unknown>>(control)
          ? cloneElement(control, { "aria-label": title })
          : control}
      </div>
    </div>
  );
}

function SelectNative({
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  "aria-label"?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 min-w-0 max-w-full sm:min-w-[10rem] rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function IdeSettingsDialog({
  open,
  onOpenChange,
}: IdeSettingsDialogProps) {
  const [category, setCategory] = useState<Category>("editor");
  const [referenceExpanded, setReferenceExpanded] = useState(false);

  useEffect(() => {
    if (!open) {
      setCategory("editor");
      setReferenceExpanded(false);
    }
  }, [open]);

  const {
    editorAutocomplete,
    setEditorAutocomplete,
    editorAutoCloseBrackets,
    setEditorAutoCloseBrackets,
    editorNonBlinkingCursor,
    setEditorNonBlinkingCursor,
    editorCodeCheck,
    setEditorCodeCheck,
    editorKeybindings,
    setEditorKeybindings,
    pdfViewerStyle,
    setPdfViewerStyle,
    referenceSearchMode,
    setReferenceSearchMode,
    spellcheckEnabled,
    setSpellcheckEnabled,
    defaultCompilerEngine,
    setDefaultCompilerEngine,
    compilerCleanAux,
    setCompilerCleanAux,
  } = useIdeSettingsStore();

  const { appearance, setAppearance, paletteId, setPaletteId, paletteOptions } =
    useTheme();
  const local = isLocalStandalone();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(720px,92vh)] flex-col overflow-hidden p-0 sm:max-w-[min(960px,96vw)]">
        <DialogHeader className="shrink-0 border-b px-0 py-0">
          <div className="px-6 py-4 pr-14">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription className="sr-only">
              Configure the LaTeX workspace
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <nav className="w-28 shrink-0 border-r bg-muted/25 p-1 sm:w-52 sm:p-2">
            <ul className="space-y-0.5">
              {nav.map((item) => {
                const active = category === item.id;
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setCategory(item.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors",
                        active
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0 opacity-80" />
                      <span className="flex-1 truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-6">
            {category === "editor" && (
              <div className="max-w-xl pb-6">
                <SettingRow
                  title="Auto-complete"
                  description="Suggests LaTeX commands while typing in the code editor."
                  control={
                    <Switch
                      checked={editorAutocomplete}
                      onCheckedChange={setEditorAutocomplete}
                    />
                  }
                />
                <SettingRow
                  title="Auto-close brackets"
                  description="Automatically insert closing brackets for (), [], and {}."
                  control={
                    <Switch
                      checked={editorAutoCloseBrackets}
                      onCheckedChange={setEditorAutoCloseBrackets}
                    />
                  }
                />
                <SettingRow
                  title="Non-blinking cursor"
                  description="Uses a steadier caret where supported by the browser."
                  control={
                    <Switch
                      checked={editorNonBlinkingCursor}
                      onCheckedChange={setEditorNonBlinkingCursor}
                    />
                  }
                />
                <SettingRow
                  title="Code check"
                  description="Shows build and citation diagnostics in the Problems panel."
                  control={
                    <Switch
                      checked={editorCodeCheck}
                      onCheckedChange={setEditorCodeCheck}
                    />
                  }
                />
                <SettingRow
                  title="Keybindings"
                  description="Choose standard shortcuts, Vim editing, or Emacs-style navigation shortcuts."
                  control={
                    <SelectNative
                      value={editorKeybindings}
                      onChange={(v) =>
                        setEditorKeybindings(v as EditorKeybindings)
                      }
                      options={[
                        { value: "none", label: "None" },
                        { value: "vim", label: "Vim" },
                        { value: "emacs", label: "Emacs" },
                      ]}
                    />
                  }
                />
                <SettingRow
                  title="PDF viewer"
                  description="Choose embedded native controls, a fit-width preview, or a separate browser tab."
                  control={
                    <SelectNative
                      value={pdfViewerStyle}
                      onChange={(v) => setPdfViewerStyle(v as PdfViewerStyle)}
                      options={[
                        { value: "embedded", label: "Embedded" },
                        { value: "overleaf", label: "Fit width" },
                        { value: "browser", label: "Browser tab" },
                      ]}
                    />
                  }
                />
                <div className="border-b border-border/60 py-4 last:border-0">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="text-sm font-semibold text-foreground">
                        Reference search
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Choose how you search your references in the
                        bibliography panel.
                      </p>
                    </div>
                    <div className="shrink-0 pt-0.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReferenceExpanded((e) => !e)}
                      >
                        {referenceExpanded ? "Hide" : "Settings"}
                      </Button>
                    </div>
                  </div>
                  {referenceExpanded ? (
                    <div className="mt-3 rounded-md border bg-muted/20 p-3">
                      <label className="block text-[11px] font-medium text-muted-foreground">
                        Mode
                      </label>
                      <select
                        aria-label="Reference search mode"
                        value={referenceSearchMode}
                        onChange={(e) =>
                          setReferenceSearchMode(
                            e.target.value as "default" | "fuzzy" | "bibtex",
                          )
                        }
                        className="mt-1 h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="default">Default</option>
                        <option value="fuzzy">Fuzzy match</option>
                        <option value="bibtex">BibTeX key exact</option>
                      </select>
                      <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                        Applies to the Cite menu search: text matching, fuzzy
                        matching, or an exact citation key.
                      </p>
                    </div>
                  ) : null}
                </div>
                <SettingRow
                  title="Spellcheck"
                  description="Uses the browser spell checker in the source editor."
                  control={
                    <Switch
                      checked={spellcheckEnabled}
                      onCheckedChange={setSpellcheckEnabled}
                    />
                  }
                />
              </div>
            )}

            {category === "compiler" && (
              <div className="max-w-xl pb-6">
                <SettingRow
                  title="Default engine"
                  description="Used for Compile and Recompile unless overridden elsewhere."
                  control={
                    <SelectNative
                      value={defaultCompilerEngine}
                      onChange={(v) =>
                        setDefaultCompilerEngine(v as CompilerEngine)
                      }
                      options={[
                        { value: "pdflatex", label: "pdfLaTeX" },
                        { value: "xelatex", label: "XeLaTeX" },
                        { value: "lualatex", label: "LuaLaTeX" },
                      ]}
                    />
                  }
                />
                <SettingRow
                  title="Clean auxiliary files"
                  description="Remove auxiliary files before building. Each build already starts in a fresh workspace."
                  control={
                    <Switch
                      checked={compilerCleanAux}
                      onCheckedChange={setCompilerCleanAux}
                    />
                  }
                />
              </div>
            )}

            {category === "appearance" && (
              <div className="max-w-xl space-y-4 pb-6">
                <SettingRow
                  title="Theme"
                  description="Light or dark interface."
                  control={
                    <SelectNative
                      value={appearance}
                      onChange={(v) => setAppearance(v as AppearancePreference)}
                      options={[
                        { value: "system", label: "System" },
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" },
                      ]}
                    />
                  }
                />
                <SettingRow
                  title="Color palette"
                  description="Accent colors used across buttons and highlights."
                  control={
                    <select
                      value={paletteId}
                      onChange={(e) =>
                        setPaletteId(e.target.value as SitePaletteId)
                      }
                      className="h-9 min-w-0 max-w-full sm:min-w-[10rem] rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                    >
                      {paletteOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  }
                />
              </div>
            )}

            {category === "account" && (
              <div className="max-w-lg pb-6">
                {local ? (
                  <p className="text-sm text-muted-foreground">
                    Account settings are unavailable in offline standalone mode.
                  </p>
                ) : (
                  <ClerkAccountPanels />
                )}
              </div>
            )}

            {category === "subscription" && (
              <div className="max-w-lg pb-6">
                <p className="text-sm text-muted-foreground">
                  This workspace has no paid plan or billing portal. Account
                  settings manage your sign-in profile when cloud mode is
                  configured.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
