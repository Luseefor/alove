export const DEMO_PROJECT_ID = "local-demo-project";

export const DEMO_FILES = [
  {
    path: "main.tex",
    type: "tex",
    content: `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{geometry}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{hyperref}
\\usepackage{physics}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{cleveref}

\\title{Quantum Entanglement Review}
\\author{A. Love}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
  This review summarizes foundational concepts, historical development, and recent advances in quantum entanglement, with emphasis on theory and experimental realizations.
\\end{abstract}

\\section{Introduction}
Quantum entanglement is a fundamental resource in quantum information science. As shown in \\cref{fig:epr}, entangled particles A and B exhibit correlations that cannot be explained by classical physics.

\\input{sections/01-introduction}
\\input{sections/02-background}

\\section{Entanglement}
\\subsection{Definitions}
An n-partite state is entangled if it cannot be written as a product of states of its individual components.

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`,
  },
  {
    path: "sections/01-introduction.tex",
    type: "tex",
    content: `% Section: Introduction
Quantum mechanics provides a unique perspective on local realism.`,
  },
  {
    path: "sections/02-background.tex",
    type: "tex",
    content: `% Section: Background
The EPR paradox was first discussed in 1935.`,
  },
  {
    path: "sections/03-methods.tex",
    type: "tex",
    content: `% Section: Methods
We utilize Bell inequalities to verify entanglement.`,
  },
  {
    path: "sections/04-results.tex",
    type: "tex",
    content: `% Section: Results
Experimental data shows a clear violation of local realism.`,
  },
  {
    path: "sections/05-conclusion.tex",
    type: "tex",
    content: `% Section: Conclusion
Entanglement remains the most mysterious feature of quantum theory.`,
  },
  {
    path: "figures/epr-paradox.pdf",
    type: "image",
    content: "data:application/pdf;base64,JVBERi0xLjAKMSAwIG9iajw8L1R5cGUvUGFnZXMvQ291bnQgMC9LaWRzW10+PmVuZG9iaiAyIDAgb2JqPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDEgMCBSPj5lbmRvYmogdHJhaWxlcjw8L1Jvb3QgMiAwIFI+PmVvZg==",
  },
  {
    path: "figures/quantum-circuit.png",
    type: "image",
    content: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  },
  {
    path: "references.bib",
    type: "bib",
    content: `@article{einstein1935can,
  title={Can quantum-mechanical description of physical reality be considered complete?},
  author={Einstein, Albert and Podolsky, Boris and Rosen, Nathan},
  journal={Physical review},
  volume={47},
  number={10},
  pages={777},
  year={1935},
  publisher={APS}
}`,
  },
  {
    path: "styles.sty",
    type: "tex",
    content: "% Custom styles",
  },
  {
    path: "macros.tex",
    type: "tex",
    content: "% Custom macros",
  },
];
