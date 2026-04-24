import { describe, expect, it, beforeEach } from "vitest";
import { applyPaletteVars, SITE_PALETTES } from "@/theme";
import { ACCENT_VAR_NAMES } from "@/theme/palette-vars";

describe("applyPaletteVars", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-alove-palette");
    for (const k of ACCENT_VAR_NAMES) {
      document.documentElement.style.removeProperty(k);
    }
  });

  it("sets every accent CSS variable for light and dark", () => {
    for (const palette of SITE_PALETTES) {
      for (const mode of ["light", "dark"] as const) {
        applyPaletteVars(palette.id, mode);
        expect(document.documentElement.dataset.alovePalette).toBe(palette.id);
        for (const key of ACCENT_VAR_NAMES) {
          const v = document.documentElement.style.getPropertyValue(key);
          expect(v).toBeTruthy();
          expect(v).toBe((mode === "dark" ? palette.dark : palette.light)[key]);
        }
      }
    }
  });

  it("falls back to default id for unknown palette", () => {
    applyPaletteVars("not-a-real-palette", "light");
    expect(document.documentElement.dataset.alovePalette).toBe("ocean");
  });
});
