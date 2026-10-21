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

async function setEditorText(page: Page, value: string) {
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
  isCodeMirror
    ? "language tools / CodeMirror mode"
    : "language tools / textarea fallback mode",
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/editor?new=true");
      await expect(page.getByText("main.tex", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      await editorContentLocator(page).first().waitFor({ timeout: 15_000 });
      await expect(page.locator('[data-testid="latex-editor"]')).toBeVisible();
    });

    if (isCodeMirror) {
      test("ref completion lists the project label", async ({ page }) => {
        await setEditorText(
          page,
          "\\section{Introduction}\n\\label{sec:intro}\n\nSee ",
        );
        const content = editorContentLocator(page);
        await content.click();
        await content.press("ControlOrMeta+End");
        await content.pressSequentially("\\ref{sec:i", { delay: 20 });
        // Typing should trigger project-aware completion; fall back to
        // the explicit trigger when the tooltip needs a nudge.
        const tooltip = page.locator(".cm-tooltip-autocomplete");
        if ((await tooltip.count()) === 0) {
          await content.press("ControlOrMeta+ ");
        }
        await expect(tooltip).toBeVisible({ timeout: 10_000 });
        await expect(tooltip).toContainText("sec:intro");
      });

      test("spellcheck flags prose and preserves source across the toggle", async ({
        page,
      }) => {
        await setEditorText(page, "The teh quick brown fox jumps.");
        const content = editorContentLocator(page);
        await expect(content).toContainText("teh");

        await page.getByRole("button", { name: "Spell: Off", exact: true }).click();
        // The full dictionary lazy-loads on enable; wait for readiness.
        await expect(
          page.getByRole("button", { name: "Spell: On", exact: true }),
        ).toBeVisible({ timeout: 20_000 });
        await expect(content).toContainText("teh");
        await expect
          .poll(() => page.locator(".cm-lintRange-warning").count(), {
            timeout: 20_000,
          })
          .toBeGreaterThan(0);

        await page.getByRole("button", { name: "Spell: On", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Spell: Off", exact: true }),
        ).toBeVisible();
        await expect(content).toContainText("teh");
        await expect(page.locator(".cm-lintRange-warning")).toHaveCount(0);
      });
    } else {
      test("textarea keeps spellcheck attribute and content", async ({
        page,
      }) => {
        const textarea = page.locator(
          '[data-testid="latex-editor-textarea"]',
        );
        await textarea.fill("The teh quick brown fox jumps.");
        await expect(textarea).toHaveValue(
          "The teh quick brown fox jumps.",
        );
        await page.getByRole("button", { name: "Spell: Off", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Spell: On", exact: true }),
        ).toBeVisible();
        await expect(textarea).toHaveValue(
          "The teh quick brown fox jumps.",
        );
      });
    }
  },
);
