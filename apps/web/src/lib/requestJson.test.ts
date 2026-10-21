// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readBoundedText, readJsonBody } from "@/lib/requestJson";

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("requestJson", () => {
  it("parses small bodies within the cap", async () => {
    const res = await readJsonBody(post(JSON.stringify({ a: 1 })), 2048);
    expect(res).toEqual({ ok: true, value: { a: 1 } });
  });

  it("rejects declared over-cap bodies without reading the stream", async () => {
    const res = await readJsonBody(
      post("x".repeat(3000), { "content-length": "3000" }),
      2048,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(413);
  });

  it("aborts lying content-length streams at the byte cap", async () => {
    const big = JSON.stringify({ data: "x".repeat(5000) });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const req = new Request("http://localhost:3000/api", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "10",
        duplex: "half",
      } as Record<string, string>,
      body: stream as BodyInit,
      duplex: "half",
    } as RequestInit);
    const res = await readJsonBody(req, 2048);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(413);
  });

  it("counts bytes, not characters", async () => {
    // 1500 chars but 3000 bytes: the old text.length check would allow it.
    const res = await readBoundedText(post("é".repeat(1500)), 2048);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(413);
  });

  it("accepts bodies exactly at the cap", async () => {
    const exact = "y".repeat(2048);
    const res = await readBoundedText(post(exact), 2048);
    expect(res).toEqual({ ok: true, text: exact });
  });

  it("rejects malformed content lengths without reading", async () => {
    for (const declared of ["abc", "-5", "1.5"]) {
      const bad = await readJsonBody(
        new Request("http://localhost:3000/api", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": declared,
          },
          body: "{}",
        }),
        2048,
      );
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.response.status).toBe(400);
    }
  });

  it("rejects invalid and empty JSON", async () => {
    const invalid = await readJsonBody(post("{oops"), 2048);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.response.status).toBe(400);
    const empty = await readJsonBody(post(null), 2048);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.response.status).toBe(400);
  });
});

it("refuses non-object JSON before route handlers access request fields", async () => {
  for (const value of [null, [], "text", 1, true]) {
    const result = await readJsonBody(post(JSON.stringify(value)), 2048);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  }
});
