import {
  COMPILE_REQUEST_LIMITS,
  PERSONAL_CLOUD_REQUEST_BYTES,
  type CompileJobPayload,
} from "@alove/protocol";

/** Reject before fetch, including requests too large for the hosting proxy. */
export function serializeCompileRequest(request: CompileJobPayload): string {
  const body = JSON.stringify(request);
  const personal = process.env.NEXT_PUBLIC_COMPILE_RUNTIME === "vercel-sandbox";
  const cap = personal
    ? PERSONAL_CLOUD_REQUEST_BYTES
    : COMPILE_REQUEST_LIMITS.maxRequestBytes;
  if (new TextEncoder().encode(body).byteLength > cap)
    throw new Error(
      personal
        ? "Personal cloud builds support up to 3 MB of project data. Reduce image sizes or split the project."
        : "Compile request is too large.",
    );
  return body;
}
