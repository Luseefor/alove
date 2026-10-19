export type EditorMode = "codemirror" | "textarea";

function isExplicitEditorMode(value: string | undefined): value is EditorMode {
  return value === "codemirror" || value === "textarea";
}

export function getEditorMode(): EditorMode {
  const explicitMode = process.env.NEXT_PUBLIC_EDITOR_MODE;
  if (isExplicitEditorMode(explicitMode)) return explicitMode;

  const legacyFlag = process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR;
  if (legacyFlag === "false" || legacyFlag === "0") return "textarea";
  if (legacyFlag === "true" || legacyFlag === "1") return "codemirror";

  return "codemirror";
}
