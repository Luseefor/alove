import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`source scrolls inside its pane at ${width}px in ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/editor?new=true");
      const source = page.getByRole("textbox", { name: "LaTeX source editor" });
      const text = Array.from({ length: 200 }, (_, i) => `% source line ${i + 1}`).join("\n");
      await source.fill(text);
      await source.press("ControlOrMeta+Home");

      const scroller = page.locator(".cm-scroller");
      await expect.poll(() => scroller.evaluate(e => e.scrollHeight - e.clientHeight)).toBeGreaterThan(1000);
      const geometry = await scroller.evaluate(e => ({
        height: e.clientHeight,
        bottom: e.getBoundingClientRect().bottom,
        paneBottom: e.closest('[data-testid="latex-editor"]')!.getBoundingClientRect().bottom,
      }));
      expect(geometry.height).toBeGreaterThan(100);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.paneBottom);

      await scroller.hover();
      await page.mouse.wheel(0, 650);
      await expect.poll(() => scroller.evaluate(e => e.scrollTop)).toBeGreaterThan(100);
      await page.mouse.wheel(0, 10000);
      await expect.poll(() => scroller.evaluate(e => e.scrollHeight - e.clientHeight - e.scrollTop)).toBeLessThan(3);
      await expect(page.getByText("% source line 200", { exact: true })).toBeInViewport();
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => scroller.evaluate(e => e.scrollTop)).toBeLessThan(3);
      await expect(page.getByText("% source line 1", { exact: true })).toBeInViewport();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await source.press("ControlOrMeta+End");
      await expect(page.getByText("% source line 200", { exact: true })).toBeInViewport();
    });
  }
}
