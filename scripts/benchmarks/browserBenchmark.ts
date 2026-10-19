import { createRequire } from "node:module";
const { chromium } = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)(
  "@playwright/test",
) as typeof import("../../apps/web/node_modules/@playwright/test");
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

const root = resolve(import.meta.dir, "../..");
const output = resolve(
  process.env.BENCH_BROWSER_OUTPUT ??
    join(root, "benchmark-results/browser.json"),
);
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30127";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Local benchmark only");
const temporary = await mkdtemp(join(tmpdir(), "alove-browser-bench-"));
const entry = join(temporary, "entry.ts");
await writeFile(
  entry,
  `import {hashBuildSource,createBuildRecord} from ${JSON.stringify(join(root, "apps/web/src/lib/buildRecord.ts"))};
import {compareBuildFiles} from ${JSON.stringify(join(root, "apps/web/src/lib/buildRecoveryCandidates.ts"))};
import {createBuildRecordRepository} from ${JSON.stringify(join(root, "apps/web/src/lib/buildRecordRepository.ts"))};
Object.assign(window,{aloveBenchmark:{hashBuildSource,createBuildRecord,compareBuildFiles,createBuildRecordRepository}});`,
);
const build = await Bun.build({
  entrypoints: [entry],
  target: "browser",
  format: "iife",
  minify: false,
});
if (!build.success) throw new Error(String(build.logs));
const browser = await chromium.launch();
const evidence: Record<string, unknown> = {
  schema: 1,
  completed: false,
  measuredAt: new Date().toISOString(),
  browser: browser.version(),
  viewport: { width: 1440, height: 900 },
};
const save = async () => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
};
let stage = "processing";
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(base + "/editor?new=true");
  await page.getByRole("textbox", { name: "LaTeX source editor" }).waitFor();
  await page.addScriptTag({ content: await build.outputs[0].text() });
  const processing = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        aloveBenchmark: {
          hashBuildSource: (input: unknown) => Promise<string>;
          createBuildRecord: (...args: unknown[]) => Promise<{ id: string }>;
          compareBuildFiles: (a: unknown, b: unknown) => unknown;
          createBuildRecordRepository: (
            factory: IDBFactory,
            name: string,
          ) => {
            save: (record: unknown) => Promise<void>;
            list: (id: string) => Promise<unknown[]>;
          };
        };
      }
    ).aloveBenchmark;
    const results = [];
    for (const bytes of [10240, 102400, 1048576, 10485760]) {
      const files: Record<string, string> = {};
      let remaining = bytes,
        part = 0;
      while (remaining > 0) {
        const size = Math.min(remaining, 1048576);
        files[part++ === 0 ? "main.tex" : `part-${part}.tex`] = "x".repeat(
          size,
        );
        remaining -= size;
      }
      const input = {
        files,
        mainFile: "main.tex",
        engine: "pdflatex",
        cleanAux: false,
      };
      const after = {
        ...files,
        "main.tex": files["main.tex"].slice(0, -1) + "y",
      };
      const hashMs: number[] = [],
        diffMs: number[] = [],
        saveMs: number[] = [],
        listMs: number[] = [];
      await api.hashBuildSource(input); // explicitly excluded warm-up
      for (let i = 0; i < (bytes >= 1048576 ? 20 : 100); i++) {
        let timer = performance.now();
        await api.hashBuildSource(input);
        hashMs.push(performance.now() - timer);
        timer = performance.now();
        api.compareBuildFiles(files, after);
        diffMs.push(performance.now() - timer);
      }
      const name = "alove-benchmark-" + crypto.randomUUID();
      const repository = api.createBuildRecordRepository(indexedDB, name);
      for (let i = 0; i < 5; i++) {
        const record = await api.createBuildRecord(
          { ...input, projectId: "benchmark" },
          {
            phase: "failed",
            log: "synthetic processing fixture",
            diagnostics: [],
          },
          i,
          Date.now(),
        );
        let timer = performance.now();
        await repository.save(record);
        saveMs.push(performance.now() - timer);
        timer = performance.now();
        await repository.list("benchmark");
        listMs.push(performance.now() - timer);
      }
      await new Promise<void>((res, rej) => {
        const q = indexedDB.deleteDatabase(name);
        q.onsuccess = () => res();
        q.onerror = () => rej(q.error);
      });
      results.push({
        bytes,
        fileCount: Object.keys(files).length,
        hashMs,
        diffMs,
        saveMs,
        listMs,
      });
    }
    return results;
  });
  evidence.processing = processing;
  await save();
  const typing = [];
  evidence.typing = typing;
  const editor = page.getByRole("textbox", { name: "LaTeX source editor" });
  for (const bytes of [10240, 102400, 1048576]) {
    stage = `typing-${bytes}`;
    console.log(`Browser typing preparation: ${bytes} bytes`);
    const text =
      "% BENCH_SOURCE_START\n" +
      "% Synthetic source line for typing latency.\n"
        .repeat(Math.ceil(bytes / 44))
        .slice(0, bytes);
    const loadStart = performance.now();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Import Source as New Project" })
      .click();
    await page
      .getByLabel("Import project source")
      .setInputFiles({
        name: "typing.alove.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            format: "alove-project",
            version: 1,
            title: `Typing benchmark ${bytes}`,
            mainFile: "main.tex",
            files: { "main.tex": text },
          }),
        ),
      });
    await page
      .getByText(`Typing benchmark ${bytes}`, { exact: true })
      .first()
      .waitFor();
    await editor.waitFor();
    const importMs = performance.now() - loadStart;
    await page.waitForTimeout(650);
    await editor.click();
    await editor.press("Control+Home");
    await page.evaluate(() => {
      (window as unknown as { keyFrames: number[] }).keyFrames = [];
      document.addEventListener(
        "keydown",
        () => {
          const start = performance.now();
          requestAnimationFrame(() => {
            (window as unknown as { keyFrames: number[] }).keyFrames.push(
              performance.now() - start,
            );
          });
        },
        { capture: true },
      );
    });
    for (let i = 0; i < 20; i++) {
      await editor.press("a");
      await page.waitForTimeout(40);
    }
    const keyToFrameMs = await page.evaluate(
      () => (window as unknown as { keyFrames: number[] }).keyFrames,
    );
    if (keyToFrameMs.length !== 20)
      throw new Error(
        `Expected 20 frame callbacks, received ${keyToFrameMs.length}`,
      );
    typing.push({
      bytes: Buffer.byteLength(text),
      importMs,
      samples: keyToFrameMs,
    });
    await save();
    // Reload removes measurement listeners; source persists in this fresh browser context only.
    await page.waitForTimeout(650);
    await page.reload();
    await editor.waitFor();
  }
  evidence.methodology = {
    processing:
      "Actual production helpers bundled for isolated Chromium. Synthetic source processing/storage, not TeX compilation. Hash/diff warm-up excluded. Five sequential IDB writes include DB creation on first save and default retention; report first save separately.",
    typing:
      "Actual CodeMirror UI via project import; 20 keyboard events per size spaced by at least 40 ms. keydown capture to next animation frame, NOT INP/paint completion or burst typing. Initial import/autosave settled; editing/autosave enabled.",
  };
  evidence.completed = true;
  await save();
  console.log(`Browser benchmark: ${output}`);
} catch (error) {
  evidence.error = {
    stage,
    name: error instanceof Error ? error.name : "Error",
    message:
      error instanceof Error ? error.message.split("\n")[0] : String(error),
  };
  await save();
  throw new Error(`Browser benchmark failed at ${stage}; see ${output}`);
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
