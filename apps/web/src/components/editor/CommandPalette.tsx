"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Kbd } from "@/components/ui/primitives";
import { useTheme } from "@/components/theme/ThemeProvider";

export type CommandPaletteAction = {
  id: string;
  group: "Build" | "Editor" | "View" | "Project";
  label: string;
  hint?: string;
  keys?: string[];
  disabled?: boolean;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
};

export function CommandPalette({ open, onClose, actions }: CommandPaletteProps) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { cyclePreference, cyclePaletteId, preference, paletteId } = useTheme();

  useEffect(() => {
    if (!open) {
      setQ("");
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const merged = useMemo(() => {
    const themeAction: CommandPaletteAction = {
      id: "theme-cycle",
      group: "View",
      label: "Cycle appearance (system → light → dark)",
      hint: `Current: ${preference}`,
      keys: ["⇧", "T"],
      run: () => {
        cyclePreference();
      },
    };
    const paletteAction: CommandPaletteAction = {
      id: "palette-cycle",
      group: "View",
      label: "Cycle accent palette",
      hint: `Current: ${paletteId}`,
      run: () => {
        cyclePaletteId();
      },
    };
    return [...actions, themeAction, paletteAction];
  }, [actions, cyclePreference, cyclePaletteId, preference, paletteId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return merged;
    return merged.filter((a) => {
      const hay = `${a.label} ${a.hint ?? ""} ${a.group}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [merged, q]);

  const groups: CommandPaletteAction["group"][] = [
    "Build",
    "Editor",
    "Project",
    "View",
  ];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[min(12vh,6rem)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400" aria-hidden>
              ⌕
            </span>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search commands…"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
            />
            <Kbd>Esc</Kbd>
          </div>
        </div>
        <div className="max-h-[min(60vh,28rem)] overflow-y-auto py-1">
          {groups.map((g) => {
            const rows = filtered.filter((a) => a.group === g);
            if (rows.length === 0) return null;
            return (
              <div key={g} className="mb-1">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {g}
                </div>
                <ul className="space-y-0.5 px-1">
                  {rows.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        disabled={a.disabled}
                        onClick={() => {
                          if (a.disabled) return;
                          a.run();
                          onClose();
                        }}
                        className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
                      >
                        <span>
                          <span className="font-medium text-zinc-900 dark:text-zinc-50">
                            {a.label}
                          </span>
                          {a.hint ? (
                            <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                              {a.hint}
                            </span>
                          ) : null}
                        </span>
                        {a.keys?.length ? (
                          <span className="flex shrink-0 gap-0.5 pt-0.5">
                            {a.keys.map((k) => (
                              <Kbd key={k}>{k}</Kbd>
                            ))}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <p className="text-[11px] text-zinc-500">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd> anytime · click outside to close
          </p>
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
