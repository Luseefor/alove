import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const files = {
  "main.tex": String.raw`\documentclass{article}
\newcommand{\hiddenword}{Preamble target}
\begin{document}
\section{Overview}
Main prose remains unchanged.
\input{sections/intro}
\include{sections/results}
\input{sections/missing}
\end{document}
`,
  "sections/intro.tex": String.raw`\section{Introduction}
Intro prose with \custom{protected target}.
\input{sections/detail}
`,
  "sections/detail.tex": String.raw`\subsection{Detail}
Detail prose.
`,
  "sections/results.tex": String.raw`\section{Results}
Results prose.
`,
  "unused.tex": String.raw`\section{Not included}`,
};
async function importPaper(page: Page) {
  await page.goto("/editor?new=true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Import Source as New Project" })
    .click();
  await page.getByLabel("Import project source").setInputFiles({
    name: "navigation.alove.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "alove-project",
        version: 1,
        title: "Manuscript navigation proof",
        mainFile: "main.tex",
        files,
      }),
    ),
  });
  await expect(
    page.getByText("Manuscript navigation proof", { exact: true }).first(),
  ).toBeVisible();
}
async function exportFiles(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: "Download Source (.alove.json)",
      exact: true,
    })
    .click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"))
    .files;
}
for (const width of [390, 1440]) {
  test(`project outline follows includes and reveals targets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await importPaper(page);
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    if (width === 390)
      await page.getByRole("button", { name: "Files", exact: true }).click();
    else
      await page
        .getByRole("button", { name: "Toggle file browser", exact: true })
        .click();
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    const outline = page.getByRole("navigation", {
      name: "Manuscript outline",
    });
    await expect(outline.getByRole("button")).toHaveText([
      /Overview/,
      /Introduction/,
      /Detail/,
      /Results/,
    ]);
    await expect(outline).not.toContainText("Not included");
    if (process.env.E2E_EVIDENCE_DIR)
      await page.screenshot({
        path: `${process.env.E2E_EVIDENCE_DIR}/outline-${width}.png`,
      });
    await outline.getByText("Outline notices").click();
    await expect(outline).toContainText("sections/missing");
    await outline
      .getByRole("button", { name: /Go to Results in sections\/results.tex/ })
      .click();
    const source = page.getByRole("textbox", { name: "LaTeX source editor" });
    await expect(source).toBeVisible();
    await expect(source).toContainText("Results prose.");
    await expect(
      page.getByRole("button", { name: "Source", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    if (width === 390)
      await expect(page.getByTestId("workbench-sidebar")).toBeHidden();
    expect(await exportFiles(page)).toEqual(files);
  });
}
test("find reveals a preamble selection without losing shared undo", async ({
  page,
}) => {
  await importPaper(page);
  const source = page.getByRole("textbox", { name: "LaTeX source editor" });
  await source.click();
  await source.press("ControlOrMeta+End");
  await source.pressSequentially("% navigation undo sentinel");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Visual manuscript editor" })
    .press("ControlOrMeta+f");
  await page.getByPlaceholder("Find in file...").fill("Preamble target");
  await page.getByPlaceholder("Find in file...").press("Enter");
  await expect(
    page.getByRole("button", { name: "Source", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(source).toBeVisible();
  await source.press("ControlOrMeta+z");
  expect(await exportFiles(page)).toEqual(files);
});
