import { expect, test } from "@playwright/test";

test.skip(process.env.E2E_REAL_COMPILE !== "1", "Requires real Redis, worker and Docker TeX.");
test("cancelling a running build stops the worker and preserves source", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/editor?new=true");
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  const source = String.raw`\documentclass{article}
\begin{document}
\loop\iftrue\repeat
\end{document}`;
  await editor.fill(source);
  const submitted = page.waitForResponse((r) => r.url().endsWith("/api/compile") && r.request().method() === "POST");
  await page.getByTestId("compile-button").click();
  const { jobId } = await (await submitted).json();
  try {
  await expect.poll(async () => (await (await page.request.get(`/api/compile/${jobId}`)).json()).state, { timeout: 30000 }).toBe("active");
  const cancelled = page.waitForResponse((r) => r.url().endsWith(`/api/compile/${jobId}`) && r.request().method() === "DELETE");
  await page.getByRole("button", { name: /cancel build/i }).click();
  expect((await cancelled).ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get(`/api/compile/${jobId}`)).json()).result?.errorCode, { timeout: 15000 }).toBe("CANCELLED");
  await expect(page.getByTestId("pdf-preview-pane")).toHaveAttribute("data-status", "failed");
  await expect(editor).toContainText("\\loop\\iftrue\\repeat");
  } finally {
    // A failed assertion must not leave an infinite job ahead of later tests.
    await page.request.delete(`/api/compile/${jobId}`).catch(() => {});
  }
});
