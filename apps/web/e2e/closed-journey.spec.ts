import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.skip(process.env.E2E_REAL_COMPILE !== "1", "Requires real Redis, Docker TeX and the compile worker.");

test("a paper survives its complete create, recover, export, import and delete journey", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  const saved = () => expect(page.getByText("Project saved", { exact: true })).toBeVisible();
  const preview = page.getByTestId("pdf-preview-pane");
  const createFile = async (path: string, content: string) => {
    await page.getByRole("button", { name: "New file", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(path);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await source.fill(content);
    await saved();
  };
  const open = async (path: string) => {
    await page.locator(`[title="${path}"]`).click();
  };
  const compile = async (status: "ready" | "failed") => {
    const response = page.waitForResponse((r) => r.url().endsWith("/api/compile") && r.request().method() === "POST");
    await page.getByTestId("compile-button").click();
    const result = await response;
    expect(result.ok()).toBe(true);
    await expect(preview).toHaveAttribute("data-status", status, { timeout: 60_000 });
  };

  await test.step("Start from home and create a named multi-file paper", async () => {
    await page.goto("/");
    await page.getByRole("link", { name: "Start writing", exact: true }).click();
    await expect(page).toHaveURL(/project=local-/);
    await page.getByRole("button", { name: "Rename project", exact: true }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Closed journey paper");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await createFile("preamble.tex", "\\newcommand{\\proofword}{Caf\\'e closed journey}");
    await createFile("refs.bib", "@book{knuth, author={Donald Knuth}, title={The TeXbook}, year={1984}, publisher={Addison-Wesley}}\n");
    await page.locator('input[type="file"]').last().setInputFiles({
      name: "pixel.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
    await expect(page.getByRole("img", { name: "pixel.png", exact: true })).toHaveJSProperty("naturalWidth", 1);
    await open("main.tex");
    await source.fill("\\documentclass{article}\n\\usepackage{graphicx}\n\\input{preamble}\n\\begin{document}\n\\proofword\nOriginal prose.\n\\includegraphics[width=1cm]{pixel.png}\nReference~\\cite{knuth}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n");
    await page.getByRole("button", { name: "File actions for main.tex", exact: true }).click();
    await page.getByRole("menuitem", { name: /Rename/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("paper.tex");
    await dialog.getByRole("button", { name: "Rename", exact: true }).click();
    await saved();
    await page.reload();
    await expect(source).toContainText("Original prose.");
    await expect(preview).toContainText("paper.pdf");
  });
  const originalUrl = page.url();

  await test.step("Build the renamed root and download an actual PDF", async () => {
    await compile("ready");
    await expect(page.getByText('Bibliography entry "knuth" appears unused', { exact: true })).toHaveCount(0);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download", exact: true }).click();
    const pdf = await download;
    expect(pdf.suggestedFilename()).toBe("paper.pdf");
    const destination = testInfo.outputPath("closed-journey.pdf");
    await pdf.saveAs(destination);
    const bytes = await readFile(destination);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
    for (const width of [390, 768, 1440]) {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 720 });
        await page.emulateMedia({ colorScheme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        const panel = page.getByTestId("build-output-panel");
        const summary = page.getByTestId("build-summary");
        await expect(summary).toContainText("Build successful");
        const bounds = await summary.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const parent = element.closest('[data-testid="build-output-panel"]')!.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
            panelLeft: parent.left, panelRight: parent.right, panelTop: parent.top, panelBottom: parent.bottom };
        });
        expect(bounds.left).toBeGreaterThanOrEqual(bounds.panelLeft);
        expect(bounds.right).toBeLessThanOrEqual(bounds.panelRight);
        expect(bounds.top).toBeGreaterThanOrEqual(bounds.panelTop);
        expect(bounds.bottom).toBeLessThanOrEqual(bounds.panelBottom);
        expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        await expect(panel.getByText("Document Stats", { exact: true })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`build-panel-${width}-${colorScheme}.png`) });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
  });

  await test.step("Break a dependency, retain the preview and recover without losing prose", async () => {
    // This assertion covers embedded-viewer persistence; SyncTeX canvas has a dedicated real-worker test.
    await page.getByRole("button", { name: "Default", exact: true }).click();
    const pdf = await page.locator('iframe[title="Compiled PDF"]').getAttribute("src");
    await open("preamble.tex");
    await source.fill("% Macro removed by mistake\n");
    await open("paper.tex");
    const current = await source.innerText();
    await source.fill(current.replace("Original prose.", "Unrelated prose must survive."));
    await compile("failed");
    await expect(page.locator('iframe[title="Compiled PDF"]')).toHaveAttribute("src", pdf!);
    await saved();
    await page.reload();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: "Build recovery", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Find breaking change" });
    await dialog.getByRole("button", { name: "Test recovery", exact: true }).click();
    await expect(dialog.getByText("Compile-verified recovery", { exact: true })).toBeVisible({ timeout: 65_000 });
    await expect(dialog.getByTestId("recovery-result")).toContainText("Restoring preamble.tex");
    await dialog.getByRole("button", { name: "Apply tested file restoration" }).click();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(source).toContainText("Unrelated prose must survive.");
    await compile("ready");
  });

  await test.step("Save local edits while offline and reload them after reconnecting", async () => {
    await context.setOffline(true);
    try {
      const current = await source.innerText();
      await source.fill(current.replace("Unrelated prose must survive.", "Unrelated prose must survive. Offline edit retained."));
      await saved();
    } finally {
      await context.setOffline(false);
    }
    await page.reload();
    await expect(source).toContainText("Offline edit retained.");
  });

  await test.step("Export exact source and import it as an independent project", async () => {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download Source (.weftly.json)", exact: true }).click();
    const download = await pending;
    const destination = testInfo.outputPath("closed-journey.alove.json");
    await download.saveAs(destination);
    const archive = JSON.parse(await readFile(destination, "utf8"));
    expect(archive.mainFile).toBe("paper.tex");
    expect(archive.files["paper.tex"]).toContain("Offline edit retained.");
    expect(archive.files["preamble.tex"]).toContain("newcommand");
    expect(archive.files["refs.bib"]).toContain("The TeXbook");
    expect(archive.files["pixel.png"]).toMatch(/^data:image\/png;base64,/);
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page.getByLabel("Import project archive").setInputFiles(destination);
    await expect(page).toHaveURL(/project=local-/);
    expect(page.url()).not.toBe(originalUrl);
    await expect(source).toContainText("Offline edit retained.");
    await saved();
    await page.reload();
    await expect(source).toContainText("Offline edit retained.");
    await compile("ready");
  });

  await test.step("Delete both project copies and finish with an empty library", async () => {
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    const rows = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Open Closed journey paper", exact: true }) });
    await expect(rows).toHaveCount(2);
    for (let count = 2; count > 0; count--) {
      page.once("dialog", (dialog) => dialog.accept());
      await rows.first().getByRole("button", { name: /Delete/ }).click();
      await expect(rows).toHaveCount(count - 1);
    }
    await page.reload();
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("No saved projects yet", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test("a damaged uploaded image exposes the converter error without returning a PDF", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/projects");
  await page.getByLabel("Import project archive").setInputFiles({
    name: "damaged-image.alove.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      format: "alove-project", version: 1, title: "Damaged image regression", mainFile: "main.tex",
      files: {
        "main.tex": "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\includegraphics{damaged.png}\n\\end{document}\n",
        // The IDAT CRC is deliberately invalid, although browsers display it.
        "damaged.png": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lRkAAAAASUVORK5CYII=",
      },
    })),
  });
  await expect(page).toHaveURL(/project=local-/);
  await page.getByTestId("compile-button").click();
  await expect(page.getByTestId("pdf-preview-pane")).toHaveAttribute("data-status", "failed", { timeout: 60_000 });
  await expect(page.locator('iframe[title="Compiled PDF"]')).toHaveCount(0);
  await expect(page.getByTestId("pdf-canvas-viewer")).toHaveCount(0);
  await expect(page.getByTestId("pdf-sync-highlight")).toHaveCount(0);
  await expect(page.getByTestId("build-output-content")).toContainText(/libpng error|xdvipdfmx:fatal/i);
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByTestId("build-output-content")).toContainText(/libpng error|xdvipdfmx:fatal/i);
});
