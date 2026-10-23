import { expect, test } from "@playwright/test";

test("builds the configured root and retains the last PDF on failure", async ({ page }) => {
  const roots: string[] = [];
  let count = 0;
  await page.route("**/api/compile", async (route) => {
    roots.push(route.request().postDataJSON().mainFile);
    await route.fulfill({ json: { jobId: String(++count) } });
  });
  await page.route("**/api/compile/*", async (route) => {
    const result = count === 1
      ? { phase: "ready", pdfBase64: "JVBERi0xLjQKJSVFT0Y=", diagnostics: [], log: "fixture" }
      : { phase: "failed", errorMessage: "Fixture error", diagnostics: [{ severity: "error", message: "Root error", file: "./main.tex", line: 2 }], log: "fixture failed" };
    await route.fulfill({ json: { state: "completed", result } });
  });
  await page.goto("/editor?new=true");
  await expect(page).toHaveURL(/project=local-/);
  await expect(page.getByRole("textbox", { name: "LaTeX source editor" })).toBeVisible();
  await page.getByRole("button", { name: "Build", exact: true }).first().click();
  const frame = page.locator('iframe[title="Compiled PDF"]');
  await expect(frame).toBeVisible();
  const previousPdf = await frame.getAttribute("src");

  await page.getByRole("button", { name: "New file", exact: true }).last().click();
  await expect(page.getByText("Stale preview", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Build", exact: true }).first().click();
  await expect(page.getByText("Build failed", { exact: true }).first()).toBeVisible();
  await expect(frame).toHaveAttribute("src", previousPdf!);
  expect(roots).toEqual(["main.tex", "main.tex"]);

  // Errors in the root must not paint the included/empty active file.
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
  await page.getByRole("button", { name: /Root error/ }).click();
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);

  // Root selection is explicit and durable, independent of the active tab.
  await page.getByRole("button", { name: "File actions for untitled.tex", exact: true }).last().click();
  await page.getByRole("menuitem", { name: "Set as Main Document", exact: true }).click();
  await page.getByRole("button", { name: "Build", exact: true }).first().click();
  await expect.poll(() => roots.at(-1)).toBe("untitled.tex");
  await expect(page.getByText(/^Project saved$/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Build", exact: true }).first().click();
  await expect.poll(() => roots.length).toBe(4);
  expect(roots.at(-1)).toBe("untitled.tex");
});

test("undo in one file cannot restore the contents of another file", async ({ page }) => {
  await page.goto("/editor?new=true");
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  await editor.fill("ROOT_CONTENT");
  await page.getByRole("button", { name: "New file", exact: true }).last().click();
  await editor.fill("CHAPTER_CONTENT");
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("ROOT_CONTENT");
  await page.getByText("main.tex", { exact: true }).first().click();
  await expect(editor).toContainText("ROOT_CONTENT");
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("CHAPTER_CONTENT");
});

test("changing spellcheck preserves source and undo", async ({ page }) => {
  await page.goto("/editor?new=true");
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("SETTINGS_UNDO_MARKER");
  await page.getByRole("button", { name: "Spell: Off", exact: true }).click();
  await expect(page.getByRole("button", { name: "Spell: On", exact: true })).toBeVisible();
  await expect(editor).toContainText("SETTINGS_UNDO_MARKER");
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("SETTINGS_UNDO_MARKER");
  await expect(editor).toContainText("documentclass");
});
