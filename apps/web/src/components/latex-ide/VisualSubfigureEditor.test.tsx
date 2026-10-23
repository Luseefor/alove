import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VisualSubfigureEditor } from "./VisualSubfigureEditor";
import {
  parseVisualSubfigure,
  patchesForVisualSubfigure,
  subfigureDraft,
  type VisualSubfigure,
} from "@/lib/visualSubfigure";
import { applyVisualSourcePatches as apply } from "@/lib/visualObjects";
import type { VisualSourcePatch } from "@/lib/visualObjectTypes";

let container: HTMLDivElement;
let root: Root;

const TWO_PANEL =
  "\\begin{figure}[htbp]\n\\centering\n" +
  "\\begin{subfigure}[b]{0.48\\textwidth}\n\\centering\n" +
  "\\includegraphics[width=\\linewidth]{\\detokenize{figures/a.png}}\n" +
  "\\caption{First}\n\\label{fig:a}\n\\end{subfigure}\n\\hfill\n" +
  "\\begin{subfigure}[b]{0.48\\textwidth}\n\\centering\n" +
  "\\includegraphics[width=\\linewidth]{\\detokenize{figures/b.png}}\n" +
  "\\caption{Second}\n\\label{fig:b}\n\\end{subfigure}\n" +
  "\\caption{Main}\n\\label{fig:main}\n\\end{figure}";

function tinyPng(): string {
  return "data:image/png;base64,iVBORw0KGgo=";
}

function renderEditor({
  model,
  assets,
  disabled = false,
  onSave = vi.fn(),
  onCancel = vi.fn(),
  usedLabels,
  uploadImpl,
}: {
  model: VisualSubfigure;
  assets?: Record<string, string>;
  disabled?: boolean;
  onSave?: (patches: VisualSourcePatch[]) => void;
  onCancel?: () => void;
  usedLabels?: string[];
  uploadImpl?: () => Promise<string>;
}) {
  const resolved = assets ?? {
    "figures/a.png": tinyPng(),
    "figures/b.png": tinyPng(),
    "figures/c.png": tinyPng(),
    "figures/d.png": tinyPng(),
  };
  const upload = vi.fn(uploadImpl ?? (async () => "figures/a.png"));
  act(() => {
    root.render(
      <VisualSubfigureEditor
        model={model}
        assets={resolved}
        onSave={onSave}
        onCancel={onCancel}
        onUpload={upload}
        disabled={disabled}
        usedLabels={usedLabels}
      />,
    );
  });
  return { onSave, onCancel, upload };
}

function query(label: string): HTMLElement | null {
  return container.querySelector(`[aria-label="${label}"]`);
}

function setInputValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const descriptor =
    el instanceof HTMLSelectElement
      ? Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          "value",
        )
      : Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        );
  act(() => {
    descriptor?.set?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function applyButton(): HTMLButtonElement {
  const apply = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Apply subfigure changes",
  ) as HTMLButtonElement;
  if (!apply) throw new Error("Missing Apply button");
  return apply;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it("keeps selected panel edits isolated until Apply", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({ model, onSave });

  const panelSelect = query("Selected figure panel") as HTMLSelectElement;
  const caption = query("Panel caption") as HTMLInputElement;
  expect(caption.value).toBe("First");

  setInputValue(caption, "First edited");
  expect(onSave).not.toHaveBeenCalled();

  setInputValue(panelSelect, "1");
  expect((query("Panel caption") as HTMLInputElement).value).toBe("Second");

  setInputValue(panelSelect, "0");
  expect((query("Panel caption") as HTMLInputElement).value).toBe(
    "First edited",
  );

  await act(async () => applyButton().click());
  expect(onSave).toHaveBeenCalledTimes(1);
  const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
  const result = apply(TWO_PANEL, patches);
  expect(result).toContain("\\caption{First edited}");
  expect(result).toContain("\\caption{Second}");
  expect(result).toContain("\\label{fig:a}");
  expect(result).toContain("\\label{fig:b}");
});

it("patches panel width and caption exactly", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({ model, onSave });

  setInputValue(query("Panel width percentage") as HTMLInputElement, "40");
  setInputValue(query("Panel caption") as HTMLInputElement, "Alpha");
  await act(async () => applyButton().click());

  expect(onSave).toHaveBeenCalledTimes(1);
  const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
  expect(patches.map((p) => p.insert).join("\n")).toContain("0.4");
  expect(patches.map((p) => p.insert).join("\n")).toContain("Alpha");
  const result = apply(TWO_PANEL, patches);
  expect(result).toContain("{0.4\\textwidth}");
  expect(result).toContain("\\caption{Alpha}");
  expect(result).toContain("\\caption{Second}");
  expect(result).toContain("\\hfill");
});

it("disables viewer inputs and Apply, and programmatic submit refuses", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({ model, onSave, disabled: true });

  expect(
    (query("Selected figure panel") as HTMLSelectElement).disabled,
  ).toBe(false);
  expect((query("Panel image") as HTMLSelectElement).disabled).toBe(true);
  expect((query("Panel width percentage") as HTMLInputElement).disabled).toBe(
    true,
  );
  expect((query("Panel caption") as HTMLInputElement).disabled).toBe(true);
  expect((query("Panel label") as HTMLInputElement).disabled).toBe(true);
  expect(applyButton().disabled).toBe(true);

  const form = container.querySelector('form[aria-label="Subfigure editor"]')!;
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(onSave).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("emits no patches on no-op, preserving exact CRLF bytes", async () => {
  const source = TWO_PANEL.replace(/\n/g, "\r\n");
  const model = parseVisualSubfigure(source)!;
  expect(model.eol).toBe("\r\n");
  const onSave = vi.fn();
  renderEditor({ model, onSave });

  await act(async () => applyButton().click());
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0]![0]).toEqual([]);
  expect(
    apply(source, patchesForVisualSubfigure(model, subfigureDraft(model))),
  ).toBe(source);
});

it("blocks Apply when a panel image is missing from project assets", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({
    model,
    onSave,
    assets: { "figures/a.png": tinyPng() },
  });

  await act(async () => applyButton().click());
  expect(onSave).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
    /project image/,
  );
});

it("renders a malicious caption as safe text without script execution", async () => {
  const evil = `<script>alert(1)</script><img src=x onerror=alert(2)>`;
  const safe = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({ model: safe, onSave });
  setInputValue(query("Panel caption") as HTMLInputElement, evil);
  expect((query("Panel caption") as HTMLInputElement).value).toBe(evil);
  await act(async () => applyButton().click());

  expect(onSave).toHaveBeenCalledTimes(1);
  const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
  const result = apply(TWO_PANEL, patches);
  expect(result).toContain("\\caption{");
  expect(container.querySelector("script")).toBeNull();
  const preview = container.querySelector(
    '[data-testid="figure-resize-preview"]',
  )!;
  expect(preview.querySelector("script")).toBeNull();
  expect(
    [...preview.querySelectorAll("img")].every(
      (img) => !img.getAttribute("onerror"),
    ),
  ).toBe(true);
});

it("moves panels with bounded earlier/later controls and preserves selection", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({ model, onSave });

  const earlier = query("Move panel earlier") as HTMLButtonElement;
  const later = query("Move panel later") as HTMLButtonElement;
  expect(earlier.disabled).toBe(true);
  expect(later.disabled).toBe(false);
  expect((query("Panel caption") as HTMLInputElement).value).toBe("First");

  await act(async () => later.click());
  expect((query("Selected figure panel") as HTMLSelectElement).value).toBe(
    "1",
  );
  // Selection follows the moved original panel.
  expect((query("Panel caption") as HTMLInputElement).value).toBe("First");
  expect((query("Move panel earlier") as HTMLButtonElement).disabled).toBe(
    false,
  );
  expect((query("Move panel later") as HTMLButtonElement).disabled).toBe(true);

  await act(async () => applyButton().click());
  expect(onSave).toHaveBeenCalledTimes(1);
  const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
  const result = apply(TWO_PANEL, patches);
  expect(result.indexOf("figures/b.png")).toBeLessThan(
    result.indexOf("figures/a.png"),
  );
  expect(result).toContain("\\hfill");

  // Moving back restores the original order with no patches.
  await act(async () =>
    (query("Move panel earlier") as HTMLButtonElement).click(),
  );
  expect((query("Selected figure panel") as HTMLSelectElement).value).toBe(
    "0",
  );
  expect((query("Panel caption") as HTMLInputElement).value).toBe("First");
  onSave.mockClear();
  await act(async () => applyButton().click());
  expect(onSave.mock.calls[0]![0]).toEqual([]);
  expect(
    apply(TWO_PANEL, onSave.mock.calls[0]![0] as VisualSourcePatch[]),
  ).toBe(TWO_PANEL);
});

it("keeps field edits with their original panel across moves", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({ model, onSave });

  setInputValue(query("Panel caption") as HTMLInputElement, "First edited");
  await act(async () => (query("Move panel later") as HTMLButtonElement).click());
  // Edited origin moves with the panel.
  expect((query("Panel caption") as HTMLInputElement).value).toBe(
    "First edited",
  );
  expect((query("Selected figure panel") as HTMLSelectElement).value).toBe(
    "1",
  );

  setInputValue(query("Selected figure panel") as HTMLSelectElement, "0");
  expect((query("Panel caption") as HTMLInputElement).value).toBe("Second");
  setInputValue(query("Selected figure panel") as HTMLSelectElement, "1");
  expect((query("Panel caption") as HTMLInputElement).value).toBe(
    "First edited",
  );

  await act(async () => applyButton().click());
  const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
  const result = apply(TWO_PANEL, patches);
  expect(result.indexOf("figures/b.png")).toBeLessThan(
    result.indexOf("figures/a.png"),
  );
  expect(result).toContain("\\caption{First edited}");
  expect(result).toContain("\\caption{Second}");
});

it("disables move controls at boundaries and when locked", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({ model, onSave });
  expect((query("Move panel earlier") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((query("Move panel later") as HTMLButtonElement).disabled).toBe(
    false,
  );
  await act(async () => (query("Move panel later") as HTMLButtonElement).click());
  expect((query("Move panel earlier") as HTMLButtonElement).disabled).toBe(
    false,
  );
  expect((query("Move panel later") as HTMLButtonElement).disabled).toBe(true);

  const lockedSave = vi.fn();
  const lockedModel = parseVisualSubfigure(TWO_PANEL)!;
  renderEditor({ model: lockedModel, onSave: lockedSave, disabled: true });
  expect((query("Move panel earlier") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((query("Move panel later") as HTMLButtonElement).disabled).toBe(true);
});

it("adds a panel, selects it, and enforces one-to-four limits", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({
    model,
    onSave,
    usedLabels: ["fig:a", "fig:b", "fig:main", "fig:new-panel"],
  });
  expect((query("Add panel") as HTMLButtonElement).disabled).toBe(false);
  expect((query("Remove panel") as HTMLButtonElement).disabled).toBe(false);

  await act(async () => (query("Add panel") as HTMLButtonElement).click());
  expect((query("Selected figure panel") as HTMLSelectElement).value).toBe(
    "1",
  );
  expect((query("Panel label") as HTMLInputElement).value).not.toBe(
    "fig:new-panel",
  );
  expect((query("Panel label") as HTMLInputElement).value).toBe(
    "fig:new-panel-1",
  );
  await act(async () => applyButton().click());
  const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
  const added = apply(TWO_PANEL, patches);
  expect(added).toContain("fig:new-panel-1");
  expect(added).toContain("{0.45\\textwidth}");

  onSave.mockClear();
  await act(async () => (query("Add panel") as HTMLButtonElement).click());
  expect((query("Add panel") as HTMLButtonElement).disabled).toBe(true);
  expect((query("Selected figure panel") as HTMLSelectElement).children).toHaveLength(4);
});

it("requires explicit confirm and cancel for removal and clamps selection", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  const onCancel = vi.fn();
  renderEditor({ model, onSave, onCancel });

  await act(async () => (query("Remove panel") as HTMLButtonElement).click());
  expect(query("Confirm remove panel")).not.toBeNull();
  expect(onSave).not.toHaveBeenCalled();
  await act(async () =>
    (query("Cancel removal") as HTMLButtonElement).click(),
  );
  expect(query("Confirm remove panel")).toBeNull();
  await act(async () => applyButton().click());
  expect(onSave.mock.calls[0]![0]).toEqual([]);

  await act(async () => (query("Remove panel") as HTMLButtonElement).click());
  await act(async () =>
    (query("Confirm remove panel") as HTMLButtonElement).click(),
  );
  expect((query("Selected figure panel") as HTMLSelectElement).value).toBe(
    "0",
  );
  expect(
    (query("Selected figure panel") as HTMLSelectElement).querySelectorAll(
      "option",
    ),
  ).toHaveLength(1);
  expect((query("Remove panel") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => applyButton().click());
  const patches = onSave.mock.calls[1]![0] as VisualSourcePatch[];
  const result = apply(TWO_PANEL, patches);
  expect(result).not.toContain("figures/a.png");
  expect(result).toContain("figures/b.png");
});

it("cancels pending removal on selection, add and move", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  renderEditor({ model });
  await act(async () => (query("Remove panel") as HTMLButtonElement).click());
  expect(query("Confirm remove panel")).not.toBeNull();
  setInputValue(query("Selected figure panel") as HTMLSelectElement, "1");
  expect(query("Confirm remove panel")).toBeNull();

  await act(async () => (query("Remove panel") as HTMLButtonElement).click());
  await act(async () => (query("Add panel") as HTMLButtonElement).click());
  expect(query("Confirm remove panel")).toBeNull();

  await act(async () => (query("Remove panel") as HTMLButtonElement).click());
  await act(async () =>
    (query("Move panel earlier") as HTMLButtonElement).click(),
  );
  // At index 1 after add, moving earlier is allowed and must cancel confirm.
  expect(query("Confirm remove panel")).toBeNull();
});

it("adds then removes a new panel back to an exact no-op", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({ model, onSave });
  await act(async () => (query("Add panel") as HTMLButtonElement).click());
  await act(async () => (query("Remove panel") as HTMLButtonElement).click());
  await act(async () =>
    (query("Confirm remove panel") as HTMLButtonElement).click(),
  );
  await act(async () => applyButton().click());
  expect(onSave.mock.calls[0]![0]).toEqual([]);
  expect(apply(TWO_PANEL, onSave.mock.calls[0]![0] as VisualSourcePatch[])).toBe(
    TWO_PANEL,
  );
});

it("maps edit, move and remove across original and new panels", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  renderEditor({ model, onSave, usedLabels: [] });
  await act(async () => (query("Add panel") as HTMLButtonElement).click());
  // New panel intentionally defaults to the selection asset (figures/a.png).
  setInputValue(query("Panel caption") as HTMLInputElement, "Brand new");
  await act(async () =>
    (query("Move panel earlier") as HTMLButtonElement).click(),
  );
  expect((query("Selected figure panel") as HTMLSelectElement).value).toBe(
    "0",
  );
  expect((query("Panel caption") as HTMLInputElement).value).toBe("Brand new");
  // Select original panel 0 (now at display 1) and remove it.
  setInputValue(query("Selected figure panel") as HTMLSelectElement, "1");
  expect((query("Panel caption") as HTMLInputElement).value).toBe("First");
  await act(async () => (query("Remove panel") as HTMLButtonElement).click());
  await act(async () =>
    (query("Confirm remove panel") as HTMLButtonElement).click(),
  );
  await act(async () => applyButton().click());
  const patches = onSave.mock.calls[0]![0] as VisualSourcePatch[];
  const result = apply(TWO_PANEL, patches);
  // Removed original block absent (caption/label/exact bytes), new panel keeps asset.
  const blockA = TWO_PANEL.slice(
    model.panels[0]!.panelFrom - model.from,
    model.panels[0]!.panelTo - model.from,
  );
  expect(result).not.toContain(blockA);
  expect(result).not.toContain("\\caption{First}");
  expect(result).not.toContain("\\label{fig:a}");
  expect(result).toContain("figures/b.png");
  expect(result).toContain("Brand new");
  // Surviving original block stays exact.
  const blockB = TWO_PANEL.slice(
    model.panels[1]!.panelFrom - model.from,
    model.panels[1]!.panelTo - model.from,
  );
  expect(result).toContain(blockB);
  expect(result).toContain("\\caption{Main}");
  // Prefix/suffix exact.
  expect(result.startsWith("\\begin{figure}[htbp]\n\\centering\n")).toBe(true);
  expect(result.endsWith("\\caption{Main}\n\\label{fig:main}\n\\end{figure}")).toBe(
    true,
  );
});

it("keeps Cancel from patching and anchors upload to the requested panel", async () => {
  const model = parseVisualSubfigure(TWO_PANEL)!;
  const onSave = vi.fn();
  const onCancel = vi.fn();
  let release!: (path: string) => void;
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  const { upload } = renderEditor({
    model,
    onSave,
    onCancel,
    uploadImpl: () => pending,
  });
  setInputValue(query("Panel caption") as HTMLInputElement, "Edited");
  await act(async () => {
    (container.querySelector('button[type="button"]') as HTMLButtonElement).click();
  });
  // Cancel discards draft edits without patching.
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Cancel")!
      .click();
  });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();

  // Upload anchoring: start upload on panel 0, switch selection, resolve.
  const file = new File(["x"], "c.png", { type: "image/png" });
  const input = query("Upload panel image") as HTMLInputElement;
  await act(async () => {
    const dt = { files: [file] } as unknown as DataTransfer;
    Object.defineProperty(input, "files", { value: dt.files, writable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(upload).toHaveBeenCalledTimes(1);
  expect((query("Selected figure panel") as HTMLSelectElement).disabled).toBe(
    true,
  );
  setInputValue(query("Selected figure panel") as HTMLSelectElement, "1");
  await act(async () => {
    release("figures/c.png");
    await pending;
  });
  await act(async () => {});
  expect((query("Panel caption") as HTMLInputElement).value).toBe("Second");
  setInputValue(query("Selected figure panel") as HTMLSelectElement, "0");
  // Upload landed on original panel 0 despite selection change.
  await act(async () => applyButton().click());
  expect(onSave).toHaveBeenCalled();
});
