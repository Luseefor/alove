import type { RecoveryBenchmarkCase } from "./types";

const VALID_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const CORRUPT_PNG =
  "data:image/png;base64,Y29ycnVwdC1wbmctY29udGVudC1ub3QtYS1yZWFsLWltYWdlLTEyMzQ1";

export const recoveryCorpus: RecoveryBenchmarkCase[] = [
  {
    id: "verified-removed-macro",
    label: "Removed macro definition in main",
    category: "single-file",
    expected: "verified",
    expectedPath: "main.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\newcommand{\proofword}{Verified recovery}
\begin{document}
Hello world. This benchmark checks macro restoration.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for the removed macro case. It remains stable.
`,
        "sections/body.tex": String.raw`Body uses the macro \proofword{} in a sentence.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Hello world. This benchmark checks macro restoration.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for the removed macro case. It remains stable.
`,
        "sections/body.tex": String.raw`Body uses the macro \proofword{} in a sentence. Legal edit adds one more sentence.
`,
      },
    },
    preservePaths: ["sections/body.tex"],
  },
  {
    id: "verified-amsmath-removed",
    label: "Removed amsmath package with align in use",
    category: "single-file",
    expected: "verified",
    expectedPath: "main.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
Benchmark for amsmath align environment.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for amsmath case. Stable.
`,
        "sections/body.tex": String.raw`Here is an aligned equation.
\begin{align}
E &= mc^2 \\
F &= ma
\end{align}
Closing prose after the equation.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Benchmark for amsmath align environment.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for amsmath case. Stable.
`,
        "sections/body.tex": String.raw`Here is an aligned equation.
\begin{align}
E &= mc^2 \\
F &= ma
\end{align}
Closing prose after the equation. Legal edit adds a sentence.
`,
      },
    },
    preservePaths: ["sections/body.tex"],
  },
  {
    id: "verified-typo-command",
    label: "Typo in body command",
    category: "single-file",
    expected: "verified",
    expectedPath: "sections/body.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Typo command benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for typo case.
`,
        "sections/body.tex": String.raw`Body with correct command \textbf{bold text} and more prose.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Typo command benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for typo case. Legal edit adds a sentence.
`,
        "sections/body.tex": String.raw`Body with typo command \textfb{bold text} and more prose.
`,
      },
    },
    preservePaths: ["sections/intro.tex"],
  },
  {
    id: "verified-unmatched-brace",
    label: "Unmatched brace in body",
    category: "single-file",
    expected: "verified",
    expectedPath: "sections/body.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Unmatched brace benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for brace case.
`,
        "sections/body.tex": String.raw`Body with balanced braces \textbf{bold} and prose.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Unmatched brace benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for brace case. Legal edit adds a sentence.
`,
        "sections/body.tex": String.raw`Body with unmatched brace \textbf{bold and prose.
`,
      },
    },
    preservePaths: ["sections/intro.tex"],
  },
  {
    id: "verified-unclosed-env",
    label: "Unclosed itemize environment",
    category: "single-file",
    expected: "verified",
    expectedPath: "sections/body.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Unclosed environment benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for env case.
`,
        "sections/body.tex": String.raw`Intro sentence for unclosed env case.
\begin{itemize}
\item First item.
\item Second item.
\end{itemize}
Closing prose.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Unclosed environment benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for env case. Legal edit adds a sentence.
`,
        "sections/body.tex": String.raw`Intro sentence for unclosed env case.
\begin{itemize}
\item First item.
\item Second item.
Closing prose.
`,
      },
    },
    preservePaths: ["sections/intro.tex"],
  },
  {
    id: "verified-missing-math-delimiter",
    label: "Missing math delimiter",
    category: "single-file",
    expected: "verified",
    expectedPath: "sections/body.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Missing delimiter benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for math case.
`,
        "sections/body.tex": String.raw`Energy $E=mc^2$ is famous. More prose here.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Missing delimiter benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for math case. Legal edit adds a sentence.
`,
        "sections/body.tex": String.raw`Energy $E=mc^2 is famous. More prose here.
`,
      },
    },
    preservePaths: ["sections/intro.tex"],
  },
  {
    id: "verified-invalid-geometry-option",
    label: "Invalid geometry option",
    category: "single-file",
    expected: "verified",
    expectedPath: "main.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage[margin=1in]{geometry}
\begin{document}
Geometry benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for geometry case. Stable.
`,
        "sections/body.tex": String.raw`Body prose for geometry case. Stable.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage[invalid-option-xyz]{geometry}
\begin{document}
Geometry benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for geometry case. Stable.
`,
        "sections/body.tex": String.raw`Body prose for geometry case. Stable. Legal edit adds a sentence.
`,
      },
    },
    preservePaths: ["sections/body.tex"],
  },
  {
    id: "verified-deleted-input",
    label: "Deleted included file",
    category: "single-file",
    expected: "verified",
    expectedPath: "sections/extra.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Deleted input benchmark root.
\input{sections/intro}
\input{sections/extra}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/extra.tex": String.raw`Extra included prose that will be deleted in the failed version.
`,
        "sections/body.tex": String.raw`Body prose stable.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Deleted input benchmark root.
\input{sections/intro}
\input{sections/extra}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/body.tex": String.raw`Body prose stable. Legal edit adds a sentence.
`,
      },
    },
    preservePaths: ["sections/body.tex"],
  },
  {
    id: "verified-wrong-input-path",
    label: "Wrong input path in main",
    category: "single-file",
    expected: "verified",
    expectedPath: "main.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Wrong path benchmark root.
\input{sections/intro}
\input{sections/extra}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/extra.tex": String.raw`Extra prose for wrong path case.
`,
        "sections/body.tex": String.raw`Body prose stable.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Wrong path benchmark root.
\input{sections/intro}
\input{sections/missing}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/extra.tex": String.raw`Extra prose for wrong path case.
`,
        "sections/body.tex": String.raw`Body prose stable. Legal edit adds a sentence.
`,
      },
    },
    preservePaths: ["sections/body.tex"],
  },
  {
    id: "verified-malformed-tabular",
    label: "Malformed tabular with extra column",
    category: "single-file",
    expected: "verified",
    expectedPath: "sections/body.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Tabular benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for tabular case.
`,
        "sections/body.tex": String.raw`Table benchmark prose.
\begin{tabular}{ll}
A & B \\
C & D \\
\end{tabular}
Closing prose.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Tabular benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for tabular case. Legal edit adds a sentence.
`,
        "sections/body.tex": String.raw`Table benchmark prose.
\begin{tabular}{l}
A & B \\
C & D \\
\end{tabular}
Closing prose.
`,
      },
    },
    preservePaths: ["sections/intro.tex"],
  },
  {
    id: "verified-duplicate-newcommand",
    label: "Duplicate newcommand in main",
    category: "single-file",
    expected: "verified",
    expectedPath: "main.tex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\newcommand{\myword}{Verified}
\begin{document}
Duplicate newcommand benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for duplicate case.
`,
        "sections/body.tex": String.raw`Body uses \myword{} macro. Stable.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\newcommand{\myword}{Verified}
\newcommand{\myword}{Duplicate}
\begin{document}
Duplicate newcommand benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable for duplicate case.
`,
        "sections/body.tex": String.raw`Body uses \myword{} macro. Stable. Legal edit adds a sentence.
`,
      },
    },
    preservePaths: ["sections/body.tex"],
  },
  {
    id: "verified-malformed-bib",
    label: "Malformed bibliography file",
    category: "single-file",
    expected: "verified",
    expectedPath: "refs.bib",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Bibliography benchmark with real citation.
\input{sections/intro}
\input{sections/body}
Citation here \cite{proof}.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for bib case.
`,
        "sections/body.tex": String.raw`Body prose for bib case.
`,
        "refs.bib": String.raw`@article{proof,title={Real bibliography proof},author={Reader, A.},journal={Local verification},year={2026}}
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Bibliography benchmark with real citation.
\input{sections/intro}
\input{sections/body}
Citation here \cite{proof}.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for bib case.
`,
        "sections/body.tex": String.raw`Body prose for bib case. Legal edit adds a sentence.
`,
        "refs.bib": String.raw`@article{proof,title={Broken bibliography \UndefinedBibCommand},author={Reader, A.},journal={Local verification},year={2026}
`,
      },
    },
    preservePaths: ["sections/body.tex"],
  },
  {
    id: "verified-corrupt-png",
    label: "Corrupt PNG bytes with valid data URL wrapper",
    category: "single-file",
    expected: "verified",
    expectedPath: "assets/pixel.png",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
Image benchmark with valid pixel.
\input{sections/intro}
\input{sections/body}
\includegraphics[width=1cm]{assets/pixel.png}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for image case.
`,
        "sections/body.tex": String.raw`Body prose for image case.
`,
        "assets/pixel.png": VALID_PIXEL_PNG,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
Image benchmark with valid pixel.
\input{sections/intro}
\input{sections/body}
\includegraphics[width=1cm]{assets/pixel.png}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose for image case.
`,
        "sections/body.tex": String.raw`Body prose for image case. Legal edit adds a sentence.
`,
        "assets/pixel.png": CORRUPT_PNG,
      },
    },
    preservePaths: ["sections/body.tex"],
  },
  {
    id: "verified-nested-include-error",
    label: "Error in nested included chapter",
    category: "single-file",
    expected: "verified",
    expectedPath: "sections/chapter.tex",
    good: {
      mainFile: "chapters/paper.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "chapters/paper.tex": String.raw`\documentclass{article}
\begin{document}
Nested paper root.
\input{sections/chapter}
\input{sections/appendix}
\end{document}
`,
        "sections/chapter.tex": String.raw`Nested chapter reached the real TeX engine. More prose.
`,
        "sections/appendix.tex": String.raw`Appendix prose stable.
`,
      },
    },
    failed: {
      mainFile: "chapters/paper.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "chapters/paper.tex": String.raw`\documentclass{article}
\begin{document}
Nested paper root.
\input{sections/chapter}
\input{sections/appendix}
\end{document}
`,
        "sections/chapter.tex": String.raw`Nested chapter with \UndefinedChapterCommand error.
`,
        "sections/appendix.tex": String.raw`Appendix prose stable. Legal edit adds a sentence.
`,
      },
    },
    preservePaths: ["sections/appendix.tex"],
  },
  {
    id: "verified-missing-sty-macro",
    label: "Local sty missing macro definition",
    category: "single-file",
    expected: "verified",
    expectedPath: "mymacros.sty",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{mymacros}
\begin{document}
Sty benchmark root.
\input{sections/intro}
\input{sections/body}
Body uses \mymacro{} here.
\end{document}
`,
        "mymacros.sty": String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{mymacros}[2026/01/01 Benchmark macros]
\newcommand{\mymacro}{Styled macro output}
`,
        "sections/intro.tex": String.raw`Intro prose for sty case.
`,
        "sections/body.tex": String.raw`Body prose for sty case.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{mymacros}
\begin{document}
Sty benchmark root.
\input{sections/intro}
\input{sections/body}
Body uses \mymacro{} here.
\end{document}
`,
        "mymacros.sty": String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{mymacros}[2026/01/01 Benchmark macros]
% Macro definition removed in the failed version.
`,
        "sections/intro.tex": String.raw`Intro prose for sty case.
`,
        "sections/body.tex": String.raw`Body prose for sty case. Legal edit adds a sentence.
`,
      },
    },
    preservePaths: ["sections/body.tex"],
  },
  {
    id: "unresolved-dual-fault",
    label: "Two independent faults requiring both fixes",
    category: "multi-fault",
    expected: "unresolved",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{amsmath}
\newcommand{\myword}{Verified}
\begin{document}
Two fault benchmark root.
\input{sections/a}
\input{sections/b}
\end{document}
`,
        "sections/a.tex": String.raw`First section uses \myword{} macro. Stable prose.
`,
        "sections/b.tex": String.raw`Second section with equation.
\begin{align}
E &= mc^2
\end{align}
Closing prose.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
Two fault benchmark root.
\input{sections/a}
\input{sections/b}
\end{document}
`,
        "sections/a.tex": String.raw`First section uses \myword{} macro. Stable prose.
`,
        "sections/b.tex": String.raw`Second section with equation.
\begin{alig}
E &= mc^2
\end{align}
Closing prose.
`,
      },
    },
    preservePaths: [],
  },
  {
    id: "unresolved-candidate-budget",
    label: "Culprit beyond five trial budget",
    category: "candidate-budget",
    expected: "unresolved",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Budget benchmark root.
\input{a}
\input{b}
\input{c}
\input{d}
\input{e}
\input{f}
\input{z}
\end{document}
`,
        "a.tex": String.raw`Prose for file A. Stable sentence.
`,
        "b.tex": String.raw`Prose for file B. Stable sentence.
`,
        "c.tex": String.raw`Prose for file C. Stable sentence.
`,
        "d.tex": String.raw`Prose for file D. Stable sentence.
`,
        "e.tex": String.raw`Prose for file E. Stable sentence.
`,
        "f.tex": String.raw`Prose for file F. Stable sentence.
`,
        "z.tex": String.raw`Prose for file Z. Stable sentence.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Budget benchmark root.
\input{a}
\input{b}
\input{c}
\input{d}
\input{e}
\input{f}
\input{z}
\end{document}
`,
        "a.tex": String.raw`Prose for file A. Stable sentence. Legal edit one.
`,
        "b.tex": String.raw`Prose for file B. Stable sentence. Legal edit one.
`,
        "c.tex": String.raw`Prose for file C. Stable sentence. Legal edit one.
`,
        "d.tex": String.raw`Prose for file D. Stable sentence. Legal edit one.
`,
        "e.tex": String.raw`Prose for file E. Stable sentence. Legal edit one.
`,
        "f.tex": String.raw`Prose for file F. Stable sentence. Legal edit one.
`,
        "z.tex": String.raw`Prose for file Z with \UnknownBudgetCommand failure.
`,
      },
    },
    preservePaths: [],
  },
  {
    id: "incompatible-engine-changed",
    label: "Engine changed with source failure",
    category: "engine",
    expected: "incompatible",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Engine benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/body.tex": String.raw`Body with correct command \textbf{bold} and prose.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "lualatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Engine benchmark root.
\input{sections/intro}
\input{sections/body}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/body.tex": String.raw`Body with typo \textfb{bold} and prose.
`,
      },
    },
    preservePaths: [],
  },
  {
    id: "incompatible-root-changed",
    label: "Root changed to bad root",
    category: "root",
    expected: "incompatible",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Good root stable.
\input{sections/body}
\end{document}
`,
        "sections/body.tex": String.raw`Body prose stable.
`,
      },
    },
    failed: {
      mainFile: "bad.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "bad.tex": String.raw`\documentclass{article}
\begin{document}
Bad root with \UndefinedRootCommand failure.
\end{document}
`,
        "sections/body.tex": String.raw`Body prose stable.
`,
      },
    },
    preservePaths: [],
  },
  {
    id: "incompatible-malformed-png-url",
    label: "Malformed PNG data URL validation error",
    category: "validation",
    expected: "incompatible",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
Malformed URL benchmark root.
\input{sections/intro}
\input{sections/body}
\includegraphics[width=1cm]{assets/pixel.png}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/body.tex": String.raw`Body prose stable.
`,
        "assets/pixel.png": VALID_PIXEL_PNG,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
Malformed URL benchmark root.
\input{sections/intro}
\input{sections/body}
\includegraphics[width=1cm]{assets/pixel.png}
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/body.tex": String.raw`Body prose stable.
`,
        "assets/pixel.png": "data:image/png;base64,!!!",
      },
    },
    preservePaths: [],
  },
];
