import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const original =
  "% Preserve CRLF and this comment.\r\n\\documentclass{article}\r\n\\newcommand{\\custom}[1]{#1}\r\n\\begin{document}\r\n\\section{Introduction}\r\nA plain sentence with \\textbf{bold} and \\textit{italics}.\r\n\r\nSecond paragraph.\r\n% Keep this body comment.\r\n\\custom{Untouched macro}\r\n\\end{document}\r\n";
async function importPaper(page: Page) {
  await page.goto("/editor?new=true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Import Source as New Project" })
    .click();
  await page.getByLabel("Import project source").setInputFiles({
    name: "manuscript.alove.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "alove-project",
        version: 1,
        title: "Manuscript proof",
        mainFile: "main.tex",
        files: {
          "main.tex": original,
          "notes.tex": "Untouched included source.\r\n",
        },
      }),
    ),
  });
  await expect(
    page.getByText("Manuscript proof", { exact: true }).first(),
  ).toBeVisible();
}
async function sourceArchive(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: "Download Source (.weftly.json)",
      exact: true,
    })
    .click();
  const download = await event;
  return JSON.parse(await readFile((await download.path())!, "utf8")) as {
    files: Record<string, string>;
  };
}
async function find(page: Page, text: string) {
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  await editor.click();
  await editor.press("ControlOrMeta+f");
  const input = page.getByRole("textbox", {
    name: "Find in file",
    exact: true,
  });
  await input.fill(text);
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await input.press("Escape");
}

test("visual writing preserves exact source, shared undo, custom syntax and durable edits", async ({
  page,
}, testInfo) => {
  await importPaper(page);
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  const visual = page.getByRole("textbox", {
    name: "Visual manuscript editor",
  });
  await expect(visual).toBeVisible();
  await expect(page.locator(".cm-visual-heading")).toContainText(
    "Introduction",
  );
  await expect(page.locator(".cm-visual-bold")).toContainText("bold");
  await expect(page.getByTestId("pdf-preview-pane")).toBeHidden();
  expect((await sourceArchive(page)).files).toEqual({
    "main.tex": original,
    "notes.tex": "Untouched included source.\r\n",
  });
  await find(page, "plain");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await page
    .getByRole("button", { name: "Bold selected text", exact: true })
    .click();
  const bold = original.replace(
    "A plain sentence",
    "A \\textbf{plain} sentence",
  );
  expect((await sourceArchive(page)).files["main.tex"]).toBe(bold);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page
    .getByRole("textbox", { name: "LaTeX source editor" })
    .press("ControlOrMeta+z");
  expect((await sourceArchive(page)).files["main.tex"]).toBe(original);
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await visual.press("ControlOrMeta+Shift+z");
  expect((await sourceArchive(page)).files["main.tex"]).toBe(bold);

  await find(page, "sentence");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await visual.pressSequentially("50% résumé");
  expect((await sourceArchive(page)).files["main.tex"]).toBe(
    bold.replace("sentence", "50\\% résumé"),
  );
  await visual.press("ControlOrMeta+z");
  expect((await sourceArchive(page)).files["main.tex"]).toBe(bold);
  await find(page, "sentence");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  const composition = await page.context().newCDPSession(page);
  await composition.send("Input.imeSetComposition", {
    text: "研究",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await composition.send("Input.insertText", { text: "研究" });
  await composition.detach();
  expect((await sourceArchive(page)).files["main.tex"]).toBe(
    bold.replace("sentence", "研究"),
  );
  await visual.press("ControlOrMeta+z");
  expect((await sourceArchive(page)).files["main.tex"]).toBe(bold);

  await find(page, "Second paragraph.");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Paragraph style" })
    .selectOption("subsection");
  const heading = bold.replace(
    "Second paragraph.",
    "\\subsection{Second paragraph.}",
  );
  expect((await sourceArchive(page)).files["main.tex"]).toBe(heading);
  await find(page, "Untouched macro");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await visual.press("X");
  await expect(
    page.getByRole("status").filter({ hasText: "crosses LaTeX structure" }),
  ).toBeVisible();
  expect((await sourceArchive(page)).files["main.tex"]).toBe(heading);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(visual).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: testInfo.outputPath(`manuscript-${width}-${colorScheme}.png`),
      });
    }
  }
  await expect(page.getByText("Project saved", { exact: true })).toBeVisible();
  await page.reload();
  expect((await sourceArchive(page)).files["main.tex"]).toBe(heading);
});

test("a visually formatted paper produces a real PDF and keeps recovery available", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_REAL_COMPILE !== "1",
    "Requires Redis and Docker TeX.",
  );
  test.setTimeout(180000);
  await importPaper(page);
  await find(page, "plain");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await page.getByRole("button", { name: "Italicize selected text" }).click();
  await find(page, "Second paragraph.");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await page.getByRole("button", { name: "Create bulleted list" }).click();
  await expect(
    page.getByRole("textbox", { name: "Visual manuscript editor" }),
  ).toContainText("•");
  await page.getByTestId("compile-button").click();
  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await expect(page.getByTestId("pdf-preview-pane")).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 60000 },
  );
  expect((await sourceArchive(page)).files["main.tex"]).toBe(
    original
      .replace("A plain sentence", "A \\textit{plain} sentence")
      .replace(
        "Second paragraph.",
        "\\begin{itemize}\r\n\\item Second paragraph.\r\n\\end{itemize}",
      ),
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Build recovery", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Find breaking change" }),
  ).toBeVisible();
});
