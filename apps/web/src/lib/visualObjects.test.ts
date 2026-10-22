import { describe, expect, it } from "vitest";
import {
  createVisualTable,
  parseVisualTable,
  tableDraft,
  pasteTableTsv,
  patchesForVisualTable,
} from "./visualTable";
import {
  createVisualFigure,
  parseVisualFigure,
  figureDraft,
  patchesForVisualFigure,
  safeFigureAsset,
  isFigurePath,
} from "./visualFigure";
import {
  parseVisualMath,
  createVisualMath,
  patchesForVisualMath,
  parseVisualCitation,
  patchesForVisualCitation,
} from "./visualInline";
import {
  parseVisualObjects,
  applyVisualSourcePatches as apply,
} from "./visualObjects";
import {
  decodeVisualProse,
  encodeVisualProse,
  readTexGroup,
} from "./visualObjectTypes";
import {
  isVisualObjectCurrent,
  objectSourcePatches,
  graphicxSetup,
  type VisualObjectTarget,
} from "./visualObjectSession";
const doc = (body: string, eol = "\n") =>
  `\\documentclass{article}${eol}\\begin{document}${eol}${body}${eol}\\end{document}${eol}`;
describe("source-backed tables", () => {
  it("edits one cell byte-exactly, preserving CRLF, rules, caption and comments", () => {
    const source = doc(
      String.raw`\begin{table}[htbp]
% keep
\begin{tabular}{|lc|}
\hline
A & B \\
C & D \\
\hline
\end{tabular}
\caption{Results}
\label{tab:result}
\end{table}`.replace(/\n/g, "\r\n"),
      "\r\n",
    );
    const m = parseVisualObjects(source)[0]!;
    expect(m.kind).toBe("table");
    if (m.kind !== "table") return;
    expect(m.structureEditable).toBe(false);
    const d = tableDraft(m);
    d.cells[0]![1] = "50% & {value}";
    const p = patchesForVisualTable(m, d);
    expect(p).toHaveLength(1);
    const cell = m.cells[0]![1]!;
    expect(apply(source, p)).toBe(
      source.slice(0, cell.from) +
        String.raw`50\% \& \{value\}` +
        source.slice(cell.to),
    );
  });
  it("pastes TSV, resizes and aligns simple tables explicitly", () => {
    const m = parseVisualTable(createVisualTable())!;
    expect(m.cells.map((r) => r.length)).toEqual([2, 2]);
    expect(m.structureEditable).toBe(true);
    const d = pasteTableTsv(
      tableDraft(m),
      0,
      0,
      "Name\tValue\tUnit\r\nAlpha\t5\tkg\r\nBeta\t6\tkg\r\n",
    );
    d.alignments[1] = "r";
    d.caption = "Results";
    const result = apply(m.source, patchesForVisualTable(m, d)),
      n = parseVisualTable(result)!;
    expect(n.cells).toHaveLength(3);
    expect(n.alignments).toEqual(["l", "r", "l"]);
    expect(n.cells[2]![0]!.text).toBe("Beta");
    expect(n.caption?.text).toBe("Results");
    expect(result).toContain(String.raw`\label{tab:new}`);
  });
  it("isolates escaped separators, groups and math, retaining readonly custom cells", () => {
    const s = String.raw`\begin{tabular}{lll}A\&B & $x&y$ & \textbf{C&D} \\ E & F & G \\\end{tabular}`,
      m = parseVisualTable(s)!;
    expect(m.cells).toHaveLength(2);
    expect(m.cells[0]!.map((c) => c.text)).toEqual(["A&B", null, null]);
    const d = tableDraft(m);
    d.cells[1]![2] = "H";
    expect(apply(s, patchesForVisualTable(m, d))).toBe(
      s.replace(" & G ", " & H "),
    );
    d.cells[0]![1] = "removed";
    expect(() => patchesForVisualTable(m, d)).toThrow(/custom cell/);
  });
  it("refuses complex structural rewrites and unsupported environments", () => {
    const m = parseVisualTable(
        String.raw`\begin{tabular}{|ll|}\hline A & B \\\end{tabular}`,
      )!,
      d = tableDraft(m);
    d.cells.push(["C", "D"]);
    expect(() => patchesForVisualTable(m, d)).toThrow(/structure/);
    for (const s of [
      String.raw`\begin{tabular}{p{3cm}}A\\\end{tabular}`,
      String.raw`\begin{tabular}{ll}A & B \\[2pt]\end{tabular}`,
      String.raw`\begin{table*}\begin{tabular}{l}A\\\end{tabular}\end{table}`,
    ])
      expect(parseVisualTable(s)).toBeNull();
  });
  it("bounds spreadsheet paste without changing the draft or truncating", () => {
    const d = tableDraft(parseVisualTable(createVisualTable())!),
      snapshot = JSON.stringify(d);
    for (const text of [
      "x\n".repeat(21),
      Array(13).fill("x").join("\t"),
      "x".repeat(65537),
    ])
      expect(() => pasteTableTsv(d, 0, 0, text)).toThrow();
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});
describe("figures", () => {
  it("patches width and caption without changing placement, label, path or CRLF", () => {
    const s = createVisualFigure("figures/a.png", "\r\n").replace(
        "[htbp]",
        "[!ht]",
      ),
      m = parseVisualFigure(s)!,
      d = figureDraft(m);
    d.width = 0.5;
    d.caption = "50% success";
    expect(apply(s, patchesForVisualFigure(m, d))).toBe(
      s
        .replace("0.8\\textwidth", "0.5\\textwidth")
        .replace("\\caption{}", String.raw`\caption{50\% success}`),
    );
  });
  it("adds width to bare graphics", () => {
    const s = String.raw`\includegraphics{figures/a.png}`,
      m = parseVisualFigure(s)!,
      d = figureDraft(m);
    d.width = 0.4;
    expect(apply(s, patchesForVisualFigure(m, d))).toBe(
      String.raw`\includegraphics[width=0.4\textwidth]{figures/a.png}`,
    );
  });
  it("retains custom captions and refuses to rewrite them", () => {
    const s = createVisualFigure("a.png").replace(
        "\\caption{}",
        String.raw`\caption{A \textbf{custom} caption}`,
      ),
      m = parseVisualFigure(s)!,
      d = figureDraft(m);
    d.width = 0.6;
    expect(apply(s, patchesForVisualFigure(m, d))).toContain(
      String.raw`\caption{A \textbf{custom} caption}`,
    );
    d.caption = "replace";
    expect(() => patchesForVisualFigure(m, d)).toThrow(/custom caption/);
  });
  it("refuses unsafe paths, remote previews, custom options and mismatched floats", () => {
    for (const p of [
      "../a.png",
      "https://evil.test/a.png",
      "a%comment.png",
      "a{b}.png",
      "a.svg",
      "a.webp",
    ])
      expect(isFigurePath(p)).toBe(false);
    for (const s of [
      String.raw`\includegraphics[scale=2]{a.png}`,
      String.raw`\begin{figure*}\includegraphics{a.png}\end{figure}`,
      String.raw`\includegraphics{a.png}\includegraphics{b.png}`,
    ])
      expect(parseVisualFigure(s)).toBeNull();
    expect(safeFigureAsset("https://evil.test/a.png")).toBeNull();
    expect(safeFigureAsset("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
  });
});
describe("equations and project references", () => {
  it.each([
    String.raw`$ x^2 $`,
    String.raw`\( x^2 \)`,
    String.raw`$$ x^2 $$`,
    String.raw`\[ x^2 \]`,
    String.raw`\begin{equation} x^2 \label{eq:x} \end{equation}`,
  ])("preserves delimiters and labels in %s", (s) => {
    const m = parseVisualMath(s)!;
    expect(m).not.toBeNull();
    expect(
      apply(
        s,
        patchesForVisualMath(m, {
          tex: m.tex.replace("x^2", "x^3"),
          display: m.display,
        }),
      ),
    ).toBe(s.replace("x^2", "x^3"));
  });
  it("allows display changes but protects numbered/labelled environments and delimiters", () => {
    const m = parseVisualMath(String.raw`\(x\)`)!;
    expect(
      apply(m.source, patchesForVisualMath(m, { tex: "y", display: true })),
    ).toBe("\\[\ny\n\\]");
    const n = parseVisualMath(
      String.raw`\begin{equation}x\label{eq:x}\end{equation}`,
    )!;
    expect(() =>
      patchesForVisualMath(n, { tex: n.tex, display: false }),
    ).toThrow(/numbered/);
    for (const t of ["x$y", String.raw`x\]\end{document}`, "x".repeat(8193)])
      expect(() => createVisualMath(t)).toThrow();
  });
  it("changes citation keys only, preserving notes, star, whitespace and style", () => {
    const s = String.raw`\citep* [see {p. 2}][chapter 3]{ old , missing }`,
      m = parseVisualCitation(s)!;
    expect(m.keys).toEqual(["old", "missing"]);
    expect(
      apply(s, patchesForVisualCitation(m, { keys: ["new", "missing"] })),
    ).toBe(s.replace(" old , missing ", "new,missing"));
    expect(patchesForVisualCitation(m, { keys: m.keys })).toEqual([]);
  });
  it("changes reference style and rejects injected keys", () => {
    const s = String.raw`\ref{sec:intro}`,
      m = parseVisualCitation(s)!;
    expect(
      apply(
        s,
        patchesForVisualCitation(m, { keys: ["sec:two"], command: "eqref" }),
      ),
    ).toBe(String.raw`\eqref{sec:two}`);
    expect(() =>
      patchesForVisualCitation(m, { keys: ["x}\\input{evil"] }),
    ).toThrow();
    expect(parseVisualCitation(String.raw`\ref{\custom}`)).toBeNull();
  });
});
describe("boundaries and sessions", () => {
  it("only exposes actual body objects, ignoring opaque custom contexts", () => {
    const s = String.raw`\documentclass{article}
\newcommand{\x}{\cite{fake}}
\begin{document}
\custom{\cite{hidden}}
% \cite{comment}
\begin{verbatim}
\cite{verbatim}
\end{verbatim}
A \cite{real} and \ref{sec:intro} with \(x^2\).
\end{document}`;
    expect(parseVisualObjects(s).map((o) => o.kind)).toEqual([
      "citation",
      "reference",
      "math",
    ]);
  });
  it("rejects overlap, invalid bounds and oversized patches", () => {
    for (const p of [
      [
        { from: 1, to: 4, insert: "" },
        { from: 2, to: 3, insert: "" },
      ],
      [{ from: -1, to: 0, insert: "" }],
      [{ from: 0, to: 6, insert: "" }],
      [{ from: 0, to: 0, insert: "x".repeat(262145) }],
    ])
      expect(() => apply("hello", p)).toThrow();
  });
  it("guards exact project, file, revision, role and editor source", () => {
    const source = doc("prose"),
      object = parseVisualMath(createVisualMath())!,
      t: VisualObjectTarget = {
        object,
        source,
        projectId: "p",
        fileId: "main.tex",
        revision: 5,
        insertion: source.indexOf("prose"),
      };
    const c = {
      projectId: "p",
      activeFileId: "main.tex",
      documentRevision: 5,
      filesByPath: { "main.tex": source },
      projectRole: "owner",
    };
    expect(isVisualObjectCurrent(t, c, source)).toBe(true);
    for (const a of [
      { ...c, projectId: "other" },
      { ...c, activeFileId: "other.tex" },
      { ...c, documentRevision: 6 },
      { ...c, projectRole: "viewer" },
      { ...c, filesByPath: { "main.tex": "changed" } },
    ])
      expect(isVisualObjectCurrent(t, a, source)).toBe(false);
    expect(isVisualObjectCurrent(t, c, "changed")).toBe(false);
    expect(apply(source, objectSourcePatches(t, []))).toBe(
      source.replace("prose", `${object.source}prose`),
    );
    expect(() => objectSourcePatches({ ...t, insertion: 0 }, [])).toThrow(
      /editable/,
    );
  });
  it("detects graphicx and ignores commented package lines", () => {
    const s = doc("prose");
    expect(graphicxSetup(s)).toEqual({
      present: false,
      insertion: s.indexOf("\\begin{document}"),
    });
    expect(
      graphicxSetup(
        s.replace(
          "\\begin{document}",
          "\\usepackage{amsmath,graphicx}\n\\begin{document}",
        ),
      ).present,
    ).toBe(true);
    expect(
      graphicxSetup(
        s.replace(
          "\\begin{document}",
          "% \\usepackage{graphicx}\n\\begin{document}",
        ),
      ).present,
    ).toBe(false);
  });
  it("roundtrips escaped prose and reads bounded balanced groups", () => {
    const value = "A & B_2 {x} \\ # % $ ~ ^ 😀";
    expect(decodeVisualProse(encodeVisualProse(value))).toBe(value);
    expect(readTexGroup(String.raw`{a{b}\}c}`, 0)?.value).toBe(
      String.raw`a{b}\}c`,
    );
    expect(readTexGroup("{".repeat(70) + "}".repeat(70), 0)).toBeNull();
  });
});

it("ignores package-shaped macro arguments and refuses insertion in invalid documents", () => {
  const source = doc("prose").replace(
    "\\begin{document}",
    String.raw`\newcommand{\setup}{\usepackage{graphicx}}` +
      "\n\\begin{document}",
  );
  expect(graphicxSetup(source).present).toBe(false);
});

it("ignores commented figure commands and caption/label tokens without rewriting them", () => {
  const s = String.raw`\begin{figure}
% \includegraphics{fake.png}
\includegraphics{real.png}
% \caption{fake caption}
\caption{Real caption}
% \label{fake}
\label{fig:real}
\end{figure}`;
  const m = parseVisualFigure(s)!;
  expect(m.path).toBe("real.png");
  expect(m.caption?.text).toBe("Real caption");
  expect(m.label?.value).toBe("fig:real");
  const d = figureDraft(m);
  d.caption = "Changed";
  expect(apply(s, patchesForVisualFigure(m, d))).toBe(
    s.replace("{Real caption}", "{Changed}"),
  );
  expect(
    parseVisualFigure(String.raw`\begin{figure}
% \includegraphics{fake.png}
\end{figure}`),
  ).toBeNull();
});

it("uses document CRLF for inline-to-display conversion and new math bodies", () => {
  const source = doc(String.raw`Text \(x^2\).`, "\r\n");
  const model = parseVisualObjects(source)[0]!;
  expect(model.kind).toBe("math");
  if (model.kind !== "math") return;
  expect(
    apply(source, patchesForVisualMath(model, { tex: "x^3", display: true })),
  ).toBe(source.replace(String.raw`\(x^2\)`, "\\[\r\nx^3\r\n\\]"));
  const fresh = parseVisualMath(createVisualMath(), 0, "\r\n")!;
  expect(
    apply(
      fresh.source,
      patchesForVisualMath(fresh, { tex: "a+\nb=c", display: true }),
    ),
  ).toBe("\\[\r\na+\r\nb=c\r\n\\]");
});
