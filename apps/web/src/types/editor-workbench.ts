export type BuildUiState =
  | { kind: "idle" }
  | { kind: "queued"; jobId: string }
  | { kind: "running"; jobId: string }
  | { kind: "ready"; jobId: string; pdfDataUrl: string | null }
  | { kind: "failed"; jobId: string; message: string };

export type Engine = "pdflatex" | "xelatex" | "lualatex";
