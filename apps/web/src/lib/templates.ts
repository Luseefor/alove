export const TEMPLATES = {
  minimal: {
    label: "Minimal article",
    files: {
      "main.tex": `\\documentclass{article}
\\begin{document}
\\section{Intro}
Start writing here.
\\end{document}
`,
    },
    mainFile: "main.tex",
  },
  bib: {
    label: "Article + BibTeX",
    files: {
      "main.tex": `\\documentclass{article}
\\bibliographystyle{plain}
\\begin{document}
See \\cite{example} for a citation.

\\bibliography{refs}
\\end{document}
`,
      "refs.bib": `@article{example,
  title={Example},
  author={Author},
  journal={Journal},
  year={2024}
}
`,
    },
    mainFile: "main.tex",
  },
} as const;

export type TemplateId = keyof typeof TEMPLATES;
