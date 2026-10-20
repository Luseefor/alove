import { test, expect } from "@playwright/test";

test.describe("Dashboard / Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads the dashboard and renders hero", async ({ page }) => {
    await expect(page.locator("text=Write, compile, and polish")).toBeVisible();
    await expect(page.locator("text=Open Editor")).toBeVisible();
    await expect(page.getByRole("link",{name:"New Project",exact:true}).first()).toBeVisible();
  });

  test("sidebar navigation is functional", async ({ page }) => {
    const sidebar = page.getByRole("complementary");
    const homeLink = sidebar.getByRole("link", { name: "Home" });
    await expect(homeLink).toBeVisible();

    const projectsLink = sidebar.getByRole("link", { name: "Projects" });
    await expect(projectsLink).toBeVisible();

    const settingsLink = sidebar.getByRole("link", { name: "Settings" });
    await expect(settingsLink).toBeVisible();

    // The badge identifies local mode; backend health is reported separately.
    await expect(sidebar.getByText("LOCAL", { exact: true })).toBeVisible();
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

  test("saved projects replace fabricated sample history",async({page})=>{
    await expect(page.getByText("No saved projects yet",{exact:true})).toBeVisible();
    await expect(page.getByRole("searchbox",{name:"Search projects by title"})).toBeVisible();
    await page.getByRole("link",{name:"View all",exact:true}).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test("pro tip can be dismissed", async ({ page }) => {
    const proTip = page.locator("text=Pro Tip");
    await expect(proTip).toBeVisible();

    await page.getByRole("button",{name:"Dismiss writing tip",exact:true}).click();
    await expect(proTip).not.toBeVisible();
  });
});
