"use client";
import React, { useState } from "react";
import { isFigurePath, safeFigureAsset } from "@/lib/visualFigure";
import {
  patchesForVisualSubfigure,
  subfigureDraft,
  type VisualSubfigure,
} from "@/lib/visualSubfigure";
import type { VisualSourcePatch } from "@/lib/visualObjectTypes";
import { FigureResizePreview } from "./FigureResizePreview";
const field =
  "mt-1 min-h-9 w-full rounded border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export function VisualSubfigureEditor({
  model,
  assets,
  onSave,
  onCancel,
  onUpload,
  disabled,
}: {
  model: VisualSubfigure;
  assets: Record<string, string>;
  onSave: (patches: VisualSourcePatch[]) => void;
  onCancel: () => void;
  onUpload: (file: File) => Promise<string>;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(() => subfigureDraft(model));
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const order = draft.order ?? draft.panels.map((_, i) => i);
  const originalIndex = order[selected] ?? selected;
  const panel = draft.panels[originalIndex]!;
  const original = model.panels[originalIndex]!;
  const locked = disabled || uploading;
  function update(value: Partial<typeof panel>) {
    setDraft((d) => {
      const currentOrder = d.order ?? d.panels.map((_, i) => i);
      const target = currentOrder[selected] ?? selected;
      return {
        ...d,
        panels: d.panels.map((p, i) => (i === target ? { ...p, ...value } : p)),
      };
    });
  }
  function moveSelected(delta: -1 | 1) {
    if (locked) return;
    const next = selected + delta;
    if (next < 0 || next >= order.length) return;
    setDraft((d) => {
      const current = [...(d.order ?? d.panels.map((_, i) => i))];
      const atSelected = current[selected]!;
      current[selected] = current[next]!;
      current[next] = atSelected;
      return { ...d, order: current };
    });
    setSelected(next);
  }
  return (
    <form
      aria-label="Subfigure editor"
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (locked) return;
        try {
          if (draft.panels.some((p) => !assets[p.path]))
            throw new Error("Choose a project image for every panel.");
          onSave(patchesForVisualSubfigure(model, draft));
          setError("");
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Could not update subfigures.",
          );
        }
      }}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <label className="block text-xs">
          Selected panel
          <select
            aria-label="Selected figure panel"
            className={field}
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {order.map((_, i) => (
              <option key={i} value={i}>
                Panel {i + 1}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Move panel earlier"
            disabled={locked || selected <= 0}
            onClick={() => moveSelected(-1)}
            className="min-h-9 rounded border border-border px-3 text-sm disabled:opacity-40"
          >
            Move earlier
          </button>
          <button
            type="button"
            aria-label="Move panel later"
            disabled={locked || selected >= order.length - 1}
            onClick={() => moveSelected(1)}
            className="min-h-9 rounded border border-border px-3 text-sm disabled:opacity-40"
          >
            Move later
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FigureResizePreview
            preview={safeFigureAsset(assets[panel.path])}
            alt={panel.caption || panel.path}
            width={panel.envWidth}
            minimumPercent={5}
            disabled={locked}
            isPdf={panel.path.toLowerCase().endsWith(".pdf")}
            onWidthChange={(envWidth) => update({ envWidth })}
          />
          <div className="space-y-2">
            <label className="block text-xs">
              Project image
              <select
                aria-label="Panel image"
                className={field}
                disabled={locked}
                value={panel.path}
                onChange={(e) => update({ path: e.target.value })}
              >
                {!assets[panel.path] && (
                  <option value={panel.path}>{panel.path} (missing)</option>
                )}
                {Object.keys(assets)
                  .filter(isFigurePath)
                  .map((path) => (
                    <option key={path}>{path}</option>
                  ))}
              </select>
            </label>
            <label className="block text-xs">
              Upload panel image
              <input
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                aria-label="Upload panel image"
                disabled={locked}
                className={field}
                onChange={async (e) => {
                  const input = e.currentTarget,
                    file = input.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  try {
                    update({ path: await onUpload(file) });
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Upload failed.",
                    );
                  } finally {
                    setUploading(false);
                    input.value = "";
                  }
                }}
              />
            </label>
            <label className="block text-xs">
              Panel width (% of {original.envWidthUnit})
              <input
                aria-label="Panel width percentage"
                type="number"
                min={5}
                max={100}
                className={field}
                disabled={locked}
                value={Math.round(panel.envWidth * 100)}
                onChange={(e) =>
                  update({ envWidth: Number(e.target.value) / 100 })
                }
              />
            </label>
            <label className="block text-xs">
              Panel alignment
              <select
                aria-label="Panel vertical alignment"
                className={field}
                value={panel.envPosition ?? ""}
                disabled={locked}
                onChange={(e) =>
                  update({ envPosition: e.target.value || null })
                }
              >
                <option value="">Default</option>
                <option value="t">Top</option>
                <option value="c">Centre</option>
                <option value="b">Bottom</option>
              </select>
            </label>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            Panel caption
            <input
              aria-label="Panel caption"
              className={field}
              disabled={locked || original.caption?.text === null}
              value={panel.caption}
              onChange={(e) => update({ caption: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Panel label
            <input
              aria-label="Panel label"
              className={field}
              disabled={locked}
              value={panel.label}
              onChange={(e) => update({ label: e.target.value })}
            />
          </label>
        </div>
        <details className="border-t border-border pt-2 text-xs">
          <summary className="cursor-pointer">Whole figure</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label>
              Caption
              <input
                aria-label="Subfigure group caption"
                className={field}
                disabled={locked || model.caption?.text === null}
                value={draft.caption}
                onChange={(e) =>
                  setDraft({ ...draft, caption: e.target.value })
                }
              />
            </label>
            <label>
              Label
              <input
                aria-label="Subfigure group label"
                className={field}
                disabled={locked}
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
            <label>
              Placement
              <select
                aria-label="Subfigure placement"
                className={field}
                disabled={locked}
                value={draft.placement ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, placement: e.target.value || null })
                }
              >
                {[
                  ...new Set([
                    draft.placement ?? "",
                    "",
                    "htbp",
                    "!ht",
                    "t",
                    "b",
                    "p",
                    "H",
                  ]),
                ].map((value) => (
                  <option key={value} value={value}>
                    {value || "Default"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-background pt-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={locked}
          className="min-h-9 rounded border border-border px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={locked}
          className="min-h-9 rounded bg-primary px-3 text-sm text-primary-foreground disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Apply subfigure changes
        </button>
      </div>
    </form>
  );
}
