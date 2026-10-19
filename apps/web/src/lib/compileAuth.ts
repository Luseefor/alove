import {
  isLocalStandalone,
  isPlaceholderConfigValue,
} from "@/lib/localStandalone";

export type CompileAuthPolicy =
  | { allowAnonymous: true }
  | { allowAnonymous: false }
  | { error: string };

export function getCompileAuthPolicy(
  env: NodeJS.ProcessEnv = process.env,
): CompileAuthPolicy {
  if (isLocalStandalone(env)) {
    return { allowAnonymous: true };
  }

  const clerkSecret = env.CLERK_SECRET_KEY?.trim() ?? "";
  if (!clerkSecret) {
    return { error: "Missing required environment variable: CLERK_SECRET_KEY" };
  }
  if (isPlaceholderConfigValue(clerkSecret)) {
    return { error: "Invalid CLERK_SECRET_KEY placeholder value" };
  }

  return { allowAnonymous: false };
}
