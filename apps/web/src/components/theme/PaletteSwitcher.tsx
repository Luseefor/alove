"use client";

import { useTheme } from "./ThemeProvider";
import type { SitePaletteId } from "@/theme";

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
    <label
      className={`inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 ${sm ? "text-[11px]" : "text-xs"} ${className}`}
    >
      <span className="sr-only sm:not-sr-only sm:inline">Accent</span>
      <select
        aria-label="Accent color"
        value={paletteId}
        onChange={(e) => setPaletteId(e.target.value as SitePaletteId)}
        className={`max-w-[9.5rem] rounded border border-zinc-300 bg-white font-medium text-zinc-900 shadow-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 ${sm ? "py-0.5 pl-1.5 pr-2 text-[11px]" : "py-1 pl-2 pr-2 text-xs"}`}
      >
        {paletteOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
