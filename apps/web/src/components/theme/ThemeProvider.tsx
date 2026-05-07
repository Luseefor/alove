"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyPaletteVars,
  readStoredPaletteId,
  PALETTE_STORAGE_KEY,
  SITE_PALETTES,
  THEME_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  FONT_SIZE_STORAGE_KEY,
  PREVIEW_BG_STORAGE_KEY,
  type ResolvedTheme,
  type SitePaletteId,
  type AppearancePreference,
  type DensityPreference,
  type EditorFontSizePreference,
  type PreviewBackgroundPreference,
} from "@/theme";

export type { ResolvedTheme } from "@/theme";

export type PaletteOption = {
  id: SitePaletteId;
  label: string;
  swatch: string;
};

type ThemeContextValue = {
  appearance: AppearancePreference;
  resolved: ResolvedTheme;
  setAppearance: (p: AppearancePreference) => void;
  cycleAppearance: () => void;

  paletteId: SitePaletteId;
  setPaletteId: (id: SitePaletteId) => void;
  cyclePaletteId: () => void;
  paletteOptions: readonly PaletteOption[];

  density: DensityPreference;
  setDensity: (d: DensityPreference) => void;

  editorFontSize: EditorFontSizePreference;
  setEditorFontSize: (size: EditorFontSizePreference) => void;

  previewBackground: PreviewBackgroundPreference;
  setPreviewBackground: (bg: PreviewBackgroundPreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored<T extends string>(key: string, valid: T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key);
  if (v && valid.includes(v as T)) return v as T;
  return fallback;
}

function resolve(
  preference: AppearancePreference,
  systemDark: boolean,
): ResolvedTheme {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<AppearancePreference>(() =>
    readStored(THEME_STORAGE_KEY, ["system", "light", "dark"], "system"),
  );
  const [systemDark, setSystemDark] = useState(false);
  
  const [paletteId, setPaletteIdState] = useState<SitePaletteId>(() =>
    readStoredPaletteId(),
  );
  
  const [density, setDensityState] = useState<DensityPreference>(() =>
    readStored(DENSITY_STORAGE_KEY, ["comfortable", "compact"], "comfortable"),
  );
  
  const [editorFontSize, setEditorFontSizeState] = useState<EditorFontSizePreference>(() =>
    readStored(FONT_SIZE_STORAGE_KEY, ["small", "medium", "large"], "medium"),
  );
  
  const [previewBackground, setPreviewBackgroundState] = useState<PreviewBackgroundPreference>(() =>
    readStored(PREVIEW_BG_STORAGE_KEY, ["charcoal", "neutral", "paper"], "charcoal"),
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved = useMemo(
    () => resolve(appearance, systemDark),
    [appearance, systemDark],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  useEffect(() => {
    applyPaletteVars(paletteId, resolved);
  }, [paletteId, resolved]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
  
  useEffect(() => {
    document.documentElement.dataset.fontSize = editorFontSize;
  }, [editorFontSize]);
  
  useEffect(() => {
    document.documentElement.dataset.previewBg = previewBackground;
  }, [previewBackground]);

  const setAppearance = useCallback((p: AppearancePreference) => {
    setAppearanceState(p);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {}
    const sd = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const res = resolve(p, sd);
    document.documentElement.classList.toggle("dark", res === "dark");
    document.documentElement.dataset.theme = res;
  }, []);

  const cycleAppearance = useCallback(() => {
    setAppearanceState((prev: AppearancePreference) => {
      const order: AppearancePreference[] = ["system", "light", "dark"];
      const next = order[(order.indexOf(prev) + 1) % order.length];
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {}
      const sd = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const res = resolve(next, sd);
      document.documentElement.classList.toggle("dark", res === "dark");
      document.documentElement.dataset.theme = res;
      return next;
    });
  }, []);

  const setPaletteId = useCallback((id: SitePaletteId) => {
    setPaletteIdState(id);
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, id);
    } catch {}
  }, []);

  const cyclePaletteId = useCallback(() => {
    const ids = SITE_PALETTES.map((p) => p.id);
    setPaletteIdState((prev) => {
      const next = ids[(ids.indexOf(prev) + 1) % ids.length] ?? prev;
      try {
        localStorage.setItem(PALETTE_STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  const setDensity = useCallback((d: DensityPreference) => {
    setDensityState(d);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, d);
    } catch {}
  }, []);
  
  const setEditorFontSize = useCallback((s: EditorFontSizePreference) => {
    setEditorFontSizeState(s);
    try {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, s);
    } catch {}
  }, []);
  
  const setPreviewBackground = useCallback((b: PreviewBackgroundPreference) => {
    setPreviewBackgroundState(b);
    try {
      localStorage.setItem(PREVIEW_BG_STORAGE_KEY, b);
    } catch {}
  }, []);

  const paletteOptions = useMemo(
    () =>
      SITE_PALETTES.map((p) => ({
        id: p.id,
        label: p.label,
        swatch: p.light["--alove-accent"],
      })),
    [],
  );

  const value = useMemo(
    () => ({
      appearance,
      resolved,
      setAppearance,
      cycleAppearance,
      paletteId,
      setPaletteId,
      cyclePaletteId,
      paletteOptions,
      density,
      setDensity,
      editorFontSize,
      setEditorFontSize,
      previewBackground,
      setPreviewBackground,
    }),
    [
      appearance,
      resolved,
      setAppearance,
      cycleAppearance,
      paletteId,
      setPaletteId,
      cyclePaletteId,
      paletteOptions,
      density,
      setDensity,
      editorFontSize,
      setEditorFontSize,
      previewBackground,
      setPreviewBackground,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
