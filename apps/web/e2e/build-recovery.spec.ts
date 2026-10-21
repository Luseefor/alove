import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test.skip(process.env.E2E_REAL_COMPILE !== "1", "Requires real Redis, Docker TeX and compile-worker.");

test("finds a tested file recovery, preserves unrelated edits, exports evidence, and undoes safely", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.goto("/editor?new=true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import Source as New Project" }).click();
  await page.getByLabel("Import project source").setInputFiles({ name: "regression.alove.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
    format: "alove-project", version: 1, title: "Regression debugger proof", mainFile: "main.tex", files: {
      "main.tex": "\\documentclass{article}\n\\input{preamble}\n\\begin{document}\n\\input{body}\n\\end{document}",
      "preamble.tex": "\\newcommand{\\proofword}{Verified recovery}",
      "body.tex": "\\proofword\nOriginal prose.",
    },
  })) });
  await expect(page.getByText("Regression debugger proof", { exact: true }).first()).toBeVisible();
  const preview = page.getByTestId("pdf-preview-pane");
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  await page.getByTestId("compile-button").click();
  await expect(preview).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  await page.locator('[title="preamble.tex"]').click();
  await editor.fill("% Removed macro definition");
  await page.locator('[title="body.tex"]').click();
  await editor.fill("\\proofword\nUnrelated prose retained.");
  await page.getByTestId("compile-button").click();
  await expect(preview).toHaveAttribute("data-status", "failed", { timeout: 60000 });
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
  // Reload verifies that recovery reads durable records, not just component state.
  await page.reload();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Build recovery", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Find breaking change" });
  await expect(dialog.getByText("Changed files (2)")).toBeVisible();
  await dialog.getByRole("button", { name: "Test recovery", exact: true }).click();
  await expect(dialog.getByText("Compile-verified recovery", { exact: true })).toBeVisible({ timeout: 65000 });
  await expect(dialog.getByTestId("recovery-result")).toContainText("Restoring preamble.tex");
  for (const width of [390, 525, 1440]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      const geometry = await dialog.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          width: innerWidth, height: innerHeight, overflow: element.scrollWidth > element.clientWidth + 1 };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.width);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
      expect(geometry.overflow).toBe(false);
      await dialog.getByRole("button", { name: "Apply tested file restoration" }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "Apply tested file restoration" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`recovery-${width}-${colorScheme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export debugging evidence" }).click();
  const download = await downloadEvent;
  const file = testInfo.outputPath("build-recovery.alove.json"); await download.saveAs(file);
  const capsule = JSON.parse(await readFile(file, "utf8"));
  expect(capsule.report.status).toBe("verified");
  expect(capsule.report.candidate.path).toBe("preamble.tex");
  expect(capsule.failed.files["body.tex"]).toContain("Unrelated prose retained.");
  expect(capsule.failed.result.environment.runtimeId).toMatch(/^sha256:/);
  expect(capsule.good.result).not.toHaveProperty("pdfBase64");
  await dialog.getByRole("button", { name: "Apply tested file restoration" }).click();
  await expect(dialog.getByText(/Recovery applied/)).toBeVisible();
  await dialog.getByRole("button", { name: "Undo file restoration" }).click();
  await expect(dialog.getByText("Recovery undone.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Apply tested file restoration" }).click();
  await page.screenshot({ path: testInfo.outputPath("verified-recovery.png") });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor).toContainText("Unrelated prose retained.");
  await page.locator('[title="preamble.tex"]').click();
  await expect(editor).toContainText("newcommand");
  await page.getByTestId("compile-button").click();
  await expect(preview).toHaveAttribute("data-status", "ready", { timeout: 60000 });
});

test("tests a change before applying it and retains separate prose edits in the same file", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const goodMain = "\\documentclass{article}\n\\newcommand{\\proofword}{Verified recovery}\n\\begin{document}\nStable context before the prose.\nOriginal prose.\n\\input{notes}\n\\proofword\n\\end{document}";
  const failedMain = goodMain.replace("\\newcommand{\\proofword}", "\\newcommand{\\proofwordBroken}")
    .replace("Original prose.", "Revised prose retained in the same file.");
  const repairedMain = failedMain.replace("\\newcommand{\\proofwordBroken}", "\\newcommand{\\proofword}");
  await page.goto("/editor?new=true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import Source as New Project" }).click();
  await page.getByLabel("Import project source").setInputFiles({ name: "focused-recovery.alove.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
    format: "alove-project", version: 1, title: "Focused recovery proof", mainFile: "main.tex",
    files: { "main.tex": goodMain, "notes.tex": "Original notes." },
  })) });
  await expect(page.getByText("Focused recovery proof", { exact: true }).first()).toBeVisible();
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  const preview = page.getByTestId("pdf-preview-pane");
  await page.getByTestId("compile-button").click();
  await expect(preview).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  await page.locator('[title="notes.tex"]').click();
  await editor.fill("New notes retained in another file.");
  await page.locator('[title="main.tex"]').click();
  await editor.fill(failedMain);
  await page.getByTestId("compile-button").click();
  await expect(preview).toHaveAttribute("data-status", "failed", { timeout: 60000 });
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Build recovery", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Find breaking change" });
  await dialog.getByRole("button", { name: "Test recovery", exact: true }).click();
  await expect(dialog.getByText("Compile-verified recovery", { exact: true })).toBeVisible({ timeout: 65000 });
  const apply = dialog.getByRole("button", { name: "Apply tested change restoration", exact: true });
  await expect(apply).toBeEnabled();
  const proposed = dialog.getByLabel("Tested restoration in main.tex");
  await expect(proposed).toContainText("newcommand");
  await expect(proposed).not.toContainText("Revised prose retained");
  const liveSource = page.locator('[data-testid="latex-editor-codemirror-content"], [data-testid="latex-editor-textarea"]').first();
  const readSource = () => liveSource.evaluate((el) => el instanceof HTMLTextAreaElement ? el.value : el.textContent ?? "");
  // Recovery trials must leave the current broken source intact until explicit Apply.
  expect(await readSource()).toContain("proofwordBroken");
  expect(await readSource()).toContain("Revised prose retained in the same file.");
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export debugging evidence" }).click();
  const download = await downloadEvent;
  const evidencePath = testInfo.outputPath("focused-recovery.alove.json");
  await download.saveAs(evidencePath);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  expect(evidence.report.candidate.scope).toBe("hunk");
  expect(evidence.report.candidate.before).toBe(repairedMain);
  expect(evidence.report.candidate.after).toBe(failedMain);
  const restoredFiles = { ...evidence.failed.files, "main.tex": repairedMain };
  const fingerprint = createHash("sha256").update(JSON.stringify([
    evidence.failed.mainFile, evidence.failed.engine, evidence.failed.cleanAux,
    Object.keys(restoredFiles).sort().map((path) => [path, restoredFiles[path]]),
  ])).digest("hex");
  expect(evidence.report.trials.at(-1).sourceHash).toBe(fingerprint);
  expect(evidence.report.trials.length).toBeLessThanOrEqual(6);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await apply.scrollIntoViewIfNeeded();
    await expect(apply).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath(`focused-recovery-${width}.png`) });
  }
  await apply.click();
  expect(await readSource()).not.toContain("proofwordBroken");
  expect(await readSource()).toContain("Revised prose retained in the same file.");
  await dialog.getByRole("button", { name: "Undo change restoration", exact: true }).click();
  expect(await readSource()).toContain("proofwordBroken");
  expect(await readSource()).toContain("Revised prose retained in the same file.");
  await apply.click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator('[title="notes.tex"]').click();
  await expect(editor).toContainText("New notes retained in another file.");
  await page.getByTestId("compile-button").click();
  await expect(preview).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  await page.reload();
  await expect(editor).toContainText("New notes retained in another file.");
  await page.locator('[title="main.tex"]').click();
  await expect(editor).toContainText("Revised prose retained in the same file.");
  await expect(editor).not.toContainText("proofwordBroken");
});
