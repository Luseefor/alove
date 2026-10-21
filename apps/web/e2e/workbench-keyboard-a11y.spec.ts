import { expect, test } from "@playwright/test";

test("narrow drawer moves focus in and returns focus on close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/editor");
  await expect(page.getByTestId("latex-editor")).toBeVisible();
  const filesToggle = page.getByRole("button", { name: "Files", exact: true });
  await expect(filesToggle).toHaveAttribute("aria-expanded", "false");
  await filesToggle.focus();
  await filesToggle.press("Enter");
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  await expect(filesToggle).toHaveAttribute("aria-expanded", "true");
  const closeButton = page.getByRole("button", {
    name: "Close project files",
    exact: true,
  });
  await expect(closeButton).toBeFocused();
  await closeButton.press("Escape");
  await expect(page.getByTestId("workbench-sidebar")).toBeHidden();
  await expect(filesToggle).toBeFocused();
});

test("rename dialog keeps focus inside and returns focus on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto("/editor");
  await expect(page.getByTestId("latex-editor")).toBeVisible();
  const rename = page.getByRole("button", { name: "Rename project" });
  await rename.click();
  const dialog = page.getByRole("dialog", { name: "Rename project" });
  await expect(dialog).toBeVisible();
  const nameField = page.getByRole("textbox", { name: "Project name" });
  await expect(nameField).toBeVisible();
  const focusInside = await page.evaluate(() => {
    const active = document.activeElement;
    return Boolean(
      active && active !== document.body && active.closest('[role="dialog"]'),
    );
  });
  expect(focusInside).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(rename).toBeFocused();
});

test("cite menu keeps keyboard access and Escape returns focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto("/editor");
  await expect(page.getByTestId("latex-editor")).toBeVisible();
  const cite = page.getByRole("button", { name: "Cite", exact: true });
  await cite.focus();
  await cite.press("Enter");
  const search = page.getByRole("textbox", { name: "Search references" });
  await expect(search).toBeVisible();
  await search.press("Escape");
  await expect(search).toBeHidden();
  await expect(cite).toBeFocused();
});

test("export menu downloads the source archive from the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto("/editor");
  await expect(page.getByTestId("latex-editor")).toBeVisible();
  const exportButton = page.getByRole("button", { name: "Export" });
  await exportButton.focus();
  await exportButton.press("Enter");
  const item = page.getByRole("menuitem", { name: /Download Source/ });
  await expect(item).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await item.focus();
  await item.press("Enter");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.alove\.json$/);
});

test("file rows and folders toggle from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto("/editor");
  await expect(page.getByTestId("latex-editor")).toBeVisible();
  const fileRow = page.getByRole("button", {
    name: "Open file sections/01-introduction.tex",
  });
  await fileRow.focus();
  await fileRow.press("Enter");
  await expect(fileRow).toHaveAttribute("aria-current", "true");
  const folderRow = page.getByRole("button", {
    name: "Collapse folder sections",
  });
  await folderRow.focus();
  await folderRow.press("Space");
  await expect(
    page.getByRole("button", { name: "Expand folder sections" }),
  ).toBeVisible();
  await expect(fileRow).toBeHidden();
});

test("narrow drawer traps Tab and exposes a dialog role", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/editor");
  await expect(page.getByTestId("latex-editor")).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Project files" }),
  ).toBeVisible();
  const closeButton = page.getByRole("button", {
    name: "Close project files",
    exact: true,
  });
  await expect(closeButton).toBeFocused();
  // Backward wrap: Shift+Tab from the first control stays inside the drawer.
  await closeButton.press("Shift+Tab");
  const wrappedBack = await page.evaluate(() => {
    const root = document.getElementById("workbench-sidebar");
    const active = document.activeElement;
    return Boolean(
      root &&
      active &&
      root.contains(active) &&
      active.getAttribute("aria-label") !== "Close project files",
    );
  });
  expect(wrappedBack).toBe(true);
  // Forward wrap: Tab from the last control returns to the first.
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
});

test("file actions menu opens from the keyboard without triggering the row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto("/editor");
  await expect(page.getByTestId("latex-editor")).toBeVisible();
  const actions = page.getByRole("button", {
    name: "File actions for sections/01-introduction.tex",
    exact: true,
  });
  await actions.focus();
  await actions.press("Enter");
  await expect(page.getByRole("menuitem", { name: /Rename/ })).toBeVisible();
  // Dismiss the menu first: Radix hides background content from the
  // accessibility tree while it is open.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: /Rename/ })).toBeHidden();
  await expect(actions).toBeFocused();
  await expect(
    page.getByRole("button", {
      name: "Open file sections/01-introduction.tex",
    }),
  ).not.toHaveAttribute("aria-current", "true");
});

test("narrow drawer yields to a nested dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/editor");
  await expect(page.getByTestId("latex-editor")).toBeVisible();
  const filesToggle = page.getByRole("button", { name: "Files", exact: true });
  await filesToggle.click();
  const drawer = page.getByRole("dialog", { name: "Project files" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "New file", exact: true }).click();
  const newFile = page.getByRole("dialog", { name: "Create new file" });
  await expect(newFile).toBeVisible();
  // Tab cycles inside the nested dialog; the drawer trap stands down.
  for (let i = 0; i < 6; i += 1) await page.keyboard.press("Tab");
  const focusInNestedDialog = await page.evaluate(() => {
    const nested = [...document.querySelectorAll('[role="dialog"]')].find(
      (dialog) =>
        dialog.getAttribute("aria-label") !== "Project files" &&
        dialog.contains(document.activeElement),
    );
    return Boolean(nested);
  });
  expect(focusInNestedDialog).toBe(true);
  // Escape closes only the nested dialog; the drawer stays open.
  await page.keyboard.press("Escape");
  await expect(newFile).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(filesToggle).not.toBeFocused();
  // A further Escape closes the drawer and returns focus to the toggle.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(filesToggle).toBeFocused();
});

test("history stays available on narrow layouts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/editor");
  await expect(page.getByTestId("latex-editor")).toBeVisible();
  const history = page.getByRole("button", { name: "History", exact: true });
  await expect(history).toBeVisible();
  await history.focus();
  await history.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Workspace history" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(history).toBeFocused();
});

test("phone layout keeps touch undo and redo available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/editor?new=true");
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  await source.fill("phone base");
  await source.press("End");
  await page.keyboard.insertText(" PHONE-EDIT");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).toContainText("phone base");
  await expect(source).not.toContainText("PHONE-EDIT");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(source).toContainText("PHONE-EDIT");
});
