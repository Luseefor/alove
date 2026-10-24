import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// A real, deliberately minimal PDF document for deterministic on-page editing.
// The compiler transport is stubbed only in the first two tests.
function fixturePdf(text: string) {
  const literal = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 12 Tf 72 650 Td (${literal}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document).toString("base64");
}
async function exportFiles(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: "Download Source (.weftly.json)",
      exact: true,
    })
    .click();
  const download = await pending;
  return JSON.parse(await readFile((await download.path())!, "utf8"))
    .files as Record<string, string>;
}
async function compilerFixture(page: Page, file: string, equation = false) {
  let files: Record<string, string> = {};
  let count = 0;
  await page.route("**/api/compile", async (route) => {
    files = route.request().postDataJSON().files;
    await route.fulfill({ json: { jobId: `pdf-edit-${++count}` } });
  });
  await page.route("**/api/compile/*", async (route) => {
    const source = files[file];
    const text =
      file === "main.tex"
        ? source
            .split("\\begin{document}")[1]
            .split("\\end{document}")[0]
            .trim()
        : source.trim();
    await route.fulfill({
      json: {
        state: "completed",
        result: {
          phase: "ready",
          pdfBase64: fixturePdf(
            equation ? "E = mc2" : text.replace(/\\%/g, "%"),
          ),
          diagnostics: [],
          log: "PDF visual fixture",
          synctex: {
            version: 1,
            truncated: false,
            entries: [
              {
                file,
                line: equation ? 2 : file === "main.tex" ? 3 : 1,
                page: 1,
                x: 72 * 65781.76,
                y: 142 * 65781.76,
                width: 250 * 65781.76,
                height: 12 * 65781.76,
              },
            ],
          },
        },
      },
    });
  });
  return () => count;
}
for (const width of [390, 1440]) {
  test(`PDF text edit updates the included source, rebuilds and shares undo at ${width}px`, async ({
    page,
  }) => {
    const builds = await compilerFixture(page, "chapters/body.tex");
    await page.setViewportSize({ width, height: 900 });
    // Imports finish after file reading and persistence, not setInputFiles.
    // Keep the read asynchronous enough to catch clicks on the old workspace.
    await page.addInitScript(() => {
      const read = File.prototype.text;
      File.prototype.text = async function () {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return read.call(this);
      };
    });
    await page.goto("/editor?new=true");
    await page.getByLabel("Import project source").setInputFiles({
      name: "pdf-edit.weftly.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "alove-project",
          version: 1,
          title: "PDF editing proof",
          mainFile: "main.tex",
          files: {
            "main.tex":
              "\\documentclass{article}\n\\begin{document}\n\\input{chapters/body}\n\\end{document}\n",
            "chapters/body.tex": "Original manuscript text.\n",
          },
        }),
      ),
    });
    await expect(
      page.getByRole("button", { name: "Rename project", exact: true }),
    ).toHaveText("PDF editing proof");
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    await expect(page.getByTestId("source-panel")).toBeHidden();
    const target = page.getByRole("button", {
      name: "Edit paragraph: Original manuscript text.",
      exact: true,
    });
    await expect(target).toBeVisible({ timeout: 30000 });
    await target.click();
    await page
      .getByRole("textbox", { name: "PDF text", exact: true })
      .fill("Edited manuscript with 50% confidence.");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "PDF text", exact: true }),
    ).toHaveValue("Edited manuscript with 50% confidence.");
    if (process.env.E2E_EVIDENCE_DIR)
      await page.screenshot({
        path: `${process.env.E2E_EVIDENCE_DIR}/pdf-draft-${width}.png`,
      });
    await page
      .getByRole("button", { name: "Apply & rebuild", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Edit paragraph: Edited manuscript with 50% confidence.",
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    expect(builds()).toBe(2);
    const files = await exportFiles(page);
    expect(files["chapters/body.tex"]).toBe(
      "Edited manuscript with 50\\% confidence.\n",
    );
    expect(files["main.tex"]).toContain("\\input{chapters/body}");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await exportFiles(page))["chapters/body.tex"]).toBe(
      "Original manuscript text.\n",
    );
    await expect(
      page.getByText("Rebuild to continue editing this page.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Rebuild", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Edit paragraph: Original manuscript text.",
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    if (process.env.E2E_EVIDENCE_DIR)
      await page.screenshot({
        path: `${process.env.E2E_EVIDENCE_DIR}/pdf-edit-${width}.png`,
      });
  });
}
test("empty document starts with an editable page rather than a failed empty build", async ({
  page,
}) => {
  const builds = await compilerFixture(page, "main.tex");
  await page.goto("/editor?new=true");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await expect(page.getByTestId("pdf-visual-blank-page")).toBeVisible();
  expect(builds()).toBe(0);
  await page
    .getByRole("textbox", { name: "PDF text", exact: true })
    .fill("First paragraph on the page.");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "PDF text", exact: true }),
  ).toHaveValue("First paragraph on the page.");
  await page
    .getByRole("button", { name: "Apply & rebuild", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Edit paragraph: First paragraph on the page.",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  expect(builds()).toBe(1);
});
test("real compiled PDF edits rebuild and preserve the included manuscript source", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.E2E_REAL_COMPILE !== "1",
    "Requires Redis, worker and TeX; no compiler stubs.",
  );
  test.setTimeout(180000);
  await page.goto("/editor?new=true");
  await page.getByLabel("Import project source").setInputFiles({
    name: "real-pdf-edit.weftly.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "alove-project",
        version: 1,
        title: "Real PDF edit",
        mainFile: "main.tex",
        files: {
          "main.tex":
            "\\documentclass{article}\n\\begin{document}\n\\input{body}\n\\end{document}\n",
          "body.tex":
            "Scientific writing on the compiled page.\n\nUntouched second paragraph.\n",
        },
      }),
    ),
  });
  await expect(
    page.getByRole("button", { name: "Rename project", exact: true }),
  ).toHaveText("Real PDF edit");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  const target = page.getByRole("button", {
    name: "Edit paragraph: Scientific writing on the compiled page.",
    exact: true,
  });
  await expect(target).toBeVisible({ timeout: 90000 });
  await target.click();
  await page
    .getByRole("textbox", { name: "PDF text", exact: true })
    .fill("Scientific writing edited on the PDF page.");
  await page.screenshot({
    path: testInfo.outputPath("pdf-edit-real-draft.png"),
  });
  await page
    .getByRole("button", { name: "Apply & rebuild", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Edit paragraph: Scientific writing edited on the PDF page.",
      exact: true,
    }),
  ).toBeVisible({ timeout: 90000 });
  await page.screenshot({
    path: testInfo.outputPath("pdf-edit-real-result.png"),
  });
  const files = await exportFiles(page);
  expect(files["body.tex"]).toBe(
    "Scientific writing edited on the PDF page.\n\nUntouched second paragraph.\n",
  );
  expect(files["main.tex"]).toContain("\\input{body}");
});

test("clicking a mapped equation opens its controls and Apply rebuilds the PDF", async ({
  page,
}) => {
  const builds = await compilerFixture(page, "body.tex", true);
  await page.goto("/editor?new=true");
  await page.getByLabel("Import project source").setInputFiles({
    name: "equation.weftly.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "alove-project",
        version: 1,
        title: "PDF equation proof",
        mainFile: "main.tex",
        files: {
          "main.tex":
            "\\documentclass{article}\n\\begin{document}\n\\input{body}\n\\end{document}\n",
          "body.tex": "\\begin{equation}\nE = mc^2\n\\end{equation}\n",
        },
      }),
    ),
  });
  await expect(
    page.getByRole("button", { name: "Rename project", exact: true }),
  ).toHaveText("PDF equation proof");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  const canvas = page.getByRole("img", { name: "PDF page 1", exact: true });
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  const box = (await canvas.boundingBox())!;
  const scale = box.width / 612;
  await canvas.click({ position: { x: 82 * scale, y: 138 * scale } });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Equation LaTeX")).toBeVisible();
  await dialog.getByLabel("Equation LaTeX").fill("E = 2mc^2");
  await dialog
    .getByRole("button", { name: "Apply equation changes", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect.poll(builds).toBe(2);
  expect((await exportFiles(page))["body.tex"]).toContain("E = 2mc^2");
});
