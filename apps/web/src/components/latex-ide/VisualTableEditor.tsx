"use client";
import React, { useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  Sigma,
  Code2,
  Combine,
  Ellipsis,
  Plus,
  Rows3,
  Columns3,
} from "lucide-react";
import {
  tableDraft,
  pasteTableTsv,
  patchesForVisualTable,
  longtableSectionForRow,
  type VisualTable,
  type TableDraft,
  type LongtableSection,
} from "@/lib/visualTable";
import {
  cloneTableDraft,
  tableCellAnchor,
  tableRowAnchor,
  mergeTableCells,
  mergeTableCellsVertical,
  splitTableCell,
  splitTableCellVertical,
  resizeTableGrid,
} from "@/lib/tableGrid";
import {
  encodeVisualProse,
  type VisualSourcePatch,
} from "@/lib/visualObjectTypes";
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
import { TablePropertiesPanel } from "./TablePropertiesPanel";
type Deletion = { axis: "row" | "column"; index: number };
type Panel = "cells" | "columns" | "borders" | "details";
const control =
  "min-h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const icon = "table-tool";
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
  const [throughRow, setThroughRow] = useState(1);
  const [panel, setPanel] = useState<Panel>("cells");
  const [selectedColumn, setSelectedColumn] = useState(0);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const selection = useRef({ from: 0, to: 0 });
  const nr = draft.cells.length,
    nc = draft.alignments.length;
  const rawRow = Math.min(active.row, nr - 1),
    rawCol = Math.min(active.col, nc - 1),
    col = tableCellAnchor(draft, rawRow, rawCol),
    row = tableRowAnchor(draft, rawRow, col);
  const structural = disabled || !model.structureEditable;
  const protectedCell = model.cells[row]?.[col]?.nodes === null;
  const sourceMode = !!draft.sourceCells?.[row]?.[col];
  const cellName = `${String.fromCharCode(65 + col)}${row + 1}`;
  function change(fn: (d: TableDraft) => TableDraft) {
    if (disabled) return;
    try {
      setDraft(fn(draft));
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
    const value = draft.cells[row]![col]!,
      raw = sourceMode ? value : encodeVisualProse(value);
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
  function toggleSource() {
    if (disabled || protectedCell) return;
    if (!sourceMode)
      cellValue(row, col, encodeVisualProse(draft.cells[row]![col]!), true);
    else {
      const nodes = parseTableCellContent(draft.cells[row]![col]!);
      if (!nodes) {
        setError("Fix the cell's LaTeX before switching to plain text.");
        return;
      }
      cellValue(row, col, tableCellPlainText(nodes), false);
    }
  }
  function menuToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    const menu = event.currentTarget;
    if (menu.open)
      form.current?.querySelectorAll("details[open]").forEach((other) => {
        if (other !== menu) other.removeAttribute("open");
      });
  }
  function menuBlur(event: React.FocusEvent<HTMLDetailsElement>) {
    if (
      event.relatedTarget &&
      !event.currentTarget.contains(event.relatedTarget as Node)
    )
      event.currentTarget.removeAttribute("open");
  }
  function closeMenu(event: React.MouseEvent<HTMLElement>) {
    event.currentTarget.closest("details")?.removeAttribute("open");
  }
  return (
    <form
      ref={form}
      aria-label="Table editor"
      className="visual-table-editor"
      onSubmit={(e) => {
        e.preventDefault();
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
      <nav aria-label="Table settings" className="table-editor-tabs">
        {(
          [
            ["cells", "Cells"],
            ["columns", "Columns"],
            ["borders", "Borders"],
            ["details", "Caption"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={panel === id}
            onClick={() => setPanel(id)}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
          {nr} × {nc} · {model.environment}
        </span>
      </nav>
      {panel === "cells" && (
        <div
          className="table-editor-toolbar"
          role="toolbar"
          aria-label="Cell formatting and structure"
        >
          <span
            className="table-cell-address"
            aria-label={`Selected cell ${cellName}`}
          >
            {cellName}
          </span>
          {(
            [
              { kind: "bold", label: "Bold", Icon: Bold },
              { kind: "italic", label: "Italic", Icon: Italic },
              { kind: "underline", label: "Underline", Icon: Underline },
              { kind: "math", label: "Inline math", Icon: Sigma },
            ] as const
          ).map(({ kind, label, Icon }) => (
            <button
              type="button"
              key={kind}
              className={icon}
              aria-label={label}
              title={label}
              disabled={disabled || protectedCell}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => format(kind)}
            >
              <Icon size={16} aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            className={icon}
            aria-label="Supported LaTeX cell"
            aria-pressed={sourceMode}
            title={
              sourceMode
                ? "Convert to plain text (removes formatting)"
                : "Edit supported LaTeX"
            }
            disabled={disabled || protectedCell}
            onClick={toggleSource}
          >
            <Code2 size={17} aria-hidden="true" />
          </button>
          <span className="table-tool-divider" />
          <details
            className="table-tool-menu"
            onToggle={menuToggle}
            onBlur={menuBlur}
          >
            <summary
              aria-label="Merge options"
              title="Merge and split cells"
              className={icon}
            >
              <Combine size={17} aria-hidden="true" />
            </summary>
            <div className="table-tool-popover space-y-3">
              <label className="block text-xs">
                Merge {cellName} through column
                <select
                  aria-label="Merge through column"
                  className="mt-1 min-h-9 w-full rounded border border-border bg-background px-2 text-sm"
                  disabled={structural}
                  value={Math.max(col, Math.min(through, nc - 1))}
                  onChange={(e) => setThrough(Number(e.target.value))}
                >
                  {draft.alignments.map((_, c) => (
                    <option key={c} value={c} disabled={c < col}>
                      {String.fromCharCode(65 + c)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={control}
                  disabled={structural || Math.min(through, nc - 1) <= col}
                  onClick={(e) => {
                    change((d) =>
                      mergeTableCells(d, row, col, Math.min(through, nc - 1)),
                    );
                    closeMenu(e);
                  }}
                >
                  Merge cells
                </button>
                <button
                  type="button"
                  className={control}
                  disabled={structural || (draft.spans![row]![col] ?? 1) < 2}
                  onClick={(e) => {
                    change((d) => splitTableCell(d, row, col));
                    closeMenu(e);
                  }}
                >
                  Split cell
                </button>
              </div>
              <label className="block text-xs">
                Merge {cellName} through row
                <select
                  aria-label="Merge through row"
                  className="mt-1 min-h-9 w-full rounded border border-border bg-background px-2 text-sm"
                  disabled={structural}
                  value={Math.max(row, Math.min(throughRow, nr - 1))}
                  onChange={(e) => setThroughRow(Number(e.target.value))}
                >
                  {draft.cells.map((_, r) => (
                    <option key={r} value={r} disabled={r < row}>
                      {r + 1}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={control}
                  disabled={structural || Math.min(throughRow, nr - 1) <= row}
                  onClick={(e) => {
                    change((d) =>
                      mergeTableCellsVertical(
                        d,
                        row,
                        Math.min(throughRow, nr - 1),
                        col,
                      ),
                    );
                    closeMenu(e);
                  }}
                >
                  Merge rows
                </button>
                <button
                  type="button"
                  className={control}
                  disabled={structural || (draft.rowSpans![row]![col] ?? 1) < 2}
                  onClick={(e) => {
                    change((d) => splitTableCellVertical(d, row, col));
                    closeMenu(e);
                  }}
                >
                  Split rows
                </button>
              </div>
              {!!draft.spanSpecs![row]![col] && (
                <label className="block text-xs">
                  Merged cell alignment
                  <select
                    aria-label="Merged cell alignment"
                    className="mt-1 min-h-9 w-full rounded border border-border bg-background px-2 text-sm"
                    disabled={structural}
                    value={
                      parseTableColumns(draft.spanSpecs![row]![col]!)
                        ?.columns[0]?.alignment ?? "l"
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
                      ?.kind !== "natural" && (
                      <option value="j">Justified</option>
                    )}
                  </select>
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                Merge joins the contents. Split keeps them in the first cell.
              </p>
            </div>
          </details>
          <details
            className="table-tool-menu"
            onToggle={menuToggle}
            onBlur={menuBlur}
          >
            <summary
              aria-label="Rows and columns"
              title="Rows and columns"
              className={icon}
            >
              <Ellipsis size={18} aria-hidden="true" />
            </summary>
            <div className="table-tool-popover table-row-actions">
              {(
                [
                  {
                    label: "Add row",
                    axis: "row",
                    index: nr,
                    action: "insert",
                    Icon: Rows3,
                  },
                  {
                    label: "Add column",
                    axis: "column",
                    index: nc,
                    action: "insert",
                    Icon: Columns3,
                  },
                  {
                    label: "Insert row above",
                    axis: "row",
                    index: row,
                    action: "insert",
                    Icon: Rows3,
                  },
                  {
                    label: "Insert column before",
                    axis: "column",
                    index: col,
                    action: "insert",
                    Icon: Columns3,
                  },
                  {
                    label: "Delete selected row",
                    axis: "row",
                    index: row,
                    action: "delete",
                    Icon: Rows3,
                  },
                  {
                    label: "Delete selected column",
                    axis: "column",
                    index: col,
                    action: "delete",
                    Icon: Columns3,
                  },
                  {
                    label: "Remove last row",
                    axis: "row",
                    index: nr - 1,
                    action: "delete",
                    Icon: Rows3,
                  },
                  {
                    label: "Remove last column",
                    axis: "column",
                    index: nc - 1,
                    action: "delete",
                    Icon: Columns3,
                  },
                ] as const
              ).map(({ label, axis, index, action, Icon }) => (
                <button
                  key={label}
                  type="button"
                  disabled={
                    structural ||
                    (action === "insert"
                      ? axis === "row"
                        ? nr >= 20
                        : nc >= 12
                      : axis === "row"
                        ? nr <= 1
                        : nc <= 1)
                  }
                  onClick={(e) => {
                    resize(axis, index, action);
                    closeMenu(e);
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}
      {deletion && (
        <div
          role="group"
          aria-label="Confirm table deletion"
          className="table-editor-notice"
        >
          <span>
            Delete {deletion.axis} {deletion.index + 1} and its content?
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className={control}
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
              className={control}
              onClick={() => setDeletion(null)}
            >
              Keep content
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="table-editor-notice text-error">
          {error}
        </p>
      )}
      <div className="table-editor-body">
        {panel === "cells" ? (
          <div
            className="table-editor-canvas"
            data-testid="table-editor-canvas"
          >
            {model.environment === "longtable" &&
              model.longtableMarkers?.some(Boolean) && (
                <p
                  aria-label="Repeated headers preserved"
                  className="table-editor-notice"
                >
                  Repeated sections preserved (
                  {model.longtableMarkers
                    .map((m, i) =>
                      m
                        ? `${m === "endfirsthead" ? "First head" : m === "endhead" ? "Head" : m === "endfoot" ? "Foot" : "Last foot"} after row ${i}`
                        : "",
                    )
                    .filter(Boolean)
                    .join(", ")}
                  ). Edits keep markers; structure changes need Source.
                </p>
              )}
            <div className="table-editor-grid-scroll">
              <table
                className="table-editor-grid"
                style={{ minWidth: nc > 4 ? `${nc * 104 + 36}px` : "100%" }}
              >
                <colgroup>
                  <col style={{ width: 36 }} />
                  {draft.alignments.map((_, c) => (
                    <col key={c} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th aria-label="Row numbers" />
                    {draft.alignments.map((_, c) => (
                      <th key={c}>
                        <button
                          type="button"
                          aria-label={`Edit column ${String.fromCharCode(65 + c)}`}
                          onClick={() => {
                            setSelectedColumn(c);
                            setPanel("columns");
                          }}
                        >
                          {String.fromCharCode(65 + c)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.cells.map((line, r) => (
                    <React.Fragment key={r}>
                      <tr>
                        {(() => {
                          const showSections =
                            model.environment === "longtable" &&
                            model.longtableMarkers?.some(Boolean);
                          if (!showSections)
                            return <th scope="row">{r + 1}</th>;
                          const section: LongtableSection =
                            longtableSectionForRow(model.longtableMarkers, r);
                          const label =
                            section === "firsthead"
                              ? "First head"
                              : section === "head"
                                ? "Head"
                                : section === "foot"
                                  ? "Foot"
                                  : section === "lastfoot"
                                    ? "Last foot"
                                    : "Body";
                          return (
                            <th
                              scope="row"
                              aria-label={`Row ${r + 1} ${label}`}
                              title={`Row ${r + 1} · ${label}`}
                            >
                              <span className="block leading-tight">
                                {r + 1}
                              </span>
                              <span className="block text-[10px] font-normal leading-tight text-muted-foreground">
                                {label}
                              </span>
                            </th>
                          );
                        })()}
                        {line.map((value, c) => {
                          const span = draft.spans![r]![c]!;
                          const vSpan = draft.rowSpans![r]![c]!;
                          if (span === 0 || vSpan === 0) return null;
                          const locked = model.cells[r]?.[c]?.nodes === null;
                          return (
                            <td
                              key={c}
                              colSpan={span}
                              rowSpan={vSpan > 1 ? vSpan : undefined}
                              data-active={
                                row === r && col === c ? "true" : undefined
                              }
                            >
                              <input
                                data-cell={`${r}-${c}`}
                                aria-label={`Row ${r + 1} column ${c + 1}`}
                                value={value}
                                disabled={disabled || locked}
                                title={
                                  locked
                                    ? "Custom markup · edit in Source"
                                    : value
                                }
                                onFocus={() => {
                                  setActive({ row: r, col: c });
                                  setSelectedColumn(c);
                                  setThrough(Math.min(nc - 1, c + span));
                                  setThroughRow(Math.min(nr - 1, r + vSpan));
                                }}
                              onSelect={(e) => {
                                selection.current = {
                                  from: e.currentTarget.selectionStart ?? 0,
                                  to: e.currentTarget.selectionEnd ?? 0,
                                };
                              }}
                              onChange={(e) => cellValue(r, c, e.target.value)}
                              onPaste={(e) => {
                                const value =
                                  e.clipboardData.getData("text/plain");
                                if (
                                  draft.sourceCells![r]![c] &&
                                  !/[\t\r\n]/.test(value)
                                ) {
                                  e.preventDefault();
                                  const input = e.currentTarget,
                                    a = input.selectionStart ?? 0,
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
                                if (
                                  value.length > 10000 ||
                                  /[\t\r\n]/.test(value)
                                ) {
                                  e.preventDefault();
                                  change((d) => {
                                    const next = pasteTableTsv(d, r, c, value);
                                    for (let i = 0; i < model.cells.length; i++)
                                      for (
                                        let j = 0;
                                        j < model.cells[i]!.length;
                                        j++
                                      )
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
                                else if (e.key === "ArrowDown")
                                  r2 += vSpan > 1 ? vSpan : 1;
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
                                const r3 = tableRowAnchor(draft, r2, c2);
                                const next =
                                  form.current?.querySelector<HTMLInputElement>(
                                    `[data-cell="${r3}-${c2}"]:not(:disabled)`,
                                  );
                                if (next) {
                                  e.preventDefault();
                                  next.focus();
                                  next.select();
                                }
                              }}
                            />
                            {span > 1 && (
                              <span
                                className="table-cell-span"
                                aria-label={`Spans ${span} columns`}
                              >
                                {span}
                              </span>
                            )}
                            {vSpan > 1 && (
                              <span
                                className="table-cell-span"
                                aria-label={`Spans ${vSpan} rows`}
                              >
                                {vSpan}↓
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {model.longtableMarkers?.[r + 1] && (
                      <tr key={`section-${r}`}>
                        <td
                          colSpan={nc + 1}
                          className="text-xs text-muted-foreground"
                        >
                          {model.longtableMarkers[r + 1] === "endfirsthead"
                            ? "— First head ends —"
                            : model.longtableMarkers[r + 1] === "endhead"
                              ? "— Head ends —"
                              : model.longtableMarkers[r + 1] === "endfoot"
                                ? "— Foot ends —"
                                : "— Last foot ends —"}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-canvas-actions">
              <button
                type="button"
                aria-label="Add row"
                disabled={structural || nr >= 20}
                onClick={() => resize("row", nr, "insert")}
              >
                <Plus size={14} aria-hidden="true" /> Row
              </button>
              <button
                type="button"
                aria-label="Add column"
                disabled={structural || nc >= 12}
                onClick={() => resize("column", nc, "insert")}
              >
                <Plus size={14} aria-hidden="true" /> Column
              </button>
              {nc > 4 && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Scroll for more columns →
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="table-properties-scroll">
            <TablePropertiesPanel
              panel={panel}
              model={model}
              draft={draft}
              selectedColumn={Math.min(selectedColumn, nc - 1)}
              onSelectedColumnChange={setSelectedColumn}
              onChange={change}
              disabled={disabled}
              structureDisabled={structural}
            />
          </div>
        )}
      </div>
      {panel === "cells" && (
        <div className="table-cell-preview-strip">
          <span className="shrink-0 text-xs text-muted-foreground">
            {sourceMode ? "Preview" : "Cell"}
          </span>
          <TableCellPreview
            compact
            source={
              sourceMode
                ? draft.cells[row]![col]!
                : encodeVisualProse(draft.cells[row]![col]!)
            }
          />
          {protectedCell && (
            <span className="text-xs text-muted-foreground">
              Edit custom markup in Source
            </span>
          )}
        </div>
      )}
      <div className="table-editor-footer">
        <span className="mr-auto text-xs text-muted-foreground">
          {!model.structureEditable
            ? "Custom structure · Source required"
            : sourceMode
              ? "LaTeX cell"
              : "Changes stay in this draft"}
        </span>
        <button type="button" onClick={onCancel} className={control}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={disabled || !!deletion}
          className="min-h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Apply table changes
        </button>
      </div>
    </form>
  );
}
