import { useEffect } from "react";

type Params = {
  onToggleCommandPalette: () => void;
  cyclePreference: () => void;
  cyclePaletteId: () => void;
};

/**
 * Global editor shortcuts (ignored when typing in inputs / contenteditable).
 */
export function useEditorWorkbenchShortcuts({
  onToggleCommandPalette,
  cyclePreference,
  cyclePaletteId,
}: Params) {
  useEffect(() => {
    const inField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return Boolean(el?.closest("input, textarea, [contenteditable=true]"));
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onToggleCommandPalette();
      }
      if (
        e.shiftKey &&
        (e.key === "t" || e.key === "T") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (inField(e.target)) return;
        e.preventDefault();
        cyclePreference();
      }
      if (
        e.shiftKey &&
        (e.key === "p" || e.key === "P") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (inField(e.target)) return;
        e.preventDefault();
        cyclePaletteId();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleCommandPalette, cyclePreference, cyclePaletteId]);
}
