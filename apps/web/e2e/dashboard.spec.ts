import { test, expect } from "@playwright/test";

test.describe("Dashboard / Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads the dashboard and renders hero", async ({ page }) => {
    await expect(page.locator("text=Write, compile, and polish")).toBeVisible();
    await expect(page.locator("text=Open Editor")).toBeVisible();
    await expect(page.locator("text=New Project")).toBeVisible();
  });

  test("sidebar navigation is functional", async ({ page }) => {
    const sidebar = page.getByRole("complementary");
    const homeLink = sidebar.getByRole("link", { name: "Home" });
    await expect(homeLink).toBeVisible();

    const projectsLink = sidebar.getByRole("link", { name: "Projects" });
    await expect(projectsLink).toBeVisible();

    const settingsLink = sidebar.getByRole("link", { name: "Settings" });
    await expect(settingsLink).toBeVisible();

    // The system status card should indicate ONLINE
    await expect(sidebar.locator("text=ONLINE")).toBeVisible();
  });

  test("quick start actions navigate correctly", async ({ page }) => {
    const newDoc = page.locator("text=New Document");
    await expect(newDoc).toBeVisible();
    
    // Navigate to editor
    const editor = page.getByRole("link", { name: "LaTeX Editor", exact: true });
    await expect(editor).toBeVisible();
    await editor.click();
    await expect(page).toHaveURL(/\/editor/);
  });

  test("recent projects displays the sample project", async ({ page }) => {
    await expect(page.locator("text=Quantum Entanglement Review")).toBeVisible();
    await expect(page.locator("text=main.tex").first()).toBeVisible();
  });

  test("pro tip can be dismissed", async ({ page }) => {
    const proTip = page.locator("text=Pro Tip");
    await expect(proTip).toBeVisible();

    const tipContainer = page.locator("text=Pro Tip").locator("..");
    const buttons = await tipContainer.locator("button").all();
    if (buttons.length > 1) {
      await buttons[1].click();
      await expect(proTip).not.toBeVisible();
    }
  });
});
