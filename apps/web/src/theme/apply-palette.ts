import { DEFAULT_PALETTE_ID, PALETTE_STORAGE_KEY } from "./constants";
import { getPalette, isSitePaletteId, type SitePaletteId } from "./palette-definitions";
import { ACCENT_VAR_NAMES } from "./palette-vars";
import type { ResolvedTheme } from "./types";

export function applyPaletteVars(
  paletteId: string,
  mode: ResolvedTheme,
): SitePaletteId {
  const raw = getPalette(paletteId);
  const safeId: SitePaletteId = raw?.id ?? (DEFAULT_PALETTE_ID as SitePaletteId);
  const palette = getPalette(safeId)!;
  const vars = mode === "dark" ? palette.dark : palette.light;
  const root = document.documentElement;
  root.dataset.alovePalette = safeId;
  for (const key of ACCENT_VAR_NAMES) {
    root.style.setProperty(key, vars[key]);
  }
  return safeId;
}

export function readStoredPaletteId(): SitePaletteId {
  if (typeof window === "undefined") {
    return DEFAULT_PALETTE_ID as SitePaletteId;
  }
  const v = localStorage.getItem(PALETTE_STORAGE_KEY);
  if (v && isSitePaletteId(v)) return v;
  return DEFAULT_PALETTE_ID as SitePaletteId;
}
