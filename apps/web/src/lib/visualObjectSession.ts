import { parseVisualDocument, canEditVisualRange } from "@alove/editor";
import { applyVisualSourcePatches, type VisualObject } from "./visualObjects";
import { readTexGroup, type VisualSourcePatch } from "./visualObjectTypes";

export type VisualObjectTarget = {
  object: VisualObject;
  source: string;
  projectId: string;
  fileId: string;
  revision: number;
  insertion: number | null;
};
export function isVisualObjectCurrent(
  target: VisualObjectTarget,
  current: {
    projectId: string | null;
    activeFileId: string | null;
    documentRevision: number;
    filesByPath: Record<string, string>;
    projectRole?: string | null;
  },
  editorSource: string | undefined,
): boolean {
  return (
    current.projectRole !== "viewer" &&
    current.projectId === target.projectId &&
    current.activeFileId === target.fileId &&
    current.documentRevision === target.revision &&
    current.filesByPath[target.fileId] === target.source &&
    editorSource === target.source
  );
}
export function objectSourcePatches(
  target: VisualObjectTarget,
  edits: VisualSourcePatch[],
): VisualSourcePatch[] {
  const object = target.object;
  if (target.insertion === null) {
    if (target.source.slice(object.from, object.to) !== object.source)
      throw new Error("The object changed. Reopen its editor.");
    applyVisualSourcePatches(target.source, edits, object);
    return edits;
  }
  if (!canEditVisualRange(target.source, target.insertion))
    throw new Error("Choose an editable paragraph in Visual first.");
  const fragment = applyVisualSourcePatches(object.source, edits);
  const block =
    object.kind === "table" ||
    object.kind === "figure" ||
    (object.kind === "math" && /^\\\[|^\$\$|^\\begin/.test(fragment));
  const eol = target.source.includes("\r\n") ? "\r\n" : "\n";
  return [
    {
      from: target.insertion,
      to: target.insertion,
      insert: block ? `${eol}${eol}${fragment}${eol}${eol}` : fragment,
    },
  ];
}
export function visualPackageSetup(
  source: string,
  packageName: string,
): {
  present: boolean;
  insertion: number | null;
} {
  const model = parseVisualDocument(source);
  if (model.limited || model.body.from === model.body.to)
    return { present: false, insertion: null };
  const preamble = source.slice(0, model.body.from);
  let present = false;
  // Inspect top-level setup commands, never package-shaped text in macro arguments.
  for (let i = 0; i < preamble.length; ) {
    if (preamble[i] === "%") {
      const end = preamble.indexOf("\n", i);
      i = end < 0 ? preamble.length : end + 1;
      continue;
    }
    if (preamble[i] === "{") {
      const group = readTexGroup(preamble, i);
      if (!group) break;
      i = group.to;
      continue;
    }
    if (preamble[i] === "\\") {
      const command =
        /^\\(?:usepackage|RequirePackage)(?:\[[^\]\r\n]*\])?\{/.exec(
          preamble.slice(i),
        );
      if (command) {
        const group = readTexGroup(preamble, i + command[0].length - 1);
        if (!group) break;
        if (group.value.split(",").some((name) => name.trim() === packageName))
          present = true;
        i = group.to;
        continue;
      }
      i += /^\\[A-Za-z]+/.exec(preamble.slice(i))?.[0].length ?? 2;
      continue;
    }
    i++;
  }
  const begin = source.lastIndexOf("\\begin{document}", model.body.from);
  return { present, insertion: begin < 0 ? null : begin };
}

export function graphicxSetup(source: string) {
  return visualPackageSetup(source, "graphicx");
}
