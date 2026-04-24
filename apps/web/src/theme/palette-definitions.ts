export const SITE_PALETTES = [
  {
    id: "emerald",
    label: "Emerald",
    light: {
      "--alove-accent": "#059669",
      "--alove-accent-hover": "#047857",
      "--alove-accent-active": "#065f46",
      "--alove-on-accent": "#ffffff",
      "--alove-surface-soft": "#ecfdf5",
      "--alove-surface-soft-border": "#a7f3d0",
      "--alove-fg-strong": "#065f46",
      "--alove-fg-muted": "#047857",
      "--alove-focus-ring": "#10b981",
      "--alove-resize-hover": "#34d399",
    },
    dark: {
      "--alove-accent": "#34d399",
      "--alove-accent-hover": "#6ee7b7",
      "--alove-accent-active": "#a7f3d0",
      "--alove-on-accent": "#022c22",
      "--alove-surface-soft": "#064e3b",
      "--alove-surface-soft-border": "#047857",
      "--alove-fg-strong": "#d1fae5",
      "--alove-fg-muted": "#a7f3d0",
      "--alove-focus-ring": "#6ee7b7",
      "--alove-resize-hover": "#34d399",
    },
  },
  {
    id: "ocean",
    label: "Ocean",
    light: {
      "--alove-accent": "#0284c7",
      "--alove-accent-hover": "#0369a1",
      "--alove-accent-active": "#075985",
      "--alove-on-accent": "#ffffff",
      "--alove-surface-soft": "#e0f2fe",
      "--alove-surface-soft-border": "#7dd3fc",
      "--alove-fg-strong": "#0c4a6e",
      "--alove-fg-muted": "#0369a1",
      "--alove-focus-ring": "#0ea5e9",
      "--alove-resize-hover": "#38bdf8",
    },
    dark: {
      "--alove-accent": "#38bdf8",
      "--alove-accent-hover": "#7dd3fc",
      "--alove-accent-active": "#bae6fd",
      "--alove-on-accent": "#082f49",
      "--alove-surface-soft": "#0c4a6e",
      "--alove-surface-soft-border": "#0369a1",
      "--alove-fg-strong": "#e0f2fe",
      "--alove-fg-muted": "#bae6fd",
      "--alove-focus-ring": "#7dd3fc",
      "--alove-resize-hover": "#38bdf8",
    },
  },
  {
    id: "violet",
    label: "Violet",
    light: {
      "--alove-accent": "#7c3aed",
      "--alove-accent-hover": "#6d28d9",
      "--alove-accent-active": "#5b21b6",
      "--alove-on-accent": "#ffffff",
      "--alove-surface-soft": "#f5f3ff",
      "--alove-surface-soft-border": "#c4b5fd",
      "--alove-fg-strong": "#5b21b6",
      "--alove-fg-muted": "#6d28d9",
      "--alove-focus-ring": "#8b5cf6",
      "--alove-resize-hover": "#a78bfa",
    },
    dark: {
      "--alove-accent": "#a78bfa",
      "--alove-accent-hover": "#c4b5fd",
      "--alove-accent-active": "#ddd6fe",
      "--alove-on-accent": "#1e1b4b",
      "--alove-surface-soft": "#4c1d95",
      "--alove-surface-soft-border": "#6d28d9",
      "--alove-fg-strong": "#ede9fe",
      "--alove-fg-muted": "#ddd6fe",
      "--alove-focus-ring": "#c4b5fd",
      "--alove-resize-hover": "#a78bfa",
    },
  },
  {
    id: "amber",
    label: "Amber",
    light: {
      "--alove-accent": "#d97706",
      "--alove-accent-hover": "#b45309",
      "--alove-accent-active": "#92400e",
      "--alove-on-accent": "#fffbeb",
      "--alove-surface-soft": "#fffbeb",
      "--alove-surface-soft-border": "#fcd34d",
      "--alove-fg-strong": "#78350f",
      "--alove-fg-muted": "#b45309",
      "--alove-focus-ring": "#f59e0b",
      "--alove-resize-hover": "#fbbf24",
    },
    dark: {
      "--alove-accent": "#fbbf24",
      "--alove-accent-hover": "#fcd34d",
      "--alove-accent-active": "#fde68a",
      "--alove-on-accent": "#451a03",
      "--alove-surface-soft": "#78350f",
      "--alove-surface-soft-border": "#b45309",
      "--alove-fg-strong": "#fffbeb",
      "--alove-fg-muted": "#fde68a",
      "--alove-focus-ring": "#fcd34d",
      "--alove-resize-hover": "#fbbf24",
    },
  },
  {
    id: "rose",
    label: "Rose",
    light: {
      "--alove-accent": "#e11d48",
      "--alove-accent-hover": "#be123c",
      "--alove-accent-active": "#9f1239",
      "--alove-on-accent": "#ffffff",
      "--alove-surface-soft": "#fff1f2",
      "--alove-surface-soft-border": "#fda4af",
      "--alove-fg-strong": "#9f1239",
      "--alove-fg-muted": "#be123c",
      "--alove-focus-ring": "#f43f5e",
      "--alove-resize-hover": "#fb7185",
    },
    dark: {
      "--alove-accent": "#fb7185",
      "--alove-accent-hover": "#fda4af",
      "--alove-accent-active": "#fecdd3",
      "--alove-on-accent": "#4c0519",
      "--alove-surface-soft": "#9f1239",
      "--alove-surface-soft-border": "#be123c",
      "--alove-fg-strong": "#ffe4e6",
      "--alove-fg-muted": "#fecdd3",
      "--alove-focus-ring": "#fda4af",
      "--alove-resize-hover": "#fb7185",
    },
  },
] as const;

export type SitePaletteId = (typeof SITE_PALETTES)[number]["id"];

export type SitePaletteDefinition = (typeof SITE_PALETTES)[number];

const byId = Object.fromEntries(SITE_PALETTES.map((p) => [p.id, p])) as Record<
  SitePaletteId,
  SitePaletteDefinition
>;

export function getPalette(id: string): SitePaletteDefinition | undefined {
  return byId[id as SitePaletteId];
}

export function isSitePaletteId(id: string): id is SitePaletteId {
  return id in byId;
}
