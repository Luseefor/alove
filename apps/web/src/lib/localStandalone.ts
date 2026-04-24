/** True when the app runs without Clerk/Convex (offline editor + compile queue only). */
export function isLocalStandalone(): boolean {
  return (
    process.env.NEXT_PUBLIC_LOCAL_STANDALONE === "true" ||
    process.env.NEXT_PUBLIC_LOCAL_STANDALONE === "1"
  );
}
