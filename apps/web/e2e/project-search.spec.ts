import { test, expect, type Page } from "@playwright/test";

const explicitEditorMode = process.env.E2E_EDITOR_MODE;
const editorMode =
  explicitEditorMode === "codemirror" || explicitEditorMode === "textarea"
    ? explicitEditorMode
    : process.env.E2E_CODEMIRROR === "0"
      ? "textarea"
      : "codemirror";
const isCodeMirror = editorMode === "codemirror";

function editorLocator(page: Page) {
  return isCodeMirror
    ? page.locator('[data-testid="latex-editor-codemirror-content"], .cm-content').first()
    : page.locator('[data-testid="latex-editor-textarea"]');
}

async function readEditorText(page: Page): Promise<string> {
  if (isCodeMirror) return await editorLocator(page).innerText();
  return await editorLocator(page).inputValue();
}

async function openSearch(page: Page) {
  await page.getByRole("button", { name: "Search", exact: true }).first().click();
  await expect(page.getByTestId("project-search-input")).toBeVisible();
}

async function runFind(page: Page, query: string) {
  await page.getByTestId("project-search-input").fill(query);
  await page.getByTestId("project-search-find").click();
}

test.describe("project search", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/editor?new=true");
    await expect(page).toHaveURL(/project=local-/);
    await expect(editorLocator(page)).toBeVisible({ timeout: 15_000 });
    // Fresh project: \documentclass{article}\n\begin{document}\n\n\end{document}
    await openSearch(page);
  });

  test("finds matches grouped by file with counts", async ({ page }) => {
    await runFind(page, "document");
    await expect(page.getByTestId("project-search-count")).toContainText("3 matches");
    await expect(page.getByTestId("project-search-count")).toContainText("1 file");
    await expect(page.getByTestId("project-search-group-main.tex")).toBeVisible();
    const matches = page.getByTestId("project-search-match");
    await expect(matches).toHaveCount(3);
    await expect(matches.first().locator("mark")).toContainText("document");
  });

  test("match click navigates the editor to the exact hit", async ({ page }) => {
    await runFind(page, "article");
    const matches = page.getByTestId("project-search-match");
    await expect(matches).toHaveCount(1);
    await matches.first().click();
    await expect(editorLocator(page)).toContainText("article");
  });

  test("whole-word, regex, and exclude globs narrow results", async ({ page }) => {
    await runFind(page, "document");
    await expect(page.getByTestId("project-search-count")).toContainText("3 matches");
    await page.getByTestId("project-search-whole-word").check();
    await page.getByTestId("project-search-find").click();
    // "documentclass" is excluded by the word boundary; begin/end remain.
    await expect(page.getByTestId("project-search-count")).toContainText("2 matches");
    await page.getByTestId("project-search-whole-word").uncheck();
    await page.getByTestId("project-search-regex").check();
    await runFind(page, "\\\\begin\\{document\\}");
    await expect(page.getByTestId("project-search-count")).toContainText("1 match");
    await page.getByTestId("project-search-regex").uncheck();
    await page.getByTestId("project-search-exclude").fill("main.tex");
    await page.getByTestId("project-search-find").click();
    await expect(page.getByTestId("project-search-count")).toContainText("0 matches");
  });

  test("replace all previews before mutating source", async ({ page }) => {
    await runFind(page, "document");
    await expect(page.getByTestId("project-search-count")).toContainText("3 matches");
    await page.getByTestId("project-search-replace-input").fill("DOCXYZ");
    await page.getByTestId("project-search-replace-all").click();
    const preview = page.getByTestId("project-search-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("3 matches");
    await page.getByTestId("project-search-confirm-replace-all").click();
    await expect(editorLocator(page)).toContainText("DOCXYZ");
    await expect(page.getByTestId("project-search-count")).toContainText("0 matches");
    expect(await readEditorText(page)).not.toContain("document");
  });

  test("single replace updates one hit and refreshes counts", async ({ page }) => {
    await runFind(page, "document");
    await expect(page.getByTestId("project-search-match")).toHaveCount(3);
    await page.getByTestId("project-search-replace-input").fill("DOCXYZ");
    await page.getByTestId("project-search-replace-one").first().click();
    await expect(page.getByTestId("project-search-count")).toContainText("2 matches");
    expect(await readEditorText(page)).toContain("DOCXYZ");
  });

  test("editing source marks results stale and blocks replacement", async ({ page }) => {
    await runFind(page, "document");
    await expect(page.getByTestId("project-search-count")).toContainText("3 matches");
    await editorLocator(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" % stale-marker");
    await expect(page.getByTestId("project-search-stale")).toBeVisible();
    await expect(page.getByTestId("project-search-replace-all")).toBeDisabled();
    await expect(page.getByTestId("project-search-replace-one").first()).toBeDisabled();
  });
});
