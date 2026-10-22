"use client";
import React, { useRef, useState } from "react";
import {
  TABLE_LIMITS,
  tableDraft,
  pasteTableTsv,
  patchesForVisualTable,
  type VisualTable,
  type TableDraft,
  type TableRule,
} from "@/lib/visualTable";
import {
  cloneTableDraft,
  tableCellAnchor,
  mergeTableCells,
  splitTableCell,
  resizeTableGrid,
  tableBorderPreset,
  setTableVerticalBorder,
} from "@/lib/tableGrid";
import { encodeVisualProse } from "@/lib/visualObjectTypes";
import type { VisualSourcePatch } from "@/lib/visualObjectTypes";
import {
  formatTableCellSelection,
  parseTableCellContent,
  tableCellPlainText,
} from "@/lib/tableCellContent";
import {
  parseTableColumns,
  serializeTableColumns,
  type TableColumn,
} from "@/lib/visualTableColumns";
import { TableCellPreview } from "./TableCellPreview";
const inputClass =
  "w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const buttonClass =
  "min-h-9 rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Deletion = { axis: "row" | "column"; index: number };
export function VisualTableEditor({
  model,
  onSave,
  onCancel,
  disabled,
}: {
  model: VisualTable;
  onSave: (patches: VisualSourcePatch[]) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(() => cloneTableDraft(tableDraft(model)));
  const [error, setError] = useState("");
  const [active, setActive] = useState({ row: 0, col: 0 });
  const [through, setThrough] = useState(1);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const selection = useRef({ from: 0, to: 0 });
  const nr = draft.cells.length,
    nc = draft.alignments.length;
  const row = Math.min(active.row, nr - 1),
    col = tableCellAnchor(draft, row, Math.min(active.col, nc - 1));
  const structural = disabled || !model.structureEditable;
  const protectedCell = model.cells[row]?.[col]?.nodes === null;
  const sourceMode = !!draft.sourceCells?.[row]?.[col];
  function change(fn: (d: TableDraft) => TableDraft) {
    if (disabled) return;
    try {
      const next = fn(draft);
      setDraft(next);
      setError("");
      setDeletion(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The table could not be updated.",
      );
    }
  }
  function cellValue(r: number, c: number, value: string, raw?: boolean) {
    change((d) => {
      const n = cloneTableDraft(d);
      n.cells[r]![c] = value;
      if (raw !== undefined) n.sourceCells![r]![c] = raw;
      return n;
    });
  }
  function resize(
    axis: Deletion["axis"],
    index: number,
    action: "insert" | "delete",
  ) {
    if (structural) return;
    const content =
      axis === "row"
        ? draft.cells[index]?.some(Boolean)
        : draft.cells.some((r) => !!r[index]);
    if (action === "delete" && content) {
      setDeletion({ axis, index });
      return;
    }
    change((d) => resizeTableGrid(d, axis, index, action));
  }
  function format(kind: "bold" | "italic" | "underline" | "math") {
    if (disabled || protectedCell) return;
    const value = draft.cells[row]![col]!;
    const raw = sourceMode ? value : encodeVisualProse(value);
    const from = sourceMode
      ? selection.current.from
      : encodeVisualProse(value.slice(0, selection.current.from)).length;
    const to = sourceMode
      ? selection.current.to
      : encodeVisualProse(value.slice(0, selection.current.to)).length;
    try {
      const next = formatTableCellSelection(raw, from, to, kind);
      cellValue(row, col, next.source, true);
      requestAnimationFrame(() => {
        const input = form.current?.querySelector<HTMLInputElement>(
          `[data-cell="${row}-${col}"]`,
        );
        input?.focus();
        input?.setSelectionRange(next.from, next.to);
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Cannot format this selection.",
      );
    }
  }
  function column(c: number, patch: Partial<TableColumn>) {
    change((d) => {
      const n = cloneTableDraft(d);
      Object.assign(n.columns![c]!, patch);
      n.alignments[c] = n.columns![c]!.alignment;
      return n;
    });
  }
  return (
    <form
      ref={form}
      aria-label="Table editor"
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || deletion) return;
        try {
          onSave(patchesForVisualTable(model, draft));
          setError("");
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "The table could not be updated.",
          );
        }
      }}
    >
      <p className="text-xs text-muted-foreground">
        {model.environment} · Up to 20 rows × 12 columns. Select a cell to
        format it or merge across its row. Custom LaTeX stays in Source.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={structural || nr >= TABLE_LIMITS.rows}
          onClick={() => resize("row", nr, "insert")}
        >
          Add row
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={structural || nr <= 1}
          onClick={() => resize("row", nr - 1, "delete")}
        >
          Remove last row
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={structural || nc >= TABLE_LIMITS.columns}
          onClick={() => resize("column", nc, "insert")}
        >
          Add column
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={structural || nc <= 1}
          onClick={() => resize("column", nc - 1, "delete")}
        >
          Remove last column
        </button>
      </div>
      <div className="max-h-72 max-w-full overflow-auto rounded border border-border">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {draft.alignments.map((a, c) => (
                <th key={c} className="min-w-36 border-b border-border p-2">
                  <label className="text-xs font-normal">
                    Column {c + 1} alignment
                    <select
                      aria-label={`Column ${c + 1} alignment`}
                      className={inputClass}
                      disabled={disabled}
                      value={a}
                      onChange={(e) =>
                        column(c, {
                          alignment: e.target.value as TableColumn["alignment"],
                        })
                      }
                    >
                      <option value="l">Left</option>
                      <option value="c">Centre</option>
                      <option value="r">Right</option>
                      {draft.columns![c]!.kind !== "natural" && (
                        <option value="j">Justified</option>
                      )}
                    </select>
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.cells.map((line, r) => (
              <tr key={r}>
                {line.map((value, c) => {
                  const span = draft.spans![r]![c]!;
                  if (span === 0) return null;
                  const locked = model.cells[r]?.[c]?.nodes === null;
                  return (
                    <td
                      key={c}
                      colSpan={span}
                      className="border border-border p-1"
                    >
                      <input
                        data-cell={`${r}-${c}`}
                        aria-label={`Row ${r + 1} column ${c + 1}`}
                        className={inputClass}
                        value={value}
                        disabled={disabled || locked}
                        title={
                          locked
                            ? "Custom markup · edit in Source"
                            : draft.sourceCells![r]![c]
                              ? "Supported LaTeX cell"
                              : "Plain text cell"
                        }
                        onFocus={() => {
                          setActive({ row: r, col: c });
                          setThrough(Math.min(nc - 1, c + span));
                        }}
                        onSelect={(e) => {
                          selection.current = {
                            from: e.currentTarget.selectionStart ?? 0,
                            to: e.currentTarget.selectionEnd ?? 0,
                          };
                        }}
                        onChange={(e) => cellValue(r, c, e.target.value)}
                        onPaste={(e) => {
                          const value = e.clipboardData.getData("text/plain");
                          // Rich-source fields never interpret clipboard TeX: paste is plain prose.
                          if (
                            draft.sourceCells![r]![c] &&
                            !/[\t\r\n]/.test(value)
                          ) {
                            e.preventDefault();
                            const input = e.currentTarget;
                            const a = input.selectionStart ?? 0,
                              b = input.selectionEnd ?? a;
                            cellValue(
                              r,
                              c,
                              input.value.slice(0, a) +
                                encodeVisualProse(value) +
                                input.value.slice(b),
                            );
                            return;
                          }
                          if (value.length > 10000 || /[\t\r\n]/.test(value)) {
                            e.preventDefault();
                            change((d) => {
                              const next = pasteTableTsv(d, r, c, value);
                              for (let i = 0; i < model.cells.length; i++)
                                for (let j = 0; j < model.cells[i]!.length; j++)
                                  if (
                                    model.cells[i]![j]!.nodes === null &&
                                    next.cells[i]?.[j] !== d.cells[i]?.[j]
                                  )
                                    throw new Error(
                                      "Paste crosses a custom cell. Edit it in Source.",
                                    );
                              if (
                                !model.structureEditable &&
                                (next.cells.length !== d.cells.length ||
                                  next.alignments.length !==
                                    d.alignments.length)
                              )
                                throw new Error(
                                  "Resize this custom table in Source.",
                                );
                              return next;
                            });
                          }
                        }}
                        onKeyDown={(e) => {
                          let r2 = r,
                            c2 = c;
                          if (e.key === "ArrowUp") r2--;
                          else if (e.key === "ArrowDown") r2++;
                          else if (
                            e.key === "ArrowLeft" &&
                            e.currentTarget.selectionStart === 0
                          )
                            c2--;
                          else if (
                            e.key === "ArrowRight" &&
                            e.currentTarget.selectionEnd === value.length
                          )
                            c2 += span;
                          else return;
                          c2 = tableCellAnchor(draft, r2, c2);
                          const next =
                            form.current?.querySelector<HTMLInputElement>(
                              `[data-cell="${r2}-${c2}"]:not(:disabled)`,
                            );
                          if (next) {
                            e.preventDefault();
                            next.focus();
                            next.select();
                          }
                        }}
                      />
                      {span > 1 && (
                        <span className="px-2 text-xs text-muted-foreground">
                          Spans {span} columns
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset
        className="space-y-2 rounded border border-border p-3"
        disabled={disabled || protectedCell}
      >
        <legend className="px-1 text-sm">
          Selected cell: row {row + 1}, column {col + 1}
        </legend>
        <div className="flex flex-wrap items-center gap-2">
          {(["bold", "italic", "underline", "math"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={buttonClass}
              onClick={() => format(kind)}
            >
              {kind === "math"
                ? "Inline math"
                : kind[0]!.toUpperCase() + kind.slice(1)}
            </button>
          ))}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={sourceMode}
              onChange={(e) => {
                if (e.target.checked)
                  cellValue(
                    row,
                    col,
                    encodeVisualProse(draft.cells[row]![col]!),
                    true,
                  );
                else {
                  const nodes = parseTableCellContent(draft.cells[row]![col]!);
                  if (!nodes) {
                    setError(
                      "Fix the supported LaTeX before converting to plain text.",
                    );
                    return;
                  }
                  cellValue(row, col, tableCellPlainText(nodes), false);
                }
              }}
            />
            Supported LaTeX cell
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Select text in the cell, then apply formatting. LaTeX mode supports
          textbf, textit, underline, newline and inline math. Switching to plain
          text removes formatting and keeps its text.
        </p>
        <TableCellPreview
          source={
            sourceMode
              ? draft.cells[row]![col]!
              : encodeVisualProse(draft.cells[row]![col]!)
          }
        />
      </fieldset>
      <fieldset
        disabled={structural}
        className="space-y-3 rounded border border-border p-3"
      >
        <legend className="px-1 text-sm">Merge and structure</legend>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            Merge through column
            <select
              aria-label="Merge through column"
              className={inputClass}
              value={Math.max(col, Math.min(through, nc - 1))}
              onChange={(e) => setThrough(Number(e.target.value))}
            >
              {draft.alignments.map((_, c) => (
                <option key={c} value={c} disabled={c < col}>
                  {c + 1}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={buttonClass}
            disabled={structural || through <= col}
            onClick={() =>
              change((d) =>
                mergeTableCells(d, row, col, Math.min(through, nc - 1)),
              )
            }
          >
            Merge cells
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={structural || (draft.spans![row]![col] ?? 1) < 2}
            onClick={() => change((d) => splitTableCell(d, row, col))}
          >
            Split cell
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Merging joins content with spaces. Splitting keeps all content in the
          first cell.
        </p>
        {!!draft.spanSpecs![row]![col] && (
          <label className="block text-xs">
            Merged cell alignment
            <select
              aria-label="Merged cell alignment"
              className={inputClass}
              value={
                parseTableColumns(draft.spanSpecs![row]![col]!)?.columns[0]
                  ?.alignment ?? "l"
              }
              onChange={(e) =>
                change((d) => {
                  const n = cloneTableDraft(d),
                    spec = parseTableColumns(n.spanSpecs![row]![col]!)!;
                  spec.columns[0]!.alignment = e.target
                    .value as TableColumn["alignment"];
                  n.spanSpecs![row]![col] = serializeTableColumns(
                    spec.columns,
                    spec.borders,
                  );
                  return n;
                })
              }
            >
              <option value="l">Left</option>
              <option value="c">Centre</option>
              <option value="r">Right</option>
              {parseTableColumns(draft.spanSpecs![row]![col]!)?.columns[0]
                ?.kind !== "natural" && <option value="j">Justified</option>}
            </select>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={structural || nr >= 20}
            onClick={() => resize("row", row, "insert")}
          >
            Insert row above
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={structural || nr <= 1}
            onClick={() => resize("row", row, "delete")}
          >
            Delete selected row
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={structural || nc >= 12}
            onClick={() => resize("column", col, "insert")}
          >
            Insert column before
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={structural || nc <= 1}
            onClick={() => resize("column", col, "delete")}
          >
            Delete selected column
          </button>
        </div>
      </fieldset>
      {deletion && (
        <div
          role="group"
          aria-label="Confirm table deletion"
          className="space-y-2 rounded border border-error p-3"
        >
          <p className="text-sm">
            Delete {deletion.axis} {deletion.index + 1} and its cell content?
            Apply commits this deletion; Cancel keeps the original table.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={disabled}
              onClick={() =>
                change((d) =>
                  resizeTableGrid(
                    d,
                    deletion.axis,
                    deletion.index,
                    "delete",
                    true,
                  ),
                )
              }
            >
              Confirm deletion
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setDeletion(null)}
            >
              Keep content
            </button>
          </div>
        </div>
      )}
      <details className="rounded border border-border p-3">
        <summary className="cursor-pointer text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Column widths and wrapping
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {draft.columns!.map((columnModel, c) => (
            <div key={c} className="space-y-2">
              <label className="block text-xs">
                Column {c + 1} type
                <select
                  aria-label={`Column ${c + 1} type`}
                  disabled={disabled}
                  className={inputClass}
                  value={columnModel.kind}
                  onChange={(e) => {
                    const kind = e.target.value as TableColumn["kind"];
                    column(c, {
                      kind,
                      width: columnModel.width || "3cm",
                      alignment:
                        kind === "natural"
                          ? columnModel.alignment === "j"
                            ? "l"
                            : columnModel.alignment
                          : columnModel.alignment,
                    });
                  }}
                >
                  <option value="natural">Natural width</option>
                  <option value="p">Wrap, top aligned</option>
                  <option value="m">Wrap, middle aligned</option>
                  <option value="b">Wrap, bottom aligned</option>
                  {model.environment === "tabularx" && (
                    <option value="X">Flexible X</option>
                  )}
                </select>
              </label>
              {!["natural", "X"].includes(columnModel.kind) && (
                <label className="block text-xs">
                  Width
                  <input
                    aria-label={`Column ${c + 1} width`}
                    className={inputClass}
                    disabled={disabled}
                    value={columnModel.width}
                    onChange={(e) => column(c, { width: e.target.value })}
                  />
                </label>
              )}
            </div>
          ))}
          {model.tableWidth && (
            <label className="text-xs">
              Table width
              <input
                aria-label="Table width"
                className={inputClass}
                disabled={disabled}
                value={draft.tableWidth}
                onChange={(e) =>
                  change((d) => ({ ...d, tableWidth: e.target.value }))
                }
              />
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            Widths accept dimensions such as 3cm or 0.25\textwidth.
            Middle/bottom alignment and custom wrapping alignment need array;
            required setup is added only with your consent.
          </p>
        </div>
      </details>
      <details className="rounded border border-border p-3">
        <summary className="cursor-pointer text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Borders and rules
        </summary>
        <fieldset disabled={structural} className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["none", "outer", "grid", "booktabs"] as const).map((p) => (
              <button
                type="button"
                key={p}
                className={buttonClass}
                onClick={() => change((d) => tableBorderPreset(d, p))}
              >
                {p === "none"
                  ? "No borders"
                  : p === "outer"
                    ? "Outer border"
                    : p === "grid"
                      ? "All borders"
                      : "Booktabs rules"}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {draft.verticalBorders!.map((b, i) => (
              <label key={i} className="text-xs">
                Vertical boundary {i + 1}
                <select
                  aria-label={`Vertical boundary ${i + 1}`}
                  className={inputClass}
                  value={b}
                  onChange={(e) =>
                    change((d) =>
                      setTableVerticalBorder(d, i, Number(e.target.value)),
                    )
                  }
                >
                  <option value={0}>None</option>
                  <option value={1}>Single</option>
                  <option value={2}>Double</option>
                </select>
              </label>
            ))}
          </div>
          {draft.rules!.map((rules, i) => {
            const value =
              rules.length === 0
                ? "none"
                : rules.length === 2 && rules.every((x) => x.kind === "hline")
                  ? "double"
                  : rules.length === 1
                    ? rules[0]!.kind
                    : "custom";
            return (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="min-w-36 text-xs">
                  Horizontal boundary {i + 1}
                  <select
                    aria-label={`Horizontal boundary ${i + 1}`}
                    className={inputClass}
                    value={value}
                    onChange={(e) =>
                      change((d) => {
                        const n = cloneTableDraft(d),
                          kind = e.target.value;
                        n.rules![i] =
                          kind === "none"
                            ? []
                            : kind === "double"
                              ? [{ kind: "hline" }, { kind: "hline" }]
                              : kind === "cline"
                                ? [{ kind: "cline", start: 1, end: nc }]
                                : [{ kind: kind as TableRule["kind"] }];
                        return n;
                      })
                    }
                  >
                    <option value="none">None</option>
                    <option value="hline">Single</option>
                    <option value="double">Double</option>
                    <option value="toprule">Booktabs top</option>
                    <option value="midrule">Booktabs middle</option>
                    <option value="bottomrule">Booktabs bottom</option>
                    <option value="cline">Partial rule</option>
                    {value === "custom" && (
                      <option value="custom" disabled>
                        Existing combined rules
                      </option>
                    )}
                  </select>
                </label>
                {value === "cline" &&
                  (["start", "end"] as const).map((edge) => (
                    <label key={edge} className="w-24 text-xs">
                      {edge === "start" ? "From column" : "To column"}
                      <input
                        aria-label={`Boundary ${i + 1} ${edge} column`}
                        type="number"
                        min={1}
                        max={nc}
                        className={inputClass}
                        value={rules[0]![edge]}
                        onChange={(e) =>
                          change((d) => {
                            const n = cloneTableDraft(d);
                            n.rules![i]![0]![edge] = Number(e.target.value);
                            return n;
                          })
                        }
                      />
                    </label>
                  ))}
              </div>
            );
          })}
        </fieldset>
      </details>
      {!model.structureEditable && (
        <p className="text-xs text-muted-foreground">
          {model.structureReason} Cell edits and column settings preserve the
          remaining source. Change custom structure in Source.
        </p>
      )}
      {model.wrapper && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            Caption
            <input
              aria-label="Table caption"
              className={inputClass}
              value={draft.caption}
              disabled={disabled || model.caption?.text === null}
              onChange={(e) =>
                change((d) => ({ ...d, caption: e.target.value }))
              }
            />
          </label>
          <label className="text-xs">
            Label
            <input
              aria-label="Table label"
              className={inputClass}
              value={draft.label}
              disabled={disabled}
              onChange={(e) => change((d) => ({ ...d, label: e.target.value }))}
            />
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-background py-3">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={disabled || !!deletion}
          className="min-h-9 rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Apply table changes
        </button>
      </div>
    </form>
  );
}
