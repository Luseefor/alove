/**
 * Public theme API (palettes, CSS variables, boot script). React providers live
 * under `src/components/theme/`.
 */
export {
  DEFAULT_PALETTE_ID,
  PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  FONT_SIZE_STORAGE_KEY,
  PREVIEW_BG_STORAGE_KEY,
} from "./constants";
export type { 
  ResolvedTheme,
  AppearancePreference,
  DensityPreference,
  EditorFontSizePreference,
  PreviewBackgroundPreference
} from "./types";
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
