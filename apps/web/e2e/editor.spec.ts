import { test, expect } from "@playwright/test";

const isCodeMirror = process.env.E2E_CODEMIRROR === "1";

test.describe(isCodeMirror ? "editor / CodeMirror mode" : "editor / textarea (default) mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor");
    if (isCodeMirror) {
      await expect(page.locator(".cm-content")).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.locator('[data-testid="latex-editor-textarea"]')).toBeVisible({ timeout: 15_000 });
    }
  });

  test("editor surface is mounted", async ({ page }) => {
    await expect(page.locator('[data-testid="latex-editor"]')).toBeVisible();
  });

  if (!isCodeMirror) {
    test("textarea contains initial content", async ({ page }) => {
      const textarea = page.locator('[data-testid="latex-editor-textarea"]');
      const val = await textarea.inputValue();
      expect(val.length).toBeGreaterThan(0);
    });

    test("typing updates textarea content", async ({ page }) => {
      const textarea = page.locator('[data-testid="latex-editor-textarea"]');
      await textarea.fill("\\section{Playwright Test}");
      await expect(textarea).toHaveValue("\\section{Playwright Test}");
    });

    test("CodeMirror host is absent in default mode", async ({ page }) => {
      await expect(page.locator('[data-testid="latex-editor-codemirror"]')).toHaveCount(0);
    });
  }

  if (isCodeMirror) {
    test("CodeMirror .cm-content is visible with initial text", async ({ page }) => {
      const content = page.locator(".cm-content");
      const text = await content.innerText();
      expect(text.length).toBeGreaterThan(0);
    });

    test("typing in CodeMirror updates content", async ({ page }) => {
      const content = page.locator(".cm-content");
      await content.click();
      await content.press("Meta+a");
      await content.press("Delete");
      await content.fill("\\section{CM Test}");
      await expect(content).toContainText("CM Test");
    });

    test("textarea fallback is absent in CodeMirror mode", async ({ page }) => {
      await expect(page.locator('[data-testid="latex-editor-textarea"]')).toHaveCount(0);
    });

    test("cursor navigation and text insertion in CodeMirror", async ({ page }) => {
      const content = page.locator(".cm-content");
      await content.click();
      const original = await content.innerText();

      await content.press("Home");
      await content.type("PREFIX ");
      let text = await content.innerText();
      expect(text).toContain("PREFIX ");
      expect(text).toContain(original.slice(0, 20));

      await content.press("End");
      await content.type(" SUFFIX");
      text = await content.innerText();
      expect(text).toContain("SUFFIX");
    });

    test("selection and text replacement in CodeMirror", async ({ page }) => {
      const content = page.locator(".cm-content");
      await content.click();
      await content.press("Meta+a");
      await content.press("Delete");
      const replacement = "\\section{Replacement Test}\nUnique content here.";
      await content.fill(replacement);
      await expect(content).toContainText("Replacement Test");

      const text = await content.innerText();
      expect(text).toContain("Unique content here");
    });

    test("undo and redo via keyboard in CodeMirror", async ({ page }) => {
      const content = page.locator(".cm-content");
      await content.click();

      const marker = "UNDO_REDO_MARKER_" + Date.now();
      await content.press("End");
      await content.type(" " + marker);
      await expect(content).toContainText(marker);

      await content.press("Meta+z");
      await expect(content).not.toContainText(marker);

      await content.press("Meta+Shift+z");
      await expect(content).toContainText(marker);
    });
  }

  test("compile button is present and enabled", async ({ page }) => {
    const btn = page.locator('[data-testid="compile-button"]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test("find bar opens and accepts input", async ({ page }) => {
    await page.getByRole("button", { name: "Toggle find bar" }).click();
    const input = page.locator('[data-testid="find-input"]');
    await expect(input).toBeVisible();
    await input.fill("document");
    await expect(input).toHaveValue("document");
  });

  test("find/search for existing text completes without error", async ({ page }) => {
    await page.getByRole("button", { name: "Toggle find bar" }).click();
    const input = page.locator('[data-testid="find-input"]');
    await expect(input).toBeVisible();

    const editorText = isCodeMirror
      ? await page.locator(".cm-content").innerText()
      : await page.locator('[data-testid="latex-editor-textarea"]').inputValue();

    const commonWord = editorText.split(/\s+/).find((w) => w.length > 3 && w.length < 20);
    if (commonWord) {
      await input.fill(commonWord);
      await expect(input).toHaveValue(commonWord);
    }
  });

  test("find/search for non-existent text does not crash", async ({ page }) => {
    await page.getByRole("button", { name: "Toggle find bar" }).click();
    const input = page.locator('[data-testid="find-input"]');
    await expect(input).toBeVisible();

    await input.fill("XYZZY_NONEXISTENT_12345");
    await expect(input).toHaveValue("XYZZY_NONEXISTENT_12345");
    await expect(page.locator('[data-testid="latex-editor"]')).toBeVisible();
  });

  test("compile trigger does not crash UI", async ({ page }) => {
    const btn = page.locator('[data-testid="compile-button"]');
    await btn.click();
    await expect(page.locator('[data-testid="latex-editor"]')).toBeVisible();
  });
});
