import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const explicitEditorMode = process.env.E2E_EDITOR_MODE;
const editorMode =
  explicitEditorMode === "codemirror" || explicitEditorMode === "textarea"
    ? explicitEditorMode
    : process.env.E2E_CODEMIRROR === "0"
      ? "textarea"
      : "codemirror";
const isCodeMirror = editorMode === "codemirror";
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
    await content.press("ControlOrMeta+a");
    await content.press("Delete");
    await content.fill(value);
    return;
  }
  await editorContentLocator(page).fill(value);
}

test.describe(
  isCodeMirror ? "editor / CodeMirror mode" : "editor / textarea fallback mode",
  () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor");
    // Select main.tex in the sidebar to activate the editor
    await page.getByText("main.tex", { exact: true }).first().click();
    
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

    test("CodeMirror host is absent in textarea fallback mode", async ({ page }) => {
      await expect(page.locator('.cm-editor')).toHaveCount(0);
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
      await content.press("ControlOrMeta+a");
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
      expect(text).toContain(original.slice(0, 10));

      await content.press("End");
      await content.type(" SUFFIX");
      text = await content.innerText();
      expect(text).toContain("SUFFIX");
    });

    test("selection and text replacement in CodeMirror", async ({ page }) => {
      const content = editorContentLocator(page);
      await content.click();
      await content.press("ControlOrMeta+a");
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

      await content.press("ControlOrMeta+z");
      await expect(content).not.toContainText(marker);

      await content.press("ControlOrMeta+Shift+z");
      await expect(content).toContainText(marker);
    });
  }

  test("template snippet insertion works in active editor", async ({ page }) => {
    await setEditorText(page, "\\documentclass{article}\n\\begin{document}\nBody\n\\end{document}\n");

    // Use "Figure" snippet instead of template section
    await page.locator('[data-testid="snippet-button-figure"]').click();

    const content = await readEditorText(page);
    expect(content).toContain("\\begin{figure}");
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

    // Use a snippet from the sidebar
    await page.locator('[data-testid="sidebar-snippet-Equation"]').click();

    let content = await readEditorText(page);
    expect(content).toContain("\\begin{equation}");
    expect(content).toContain("E = mc^2");

    if (isCodeMirror) {
      await setEditorText(page, "alpha beta");
      const cm = editorContentLocator(page);
      await cm.click();
      await cm.press("Home");
      for (let i = 0; i < 5; i += 1) {
        await cm.press("Shift+ArrowRight");
      }
    } else {
      await setEditorText(page, "alpha");
      const textarea = page.locator('[data-testid="latex-editor-textarea"]');
      await textarea.click();
      await page.keyboard.press("ControlOrMeta+a");
      expect(await textarea.evaluate((element: HTMLTextAreaElement) => ({
        start: element.selectionStart,
        end: element.selectionEnd,
      }))).toEqual({ start: 0, end: 5 });
    }

    // Use sidebar snippet for wrap test
    await page.locator('[data-testid="sidebar-snippet-Fraction"]').click();

    content = await readEditorText(page);
    if (isCodeMirror) {
      expect(content).toContain("\\frac{alpha}{b}");
      expect(content).toContain("beta");
    } else {
      expect(content).toContain("\\frac{alpha}{b}");
    }
  });

  if (!isCodeMirror) {
    test("snippet insertion follows the textarea caret", async ({ page }) => {
      await setEditorText(page, "alpha beta");
      const textarea = page.locator('[data-testid="latex-editor-textarea"]');
      await textarea.press("Home");
      for (let i = 0; i < 5; i += 1) await textarea.press("ArrowRight");
      await page.locator('[data-testid="sidebar-snippet-Fraction"]').click();
      await expect(textarea).toHaveValue("alpha\\frac{a}{b} beta");
    });
  }

  test("compile button is present and enabled", async ({ page }) => {
    const btn = page.locator('[data-testid="compile-button"]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test("find bar opens and accepts input", async ({ page }) => {
    await page.locator('[data-testid="snippet-button-figure"]').click(); // Just to have content
    await page.locator('[data-testid="find-button"]').click();
    const input = page.locator('[data-testid="find-input"]');
    await expect(input).toBeVisible();
    await input.fill("document");
    await expect(input).toHaveValue("document");
  });

  test("compile trigger does not crash UI", async ({ page }) => {
    const btn = page.locator('[data-testid="compile-button"]');
    await btn.click();
    await expect(page.locator('[data-testid="latex-editor"]')).toBeVisible();
  });

  test("PDF preview remains stable after compile trigger", async ({ page }) => {
    const pane = page.locator('[data-testid="pdf-preview-pane"]');
    const btn = page.locator('[data-testid="compile-button"]');

    await expect(pane).toBeVisible();
    await btn.click();

    await expect(page.locator('[data-testid="latex-editor"]')).toBeVisible();
    await expect(pane).toBeVisible();
    await expect(pane).toHaveAttribute("data-status", /queued|running|failed|ready/);

    const buildStatus = await pane.getAttribute("data-status");
    if (buildStatus === "ready") {
      // In new UI, we have a mockup or actual PDF
      return;
    }
    
    expect(buildStatus === "queued" || buildStatus === "running" || buildStatus === "failed").toBe(true);
  });
  },
);
