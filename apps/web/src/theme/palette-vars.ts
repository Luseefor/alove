/**
 * CSS custom properties driven by `SITE_PALETTES` (TypeScript source of truth).
 * Referenced from `globals.css` @theme and applied at runtime + boot script.
 */
export const ACCENT_VAR_NAMES = [
  "--alove-accent",
  "--alove-accent-hover",
  "--alove-accent-active",
  "--alove-on-accent",
  "--alove-surface-soft",
  "--alove-surface-soft-border",
  "--alove-fg-strong",
  "--alove-fg-muted",
  "--alove-focus-ring",
  "--alove-resize-hover",
] as const;

export type AccentVarName = (typeof ACCENT_VAR_NAMES)[number];

export type PaletteModeVars = Record<AccentVarName, string>;
