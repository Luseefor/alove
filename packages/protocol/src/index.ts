export type BuildPhase = "queued" | "compiling" | "ready" | "failed";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface CompileJobPayload {
  projectId: string;
  mainFile: string;
  files: Record<string, string>;
  engine?: "pdflatex" | "lualatex" | "xelatex";
  /** Extra args passed to latexmk after engine flags (advanced). */
  latexmkExtraArgs?: string[];
  /** Run `latexmk -c` before the main build to drop aux files in the work dir. */
  cleanAux?: boolean;
  /** Wall-clock cap for the TeX process (ms). Default 120_000. */
  timeoutMs?: number;
  /** Recorded in responses for reproducibility messaging. */
  texliveImage?: string;
}

export interface CompileJobResult {
  phase: BuildPhase;
  log: string;
  diagnostics: Diagnostic[];
  pdfBase64?: string;
  mainPdfRelPath?: string;
  errorMessage?: string;
  texliveImage?: string;
  timedOut?: boolean;
}
