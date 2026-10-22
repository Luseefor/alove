import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisualTableEditor } from "./VisualTableEditor";
import { parseVisualTable } from "@/lib/visualTable";
import type { VisualSourcePatch } from "@/lib/visualObjectTypes";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as unknown as Record<string, unknown>).requestAnimationFrame = (
    cb: () => void,
  ) => {
    cb();
    return 0;
  };
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderEditor(
  source: string,
  options?: { disabled?: boolean; onSave?: (p: VisualSourcePatch[]) => void },
) {
  const model = parseVisualTable(source)!;
  expect(model).not.toBeNull();
  const onSave = options?.onSave ?? vi.fn();
  const onCancel = vi.fn();
  act(() => {
    root.render(
      <VisualTableEditor
        model={model}
        onSave={onSave}
        onCancel={onCancel}
        disabled={options?.disabled}
      />,
    );
  });
  return { model, onSave, onCancel };
}

function getButton(text: string): HTMLButtonElement {
  const el = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!el) throw new Error(`Missing button: ${text}`);
  return el as HTMLButtonElement;
}

function getInput(label: string): HTMLInputElement {
  const el = container.querySelector(
    `input[aria-label="${label}"]`,
  ) as HTMLInputElement | null;
  if (!el) throw new Error(`Missing input: ${label}`);
  return el;
}

function getSelect(label: string): HTMLSelectElement {
  const el = container.querySelector(
    `select[aria-label="${label}"]`,
  ) as HTMLSelectElement | null;
  if (!el) throw new Error(`Missing select: ${label}`);
  return el;
}

function setInputValue(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!
      .set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelectValue(el: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!
      .set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function confirmGroup(): Element | null {
  return container.querySelector('[aria-label="Confirm table deletion"]');
}

function cellInputs(): HTMLInputElement[] {
  return [...container.querySelectorAll('input[data-cell]')] as HTMLInputElement[];
}

const twoByTwo = String.raw`\begin{tabular}{ll}A & B \\C & D \\\end{tabular}`;

describe("VisualTableEditor", () => {
  it("requires explicit confirmation to delete a nonempty row", () => {
    const onSave = vi.fn();
    renderEditor(twoByTwo, { onSave });
    expect(confirmGroup()).toBeNull();

    act(() => {
      getButton("Delete selected row").click();
    });
    expect(confirmGroup()).not.toBeNull();
    expect(confirmGroup()?.textContent).toContain("Delete row 1");
    expect(getButton("Apply table changes").disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      getButton("Keep content").click();
    });
    expect(confirmGroup()).toBeNull();
    expect(cellInputs()).toHaveLength(4);
    expect(getButton("Apply table changes").disabled).toBe(false);

    act(() => {
      getButton("Delete selected row").click();
    });
    expect(confirmGroup()).not.toBeNull();
    act(() => {
      getButton("Confirm deletion").click();
    });
    expect(confirmGroup()).toBeNull();
    expect(cellInputs()).toHaveLength(2);
    expect(getInput("Row 1 column 1").value).toBe("C");
    expect(getInput("Row 1 column 2").value).toBe("D");

    act(() => {
      getButton("Apply table changes").click();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
    expect(patches.length).toBeGreaterThan(0);
  });

  it("requires explicit confirmation to delete a nonempty column", () => {
    const onSave = vi.fn();
    renderEditor(twoByTwo, { onSave });

    act(() => {
      getButton("Delete selected column").click();
    });
    expect(confirmGroup()).not.toBeNull();
    expect(confirmGroup()?.textContent).toContain("Delete column 1");
    expect(getButton("Apply table changes").disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      getButton("Confirm deletion").click();
    });
    expect(confirmGroup()).toBeNull();
    expect(cellInputs()).toHaveLength(2);
    expect(getInput("Row 1 column 1").value).toBe("B");
    expect(getInput("Row 2 column 1").value).toBe("D");
  });

  it("deletes an empty row immediately without confirmation", () => {
    const source = String.raw`\begin{tabular}{ll}A & B \\ & \\\end{tabular}`;
    renderEditor(source);
    expect(cellInputs()).toHaveLength(4);

    act(() => {
      getInput("Row 2 column 1").focus();
    });
    act(() => {
      getButton("Delete selected row").click();
    });
    expect(confirmGroup()).toBeNull();
    expect(cellInputs()).toHaveLength(2);
    expect(getInput("Row 1 column 1").value).toBe("A");
  });

  it("merges cells with spaces and split retains content in the first cell", () => {
    const source = String.raw`\begin{tabular}{ll}Alpha & Beta \\C & D \\\end{tabular}`;
    const onSave = vi.fn();
    renderEditor(source, { onSave });

    act(() => {
      getButton("Merge cells").click();
    });
    expect(getInput("Row 1 column 1").value).toBe("Alpha Beta");
    expect(
      container.querySelector('input[aria-label="Row 1 column 2"]'),
    ).toBeNull();
    expect(container.textContent).toContain("Spans 2 columns");

    act(() => {
      getButton("Apply table changes").click();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
    expect(JSON.stringify(patches)).toContain("Alpha Beta");
    expect(JSON.stringify(patches)).toContain("multicolumn");

    act(() => {
      getButton("Split cell").click();
    });
    expect(getInput("Row 1 column 1").value).toBe("Alpha Beta");
    expect(getInput("Row 1 column 2").value).toBe("");
    expect(container.textContent).not.toContain("Spans 2 columns");
  });

  it("blocks disabled viewer controls from mutating or saving", () => {
    const onSave = vi.fn();
    renderEditor(twoByTwo, { disabled: true, onSave });
    const before = getInput("Row 1 column 1").value;

    expect(getInput("Row 1 column 1").disabled).toBe(true);
    expect(getButton("Add row").disabled).toBe(true);
    expect(getButton("Delete selected row").disabled).toBe(true);
    expect(getButton("Delete selected column").disabled).toBe(true);
    expect(getButton("Merge cells").disabled).toBe(true);
    expect(getSelect("Column 1 alignment").disabled).toBe(true);
    expect(getButton("Apply table changes").disabled).toBe(true);

    act(() => {
      getButton("Delete selected row").click();
    });
    expect(confirmGroup()).toBeNull();
    expect(cellInputs()).toHaveLength(4);

    act(() => {
      getButton("Bold").click();
    });
    expect(getInput("Row 1 column 1").value).toBe(before);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    act(() => {
      const form = container.querySelector("form")!;
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps custom protected cells as Source-only", () => {
    const source = String.raw`\begin{tabular}{ll}\custom{A} & B \\C & D \\\end{tabular}`;
    const model = parseVisualTable(source)!;
    expect(model.cells[0]![0]!.nodes).toBeNull();
    const onSave = vi.fn();
    renderEditor(source, { onSave });

    const protectedInput = getInput("Row 1 column 1");
    expect(protectedInput.disabled).toBe(true);
    expect(protectedInput.title).toBe("Custom markup · edit in Source");
    expect(protectedInput.value).toBe(String.raw`\custom{A}`);
    expect(getInput("Row 1 column 2").disabled).toBe(false);

    const fieldsets = container.querySelectorAll("fieldset");
    expect((fieldsets[0] as HTMLFieldSetElement).disabled).toBe(true);

    const before = protectedInput.value;
    act(() => {
      getButton("Bold").click();
    });
    expect(getInput("Row 1 column 1").value).toBe(before);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    setInputValue(getInput("Row 1 column 2"), "B2");
    act(() => {
      getButton("Apply table changes").click();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onSave.mock.calls[0]![0])).toContain("B2");
  });

  it("updates alignment, column type, and width state", () => {
    const onSave = vi.fn();
    renderEditor(twoByTwo, { onSave });

    const alignment = getSelect("Column 1 alignment");
    expect(alignment.value).toBe("l");
    setSelectValue(alignment, "c");
    expect(getSelect("Column 1 alignment").value).toBe("c");

    const kind = getSelect("Column 1 type");
    expect(kind.value).toBe("natural");
    setSelectValue(kind, "p");
    const width = getInput("Column 1 width");
    expect(width.value).toBe("3cm");
    setInputValue(width, "4cm");
    expect(getInput("Column 1 width").value).toBe("4cm");

    act(() => {
      getButton("Apply table changes").click();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
    const spec = patches.map((p) => p.insert).join("\n");
    expect(spec).toContain("p{4cm}");
  });

  it("formats a selection while preserving escaped literals exactly", async () => {
    const source = String.raw`\begin{tabular}{ll}100\% beta & x \\c & d \\\end{tabular}`;
    const onSave = vi.fn();
    renderEditor(source, { onSave });
    const cell = getInput("Row 1 column 1");
    expect(cell.value).toBe("100% beta");

    await act(async () => {
      cell.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      // jsdom does not fire React onSelect for controlled inputs from an
      // input-level select event; a document selectionchange does sync the
      // selection ref the same way a real browser selection does.
      const focused = getInput("Row 1 column 1");
      focused.setSelectionRange(5, 9);
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      getButton("Bold").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getInput("Row 1 column 1").value).toBe(
      String.raw`100\% \textbf{beta}`,
    );
    const checkbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    const preview = container.querySelector('[aria-label="Cell preview"]')!;
    expect(preview.querySelector("strong")?.textContent).toBe("beta");
    expect(preview.textContent).toContain("100%");

    act(() => {
      getButton("Apply table changes").click();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
    expect(patches.map((p) => p.insert).join("\n")).toContain(
      String.raw`100\% \textbf{beta}`,
    );
  });

  it("updates merged cell alignment through its selector", () => {
    const source = String.raw`\begin{tabular}{ll}Alpha & Beta \\C & D \\\end{tabular}`;
    const onSave = vi.fn();
    renderEditor(source, { onSave });

    act(() => {
      getButton("Merge cells").click();
    });
    const mergedAlignment = getSelect("Merged cell alignment");
    expect(mergedAlignment.value).toBe("l");
    setSelectValue(mergedAlignment, "c");
    expect(getSelect("Merged cell alignment").value).toBe("c");

    act(() => {
      getButton("Apply table changes").click();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onSave.mock.calls[0]![0])).toContain("multicolumn");
  });

  it("wires vertical boundaries through the border helper", () => {
    const onSave = vi.fn();
    renderEditor(twoByTwo, { onSave });

    const boundary = getSelect("Vertical boundary 1");
    expect(boundary.value).toBe("0");
    setSelectValue(boundary, "1");
    expect(getSelect("Vertical boundary 1").value).toBe("1");

    act(() => {
      getButton("Apply table changes").click();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    const spec = (onSave.mock.calls[0]![0] as VisualSourcePatch[])
      .map((p) => p.insert)
      .join("\n");
    expect(spec).toContain("|");
  });
});
