import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { parseSyncTex } from "../src/synctex.ts";

// Trusted toolchain only (latexmk + synctex CLI from the runner image).
// No project source reaches a shell: the fixture is fixed text.
const IMAGE = process.env.COMPILE_DOCKER_IMAGE ?? "alove-tex:local";
const ENABLED = process.env.SYNCTEX_FIXTURE_CHECK === "1";

function dockerAvailable() {
  // NOTE: `docker image inspect <name>` is unreliable against this daemon
  // (Desktop containerd store answers run/pull but not inspect-by-name),
  // so probe via the listing instead of inspect.
  const check = spawnSync("docker", ["images", "-q", IMAGE], {
    encoding: "utf8",
    timeout: 15000,
  });
  return check.status === 0 && check.stdout.trim().length > 0;
}

function fixtureScript(engineFlag) {
  return [
    "set -e",
    "D=$(mktemp -d)",
    "mkdir -p $D/sections",
    "cd $D",
    `printf '%s\\n' '\\documentclass{article}' '\\begin{document}' 'Hello SyncTeX world.' '\\input{sections/chap}' '\\newpage' 'Second page here.' '\\end{document}' > main.tex`,
    `printf '%s\\n' 'Nested chapter line one.' '' 'Nested chapter line two.' > sections/chap.tex`,
    `latexmk -norc ${engineFlag} -no-shell-escape -interaction=nonstopmode -halt-on-error -latexoption="-synctex=1" ./main.tex >/dev/null 2>&1`,
    "echo '---PREAMBLE---'",
    "gzip -dc main.synctex.gz | grep -E '^(Magnification|Unit|X Offset|Y Offset):'",
    "echo '---VIEW3---'",
    "synctex view -i '3:0:./main.tex' -o main.pdf | grep -E '^(Page|x|y|h|v):'",
    "echo '---CHAP1---'",
    "synctex view -i '1:0:./sections/chap.tex' -o main.pdf | grep -E '^(Page|x|y|h|v):'",
    "echo '---BLOB---'",
    "base64 -w0 main.synctex.gz",
    "echo",
    "rm -rf $D",
  ].join("\n");
}

function runFixture(engineFlag) {
  const run = spawnSync(
    "docker",
    ["run", "--rm", "--platform", "linux/amd64", IMAGE, "sh", "-c", fixtureScript(engineFlag)],
    { encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(`fixture failed: ${run.stderr.slice(-2000)}`);
  return run.stdout;
}

function section(stdout, name) {
  const parts = stdout.split(`---${name}---\n`);
  if (parts.length < 2) throw new Error(`missing section ${name}`);
  return parts[1].split("---")[0].trim();
}

function cliCoords(block) {
  const out = {};
  for (const line of block.split("\n")) {
    const m = /^(Page|x|y|h|v):([\d.]+)$/.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

const TOLERANCE_BP = 0.01;

describe("synctex container fixtures", () => {
  for (const [engine, flag] of [["pdflatex", "-pdf"], ["xelatex", "-xelatex"], ["lualatex", "-lualatex"]]) {
    it(`matches synctex CLI coordinates for ${engine}`, () => {
      if (!ENABLED) {
        console.log("skip: set SYNCTEX_FIXTURE_CHECK=1 with the runner image available");
        return;
      }
      if (!dockerAvailable()) throw new Error(`Docker image ${IMAGE} must be ready`);
      const stdout = runFixture(flag);
      const gz = Buffer.from(section(stdout, "BLOB").replace(/\s+/g, ""), "base64");
      const mapping = parseSyncTex(gunzipSync(gz).toString("utf8"), {
        knownFiles: ["main.tex", "sections/chap.tex"],
      });
      expect(mapping.entries.length).toBeGreaterThan(10);
      const k = (mapping.preamble.unit * 1000) / (65781.76 * mapping.preamble.magnification);
      const toBp = (v, off) => (v + off) * k;
      if (engine === "xelatex") {
        expect(mapping.preamble.xOffset).toBeGreaterThan(0);
        expect(mapping.preamble.yOffset).toBeGreaterThan(0);
      } else {
        expect(mapping.preamble.xOffset).toBe(0);
        expect(mapping.preamble.yOffset).toBe(0);
      }
      const view3 = cliCoords(section(stdout, "VIEW3"));
      const hBox = mapping.entries.find(
        (e) => e.file === "main.tex" && e.line === 3 && (e.width ?? 0) > 0,
      );
      expect(hBox).toBeDefined();
      expect(toBp(hBox.x, mapping.preamble.xOffset)).toBeCloseTo(view3.h, 2);
      expect(Math.abs(toBp(hBox.x, mapping.preamble.xOffset) - view3.h)).toBeLessThan(TOLERANCE_BP);
      const chap = mapping.entries.find((e) => e.file === "sections/chap.tex" && e.line === 1);
      const chapView = cliCoords(section(stdout, "CHAP1"));
      expect(chap).toBeDefined();
      expect(chapView.x).toBeDefined();
      expect(chapView.y).toBeDefined();
      // First visible anchor for the included line matches the CLI x/y.
      expect(Math.abs(toBp(chap.x, mapping.preamble.xOffset) - chapView.x)).toBeLessThan(TOLERANCE_BP);
      expect(Math.abs(toBp(chap.y, mapping.preamble.yOffset) - chapView.y)).toBeLessThan(TOLERANCE_BP);
    }, 180000);
  }
});
