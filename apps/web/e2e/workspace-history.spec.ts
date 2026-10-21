import { expect, test } from "@playwright/test";

test("history previews, cancels, restores and preserves a checkpoint of replaced work", async ({
  page,
}) => {
  await page.goto("/editor?new=true");
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  const saved = page.getByText("Project Saved", { exact: true });
  await expect(saved).toBeVisible();
  await editor.fill("Original historical source");
  await expect(saved).toBeVisible();
  await editor.fill("Current source to preserve");
  await expect(saved).toBeVisible();
  const trigger = page.getByRole("button", { name: "History", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Workspace history" });
  const checkpoints = dialog.getByRole("combobox", {
    name: "Checkpoint",
    exact: true,
  });
  await expect(checkpoints.locator("option")).toHaveCount(3);
  await checkpoints.selectOption({ index: 1 });
  await expect(dialog).toContainText("Original historical source");
  await expect(dialog).toContainText("Current source to preserve");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(editor).toContainText("Current source to preserve");
  await trigger.click();
  await checkpoints.selectOption({ index: 1 });
  await dialog
    .getByRole("button", { name: "Restore checkpoint", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(editor).toContainText("Original historical source");
  await expect(saved).toBeVisible();
  await page.reload();
  await expect(editor).toContainText("Original historical source");
  await trigger.click();
  await checkpoints.selectOption({ index: 1 });
  await expect(dialog).toContainText("Current source to preserve");
  await dialog
    .getByRole("button", { name: "Restore checkpoint", exact: true })
    .click();
  await expect(editor).toContainText("Current source to preserve");
});

test("deleted project checkpoints recover into an independent project", async ({
  page,
}) => {
  await page.goto("/editor?new=true");
  const originalUrl = page.url();
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  await editor.fill("Recover deleted project source");
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
  const projectId = new URL(page.url()).searchParams.get("project");
  await page.goto("/projects");
  const row = page
    .locator("li")
    .filter({ has: page.locator(`a[href*="${projectId}"]`) });
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: /^Delete / }).click();
  await expect(row).toHaveCount(0);
  await page.getByText("Recover deleted projects", { exact: true }).click();
  await page
    .getByRole("button", { name: /^Recover Untitled Project$/ })
    .click();
  await page.getByRole("link", { name: "Open recovered project" }).click();
  await expect(editor).toContainText("Recover deleted project source");
  expect(page.url()).not.toBe(originalUrl);
  expect(new URL(page.url()).searchParams.get("project")).not.toBe(projectId);
});
