import { expect, test } from "@playwright/test";

test.skip(
  process.env.E2E_REAL_COMPILE !== "1",
  "Requires running Redis, compile-worker, Docker and TeX; no API mocks.",
);

test("real SyncTeX coordinate navigation with the interactive viewer", async ({
  page,
}) => {
  test.setTimeout(180000);
  const source = String.raw`\documentclass{article}
\begin{document}
First page for SyncTeX forward search.
\newpage
Second page for SyncTeX reverse search.
\end{document}
`;
  await page.goto("/editor?new=true");
  await expect(page).toHaveURL(/project=local-/);
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  await editor.fill(source);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/compile") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("compile-button").click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);

  const preview = page.getByTestId("pdf-preview-pane");
  await expect(preview).toHaveAttribute("data-status", "ready", {
    timeout: 90000,
  });

  const syncControls = page.getByTestId("synctex-controls");
  await expect(syncControls).toBeVisible();
  await expect(syncControls).toContainText(/SyncTeX ready/);

  // A fresh mapping auto-enables the interactive canvas viewer.
  const canvasViewer = page.getByTestId("pdf-canvas-viewer");
  await expect(canvasViewer).toBeVisible({ timeout: 30000 });
  const canvas = canvasViewer.locator("canvas");
  await expect(canvas).toBeVisible();

  // Source -> PDF: the cursor resolves to a real anchor highlight.
  await page
    .getByRole("button", { name: "Go to PDF for cursor" })
    .click();
  await expect(syncControls).toContainText(/PDF page \d+ for/);
  const highlight = page.getByTestId("pdf-sync-highlight");
  await expect(highlight).toBeVisible();
  const box = await highlight.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  // PDF -> source: double-clicking the rendered page maps the real
  // click point to the nearest source anchor.
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();
  await canvas.dblclick({
    position: {
      x: Math.floor((canvasBox?.width ?? 100) / 2),
      y: Math.floor((canvasBox?.height ?? 100) / 3),
    },
  });
  await expect(syncControls).toContainText(/Source .*\.tex:\d+ for PDF page/);

  // Keyboard page fallback stays accessible in the canvas viewer.
  await expect(canvasViewer.getByLabel("Current PDF page")).toBeVisible();
  await expect(
    canvasViewer.getByRole("button", { name: "Next PDF page" }),
  ).toBeVisible();

  // The Default viewer toggle preserves the iframe path.
  await page.getByRole("button", { name: "Default", exact: true }).click();
  const frame = page.locator('iframe[title="Compiled PDF"]');
  await expect(frame).toBeVisible();

  // Stale-source guard: editing after the build disables sync, hides the
  // highlight, and falls back to the default viewer.
  await editor.fill(source.replace("Second page", "Edited second page"));
  await expect(syncControls).toContainText(/SyncTeX stale/);
  await expect(
    page.getByRole("button", { name: "Go to PDF for cursor" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Go to source for page" }),
  ).toBeDisabled();
  await expect(page.getByTestId("pdf-sync-highlight")).toHaveCount(0);
});
