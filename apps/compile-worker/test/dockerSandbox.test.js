import { describe, expect, it } from "bun:test";
import {
  dockerSandboxArgs,
  resolveDockerSandboxPolicy,
  sandboxPolicyId,
} from "../src/dockerSandbox.ts";

const DEFAULTS = {
  memoryMb: 1024,
  cpus: 1,
  pids: 64,
  workMb: 128,
  tmpMb: 128,
};

const IMAGE_ID = `sha256:${"a".repeat(64)}`;

function hasFlag(args, flag, value) {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  if (value === undefined) return true;
  return args[idx + 1] === value;
}

describe("resolveDockerSandboxPolicy defaults", () => {
  it("returns hardened defaults with empty env", () => {
    expect(resolveDockerSandboxPolicy({})).toEqual(DEFAULTS);
  });

  it("defaults when called with no argument", () => {
    expect(resolveDockerSandboxPolicy()).toEqual(DEFAULTS);
  });
});

describe("resolveDockerSandboxPolicy env overrides", () => {
  it("accepts each valid override", () => {
    expect(
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_MEMORY_MB: "2048" }),
    ).toMatchObject({ memoryMb: 2048 });
    expect(
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_CPUS: "2" }),
    ).toMatchObject({ cpus: 2 });
    expect(
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_CPUS: "0.25" }),
    ).toMatchObject({ cpus: 0.25 });
    expect(
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_PIDS: "32" }),
    ).toMatchObject({ pids: 32 });
    expect(
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_WORK_MB: "64" }),
    ).toMatchObject({ workMb: 64 });
    expect(
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_TMP_MB: "64" }),
    ).toMatchObject({ tmpMb: 64 });
  });

  it("accepts boundary values", () => {
    const policy = resolveDockerSandboxPolicy({
      COMPILE_SANDBOX_MEMORY_MB: "256",
      COMPILE_SANDBOX_CPUS: "0.25",
      COMPILE_SANDBOX_PIDS: "16",
      COMPILE_SANDBOX_WORK_MB: "16",
      COMPILE_SANDBOX_TMP_MB: "16",
    });
    expect(policy).toEqual({
      memoryMb: 256,
      cpus: 0.25,
      pids: 16,
      workMb: 16,
      tmpMb: 16,
    });
  });

  it("rejects non-numeric strings", () => {
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_MEMORY_MB: "lots" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_CPUS: "fast" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_PIDS: "many" }),
    ).toThrow();
  });

  it("rejects zero, Infinity, and out-of-range values", () => {
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_MEMORY_MB: "0" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_MEMORY_MB: "128" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_MEMORY_MB: "8192" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_MEMORY_MB: "Infinity" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_CPUS: "0" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_CPUS: "8" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_CPUS: "Infinity" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_PIDS: "0" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_PIDS: "512" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_WORK_MB: "0" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_WORK_MB: "1024" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_TMP_MB: "0" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_TMP_MB: "512" }),
    ).toThrow();
  });

  it("rejects fractional values for integer fields", () => {
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_MEMORY_MB: "1024.5" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_PIDS: "64.5" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_WORK_MB: "64.5" }),
    ).toThrow();
    expect(() =>
      resolveDockerSandboxPolicy({ COMPILE_SANDBOX_TMP_MB: "64.5" }),
    ).toThrow();
  });

  it("rejects tmpfs overflow: workMb + tmpMb + 16 > memoryMb - 128", () => {
    expect(() =>
      resolveDockerSandboxPolicy({
        COMPILE_SANDBOX_MEMORY_MB: "256",
        COMPILE_SANDBOX_WORK_MB: "128",
        COMPILE_SANDBOX_TMP_MB: "128",
      }),
    ).toThrow();
  });
});

describe("sandboxPolicyId", () => {
  it("is stable with v1 prefix and 64 hex chars", () => {
    const a = sandboxPolicyId(DEFAULTS);
    const b = sandboxPolicyId({ ...DEFAULTS });
    expect(a).toBe(b);
    expect(a.startsWith("alove-tex-sandbox-v1:")).toBe(true);
    const hex = a.slice("alove-tex-sandbox-v1:".length);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes identity when caps change", () => {
    const base = sandboxPolicyId(DEFAULTS);
    expect(sandboxPolicyId({ ...DEFAULTS, memoryMb: 2048 })).not.toBe(base);
    expect(sandboxPolicyId({ ...DEFAULTS, cpus: 2 })).not.toBe(base);
    expect(sandboxPolicyId({ ...DEFAULTS, pids: 32 })).not.toBe(base);
    expect(sandboxPolicyId({ ...DEFAULTS, workMb: 64 })).not.toBe(base);
    expect(sandboxPolicyId({ ...DEFAULTS, tmpMb: 64 })).not.toBe(base);
  });
});

describe("dockerSandboxArgs security posture", () => {
  const policy = { ...DEFAULTS };
  const base = {
    name: "alove-compile-test",
    sourcePath: "/data/src",
    imageId: IMAGE_ID,
    ttlSeconds: 600,
    policy,
  };

  it("starts with run --detach --rm --init --name and isolates network/user/caps", () => {
    const args = dockerSandboxArgs(base);
    expect(args[0]).toBe("run");
    expect(hasFlag(args, "--detach")).toBe(true);
    expect(hasFlag(args, "--rm")).toBe(true);
    expect(hasFlag(args, "--init")).toBe(true);
    expect(hasFlag(args, "--name", base.name)).toBe(true);
    expect(hasFlag(args, "--network", "none")).toBe(true);
    expect(hasFlag(args, "--user", "65532:65532")).toBe(true);
    expect(hasFlag(args, "--cap-drop", "ALL")).toBe(true);
    expect(hasFlag(args, "--security-opt", "no-new-privileges=true")).toBe(
      true,
    );
    expect(hasFlag(args, "--read-only")).toBe(true);
  });

  it("bounds memory, cpu, pids, shm, logging, and ulimits", () => {
    const args = dockerSandboxArgs(base);
    const memBytes = String(policy.memoryMb * 1024 * 1024);
    expect(hasFlag(args, "--memory", memBytes)).toBe(true);
    expect(hasFlag(args, "--memory-swap", memBytes)).toBe(true);
    expect(hasFlag(args, "--cpus", String(policy.cpus))).toBe(true);
    expect(hasFlag(args, "--pids-limit", String(policy.pids))).toBe(true);
    expect(hasFlag(args, "--shm-size", "16m")).toBe(true);
    expect(hasFlag(args, "--log-driver", "none")).toBe(true);
    expect(args).toContain("nofile=256:256");
    expect(args).toContain("fsize=67108864:67108864");
  });

  it("mounts source readonly and bounds /work + /tmp tmpfs with uid 65532", () => {
    const args = dockerSandboxArgs(base);
    const joined = args.join("\n");
    expect(joined).toContain(base.sourcePath);
    expect(joined).toContain("readonly");
    const tmpfsCount = args.filter((a) => a === "--tmpfs").length;
    expect(tmpfsCount).toBeGreaterThanOrEqual(2);
    for (const target of ["/work:", "/tmp:"]) {
      const entry = args.find(
        (a) => typeof a === "string" && a.startsWith(target),
      );
      expect(entry).toBeDefined();
      for (const opt of ["nosuid", "nodev", "noexec", "uid=65532"]) {
        expect(entry).toContain(opt);
      }
      expect(entry).toContain("size=");
    }
  });

  it("sets workdir, safe env, entrypoint sleep, image, and ttl", () => {
    const args = dockerSandboxArgs(base);
    expect(hasFlag(args, "--workdir", "/work")).toBe(true);
    expect(args).toContain("HOME=/tmp");
    expect(hasFlag(args, "--entrypoint", "sleep")).toBe(true);
    expect(args).toContain(base.imageId);
    expect(args).toContain(String(base.ttlSeconds));
  });

  it("passes platform through when provided", () => {
    const args = dockerSandboxArgs({ ...base, platform: "linux/amd64" });
    expect(hasFlag(args, "--platform", "linux/amd64")).toBe(true);
  });

  it("rejects non-sha256 image ids and bad names", () => {
    expect(() =>
      dockerSandboxArgs({ ...base, imageId: "configured-image:mutable" }),
    ).toThrow();
    expect(() => dockerSandboxArgs({ ...base, name: "evil;name" })).toThrow();
  });
});
