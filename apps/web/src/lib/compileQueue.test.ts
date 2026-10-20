// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const queues = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@alove/queue", () => ({ createCompileQueue: queues.create }));

afterEach(() => { delete (globalThis as { compileQueue?: unknown }).compileQueue; vi.resetModules(); vi.clearAllMocks(); });
describe("web queue recovery", () => {
  it("replaces a disconnected cached producer after Redis returns", async () => {
    const firstClient = new EventEmitter();
    const first = { client: Promise.resolve(firstClient), waitUntilReady: () => Promise.resolve(), close: vi.fn(async () => {}) };
    const second = { client: Promise.resolve(new EventEmitter()), waitUntilReady: () => Promise.resolve(), close: vi.fn(async () => {}) };
    queues.create.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { getCompileQueue } = await import("./compileQueue");
    expect(getCompileQueue()).toBe(first);
    await Promise.resolve();
    firstClient.emit("end");
    expect(first.close).toHaveBeenCalledOnce();
    expect(getCompileQueue()).toBe(second);
    expect(queues.create).toHaveBeenCalledTimes(2);
  });
  it("allows a later request to retry an initial connection failure", async () => {
    const broken = { client: Promise.resolve(new EventEmitter()), waitUntilReady: () => Promise.reject(new Error("connection unavailable")), close: vi.fn(async () => {}) };
    const fresh = { client: Promise.resolve(new EventEmitter()), waitUntilReady: () => Promise.resolve(), close: vi.fn(async () => {}) };
    queues.create.mockReturnValueOnce(broken).mockReturnValueOnce(fresh);
    const { getCompileQueue } = await import("./compileQueue");
    getCompileQueue();
    await Promise.resolve(); await Promise.resolve();
    expect(getCompileQueue()).toBe(fresh);
  });
});
