/**
 * Public theme API (palettes, CSS variables, boot script). React providers live
 * under `src/components/theme/`.
 */
export {
  DEFAULT_PALETTE_ID,
  PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./constants";
export type { ResolvedTheme } from "./types";
export type { AccentVarName, PaletteModeVars } from "./palette-vars";
export {
  SITE_PALETTES,
  getPalette,
  isSitePaletteId,
  type SitePaletteDefinition,
  type SitePaletteId,
} from "./palette-definitions";
export { applyPaletteVars, readStoredPaletteId } from "./apply-palette";
export { buildBootInlineScript } from "./boot-script";
