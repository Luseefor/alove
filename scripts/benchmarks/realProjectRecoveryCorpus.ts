import { readFileSync } from "node:fs";
import type { FocusedRecoveryFixture } from "./focusedRecoveryCorpus";

/**
 * Real-project recovery fixtures (pinned public thesis TEMPLATE, not a manuscript).
 *
 * Upstream: https://github.com/dcroote/stanford-thesis-example
 * Branch: master, commit: ffef6af633d0716fb0592b83c8ce594ed38819d2
 * Baseline is original upstream with no adaptations.
 * Vendored unchanged under scripts/benchmarks/fixtures/real-projects/stanford-thesis-example/.
 * Manifest: scripts/benchmarks/fixtures/real-projects/stanford-thesis-example.manifest.json
 * Licensing: MIT (Copyright 2019 Derek Croote) plus suthesis-2e.sty original
 * permissive notice (Stanford thesis style, Joseph Pallas/Emma Pease lineage).
 * All copyright notices preserved in vendored files.
 *
 * This is a real public thesis TEMPLATE / example thesis, not a real submitted
 * manuscript, private thesis, or user study, and not a representative survey.
 * No build claim here; actual-compiler verification is future work via the
 * primary verification CLI (verifyFocusedRecovery.ts).
 *
 * Local CLI fixture loader. Reads pinned bytes only; no network or runtime fetch.
 */

const fixtureRoot = new URL(
  "./fixtures/real-projects/stanford-thesis-example/",
  import.meta.url,
);
const text = (path: string) => readFileSync(new URL(path, fixtureRoot), "utf8");
const UPSTREAM_MAIN_TEX = text("main.tex");
const UPSTREAM_CH_INTRO_TEX = text("ch_intro.tex");
const UPSTREAM_CH_PAPER1_TEX = text("ch_paper1.tex");
const UPSTREAM_CH_CONCLUSION_TEX = text("ch_conclusion.tex");
const UPSTREAM_PREFACE_ABSTRACT_TEX = text("preface_abstract.tex");
const UPSTREAM_PREFACE_ACK_TEX = text("preface_acknowledgements.tex");
const UPSTREAM_MYBIB_BIB = text("mybib.bib");
const UPSTREAM_SUTHESIS_STY = text("suthesis-2e.sty");
const UPSTREAM_FIG1_PNG =
  "data:image/png;base64," +
  readFileSync(new URL("figs/paper1/fig1.png", fixtureRoot)).toString("base64");

function upstreamFiles(): Record<string, string> {
  return {
    "main.tex": UPSTREAM_MAIN_TEX,
    "ch_intro.tex": UPSTREAM_CH_INTRO_TEX,
    "ch_paper1.tex": UPSTREAM_CH_PAPER1_TEX,
    "ch_conclusion.tex": UPSTREAM_CH_CONCLUSION_TEX,
    "preface_abstract.tex": UPSTREAM_PREFACE_ABSTRACT_TEX,
    "preface_acknowledgements.tex": UPSTREAM_PREFACE_ACK_TEX,
    "mybib.bib": UPSTREAM_MYBIB_BIB,
    "suthesis-2e.sty": UPSTREAM_SUTHESIS_STY,
    "figs/paper1/fig1.png": UPSTREAM_FIG1_PNG,
  };
}

const ENGINE = "pdflatex" as const;
const TIMEOUT_MS = 15000;

export const realProjectRecoveryCorpus: FocusedRecoveryFixture[] = [
  {
    id: "real-thesis-chapter-typo-preserved",
    label: "Real template chapter typo plus later separated same-file prose",
    good: {
      mainFile: "main.tex",
      engine: ENGINE,
      timeoutMs: TIMEOUT_MS,
      files: upstreamFiles(),
    },
    failed: {
      mainFile: "main.tex",
      engine: ENGINE,
      timeoutMs: TIMEOUT_MS,
      files: {
        ...upstreamFiles(),
        "ch_paper1.tex": UPSTREAM_CH_PAPER1_TEX.replace(
          "\\textbf{bold}, \\textit{italics}",
          "\\textfb{bold}, \\textit{italics}",
        ).replace(
          "More text here.\n\nMore text here.\n\n\\section{Conclusions}",
          "More text here.\n\nMore text here. Revised addition preserves legal prose.\n\n\\section{Conclusions}",
        ),
      },
    },
    expected: {
      status: "verified",
      scope: "hunk",
      path: "ch_paper1.tex",
      files: {
        ...upstreamFiles(),
        "ch_paper1.tex": UPSTREAM_CH_PAPER1_TEX.replace(
          "More text here.\n\nMore text here.\n\n\\section{Conclusions}",
          "More text here.\n\nMore text here. Revised addition preserves legal prose.\n\n\\section{Conclusions}",
        ),
      },
    },
    retainedText: "Revised addition preserves legal prose.",
    revertedText: "\\textbf{bold}",
  },
  {
    id: "real-thesis-include-command-preserved",
    label: "Real template main include command typo plus later separate prose",
    good: {
      mainFile: "main.tex",
      engine: ENGINE,
      timeoutMs: TIMEOUT_MS,
      files: upstreamFiles(),
    },
    failed: {
      mainFile: "main.tex",
      engine: ENGINE,
      timeoutMs: TIMEOUT_MS,
      files: {
        ...upstreamFiles(),
        "main.tex": UPSTREAM_MAIN_TEX.replace(
          "\\include{ch_paper1}",
          "\\incldue{ch_paper1}",
        ).replace(
          "% adds a non-numbered signature page at end (for printing on ACID-FREE paper)",
          "Revised note preserves legal prose.\n% adds a non-numbered signature page at end (for printing on ACID-FREE paper)",
        ),
      },
    },
    expected: {
      status: "verified",
      scope: "hunk",
      path: "main.tex",
      files: {
        ...upstreamFiles(),
        "main.tex": UPSTREAM_MAIN_TEX.replace(
          "% adds a non-numbered signature page at end (for printing on ACID-FREE paper)",
          "Revised note preserves legal prose.\n% adds a non-numbered signature page at end (for printing on ACID-FREE paper)",
        ),
      },
    },
    retainedText: "Revised note preserves legal prose.",
    revertedText: "\\include{ch_paper1}",
  },
  {
    id: "real-thesis-dual-fault-unresolved",
    label: "Real template independent faults in two files stay unresolved",
    good: {
      mainFile: "main.tex",
      engine: ENGINE,
      timeoutMs: TIMEOUT_MS,
      files: upstreamFiles(),
    },
    failed: {
      mainFile: "main.tex",
      engine: ENGINE,
      timeoutMs: TIMEOUT_MS,
      files: {
        ...upstreamFiles(),
        "ch_intro.tex": UPSTREAM_CH_INTRO_TEX.replace(
          "Broad overview.",
          "Broad overview with \\UndefinedIntroCommand error.",
        ),
        "ch_paper1.tex": UPSTREAM_CH_PAPER1_TEX.replace(
          "\\textbf{bold}, \\textit{italics}",
          "\\textfb{bold}, \\textit{italics}",
        ),
      },
    },
    expected: {
      status: "unresolved",
    },
  },
];
