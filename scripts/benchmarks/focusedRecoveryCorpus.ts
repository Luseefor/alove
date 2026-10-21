import type { CompileJobPayload } from "@alove/protocol";

export type FocusedRecoveryFixture = {
  id: string;
  label: string;
  good: Omit<CompileJobPayload, "projectId">;
  failed: Omit<CompileJobPayload, "projectId">;
  expected: {
    status: "verified" | "unresolved" | "incompatible";
    scope?: "hunk" | "file";
    path?: string;
    files?: Record<string, string>;
  };
  retainedText?: string;
  revertedText?: string;
};

export const focusedRecoveryCorpus: FocusedRecoveryFixture[] = [
  {
    id: "focused-same-file-macro-preserved",
    label: "Removed macro with same-file prose plus other-file prose",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\newcommand{\proofword}{Verified}
\begin{document}
First paragraph stable.
\input{sections/body}
Closing prose original.
\end{document}
`,
        "sections/body.tex": String.raw`Body uses \proofword{} macro.
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
First paragraph stable.
\input{sections/body}
Closing prose revised with new sentence.
\end{document}
`,
        "sections/body.tex": String.raw`Body uses \proofword{} macro. Extra sentence.
`,
      },
    },
    expected: {
      status: "verified",
      scope: "hunk",
      path: "main.tex",
      files: {
        "main.tex": String.raw`\documentclass{article}
\newcommand{\proofword}{Verified}
\begin{document}
First paragraph stable.
\input{sections/body}
Closing prose revised with new sentence.
\end{document}
`,
        "sections/body.tex": String.raw`Body uses \proofword{} macro. Extra sentence.
`,
      },
    },
    retainedText: "Closing prose revised with new sentence.",
    revertedText: String.raw`\newcommand{\proofword}{Verified}`,
  },
  {
    id: "focused-body-typo-preserved",
    label: "Typo command in body with separated prose",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Typo body benchmark root.
\input{sections/body}
\end{document}
`,
        "sections/body.tex": String.raw`Intro sentence stable.
Body with correct command \textbf{bold text} and more prose.
Middle separator stable.
Trailing prose original.
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
Typo body benchmark root.
\input{sections/body}
\end{document}
`,
        "sections/body.tex": String.raw`Intro sentence stable.
Body with typo command \textfb{bold text} and more prose.
Middle separator stable.
Trailing prose revised with addition.
`,
      },
    },
    expected: {
      status: "verified",
      scope: "hunk",
      path: "sections/body.tex",
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Typo body benchmark root.
\input{sections/body}
\end{document}
`,
        "sections/body.tex": String.raw`Intro sentence stable.
Body with correct command \textbf{bold text} and more prose.
Middle separator stable.
Trailing prose revised with addition.
`,
      },
    },
    retainedText: "Trailing prose revised with addition.",
    revertedText: String.raw`\textbf{bold text}`,
  },
  {
    id: "focused-wrong-input-preserved",
    label: "Wrong input filename with separated same-file prose",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Wrong path root stable.
\input{sections/intro}
\input{sections/extra}
\input{sections/body}
Closing prose original.
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/extra.tex": String.raw`Extra prose stable.
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
Wrong path root stable.
\input{sections/intro}
\input{sections/missing}
\input{sections/body}
Closing prose revised with addition.
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/extra.tex": String.raw`Extra prose stable.
`,
        "sections/body.tex": String.raw`Body prose stable.
`,
      },
    },
    expected: {
      status: "verified",
      scope: "hunk",
      path: "main.tex",
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Wrong path root stable.
\input{sections/intro}
\input{sections/extra}
\input{sections/body}
Closing prose revised with addition.
\end{document}
`,
        "sections/intro.tex": String.raw`Intro prose stable.
`,
        "sections/extra.tex": String.raw`Extra prose stable.
`,
        "sections/body.tex": String.raw`Body prose stable.
`,
      },
    },
    retainedText: "Closing prose revised with addition.",
    revertedText: String.raw`\input{sections/extra}`,
  },
  {
    id: "focused-amsmath-preserved",
    label: "Removed amsmath package with separated same-file prose",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
Amsmath root stable.
\input{sections/body}
Closing prose original.
\end{document}
`,
        "sections/body.tex": String.raw`Here is an aligned equation.
\begin{align}
E &= mc^2
\end{align}
Closing equation prose.
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
Amsmath root stable.
\input{sections/body}
Closing prose revised with addition.
\end{document}
`,
        "sections/body.tex": String.raw`Here is an aligned equation.
\begin{align}
E &= mc^2
\end{align}
Closing equation prose.
`,
      },
    },
    expected: {
      status: "verified",
      scope: "hunk",
      path: "main.tex",
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
Amsmath root stable.
\input{sections/body}
Closing prose revised with addition.
\end{document}
`,
        "sections/body.tex": String.raw`Here is an aligned equation.
\begin{align}
E &= mc^2
\end{align}
Closing equation prose.
`,
      },
    },
    retainedText: "Closing prose revised with addition.",
    revertedText: String.raw`\usepackage{amsmath}`,
  },
  {
    id: "focused-dual-file-unresolved",
    label: "Independent faults in two files stay unresolved",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\usepackage{amsmath}
\newcommand{\myword}{Verified}
\begin{document}
Dual fault root stable.
\input{sections/a}
\input{sections/b}
\end{document}
`,
        "sections/a.tex": String.raw`First section uses \myword{} macro. Stable.
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
Dual fault root stable.
\input{sections/a}
\input{sections/b}
\end{document}
`,
        "sections/a.tex": String.raw`First section uses \myword{} macro. Stable.
`,
        "sections/b.tex": String.raw`Second section with equation.
\begin{alig}
E &= mc^2
\end{align}
Closing prose.
`,
      },
    },
    expected: {
      status: "unresolved",
    },
  },
  {
    id: "focused-whole-file-fallback",
    label: "Two faults plus prose need whole-file fallback and lose prose",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
First block correct \textbf{bold one} end.
Separator one stable.
Second block correct \textit{italic two} end.
Separator two stable.
Closing prose original.
\end{document}
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
First block broken \textfb{bold one} end.
Separator one stable.
Second block broken \textitx{italic two} end.
Separator two stable.
Closing prose revised with addition.
\end{document}
`,
      },
    },
    expected: {
      status: "verified",
      scope: "file",
      path: "main.tex",
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
First block correct \textbf{bold one} end.
Separator one stable.
Second block correct \textit{italic two} end.
Separator two stable.
Closing prose original.
\end{document}
`,
      },
    },
    retainedText: "Closing prose revised with addition.",
    revertedText: "Closing prose original.",
  },
  {
    id: "focused-engine-changed-incompatible",
    label: "Engine changed from pdflatex baseline to xelatex",
    good: {
      mainFile: "main.tex",
      engine: "pdflatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Engine benchmark root.
\input{sections/body}
\end{document}
`,
        "sections/body.tex": String.raw`Body with correct command \textbf{bold} and prose.
`,
      },
    },
    failed: {
      mainFile: "main.tex",
      engine: "xelatex",
      timeoutMs: 15000,
      files: {
        "main.tex": String.raw`\documentclass{article}
\begin{document}
Engine benchmark root.
\input{sections/body}
\end{document}
`,
        "sections/body.tex": String.raw`Body with typo \textfb{bold} and prose.
`,
      },
    },
    expected: {
      status: "incompatible",
    },
  },
];
