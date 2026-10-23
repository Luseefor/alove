import {
  parseVisualSubfigure,
  subfigureDraft,
  patchesForVisualSubfigure,
} from "./visualSubfigure";
import { parseVisualObjects } from "./visualObjects";
import { describe, expect, it } from "vitest";
import {
  createVisualFigure,
  figureDraft,
  isFigurePlacement,
  parseVisualFigure,
  patchesForVisualFigure,
  requiredFigurePackages,
  type FigureDraft,
} from "./visualFigure";
import { applyVisualSourcePatches as apply } from "./visualObjects";

describe("visual figure resize and placement", () => {
  it("returns no patches for an untouched draft, preserving exact bytes", () => {
    const source = createVisualFigure("figures/a.png");
    const model = parseVisualFigure(source)!;
    expect(model.placement).toBe("htbp");
    expect(model.starred).toBe(false);
    const patches = patchesForVisualFigure(model, figureDraft(model));
    expect(patches).toEqual([]);
    expect(apply(source, patches)).toBe(source);
  });

  it("preserves exact placement, CRLF and custom caption bytes on no-op", () => {
    const source = createVisualFigure("figures/a.png", "\r\n").replace(
      "[htbp]",
      "[!ht]",
    );
    const model = parseVisualFigure(source)!;
    expect(model.placement).toBe("!ht");
    expect(model.eol).toBe("\r\n");
    const patches = patchesForVisualFigure(model, figureDraft(model));
    expect(patches).toEqual([]);
    expect(apply(source, patches)).toBe(source);
  });

  it("patches only the width number, keeping unit, placement and CRLF", () => {
    const source = createVisualFigure("figures/a.png", "\r\n")
      .replace("[htbp]", "[!ht]")
      .replace("0.8\\textwidth", "0.8\\linewidth");
    const model = parseVisualFigure(source)!;
    expect(model.widthUnit).toBe("linewidth");
    expect(model.placement).toBe("!ht");
    const draft = figureDraft(model);
    draft.width = 0.5;
    const result = apply(source, patchesForVisualFigure(model, draft));
    expect(result).toBe(source.replace("0.8\\linewidth", "0.5\\linewidth"));
    expect(result).toContain("[!ht]");
    expect(result).toContain("\r\n");
  });

  it("changes, removes and adds float placement without touching other bytes", () => {
    const htbp = createVisualFigure("figures/a.png");
    const model = parseVisualFigure(htbp)!;
    const changed = figureDraft(model);
    changed.placement = "!ht";
    expect(apply(htbp, patchesForVisualFigure(model, changed))).toBe(
      htbp.replace("[htbp]", "[!ht]"),
    );

    const removed = figureDraft(model);
    removed.placement = null;
    expect(apply(htbp, patchesForVisualFigure(model, removed))).toBe(
      htbp.replace("[htbp]", ""),
    );

    const bare =
      "\\begin{figure}\n\\centering\n\\includegraphics{figures/a.png}\n\\end{figure}";
    const bareModel = parseVisualFigure(bare)!;
    expect(bareModel.placement).toBeNull();
    const added = figureDraft(bareModel);
    added.placement = "htbp";
    expect(apply(bare, patchesForVisualFigure(bareModel, added))).toBe(
      bare.replace("\\begin{figure}\n", "\\begin{figure}[htbp]\n"),
    );

    // No-op placement preserves absence of brackets.
    expect(patchesForVisualFigure(bareModel, figureDraft(bareModel))).toEqual(
      [],
    );
  });

  it("fails closed on unsafe widths, placements and bare-figure placement", () => {
    const model = parseVisualFigure(createVisualFigure("figures/a.png"))!;
    for (const width of [0.09, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        patchesForVisualFigure(model, { ...figureDraft(model), width }),
      ).toThrow(/width/);
    }
    for (const placement of ["foo", "htbp,foo", " H", "[htbp]", "HHHHHHHHH"]) {
      expect(() =>
        patchesForVisualFigure(model, {
          ...figureDraft(model),
          placement,
        }),
      ).toThrow();
    }
    expect(isFigurePlacement("foo")).toBe(false);
    expect(isFigurePlacement("htbp")).toBe(true);
    expect(isFigurePlacement(null)).toBe(true);
    const bare = parseVisualFigure("\\includegraphics{figures/a.png}")!;
    expect(() =>
      patchesForVisualFigure(bare, { ...figureDraft(bare), placement: "htbp" }),
    ).toThrow();
  });

  it("fails closed on unsafe options, mismatched floats and subfigures", () => {
    for (const source of [
      "\\includegraphics[scale=2]{a.png}",
      "\\includegraphics[width=0.5\\textwidth,trim=0 0 0 0]{a.png}",
      "\\begin{figure}[foo]\\includegraphics{a.png}\\end{figure}",
      "\\begin{figure}[htbp,foo]\\includegraphics{a.png}\\end{figure}",
      "\\begin{figure} [htbp]\\includegraphics{a.png}\\end{figure}",
      "\\begin{figure*}\\includegraphics{a.png}\\end{figure}",
      "\\begin{figure}\\includegraphics{a.png}\\end{figure*}",
      "\\begin{figure}\\begin{subfigure}{a}\\includegraphics{a.png}\\end{subfigure}\\end{figure}",
      "\\begin{figure}\\includegraphics{a.png}\\subcaption{A}\\end{figure}",
      "\\begin{figure}\\includegraphics{a.png}\\includegraphics{b.png}\\end{figure}",
    ])
      expect(parseVisualFigure(source), source).toBeNull();
  });

  it("keeps starred figures and linewidth units while patching placement", () => {
    const source = createVisualFigure("figures/a.png")
      .replace("\\begin{figure}", "\\begin{figure*}")
      .replace("\\end{figure}", "\\end{figure*}")
      .replace("0.8\\textwidth", "0.8\\linewidth");
    const model = parseVisualFigure(source)!;
    expect(model.starred).toBe(true);
    expect(model.placement).toBe("htbp");
    const draft = figureDraft(model);
    draft.placement = "h";
    draft.width = 0.6;
    const result = apply(source, patchesForVisualFigure(model, draft));
    expect(result).toBe(
      source
        .replace("[htbp]", "[h]")
        .replace("0.8\\linewidth", "0.6\\linewidth"),
    );
    expect(result).toContain("\\begin{figure*}");
    expect(result).toContain("\\end{figure*}");
  });

  it("uses absolute offsets so placement patches apply outside the fragment", () => {
    const fragment = createVisualFigure("figures/a.png");
    const prefix = "Hello\n\n";
    const source = `${prefix}${fragment}\n\nWorld`;
    const model = parseVisualFigure(fragment, prefix.length)!;
    const draft = figureDraft(model);
    draft.placement = "h";
    const patches = patchesForVisualFigure(model, draft);
    expect(patches).toHaveLength(1);
    expect(apply(source, patches)).toBe(source.replace("[htbp]", "[h]"));
  });

  it("requires graphicx always, float only for H, subcaption for panels", () => {
    expect(requiredFigurePackages({ placement: null })).toEqual(["graphicx"]);
    expect(requiredFigurePackages({ placement: "htbp" })).toEqual(["graphicx"]);
    expect(requiredFigurePackages({ placement: "H" })).toEqual([
      "graphicx",
      "float",
    ]);
    expect(requiredFigurePackages({ placement: "htbp", panels: [{}] })).toEqual(
      ["graphicx", "subcaption"],
    );
    expect(requiredFigurePackages({ placement: "H", panels: [{}] })).toEqual([
      "graphicx",
      "subcaption",
      "float",
    ]);
  });

  it("dispatches subcaption figures as an explicit subfigure object", () => {
    const source =
      "\\begin{figure}[htbp]\n\\centering\n" +
      "\\begin{subfigure}[b]{0.48\\textwidth}\n\\centering\n" +
      "\\includegraphics[width=\\linewidth]{\\detokenize{figures/a.png}}\n" +
      "\\caption{First}\n\\label{fig:a}\n\\end{subfigure}\n\\hfill\n" +
      "\\begin{subfigure}[b]{0.48\\textwidth}\n\\centering\n" +
      "\\includegraphics[width=\\linewidth]{\\detokenize{figures/b.png}}\n" +
      "\\caption{Second}\n\\label{fig:b}\n\\end{subfigure}\n" +
      "\\caption{Main}\n\\label{fig:main}\n\\end{figure}";
    const model = parseVisualSubfigure(source)!;
    expect(model.kind).toBe("subfigure");
    expect(model.panels).toHaveLength(2);
    expect(model.placement).toBe("htbp");
    expect(patchesForVisualSubfigure(model, subfigureDraft(model))).toEqual([]);
    expect(
      apply(source, patchesForVisualSubfigure(model, subfigureDraft(model))),
    ).toBe(source);
    const edited = subfigureDraft(model);
    edited.panels[0]!.envWidth = 0.4;
    expect(apply(source, patchesForVisualSubfigure(model, edited))).toBe(
      source.replace("0.48\\textwidth", "0.4\\textwidth"),
    );
    expect(parseVisualFigure(source)).toBeNull();
    expect(
      parseVisualObjects(`\\begin{document}\n${source}\n\\end{document}`).map(
        (object) => object.kind,
      ),
    ).toEqual(["subfigure"]);
    expect(() =>
      patchesForVisualSubfigure(model, {
        ...subfigureDraft(model),
        panels: [subfigureDraft(model).panels[0]!],
      }),
    ).toThrow();
    expect(requiredFigurePackages(model)).toEqual(["graphicx", "subcaption"]);
  });

  it("accepts legacy drafts without a placement field, preserving placement", () => {
    const model = parseVisualFigure(createVisualFigure("figures/a.png"))!;
    const full = figureDraft(model);
    const legacy: Omit<FigureDraft, "placement"> = {
      path: full.path,
      width: full.width,
      caption: full.caption,
      label: full.label,
    };
    legacy.width = 0.5;
    const patches = patchesForVisualFigure(model, legacy);
    expect(patches).toHaveLength(1);
    expect(apply(createVisualFigure("figures/a.png"), patches)).toBe(
      createVisualFigure("figures/a.png").replace(
        "0.8\\textwidth",
        "0.5\\textwidth",
      ),
    );
  });
});
