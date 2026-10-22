import { describe, expect, it } from "vitest";
import { parseVisualTable } from "@/lib/visualTable";
import { buildVisualTablePreview } from "./visualObjectExtension";

function preview(source: string) {
  const model = parseVisualTable(source);
  expect(model?.kind).toBe("table");
  if (!model || model.kind !== "table") throw new Error("expected a table");
  const calls: { row: number; column: number }[] = [];
  const frame = buildVisualTablePreview(model, (cell) => {
    calls.push(cell);
  });
  return { model, frame, calls };
}

describe("advanced table widget preview", () => {
  it("skips covered cells, spans merges and keeps edit mapping", () => {
    const { frame, calls } = preview(
      String.raw`\begin{tabular}{|l|c|}\hline\multicolumn{2}{|c|}{Merged} \\\hline A & B \\\hline\end{tabular}`,
    );
    const cells = [...frame.querySelectorAll("td")];
    expect(cells).toHaveLength(3);
    expect(cells[0]!.colSpan).toBe(2);
    const buttons = [
      ...frame.querySelectorAll("td button"),
    ] as HTMLElement[];
    expect(
      buttons.map((b) => b.getAttribute("aria-label")?.split(":")[0]),
    ).toEqual([
      "Edit table row 1 column 1",
      "Edit table row 2 column 1",
      "Edit table row 2 column 2",
    ]);
    buttons[0]!.click();
    buttons[2]!.click();
    expect(calls).toEqual([
      { row: 0, column: 0 },
      { row: 1, column: 1 },
    ]);
  });

  it("renders rich inline content and math without HTML execution", () => {
    const { frame } = preview(
      String.raw`\begin{tabular}{ll}\textbf{Bold} \textit{It} & \(x^2\) \\\end{tabular}`,
    );
    const first = frame.querySelectorAll("td")[0]!;
    expect(first.querySelector("strong")?.textContent).toBe("Bold");
    expect(first.querySelector("em")?.textContent).toBe("It");
    expect(frame.querySelector(".katex")).not.toBeNull();
    expect(frame.querySelector("script")).toBeNull();
  });

  it("shows unknown source as text without innerHTML", () => {
    const hostile = String.raw`\custom{evil} <img src=x onerror=alert(1)>`;
    const { frame } = preview(
      String.raw`\begin{tabular}{l}` + hostile + String.raw` \\\end{tabular}`,
    );
    const td = frame.querySelector("td")!;
    expect(td.querySelector("img")).toBeNull();
    expect(td.textContent).toContain(hostile);
    expect(td.querySelector(".cm-visual-object-source")).not.toBeNull();
  });

  it("applies column and table widths through tableDimensionCss", () => {
    const { frame } = preview(
      String.raw`\begin{tabularx}{\linewidth}{|X|>{\raggedleft\arraybackslash}p{2cm}|}Text & Value \\\end{tabularx}`,
    );
    const table = frame.querySelector("table")!;
    expect(table.style.width).toBe("100%");
    const cols = [...frame.querySelectorAll("col")];
    expect(cols).toHaveLength(2);
    expect(cols[1]!.style.width).toBe("2cm");
  });

  it("renders single, double and booktabs borders with theme tokens", () => {
    const { frame } = preview(
      String.raw`\begin{tabular}{|l||c|}\hline\hline A & B \\\toprule C & D \\\bottomrule\end{tabular}`,
    );
    const first = frame.querySelectorAll("tr")[0]!.querySelectorAll("td");
    expect(first[0]!.style.borderLeft).toContain("var(--border)");
    expect(first[0]!.style.borderRight).toContain("double");
    expect(first[0]!.style.borderRight).toContain("var(--border)");
    expect(first[0]!.style.borderTop).toContain("double");
    const booktabsRow = frame
      .querySelectorAll("tr")[1]!
      .querySelectorAll("td")[0]!;
    expect(booktabsRow.style.borderTop).toContain("var(--foreground)");
    expect(booktabsRow.style.borderBottom).toContain("var(--foreground)");
  });

  it("renders partial clines only across the named columns", () => {
    const { frame } = preview(
      String.raw`\begin{tabular}{ll}\hline A & B \\\cline{1-1} C & D \\\hline\end{tabular}`,
    );
    const second = frame.querySelectorAll("tr")[1]!.querySelectorAll("td");
    expect(second[0]!.style.borderTop).toBe("1px solid var(--border)");
    expect(second[1]!.style.borderTop).toBe("0px solid var(--border)");
  });

  it("clears borders when the model has none", () => {
    const { frame } = preview(
      String.raw`\begin{tabular}{ll}A & B \\\end{tabular}`,
    );
    const td = frame.querySelector("td")!;
    expect(td.style.borderLeft).toBe("0px solid var(--border)");
    expect(td.style.borderTop).toBe("0px solid var(--border)");
    expect(td.style.borderBottom).toBe("0px solid var(--border)");
  });

  it("never renders links, images or scripts from hostile math", () => {
    const { frame } = preview(
      String.raw`\begin{tabular}{l}\( \href{javascript:alert(1)}{x} \) \\\end{tabular}`,
    );
    expect(frame.querySelector("a,script,img")).toBeNull();
  });

  it("honours multicolumn alignment and bars over the base spec", () => {
    const { frame } = preview(
      String.raw`\begin{tabular}{|l|r|}\hline\multicolumn{2}{c}{Merged} \\\hline A & B \\\hline\end{tabular}`,
    );
    const merged = frame.querySelectorAll("tr")[0]!.querySelector("td")!;
    expect(merged.colSpan).toBe(2);
    expect(merged.style.textAlign).toBe("center");
    expect(merged.style.borderLeft).toBe("0px solid var(--border)");
    expect(merged.style.borderRight).toBe("0px solid var(--border)");
    const base = frame.querySelectorAll("tr")[1]!.querySelectorAll("td");
    expect(base[0]!.style.textAlign).toBe("left");
    expect(base[0]!.style.borderLeft).toBe("1px solid var(--border)");
    expect(base[1]!.style.textAlign).toBe("right");
    expect(base[1]!.style.borderRight).toBe("1px solid var(--border)");
  });

  it("honours multicolumn double bars differing from the base spec", () => {
    const { frame } = preview(
      String.raw`\begin{tabular}{lr}\hline\multicolumn{2}{|r||}{Merged} \\\hline A & B \\\hline\end{tabular}`,
    );
    const merged = frame.querySelector("td")!;
    expect(merged.style.textAlign).toBe("right");
    expect(merged.style.borderLeft).toBe("1px solid var(--border)");
    expect(merged.style.borderRight).toContain("double");
    expect(merged.style.borderRight).toContain("var(--border)");
  });

  it("aligns p/m/b columns vertically and widths merged wrap cells", () => {
    const { frame } = preview(
      String.raw`\begin{tabular}{|m{2cm}|b{3cm}|}\hline A & B \\\hline\multicolumn{2}{p{4cm}}{Merged} \\\hline\end{tabular}`,
    );
    const base = frame.querySelectorAll("tr")[0]!.querySelectorAll("td");
    expect(base[0]!.style.verticalAlign).toBe("middle");
    expect(base[1]!.style.verticalAlign).toBe("bottom");
    const merged = frame.querySelectorAll("tr")[1]!.querySelector("td")!;
    expect(merged.style.verticalAlign).toBe("top");
    expect(merged.style.width).toBe("4cm");
    expect(merged.style.textAlign).toBe("justify");
  });
});
