import { createRequire } from "node:module";
const { chromium } = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)(
  "@playwright/test",
) as typeof import("../../apps/web/node_modules/@playwright/test");
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { summarize } from "./statistics";

const BASELINE_REF = "eed8107";
const BASELINE_PATH = "apps/web/src/lib/buildRecordRepository.ts";
const UPDATED_REL = "apps/web/src/lib/buildRecordRepository.ts";
const BUILD_RECORD_REL = "apps/web/src/lib/buildRecord.ts";
const SIZES = [1048576, 10485760] as const;
const ROUNDS = 5;
const SAVES_PER_VARIANT = 5;
const PROJECT_ID = "history-benchmark";

const GIT_TIMEOUT_MS = 15000;
const NAV_TIMEOUT_MS = 30000;
const VARIANT_EVALUATE_TIMEOUT_MS = 180000;
const OVERALL_TIMEOUT_MS = 900000;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
};
const positionalOutput = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
const output = resolve(
  flag("--output", positionalOutput ?? "benchmark-results/history-comparison.json"),
);
const baseUrl = flag("--base-url", process.env.E2E_BASE_URL ?? "http://127.0.0.1:30128");
const base = new URL(baseUrl);
if (!["127.0.0.1", "localhost"].includes(base.hostname))
  throw new Error("Local benchmark only");

const root = resolve(import.meta.dir, "../..");
const temporary = await mkdtemp(join(tmpdir(), "alove-history-compare-"));
const ownedDbNames: string[] = [];

type Variant = "baseline" | "updated";
type RoundResult = {
  round: number;
  order: Variant[];
  variants: Record<Variant, { dbName: string; saveMs: number[]; listMs: number[] }>;
};
type SizeResult = {
  bytes: number;
  fileCount: number;
  sourceBytes: number;
  rounds: RoundResult[];
  baseline: { firstSaveMs: number[]; laterSaveMs: number[]; listMs: number[] };
  updated: { firstSaveMs: number[]; laterSaveMs: number[]; listMs: number[] };
};

const evidence: Record<string, unknown> = {
  schema: 1,
  completed: false,
  measuredAt: new Date().toISOString(),
  baseUrl: base.href,
  baselineRef: BASELINE_REF,
  sizes: [...SIZES],
  roundsPerSize: ROUNDS,
  savesPerVariantRound: SAVES_PER_VARIANT,
};
const save = async () => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
};

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

let stage = "setup";
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;

  // Baseline source is the actual repository file at the pinned revision.
  const baselineSource = execFileSync("git", ["show", `${BASELINE_REF}:${BASELINE_PATH}`], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  }) as string;
  const baselineFile = join(temporary, "baseline-buildRecordRepository.ts");
  await writeFile(baselineFile, baselineSource);
  const updatedAbs = join(root, UPDATED_REL);
  const buildRecordAbs = join(root, BUILD_RECORD_REL);
  const updatedSource = await readFile(updatedAbs, "utf8");
  evidence.applicationRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    cwd: root,
  }).trim();
  evidence.sourceHashes = {
    baselineRef: BASELINE_REF,
    baselinePath: BASELINE_PATH,
    baselineSha256: sha256(baselineSource),
    updatedPath: UPDATED_REL,
    updatedSha256: sha256(updatedSource),
  };
  evidence.versions = { bun: Bun.version };
  await save();

  stage = "bundle";
  const entry = join(temporary, "entry.ts");
  await writeFile(
    entry,
    `import {createBuildRecord} from ${JSON.stringify(buildRecordAbs)};\n` +
      `import {createBuildRecordRepository as createUpdatedRepository} from ${JSON.stringify(updatedAbs)};\n` +
      `import {createBuildRecordRepository as createBaselineRepository} from ${JSON.stringify(baselineFile)};\n` +
      `Object.assign(window,{aloveHistoryComparison:{createBuildRecord,createBaselineRepository,createUpdatedRepository}});`,
  );
  const build = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife", minify: false });
  if (!build.success) throw new Error(String(build.logs));
  const bundleText = await build.outputs[0].text();
  await save();

  stage = "launch";
  // PLAYWRIGHT_BROWSERS_PATH from the environment is respected implicitly.
  browser = await chromium.launch({ timeout: NAV_TIMEOUT_MS });
  evidence.versions = { ...(evidence.versions as object), browser: browser.version() };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  await save();

  stage = "navigate";
  await page.goto(base.href + "editor?new=true", { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "LaTeX source editor" }).waitFor({ timeout: NAV_TIMEOUT_MS });
  await page.addScriptTag({ content: bundleText });
  await save();

  const sizes: SizeResult[] = [];
  evidence.sizes = sizes;
  evidence.methodology = {
    payload:
      "Synthetic ASCII source map segmented at max 1 MiB per file with main.tex first (same segmentation as the existing browser harness). File contents are 'x' repeats so UTF-8 bytes equal character count. Payloads are cloned per record via object spread with identical content.",
    pairing:
      "5 paired rounds per size (1 MiB, 10 MiB). Within each round both variants run 5 sequential save/list steps against an isolated fresh IndexedDB database; round order alternates baseline-first vs updated-first to control order effects.",
    retention:
      "Default repository retention applies (max 20 records / 50 MiB per project, newest plus newest-ok pinned); with 5 records per database no eviction is expected, but the growing-history retention scan runs inside every save after the first.",
    timingBoundary:
      "Each saveMs covers performance.now() immediately before/after await repository.save(record) only. Each listMs covers performance.now() immediately before/after await repository.list(projectId) only. Records are built with the actual createBuildRecord helper BEFORE the save timer (hashing excluded). firstSaveMs is index 0 of each round (includes IndexedDB creation); laterSaveMs is indices 1-4 (includes growing history plus retention scan). Per size/variant: n=5 first saves, n=20 later saves, n=25 lists; all raw samples retained.",
    isolation:
      "One fresh IndexedDB database per variant per round; only databases created by this script are deleted, with deleteDatabase awaited to onsuccess before proceeding.",
    scope:
      "IndexedDB storage comparison only. Not an API latency, TeX compilation, typing, INP, paint, or burst-typing measurement. No server load is applied.",
    timeouts: {
      gitMs: GIT_TIMEOUT_MS,
      navMs: NAV_TIMEOUT_MS,
      variantEvaluateMs: VARIANT_EVALUATE_TIMEOUT_MS,
      overallMs: OVERALL_TIMEOUT_MS,
    },
  };

  for (const bytes of SIZES) {
    if (Date.now() > deadline) throw new Error("Overall benchmark deadline exceeded");
    stage = `measure-${bytes}`;
    const fileCount = Math.ceil(bytes / 1048576);
    const sizeEntry: SizeResult = {
      bytes,
      fileCount,
      sourceBytes: bytes,
      rounds: [],
      baseline: { firstSaveMs: [], laterSaveMs: [], listMs: [] },
      updated: { firstSaveMs: [], laterSaveMs: [], listMs: [] },
    };
    sizes.push(sizeEntry);

    for (let round = 0; round < ROUNDS; round++) {
      if (Date.now() > deadline) throw new Error("Overall benchmark deadline exceeded");
      const order: Variant[] = round % 2 === 0 ? ["baseline", "updated"] : ["updated", "baseline"];
      const roundResult: RoundResult = {
        round: round + 1,
        order,
        variants: {} as RoundResult["variants"],
      };
      sizeEntry.rounds.push(roundResult);
      await save();

      for (const variant of order) {
        const dbName = `alove-history-${variant}-${bytes}-r${round + 1}-${randomUUID()}`;
        ownedDbNames.push(dbName);
        console.log(`History comparison: ${bytes} bytes round ${round + 1}/${ROUNDS} variant ${variant} (${order[0]} first)`);
        const measured = await withTimeout(
          page.evaluate(
            async ({ bytesArg, dbNameArg, variantArg }: { bytesArg: number; dbNameArg: string; variantArg: Variant }) => {
              const api = (
                window as unknown as {
                  aloveHistoryComparison: {
                    createBuildRecord: (...args: unknown[]) => Promise<unknown>;
                    createBaselineRepository: (
                      factory: IDBFactory,
                      name: string,
                    ) => { save: (r: unknown) => Promise<void>; list: (id: string) => Promise<unknown[]> };
                    createUpdatedRepository: (
                      factory: IDBFactory,
                      name: string,
                    ) => { save: (r: unknown) => Promise<void>; list: (id: string) => Promise<unknown[]> };
                  };
                }
              ).aloveHistoryComparison;
              const withOpTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
                let timer: ReturnType<typeof setTimeout> | undefined;
                const gate = new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
                });
                try {
                  return await Promise.race([p, gate]);
                } finally {
                  if (timer !== undefined) clearTimeout(timer);
                }
              };
              const files: Record<string, string> = {};
              let remaining = bytesArg;
              let part = 0;
              while (remaining > 0) {
                const size = Math.min(remaining, 1048576);
                files[part++ === 0 ? "main.tex" : `part-${part}.tex`] = "x".repeat(size);
                remaining -= size;
              }
              const factory = variantArg === "baseline" ? api.createBaselineRepository : api.createUpdatedRepository;
              const repository = factory(indexedDB, dbNameArg);
              const projectId = "history-benchmark";
              const saveMs: number[] = [];
              const listMs: number[] = [];
              try {
                for (let i = 0; i < 5; i++) {
                  const record = await withOpTimeout(
                    api.createBuildRecord(
                      { projectId, files: { ...files }, mainFile: "main.tex", engine: "pdflatex", cleanAux: false },
                      { phase: "failed", log: "synthetic history fixture", diagnostics: [] },
                      i,
                      Date.now(),
                    ),
                    60000,
                    "createBuildRecord",
                  );
                  let timer = performance.now();
                  await withOpTimeout(repository.save(record), 60000, "save");
                  saveMs.push(performance.now() - timer);
                  timer = performance.now();
                  await withOpTimeout(repository.list(projectId), 60000, "list");
                  listMs.push(performance.now() - timer);
                }
              } finally {
                await withOpTimeout(
                  new Promise<void>((resolveDelete, rejectDelete) => {
                    const req = indexedDB.deleteDatabase(dbNameArg);
                    req.onsuccess = () => resolveDelete();
                    req.onerror = () => rejectDelete(req.error ?? new Error("delete failed"));
                    req.onblocked = () => rejectDelete(new Error("delete blocked"));
                  }),
                  30000,
                  "deleteDatabase",
                );
              }
              return { saveMs, listMs };
            },
            { bytesArg: bytes, dbNameArg: dbName, variantArg: variant },
          ),
          VARIANT_EVALUATE_TIMEOUT_MS,
          `variant evaluate ${bytes}/${variant}/round-${round + 1}`,
        );
        if (
          !Array.isArray(measured.saveMs) ||
          measured.saveMs.length !== SAVES_PER_VARIANT ||
          !Array.isArray(measured.listMs) ||
          measured.listMs.length !== SAVES_PER_VARIANT ||
          [...measured.saveMs, ...measured.listMs].some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0)
        )
          throw new Error(`Invalid samples for ${bytes}/${variant}/round-${round + 1}`);
        roundResult.variants[variant] = { dbName, saveMs: measured.saveMs, listMs: measured.listMs };
        sizeEntry[variant].firstSaveMs.push(measured.saveMs[0]);
        sizeEntry[variant].laterSaveMs.push(...measured.saveMs.slice(1));
        sizeEntry[variant].listMs.push(...measured.listMs);
        await save();
      }
    }
  }

  evidence.summary = Object.fromEntries(
    sizes.map((s) => [
      String(s.bytes),
      Object.fromEntries(
        (["baseline", "updated"] as const).map((v) => [
          v,
          {
            firstSaveMs: summarize(s[v].firstSaveMs),
            laterSaveMs: summarize(s[v].laterSaveMs),
            listMs: summarize(s[v].listMs),
          },
        ]),
      ),
    ]),
  );
  evidence.completed = true;
  evidence.finishedAt = new Date().toISOString();
  await save();
  console.log(`History comparison: ${output}`);
} catch (error) {
  evidence.error = {
    stage,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message.split("\n")[0] : String(error),
  };
  evidence.completed = false;
  try {
    await save();
  } catch {
    /* ignore checkpoint failure */
  }
  throw new Error(`History comparison failed at ${stage}; see ${output}`);
} finally {
  if (browser !== null) await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
