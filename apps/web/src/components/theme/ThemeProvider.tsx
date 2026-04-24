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
  type ResolvedTheme,
  type SitePaletteId,
} from "@/theme";

export type { ResolvedTheme } from "@/theme";

export type ThemePreference = "system" | "light" | "dark";

export type PaletteOption = {
  id: SitePaletteId;
  label: string;
  swatch: string;
};

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  cyclePreference: () => void;
  paletteId: SitePaletteId;
  setPaletteId: (id: SitePaletteId) => void;
  /** Cycles through `SITE_PALETTES` order (keyboard / command palette). */
  cyclePaletteId: () => void;
  paletteOptions: readonly PaletteOption[];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemePreference | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return null;
}

function initialPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  return readStoredTheme() ?? "system";
}

function initialSystemDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState(initialPreference);
  const [systemDark, setSystemDark] = useState(initialSystemDark);
  const [paletteId, setPaletteIdState] = useState<SitePaletteId>(() =>
    readStoredPaletteId(),
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved = useMemo(
    () => resolve(preference, systemDark),
    [preference, systemDark],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  useEffect(() => {
    applyPaletteVars(paletteId, resolved);
  }, [paletteId, resolved]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {
      /* private mode */
    }
    const sd = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", resolve(p, sd) === "dark");
  }, []);

  const cyclePreference = useCallback(() => {
    setPreferenceState((prev) => {
      const order: ThemePreference[] = ["system", "light", "dark"];
      const i = order.indexOf(prev);
      const next = order[(i + 1) % order.length] ?? "system";
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      const sd = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle(
        "dark",
        resolve(next, sd) === "dark",
      );
      return next;
    });
  }, []);

  const setPaletteId = useCallback((id: SitePaletteId) => {
    setPaletteIdState(id);
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const cyclePaletteId = useCallback(() => {
    const ids = SITE_PALETTES.map((p) => p.id);
    setPaletteIdState((prev) => {
      const i = ids.indexOf(prev);
      const next = ids[(i + 1) % ids.length] ?? prev;
      try {
        localStorage.setItem(PALETTE_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
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
      preference,
      resolved,
      setPreference,
      cyclePreference,
      paletteId,
      setPaletteId,
      cyclePaletteId,
      paletteOptions,
    }),
    [
      preference,
      resolved,
      setPreference,
      cyclePreference,
      paletteId,
      setPaletteId,
      cyclePaletteId,
      paletteOptions,
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
