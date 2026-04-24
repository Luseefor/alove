"use client";

import { useTheme } from "./ThemeProvider";
type PaletteSwitcherProps = {
  size?: "sm" | "md";
  className?: string;
};

export function PaletteSwitcher({
  size = "md",
  className = "",
}: PaletteSwitcherProps) {
  const { paletteId, setPaletteId, paletteOptions } = useTheme();
  const sm = size === "sm";

  return (
    <div
      role="listbox"
      aria-label="Accent color"
      className={`inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-700 dark:bg-zinc-900/80 ${sm ? "gap-0.5" : "gap-1"} ${className}`}
    >
      {paletteOptions.map((p) => {
        const selected = paletteId === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={selected}
            title={p.label}
            onClick={() => setPaletteId(p.id)}
            className={`rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-100 dark:focus-visible:ring-offset-zinc-900 ${
              sm ? "p-0.5" : "p-1"
            } ${selected ? "ring-2 ring-zinc-400 dark:ring-zinc-500" : ""}`}
          >
            <span
              className={`block rounded-full border border-black/10 shadow-inner dark:border-white/10 ${
                sm ? "h-5 w-5" : "h-6 w-6"
              }`}
              style={{ backgroundColor: p.swatch }}
            />
            <span className="sr-only">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
