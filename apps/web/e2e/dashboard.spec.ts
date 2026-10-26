import { test, expect } from "@playwright/test";

test.describe("Weftly front page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("opens a new project from the primary action", async ({ page }) => {
    await page
      .getByRole("link", { name: "Start writing", exact: true })
      .click();
    await expect(page).toHaveURL(/\/editor\?.*project=local-/);
    await expect(
      page.getByRole("button", { name: "Rename project", exact: true }),
    ).toHaveText("Untitled Project");
  });

  test("opens the existing sample workspace", async ({ page }) => {
    await page
      .getByRole("link", { name: "Explore a sample", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Rename project", exact: true }),
    ).toHaveText("Quantum Entanglement Review");
    await expect(page.getByTestId("source-panel")).toBeVisible();
  });

  test("keeps saved-project search and project navigation available", async ({
    page,
  }) => {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Projects", exact: true })
      .click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(
      page.getByText("No saved projects yet", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search projects by title" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Import source archive", exact: true }),
    ).toBeVisible();
  });

  test("keyboard users can skip directly to the main content", async ({
    page,
  }) => {
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("light and dark layouts fit phone, tablet and desktop, with real loaded images", async ({
    page,
  }) => {
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => localStorage.setItem("alove-theme-preference", value),
        theme,
      );
      await page.reload();
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          "Your paper.From idea to PDF.",
        );
        const image = page.getByRole("img", {
          name:
            theme === "light"
              ? "Weftly's editor with LaTeX source beside its typeset PDF, project files, and source and visual writing modes."
              : "Weftly's editor in dark appearance with LaTeX source beside its typeset PDF.",
          exact: true,
        });
        await expect(image).toBeVisible();
        await expect
          .poll(() =>
            image.evaluate(
              (element: HTMLImageElement) =>
                element.complete && element.naturalWidth > 0,
            ),
          )
          .toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await expect(
          page.getByRole("link", { name: "Start writing", exact: true }),
        ).toBeInViewport();
        if (width >= 1000) {
          const bounds = (await image.boundingBox())!;
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(960);
        }
        if (process.env.E2E_EVIDENCE_DIR)
          await page.screenshot({
            path: `${process.env.E2E_EVIDENCE_DIR}/home-${theme}-${width}.png`,
            fullPage: true,
          });
      }
    }
    await page
      .getByRole("button", { name: "Toggle light and dark appearance" })
      .click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});
