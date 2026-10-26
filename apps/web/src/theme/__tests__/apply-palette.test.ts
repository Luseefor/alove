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

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => {
      const s = parseInt(value, 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

it("keeps text and primary controls readable in every profile and appearance", () => {
  for (const palette of SITE_PALETTES) {
    for (const mode of ["light", "dark"] as const) {
      const colors = palette[mode];
      const surfaces =
        mode === "light"
          ? ["#ffffff", "#f1f3f6", "#eceff3", "#f5f7fa"]
          : ["#15191f", "#20252e", "#0f1217", "#10141a", "#1c222b"];
      expect(
        contrast(colors["--alove-accent"], colors["--alove-on-accent"]),
        `${palette.id} ${mode} button`,
      ).toBeGreaterThanOrEqual(4.5);
      for (const surface of surfaces) {
        expect(
          contrast(colors["--alove-fg-strong"], surface),
          `${palette.id} ${mode} text`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(colors["--alove-fg-muted"], surface),
          `${palette.id} ${mode} secondary text`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(colors["--alove-accent"], surface),
          `${palette.id} ${mode} accent text`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});
