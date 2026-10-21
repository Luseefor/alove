import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCompileJob, __testOnly } from "../src/runCompile.ts";

const originalEnv = { ...process.env };
let fixtureDirectory;

afterEach(async () => {
  process.env = { ...originalEnv };
  if (fixtureDirectory)
    await rm(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = undefined;
});

function synctexText() {
  return [
    "SyncTeX Version:1",
    "Input:1:/work/main.tex",
    "Input:2:/work/sections/chap.tex",
    "Output:pdf",
    "Magnification:1000",
    "Unit:1",
    "X Offset:0",
    "Y Offset:0",
    "Content:",
    "{1",
    "[1,3:4736286,46220574:100,100,0",
    "x1,5:100,200",
    "}",
    "{2",
    "[2,1:100,200:100,100,0",
    "}",
    "Postamble:",
    "Count:4",
  ].join("\n");
}

async function installFakeLatexmk({ synctex = true } = {}) {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "alove-synctex-fixture-"));
  const executable = join(fixtureDirectory, "latexmk");
  const payload = synctexText();
  const gzBase64 = gzipSync(payload).toString("base64");
  await writeFile(
    executable,
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (!args.includes("-c")) {
  const name = args.at(-1);
  writeFileSync(name.replace(/\\.tex$/, ".pdf"), "%PDF-synctex-fixture");
  writeFileSync(name.replace(/\\.tex$/, ".log"), JSON.stringify(args));
  ${synctex ? `writeFileSync(name.replace(/\\.tex$/, ".synctex.gz"), Buffer.from(${JSON.stringify(gzBase64)}, "base64"));` : ""}
}
`,
  );
  await chmod(executable, 0o755);
  process.env.PATH = `${fixtureDirectory}:${dirname(process.execPath)}:${originalEnv.PATH}`;
  process.env.COMPILE_USE_DOCKER = "false";
  process.env.COMPILE_TRUSTED_LOCAL = "true";
}

describe("runCompile synctex", () => {
  it("emits the fixed synctex flag across engines", () => {
    expect(__testOnly.SYNCTEX_LATEX_OPTION).toBe("-latexoption=-synctex=1");
    expect(__testOnly.synctexRelPath("main.tex")).toBe("main.synctex.gz");
    expect(__testOnly.synctexRelPath("chapters/paper.tex")).toBe(
      "chapters/paper.synctex.gz",
    );
  });

  it("passes -latexoption=-synctex=1 to latexmk for every engine", async () => {
    for (const engine of ["pdflatex", "xelatex", "lualatex"]) {
      await installFakeLatexmk();
      const result = await runCompileJob({
        projectId: "local",
        mainFile: "main.tex",
        engine,
        files: { "main.tex": "source" },
      });
      expect(result.phase).toBe("ready");
      const args = JSON.parse(result.log);
      expect(args).toContain("-latexoption=-synctex=1");
      expect(args).toContain("-no-shell-escape");
      expect(args).toContain("-norc");
    }
  });

  it("parses emitted synctex.gz into a bounded mapping with nested includes", async () => {
    await installFakeLatexmk();
    const result = await runCompileJob({
      projectId: "local",
      mainFile: "main.tex",
      files: { "main.tex": "root", "sections/chap.tex": "chapter" },
    });
    expect(result.phase).toBe("ready");
    expect(result.synctex?.version).toBe(1);
    expect(result.synctex?.truncated).toBe(false);
    const files = new Set(result.synctex?.entries.map((e) => e.file));
    expect(files.has("main.tex")).toBe(true);
    expect(files.has("sections/chap.tex")).toBe(true);
    expect(result.synctex?.entries.every((e) => e.page >= 1 && e.line >= 1)).toBe(
      true,
    );
  });

  it("succeeds without a mapping when the engine emits no synctex", async () => {
    await installFakeLatexmk({ synctex: false });
    const result = await runCompileJob({
      projectId: "local",
      mainFile: "main.tex",
      files: { "main.tex": "source" },
    });
    expect(result.phase).toBe("ready");
    expect(result.synctex).toBeUndefined();
  });

  it("caps entries and warns instead of failing the build", async () => {
    await installFakeLatexmk();
    process.env.COMPILE_MAX_SYNCTEX_ENTRIES = "1";
    const result = await runCompileJob({
      projectId: "local",
      mainFile: "main.tex",
      files: { "main.tex": "root", "sections/chap.tex": "chapter" },
    });
    expect(result.phase).toBe("ready");
    expect(result.synctex?.entries.length).toBe(1);
    expect(result.synctex?.truncated).toBe(true);
    expect(
      result.diagnostics.some((d) => d.message.includes("SyncTeX")),
    ).toBe(true);
  });

  it("resolves caps from env with protocol defaults", () => {
    delete process.env.COMPILE_MAX_SYNCTEX_BYTES;
    delete process.env.COMPILE_MAX_SYNCTEX_DECOMPRESSED_BYTES;
    delete process.env.COMPILE_MAX_SYNCTEX_ENTRIES;
    const caps = __testOnly.resolveSynctexCaps();
    expect(caps.maxCompressedBytes).toBe(5242880);
    expect(caps.maxDecompressedBytes).toBe(5242880);
    expect(caps.maxEntries).toBe(20000);
  });
});
