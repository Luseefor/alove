import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const source = String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
Prose before the objects.
\begin{figure}[htbp]
\centering
\includegraphics[width=0.8\textwidth]{figures/a.png}
\caption{An image}
\label{fig:image}
\end{figure}
\begin{figure}[htbp]
\centering
\begin{subfigure}[b]{0.48\textwidth}
\centering
\includegraphics[width=\linewidth]{figures/a.png}
\caption{First panel}
\label{fig:a}
\end{subfigure}
\hfill
\begin{subfigure}[b]{0.48\textwidth}
\centering
\includegraphics[width=\linewidth]{figures/a.png}
\caption{Second panel}
\label{fig:b}
\end{subfigure}
\caption{Compared images}
\label{fig:group}
\end{figure}
\begin{tabular}{ll}
Alpha & 1 \\
Beta & 2 \\
\end{tabular}
\begin{longtable}{ll}
First header & Value \\
\endfirsthead
Repeated header & Value \\
\endhead
Continued & Page \\
\endfoot
Last footer & Page \\
\endlastfoot
Body & 7 \\
\end{longtable}
Prose after the objects.
\end{document}
`;
async function paper(page: Page, initialSource = source) {
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
        title: "Manuscript object proof",
        mainFile: "main.tex",
        files: { "main.tex": initialSource, "figures/a.png": png },
      }),
    ),
  });
  await expect(
    page.getByText("Manuscript object proof", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Manuscript", exact: true }).click();
}
async function exported(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("menuitem", {
      name: "Download Source (.weftly.json)",
      exact: true,
    })
    .click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"))
    .files["main.tex"];
}
async function build(page: Page) {
  if (process.env.E2E_REAL_COMPILE !== "1") return;
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await expect(
    page.getByTestId("pdf-preview-pane").locator("iframe, canvas").first(),
  ).toBeVisible({ timeout: 90_000 });
}
test("figure drag and placement stay drafts until checkpointed Apply", async ({
  page,
}) => {
  await paper(page);
  await page.getByRole("button", { name: "Edit figure", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const handle = dialog.getByRole("slider", {
    name: "Drag to resize figure width",
  });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 70, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(
    Number(await dialog.getByLabel("Figure width percentage").inputValue()),
  ).toBeLessThan(80);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await exported(page)).toBe(source);
  await page.getByRole("button", { name: "Edit figure", exact: true }).click();
  await page.getByLabel("Figure width percentage").fill("45");
  await page.getByLabel("Figure placement").selectOption("H");
  await page.getByRole("button", { name: "Apply figure changes" }).click();
  await page.getByLabel("Enable float in document setup").check();
  await page.getByRole("button", { name: "Apply figure changes" }).click();
  await expect(dialog).toHaveCount(0);
  const edited = await exported(page);
  expect(edited).toContain(String.raw`\usepackage{float}`);
  expect(edited).toContain(String.raw`\begin{figure}[H]`);
  expect(edited).toContain(String.raw`width=0.45\textwidth`);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page
    .getByRole("textbox", { name: "LaTeX source editor" })
    .press("ControlOrMeta+z");
  expect(await exported(page)).toBe(source);
});
test("subfigure panel edits preserve their neighbours and add explicit setup", async ({
  page,
}) => {
  await paper(page);
  await page
    .getByRole("button", { name: "Edit subfigures", exact: true })
    .click();
  await page.getByLabel("Selected figure panel").selectOption("1");
  await page
    .getByLabel("Panel caption", { exact: true })
    .fill("Second panel revised & retained");
  await page.getByLabel("Panel width percentage").fill("40");
  if (process.env.E2E_EVIDENCE_DIR)
    await page.screenshot({
      path: `${process.env.E2E_EVIDENCE_DIR}/subfigures-desktop.png`,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = (await page.getByRole("dialog").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  const sourceAction = (await page
    .getByRole("button", { name: "Edit in Source", exact: true })
    .boundingBox())!;
  expect(sourceAction.x + sourceAction.width).toBeLessThanOrEqual(
    bounds.x + bounds.width,
  );
  await expect(
    page.getByRole("button", { name: "Apply subfigure changes" }),
  ).toBeInViewport();
  if (process.env.E2E_EVIDENCE_DIR)
    await page.screenshot({
      path: `${process.env.E2E_EVIDENCE_DIR}/subfigures-phone.png`,
    });
  await page.getByRole("button", { name: "Apply subfigure changes" }).click();
  await page.getByLabel("Enable subcaption in document setup").check();
  await page.getByRole("button", { name: "Apply subfigure changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const edited = await exported(page);
  expect(edited).toContain(String.raw`\usepackage{subcaption}`);
  expect(edited).toContain(String.raw`\caption{First panel}`);
  expect(edited).toContain(
    String.raw`\caption{Second panel revised \& retained}`,
  );
  expect(edited).toContain(String.raw`{0.4\textwidth}`);
  expect(edited).toContain(String.raw`\hfill`);
});
test("vertical merges retain content and repeated headers retain exact markers", async ({
  page,
}) => {
  await paper(page);
  await page
    .getByRole("button", { name: "Edit table", exact: true })
    .first()
    .click();
  await page.getByLabel("Row 1 column 1", { exact: true }).focus();
  await page.locator('summary[aria-label="Merge options"]').click();
  await page.getByLabel("Merge through row").selectOption({ value: "1" });
  await expect(page.getByLabel("Merge through row")).toHaveValue("1");
  await expect(
    page.getByRole("button", { name: "Merge rows", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Merge rows", exact: true }).click();
  await expect(page.getByLabel("Row 1 column 1", { exact: true })).toHaveValue(
    "Alpha Beta",
  );
  await page.getByRole("button", { name: "Apply table changes" }).click();
  await page.getByLabel("Enable multirow in document setup").check();
  await page.getByRole("button", { name: "Apply table changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page
      .locator('[aria-label="Visual table preview"]')
      .first()
      .locator('td[rowspan="2"]'),
  ).toHaveCount(1);
  const merged = await exported(page);
  expect(merged).toContain(String.raw`\multirow{2}{*}{Alpha Beta}`);
  await page
    .getByRole("button", { name: "Edit table", exact: true })
    .nth(1)
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Repeated sections preserved",
  );
  await page.getByLabel("Row 5 column 2", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Apply table changes" }).click();
  await page.getByLabel("Enable longtable in document setup").check();
  await page.getByRole("button", { name: "Apply table changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const edited = await exported(page);
  for (const marker of ["endfirsthead", "endhead", "endfoot", "endlastfoot"])
    expect(edited).toContain(`\\${marker}`);
  expect(edited).toContain("Body & 8");
  // This fixture also contains subfigures: enable their package through its own explicit editor flow before compiling.
  await page
    .getByRole("button", { name: "Edit subfigures", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply subfigure changes" }).click();
  await page.getByLabel("Enable subcaption in document setup").check();
  await page.getByRole("button", { name: "Apply subfigure changes" }).click();
  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await build(page);
});

test("subfigure ordering follows panel edits through Cancel, undo, redo and reload", async ({
  page,
}) => {
  const initial = source.replace(
    String.raw`\usepackage{graphicx}`,
    String.raw`\usepackage{graphicx}
\usepackage{subcaption}
\usepackage{longtable}`,
  );
  const blocks = [
    ...initial.matchAll(/\\begin\{subfigure\}[\s\S]*?\\end\{subfigure\}/g),
  ].map((m) => m[0]);
  expect(blocks).toHaveLength(2);
  await paper(page, initial);
  const open = () =>
    page.getByRole("button", { name: "Edit subfigures", exact: true }).click();
  await open();
  await expect(
    page.getByRole("button", { name: "Move panel earlier", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Move panel later", exact: true })
    .click();
  await expect(page.getByLabel("Panel caption", { exact: true })).toHaveValue(
    "First panel",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await exported(page)).toBe(initial);
  await open();
  await page
    .getByLabel("Panel caption", { exact: true })
    .fill("First moved & edited");
  await page.setViewportSize({ width: 390, height: 844 });
  const later = page.getByRole("button", {
    name: "Move panel later",
    exact: true,
  });
  await later.focus();
  await page.keyboard.press("Enter");
  await expect(later).toBeDisabled();
  await expect(page.getByLabel("Panel caption", { exact: true })).toHaveValue(
    "First moved & edited",
  );
  const earlier = page.getByRole("button", {
    name: "Move panel earlier",
    exact: true,
  });
  await expect(earlier).toBeInViewport();
  const bounds = (await earlier.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  if (process.env.E2E_EVIDENCE_DIR)
    await page.screenshot({
      path: `${process.env.E2E_EVIDENCE_DIR}/subfigure-order-phone.png`,
    });
  await page.getByRole("button", { name: "Apply subfigure changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const expected = initial
    .replace(blocks[0]!, "__FIRST_PANEL__")
    .replace(
      blocks[1]!,
      blocks[0]!.replace("First panel", String.raw`First moved \& edited`),
    )
    .replace("__FIRST_PANEL__", blocks[1]!);
  expect(await exported(page)).toBe(expected);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  await editor.press("ControlOrMeta+z");
  expect(await exported(page)).toBe(initial);
  await editor.press("ControlOrMeta+Shift+z");
  expect(await exported(page)).toBe(expected);
  await page.reload();
  expect(await exported(page)).toBe(expected);
  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await build(page);
});

test("subfigure count changes are confirmed drafts with limits and exact undo", async ({
  page,
}) => {
  const initial = source.replace(
    String.raw`\usepackage{graphicx}`,
    String.raw`\usepackage{graphicx}
\usepackage{subcaption}
\usepackage{longtable}`,
  );
  const blocks = [
    ...initial.matchAll(/\\begin\{subfigure\}[\s\S]*?\\end\{subfigure\}/g),
  ].map((m) => m[0]);
  await paper(page, initial);
  const open = () =>
    page.getByRole("button", { name: "Edit subfigures", exact: true }).click();
  const add = () =>
    page.getByRole("button", { name: "Add panel", exact: true }).click();
  const remove = () =>
    page.getByRole("button", { name: "Remove panel", exact: true }).click();
  const confirm = () =>
    page
      .getByRole("button", { name: "Confirm remove panel", exact: true })
      .click();
  const options = page.getByLabel("Selected figure panel").locator("option");
  await open();
  await add();
  await expect(options).toHaveCount(3);
  await remove();
  await page
    .getByRole("button", { name: "Cancel removal", exact: true })
    .click();
  await expect(options).toHaveCount(3);
  await remove();
  await confirm();
  await expect(options).toHaveCount(2);
  await page.getByRole("button", { name: "Apply subfigure changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await exported(page)).toBe(initial);
  await open();
  await add();
  await add();
  await expect(options).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Add panel", exact: true }),
  ).toBeDisabled();
  for (let i = 0; i < 3; i++) {
    await remove();
    await confirm();
  }
  await expect(options).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Remove panel", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await exported(page)).toBe(initial);
  await open();
  await add();
  await page
    .getByLabel("Panel caption", { exact: true })
    .fill("New panel & retained");
  await page
    .getByRole("button", { name: "Move panel earlier", exact: true })
    .click();
  await page.getByLabel("Selected figure panel").selectOption("1");
  await expect(page.getByLabel("Panel caption", { exact: true })).toHaveValue(
    "First panel",
  );
  await remove();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Confirm remove panel", exact: true }),
  ).toBeInViewport();
  if (process.env.E2E_EVIDENCE_DIR)
    await page.screenshot({
      path: `${process.env.E2E_EVIDENCE_DIR}/subfigure-remove-phone.png`,
    });
  await confirm();
  await expect(options).toHaveCount(2);
  await page.getByRole("button", { name: "Apply subfigure changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const edited = await exported(page);
  expect([...edited.matchAll(/\\begin\{subfigure\}/g)]).toHaveLength(2);
  expect(edited).toContain(blocks[1]!);
  expect(edited).not.toContain(blocks[0]!);
  expect(edited).toContain(String.raw`\caption{New panel \& retained}`);
  const labels = [...edited.matchAll(/\\label\{([^}]+)\}/g)].map((m) => m[1]);
  expect(new Set(labels).size).toBe(labels.length);
  const before = initial.slice(0, initial.indexOf(blocks[0]!));
  const after = initial.slice(initial.indexOf(blocks[1]!) + blocks[1]!.length);
  expect(edited.startsWith(before)).toBe(true);
  expect(edited.endsWith(after)).toBe(true);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  await editor.press("ControlOrMeta+z");
  expect(await exported(page)).toBe(initial);
  await editor.press("ControlOrMeta+Shift+z");
  expect(await exported(page)).toBe(edited);
  await page.reload();
  expect(await exported(page)).toBe(edited);
  await page.getByRole("button", { name: "Proof", exact: true }).click();
  await build(page);
});
