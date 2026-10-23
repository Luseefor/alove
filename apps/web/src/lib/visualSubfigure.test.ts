import { describe, expect, it } from "vitest";
import {
  createSubfigurePanelDraft,
  createVisualSubfigure,
  isSafeSubfigureSeparatorForCountChange,
  parseVisualSubfigure,
  patchesForVisualSubfigure,
  requiredSubfigurePackages,
  subfigureDraft,
  uniqueSubfigurePanelLabel,
  SUBFIGURE_MAX_PANELS,
  SUBFIGURE_NEW_PANEL_WIDTH,
} from "./visualSubfigure";
import { applyVisualSourcePatches as apply } from "./visualObjects";
import { isFigurePath } from "./visualFigure";

const TWO_PANEL =
  "\\begin{figure}[htbp]\n\\centering\n" +
  "\\begin{subfigure}[b]{0.48\\textwidth}\n\\centering\n" +
  "\\includegraphics[width=\\linewidth]{\\detokenize{figures/a.png}}\n" +
  "\\caption{First}\n\\label{fig:a}\n\\end{subfigure}\n\\hfill\n" +
  "\\begin{subfigure}[b]{0.48\\textwidth}\n\\centering\n" +
  "\\includegraphics[width=\\linewidth]{\\detokenize{figures/b.png}}\n" +
  "\\caption{Second}\n\\label{fig:b}\n\\end{subfigure}\n" +
  "\\caption{Main}\n\\label{fig:main}\n\\end{figure}";

describe("visual subfigures", () => {
  it("returns no patches for an untouched draft, preserving exact bytes", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    expect(model.kind).toBe("subfigure");
    expect(model.panels).toHaveLength(2);
    expect(model.placement).toBe("htbp");
    expect(model.panels[0]!.envPosition).toBe("b");
    expect(model.panels[0]!.envWidth).toBe(0.48);
    expect(model.panels[0]!.graphicWidth).toBe(1);
    expect(patchesForVisualSubfigure(model, subfigureDraft(model))).toEqual([]);
    expect(
      apply(TWO_PANEL, patchesForVisualSubfigure(model, subfigureDraft(model))),
    ).toBe(TWO_PANEL);
  });

  it("preserves CRLF and placement on no-op", () => {
    const source = TWO_PANEL.replace(/\n/g, "\r\n").replace("[htbp]", "[!ht]");
    const model = parseVisualSubfigure(source)!;
    expect(model.placement).toBe("!ht");
    expect(model.eol).toBe("\r\n");
    expect(patchesForVisualSubfigure(model, subfigureDraft(model))).toEqual([]);
    expect(
      apply(source, patchesForVisualSubfigure(model, subfigureDraft(model))),
    ).toBe(source);
  });

  it("patches panel widths, keeping units and separators", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const draft = subfigureDraft(model);
    draft.panels[0]!.envWidth = 0.4;
    draft.panels[1]!.envWidth = 0.55;
    const result = apply(TWO_PANEL, patchesForVisualSubfigure(model, draft));
    expect(result).toBe(
      TWO_PANEL.replace("0.48\\textwidth", "0.4\\textwidth").replace(
        "0.48\\textwidth",
        "0.55\\textwidth",
      ),
    );
    expect(result).toContain("\\hfill");
  });

  it("edits panel and main captions without touching labels or placement", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const draft = subfigureDraft(model);
    draft.panels[0]!.caption = "Alpha & beta";
    draft.caption = "Main 50%";
    const result = apply(TWO_PANEL, patchesForVisualSubfigure(model, draft));
    expect(result).toContain("\\caption{Alpha \\& beta}");
    expect(result).toContain("\\caption{Main 50\\%}");
    expect(result).toContain("\\label{fig:a}");
    expect(result).toContain("\\label{fig:main}");
    expect(result).toContain("[htbp]");
  });

  it("changes, removes and adds outer placement", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const changed = subfigureDraft(model);
    changed.placement = "!ht";
    expect(apply(TWO_PANEL, patchesForVisualSubfigure(model, changed))).toBe(
      TWO_PANEL.replace("[htbp]", "[!ht]"),
    );
    const removed = subfigureDraft(model);
    removed.placement = null;
    expect(apply(TWO_PANEL, patchesForVisualSubfigure(model, removed))).toBe(
      TWO_PANEL.replace("[htbp]", ""),
    );
  });

  it("sets, replaces and removes inner graphic widths", () => {
    const bare = TWO_PANEL.replace(
      "[width=\\linewidth]{\\detokenize{figures/a.png}}",
      "{figures/a.png}",
    );
    const model = parseVisualSubfigure(bare)!;
    expect(model.panels[0]!.graphicWidth).toBeNull();
    const added = subfigureDraft(model);
    added.panels[0]!.graphicWidth = 0.9;
    expect(apply(bare, patchesForVisualSubfigure(model, added))).toBe(
      bare.replace(
        "\\includegraphics{figures/a.png}",
        "\\includegraphics[width=0.9\\linewidth]{figures/a.png}",
      ),
    );
    const full = subfigureDraft(parseVisualSubfigure(TWO_PANEL)!);
    full.panels[0]!.graphicWidth = 0.9;
    expect(
      apply(
        TWO_PANEL,
        patchesForVisualSubfigure(parseVisualSubfigure(TWO_PANEL)!, full),
      ),
    ).toContain("[width=0.9\\linewidth]");
    const removed = subfigureDraft(parseVisualSubfigure(TWO_PANEL)!);
    removed.panels[0]!.graphicWidth = null;
    expect(
      apply(
        TWO_PANEL,
        patchesForVisualSubfigure(parseVisualSubfigure(TWO_PANEL)!, removed),
      ),
    ).toContain("\\includegraphics{\\detokenize{figures/a.png}}");
  });

  it("adds missing panel and main captions with document EOL", () => {
    const source = createVisualSubfigure(
      ["figures/a.png", "figures/b.png"],
      "\r\n",
    );
    const model = parseVisualSubfigure(source)!;
    const draft = subfigureDraft(model);
    draft.panels[0]!.caption = "A";
    draft.caption = "Main";
    const result = apply(source, patchesForVisualSubfigure(model, draft));
    expect(result).toContain("\\caption{A}\r\n");
    expect(result).toContain("\\caption{Main}\r\n");
    expect(result).toContain("\r\n");
  });

  it("fails closed on unsafe widths, positions, placements and paths", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    for (const envWidth of [0.04, 1.01, Number.NaN]) {
      const draft = subfigureDraft(model);
      draft.panels[0]!.envWidth = envWidth;
      expect(() => patchesForVisualSubfigure(model, draft)).toThrow(/5–100/);
    }
    for (const graphicWidth of [0.09, 1.01]) {
      const draft = subfigureDraft(model);
      draft.panels[0]!.graphicWidth = graphicWidth;
      expect(() => patchesForVisualSubfigure(model, draft)).toThrow(/10–100/);
    }
    for (const placement of ["foo", "htbp,x"]) {
      const draft = subfigureDraft(model);
      draft.placement = placement;
      expect(() => patchesForVisualSubfigure(model, draft)).toThrow();
    }
    {
      const draft = subfigureDraft(model);
      draft.panels[1]!.envPosition = "x";
      expect(() => patchesForVisualSubfigure(model, draft)).toThrow();
    }
    {
      const draft = subfigureDraft(model);
      draft.panels[0]!.path = "../evil.png";
      expect(() => patchesForVisualSubfigure(model, draft)).toThrow();
    }
    {
      const draft = subfigureDraft(model);
      draft.panels = [draft.panels[0]!];
      expect(() => patchesForVisualSubfigure(model, draft)).toThrow();
    }
  });

  it("fails closed on custom structures, keeping them Source-only", () => {
    for (const source of [
      TWO_PANEL.replace("[b]{0.48", "[b]{0.48cm"),
      TWO_PANEL.replace("\\hfill", "\\hspace{\\fill}"),
      TWO_PANEL.replace("\\caption{First}", "\\subcaption{First}"),
      TWO_PANEL.replace(
        "\\begin{subfigure}[b]{0.48\\textwidth}",
        "\\begin{subfigure}[b]{0.48\\textwidth}\\custom{x}",
      ),
      TWO_PANEL.replace(
        "\\end{subfigure}\n\\hfill",
        "\\end{subfigure}\nSome text\n\\hfill",
      ),
      TWO_PANEL.replace("\\caption{Main}", "\\caption*{Main}"),
      "\\begin{figure}\n\\includegraphics{figures/a.png}\n\\end{figure}",
      TWO_PANEL.replace(
        "\\end{subfigure}\n\\caption{Main}",
        "\\end{subfigure}\n\\begin{subfigure}[b]{0.3\\textwidth}\n" +
          "\\includegraphics{figures/c.png}\n\\end{subfigure}\n" +
          "\\begin{subfigure}[b]{0.3\\textwidth}\n" +
          "\\includegraphics{figures/d.png}\n\\end{subfigure}\n" +
          "\\begin{subfigure}[b]{0.3\\textwidth}\n" +
          "\\includegraphics{figures/e.png}\n\\end{subfigure}\n" +
          "\\caption{Main}",
      ),
    ])
      expect(parseVisualSubfigure(source), source.slice(0, 60)).toBeNull();
    expect(SUBFIGURE_MAX_PANELS).toBe(4);
  });

  it("roundtrips created figures and uses absolute offsets", () => {
    const created = createVisualSubfigure(["figures/a.png", "figures/b.png"]);
    const model = parseVisualSubfigure(created)!;
    expect(model.panels).toHaveLength(2);
    expect(patchesForVisualSubfigure(model, subfigureDraft(model))).toEqual([]);
    const prefix = "Hello\n\n";
    const source = `${prefix}${created}\n\nWorld`;
    const shifted = parseVisualSubfigure(created, prefix.length)!;
    const draft = subfigureDraft(shifted);
    draft.panels[0]!.envWidth = 0.4;
    const patches = patchesForVisualSubfigure(shifted, draft);
    expect(patches).toHaveLength(1);
    expect(apply(source, patches)).toBe(
      source.replace("0.48\\textwidth", "0.4\\textwidth"),
    );
  });

  it("requires graphicx and subcaption always and float only for H", () => {
    const model = parseVisualSubfigure(
      createVisualSubfigure(["figures/a.png", "figures/b.png"]),
    )!;
    expect(requiredSubfigurePackages(model)).toEqual([
      "graphicx",
      "subcaption",
    ]);
    expect(requiredSubfigurePackages({ ...model, placement: "H" })).toEqual([
      "graphicx",
      "subcaption",
      "float",
    ]);
  });

  it("swaps panels preserving exact bytes and separator slots", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const draft = subfigureDraft(model);
    draft.order = [1, 0];
    const patches = patchesForVisualSubfigure(model, draft);
    expect(patches.length).toBeGreaterThan(0);
    const result = apply(TWO_PANEL, patches);
    const blockA = TWO_PANEL.slice(
      model.panels[0]!.panelFrom - model.from,
      model.panels[0]!.panelTo - model.from,
    );
    const blockB = TWO_PANEL.slice(
      model.panels[1]!.panelFrom - model.from,
      model.panels[1]!.panelTo - model.from,
    );
    const separator = TWO_PANEL.slice(
      model.panels[0]!.panelTo - model.from,
      model.panels[1]!.panelFrom - model.from,
    );
    expect(separator).toContain("\\hfill");
    expect(result).toContain(`${blockB}${separator}${blockA}`);
    expect(result.indexOf("figures/b.png")).toBeLessThan(
      result.indexOf("figures/a.png"),
    );
    expect(result).toContain("\\caption{Main}");
    expect(result).toContain("\\label{fig:main}");
    expect(result).toContain("[htbp]");
    // Separators stay in their slots exactly once.
    expect(result.split("\\hfill").length - 1).toBe(1);
  });

  it("treats missing or identity order as a no-op with minimal patches", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const identity = subfigureDraft(model);
    identity.order = [0, 1];
    expect(patchesForVisualSubfigure(model, identity)).toEqual([]);
    const missing = subfigureDraft(model);
    delete (missing as { order?: number[] }).order;
    expect(patchesForVisualSubfigure(model, missing)).toEqual([]);
    const reversed = subfigureDraft(model);
    reversed.order = [1, 0];
    expect(patchesForVisualSubfigure(model, reversed).length).toBeGreaterThan(
      0,
    );
    const back = subfigureDraft(model);
    back.order = [0, 1];
    expect(patchesForVisualSubfigure(model, back)).toEqual([]);
  });

  it("applies concurrent edits to the original panel before moving it", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const draft = subfigureDraft(model);
    draft.panels[0]!.caption = "Alpha";
    draft.panels[0]!.envWidth = 0.4;
    draft.order = [1, 0];
    const result = apply(TWO_PANEL, patchesForVisualSubfigure(model, draft));
    // Edited original panel 0 moves to the second slot.
    const secondHalf = result.slice(result.indexOf("figures/a.png") - 200);
    expect(secondHalf).toContain("\\caption{Alpha}");
    expect(secondHalf).toContain("{0.4\\textwidth}");
    // Unedited original panel 1 moves to the first slot unchanged.
    const firstHalf = result.slice(0, result.indexOf("figures/a.png"));
    expect(firstHalf).toContain("figures/b.png");
    expect(firstHalf).toContain("\\caption{Second}");
    expect(result).toContain("\\hfill");
  });

  it("rejects duplicate, out-of-range and misshapen permutations", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    for (const order of [[0, 0], [1, 1], [0, 2], [-1, 1], [0, 1, 2]]) {
      const draft = subfigureDraft(model);
      draft.order = order;
      expect(() => patchesForVisualSubfigure(model, draft)).toThrow(
        /order/i,
      );
    }
    for (const order of [[], [0, 1, 2, 3, 4]]) {
      const draft = subfigureDraft(model);
      draft.order = order;
      expect(() => patchesForVisualSubfigure(model, draft)).toThrow(
        /one to four/i,
      );
    }
  });

  it("preserves existing duplicate labels on no-op and reorder", () => {
    const dup = TWO_PANEL.replace("\\label{fig:b}", "\\label{fig:a}");
    const model = parseVisualSubfigure(dup)!;
    expect(model.panels[0]!.label?.value).toBe("fig:a");
    expect(model.panels[1]!.label?.value).toBe("fig:a");
    expect(patchesForVisualSubfigure(model, subfigureDraft(model))).toEqual(
      [],
    );
    const reordered = subfigureDraft(model);
    reordered.order = [1, 0];
    const result = apply(dup, patchesForVisualSubfigure(model, reordered));
    expect(result.indexOf("figures/b.png")).toBeLessThan(
      result.indexOf("figures/a.png"),
    );
    const changed = subfigureDraft(model);
    changed.panels[1]!.label = "fig:a";
    expect(() => patchesForVisualSubfigure(model, changed)).not.toThrow();
    const newlyDup = subfigureDraft(model);
    newlyDup.panels[1]!.label = "fig:main";
    expect(() => patchesForVisualSubfigure(model, newlyDup)).toThrow(
      /unique/i,
    );
  });

  it("preserves CRLF and nonzero offsets when reordering", () => {
    const source = TWO_PANEL.replace(/\n/g, "\r\n");
    const model = parseVisualSubfigure(source)!;
    expect(model.eol).toBe("\r\n");
    const draft = subfigureDraft(model);
    draft.order = [1, 0];
    const result = apply(source, patchesForVisualSubfigure(model, draft));
    expect(result).toContain("\r\n\\begin{subfigure}");
    expect(result.replace(/\r\n/g, "")).not.toContain("\n");
    expect(result.indexOf("figures/b.png")).toBeLessThan(
      result.indexOf("figures/a.png"),
    );
    expect(result).toContain("\r\n\\hfill\r\n");

    const prefix = "Hello\r\n\r\n";
    const full = `${prefix}${source}\r\nWorld`;
    const shifted = parseVisualSubfigure(source, prefix.length)!;
    const shiftedDraft = subfigureDraft(shifted);
    shiftedDraft.order = [1, 0];
    const shiftedPatches = patchesForVisualSubfigure(shifted, shiftedDraft);
    const expectedInner = apply(
      source,
      patchesForVisualSubfigure(parseVisualSubfigure(source)!, {
        ...subfigureDraft(parseVisualSubfigure(source)!),
        order: [1, 0],
      }),
    );
    expect(apply(full, shiftedPatches)).toBe(
      `${prefix}${expectedInner}\r\nWorld`,
    );
    // Offsets stay absolute.
    for (const patch of shiftedPatches) {
      expect(patch.from).toBeGreaterThanOrEqual(prefix.length);
    }
  });

  it("retains custom panel markup, comments and separators on reorder", () => {
    const custom = TWO_PANEL.replace(
      "\\centering\n\\includegraphics[width=\\linewidth]{\\detokenize{figures/a.png}}",
      "\\centering\n% panel comment\n\\includegraphics[width=\\linewidth]{\\detokenize{figures/a.png}}",
    ).replace("\\caption{First}", "\\caption{\\textbf{First}}");
    const model = parseVisualSubfigure(custom)!;
    expect(model.panels[0]!.caption?.text).toBeNull();
    const draft = subfigureDraft(model);
    draft.order = [1, 0];
    const result = apply(custom, patchesForVisualSubfigure(model, draft));
    expect(result).toContain("% panel comment");
    expect(result).toContain("\\caption{\\textbf{First}}");
    expect(result).toContain("\\hfill");
    expect(result.indexOf("figures/b.png")).toBeLessThan(
      result.indexOf("figures/a.png"),
    );
  });

  it("keeps group metadata untouched unless edited alongside reorder", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const untouched = subfigureDraft(model);
    untouched.order = [1, 0];
    const plain = apply(TWO_PANEL, patchesForVisualSubfigure(model, untouched));
    expect(plain).toContain("\\caption{Main}");
    expect(plain).toContain("\\label{fig:main}");
    expect(plain).toContain("[htbp]");

    const edited = subfigureDraft(model);
    edited.order = [1, 0];
    edited.caption = "Grouped";
    edited.placement = "!ht";
    const result = apply(TWO_PANEL, patchesForVisualSubfigure(model, edited));
    expect(result).toContain("\\caption{Grouped}");
    expect(result).toContain("[!ht]");
    expect(result.indexOf("figures/b.png")).toBeLessThan(
      result.indexOf("figures/a.png"),
    );
  });

  it("adds a panel with defaults and removes back to a no-op", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    expect(SUBFIGURE_NEW_PANEL_WIDTH).toBe(0.45);
    const fresh = createSubfigurePanelDraft({
      path: "figures/c.png",
      usedLabels: ["fig:a", "fig:b", "fig:main"],
    });
    expect(fresh.envWidth).toBe(0.45);
    expect(fresh.envPosition).toBe("b");
    expect(isFigurePath(fresh.path)).toBe(true);
    expect(uniqueSubfigurePanelLabel(["fig:new-panel"])).toBe(
      "fig:new-panel-1",
    );
    const draft = subfigureDraft(model);
    draft.addedPanels = [fresh];
    draft.order = [0, 1, 2];
    const added = apply(TWO_PANEL, patchesForVisualSubfigure(model, draft));
    expect(added).toContain("figures/c.png");
    expect(added).toContain("{0.45\\textwidth}");
    expect(added).toContain(fresh.label);
    // Original widths untouched.
    expect(added).toContain("{0.48\\textwidth}");
    // Removing the new panel restores the original source exactly.
    const removed = subfigureDraft(model);
    removed.addedPanels = [fresh];
    removed.order = [0, 1];
    expect(apply(TWO_PANEL, patchesForVisualSubfigure(model, removed))).toBe(
      TWO_PANEL,
    );
    expect(patchesForVisualSubfigure(model, subfigureDraft(model))).toEqual(
      [],
    );
  });

  it("removes an original panel and keeps exact surviving blocks", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const draft = subfigureDraft(model);
    draft.order = [1];
    const result = apply(TWO_PANEL, patchesForVisualSubfigure(model, draft));
    expect(result).toContain("figures/b.png");
    expect(result).not.toContain("figures/a.png");
    expect(result).toContain("\\caption{Main}");
    expect(result).toContain("\\label{fig:main}");
    expect(result.slice(0, result.indexOf("\\begin{subfigure}"))).toBe(
      TWO_PANEL.slice(0, TWO_PANEL.indexOf("\\begin{subfigure}")),
    );
    expect(result.slice(result.lastIndexOf("\\end{subfigure}") + 16)).toBe(
      TWO_PANEL.slice(TWO_PANEL.lastIndexOf("\\end{subfigure}") + 16),
    );
  });

  it("treats remove-original plus add-new with unchanged count as structural", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const fresh = createSubfigurePanelDraft({
      path: "figures/c.png",
      usedLabels: ["fig:a", "fig:b", "fig:main"],
    });
    const draft = subfigureDraft(model);
    draft.panels[1]!.caption = "Second edited";
    draft.addedPanels = [fresh];
    draft.order = [1, 2];
    const result = apply(TWO_PANEL, patchesForVisualSubfigure(model, draft));
    expect(result).not.toContain("figures/a.png");
    expect(result).toContain("figures/b.png");
    expect(result).toContain("figures/c.png");
    expect(result).toContain("\\caption{Second edited}");
    expect(result).toContain(fresh.label);
  });

  it("validates only active drafts so removed invalid edits do not block", () => {
    const model = parseVisualSubfigure(TWO_PANEL)!;
    const draft = subfigureDraft(model);
    draft.panels[0]!.path = "../evil.png";
    draft.order = [1];
    expect(() => patchesForVisualSubfigure(model, draft)).not.toThrow();
    const result = apply(TWO_PANEL, patchesForVisualSubfigure(model, draft));
    expect(result).not.toContain("evil");
  });

  it("refuses ambiguous inter-panel gaps for count changes only", () => {
    expect(isSafeSubfigureSeparatorForCountChange("\n\\hfill\n")).toBe(true);
    expect(isSafeSubfigureSeparatorForCountChange("\n")).toBe(true);
    expect(isSafeSubfigureSeparatorForCountChange("\n% hi\n")).toBe(false);
    expect(isSafeSubfigureSeparatorForCountChange("\n\\\\\n")).toBe(false);
    expect(
      isSafeSubfigureSeparatorForCountChange("\n\\caption{X}\n"),
    ).toBe(false);
    const commented = TWO_PANEL.replace(
      "\\end{subfigure}\n\\hfill",
      "\\end{subfigure}\n% note\n\\hfill",
    );
    const commentedModel = parseVisualSubfigure(commented)!;
    // Order-only still supports arbitrary separators.
    const reorder = subfigureDraft(commentedModel);
    reorder.order = [1, 0];
    expect(() =>
      apply(commented, patchesForVisualSubfigure(commentedModel, reorder)),
    ).not.toThrow();
    // Count change refuses and explains Source.
    const remove = subfigureDraft(commentedModel);
    remove.order = [1];
    expect(() => patchesForVisualSubfigure(commentedModel, remove)).toThrow(
      /Source/,
    );
  });

  it("preserves CRLF, offsets and exact blocks on count changes", () => {
    const source = TWO_PANEL.replace(/\n/g, "\r\n");
    const model = parseVisualSubfigure(source)!;
    const fresh = createSubfigurePanelDraft({
      path: "figures/c.png",
      usedLabels: ["fig:a", "fig:b", "fig:main"],
    });
    const draft = subfigureDraft(model);
    draft.addedPanels = [fresh];
    draft.order = [0, 1, 2];
    const result = apply(source, patchesForVisualSubfigure(model, draft));
    expect(result.replace(/\r\n/g, "")).not.toContain("\n");
    expect(result).toContain(`\r\n\\hfill\r\n`);
    const prefix = "Pre\r\n\r\n";
    const full = `${prefix}${source}\r\nPost`;
    const shifted = parseVisualSubfigure(source, prefix.length)!;
    const shiftedDraft = subfigureDraft(shifted);
    shiftedDraft.addedPanels = [fresh];
    shiftedDraft.order = [0, 1, 2];
    const patches = patchesForVisualSubfigure(shifted, shiftedDraft);
    for (const patch of patches) {
      expect(patch.from).toBeGreaterThanOrEqual(prefix.length);
    }
    expect(apply(full, patches)).toContain("figures/c.png");
  });
});
