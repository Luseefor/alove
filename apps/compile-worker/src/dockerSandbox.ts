import { createHash } from "node:crypto";

export type DockerSandboxPolicy = {
  memoryMb: number;
  cpus: number;
  pids: number;
  workMb: number;
  tmpMb: number;
};

/** Invalid server settings must never disable a resource bound. */
export function resolveDockerSandboxPolicy(
  env: Record<string, string | undefined> = process.env,
): DockerSandboxPolicy {
  const number = (
    key: string,
    fallback: number,
    min: number,
    max: number,
    integer = true,
  ) => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (
      !/^\d+(?:\.\d+)?$/.test(raw) ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    ) {
      throw new Error(
        `${key} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`,
      );
    }
    return value;
  };
  const policy = {
    memoryMb: number("COMPILE_SANDBOX_MEMORY_MB", 1024, 256, 4096),
    cpus: number("COMPILE_SANDBOX_CPUS", 1, 0.25, 4, false),
    pids: number("COMPILE_SANDBOX_PIDS", 64, 16, 256),
    workMb: number("COMPILE_SANDBOX_WORK_MB", 128, 16, 512),
    tmpMb: number("COMPILE_SANDBOX_TMP_MB", 128, 16, 256),
  };
  if (policy.workMb + policy.tmpMb + 16 > policy.memoryMb - 128) {
    throw new Error(
      "Sandbox writable mounts must leave at least 128 MiB for TeX processes",
    );
  }
  return policy;
}

export function sandboxPolicyId(policy: DockerSandboxPolicy): string {
  const fields = [
    policy.memoryMb,
    policy.cpus,
    policy.pids,
    policy.workMb,
    policy.tmpMb,
  ];
  return `alove-tex-sandbox-v1:${createHash("sha256").update(JSON.stringify(fields)).digest("hex")}`;
}

export function dockerSandboxArgs(args: {
  name: string;
  sourcePath: string;
  imageId: string;
  platform?: string;
  ttlSeconds: number;
  policy: DockerSandboxPolicy;
}): string[] {
  const { name, sourcePath, imageId, platform, ttlSeconds, policy } = args;
  if (
    !/^sha256:[a-f0-9]{64}$/.test(imageId) ||
    !/^alove-compile-[a-zA-Z0-9-]+$/.test(name) ||
    !sourcePath.startsWith("/") ||
    /[,\0]/.test(sourcePath) ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1
  ) {
    throw new Error("Invalid server sandbox arguments");
  }
  const memory = String(policy.memoryMb * 1024 * 1024);
  return [
    "run",
    "--detach",
    "--rm",
    "--init",
    "--name",
    name,
    ...(platform ? ["--platform", platform] : []),
    "--network",
    "none",
    "--user",
    "65532:65532",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--read-only",
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "--cpus",
    String(policy.cpus),
    "--pids-limit",
    String(policy.pids),
    "--shm-size",
    "16m",
    "--log-driver",
    "none",
    "--ulimit",
    "nofile=256:256",
    "--ulimit",
    "fsize=67108864:67108864",
    "--mount",
    `type=bind,source=${sourcePath},target=/source,readonly`,
    "--tmpfs",
    `/work:rw,nosuid,nodev,noexec,size=${policy.workMb}m,mode=0700,uid=65532,gid=65532,nr_inodes=8192`,
    "--tmpfs",
    `/tmp:rw,nosuid,nodev,noexec,size=${policy.tmpMb}m,mode=1777,uid=65532,gid=65532,nr_inodes=4096`,
    "--workdir",
    "/work",
    "--env",
    "HOME=/tmp",
    "--env",
    "TEXMFVAR=/tmp/texmf-var",
    "--env",
    "TEXMFCONFIG=/tmp/texmf-config",
    "--env",
    "TEXMFHOME=/tmp/texmf-home",
    "--env",
    "XDG_CACHE_HOME=/tmp/cache",
    "--env",
    "VARTEXFONTS=/tmp/fonts",
    "--env",
    "openin_any=p",
    "--env",
    "openout_any=p",
    "--entrypoint",
    "sleep",
    imageId,
    String(ttlSeconds),
  ];
}
