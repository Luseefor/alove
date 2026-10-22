"use client";
import React from "react";
import { useState } from "react";
import type { ProjectCiteEntry, ProjectLabelEntry } from "@alove/editor";
import {
  FIGURE_PLACEMENT_OPTIONS,
  figureDraft,
  isFigurePath,
  patchesForVisualFigure,
  safeFigureAsset,
  type VisualFigure,
} from "@/lib/visualFigure";
import {
  CITE_COMMANDS,
  REF_COMMANDS,
  patchesForVisualMath,
  patchesForVisualCitation,
  type VisualMath,
  type VisualCitation,
} from "@/lib/visualInline";
import type { VisualSourcePatch } from "@/lib/visualObjectTypes";
import { MathPreview } from "./MathPreview";
import { FigureResizePreview } from "./FigureResizePreview";
const inputClass =
  "w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const buttonClass =
  "min-h-9 rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Props = {
  onSave: (patches: VisualSourcePatch[]) => void;
  onCancel: () => void;
  disabled?: boolean;
};
function Footer({
  disabled,
  onCancel,
  label,
}: {
  disabled?: boolean;
  onCancel: () => void;
  label: string;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-border pt-4">
      <button type="button" onClick={onCancel} className={buttonClass}>
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="min-h-9 rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
      </button>
    </div>
  );
}
function ErrorText({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="text-sm text-error">
      {error}
    </p>
  ) : null;
}

export function VisualFigureEditor({
  model,
  assets,
  onSave,
  onCancel,
  onUpload,
  disabled,
}: Props & {
  model: VisualFigure;
  assets: Record<string, string>;
  onUpload: (file: File) => Promise<string>;
}) {
  const [draft, setDraft] = useState(() => figureDraft(model)),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  const preview = safeFigureAsset(assets[draft.path]);
  const placementValue = draft.placement ?? "";
  const placementOptions =
    placementValue &&
    !FIGURE_PLACEMENT_OPTIONS.includes(placementValue as never)
      ? [placementValue, ...FIGURE_PLACEMENT_OPTIONS]
      : FIGURE_PLACEMENT_OPTIONS;
  return (
    <form
      aria-label="Figure editor"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          if (!assets[draft.path])
            throw new Error("Choose an image in this project.");
          onSave(patchesForVisualFigure(model, draft));
          setError("");
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "The figure could not be updated.",
          );
        }
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FigureResizePreview
          preview={preview}
          alt={draft.caption || draft.path}
          width={draft.width}
          disabled={disabled}
          isPdf={draft.path.endsWith(".pdf")}
          onWidthChange={(width) => setDraft({ ...draft, width })}
        />
        <div className="space-y-3">
          <label className="block text-xs">
            Project image
            <select
              aria-label="Project image"
              value={draft.path}
              disabled={disabled || uploading}
              className={inputClass}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            >
              {!assets[draft.path] && (
                <option value={draft.path}>{draft.path} (missing)</option>
              )}
              {Object.keys(assets)
                .filter(isFigurePath)
                .map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-xs">
            Upload PNG, JPEG or PDF (up to 500 KB)
            <input
              aria-label="Upload figure asset"
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              disabled={disabled || uploading}
              className={inputClass}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setUploading(true);
                try {
                  const path = await onUpload(file);
                  setDraft((d) => ({ ...d, path }));
                  setError("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Upload failed.");
                } finally {
                  setUploading(false);
                  event.target.value = "";
                }
              }}
            />
          </label>
          <label className="block text-xs">
            Width: {Math.round(draft.width * 100)}% of text width
            <input
              aria-label="Figure width"
              type="range"
              min="10"
              max="100"
              value={Math.round(draft.width * 100)}
              disabled={disabled}
              className="w-full"
              onChange={(e) =>
                setDraft({ ...draft, width: Number(e.target.value) / 100 })
              }
            />
          </label>
          <input
            aria-label="Figure width percentage"
            type="number"
            min="10"
            max="100"
            value={Math.round(draft.width * 100)}
            disabled={disabled}
            className={inputClass}
            onChange={(e) =>
              setDraft({ ...draft, width: Number(e.target.value) / 100 })
            }
          />
          {model.wrapper && (
            <label className="block text-xs">
              Float placement
              <select
                aria-label="Figure placement"
                value={placementValue}
                disabled={disabled}
                className={inputClass}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    placement: e.target.value === "" ? null : e.target.value,
                  })
                }
              >
                {placementOptions.map((option) => (
                  <option key={option || "default"} value={option}>
                    {option === ""
                      ? "Default (no specifier)"
                      : option === "H"
                        ? "H (needs float package)"
                        : `[${option}]`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      {model.wrapper && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            Caption
            <input
              aria-label="Figure caption"
              value={draft.caption}
              disabled={disabled || model.caption?.text === null}
              className={inputClass}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Label
            <input
              aria-label="Figure label"
              value={draft.label}
              disabled={disabled}
              className={inputClass}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
        </div>
      )}
      <ErrorText error={error} />
      <Footer
        disabled={disabled || uploading}
        onCancel={onCancel}
        label="Apply figure changes"
      />
    </form>
  );
}

export function VisualMathEditor({
  model,
  onSave,
  onCancel,
  disabled,
}: Props & { model: VisualMath }) {
  const [tex, setTex] = useState(model.tex),
    [display, setDisplay] = useState(model.display),
    [error, setError] = useState("");
  return (
    <form
      aria-label="Equation editor"
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          onSave(patchesForVisualMath(model, { tex, display }));
          setError("");
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "The equation could not be updated.",
          );
        }
      }}
    >
      <label className="block text-xs">
        Equation LaTeX
        <textarea
          aria-label="Equation LaTeX"
          value={tex}
          disabled={disabled}
          rows={5}
          className={`${inputClass} font-mono`}
          onChange={(e) => setTex(e.target.value)}
        />
      </label>
      <div
        role="group"
        aria-label="Equation symbols"
        className="flex flex-wrap gap-2"
      >
        {["\\frac{a}{b}", "\\sqrt{x}", "\\alpha", "\\sum_{i=1}^{n}"].map(
          (symbol) => (
            <button
              key={symbol}
              type="button"
              className={buttonClass}
              disabled={disabled}
              onClick={() => setTex(tex + symbol)}
            >
              {symbol}
            </button>
          ),
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label="Display equation"
          checked={display}
          disabled={disabled || model.numbered || /\\label\b/.test(model.tex)}
          onChange={(e) => setDisplay(e.target.checked)}
        />
        Display on its own line
      </label>
      {model.numbered && (
        <p className="text-xs text-muted-foreground">
          The numbered equation environment is retained. Change numbering in
          Source.
        </p>
      )}
      <MathPreview tex={tex} display={display} />
      <ErrorText error={error} />
      <Footer
        disabled={disabled}
        onCancel={onCancel}
        label="Apply equation changes"
      />
    </form>
  );
}

export function VisualCitationEditor({
  model,
  citations,
  labels,
  onSave,
  onCancel,
  disabled,
}: Props & {
  model: VisualCitation;
  citations: ProjectCiteEntry[];
  labels: ProjectLabelEntry[];
}) {
  const [keys, setKeys] = useState(model.keys),
    [command, setCommand] = useState(model.command),
    [query, setQuery] = useState(""),
    [manual, setManual] = useState(""),
    [error, setError] = useState("");
  const entries =
    model.kind === "citation"
      ? citations.map((entry) => ({
          key: entry.key,
          description: [entry.title, entry.author, entry.year]
            .filter(Boolean)
            .join(" · "),
        }))
      : labels.map((entry) => ({
          key: entry.label,
          description: [entry.context, entry.file].filter(Boolean).join(" · "),
        }));
  const results = entries
    .filter((entry) =>
      `${entry.key} ${entry.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 100);
  return (
    <form
      aria-label={
        model.kind === "citation" ? "Citation editor" : "Reference editor"
      }
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          onSave(patchesForVisualCitation(model, { keys, command }));
          setError("");
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "The reference could not be updated.",
          );
        }
      }}
    >
      <label className="block text-xs">
        Style
        <select
          aria-label="Citation or reference style"
          value={command}
          disabled={disabled}
          className={inputClass}
          onChange={(e) => setCommand(e.target.value)}
        >
          {(model.kind === "citation" ? CITE_COMMANDS : REF_COMMANDS).map(
            (name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ),
          )}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Citation styles beyond cite, and references beyond ref, require the
        matching LaTeX package in document setup. The picker does not add
        packages.
      </p>
      <div
        role="group"
        aria-label="Selected keys"
        className="flex flex-wrap gap-2"
      >
        {keys.map((key, i) => (
          <button
            key={`${key}-${i}`}
            type="button"
            className={buttonClass}
            disabled={disabled}
            aria-label={`Remove ${key}`}
            onClick={() => setKeys(keys.filter((_, at) => i !== at))}
          >
            {key} ×
          </button>
        ))}
      </div>
      {keys.some((key) => !entries.some((entry) => entry.key === key)) && (
        <p role="status" className="text-xs text-muted-foreground">
          Some selected keys are not in the current project index. They are
          preserved until you change them.
        </p>
      )}
      <label className="block text-xs">
        Search project keys
        <input
          aria-label="Search project citations and references"
          className={inputClass}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div
        className="max-h-52 overflow-auto rounded border border-border"
        role="group"
        aria-label="Project matches"
      >
        {results.map((entry) => (
          <button
            key={entry.key}
            type="button"
            disabled={disabled || keys.includes(entry.key) || keys.length >= 20}
            onClick={() =>
              setKeys(
                model.kind === "reference" &&
                  !["cref", "Cref"].includes(command)
                  ? [entry.key]
                  : [...keys, entry.key],
              )
            }
            className="block w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="block font-medium">{entry.key}</span>
            <span className="block break-words text-xs text-muted-foreground">
              {entry.description}
            </span>
          </button>
        ))}
        {!results.length && (
          <p className="p-3 text-xs text-muted-foreground">
            No project matches. Add a bibliography or label, or enter a key
            below.
          </p>
        )}
      </div>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs">
          Key
          <input
            aria-label="Manual citation or reference key"
            value={manual}
            disabled={disabled}
            className={inputClass}
            onChange={(e) => setManual(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || !manual.trim() || keys.length >= 20}
          onClick={() => {
            setKeys(
              model.kind === "reference" && !["cref", "Cref"].includes(command)
                ? [manual.trim()]
                : [...keys, manual.trim()],
            );
            setManual("");
          }}
        >
          Add key
        </button>
      </div>
      <ErrorText error={error} />
      <Footer
        disabled={disabled}
        onCancel={onCancel}
        label={
          model.kind === "citation"
            ? "Apply citation changes"
            : "Apply reference changes"
        }
      />
    </form>
  );
}
