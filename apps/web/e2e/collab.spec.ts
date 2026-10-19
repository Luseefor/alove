import { test, expect } from "@playwright/test";

test.describe("Cloud Collaboration Mode", () => {
  // These tests verify the cloud environment configuration behavior.
  // Note: For a fully provisioned Convex/Clerk environment,
  // we would use Clerk testing tokens to bypass the sign-in redirect
  // and directly interact with the Convex database.

  test("redirects to sign-in when local standalone mode is false", async ({ page }) => {
    // If the test environment is running in cloud mode (E2E_CLOUD=true),
    // the Next.js middleware should intercept the request and redirect to Clerk's sign-in.
    // We only execute this check if the env var explicitly asks for cloud testing.
    test.skip(process.env.E2E_CLOUD !== "true", "Run only in cloud e2e mode");

    await page.goto("/editor");

    // The middleware should trigger a redirect to the Clerk sign-in page.
    await expect(page).toHaveURL(/.*sign-in.*/);
    await expect(page.locator("text=Sign in")).toBeVisible();
  });

  test("Convex components are conditionally rendered based on environment", async ({ page }) => {
    test.skip(process.env.E2E_CLOUD !== "true", "Run only in cloud e2e mode");

    await page.goto("/");
    
    // In cloud mode, the hero or header should display the "Sign In" button
    // or Cloud-specific messaging instead of "Local Mode"
    const signInBtn = page.locator("text=Sign in");
    await expect(signInBtn).toBeVisible();

    // "Local Sandbox" specific items should NOT be present
    await expect(page.locator("text=Standalone offline mode")).not.toBeVisible();
  });
});
