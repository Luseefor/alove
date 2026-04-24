export interface InputRef {
  path: string;
  from: number;
  to: number;
}

const inputRe = /\\(?:input|include)(?:\[[^\]]*\])?\{([^}]+)\}/gu;

export function parseInputRefs(doc: string): InputRef[] {
  const out: InputRef[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(inputRe.source, inputRe.flags);
  while ((m = re.exec(doc)) !== null) {
    const path = m[1]!.trim();
    out.push({ path, from: m.index, to: m.index + m[0].length });
  }
  return out;
}
