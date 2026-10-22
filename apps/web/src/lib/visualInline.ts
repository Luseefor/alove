import {
  isVisualTexKey,
  readTexGroup,
  type VisualObjectBase,
  type VisualSourcePatch,
} from "./visualObjectTypes";
export type VisualMath = VisualObjectBase & {
  kind: "math";
  tex: string;
  display: boolean;
  numbered: boolean;
  contentFrom: number;
  contentTo: number;
  eol: string;
};
export type VisualCitation = VisualObjectBase & {
  kind: "citation" | "reference";
  command: string;
  keys: string[];
  keyFrom: number;
  keyTo: number;
  commandFrom: number;
  commandTo: number;
};
export const CITE_COMMANDS = [
  "cite",
  "citep",
  "citet",
  "citeauthor",
  "citeyear",
  "autocite",
  "parencite",
  "textcite",
];
export const REF_COMMANDS = ["ref", "eqref", "autoref", "cref", "Cref"];
function validMath(tex: string): boolean {
  if (
    !tex.trim() ||
    tex.length > 8192 ||
    /\\(?:end\{(?:equation\*?|document)\}|[)\]])/.test(tex)
  )
    return false;
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === "\\") {
      i++;
      continue;
    }
    if (tex[i] === "$") return false;
  }
  return true;
}
export function parseVisualMath(
  fragment: string,
  from = 0,
  contextEol = "\n",
): VisualMath | null {
  if (fragment.length > 10000) return null;
  let a = 0,
    b = fragment.length,
    display = false,
    numbered = false;
  if (
    fragment.startsWith("$$") &&
    fragment.endsWith("$$") &&
    fragment.length >= 4
  ) {
    a = 2;
    b -= 2;
    display = true;
  } else if (
    fragment.startsWith("$") &&
    fragment.endsWith("$") &&
    fragment.length >= 2
  ) {
    a = 1;
    b--;
  } else if (fragment.startsWith("\\(") && fragment.endsWith("\\)")) {
    a = 2;
    b -= 2;
  } else if (fragment.startsWith("\\[") && fragment.endsWith("\\]")) {
    a = 2;
    b -= 2;
    display = true;
  } else {
    const env = /^\\begin\{(equation\*?)\}/.exec(fragment);
    if (!env || !fragment.endsWith(`\\end{${env[1]}}`)) return null;
    a = env[0].length;
    b -= `\\end{${env[1]}}`.length;
    display = true;
    numbered = env[1] === "equation";
  }
  const inner = fragment.slice(a, b),
    lead = inner.length - inner.trimStart().length,
    trail = inner.length - inner.trimEnd().length;
  const tex = inner.trim();
  if (!validMath(tex)) return null;
  return {
    kind: "math",
    from,
    to: from + fragment.length,
    source: fragment,
    tex,
    display,
    numbered,
    contentFrom: from + a + lead,
    contentTo: from + b - trail,
    eol: fragment.includes("\r\n") ? "\r\n" : contextEol,
  };
}
export function createVisualMath(
  tex = "x^2",
  display = false,
  eol = "\n",
): string {
  if (!validMath(tex))
    throw new Error(
      "Use up to 8 Ki characters of math without outer delimiters.",
    );
  const body = tex.replace(/\r?\n/g, eol);
  return display ? `\\[${eol}${body}${eol}\\]` : `\\(${body}\\)`;
}
export function patchesForVisualMath(
  model: VisualMath,
  draft: { tex: string; display: boolean },
): VisualSourcePatch[] {
  if (!validMath(draft.tex))
    throw new Error(
      "Use up to 8 Ki characters of math without outer delimiters.",
    );
  if (draft.display !== model.display) {
    if (model.numbered || /\\label\b/.test(model.tex))
      throw new Error(
        "Change numbered or labelled equation environments in Source.",
      );
    return [
      {
        from: model.from,
        to: model.to,
        insert: createVisualMath(draft.tex, draft.display, model.eol),
      },
    ];
  }
  return draft.tex === model.tex
    ? []
    : [
        {
          from: model.contentFrom,
          to: model.contentTo,
          insert: draft.tex.replace(/\r?\n/g, model.eol),
        },
      ];
}
export function parseVisualCitation(
  fragment: string,
  from = 0,
): VisualCitation | null {
  if (fragment.length > 8192) return null;
  const cmd = /^\\([A-Za-z]+)\*?/.exec(fragment);
  if (
    !cmd ||
    (!CITE_COMMANDS.includes(cmd[1]!) && !REF_COMMANDS.includes(cmd[1]!))
  )
    return null;
  let i = cmd[0].length,
    opts = 0;
  while (/\s/.test(fragment[i] ?? "") && i < fragment.length) i++;
  while (fragment[i] === "[") {
    if (++opts > 2 || REF_COMMANDS.includes(cmd[1]!)) return null;
    let depth = 1;
    i++;
    while (i < fragment.length && depth) {
      if (fragment[i] === "\\") {
        i += 2;
        continue;
      }
      if (fragment[i] === "{") {
        const group = readTexGroup(fragment, i);
        if (!group) return null;
        i = group.to;
        continue;
      }
      if (fragment[i] === "[") depth++;
      if (fragment[i] === "]") depth--;
      i++;
    }
    if (depth) return null;
    while (i < fragment.length && /\s/.test(fragment[i]!)) i++;
  }
  const group = readTexGroup(fragment, i);
  if (!group || group.to !== fragment.length) return null;
  const keys = group.value.split(",").map((k) => k.trim());
  if (
    !keys.length ||
    keys.length > 20 ||
    keys.some((key) => !isVisualTexKey(key))
  )
    return null;
  return {
    kind: REF_COMMANDS.includes(cmd[1]!) ? "reference" : "citation",
    from,
    to: from + fragment.length,
    source: fragment,
    command: cmd[1]!,
    keys,
    keyFrom: from + group.contentFrom,
    keyTo: from + group.contentTo,
    commandFrom: from + 1,
    commandTo: from + 1 + cmd[1]!.length,
  };
}
export function createVisualCitation(
  keys: string[],
  kind: "citation" | "reference" = "citation",
): string {
  if (!keys.length || keys.length > 20 || keys.some((k) => !isVisualTexKey(k)))
    throw new Error("Choose up to 20 valid project keys.");
  return `\\${kind === "citation" ? "cite" : "ref"}{${keys.join(",")}}`;
}
export function patchesForVisualCitation(
  model: VisualCitation,
  draft: { keys: string[]; command?: string },
): VisualSourcePatch[] {
  const command = draft.command ?? model.command;
  if (
    !draft.keys.length ||
    draft.keys.length > 20 ||
    draft.keys.some((key) => !isVisualTexKey(key)) ||
    (model.kind === "reference" &&
      !["cref", "Cref"].includes(command) &&
      draft.keys.length !== 1) ||
    !(model.kind === "citation" ? CITE_COMMANDS : REF_COMMANDS).includes(
      command,
    )
  )
    throw new Error(
      "Choose valid citation/reference keys and a supported style.",
    );
  const patches: VisualSourcePatch[] = [];
  if (draft.keys.join(",") !== model.keys.join(","))
    patches.push({
      from: model.keyFrom,
      to: model.keyTo,
      insert: draft.keys.join(","),
    });
  if (command !== model.command)
    patches.push({
      from: model.commandFrom,
      to: model.commandTo,
      insert: command,
    });
  return patches.sort((a, b) => a.from - b.from);
}
