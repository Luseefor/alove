import { describe, expect, it } from "vitest";
import {
  createVisualSubfigure,
  parseVisualSubfigure,
  patchesForVisualSubfigure,
  requiredSubfigurePackages,
  subfigureDraft,
  SUBFIGURE_MAX_PANELS,
} from "./visualSubfigure";
import { applyVisualSourcePatches as apply } from "./visualObjects";

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
});
