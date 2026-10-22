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
}: {
  model: VisualSubfigure;
  assets?: Record<string, string>;
  disabled?: boolean;
  onSave?: (patches: VisualSourcePatch[]) => void;
  onCancel?: () => void;
}) {
  const resolved = assets ?? {
    "figures/a.png": tinyPng(),
    "figures/b.png": tinyPng(),
  };
  const upload = vi.fn(async () => "figures/a.png");
  act(() => {
    root.render(
      <VisualSubfigureEditor
        model={model}
        assets={resolved}
        onSave={onSave}
        onCancel={onCancel}
        onUpload={upload}
        disabled={disabled}
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
