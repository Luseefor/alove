import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VisualFigureEditor } from "./VisualObjectForms";
import {
  createVisualFigure,
  parseVisualFigure,
  type VisualFigure,
} from "@/lib/visualFigure";

let container: HTMLDivElement;
let root: Root;

function tinyPng(): string {
  return "data:image/png;base64,iVBORw0KGgo=";
}

function renderEditor({
  model,
  disabled = false,
  onSave = vi.fn(),
  onCancel = vi.fn(),
}: {
  model: VisualFigure;
  disabled?: boolean;
  onSave?: (patches: unknown[]) => void;
  onCancel?: () => void;
}) {
  const assets = { [model.path]: tinyPng() };
  const upload = vi.fn(async () => model.path);
  act(() => {
    root.render(
      <VisualFigureEditor
        model={model}
        assets={assets}
        onSave={onSave as never}
        onCancel={onCancel}
        onUpload={upload}
        disabled={disabled}
      />,
    );
  });
  return { onSave: onSave as ReturnType<typeof vi.fn>, onCancel };
}

function query(label: string): HTMLElement | null {
  return container.querySelector(`[aria-label="${label}"]`);
}

function setInputValue(
  el: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
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

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  clientX?: number,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: clientX ?? 0,
  });
  act(() => {
    target.dispatchEvent(event);
  });
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

it("keeps drag and slider edits as draft-only until Apply, and Cancel discards them", async () => {
  const model = parseVisualFigure(createVisualFigure("figures/a.png"))!;
  const onSave = vi.fn();
  const onCancel = vi.fn();
  renderEditor({ model, onSave, onCancel });

  const slider = query("Figure width") as HTMLInputElement;
  expect(slider).not.toBeNull();
  // Slider keyboard fallback changes only the draft.
  setInputValue(slider, "50");
  expect(onSave).not.toHaveBeenCalled();
  expect(query("Figure editor")?.textContent).toContain("50%");

  // Pointer drag handle updates the same draft without saving.
  // Pointer capture retargets moves to the handle, so moves dispatch there.
  const handle = container.querySelector(
    '[data-testid="figure-resize-handle"]',
  ) as HTMLElement;
  expect(handle).not.toBeNull();
  dispatchPointer(handle, "pointerdown", 100);
  dispatchPointer(handle, "pointermove", 226);
  dispatchPointer(handle, "pointerup");
  expect(onSave).not.toHaveBeenCalled();
  expect(handle.getAttribute("aria-valuenow")).not.toBe("50");

  // Cancel discards the draft without saving.
  const cancel = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Cancel",
  )!;
  await act(async () => cancel.click());
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});

it("disables drag, inputs and Apply for viewers without changing source", async () => {
  const model = parseVisualFigure(createVisualFigure("figures/a.png"))!;
  const onSave = vi.fn();
  renderEditor({ model, disabled: true, onSave });
  expect((query("Figure width") as HTMLInputElement).disabled).toBe(true);
  expect((query("Figure width percentage") as HTMLInputElement).disabled).toBe(
    true,
  );
  expect((query("Figure placement") as HTMLSelectElement).disabled).toBe(true);
  const handle = container.querySelector(
    '[data-testid="figure-resize-handle"]',
  ) as HTMLElement;
  expect(handle.getAttribute("tabindex")).toBe("-1");
  expect(handle.getAttribute("aria-disabled")).toBe("true");
  const before = handle.getAttribute("aria-valuenow");
  dispatchPointer(handle, "pointerdown", 0);
  dispatchPointer(handle, "pointermove", 200);
  dispatchPointer(handle, "pointerup");
  expect(handle.getAttribute("aria-valuenow")).toBe(before);
  const apply = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Apply figure changes",
  ) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
});

it("preserves exact placement unless changed and applies placement edits", async () => {
  const source = createVisualFigure("figures/a.png").replace("[htbp]", "[!ht]");
  const model = parseVisualFigure(source)!;
  const onSave = vi.fn();
  renderEditor({ model, onSave });
  const placement = query("Figure placement") as HTMLSelectElement;
  expect(placement.value).toBe("!ht");

  // No-op Apply emits no patches, preserving exact original bytes.
  const apply = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Apply figure changes",
  )!;
  await act(async () => apply.click());
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0]![0]).toEqual([]);

  // Changing placement emits a single placement patch.
  onSave.mockClear();
  setInputValue(placement, "h");
  await act(async () => apply.click());
  expect(onSave).toHaveBeenCalledTimes(1);
  const patches = onSave.mock.calls[0]![0] as { insert: string }[];
  expect(patches).toHaveLength(1);
  expect(patches[0]!.insert).toBe("h");
});

it("fails closed on out-of-range widths without saving", async () => {
  const model = parseVisualFigure(createVisualFigure("figures/a.png"))!;
  const onSave = vi.fn();
  renderEditor({ model, onSave });
  const number = query("Figure width percentage") as HTMLInputElement;
  // Empty maps to width 0, which bypasses native min/max but fails our bounds.
  setInputValue(number, "");
  // Dispatch submit directly to bypass native number validation and exercise
  // our bounded error path; a real blocked submit also saves nothing.
  const form = container.querySelector('form[aria-label="Figure editor"]')!;
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(onSave).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
    /width|10–100|project image/,
  );
});
