function flagEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/** True when the app runs without Clerk/Convex (offline editor + compile queue only). */
export function isLocalStandalone(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagEnabled(env.NEXT_PUBLIC_LOCAL_STANDALONE);
}

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function isPlaceholderConfigValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("placeholder") ||
    normalized.includes("example.com") ||
    normalized.includes("changeme") ||
    normalized.includes("your-")
  );
}
