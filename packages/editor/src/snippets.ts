import {
  autocompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";

const latexSnippets: readonly Completion[] = [
  { label: "\\begin{itemize}", apply: "\\begin{itemize}\n\\item \n\\end{itemize}" },
  { label: "\\begin{enumerate}", apply: "\\begin{enumerate}\n\\item \n\\end{enumerate}" },
  { label: "\\begin{figure}", apply: "\\begin{figure}\n\\centering\n\\includegraphics[width=\\linewidth]{}\n\\caption{}\n\\label{fig:}\n\\end{figure}" },
  { label: "\\begin{equation}", apply: "\\begin{equation}\n  \n\\end{equation}" },
  { label: "\\section{}", apply: "\\section{}" },
  { label: "\\subsection{}", apply: "\\subsection{}" },
  { label: "\\textbf{}", apply: "\\textbf{}" },
  { label: "\\emph{}", apply: "\\emph{}" },
  { label: "\\cite{}", apply: "\\cite{}" },
  { label: "\\ref{}", apply: "\\ref{}" },
  { label: "\\label{}", apply: "\\label{}" },
  { label: "\\includegraphics{}", apply: "\\includegraphics[width=\\linewidth]{}" },
  { label: "\\input{}", apply: "\\input{}" },
  { label: "\\include{}", apply: "\\include{}" },
];

function latexCompletionSource(ctx: CompletionContext) {
  const word = ctx.matchBefore(/\\?\w*$/u);
  if (!word && !ctx.explicit) return null;
  const from = word ? word.from : ctx.pos;
  const filter = (word ? word.text : "").replace(/^\\/u, "").toLowerCase();
  const options = latexSnippets.filter((c) =>
    c.label.toLowerCase().includes(filter),
  );
  if (!options.length) return null;
  return { from, options };
}

export const latexAutocomplete = autocompletion({
  override: [latexCompletionSource],
  activateOnTyping: true,
});
