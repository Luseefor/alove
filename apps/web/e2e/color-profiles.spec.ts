import { test, expect } from "@playwright/test";
import { SITE_PALETTES } from "../src/theme/palette-definitions";

function contrast(first: string, second: string) {
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((value) => {
        const s = Number(value) / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const mode of ["light", "dark"]) {
  test(`all six ${mode} profiles keep landing and editor controls readable`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.goto("/");
    for (const palette of SITE_PALETTES) {
      await page.evaluate(
        ({ mode, id }) => {
          localStorage.setItem("alove-theme-preference", mode);
          localStorage.setItem("alove-palette-id", id);
        },
        { mode, id: palette.id },
      );
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await expect(page.locator("html")).toHaveAttribute(
        "data-alove-palette",
        palette.id,
      );
      const cta = page.getByRole("link", {
        name: "Start writing",
        exact: true,
      });
      const ctaColors = await cta.evaluate((element) => {
        const style = getComputedStyle(element);
        return { text: style.color, background: style.backgroundColor };
      });
      expect(
        contrast(ctaColors.text, ctaColors.background),
        `${palette.id} ${mode} landing action`,
      ).toBeGreaterThanOrEqual(4.5);
      const canvas = await page
        .locator("main")
        .locator("..")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      const headline = await page
        .getByRole("heading", { level: 1 })
        .evaluate((element) => getComputedStyle(element).color);
      expect(
        contrast(headline, canvas),
        `${palette.id} ${mode} headline`,
      ).toBeGreaterThanOrEqual(4.5);
      await page
        .getByRole("link", { name: "Start writing", exact: true })
        .click();
      const build = page.getByTestId("compile-button");
      await expect(build).toBeVisible();
      const buildColors = await build.evaluate((element) => {
        const style = getComputedStyle(element);
        return { text: style.color, background: style.backgroundColor };
      });
      expect(
        contrast(buildColors.text, buildColors.background),
        `${palette.id} ${mode} editor action`,
      ).toBeGreaterThanOrEqual(4.5);
      await page.goto("/");
    }
  });
}
