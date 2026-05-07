import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const isCodeMirror = process.env.E2E_CODEMIRROR === "1";
const codeMirrorContentSelector =
  '[data-testid="latex-editor-codemirror-content"], .cm-content';

function editorContentLocator(page: Page) {
  return isCodeMirror
    ? page.locator(codeMirrorContentSelector).first()
    : page.locator('[data-testid="latex-editor-textarea"]');
}

async function readEditorText(
  page: Page,
): Promise<string> {
  if (isCodeMirror) {
    return await editorContentLocator(page).innerText();
  }
  return await editorContentLocator(page).inputValue();
}

async function setEditorText(
  page: Page,
  value: string,
) {
  if (isCodeMirror) {
    const content = editorContentLocator(page);
    await content.click();
    await content.press("Meta+a");
    await content.press("Delete");
    await content.fill(value);
    return;
  }
  await editorContentLocator(page).fill(value);
}

test.describe(isCodeMirror ? "editor / CodeMirror mode" : "editor / textarea (default) mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor");
    if (isCodeMirror) {
      await expect(editorContentLocator(page)).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.locator('[data-testid="latex-editor-textarea"]')).toBeVisible({ timeout: 15_000 });
    }
    await expect(page.locator('[data-testid="pdf-preview-pane"]')).toBeVisible();
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
      const content = editorContentLocator(page);
      const text = await content.innerText();
      expect(text.length).toBeGreaterThan(0);
    });

    test("typing in CodeMirror updates content", async ({ page }) => {
      const content = editorContentLocator(page);
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
      const content = editorContentLocator(page);
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
      const content = editorContentLocator(page);
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
      const content = editorContentLocator(page);
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

  test("template snippet insertion works in active editor", async ({ page }) => {
    await setEditorText(page, "\\documentclass{article}\n\\begin{document}\nBody\n\\end{document}\n");

    await page.getByRole("button", { name: "Templates" }).click();
    await page.locator('[data-testid="snippet-button-section"]').click();

    const content = await readEditorText(page);
    expect(content).toContain("\\section{New Section}");
  });

  test("equation snippet insertion supports cursor insert and selection wrap", async ({ page }) => {
    await setEditorText(page, "alpha beta");

    if (isCodeMirror) {
      const content = editorContentLocator(page);
      await content.click();
      await content.press("Home");
    } else {
      const textarea = page.locator('[data-testid="latex-editor-textarea"]');
      await textarea.click();
      await textarea.press("Home");
    }

    await page.locator('[data-testid="snippet-button"]').click();
    await page.locator('[data-testid="snippet-button-equation"]').click();

    let content = await readEditorText(page);
    expect(content).toContain("\\begin{equation}");
    expect(content).toContain("E = mc^2");

    await setEditorText(page, "alpha beta");

    if (isCodeMirror) {
      const cm = editorContentLocator(page);
      await cm.click();
      await cm.press("Home");
      for (let i = 0; i < 5; i += 1) {
        await cm.press("Shift+ArrowRight");
      }
    } else {
      const textarea = page.locator('[data-testid="latex-editor-textarea"]');
      await textarea.click();
      await textarea.press("Home");
      for (let i = 0; i < 5; i += 1) {
        await textarea.press("Shift+ArrowRight");
      }
    }

    await page.locator('[data-testid="snippet-button"]').click();
    await page.locator('[data-testid="snippet-button-equation"]').click();

    content = await readEditorText(page);
    expect(content).toContain("\\begin{equation}\nalpha\n\\end{equation}");
    expect(content).toContain("beta");
  });

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

    const editorText = await readEditorText(page);

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

  test("PDF preview remains stable after compile trigger", async ({ page }) => {
    const pane = page.locator('[data-testid="pdf-preview-pane"]');
    const status = page.locator('[data-testid="compile-status"]');
    const btn = page.locator('[data-testid="compile-button"]');

    await expect(pane).toBeVisible();
    await btn.click();

    await expect(page.locator('[data-testid="latex-editor"]')).toBeVisible();
    await expect(pane).toBeVisible();
    await expect(status).toHaveAttribute("data-status", /queued|running|failed|ready/);

    const buildStatus = await status.getAttribute("data-status");
    if (buildStatus === "ready") {
      await expect(page.locator('iframe[title="Compiled PDF"]')).toBeVisible();
      return;
    }
    if (buildStatus === "failed") {
      await expect(page.locator('[data-testid="pdf-preview-error"]')).toBeVisible();
      return;
    }

    expect(buildStatus === "queued" || buildStatus === "running").toBe(true);
  });
});
