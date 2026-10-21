import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  createProjectCompletionSource,
  type ProjectLanguageIndex,
} from "./projectCompletion";

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

export type ProjectIndexGetter = () => ProjectLanguageIndex;
/**
 * Combined completion: project cite/ref keys take precedence inside
 * `\cite{...}` / `\ref{...}` braces, snippet commands elsewhere.
 */
export function createProjectAwareCompletionSource(
  getIndex?: ProjectIndexGetter,
): (ctx: CompletionContext) => CompletionResult | null {
  const projectSource = createProjectCompletionSource(
    getIndex ?? (() => ({ cites: [], labels: [] })),
  );
  return function projectAwareSource(
    ctx: CompletionContext,
  ): CompletionResult | null {
    return projectSource(ctx) ?? latexCompletionSource(ctx);
  };
}

export function createLatexAutocomplete(getIndex?: ProjectIndexGetter) {
  return autocompletion({
    override: [createProjectAwareCompletionSource(getIndex)],
    activateOnTyping: true,
  });
}

/**
 * Project-only completion source (no autocompletion wrapper): prefer
 * `createLatexAutocomplete` / `createProjectAwareCompletionSource`, which
 * combine project keys with snippet commands in a single `autocompletion`
 * extension. Mounting two `autocompletion()` extensions conflicts on the
 * shared `override` facet.
 */
export function createProjectCompletionExtension(
  cites: readonly ProjectLanguageIndex["cites"][number][],
  labels: readonly ProjectLanguageIndex["labels"][number][],
) {
  const snapshotCites = [...cites];
  const snapshotLabels = [...labels];
  return createProjectCompletionSource(() => ({
    cites: snapshotCites,
    labels: snapshotLabels,
  }));
}

export const latexAutocomplete = autocompletion({
  override: [latexCompletionSource],
  activateOnTyping: true,
});
