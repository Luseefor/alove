export type ProjectFile = {
  id: string;
  name: string;
  path: string;
  type: "tex" | "bib" | "sty" | "image" | "pdf" | "markdown" | "folder";
  content?: string;
  modified?: boolean;
  children?: ProjectFile[];
};

export type CompileRequest = {
  projectId: string;
  rootFile: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
  nonstopmode: boolean;
};

export type CompileDiagnostic = {
  id: string;
  severity: "error" | "warning" | "info";
  file: string;
  line?: number;
  column?: number;
  message: string;
  source: "latex" | "bibtex" | "system";
};

export type CompileResult = {
  ok: boolean;
  pdfUrl?: string;
  log: string;
  diagnostics: CompileDiagnostic[];
  pageCount?: number;
  durationMs: number;
};
