import { expect, test, type Page } from "@playwright/test";

function sourceEditor(page: Page) {
  return page.getByRole("textbox", { name: "LaTeX source editor" });
}

async function saved(page: Page) {
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
}

test("local source, added empty file, and active tab survive refresh", async ({
  page,
}) => {
  await page.goto("/editor?new=true");
  await expect(page).toHaveURL(/project=local-/);
  const originalUrl = page.url();
  const text =
    "\\documentclass{article}\n\\begin{document}\nPersisted café source.\n\\end{document}";
  await sourceEditor(page).fill(text);
  await saved(page);
  await page
    .getByRole("button", { name: "New file", exact: true })
    .last()
    .click();
  await saved(page);
  await page.reload();
  await expect(
    page.getByText("untitled.tex", { exact: true }).first(),
  ).toBeVisible();
  await expect(sourceEditor(page)).toHaveText("");
  await page.getByText("main.tex", { exact: true }).first().click();
  await expect(sourceEditor(page)).toContainText("Persisted café source.");
  await saved(page);

  await page.goto("/editor?new=true");
  await expect(page).toHaveURL(/project=local-/);
  expect(page.url()).not.toBe(originalUrl);
  await expect(sourceEditor(page)).not.toContainText("Persisted café source.");
  await saved(page);
  await page.goto(originalUrl);
  await expect(sourceEditor(page)).toContainText("Persisted café source.");
});

test("source export imports as a separate recoverable project", async ({
  page,
}) => {
  await page.goto("/editor?new=true");
  await expect(page).toHaveURL(/project=local-/);
  const originalUrl = page.url();
  await sourceEditor(page).fill("\\section{Recoverable source}");
  await saved(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: "Download Source (.alove.json)",
      exact: true,
    })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByLabel("Import project source").setInputFiles(path!);
  await expect(page).not.toHaveURL(originalUrl);
  await expect(sourceEditor(page)).toContainText("Recoverable source");
  await saved(page);
  await page.reload();
  await expect(sourceEditor(page)).toContainText("Recoverable source");
});

test("a stale local tab keeps its draft and reports a conflict", async ({
  page,
  context,
}) => {
  await page.goto("/editor?new=true");
  await expect(page).toHaveURL(/project=local-/);
  await saved(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await saved(other);
  await sourceEditor(page).fill("\\section{First tab saved}");
  await saved(page);
  await sourceEditor(other).fill("\\section{Second tab draft}");
  await expect(
    other
      .getByRole("alert")
      .filter({ hasText: "different tab saved a newer version" }),
  ).toContainText("different tab saved a newer version");
  await expect(sourceEditor(other)).toContainText("Second tab draft");
  await page.reload();
  await expect(sourceEditor(page)).toContainText("First tab saved");
});
