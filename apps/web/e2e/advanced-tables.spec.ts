import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const original = String.raw`% Advanced tables: keep comments, captions and CRLF.
\documentclass{article}
\usepackage{tabularx,longtable}
\begin{document}
Prose before tables.
\begin{table}[htbp]
\centering
\begin{tabular}{lll}
Name & Value & Unit \\
Alpha & 2 & kg \\
Beta & 3 & kg \\
\end{tabular}
\caption{Measured results}
\label{tab:measure}
\end{table}
\begin{tabularx}{\linewidth}{Xl}
Flexible text & Count \\
Sample text & 7 \\
\end{tabularx}
\begin{longtable}{ll}
\caption{Long results}\label{tab:long}\\
Item & Number \\
First & 9 \\
\end{longtable}
Prose after tables.
\end{document}
`.replace(/\n/g, "\r\n");
async function paper(page: Page, source = original) {
  await page.goto("/editor?new=true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Import Source as New Project" })
    .click();
  await page.getByLabel("Import project source").setInputFiles({
    name: "advanced.alove.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "alove-project",
        version: 1,
        title: "Advanced table proof",
        mainFile: "main.tex",
        files: { "main.tex": source, "notes.tex": "Untouched notes.\r\n" },
      }),
    ),
  });
  await expect(
    page.getByText("Advanced table proof", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Visual", exact: true }).click();
}
async function archive(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: "Download Source (.alove.json)",
      exact: true,
    })
    .click();
  return JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  ) as { files: Record<string, string> };
}
async function open(page: Page, index = 0) {
  await page
    .getByRole("button", { name: "Edit table", exact: true })
    .nth(index)
    .click();
}
async function apply(page: Page) {
  await page.getByRole("button", { name: "Apply table changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function editedRichTable(page: Page) {
  await open(page);
  const name = page.getByLabel("Row 1 column 1", { exact: true });
  await name.focus();
  await name.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(name).toHaveValue(String.raw`\textbf{Name}`);
  await page.locator('summary[aria-label="Merge options"]').click();
  await page.getByLabel("Merge through column").selectOption("1");
  await page.getByRole("button", { name: "Merge cells", exact: true }).click();
  await expect(name).toHaveValue(String.raw`\textbf{Name} Value`);
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await page.getByLabel("Selected column", { exact: true }).selectOption("2");
  await page.getByLabel("Column 3 type").selectOption("m");
  await page.getByLabel("Column 3 width").fill("2cm");
  await page.getByRole("button", { name: "Borders", exact: true }).click();
  await page
    .getByRole("button", { name: "Booktabs rules", exact: true })
    .click();
  await page.getByRole("button", { name: "Cells", exact: true }).click();
  const value = page.getByLabel("Row 2 column 2", { exact: true });
  await value.focus();
  await value.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Inline math", exact: true }).click();
  await expect(value).toHaveValue(String.raw`\(2\)`);
  await page.getByRole("button", { name: "Apply table changes" }).click();
  await expect(page.getByRole("alert")).toContainText("require packages");
  await page.getByLabel("Enable array in document setup").check();
  await page.getByLabel("Enable booktabs in document setup").check();
  await apply(page);
}
test("merge, widths, borders and rich cells share one checkpointed undo transaction", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await paper(page);
  expect((await archive(page)).files["main.tex"]).toBe(original);
  await open(page);
  await apply(page);
  expect((await archive(page)).files["main.tex"]).toBe(original);
  await open(page);
  await page
    .getByLabel("Row 2 column 1", { exact: true })
    .fill("Discarded draft");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await archive(page)).files["main.tex"]).toBe(original);
  await editedRichTable(page);
  const changed = (await archive(page)).files;
  expect(changed["main.tex"]).toContain(
    String.raw`\multicolumn{2}{l}{\textbf{Name} Value}`,
  );
  expect(changed["main.tex"]).toContain(
    String.raw`>{\raggedright\arraybackslash}m{2cm}`,
  );
  expect(changed["main.tex"]).toContain(String.raw`Alpha & \(2\) & kg`);
  expect(changed["main.tex"]).toContain("\\usepackage{array,booktabs}\r\n");
  expect(
    changed["main.tex"]!.slice(
      changed["main.tex"]!.indexOf("\\caption{Measured"),
    ),
  ).toBe(original.slice(original.indexOf("\\caption{Measured")));
  expect(changed["main.tex"]!.replace(/\r\n/g, "")).not.toContain("\n");
  expect(changed["notes.tex"]).toBe("Untouched notes.\r\n");
  await expect(
    page.locator(".cm-visual-table-scroll td[colspan='2'] strong"),
  ).toHaveText("Name");
  await expect(page.locator(".cm-visual-table-scroll .katex")).toHaveCount(1);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await archive(page)).files["main.tex"]).toBe(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await archive(page)).files).toEqual(changed);
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
  await page.reload();
  expect((await archive(page)).files).toEqual(changed);
  expect(errors).toEqual([]);
});
test("merged paste refuses overlap, split retains content and populated deletion needs consent", async ({
  page,
}) => {
  const source = original.replace(
    "Name & Value & Unit",
    String.raw`\multicolumn{2}{c}{Name Value} & Unit`,
  );
  await paper(page, source);
  await open(page);
  const cell = page.getByLabel("Row 1 column 1", { exact: true });
  await cell.focus();
  await cell.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "X\tY");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByRole("alert")).toContainText("merged");
  await expect(cell).toHaveValue("Name Value");
  await page.locator('summary[aria-label="Merge options"]').click();
  await page.getByRole("button", { name: "Split cell", exact: true }).click();
  await expect(cell).toHaveValue("Name Value");
  await expect(page.getByLabel("Row 1 column 2", { exact: true })).toHaveValue(
    "",
  );
  await page.locator('summary[aria-label="Rows and columns"]').click();
  await page
    .getByRole("button", { name: "Remove last row", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Confirm table deletion" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply table changes" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Keep content", exact: true }).click();
  await expect(page.getByLabel("Row 3 column 1", { exact: true })).toHaveValue(
    "Beta",
  );
  await page.locator('summary[aria-label="Rows and columns"]').click();
  await page
    .getByRole("button", { name: "Remove last row", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(page.getByLabel("Row 3 column 1", { exact: true })).toHaveCount(
    0,
  );
  await apply(page);
  const changed = (await archive(page)).files["main.tex"]!;
  expect(changed).toContain("Name Value &  & Unit");
  expect(changed).not.toContain("Beta & 3");
  expect(changed).toContain("Alpha & 2");
});
test("tabularx widths and longtable metadata survive independent cell edits", async ({
  page,
}) => {
  await paper(page);
  await open(page, 1);
  await page
    .getByLabel("Row 2 column 1", { exact: true })
    .fill("Revised flexible text");
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await page
    .getByLabel("Table width", { exact: true })
    .fill(String.raw`0.8\linewidth`);
  await apply(page);
  await open(page, 2);
  await page.getByLabel("Row 2 column 2", { exact: true }).fill("12");
  await apply(page);
  expect((await archive(page)).files["main.tex"]).toBe(
    original
      .replace("Sample text", "Revised flexible text")
      .replace("{\\linewidth}{Xl}", "{0.8\\linewidth}{Xl}")
      .replace("First & 9", "First & 12"),
  );
});
test("edited advanced tables compile through the real worker and produce a PDF", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_REAL_COMPILE !== "1",
    "Requires Redis and the real Docker TeX worker.",
  );
  test.setTimeout(150_000);
  await paper(page);
  await editedRichTable(page);
  await open(page, 1);
  await page.getByLabel("Row 2 column 2", { exact: true }).fill("11");
  await apply(page);
  await open(page, 2);
  await page
    .getByLabel("Row 2 column 1", { exact: true })
    .fill("Longtable edited");
  await apply(page);
  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await page.getByTestId("compile-button").click();
  await expect(page.getByTestId("pdf-preview-pane")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 120_000 },
  );
  await expect(page.getByTestId("pdf-preview-pane")).toBeVisible();
  const changed = (await archive(page)).files["main.tex"]!;
  expect(changed).toContain("Longtable edited & 9");
  expect(changed).toContain("Sample text & 11");
});

test("advanced controls fit narrow layouts and retain keyboard focus in both themes", async ({
  page,
}, testInfo) => {
  await paper(page);
  for (const width of [390, 768, 1440])
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await open(page);
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      const canvas = page.getByTestId("table-editor-canvas");
      await expect(canvas).toBeVisible();
      const lastCell = await page
        .getByLabel("Row 1 column 3", { exact: true })
        .boundingBox();
      expect(lastCell!.x + lastCell!.width).toBeLessThanOrEqual(width);
      const footer = await page
        .getByRole("button", { name: "Apply table changes" })
        .boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(900);
      expect(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(false);
      await page.getByLabel("Row 1 column 1", { exact: true }).focus();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByLabel("Row 2 column 1", { exact: true }),
      ).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(
          `advanced-tables-${width}-${colorScheme}.png`,
        ),
      });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".cm-content")).toBeFocused();
    }
});
