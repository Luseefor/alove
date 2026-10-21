/**
 * Bounded request-body reading for cloud API routes.
 *
 * The old pattern (`req.text()` then a length check) buffers the entire
 * body first: a lying or missing Content-Length lets a hostile client force
 * unbounded memory before any limit applies. This helper:
 * - pre-checks a declared Content-Length (malformed → 400, over cap → 413
 *   without touching the stream),
 * - then streams with a byte cap, cancelling the reader at the limit.
 * Byte counts use the wire encoding (`byteLength`), not JS string length,
 * so multibyte bodies cannot slip past a character-count check.
 */

export type BoundedText =
  | { ok: true; text: string }
  | { ok: false; response: Response };

function tooLarge(): BoundedText {
  return {
    ok: false,
    response: Response.json({ error: "Request too large." }, { status: 413 }),
  };
}

export async function readBoundedText(
  req: Request,
  maxBytes: number,
): Promise<BoundedText> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isSafeInteger(n) || n < 0) {
      return {
        ok: false,
        response: Response.json(
          { error: "Invalid Content-Length." },
          { status: 400 },
        ),
      };
    }
    if (n > maxBytes) return tooLarge();
  }
  const body = req.body;
  if (body === null) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } catch {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancel failures; the body is already unusable.
      }
      return {
        ok: false,
        response: Response.json(
          { error: "Could not read request body." },
          { status: 400 },
        ),
      };
    }
    if (result.done) break;
    const value = result.value;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancel failures; the cap has already fired.
      }
      return tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(out) };
}

export type BoundedJson =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

export async function readJsonBody(
  req: Request,
  maxBytes: number,
): Promise<BoundedJson> {
  const body = await readBoundedText(req, maxBytes);
  if (!body.ok) return body;
  try {
    const value: unknown = JSON.parse(body.text);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return {
        ok: false,
        response: Response.json(
          { error: "Expected a JSON object." },
          { status: 400 },
        ),
      };
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON body." }, { status: 400 }),
    };
  }
}
