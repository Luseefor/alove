/**
 * Starts Next in local standalone mode on the first free TCP port from
 * ALOVE_WEB_PORT (default 30127) up to +80, skipping common reserved ports.
 */
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

/** Next.js and other tooling reject or bind these by convention. */
const SKIP_PORTS = new Set([
  0, 1, 20, 21, 22, 25, 53, 80, 110, 143, 443, 445, 465, 587, 853, 993, 995,
  2049, 3000, 3001, 3002, 3003, 3306, 3389, 5000, 5001, 5432, 5433, 5600, 5678,
  5900, 6000, 6379, 8000, 8080, 8443, 9000, 9200,
]);

/** True if something accepts TCP on 127.0.0.1 (port not free for Next). */
function tcpPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const finish = (occupied: boolean) => {
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ECONNREFUSED") finish(false);
      else finish(false);
    });
  });
}

async function pickPort(): Promise<number> {
  const raw = process.env.ALOVE_WEB_PORT;
  const base = Math.floor(Number(raw ?? "30127"));
  const start = Number.isFinite(base) && base > 0 ? base : 30127;

  for (let i = 0; i < 80; i += 1) {
    const port = start + i;
    if (port > 65535) break;
    if (SKIP_PORTS.has(port)) continue;
    if (!(await tcpPortOccupied(port))) return port;
  }
  throw new Error(
    `No free port found starting at ${start} (set ALOVE_WEB_PORT to a different base).`,
  );
}

const port = await pickPort();

console.error(
  `\n\x1b[36m[alove]\x1b[0m Local standalone → \x1b[1mhttp://127.0.0.1:${port}/editor\x1b[0m\n`,
);

const proc = Bun.spawn({
  cmd: ["bunx", "next", "dev", "--turbopack", "-p", String(port)],
  cwd: webRoot,
  env: { ...process.env, NEXT_PUBLIC_LOCAL_STANDALONE: "true" },
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const code = await proc.exited;
process.exit(code ?? 1);
