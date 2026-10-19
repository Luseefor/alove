import { test, expect } from "@playwright/test";

test("citation search modes insert into the current source selection", async ({
  page,
}) => {
  await page.goto("/editor?template=bib");
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  await source.fill("alpha omega");
  await source.press("Home");
  await source.press("ArrowRight");
  await page.getByRole("button", { name: "Cite", exact: true }).click();
  await page.getByRole("textbox", { name: "Search references" }).fill("exampl");
  await page
    .getByRole("menuitem", { name: "example (2024)", exact: true })
    .click();
  await expect(source).toHaveText("a\\cite{example}lpha omega");
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: "Settings", exact: true }).click();
  await settings
    .getByRole("combobox", { name: "Reference search mode" })
    .selectOption("bibtex");
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Cite", exact: true }).click();
  await expect(
    page.getByText("No matching references.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search references" })
    .fill("example");
  await expect(
    page.getByRole("menuitem", { name: "example (2024)", exact: true }),
  ).toBeVisible();
});

test("file creation and rename surface errors and retain the selected main document", async ({
  page,
}) => {
  await page.goto("/editor?new=true");
  await page
    .getByRole("button", { name: "New file", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("main.tex");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/already exists/i);
  await dialog.getByRole("textbox").fill("notes.tex");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("button", { name: "File actions for notes.tex", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("../unsafe.tex");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("textbox").fill("chapter.tex");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("button", { name: "File actions for chapter.tex", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Set as Main Document", exact: true })
    .click();
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("pdf-preview-pane")).toContainText(
    "chapter.pdf",
  );
});

test("compiler settings and browser PDF option produce a real PDF", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_REAL_COMPILE !== "1",
    "Requires the actual Docker worker",
  );
  test.setTimeout(90_000);
  await page.goto("/editor?new=true");
  await page
    .getByRole("textbox", { name: "LaTeX source editor" })
    .fill(
      "\\documentclass{article}\n\\begin{document}\nReal viewer settings test.\n\\end{document}",
    );
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  const settings = page.getByRole("dialog");
  await settings
    .getByRole("combobox", { name: "PDF viewer", exact: true })
    .selectOption("browser");
  await settings.getByRole("button", { name: "Compiler", exact: true }).click();
  await settings
    .getByRole("combobox", { name: "Default engine", exact: true })
    .selectOption("pdflatex");
  await settings
    .getByRole("switch", { name: "Clean auxiliary files", exact: true })
    .check();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/compile"),
  );
  await page.getByTestId("compile-button").click();
  expect((await requestPromise).postDataJSON()).toMatchObject({
    engine: "pdflatex",
    cleanAux: true,
  });
  await expect(page.getByTestId("pdf-preview-pane")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 60_000 },
  );
  const open = page.getByRole("link", {
    name: "Open PDF in browser tab",
    exact: true,
  });
  await expect(open).toHaveAttribute("href", /^blob:/);
  const popupPromise = page.waitForEvent("popup");
  await open.click();
  const popup = await popupPromise;
  // Chromium's headless shell has no native PDF viewer. Verify the URL's actual
  // bytes and the popup action; the visible browser checks native rendering.
  const signature = await open.evaluate(async (anchor) => {
    const response = await fetch((anchor as HTMLAnchorElement).href);
    return {
      type: response.headers.get("content-type"),
      magic: (await response.text()).slice(0, 5),
    };
  });
  expect(signature).toEqual({ type: "application/pdf", magic: "%PDF-" });
  await popup.close();
});

test("Find navigation and Undo/Redo include toolbar insertions across tabs", async ({
  page,
}) => {
  await page.goto("/editor?new=true");
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  await source.fill("alpha beta gamma beta");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const find = page.getByRole("textbox", { name: "Find in file", exact: true });
  await find.fill("beta");
  await find.press("Enter");
  await find.press("Escape");
  await page.keyboard.insertText("MATCH");
  await expect(source).toHaveText("alpha MATCH gamma beta");
  await page
    .getByRole("button", { name: "Table", exact: true })
    .first()
    .click();
  await expect(source).toContainText("\\begin{table}");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).not.toContainText("\\begin{table}");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(source).toContainText("\\begin{table}");
  await page
    .getByRole("button", { name: "New file", exact: true })
    .last()
    .click();
  await expect(source).toHaveText("");
  await page.getByText("main.tex", { exact: true }).first().click();
  await expect(source).toContainText("\\begin{table}");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).not.toContainText("\\begin{table}");
});

test("settings control the editor and persist after reload", async ({
  page,
}) => {
  await page.goto("/editor?new=true");
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("switch", { name: "Auto-complete", exact: true })
    .uncheck();
  await dialog
    .getByRole("switch", { name: "Auto-close brackets", exact: true })
    .uncheck();
  await dialog
    .getByRole("switch", { name: "Non-blinking cursor", exact: true })
    .check();
  await dialog
    .getByRole("combobox", { name: "Keybindings", exact: true })
    .selectOption("emacs");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  await source.fill("abc");
  await source.press("End");
  await source.press("Control+a");
  await page.keyboard.insertText("X");
  await expect(source).toHaveText("Xabc");
  await source.press("End");
  await page.keyboard.insertText("{");
  await expect(source).toHaveText("Xabc{");
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await expect(
    dialog.getByRole("switch", { name: "Auto-complete", exact: true }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("switch", { name: "Non-blinking cursor", exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("combobox", { name: "Keybindings", exact: true }),
  ).toHaveValue("emacs");
});

test("global search handles regex failures, clears input, and jumps to matching source", async ({
  page,
}) => {
  await page.goto("/editor?new=true");
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  await source.fill("first\nneedle here\nlast");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const input = page.getByPlaceholder("Search text in project...");
  await page.getByRole("checkbox", { name: "Regex", exact: true }).check();
  await input.fill("[");
  await input.press("Enter");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /regular expression|regex|unterminated/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(input).toHaveValue("");
  await input.fill("needle");
  await input.press("Enter");
  await page.getByRole("button", { name: /needle here/ }).click();
  await page.keyboard.insertText("JUMP ");
  await expect(source).toContainText("JUMP needle here");
});

test("folder and binary upload controls preserve assets, reject collisions, and delete files", async ({
  page,
}) => {
  await page.goto("/editor?new=true");
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("assets");
  await dialog
    .getByRole("button", { name: "Create Folder", exact: true })
    .click();
  await expect(page.getByText("assets", { exact: true })).toBeVisible();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lRkAAAAASUVORK5CYII=",
    "base64",
  );
  const input = page.locator('input[type="file"]').last();
  await input.setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: png,
  });
  const asset = page.getByRole("img", { name: "pixel.png", exact: true });
  await expect(asset).toBeVisible();
  await expect(asset).toHaveJSProperty("naturalWidth", 1);
  await expect(
    page.getByRole("textbox", { name: "LaTeX source editor" }),
  ).toHaveCount(0);
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("img", { name: "pixel.png", exact: true }),
  ).toBeVisible();
  await input.setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByText(/already exists/i)).toBeVisible();
  await page
    .getByRole("button", { name: "File actions for pixel.png", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Delete…", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "File actions for pixel.png",
      exact: true,
    }),
  ).toHaveCount(0);
});
