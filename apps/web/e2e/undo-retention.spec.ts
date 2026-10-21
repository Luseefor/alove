import { test, expect } from "@playwright/test";

const explicitEditorMode = process.env.E2E_EDITOR_MODE;
const editorMode =
  explicitEditorMode === "codemirror" || explicitEditorMode === "textarea"
    ? explicitEditorMode
    : process.env.E2E_CODEMIRROR === "0"
      ? "textarea"
      : "codemirror";
const isCodeMirror = editorMode === "codemirror";

test.describe(
  isCodeMirror
    ? "undo retention / CodeMirror mode"
    : "undo retention / textarea fallback mode",
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/editor?new=true");
      await expect(
        page.getByRole("textbox", { name: "LaTeX source editor" }),
      ).toBeVisible({ timeout: 15_000 });
    });

    if (!isCodeMirror) {
      test("tab switches preserve content without crashing in fallback mode", async ({
        page,
      }) => {
        const source = page.getByRole("textbox", {
          name: "LaTeX source editor",
        });
        await source.fill("fallback base content");
        await page
          .getByRole("button", { name: "New file", exact: true })
          .last()
          .click();
        await expect(source).toHaveValue("");
        await source.fill("second file content");
        await page.getByText("main.tex", { exact: true }).first().click();
        await expect(source).toHaveValue("fallback base content");
        await page.getByText("untitled.tex", { exact: true }).first().click();
        await expect(source).toHaveValue("second file content");
      });
      return;
    }

    test("return-to-tab retains its own undo and redo", async ({ page }) => {
      const source = page.getByRole("textbox", { name: "LaTeX source editor" });
      await source.fill("base content");
      await source.press("End");
      await page.keyboard.insertText(" MARK_A");
      await expect(source).toContainText("MARK_A");

      await page
        .getByRole("button", { name: "New file", exact: true })
        .last()
        .click();
      await expect(source).toHaveText("");
      await source.fill("second file");

      await page.getByText("main.tex", { exact: true }).first().click();
      await expect(source).toContainText("MARK_A");

      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(source).not.toContainText("MARK_A");
      await expect(source).toContainText("base content");

      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expect(source).toContainText("MARK_A");
    });

    test("undo is isolated per file across tab switches", async ({ page }) => {
      const source = page.getByRole("textbox", { name: "LaTeX source editor" });
      await source.fill("file-a-base");
      await source.press("End");
      await page.keyboard.insertText(" A-EDIT");
      await expect(source).toContainText("A-EDIT");

      await page
        .getByRole("button", { name: "New file", exact: true })
        .last()
        .click();
      await expect(source).toHaveText("");
      await source.fill("file-b-base");
      await source.press("End");
      await page.keyboard.insertText(" B-EDIT");
      await expect(source).toContainText("B-EDIT");

      await page.getByText("main.tex", { exact: true }).first().click();
      await expect(source).toContainText("A-EDIT");
      await expect(source).not.toContainText("B-EDIT");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(source).not.toContainText("A-EDIT");
      await expect(source).toContainText("file-a-base");

      await page.getByText("untitled.tex", { exact: true }).first().click();
      await expect(source).toContainText("B-EDIT");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(source).not.toContainText("B-EDIT");
      await expect(source).toContainText("file-b-base");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expect(source).toContainText("B-EDIT");
    });

    test("deleted then recreated file does not resurrect undo", async ({
      page,
    }) => {
      const source = page.getByRole("textbox", { name: "LaTeX source editor" });
      await page
        .getByRole("button", { name: "New file", exact: true })
        .first()
        .click();
      let dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill("scratch.tex");
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await source.fill("v1");
      await source.press("End");
      await page.keyboard.insertText(" STALE-EDIT");
      await expect(source).toContainText("STALE-EDIT");

      await page
        .getByRole("button", {
          name: "File actions for scratch.tex",
          exact: true,
        })
        .click();
      await page
        .getByRole("menuitem", { name: "Delete…", exact: true })
        .click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(
        page.getByRole("button", {
          name: "File actions for scratch.tex",
          exact: true,
        }),
      ).toHaveCount(0);

      await page
        .getByRole("button", { name: "New file", exact: true })
        .first()
        .click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill("scratch.tex");
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await expect(source).toHaveText("");
      await source.fill("v1");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      // Fresh file: undo must not bring back the deleted file's edit.
      await expect(source).not.toContainText("STALE-EDIT");
    });

    test("settings changes preserve per-file undo across tabs", async ({
      page,
    }) => {
      const source = page.getByRole("textbox", { name: "LaTeX source editor" });
      await source.fill("settings base");
      await source.press("End");
      await page.keyboard.insertText(" SETTINGS-MARK");
      await expect(source).toContainText("SETTINGS-MARK");

      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      const settings = page.getByRole("dialog");
      await settings
        .getByRole("switch", { name: "Auto-complete", exact: true })
        .uncheck();
      await settings
        .getByRole("button", { name: "Close", exact: true })
        .click();

      await page
        .getByRole("button", { name: "New file", exact: true })
        .last()
        .click();
      await expect(source).toHaveText("");
      await page.getByText("main.tex", { exact: true }).first().click();
      await expect(source).toContainText("SETTINGS-MARK");

      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(source).not.toContainText("SETTINGS-MARK");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expect(source).toContainText("SETTINGS-MARK");

      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await settings
        .getByRole("switch", { name: "Auto-complete", exact: true })
        .check();
      await settings
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(source).toContainText("SETTINGS-MARK");
    });
  },
);
