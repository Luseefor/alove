"use client";
import React from "react";

import {
  cloneTableDraft,
  setTableVerticalBorder,
  tableBorderPreset,
} from "@/lib/tableGrid";
import type { TableDraft, TableRule, VisualTable } from "@/lib/visualTable";
import type { TableColumn } from "@/lib/visualTableColumns";

export type TablePropertiesPanelProps = {
  panel: "columns" | "borders" | "details";
  model: VisualTable;
  draft: TableDraft;
  selectedColumn: number;
  onSelectedColumnChange: (column: number) => void;
  onChange: (update: (draft: TableDraft) => TableDraft) => void;
  disabled?: boolean;
  structureDisabled?: boolean;
};

const inputClass =
  "min-h-9 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const buttonClass =
  "min-h-9 rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function columnLetter(index: number): string {
  let name = "";
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

export function TablePropertiesPanel({
  panel,
  model,
  draft,
  selectedColumn,
  onSelectedColumnChange,
  onChange,
  disabled,
  structureDisabled,
}: TablePropertiesPanelProps) {
  const nc = draft.alignments.length;
  const safeColumn =
    nc === 0 ? 0 : Math.min(Math.max(selectedColumn, 0), nc - 1);

  if (panel === "columns") {
    const columnModel: TableColumn = draft.columns?.[safeColumn] ?? {
      kind: "natural",
      alignment: (draft.alignments[safeColumn] ??
        "l") as TableColumn["alignment"],
      width: "",
    };
    const patchColumn = (patch: Partial<TableColumn>) => {
      onChange((d) => {
        const next = cloneTableDraft(d);
        Object.assign(next.columns![safeColumn]!, patch);
        next.alignments[safeColumn] = next.columns![safeColumn]!.alignment;
        return next;
      });
    };
    return (
      <div className="mx-auto w-full max-w-2xl space-y-3">
        <label className="block text-xs">
          Selected column
          <select
            aria-label="Selected column"
            className={inputClass}
            disabled={disabled}
            value={safeColumn}
            onChange={(e) => onSelectedColumnChange(Number(e.target.value))}
          >
            {draft.alignments.map((_, c) => (
              <option key={c} value={c}>
                {columnLetter(c)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            Column {safeColumn + 1} type
            <select
              aria-label={`Column ${safeColumn + 1} type`}
              className={inputClass}
              disabled={disabled}
              value={columnModel.kind}
              onChange={(e) => {
                const kind = e.target.value as TableColumn["kind"];
                patchColumn({
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
          <label className="block text-xs">
            Column {safeColumn + 1} alignment
            <select
              aria-label={`Column ${safeColumn + 1} alignment`}
              className={inputClass}
              disabled={disabled}
              value={draft.alignments[safeColumn]}
              onChange={(e) =>
                patchColumn({
                  alignment: e.target.value as TableColumn["alignment"],
                })
              }
            >
              <option value="l">Left</option>
              <option value="c">Centre</option>
              <option value="r">Right</option>
              {columnModel.kind !== "natural" && (
                <option value="j">Justified</option>
              )}
            </select>
          </label>
          {!["natural", "X"].includes(columnModel.kind) && (
            <label className="block text-xs">
              Column {safeColumn + 1} width
              <input
                aria-label={`Column ${safeColumn + 1} width`}
                className={inputClass}
                disabled={disabled}
                value={columnModel.width}
                onChange={(e) => patchColumn({ width: e.target.value })}
              />
            </label>
          )}
          {model.tableWidth && (
            <label className="block text-xs">
              Table width
              <input
                aria-label="Table width"
                className={inputClass}
                disabled={disabled}
                value={draft.tableWidth ?? ""}
                onChange={(e) =>
                  onChange((d) => ({ ...d, tableWidth: e.target.value }))
                }
              />
            </label>
          )}
        </div>
      </div>
    );
  }

  if (panel === "borders") {
    const structural = disabled || structureDisabled;
    const rules = draft.rules ?? [];
    return (
      <div className="mx-auto w-full max-w-2xl space-y-3">
        <div className="flex flex-wrap gap-2">
          {(["none", "outer", "grid", "booktabs"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              className={buttonClass}
              disabled={structural}
              onClick={() => onChange((d) => tableBorderPreset(d, preset))}
            >
              {preset === "none"
                ? "No borders"
                : preset === "outer"
                  ? "Outer border"
                  : preset === "grid"
                    ? "All borders"
                    : "Booktabs rules"}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(draft.verticalBorders ?? []).map((border, i) => (
            <label key={i} className="block text-xs">
              Vertical boundary {i + 1}
              <select
                aria-label={`Vertical boundary ${i + 1}`}
                className={inputClass}
                disabled={structural}
                value={border}
                onChange={(e) =>
                  onChange((d) =>
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
        <div className="space-y-2">
          {rules.map((boundaryRules, i) => {
            const value =
              boundaryRules.length === 0
                ? "none"
                : boundaryRules.length === 2 &&
                    boundaryRules.every((x) => x.kind === "hline")
                  ? "double"
                  : boundaryRules.length === 1
                    ? boundaryRules[0]!.kind
                    : "custom";
            return (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="min-w-36 flex-1 text-xs">
                  Horizontal boundary {i + 1}
                  <select
                    aria-label={`Horizontal boundary ${i + 1}`}
                    className={inputClass}
                    disabled={structural}
                    value={value}
                    onChange={(e) =>
                      onChange((d) => {
                        const next = cloneTableDraft(d);
                        const kind = e.target.value;
                        next.rules![i] =
                          kind === "none"
                            ? []
                            : kind === "double"
                              ? [{ kind: "hline" }, { kind: "hline" }]
                              : kind === "cline"
                                ? [{ kind: "cline", start: 1, end: nc }]
                                : [{ kind: kind as TableRule["kind"] }];
                        return next;
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
                        disabled={structural}
                        value={boundaryRules[0]![edge]}
                        onChange={(e) =>
                          onChange((d) => {
                            const next = cloneTableDraft(d);
                            next.rules![i]![0]![edge] = Number(e.target.value);
                            return next;
                          })
                        }
                      />
                    </label>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!model.wrapper) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs text-muted-foreground">
          This table has no caption or label because it is not in a table
          environment.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          Caption
          <input
            aria-label="Table caption"
            className={inputClass}
            disabled={disabled || model.caption?.text === null}
            value={draft.caption}
            onChange={(e) =>
              onChange((d) => ({ ...d, caption: e.target.value }))
            }
          />
        </label>
        <label className="block text-xs">
          Label
          <input
            aria-label="Table label"
            className={inputClass}
            disabled={disabled}
            value={draft.label}
            onChange={(e) => onChange((d) => ({ ...d, label: e.target.value }))}
          />
        </label>
      </div>
    </div>
  );
}
