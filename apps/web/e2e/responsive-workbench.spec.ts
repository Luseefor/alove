import { expect, test } from "@playwright/test";

for (const width of [390, 525, 768, 1024, 1440]) {
  for (const scheme of ["light", "dark"] as const) {
    test("workbench fits " + width + "px in " + scheme, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/editor");
      const editor = page.getByTestId("latex-editor");
      await expect(editor).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      const geometry = await page.evaluate(() => {
        const visible = (element: Element) => element.getClientRects().length > 0;
        const header = document.querySelector("header")!;
        const items = [...header.querySelectorAll("button"), header.querySelector("span[title]")!].filter(visible);
        const boxes = items.map((element) => ({ text: element.getAttribute("aria-label") ?? element.textContent, box: element.getBoundingClientRect() }));
        const overlaps: string[] = [];
        boxes.forEach((a, index) => boxes.slice(index + 1).forEach((b) => {
          if (Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1) overlaps.push(String(a.text) + " / " + b.text);
        }));
        return {
          overlaps,
          clipped: boxes.filter(({ box }) => box.left < 0 || box.right > innerWidth + 1).map(({ text }) => text),
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          editorWidth: document.querySelector('[data-testid="latex-editor"]')!.getBoundingClientRect().width,
        };
      });
      expect(geometry.overlaps).toEqual([]);
      expect(geometry.clipped).toEqual([]);
      expect(geometry.pageOverflow).toBe(false);
      expect(geometry.editorWidth).toBeGreaterThan(width < 1024 ? width - 60 : 350);

      if (width < 1024) {
        await expect(page.getByTestId("workbench-sidebar")).toBeHidden();
        await expect(page.getByTestId("pdf-preview-pane")).toBeHidden();
        const source = page.getByRole("textbox", { name: "LaTeX source editor" });
        await source.click();
        await source.press("Meta+End");
        await source.pressSequentially("RESPONSIVE_DRAFT");
        await page.getByRole("button", { name: "PDF", exact: true }).click();
        await expect(page.getByTestId("pdf-preview-pane")).toBeVisible();
        await expect(editor).toBeHidden();
        await page.getByRole("button", { name: "Source", exact: true }).click();
        await expect(source).toContainText("RESPONSIVE_DRAFT");
        await source.press("Meta+z");
        await expect(source).not.toContainText("RESPONSIVE_DRAFT");
        await page.getByRole("button", { name: "Files", exact: true }).click();
        await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
        const sidebar = await page.getByTestId("workbench-sidebar").boundingBox();
        expect(sidebar!.width).toBeGreaterThanOrEqual(260);
        await page.getByRole("button", { name: "Close project files", exact: true }).click();
        await expect(page.getByTestId("workbench-sidebar")).toBeHidden();
      } else {
        await expect(page.getByTestId("pdf-preview-pane")).toBeVisible();
        const sidebar = await page.getByTestId("workbench-sidebar").boundingBox();
        expect(sidebar!.width).toBeGreaterThanOrEqual(220);
      }
    });
  }
}

test("resizing across the breakpoint retains the source view and editor history", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto("/editor?new=true");
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  await source.click();
  await source.press("Meta+End");
  await source.pressSequentially("RESIZE_DRAFT");
  await page.setViewportSize({ width: 525, height: 850 });
  await expect(source).toContainText("RESIZE_DRAFT");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 850 });
  await expect(source).toContainText("RESIZE_DRAFT");
  await expect(page.getByTestId("pdf-preview-pane")).toBeVisible();
  await page.setViewportSize({ width: 525, height: 850 });
  await expect(page.getByTestId("workbench-sidebar")).toBeHidden();
  await source.press("Meta+z");
  await expect(source).not.toContainText("RESIZE_DRAFT");
});
