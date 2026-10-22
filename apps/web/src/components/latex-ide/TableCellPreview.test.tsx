import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TableCellPreview,
  renderTableCellContent,
} from "./TableCellPreview";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderPreview(source: string): HTMLElement {
  act(() => {
    root.render(<TableCellPreview source={source} />);
  });
  const preview = container.querySelector(
    '[aria-label="Cell preview"]',
  ) as HTMLElement | null;
  if (!preview) throw new Error("Missing cell preview");
  return preview;
}

describe("TableCellPreview", () => {
  it("formats supported bold, italic, underline, and breaks as safe DOM", () => {
    const preview = renderPreview(
      String.raw`\textbf{Bold} and \textit{Italic} \underline{Under} \newline next`,
    );
    expect(preview.querySelector("strong")?.textContent).toBe("Bold");
    expect(preview.querySelector("em")?.textContent).toBe("Italic");
    expect(preview.querySelector("u")?.textContent).toBe("Under");
    expect(preview.querySelector("br")).not.toBeNull();
    expect(preview.querySelector("img,script,a")).toBeNull();
    expect(preview.textContent).toContain("next");
  });

  it("renders inline math with KaTeX and keeps hostile math inert", () => {
    const preview = renderPreview(String.raw`\(x^2\)`);
    expect(preview.querySelector(".katex,math")).not.toBeNull();
    expect(preview.querySelector("img,script,a")).toBeNull();

    const element = document.createElement("div");
    expect(renderTableCellContent(element, String.raw`\(x^2\)`)).toBe(true);
    expect(element.querySelector(".katex,math")).not.toBeNull();
    expect(element.querySelector("img,script")).toBeNull();
  });

  it("keeps malicious HTML as text without creating elements or scripts", () => {
    const source = "<img src=x onerror=alert(1)><script>alert(1)</script>";
    const preview = renderPreview(source);
    expect(preview.querySelector("img,script")).toBeNull();
    expect(preview.textContent).toContain("<img src=x");
    expect(preview.textContent).toContain("<script>");

    const escaped = renderPreview(String.raw`50\% <b>hi</b>`);
    expect(escaped.querySelector("b,img,script")).toBeNull();
    expect(escaped.textContent).toContain("50%");
    expect(escaped.textContent).toContain("<b>hi</b>");
  });

  it("shows unsupported raw source visibly with a source marker", () => {
    const source = String.raw`\input{evil}`;
    const element = document.createElement("div");
    expect(renderTableCellContent(element, source)).toBe(false);
    expect(element.textContent).toBe(source);
    expect(element.classList.contains("cm-visual-object-source")).toBe(true);

    const preview = renderPreview(source);
    expect(preview.textContent).toBe(source);
    expect(preview.classList.contains("cm-visual-object-source")).toBe(true);
    expect(preview.querySelector("img,script")).toBeNull();
  });
});
