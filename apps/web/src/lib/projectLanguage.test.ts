import { describe, expect, it } from "vitest";
import {
  buildProjectLanguageIndex,
  filterCitations,
  filterLabels,
} from "@/lib/projectLanguage";
import {
  buildCiteCompletions,
  buildRefCompletions,
  findCiteCompletion,
  findRefCompletion,
  parseBibEntries,
  parseTexLabels,
} from "@alove/editor";

describe("parseBibEntries", () => {
  it("parses keys with title/author/year metadata across files", () => {
    const entries = parseBibEntries(`@article{einstein1905,
  title={On the electrodynamics of moving bodies},
  author={Albert Einstein},
  year={1905}
}
@book{knuth1984,
  title="The TeXbook",
  author="Donald Knuth",
  year="1984"
}`);
    expect(entries.map((e) => e.key)).toEqual(["einstein1905", "knuth1984"]);
    expect(entries[0]).toMatchObject({
      title: "On the electrodynamics of moving bodies",
      author: "Albert Einstein",
      year: "1905",
    });
    expect(entries[1]).toMatchObject({
      title: "The TeXbook",
      author: "Donald Knuth",
    });
  });

  it("handles nested braces in titles", () => {
    const entries = parseBibEntries(
      `@article{key1,\ntitle={{A {Nested} Title}},\nauthor={Doe, Jane},\nyear={2020}\n}`,
    );
    expect(entries[0]?.title).toContain("Nested");
  });
});

describe("parseTexLabels", () => {
  it("collects labels with section context", () => {
    const labels = parseTexLabels(
      "\\section{Intro}\n\\label{sec:intro}\n\\begin{figure}\n\\caption{A fig}\n\\label{fig:one}\n\\end{figure}",
      "main.tex",
    );
    expect(labels.map((l) => l.label)).toEqual(["sec:intro", "fig:one"]);
    expect(labels[0]?.context).toContain("Intro");
    expect(labels[0]?.file).toBe("main.tex");
  });

  it("skips escaped and commented labels", () => {
    const labels = parseTexLabels(
      "% \\label{sec:commented}\nText \\\\label{sec:escaped}\n\\label{sec:real}",
    );
    expect(labels.map((l) => l.label)).toEqual(["sec:real"]);
  });

  it("skips labels inside verbatim blocks", () => {
    const labels = parseTexLabels(
      "\\begin{verbatim}\n\\label{sec:hidden}\n\\end{verbatim}\n\\label{sec:shown}",
    );
    expect(labels.map((l) => l.label)).toEqual(["sec:shown"]);
  });
});

describe("findCiteCompletion", () => {
  it("detects cite variants and the active comma-separated key", () => {
    const doc = "\\cite{einstein1905,knu";
    const hit = findCiteCompletion(doc, doc.length);
    expect(hit?.command).toBe("cite");
    expect(hit?.fragment).toBe("knu");
    expect(typeof hit?.from).toBe("number");
  });

  it("handles citep/textcite variants with optional args", () => {
    for (const cmd of ["\\citep[see][]{k", "\\textcite{k", "\\autocite{k"]) {
      const hit = findCiteCompletion(cmd, cmd.length);
      expect(hit?.fragment).toBe("k");
    }
  });

  it("returns null outside braces and for commented/escaped commands", () => {
    expect(findCiteCompletion("hello", 5)).toBeNull();
    const commented = "% \\cite{abc";
    expect(findCiteCompletion(commented, commented.length)).toBeNull();
  });

  it("returns empty fragment right after the opening brace", () => {
    const doc = "See \\cite{";
    expect(findCiteCompletion(doc, doc.length)?.fragment).toBe("");
  });
});

describe("findRefCompletion", () => {
  it("detects ref/eqref/cref variants", () => {
    for (const [doc, cmd] of [
      ["\\ref{sec:i", "ref"],
      ["\\eqref{eq:m", "eqref"],
      ["\\cref{fig:o", "cref"],
      ["\\autoref{sec:i", "autoref"],
    ] as const) {
      const hit = findRefCompletion(doc, doc.length);
      expect(hit?.command).toBe(cmd);
      expect(hit?.fragment.length).toBeGreaterThan(0);
    }
  });

  it("returns null outside ref braces", () => {
    expect(findRefCompletion("plain text", 5)).toBeNull();
  });
});

describe("buildProjectLanguageIndex", () => {
  it("merges bib citations and tex labels project-wide", () => {
    const index = buildProjectLanguageIndex({
      "main.tex":
        "\\section{Intro}\\label{sec:intro}\nSee \\cite{einstein1905}.",
      "chapter.tex": "\\label{sec:methods}\nMethods.",
      "refs.bib":
        "@article{einstein1905,\ntitle={Relativity},\nauthor={Einstein},\nyear={1905}\n}",
    });
    expect(index.citations.map((c) => c.key)).toEqual(["einstein1905"]);
    expect(index.citations[0]).toMatchObject({ year: "1905" });
    expect(index.labels.map((l) => l.label).sort()).toEqual([
      "sec:intro",
      "sec:methods",
    ]);
  });

  it("dedupes keys and skips binary previews", () => {
    const index = buildProjectLanguageIndex({
      "a.bib": "@book{dup,\ntitle={A}\n}\n@book{dup,\ntitle={B}\n}",
      "fig.pdf": "data:image/png;base64,AAA",
      "main.tex": "\\label{sec:a}\n\\label{sec:a}",
    });
    expect(index.citations).toHaveLength(1);
    expect(index.labels).toHaveLength(1);
  });
});

describe("completion builders", () => {
  it("exposes metadata for cite options and filters by fragment", () => {
    const options = buildCiteCompletions(
      [
        { key: "einstein1905", title: "Relativity", author: "Einstein", year: "1905" },
        { key: "knuth1984", title: "TeXbook" },
      ],
      "einst",
    );
    expect(options.map((o) => o.label)).toEqual(["einstein1905"]);
    expect(String(options[0]?.detail)).toContain("1905");
  });

  it("exposes label context for ref options", () => {
    const options = buildRefCompletions(
      [{ label: "sec:intro", context: "Intro", file: "main.tex" }],
      "sec",
    );
    expect(options.map((o) => o.label)).toEqual(["sec:intro"]);
    expect(String(options[0]?.detail)).toContain("main.tex");
  });
});

describe("projectLanguage filters", () => {
  it("filters citations and labels by query", () => {
    const { citations, labels } = buildProjectLanguageIndex({
      "refs.bib": "@book{knuth1984,\ntitle={The TeXbook}\n}",
      "main.tex": "\\label{sec:intro}",
    });
    expect(filterCitations(citations, "texbook")).toHaveLength(1);
    expect(filterCitations(citations, "nope")).toHaveLength(0);
    expect(filterLabels(labels, "intro")).toHaveLength(1);
    expect(filterLabels(labels, "nope")).toHaveLength(0);
  });
});
