import { describe, expect, it } from "vitest";
import { buildBootInlineScript, SITE_PALETTES } from "@/theme";

describe("buildBootInlineScript", () => {
  it("embeds JSON for every palette id", () => {
    const script = buildBootInlineScript();
    for (const p of SITE_PALETTES) {
      expect(script).toContain(`"${p.id}"`);
    }
    expect(script).toContain("alove-palette-id");
    expect(script).toContain("alove-theme-preference");
  });
});
