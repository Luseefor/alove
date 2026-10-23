import { test, expect } from "@playwright/test";

test("template, project rename, library search and guarded deletion work", async ({
  page,
}) => {
  await page.goto("/projects");
  await page
    .getByRole("link", { name: "Article + BibTeX", exact: true })
    .click();
  await expect(page).toHaveURL(/project=local-/);
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  await expect(source).toContainText("\\bibliography{refs}");
  await expect(page.getByText("refs.bib", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Rename project", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Project name" })
    .fill("Library test paper");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("button", { name: "Rename project" })).toHaveText(
    "Library test paper",
  );
  await expect(page.getByText("Project saved", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page
    .getByRole("searchbox", { name: "Search projects by title" })
    .fill("Library test");
  const row = page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("link", {
        name: "Open Library test paper",
        exact: true,
      }),
    });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Rename/ }).click();
  await page
    .getByRole("textbox", { name: "New title for Library test paper" })
    .fill("Renamed in library");
  await page
    .getByRole("button", {
      name: "Save new title for Library test paper",
      exact: true,
    })
    .click();
  await page.getByRole("searchbox").fill("Renamed in library");
  const renamed = page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("link", {
        name: "Open Renamed in library",
        exact: true,
      }),
    });
  await expect(renamed).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await renamed.getByRole("button", { name: /Delete/ }).click();
  await expect(renamed).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await renamed.getByRole("button", { name: /Delete/ }).click();
  await expect(renamed).toHaveCount(0);
});

test("library archive import creates a durable independent project", async ({
  page,
}) => {
  await page.goto("/projects");
  await page
    .getByLabel("Import project archive")
    .setInputFiles({
      name: "paper.alove.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "alove-project",
          version: 1,
          title: "Imported library paper",
          mainFile: "main.tex",
          files: {
            "main.tex":
              "\\documentclass{article}\n\\begin{document}\nImported library text.\n\\end{document}",
          },
        }),
      ),
    });
  await expect(page).toHaveURL(/project=local-/);
  await expect(
    page.getByRole("textbox", { name: "LaTeX source editor" }),
  ).toContainText("Imported library text.");
  await expect(page.getByText("Project saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Rename project" })).toHaveText(
    "Imported library paper",
  );
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "does not create a live collaboration link",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download shareable source" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.weftly\.json$/);
});
