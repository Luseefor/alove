import { expect, test } from "@playwright/test";

for (const path of ["/help", "/privacy", "/status"]) {
  test(`public ${path} has navigation and a page title`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page).not.toHaveTitle(/^alove$/i);
    await expect(page.locator('a[href="/"]').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("unknown route offers useful recovery with 404 status", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: /projects/i })).toHaveAttribute("href", "/projects");
  await page.getByRole("link", { name: /home/i }).click();
  await expect(page).toHaveURL("/");
});

test("status retry recovers from an unavailable compile backend", async ({ page }) => {
  let count = 0;
  await page.route("**/api/ready", (route) => {
    count++;
    return route.fulfill({ status: count === 1 ? 503 : 200, contentType: "application/json", body: JSON.stringify({ ok: count > 1, checks: { configuration: true, redis: count > 1, worker: count > 1 } }) });
  });
  await page.goto("/status");
  await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /retry/i }).click();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
  expect(count).toBe(2);
});
