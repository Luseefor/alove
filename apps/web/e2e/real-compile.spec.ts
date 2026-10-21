import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.skip(process.env.E2E_REAL_COMPILE !== "1", "Requires running Redis, compile-worker, Docker and TeX; no API mocks.");

test("create, edit, compile, download, retain a good PDF after failure, and reload source", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const source = String.raw`\documentclass{article}
\begin{document}
ALOVE BROWSER REAL PDF PROOF
\end{document}
`;
  await page.goto("/editor?new=true");
  await expect(page).toHaveURL(/project=local-/);
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  await editor.fill(source);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/compile") && response.request().method() === "POST");
  await page.getByTestId("compile-button").click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expect((await response.json()).jobId).toBeTruthy();
  const preview = page.getByTestId("pdf-preview-pane");
  await expect(preview).toHaveAttribute("data-status", "ready", { timeout: 60000 });
  // Verify the embedded viewer path explicitly; fresh SyncTeX builds open the interactive viewer.
  await page.getByRole("button", { name: "Default", exact: true }).click();
  const frame = page.locator('iframe[title="Compiled PDF"]');
  const successfulPdf = await frame.getAttribute("src");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("main.pdf");
  const destination = testInfo.outputPath("real-workflow.pdf");
  await download.saveAs(destination);
  const bytes = await readFile(destination);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.includes(Buffer.from("%%EOF"))).toBe(true);
  expect(bytes.length).toBeGreaterThan(1000);

  await editor.fill(source.replace("ALOVE BROWSER REAL PDF PROOF", "\\UndefinedBrowserSmokeCommand"));
  await page.getByTestId("compile-button").click();
  await expect(preview).toHaveAttribute("data-status", "failed", { timeout: 60000 });
  await expect(frame).toHaveAttribute("src", successfulPdf!);
  await expect(page.getByRole("button", { name: /Undefined control sequence/ })).toBeVisible();

  await editor.fill(source);
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
  const projectUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(projectUrl);
  await expect(editor).toContainText("ALOVE BROWSER REAL PDF PROOF");
  await page.getByTestId("compile-button").click();
  await expect(preview).toHaveAttribute("data-status", "ready", { timeout: 60000 });
});
