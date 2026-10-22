import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const original = String.raw`% Keep the whole preamble and comments.
\documentclass{article}
\begin{document}
\section{Introduction}\label{sec:intro}
Prose before objects.
\begin{table}[htbp]
\centering
\begin{tabular}{ll}
Name & Value \\
Alpha & 2 \\
\end{tabular}
\caption{Original results}
\label{tab:results}
\end{table}
An inline equation \(x^2\) and reference \ref{sec:intro}, citation \cite{knuth}.
\bibliographystyle{plain}
\bibliography{refs}
Prose after objects.
\end{document}
`.replace(/\n/g, "\r\n");
async function paper(page: Page) {
  await page.goto("/editor?new=true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Import Source as New Project" })
    .click();
  await page.getByLabel("Import project source").setInputFiles({
    name: "objects.alove.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "alove-project",
        version: 1,
        title: "Visual object proof",
        mainFile: "main.tex",
        files: {
          "main.tex": original,
          "notes.tex": "Untouched notes.\r\n",
          "refs.bib":
            "@book{knuth, title={The TeXbook}, author={Donald Knuth}, year={1984}, publisher={Addison-Wesley}}\n@book{lamport, title={LaTeX}, author={Leslie Lamport}, year={1994}, publisher={Addison-Wesley}}\n",
        },
      }),
    ),
  });
  await expect(
    page.getByText("Visual object proof", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Visual", exact: true }).click();
}
async function archive(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: "Download Source (.alove.json)",
      exact: true,
    })
    .click();
  return JSON.parse(await readFile((await (await event).path())!, "utf8")) as {
    files: Record<string, string>;
  };
}
async function atProse(page: Page) {
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  await source.click();
  await source.press("ControlOrMeta+f");
  const input = page.getByRole("textbox", {
    name: "Find in file",
    exact: true,
  });
  await input.fill("Prose after objects.");
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await input.press("Escape");
  await source.press("ArrowRight");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
}
async function insert(page: Page, name: string) {
  await atProse(page);
  await page.getByRole("button", { name: "Insert visual object" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("table cells, TSV, structure, keyboard, cancel and shared undo preserve exact source", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await paper(page);
  await expect(
    page.getByRole("button", { name: "Edit table", exact: true }),
  ).toBeVisible();
  expect((await archive(page)).files["main.tex"]).toBe(original);
  await page
    .getByRole("button", { name: "Edit table row 2 column 2: 2", exact: true })
    .click();
  await expect(
    page.getByLabel("Row 2 column 2", { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Row 2 column 2", { exact: true })
    .fill("50% & revised");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await archive(page)).files["main.tex"]).toBe(original);
  await page.getByRole("button", { name: "Edit table", exact: true }).click();
  await page
    .getByLabel("Row 2 column 2", { exact: true })
    .fill("50% & revised");
  await page.getByRole("button", { name: "Apply table changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const changed = original.replace(
    "Alpha & 2",
    String.raw`Alpha & 50\% \& revised`,
  );
  expect((await archive(page)).files["main.tex"]).toBe(changed);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await archive(page)).files["main.tex"]).toBe(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await page.getByRole("button", { name: "Edit table", exact: true }).click();
  await page.getByLabel("Row 1 column 1", { exact: true }).evaluate((el) => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      "Material\tMass\tUnit\r\nSteel\t5\tkg\r\nWood\t3\tkg",
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByLabel("Row 3 column 3", { exact: true })).toHaveValue(
    "kg",
  );
  await page.getByLabel("Column 2 alignment").selectOption("r");
  await page.getByLabel("Table caption").fill("Pasted results");
  await page.getByLabel("Row 1 column 1", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByLabel("Row 2 column 1", { exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Apply table changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const result = (await archive(page)).files;
  expect(result["main.tex"]).toContain("{lrl}\r\nMaterial & Mass & Unit");
  expect(result["main.tex"]).toContain("\\caption{Pasted results}");
  expect(result["notes.tex"]).toBe("Untouched notes.\r\n");
  expect(errors).toEqual([]);
  await expect(page.getByText("Project Saved", { exact: true })).toBeVisible();
  await page.reload();
  expect((await archive(page)).files).toEqual(result);
});

test("equation rendering and project cite/ref pickers preserve surrounding LaTeX", async ({
  page,
}) => {
  await paper(page);
  await page
    .getByRole("button", { name: "Edit equation", exact: true })
    .click();
  await page.getByLabel("Equation LaTeX").fill(String.raw`\frac{x^3}{2}`);
  await expect(page.getByTestId("math-preview")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: "Apply equation changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit citation knuth", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove knuth", exact: true }).click();
  await page
    .getByLabel("Search project citations and references")
    .fill("Lamport");
  await page.getByRole("button", { name: /lamport LaTeX/ }).click();
  await page.getByRole("button", { name: "Apply citation changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit reference sec:intro", exact: true })
    .click();
  await page
    .getByLabel("Search project citations and references")
    .fill("tab:results");
  await page.getByRole("button", { name: /tab:results/ }).click();
  await page.getByRole("button", { name: "Apply reference changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await archive(page)).files["main.tex"]).toBe(
    original
      .replace("x^2", String.raw`\frac{x^3}{2}`)
      .replace("\\cite{knuth}", "\\cite{lamport}")
      .replace("\\ref{sec:intro}", "\\ref{tab:results}"),
  );
});

test("figure upload, explicit setup, resizing, caption and undo use one source transaction", async ({
  page,
}) => {
  await paper(page);
  await insert(page, "Figure");
  await page
    .getByLabel("Upload figure asset")
    .setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: pixel });
  await expect(page.getByLabel("Project image")).toHaveValue(
    "figures/pixel.png",
  );
  await page.getByLabel("Figure width percentage").fill("40");
  await page.getByLabel("Figure caption").fill("A 50% test figure");
  await page.getByRole("button", { name: "Apply figure changes" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enable graphicx" }),
  ).toBeVisible();
  await page
    .getByLabel("Enable image support in document setup (graphicx)")
    .check();
  await page.getByRole("button", { name: "Apply figure changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cm-visual-figure-image")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  const result = (await archive(page)).files;
  expect(result["main.tex"]).toContain(
    "\\usepackage{graphicx}\r\n\\begin{document}",
  );
  expect(result["main.tex"]).toContain("width=0.4\\textwidth");
  expect(result["main.tex"]).toContain(
    String.raw`\caption{A 50\% test figure}`,
  );
  expect(result["figures/pixel.png"]).toContain("data:image/png;base64,");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await archive(page)).files["main.tex"]).toBe(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await archive(page)).files).toEqual(result);
  if (process.env.E2E_REAL_COMPILE === "1") {
    test.setTimeout(180000);
    await page.getByTestId("compile-button").click();
    await page.getByRole("button", { name: "Proof", exact: true }).click();
    await expect(page.getByTestId("pdf-preview-pane")).toHaveAttribute(
      "data-status",
      "ready",
      { timeout: 60000 },
    );
  }
});

test("object dialogs and previews fit phone, tablet and desktop in both themes", async ({
  page,
}, testInfo) => {
  await paper(page);
  for (const width of [390, 768, 1440])
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page
        .getByRole("button", { name: "Edit table", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: testInfo.outputPath(`objects-${width}-${colorScheme}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
});

test("new table and display equation insertion share the document and undo", async ({
  page,
}) => {
  await paper(page);
  await insert(page, "Table");
  await page.getByLabel("Row 1 column 1", { exact: true }).fill("Inserted");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove last row", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove last column", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply table changes", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit table", exact: true }),
  ).toHaveCount(2);
  let result = (await archive(page)).files["main.tex"]!;
  expect(result).toMatch(/Inserted\s*&/);
  expect(
    result!.slice(
      0,
      result!.indexOf(
        "\\begin{table}",
        result!.indexOf("Prose after objects."),
      ),
    ),
  ).toBe(
    original.slice(0, original.indexOf("\r\n\\end{document}")) + "\r\n\r\n",
  );
  expect(result).toContain("\\label{tab:new}");
  await insert(page, "Equation");
  await page.getByLabel("Equation LaTeX").fill("a+b=c");
  await page.getByLabel("Display equation", { exact: true }).check();
  await page.getByRole("button", { name: "Apply equation changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  result = (await archive(page)).files["main.tex"]!;
  expect(result).toContain("\\[\r\na+b=c\r\n\\]");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await archive(page)).files["main.tex"]).not.toContain("a+b=c");
});
