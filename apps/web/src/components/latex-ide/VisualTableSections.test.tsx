import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisualTableEditor } from "./VisualTableEditor";
import { parseVisualTable } from "@/lib/visualTable";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const standard = [
  String.raw`\begin{longtable}{ll}`,
  String.raw`H1 & H2 \\`,
  String.raw`\endfirsthead`,
  String.raw`H1 & H2 \\`,
  String.raw`\endhead`,
  String.raw`F1 & F2 \\`,
  String.raw`\endfoot`,
  String.raw`L1 & L2 \\`,
  String.raw`\endlastfoot`,
  String.raw`A & B \\`,
  String.raw`\end{longtable}`,
].join("\n");

describe("VisualTableEditor repeated sections", () => {
  it("labels first head, head, foot, last foot and body distinctly", () => {
    const model = parseVisualTable(standard)!;
    act(() => {
      root.render(
        <VisualTableEditor
          model={model}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });
    const headers = [...container.querySelectorAll('th[scope="row"]')].map(
      (th) => th.textContent,
    );
    expect(headers).toHaveLength(5);
    expect(headers[0]).toContain("First head");
    expect(headers[1]).toContain("Head");
    expect(headers[2]).toContain("Foot");
    expect(headers[3]).toContain("Last foot");
    expect(headers[4]).toContain("Body");
    expect(
      container.querySelector('[aria-label="Repeated headers preserved"]'),
    ).not.toBeNull();
  });

  it("does not label plain tabular rows as repeated sections", () => {
    const model = parseVisualTable(
      String.raw`\begin{tabular}{ll}a & b \\c & d \\\end{tabular}`,
    )!;
    act(() => {
      root.render(
        <VisualTableEditor
          model={model}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });
    const headers = [...container.querySelectorAll('th[scope="row"]')].map(
      (th) => th.textContent,
    );
    expect(headers).toEqual(["1", "2"]);
  });
});
