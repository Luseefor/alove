"use client";
import React, { useState } from "react";
import { isFigurePath, safeFigureAsset } from "@/lib/visualFigure";
import {
  createSubfigurePanelDraft,
  patchesForVisualSubfigure,
  subfigureDraft,
  SUBFIGURE_MAX_PANELS,
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
  usedLabels,
}: {
  model: VisualSubfigure;
  assets: Record<string, string>;
  onSave: (patches: VisualSourcePatch[]) => void;
  onCancel: () => void;
  onUpload: (file: File) => Promise<string>;
  disabled?: boolean;
  usedLabels?: string[];
}) {
  const [draft, setDraft] = useState(() => subfigureDraft(model));
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null);
  const originalCount = model.panels.length;
  const addedPanels = draft.addedPanels ?? [];
  const order = draft.order ?? draft.panels.map((_, i) => i);
  const activeId = order[selected] ?? selected;
  const isNewPanel = activeId >= originalCount;
  const addedIndex = activeId - originalCount;
  const panel = isNewPanel
    ? addedPanels[addedIndex]!
    : draft.panels[activeId]!;
  const original = isNewPanel ? null : model.panels[activeId]!;
  const unit = isNewPanel ? "textwidth" : original!.envWidthUnit;
  const locked = disabled || uploading;
  const confirming = pendingRemoveId !== null;
  const usableImageCount = Object.keys(assets).filter(isFigurePath).length;
  function cancelPending() {
    setPendingRemoveId(null);
  }
  function selectPanel(index: number) {
    setSelected(index);
    setPendingRemoveId(null);
  }
  function update(value: Partial<typeof panel>) {
    const targetId = activeId;
    setDraft((d) => {
      if (targetId >= model.panels.length) {
        const idx = targetId - model.panels.length;
        return {
          ...d,
          addedPanels: (d.addedPanels ?? []).map((p, i) =>
            i === idx ? { ...p, ...value } : p,
          ),
        };
      }
      return {
        ...d,
        panels: d.panels.map((p, i) =>
          i === targetId ? { ...p, ...value } : p,
        ),
      };
    });
  }
  function moveSelected(delta: -1 | 1) {
    if (locked) return;
    const next = selected + delta;
    if (next < 0 || next >= order.length) return;
    setPendingRemoveId(null);
    setDraft((d) => {
      const current = [...(d.order ?? d.panels.map((_, i) => i))];
      const atSelected = current[selected]!;
      current[selected] = current[next]!;
      current[next] = atSelected;
      return { ...d, order: current };
    });
    setSelected(next);
  }
  function addPanel() {
    if (locked) return;
    if (order.length >= SUBFIGURE_MAX_PANELS) return;
    setPendingRemoveId(null);
    const available = Object.keys(assets).filter(isFigurePath);
    const selectedPath = panel?.path;
    const defaultPath =
      selectedPath && isFigurePath(selectedPath) && assets[selectedPath]
        ? selectedPath
        : (available[0] ?? selectedPath);
    if (!defaultPath || !isFigurePath(defaultPath)) return;
    const used = new Set<string>([
      ...(usedLabels ?? []),
      ...draft.panels.map((p) => p.label),
      ...(draft.addedPanels ?? []).map((p) => p.label),
      draft.label,
    ]);
    const fresh = createSubfigurePanelDraft({
      path: defaultPath,
      usedLabels: used,
    });
    setDraft((d) => {
      const currentAdded = [...(d.addedPanels ?? []), fresh];
      const newId = model.panels.length + currentAdded.length - 1;
      const currentOrder = [...(d.order ?? d.panels.map((_, i) => i))];
      currentOrder.splice(selected + 1, 0, newId);
      return { ...d, addedPanels: currentAdded, order: currentOrder };
    });
    setSelected(selected + 1);
  }
  function requestRemove() {
    if (locked || order.length <= 1) return;
    setPendingRemoveId(activeId);
  }
  function confirmRemove() {
    if (locked) return;
    const removeId = pendingRemoveId;
    if (removeId === null) return;
    const displayIndex = order.indexOf(removeId);
    if (displayIndex < 0) {
      setPendingRemoveId(null);
      return;
    }
    setDraft((d) => {
      const currentOrder = [...(d.order ?? d.panels.map((_, i) => i))];
      const atDisplay = currentOrder[displayIndex];
      if (atDisplay === undefined || atDisplay !== removeId) {
        return d;
      }
      currentOrder.splice(displayIndex, 1);
      if (removeId >= model.panels.length) {
        const removeAddedIndex = removeId - model.panels.length;
        const currentAdded = (d.addedPanels ?? []).filter(
          (_, i) => i !== removeAddedIndex,
        );
        const adjusted = currentOrder.map((id) =>
          id > removeId ? id - 1 : id,
        );
        return { ...d, addedPanels: currentAdded, order: adjusted };
      }
      return { ...d, order: currentOrder };
    });
    setSelected(Math.max(0, Math.min(displayIndex, order.length - 2)));
    setPendingRemoveId(null);
  }
  return (
    <form
      aria-label="Subfigure editor"
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (locked) return;
        try {
          const activePaths = order.map((id) =>
            id < model.panels.length
              ? draft.panels[id]!.path
              : (draft.addedPanels ?? [])[id - model.panels.length]!.path,
          );
          if (activePaths.some((p) => !assets[p]))
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
            disabled={uploading}
            onChange={(e) => selectPanel(Number(e.target.value))}
          >
            {order.map((_, i) => (
              <option key={i} value={i}>
                Panel {i + 1}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
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
          <button
            type="button"
            aria-label="Add panel"
            disabled={
              locked ||
              order.length >= SUBFIGURE_MAX_PANELS ||
              usableImageCount === 0
            }
            onClick={addPanel}
            className="min-h-9 rounded border border-border px-3 text-sm disabled:opacity-40"
          >
            Add panel
          </button>
          <button
            type="button"
            aria-label="Remove panel"
            disabled={locked || order.length <= 1}
            onClick={requestRemove}
            className="min-h-9 rounded border border-border px-3 text-sm disabled:opacity-40"
          >
            Remove panel
          </button>
        </div>
        {confirming && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs">
            <span>Remove this panel?</span>
            <button
              type="button"
              aria-label="Confirm remove panel"
              disabled={locked}
              onClick={confirmRemove}
              className="min-h-9 rounded border border-error px-3 text-sm text-error disabled:opacity-40"
            >
              Confirm remove panel
            </button>
            <button
              type="button"
              aria-label="Cancel removal"
              disabled={locked}
              onClick={cancelPending}
              className="min-h-9 rounded border border-border px-3 text-sm disabled:opacity-40"
            >
              Cancel removal
            </button>
          </div>
        )}
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
                  const targetId = activeId;
                  const targetIsNew = targetId >= model.panels.length;
                  const targetAddedIndex = targetId - model.panels.length;
                  setUploading(true);
                  try {
                    const nextPath = await onUpload(file);
                    setDraft((d) => {
                      if (targetIsNew) {
                        return {
                          ...d,
                          addedPanels: (d.addedPanels ?? []).map((p, i) =>
                            i === targetAddedIndex
                              ? { ...p, path: nextPath }
                              : p,
                          ),
                        };
                      }
                      return {
                        ...d,
                        panels: d.panels.map((p, i) =>
                          i === targetId ? { ...p, path: nextPath } : p,
                        ),
                      };
                    });
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
              Panel width (% of {unit})
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
              disabled={locked || (!isNewPanel && original?.caption?.text === null)}
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
